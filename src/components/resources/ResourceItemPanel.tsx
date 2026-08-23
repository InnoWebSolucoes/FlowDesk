import React, { useEffect, useMemo, useState } from 'react'
import { X, Upload, Trash2, ExternalLink, Plus, Download } from 'lucide-react'
import { ResourceItem } from '../../types'
import { useProjectStore } from '../../store/projectStore'
import { fileKind, FileKindIcon, formatFileSize } from './ResourceThumbnail'

interface Props {
  item: ResourceItem
  onClose: () => void
}

export function ResourceItemPanel({ item, onClose }: Props) {
  const { updateItem, replaceItemFile, removeItemFile, deleteItem, setItemLinks, getFileUrl } = useProjectStore()

  const [title, setTitle] = useState(item.title)
  const [description, setDescription] = useState(item.description)
  const [links, setLinks] = useState<{ id?: string; label: string; url: string }[]>(
    item.links.map((l) => ({ id: l.id, label: l.label, url: l.url }))
  )
  // Keyed by storage path so a removed or replaced file never shows a stale URL.
  const [signed, setSigned] = useState<{ path: string; url: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const [saved, setSaved] = useState(false)

  // Signed URL for preview/download; refreshed whenever the file changes.
  // The panel is keyed on item.id upstream, so the form state above re-seeds
  // on selection without needing a sync effect here.
  useEffect(() => {
    let cancelled = false
    const path = item.storagePath
    if (!path) return

    getFileUrl(path).then((url) => {
      if (!cancelled && url) setSigned({ path, url })
    })
    return () => { cancelled = true }
  }, [item.storagePath, getFileUrl])

  const fileUrl = signed && signed.path === item.storagePath ? signed.url : null

  const kind = useMemo(() => fileKind(item.mimeType), [item.mimeType])

  const dirty =
    title !== item.title ||
    description !== item.description ||
    JSON.stringify(links.map((l) => [l.label, l.url])) !==
      JSON.stringify(item.links.map((l) => [l.label, l.url]))

  const handleSave = async () => {
    setBusy(true)
    await updateItem(item.id, { title, description })
    await setItemLinks(item.id, links)
    setBusy(false)
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  // Replacing the file keeps title, description and links untouched.
  const handleReplaceFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setBusy(true)
    await replaceItemFile(item.id, file)
    setBusy(false)
    e.target.value = ''
  }

  const handleDelete = async () => {
    if (!confirm(`Delete "${item.title}"? This cannot be undone.`)) return
    await deleteItem(item.id)
    onClose()
  }

  return (
    <aside className="absolute top-0 right-0 h-full w-full sm:w-[380px] bg-surface border-l border-border shadow-xl flex flex-col z-30">
      <header className="flex items-center justify-between px-4 py-3 border-b border-border flex-shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <FileKindIcon mime={item.mimeType} />
          <span className="text-text-main font-medium text-sm truncate">{item.title}</span>
        </div>
        <button onClick={onClose} className="text-text-subtle hover:text-text-main p-1 rounded flex-shrink-0">
          <X size={18} />
        </button>
      </header>

      <div className="flex-1 overflow-y-auto p-4 space-y-5">
        {/* File preview */}
        <section>
          <label className="block text-xs font-medium text-text-muted mb-2">File</label>
          {item.storagePath ? (
            <div className="rounded-lg border border-border overflow-hidden">
              {kind === 'image' && fileUrl && (
                <img src={fileUrl} alt={item.title} className="w-full max-h-52 object-contain bg-surface-2" />
              )}
              {kind === 'audio' && fileUrl && (
                <audio controls src={fileUrl} className="w-full" />
              )}
              {kind === 'video' && fileUrl && (
                <video controls src={fileUrl} className="w-full max-h-52 bg-black" />
              )}
              {kind === 'pdf' && fileUrl && (
                <iframe src={fileUrl} title={item.title} className="w-full h-52 bg-surface-2" />
              )}
              <div className="flex items-center justify-between gap-2 px-3 py-2 bg-surface-2">
                <div className="min-w-0">
                  <p className="text-xs text-text-main truncate">{item.fileName}</p>
                  <p className="text-[11px] text-text-subtle">{formatFileSize(item.size)}</p>
                </div>
                {fileUrl && (
                  <div className="flex items-center gap-1 flex-shrink-0">
                    <a
                      href={fileUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="flex items-center gap-1 text-xs font-medium text-primary hover:underline px-2 py-1.5 rounded"
                      title="Open in a new tab"
                    >
                      <ExternalLink size={14} /> Open
                    </a>
                    <a
                      href={fileUrl}
                      download={item.fileName ?? undefined}
                      className="text-text-subtle hover:text-primary p-1.5 rounded"
                      title="Download"
                    >
                      <Download size={15} />
                    </a>
                  </div>
                )}
              </div>
            </div>
          ) : (
            <p className="text-xs text-text-subtle italic">No file attached — this item is links only.</p>
          )}

          <div className="flex gap-2 mt-2">
            <label className="flex-1 cursor-pointer">
              <span className="flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg border border-border text-xs font-medium text-text-muted hover:bg-surface-2 transition-colors">
                <Upload size={14} />
                {item.storagePath ? 'Replace file' : 'Attach file'}
              </span>
              <input type="file" className="hidden" onChange={handleReplaceFile} disabled={busy} />
            </label>
            {item.storagePath && (
              <button
                onClick={() => removeItemFile(item.id)}
                className="px-3 py-2 rounded-lg border border-border text-xs text-text-muted hover:text-danger hover:border-danger transition-colors"
                title="Remove file, keep the info"
              >
                <Trash2 size={14} />
              </button>
            )}
          </div>
          {item.storagePath && (
            <p className="text-[11px] text-text-subtle mt-1.5">
              Replacing the file keeps the title, description and links below.
            </p>
          )}
        </section>

        {/* Metadata */}
        <section className="space-y-3">
          <div>
            <label className="block text-xs font-medium text-text-muted mb-1.5">Title</label>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full px-3 py-2 rounded-lg bg-surface-2 border border-border text-sm text-text-main focus:outline-none focus:border-primary"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-text-muted mb-1.5">Description</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={4}
              placeholder="What is this, and what is it for?"
              className="w-full px-3 py-2 rounded-lg bg-surface-2 border border-border text-sm text-text-main resize-y focus:outline-none focus:border-primary"
            />
          </div>
        </section>

        {/* Links */}
        <section>
          <div className="flex items-center justify-between mb-2">
            <label className="text-xs font-medium text-text-muted">Links</label>
            <button
              onClick={() => setLinks([...links, { label: '', url: '' }])}
              className="text-xs text-primary hover:underline flex items-center gap-1"
            >
              <Plus size={12} /> Add link
            </button>
          </div>

          {links.length === 0 && (
            <p className="text-xs text-text-subtle italic">
              e.g. the Google Docs URL for an uploaded contract.
            </p>
          )}

          <div className="space-y-2">
            {links.map((link, idx) => (
              <div key={link.id ?? idx} className="flex gap-1.5 items-start">
                <div className="flex-1 space-y-1.5">
                  <input
                    value={link.label}
                    onChange={(e) => {
                      const next = [...links]
                      next[idx] = { ...next[idx], label: e.target.value }
                      setLinks(next)
                    }}
                    placeholder="Label (e.g. Google Docs)"
                    className="w-full px-2.5 py-1.5 rounded-md bg-surface-2 border border-border text-xs text-text-main focus:outline-none focus:border-primary"
                  />
                  <input
                    value={link.url}
                    onChange={(e) => {
                      const next = [...links]
                      next[idx] = { ...next[idx], url: e.target.value }
                      setLinks(next)
                    }}
                    placeholder="https://..."
                    className="w-full px-2.5 py-1.5 rounded-md bg-surface-2 border border-border text-xs text-text-main focus:outline-none focus:border-primary"
                  />
                </div>
                <div className="flex flex-col gap-1 pt-0.5">
                  {link.url && (
                    <a
                      href={link.url}
                      target="_blank"
                      rel="noreferrer"
                      className="text-text-subtle hover:text-primary p-1 rounded"
                      title="Open"
                    >
                      <ExternalLink size={13} />
                    </a>
                  )}
                  <button
                    onClick={() => setLinks(links.filter((_, i) => i !== idx))}
                    className="text-text-subtle hover:text-danger p-1 rounded"
                    title="Remove"
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>

      <footer className="border-t border-border p-3 flex items-center gap-2 flex-shrink-0">
        <button
          onClick={handleSave}
          disabled={busy || !dirty}
          className="flex-1 px-3 py-2 rounded-lg bg-primary text-white text-sm font-medium disabled:opacity-40 hover:bg-primary/90 transition-colors"
        >
          {busy ? 'Saving…' : saved ? 'Saved' : 'Save changes'}
        </button>
        <button
          onClick={handleDelete}
          className="px-3 py-2 rounded-lg border border-border text-text-muted hover:text-danger hover:border-danger transition-colors"
          title="Delete item"
        >
          <Trash2 size={15} />
        </button>
      </footer>
    </aside>
  )
}
