import { useCallback, useEffect, useRef, useState } from 'react'

export interface Rect {
  left: number
  top: number
  width: number
  height: number
}

/** World-space distance before a press counts as a marquee rather than a click. */
const MARQUEE_THRESHOLD = 4

/**
 * Drag-to-select over a container. Rows and tiles register themselves by id via
 * `register`, and anything whose box intersects the dragged rectangle is
 * selected. Returns the rectangle so the caller can draw it.
 */
export function useMarqueeSelect(
  containerRef: React.RefObject<HTMLElement | null>,
  onSelect: (ids: string[], additive: boolean) => void
) {
  const [rect, setRect] = useState<Rect | null>(null)
  const targets = useRef(new Map<string, HTMLElement>())
  const start = useRef<{ x: number; y: number; additive: boolean } | null>(null)

  /** ref callback for a selectable element. */
  const register = useCallback((id: string) => (el: HTMLElement | null) => {
    if (el) targets.current.set(id, el)
    else targets.current.delete(id)
  }, [])

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      // Left button on the background only — rows stop propagation themselves.
      if (e.button !== 0) return
      const container = containerRef.current
      if (!container) return

      const bounds = container.getBoundingClientRect()
      start.current = {
        x: e.clientX - bounds.left + container.scrollLeft,
        y: e.clientY - bounds.top + container.scrollTop,
        additive: e.shiftKey || e.metaKey || e.ctrlKey,
      }
    },
    [containerRef]
  )

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const onMove = (e: PointerEvent) => {
      const s = start.current
      if (!s) return

      const bounds = container.getBoundingClientRect()
      const x = e.clientX - bounds.left + container.scrollLeft
      const y = e.clientY - bounds.top + container.scrollTop

      if (!rect && Math.hypot(x - s.x, y - s.y) < MARQUEE_THRESHOLD) return

      const next: Rect = {
        left: Math.min(s.x, x),
        top: Math.min(s.y, y),
        width: Math.abs(x - s.x),
        height: Math.abs(y - s.y),
      }
      setRect(next)

      // Intersect against each registered element, in the same coordinate space.
      const hits: string[] = []
      for (const [id, el] of targets.current) {
        const r = el.getBoundingClientRect()
        const left = r.left - bounds.left + container.scrollLeft
        const top = r.top - bounds.top + container.scrollTop
        if (
          left < next.left + next.width &&
          left + r.width > next.left &&
          top < next.top + next.height &&
          top + r.height > next.top
        ) {
          hits.push(id)
        }
      }
      onSelect(hits, s.additive)
    }

    const onUp = () => {
      start.current = null
      setRect(null)
    }

    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
    }
  }, [containerRef, onSelect, rect])

  return { rect, register, onPointerDown, isMarqueeing: rect !== null }
}
