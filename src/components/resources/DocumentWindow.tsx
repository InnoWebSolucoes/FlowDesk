import React, { useEffect, useMemo, useRef, useState } from 'react'
import {
  X, Minus, Maximize2, Minimize2, ExternalLink, Download, Loader2, AlertCircle,
  PanelRightOpen, PanelRightClose,
} from 'lucide-react'
import { ResourceItem } from '../../types'
import { useProjectStore } from '../../store/projectStore'
import { fileKind } from './ResourceThumbnail'
import { googleEmbedUrl } from './googleDocs'

/**
 * A draggable, resizable window that renders a document in place, so opening a
 * PDF, an image or a Google Doc never navigates away from FlowDesk.
 *
 * Google Docs, Sheets and Slides are embedded in their real editor, so the
 * document can be edited here. Anything the browser cannot display inline
 * (Office files, archives) falls back to an explicit "open externally" panel
 * rather than a blank frame.
 */

type Source =
  | { type: 'loading' }
  | { type: 'image' | 'pdf' | 'video' | 'audio' | 'text'; url: string }
  | { type: 'google'; url: string; external: string }
  | { type: 'office'; viewer: string; url: string }
  | { type: 'unsupported'; url: string | null; reason: string }

export function DocumentWindow({ item, onClose }: { item: ResourceItem; onClose: () => void }) {
  const getFileUrl = useProjectStore((s) => s.getFileUrl)
  const [source, setSource] = useState<Source>({ type: 'loading' })
  const [maximised, setMaximised] = useState(false)
  const [minimised, setMinimised] = useState(false)
  // Docked is the default: a full-height panel on the right, the same shape as
  // the Claude pane. Undocking gives the draggable floating window.
  const [docked, setDocked] = useState(true)

  // Position and size, in px. Kept in state so the window can be dragged.
  const [box, setBox] = useState(() => ({
    x: Math.max(16, window.innerWidth / 2 - 460),
    y: Math.max(16, window.innerHeight / 2 - 320),
    w: Math.min(920, window.innerWidth - 48),
    h: Math.min(640, window.innerHeight - 80),
  }))
  const dragRef = useRef<{ dx: number; dy: number } | null>(null)
  const resizeRef = useRef<{ x: number; y: number; w: number; h: number } | null>(null)
  const [dockWidth, setDockWidth] = useState(() => Math.min(560, Math.max(360, window.innerWidth * 0.42)))
  const dockResizeRef = useRef<number | null>(null)

  /** A Google link on the item wins: it is the editable version of the doc. */
  const googleLink = useMemo(() => {
    for (const l of item.links) {
      const embed = googleEmbedUrl(l.url)
      if (embed) return { embed, external: l.url }
    }
    return null
  }, [item.links])

  useEffect(() => {
    let cancelled = false

    const resolve = async () => {
      if (googleLink) {
        setSource({ type: 'google', url: googleLink.embed, external: googleLink.external })
        return
      }

      if (!item.storagePath) {
        const first = item.links[0]
        setSource({
          type: 'unsupported',
          url: first?.url ?? null,
          reason: first ? 'This link opens outside FlowDesk.' : 'This item has no file or link yet.',
        })
        return
      }

      const url = await getFileUrl(item.storagePath)
      if (cancelled) return
      if (!url) {
        setSource({ type: 'unsupported', url: null, reason: 'The file could not be loaded.' })
        return
      }

      const kind = fileKind(item.mimeType, item.fileName)
      if (kind === 'doc' || kind === 'sheet' || kind === 'slide') {
        // Browsers cannot render Office files. Microsoft's viewer converts them
        // for display; it fetches the file itself, which works because our
        // signed URLs are publicly reachable for the hour they live.
        setSource({
          type: 'office',
          viewer: `https://view.officeapps.live.com/op/embed.aspx?src=${encodeURIComponent(url)}`,
          url,
        })
      }
      else if (kind === 'image') setSource({ type: 'image', url })
      else if (kind === 'pdf') setSource({ type: 'pdf', url })
      else if (kind === 'video') setSource({ type: 'video', url })
      else if (kind === 'audio') setSource({ type: 'audio', url })
      else if (kind === 'text' || kind === 'code') setSource({ type: 'text', url })
      else {
        setSource({
          type: 'unsupported',
          url,
          reason: 'This file type cannot be shown here. Download it, or open it externally.',
        })
      }
    }

    resolve()
    return () => { cancelled = true }
  }, [item, getFileUrl, googleLink])

  // Dragging the title bar, and the bottom-right resize corner.
  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      if (dragRef.current) {
        setBox((b) => ({
          ...b,
          x: Math.max(0, Math.min(window.innerWidth - 120, e.clientX - dragRef.current!.dx)),
          y: Math.max(0, Math.min(window.innerHeight - 40, e.clientY - dragRef.current!.dy)),
        }))
      } else if (dockResizeRef.current !== null) {
        // Dragging the panel's left edge widens or narrows it.
        setDockWidth(Math.max(320, Math.min(window.innerWidth - 120, window.innerWidth - e.clientX)))
      } else if (resizeRef.current) {
        const r = resizeRef.current
        setBox((b) => ({
          ...b,
          w: Math.max(360, r.w + (e.clientX - r.x)),
          h: Math.max(240, r.h + (e.clientY - r.y)),
        }))
      }
    }
    const onUp = () => {
      dragRef.current = null
      resizeRef.current = null
      dockResizeRef.current = null
      document.body.style.userSelect = ''
    }

    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const style: React.CSSProperties = maximised
    ? { left: 8, top: 8, width: 'calc(100vw - 16px)', height: 'calc(100vh - 16px)' }
    : docked
      ? minimised
        ? { right: 0, bottom: 0, width: 360, height: 'auto' }
        : { right: 0, top: 0, width: dockWidth, height: '100vh' }
      : minimised
        ? { left: box.x, top: box.y, width: 320, height: 'auto' }
        : { left: box.x, top: box.y, width: box.w, height: box.h }

  const externalUrl =
    source.type === 'google' ? source.external : 'url' in source ? source.url ?? undefined : undefined

  return (
    <div
      className={`fixed z-[70] bg-surface border-border shadow-2xl flex flex-col overflow-hidden ${
        docked && !maximised ? 'border-l' : 'border rounded-xl'
      }`}
      style={style}
      role="dialog"
      aria-label={item.title}
    >
      <header
        onPointerDown={(e) => {
          if (docked || maximised || (e.target as HTMLElement).closest('button')) return
          dragRef.current = { dx: e.clientX - box.x, dy: e.clientY - box.y }
          document.body.style.userSelect = 'none'
        }}
        onDoubleClick={() => setMaximised((m) => !m)}
        className={`flex items-center gap-2 px-3 py-2 border-b border-border bg-surface-2 flex-shrink-0 select-none ${
          docked || maximised ? '' : 'cursor-move'
        }`}
      >
        <span className="text-sm text-text-main truncate flex-1" title={item.title}>
          {item.title}
        </span>

        {externalUrl && (
          <a
            href={externalUrl}
            target="_blank"
            rel="noreferrer"
            className="text-text-subtle hover:text-primary p-1 rounded"
            title="Open outside FlowDesk"
          >
            <ExternalLink size={14} />
          </a>
        )}
        {source.type !== 'google' && 'url' in source && source.url && (
          <a
            href={source.url}
            download={item.fileName ?? undefined}
            className="text-text-subtle hover:text-primary p-1 rounded"
            title="Download"
          >
            <Download size={14} />
          </a>
        )}
        <button
          onClick={() => { setDocked((d) => !d); setMaximised(false) }}
          className="text-text-subtle hover:text-text-main p-1 rounded"
          title={docked ? 'Pop out into a floating window' : 'Dock to the right'}
        >
          {docked ? <PanelRightOpen size={14} /> : <PanelRightClose size={14} />}
        </button>
        <button
          onClick={() => setMinimised((m) => !m)}
          className="text-text-subtle hover:text-text-main p-1 rounded"
          title={minimised ? 'Restore' : 'Minimise'}
        >
          <Minus size={14} />
        </button>
        <button
          onClick={() => { setMaximised((m) => !m); setMinimised(false) }}
          className="text-text-subtle hover:text-text-main p-1 rounded"
          title={maximised ? 'Restore' : 'Maximise'}
        >
          {maximised ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
        </button>
        <button onClick={onClose} className="text-text-subtle hover:text-danger p-1 rounded" title="Close">
          <X size={15} />
        </button>
      </header>

      {!minimised && (
        <div className="flex-1 min-h-0 bg-surface-2 relative">
          {source.type === 'loading' && (
            <div className="absolute inset-0 flex items-center justify-center text-text-subtle">
              <Loader2 size={20} className="animate-spin" />
            </div>
          )}

          {source.type === 'image' && (
            <div className="absolute inset-0 overflow-auto flex items-center justify-center p-2">
              <img src={source.url} alt={item.title} className="max-w-full max-h-full object-contain" />
            </div>
          )}

          {(source.type === 'pdf' || source.type === 'text') && (
            <iframe src={source.url} title={item.title} className="w-full h-full border-0 bg-white" />
          )}

          {source.type === 'office' && (
            <iframe
              src={source.viewer}
              title={item.title}
              className="w-full h-full border-0 bg-white"
            />
          )}

          {source.type === 'google' && (
            <iframe
              src={source.url}
              title={item.title}
              className="w-full h-full border-0 bg-white"
              allow="clipboard-read; clipboard-write"
            />
          )}

          {source.type === 'video' && (
            <video src={source.url} controls className="w-full h-full bg-black" />
          )}

          {source.type === 'audio' && (
            <div className="absolute inset-0 flex items-center justify-center p-6">
              <audio src={source.url} controls className="w-full" />
            </div>
          )}

          {source.type === 'unsupported' && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-6 text-center">
              <AlertCircle size={22} className="text-text-subtle" />
              <p className="text-sm text-text-muted max-w-xs">{source.reason}</p>
              {source.url && (
                <a
                  href={source.url}
                  target="_blank"
                  rel="noreferrer"
                  className="px-3 py-1.5 rounded-lg bg-primary text-white text-xs font-medium"
                >
                  Open externally
                </a>
              )}
            </div>
          )}
        </div>
      )}

      {!minimised && !maximised && docked && (
        <div
          onPointerDown={() => {
            dockResizeRef.current = 1
            document.body.style.userSelect = 'none'
          }}
          className="absolute inset-y-0 left-0 w-1.5 cursor-ew-resize hover:bg-primary/30"
          title="Drag to resize the panel"
        />
      )}

      {!minimised && !maximised && !docked && (
        <div
          onPointerDown={(e) => {
            resizeRef.current = { x: e.clientX, y: e.clientY, w: box.w, h: box.h }
            document.body.style.userSelect = 'none'
          }}
          className="absolute bottom-0 right-0 w-4 h-4 cursor-nwse-resize"
          title="Resize"
        />
      )}
    </div>
  )
}
