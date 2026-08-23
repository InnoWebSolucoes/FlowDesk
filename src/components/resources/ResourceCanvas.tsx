import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ChevronRight, Home, Plus, FolderPlus, ZoomIn, ZoomOut, Maximize2, Link2, Pencil, Check, X,
  ExternalLink, CornerLeftUp,
} from 'lucide-react'
import { ResourceCluster, ResourceItem } from '../../types'
import { useProjectStore } from '../../store/projectStore'
import { useCanvasViewport, ZOOM_ENTER_THRESHOLD, ZOOM_EXIT_THRESHOLD } from './useCanvasViewport'
import { ResourceItemPanel } from './ResourceItemPanel'
import { ResourceThumbnail } from './ResourceThumbnail'

const ITEM_W = 132
const THUMB_H = 92
const ITEM_H = THUMB_H + 38
const CLUSTER_COLORS = ['#6366f1', '#8b5cf6', '#ec4899', '#f59e0b', '#10b981', '#06b6d4', '#ef4444']

interface Props {
  projectId: string
}

/** Lay new nodes out on a spiral so they never spawn on top of each other. */
function spawnPosition(index: number) {
  const angle = index * 2.399963 // golden angle
  const radius = 115 * Math.sqrt(index + 1)
  return { x: Math.cos(angle) * radius, y: Math.sin(angle) * radius }
}

export function ResourceCanvas({ projectId }: Props) {
  const {
    clusters, items, resourcesLoadedFor, loadResources,
    createCluster, updateCluster, deleteCluster,
    createItem, moveItem, getFileUrl,
  } = useProjectStore()

  const containerRef = useRef<HTMLDivElement>(null)
  const {
    viewport, isPanning, animating, onPanStart, screenToWorld, centreWorld,
    resetView, zoomBy, setViewport,
  } = useCanvasViewport(containerRef)

  // The cluster we are currently zoomed into (null = project root).
  const [currentClusterId, setCurrentClusterId] = useState<string | null>(null)
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null)
  const [renamingClusterId, setRenamingClusterId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [dragId, setDragId] = useState<string | null>(null)

  const dragState = useRef<{
    id: string
    kind: 'item' | 'cluster'
    offsetX: number
    offsetY: number
    pointerId: number
    moved: boolean
  } | null>(null)

  useEffect(() => {
    if (resourcesLoadedFor !== projectId) loadResources(projectId)
  }, [projectId, resourcesLoadedFor, loadResources])

  // Re-centre when switching project. Level changes set their own scale below,
  // so they must not reset the view (that would re-trigger the zoom thresholds).
  useEffect(() => {
    resetView()
  }, [projectId, resetView])

  // Children of the level we're viewing.
  const visibleClusters = useMemo(
    () => clusters.filter((c) => c.parentClusterId === currentClusterId),
    [clusters, currentClusterId]
  )
  const visibleItems = useMemo(
    () => items.filter((i) => i.clusterId === currentClusterId),
    [items, currentClusterId]
  )

  // Breadcrumb trail from root down to the current cluster.
  const trail = useMemo(() => {
    const path: ResourceCluster[] = []
    let id = currentClusterId
    while (id) {
      const c = clusters.find((x) => x.id === id)
      if (!c) break
      path.unshift(c)
      id = c.parentClusterId
    }
    return path
  }, [currentClusterId, clusters])

  const selectedItem = selectedItemId ? items.find((i) => i.id === selectedItemId) ?? null : null

  const countsFor = useCallback(
    (clusterId: string) => {
      const childClusters = clusters.filter((c) => c.parentClusterId === clusterId).length
      const childItems = items.filter((i) => i.clusterId === clusterId).length
      return { childClusters, childItems }
    },
    [clusters, items]
  )

  // ─── Drag ──────────────────────────────────────────────────────────────────

  const startDrag = (e: React.PointerEvent, id: string, kind: 'item' | 'cluster', x: number, y: number) => {
    if (e.button !== 0) return
    e.stopPropagation()
    // Prevent the browser starting a text/image selection drag, which would
    // swallow the matching pointerup and leave the node stuck to the cursor.
    e.preventDefault()

    const world = screenToWorld(e.clientX, e.clientY)
    dragState.current = { id, kind, offsetX: world.x - x, offsetY: world.y - y, pointerId: e.pointerId, moved: false }
    setDragId(id)
  }

  useEffect(() => {
    if (!dragId) return

    const onMove = (e: PointerEvent) => {
      const d = dragState.current
      if (!d || e.pointerId !== d.pointerId) return
      d.moved = true

      const world = screenToWorld(e.clientX, e.clientY)
      const x = world.x - d.offsetX
      const y = world.y - d.offsetY

      // Optimistic local move; persisted on pointer-up.
      useProjectStore.setState((s) =>
        d.kind === 'item'
          ? { items: s.items.map((i) => (i.id === d.id ? { ...i, x, y } : i)) }
          : { clusters: s.clusters.map((c) => (c.id === d.id ? { ...c, x, y } : c)) }
      )
    }

    const onUp = (e?: PointerEvent) => {
      const d = dragState.current
      if (d && e && e.pointerId !== d.pointerId) return

      dragState.current = null
      setDragId(null)
      if (!d) return

      // A click that never moved shouldn't write a position back.
      if (!d.moved) return

      const store = useProjectStore.getState()
      if (d.kind === 'item') {
        const item = store.items.find((i) => i.id === d.id)
        if (!item) return

        // Dropping an item inside a cluster bubble re-parents it into that cluster.
        const target = store.clusters.find(
          (c) =>
            c.parentClusterId === currentClusterId &&
            Math.hypot(c.x - item.x, c.y - item.y) < c.radius
        )

        if (target) {
          // Place it near the centre of its new home rather than at the drop point.
          const siblings = store.items.filter((i) => i.clusterId === target.id).length
          const pos = spawnPosition(siblings)
          moveItem(item.id, target.id, pos.x, pos.y)
        } else {
          moveItem(item.id, currentClusterId, item.x, item.y)
        }
      } else {
        const cluster = store.clusters.find((c) => c.id === d.id)
        if (cluster) updateCluster(cluster.id, { x: cluster.x, y: cluster.y })
      }
    }

    const onCancel = () => onUp()

    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    // pointercancel fires when the browser takes over the gesture (e.g. a
    // native drag); blur covers alt-tab mid-drag. Without these the node
    // stays glued to the cursor after the finger lifts.
    window.addEventListener('pointercancel', onCancel)
    window.addEventListener('blur', onCancel)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onCancel)
      window.removeEventListener('blur', onCancel)
    }
  }, [dragId, screenToWorld, currentClusterId, moveItem, updateCluster])

  // ─── Cluster navigation ────────────────────────────────────────────────────

  /**
   * Level changes swap content instantly and keep the viewport continuous, so
   * the zoom never breaks. Children of both levels live in the same world
   * coordinate space, so entering a cluster is just a re-centre: point the
   * viewport at the cluster's world position at the scale we're already at.
   * `navLock` suppresses the zoom watcher while the new scale settles.
   */
  const navLock = useRef(false)

  const enterCluster = useCallback(
    (cluster: ResourceCluster) => {
      if (navLock.current) return
      navLock.current = true
      setSelectedItemId(null)

      const rect = containerRef.current?.getBoundingClientRect()
      if (!rect) { navLock.current = false; return }

      // Swap level and re-anchor in one commit: the cluster's contents are laid
      // out around the origin, so centre the origin where the bubble just was.
      // Scale drops back to 1 so there's room to zoom in again immediately.
      setCurrentClusterId(cluster.id)
      setViewport({ x: rect.width / 2, y: rect.height / 2, scale: 1 })

      setTimeout(() => { navLock.current = false }, 180)
    },
    [setViewport]
  )

  const exitCluster = useCallback(() => {
    if (navLock.current) return
    const current = clusters.find((c) => c.id === currentClusterId)
    if (!current) return

    const rect = containerRef.current?.getBoundingClientRect()
    if (!rect) return

    navLock.current = true
    setSelectedItemId(null)

    // Same single commit as entering: swap level and land centred on the bubble
    // we just came out of, so the viewport stays continuous.
    setCurrentClusterId(current.parentClusterId)
    setViewport({ x: rect.width / 2 - current.x, y: rect.height / 2 - current.y, scale: 1 })

    setTimeout(() => { navLock.current = false }, 180)
  }, [clusters, currentClusterId, setViewport])

  /**
   * Zoom-driven navigation: push past the enter threshold while a cluster fills
   * the centre of the view to drill in; pull back past the exit threshold to pop out.
   *
   * This reacts to a user gesture (the wheel/pinch handler that moves the
   * viewport) rather than syncing derived state, and navLock keeps the level
   * change from feeding back into itself.
   */
  useEffect(() => {
    if (navLock.current || animating || dragId) return

    if (viewport.scale >= ZOOM_ENTER_THRESHOLD) {
      const centre = centreWorld()
      // The cluster under the centre of the viewport, if any.
      const target = visibleClusters.find(
        (c) => Math.hypot(c.x - centre.x, c.y - centre.y) < c.radius
      )
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (target) enterCluster(target)
      return
    }

    if (viewport.scale <= ZOOM_EXIT_THRESHOLD && currentClusterId) {
      exitCluster()
    }
  }, [
    viewport.scale, animating, dragId, currentClusterId,
    visibleClusters, centreWorld, enterCluster, exitCluster,
  ])

  /**
   * Open an item's file in a new tab. Link-only items fall back to their first
   * link. The window is opened synchronously and its URL set once the signed URL
   * resolves, so the popup blocker doesn't eat it.
   */
  const openItem = useCallback(
    async (item: ResourceItem) => {
      if (!item.storagePath) {
        const first = item.links[0]
        if (first) window.open(first.url, '_blank', 'noopener,noreferrer')
        return
      }

      const tab = window.open('', '_blank', 'noopener,noreferrer')
      const url = await getFileUrl(item.storagePath)
      if (!url) {
        tab?.close()
        return
      }
      if (tab) tab.location.href = url
      else window.open(url, '_blank', 'noopener,noreferrer')
    },
    [getFileUrl]
  )

  const handleAddCluster = async () => {
    const pos = spawnPosition(visibleClusters.length + visibleItems.length)
    const color = CLUSTER_COLORS[clusters.length % CLUSTER_COLORS.length]
    const created = await createCluster(projectId, currentClusterId, {
      title: 'New cluster',
      color,
      x: pos.x,
      y: pos.y,
      radius: 160,
    })
    if (created) {
      setRenamingClusterId(created.id)
      setRenameValue(created.title)
    }
  }

  const handleAddFiles = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? [])
    const base = visibleClusters.length + visibleItems.length
    for (let i = 0; i < files.length; i++) {
      const pos = spawnPosition(base + i)
      await createItem(projectId, currentClusterId, { title: files[i].name, x: pos.x, y: pos.y }, files[i])
    }
    e.target.value = ''
  }

  const handleAddLinkItem = async () => {
    const pos = spawnPosition(visibleClusters.length + visibleItems.length)
    const created = await createItem(projectId, currentClusterId, {
      title: 'New link',
      description: '',
      x: pos.x,
      y: pos.y,
    })
    if (created) setSelectedItemId(created.id)
  }

  const commitRename = async () => {
    if (renamingClusterId) await updateCluster(renamingClusterId, { title: renameValue.trim() || 'Untitled cluster' })
    setRenamingClusterId(null)
  }

  const handleDeleteCluster = async (cluster: ResourceCluster) => {
    const { childClusters, childItems } = countsFor(cluster.id)
    const detail = childClusters + childItems > 0 ? ` and everything inside it (${childItems} item(s), ${childClusters} cluster(s))` : ''
    if (!confirm(`Delete "${cluster.title}"${detail}? This cannot be undone.`)) return
    await deleteCluster(cluster.id)
  }

  const isEmpty = visibleClusters.length === 0 && visibleItems.length === 0

  return (
    <div className="relative h-[calc(100vh-190px)] min-h-[460px] rounded-xl border border-border bg-surface overflow-hidden">
      {/* Toolbar */}
      <div className="absolute top-0 left-0 right-0 z-20 flex items-center justify-between gap-3 px-4 py-2.5 bg-surface/90 backdrop-blur border-b border-border">
        {/* Breadcrumb */}
        <nav className="flex items-center gap-1 text-sm min-w-0 overflow-x-auto">
          <button
            onClick={() => setCurrentClusterId(null)}
            className={`flex items-center gap-1.5 px-2 py-1 rounded-md flex-shrink-0 transition-colors ${
              currentClusterId === null ? 'text-text-main font-medium' : 'text-text-muted hover:text-text-main'
            }`}
          >
            <Home size={14} /> Resources
          </button>
          {trail.map((c) => (
            <React.Fragment key={c.id}>
              <ChevronRight size={13} className="text-text-subtle flex-shrink-0" />
              <button
                onClick={() => setCurrentClusterId(c.id)}
                className={`px-2 py-1 rounded-md flex-shrink-0 truncate max-w-[160px] transition-colors ${
                  c.id === currentClusterId ? 'text-text-main font-medium' : 'text-text-muted hover:text-text-main'
                }`}
              >
                {c.title}
              </button>
            </React.Fragment>
          ))}
        </nav>

        <div className="flex items-center gap-1.5 flex-shrink-0">
          <button onClick={() => zoomBy(1 / 1.25)} className="p-1.5 rounded-md text-text-muted hover:bg-surface-2" title="Zoom out">
            <ZoomOut size={15} />
          </button>
          <button onClick={() => zoomBy(1.25)} className="p-1.5 rounded-md text-text-muted hover:bg-surface-2" title="Zoom in">
            <ZoomIn size={15} />
          </button>
          <button onClick={resetView} className="p-1.5 rounded-md text-text-muted hover:bg-surface-2" title="Reset view">
            <Maximize2 size={15} />
          </button>
          {currentClusterId && (
            <button
              onClick={exitCluster}
              className="p-1.5 rounded-md text-text-muted hover:bg-surface-2"
              title="Leave cluster (or just zoom out)"
            >
              <CornerLeftUp size={15} />
            </button>
          )}

          <div className="w-px h-5 bg-border mx-1" />

          <button
            onClick={handleAddCluster}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium text-text-muted hover:bg-surface-2"
            title="New cluster"
          >
            <FolderPlus size={14} /> Cluster
          </button>
          <button
            onClick={handleAddLinkItem}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium text-text-muted hover:bg-surface-2"
            title="New link-only item"
          >
            <Link2 size={14} /> Link
          </button>
          <label className="cursor-pointer">
            <span className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md bg-primary text-white text-xs font-medium hover:bg-primary/90 transition-colors">
              <Plus size={14} /> Upload
            </span>
            <input type="file" multiple className="hidden" onChange={handleAddFiles} />
          </label>
        </div>
      </div>

      {/* Canvas surface */}
      <div
        ref={containerRef}
        onPointerDown={onPanStart}
        onClick={() => setSelectedItemId(null)}
        className={`absolute inset-0 pt-12 select-none touch-none ${isPanning ? 'cursor-grabbing' : 'cursor-grab'}`}
        style={{
          backgroundImage: 'radial-gradient(circle, rgb(148 163 184 / 0.18) 1px, transparent 1px)',
          backgroundSize: `${24 * viewport.scale}px ${24 * viewport.scale}px`,
          backgroundPosition: `${viewport.x}px ${viewport.y}px`,
        }}
      >
        <div
          className="absolute top-0 left-0 origin-top-left"
          style={{
            transform: `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.scale})`,
            transition: animating ? 'transform 450ms cubic-bezier(0.22, 1, 0.36, 1)' : 'none',
          }}
        >
          {/* Cluster bubbles */}
          {visibleClusters.map((cluster) => {
            const { childClusters, childItems } = countsFor(cluster.id)
            const isRenaming = renamingClusterId === cluster.id
            return (
              <div
                key={cluster.id}
                className="absolute group"
                style={{ left: cluster.x - cluster.radius, top: cluster.y - cluster.radius }}
              >
                {/* Title hovering above the bubble */}
                <div
                  className="absolute left-1/2 -translate-x-1/2 flex items-center gap-1.5 whitespace-nowrap"
                  style={{ top: -34 }}
                >
                  {isRenaming ? (
                    <div className="flex items-center gap-1 bg-surface border border-border rounded-lg px-1.5 py-1 shadow-sm">
                      <input
                        autoFocus
                        value={renameValue}
                        onChange={(e) => setRenameValue(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') commitRename()
                          if (e.key === 'Escape') setRenamingClusterId(null)
                        }}
                        onPointerDown={(e) => e.stopPropagation()}
                        onClick={(e) => e.stopPropagation()}
                        className="bg-transparent text-sm text-text-main w-36 focus:outline-none px-1"
                      />
                      <button onClick={(e) => { e.stopPropagation(); commitRename() }} className="text-success p-0.5">
                        <Check size={13} />
                      </button>
                      <button onClick={(e) => { e.stopPropagation(); setRenamingClusterId(null) }} className="text-text-subtle p-0.5">
                        <X size={13} />
                      </button>
                    </div>
                  ) : (
                    <>
                      <span
                        className="text-text-main font-semibold px-2.5 py-1 rounded-lg bg-surface/85 backdrop-blur-sm border border-border shadow-sm"
                        style={{ fontSize: 15 }}
                      >
                        {cluster.title}
                      </span>
                      <span className="text-[11px] text-text-subtle bg-surface/85 px-1.5 py-0.5 rounded border border-border">
                        {childItems + childClusters}
                      </span>
                      <button
                        onClick={(e) => { e.stopPropagation(); setRenamingClusterId(cluster.id); setRenameValue(cluster.title) }}
                        onPointerDown={(e) => e.stopPropagation()}
                        className="opacity-0 group-hover:opacity-100 text-text-subtle hover:text-text-main transition-opacity p-1 rounded bg-surface/85 border border-border"
                        title="Rename"
                      >
                        <Pencil size={11} />
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); handleDeleteCluster(cluster) }}
                        onPointerDown={(e) => e.stopPropagation()}
                        className="opacity-0 group-hover:opacity-100 text-text-subtle hover:text-danger transition-opacity p-1 rounded bg-surface/85 border border-border"
                        title="Delete cluster"
                      >
                        <X size={11} />
                      </button>
                    </>
                  )}
                </div>

                {/* The bubble */}
                <button
                  onPointerDown={(e) => startDrag(e, cluster.id, 'cluster', cluster.x, cluster.y)}
                  onClick={(e) => { e.stopPropagation(); if (!dragId) enterCluster(cluster) }}
                  className="rounded-full border-2 border-dashed transition-colors hover:brightness-105 active:cursor-grabbing"
                  style={{
                    width: cluster.radius * 2,
                    height: cluster.radius * 2,
                    borderColor: `${cluster.color}66`,
                    backgroundColor: `${cluster.color}14`,
                  }}
                  title={`Open "${cluster.title}"`}
                >
                  <span className="sr-only">Open {cluster.title}</span>
                </button>

                {/* A hint of what's inside, so a cluster isn't an empty circle */}
                <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                  <div className="flex flex-wrap gap-1.5 justify-center max-w-[70%] opacity-60">
                    {items
                      .filter((i) => i.clusterId === cluster.id)
                      .slice(0, 6)
                      .map((i) => (
                        <div
                          key={i.id}
                          className="w-9 h-9 rounded-md border border-border overflow-hidden bg-surface"
                        >
                          <ResourceThumbnail item={i} width={36} height={36} />
                        </div>
                      ))}
                    {clusters
                      .filter((c) => c.parentClusterId === cluster.id)
                      .slice(0, 3)
                      .map((c) => (
                        <div
                          key={c.id}
                          className="w-7 h-7 rounded-full border-2 border-dashed"
                          style={{ borderColor: `${c.color}88`, backgroundColor: `${c.color}22` }}
                        />
                      ))}
                  </div>
                </div>
              </div>
            )
          })}

          {/* Item nodes: a preview card, so each file looks like what it is. */}
          {visibleItems.map((item) => (
            <div
              key={item.id}
              onPointerDown={(e) => startDrag(e, item.id, 'item', item.x, item.y)}
              onClick={(e) => { e.stopPropagation(); if (!dragId) setSelectedItemId(item.id) }}
              onDoubleClick={(e) => { e.stopPropagation(); openItem(item) }}
              title={`${item.title}\nDouble-click to open`}
              className={`group absolute rounded-xl border bg-surface overflow-hidden cursor-pointer select-none transition-shadow hover:shadow-lg active:cursor-grabbing ${
                selectedItemId === item.id ? 'border-primary ring-2 ring-primary/25' : 'border-border'
              }`}
              style={{ left: item.x - ITEM_W / 2, top: item.y - ITEM_H / 2, width: ITEM_W }}
            >
              {/* draggable=false stops the browser's native image drag, which
                  would steal the pointer and strand the node mid-drag. */}
              <div className="relative pointer-events-none" draggable={false}>
                <ResourceThumbnail item={item} width={ITEM_W} height={THUMB_H} />

                {/* Open button, revealed on hover over the card */}
                {(item.storagePath || item.links.length > 0) && (
                  <button
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={(e) => { e.stopPropagation(); openItem(item) }}
                    className="absolute top-1 right-1 pointer-events-auto opacity-0 group-hover:opacity-100 focus:opacity-100 bg-surface/90 border border-border rounded-md p-1 text-text-muted hover:text-primary transition-opacity"
                    title="Open"
                  >
                    <ExternalLink size={12} />
                  </button>
                )}
              </div>

              <div className="px-2 py-1.5 border-t border-border">
                <p className="text-[11px] text-text-main leading-tight line-clamp-2 break-words">
                  {item.title}
                </p>
                {item.links.length > 0 && (
                  <span className="flex items-center gap-0.5 text-[10px] text-text-subtle mt-0.5">
                    <Link2 size={9} /> {item.links.length}
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>

        {isEmpty && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className="text-center">
              <p className="text-text-muted text-sm">
                {currentClusterId ? 'This cluster is empty.' : 'No resources yet.'}
              </p>
              <p className="text-text-subtle text-xs mt-1">
                Upload files, add links, or create a cluster to group them.
              </p>
            </div>
          </div>
        )}
      </div>

      {/* Keyed on id so the edit form re-seeds when a different item is selected. */}
      {selectedItem && (
        <ResourceItemPanel key={selectedItem.id} item={selectedItem} onClose={() => setSelectedItemId(null)} />
      )}
    </div>
  )
}
