import React, { useMemo, useState } from 'react'
import {
  ChevronRight, Home, Folder, LayoutGrid, List as ListIcon,
  ArrowUp, ArrowDown, ExternalLink, Link2,
} from 'lucide-react'
import { format, parseISO } from 'date-fns'
import { ResourceCluster, ResourceItem } from '../../types'
import { useProjectStore } from '../../store/projectStore'
import { ResourceThumbnail, FileKindIcon, kindStyle, fileKind, formatFileSize } from './ResourceThumbnail'

type SortKey = 'name' | 'type' | 'size' | 'modified'
type ViewMode = 'list' | 'grid'

/** Sortable column header. Hoisted so it isn't redefined on every render. */
function SortHeader({
  label,
  k,
  sortKey,
  sortAsc,
  onSort,
  className = '',
}: {
  label: string
  k: SortKey
  sortKey: SortKey
  sortAsc: boolean
  onSort: (k: SortKey) => void
  className?: string
}) {
  return (
    <button
      onClick={() => onSort(k)}
      className={`flex items-center gap-1 text-[11px] font-medium text-text-muted hover:text-text-main transition-colors ${className}`}
    >
      {label}
      {sortKey === k && (sortAsc ? <ArrowUp size={11} /> : <ArrowDown size={11} />)}
    </button>
  )
}

interface Props {
  projectId: string
  /** Shared with the canvas so switching views keeps your place. */
  clusterId: string | null
  onNavigate: (clusterId: string | null) => void
  onSelectItem: (item: ResourceItem) => void
  onOpenItem: (item: ResourceItem) => void
}

/**
 * The conventional counterpart to the canvas: the same clusters and documents
 * as nested folders, in a sortable list or an icon grid.
 */
export function ResourceFolders({ projectId, clusterId, onNavigate, onSelectItem, onOpenItem }: Props) {
  const { clusters, items } = useProjectStore()
  const [mode, setMode] = useState<ViewMode>('list')
  const [sortKey, setSortKey] = useState<SortKey>('name')
  const [sortAsc, setSortAsc] = useState(true)

  const folders = useMemo(
    () =>
      clusters
        .filter((c) => c.projectId === projectId && c.parentClusterId === clusterId)
        .sort((a, b) => a.title.localeCompare(b.title)),
    [clusters, projectId, clusterId]
  )

  const files = useMemo(() => {
    const here = items.filter((i) =>
      i.projectId === projectId &&
      (clusterId ? i.clusterIds.includes(clusterId) : i.clusterIds.length === 0)
    )

    const dir = sortAsc ? 1 : -1
    return [...here].sort((a, b) => {
      switch (sortKey) {
        case 'type':
          return dir * fileKind(a.mimeType, a.fileName).localeCompare(fileKind(b.mimeType, b.fileName))
        case 'size':
          return dir * ((a.size ?? 0) - (b.size ?? 0))
        case 'modified':
          return dir * a.updatedAt.localeCompare(b.updatedAt)
        default:
          return dir * a.title.localeCompare(b.title)
      }
    })
  }, [items, projectId, clusterId, sortKey, sortAsc])

  const trail = useMemo(() => {
    const path: ResourceCluster[] = []
    let id = clusterId
    while (id) {
      const c = clusters.find((x) => x.id === id)
      if (!c) break
      path.unshift(c)
      id = c.parentClusterId
    }
    return path
  }, [clusterId, clusters])

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) setSortAsc(!sortAsc)
    else { setSortKey(key); setSortAsc(true) }
  }

  const countsFor = (id: string) => ({
    folders: clusters.filter((c) => c.parentClusterId === id).length,
    files: items.filter((i) => i.clusterIds.includes(id)).length,
  })

  return (
    <div className="rounded-xl border border-border bg-surface overflow-hidden">
      {/* Breadcrumb + view switch */}
      <div className="flex items-center justify-between gap-3 px-4 py-2.5 border-b border-border">
        <nav className="flex items-center gap-1 text-sm min-w-0 overflow-x-auto">
          <button
            onClick={() => onNavigate(null)}
            className={`flex items-center gap-1.5 px-2 py-1 rounded-md flex-shrink-0 transition-colors ${
              clusterId === null ? 'text-text-main font-medium' : 'text-text-muted hover:text-text-main'
            }`}
          >
            <Home size={14} /> Resources
          </button>
          {trail.map((c) => (
            <React.Fragment key={c.id}>
              <ChevronRight size={13} className="text-text-subtle flex-shrink-0" />
              <button
                onClick={() => onNavigate(c.id)}
                className={`px-2 py-1 rounded-md flex-shrink-0 truncate max-w-[160px] transition-colors ${
                  c.id === clusterId ? 'text-text-main font-medium' : 'text-text-muted hover:text-text-main'
                }`}
              >
                {c.title}
              </button>
            </React.Fragment>
          ))}
        </nav>

        <div className="flex items-center gap-0.5 flex-shrink-0 bg-surface-2 rounded-md p-0.5">
          {([['list', ListIcon], ['grid', LayoutGrid]] as const).map(([m, Icon]) => (
            <button
              key={m}
              onClick={() => setMode(m)}
              className={`p-1.5 rounded transition-colors ${
                mode === m ? 'bg-surface text-text-main shadow-sm' : 'text-text-muted hover:text-text-main'
              }`}
              title={m === 'list' ? 'List view' : 'Grid view'}
            >
              <Icon size={14} />
            </button>
          ))}
        </div>
      </div>

      {folders.length === 0 && files.length === 0 ? (
        <p className="text-text-subtle text-sm text-center py-16">
          {clusterId ? 'This cluster is empty.' : 'No resources yet.'}
        </p>
      ) : mode === 'list' ? (
        <div>
          {/* Column headers */}
          <div className="flex items-center gap-3 px-4 py-2 border-b border-border bg-surface-2">
            <span className="w-5 flex-shrink-0" />
            {([
              ['Name', 'name', 'flex-1'],
              ['Type', 'type', 'w-16 flex-shrink-0'],
              ['Size', 'size', 'w-20 flex-shrink-0'],
              ['Modified', 'modified', 'w-24 flex-shrink-0'],
            ] as const).map(([label, k, cls]) => (
              <SortHeader
                key={k}
                label={label}
                k={k}
                sortKey={sortKey}
                sortAsc={sortAsc}
                onSort={toggleSort}
                className={cls}
              />
            ))}
            <span className="w-8 flex-shrink-0" />
          </div>

          {/* Folders first, as in any file browser */}
          {folders.map((f) => {
            const { folders: sub, files: n } = countsFor(f.id)
            return (
              <button
                key={f.id}
                onDoubleClick={() => onNavigate(f.id)}
                onClick={() => onNavigate(f.id)}
                className="w-full flex items-center gap-3 px-4 py-2 border-b border-border hover:bg-surface-2 transition-colors text-left"
              >
                <Folder size={16} style={{ color: f.color }} className="flex-shrink-0" />
                <span className="flex-1 text-sm text-text-main truncate">{f.title}</span>
                <span className="w-16 flex-shrink-0 text-[11px] text-text-subtle">Folder</span>
                <span className="w-20 flex-shrink-0 text-[11px] text-text-subtle">
                  {n + sub > 0 ? `${n + sub} items` : '—'}
                </span>
                <span className="w-24 flex-shrink-0 text-[11px] text-text-subtle">
                  {format(parseISO(f.createdAt), 'd MMM yyyy')}
                </span>
                <span className="w-8 flex-shrink-0" />
              </button>
            )
          })}

          {files.map((i) => (
            <div
              key={i.id}
              onClick={() => onSelectItem(i)}
              onDoubleClick={() => onOpenItem(i)}
              className="w-full flex items-center gap-3 px-4 py-2 border-b border-border hover:bg-surface-2 transition-colors cursor-pointer"
              title={`${i.title}\nClick for details · double-click to open`}
            >
              <span className="flex-shrink-0" style={{ color: kindStyle(fileKind(i.mimeType, i.fileName)).color }}>
                <FileKindIcon mime={i.mimeType} fileName={i.fileName} size={16} />
              </span>
              <span className="flex-1 min-w-0">
                <span className="block text-sm text-text-main truncate">{i.title}</span>
                {(i.clusterIds.length > 1 || i.links.length > 0 || i.versions.length > 0) && (
                  <span className="flex items-center gap-2 text-[10px] text-text-subtle">
                    {i.clusterIds.length > 1 && <span>in {i.clusterIds.length} clusters</span>}
                    {i.links.length > 0 && <span className="flex items-center gap-0.5"><Link2 size={9} />{i.links.length}</span>}
                    {i.versions.length > 0 && <span>v{i.versions.length + 1}</span>}
                  </span>
                )}
              </span>
              <span className="w-16 flex-shrink-0 text-[11px] text-text-subtle">
                {kindStyle(fileKind(i.mimeType, i.fileName)).label}
              </span>
              <span className="w-20 flex-shrink-0 text-[11px] text-text-subtle">
                {formatFileSize(i.size) || '—'}
              </span>
              <span className="w-24 flex-shrink-0 text-[11px] text-text-subtle">
                {format(parseISO(i.updatedAt), 'd MMM yyyy')}
              </span>
              <button
                onClick={(e) => { e.stopPropagation(); onOpenItem(i) }}
                className="w-8 flex-shrink-0 text-text-subtle hover:text-primary"
                title="Open"
              >
                <ExternalLink size={13} />
              </button>
            </div>
          ))}
        </div>
      ) : (
        /* Grid */
        <div className="p-4 grid gap-3 grid-cols-[repeat(auto-fill,minmax(132px,1fr))]">
          {folders.map((f) => {
            const { folders: sub, files: n } = countsFor(f.id)
            return (
              <button
                key={f.id}
                onClick={() => onNavigate(f.id)}
                className="flex flex-col items-center gap-2 p-3 rounded-xl border border-border hover:border-primary hover:shadow-md transition-all"
              >
                <Folder size={36} style={{ color: f.color }} />
                <span className="text-[11px] text-text-main text-center leading-tight line-clamp-2">{f.title}</span>
                <span className="text-[10px] text-text-subtle">{n + sub} items</span>
              </button>
            )
          })}

          {files.map((i) => (
            <div
              key={i.id}
              onClick={() => onSelectItem(i)}
              onDoubleClick={() => onOpenItem(i)}
              className="rounded-xl border border-border overflow-hidden hover:border-primary hover:shadow-md transition-all cursor-pointer"
              title={`${i.title}\nClick for details · double-click to open`}
            >
              <ResourceThumbnail item={i} width={132} height={92} />
              <div className="px-2 py-1.5 border-t border-border">
                <p className="text-[11px] text-text-main leading-tight line-clamp-2 break-words">{i.title}</p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
