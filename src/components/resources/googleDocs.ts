/**
 * Turns a Google Docs, Sheets, Slides, Forms or Drive share link into the URL
 * that can be embedded in a frame.
 *
 * Docs/Sheets/Slides keep `/edit`, so the embedded view is the real editor and
 * changes save to the document itself. Drive files only support `/preview`.
 * Returns null for anything that is not a recognisable Google link.
 */
export function googleEmbedUrl(raw: string): string | null {
  try {
    const url = new URL(raw)
    if (!/(^|\.)google\.com$/.test(url.hostname)) return null

    const m = url.pathname.match(/^\/(document|spreadsheets|presentation|forms)\/d\/([^/]+)/)
    if (!m) {
      const drive = url.pathname.match(/^\/file\/d\/([^/]+)/)
      if (drive) return `https://drive.google.com/file/d/${drive[1]}/preview`
      return null
    }

    const [, kind, id] = m
    if (kind === 'presentation') return `https://docs.google.com/presentation/d/${id}/edit?rm=embedded`
    if (kind === 'spreadsheets') return `https://docs.google.com/spreadsheets/d/${id}/edit?rm=embedded`
    if (kind === 'forms') return `https://docs.google.com/forms/d/${id}/viewform?embedded=true`
    return `https://docs.google.com/document/d/${id}/edit?rm=embedded`
  } catch {
    return null
  }
}
