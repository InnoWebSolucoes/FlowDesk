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
  /**
   * Take a site off one person's list. A site can be on several lists, so
   * this never deletes it for anyone else; it goes altogether only when
   * nobody has it any more.
   */
  removeWebsiteFor: (websiteId: string, employeeId: string) => Promise<void>

  uploadDocument: (employeeId: string, file: File, folderId?: string) => Promise<void>
  deleteDocument: (id: string) => Promise<void>
  /** What the document is called in the list, and the icon beside it. */
  updateDocument: (id: string, patch: { title?: string; iconUrl?: string | null }) => Promise<void>
  getDocumentUrl: (storagePath: string) => Promise<string | null>

  createFolder: (name: string, ownerId: string) => Promise<void>
  deleteFolder: (id: string) => Promise<void>

  saveGuidelines: (employeeId: string, content: string, updatedBy: string) => Promise<void>
  getGuidelines: (employeeId: string) => Guidelines | undefined
}

/** Does this look like a web address rather than a name? */
function looksLikeUrl(v: string | null | undefined): boolean {
  const s = (v ?? '').trim()
  if (!s) return false
  if (/^https?:\/\//i.test(s)) return true
  // A bare domain: something.something, no spaces.
  return /^[^\s/]+\.[a-z]{2,}(\/|$)/i.test(s)
}

/**
 * A website row, with the two fields put back the right way round when they
 * were entered swapped.
 *
 * The add form was three unlabelled boxes with the address first, so the URL
 * went into the name and the name into the URL. The label then read
 * "https://drive.google.com" and the favicon was looked up for a hostname
 * that never existed — which is why every tile showed the generic globe.
 *
 * FIX_SWAPPED_WEBSITES.sql repairs the stored rows, but relying on a script
 * having been run is how this survived two rounds of being reported fixed.
 * Corrected on the way in as well, so the list is right whether or not the
 * database has been tidied: only when the name really is an address and the
 * url really is not, which cannot touch a row that was entered correctly.
 */
function toWebsite(row: any): Website {
  const swapped = looksLikeUrl(row.name) && !looksLikeUrl(row.url)
  const url = swapped ? row.name : row.url
  const name = swapped ? row.url : row.name

  return {
    id: row.id,
    // A name that is still just the address reads as no name at all, so it
    // falls back to the hostname — "drive.google.com" rather than the whole
    // truncated URL.
    name: (name ?? '').trim() || hostOf(url) || (url ?? ''),
    url,
    description: row.description,
    assignedTo: (row.website_assignments ?? []).map((a: any) => a.employee_id),
    faviconUrl: row.favicon_url ?? undefined,
  }
}

/** The hostname, for when a site has no name worth showing. */
function hostOf(url: string | null | undefined): string {
  const raw = (url ?? '').trim()
  if (!raw) return ''
  try {
    return new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`).hostname.replace(/^www\./, '')
  } catch {
    return raw.replace(/^https?:\/\//i, '').split('/')[0]
  }
}

function toDocument(row: any): Document {
  return {
    id: row.id,
    name: row.name,
    // Rows uploaded before titles existed have none; the filename is what
    // they were shown as, so it stays what they are shown as.
    title: row.title || row.name,
    iconUrl: row.icon_url ?? null,
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
    // The id is generated here rather than read back. Selecting the row after
    // inserting it needs a matching select policy, and a site is only visible
    // to somebody once they are assigned to it — which happens on the next
    // statement. So for anyone but the owner the insert succeeded and the
    // read came back empty, and the function returned before ever writing the
    // assignment: the site was created, belonged to nobody, and the button
    // looked like it had done nothing.
    const id = uuidv4()
    const row = {
      id,
      name: website.name,
      url: website.url,
      description: website.description,
      favicon_url: website.faviconUrl ?? null,
    }

    const { error } = await supabase.from('websites').insert(row)
    if (error) {
      console.error('[addWebsite] failed:', error)
      throw new Error(error.message)
    }

    if (website.assignedTo.length > 0) {
      const { error: assignErr } = await supabase
        .from('website_assignments')
        .insert(website.assignedTo.map((employeeId) => ({ website_id: id, employee_id: employeeId })))
      if (assignErr) {
        // Without an assignment the site is on nobody's list and invisible to
        // everyone but the owner, so a half-done add is worse than none.
        await supabase.from('websites').delete().eq('id', id)
        console.error('[addWebsite] assignment failed:', assignErr)
        throw new Error(assignErr.message)
      }
    }

    set((s) => ({
      websites: [
        ...s.websites,
        toWebsite({ ...row, website_assignments: website.assignedTo.map((e) => ({ employee_id: e })) }),
      ],
    }))
  },

  updateWebsite: async (id, updates) => {
    const patch: Record<string, unknown> = {}
    if (updates.name !== undefined) patch.name = updates.name
    if (updates.url !== undefined) patch.url = updates.url
    if (updates.description !== undefined) patch.description = updates.description
    if (updates.faviconUrl !== undefined) patch.favicon_url = updates.faviconUrl

    if (Object.keys(patch).length > 0) {
      // Checked: an edit refused here used to look saved until the next reload.
      const { error } = await supabase.from('websites').update(patch).eq('id', id)
      if (error) {
        console.error('[updateWebsite] failed:', error)
        throw new Error(error.message)
      }
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

  removeWebsiteFor: async (websiteId, employeeId) => {
    // Through a function, because an employee can only see their own
    // assignment: they cannot tell whether anyone else has the site, so they
    // cannot know whether deleting the whole row is safe. The function can.
    const { error } = await supabase.rpc('remove_website_from_list', {
      p_website: websiteId,
      p_employee: employeeId,
    })
    if (error) {
      // Until that migration has run, take it off this person's list directly.
      // The site row stays behind, where only the owner could ever see it.
      console.warn('[removeWebsiteFor] falling back to removing the assignment:', error.message)
      const { error: direct } = await supabase
        .from('website_assignments')
        .delete()
        .eq('website_id', websiteId)
        .eq('employee_id', employeeId)
      if (direct) {
        console.error('[removeWebsiteFor] failed:', direct)
        throw new Error(direct.message)
      }
    }
    set((s) => ({
      websites: s.websites
        .map((w) => (w.id === websiteId ? { ...w, assignedTo: w.assignedTo.filter((a) => a !== employeeId) } : w))
        .filter((w) => w.id !== websiteId || w.assignedTo.length > 0),
    }))
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
        title: file.name,
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

  updateDocument: async (id, patch) => {
    const row: Record<string, unknown> = {}
    if (patch.title !== undefined) row.title = patch.title
    if (patch.iconUrl !== undefined) row.icon_url = patch.iconUrl
    if (Object.keys(row).length === 0) return

    const { error } = await supabase.from('documents').update(row).eq('id', id)
    if (error) {
      console.error('[updateDocument] failed:', error)
      throw new Error(error.message)
    }
    set((s) => ({
      documents: s.documents.map((d) =>
        d.id === id
          ? { ...d, ...(patch.title !== undefined ? { title: patch.title } : {}),
              ...(patch.iconUrl !== undefined ? { iconUrl: patch.iconUrl } : {}) }
          : d,
      ),
    }))
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
