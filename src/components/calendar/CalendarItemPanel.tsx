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
import { useT } from '../../i18n/useT'
import { useEmployeeStore } from '../../store/employeeStore'

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
          <header className="flex items-start justify-between gap-3 px-5 py-4 border-b border-border flex-shrink-0">
            <div className="min-w-0">
              {todo ? (
                <textarea
                  value={todo.title}
                  readOnly={readOnly}
                  onChange={(e) => updateTodo(todo.id, { title: e.target.value })}
                  rows={Math.min(3, Math.ceil(todo.title.length / 46) || 1)}
                  className="w-full bg-transparent text-text-main font-semibold text-base outline-none focus:bg-surface-2 rounded px-1 -ml-1 resize-none leading-snug"
                />
              ) : (
                <textarea
                  value={entry!.title}
                  readOnly={readOnly}
                  onChange={(e) => updateCalendarEntry(entry!.id, { title: e.target.value })}
                  rows={Math.min(3, Math.ceil(entry!.title.length / 46) || 1)}
                  className="w-full bg-transparent text-text-main font-semibold text-base outline-none focus:bg-surface-2 rounded px-1 -ml-1 resize-none leading-snug"
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
            {todo ? <TodoBody todo={todo} readOnly={readOnly} /> : <EntryBody entry={entry!} readOnly={readOnly} />}

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

              {linked.length === 0 && (
                <p className="text-xs text-text-subtle italic">{t('cal_nothingLinkedAttachTheContractBrie')}</p>
              )}

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

          <footer className="px-5 py-3 border-t border-border flex items-center gap-2 flex-shrink-0">
            {todo && (
              <button
                onClick={() => navigate(`${root}/todos`)}
                className="text-xs text-primary hover:underline flex-1 text-left"
              >{t('cal_openInTodos')}</button>
            )}
            {entry && <span className="flex-1" />}
            {!readOnly && (
              <button
                onClick={() => {
                  if (todo) deleteTodo(todo.id)
                  else deleteCalendarEntry(entry!.id)
                  onClose()
                }}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs text-danger hover:bg-danger-bg"
              >
                <Trash2 size={13} />{t('ui_delete')}</button>
            )}
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

function TodoBody({ todo, readOnly }: { todo: ProjectTodo; readOnly?: boolean }) {
  const { t } = useT()
  const { employees } = useEmployeeStore()
  const { updateTodo, toggleTodo, todoLists } = useProjectStore()

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
          value={todo.notes}
          readOnly={readOnly}
          onChange={(e) => updateTodo(todo.id, { notes: e.target.value })}
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
          readOnly={readOnly}
          disabled={readOnly}
          onChange={(e) => updateTodo(todo.id, { doDate: e.target.value || null })}
          className={inputClass}
        />
      </Field>

      {/* Who is doing it. Adding a todo from the calendar dropped you here
          with no way to say whose it was, so it stayed on the shared board. */}
      <Field label={t('cal_assignedTo')}>
        <select
          value={todo.assigneeId ?? ''}
          disabled={readOnly}
          onChange={(e) => updateTodo(todo.id, { assigneeId: e.target.value || null })}
          className={inputClass}
        >
          <option value="">{t('cal_nobodyInParticular')}</option>
          {employees.map((e) => (
            <option key={e.id} value={e.id}>
              {e.name}
            </option>
          ))}
        </select>
      </Field>

      <div className="grid grid-cols-2 gap-3">
        <Field label={t('cal_priorityLabel')}>
          <select
            value={todo.priority}
            disabled={readOnly}
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
            disabled={readOnly}
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

function EntryBody({ entry, readOnly }: { entry: CalendarEntry; readOnly?: boolean }) {
  const { t } = useT()
  const { updateCalendarEntry } = useProjectStore()

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
              disabled={readOnly}
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
          value={entry.notes}
          readOnly={readOnly}
          onChange={(e) => updateCalendarEntry(entry.id, { notes: e.target.value })}
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
            readOnly={readOnly}
            disabled={readOnly}
            onChange={(e) => setFirstDay(e.target.value)}
            className={inputClass}
          />
        </Field>
        <Field label={t('cal_lastDay')}>
          <input
            type="date"
            value={entry.endsOn}
            readOnly={readOnly}
            disabled={readOnly}
            onChange={(e) => setLastDay(e.target.value)}
            className={inputClass}
          />
        </Field>
      </div>

      <Field label={t('cal_whoCanSeeIt')}>
        <select
          value={entry.visibility ?? ''}
          disabled={readOnly}
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
