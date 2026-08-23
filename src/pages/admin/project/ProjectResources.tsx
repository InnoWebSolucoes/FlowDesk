import React, { useEffect, useState } from 'react'
import { useOutletContext } from 'react-router-dom'
import { Orbit, FolderTree } from 'lucide-react'
import { Project, ResourceItem } from '../../../types'
import { useProjectStore } from '../../../store/projectStore'
import { ResourceCanvas } from '../../../components/resources/ResourceCanvas'
import { ResourceFolders } from '../../../components/resources/ResourceFolders'
import { ResourceItemPanel } from '../../../components/resources/ResourceItemPanel'

interface Ctx { project: Project }

type View = 'canvas' | 'folders'

export function ProjectResources() {
  const { project } = useOutletContext<Ctx>()
  const { resourcesLoadedFor, loadResources, items, getFileUrl } = useProjectStore()

  const [view, setView] = useState<View>(() => {
    try {
      return (localStorage.getItem(`flowdesk:resourceView:${project.id}`) as View) || 'canvas'
    } catch {
      return 'canvas'
    }
  })
  // Shared so switching views keeps you in the same cluster.
  const [clusterId, setClusterId] = useState<string | null>(null)
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null)

  useEffect(() => {
    if (resourcesLoadedFor !== project.id) loadResources(project.id)
  }, [project.id, resourcesLoadedFor, loadResources])

  const chooseView = (next: View) => {
    setView(next)
    try {
      localStorage.setItem(`flowdesk:resourceView:${project.id}`, next)
    } catch {
      // Blocked storage just means the choice isn't remembered.
    }
  }

  /** Open a document's file in a new tab; link-only items use their first link. */
  const openItem = async (item: ResourceItem) => {
    if (!item.storagePath) {
      const first = item.links[0]
      if (first) window.open(first.url, '_blank', 'noopener,noreferrer')
      return
    }
    const tab = window.open('', '_blank')
    if (tab) tab.opener = null
    const url = await getFileUrl(item.storagePath)
    if (!url) { tab?.close(); return }
    if (tab && !tab.closed) tab.location.replace(url)
    else window.open(url, '_blank', 'noopener,noreferrer')
  }

  const selectedItem = selectedItemId ? items.find((i) => i.id === selectedItemId) ?? null : null

  return (
    <div>
      <div className="flex items-center justify-between gap-3 mb-4">
        <p className="text-text-muted text-sm">
          {view === 'canvas'
            ? 'Two fingers to pan, pinch to zoom. Zoom into a cluster to enter it, zoom back out to leave.'
            : 'The same clusters and documents as nested folders.'}
        </p>

        <div className="flex items-center gap-0.5 flex-shrink-0 bg-surface-2 rounded-lg p-0.5">
          {([
            ['canvas', Orbit, 'Cluster view'],
            ['folders', FolderTree, 'Folder view'],
          ] as const).map(([v, Icon, label]) => (
            <button
              key={v}
              onClick={() => chooseView(v)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                view === v ? 'bg-surface text-text-main shadow-sm' : 'text-text-muted hover:text-text-main'
              }`}
            >
              <Icon size={14} /> {label}
            </button>
          ))}
        </div>
      </div>

      {view === 'canvas' ? (
        <ResourceCanvas
          projectId={project.id}
          clusterId={clusterId}
          onNavigate={setClusterId}
        />
      ) : (
        <div className="relative">
          <ResourceFolders
            projectId={project.id}
            clusterId={clusterId}
            onNavigate={setClusterId}
            onSelectItem={(i) => setSelectedItemId(i.id)}
            onOpenItem={openItem}
          />
          {selectedItem && (
            <div className="fixed inset-y-0 right-0 z-40 w-full sm:w-[380px]">
              <ResourceItemPanel
                key={selectedItem.id}
                item={selectedItem}
                onClose={() => setSelectedItemId(null)}
              />
            </div>
          )}
        </div>
      )}
    </div>
  )
}
