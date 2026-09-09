/**
 * A site's own favicon, via Google's service.
 *
 * The service wants a bare hostname. Handing it the whole URL — scheme, path
 * and all — returns nothing, which is why every tile showed a blank square in
 * both places websites are listed.
 *
 * Shared rather than written twice: the employee's Toolbox and the manager's
 * view of it both draw the same sites, and the two had already drifted.
 */
export function faviconUrl(url: string, size = 64): string {
  let host = url
  try {
    host = new URL(/^https?:\/\//i.test(url) ? url : `https://${url}`).hostname
  } catch {
    // Not parseable as a URL — strip what we can and let the service try.
    host = url.replace(/^https?:\/\//i, '').split('/')[0]
  }
  return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&sz=${size}`
}

/** The letter to fall back to when a site has no favicon of its own. */
export function faviconLetter(nameOrUrl: string): string {
  return (nameOrUrl || '?').trim().replace(/^https?:\/\//i, '').charAt(0).toUpperCase()
}
