import { useCallback, useEffect, useRef, useState } from 'react'

export interface Viewport {
  x: number
  y: number
  scale: number
}

const MIN_SCALE = 0.15
const MAX_SCALE = 3

/** Zoom step per notch. Lower = less sensitive. */
const WHEEL_STEP = 1.3
/** Pinch fires many small events per gesture, so it needs a gentler step. */
const PINCH_STEP = 1.16
/** Button zoom step. */
const BUTTON_STEP = 1.4

/**
 * Zoom thresholds that drive cluster navigation. Both levels land at scale 1
 * after a swap, so these sit well either side of it — the gap is the hysteresis
 * that stops a single gesture from cascading through several levels.
 */
export const ZOOM_ENTER_THRESHOLD = 2.2
export const ZOOM_EXIT_THRESHOLD = 0.45

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

      const isPinch = e.ctrlKey
      // Mouse wheels emit deltaY in ~100px notches with no horizontal component.
      const isMouseWheel = !e.ctrlKey && e.deltaX === 0 && Math.abs(e.deltaY) >= 40 && e.deltaMode === 0

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
