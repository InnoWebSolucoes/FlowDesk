import React, { useEffect, useState } from 'react'
import { Document } from '../../types'
import { useToolStore } from '../../store/toolStore'
import { fileKind, kindStyle } from '../resources/ResourceThumbnail'

/**
 * Signed URLs for toolbox documents.
 *
 * The resources canvas has its own version of this, but it signs against the
 * resources bucket through the project store. Toolbox documents live in
 * `attachments` and are signed by the tool store, so the caching has to be
 * repeated rather than shared. Cached by storage path and expiry, because a
 * grid of thumbnails would otherwise fire one request per file per render.
 */
const urlCache = new Map<string, { url: string; expires: number }>()

export function useDocumentUrl(storagePath: string | null): string | null {
  const getDocumentUrl = useToolStore((s) => s.getDocumentUrl)
  const [url, setUrl] = useState<string | null>(() => {
    if (!storagePath) return null
    const hit = urlCache.get(storagePath)
    return hit && hit.expires > Date.now() ? hit.url : null
  })

  useEffect(() => {
    if (!storagePath) {
      setUrl(null)
      return
    }
    const hit = urlCache.get(storagePath)
    if (hit && hit.expires > Date.now()) {
      setUrl(hit.url)
      return
    }

    let alive = true
    getDocumentUrl(storagePath).then((signed) => {
      if (!signed) return
      // The signature lasts a minute; expire the cache a little before that so
      // a thumbnail never renders with a URL that has just gone stale.
      urlCache.set(storagePath, { url: signed, expires: Date.now() + 45_000 })
      if (alive) setUrl(signed)
    })
    return () => { alive = false }
  }, [storagePath, getDocumentUrl])

  return url
}

/**
 * What a document looks like before you open it.
 *
 * An image shows itself. Everything else shows its type — the icon and colour
 * the resources canvas already uses, on a tint of the same colour — because a
 * PDF has no thumbnail to draw and a row of identical grey glyphs told an
 * employee nothing about which file was which.
 */
export function DocumentThumb({ doc, height = 112 }: { doc: Document; height?: number }) {
  const kind = fileKind(doc.type || null, doc.name)
  const { color, Icon, label } = kindStyle(kind)
  const isImage = kind === 'image'

  // Only images are fetched. Signing every PDF in the list to draw an icon
  // would be a request per file for a picture we were never going to use.
  const url = useDocumentUrl(isImage ? doc.storagePath : null)
  const [failed, setFailed] = useState(false)

  if (isImage && url && !failed) {
    return (
      <div
        className="w-full rounded-lg overflow-hidden bg-surface-2 flex items-center justify-center"
        style={{ height }}
      >
        <img
          src={url}
          alt={doc.title || doc.name}
          loading="lazy"
          onError={() => setFailed(true)}
          className="w-full h-full object-cover"
        />
      </div>
    )
  }

  return (
    <div
      className="w-full rounded-lg flex flex-col items-center justify-center gap-1.5"
      // A tint of the type's own colour: enough to tell a PDF from a
      // spreadsheet across a grid without shouting.
      style={{ height, backgroundColor: `${color}14` }}
    >
      <span style={{ color }}>
        <Icon size={28} />
      </span>
      <span className="text-[10px] font-semibold uppercase tracking-wide" style={{ color }}>
        {label}
      </span>
    </div>
  )
}
