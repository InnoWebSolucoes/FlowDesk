import React, { useEffect, useMemo, useState } from 'react'
import { useOutletContext } from 'react-router-dom'
import {
  ChevronLeft, ChevronRight, Plus, X, Lock, Users as UsersIcon, Globe, Clock, Trash2,
} from 'lucide-react'
import {
  addDays, addMonths, endOfMonth, endOfWeek, format, isSameDay, isSameMonth,
  parseISO, startOfDay, startOfMonth, startOfWeek,
} from 'date-fns'
import { Project, ProjectTodo, CalendarEntry, Visibility, CalendarEntryKind } from '../../../types'
import { useProjectStore } from '../../../store/projectStore'
import { useEmployeeStore } from '../../../store/employeeStore'
import { useAuthStore } from '../../../store/authStore'

const KIND_STYLE: Record<CalendarEntryKind, { label: string; color: string }> = {
  busy: { label: 'Busy', color: '#dc2626' },
  working: { label: 'Working', color: '#16a34a' },
  meeting: { label: 'Meeting', color: '#2563eb' },
  timeoff: { label: 'Time off', color: '#a855f7' },
}

const VISIBILITY_META: Record<Visibility, { label: string; hint: string; Icon: typeof Lock }> = {
  private: { label: 'Private', hint: 'Only you, even managers cannot see it', Icon: Lock },
  team: { label: 'Team', hint: 'Everyone on this project', Icon: UsersIcon },
  everyone: { label: 'Everyone', hint: 'Everyone in the company', Icon: Globe },
}

/** Local YYYY-MM-DD. A do date is a calendar day, not an instant. */
const dayKey = (d: Date) => format(d, 'yyyy-MM-dd')

export function ProjectCalendar() {
  const { project } = useOutletContext<{ project: Project }>()
  const {
    todos, todosLoadedFor, loadTodos, updateTodo,
    calendarEntries, calendarLoadedFor, loadCalendar,
    createCalendarEntry, deleteCalendarEntry,
  } = useProjectStore()
  const employees = useEmployeeStore((s) => s.employees)
  const currentUser = useAuthStore((s) => s.currentUser)

  const [cursor, setCursor] = useState(() => startOfMonth(new Date()))
  const [draft, setDraft] = useState<{ day: string } | null>(null)
  const [detail, setDetail] = useState<CalendarEntry | null>(null)

  useEffect(() => {
    if (todosLoadedFor !== project.id) loadTodos(project.id)
    if (calendarLoadedFor !== project.id) loadCalendar(project.id)
  }, [project.id, todosLoadedFor, calendarLoadedFor, loadTodos, loadCalendar])

  // Six weeks covering the month, so the grid never changes height.
  const days = useMemo(() => {
    const first = startOfWeek(startOfMonth(cursor), { weekStartsOn: 1 })
    const last = endOfWeek(endOfMonth(cursor), { weekStartsOn: 1 })
    const out: Date[] = []
    for (let d = first; d <= last; d = addDays(d, 1)) out.push(d)
    return out
  }, [cursor])

  /** Todos land on their do date — the day you plan to work, not the deadline. */
  const todosByDay = useMemo(() => {
    const map = new Map<string, ProjectTodo[]>()
    for (const t of todos) {
      if (!t.doDate) continue
      const list = map.get(t.doDate) ?? []
      list.push(t)
      map.set(t.doDate, list)
    }
    return map
  }, [todos])

  /** A due date with no do date still deserves a marker, or deadlines vanish. */
  const dueByDay = useMemo(() => {
    const map = new Map<string, ProjectTodo[]>()
    for (const t of todos) {
      if (!t.dueDate || t.isCompleted) continue
      const list = map.get(t.dueDate) ?? []
      list.push(t)
      map.set(t.dueDate, list)
    }
    return map
  }, [todos])

  const entriesByDay = useMemo(() => {
    const map = new Map<string, CalendarEntry[]>()
    for (const e of calendarEntries) {
      // Multi-day entries appear on each day they cover.
      let d = startOfDay(parseISO(e.startsAt))
      const end = parseISO(e.endsAt)
      while (d < end) {
        const key = dayKey(d)
        const list = map.get(key) ?? []
        list.push(e)
        map.set(key, list)
        d = addDays(d, 1)
      }
    }
    return map
  }, [calendarEntries])

  const nameFor = (userId: string | null) => {
    if (!userId) return null
    if (userId === currentUser?.id) return 'You'
    return employees.find((e) => e.id === userId)?.name ?? null
  }

  const today = dayKey(new Date())

  return (
    <div className="animate-fade-in">
      <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
        <div className="flex items-center gap-1">
          <button
            onClick={() => setCursor(addMonths(cursor, -1))}
            className="p-1.5 rounded-md text-text-muted hover:bg-surface-2"
            title="Previous month"
          >
            <ChevronLeft size={18} />
          </button>
          <h2 className="text-text-main font-semibold text-base w-44 text-center">
            {format(cursor, 'MMMM yyyy')}
          </h2>
          <button
            onClick={() => setCursor(addMonths(cursor, 1))}
            className="p-1.5 rounded-md text-text-muted hover:bg-surface-2"
            title="Next month"
          >
            <ChevronRight size={18} />
          </button>
          <button
            onClick={() => setCursor(startOfMonth(new Date()))}
            className="ml-2 px-2.5 py-1.5 rounded-md text-xs font-medium text-text-muted hover:bg-surface-2"
          >
            Today
          </button>
        </div>

        <div className="flex items-center gap-3 text-[11px] text-text-subtle">
          <span className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-sm bg-primary" /> Do date
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-sm border-2 border-danger" /> Deadline
          </span>
          {Object.entries(KIND_STYLE).map(([k, v]) => (
            <span key={k} className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: v.color }} />
              {v.label}
            </span>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-7 gap-px bg-border rounded-xl overflow-hidden border border-border">
        {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => (
          <div key={d} className="bg-surface-2 px-2 py-1.5 text-[11px] font-medium text-text-muted text-center">
            {d}
          </div>
        ))}

        {days.map((day) => {
          const key = dayKey(day)
          const dayTodos = todosByDay.get(key) ?? []
          const dayDue = (dueByDay.get(key) ?? []).filter((t) => t.doDate !== key)
          const dayEntries = entriesByDay.get(key) ?? []
          const outside = !isSameMonth(day, cursor)

          return (
            <div
              key={key}
              className={`group relative bg-surface min-h-[104px] p-1.5 ${outside ? 'opacity-40' : ''}`}
            >
              <div className="flex items-center justify-between mb-1">
                <span
                  className={`text-[11px] w-5 h-5 flex items-center justify-center rounded-full ${
                    key === today ? 'bg-primary text-white font-semibold' : 'text-text-muted'
                  }`}
                >
                  {format(day, 'd')}
                </span>
                <button
                  onClick={() => setDraft({ day: key })}
                  className="opacity-0 group-hover:opacity-100 text-text-subtle hover:text-primary p-0.5 rounded transition-opacity"
                  title="Add busy or working time"
                >
                  <Plus size={13} />
                </button>
              </div>

              <div className="space-y-1">
                {dayTodos.map((t) => (
                  <div
                    key={t.id}
                    title={`${t.title}${t.dueDate ? ` — due ${t.dueDate}` : ''}`}
                    className={`text-[10px] leading-tight px-1.5 py-1 rounded bg-primary/10 text-primary truncate ${
                      t.isCompleted ? 'line-through opacity-60' : ''
                    }`}
                  >
                    {t.doStart && <span className="opacity-70">{t.doStart.slice(0, 5)} </span>}
                    {t.title}
                  </div>
                ))}

                {dayEntries.map((e) => (
                  <button
                    key={e.id}
                    onClick={() => setDetail(e)}
                    className="w-full text-left text-[10px] leading-tight px-1.5 py-1 rounded truncate"
                    style={{
                      backgroundColor: `${KIND_STYLE[e.kind].color}1a`,
                      color: KIND_STYLE[e.kind].color,
                    }}
                    title={`${e.title} — ${nameFor(e.ownerId) ?? 'someone'}`}
                  >
                    {!e.allDay && (
                      <span className="opacity-70">{format(parseISO(e.startsAt), 'HH:mm')} </span>
                    )}
                    {e.title}
                  </button>
                ))}

                {dayDue.map((t) => (
                  <div
                    key={`due-${t.id}`}
                    title={`Deadline: ${t.title}${t.doDate ? '' : ' — no do date set'}`}
                    className="text-[10px] leading-tight px-1.5 py-1 rounded border border-danger/40 text-danger truncate"
                  >
                    Due: {t.title}
                  </div>
                ))}
              </div>
            </div>
          )
        })}
      </div>

      {/* Unscheduled: has a deadline but no plan for when to do it. */}
      <UnscheduledStrip todos={todos} onSchedule={(id, day) => updateTodo(id, { doDate: day })} />

      {draft && (
        <EntryDialog
          day={draft.day}
          projectId={project.id}
          onClose={() => setDraft(null)}
          onCreate={createCalendarEntry}
        />
      )}

      {detail && (
        <div
          className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4"
          onClick={() => setDetail(null)}
        >
          <div className="bg-surface rounded-xl border border-border w-full max-w-sm" onClick={(e) => e.stopPropagation()}>
            <div className="px-5 py-4 border-b border-border flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h3 className="text-text-main font-semibold text-base truncate">{detail.title}</h3>
                <p className="text-text-subtle text-xs">
                  {KIND_STYLE[detail.kind].label} · {nameFor(detail.ownerId) ?? 'Someone'}
                </p>
              </div>
              <button onClick={() => setDetail(null)} className="text-text-subtle hover:text-text-main p-1">
                <X size={16} />
              </button>
            </div>
            <div className="p-5 space-y-2 text-sm text-text-muted">
              <p className="flex items-center gap-2">
                <Clock size={14} />
                {detail.allDay
                  ? format(parseISO(detail.startsAt), 'EEE d MMM')
                  : `${format(parseISO(detail.startsAt), 'EEE d MMM, HH:mm')} – ${format(parseISO(detail.endsAt), 'HH:mm')}`}
              </p>
              {detail.notes && <p className="text-xs">{detail.notes}</p>}
              {detail.visibility && (
                <p className="text-xs flex items-center gap-1.5">
                  {React.createElement(VISIBILITY_META[detail.visibility].Icon, { size: 13 })}
                  {VISIBILITY_META[detail.visibility].label}
                </p>
              )}
            </div>
            {(detail.ownerId === currentUser?.id || currentUser?.role === 'admin') && (
              <div className="px-5 py-3 border-t border-border flex justify-end">
                <button
                  onClick={() => {
                    deleteCalendarEntry(detail.id)
                    setDetail(null)
                  }}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs text-danger hover:bg-danger-bg"
                >
                  <Trash2 size={13} /> Delete
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

/** Todos with a deadline but no plan — the gap the do date is meant to close. */
function UnscheduledStrip({
  todos,
  onSchedule,
}: {
  todos: ProjectTodo[]
  onSchedule: (id: string, day: string) => void
}) {
  const pending = todos.filter((t) => !t.isCompleted && !t.doDate)
  if (pending.length === 0) return null

  return (
    <div className="mt-4 rounded-xl border border-border bg-surface p-4">
      <h3 className="text-text-main font-medium text-sm mb-1">Not scheduled yet</h3>
      <p className="text-text-subtle text-xs mb-3">
        These have no do date, so they never appear on the calendar. Pick a day you will actually work on them.
      </p>
      <div className="space-y-1.5">
        {pending.slice(0, 8).map((t) => (
          <div key={t.id} className="flex items-center gap-2 flex-wrap">
            <span className="text-sm text-text-main flex-1 min-w-0 truncate">{t.title}</span>
            {t.dueDate && <span className="text-[11px] text-danger">due {t.dueDate}</span>}
            <input
              type="date"
              onChange={(e) => e.target.value && onSchedule(t.id, e.target.value)}
              className="px-2 py-1 rounded-md bg-surface-2 border border-border text-xs text-text-main"
            />
          </div>
        ))}
      </div>
    </div>
  )
}

function EntryDialog({
  day,
  projectId,
  onClose,
  onCreate,
}: {
  day: string
  projectId: string
  onClose: () => void
  onCreate: ReturnType<typeof useProjectStore.getState>['createCalendarEntry']
}) {
  const [title, setTitle] = useState('')
  const [kind, setKind] = useState<CalendarEntryKind>('busy')
  const [allDay, setAllDay] = useState(false)
  const [start, setStart] = useState('09:00')
  const [end, setEnd] = useState('17:00')
  const [visibility, setVisibility] = useState<Visibility | ''>('')
  const [busy, setBusy] = useState(false)

  const save = async () => {
    if (busy) return
    if (!allDay && end <= start) return
    setBusy(true)
    await onCreate({
      projectId,
      title: title.trim() || KIND_STYLE[kind].label,
      kind,
      allDay,
      // Local time in, ISO out — the row stores an instant.
      startsAt: new Date(`${day}T${allDay ? '00:00' : start}`).toISOString(),
      endsAt: allDay
        ? new Date(`${day}T23:59`).toISOString()
        : new Date(`${day}T${end}`).toISOString(),
      visibility: visibility || null,
    })
    setBusy(false)
    onClose()
  }

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-surface rounded-xl border border-border w-full max-w-md" onClick={(e) => e.stopPropagation()}>
        <div className="px-5 py-4 border-b border-border">
          <h3 className="text-text-main font-semibold text-base">Add time</h3>
          <p className="text-text-subtle text-xs">{format(parseISO(day), 'EEEE d MMMM yyyy')}</p>
        </div>

        <div className="p-5 space-y-3">
          <div className="grid grid-cols-4 gap-1.5">
            {(Object.keys(KIND_STYLE) as CalendarEntryKind[]).map((k) => (
              <button
                key={k}
                onClick={() => setKind(k)}
                className="px-2 py-1.5 rounded-lg text-xs font-medium border transition-colors"
                style={
                  kind === k
                    ? { backgroundColor: `${KIND_STYLE[k].color}1a`, color: KIND_STYLE[k].color, borderColor: KIND_STYLE[k].color }
                    : { borderColor: 'var(--tw-border-opacity, #e5e7eb)' }
                }
              >
                {KIND_STYLE[k].label}
              </button>
            ))}
          </div>

          <input
            autoFocus
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={`Name (default: ${KIND_STYLE[kind].label})`}
            className="w-full px-3 py-2 bg-surface-2 border border-border rounded-lg text-sm text-text-main outline-none focus:border-primary"
          />

          <label className="flex items-center gap-2 text-xs text-text-muted">
            <input type="checkbox" checked={allDay} onChange={(e) => setAllDay(e.target.checked)} className="w-4 h-4 accent-primary" />
            All day
          </label>

          {!allDay && (
            <div className="flex items-center gap-2">
              <input
                type="time"
                value={start}
                onChange={(e) => setStart(e.target.value)}
                className="flex-1 px-3 py-2 bg-surface-2 border border-border rounded-lg text-sm text-text-main"
              />
              <span className="text-text-subtle text-xs">to</span>
              <input
                type="time"
                value={end}
                onChange={(e) => setEnd(e.target.value)}
                className="flex-1 px-3 py-2 bg-surface-2 border border-border rounded-lg text-sm text-text-main"
              />
            </div>
          )}
          {!allDay && end <= start && (
            <p className="text-[11px] text-danger">The end time must be after the start time.</p>
          )}

          <div>
            <label className="block text-text-muted text-xs mb-1">Who can see it</label>
            <select
              value={visibility}
              onChange={(e) => setVisibility(e.target.value as Visibility | '')}
              className="w-full px-3 py-2 bg-surface-2 border border-border rounded-lg text-sm text-text-main"
            >
              <option value="">Default for my role</option>
              {(Object.keys(VISIBILITY_META) as Visibility[]).map((v) => (
                <option key={v} value={v}>
                  {VISIBILITY_META[v].label} — {VISIBILITY_META[v].hint}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="px-5 py-3 border-t border-border flex justify-end gap-2">
          <button onClick={onClose} className="px-3 py-1.5 rounded-lg text-xs font-medium text-text-muted hover:bg-surface-2">
            Cancel
          </button>
          <button
            onClick={save}
            disabled={busy || (!allDay && end <= start)}
            className="px-3 py-1.5 rounded-lg bg-primary text-white text-xs font-medium hover:bg-primary/90 disabled:opacity-50"
          >
            {busy ? 'Adding…' : 'Add'}
          </button>
        </div>
      </div>
    </div>
  )
}
