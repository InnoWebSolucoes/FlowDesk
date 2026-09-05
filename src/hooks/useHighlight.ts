import { useCallback, useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { HIGHLIGHT_CLASS, HIGHLIGHT_MS, HIGHLIGHT_PARAM } from '../lib/highlight'

/**
 * Reads `?highlight=<id>` and hands back the two things a list needs to act on
 * it: the class for the matching row, and a ref that scrolls it into view.
 *
 * Usage in a list:
 *
 *     const highlight = useHighlight()
 *     ...
 *     <div key={task.id} {...highlight.props(task.id)}>
 *
 * The parameter is cleared once the ring has run its course, so the highlight
 * does not come back on every later render of the page — but not before, or
 * consuming it would cancel the very highlight it was asking for.
 */
export function useHighlight() {
  const [searchParams, setSearchParams] = useSearchParams()
  const [expired, setExpired] = useState<string | null>(null)
  const scrolled = useRef<string | null>(null)

  const wanted = searchParams.get(HIGHLIGHT_PARAM)
  /**
   * The id being pointed at, derived from the URL rather than copied into
   * state. Copying it would mean setting state during an effect — a cascading
   * render on every arrival — so the parameter itself is the source, and state
   * only records the one thing the URL cannot: that its four seconds are up.
   */
  const activeId = wanted && wanted !== expired ? wanted : null

  // A fresh id restarts the scroll, so returning to the same row later scrolls
  // to it again rather than assuming the page never moved.
  useEffect(() => {
    scrolled.current = null
  }, [wanted])

  // The ring is temporary by design — it says "here", then gets out of the way.
  useEffect(() => {
    if (!activeId) return
    const timer = setTimeout(() => setExpired(activeId), HIGHLIGHT_MS)
    return () => clearTimeout(timer)
  }, [activeId])

  // Consume the parameter once the ring has been and gone, rather than on
  // arrival: clearing it immediately would erase the very id being rendered
  // from, and leaving it forever would re-ring the row on every later render.
  useEffect(() => {
    if (!expired || wanted !== expired) return
    searchParams.delete(HIGHLIGHT_PARAM)
    setSearchParams(searchParams, { replace: true })
  }, [expired, wanted, searchParams, setSearchParams])

  /**
   * Scrolls the highlighted row into view once. A callback ref rather than an
   * effect because the row may not be mounted when the id arrives — it can be
   * inside a collapsed section or a list that is still loading, and this fires
   * whenever it does appear.
   */
  const ref = useCallback(
    (node: HTMLElement | null) => {
      if (!node || !activeId || scrolled.current === activeId) return
      scrolled.current = activeId
      node.scrollIntoView({ behavior: 'smooth', block: 'center' })
    },
    [activeId]
  )

  const isHighlighted = (id: string) => activeId === id

  /**
   * Everything a row needs, ready to spread onto it. The row's own classes are
   * passed in rather than left to the caller to merge, because spreading a
   * `className` over an element that already has one silently replaces it —
   * which would strip the row of its normal styling for the four seconds it is
   * highlighted.
   */
  const props = (id: string, className = '') =>
    isHighlighted(id)
      ? { ref, className: `${className} ${HIGHLIGHT_CLASS}`.trim(), 'data-highlighted': true }
      : { className }

  return { activeId, isHighlighted, props, ref }
}
