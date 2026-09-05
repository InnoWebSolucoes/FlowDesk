import React, { useMemo, useState } from 'react'
import {
  X, Trash2, Link2, FolderOpen, ExternalLink, Lock, Users as UsersIcon, Globe, Check,
} from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import {
  CalendarEntry, ProjectTodo, Visibility, CalendarEntryKind, Priority,
} from '../../types'
import { useProjectStore } from '../../store/projectStore'
import { FileKindIcon } from '../resources/ResourceThumbnail'
import { ResourceLinkPicker, LinkKey } from '../shared/ResourceLinkPicker'
import { KIND_STYLE } from './calendarShared'

const VISIBILITY: { value: Visibility | ''; label: string; Icon: typeof Lock }[] = [
  { value: '', label: 'Default for my role', Icon: UsersIcon },
  { value: 'private', label: 'Private, only me', Icon: Lock },
  { value: 'team', label: 'Team, everyone on this project', Icon: UsersIcon },
  { value: 'everyone', label: 'Everyone in the company', Icon: Globe },
]

/**
 * The detail view for anything on the calendar. Todos and entries differ
 * enough in their fields to keep separate bodies, but they share the shell,
 * the linked-documents section and the cross-navigation to the other tab.
 */
export function CalendarItemPanel({
  todo,
  entry,
  projectId,
  onClose,
  basePath,
}: {
  todo?: ProjectTodo
  entry?: CalendarEntry
  projectId: string
  onClose: () => void
  /**
   * Where this side of the app lives. The panel links out to Resources and
   * Todos, which sit at different paths for an admin and an employee.
   */
  basePath?: string
}) {
  const {
    updateTodo, deleteTodo, setTodoLinks,
    updateCalendarEntry, deleteCalendarEntry, setCalendarEntryLinks,
    items, clusters,
  } = useProjectStore()
  const navigate = useNavigate()
  const [picking, setPicking] = useState(false)

  const root = basePath ?? `/admin/projects/${projectId}`

  const links = todo?.links ?? entry?.links ?? []

  const linked = useMemo(
    () =>
      links.map((l) => ({
        raw: l,
        item: l.itemId ? items.find((i) => i.id === l.itemId) : undefined,
        cluster: l.clusterId ? clusters.find((c) => c.id === l.clusterId) : undefined,
      })),
    [links, items, clusters],
  )

  const goToResource = (itemId?: string | null, clusterId?: string | null) => {
    // The resources tab reads these to open the right place and select it.
    const params = new URLSearchParams()
    if (itemId) params.set('item', itemId)
    if (clusterId) params.set('cluster', clusterId)
    navigate(`${root}/resources?${params.toString()}`)
  }

  const saveLinks = async (picked: LinkKey[]) => {
    if (todo) await setTodoLinks(todo.id, picked)
    else if (entry) await setCalendarEntryLinks(entry.id, picked)
    setPicking(false)
  }

  return (
    <>
      <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={onClose}>
        <div
          className="bg-surface rounded-xl border border-border w-full max-w-md flex flex-col max-h-[85vh]"
          onClick={(e) => e.stopPropagation()}
        >
          <header className="flex items-start justify-between gap-3 px-5 py-4 border-b border-border flex-shrink-0">
            <div className="min-w-0">
              {todo ? (
                <input
                  value={todo.title}
                  onChange={(e) => updateTodo(todo.id, { title: e.target.value })}
                  className="w-full bg-transparent text-text-main font-semibold text-base outline-none focus:bg-surface-2 rounded px-1 -ml-1"
                />
              ) : (
                <input
                  value={entry!.title}
                  onChange={(e) => updateCalendarEntry(entry!.id, { title: e.target.value })}
                  className="w-full bg-transparent text-text-main font-semibold text-base outline-none focus:bg-surface-2 rounded px-1 -ml-1"
                />
              )}
              <p className="text-text-subtle text-xs mt-0.5">
                {todo ? 'Todo' : KIND_STYLE[entry!.kind].label}
              </p>
            </div>
            <button onClick={onClose} className="text-text-subtle hover:text-text-main p-1 flex-shrink-0">
              <X size={18} />
            </button>
          </header>

          <div className="flex-1 overflow-y-auto p-5 space-y-4">
            {todo ? <TodoBody todo={todo} /> : <EntryBody entry={entry!} />}

            <section>
              <div className="flex items-center justify-between mb-2">
                <label className="text-xs font-medium text-text-muted">Linked documents</label>
                <button
                  onClick={() => setPicking(true)}
                  className="text-xs text-primary hover:underline flex items-center gap-1"
                >
                  <Link2 size={12} /> {links.length > 0 ? 'Edit links' : 'Add links'}
                </button>
              </div>

              {linked.length === 0 && (
                <p className="text-xs text-text-subtle italic">
                  Nothing linked. Attach the contract, brief or folder this relates to.
                </p>
              )}

              <div className="space-y-1">
                {linked.map(({ raw, item, cluster }) => (
                  <button
                    key={raw.id}
                    onClick={() => goToResource(item?.id, cluster?.id)}
                    className="w-full flex items-center gap-2 p-2 rounded-lg bg-surface-2 hover:bg-border text-left transition-colors group"
                    title="Open in the resources tab"
                  >
                    {cluster ? (
                      <FolderOpen size={14} style={{ color: cluster.color }} className="flex-shrink-0" />
                    ) : (
                      <span className="text-text-muted flex-shrink-0">
                        <FileKindIcon mime={item?.links.length ? null : item?.mimeType ?? null} size={14} />
                      </span>
                    )}
                    <span className="text-xs text-text-main truncate flex-1">
                      {cluster?.title ?? item?.title ?? 'Missing document'}
                    </span>
                    <ExternalLink size={12} className="text-text-subtle opacity-0 group-hover:opacity-100 flex-shrink-0" />
                  </button>
                ))}
              </div>
            </section>
          </div>

          <footer className="px-5 py-3 border-t border-border flex items-center gap-2 flex-shrink-0">
            {todo && (
              <button
                onClick={() => navigate(`${root}/todos`)}
                className="text-xs text-primary hover:underline flex-1 text-left"
              >
                Open in Todos →
              </button>
            )}
            {entry && <span className="flex-1" />}
            <button
              onClick={() => {
                const label = todo?.title ?? entry?.title
                if (!confirm(`Delete "${label}"? This cannot be undone.`)) return
                if (todo) deleteTodo(todo.id)
                else deleteCalendarEntry(entry!.id)
                onClose()
              }}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs text-danger hover:bg-danger-bg"
            >
              <Trash2 size={13} /> Delete
            </button>
          </footer>
        </div>
      </div>

      {picking && (
        <ResourceLinkPicker
          projectId={projectId}
          subtitle={todo?.title ?? entry?.title}
          initial={links.map((l) => (l.itemId ? { itemId: l.itemId } : { clusterId: l.clusterId! }))}
          onClose={() => setPicking(false)}
          onSave={saveLinks}
        />
      )}
    </>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs font-medium text-text-muted mb-1">{label}</label>
      {children}
    </div>
  )
}

const inputClass =
  'w-full px-3 py-2 rounded-lg bg-surface-2 border border-border text-sm text-text-main focus:outline-none focus:border-primary'

function TodoBody({ todo }: { todo: ProjectTodo }) {
  const { updateTodo, toggleTodo, todoLists } = useProjectStore()

  return (
    <>
      <button
        onClick={() => toggleTodo(todo.id)}
        className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm w-full transition-colors ${
          todo.isCompleted
            ? 'bg-success-bg text-success'
            : 'bg-surface-2 text-text-muted hover:bg-border'
        }`}
      >
        <Check size={14} />
        {todo.isCompleted ? 'Completed' : 'Mark as done'}
      </button>

      <Field label="Description">
        <textarea
          value={todo.notes}
          onChange={(e) => updateTodo(todo.id, { notes: e.target.value })}
          rows={4}
          placeholder="What is this, and what does done look like?"
          className={`${inputClass} resize-y`}
        />
      </Field>

      <div className="grid grid-cols-2 gap-3">
        <Field label="Do date, when you'll work on it">
          <input
            type="date"
            value={todo.doDate ?? ''}
            onChange={(e) => updateTodo(todo.id, { doDate: e.target.value || null })}
            className={inputClass}
          />
        </Field>
        <Field label="Deadline">
          <input
            type="date"
            value={todo.dueDate ?? ''}
            onChange={(e) => updateTodo(todo.id, { dueDate: e.target.value || null })}
            className={inputClass}
          />
        </Field>
      </div>

      {todo.doDate && (
        <div className="grid grid-cols-2 gap-3">
          <Field label="Start time">
            <input
              type="time"
              value={todo.doStart ?? ''}
              onChange={(e) => updateTodo(todo.id, { doStart: e.target.value || null })}
              className={inputClass}
            />
          </Field>
          <Field label="End time">
            <input
              type="time"
              value={todo.doEnd ?? ''}
              onChange={(e) => updateTodo(todo.id, { doEnd: e.target.value || null })}
              className={inputClass}
            />
          </Field>
        </div>
      )}

      {todo.dueDate && todo.doDate && todo.doDate > todo.dueDate && (
        <p className="text-[11px] text-danger">
          The do date is after the deadline, you would finish it late.
        </p>
      )}

      <div className="grid grid-cols-2 gap-3">
        <Field label="Priority">
          <select
            value={todo.priority}
            onChange={(e) => updateTodo(todo.id, { priority: e.target.value as Priority })}
            className={inputClass}
          >
            <option value="high">High</option>
            <option value="medium">Medium</option>
            <option value="low">Low</option>
          </select>
        </Field>
        <Field label="List">
          <select
            value={todo.listId ?? ''}
            onChange={(e) => useProjectStore.getState().moveTodoToList(todo.id, e.target.value)}
            className={inputClass}
          >
            {todoLists.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
        </Field>
      </div>
    </>
  )
}

function EntryBody({ entry }: { entry: CalendarEntry }) {
  const { updateCalendarEntry } = useProjectStore()
  const start = new Date(entry.startsAt)
  const end = new Date(entry.endsAt)
  const pad = (n: number) => String(n).padStart(2, '0')
  const dateVal = `${start.getFullYear()}-${pad(start.getMonth() + 1)}-${pad(start.getDate())}`
  const timeVal = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}`

  const reschedule = (day: string, from: string, to: string) => {
    const s = new Date(`${day}T${from}`)
    const e = new Date(`${day}T${to}`)
    if (e <= s) return
    updateCalendarEntry(entry.id, { startsAt: s.toISOString(), endsAt: e.toISOString() })
  }

  return (
    <>
      <Field label="Type">
        <div className="grid grid-cols-4 gap-1.5">
          {(Object.keys(KIND_STYLE) as CalendarEntryKind[]).map((k) => (
            <button
              key={k}
              onClick={() => updateCalendarEntry(entry.id, { kind: k })}
              className="px-2 py-1.5 rounded-lg text-xs font-medium border transition-colors"
              style={
                entry.kind === k
                  ? {
                      backgroundColor: `${KIND_STYLE[k].color}1a`,
                      color: KIND_STYLE[k].color,
                      borderColor: KIND_STYLE[k].color,
                    }
                  : { borderColor: '#e5e7eb', color: '#6b7280' }
              }
            >
              {KIND_STYLE[k].label}
            </button>
          ))}
        </div>
      </Field>

      <Field label="Notes">
        <textarea
          value={entry.notes}
          onChange={(e) => updateCalendarEntry(entry.id, { notes: e.target.value })}
          rows={3}
          placeholder="Agenda, location, anything useful."
          className={`${inputClass} resize-y`}
        />
      </Field>

      <Field label="Day">
        <input
          type="date"
          value={dateVal}
          onChange={(e) => e.target.value && reschedule(e.target.value, timeVal(start), timeVal(end))}
          className={inputClass}
        />
      </Field>

      {!entry.allDay && (
        <div className="grid grid-cols-2 gap-3">
          <Field label="From">
            <input
              type="time"
              value={timeVal(start)}
              onChange={(e) => e.target.value && reschedule(dateVal, e.target.value, timeVal(end))}
              className={inputClass}
            />
          </Field>
          <Field label="To">
            <input
              type="time"
              value={timeVal(end)}
              onChange={(e) => e.target.value && reschedule(dateVal, timeVal(start), e.target.value)}
              className={inputClass}
            />
          </Field>
        </div>
      )}

      <label className="flex items-center gap-2 text-xs text-text-muted">
        <input
          type="checkbox"
          checked={entry.allDay}
          onChange={(e) => updateCalendarEntry(entry.id, { allDay: e.target.checked })}
          className="w-4 h-4 accent-primary"
        />
        All day
      </label>

      <Field label="Who can see it">
        <select
          value={entry.visibility ?? ''}
          onChange={(e) => updateCalendarEntry(entry.id, { visibility: (e.target.value || null) as Visibility | null })}
          className={inputClass}
        >
          {VISIBILITY.map((v) => (
            <option key={v.value} value={v.value}>
              {v.label}
            </option>
          ))}
        </select>
      </Field>
    </>
  )
}
