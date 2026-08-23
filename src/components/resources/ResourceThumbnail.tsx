import React, { useEffect, useState } from 'react'
import { FileText, Music, Video, Table, Presentation, Archive, Code, File as FileIcon, Link2 } from 'lucide-react'
import { ResourceItem } from '../../types'
import { useProjectStore } from '../../store/projectStore'

export type FileKind =
  | 'image' | 'pdf' | 'audio' | 'video' | 'doc' | 'sheet' | 'slide'
  | 'archive' | 'code' | 'text' | 'link' | 'other'

export function fileKind(mime: string | null, fileName?: string | null): FileKind {
  if (!mime) return 'link'

  if (mime.startsWith('image/')) return 'image'
  if (mime.startsWith('audio/')) return 'audio'
  if (mime.startsWith('video/')) return 'video'
  if (mime === 'application/pdf') return 'pdf'

  const ext = fileName?.split('.').pop()?.toLowerCase() ?? ''

  if (mime.includes('word') || mime.includes('opendocument.text') || ['doc', 'docx', 'odt', 'rtf'].includes(ext)) return 'doc'
  if (mime.includes('sheet') || mime.includes('excel') || ['xls', 'xlsx', 'ods', 'csv'].includes(ext)) return 'sheet'
  if (mime.includes('presentation') || mime.includes('powerpoint') || ['ppt', 'pptx', 'odp'].includes(ext)) return 'slide'
  if (mime.includes('zip') || mime.includes('compressed') || ['zip', 'rar', '7z', 'tar', 'gz'].includes(ext)) return 'archive'
  if (mime.startsWith('text/plain') || ext === 'txt' || ext === 'md') return 'text'
  if (['js', 'ts', 'tsx', 'jsx', 'py', 'json', 'html', 'css', 'sql', 'sh'].includes(ext)) return 'code'

  return 'other'
}

/** Per-kind colour + icon, so a file reads as its type at a glance. */
const KIND_STYLE: Record<FileKind, { color: string; Icon: React.ComponentType<{ size?: number }>; label: string }> = {
  image:   { color: '#8b5cf6', Icon: FileIcon,     label: 'Image' },
  pdf:     { color: '#dc2626', Icon: FileText,     label: 'PDF' },
  audio:   { color: '#f59e0b', Icon: Music,        label: 'Audio' },
  video:   { color: '#ec4899', Icon: Video,        label: 'Video' },
  doc:     { color: '#2563eb', Icon: FileText,     label: 'Doc' },
  sheet:   { color: '#16a34a', Icon: Table,        label: 'Sheet' },
  slide:   { color: '#ea580c', Icon: Presentation, label: 'Slides' },
  archive: { color: '#78716c', Icon: Archive,      label: 'Archive' },
  code:    { color: '#0891b2', Icon: Code,         label: 'Code' },
  text:    { color: '#64748b', Icon: FileText,     label: 'Text' },
  link:    { color: '#6366f1', Icon: Link2,        label: 'Link' },
  other:   { color: '#64748b', Icon: FileIcon,     label: 'File' },
}

export function kindStyle(kind: FileKind) {
  return KIND_STYLE[kind]
}

export function FileKindIcon({ mime, fileName, size = 18 }: { mime: string | null; fileName?: string | null; size?: number }) {
  const { Icon } = KIND_STYLE[fileKind(mime, fileName)]
  return <Icon size={size} />
}

export function formatFileSize(bytes: number | null) {
  if (bytes == null) return ''
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/**
 * Signed URLs are per-item and expire, so they're cached in a module-level map
 * keyed by storage path. This keeps a canvas of many thumbnails from firing a
 * request per render, and survives re-mounts while panning.
 */
const urlCache = new Map<string, { url: string; expires: number }>()

export function useSignedUrl(storagePath: string | null): string | null {
  const getFileUrl = useProjectStore((s) => s.getFileUrl)
  const [url, setUrl] = useState<string | null>(null)

  useEffect(() => {
    if (!storagePath) return

    let cancelled = false

    // The URL cache is an external store, so a hit resolves immediately;
    // otherwise sign a fresh URL and cache it for the other thumbnails.
    const hit = urlCache.get(storagePath)
    const pending = hit && hit.expires > Date.now()
      ? Promise.resolve(hit.url)
      : getFileUrl(storagePath).then((signed) => {
          // Signed for 1h upstream; expire the cache a little early.
          if (signed) urlCache.set(storagePath, { url: signed, expires: Date.now() + 55 * 60 * 1000 })
          return signed
        })

    pending.then((signed) => {
      if (!cancelled && signed) setUrl(signed)
    })

    return () => { cancelled = true }
  }, [storagePath, getFileUrl])

  return storagePath ? url : null
}

/**
 * Visual preview of a resource item.
 *
 * Images and videos render their actual content; PDFs render their first page
 * via an iframe; everything else gets a typed, colour-coded card with its
 * extension, so the canvas reads like the file grid in a drive.
 */
export function ResourceThumbnail({
  item,
  width,
  height,
}: {
  item: ResourceItem
  width: number
  height: number
}) {
  const kind = fileKind(item.mimeType, item.fileName)
  const url = useSignedUrl(item.storagePath)
  const { color, Icon, label } = KIND_STYLE[kind]
  const [failed, setFailed] = useState(false)

  const ext = item.fileName?.split('.').pop()?.toUpperCase().slice(0, 4) ?? label

  // Real visual content where the browser can render it natively.
  if (url && !failed) {
    if (kind === 'image') {
      return (
        <img
          src={url}
          alt={item.title}
          draggable={false}
          onError={() => setFailed(true)}
          className="object-cover bg-surface-2"
          style={{ width, height }}
        />
      )
    }

    if (kind === 'video') {
      return (
        <video
          src={url}
          muted
          playsInline
          preload="metadata"
          draggable={false}
          onError={() => setFailed(true)}
          className="object-cover bg-black"
          style={{ width, height }}
        />
      )
    }

    if (kind === 'pdf') {
      // The iframe renders page 1; a transparent overlay keeps drag/click on the node.
      return (
        <div className="relative overflow-hidden bg-white" style={{ width, height }}>
          <iframe
            src={`${url}#page=1&toolbar=0&navpanes=0&scrollbar=0&view=FitH`}
            title={item.title}
            tabIndex={-1}
            scrolling="no"
            className="border-0 pointer-events-none"
            style={{ width: width * 2, height: height * 2, transform: 'scale(0.5)', transformOrigin: 'top left' }}
          />
          <span
            className="absolute bottom-1 right-1 text-[8px] font-bold text-white px-1 py-0.5 rounded"
            style={{ backgroundColor: color }}
          >
            PDF
          </span>
        </div>
      )
    }
  }

  // Typed card for everything else — colour and extension carry the meaning.
  return (
    <div
      className="flex flex-col items-center justify-center gap-1"
      style={{ width, height, backgroundColor: `${color}14` }}
    >
      <span style={{ color }}>
        <Icon size={Math.min(30, height * 0.34)} />
      </span>
      <span
        className="text-[9px] font-bold tracking-wide px-1.5 py-0.5 rounded"
        style={{ color, backgroundColor: `${color}22` }}
      >
        {item.storagePath ? ext : 'LINK'}
      </span>
    </div>
  )
}
