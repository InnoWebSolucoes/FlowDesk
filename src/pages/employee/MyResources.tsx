import React, { useEffect, useRef, useState } from 'react'
import { useOutletContext } from 'react-router-dom'
import { Upload, Loader2 } from 'lucide-react'
import { Project, ResourceItem } from '../../types'
import { useAuthStore } from '../../store/authStore'
import { useProjectStore } from '../../store/projectStore'
import { ResourceFolders } from '../../components/resources/ResourceFolders'
import { ResourceItemPanel } from '../../components/resources/ResourceItemPanel'
import { DocumentWindow } from '../../components/resources/DocumentWindow'
import { googleEmbedUrl } from '../../components/resources/googleDocs'

interface Ctx { project: Project }

/**
 * The project's files, as an employee sees them.
 *
 * The folder view rather than the managers' canvas: the canvas is where the
 * project's structure is arranged, and that is a manager's job. What an
 * employee needs is to find a document, open it, and add their own — so this
 * is the browser plus an upload button, and nothing that rearranges the
 * project or changes who can see what.
 *
 * Which documents exist here is already decided by the access rules the
 * managers set; nothing on this page can widen them.
 */
export function MyResources() {
  const { project } = useOutletContext<Ctx>()
  const currentUser = useAuthStore((s) => s.currentUser)
  const { resourcesLoadedFor, loadResources, items, createItem } = useProjectStore()

  const [clusterId, setClusterId] = useState<string | null>(null)
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null)
  const [openDocId, setOpenDocId] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (resourcesLoadedFor !== project.id) loadResources(project.id)
  }, [project.id, resourcesLoadedFor, loadResources])

  /** Their own uploads are theirs to rename, move and delete. Nothing else is. */
  const canEditItem = (item: ResourceItem) => item.createdBy === currentUser?.id

  const openItem = (item: ResourceItem) => {
    const isPlainLink =
      !item.storagePath && item.links.length > 0 && !item.links.some((l) => googleEmbedUrl(l.url))
    if (isPlainLink) {
      window.open(item.links[0].url, '_blank', 'noopener,noreferrer')
      return
    }
    setOpenDocId(item.id)
  }

  const handleUpload = async (files: FileList | null) => {
    if (!files?.length) return
    setUploading(true)
    // Uploaded where you are looking, which is the only place you could mean.
    for (const file of Array.from(files)) {
      await createItem(project.id, clusterId, { title: file.name }, file)
    }
    setUploading(false)
    if (fileInput.current) fileInput.current.value = ''
  }

  const selectedItem = selectedItemId ? items.find((i) => i.id === selectedItemId) ?? null : null
  const openDoc = openDocId ? items.find((i) => i.id === openDocId) ?? null : null

  return (
    <div>
      <div className="flex items-center justify-between gap-3 mb-4">
        <p className="text-text-muted text-sm">
          The project's documents. Open one to read it, or add your own here.
        </p>

        <input
          ref={fileInput}
          type="file"
          multiple
          className="hidden"
          onChange={(e) => handleUpload(e.target.files)}
        />
        <button
          onClick={() => fileInput.current?.click()}
          disabled={uploading}
          className="flex items-center gap-1.5 bg-primary text-white text-sm font-medium px-3.5 py-2 rounded-lg hover:bg-primary-dark disabled:opacity-50 transition-colors flex-shrink-0"
        >
          {uploading ? <Loader2 size={15} className="animate-spin" /> : <Upload size={15} />}
          {uploading ? 'Uploading…' : 'Upload'}
        </button>
      </div>

      <div className="relative">
        <ResourceFolders
          projectId={project.id}
          clusterId={clusterId}
          onNavigate={setClusterId}
          onSelectItem={(i) => setSelectedItemId(i.id)}
          onOpenItem={openItem}
          canEditItem={canEditItem}
        />
        {selectedItem && (
          <div className="fixed inset-y-0 right-0 z-40 w-full sm:w-[380px]">
            <ResourceItemPanel
              key={selectedItem.id}
              item={selectedItem}
              readOnly={!canEditItem(selectedItem)}
              onClose={() => setSelectedItemId(null)}
            />
          </div>
        )}
      </div>

      {openDoc && <DocumentWindow item={openDoc} onClose={() => setOpenDocId(null)} />}
    </div>
  )
}
