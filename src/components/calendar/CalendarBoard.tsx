import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ChevronLeft, ChevronRight, SlidersHorizontal, GripVertical, CalendarClock, Check,
  Circle, CheckCircle2, Timer, Users, X,
} from 'lucide-react'
import {
  addDays, addWeeks, format,
  startOfWeek, parseISO,
} from 'date-fns'
import { Project, ProjectTodo, CalendarEntry, Task } from '../../types'
import { useProjectStore } from '../../store/projectStore'
import { useTaskStore } from '../../store/taskStore'
import { useEmployeeStore } from '../../store/employeeStore'
import { useAuthStore } from '../../store/authStore'
import { isTaskDueOnDate } from '../../utils/taskScheduler'
import { personColor, todoOwner } from '../../lib/personColor'
import { CalendarItemPanel } from './CalendarItemPanel'
import { TaskPeekPanel } from './TaskPeekPanel'
import {
  KIND_STYLE, LAYERS, Layer, dayKey, dayDate, entryCoversDay,
} from './calendarShared'
import { useT } from '../../i18n/useT'

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
  /** An assigned task, on a day its frequency puts it on. */
  task?: Task
  /** Whose block this is, when other people's calendars are overlaid. */
  ownerName?: string
  /** For a task block: whose assignment this is, so it can be rescheduled. */
  employeeId?: string
  /** For a task block: whether that person has done it on the day shown. */
  done?: boolean
  /** Started but not finished, so it can be shown as under way. */
  started?: boolean
  /**
   * Something the person put on their own todo list, rather than work
   * assigned to them. Outlined in their colour on white, so at a glance a
   * week separates what they were given from what they took on.
   */
  ownWork?: boolean
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
  /**
   * Look, don't touch. A manager reading somebody else's week gets exactly the
   * board that person sees — the same blocks in the same colours — but cannot
   * add, move, tick or delete anything on it. Their calendar is theirs.
   */
  readOnly?: boolean
}

/**
 * The working calendar: todos on their do dates, alongside busy/working blocks.
 * One component for the managers' board and each employee's, so the planning
 * view is the same tool on both sides.
 */
export function CalendarBoard({ project, ownerId, basePath, readOnly = false }: CalendarBoardProps) {
  const { t } = useT()
  const {
    todos, todosLoadedFor, loadTodos, updateTodo,
    todoLists,
    toggleTodo, deleteTodo,
    calendarEntries, calendarLoadedFor, loadCalendar,
    createTodo, createTodoList,
    createCalendarEntry, updateCalendarEntry, deleteCalendarEntry,
    overlayTodos, loadOverlayTodos,
  } = useProjectStore()

  const {
    tasks, completeTask, uncompleteTask, isTaskCompleted,
    setInProgress, clearInProgress, isInProgress,
  } = useTaskStore()
  const { employees } = useEmployeeStore()
  const currentUserId = useAuthStore((s) => s.currentUser?.id)

  /**
   * Reading somebody else's board rather than your own. It matters for the
   * busy blocks: on your own board RLS has already decided what you may see,
   * and that is the right answer. Looking at an employee's board as the
   * manager, RLS is still *yours* — far broader — so without this the board
   * fills with entries that have nothing to do with them, on a page that says
   * it is their calendar.
   */
  const otherPersonsBoard = ownerId !== null && ownerId !== currentUserId

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
  // A task block used to open nothing: the handler only knew todos and
  // entries, so clicking assigned work silently did nothing at all.
  const [openTask, setOpenTask] = useState<string | null>(null)
  const [error, setError] = useState('')
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
  const [dayMenu, setDayMenu] = useState<{ x: number; y: number; day: string } | null>(null)
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
  // Both ranges roll around the cursor rather than snapping to a calendar
  // week or month. Work does not stop on a Sunday, and a calendar month spends
  // half its width on days that have already gone: what matters is the days
  // either side of now, with yesterday kept in view because unfinished work
  // does not disappear overnight.
  const days = useMemo(() => {
    if (view === 'day') return [cursor]

    // Yesterday, today, and the next five days.
    if (view === 'week') {
      return Array.from({ length: 7 }, (_, i) => addDays(cursor, i - 1))
    }

    // Last week, this week, and the two ahead — whole weeks, so the columns
    // still line up under Mon–Sun.
    const first = addWeeks(startOfWeek(cursor, { weekStartsOn: 1 }), -1)
    const out: Date[] = []
    for (let i = 0; i < 28; i++) out.push(addDays(first, i))
    return out
  }, [view, cursor])

  // Move by what is on screen: a week of days, or the four weeks the month
  // view now shows.
  const step = (dir: 1 | -1) => {
    if (view === 'day') setCursor((c) => addDays(c, dir))
    else if (view === 'week') setCursor((c) => addDays(c, 7 * dir))
    else setCursor((c) => addWeeks(c, 4 * dir))
  }

  // The lists on this board. The store holds whatever was loaded last, so
  // without this the panel can be handed another owner's lists.
  const boardLists = useMemo(
    () => todoLists.filter((l) => l.projectId === project.id && (l.ownerId ?? null) === ownerId),
    [todoLists, project.id, ownerId],
  )

  // ── Blocks per day ───────────────────────────────────────────────────────
  // The calendar is organised by day: everything on a day is one flat list,
  // in the order it was added to it.
  const blocksFor = useCallback(
    (day: string): Block[] => {
      const blocks: Block[] = []

      if (visible('do')) {
        for (const t of todos) {
          if (t.doDate !== day) continue
          // Whose board this is. The fetch is scoped, but the store holds
          // whatever was loaded last, so opening the managers' board and then
          // an employee's calendar put the manager's todos on it.
          if ((t.ownerId ?? null) !== ownerId) continue
          blocks.push({
            key: `todo-${t.id}`,
            label: t.title,
            color: personColor(todoOwner(t) ?? ownerId),
            ownWork: true,
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
            color: personColor(todoOwner(t)),
            ownWork: true,
            todo: t,
            ownerName: employees.find((e) => e.id === t.ownerId)?.name,
          })
        }
      }

      // Assigned work belongs on the calendar too, otherwise an employee has
      // to hold two lists in their head. Shown on the day it is planned for;
      // if nobody has planned it, on the days its recurrence puts it on, so
      // it is not invisible.
      const scheduleOwners = canOverlay ? [...overlaid] : [ownerId!]
      if (visible('do')) for (const empIdForCal of scheduleOwners) {
        const who = employees.find((e) => e.id === empIdForCal)
        for (const task of tasks) {
          if (!task.isActive || !task.assignedTo.includes(empIdForCal)) continue

          if (!isTaskDueOnDate(task, empIdForCal, parseISO(day))) continue

          // One kind of task block now. There used to be two — the work on
          // its do date, and a faded red marker on its deadline — and a task
          // with both put the same title on the calendar twice, in two
          // colours, meaning two different things. Every day a task appears
          // on is a day it is meant to be worked on.
          blocks.push({
            key: `task-${task.id}-${empIdForCal}`,
            label: task.title,
            color: personColor(empIdForCal),
            task,
            employeeId: empIdForCal,
            // The day it is shown on is the day it counts for: a recurring
            // task is done again each time it comes round.
            done: isTaskCompleted(task.id, empIdForCal, day),
            started: isInProgress(task.id, empIdForCal, day),
            ownerName: canOverlay ? who?.name : undefined,
          })
        }
      }

      for (const e of calendarEntries) {
        if (!visible(e.kind)) continue
        if (!entryCoversDay(e, day)) continue
        // On someone else's board, only their own blocks belong on it.
        if (otherPersonsBoard && e.ownerId !== ownerId) continue
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
    [todos, overlayTodos, calendarEntries, hidden, tasks, employees, overlaid, ownerId, canOverlay, otherPersonsBoard],
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
  /**
   * Clicking an empty day adds a todo on it, not a busy block: planning work
   * is what this calendar is for, and a "Busy" entry was almost never what
   * anyone meant. Blocking time out is still there, on the day's own menu.
   */
  const createAt = async (day: string) => {
    if (readOnly) return
    setError('')
    try {
      // A todo has to live in a list. Falling back to making one beats
      // refusing the click on a project whose board is still empty.
      let listId: string | undefined = todoLists[0]?.id
      if (!listId) {
        const made = await createTodoList(project.id, 'To do', ownerId)
        listId = made?.id
      }
      if (!listId) {
        setError(t('err_noList'))
        return
      }

      const created = await createTodo(
        project.id,
        { title: 'New todo', listId, doDate: day },
        ownerId,
      )
      if (created) setOpenTodo(created.id)
    } catch (e) {
      setError((e as Error).message || 'That could not be added.')
    }
  }

  /** Clicking a date opens that day on its own, which is what someone is
   *  asking for when they click it in a week or a month. */
  /**
   * Tick an assigned task off from the calendar. A todo is simply toggled; a
   * task is completed for one person on one day, so it needs both.
   */
  const toggleTaskDone = async (taskId: string, employeeId: string, day: string) => {
    if (readOnly) return
    setError('')
    try {
      // The same three states as My Tasks, in the same order: not started,
      // started, done. Ticking here and ticking there are the same action on
      // the same record — the calendar is another view of the task, not a
      // separate thing that happens to look like one.
      if (isTaskCompleted(taskId, employeeId, day)) {
        // Done -> back to the beginning.
        await uncompleteTask(taskId, employeeId, day)
        await clearInProgress(taskId, employeeId, day)
      } else if (isInProgress(taskId, employeeId, day)) {
        // Started -> done. Completing supersedes the started flag, so it is
        // cleared rather than left behind to reappear on un-completing.
        await completeTask(taskId, employeeId, day)
      } else {
        // Not started -> started.
        await setInProgress(taskId, employeeId, day)
      }
    } catch (e) {
      setError((e as Error).message || 'That could not be updated.')
    }
  }

  const openDay = (day: Date) => {
    setCursor(day)
    setView('day')
  }

  /** Blocking time out, which the day menu still offers. */
  const createEntryAt = async (day: string) => {
    if (readOnly) return
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

  // Says what is on screen. The month view no longer shows one month, so
  // naming a month would be a lie.
  const title =
    view === 'day'
      ? format(cursor, 'EEEE d MMMM yyyy')
      : days.length > 0
        ? `${format(days[0], 'd MMM')} – ${format(days[days.length - 1], 'd MMM yyyy')}`
        : format(cursor, 'MMMM yyyy')

  return (
    // Fills the window less the chrome above it and a margin below, so the
    // grid reaches down the page without running into the bottom edge.
    // min-h-0 on the row below is what lets a flex child shrink and scroll.
    <div className="animate-fade-in flex flex-col h-[calc(100vh-11rem)] min-h-[30rem] mb-6">
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
          >{t('ui_today')}</button>
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
              title={t('cal_showOrHideTypes')}
            >
              <SlidersHorizontal size={13} />
              {hidden.size > 0 ? `${LAYERS.length - hidden.size}/${LAYERS.length}` : 'Filter'}
            </button>

            {/* Whose weeks to show alongside your own. This used to live inside
                the type filter, where nothing suggested the team was in it. */}
            {canOverlay && (
              <>
                <button
                  onClick={() => setTeamOpen((v) => !v)}
                  className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-md border text-xs font-medium transition-colors ${
                    overlaid.size > 0
                      ? 'bg-primary-light border-primary/30 text-primary'
                      : 'bg-surface border-border text-text-muted hover:text-text-main'
                  }`}
                  title={t('cal_showAColleagueSCalendarAlongside')}
                >
                  <Users size={13} />
                  {overlaid.size > 0 ? `${overlaid.size} shown` : 'Team'}
                </button>

                {teamOpen && (
                  <>
                    <div className="fixed inset-0 z-40" onClick={() => setTeamOpen(false)} />
                    <div className="absolute right-0 top-full mt-1 z-50 w-56 py-1.5 bg-surface border border-border rounded-lg shadow-xl">
                      <p className="px-3 py-1 text-[10px] font-semibold uppercase tracking-wide text-text-subtle">{t('cal_showAlongsideYours')}</p>
                      {employees.length === 0 && (
                        <p className="px-3 py-2 text-xs text-text-subtle">
                          Nobody is on this project yet. Add someone on the Team
                          tab and their week will show up here.
                        </p>
                      )}
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
                          >{t('cal_showOnlyMine')}</button>
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
                    >{t('cal_showEverything')}</button>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      <div className="flex gap-4 items-stretch flex-1 min-h-0">
        <div className="flex-1 min-w-0 flex flex-col min-h-0" ref={gridRef}>
          {view === 'month' ? (
            <MonthGrid
              days={days}
              today={today}
              readOnly={readOnly}
              blocksFor={blocksFor}
              hoverSlot={hoverSlot}
              dragging={!!drag}
              onOpenTodo={setOpenTodo}
              onOpenEntry={setOpenEntry}
              onOpenTask={setOpenTask}
              onCreate={createAt}
              onOpenDay={openDay}
              onDayContext={(x, y, day) => setDayMenu({ x, y, day })}
              justDragged={justDragged}
              onToggleDone={toggleTodo}
              onToggleTask={toggleTaskDone}
              onBlockContext={(x, y, ids) => setBlockMenu({ x, y, ...ids })}
              onDragTodo={(t) => setDrag({ kind: 'todo', id: t.id, label: t.title })}
              onDragEntry={(e) => setDrag({ kind: 'entry', id: e.id, label: e.title })}
            />
          ) : (
            <DayGrid
              days={days}
              today={today}
              readOnly={readOnly}
              blocksFor={blocksFor}
              hoverSlot={hoverSlot}
              dragging={!!drag}
              onOpenTodo={setOpenTodo}
              onOpenEntry={setOpenEntry}
              onOpenTask={setOpenTask}
              onCreate={createAt}
              onOpenDay={openDay}
              onDayContext={(x, y, day) => setDayMenu({ x, y, day })}
              justDragged={justDragged}
              onToggleDone={toggleTodo}
              onToggleTask={toggleTaskDone}
              onBlockContext={(x, y, ids) => setBlockMenu({ x, y, ...ids })}
              onDragTodo={(t) => setDrag({ kind: 'todo', id: t.id, label: t.title })}
              onDragEntry={(e) => setDrag({ kind: 'entry', id: e.id, label: e.title })}
            />
          )}
        </div>

        <Unscheduled
          todos={todos}
          lists={boardLists}
          readOnly={readOnly}
          dragging={drag?.kind === 'unscheduled' ? drag.id : null}
          dropActive={overUnscheduled}
          onDragStart={(id, label) => setDrag({ kind: 'unscheduled', id, label })}
          onOpen={setOpenTodo}
          onToggleDone={toggleTodo}
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
      {dayMenu && (() => {
        const pos = menuPos(dayMenu.x, dayMenu.y, 1)
        return (
          <>
            <div className="fixed inset-0 z-40" onClick={() => setDayMenu(null)} />
            <div
              className="fixed z-50 w-44 py-1 bg-surface border border-border rounded-lg shadow-xl"
              style={{ left: pos.left, top: pos.top }}
            >
              <button
                onClick={() => { createEntryAt(dayMenu.day); setDayMenu(null) }}
                className="w-full text-left px-3 py-1.5 text-xs text-text-main hover:bg-surface-2 transition-colors"
              >
                {t('cal_blockTimeOut')}
              </button>
            </div>
          </>
        )
      })()}

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
              >{t('cal_details')}</button>

              {bTodo && (
                <button
                  onClick={act(() => unscheduleTodo(bTodo.id))}
                  className="w-full text-left px-3 py-1.5 text-xs text-text-main hover:bg-surface-2 transition-colors"
                  title={t('cal_takesItOffTheCalendarAnd')}
                >{t('ui_remove')}</button>
              )}

              <div className="h-px bg-border my-1" />
              <button
                onClick={act(() => {
                  if (bTodo) deleteTodo(bTodo.id)
                  else deleteCalendarEntry(bEntry!.id)
                })}
                className="w-full text-left px-3 py-1.5 text-xs text-danger hover:bg-surface-2 transition-colors"
              >{t('ui_delete')}</button>
            </div>
          </>
        )
      })()}

      {error && (
        <div className="fixed bottom-5 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2 px-3 py-2 rounded-lg bg-danger-bg border border-danger/30 text-danger text-xs shadow-lg">
          {error}
          <button onClick={() => setError('')} className="hover:opacity-70">
            <X size={12} />
          </button>
        </div>
      )}

      {openTask && (() => {
        const t = tasks.find((x) => x.id === openTask)
        return t ? (
          <TaskPeekPanel task={t} basePath={basePath} onClose={() => setOpenTask(null)} />
        ) : null
      })()}

      {(todo || entry) && (
        <CalendarItemPanel
          todo={todo}
          entry={entry}
          projectId={project.id}
          basePath={basePath}
          readOnly={readOnly}
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
  readOnly,
  blocksFor,
  hoverSlot,
  dragging,
  onOpenTodo,
  onOpenEntry,
  onOpenTask,
  onCreate,
  onOpenDay,
  onDayContext,
  justDragged,
  onToggleDone,
  onToggleTask,
  onBlockContext,
  onDragTodo,
  onDragEntry,
}: {
  days: Date[]
  today: string
  readOnly?: boolean
  blocksFor: (day: string) => Block[]
  hoverSlot: string | null
  dragging: boolean
  onOpenTodo: (id: string) => void
  onOpenEntry: (id: string) => void
  onOpenTask: (id: string) => void
  onCreate: (day: string) => void
  onOpenDay: (day: Date) => void
  onDayContext: (x: number, y: number, day: string) => void
  justDragged: React.MutableRefObject<boolean>
  onToggleDone: (todoId: string) => void
  onToggleTask: (taskId: string, employeeId: string, day: string) => void
  onBlockContext: (x: number, y: number, ids: { todoId?: string; entryId?: string }) => void
  onDragTodo: (todo: ProjectTodo) => void
  onDragEntry: (entry: CalendarEntry) => void
}) {
  const { t } = useT()
  return (
    // Two rows: the day names at their natural height, and the days taking
    // everything left over. Without the explicit rows the grid sizes itself
    // to its content and the cells cannot be told to fill or to scroll.
    <div
      className="grid gap-px bg-border rounded-xl overflow-hidden border border-border flex-1 min-h-0"
      style={{
        gridTemplateColumns: `repeat(${days.length}, minmax(0, 1fr))`,
        gridTemplateRows: 'auto minmax(0, 1fr)',
      }}
    >
      {days.map((day) => {
        const key = dayKey(day)
        return (
          <button
            key={`h-${key}`}
            onClick={() => onOpenDay(day)}
            title={`Open ${format(day, 'EEEE d MMMM')}`}
            className="bg-surface-2 px-2 py-2 text-center hover:bg-surface transition-colors"
          >
            <p className="text-[11px] text-text-muted">{format(day, 'EEE')}</p>
            <p
              className={`text-sm font-medium mt-0.5 w-6 h-6 mx-auto flex items-center justify-center rounded-full ${
                key === today ? 'bg-primary text-white' : 'text-text-main'
              }`}
            >
              {format(day, 'd')}
            </p>
          </button>
        )
      })}

      {days.map((day) => {
        const key = dayKey(day)
        const blocks = blocksFor(key)

        return (
          <div
            key={key}
            data-day={key}
            onClick={() => { if (!readOnly && !justDragged.current) onCreate(key) }}
            onContextMenu={(e) => {
              if (readOnly) return
              e.preventDefault()
              onDayContext(e.clientX, e.clientY, key)
            }}
            className={`bg-surface p-2 transition-colors min-h-0 overflow-y-auto ${
              readOnly ? '' : 'cursor-pointer hover:bg-surface-2/40'
            } ${dragging && hoverSlot === key ? 'ring-2 ring-primary ring-inset' : ''}`}
          >
            {/* Scrolls within the day rather than stretching it, so one busy
                day does not set the height of the whole week. */}
            <div className="space-y-1.5">
              {blocks.map((b) => (
                <BlockChip
                  key={b.key}
                  block={b}
                  onOpen={() =>
                    b.todo
                      ? onOpenTodo(b.todo.id)
                      : b.task
                        ? onOpenTask(b.task.id)
                        : onOpenEntry(b.entry!.id)
                  }
                  onDragStart={
                    // Only todos and time blocks are dragged. An assigned
                    // task's day comes from the schedule it was given, and
                    // dragging it used to clear that do_date, which moved the
                    // block somewhere nobody asked for. It is ticked, not
                    // moved; rescheduling it is the task manager's job.
                    readOnly
                      ? undefined
                      : b.todo
                        ? () => onDragTodo(b.todo!)
                        : b.entry
                          ? () => onDragEntry(b.entry!)
                          : undefined
                  }
                  onToggleDone={
                    readOnly
                      ? undefined
                      : b.todo
                        ? () => onToggleDone(b.todo!.id)
                        : b.task && b.employeeId
                          ? () => onToggleTask(b.task!.id, b.employeeId!, key)
                          : undefined
                  }
                  onContext={
                    readOnly
                      ? undefined
                      : (x, y) => onBlockContext(x, y, { todoId: b.todo?.id, entryId: b.entry?.id })
                  }
                />
              ))}
              {blocks.length === 0 && (
                <p className="text-[11px] text-text-subtle text-center pt-4">{t('cal_nothingPlanned')}</p>
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
  today,
  readOnly,
  blocksFor,
  hoverSlot,
  dragging,
  onOpenTodo,
  onOpenEntry,
  onOpenTask,
  onCreate,
  onOpenDay,
  onDayContext,
  justDragged,
  onToggleDone,
  onToggleTask,
  onBlockContext,
  onDragTodo,
  onDragEntry,
}: {
  days: Date[]
  today: string
  readOnly?: boolean
  blocksFor: (day: string) => Block[]
  hoverSlot: string | null
  dragging: boolean
  onOpenTodo: (id: string) => void
  onOpenEntry: (id: string) => void
  onOpenTask: (id: string) => void
  onCreate: (day: string) => void
  onOpenDay: (day: Date) => void
  onDayContext: (x: number, y: number, day: string) => void
  justDragged: React.MutableRefObject<boolean>
  onToggleDone: (todoId: string) => void
  onToggleTask: (taskId: string, employeeId: string, day: string) => void
  onBlockContext: (x: number, y: number, ids: { todoId?: string; entryId?: string }) => void
  onDragTodo: (todo: ProjectTodo) => void
  onDragEntry: (entry: CalendarEntry) => void
}) {
  return (
    <div
      className="grid grid-cols-7 gap-px bg-border rounded-xl overflow-hidden border border-border flex-1 min-h-0"
      style={{ gridTemplateRows: 'auto repeat(4, minmax(0, 1fr))' }}
    >
      {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => (
        <div key={d} className="bg-surface-2 px-2 py-1.5 text-[11px] font-medium text-text-muted text-center">
          {d}
        </div>
      ))}

      {days.map((day) => {
        const key = dayKey(day)
        const all = blocksFor(key)
        // The past is dimmed, not "another month": the grid spans four weeks
        // around now and no longer follows a calendar month at all.
        const outside = key < today

        return (
          <div
            key={key}
            data-day={key}
            onClick={() => { if (!readOnly && !justDragged.current) onCreate(key) }}
            onContextMenu={(e) => {
              if (readOnly) return
              e.preventDefault()
              onDayContext(e.clientX, e.clientY, key)
            }}
            className={`bg-surface min-h-[112px] p-1.5 transition-colors overflow-y-auto ${
              readOnly ? '' : 'cursor-pointer hover:bg-surface-2/40'
            } ${outside ? 'opacity-40' : ''} ${
              dragging && hoverSlot === key ? 'ring-2 ring-primary ring-inset' : ''
            }`}
          >
            <div className="flex items-center justify-between mb-1">
              <button
                onClick={(e) => { e.stopPropagation(); onOpenDay(day) }}
                title={`Open ${format(day, 'EEEE d MMMM')}`}
                className={`text-[11px] w-5 h-5 flex items-center justify-center rounded-full transition-colors ${
                  key === today
                    ? 'bg-primary text-white font-semibold'
                    : 'text-text-muted hover:bg-surface-2 hover:text-text-main'
                }`}
              >
                {format(day, 'd')}
              </button>
            </div>

            <div className="space-y-1">
              {all.map((b) => (
                <BlockChip
                  key={b.key}
                  block={b}
                  compact
                  onOpen={() =>
                    b.todo
                      ? onOpenTodo(b.todo.id)
                      : b.task
                        ? onOpenTask(b.task.id)
                        : onOpenEntry(b.entry!.id)
                  }
                  onDragStart={
                    // Only todos and time blocks are dragged. An assigned
                    // task's day comes from the schedule it was given, and
                    // dragging it used to clear that do_date, which moved the
                    // block somewhere nobody asked for. It is ticked, not
                    // moved; rescheduling it is the task manager's job.
                    readOnly
                      ? undefined
                      : b.todo
                        ? () => onDragTodo(b.todo!)
                        : b.entry
                          ? () => onDragEntry(b.entry!)
                          : undefined
                  }
                  onToggleDone={
                    readOnly
                      ? undefined
                      : b.todo
                        ? () => onToggleDone(b.todo!.id)
                        : b.task && b.employeeId
                          ? () => onToggleTask(b.task!.id, b.employeeId!, key)
                          : undefined
                  }
                  onContext={
                    readOnly
                      ? undefined
                      : (x, y) => onBlockContext(x, y, { todoId: b.todo?.id, entryId: b.entry?.id })
                  }
                />
              ))}
              {/* No "+N more" count: the cell scrolls, so everything on the
                  day is reachable without leaving the month view. */}
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
  compact,
  onOpen,
  onDragStart,
  onToggleDone,
  onContext,
}: {
  block: Block
  compact?: boolean
  onOpen: () => void
  /** Absent on a board that is only being read: the block cannot be moved. */
  onDragStart?: () => void
  onToggleDone?: () => void
  onContext?: (x: number, y: number) => void
}) {
  const { t } = useT()
  const moved = useRef(false)

  return (
    <div
      onPointerDown={(e) => {
        if (e.button !== 0) return
        e.stopPropagation()
        // Stops the browser starting a text selection on the block's label.
        e.preventDefault()
        moved.current = false
        // Nothing to drag on a read-only board; the stopPropagation above is
        // still wanted, so that clicking a block does not also hit the day.
        if (!onDragStart) return
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
      className={`relative rounded-md text-xs leading-snug select-none shadow-sm ${
        onDragStart ? 'cursor-grab active:cursor-grabbing' : 'cursor-pointer'
      } ${
        // Month cells stay tight — there are 28 of them on screen. A week or
        // a day has the room, and 11px text in a 1-unit padding was a sliver
        // that was hard to read and harder to hit.
        compact ? 'px-1.5 py-1 text-[11px]' : 'px-2.5 py-2'
      } ${
        // Done work fades and strikes through, whichever kind it is.
        block.todo?.isCompleted || block.done ? 'line-through opacity-45' : ''
      }`}
      style={
        block.ownWork
          ? // Their own todo: outlined in their colour on white, at full
            // strength. Assigned work is filled, so the two are told apart
            // by whether the colour is inside the block or around it —
            // which reads at a glance across a week without needing a key.
            {
              border: `2px solid ${block.color}`,
              color: block.color,
              backgroundColor: '#FFFFFF',
            }
          : // Scheduled work, in the person's colour exactly as it is — no
            // mix into white. Diluting it made every block a pale wash and
            // two people's work hard to tell apart at a glance. White text
            // is what makes the solid colour readable.
            {
              backgroundColor: block.color,
              color: '#FFFFFF',
              // Under way but not finished: a lighter edge, so started work
              // is visibly different from untouched work without changing
              // whose colour it is.
              boxShadow: block.started ? 'inset 0 0 0 2px rgba(255,255,255,0.65)' : undefined,
            }
      }
    >
      {/* A row rather than floats: the label now wraps to two lines, and a
          floated button beside a clamped block does not line up. */}
      <div className="flex items-start gap-1.5">
        {onToggleDone && (
          <button
            onPointerDown={(e) => { e.stopPropagation(); moved.current = true }}
            onClick={(e) => { e.stopPropagation(); onToggleDone() }}
            className="flex-shrink-0 mt-[1px] hover:opacity-100 opacity-80"
            title={block.todo?.isCompleted || block.done ? t('cal_markNotDone') : t('cal_markDone')}
          >
            {block.todo?.isCompleted || block.done ? (
              <CheckCircle2 size={15} />
            ) : block.started ? (
              // Under way, the same timer My Tasks shows, so ticking once
              // says something visible rather than appearing to do nothing.
              <Timer size={15} />
            ) : (
              <Circle size={15} />
            )}
          </button>
        )}
        <span className="min-w-0 flex-1">
          {/* Two lines before it clips: one line cut most titles mid-word,
              and a calendar box has the room now. */}
          <span className="line-clamp-2 break-words">{block.label}</span>
          {/* Whose it is, when the team's calendars are overlaid on yours. */}
          {block.ownerName && (
            <span className="opacity-60"> · {block.ownerName}</span>
          )}
        </span>
      </div>
    </div>
  )
}

/** Todos with no do date — draggable straight onto the calendar. */
function Unscheduled({
  todos,
  lists,
  readOnly,
  dragging,
  dropActive,
  onDragStart,
  onOpen,
  onToggleDone,
}: {
  todos: ProjectTodo[]
  lists: { id: string; name: string }[]
  readOnly?: boolean
  dragging: string | null
  /** True while a scheduled todo is being dragged over this panel. */
  dropActive?: boolean
  onDragStart: (id: string, label: string) => void
  onOpen: (id: string) => void
  onToggleDone: (id: string) => void
}) {
  // `t` is the todo inside the list below, so the translator is `tr` here.
  const { t: tr } = useT()
  // Everything on this board that has no day yet.
  //
  // This used to show only lists[0], which meant a todo added to any other
  // tab never appeared here — and lists[0] was whichever list the store had
  // loaded first, not necessarily one on this board at all. The point of the
  // panel is that nothing waiting to be scheduled is invisible, so it reads
  // every list rather than one.
  const listIds = new Set(lists.map((l) => l.id))
  const pending = todos.filter(
    (t) =>
      !t.isCompleted &&
      !t.doDate &&
      (t.listId === null || listIds.size === 0 || listIds.has(t.listId)),
  )

  return (
    <aside
      data-unscheduled
      className={`w-60 flex-shrink-0 rounded-xl border bg-surface p-3 hidden lg:flex lg:flex-col min-h-0 transition-colors ${
        dropActive ? 'border-primary ring-2 ring-primary/30' : 'border-border'
      }`}
    >
      <h3 className="text-text-main font-medium text-sm flex items-center gap-1.5 flex-shrink-0">
        <CalendarClock size={14} className="text-text-muted" />{tr('cal_notScheduled')}</h3>
      <p className="text-text-subtle text-[11px] mt-0.5 mb-3 flex-shrink-0">{tr('cal_unscheduledHint')}</p>

      {dropActive && (
        <p className="text-[11px] text-primary font-medium mb-2">{tr('cal_dropToUnschedule')}</p>
      )}

      {pending.length === 0 ? (
        <p className="text-xs text-text-subtle italic">{tr('cal_everythingHasADoDate')}</p>
      ) : (
        <div className="space-y-1.5 flex-1 min-h-0 overflow-y-auto">
          {pending.map((t) => (
            <div
              key={t.id}
              onPointerDown={(e) => {
                if (readOnly || e.button !== 0) return
                onDragStart(t.id, t.title)
              }}
              onClick={() => onOpen(t.id)}
              className={`group flex items-start gap-1.5 p-2 rounded-lg border-2 text-left transition-colors ${
                readOnly ? 'cursor-pointer' : 'cursor-grab active:cursor-grabbing'
              } ${dragging === t.id ? 'bg-primary-light' : 'bg-surface hover:brightness-95'}`}
              // Their colour, outlined, exactly as the same todo looks once
              // it has a day — so dragging it onto the calendar changes where
              // it is and nothing else about it.
              style={{ borderColor: personColor(todoOwner(t)) }}
            >
              {!readOnly && (
                <GripVertical size={12} className="text-text-subtle mt-0.5 flex-shrink-0" />
              )}
              {/* Ticking it off here: something can be finished without ever
                  having been given a day. */}
              {!readOnly && (
                <button
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={(e) => { e.stopPropagation(); onToggleDone(t.id) }}
                  title={tr('cal_markDone')}
                  className="text-text-subtle hover:text-success mt-0.5 flex-shrink-0"
                >
                  <Circle size={12} />
                </button>
              )}
              <div className="min-w-0 flex-1">
                <p className="text-xs text-text-main leading-snug">{t.title}</p>
              </div>
            </div>
          ))}
        </div>
      )}
    </aside>
  )
}
