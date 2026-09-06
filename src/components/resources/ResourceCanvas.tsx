import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ChevronRight, Home, Plus, ZoomIn, ZoomOut, Maximize2, Link2, Lock, Check, X,
  CornerLeftUp, Search, FolderOpen, ExternalLink, Upload,
} from 'lucide-react'
import { ResourceCluster, ResourceItem } from '../../types'
import { useProjectStore } from '../../store/projectStore'
import { useCanvasViewport, ZOOM_ENTER_THRESHOLD, ZOOM_EXIT_THRESHOLD } from './useCanvasViewport'
import { ResourceItemPanel } from './ResourceItemPanel'
import { ClusterPanel } from './ClusterPanel'
import { googleEmbedUrl } from './googleDocs'
import { isNative, dragDocumentOut, copyDocumentFile, prepareDocument } from '../../lib/nativeShare'
import { ResourceThumbnail } from './ResourceThumbnail'
import { useT } from '../../i18n/useT'

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
  /** Opens a document in the page's viewer window. */
  onOpenItem: (item: ResourceItem) => void
}

/**
 * Keeps a right-click menu fully on screen: it flips above or left of the
 * pointer when there is not enough room below or to the right, and never
 * starts off the edge. Height is estimated from the item count, since the menu
 * has not been measured at the point it is positioned.
 */
function menuPosition(x: number, y: number, itemCount: number, width = 240) {
  const ROW = 30
  const CHROME = 16
  const MARGIN = 8
  const height = itemCount * ROW + CHROME

  const left = x + width + MARGIN > window.innerWidth
    ? Math.max(MARGIN, x - width)
    : x
  const top = y + height + MARGIN > window.innerHeight
    ? Math.max(MARGIN, y - height)
    : y

  return { left, top, maxHeight: window.innerHeight - top - MARGIN }
}

/** Lay new nodes out on a spiral so they never spawn on top of each other. */
function spawnPosition(index: number) {
  const angle = index * 2.399963 // golden angle
  const radius = 115 * Math.sqrt(index + 1)
  return { x: Math.cos(angle) * radius, y: Math.sin(angle) * radius }
}

export function ResourceCanvas({ projectId, clusterId, onNavigate, onOpenItem }: Props) {
  const { t } = useT()
  const {
    clusters, items, resourcesLoadedFor, loadResources,
    createCluster, updateCluster, deleteCluster, duplicateCluster,
    createItem, moveItem, deleteItem, duplicateItem, setItemClusters, updateItem,
    setItemLinks, stackItemOnto,
  } = useProjectStore()

  // Whether the OS-level file actions are available (desktop app only).
  const nativeShare = isNative()
  // Names the document just copied, so the paste step is obvious.
  const [copied, setCopied] = useState<string | null>(null)

  const containerRef = useRef<HTMLDivElement>(null)
  const {
    viewport, isPanning, animating, onPanStart, screenToWorld, centreWorld,
    resetView, zoomBy, setViewport,
  } = useCanvasViewport(containerRef)

  // The cluster we're zoomed into (null = project root), owned by the page.
  const currentClusterId = clusterId
  const setCurrentClusterId = onNavigate
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null)
  // Multi-select for bulk moves. The single selection above still drives the
  // details panel; this is the set the marquee and shift-click build up.
  /**
   * Selected presences, keyed "<location>::<itemId>" where location is the
   * cluster id or "space". Selecting a document selects it *where it is*: the
   * same document tagged into two clusters is two separate presences, so
   * removing it from one leaves the other alone. Deleting from everywhere is
   * offered explicitly, and is the only action that ignores location.
   */
  const [multiSelected, setMultiSelected] = useState<Set<string>>(new Set())
  /** The key for a document as it appears in a given place. */
  const presenceKey = (itemId: string, location: string | null) => `${location ?? 'space'}::${itemId}`
  const itemIdOf = (key: string) => key.slice(key.indexOf('::') + 2)
  const lastClickedItem = useRef<string | null>(null)
  // Pending single-click, cancelled if a double click follows.
  const clickTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Shift-drag on the background draws a selection box instead of panning.
  const [marquee, setMarquee] = useState<{ x1: number; y1: number; x2: number; y2: number } | null>(null)
  // Right-click on empty canvas: create a cluster, or act on the selection.
  const [bgMenu, setBgMenu] = useState<{ x: number; y: number; world: { x: number; y: number } } | null>(null)
  const [clusterMenu, setClusterMenu] = useState<{ clusterId: string; x: number; y: number } | null>(null)
  // The cluster whose details are open, the counterpart to selectedItemId.
  const [detailClusterId, setDetailClusterId] = useState<string | null>(null)
  /** Which cluster's nested-cluster list is expanded in its menu. */
  const [clusterList, setClusterList] = useState<string | null>(null)
  const marqueeStart = useRef<{ x: number; y: number; additive: Set<string> } | null>(null)
  const marqueeBox = useRef<{ x1: number; y1: number; x2: number; y2: number } | null>(null)
  const [marqueeActive, setMarqueeActive] = useState(false)
  // Set when a marquee ends, so the click the pointerup generates does not also
  // run the background's "clear the selection" handler.
  const justMarqueed = useRef(false)
  // Lets the right-click menu open the file picker, which needs a real input.
  const bgUploadRef = useRef<HTMLInputElement>(null)
  const [renamingClusterId, setRenamingClusterId] = useState<string | null>(null)
  // Draft for the "add link" dialog; null when the dialog is closed.
  const [linkDraft, setLinkDraft] = useState<{ url: string; title: string } | null>(null)
  const [linkBusy, setLinkBusy] = useState(false)
  // The open panel, as a drop target for documents dragged off the canvas.
  const panelDropRef = useRef<HTMLElement | null>(null)
  const lastPointer = useRef({ x: 0, y: 0 })
  const [panelDropActive, setPanelDropActive] = useState(false)
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

  // A selection gesture clears selectedItemId, so the panel does not pop up
  // while picking nodes. Asking for details explicitly still opens it, and the
  // selection is left alone.
  const selectedItem = selectedItemId ? items.find((i) => i.id === selectedItemId) ?? null : null
  // Resolved from the store, not held as state, so an edit made in the panel
  // is reflected back into it immediately.
  const detailCluster = detailClusterId
    ? clusters.find((c) => c.id === detailClusterId) ?? null
    : null

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

  // ─── Drag ──────────────────────────────────────────────────────────────────

  /**
   * A click anywhere outside the canvas clears the selection — clicking the
   * toolbar, the sidebar or empty page space should not leave nodes looking
   * selected. The panel and its dialogs are excluded so interacting with them
   * doesn't wipe what you just picked.
   */
  useEffect(() => {
    if (multiSelected.size === 0 && !selectedItemId) return

    const onDocPointerDown = (e: PointerEvent) => {
      const target = e.target as Element | null
      if (!target) return
      if (containerRef.current?.contains(target)) return
      if (target.closest('[data-resource-item], [data-canvas-ui], [role="dialog"], aside')) return
      setMultiSelected(new Set())
      setSelectedItemId(null)
    }

    document.addEventListener('pointerdown', onDocPointerDown)
    return () => document.removeEventListener('pointerdown', onDocPointerDown)
  }, [multiSelected.size, selectedItemId])

  /**
   * Shift-drag selection. The rectangle is tracked in container pixels, then
   * compared against each node's own box in the same space — the nodes live
   * inside the zoom/pan transform, so their screen rects are read directly
   * rather than recomputed from world coordinates.
   *
   * The live rectangle is kept in a ref as well as in state: the effect must
   * not re-subscribe on every mouse move (that would race the pointerup), so
   * the handlers cannot rely on the state value, which would be stale.
   */
  useEffect(() => {
    if (!marqueeActive) return

    const onMove = (e: PointerEvent) => {
      const rect = containerRef.current?.getBoundingClientRect()
      const start = marqueeStart.current
      if (!rect || !start) return
      const box = { x1: start.x, y1: start.y, x2: e.clientX - rect.left, y2: e.clientY - rect.top }
      marqueeBox.current = box
      setMarquee(box)
    }

    const onUp = () => {
      const rect = containerRef.current?.getBoundingClientRect()
      const start = marqueeStart.current
      const box = marqueeBox.current
      marqueeStart.current = null
      marqueeBox.current = null
      setMarqueeActive(false)
      setMarquee(null)
      if (!rect || !start || !box) return

      const left = Math.min(box.x1, box.x2)
      const right = Math.max(box.x1, box.x2)
      const top = Math.min(box.y1, box.y2)
      const bottom = Math.max(box.y1, box.y2)
      // A stray shift-click shouldn't wipe the selection.
      if (right - left < 4 && bottom - top < 4) return

      const hits = new Set(start.additive)
      const intersects = (el: HTMLElement) => {
        const r = el.getBoundingClientRect()
        const x1 = r.left - rect.left
        const y1 = r.top - rect.top
        return x1 < right && x1 + r.width > left && y1 < bottom && y1 + r.height > top
      }

      for (const el of containerRef.current!.querySelectorAll<HTMLElement>('[data-item-id]')) {
        if (intersects(el)) hits.add(presenceKey(el.dataset.itemId!, currentClusterId))
      }

      // A bubble caught by the box selects everything it holds, at any depth —
      // the same thing shift-clicking the bubble does. Its documents are
      // selected in the cluster that holds them, not in the level on screen.
      const store = useProjectStore.getState()
      // A bubble is a circle, so its square bounding box would catch clusters
      // the box only grazes at a corner. Test the circle itself.
      const touchesCircle = (el: HTMLElement) => {
        const r = el.getBoundingClientRect()
        const cx = r.left + r.width / 2 - rect.left
        const cy = r.top + r.height / 2 - rect.top
        const radius = r.width / 2
        // Nearest point of the selection box to the bubble's centre.
        const nx = Math.max(left, Math.min(cx, right))
        const ny = Math.max(top, Math.min(cy, bottom))
        return Math.hypot(cx - nx, cy - ny) <= radius
      }

      for (const el of containerRef.current!.querySelectorAll<HTMLElement>('[data-cluster-id]')) {
        if (!touchesCircle(el)) continue
        const inside = subtreeIds(store.clusters, el.dataset.clusterId!)
        for (const i of store.items) {
          for (const c of i.clusterIds) {
            if (inside.has(c)) hits.add(presenceKey(i.id, c))
          }
        }
      }
      setSelectedItemId(null)
      setMultiSelected(hits)
      justMarqueed.current = true
      setTimeout(() => { justMarqueed.current = false }, 0)
    }

    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
  }, [marqueeActive])

  /**
   * Ctrl+C copies the selected document as a file, so it can be pasted into
   * WhatsApp, Claude or anything else. Matches what every file browser does,
   * rather than making the right-click menu the only route.
   */
  useEffect(() => {
    if (!nativeShare) return

    const onKey = async (e: KeyboardEvent) => {
      if (!(e.key === 'c' && (e.ctrlKey || e.metaKey))) return
      // Don't hijack copying text out of an input.
      const t = e.target as HTMLElement | null
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return

      const ids = multiSelected.size > 0 ? [...multiSelected].map(itemIdOf) : selectedItemId ? [selectedItemId] : []
      if (ids.length === 0) return

      // The clipboard holds one file, so a multi-selection copies the first.
      const target = items.find((i) => i.id === ids[0] && i.storagePath)
      if (!target) return

      e.preventDefault()
      const res = await copyDocumentFile(target.storagePath, target.fileName)
      if (res.ok) {
        setCopied(target.title)
        setTimeout(() => setCopied(null), 2600)
      }
    }

    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [nativeShare, multiSelected, selectedItemId, items])

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

      lastPointer.current = { x: e.clientX, y: e.clientY }
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

        // Light the panel up while a document is held over it.
        if (cur.kind === 'item' && selectedItemId && cur.id !== selectedItemId && panelDropRef.current) {
          const el = document.elementFromPoint(lastPointer.current.x, lastPointer.current.y)
          setPanelDropActive(panelDropRef.current.contains(el as Node | null))
        }

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

      const overPanel = panelDropRef.current && e
        ? panelDropRef.current.contains(document.elementFromPoint(e.clientX, e.clientY) as Node | null)
        : false

      dragState.current = null
      setDragId(null)
      setDragKind(null)
      setPullingOut(false)
      setDropTargetId(null)
      setPanelDropActive(false)

      if (!d || !d.moved) {
        // A click that never moved shouldn't write a position back.
        setDragPos(null)
        return
      }

      // Dropped onto the open item's panel: fold this document into that one as
      // its newest version, instead of moving it around the canvas.
      if (overPanel && d.kind === 'item' && selectedItemId && d.id !== selectedItemId) {
        draggedRef.current = d.id
        setDragPos(null)
        stackItemOnto(d.id, selectedItemId, currentClusterId)
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
          // A multi-selection moves together, each getting its own slot.
          const selfKey = presenceKey(d.id, currentClusterId)
          const group = multiSelected.has(selfKey) ? [...multiSelected].map(itemIdOf) : [d.id]
          let siblings = store.items.filter((i) => i.clusterId === target.id).length
          for (const id of group) {
            const pos = spawnPosition(siblings++)
            moveItem(id, target.id, pos.x, pos.y, d.pullOutOf ?? undefined)
          }
          if (group.length > 1) setMultiSelected(new Set())
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
  }, [dragId, screenToWorld, currentClusterId, moveItem, updateCluster, selectedItemId, stackItemOnto, multiSelected])

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
   * Open an item. The page owns the viewer window, so this hands the item up;
   * a plain external link still goes to the browser, since an arbitrary site
   * cannot be relied on to render in a frame.
   */
  const openItem = useCallback(
    (item: ResourceItem) => {
      const isPlainLink =
        !item.storagePath && item.links.length > 0 && !item.links.some((l) => googleEmbedUrl(l.url))
      if (isPlainLink) {
        window.open(item.links[0].url, '_blank', 'noopener,noreferrer')
        return
      }
      onOpenItem(item)
    },
    [onOpenItem]
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

  /**
   * Bulk actions for a multi-selection, from the background right-click menu.
   *
   * Untag removes the documents from *this* location only — they stay wherever
   * else they are tagged. Delete removes them from everywhere, permanently.
   */
  /** Selected presences, split back into their document and their location. */
  const selectionPresences = () =>
    [...multiSelected].map((key) => {
      const at = key.slice(0, key.indexOf('::'))
      return { itemId: itemIdOf(key), location: at === 'space' ? null : at }
    })
  /** Distinct documents in the selection, for actions that ignore location. */
  const selectionIds = () => [...new Set([...multiSelected].map(itemIdOf))]

  const bulkIntoNewCluster = async (world: { x: number; y: number }, copy: boolean) => {
    const ids = selectionIds()
    if (ids.length === 0) return
    const color = CLUSTER_COLORS[clusters.length % CLUSTER_COLORS.length]
    const created = await createCluster(projectId, currentClusterId, {
      title: 'New cluster',
      color,
      x: world.x,
      y: world.y,
      radius: 160,
    })
    if (!created) return

    let placed = 0
    for (const id of ids) {
      const item = items.find((i) => i.id === id)
      if (!item) continue
      const pos = spawnPosition(placed++)
      if (copy) {
        // Tag it into the new cluster as well, leaving it where it is.
        await setItemClusters(id, [...new Set([...item.clusterIds, created.id])])
      } else {
        await moveItem(id, created.id, pos.x, pos.y, currentClusterId ?? undefined)
      }
    }
    setMultiSelected(new Set())
    setRenamingClusterId(created.id)
    setRenameValue(created.title)
  }

  /** Remove the selection from here, keeping it wherever else it lives. */
  const bulkUntag = async () => {
    // Each presence is removed from its own location, which is not necessarily
    // the level currently in view — a cluster selection can span several.
    for (const { itemId, location } of selectionPresences()) {
      const item = items.find((i) => i.id === itemId)
      if (!item) continue
      if (location) {
        await setItemClusters(itemId, item.clusterIds.filter((c) => c !== location))
      } else {
        await updateItem(itemId, { showAtTopLevel: false })
      }
    }
    setMultiSelected(new Set())
  }

  /** A separate copy of each selected document, beside the original. */
  const bulkDuplicate = async () => {
    const ids = selectionIds()
    if (ids.length === 0) return
    for (const id of ids) await duplicateItem(id)
    setMultiSelected(new Set())
  }

  const bulkDelete = async () => {
    const ids = selectionIds()
    if (ids.length === 0) return
    for (const id of ids) await deleteItem(id)
    setMultiSelected(new Set())
  }

  const handleAddCluster = async (at?: { x: number; y: number }) => {
    const pos = at ?? spawnNearView()
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

  /**
   * Uploading a file that is already here is almost always a mistake, so say
   * so before adding a second copy. Matched on name and byte size, which is
   * enough to catch the real case (the same file picked twice) without reading
   * every file to hash it.
   *
   * Returns the files to actually upload.
   */
  const screenForDuplicates = (files: File[]): File[] => {
    const existing = useProjectStore
      .getState()
      .items.filter((i) => i.projectId === projectId && i.fileName)

    const clashes: { file: File; match: string }[] = []
    for (const file of files) {
      const match = existing.find((i) => i.fileName === file.name && i.size === file.size)
      if (match) clashes.push({ file, match: match.title })
    }
    if (clashes.length === 0) return files

    // Duplicates are added as separate copies rather than asking.
    const ok = true
    return ok ? files : files.filter((f) => !clashes.some((c) => c.file === f))
  }

  const handleAddFiles = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = screenForDuplicates(Array.from(e.target.files ?? []))
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

    const files = screenForDuplicates(Array.from(e.dataTransfer.files ?? []))
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
            <Home size={14} />{t('ui_resources')}</button>
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
              placeholder={t('res_searchResources')}
              className="w-40 sm:w-52 pl-7 pr-6 py-1.5 rounded-md bg-surface-2 border border-border text-xs text-text-main focus:outline-none focus:border-primary"
            />
            {query && (
              <button
                onClick={() => setQuery('')}
                className="absolute right-1.5 top-1/2 -translate-y-1/2 text-text-subtle hover:text-text-main"
                title={t('ui_clear')}
              >
                <X size={12} />
              </button>
            )}

            {/* Results dropdown */}
            {searchResults && (
              <div className="absolute top-full right-0 mt-1 w-80 max-h-72 overflow-y-auto bg-surface border border-border rounded-lg shadow-xl z-40">
                {searchResults.length === 0 ? (
                  <p className="text-text-subtle text-xs text-center py-6">{t('res_noMatches')}</p>
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

          <button onClick={() => zoomBy(1 / 1.25)} className="p-1.5 rounded-md text-text-muted hover:bg-surface-2" title={t('res_zoomOut')}>
            <ZoomOut size={15} />
          </button>
          <button onClick={() => zoomBy(1.25)} className="p-1.5 rounded-md text-text-muted hover:bg-surface-2" title={t('res_zoomIn')}>
            <ZoomIn size={15} />
          </button>
          <button onClick={resetView} className="p-1.5 rounded-md text-text-muted hover:bg-surface-2" title={t('res_resetView')}>
            <Maximize2 size={15} />
          </button>
          {currentClusterId && (
            <button
              onClick={exitCluster}
              className="p-1.5 rounded-md text-text-muted hover:bg-surface-2"
              title={t('res_leaveClusterOrJustZoomOut')}
            >
              <CornerLeftUp size={15} />
            </button>
          )}

          <div className="w-px h-5 bg-border mx-1" />

          <button
            onClick={() => setLinkDraft({ url: '', title: '' })}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium text-text-muted hover:bg-surface-2"
            title={t('res_newLinkOnlyItem')}
          >
            <Link2 size={14} />{t('ui_link')}</button>
          <label className="cursor-pointer">
            <span className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md bg-primary text-white text-xs font-medium hover:bg-primary/90 transition-colors">
              <Plus size={14} />{t('res_upload')}</span>
            <input type="file" multiple className="hidden" onChange={handleAddFiles} />
          </label>
        </div>
      </div>

      {/* Canvas surface */}
      <div
        ref={containerRef}
        onPointerDown={(e) => {
          if (e.button === 0 && e.shiftKey) {
            // Selecting a region, not moving the view.
            e.preventDefault()
            const rect = containerRef.current?.getBoundingClientRect()
            if (!rect) return
            const x = e.clientX - rect.left
            const y = e.clientY - rect.top
            marqueeStart.current = { x, y, additive: new Set(multiSelected) }
            marqueeBox.current = { x1: x, y1: y, x2: x, y2: y }
            setMarquee(marqueeBox.current)
            setMarqueeActive(true)
            return
          }
          onPanStart(e)
        }}
        onClick={() => {
          if (justMarqueed.current) return
          setSelectedItemId(null)
          setMultiSelected(new Set())
        }}
        onContextMenu={(e) => {
          e.preventDefault()
          setBgMenu({ x: e.clientX, y: e.clientY, world: screenToWorld(e.clientX, e.clientY) })
        }}
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
            const isRenaming = renamingClusterId === cluster.id
            // A card dragged across the canvas and a file dragged in from the
            // desktop both land here, so both light the bubble up the same way.
            const isDropTarget = dropTargetId === cluster.id
            // Shift-selecting a cluster selects its contents; show that on the
            // bubble too, or the gesture looks like it did nothing.
            const inside = subtreeIds(clusters, cluster.id)
            const insideKeys = items.flatMap((i) =>
              i.clusterIds.filter((c) => inside.has(c)).map((c) => presenceKey(i.id, c)),
            )
            const clusterSelected =
              insideKeys.length > 0 && insideKeys.every((k) => multiSelected.has(k)) || fileDropTargetId === cluster.id
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
                    <input
                      autoFocus
                      value={renameValue}
                      onChange={(e) => setRenameValue(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
                        if (e.key === 'Escape') setRenamingClusterId(null)
                      }}
                      // Clicking away saves: there is nothing to confirm, so a
                      // tick button would only be one more thing to hit.
                      onBlur={commitRename}
                      onPointerDown={(e) => e.stopPropagation()}
                      onClick={(e) => e.stopPropagation()}
                      className="text-text-main font-semibold px-2.5 py-1 rounded-lg bg-surface border border-primary shadow-sm w-44 focus:outline-none"
                      style={{ fontSize: 15 }}
                    />
                  ) : (
                    <span
                      onClick={(e) => {
                        e.stopPropagation()
                        setRenamingClusterId(cluster.id)
                        setRenameValue(cluster.title)
                      }}
                      onPointerDown={(e) => e.stopPropagation()}
                      title={t('res_clickToRename')}
                      className="text-text-main font-semibold px-2.5 py-1 rounded-lg bg-surface/85 backdrop-blur-sm border border-border shadow-sm cursor-text hover:border-primary/50 transition-colors"
                      style={{ fontSize: 15 }}
                    >
                      {cluster.title}
                    </span>
                  )}
                </div>

                {/* The bubble */}
                <button
                  data-cluster-id={cluster.id}
                  onPointerDown={(e) => startDrag(e, cluster.id, 'cluster', cluster.x, cluster.y)}
                  onContextMenu={(e) => {
                    e.preventDefault()
                    e.stopPropagation()
                    setClusterMenu({ clusterId: cluster.id, x: e.clientX, y: e.clientY })
                  }}
                  onDoubleClick={(e) => {
                    // Opens even when a modifier is held, so shift-selecting a
                    // few clusters and then opening one still works.
                    e.stopPropagation()
                    enterCluster(cluster)
                  }}
                  onClick={(e) => {
                    e.stopPropagation()
                    // A click that ends a drag must not also open the cluster.
                    if (draggedRef.current === cluster.id) { draggedRef.current = null; return }
                    if (dragId) return

                    // Shift or ctrl selects everything the cluster holds, at any
                    // depth, rather than navigating into it. Double-click still
                    // opens it, which the handler below takes care of.
                    if (e.shiftKey || e.metaKey || e.ctrlKey) {
                      // Each document is selected in the cluster that holds it,
                      // not everywhere it happens to appear.
                      const inside = subtreeIds(clusters, cluster.id)
                      const keys: string[] = []
                      for (const i of items) {
                        for (const c of i.clusterIds) {
                          if (inside.has(c)) keys.push(presenceKey(i.id, c))
                        }
                      }
                      setSelectedItemId(null)
                      setMultiSelected((prev) => new Set([...prev, ...keys]))
                      return
                    }

                    enterCluster(cluster)
                  }}
                  className={`rounded-full border-2 hover:brightness-105 active:cursor-grabbing ${
                    dragId === cluster.id ? '' : 'transition-[box-shadow,border-color,opacity,filter]'
                  } ${isDropTarget ? 'border-solid scale-105' : 'border-dashed'} ${
                    clusterSelected ? 'ring-4 ring-primary/30 border-solid' : ''
                  }`}
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
                          // Scoped to the cluster: a document that also sits in
                          // the space renders in both places, and a shared key
                          // would make React treat them as one element and
                          // animate it between the two positions.
                          key={`preview-${cluster.id}-${i.id}`}
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
              onPointerEnter={() => {
                if (nativeShare && item.storagePath) prepareDocument(item.storagePath, item.fileName)
              }}
              onMouseMove={(e) => {
                // Cursor tells you the drag will leave the app.
                const el = e.currentTarget as HTMLElement
                el.style.cursor =
                  (e.ctrlKey || e.metaKey) && nativeShare && item.storagePath ? 'copy' : ''
              }}
              onMouseLeave={(e) => {
                ;(e.currentTarget as HTMLElement).style.cursor = ''
              }}
              onPointerDown={(e) => {
                // Ctrl hands the press to the browser so a native file drag can
                // begin: startDrag calls preventDefault, which would otherwise
                // stop dragstart from ever firing. Ctrl-click still toggles the
                // selection, because a click without movement never becomes a
                // drag.
                if ((e.ctrlKey || e.metaKey) && nativeShare && item.storagePath) return
                startDrag(e, item.id, 'item', item.x, item.y)
              }}
              onClick={(e) => {
                e.stopPropagation()
                if (draggedRef.current === item.id) { draggedRef.current = null; return }
                if (dragId) return

                // Any selection gesture closes the details panel.
                if (e.shiftKey || e.metaKey || e.ctrlKey) setSelectedItemId(null)

                // Shift and ctrl both add one node to the selection. A range
                // select would need a running order, and nodes on a free-form
                // canvas have none — using the array order swept in whatever
                // happened to sit between them in the database.
                if (e.shiftKey || e.metaKey || e.ctrlKey) {
                  const key = presenceKey(item.id, currentClusterId)
                  setMultiSelected((prev) => {
                    const next = new Set(prev)
                    if (next.has(key)) next.delete(key)
                    else next.add(key)
                    return next
                  })
                  lastClickedItem.current = item.id
                  return
                }

                setMultiSelected(new Set())
                lastClickedItem.current = item.id

                // Held briefly so a double click can cancel it: otherwise the
                // panel opens over the node before the second click lands.
                if (clickTimer.current) clearTimeout(clickTimer.current)
                clickTimer.current = setTimeout(() => {
                  clickTimer.current = null
                  setSelectedItemId(item.id)
                }, 220)
              }}
              data-item-id={item.id}
              // In the desktop app a node can be dragged straight out to
              // WhatsApp, Claude, an email — anything that takes a file. The
              // browser cannot hand over file data, so this is off there.
              // Ctrl-drag sends the file to another application; a plain drag
              // moves the node around the canvas.
              draggable={nativeShare && !!item.storagePath}
              onDragStart={(e) => {
                if (!item.storagePath) return
                // The OS drag replaces the HTML5 one entirely.
                e.preventDefault()
                dragDocumentOut(item.storagePath, item.fileName).then((ok) => {
                  if (!ok) {
                    setCopied(null)
                    alert('The file could not be prepared for dragging. Try "Copy file" instead.')
                  }
                })
              }}
              onDoubleClick={(e) => {
                e.stopPropagation()
                if (clickTimer.current) {
                  clearTimeout(clickTimer.current)
                  clickTimer.current = null
                }
                setSelectedItemId(null)
                openItem(item)
              }}
              onContextMenu={(e) => {
                e.preventDefault()
                e.stopPropagation()
                setMenu({ itemId: item.id, x: e.clientX, y: e.clientY })
              }}
              title={`${item.title}\nClick for details · double-click to open · right-click for more`}
              className={`group absolute rounded-xl border bg-surface overflow-hidden cursor-pointer select-none hover:shadow-lg active:cursor-grabbing ${
                // Colours and shadow animate; position never does. Animating
                // left/top made a node slide across the canvas whenever its
                // coordinates changed — most visibly for a document that also
                // sits inside a cluster, which has different coordinates there.
                dragId === item.id ? '' : 'transition-[box-shadow,border-color,opacity]'
              } ${
                selectedItemId === item.id || multiSelected.has(presenceKey(item.id, currentClusterId))
                  ? 'border-primary ring-2 ring-primary/25'
                  : 'border-border'
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
                    title={t('res_openTheFile')}
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

        {/* Selection rectangle. Outside the zoom transform, since it is drawn
            in container pixels rather than world coordinates. */}
        {marquee && (
          <div
            className="absolute border border-primary/40 bg-primary/5 rounded-sm pointer-events-none z-20"
            style={{
              left: Math.min(marquee.x1, marquee.x2),
              top: Math.min(marquee.y1, marquee.y2),
              width: Math.abs(marquee.x2 - marquee.x1),
              height: Math.abs(marquee.y2 - marquee.y1),
            }}
          />
        )}

        {isEmpty && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className="text-center">
              <p className="text-text-muted text-sm">
                {currentClusterId ? 'This cluster is empty.' : 'No resources yet.'}
              </p>
              <p className="text-text-subtle text-xs mt-1">{t('res_dropFilesHereAddLinksOr')}</p>
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
                    : 'Drop to add to the space'}
              </span>
            </div>
          </div>
        )}
      </div>

      <input
        ref={bgUploadRef}
        type="file"
        multiple
        className="hidden"
        onChange={handleAddFiles}
      />

      {copied && (
        <div className="fixed bottom-5 left-1/2 -translate-x-1/2 z-[70] flex items-center gap-2 px-4 py-2.5 rounded-lg bg-text-main text-surface shadow-xl">
          <Check size={14} />
          <span className="text-xs">
            <b>{copied}</b> copied, paste it with Ctrl+V in WhatsApp, Claude, or anywhere else.
          </span>
        </div>
      )}

      {/* Cluster right-click: rename, duplicate or delete it. */}
      {clusterMenu && (() => {
        const target = clusters.find((c) => c.id === clusterMenu.clusterId)
        if (!target) return null
        const act = (fn: () => void) => () => { fn(); setClusterMenu(null) }
        const pos = menuPosition(clusterMenu.x, clusterMenu.y, 5, 208)
        return (
          <>
            <div
              data-canvas-ui
              className="fixed inset-0 z-40"
              onClick={() => { setClusterMenu(null); setClusterList(null) }}
              onContextMenu={(e) => { e.preventDefault(); setClusterMenu(null); setClusterList(null) }}
            />
            <div
              data-canvas-ui
              className="fixed z-50 w-52 py-1 bg-surface border border-border rounded-lg shadow-xl overflow-y-auto"
              style={{ left: pos.left, top: pos.top, maxHeight: pos.maxHeight }}
            >
              <p className="px-3 py-1.5 text-[11px] text-text-subtle border-b border-border mb-1 truncate">
                {target.title}
              </p>
              <button
                onClick={act(() => enterCluster(target))}
                className="w-full text-left px-3 py-1.5 text-xs text-text-main hover:bg-surface-2 transition-colors"
              >{t('ui_open')}</button>
              <button
                onClick={act(() => setDetailClusterId(target.id))}
                className="w-full text-left px-3 py-1.5 text-xs text-text-main hover:bg-surface-2 transition-colors"
              >{t('res_detailsAndSharing')}</button>
              {(() => {
                const children = clusters.filter((c) => c.parentClusterId === target.id)
                if (children.length === 0) return null
                return (
                  <button
                    onClick={() => setClusterList(clusterList === target.id ? null : target.id)}
                    className="w-full flex items-center justify-between px-3 py-1.5 text-xs text-text-main hover:bg-surface-2 transition-colors"
                  >
                    <span>Clusters inside ({children.length})</span>
                    <ChevronRight
                      size={12}
                      className={`transition-transform ${clusterList === target.id ? 'rotate-90' : ''}`}
                    />
                  </button>
                )
              })()}

              {clusterList === target.id && (
                <div className="max-h-48 overflow-y-auto border-y border-border my-1 bg-surface-2/40">
                  {clusters
                    .filter((c) => c.parentClusterId === target.id)
                    .map((c) => (
                      <button
                        key={c.id}
                        onClick={act(() => enterCluster(c))}
                        className="w-full flex items-center gap-2 pl-5 pr-3 py-1.5 text-xs text-text-main hover:bg-surface transition-colors text-left"
                      >
                        <span
                          className="w-2 h-2 rounded-full flex-shrink-0"
                          style={{ backgroundColor: c.color }}
                        />
                        <span className="truncate">{c.title}</span>
                      </button>
                    ))}
                </div>
              )}

              <button
                onClick={act(() => duplicateCluster(target.id))}
                className="w-full text-left px-3 py-1.5 text-xs text-text-main hover:bg-surface-2 transition-colors"
                title={t('res_copiesTheClusterAndItsNesting')}
              >{t('ui_duplicate')}</button>
              <div className="h-px bg-border my-1" />
              <button
                onClick={act(() => handleDeleteCluster(target))}
                className="w-full text-left px-3 py-1.5 text-xs text-danger hover:bg-surface-2 transition-colors"
              >{t('ui_delete')}</button>
            </div>
          </>
        )
      })()}

      {/* Background right-click: create a cluster, or act on the selection. */}
      {bgMenu && (() => {
        const count = multiSelected.size
        const act = (fn: () => void) => () => { fn(); setBgMenu(null) }
        const where = currentClusterId ? 'this cluster' : 'the space'
        const pos = menuPosition(bgMenu.x, bgMenu.y, count > 0 ? 9 : 3)
        return (
          <>
            <div
              data-canvas-ui
              className="fixed inset-0 z-40"
              onClick={() => setBgMenu(null)}
              onContextMenu={(e) => { e.preventDefault(); setBgMenu(null) }}
            />
            <div
              data-canvas-ui
              className="fixed z-50 w-60 py-1 bg-surface border border-border rounded-lg shadow-xl overflow-y-auto"
              style={{ left: pos.left, top: pos.top, maxHeight: pos.maxHeight }}
            >
              {count > 0 && (
                <p className="px-3 py-1.5 text-[11px] text-text-subtle border-b border-border mb-1">
                  {count} document{count === 1 ? '' : 's'} selected
                </p>
              )}

              <button
                onClick={act(() => bgUploadRef.current?.click())}
                className="w-full text-left px-3 py-1.5 text-xs text-text-main hover:bg-surface-2 transition-colors"
              >{t('res_uploadFiles')}</button>
              <button
                onClick={act(() => setLinkDraft({ url: '', title: '' }))}
                className="w-full text-left px-3 py-1.5 text-xs text-text-main hover:bg-surface-2 transition-colors"
              >{t('ui_addLink')}</button>
              <button
                onClick={act(() => handleAddCluster(bgMenu.world))}
                className="w-full text-left px-3 py-1.5 text-xs text-text-main hover:bg-surface-2 transition-colors"
              >{t('res_createCluster')}</button>

              {count > 0 && (
                <>
                  <div className="h-px bg-border my-1" />
                  <button
                    onClick={act(bulkDuplicate)}
                    className="w-full text-left px-3 py-1.5 text-xs text-text-main hover:bg-surface-2 transition-colors"
                    title={t('res_aSeparateCopyOfEachBeside')}
                  >{t('ui_duplicate')}</button>
                  <button
                    onClick={act(() => bulkIntoNewCluster(bgMenu.world, false))}
                    className="w-full text-left px-3 py-1.5 text-xs text-text-main hover:bg-surface-2 transition-colors"
                  >{t('res_moveToNewCluster')}</button>
                  <button
                    onClick={act(() => bulkIntoNewCluster(bgMenu.world, true))}
                    className="w-full text-left px-3 py-1.5 text-xs text-text-main hover:bg-surface-2 transition-colors"
                    title={t('res_theyStayHereAsWellAs')}
                  >{t('res_duplicateIntoNewCluster')}</button>
                  <div className="h-px bg-border my-1" />
                  <button
                    onClick={act(bulkUntag)}
                    className="w-full text-left px-3 py-1.5 text-xs text-text-main hover:bg-surface-2 transition-colors"
                    title={`Removes them from ${where} only, they stay everywhere else`}
                  >{t('ui_remove')}</button>
                  <button
                    onClick={act(bulkDelete)}
                    className="w-full text-left px-3 py-1.5 text-xs text-danger hover:bg-surface-2 transition-colors"
                    title={t('res_deletesTheFilesFromEveryLocation')}
                  >{t('ui_delete')}</button>
                </>
              )}
            </div>
          </>
        )
      })()}

      {/* Right-click menu. Fixed-positioned, so it escapes the canvas transform. */}
      {menu && (() => {
        const target = items.find((i) => i.id === menu.itemId)
        if (!target) return null
        const act = (fn: () => void) => () => { fn(); setMenu(null) }
        const pos = menuPosition(menu.x, menu.y, 6, 176)
        return (
          <>
            <div data-canvas-ui className="fixed inset-0 z-40" onClick={() => setMenu(null)} onContextMenu={(e) => { e.preventDefault(); setMenu(null) }} />
            <div
              data-canvas-ui
              className="fixed z-50 w-44 py-1 bg-surface border border-border rounded-lg shadow-xl overflow-y-auto"
              style={{ left: pos.left, top: pos.top, maxHeight: pos.maxHeight }}
            >
              {[
                ['Open', () => openItem(target)],
                ['Details', () => setSelectedItemId(target.id)],
                ['Duplicate', () => duplicateItem(target.id)],
                ...(nativeShare && target.storagePath
                  ? [['Copy file', async () => {
                      const res = await copyDocumentFile(target.storagePath, target.fileName)
                      setCopied(res.ok ? target.title : null)
                      if (!res.ok) alert(res.error ?? 'The file could not be copied.')
                      else setTimeout(() => setCopied(null), 2600)
                    }] as [string, () => void]]
                  : []),
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
                title={t('res_removeFromHereOnlyTheDocument')}
              >{t('ui_remove')}</button>
              <div className="h-px bg-border my-1" />
              <button
                onClick={act(() => {
                  deleteItem(target.id)
                })}
                className="w-full text-left px-3 py-1.5 text-xs text-danger hover:bg-surface-2 transition-colors"
              >{t('ui_delete')}</button>
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
              <h3 className="text-text-main font-semibold text-base">{t('res_addALink')}</h3>
              <p className="text-text-subtle text-xs">{t('res_itAppearsOnTheCanvasLike')}</p>
            </div>

            <div className="p-5 space-y-3">
              <div>
                <label className="block text-text-muted text-xs mb-1">{t('res_address')}</label>
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
                <label className="block text-text-muted text-xs mb-1">{t('ui_name')}<span className="text-text-subtle">(optional)</span></label>
                <input
                  value={linkDraft.title}
                  onChange={(e) => setLinkDraft({ ...linkDraft, title: e.target.value })}
                  onKeyDown={(e) => { if (e.key === 'Enter') handleCreateLink() }}
                  placeholder={t('res_takenFromTheAddressIfLeft')}
                  className="w-full px-3 py-2 bg-surface-2 border border-border rounded-lg text-sm text-text-main outline-none focus:border-primary"
                />
              </div>
            </div>

            <div className="px-5 py-3 border-t border-border flex justify-end gap-2">
              <button
                onClick={() => setLinkDraft(null)}
                disabled={linkBusy}
                className="px-3 py-1.5 rounded-lg text-xs font-medium text-text-muted hover:bg-surface-2 disabled:opacity-50"
              >{t('ui_cancel')}</button>
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

      {/* A cluster's own details: name, colour, who can open it, what is in
          it. Keyed so switching clusters re-seeds the form. */}
      {detailCluster && (
        <ClusterPanel
          key={detailCluster.id}
          cluster={detailCluster}
          onClose={() => setDetailClusterId(null)}
          onOpen={() => {
            setDetailClusterId(null)
            enterCluster(detailCluster)
          }}
          onDuplicate={() => {
            setDetailClusterId(null)
            duplicateCluster(detailCluster.id)
          }}
          onDelete={() => {
            setDetailClusterId(null)
            handleDeleteCluster(detailCluster)
          }}
        />
      )}

      {/* Keyed on id so the edit form re-seeds when a different item is selected. */}
      {selectedItem && (
        <ResourceItemPanel
          key={selectedItem.id}
          item={selectedItem}
          onClose={() => setSelectedItemId(null)}
          dropRef={panelDropRef}
          dropActive={panelDropActive}
        />
      )}
    </div>
  )
}
