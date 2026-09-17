import React, { useEffect, useState } from 'react'
import { X, Download, ExternalLink } from 'lucide-react'
import { ResourceItem } from '../../types'
import {
  ResourceThumbnail, formatFileSize, fileKind, useSignedUrl, FileKindIcon,
} from '../resources/ResourceThumbnail'
import { useT } from '../../i18n/useT'

/**
 * A document opened inside FlowDesk: an image, video, audio or PDF shown
 * over the page, anything else offered as a download. Nothing leaves the
 * app — a new tab in the desktop shell is a window with no way back.
 */
export function AttachmentViewer({ item, onClose }: { item: ResourceItem; onClose: () => void }) {
  const { t } = useT()
  const kind = item.links.length > 0 ? 'link' : fileKind(item.mimeType, item.fileName)
  const url = useSignedUrl(kind === 'link' ? null : item.storagePath)
  const name = item.fileName ?? item.title

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  const download = () => {
    if (!url) return
    const a = document.createElement('a')
    a.href = url
    a.download = name
    document.body.appendChild(a)
    a.click()
    a.remove()
  }

  const inline = kind === 'image' || kind === 'video' || kind === 'audio' || kind === 'pdf'

  return (
    <div className="fixed inset-0 z-[70] bg-black/80 flex flex-col" onClick={onClose}>
      <div
        className="flex items-center gap-3 px-4 py-2.5 bg-black/40 text-white flex-shrink-0"
        onClick={(e) => e.stopPropagation()}
      >
        <span className="text-sm font-medium truncate flex-1">{name}</span>
        {item.size ? <span className="text-xs text-white/60">{formatFileSize(item.size)}</span> : null}
        {kind === 'link' ? (
          <a
            href={item.links[0]?.url}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-md bg-white/10 hover:bg-white/20"
          >
            <ExternalLink size={13} /> {t('attachment_open')}
          </a>
        ) : (
          <button
            onClick={download}
            disabled={!url}
            className="flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-md bg-white/10 hover:bg-white/20 disabled:opacity-50"
          >
            <Download size={13} /> {t('attachment_download')}
          </button>
        )}
        <button onClick={onClose} className="p-1.5 rounded-md hover:bg-white/20" title={t('ui_close')}>
          <X size={16} />
        </button>
      </div>

      <div className="flex-1 min-h-0 flex items-center justify-center p-4">
        {inline && url ? (
          kind === 'image' ? (
            <img src={url} alt={name} className="max-w-full max-h-full object-contain" onClick={(e) => e.stopPropagation()} />
          ) : kind === 'video' ? (
            <video src={url} controls autoPlay className="max-w-full max-h-full" onClick={(e) => e.stopPropagation()} />
          ) : kind === 'audio' ? (
            <audio src={url} controls autoPlay onClick={(e) => e.stopPropagation()} />
          ) : (
            <iframe
              src={`${url}#toolbar=1&view=FitH`}
              title={name}
              className="w-full h-full max-w-5xl bg-white rounded-lg border-0"
              onClick={(e) => e.stopPropagation()}
            />
          )
        ) : (
          // Nothing the browser can draw. Say what it is and offer it.
          <div
            className="bg-surface rounded-xl p-8 flex flex-col items-center gap-3 text-center max-w-sm"
            onClick={(e) => e.stopPropagation()}
          >
            <FileKindIcon mime={item.mimeType} fileName={item.fileName} size={40} />
            <p className="text-sm text-text-main font-medium break-all">{name}</p>
            <p className="text-xs text-text-muted">{t('attachment_noPreview')}</p>
            {kind !== 'link' && (
              <button
                onClick={download}
                disabled={!url}
                className="flex items-center gap-1.5 bg-primary text-white text-sm font-medium px-4 py-2 rounded-lg hover:bg-primary-dark disabled:opacity-50"
              >
                <Download size={14} /> {t('attachment_download')}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

/**
 * An attached document, with a real preview of it — the image itself, the
 * first page of a PDF, a frame of a video — and its name. Click opens it.
 * `onRemove` makes it a pending attachment that can still be taken off.
 */
export function AttachmentCard({
  item,
  onRemove,
  width = 168,
}: {
  item: ResourceItem
  onRemove?: () => void
  width?: number
}) {
  const { t } = useT()
  const [viewing, setViewing] = useState(false)
  const height = Math.round(width * 0.62)

  return (
    <div
      className="relative rounded-lg border border-border bg-surface overflow-hidden group flex-shrink-0"
      style={{ width }}
    >
      <button
        type="button"
        onClick={() => setViewing(true)}
        title={t('attachment_open')}
        className="block w-full text-left"
      >
        <div className="overflow-hidden bg-surface-2" style={{ width, height }}>
          <ResourceThumbnail item={item} width={width} height={height} />
        </div>
        <div className="px-2 py-1.5">
          <p className="text-[11px] text-text-main truncate group-hover:text-primary transition-colors">
            {item.fileName ?? item.title}
          </p>
          {item.size ? (
            <p className="text-[10px] text-text-subtle">{formatFileSize(item.size)}</p>
          ) : null}
        </div>
      </button>
      {onRemove && (
        <button
          type="button"
          onClick={onRemove}
          title={t('ui_remove')}
          className="absolute top-1 right-1 w-5 h-5 rounded-full bg-black/60 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
        >
          <X size={11} />
        </button>
      )}
      {viewing && <AttachmentViewer item={item} onClose={() => setViewing(false)} />}
    </div>
  )
}

/** A document that is on the entry but could not be loaded: deleted, or not yours to see. */
export function MissingAttachment({ width = 168 }: { width?: number }) {
  const { t } = useT()
  return (
    <div
      className="rounded-lg border border-dashed border-border bg-surface-2/60 flex items-center justify-center text-[11px] text-text-subtle italic flex-shrink-0"
      style={{ width, height: Math.round(width * 0.62) + 36 }}
    >
      {t('attachment_missing')}
    </div>
  )
}
