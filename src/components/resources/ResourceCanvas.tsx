import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ChevronRight, Home, Plus, FolderPlus, ZoomIn, ZoomOut, Maximize2, Link2, Pencil, Check, X,
  CornerLeftUp, Search, FolderOpen, ExternalLink, Upload,
} from 'lucide-react'
import { ResourceCluster, ResourceItem } from '../../types'
import { useProjectStore } from '../../store/projectStore'
import { useCanvasViewport, ZOOM_ENTER_THRESHOLD, ZOOM_EXIT_THRESHOLD } from './useCanvasViewport'
import { ResourceItemPanel } from './ResourceItemPanel'
import { ResourceThumbnail } from './ResourceThumbnail'

const ITEM_W = 132
const THUMB_H = 92
const ITEM_H = THUMB_H + 38

/** How far outside a bubble a dragged card still counts as a drop on it. */
const DROP_SLOP = ITEM_W / 2

/**
 * Screen-space distance (device px) before a press counts as a drag rather
 * than a click. Measured on screen, not world coordinates, so it stays a
 * consistent hand-jitter tolerance at any zoom level — a fixed world-space
 * threshold shrinks to sub-pixel at high zoom, misreading an ordinary click
 * on a small target (like a cluster's pull-out preview thumbnails) as a drag.
 */
const DRAG_THRESHOLD = 6

/**
 * How far from the centre of the cluster you're inside an item must be dragged
 * before it leaves that cluster. A cluster's contents sit near the origin, so
 * this is comfortably outside the packed area.
 */
const EJECT_RADIUS = 420

/**
 * The cluster a card at (x, y) would drop into: the nearest bubble at this
 * level whose edge the card reaches. Shared by the drag preview and the drop.
 */
function dropTargetAt(
  clusters: ResourceCluster[],
  parentId: string | null,
  x: number,
  y: number
): ResourceCluster | undefined {
  return clusters
    .filter((c) => c.parentClusterId === parentId)
    .map((c) => ({ c, dist: Math.hypot(c.x - x, c.y - y) }))
    .filter(({ c, dist }) => dist < c.radius + DROP_SLOP)
    .sort((a, b) => a.dist - b.dist)[0]?.c
}

/** A cluster's id plus every cluster nested inside it, so a drag can't drop it into its own subtree. */
function subtreeIds(clusters: ResourceCluster[], rootId: string): Set<string> {
  const ids = new Set([rootId])
  let grew = true
  while (grew) {
    grew = false
    for (const c of clusters) {
      if (c.parentClusterId && ids.has(c.parentClusterId) && !ids.has(c.id)) {
        ids.add(c.id)
        grew = true
      }
    }
  }
  return ids
}
const CLUSTER_COLORS = ['#6366f1', '#8b5cf6', '#ec4899', '#f59e0b', '#10b981', '#06b6d4', '#ef4444']

interface Props {
  projectId: string
  /** Current cluster, owned by the page so the folder view shares it. */
  clusterId: string | null
  onNavigate: (clusterId: string | null) => void
}

/** Lay new nodes out on a spiral so they never spawn on top of each other. */
function spawnPosition(index: number) {
  const angle = index * 2.399963 // golden angle
  const radius = 115 * Math.sqrt(index + 1)
  return { x: Math.cos(angle) * radius, y: Math.sin(angle) * radius }
}

export function ResourceCanvas({ projectId, clusterId, onNavigate }: Props) {
  const {
    clusters, items, resourcesLoadedFor, loadResources,
    createCluster, updateCluster, deleteCluster,
    createItem, moveItem, getFileUrl, deleteItem, duplicateItem, setItemClusters, updateItem,
    setItemLinks,
  } = useProjectStore()

  const containerRef = useRef<HTMLDivElement>(null)
  const {
    viewport, isPanning, animating, onPanStart, screenToWorld, centreWorld,
    resetView, zoomBy, setViewport,
  } = useCanvasViewport(containerRef)

  // The cluster we're zoomed into (null = project root), owned by the page.
  const currentClusterId = clusterId
  const setCurrentClusterId = onNavigate
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null)
  const [renamingClusterId, setRenamingClusterId] = useState<string | null>(null)
  // Draft for the "add link" dialog; null when the dialog is closed.
  const [linkDraft, setLinkDraft] = useState<{ url: string; title: string } | null>(null)
  const [linkBusy, setLinkBusy] = useState(false)
  const [renameValue, setRenameValue] = useState('')
  const [dragId, setDragId] = useState<string | null>(null)
  const [dragKind, setDragKind] = useState<'item' | 'cluster' | null>(null)
  // Live position of the node being dragged. Kept out of the store so a drag
  // re-renders only this component, not every node on the canvas.
  const [dragPos, setDragPos] = useState<{ x: number; y: number } | null>(null)
  // Set while dragging a preview out of a bubble, so the ghost knows to render.
  const [pullingOut, setPullingOut] = useState(false)
  // Cluster the dragged item would drop into, for the highlight.
  const [dropTargetId, setDropTargetId] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  // Right-click menu on an item card, positioned in screen coordinates.
  const [menu, setMenu] = useState<{ itemId: string; x: number; y: number } | null>(null)
  // Files dragged in from the desktop. Counted rather than a boolean: dragenter
  // and dragleave both fire when the pointer crosses a child element, so a flag
  // would flicker off as soon as the cursor moved over a card.
  const [dropDepth, setDropDepth] = useState(0)
  // Cluster a file drop would land in, for the same highlight a card drag gets.
  const [fileDropTargetId, setFileDropTargetId] = useState<string | null>(null)

  // Suppresses the zoom watcher while a level change settles, so the landing
  // scale can't immediately re-trigger it.
  const navLock = useRef(false)

  /**
   * Id of the node that was just dragged. The browser fires `click` after
   * `pointerup`, by which point drag state is already cleared — without this
   * the click that ends a drag would also open the cluster or select the item.
   */
  const draggedRef = useRef<string | null>(null)

  const dragState = useRef<{
    id: string
    kind: 'item' | 'cluster'
    offsetX: number
    offsetY: number
    pointerId: number
    moved: boolean
    /** Where the drag began, to tell a click from a drag. */
    startX: number
    startY: number
    /** Screen-space start, so drag/click classification is zoom-independent. */
    startScreenX: number
    startScreenY: number
    /** Latest position, written every pointermove, read on release. */
    x: number
    y: number
    /** Set when dragging a preview out of a bubble on the parent level. */
    pullOutOf?: string
  } | null>(null)

  useEffect(() => {
    if (resourcesLoadedFor !== projectId) loadResources(projectId)
  }, [projectId, resourcesLoadedFor, loadResources])

  // A file dropped just outside the canvas would otherwise make the browser
  // navigate to it, throwing away the whole app. Swallow those instead.
  useEffect(() => {
    const swallow = (e: DragEvent) => {
      if (e.dataTransfer?.types.includes('Files')) e.preventDefault()
    }
    window.addEventListener('dragover', swallow)
    window.addEventListener('drop', swallow)
    return () => {
      window.removeEventListener('dragover', swallow)
      window.removeEventListener('drop', swallow)
    }
  }, [])

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
  // A document appears in every cluster it's tagged into, and in the main space
  // when explicitly placed there — the two aren't exclusive.
  const visibleItems = useMemo(
    () =>
      items.filter((i) =>
        currentClusterId ? i.clusterIds.includes(currentClusterId) : i.showAtTopLevel
      ),
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

  /**
   * Position to render a node at. The node being dragged follows the pointer
   * from local state; everything else reads its stored position.
   */
  const posOf = (node: { id: string; x: number; y: number }) =>
    dragId === node.id && dragPos ? dragPos : node

  /**
   * Search the whole project, not just the level in view: titles, descriptions,
   * file names and link labels/URLs for items; titles for clusters. Results
   * carry their path so you can tell duplicates apart and jump straight there.
   */
  const searchResults = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return null

    const pathOf = (clusterId: string | null): string => {
      const parts: string[] = []
      let id = clusterId
      while (id) {
        const c = clusters.find((x) => x.id === id)
        if (!c) break
        parts.unshift(c.title)
        id = c.parentClusterId
      }
      return parts.length > 0 ? parts.join(' › ') : 'Top level'
    }

    const itemHits = items
      .filter((i) =>
        i.title.toLowerCase().includes(q) ||
        i.description.toLowerCase().includes(q) ||
        (i.fileName ?? '').toLowerCase().includes(q) ||
        i.links.some((l) => l.label.toLowerCase().includes(q) || l.url.toLowerCase().includes(q))
      )
      .map((i) => ({ kind: 'item' as const, id: i.id, label: i.title, item: i, path: pathOf(i.clusterId) }))

    const clusterHits = clusters
      .filter((c) => c.title.toLowerCase().includes(q))
      .map((c) => ({ kind: 'cluster' as const, id: c.id, label: c.title, cluster: c, path: pathOf(c.parentClusterId) }))

    return [...clusterHits, ...itemHits]
  }, [query, items, clusters])

  const matchedIds = useMemo(
    () => new Set((searchResults ?? []).map((r) => r.id)),
    [searchResults]
  )

  /** Jump to a search hit: open the level that holds it and centre it. */
  const goToResult = useCallback(
    (result: { kind: 'item' | 'cluster'; id: string }) => {
      const rect = containerRef.current?.getBoundingClientRect()
      if (!rect) return

      if (result.kind === 'item') {
        const item = items.find((i) => i.id === result.id)
        if (!item) return
        navLock.current = true
        setCurrentClusterId(item.clusterId)
        setViewport({ x: rect.width / 2 - item.x, y: rect.height / 2 - item.y, scale: 1 })
        setSelectedItemId(item.id)
        setTimeout(() => { navLock.current = false }, 180)
      } else {
        const cluster = clusters.find((c) => c.id === result.id)
        if (!cluster) return
        navLock.current = true
        // Show the cluster in its parent so you see the bubble itself.
        setCurrentClusterId(cluster.parentClusterId)
        setViewport({ x: rect.width / 2 - cluster.x, y: rect.height / 2 - cluster.y, scale: 1 })
        setTimeout(() => { navLock.current = false }, 180)
      }
      setQuery('')
    },
    [items, clusters, setViewport]
  )

  const countsFor = useCallback(
    (clusterId: string) => {
      const childClusters = clusters.filter((c) => c.parentClusterId === clusterId).length
      const childItems = items.filter((i) => i.clusterId === clusterId).length
      return { childClusters, childItems }
    },
    [clusters, items]
  )

  // ─── Drag ──────────────────────────────────────────────────────────────────

  const startDrag = (
    e: React.PointerEvent,
    id: string,
    kind: 'item' | 'cluster',
    x: number,
    y: number,
    opts?: { pullOutOf?: string }
  ) => {
    if (e.button !== 0) return
    e.stopPropagation()
    // Prevent the browser starting a text/image selection drag, which would
    // swallow the matching pointerup and leave the node stuck to the cursor.
    e.preventDefault()

    const world = screenToWorld(e.clientX, e.clientY)
    dragState.current = {
      id, kind,
      offsetX: world.x - x,
      offsetY: world.y - y,
      pointerId: e.pointerId,
      moved: false,
      startX: x, startY: y,
      startScreenX: e.clientX, startScreenY: e.clientY,
      x, y,
      pullOutOf: opts?.pullOutOf,
    }
    setDragId(id)
    setDragKind(kind)
    setDragPos({ x, y })
    setPullingOut(!!opts?.pullOutOf)
  }

  useEffect(() => {
    if (!dragId) return

    let frame = 0

    const onMove = (e: PointerEvent) => {
      const d = dragState.current
      if (!d || e.pointerId !== d.pointerId) return

      const world = screenToWorld(e.clientX, e.clientY)
      const x = world.x - d.offsetX
      const y = world.y - d.offsetY

      // Ignore ordinary hand jitter so a plain click never counts as a drag.
      // Measured in screen px (not world px) so it's the same real-world
      // tolerance at any zoom level.
      if (
        !d.moved &&
        Math.hypot(e.clientX - d.startScreenX, e.clientY - d.startScreenY) > DRAG_THRESHOLD
      ) {
        d.moved = true
      }

      d.x = x
      d.y = y

      // Coalesce to one update per frame: pointermove can fire far faster than
      // the display refreshes, and each extra render is pure lag.
      if (frame) return
      frame = requestAnimationFrame(() => {
        frame = 0
        const cur = dragState.current
        if (!cur) return

        setDragPos({ x: cur.x, y: cur.y })
        const allClusters = useProjectStore.getState().clusters
        if (cur.kind === 'item') {
          const hit = dropTargetAt(
            allClusters.filter((c) => c.id !== cur.pullOutOf),
            currentClusterId,
            cur.x,
            cur.y
          )
          setDropTargetId(hit?.id ?? null)
        } else {
          // A cluster can't be dropped into itself or its own descendant.
          const excluded = subtreeIds(allClusters, cur.id)
          const hit = dropTargetAt(
            allClusters.filter((c) => !excluded.has(c.id)),
            currentClusterId,
            cur.x,
            cur.y
          )
          setDropTargetId(hit?.id ?? null)
        }
      })
    }

    const onUp = (e?: PointerEvent) => {
      const d = dragState.current
      if (d && e && e.pointerId !== d.pointerId) return

      if (frame) { cancelAnimationFrame(frame); frame = 0 }

      dragState.current = null
      setDragId(null)
      setDragKind(null)
      setPullingOut(false)
      setDropTargetId(null)

      if (!d || !d.moved) {
        // A click that never moved shouldn't write a position back.
        setDragPos(null)
        return
      }

      // Record that this gesture was a drag so the click handler can ignore it.
      draggedRef.current = d.id

      const store = useProjectStore.getState()
      if (d.kind === 'item') {
        // Dropping an item on a cluster bubble re-parents it. The card only has
        // to touch the bubble, not sit centred in it. When pulling a preview out
        // of a bubble, that bubble is excluded so it doesn't snap straight back.
        const target = dropTargetAt(
          store.clusters.filter((c) => c.id !== d.pullOutOf),
          currentClusterId,
          d.x,
          d.y
        )

        if (target) {
          // Place it near the centre of its new home rather than at the drop point.
          const siblings = store.items.filter((i) => i.clusterId === target.id).length
          const pos = spawnPosition(siblings)
          moveItem(d.id, target.id, pos.x, pos.y, d.pullOutOf ?? undefined)
        } else if (d.pullOutOf) {
          // Pulled out of a bubble on this level: it lands here, where dropped.
          moveItem(d.id, currentClusterId, d.x, d.y, d.pullOutOf)
        } else if (currentClusterId && Math.hypot(d.x, d.y) > EJECT_RADIUS) {
          // Dragged clear of the cluster we're inside: move it up to the parent
          // and drop it just outside that cluster's bubble.
          const here = store.clusters.find((c) => c.id === currentClusterId)
          const parentId = here?.parentClusterId ?? null
          const angle = Math.atan2(d.y, d.x)
          const dist = (here?.radius ?? 160) + ITEM_W
          moveItem(
            d.id,
            parentId,
            (here?.x ?? 0) + Math.cos(angle) * dist,
            (here?.y ?? 0) + Math.sin(angle) * dist
          )
        } else {
          moveItem(d.id, currentClusterId, d.x, d.y)
        }
      } else {
        // Dropping a cluster on another one at this level nests it inside;
        // its own subtree is excluded so it can't be dropped into itself.
        const excluded = subtreeIds(store.clusters, d.id)
        const target = dropTargetAt(
          store.clusters.filter((c) => !excluded.has(c.id)),
          currentClusterId,
          d.x,
          d.y
        )

        if (target) {
          const siblings = store.clusters.filter((c) => c.parentClusterId === target.id).length
          const pos = spawnPosition(siblings)
          updateCluster(d.id, { parentClusterId: target.id, x: pos.x, y: pos.y })
        } else {
          updateCluster(d.id, { x: d.x, y: d.y })
        }
      }

      // Cleared last: the store writes above are optimistic and synchronous, so
      // by now the node already renders at its dropped position.
      setDragPos(null)
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
      // The cluster nearest the centre of the viewport. The generous radius
      // means you only have to be aiming at a bubble, not dead-centre on it.
      const target = visibleClusters
        .map((c) => ({ c, dist: Math.hypot(c.x - centre.x, c.y - centre.y) }))
        .filter(({ c, dist }) => dist < c.radius * 1.35)
        .sort((a, b) => a.dist - b.dist)[0]?.c

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

      // Open the tab synchronously so the popup blocker allows it, then point it
      // at the signed URL once that resolves. `noopener` must NOT be used here:
      // it nulls the returned handle, so the tab would be stranded on about:blank.
      const tab = window.open('', '_blank')
      if (tab) tab.opener = null

      const url = await getFileUrl(item.storagePath)
      if (!url) {
        tab?.close()
        return
      }

      if (tab && !tab.closed) tab.location.replace(url)
      else window.open(url, '_blank', 'noopener,noreferrer')
    },
    [getFileUrl]
  )

  /**
   * Where a newly created node should land: at the centre of what the user is
   * looking at, nudged along a spiral until it isn't sitting on top of an
   * existing node. `taken` carries positions from the same batch, which aren't
   * in the store yet.
   */
  const spawnNearView = useCallback(
    (taken: { x: number; y: number }[] = []) => {
      const centre = centreWorld()
      const occupied = [
        ...visibleItems.map((i) => ({ x: i.x, y: i.y })),
        ...visibleClusters.map((c) => ({ x: c.x, y: c.y })),
        ...taken,
      ]

      const clear = (x: number, y: number) =>
        !occupied.some((o) => Math.abs(o.x - x) < ITEM_W * 1.1 && Math.abs(o.y - y) < ITEM_H * 1.1)

      if (clear(centre.x, centre.y)) return { x: centre.x, y: centre.y }

      for (let i = 1; i < 80; i++) {
        const offset = spawnPosition(i)
        const x = centre.x + offset.x
        const y = centre.y + offset.y
        if (clear(x, y)) return { x, y }
      }
      return { x: centre.x, y: centre.y }
    },
    [centreWorld, visibleItems, visibleClusters]
  )

  const handleAddCluster = async () => {
    const pos = spawnNearView()
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
    // Track this batch's positions so a multi-file upload fans out instead of
    // stacking — the store hasn't caught up between iterations.
    const placed: { x: number; y: number }[] = []

    for (const file of files) {
      const pos = spawnNearView(placed)
      placed.push(pos)
      await createItem(projectId, currentClusterId, { title: file.name, x: pos.x, y: pos.y }, file)
    }
    e.target.value = ''
  }

  /**
   * Files dropped from the desktop land where they were dropped, so a drop is
   * also a placement. Dropping onto a bubble files them into that cluster
   * instead, matching what dragging an existing card onto it does.
   */
  const handleFileDrop = async (e: React.DragEvent) => {
    e.preventDefault()
    setDropDepth(0)
    setFileDropTargetId(null)

    const files = Array.from(e.dataTransfer.files ?? [])
    if (files.length === 0) return

    const world = screenToWorld(e.clientX, e.clientY)
    const target = dropTargetAt(useProjectStore.getState().clusters, currentClusterId, world.x, world.y)

    // Fan a multi-file drop out around the drop point rather than stacking it.
    const placed: { x: number; y: number }[] = []
    for (const file of files) {
      const offset = spawnPosition(placed.length)
      const pos = target
        ? spawnPosition(
            useProjectStore.getState().items.filter((i) => i.clusterId === target.id).length + placed.length
          )
        : placed.length === 0
          ? { x: world.x, y: world.y }
          : { x: world.x + offset.x, y: world.y + offset.y }
      placed.push(pos)
      await createItem(
        projectId,
        target ? target.id : currentClusterId,
        { title: file.name, x: pos.x, y: pos.y },
        file
      )
    }
  }

  /**
   * Highlight the bubble a file drop would land in, so it reads the same as
   * dragging a card across the canvas.
   */
  const handleFileDragOver = (e: React.DragEvent) => {
    if (!e.dataTransfer.types.includes('Files')) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'copy'

    const world = screenToWorld(e.clientX, e.clientY)
    const hit = dropTargetAt(useProjectStore.getState().clusters, currentClusterId, world.x, world.y)
    setFileDropTargetId(hit?.id ?? null)
  }

  /**
   * Create a link item from the dialog. A link node behaves like a file node:
   * one click selects and shows its info, double click opens the page.
   */
  const handleCreateLink = async () => {
    if (!linkDraft) return
    const raw = linkDraft.url.trim()
    if (!raw) return
    // People paste "example.com" as often as a full URL.
    const url = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(raw) ? raw : `https://${raw}`

    let title = linkDraft.title.trim()
    if (!title) {
      try {
        title = new URL(url).hostname.replace(/^www\./, '')
      } catch {
        title = 'Link'
      }
    }

    setLinkBusy(true)
    const pos = spawnNearView()
    const created = await createItem(projectId, currentClusterId, {
      title,
      description: '',
      x: pos.x,
      y: pos.y,
    })
    if (created) {
      await setItemLinks(created.id, [{ label: '', url }])
      setSelectedItemId(created.id)
    }
    setLinkBusy(false)
    setLinkDraft(null)
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
          {/* Search across the whole project */}
          <div className="relative">
            <Search size={13} className="absolute left-2 top-1/2 -translate-y-1/2 text-text-subtle pointer-events-none" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') setQuery('')
                if (e.key === 'Enter' && searchResults?.[0]) goToResult(searchResults[0])
              }}
              placeholder="Search resources…"
              className="w-40 sm:w-52 pl-7 pr-6 py-1.5 rounded-md bg-surface-2 border border-border text-xs text-text-main focus:outline-none focus:border-primary"
            />
            {query && (
              <button
                onClick={() => setQuery('')}
                className="absolute right-1.5 top-1/2 -translate-y-1/2 text-text-subtle hover:text-text-main"
                title="Clear"
              >
                <X size={12} />
              </button>
            )}

            {/* Results dropdown */}
            {searchResults && (
              <div className="absolute top-full right-0 mt-1 w-80 max-h-72 overflow-y-auto bg-surface border border-border rounded-lg shadow-xl z-40">
                {searchResults.length === 0 ? (
                  <p className="text-text-subtle text-xs text-center py-6">No matches.</p>
                ) : (
                  searchResults.map((r) => (
                    <button
                      key={`${r.kind}-${r.id}`}
                      onClick={() => goToResult(r)}
                      className="w-full flex items-center gap-2 px-3 py-2 hover:bg-surface-2 text-left transition-colors"
                    >
                      <span className="flex-shrink-0 text-text-muted">
                        {r.kind === 'cluster'
                          ? <FolderOpen size={14} style={{ color: r.cluster.color }} />
                          : <ResourceThumbnail item={r.item} width={20} height={20} />}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-xs text-text-main truncate">{r.label}</span>
                        <span className="block text-[10px] text-text-subtle truncate">
                          {r.kind === 'cluster' ? 'Cluster · ' : ''}{r.path}
                        </span>
                      </span>
                    </button>
                  ))
                )}
              </div>
            )}
          </div>

          <div className="w-px h-5 bg-border mx-0.5" />

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
            onClick={() => setLinkDraft({ url: '', title: '' })}
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
        onDragEnter={(e) => {
          if (!e.dataTransfer.types.includes('Files')) return
          e.preventDefault()
          setDropDepth((d) => d + 1)
        }}
        onDragOver={handleFileDragOver}
        onDragLeave={(e) => {
          if (!e.dataTransfer.types.includes('Files')) return
          setDropDepth((d) => {
            const next = Math.max(0, d - 1)
            if (next === 0) setFileDropTargetId(null)
            return next
          })
        }}
        onDrop={handleFileDrop}
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
            // A card dragged across the canvas and a file dragged in from the
            // desktop both land here, so both light the bubble up the same way.
            const isDropTarget = dropTargetId === cluster.id || fileDropTargetId === cluster.id
            return (
              <div
                key={cluster.id}
                className="absolute group"
                style={{
                  left: posOf(cluster).x - cluster.radius,
                  top: posOf(cluster).y - cluster.radius,
                }}
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
                  onClick={(e) => {
                    e.stopPropagation()
                    // A click that ends a drag must not also open the cluster.
                    if (draggedRef.current === cluster.id) { draggedRef.current = null; return }
                    if (!dragId) enterCluster(cluster)
                  }}
                  className={`rounded-full border-2 hover:brightness-105 active:cursor-grabbing ${
                    dragId === cluster.id ? '' : 'transition-all'
                  } ${isDropTarget ? 'border-solid scale-105' : 'border-dashed'}`}
                  style={{
                    width: cluster.radius * 2,
                    height: cluster.radius * 2,
                    // Solid ring and a stronger fill while a drop would land here.
                    borderColor: isDropTarget ? cluster.color : `${cluster.color}66`,
                    backgroundColor: isDropTarget ? `${cluster.color}33` : `${cluster.color}14`,
                  }}
                  title={`Open "${cluster.title}"`}
                >
                  <span className="sr-only">Open {cluster.title}</span>
                </button>

                {/* A hint of what's inside, so a cluster isn't an empty circle.
                    The previews are draggable, so a document can be pulled
                    straight out of a bubble without entering it first. */}
                <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                  <div className="flex flex-wrap gap-1.5 justify-center max-w-[70%]">
                    {items
                      .filter((i) => i.clusterIds.includes(cluster.id))
                      .slice(0, 6)
                      .map((i) => (
                        <div
                          key={i.id}
                          data-resource-item
                          onPointerDown={(e) => {
                            // Start the drag at the bubble's position: the item's
                            // own x/y are relative to the cluster's interior.
                            e.stopPropagation()
                            startDrag(e, i.id, 'item', cluster.x, cluster.y, { pullOutOf: cluster.id })
                          }}
                          onClick={(e) => {
                            e.stopPropagation()
                            if (draggedRef.current === i.id) { draggedRef.current = null; return }
                            setSelectedItemId(i.id)
                          }}
                          onDoubleClick={(e) => { e.stopPropagation(); openItem(i) }}
                          title={`${i.title}\nClick for details · double-click to open · drag out of ${cluster.title}`}
                          className={`w-9 h-9 rounded-md border border-border overflow-hidden bg-surface pointer-events-auto cursor-pointer hover:ring-2 hover:ring-primary hover:opacity-100 ${
                            dragId === i.id ? 'opacity-0' : 'opacity-60'
                          }`}
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

          {/* Eject boundary: drag an item past this to move it out of the
              cluster you're inside. Only while actually dragging one. */}
          {currentClusterId && dragId && dragPos && dragKind === 'item' && (
            <div
              className="absolute rounded-full border-2 border-dashed pointer-events-none transition-colors"
              style={{
                left: -EJECT_RADIUS,
                top: -EJECT_RADIUS,
                width: EJECT_RADIUS * 2,
                height: EJECT_RADIUS * 2,
                borderColor:
                  Math.hypot(dragPos.x, dragPos.y) > EJECT_RADIUS
                    ? 'rgb(220 38 38 / 0.7)'
                    : 'rgb(148 163 184 / 0.35)',
              }}
            >
              <span
                className="absolute left-1/2 -translate-x-1/2 text-[11px] font-medium px-2 py-0.5 rounded bg-surface border border-border"
                style={{
                  top: -12,
                  color: Math.hypot(dragPos.x, dragPos.y) > EJECT_RADIUS ? 'rgb(220 38 38)' : undefined,
                }}
              >
                {Math.hypot(dragPos.x, dragPos.y) > EJECT_RADIUS
                  ? 'Release to move out of this cluster'
                  : 'Drag past here to leave the cluster'}
              </span>
            </div>
          )}

          {/* Ghost for an item being pulled out of a bubble: it still belongs to
              that cluster, so it isn't in visibleItems until the drop lands. */}
          {dragId && dragPos && pullingOut && (() => {
            const ghost = items.find((i) => i.id === dragId)
            if (!ghost) return null
            return (
              <div
                className="absolute rounded-xl border-2 border-primary bg-surface overflow-hidden shadow-lg pointer-events-none"
                style={{
                  left: dragPos.x - ITEM_W / 2,
                  top: dragPos.y - ITEM_H / 2,
                  width: ITEM_W,
                }}
              >
                <ResourceThumbnail item={ghost} width={ITEM_W} height={THUMB_H} />
                <div className="px-2 py-1.5 border-t border-border">
                  <p className="text-[11px] text-text-main leading-tight line-clamp-2 break-words">
                    {ghost.title}
                  </p>
                </div>
              </div>
            )
          })()}

          {/* Item nodes: a preview card, so each file looks like what it is. */}
          {visibleItems.map((item) => (
            <div
              key={item.id}
              data-resource-item
              onPointerDown={(e) => startDrag(e, item.id, 'item', item.x, item.y)}
              onClick={(e) => {
                e.stopPropagation()
                if (draggedRef.current === item.id) { draggedRef.current = null; return }
                if (!dragId) setSelectedItemId(item.id)
              }}
              onDoubleClick={(e) => { e.stopPropagation(); openItem(item) }}
              onContextMenu={(e) => {
                e.preventDefault()
                e.stopPropagation()
                setMenu({ itemId: item.id, x: e.clientX, y: e.clientY })
              }}
              title={`${item.title}\nClick for details · double-click to open · right-click for more`}
              className={`group absolute rounded-xl border bg-surface overflow-hidden cursor-pointer select-none hover:shadow-lg active:cursor-grabbing ${
                // No transition on the dragged node, or it lags the pointer.
                dragId === item.id ? '' : 'transition-all'
              } ${
                selectedItemId === item.id ? 'border-primary ring-2 ring-primary/25' : 'border-border'
              } ${
                // While searching, fade everything that doesn't match.
                searchResults && !matchedIds.has(item.id) ? 'opacity-25' : ''
              } ${searchResults && matchedIds.has(item.id) ? 'ring-2 ring-primary' : ''}`}
              style={{
                left: posOf(item).x - ITEM_W / 2,
                top: posOf(item).y - ITEM_H / 2,
                width: ITEM_W,
              }}
            >
              {/* draggable=false stops the browser's native image drag, which
                  would steal the pointer and strand the node mid-drag. */}
              <div className="relative pointer-events-none" draggable={false}>
                <ResourceThumbnail item={item} width={ITEM_W} height={THUMB_H} />

                {/* Shortcut to the file itself, for anyone who'd rather not
                    double-click. */}
                {(item.storagePath || item.links.length > 0) && (
                  <button
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={(e) => { e.stopPropagation(); openItem(item) }}
                    className="absolute top-1 right-1 pointer-events-auto opacity-0 group-hover:opacity-100 focus:opacity-100 bg-surface/90 border border-border rounded-md p-1 text-text-muted hover:text-primary transition-opacity"
                    title="Open the file"
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
                Drop files here, add links, or create a cluster to group them.
              </p>
            </div>
          </div>
        )}

        {/* Drop hint. Pointer-events-none so it never swallows the drop itself. */}
        {dropDepth > 0 && (
          <div className="absolute inset-0 pt-12 flex items-center justify-center pointer-events-none z-10">
            <div className="absolute inset-3 mt-12 rounded-xl border-2 border-dashed border-primary bg-primary/5" />
            <div className="relative flex items-center gap-2 px-3.5 py-2 rounded-lg bg-surface border border-border shadow-lg">
              <Upload size={15} className="text-primary" />
              <span className="text-sm text-text-main">
                {fileDropTargetId
                  ? `Drop into "${clusters.find((c) => c.id === fileDropTargetId)?.title ?? 'cluster'}"`
                  : currentClusterId
                    ? 'Drop to add to this cluster'
                    : 'Drop to add to the main space'}
              </span>
            </div>
          </div>
        )}
      </div>

      {/* Right-click menu. Fixed-positioned, so it escapes the canvas transform. */}
      {menu && (() => {
        const target = items.find((i) => i.id === menu.itemId)
        if (!target) return null
        const act = (fn: () => void) => () => { fn(); setMenu(null) }
        return (
          <>
            <div className="fixed inset-0 z-40" onClick={() => setMenu(null)} onContextMenu={(e) => { e.preventDefault(); setMenu(null) }} />
            <div
              className="fixed z-50 w-44 py-1 bg-surface border border-border rounded-lg shadow-xl"
              style={{ left: menu.x, top: menu.y }}
            >
              {[
                ['Open', () => openItem(target)],
                ['Details', () => setSelectedItemId(target.id)],
                ['Duplicate', () => duplicateItem(target.id)],
              ].map(([label, fn]) => (
                <button
                  key={label as string}
                  onClick={act(fn as () => void)}
                  className="w-full text-left px-3 py-1.5 text-xs text-text-main hover:bg-surface-2 transition-colors"
                >
                  {label as string}
                </button>
              ))}
              <button
                onClick={act(() =>
                  currentClusterId
                    ? setItemClusters(target.id, target.clusterIds.filter((id) => id !== currentClusterId))
                    : updateItem(target.id, { showAtTopLevel: false })
                )}
                className="w-full text-left px-3 py-1.5 text-xs text-text-main hover:bg-surface-2 transition-colors"
                title="Remove from here only; the document stays everywhere else"
              >
                {currentClusterId ? 'Remove from this cluster' : 'Remove from the main space'}
              </button>
              <div className="h-px bg-border my-1" />
              <button
                onClick={act(() => {
                  if (confirm(`Delete "${target.title}" everywhere? This cannot be undone.`)) deleteItem(target.id)
                })}
                className="w-full text-left px-3 py-1.5 text-xs text-danger hover:bg-surface-2 transition-colors"
              >
                Delete permanently
              </button>
            </div>
          </>
        )
      })()}

      {/* Add-a-link dialog. The resulting node behaves like any other item. */}
      {linkDraft && (
        <div
          className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4"
          onClick={() => !linkBusy && setLinkDraft(null)}
        >
          <div
            className="bg-surface rounded-xl border border-border w-full max-w-md"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-5 py-4 border-b border-border">
              <h3 className="text-text-main font-semibold text-base">Add a link</h3>
              <p className="text-text-subtle text-xs">
                It appears on the canvas like a file. Double-click it to open the page.
              </p>
            </div>

            <div className="p-5 space-y-3">
              <div>
                <label className="block text-text-muted text-xs mb-1">Address</label>
                <input
                  autoFocus
                  value={linkDraft.url}
                  onChange={(e) => setLinkDraft({ ...linkDraft, url: e.target.value })}
                  onKeyDown={(e) => { if (e.key === 'Enter') handleCreateLink() }}
                  placeholder="https://example.com"
                  spellCheck={false}
                  className="w-full px-3 py-2 bg-surface-2 border border-border rounded-lg text-sm text-text-main outline-none focus:border-primary"
                />
              </div>
              <div>
                <label className="block text-text-muted text-xs mb-1">Name <span className="text-text-subtle">(optional)</span></label>
                <input
                  value={linkDraft.title}
                  onChange={(e) => setLinkDraft({ ...linkDraft, title: e.target.value })}
                  onKeyDown={(e) => { if (e.key === 'Enter') handleCreateLink() }}
                  placeholder="Taken from the address if left empty"
                  className="w-full px-3 py-2 bg-surface-2 border border-border rounded-lg text-sm text-text-main outline-none focus:border-primary"
                />
              </div>
            </div>

            <div className="px-5 py-3 border-t border-border flex justify-end gap-2">
              <button
                onClick={() => setLinkDraft(null)}
                disabled={linkBusy}
                className="px-3 py-1.5 rounded-lg text-xs font-medium text-text-muted hover:bg-surface-2 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={handleCreateLink}
                disabled={linkBusy || !linkDraft.url.trim()}
                className="px-3 py-1.5 rounded-lg bg-primary text-white text-xs font-medium hover:bg-primary/90 disabled:opacity-50"
              >
                {linkBusy ? 'Adding…' : 'Add link'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Keyed on id so the edit form re-seeds when a different item is selected. */}
      {selectedItem && (
        <ResourceItemPanel key={selectedItem.id} item={selectedItem} onClose={() => setSelectedItemId(null)} />
      )}
    </div>
  )
}
