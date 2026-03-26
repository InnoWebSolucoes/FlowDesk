import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { Website, Document, Folder, Guidelines } from '../types'
import { sampleWebsites, anaGuidelines } from '../data/sampleData'
import { v4 as uuidv4 } from 'uuid'

interface ToolState {
  websites: Website[]
  documents: Document[]
  folders: Folder[]
  guidelines: Guidelines[]
  initialized: boolean

  // Website
  addWebsite: (website: Website) => void
  updateWebsite: (id: string, updates: Partial<Website>) => void
  deleteWebsite: (id: string) => void

  // Documents
  uploadDocument: (employeeId: string, file: File, folderId?: string) => Promise<void>
  deleteDocument: (id: string) => void

  // Folders
  createFolder: (name: string, ownerId: string) => void
  deleteFolder: (id: string) => void

  // Guidelines
  saveGuidelines: (employeeId: string, content: string, updatedBy: string) => void
  getGuidelines: (employeeId: string) => Guidelines | undefined

  initialize: () => void
}

export const useToolStore = create<ToolState>()(
  persist(
    (set, get) => ({
      websites: [],
      documents: [],
      folders: [],
      guidelines: [],
      initialized: false,

      initialize: () => {
        if (get().initialized) return
        set({
          websites: sampleWebsites,
          guidelines: [anaGuidelines],
          initialized: true,
        })
      },

      addWebsite: (website) => set((s) => ({ websites: [...s.websites, website] })),
      updateWebsite: (id, updates) =>
        set((s) => ({ websites: s.websites.map((w) => (w.id === id ? { ...w, ...updates } : w)) })),
      deleteWebsite: (id) => set((s) => ({ websites: s.websites.filter((w) => w.id !== id) })),

      uploadDocument: async (employeeId, file, folderId) => {
        return new Promise((resolve, reject) => {
          const reader = new FileReader()
          reader.onload = () => {
            const doc: Document = {
              id: uuidv4(),
              name: file.name,
              type: file.type || file.name.split('.').pop() || 'unknown',
              size: file.size,
              uploadedAt: new Date().toISOString(),
              uploadedBy: employeeId,
              data: reader.result as string,
              folderId,
            }
            set((s) => ({ documents: [...s.documents, doc] }))
            resolve()
          }
          reader.onerror = reject
          reader.readAsDataURL(file)
        })
      },

      deleteDocument: (id) => set((s) => ({ documents: s.documents.filter((d) => d.id !== id) })),

      createFolder: (name, ownerId) => {
        const folder: Folder = {
          id: uuidv4(),
          name,
          ownerId,
          createdAt: new Date().toISOString(),
        }
        set((s) => ({ folders: [...s.folders, folder] }))
      },

      deleteFolder: (id) => set((s) => ({ folders: s.folders.filter((f) => f.id !== id) })),

      saveGuidelines: (employeeId, content, updatedBy) => {
        set((s) => {
          const existing = s.guidelines.find((g) => g.employeeId === employeeId)
          if (existing) {
            return {
              guidelines: s.guidelines.map((g) =>
                g.employeeId === employeeId
                  ? { ...g, content, updatedAt: new Date().toISOString(), updatedBy }
                  : g
              ),
            }
          }
          return {
            guidelines: [
              ...s.guidelines,
              { employeeId, content, updatedAt: new Date().toISOString(), updatedBy },
            ],
          }
        })
      },

      getGuidelines: (employeeId) => get().guidelines.find((g) => g.employeeId === employeeId),
    }),
    { name: 'flowdesk-tools' }
  )
)
