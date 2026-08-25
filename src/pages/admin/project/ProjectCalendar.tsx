import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useOutletContext } from 'react-router-dom'
import {
  ChevronLeft, ChevronRight, SlidersHorizontal, GripVertical, CalendarClock, Check,
  Circle, CheckCircle2,
} from 'lucide-react'
import {
  addDays, addMonths, addWeeks, endOfMonth, endOfWeek, format, isSameMonth,
  startOfMonth, startOfWeek,
} from 'date-fns'
import { Project, ProjectTodo, CalendarEntry } from '../../../types'
import { useProjectStore } from '../../../store/projectStore'
import { CalendarItemPanel } from '../../../components/calendar/CalendarItemPanel'
import {
  KIND_STYLE, LAYERS, Layer, DAY_START_HOUR, DAY_END_HOUR, HOUR_HEIGHT,
  dayKey, atTime, minutesToOffset, offsetToMinutes, snap15, minutesToTime,
  todoMinutes, entryMinutes, layoutColumns,
} from '../../../components/calendar/calendarShared'

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
type DragState =
  | { kind: 'todo'; id: string; grabMinutes: number; durationMinutes: number | null }
  | { kind: 'entry'; id: string; grabMinutes: number; durationMinutes: number }
  | { kind: 'unscheduled'; id: string }
  // Dragging an edge changes the duration instead of moving the block.
  | {
      kind: 'resize'
      target: 'todo' | 'entry'
      id: string
      edge: 'start' | 'end'
      otherEdgeMinutes: number
    }

interface Block {
  key: string
  start: number
  end: number
  label: string
  color: string
  outlined?: boolean
  todo?: ProjectTodo
  entry?: CalendarEntry
  allDay?: boolean
}

export function ProjectCalendar() {
  const { project } = useOutletContext<{ project: Project }>()
  const {
    todos, todosLoadedFor, loadTodos, updateTodo,
    todoLists,
    toggleTodo, deleteTodo,
    calendarEntries, calendarLoadedFor, loadCalendar,
    createCalendarEntry, updateCalendarEntry, deleteCalendarEntry,
  } = useProjectStore()

  const [view, setView] = useState<View>('week')
  const [cursor, setCursor] = useState(() => new Date())
  const [hidden, setHidden] = useState<Set<Layer>>(new Set())
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [openTodo, setOpenTodo] = useState<string | null>(null)
  const [openEntry, setOpenEntry] = useState<string | null>(null)
  const [drag, setDrag] = useState<DragState | null>(null)
  const [hoverSlot, setHoverSlot] = useState<{ day: string; minutes: number } | null>(null)
  // Set when a drag ends, so the click event that follows the pointerup does
  // not also fire "create an entry here".
  const justDragged = useRef(false)
  // Right-click on a block: complete it, take it off the calendar, or delete.
  const [blockMenu, setBlockMenu] = useState<
    { x: number; y: number; todoId?: string; entryId?: string } | null
  >(null)
  const gridRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (todosLoadedFor !== project.id) loadTodos(project.id)
    if (calendarLoadedFor !== project.id) loadCalendar(project.id)
  }, [project.id, todosLoadedFor, calendarLoadedFor, loadTodos, loadCalendar])

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
  const blocksFor = useCallback(
    (day: string): { timed: Block[]; allDay: Block[] } => {
      const timed: Block[] = []
      const allDay: Block[] = []

      if (visible('do')) {
        for (const t of todos) {
          if (t.doDate !== day) continue
          const mins = todoMinutes(t)
          const block: Block = {
            key: `todo-${t.id}`,
            start: mins?.start ?? 0,
            end: mins?.end ?? 0,
            label: t.title,
            color: '#1A5C3A',
            todo: t,
            allDay: !mins,
          }
          if (mins) timed.push(block)
          else allDay.push(block)
        }
      }

      if (visible('due')) {
        for (const t of todos) {
          if (t.dueDate !== day || t.isCompleted) continue
          if (t.doDate === day) continue // already shown as a do-date block
          allDay.push({
            key: `due-${t.id}`,
            start: 0,
            end: 0,
            label: `Due: ${t.title}`,
            color: '#dc2626',
            outlined: true,
            todo: t,
            allDay: true,
          })
        }
      }

      for (const e of calendarEntries) {
        if (!visible(e.kind)) continue
        const s = new Date(e.startsAt)
        const en = new Date(e.endsAt)
        const dayStart = atTime(day, '00:00')
        const dayEnd = new Date(dayStart.getTime() + 864e5)
        if (en <= dayStart || s >= dayEnd) continue

        const block: Block = {
          key: `entry-${e.id}`,
          start: 0,
          end: 0,
          label: e.title,
          color: KIND_STYLE[e.kind].color,
          entry: e,
          allDay: e.allDay,
        }
        if (e.allDay) {
          allDay.push(block)
        } else {
          const m = entryMinutes(e, day)
          timed.push({ ...block, start: m.start, end: m.end })
        }
      }

      return { timed, allDay }
    },
    [todos, calendarEntries, hidden],
  )

  // ── Dragging ─────────────────────────────────────────────────────────────
  /** Screen point → the day column and minute it falls in. */
  const slotAt = useCallback(
    (clientX: number, clientY: number): { day: string; minutes: number } | null => {
      const el = document.elementFromPoint(clientX, clientY)?.closest('[data-day]') as HTMLElement | null
      if (!el) return null
      const day = el.dataset.day!
      if (view === 'month') return { day, minutes: -1 }
      const rect = el.getBoundingClientRect()
      const minutes = snap15(offsetToMinutes(clientY - rect.top))
      return { day, minutes: Math.max(DAY_START_HOUR * 60, Math.min(DAY_END_HOUR * 60 - 15, minutes)) }
    },
    [view],
  )

  useEffect(() => {
    if (!drag) return

    const onMove = (e: PointerEvent) => setHoverSlot(slotAt(e.clientX, e.clientY))

    const onUp = async (e: PointerEvent) => {
      const slot = slotAt(e.clientX, e.clientY)
      setDrag(null)
      setHoverSlot(null)
      justDragged.current = true
      // Cleared after the click that this pointerup generates has passed.
      setTimeout(() => { justDragged.current = false }, 0)
      if (!slot) return

      const timed = slot.minutes >= 0

      if (drag.kind === 'resize') {
        if (!timed) return
        // Keep at least 15 minutes, and let the dragged edge cross the other.
        const dragged = snap15(slot.minutes)
        const from = Math.min(dragged, drag.otherEdgeMinutes)
        const to = Math.max(dragged, drag.otherEdgeMinutes)
        const start = drag.edge === 'start' ? Math.min(from, drag.otherEdgeMinutes - 15) : from
        const end = drag.edge === 'end' ? Math.max(to, drag.otherEdgeMinutes + 15) : to

        if (drag.target === 'todo') {
          await updateTodo(drag.id, {
            doStart: minutesToTime(Math.max(0, start)),
            doEnd: minutesToTime(end),
          })
        } else {
          const e2 = calendarEntries.find((x) => x.id === drag.id)
          if (!e2) return
          const day = slot.day
          await updateCalendarEntry(drag.id, {
            startsAt: atTime(day, minutesToTime(Math.max(0, start))).toISOString(),
            endsAt: atTime(day, minutesToTime(end)).toISOString(),
          })
        }
        return
      }

      if (drag.kind === 'unscheduled' || drag.kind === 'todo') {
        const patch: Partial<ProjectTodo> = { doDate: slot.day }
        if (timed && view !== 'month') {
          const start = drag.kind === 'todo' ? slot.minutes - drag.grabMinutes : slot.minutes
          const snapped = snap15(Math.max(DAY_START_HOUR * 60, start))
          const duration = drag.kind === 'todo' ? drag.durationMinutes ?? 60 : 60
          patch.doStart = minutesToTime(snapped)
          patch.doEnd = minutesToTime(snapped + duration)
        }
        await updateTodo(drag.id, patch)
        return
      }

      if (drag.kind === 'entry') {
        const entry = calendarEntries.find((x) => x.id === drag.id)
        if (!entry) return
        if (!timed || view === 'month') {
          // Month view moves the day but keeps the time of day.
          const s = new Date(entry.startsAt)
          const ns = atTime(slot.day, `${String(s.getHours()).padStart(2, '0')}:${String(s.getMinutes()).padStart(2, '0')}`)
          const ne = new Date(ns.getTime() + drag.durationMinutes * 60000)
          await updateCalendarEntry(entry.id, { startsAt: ns.toISOString(), endsAt: ne.toISOString() })
          return
        }
        const startMin = snap15(Math.max(DAY_START_HOUR * 60, slot.minutes - drag.grabMinutes))
        const ns = atTime(slot.day, minutesToTime(startMin))
        const ne = new Date(ns.getTime() + drag.durationMinutes * 60000)
        await updateCalendarEntry(entry.id, { startsAt: ns.toISOString(), endsAt: ne.toISOString() })
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
  }, [drag, slotAt, view, updateTodo, updateCalendarEntry, calendarEntries])

  /** Click on empty space in a day column → new entry there. */
  const createAt = async (day: string, minutes: number) => {
    const start = minutes >= 0 ? minutesToTime(snap15(minutes)) : '09:00'
    const startDate = atTime(day, start)
    const endDate = new Date(startDate.getTime() + 60 * 60000)
    const created = await createCalendarEntry({
      projectId: project.id,
      title: 'Busy',
      kind: 'busy',
      startsAt: startDate.toISOString(),
      endsAt: endDate.toISOString(),
      allDay: minutes < 0,
    })
    if (created) setOpenEntry(created.id)
  }

  /**
   * Taking a todo off the calendar clears its do date, which returns it to the
   * unscheduled list — the todo itself is untouched. A calendar entry has no
   * life outside the calendar, so it is only ever deleted.
   */
  const unscheduleTodo = (id: string) => updateTodo(id, { doDate: null, doStart: null, doEnd: null })

  const todo = openTodo ? todos.find((t) => t.id === openTodo) : undefined
  const entry = openEntry ? calendarEntries.find((e) => e.id === openEntry) : undefined
  const today = dayKey(new Date())

  const title =
    view === 'day'
      ? format(cursor, 'EEEE d MMMM yyyy')
      : view === 'week'
        ? `${format(startOfWeek(cursor, { weekStartsOn: 1 }), 'd MMM')} – ${format(endOfWeek(cursor, { weekStartsOn: 1 }), 'd MMM yyyy')}`
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
              onCreate={(day) => createAt(day, -1)}
              justDragged={justDragged}
              onToggleDone={toggleTodo}
              onBlockContext={(x, y, ids) => setBlockMenu({ x, y, ...ids })}
              onDragTodo={(t) => setDrag({ kind: 'todo', id: t.id, grabMinutes: 0, durationMinutes: null })}
              onDragEntry={(e) =>
                setDrag({
                  kind: 'entry',
                  id: e.id,
                  grabMinutes: 0,
                  durationMinutes: Math.max(15, (new Date(e.endsAt).getTime() - new Date(e.startsAt).getTime()) / 60000),
                })
              }
            />
          ) : (
            <TimeGrid
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
              onResize={(target, id, edge, otherEdgeMinutes) =>
                setDrag({ kind: 'resize', target, id, edge, otherEdgeMinutes })
              }
              onDragTodo={(t, grab) =>
                setDrag({
                  kind: 'todo',
                  id: t.id,
                  grabMinutes: grab,
                  durationMinutes: (() => {
                    const m = todoMinutes(t)
                    return m ? m.end - m.start : 60
                  })(),
                })
              }
              onDragEntry={(e, grab) =>
                setDrag({
                  kind: 'entry',
                  id: e.id,
                  grabMinutes: grab,
                  durationMinutes: Math.max(15, (new Date(e.endsAt).getTime() - new Date(e.startsAt).getTime()) / 60000),
                })
              }
            />
          )}
        </div>

        <Unscheduled
          todos={todos}
          lists={todoLists}
          dragging={drag?.kind === 'unscheduled' ? drag.id : null}
          onDragStart={(id) => setDrag({ kind: 'unscheduled', id })}
          onOpen={setOpenTodo}
        />
      </div>

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
                  const label = bTodo?.title ?? bEntry!.title
                  const what = bTodo ? 'the todo and its calendar slot' : 'this calendar entry'
                  if (!confirm(`Delete "${label}"? This removes ${what}, and cannot be undone.`)) return
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
function TimeGrid({
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
  onResize,
  onDragTodo,
  onDragEntry,
}: {
  days: Date[]
  today: string
  blocksFor: (day: string) => { timed: Block[]; allDay: Block[] }
  hoverSlot: { day: string; minutes: number } | null
  dragging: boolean
  onOpenTodo: (id: string) => void
  onOpenEntry: (id: string) => void
  onCreate: (day: string, minutes: number) => void
  justDragged: React.MutableRefObject<boolean>
  onToggleDone: (todoId: string) => void
  onBlockContext: (x: number, y: number, ids: { todoId?: string; entryId?: string }) => void
  onResize: (target: 'todo' | 'entry', id: string, edge: 'start' | 'end', otherEdgeMinutes: number) => void
  onDragTodo: (todo: ProjectTodo, grabMinutes: number) => void
  onDragEntry: (entry: CalendarEntry, grabMinutes: number) => void
}) {
  const hours = Array.from({ length: DAY_END_HOUR - DAY_START_HOUR }, (_, i) => DAY_START_HOUR + i)
  const gridHeight = (DAY_END_HOUR - DAY_START_HOUR) * HOUR_HEIGHT

  return (
    <div className="rounded-xl border border-border bg-surface overflow-hidden">
      {/* Day headers */}
      <div className="flex border-b border-border">
        <div className="w-16 flex-shrink-0" />
        {days.map((d) => {
          const key = dayKey(d)
          const isToday = key === today
          return (
            <div key={key} className="flex-1 min-w-0 px-2 py-2.5 text-center">
              <p className="text-[10px] uppercase tracking-wide text-text-subtle">{format(d, 'EEE')}</p>
              <p
                className={`text-lg font-medium mt-0.5 mx-auto w-8 h-8 flex items-center justify-center rounded-full ${
                  isToday ? 'bg-primary text-white' : 'text-text-main'
                }`}
              >
                {format(d, 'd')}
              </p>
            </div>
          )
        })}
      </div>

      {/* All-day strip */}
      <div className="flex border-b border-border min-h-[2rem]">
        <div className="w-16 flex-shrink-0 px-2 py-1.5 text-[10px] text-text-subtle text-right">all-day</div>
        {days.map((d) => {
          const key = dayKey(d)
          const { allDay } = blocksFor(key)
          return (
            <div
              key={key}
              data-day={key}
              onClick={() => { if (!justDragged.current) onCreate(key, -1) }}
              className="flex-1 min-w-0 border-l border-border/50 p-1 space-y-1 cursor-pointer hover:bg-surface-2/40 transition-colors"
            >
              {allDay.map((b) => (
                <BlockChip
                  key={b.key}
                  block={b}
                  onOpen={() => (b.todo ? onOpenTodo(b.todo.id) : onOpenEntry(b.entry!.id))}
                  onDragStart={() =>
                    b.todo ? onDragTodo(b.todo, 0) : b.entry && onDragEntry(b.entry, 0)
                  }
                  onToggleDone={b.todo ? () => onToggleDone(b.todo!.id) : undefined}
                  onContext={(x, y) =>
                    onBlockContext(x, y, { todoId: b.todo?.id, entryId: b.entry?.id })
                  }
                />
              ))}
            </div>
          )
        })}
      </div>

      {/* Hour grid */}
      <div className="flex relative" style={{ height: gridHeight }}>
        <div className="w-16 flex-shrink-0">
          {hours.map((h) => (
            <div
              key={h}
              className="text-[10px] text-text-subtle text-right pr-3 -translate-y-1.5"
              style={{ height: HOUR_HEIGHT }}
            >
              {h % 12 === 0 ? 12 : h % 12}{h < 12 ? 'am' : 'pm'}
            </div>
          ))}
        </div>

        {days.map((d) => {
          const key = dayKey(d)
          const { timed } = blocksFor(key)
          const cols = layoutColumns(timed)

          return (
            <div
              key={key}
              data-day={key}
              className={`flex-1 min-w-0 border-l border-border/50 relative ${
                key === today ? 'bg-primary/[0.02]' : ''
              }`}
              onClick={(e) => {
                // Only empty space creates; blocks stop propagation themselves,
                // and a click that merely ends a drag is ignored.
                if (justDragged.current) return
                const rect = e.currentTarget.getBoundingClientRect()
                onCreate(key, offsetToMinutes(e.clientY - rect.top))
              }}
            >
              {hours.map((h) => (
                <div
                  key={h}
                  className="border-b border-border/40"
                  style={{ height: HOUR_HEIGHT }}
                >
                  {/* Half-hour guide, fainter still, to make slots readable
                      without the grid reading as a spreadsheet. */}
                  <div className="h-1/2 border-b border-border/15" />
                </div>
              ))}

              {timed.map((b) => {
                const pos = cols.get(b) ?? { col: 0, cols: 1 }
                const top = minutesToOffset(b.start)
                const height = Math.max(18, ((b.end - b.start) / 60) * HOUR_HEIGHT - 2)
                return (
                  <div
                    key={b.key}
                    className="absolute px-0.5"
                    style={{
                      top,
                      height,
                      left: `${(pos.col / pos.cols) * 100}%`,
                      width: `${(1 / pos.cols) * 100}%`,
                    }}
                  >
                    <BlockChip
                      block={b}
                      filled
                      onOpen={() => (b.todo ? onOpenTodo(b.todo.id) : onOpenEntry(b.entry!.id))}
                      onDragStart={(grabMinutes) =>
                        b.todo ? onDragTodo(b.todo, grabMinutes) : b.entry && onDragEntry(b.entry, grabMinutes)
                      }
                      onToggleDone={b.todo ? () => onToggleDone(b.todo!.id) : undefined}
                      onContext={(x, y) =>
                        onBlockContext(x, y, { todoId: b.todo?.id, entryId: b.entry?.id })
                      }
                      onResizeStart={(edge, otherEdgeMinutes) =>
                        onResize(
                          b.todo ? 'todo' : 'entry',
                          b.todo?.id ?? b.entry!.id,
                          edge,
                          otherEdgeMinutes,
                        )
                      }
                      blockStart={b.start}
                      blockEnd={b.end}
                    />
                  </div>
                )
              })}

              {dragging && hoverSlot?.day === key && hoverSlot.minutes >= 0 && (
                <div
                  className="absolute left-0 right-0 h-0.5 bg-primary pointer-events-none z-10"
                  style={{ top: minutesToOffset(hoverSlot.minutes) }}
                >
                  <span className="absolute -top-4 left-1 text-[10px] font-medium text-primary bg-surface px-1 rounded">
                    {minutesToTime(hoverSlot.minutes)}
                  </span>
                </div>
              )}
            </div>
          )
        })}
      </div>
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
  blocksFor: (day: string) => { timed: Block[]; allDay: Block[] }
  hoverSlot: { day: string; minutes: number } | null
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
        const { timed, allDay } = blocksFor(key)
        const all = [...allDay, ...timed.sort((a, b) => a.start - b.start)]
        const outside = !isSameMonth(day, cursor)

        return (
          <div
            key={key}
            data-day={key}
            onClick={() => { if (!justDragged.current) onCreate(key) }}
            className={`bg-surface min-h-[112px] p-1.5 cursor-pointer transition-colors hover:bg-surface-2/40 ${
              outside ? 'opacity-40' : ''
            } ${dragging && hoverSlot?.day === key ? 'ring-2 ring-primary ring-inset' : ''}`}
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
  onResizeStart,
  onToggleDone,
  onContext,
  blockStart,
  blockEnd,
}: {
  block: Block
  filled?: boolean
  compact?: boolean
  onOpen: () => void
  onDragStart: (grabMinutes: number) => void
  onResizeStart?: (edge: 'start' | 'end', otherEdgeMinutes: number) => void
  onToggleDone?: () => void
  onContext?: (x: number, y: number) => void
  blockStart?: number
  blockEnd?: number
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
            // Where inside the block the grab happened, so it doesn't jump.
            const rect = (e.currentTarget as HTMLElement)?.getBoundingClientRect?.()
            const grabMinutes =
              blockStart != null && rect ? offsetToMinutes(startY - rect.top) - DAY_START_HOUR * 60 : 0
            onDragStart(Math.max(0, grabMinutes))
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
      title={block.label}
      className={`relative rounded text-[10px] leading-tight truncate cursor-grab active:cursor-grabbing select-none ${
        compact ? 'px-1.5 py-1' : 'px-1.5 py-1 h-full overflow-hidden'
      } ${block.todo?.isCompleted ? 'line-through opacity-60' : ''}`}
      style={
        block.outlined
          ? { border: `1px solid ${block.color}66`, color: block.color }
          : filled
            ? { backgroundColor: `${block.color}22`, color: block.color, borderLeft: `2px solid ${block.color}` }
            : { backgroundColor: `${block.color}1a`, color: block.color }
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
      {blockStart != null && !compact && (
        <span className="opacity-70">{minutesToTime(blockStart)} </span>
      )}
      {block.label}

      {/* Drag either edge to change the duration, as in Google Calendar. */}
      {onResizeStart && blockStart != null && blockEnd != null && !compact && (
        <>
          <div
            onPointerDown={(e) => {
              if (e.button !== 0) return
              e.stopPropagation()
              e.preventDefault()
              moved.current = true
              onResizeStart('start', blockEnd)
            }}
            className="absolute top-0 left-0 right-0 h-1.5 cursor-ns-resize"
            title="Drag to change the start time"
          />
          <div
            onPointerDown={(e) => {
              if (e.button !== 0) return
              e.stopPropagation()
              e.preventDefault()
              moved.current = true
              onResizeStart('end', blockStart)
            }}
            className="absolute bottom-0 left-0 right-0 h-1.5 cursor-ns-resize"
            title="Drag to change the end time"
          />
        </>
      )}
    </div>
  )
}

/** Todos with no do date — draggable straight onto the calendar. */
function Unscheduled({
  todos,
  lists,
  dragging,
  onDragStart,
  onOpen,
}: {
  todos: ProjectTodo[]
  lists: { id: string; name: string }[]
  dragging: string | null
  onDragStart: (id: string) => void
  onOpen: (id: string) => void
}) {
  // Only the main list, as asked — otherwise every list's backlog piles in here.
  const mainListId = lists[0]?.id ?? null
  const pending = todos.filter(
    (t) => !t.isCompleted && !t.doDate && (mainListId === null || t.listId === mainListId),
  )

  return (
    <aside className="w-60 flex-shrink-0 rounded-xl border border-border bg-surface p-3 hidden lg:block">
      <h3 className="text-text-main font-medium text-sm flex items-center gap-1.5">
        <CalendarClock size={14} className="text-text-muted" />
        Not scheduled
      </h3>
      <p className="text-text-subtle text-[11px] mt-0.5 mb-3">
        {lists[0] ? `From "${lists[0].name}".` : ''} Drag onto a day to set its do date.
      </p>

      {pending.length === 0 ? (
        <p className="text-xs text-text-subtle italic">Everything has a do date.</p>
      ) : (
        <div className="space-y-1.5 max-h-[60vh] overflow-y-auto">
          {pending.map((t) => (
            <div
              key={t.id}
              onPointerDown={(e) => {
                if (e.button !== 0) return
                onDragStart(t.id)
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
