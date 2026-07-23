import { create } from 'zustand'
import { supabase } from '../lib/supabaseClient'
import { Website, Document, Folder, Guidelines } from '../types'
import { v4 as uuidv4 } from 'uuid'

interface ToolState {
  websites: Website[]
  documents: Document[]
  folders: Folder[]
  guidelines: Guidelines[]
  loading: boolean

  initialize: () => Promise<void>

  addWebsite: (website: Omit<Website, 'id'>) => Promise<void>
  updateWebsite: (id: string, updates: Partial<Website>) => Promise<void>
  deleteWebsite: (id: string) => Promise<void>

  uploadDocument: (employeeId: string, file: File, folderId?: string) => Promise<void>
  deleteDocument: (id: string) => Promise<void>
  getDocumentUrl: (storagePath: string) => Promise<string | null>

  createFolder: (name: string, ownerId: string) => Promise<void>
  deleteFolder: (id: string) => Promise<void>

  saveGuidelines: (employeeId: string, content: string, updatedBy: string) => Promise<void>
  getGuidelines: (employeeId: string) => Guidelines | undefined
}

function toWebsite(row: any): Website {
  return {
    id: row.id,
    name: row.name,
    url: row.url,
    description: row.description,
    assignedTo: (row.website_assignments ?? []).map((a: any) => a.employee_id),
    faviconUrl: row.favicon_url ?? undefined,
  }
}

function toDocument(row: any): Document {
  return {
    id: row.id,
    name: row.name,
    type: row.type,
    size: row.size,
    uploadedAt: row.uploaded_at,
    uploadedBy: row.uploaded_by,
    storagePath: row.storage_path,
    folderId: row.folder_id ?? undefined,
  }
}

function toGuidelines(row: any): Guidelines {
  return {
    employeeId: row.employee_id,
    content: row.content,
    updatedAt: row.updated_at,
    updatedBy: row.updated_by,
  }
}

export const useToolStore = create<ToolState>()((set, get) => ({
  websites: [],
  documents: [],
  folders: [],
  guidelines: [],
  loading: false,

  initialize: async () => {
    set({ loading: true })
    const [websitesRes, documentsRes, foldersRes, guidelinesRes] = await Promise.all([
      supabase.from('websites').select('*, website_assignments(employee_id)'),
      supabase.from('documents').select('*'),
      supabase.from('folders').select('*'),
      supabase.from('guidelines').select('*'),
    ])

    set({
      websites: (websitesRes.data ?? []).map(toWebsite),
      documents: (documentsRes.data ?? []).map(toDocument),
      folders: foldersRes.data ?? [],
      guidelines: (guidelinesRes.data ?? []).map(toGuidelines),
      loading: false,
    })
  },

  addWebsite: async (website) => {
    const { data, error } = await supabase
      .from('websites')
      .insert({ name: website.name, url: website.url, description: website.description, favicon_url: website.faviconUrl ?? null })
      .select()
      .single()

    if (error || !data) return

    if (website.assignedTo.length > 0) {
      await supabase
        .from('website_assignments')
        .insert(website.assignedTo.map((employeeId) => ({ website_id: data.id, employee_id: employeeId })))
    }

    set((s) => ({ websites: [...s.websites, toWebsite({ ...data, website_assignments: website.assignedTo.map(id => ({ employee_id: id })) })] }))
  },

  updateWebsite: async (id, updates) => {
    const patch: Record<string, unknown> = {}
    if (updates.name !== undefined) patch.name = updates.name
    if (updates.url !== undefined) patch.url = updates.url
    if (updates.description !== undefined) patch.description = updates.description
    if (updates.faviconUrl !== undefined) patch.favicon_url = updates.faviconUrl

    if (Object.keys(patch).length > 0) {
      await supabase.from('websites').update(patch).eq('id', id)
    }

    if (updates.assignedTo !== undefined) {
      await supabase.from('website_assignments').delete().eq('website_id', id)
      if (updates.assignedTo.length > 0) {
        await supabase
          .from('website_assignments')
          .insert(updates.assignedTo.map((employeeId) => ({ website_id: id, employee_id: employeeId })))
      }
    }

    set((s) => ({ websites: s.websites.map((w) => (w.id === id ? { ...w, ...updates } : w)) }))
  },

  deleteWebsite: async (id) => {
    await supabase.from('websites').delete().eq('id', id)
    set((s) => ({ websites: s.websites.filter((w) => w.id !== id) }))
  },

  uploadDocument: async (employeeId, file, folderId) => {
    const documentId = uuidv4()
    const path = `documents/${employeeId}/${documentId}-${file.name}`

    const { error: uploadErr } = await supabase.storage.from('attachments').upload(path, file)
    if (uploadErr) return

    const { data, error } = await supabase
      .from('documents')
      .insert({
        name: file.name,
        type: file.type || file.name.split('.').pop() || 'unknown',
        size: file.size,
        uploaded_by: employeeId,
        storage_path: path,
        folder_id: folderId ?? null,
      })
      .select()
      .single()

    if (error || !data) return
    set((s) => ({ documents: [...s.documents, toDocument(data)] }))
  },

  deleteDocument: async (id) => {
    const doc = get().documents.find((d) => d.id === id)
    if (doc) await supabase.storage.from('attachments').remove([doc.storagePath])
    await supabase.from('documents').delete().eq('id', id)
    set((s) => ({ documents: s.documents.filter((d) => d.id !== id) }))
  },

  getDocumentUrl: async (storagePath) => {
    const { data, error } = await supabase.storage.from('attachments').createSignedUrl(storagePath, 60)
    if (error || !data) return null
    return data.signedUrl
  },

  createFolder: async (name, ownerId) => {
    const { data, error } = await supabase
      .from('folders')
      .insert({ name, owner_id: ownerId })
      .select()
      .single()

    if (error || !data) return
    set((s) => ({ folders: [...s.folders, data] }))
  },

  deleteFolder: async (id) => {
    await supabase.from('folders').delete().eq('id', id)
    set((s) => ({ folders: s.folders.filter((f) => f.id !== id) }))
  },

  saveGuidelines: async (employeeId, content, updatedBy) => {
    const { data, error } = await supabase
      .from('guidelines')
      .upsert({ employee_id: employeeId, content, updated_by: updatedBy, updated_at: new Date().toISOString() })
      .select()
      .single()

    if (error || !data) return

    set((s) => {
      const existing = s.guidelines.find((g) => g.employeeId === employeeId)
      const updated = toGuidelines(data)
      return {
        guidelines: existing
          ? s.guidelines.map((g) => (g.employeeId === employeeId ? updated : g))
          : [...s.guidelines, updated],
      }
    })
  },

  getGuidelines: (employeeId) => get().guidelines.find((g) => g.employeeId === employeeId),
}))
