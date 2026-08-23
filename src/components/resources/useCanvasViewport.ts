import { useCallback, useEffect, useRef, useState } from 'react'

export interface Viewport {
  x: number
  y: number
  scale: number
}

const MIN_SCALE = 0.08
const MAX_SCALE = 3

/** Zoom step per notch. Lower = less sensitive. */
const WHEEL_STEP = 1.6
/** Pinch fires many small events per gesture, so it needs a gentler step. */
const PINCH_STEP = 1.34
/** Button zoom step. */
const BUTTON_STEP = 1.6

/** Idle time after which a new wheel stream is classified afresh. */
const GESTURE_GAP_MS = 220

/**
 * Zoom thresholds that drive cluster navigation. Both levels land at scale 1
 * after a swap, so these sit either side of it — the gap is the hysteresis that
 * stops a single gesture from cascading through several levels.
 *
 * Exit sits several steps below the landing scale on purpose: you need room to
 * zoom out and survey a whole cluster before it decides you're leaving it.
 */
export const ZOOM_ENTER_THRESHOLD = 1.45
export const ZOOM_EXIT_THRESHOLD = 0.3

/**
 * Pan/zoom viewport for the resources canvas.
 *
 * World coordinates are what we persist (item.x / cluster.x); screen coordinates
 * are what the pointer reports. The canvas renders a single transformed layer,
 * so children stay real DOM nodes and keep their normal interactions.
 */
export function useCanvasViewport(containerRef: React.RefObject<HTMLElement | null>) {
  const [viewport, setViewport] = useState<Viewport>({ x: 0, y: 0, scale: 1 })
  const [isPanning, setIsPanning] = useState(false)
  const [animating, setAnimating] = useState(false)

  const panState = useRef<{ startX: number; startY: number; originX: number; originY: number } | null>(null)
  // Wheel-stream classification, so a diagonal trackpad swipe isn't mistaken
  // for a mouse wheel on the frames where its horizontal delta happens to be 0.
  const lastWheel = useRef(0)
  const trackpadGesture = useRef(false)
  const animTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const screenToWorld = useCallback(
    (screenX: number, screenY: number) => {
      const rect = containerRef.current?.getBoundingClientRect()
      if (!rect) return { x: 0, y: 0 }
      return {
        x: (screenX - rect.left - viewport.x) / viewport.scale,
        y: (screenY - rect.top - viewport.y) / viewport.scale,
      }
    },
    [containerRef, viewport]
  )

  /** Animate the viewport to a new value; `animating` drives the CSS transition. */
  const animateTo = useCallback((next: Viewport, duration = 450) => {
    setAnimating(true)
    setViewport(next)
    if (animTimer.current) clearTimeout(animTimer.current)
    animTimer.current = setTimeout(() => setAnimating(false), duration)
  }, [])

  /** Centre the viewport on a world-space box, fitting it with padding. */
  const focusOn = useCallback(
    (worldX: number, worldY: number, worldSize: number, padding = 1.6) => {
      const rect = containerRef.current?.getBoundingClientRect()
      if (!rect) return

      const target = Math.min(rect.width, rect.height) / (worldSize * padding)
      const scale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, target))

      animateTo({
        x: rect.width / 2 - worldX * scale,
        y: rect.height / 2 - worldY * scale,
        scale,
      })
    },
    [containerRef, animateTo]
  )

  const resetView = useCallback(() => {
    const rect = containerRef.current?.getBoundingClientRect()
    if (!rect) return
    animateTo({ x: rect.width / 2, y: rect.height / 2, scale: 1 })
  }, [containerRef, animateTo])

  const zoomBy = useCallback(
    (factor: number) => {
      const rect = containerRef.current?.getBoundingClientRect()
      if (!rect) return

      setViewport((v) => {
        const scale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, v.scale * factor))
        // Keep the container centre fixed while zooming.
        const cx = rect.width / 2
        const cy = rect.height / 2
        const ratio = scale / v.scale
        return { x: cx - (cx - v.x) * ratio, y: cy - (cy - v.y) * ratio, scale }
      })
    },
    [containerRef]
  )

  const onPanStart = useCallback(
    (e: React.PointerEvent) => {
      // Only background drags pan; nodes stop propagation themselves.
      if (e.button !== 0) return
      // Stops the browser turning the pan into a text selection.
      e.preventDefault()
      panState.current = { startX: e.clientX, startY: e.clientY, originX: viewport.x, originY: viewport.y }
      setIsPanning(true)
    },
    [viewport]
  )

  useEffect(() => {
    if (!isPanning) return

    const onMove = (e: PointerEvent) => {
      const p = panState.current
      if (!p) return
      setViewport((v) => ({ ...v, x: p.originX + (e.clientX - p.startX), y: p.originY + (e.clientY - p.startY) }))
    }
    const onUp = () => {
      panState.current = null
      setIsPanning(false)
    }

    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    // Guarantees the pan ends even if the browser hijacks the gesture.
    window.addEventListener('pointercancel', onUp)
    window.addEventListener('blur', onUp)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
      window.removeEventListener('blur', onUp)
    }
  }, [isPanning])

  // Trackpad/wheel input. Non-passive so preventDefault sticks.
  //
  // Two-finger scroll pans (deltaX/deltaY), matching every other canvas app.
  // Pinch-to-zoom arrives as a wheel event with ctrlKey set — that's how
  // browsers surface the gesture — so it's the only path that scales.
  // A real mouse wheel (no ctrl, coarse deltaY, no deltaX) also zooms, since
  // there's no second axis to pan with.
  useEffect(() => {
    const el = containerRef.current
    if (!el) return

    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const rect = el.getBoundingClientRect()
      const px = e.clientX - rect.left
      const py = e.clientY - rect.top

      const now = performance.now()
      // A trackpad emits a continuous stream of events; a mouse wheel emits
      // isolated notches. Any horizontal component at all marks the stream as a
      // trackpad, and that verdict is held for the rest of the gesture — a
      // diagonal swipe passes through deltaX === 0 on individual frames, and
      // judging those in isolation made the pan jump into a zoom mid-swipe.
      if (now - lastWheel.current > GESTURE_GAP_MS) trackpadGesture.current = false
      lastWheel.current = now
      if (e.deltaX !== 0 || !Number.isInteger(e.deltaY)) trackpadGesture.current = true

      const isPinch = e.ctrlKey
      const isMouseWheel =
        !isPinch && !trackpadGesture.current && Math.abs(e.deltaY) >= 40 && e.deltaMode === 0

      if (isPinch || isMouseWheel) {
        setViewport((v) => {
          // Pinch deltas are fine-grained; wheel notches are coarse. Clamp so a
          // single gesture can't leap across the zoom range.
          const notches = Math.max(-3, Math.min(3, e.deltaY / (isPinch ? 40 : 100)))
          const factor = Math.pow(isPinch ? PINCH_STEP : WHEEL_STEP, -notches)
          const scale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, v.scale * factor))
          const ratio = scale / v.scale
          return { x: px - (px - v.x) * ratio, y: py - (py - v.y) * ratio, scale }
        })
        return
      }

      // Two-finger scroll: pan on both axes.
      setViewport((v) => ({ ...v, x: v.x - e.deltaX, y: v.y - e.deltaY }))
    }

    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [containerRef])

  useEffect(() => () => { if (animTimer.current) clearTimeout(animTimer.current) }, [])

  /** World-space point at the centre of the viewport. */
  const centreWorld = useCallback(() => {
    const rect = containerRef.current?.getBoundingClientRect()
    if (!rect) return { x: 0, y: 0 }
    return {
      x: (rect.width / 2 - viewport.x) / viewport.scale,
      y: (rect.height / 2 - viewport.y) / viewport.scale,
    }
  }, [containerRef, viewport])

  return {
    viewport, isPanning, animating, onPanStart, screenToWorld, centreWorld,
    focusOn, resetView, zoomBy, setViewport, BUTTON_STEP,
  }
}
