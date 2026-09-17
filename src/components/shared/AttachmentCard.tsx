import React from 'react'
import { X } from 'lucide-react'
import { ResourceItem } from '../../types'
import { useProjectStore } from '../../store/projectStore'
import { ResourceThumbnail, formatFileSize } from '../resources/ResourceThumbnail'
import { useT } from '../../i18n/useT'

/**
 * Opens a document the way a reader expects: an image, PDF or video in a
 * new tab where the browser can show it, anything else as a download. A
 * link item goes straight to its address. Never in the current tab — in
 * the desktop shell that replaced the whole app with the file.
 */
export async function openResourceItem(
  item: ResourceItem,
  getFileUrl: (storagePath: string) => Promise<string | null>,
) {
  if (!item.storagePath) {
    if (item.links[0]) window.open(item.links[0].url, '_blank', 'noopener,noreferrer')
    return
  }
  const url = await getFileUrl(item.storagePath)
  if (!url) return
  window.open(url, '_blank', 'noopener,noreferrer')
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
  const getFileUrl = useProjectStore((s) => s.getFileUrl)
  const height = Math.round(width * 0.62)

  return (
    <div
      className="relative rounded-lg border border-border bg-surface overflow-hidden group flex-shrink-0"
      style={{ width }}
    >
      <button
        type="button"
        onClick={() => openResourceItem(item, getFileUrl)}
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
