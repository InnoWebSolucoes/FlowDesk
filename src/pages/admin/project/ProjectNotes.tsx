import React, { useEffect, useMemo, useRef, useState } from 'react'
import { useOutletContext } from 'react-router-dom'
import {
  Pin, PinOff, Trash2, Archive, ArchiveRestore, CheckSquare, Palette, X, Plus, Search,
} from 'lucide-react'
import { Project, ProjectNote } from '../../../types'
import { useProjectStore } from '../../../store/projectStore'

interface Ctx { project: Project }

/** Keep's palette, muted to sit inside FlowDesk's own surfaces. */
const COLORS = [
  { name: 'Yellow', value: '#fef3c7' },
  { name: 'Green', value: '#d1fae5' },
  { name: 'Blue', value: '#dbeafe' },
  { name: 'Purple', value: '#ede9fe' },
  { name: 'Pink', value: '#fce7f3' },
  { name: 'Orange', value: '#ffedd5' },
  { name: 'Grey', value: '#e5e7eb' },
]

export function ProjectNotes() {
  const { project } = useOutletContext<Ctx>()
  const { notes, notesLoadedFor, loadNotes, createNote } = useProjectStore()
  const [query, setQuery] = useState('')
  const [showArchived, setShowArchived] = useState(false)

  useEffect(() => {
    if (notesLoadedFor !== project.id) loadNotes(project.id)
  }, [project.id, notesLoadedFor, loadNotes])

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    return notes
      .filter((n) => n.projectId === project.id)
      .filter((n) => n.isArchived === showArchived)
      .filter((n) =>
        !q ||
        n.title.toLowerCase().includes(q) ||
        n.body.toLowerCase().includes(q) ||
        n.items.some((i) => i.text.toLowerCase().includes(q))
      )
      // Pinned first, then the board's own order.
      .sort((a, b) =>
        a.isPinned === b.isPinned ? a.sortOrder - b.sortOrder : a.isPinned ? -1 : 1
      )
  }, [notes, project.id, query, showArchived])

  const pinned = visible.filter((n) => n.isPinned)
  const others = visible.filter((n) => !n.isPinned)

  return (
    <div className="space-y-5">
      {/* Compose + search */}
      <div className="flex flex-wrap items-center gap-3">
        <NewNote projectId={project.id} onCreate={createNote} />
        <div className="relative flex-1 min-w-[12rem] max-w-xs">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-subtle" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search notes"
            className="w-full pl-9 pr-3 py-2 rounded-lg bg-surface-2 border border-border text-sm text-text-main focus:outline-none focus:border-primary"
          />
        </div>
        <button
          onClick={() => setShowArchived((v) => !v)}
          className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm border transition-colors ${
            showArchived
              ? 'bg-primary text-white border-primary'
              : 'bg-surface-2 border-border text-text-muted hover:text-text-main'
          }`}
        >
          <Archive size={14} />
          {showArchived ? 'Archived' : 'Archive'}
        </button>
      </div>

      {visible.length === 0 && (
        <div className="text-center py-16">
          <p className="text-text-muted text-sm">
            {showArchived
              ? 'Nothing archived.'
              : query
                ? 'No notes match that search.'
                : 'No notes yet, write the first one above.'}
          </p>
        </div>
      )}

      {pinned.length > 0 && (
        <section>
          <h3 className="text-[11px] font-semibold uppercase tracking-wide text-text-subtle mb-2">
            Pinned
          </h3>
          <NoteGrid notes={pinned} />
        </section>
      )}

      {others.length > 0 && (
        <section>
          {pinned.length > 0 && (
            <h3 className="text-[11px] font-semibold uppercase tracking-wide text-text-subtle mb-2">
              Others
            </h3>
          )}
          <NoteGrid notes={others} />
        </section>
      )}
    </div>
  )
}

/** Masonry-ish columns, so notes of different heights pack without gaps. */
function NoteGrid({ notes }: { notes: ProjectNote[] }) {
  return (
    <div className="columns-1 sm:columns-2 lg:columns-3 xl:columns-4 gap-3 [column-fill:_balance]">
      {notes.map((note) => (
        <div key={note.id} className="break-inside-avoid mb-3">
          <NoteCard note={note} />
        </div>
      ))}
    </div>
  )
}

/** The collapsed "Take a note…" box that expands into a full editor. */
function NewNote({
  projectId,
  onCreate,
}: {
  projectId: string
  onCreate: (projectId: string, input?: Partial<ProjectNote>) => Promise<ProjectNote | null>
}) {
  const [open, setOpen] = useState(false)
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [color, setColor] = useState(COLORS[0].value)
  const bodyRef = useRef<HTMLTextAreaElement>(null)

  const close = async () => {
    // An empty note is a no-op rather than a blank card on the board.
    if (title.trim() || body.trim()) {
      await onCreate(projectId, { title: title.trim(), body: body.trim(), color })
    }
    setTitle('')
    setBody('')
    setColor(COLORS[0].value)
    setOpen(false)
  }

  if (!open) {
    return (
      <button
        onClick={() => {
          setOpen(true)
          setTimeout(() => bodyRef.current?.focus(), 0)
        }}
        className="flex items-center gap-2 px-4 py-2 rounded-lg bg-surface-2 border border-border text-sm text-text-muted hover:text-text-main hover:border-primary/40 transition-colors"
      >
        <Plus size={15} />
        Take a note…
      </button>
    )
  }

  return (
    <div
      className="w-full rounded-xl border border-border p-3 shadow-sm"
      style={{ backgroundColor: color }}
    >
      <input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="Title"
        className="w-full bg-transparent text-sm font-semibold text-zinc-900 placeholder-zinc-500 focus:outline-none mb-1.5"
      />
      <textarea
        ref={bodyRef}
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder="Take a note…"
        rows={3}
        // Ctrl+Enter saves, matching the rest of the app's quick-entry boxes.
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) close()
          if (e.key === 'Escape') close()
        }}
        className="w-full bg-transparent text-sm text-zinc-800 placeholder-zinc-500 focus:outline-none resize-y"
      />
      <div className="flex items-center justify-between mt-2">
        <ColorPicker value={color} onChange={setColor} />
        <button
          onClick={close}
          className="px-3 py-1 rounded-md text-xs font-medium text-zinc-700 hover:bg-black/10 transition-colors"
        >
          Done
        </button>
      </div>
    </div>
  )
}

function ColorPicker({ value, onChange }: { value: string; onChange: (c: string) => void }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        title="Colour"
        className="p-1.5 rounded-md text-zinc-600 hover:bg-black/10 transition-colors"
      >
        <Palette size={15} />
      </button>
      {open && (
        <div className="absolute left-0 bottom-full mb-1 z-20 flex gap-1 p-1.5 rounded-lg bg-surface border border-border shadow-lg">
          {COLORS.map((c) => (
            <button
              key={c.value}
              title={c.name}
              onClick={() => {
                onChange(c.value)
                setOpen(false)
              }}
              className={`w-5 h-5 rounded-full border transition-transform hover:scale-110 ${
                value === c.value ? 'border-zinc-900' : 'border-black/15'
              }`}
              style={{ backgroundColor: c.value }}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function NoteCard({ note }: { note: ProjectNote }) {
  const { updateNote, deleteNote, setNoteItems, toggleNoteItem } = useProjectStore()
  const [editing, setEditing] = useState(false)
  const [title, setTitle] = useState(note.title)
  const [body, setBody] = useState(note.body)

  // Keep the draft in step when the note changes underneath (another manager,
  // or the checklist conversion below).
  useEffect(() => {
    if (!editing) {
      setTitle(note.title)
      setBody(note.body)
    }
  }, [note.title, note.body, editing])

  const commit = () => {
    setEditing(false)
    const patch: Partial<ProjectNote> = {}
    if (title !== note.title) patch.title = title
    if (body !== note.body) patch.body = body
    if (Object.keys(patch).length) updateNote(note.id, patch)
  }

  const isChecklist = note.items.length > 0

  /** Turns the body's lines into checklist items, and back again. */
  const toggleChecklist = () => {
    if (isChecklist) {
      const text = note.items.map((i) => (i.isChecked ? `✓ ${i.text}` : i.text)).join('\n')
      setNoteItems(note.id, [])
      updateNote(note.id, { body: [note.body, text].filter(Boolean).join('\n') })
    } else {
      const lines = body.split('\n').map((l) => l.trim()).filter(Boolean)
      if (!lines.length) return
      setNoteItems(note.id, lines.map((text) => ({ text, isChecked: false })))
      updateNote(note.id, { body: '' })
    }
  }

  return (
    <div
      className="group rounded-xl border border-black/10 p-3 shadow-sm hover:shadow-md transition-shadow"
      style={{ backgroundColor: note.color }}
    >
      {editing ? (
        <>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Title"
            className="w-full bg-transparent text-sm font-semibold text-zinc-900 placeholder-zinc-500 focus:outline-none mb-1"
          />
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={Math.max(3, body.split('\n').length)}
            autoFocus
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) commit()
              if (e.key === 'Escape') {
                setTitle(note.title)
                setBody(note.body)
                setEditing(false)
              }
            }}
            className="w-full bg-transparent text-sm text-zinc-800 focus:outline-none resize-y"
          />
          <button
            onClick={commit}
            className="mt-1 px-3 py-1 rounded-md text-xs font-medium text-zinc-700 hover:bg-black/10 transition-colors"
          >
            Done
          </button>
        </>
      ) : (
        <div onClick={() => !isChecklist && setEditing(true)} className={isChecklist ? '' : 'cursor-text'}>
          {note.title && (
            <h4 className="text-sm font-semibold text-zinc-900 mb-1 break-words">{note.title}</h4>
          )}

          {isChecklist ? (
            <ul className="space-y-1">
              {note.items.map((item) => (
                <li key={item.id} className="flex items-start gap-2">
                  <input
                    type="checkbox"
                    checked={item.isChecked}
                    onChange={() => toggleNoteItem(note.id, item.id)}
                    className="mt-0.5 accent-zinc-700 cursor-pointer"
                  />
                  <span
                    className={`text-sm break-words ${
                      item.isChecked ? 'line-through text-zinc-500' : 'text-zinc-800'
                    }`}
                  >
                    {item.text}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            note.body && (
              <p className="text-sm text-zinc-800 whitespace-pre-wrap break-words">{note.body}</p>
            )
          )}

          {!note.title && !note.body && !isChecklist && (
            <p className="text-sm text-zinc-500 italic">Empty note</p>
          )}
        </div>
      )}

      {/* Actions appear on hover, as in Keep, so the board stays calm. */}
      <div className="flex items-center gap-0.5 mt-2 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
        <IconBtn
          title={note.isPinned ? 'Unpin' : 'Pin'}
          onClick={() => updateNote(note.id, { isPinned: !note.isPinned })}
        >
          {note.isPinned ? <PinOff size={14} /> : <Pin size={14} />}
        </IconBtn>

        <IconBtn title={isChecklist ? 'Convert to text' : 'Convert to checklist'} onClick={toggleChecklist}>
          <CheckSquare size={14} />
        </IconBtn>

        <ColorPicker value={note.color} onChange={(c) => updateNote(note.id, { color: c })} />

        <IconBtn
          title={note.isArchived ? 'Restore' : 'Archive'}
          onClick={() => updateNote(note.id, { isArchived: !note.isArchived })}
        >
          {note.isArchived ? <ArchiveRestore size={14} /> : <Archive size={14} />}
        </IconBtn>

        <IconBtn
          title="Delete"
          danger
          onClick={() => {
            if (confirm('Delete this note? This cannot be undone.')) deleteNote(note.id)
          }}
        >
          <Trash2 size={14} />
        </IconBtn>
      </div>
    </div>
  )
}

function IconBtn({
  children,
  title,
  onClick,
  danger,
}: {
  children: React.ReactNode
  title: string
  onClick: () => void
  danger?: boolean
}) {
  return (
    <button
      title={title}
      onClick={(e) => {
        e.stopPropagation()
        onClick()
      }}
      className={`p-1.5 rounded-md transition-colors ${
        danger ? 'text-zinc-600 hover:bg-red-500/20 hover:text-red-700' : 'text-zinc-600 hover:bg-black/10'
      }`}
    >
      {children}
    </button>
  )
}
