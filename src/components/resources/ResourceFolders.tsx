import React, { useCallback, useMemo, useRef, useState } from 'react'
import {
  ChevronRight, Home, Folder, LayoutGrid, List as ListIcon,
  ArrowUp, ArrowDown, ExternalLink, Link2, CheckSquare, Square, X,
  FolderInput, Copy, Trash2, Tag,
} from 'lucide-react'
import { format, parseISO } from 'date-fns'
import { ResourceCluster, ResourceItem } from '../../types'
import { useProjectStore } from '../../store/projectStore'
import { ResourceThumbnail, FileKindIcon, kindStyle, fileKind, formatFileSize } from './ResourceThumbnail'
import { useMarqueeSelect } from './useMarqueeSelect'

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
 * as nested folders, in a sortable list or an icon grid, with selection and
 * bulk actions.
 */
export function ResourceFolders({ projectId, clusterId, onNavigate, onSelectItem, onOpenItem }: Props) {
  const { clusters, items, moveItem, setItemClusters, deleteItem, duplicateItem } = useProjectStore()
  const [mode, setMode] = useState<ViewMode>('list')
  const [sortKey, setSortKey] = useState<SortKey>('name')
  const [sortAsc, setSortAsc] = useState(true)

  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [menu, setMenu] = useState<{ itemId: string; x: number; y: number } | null>(null)
  const [movePicker, setMovePicker] = useState<'move' | 'tag' | null>(null)
  const lastClicked = useRef<string | null>(null)

  const scrollRef = useRef<HTMLDivElement>(null)

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

  const handleMarquee = useCallback((ids: string[], additive: boolean) => {
    setSelected((prev) => (additive ? new Set([...prev, ...ids]) : new Set(ids)))
  }, [])

  const { rect, register, onPointerDown } = useMarqueeSelect(scrollRef, handleMarquee)

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

  /** Click behaviour that matches a file browser: plain, ctrl/cmd, and shift. */
  const clickFile = (e: React.MouseEvent, item: ResourceItem) => {
    const additive = e.metaKey || e.ctrlKey

    if (e.shiftKey && lastClicked.current) {
      const ids = files.map((f) => f.id)
      const from = ids.indexOf(lastClicked.current)
      const to = ids.indexOf(item.id)
      if (from !== -1 && to !== -1) {
        const range = ids.slice(Math.min(from, to), Math.max(from, to) + 1)
        setSelected((prev) => new Set([...prev, ...range]))
        return
      }
    }

    if (additive) {
      setSelected((prev) => {
        const next = new Set(prev)
        if (next.has(item.id)) next.delete(item.id)
        else next.add(item.id)
        return next
      })
      lastClicked.current = item.id
      return
    }

    // A plain click with a selection running adjusts the selection rather than
    // opening the panel, which is what every file browser does.
    if (selected.size > 0) {
      setSelected(new Set([item.id]))
      lastClicked.current = item.id
      return
    }

    lastClicked.current = item.id
    onSelectItem(item)
  }

  const selectedItems = useMemo(
    () => items.filter((i) => selected.has(i.id)),
    [items, selected]
  )

  const clearSelection = () => setSelected(new Set())

  // ─── Bulk actions ──────────────────────────────────────────────────────────

  const bulkMove = async (targetId: string | null) => {
    for (const i of selectedItems) {
      await moveItem(i.id, targetId, i.x, i.y)
    }
    setMovePicker(null)
    clearSelection()
  }

  const bulkTag = async (targetId: string) => {
    for (const i of selectedItems) {
      if (!i.clusterIds.includes(targetId)) {
        await setItemClusters(i.id, [...i.clusterIds, targetId])
      }
    }
    setMovePicker(null)
    clearSelection()
  }

  const bulkDuplicate = async () => {
    for (const i of selectedItems) await duplicateItem(i.id)
    clearSelection()
  }

  const bulkDelete = async () => {
    if (!confirm(`Delete ${selectedItems.length} document(s) everywhere? This cannot be undone.`)) return
    for (const i of selectedItems) await deleteItem(i.id)
    clearSelection()
  }

  const bulkRemoveFromCluster = async () => {
    if (!clusterId) return
    for (const i of selectedItems) {
      await setItemClusters(i.id, i.clusterIds.filter((c) => c !== clusterId))
    }
    clearSelection()
  }

  const openMenu = (e: React.MouseEvent, item: ResourceItem) => {
    e.preventDefault()
    e.stopPropagation()
    // Right-clicking outside the selection makes that row the selection.
    if (!selected.has(item.id)) {
      setSelected(new Set([item.id]))
      lastClicked.current = item.id
    }
    setMenu({ itemId: item.id, x: e.clientX, y: e.clientY })
  }

  const menuTarget = menu ? items.find((i) => i.id === menu.itemId) ?? null : null
  const menuCount = menu && selected.size > 1 ? selected.size : 1

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

        <div className="flex items-center gap-2 flex-shrink-0">
          {files.length > 0 && (
            <button
              onClick={() =>
                setSelected(selected.size === files.length ? new Set() : new Set(files.map((f) => f.id)))
              }
              className="flex items-center gap-1.5 px-2 py-1.5 rounded-md text-xs font-medium text-text-muted hover:text-text-main hover:bg-surface-2 transition-colors"
              title="Select files for bulk actions"
            >
              {selected.size === files.length && files.length > 0
                ? <CheckSquare size={14} />
                : <Square size={14} />}
              Select
            </button>
          )}

          <div className="flex items-center gap-0.5 bg-surface-2 rounded-md p-0.5">
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
      </div>

      {/* Bulk action bar */}
      {selected.size > 0 && (
        <div className="flex items-center gap-2 px-4 py-2 bg-primary-light border-b border-border">
          <span className="text-xs font-medium text-text-main">
            {selected.size} selected
          </span>
          <div className="flex-1" />
          <button
            onClick={() => setMovePicker('move')}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium text-text-muted hover:text-text-main hover:bg-surface transition-colors"
          >
            <FolderInput size={13} /> Move to
          </button>
          <button
            onClick={() => setMovePicker('tag')}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium text-text-muted hover:text-text-main hover:bg-surface transition-colors"
            title="Also show these in another cluster, without moving them"
          >
            <Tag size={13} /> Add to
          </button>
          <button
            onClick={bulkDuplicate}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium text-text-muted hover:text-text-main hover:bg-surface transition-colors"
          >
            <Copy size={13} /> Duplicate
          </button>
          {clusterId && (
            <button
              onClick={bulkRemoveFromCluster}
              className="px-2.5 py-1.5 rounded-md text-xs font-medium text-text-muted hover:text-text-main hover:bg-surface transition-colors"
              title="Untag from this cluster; the documents stay in their others"
            >
              Remove here
            </button>
          )}
          <button
            onClick={bulkDelete}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium text-danger hover:bg-surface transition-colors"
          >
            <Trash2 size={13} /> Delete
          </button>
          <button
            onClick={clearSelection}
            className="text-text-subtle hover:text-text-main p-1 rounded"
            title="Clear selection"
          >
            <X size={14} />
          </button>
        </div>
      )}

      {/* Body: marquee-selectable */}
      <div
        ref={scrollRef}
        onPointerDown={onPointerDown}
        onClick={(e) => { if (e.target === e.currentTarget) clearSelection() }}
        className="relative max-h-[calc(100vh-330px)] min-h-[320px] overflow-y-auto select-none"
      >
        {/* Marquee rectangle */}
        {rect && (
          <div
            className="absolute border border-primary bg-primary/10 pointer-events-none z-20 rounded-sm"
            style={{ left: rect.left, top: rect.top, width: rect.width, height: rect.height }}
          />
        )}

        {folders.length === 0 && files.length === 0 ? (
          <p className="text-text-subtle text-sm text-center py-16">
            {clusterId ? 'This cluster is empty.' : 'No resources yet.'}
          </p>
        ) : mode === 'list' ? (
          <div>
            {/* Column headers */}
            <div className="flex items-center gap-3 px-4 py-2 border-b border-border bg-surface-2 sticky top-0 z-10">
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
                  onPointerDown={(e) => e.stopPropagation()}
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

            {files.map((i) => {
              const isSelected = selected.has(i.id)
              return (
                <div
                  key={i.id}
                  ref={register(i.id)}
                  data-resource-item
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={(e) => clickFile(e, i)}
                  onDoubleClick={() => onOpenItem(i)}
                  onContextMenu={(e) => openMenu(e, i)}
                  className={`w-full flex items-center gap-3 px-4 py-2 border-b border-border transition-colors cursor-pointer ${
                    isSelected ? 'bg-primary-light' : 'hover:bg-surface-2'
                  }`}
                  title={`${i.title}\nClick for details · double-click to open · right-click for actions`}
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
              )
            })}
          </div>
        ) : (
          /* Grid */
          <div className="p-4 grid gap-3 grid-cols-[repeat(auto-fill,minmax(132px,1fr))]">
            {folders.map((f) => {
              const { folders: sub, files: n } = countsFor(f.id)
              return (
                <button
                  key={f.id}
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={() => onNavigate(f.id)}
                  className="flex flex-col items-center gap-2 p-3 rounded-xl border border-border hover:border-primary hover:shadow-md transition-all"
                >
                  <Folder size={36} style={{ color: f.color }} />
                  <span className="text-[11px] text-text-main text-center leading-tight line-clamp-2">{f.title}</span>
                  <span className="text-[10px] text-text-subtle">{n + sub} items</span>
                </button>
              )
            })}

            {files.map((i) => {
              const isSelected = selected.has(i.id)
              return (
                <div
                  key={i.id}
                  ref={register(i.id)}
                  data-resource-item
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={(e) => clickFile(e, i)}
                  onDoubleClick={() => onOpenItem(i)}
                  onContextMenu={(e) => openMenu(e, i)}
                  className={`rounded-xl border overflow-hidden hover:shadow-md transition-all cursor-pointer ${
                    isSelected ? 'border-primary ring-2 ring-primary/30' : 'border-border hover:border-primary'
                  }`}
                  title={`${i.title}\nClick for details · double-click to open · right-click for actions`}
                >
                  <ResourceThumbnail item={i} width={132} height={92} />
                  <div className="px-2 py-1.5 border-t border-border">
                    <p className="text-[11px] text-text-main leading-tight line-clamp-2 break-words">{i.title}</p>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Right-click menu */}
      {menu && menuTarget && (
        <>
          <div
            className="fixed inset-0 z-40"
            onClick={() => setMenu(null)}
            onContextMenu={(e) => { e.preventDefault(); setMenu(null) }}
          />
          <div
            className="fixed z-50 w-52 py-1 bg-surface border border-border rounded-lg shadow-xl"
            style={{ left: menu.x, top: menu.y }}
          >
            {menuCount === 1 && (
              <>
                <MenuItem label="Open" onClick={() => { onOpenItem(menuTarget); setMenu(null) }} />
                <MenuItem label="Details" onClick={() => { onSelectItem(menuTarget); setMenu(null) }} />
              </>
            )}
            <MenuItem
              label={menuCount > 1 ? `Move ${menuCount} to…` : 'Move to…'}
              onClick={() => { setMenu(null); setMovePicker('move') }}
            />
            <MenuItem
              label={menuCount > 1 ? `Add ${menuCount} to…` : 'Add to cluster…'}
              onClick={() => { setMenu(null); setMovePicker('tag') }}
            />
            <MenuItem
              label={menuCount > 1 ? `Duplicate ${menuCount}` : 'Duplicate'}
              onClick={() => { setMenu(null); bulkDuplicate() }}
            />
            {clusterId && (
              <MenuItem
                label="Remove from this cluster"
                onClick={() => { setMenu(null); bulkRemoveFromCluster() }}
              />
            )}
            <div className="h-px bg-border my-1" />
            <MenuItem
              label={menuCount > 1 ? `Delete ${menuCount} permanently` : 'Delete permanently'}
              danger
              onClick={() => { setMenu(null); bulkDelete() }}
            />
          </div>
        </>
      )}

      {/* Destination picker for move / add-to */}
      {movePicker && (
        <div
          className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4"
          onClick={() => setMovePicker(null)}
        >
          <div
            className="bg-surface rounded-xl border border-border w-full max-w-md flex flex-col max-h-[70vh]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-5 py-4 border-b border-border">
              <h3 className="text-text-main font-semibold text-base">
                {movePicker === 'move' ? 'Move to' : 'Also show in'}
              </h3>
              <p className="text-text-subtle text-xs">
                {movePicker === 'move'
                  ? `${selected.size} document(s) will move there.`
                  : `${selected.size} document(s) will appear there as well as where they are now.`}
              </p>
            </div>

            <div className="flex-1 overflow-y-auto p-2 space-y-0.5">
              {movePicker === 'move' && (
                <button
                  onClick={() => bulkMove(null)}
                  className="w-full flex items-center gap-2.5 p-2.5 rounded-lg hover:bg-surface-2 text-left transition-colors"
                >
                  <Home size={15} className="text-text-muted" />
                  <span className="text-sm text-text-main">Top level</span>
                </button>
              )}
              {clusters
                .filter((c) => c.projectId === projectId)
                .sort((a, b) => a.title.localeCompare(b.title))
                .map((c) => (
                  <button
                    key={c.id}
                    onClick={() => (movePicker === 'move' ? bulkMove(c.id) : bulkTag(c.id))}
                    className="w-full flex items-center gap-2.5 p-2.5 rounded-lg hover:bg-surface-2 text-left transition-colors"
                  >
                    <Folder size={15} style={{ color: c.color }} />
                    <span className="text-sm text-text-main truncate flex-1">{c.title}</span>
                    {c.id === clusterId && <span className="text-[10px] text-text-subtle">here</span>}
                  </button>
                ))}
            </div>

            <div className="px-5 py-3 border-t border-border flex justify-end">
              <button
                onClick={() => setMovePicker(null)}
                className="px-4 py-2 rounded-lg border border-border text-text-muted text-sm hover:bg-surface-2 transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function MenuItem({
  label,
  onClick,
  danger = false,
}: {
  label: string
  onClick: () => void
  danger?: boolean
}) {
  return (
    <button
      onClick={onClick}
      className={`w-full text-left px-3 py-1.5 text-xs hover:bg-surface-2 transition-colors ${
        danger ? 'text-danger' : 'text-text-main'
      }`}
    >
      {label}
    </button>
  )
}
