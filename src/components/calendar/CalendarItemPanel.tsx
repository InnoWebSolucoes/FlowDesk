import React, { useEffect, useMemo, useState } from 'react'
import {
  X, Link2, FolderOpen, ExternalLink, Lock, Users as UsersIcon, Globe, Check, Pencil,
} from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import {
  CalendarEntry, ProjectTodo, Visibility, CalendarEntryKind, Priority,
} from '../../types'
import { useProjectStore } from '../../store/projectStore'
import { FileKindIcon } from '../resources/ResourceThumbnail'
import { ResourceLinkPicker, LinkKey } from '../shared/ResourceLinkPicker'
import { KIND_STYLE } from './calendarShared'
import { useT } from '../../i18n/useT'
import { useEmployeeStore } from '../../store/employeeStore'
import { useTaskStore } from '../../store/taskStore'
import { useAuthStore } from '../../store/authStore'
import { format } from 'date-fns'

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
  readOnly = false,
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
  /**
   * Reading somebody else's item. Every field still shows what it says — the
   * point is to see their week as they see it — but nothing here writes.
   */
  readOnly?: boolean
}) {
  const { t } = useT()
  const {
    updateTodo, deleteTodo, setTodoLinks,
    updateCalendarEntry, deleteCalendarEntry, setCalendarEntryLinks,
    items, clusters,
  } = useProjectStore()
  const navigate = useNavigate()
  const [picking, setPicking] = useState(false)
  // Reading unless asked otherwise. Opening an item to check what it says
  // should not put a cursor in every field.
  const [editing, setEditing] = useState(false)

  const title = todo?.title ?? entry?.title ?? ''

  // The title being typed, held here until it is committed. Writing the store
  // on every keystroke waited for the network before the box showed the
  // letter, so letters landed out of order or vanished, and every write
  // re-rendered the whole calendar behind the panel, which was the flicker.
  const [titleDraft, setTitleDraft] = useState(title)
  useEffect(() => {
    if (!editing) setTitleDraft(title)
  }, [title, editing])

  const commitTitle = () => {
    const next = titleDraft.trim()
    if (!next) {
      setTitleDraft(title)
      return
    }
    if (next === title) return
    if (todo) updateTodo(todo.id, { title: next })
    else if (entry) updateCalendarEntry(entry.id, { title: next })
  }

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
          className="bg-surface rounded-xl border border-border w-full max-w-xl flex flex-col max-h-[85vh]"
          onClick={(e) => e.stopPropagation()}
        >
          <header className="flex items-start gap-3 px-5 py-4 border-b border-border flex-shrink-0">
            {/* flex-1 as well as min-w-0. min-w-0 only lets it shrink; without
                something telling it to grow, the title was squeezed into
                whatever the close button left over and wrapped down the left
                edge of a mostly empty header. */}
            <div className="min-w-0 flex-1">
              {editing ? (
                <textarea
                  value={titleDraft}
                  autoFocus
                  onChange={(e) => setTitleDraft(e.target.value)}
                  onBlur={commitTitle}
                  onKeyDown={(e) => {
                    // A title is one line: Enter finishes it rather than breaking it.
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault()
                      ;(e.target as HTMLTextAreaElement).blur()
                    }
                  }}
                  rows={Math.min(4, Math.ceil(titleDraft.length / 46) || 1)}
                  className="w-full bg-surface-2 text-text-main font-semibold text-base outline-none focus:ring-1 focus:ring-primary/40 rounded px-2 -ml-2 resize-none leading-snug"
                />
              ) : (
                <h3 className="text-text-main font-semibold text-base leading-snug break-words">
                  {title}
                </h3>
              )}
              <p className="text-text-subtle text-xs mt-0.5">
                {todo ? 'Todo' : KIND_STYLE[entry!.kind].label}
              </p>
            </div>

            {/* Reading by default, editing on purpose. Everything here used to
                be live the moment the panel opened, so opening something to
                check what it said meant one stray keystroke away from
                changing it. */}
            {!readOnly && (
              <button
                onClick={() => setEditing((v) => !v)}
                className={`flex items-center gap-1.5 text-xs font-medium px-2.5 py-1.5 rounded-lg transition-colors flex-shrink-0 ${
                  editing
                    ? 'bg-primary text-white'
                    : 'text-text-muted hover:bg-surface-2 hover:text-text-main'
                }`}
              >
                {editing ? <Check size={13} /> : <Pencil size={13} />}
                {editing ? t('cal_done') : t('cal_edit')}
              </button>
            )}

            <button onClick={onClose} className="text-text-subtle hover:text-text-main p-1 flex-shrink-0">
              <X size={18} />
            </button>
          </header>

          <div className="flex-1 overflow-y-auto p-5 space-y-4">
            {todo
              ? <TodoBody todo={todo} readOnly={readOnly} editing={editing} onClose={onClose} />
              : <EntryBody entry={entry!} readOnly={readOnly} editing={editing} />}

            <section>
              <div className="flex items-center justify-between mb-2">
                <label className="text-xs font-medium text-text-muted">{t('cal_linkedDocuments')}</label>
                {!readOnly && (
                  <button
                    onClick={() => setPicking(true)}
                    className="text-xs text-primary hover:underline flex items-center gap-1"
                  >
                    <Link2 size={12} /> {links.length > 0 ? 'Edit links' : 'Add links'}
                  </button>
                )}
              </div>

              <div className="space-y-1">
                {linked.map(({ raw, item, cluster }) => (
                  <button
                    key={raw.id}
                    onClick={() => goToResource(item?.id, cluster?.id)}
                    className="w-full flex items-center gap-2 p-2 rounded-lg bg-surface-2 hover:bg-border text-left transition-colors group"
                    title={t('cal_openInTheResourcesTab')}
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

function TodoBody({
  todo, readOnly, editing, onClose,
}: { todo: ProjectTodo; readOnly?: boolean; editing?: boolean; onClose: () => void }) {
  const { t } = useT()
  const { employees } = useEmployeeStore()
  const { updateTodo, toggleTodo, deleteTodo, todoLists } = useProjectStore()
  const addTask = useTaskStore((s) => s.addTask)
  const realUser = useAuthStore((s) => s.realUser)

  // Locked unless the panel is in edit mode. Who is doing it is the one
  // exception below: reassigning is a thing you do while reading a list, not
  // something worth entering an edit mode for.
  const locked = readOnly || !editing

  // Held while typing and saved when the box loses focus, for the same reason
  // as the title: a store write per keystroke dropped letters and redrew the
  // calendar behind the panel.
  const [notesDraft, setNotesDraft] = useState(todo.notes)
  useEffect(() => {
    if (locked) setNotesDraft(todo.notes)
  }, [todo.notes, locked])
  const commitNotes = () => {
    if (notesDraft !== todo.notes) updateTodo(todo.id, { notes: notesDraft })
  }

  // Giving a todo to an employee makes it their work: an assigned task, on
  // their calendar in their colour and in their My Tasks, rather than a todo
  // with a name beside it on somebody else's board. Only the owner creates
  // tasks, so for anyone else this stays a note on the todo.
  const canConvert = !readOnly && !!realUser?.isOwner
  const [converting, setConverting] = useState(false)
  const [assignError, setAssignError] = useState('')

  const assign = async (personId: string) => {
    setAssignError('')
    const person = employees.find((e) => e.id === personId)
    if (!person || person.role !== 'employee' || !canConvert || !realUser) {
      updateTodo(todo.id, { assigneeId: personId || null })
      return
    }
    setConverting(true)
    try {
      // A task needs a day; a todo with none becomes today's.
      await addTask({
        projectId: todo.projectId,
        title: todo.title,
        description: todo.notes,
        assignedTo: [person.id],
        frequency: { type: 'one-off', date: todo.doDate ?? format(new Date(), 'yyyy-MM-dd') },
        categoryId: '',
        priority: todo.priority,
        estimatedMinutes: 0,
        createdBy: realUser.id,
        isActive: true,
      })
      // Only once the task exists, so a refused create never loses the todo.
      await deleteTodo(todo.id)
      // The todo is gone, and the task now lives on their calendar and in
      // their My Tasks; there is nothing left here to look at.
      onClose()
    } catch (err) {
      setAssignError((err as Error).message || t('cal_couldNotAssign'))
    } finally {
      setConverting(false)
    }
  }

  return (
    <>
      {/* Read-only still says whether it is done — that is a fact about their
          week — it just is not a button any more. */}
      <div
        className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm w-full transition-colors ${
          todo.isCompleted
            ? 'bg-success-bg text-success'
            : `bg-surface-2 text-text-muted ${readOnly ? '' : 'hover:bg-border cursor-pointer'}`
        }`}
        onClick={readOnly ? undefined : () => toggleTodo(todo.id)}
        role={readOnly ? undefined : 'button'}
      >
        <Check size={14} />
        {todo.isCompleted ? 'Completed' : readOnly ? 'Not done yet' : 'Mark as done'}
      </div>

      <Field label={t('cal_descriptionLabel')}>
        <textarea
          value={notesDraft}
          readOnly={locked}
          onChange={(e) => setNotesDraft(e.target.value)}
          onBlur={commitNotes}
          rows={4}
          placeholder={t('cal_whatIsThisAndWhatDoes')}
          className={`${inputClass} resize-y`}
        />
      </Field>

      {/* One date. The deadline that used to sit beside it is gone: a todo
          happens on the day it happens, and two dates meant reading both to
          work out which one the week was actually built from. */}
      <Field label={t('cal_doDateLabel')}>
        <input
          type="date"
          value={todo.doDate ?? ''}
          readOnly={locked}
          disabled={locked}
          onChange={(e) => updateTodo(todo.id, { doDate: e.target.value || null })}
          className={inputClass}
        />
      </Field>

      {/* Who is doing it. Adding a todo from the calendar dropped you here
          with no way to say whose it was, so it stayed on the shared board. */}
      <Field label={t('cal_assignedTo')}>
        <select
          value={todo.assigneeId ?? ''}
          disabled={readOnly || converting}
          onChange={(e) => assign(e.target.value)}
          className={inputClass}
        >
          <option value="">{t('cal_nobodyInParticular')}</option>
          {employees.map((e) => (
            <option key={e.id} value={e.id}>
              {e.name}
            </option>
          ))}
        </select>
        {canConvert && (
          <p className="text-[11px] text-text-subtle mt-1">{t('cal_assignBecomesTask')}</p>
        )}
        {assignError && <p className="text-[11px] text-danger mt-1">{assignError}</p>}
      </Field>

      <div className="grid grid-cols-2 gap-3">
        <Field label={t('cal_priorityLabel')}>
          <select
            value={todo.priority}
            disabled={locked}
            onChange={(e) => updateTodo(todo.id, { priority: e.target.value as Priority })}
            className={inputClass}
          >
            <option value="high">{t('ui_high')}</option>
            <option value="medium">{t('ui_medium')}</option>
            <option value="low">{t('ui_low')}</option>
          </select>
        </Field>
        <Field label={t('cal_listLabel')}>
          <select
            value={todo.listId ?? ''}
            disabled={locked}
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

function EntryBody({
  entry, readOnly, editing,
}: { entry: CalendarEntry; readOnly?: boolean; editing?: boolean }) {
  const { t } = useT()
  const { updateCalendarEntry } = useProjectStore()
  const locked = readOnly || !editing

  const [notesDraft, setNotesDraft] = useState(entry.notes)
  useEffect(() => {
    if (locked) setNotesDraft(entry.notes)
  }, [entry.notes, locked])
  const commitNotes = () => {
    if (notesDraft !== entry.notes) updateCalendarEntry(entry.id, { notes: notesDraft })
  }

  // An entry occupies whole days. Moving the first day past the last drags
  // the last with it, so the range can never invert.
  const setFirstDay = (day: string) => {
    if (!day) return
    updateCalendarEntry(entry.id, {
      startsOn: day,
      endsOn: entry.endsOn < day ? day : entry.endsOn,
    })
  }

  const setLastDay = (day: string) => {
    if (!day) return
    updateCalendarEntry(entry.id, { endsOn: day < entry.startsOn ? entry.startsOn : day })
  }

  return (
    <>
      <Field label={t('cal_typeLabel')}>
        <div className="grid grid-cols-4 gap-1.5">
          {(Object.keys(KIND_STYLE) as CalendarEntryKind[]).map((k) => (
            <button
              key={k}
              disabled={locked}
              onClick={() => updateCalendarEntry(entry.id, { kind: k })}
              className="px-2 py-1.5 rounded-lg text-xs font-medium border transition-colors disabled:cursor-default"
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

      <Field label={t('cal_notesLabel')}>
        <textarea
          value={notesDraft}
          readOnly={locked}
          onChange={(e) => setNotesDraft(e.target.value)}
          onBlur={commitNotes}
          rows={3}
          placeholder={t('cal_agendaLocationAnythingUseful')}
          className={`${inputClass} resize-y`}
        />
      </Field>

      <div className="grid grid-cols-2 gap-3">
        <Field label={t('cal_firstDay')}>
          <input
            type="date"
            value={entry.startsOn}
            readOnly={locked}
            disabled={locked}
            onChange={(e) => setFirstDay(e.target.value)}
            className={inputClass}
          />
        </Field>
        <Field label={t('cal_lastDay')}>
          <input
            type="date"
            value={entry.endsOn}
            readOnly={locked}
            disabled={locked}
            onChange={(e) => setLastDay(e.target.value)}
            className={inputClass}
          />
        </Field>
      </div>

      <Field label={t('cal_whoCanSeeIt')}>
        <select
          value={entry.visibility ?? ''}
          disabled={locked}
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
