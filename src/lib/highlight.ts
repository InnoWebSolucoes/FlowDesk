/**
 * Pointing at one thing on a crowded page.
 *
 * A notification is about a specific task, todo, note or document, but the page
 * it lives on shows dozens of them. Landing on the right page is not enough:
 * the reader still has to hunt for the row the notification meant. So the link
 * carries `?highlight=<id>`, and whichever list renders that id flashes it for
 * a few seconds and scrolls it into view.
 *
 * The parameter is deliberately generic — one name across tasks, todos, notes
 * and documents — so a page adds this by reading one hook and spreading one
 * set of props, rather than inventing its own convention.
 */

export const HIGHLIGHT_PARAM = 'highlight'

/** How long the ring stays up. Long enough to find, short enough not to nag. */
export const HIGHLIGHT_MS = 4000

/** Adds `?highlight=<id>` to a route, preserving any query it already has. */
export function withHighlight(path: string, id: string | null | undefined) {
  if (!id) return path
  const sep = path.includes('?') ? '&' : '?'
  return `${path}${sep}${HIGHLIGHT_PARAM}=${encodeURIComponent(id)}`
}

/**
 * The ring itself. A class rather than an inline style so it sits in the same
 * Tailwind vocabulary as everything around it, and an outline rather than a
 * border so it cannot shift the layout of the row it lands on.
 */
export const HIGHLIGHT_CLASS =
  'outline outline-2 outline-offset-2 outline-primary rounded-lg animate-highlight-pulse'
