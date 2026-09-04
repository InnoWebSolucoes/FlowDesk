import React, { useEffect, useMemo, useRef, useState } from 'react'
import {
  X, Upload, Trash2, ExternalLink, Plus, Download, History, Check, FolderOpen, Copy, Home,
  Shield, Users, UserCheck, Globe, UserCog, ChevronDown,
} from 'lucide-react'
import { format, parseISO } from 'date-fns'
import { ResourceItem, ResourceAccess } from '../../types'
import { useProjectStore } from '../../store/projectStore'
import { useEmployeeStore } from '../../store/employeeStore'
import { fileKind, FileKindIcon, formatFileSize } from './ResourceThumbnail'

const ACCESS_OPTIONS: {
  value: ResourceAccess
  label: string
  hint: string
  Icon: typeof Globe
}[] = [
  { value: 'everyone', label: 'Everyone', hint: 'Anyone working on this project', Icon: Globe },
  { value: 'employees', label: 'Employees', hint: 'Managers and staff on this project', Icon: Users },
  { value: 'managers', label: 'Managers only', hint: 'Nobody else can open it', Icon: UserCog },
  { value: 'specific', label: 'Specific people', hint: 'Choose exactly who, below', Icon: UserCheck },
]

/**
 * A section that stays folded until it is needed. Both lists below can run to
 * a dozen rows, which buried the fields underneath them.
 */
function Collapsible({
  icon,
  label,
  summary,
  defaultOpen = false,
  children,
}: {
  icon: React.ReactNode
  label: string
  summary: string
  defaultOpen?: boolean
  children: React.ReactNode
}) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <section className="border border-border rounded-lg overflow-hidden">
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center gap-2 px-3 py-2 hover:bg-surface-2 transition-colors text-left"
      >
        <span className="text-text-muted flex-shrink-0">{icon}</span>
        <span className="text-xs font-medium text-text-muted">{label}</span>
        <span className="text-[11px] text-text-subtle truncate flex-1 text-right">{summary}</span>
        <ChevronDown
          size={14}
          className={`text-text-subtle flex-shrink-0 transition-transform ${open ? 'rotate-180' : ''}`}
        />
      </button>
      {open && <div className="px-3 pb-3 pt-1 border-t border-border">{children}</div>}
    </section>
  )
}

interface Props {
  item: ResourceItem
  onClose: () => void
  /** Lets the canvas treat this panel as a drop target for dragged documents. */
  dropRef?: React.MutableRefObject<HTMLElement | null>
  /** True while a dragged document is held over the panel. */
  dropActive?: boolean
}

export function ResourceItemPanel({ item, onClose, dropRef, dropActive = false }: Props) {
  const {
    updateItem, removeItemFile, deleteItem, setItemLinks, getFileUrl,
    addItemVersion, makeVersionCurrent, deleteItemVersion,
    setItemClusters, duplicateItem, clusters, setItemAccess,
  } = useProjectStore()
  const employees = useEmployeeStore((s) => s.employees)

  const accessUsers = item.accessUserIds
  const projectPeople = useMemo(
    () => employees.filter((e) => e.projectId === item.projectId),
    [employees, item.projectId],
  )

  const [title, setTitle] = useState(item.title)
  const [description, setDescription] = useState(item.description)
  const [links, setLinks] = useState<{ id?: string; label: string; url: string }[]>(
    item.links.map((l) => ({ id: l.id, label: l.label, url: l.url }))
  )
  const panelRef = useRef<HTMLElement>(null)
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

  const projectClusters = useMemo(
    () => clusters.filter((c) => c.projectId === item.projectId),
    [clusters, item.projectId]
  )

  /**
   * Dismiss on a click outside the panel, or on Escape. Bound on pointerdown so
   * it fires before a canvas node's own click handler re-opens the panel.
   */
  useEffect(() => {
    const onPointerDown = (e: PointerEvent) => {
      const el = panelRef.current
      const target = e.target as Node
      if (!el || el.contains(target)) return
      // A file dialog or confirm() can steal focus mid-edit; only close for
      // clicks that land in the document itself.
      if (!document.contains(target)) return
      // Clicking another document swaps the panel over to it rather than
      // closing — the parent re-renders it with a new key.
      if (target instanceof Element && target.closest('[data-resource-item]')) return
      onClose()
    }

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }

    // Deferred a tick so the click that opened the panel doesn't close it.
    const id = setTimeout(() => {
      window.addEventListener('pointerdown', onPointerDown)
      window.addEventListener('keydown', onKey)
    }, 0)

    return () => {
      clearTimeout(id)
      window.removeEventListener('pointerdown', onPointerDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [onClose])

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
  /** Uploading archives the current file as a version rather than losing it. */
  const handleNewVersion = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setBusy(true)
    await addItemVersion(item.id, file)
    setBusy(false)
    e.target.value = ''
  }

  const handleDelete = async () => {
    if (!confirm(`Delete "${item.title}"? This cannot be undone.`)) return
    await deleteItem(item.id)
    onClose()
  }

  /**
   * Is this primarily a link? Having an address makes it one — attaching a PDF
   * to a link is adding a supporting document, not turning it into that PDF.
   * Only an item with no links at all is a plain document.
   *
   * Uses the saved links rather than the draft, so typing in the links editor
   * doesn't reorder the panel under the cursor.
   */
  const isLinkFirst = item.links.length > 0

  const linksSection = (
    <section>
      <div className="flex items-center justify-between mb-2">
        <label className="text-xs font-medium text-text-muted">{isLinkFirst ? 'Address' : 'Links'}</label>
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
  )

  const fileSection = (
    <section>
      <label className="block text-xs font-medium text-text-muted mb-2">File</label>
      {item.storagePath ? (
        <div className="rounded-lg border border-border overflow-hidden">
          {kind === 'image' && fileUrl && (
            <img src={fileUrl} alt={item.title} className="w-full max-h-52 object-contain bg-surface-2" />
          )}
          {kind === 'audio' && fileUrl && <audio controls src={fileUrl} className="w-full" />}
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
                  className="text-text-subtle hover:text-primary p-1.5 rounded"
                  title="Open"
                >
                  <ExternalLink size={14} />
                </a>
                <a
                  href={fileUrl}
                  download={item.fileName ?? undefined}
                  className="text-text-subtle hover:text-primary p-1.5 rounded"
                  title="Download"
                >
                  <Download size={14} />
                </a>
              </div>
            )}
          </div>
        </div>
      ) : (
        <p className="text-xs text-text-subtle italic">
          No file attached, this is a link. You can attach one if you want the document here too.
        </p>
      )}

      <div className="flex gap-2 mt-2">
        <label className="flex-1 cursor-pointer">
          <span className="flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg border border-border text-xs font-medium text-text-muted hover:bg-surface-2 transition-colors">
            <Upload size={14} />
            {item.storagePath ? 'Upload new version' : 'Attach file'}
          </span>
          <input type="file" className="hidden" onChange={handleNewVersion} disabled={busy} />
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
          The current file is archived below, and the title, description and links are kept.
        </p>
      )}
    </section>
  )

  return (
    <aside
      ref={(el) => {
        panelRef.current = el
        if (dropRef) dropRef.current = el
      }}
      className={`absolute top-0 right-0 h-full w-full sm:w-[380px] bg-surface border-l shadow-xl flex flex-col z-30 transition-colors ${
        dropActive ? 'border-primary ring-2 ring-primary/40' : 'border-border'
      }`}
    >
      {dropActive && (
        <div className="absolute inset-0 z-10 bg-primary/5 flex items-center justify-center pointer-events-none">
          <span className="px-3 py-1.5 rounded-lg bg-primary text-white text-xs font-medium shadow">
            Drop to add as the newest version
          </span>
        </div>
      )}
      <header className="flex items-center justify-between px-4 py-3 border-b border-border flex-shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          {/* null mime resolves to the link icon, matching the canvas node. */}
          <FileKindIcon mime={isLinkFirst ? null : item.mimeType} />
          <span className="text-text-main font-medium text-sm truncate">{item.title}</span>
        </div>
        <button onClick={onClose} className="text-text-subtle hover:text-text-main p-1 rounded flex-shrink-0">
          <X size={18} />
        </button>
      </header>

      <div className="flex-1 overflow-y-auto p-4 space-y-5">
        {/* A link-only item leads with its links; for a file item the links
            stay below, where they read as extra references. */}
        {isLinkFirst && linksSection}

        {/* File box: last for a link item, first for a document. */}
        {!isLinkFirst && fileSection}

        {/* Version history */}
        {item.versions.length > 0 && (
          <section>
            <label className="flex items-center gap-1.5 text-xs font-medium text-text-muted mb-2">
              <History size={13} /> Previous versions ({item.versions.length})
            </label>
            <div className="space-y-1.5">
              {item.versions.map((v) => (
                <div
                  key={v.id}
                  className="flex items-center gap-2 px-2.5 py-2 rounded-lg border border-border bg-surface-2"
                >
                  <span className="text-text-muted flex-shrink-0">
                    <FileKindIcon mime={v.mimeType} fileName={v.fileName} size={14} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-[11px] text-text-main truncate">{v.fileName}</p>
                    <p className="text-[10px] text-text-subtle">
                      {format(parseISO(v.createdAt), 'd MMM yyyy, HH:mm')} · {formatFileSize(v.size)}
                    </p>
                  </div>
                  <VersionActions
                    onOpen={async () => {
                      const url = await getFileUrl(v.storagePath)
                      if (url) window.open(url, '_blank', 'noopener,noreferrer')
                    }}
                    onRestore={() => makeVersionCurrent(item.id, v.id)}
                    onDelete={() => {
                      if (confirm(`Delete version "${v.fileName}"? This cannot be undone.`)) {
                        deleteItemVersion(item.id, v.id)
                      }
                    }}
                  />
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Who can see it */}
        <Collapsible
          icon={<Shield size={13} />}
          label="Who can see this"
          summary={
            item.access === 'specific'
              ? `${accessUsers.length} person${accessUsers.length === 1 ? '' : 's'}`
              : ACCESS_OPTIONS.find((o) => o.value === item.access)?.label ?? 'Everyone'
          }
        >
          <div className="space-y-1">
            {ACCESS_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                onClick={() => setItemAccess(item.id, opt.value, accessUsers)}
                className={`w-full flex items-start gap-2 p-2 rounded-lg border text-left transition-colors ${
                  item.access === opt.value
                    ? 'border-primary bg-primary-light'
                    : 'border-border hover:bg-surface-2'
                }`}
              >
                <opt.Icon size={13} className="mt-0.5 flex-shrink-0" />
                <span className="min-w-0">
                  <span className="block text-xs text-text-main">{opt.label}</span>
                  <span className="block text-[11px] text-text-subtle">{opt.hint}</span>
                </span>
              </button>
            ))}
          </div>

          {item.access === 'specific' && (
            <div className="mt-2 border border-border rounded-lg p-2 space-y-1 max-h-48 overflow-y-auto">
              {projectPeople.length === 0 ? (
                <p className="text-[11px] text-text-subtle italic px-1">
                  Nobody is assigned to this project yet.
                </p>
              ) : (
                projectPeople.map((person) => {
                  const checked = accessUsers.includes(person.id)
                  return (
                    <label
                      key={person.id}
                      className="flex items-center gap-2 px-1 py-1 rounded hover:bg-surface-2 cursor-pointer"
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => {
                          const next = checked
                            ? accessUsers.filter((id) => id !== person.id)
                            : [...accessUsers, person.id]
                          setItemAccess(item.id, 'specific', next)
                        }}
                        className="w-3.5 h-3.5 accent-primary"
                      />
                      <span className="text-xs text-text-main truncate flex-1">{person.name}</span>
                      <span className="text-[10px] text-text-subtle">{person.jobTitle}</span>
                    </label>
                  )
                })
              )}
            </div>
          )}

          <p className="text-[11px] text-text-subtle mt-1.5">
            Managers always have access, so a document can never be locked away
            from the people responsible for it.
          </p>
        </Collapsible>

        {/* Cluster tags */}
        <Collapsible
          icon={<FolderOpen size={13} />}
          label="Appears in"
          summary={`${item.clusterIds.length + (item.showAtTopLevel ? 1 : 0)} place${
            item.clusterIds.length + (item.showAtTopLevel ? 1 : 0) === 1 ? '' : 's'
          }`}
        >
          <p className="text-[11px] text-text-subtle mb-2">
            One document, shown everywhere you tick. It isn't copied.
          </p>
          <div className="space-y-1 max-h-44 overflow-y-auto">
            {/* The main space is a destination in its own right, so a document
                can sit at the top level and inside clusters at the same time. */}
            <label className="flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-surface-2 cursor-pointer">
              <input
                type="checkbox"
                checked={item.showAtTopLevel}
                onChange={() => updateItem(item.id, { showAtTopLevel: !item.showAtTopLevel })}
                className="accent-primary"
              />
              <Home size={12} className="text-text-muted flex-shrink-0" />
              <span className="text-xs text-text-main truncate flex-1">Space</span>
            </label>

            {projectClusters.length === 0 && (
              <p className="text-xs text-text-subtle italic">No clusters in this project yet.</p>
            )}
            {projectClusters.map((c) => {
              const checked = item.clusterIds.includes(c.id)
              return (
                <label
                  key={c.id}
                  className="flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-surface-2 cursor-pointer"
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() =>
                      setItemClusters(
                        item.id,
                        checked
                          ? item.clusterIds.filter((id) => id !== c.id)
                          : [...item.clusterIds, c.id]
                      )
                    }
                    className="accent-primary"
                  />
                  <span
                    className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                    style={{ backgroundColor: c.color }}
                  />
                  <span className="text-xs text-text-main truncate flex-1">{c.title}</span>
                  {c.id === item.clusterId && (
                    <span className="text-[10px] text-text-subtle">home</span>
                  )}
                </label>
              )
            })}
          </div>
        </Collapsible>

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

        {/* For a file item the links sit at the bottom, as extra references;
            for a link item that is where the optional file box goes instead. */}
        {isLinkFirst ? fileSection : linksSection}
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
          onClick={() => duplicateItem(item.id)}
          className="px-3 py-2 rounded-lg border border-border text-text-muted hover:text-primary hover:border-primary transition-colors"
          title="Duplicate, a real copy, separate from this one"
        >
          <Copy size={15} />
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

/** Open / restore / delete for one archived version. */
function VersionActions({
  onOpen,
  onRestore,
  onDelete,
}: {
  onOpen: () => void
  onRestore: () => void
  onDelete: () => void
}) {
  return (
    <div className="flex items-center gap-0.5 flex-shrink-0">
      <button onClick={onOpen} className="text-text-subtle hover:text-primary p-1 rounded" title="Open this version">
        <ExternalLink size={12} />
      </button>
      <button
        onClick={onRestore}
        className="text-text-subtle hover:text-success p-1 rounded"
        title="Make this the current version"
      >
        <Check size={13} />
      </button>
      <button onClick={onDelete} className="text-text-subtle hover:text-danger p-1 rounded" title="Delete this version">
        <Trash2 size={12} />
      </button>
    </div>
  )
}
