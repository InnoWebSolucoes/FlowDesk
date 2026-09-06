import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ChevronLeft, ChevronRight, SlidersHorizontal, GripVertical, CalendarClock, Check,
  Circle, CheckCircle2, Users,
} from 'lucide-react'
import {
  addDays, addMonths, addWeeks, endOfMonth, endOfWeek, format, isSameMonth,
  startOfMonth, startOfWeek, parseISO,
} from 'date-fns'
import { Project, ProjectTodo, CalendarEntry, Task } from '../../types'
import { useProjectStore } from '../../store/projectStore'
import { useTaskStore } from '../../store/taskStore'
import { useEmployeeStore } from '../../store/employeeStore'
import { isTaskDueOnDate } from '../../utils/taskScheduler'
import { CalendarItemPanel } from './CalendarItemPanel'
import {
  KIND_STYLE, LAYERS, Layer, dayKey, dayDate, entryCoversDay,
} from './calendarShared'

type View = 'day' | 'week' | 'month'

/** Keeps a right-click menu on screen. */
function menuPos(x: number, y: number, rows: number, width = 192) {
  const height = rows * 30 + 40
  return {
    left: x + width + 8 > window.innerWidth ? Math.max(8, x - width) : x,
    top: y + height + 8 > window.innerHeight ? Math.max(8, y - height) : y,
  }
}

/** What is being dragged, and what the drop should do. */
// Dragging moves an item from one day to another; there is nothing finer to
// drag to now that the calendar is day-based.
type DragState =
  | { kind: 'todo'; id: string; label: string }
  | { kind: 'entry'; id: string; label: string }
  | { kind: 'unscheduled'; id: string; label: string }

interface Block {
  key: string
  label: string
  color: string
  outlined?: boolean
  todo?: ProjectTodo
  entry?: CalendarEntry
  /** An assigned task shown on the day it is planned for, or its deadline. */
  task?: Task
  /** Whose block this is, when other people's calendars are overlaid. */
  ownerName?: string
}

interface CalendarBoardProps {
  project: Project
  /**
   * Whose todos appear alongside the calendar entries. Null is the managers'
   * shared board; a user id is that person's own. Calendar entries are always
   * the viewer's own plus whatever has been shared with them — that is decided
   * by RLS, not here.
   */
  ownerId: string | null
  /** Where this side of the app lives, for links out to Resources and Todos. */
  basePath: string
}

/**
 * The working calendar: todos on their do dates, alongside busy/working blocks.
 * One component for the managers' board and each employee's, so the planning
 * view is the same tool on both sides.
 */
export function CalendarBoard({ project, ownerId, basePath }: CalendarBoardProps) {
  const {
    todos, todosLoadedFor, loadTodos, updateTodo,
    todoLists,
    toggleTodo, deleteTodo,
    calendarEntries, calendarLoadedFor, loadCalendar,
    createCalendarEntry, updateCalendarEntry, deleteCalendarEntry,
    overlayTodos, loadOverlayTodos,
  } = useProjectStore()

  const { tasks } = useTaskStore()
  const { employees } = useEmployeeStore()

  // Whose calendars to overlay, beyond your own. Admin-only: a manager needs
  // to see the team's week to plan against it. Empty means just this board.
  const [overlaid, setOverlaid] = useState<Set<string>>(new Set())
  const canOverlay = ownerId === null

  const [view, setView] = useState<View>('week')
  const [cursor, setCursor] = useState(() => new Date())
  const [hidden, setHidden] = useState<Set<Layer>>(new Set())
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [teamOpen, setTeamOpen] = useState(false)
  const [openTodo, setOpenTodo] = useState<string | null>(null)
  const [openEntry, setOpenEntry] = useState<string | null>(null)
  const [drag, setDrag] = useState<DragState | null>(null)
  const [hoverSlot, setHoverSlot] = useState<string | null>(null)
  // Where the pointer is, so the dragged item can follow it. Null until the
  // first move, which keeps the preview from flashing at the origin.
  const [dragPoint, setDragPoint] = useState<{ x: number; y: number } | null>(null)
  // Set while the pointer is over the unscheduled panel, which drops a todo
  // off the calendar rather than moving it.
  const [overUnscheduled, setOverUnscheduled] = useState(false)
  // Set when a drag ends, so the click event that follows the pointerup does
  // not also fire "create an entry here".
  const justDragged = useRef(false)
  // Right-click on a block: complete it, take it off the calendar, or delete.
  const [blockMenu, setBlockMenu] = useState<
    { x: number; y: number; todoId?: string; entryId?: string } | null
  >(null)
  const gridRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    // The marker is keyed by board, so the managers' shared one is ":shared".
    const boardKey = `${project.id}:${ownerId ?? 'shared'}`
    if (todosLoadedFor !== boardKey) loadTodos(project.id, ownerId)
    if (calendarLoadedFor !== project.id) loadCalendar(project.id)
  }, [project.id, ownerId, todosLoadedFor, calendarLoadedFor, loadTodos, loadCalendar])

  const visible = (layer: Layer) => !hidden.has(layer)
  const toggleLayer = (layer: Layer) =>
    setHidden((prev) => {
      const next = new Set(prev)
      if (next.has(layer)) next.delete(layer)
      else next.add(layer)
      return next
    })

  // ── The days on screen ───────────────────────────────────────────────────
  const days = useMemo(() => {
    if (view === 'day') return [cursor]
    if (view === 'week') {
      const first = startOfWeek(cursor, { weekStartsOn: 1 })
      return Array.from({ length: 7 }, (_, i) => addDays(first, i))
    }
    const first = startOfWeek(startOfMonth(cursor), { weekStartsOn: 1 })
    const last = endOfWeek(endOfMonth(cursor), { weekStartsOn: 1 })
    const out: Date[] = []
    for (let d = first; d <= last; d = addDays(d, 1)) out.push(d)
    return out
  }, [view, cursor])

  const step = (dir: 1 | -1) => {
    if (view === 'day') setCursor((c) => addDays(c, dir))
    else if (view === 'week') setCursor((c) => addWeeks(c, dir))
    else setCursor((c) => addMonths(c, dir))
  }

  // ── Blocks per day ───────────────────────────────────────────────────────
  // The calendar is organised by day: everything on a day is one flat list,
  // in the order it was added to it.
  const blocksFor = useCallback(
    (day: string): Block[] => {
      const blocks: Block[] = []

      if (visible('do')) {
        for (const t of todos) {
          if (t.doDate !== day) continue
          blocks.push({
            key: `todo-${t.id}`,
            label: t.title,
            color: '#1A5C3A',
            todo: t,
          })
        }
      }

      // The overlaid people's own todos, so their week reads as a week rather
      // than a list of assignments. Their name rides along, as tasks do.
      if (canOverlay && overlaid.size > 0 && visible('do')) {
        for (const t of overlayTodos) {
          if (t.doDate !== day || !t.ownerId || !overlaid.has(t.ownerId)) continue
          blocks.push({
            key: `overlay-todo-${t.id}`,
            label: t.title,
            color: '#1A5C3A',
            todo: t,
            ownerName: employees.find((e) => e.id === t.ownerId)?.name,
          })
        }
      }

      // Assigned work belongs on the calendar too, otherwise an employee has
      // to hold two lists in their head. Shown on the day they planned it; if
      // they have not planned it, on its deadline so it is not invisible.
      const scheduleOwners = canOverlay ? [...overlaid] : [ownerId!]
      for (const empIdForCal of scheduleOwners) {
        const who = employees.find((e) => e.id === empIdForCal)
        for (const task of tasks) {
          if (!task.isActive || !task.assignedTo.includes(empIdForCal)) continue

          const sched = task.schedules.find((x) => x.employeeId === empIdForCal)
          const planned = sched?.doDate
          const showsToday =
            planned === day ||
            (!planned && task.deadline === day) ||
            (!planned && !task.deadline && isTaskDueOnDate(task, empIdForCal, parseISO(day)))
          if (!showsToday) continue
          if (planned === day ? !visible('do') : !visible('due')) continue

          blocks.push({
            key: `task-${task.id}-${empIdForCal}`,
            label: task.title,
            color: '#6366f1',
            outlined: !planned,
            task,
            ownerName: canOverlay ? who?.name : undefined,
          })
        }
      }

      if (visible('due')) {
        for (const t of todos) {
          if (t.dueDate !== day || t.isCompleted) continue
          if (t.doDate === day) continue // already shown as a do-date block
          blocks.push({
            key: `due-${t.id}`,
            label: `Due: ${t.title}`,
            color: '#dc2626',
            outlined: true,
            todo: t,
          })
        }
      }

      for (const e of calendarEntries) {
        if (!visible(e.kind)) continue
        if (!entryCoversDay(e, day)) continue
        // Someone else's entry only shows while they are overlaid, and says
        // whose it is so a busy day is attributable.
        const mine = !ownerId || e.ownerId === ownerId
        const theirs = canOverlay && overlaid.has(e.ownerId)
        if (!mine && !theirs && canOverlay && overlaid.size > 0) continue
        blocks.push({
          key: `entry-${e.id}`,
          label: e.title,
          color: KIND_STYLE[e.kind].color,
          ownerName: theirs ? employees.find((x) => x.id === e.ownerId)?.name : undefined,
          entry: e,
        })
      }

      return blocks
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [todos, overlayTodos, calendarEntries, hidden, tasks, employees, overlaid, ownerId, canOverlay],
  )

  // ── Dragging ─────────────────────────────────────────────────────────────
  // Other people's todos only arrive when someone is actually overlaid, so a
  // manager looking at their own week pays nothing for the feature.
  useEffect(() => {
    if (canOverlay) loadOverlayTodos(project.id, [...overlaid])
  }, [canOverlay, project.id, overlaid, loadOverlayTodos])

  /** Screen point → the day column it falls in. */
  const slotAt = useCallback((clientX: number, clientY: number): string | null => {
    const el = document.elementFromPoint(clientX, clientY)?.closest('[data-day]') as HTMLElement | null
    return el?.dataset.day ?? null
  }, [])

  /** Whether a screen point is over the unscheduled panel. */
  const overDropOut = useCallback((clientX: number, clientY: number) => {
    const el = document.elementFromPoint(clientX, clientY) as HTMLElement | null
    return !!el?.closest('[data-unscheduled]')
  }, [])

  useEffect(() => {
    if (!drag) return

    const onMove = (e: PointerEvent) => {
      setDragPoint({ x: e.clientX, y: e.clientY })
      setHoverSlot(slotAt(e.clientX, e.clientY))
      setOverUnscheduled(drag.kind !== 'entry' && overDropOut(e.clientX, e.clientY))
    }

    const onUp = async (e: PointerEvent) => {
      const day = slotAt(e.clientX, e.clientY)
      const droppedOut = drag.kind !== 'entry' && overDropOut(e.clientX, e.clientY)
      setDrag(null)
      setHoverSlot(null)
      setDragPoint(null)
      setOverUnscheduled(false)
      justDragged.current = true
      // Cleared after the click that this pointerup generates has passed.
      setTimeout(() => { justDragged.current = false }, 0)

      // Dropping a scheduled todo back on the list clears its do date, which
      // is how something comes off the calendar without being deleted.
      if (droppedOut) {
        if (drag.kind === 'todo') await updateTodo(drag.id, { doDate: null })
        return
      }

      if (!day) return

      if (drag.kind === 'unscheduled' || drag.kind === 'todo') {
        await updateTodo(drag.id, { doDate: day })
        return
      }

      if (drag.kind === 'entry') {
        const entry = calendarEntries.find((x) => x.id === drag.id)
        if (!entry) return
        // Dragging moves the whole entry, so a multi-day block keeps its
        // length and lands with its first day where it was dropped.
        const span = Math.round(
          (dayDate(entry.endsOn).getTime() - dayDate(entry.startsOn).getTime()) / 864e5,
        )
        const newEnd = new Date(dayDate(day).getTime() + span * 864e5)
        await updateCalendarEntry(entry.id, { startsOn: day, endsOn: dayKey(newEnd) })
      }
    }

    // Without this the browser starts a text selection mid-drag, which both
    // looks broken and swallows the pointer events.
    const previousSelect = document.body.style.userSelect
    document.body.style.userSelect = 'none'

    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    return () => {
      document.body.style.userSelect = previousSelect
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
  }, [drag, slotAt, overDropOut, updateTodo, updateCalendarEntry, calendarEntries])

  /** Click on empty space in a day → a new entry on that day. */
  const createAt = async (day: string) => {
    const created = await createCalendarEntry({
      projectId: project.id,
      title: 'Busy',
      kind: 'busy',
      startsOn: day,
      endsOn: day,
    })
    if (created) setOpenEntry(created.id)
  }

  /**
   * Taking a todo off the calendar clears its do date, which returns it to the
   * unscheduled list — the todo itself is untouched. A calendar entry has no
   * life outside the calendar, so it is only ever deleted.
   */
  const unscheduleTodo = (id: string) => updateTodo(id, { doDate: null })

  const todo = openTodo ? todos.find((t) => t.id === openTodo) : undefined
  const entry = openEntry ? calendarEntries.find((e) => e.id === openEntry) : undefined
  const today = dayKey(new Date())

  const title =
    view === 'day'
      ? format(cursor, 'EEEE d MMMM yyyy')
      : view === 'week'
        ? `${format(startOfWeek(cursor, { weekStartsOn: 1 }), 'd MMM')}, ${format(endOfWeek(cursor, { weekStartsOn: 1 }), 'd MMM yyyy')}`
        : format(cursor, 'MMMM yyyy')

  return (
    <div className="animate-fade-in">
      {/* Toolbar */}
      <div className="flex items-center justify-between gap-2 mb-4 flex-wrap">
        <div className="flex items-center gap-1">
          <button onClick={() => step(-1)} className="p-1.5 rounded-md text-text-muted hover:bg-surface-2">
            <ChevronLeft size={18} />
          </button>
          <button onClick={() => step(1)} className="p-1.5 rounded-md text-text-muted hover:bg-surface-2">
            <ChevronRight size={18} />
          </button>
          <button
            onClick={() => setCursor(new Date())}
            className="ml-1 px-2.5 py-1.5 rounded-md text-xs font-medium text-text-muted hover:bg-surface-2 border border-border"
          >
            Today
          </button>
          <h2 className="ml-3 text-text-main font-semibold text-base">{title}</h2>
        </div>

        <div className="flex items-center gap-2">
          <div className="flex rounded-lg border border-border overflow-hidden">
            {(['day', 'week', 'month'] as View[]).map((v) => (
              <button
                key={v}
                onClick={() => setView(v)}
                className={`px-3 py-1.5 text-xs font-medium capitalize transition-colors ${
                  view === v ? 'bg-primary text-white' : 'text-text-muted hover:bg-surface-2'
                }`}
              >
                {v}
              </button>
            ))}
          </div>

          <div className="relative">
            <button
              onClick={() => setFiltersOpen((o) => !o)}
              className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-xs font-medium transition-colors ${
                hidden.size > 0
                  ? 'border-primary text-primary bg-primary-light'
                  : 'border-border text-text-muted hover:bg-surface-2'
              }`}
              title="Show or hide types"
            >
              <SlidersHorizontal size={13} />
              {hidden.size > 0 ? `${LAYERS.length - hidden.size}/${LAYERS.length}` : 'Filter'}
            </button>

            {/* Whose weeks to show alongside your own. This used to live inside
                the type filter, where nothing suggested the team was in it. */}
            {canOverlay && employees.length > 0 && (
              <>
                <button
                  onClick={() => setTeamOpen((v) => !v)}
                  className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-md border text-xs font-medium transition-colors ${
                    overlaid.size > 0
                      ? 'bg-primary-light border-primary/30 text-primary'
                      : 'bg-surface border-border text-text-muted hover:text-text-main'
                  }`}
                  title="Show a colleague's calendar alongside yours"
                >
                  <Users size={13} />
                  {overlaid.size > 0 ? `${overlaid.size} shown` : 'Team'}
                </button>

                {teamOpen && (
                  <>
                    <div className="fixed inset-0 z-40" onClick={() => setTeamOpen(false)} />
                    <div className="absolute right-0 top-full mt-1 z-50 w-56 py-1.5 bg-surface border border-border rounded-lg shadow-xl">
                      <p className="px-3 py-1 text-[10px] font-semibold uppercase tracking-wide text-text-subtle">
                        Show alongside yours
                      </p>
                      <div className="max-h-56 overflow-y-auto">
                        {employees.map((emp) => (
                          <button
                            key={emp.id}
                            onClick={() =>
                              setOverlaid((prev) => {
                                const next = new Set(prev)
                                if (next.has(emp.id)) next.delete(emp.id)
                                else next.add(emp.id)
                                return next
                              })
                            }
                            className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-text-main hover:bg-surface-2"
                          >
                            <span className="w-3 h-3 rounded-full bg-primary/70 flex-shrink-0" />
                            <span className="flex-1 text-left truncate">{emp.name}</span>
                            {overlaid.has(emp.id) && <Check size={13} className="text-primary" />}
                          </button>
                        ))}
                      </div>
                      {overlaid.size > 0 && (
                        <>
                          <div className="h-px bg-border my-1.5" />
                          <button
                            onClick={() => setOverlaid(new Set())}
                            className="w-full px-3 py-1.5 text-left text-xs text-text-muted hover:bg-surface-2"
                          >
                            Show only mine
                          </button>
                        </>
                      )}
                    </div>
                  </>
                )}
              </>
            )}

            {filtersOpen && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setFiltersOpen(false)} />
                <div className="absolute right-0 top-full mt-1 z-50 w-52 py-1.5 bg-surface border border-border rounded-lg shadow-xl">
                  {LAYERS.map((l) => (
                    <button
                      key={l.key}
                      onClick={() => toggleLayer(l.key)}
                      className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-text-main hover:bg-surface-2"
                    >
                      <span
                        className="w-3 h-3 rounded-sm flex-shrink-0"
                        style={
                          l.outlined
                            ? { border: `2px solid ${l.color}` }
                            : { backgroundColor: l.color }
                        }
                      />
                      <span className="flex-1 text-left">{l.label}</span>
                      {visible(l.key) && <Check size={13} className="text-primary" />}
                    </button>
                  ))}
                  {hidden.size > 0 && (
                    <button
                      onClick={() => setHidden(new Set())}
                      className="w-full text-left px-3 py-1.5 text-xs text-primary hover:bg-surface-2 border-t border-border mt-1 pt-1.5"
                    >
                      Show everything
                    </button>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      <div className="flex gap-4 items-start">
        <div className="flex-1 min-w-0" ref={gridRef}>
          {view === 'month' ? (
            <MonthGrid
              days={days}
              cursor={cursor}
              today={today}
              blocksFor={blocksFor}
              hoverSlot={hoverSlot}
              dragging={!!drag}
              onOpenTodo={setOpenTodo}
              onOpenEntry={setOpenEntry}
              onCreate={createAt}
              justDragged={justDragged}
              onToggleDone={toggleTodo}
              onBlockContext={(x, y, ids) => setBlockMenu({ x, y, ...ids })}
              onDragTodo={(t) => setDrag({ kind: 'todo', id: t.id, label: t.title })}
              onDragEntry={(e) => setDrag({ kind: 'entry', id: e.id, label: e.title })}
            />
          ) : (
            <DayGrid
              days={days}
              today={today}
              blocksFor={blocksFor}
              hoverSlot={hoverSlot}
              dragging={!!drag}
              onOpenTodo={setOpenTodo}
              onOpenEntry={setOpenEntry}
              onCreate={createAt}
              justDragged={justDragged}
              onToggleDone={toggleTodo}
              onBlockContext={(x, y, ids) => setBlockMenu({ x, y, ...ids })}
              onDragTodo={(t) => setDrag({ kind: 'todo', id: t.id, label: t.title })}
              onDragEntry={(e) => setDrag({ kind: 'entry', id: e.id, label: e.title })}
            />
          )}
        </div>

        <Unscheduled
          todos={todos}
          lists={todoLists}
          dragging={drag?.kind === 'unscheduled' ? drag.id : null}
          dropActive={overUnscheduled}
          onDragStart={(id, label) => setDrag({ kind: 'unscheduled', id, label })}
          onOpen={setOpenTodo}
        />
      </div>

      {/* The item follows the cursor, so it is obvious what is being moved and
          where it would land. Pointer events pass through it, or it would sit
          under the cursor and hide the day being hovered. */}
      {drag && dragPoint && (
        <div
          className="fixed z-50 pointer-events-none px-2 py-1 rounded-md text-xs font-medium shadow-lg border max-w-[220px] truncate"
          style={{
            left: dragPoint.x + 12,
            top: dragPoint.y + 12,
            background: overUnscheduled ? 'var(--color-surface, #fff)' : '#1A5C3A',
            color: overUnscheduled ? '#dc2626' : '#fff',
            borderColor: overUnscheduled ? '#dc2626' : 'transparent',
          }}
        >
          {overUnscheduled ? `Unschedule: ${drag.label}` : drag.label}
        </div>
      )}

      {/* Right-click on a calendar item. "Remove" only exists for a todo,
          which lives in the todo list independently of the calendar; a
          calendar entry has nowhere else to be, so it is only deleted. */}
      {blockMenu && (() => {
        const bTodo = blockMenu.todoId ? todos.find((t) => t.id === blockMenu.todoId) : undefined
        const bEntry = blockMenu.entryId ? calendarEntries.find((e) => e.id === blockMenu.entryId) : undefined
        if (!bTodo && !bEntry) return null
        const act = (fn: () => void) => () => { fn(); setBlockMenu(null) }
        const pos = menuPos(blockMenu.x, blockMenu.y, bTodo ? 4 : 2)
        return (
          <>
            <div
              className="fixed inset-0 z-[60]"
              onClick={() => setBlockMenu(null)}
              onContextMenu={(e) => { e.preventDefault(); setBlockMenu(null) }}
            />
            <div
              className="fixed z-[61] w-48 py-1 bg-surface border border-border rounded-lg shadow-xl"
              style={{ left: pos.left, top: pos.top }}
            >
              <p className="px-3 py-1.5 text-[11px] text-text-subtle border-b border-border mb-1 truncate">
                {bTodo?.title ?? bEntry?.title}
              </p>

              {bTodo && (
                <button
                  onClick={act(() => toggleTodo(bTodo.id))}
                  className="w-full text-left px-3 py-1.5 text-xs text-text-main hover:bg-surface-2 transition-colors"
                >
                  {bTodo.isCompleted ? 'Mark as not done' : 'Mark as complete'}
                </button>
              )}

              <button
                onClick={act(() => (bTodo ? setOpenTodo(bTodo.id) : setOpenEntry(bEntry!.id)))}
                className="w-full text-left px-3 py-1.5 text-xs text-text-main hover:bg-surface-2 transition-colors"
              >
                Details
              </button>

              {bTodo && (
                <button
                  onClick={act(() => unscheduleTodo(bTodo.id))}
                  className="w-full text-left px-3 py-1.5 text-xs text-text-main hover:bg-surface-2 transition-colors"
                  title="Takes it off the calendar and back to the unscheduled list; the todo stays"
                >
                  Remove
                </button>
              )}

              <div className="h-px bg-border my-1" />
              <button
                onClick={act(() => {
                  if (bTodo) deleteTodo(bTodo.id)
                  else deleteCalendarEntry(bEntry!.id)
                })}
                className="w-full text-left px-3 py-1.5 text-xs text-danger hover:bg-surface-2 transition-colors"
              >
                Delete
              </button>
            </div>
          </>
        )
      })()}

      {(todo || entry) && (
        <CalendarItemPanel
          todo={todo}
          entry={entry}
          projectId={project.id}
          basePath={basePath}
          onClose={() => {
            setOpenTodo(null)
            setOpenEntry(null)
          }}
        />
      )}
    </div>
  )
}

/** Day and week share this: an hour ruler with absolutely positioned blocks. */
/**
 * Day and week views: one column per day, each holding that day's items in a
 * plain list. There is no hour grid — the calendar organises by day only.
 */
function DayGrid({
  days,
  today,
  blocksFor,
  hoverSlot,
  dragging,
  onOpenTodo,
  onOpenEntry,
  onCreate,
  justDragged,
  onToggleDone,
  onBlockContext,
  onDragTodo,
  onDragEntry,
}: {
  days: Date[]
  today: string
  blocksFor: (day: string) => Block[]
  hoverSlot: string | null
  dragging: boolean
  onOpenTodo: (id: string) => void
  onOpenEntry: (id: string) => void
  onCreate: (day: string) => void
  justDragged: React.MutableRefObject<boolean>
  onToggleDone: (todoId: string) => void
  onBlockContext: (x: number, y: number, ids: { todoId?: string; entryId?: string }) => void
  onDragTodo: (todo: ProjectTodo) => void
  onDragEntry: (entry: CalendarEntry) => void
}) {
  return (
    <div
      className="grid gap-px bg-border rounded-xl overflow-hidden border border-border"
      style={{ gridTemplateColumns: `repeat(${days.length}, minmax(0, 1fr))` }}
    >
      {days.map((day) => {
        const key = dayKey(day)
        return (
          <div key={`h-${key}`} className="bg-surface-2 px-2 py-2 text-center">
            <p className="text-[11px] text-text-muted">{format(day, 'EEE')}</p>
            <p
              className={`text-sm font-medium mt-0.5 w-6 h-6 mx-auto flex items-center justify-center rounded-full ${
                key === today ? 'bg-primary text-white' : 'text-text-main'
              }`}
            >
              {format(day, 'd')}
            </p>
          </div>
        )
      })}

      {days.map((day) => {
        const key = dayKey(day)
        const blocks = blocksFor(key)

        return (
          <div
            key={key}
            data-day={key}
            onClick={() => { if (!justDragged.current) onCreate(key) }}
            className={`bg-surface min-h-[320px] p-2 cursor-pointer transition-colors hover:bg-surface-2/40 ${
              dragging && hoverSlot === key ? 'ring-2 ring-primary ring-inset' : ''
            }`}
          >
            <div className="space-y-1">
              {blocks.map((b) => (
                <BlockChip
                  key={b.key}
                  block={b}
                  onOpen={() => (b.todo ? onOpenTodo(b.todo.id) : onOpenEntry(b.entry!.id))}
                  onDragStart={() => (b.todo ? onDragTodo(b.todo) : b.entry && onDragEntry(b.entry))}
                  onToggleDone={b.todo ? () => onToggleDone(b.todo!.id) : undefined}
                  onContext={(x, y) =>
                    onBlockContext(x, y, { todoId: b.todo?.id, entryId: b.entry?.id })
                  }
                />
              ))}
              {blocks.length === 0 && (
                <p className="text-[11px] text-text-subtle text-center pt-4">Nothing planned</p>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}

function MonthGrid({
  days,
  cursor,
  today,
  blocksFor,
  hoverSlot,
  dragging,
  onOpenTodo,
  onOpenEntry,
  onCreate,
  justDragged,
  onToggleDone,
  onBlockContext,
  onDragTodo,
  onDragEntry,
}: {
  days: Date[]
  cursor: Date
  today: string
  blocksFor: (day: string) => Block[]
  hoverSlot: string | null
  dragging: boolean
  onOpenTodo: (id: string) => void
  onOpenEntry: (id: string) => void
  onCreate: (day: string) => void
  justDragged: React.MutableRefObject<boolean>
  onToggleDone: (todoId: string) => void
  onBlockContext: (x: number, y: number, ids: { todoId?: string; entryId?: string }) => void
  onDragTodo: (todo: ProjectTodo) => void
  onDragEntry: (entry: CalendarEntry) => void
}) {
  return (
    <div className="grid grid-cols-7 gap-px bg-border rounded-xl overflow-hidden border border-border">
      {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => (
        <div key={d} className="bg-surface-2 px-2 py-1.5 text-[11px] font-medium text-text-muted text-center">
          {d}
        </div>
      ))}

      {days.map((day) => {
        const key = dayKey(day)
        const all = blocksFor(key)
        const outside = !isSameMonth(day, cursor)

        return (
          <div
            key={key}
            data-day={key}
            onClick={() => { if (!justDragged.current) onCreate(key) }}
            className={`bg-surface min-h-[112px] p-1.5 cursor-pointer transition-colors hover:bg-surface-2/40 ${
              outside ? 'opacity-40' : ''
            } ${dragging && hoverSlot === key ? 'ring-2 ring-primary ring-inset' : ''}`}
          >
            <div className="flex items-center justify-between mb-1">
              <span
                className={`text-[11px] w-5 h-5 flex items-center justify-center rounded-full ${
                  key === today ? 'bg-primary text-white font-semibold' : 'text-text-muted'
                }`}
              >
                {format(day, 'd')}
              </span>
            </div>

            <div className="space-y-1">
              {all.slice(0, 4).map((b) => (
                <BlockChip
                  key={b.key}
                  block={b}
                  compact
                  onOpen={() => (b.todo ? onOpenTodo(b.todo.id) : onOpenEntry(b.entry!.id))}
                  onDragStart={() => (b.todo ? onDragTodo(b.todo) : b.entry && onDragEntry(b.entry))}
                  onToggleDone={b.todo ? () => onToggleDone(b.todo!.id) : undefined}
                  onContext={(x, y) =>
                    onBlockContext(x, y, { todoId: b.todo?.id, entryId: b.entry?.id })
                  }
                />
              ))}
              {all.length > 4 && (
                <p className="text-[10px] text-text-subtle pl-1">+{all.length - 4} more</p>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}

/**
 * One item on the calendar. Dragging is pointer-based (not HTML5 DnD) so it
 * works identically in the desktop shell and gives us live snapping.
 */
function BlockChip({
  block,
  filled,
  compact,
  onOpen,
  onDragStart,
  onToggleDone,
  onContext,
}: {
  block: Block
  filled?: boolean
  compact?: boolean
  onOpen: () => void
  onDragStart: () => void
  onToggleDone?: () => void
  onContext?: (x: number, y: number) => void
}) {
  const moved = useRef(false)

  return (
    <div
      onPointerDown={(e) => {
        if (e.button !== 0) return
        e.stopPropagation()
        // Stops the browser starting a text selection on the block's label.
        e.preventDefault()
        moved.current = false
        const startX = e.clientX
        const startY = e.clientY

        const onMove = (ev: PointerEvent) => {
          if (moved.current) return
          if (Math.hypot(ev.clientX - startX, ev.clientY - startY) > 4) {
            moved.current = true
            onDragStart()
            window.removeEventListener('pointermove', onMove)
          }
        }
        window.addEventListener('pointermove', onMove)
        window.addEventListener(
          'pointerup',
          () => window.removeEventListener('pointermove', onMove),
          { once: true },
        )
      }}
      onClick={(e) => {
        e.stopPropagation()
        if (!moved.current) onOpen()
      }}
      onContextMenu={(e) => {
        if (!onContext) return
        e.preventDefault()
        e.stopPropagation()
        onContext(e.clientX, e.clientY)
      }}
      title={block.ownerName ? `${block.label} — ${block.ownerName}` : block.label}
      className={`relative rounded-md text-[11px] leading-tight truncate cursor-grab active:cursor-grabbing select-none shadow-sm ${
        compact ? 'px-1.5 py-1' : 'px-2 py-1 h-full overflow-hidden'
      } ${block.todo?.isCompleted ? 'line-through opacity-60' : ''}`}
      style={
        block.outlined
          ? { border: `1px solid ${block.color}66`, color: block.color }
          : filled
            ? {
                // color-mix keeps the tint while staying fully opaque, so the
                // hour rules behind the column do not show through the block.
                backgroundColor: `color-mix(in srgb, ${block.color} 14%, #FFFFFF)`,
                color: block.color,
                borderLeft: `3px solid ${block.color}`,
              }
            : { backgroundColor: `color-mix(in srgb, ${block.color} 12%, #FFFFFF)`, color: block.color }
      }
    >
      {onToggleDone && (
        <button
          onPointerDown={(e) => { e.stopPropagation(); moved.current = true }}
          onClick={(e) => { e.stopPropagation(); onToggleDone() }}
          className="float-left mr-1 mt-[1px] hover:opacity-100 opacity-70"
          title={block.todo?.isCompleted ? 'Mark as not done' : 'Mark as done'}
        >
          {block.todo?.isCompleted ? <CheckCircle2 size={11} /> : <Circle size={11} />}
        </button>
      )}
      {block.label}
      {/* Whose it is, when the team's calendars are overlaid on yours. */}
      {block.ownerName && (
        <span className="opacity-60"> · {block.ownerName}</span>
      )}

    </div>
  )
}

/** Todos with no do date — draggable straight onto the calendar. */
function Unscheduled({
  todos,
  lists,
  dragging,
  dropActive,
  onDragStart,
  onOpen,
}: {
  todos: ProjectTodo[]
  lists: { id: string; name: string }[]
  dragging: string | null
  /** True while a scheduled todo is being dragged over this panel. */
  dropActive?: boolean
  onDragStart: (id: string, label: string) => void
  onOpen: (id: string) => void
}) {
  // Only the main list, as asked — otherwise every list's backlog piles in here.
  const mainListId = lists[0]?.id ?? null
  const pending = todos.filter(
    (t) => !t.isCompleted && !t.doDate && (mainListId === null || t.listId === mainListId),
  )

  return (
    <aside
      data-unscheduled
      className={`w-60 flex-shrink-0 rounded-xl border bg-surface p-3 hidden lg:block transition-colors ${
        dropActive ? 'border-primary ring-2 ring-primary/30' : 'border-border'
      }`}
    >
      <h3 className="text-text-main font-medium text-sm flex items-center gap-1.5">
        <CalendarClock size={14} className="text-text-muted" />
        Not scheduled
      </h3>
      <p className="text-text-subtle text-[11px] mt-0.5 mb-3">
        {lists[0] ? `From "${lists[0].name}".` : ''} Drag onto a day to set its do
        date, or back here to unschedule it.
      </p>

      {dropActive && (
        <p className="text-[11px] text-primary font-medium mb-2">Drop to unschedule</p>
      )}

      {pending.length === 0 ? (
        <p className="text-xs text-text-subtle italic">Everything has a do date.</p>
      ) : (
        <div className="space-y-1.5 max-h-[60vh] overflow-y-auto">
          {pending.map((t) => (
            <div
              key={t.id}
              onPointerDown={(e) => {
                if (e.button !== 0) return
                onDragStart(t.id, t.title)
              }}
              onClick={() => onOpen(t.id)}
              className={`group flex items-start gap-1.5 p-2 rounded-lg border text-left cursor-grab active:cursor-grabbing transition-colors ${
                dragging === t.id
                  ? 'border-primary bg-primary-light'
                  : 'border-border bg-surface-2 hover:border-primary/40'
              }`}
            >
              <GripVertical size={12} className="text-text-subtle mt-0.5 flex-shrink-0" />
              <div className="min-w-0 flex-1">
                <p className="text-xs text-text-main leading-snug">{t.title}</p>
                {t.dueDate && <p className="text-[10px] text-danger mt-0.5">due {t.dueDate}</p>}
              </div>
            </div>
          ))}
        </div>
      )}
    </aside>
  )
}
