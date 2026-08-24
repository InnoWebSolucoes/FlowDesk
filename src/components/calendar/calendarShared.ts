import { CalendarEntryKind, ProjectTodo, CalendarEntry } from '../../types'

export const KIND_STYLE: Record<CalendarEntryKind, { label: string; color: string }> = {
  busy: { label: 'Busy', color: '#dc2626' },
  working: { label: 'Working', color: '#16a34a' },
  meeting: { label: 'Meeting', color: '#2563eb' },
  timeoff: { label: 'Time off', color: '#a855f7' },
}

/** The filterable layers of the calendar, including the two todo kinds. */
export type Layer = CalendarEntryKind | 'do' | 'due'

export const LAYERS: { key: Layer; label: string; color: string; outlined?: boolean }[] = [
  { key: 'do', label: 'Do date', color: '#1A5C3A' },
  { key: 'due', label: 'Deadline', color: '#dc2626', outlined: true },
  ...(Object.keys(KIND_STYLE) as CalendarEntryKind[]).map((k) => ({
    key: k as Layer,
    label: KIND_STYLE[k].label,
    color: KIND_STYLE[k].color,
  })),
]

/** Working day shown in the day/week grids. */
export const DAY_START_HOUR = 7
export const DAY_END_HOUR = 21
export const HOUR_HEIGHT = 48

export const pad = (n: number) => String(n).padStart(2, '0')

/** Local YYYY-MM-DD. A do date is a calendar day, not an instant. */
export function dayKey(d: Date) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** "HH:MM" from a Date, in local time. */
export function timeKey(d: Date) {
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** Builds a local Date from a YYYY-MM-DD day and an HH:MM time. */
export function atTime(day: string, time: string) {
  const [y, m, d] = day.split('-').map(Number)
  const [hh, mm] = time.split(':').map(Number)
  return new Date(y, m - 1, d, hh, mm, 0, 0)
}

/** Minutes since midnight → offset in px inside the day grid. */
export function minutesToOffset(minutes: number) {
  return ((minutes - DAY_START_HOUR * 60) / 60) * HOUR_HEIGHT
}

export function offsetToMinutes(px: number) {
  return DAY_START_HOUR * 60 + (px / HOUR_HEIGHT) * 60
}

/** Rounds to the nearest quarter hour, which is what dragging should snap to. */
export function snap15(minutes: number) {
  return Math.round(minutes / 15) * 15
}

export function minutesToTime(minutes: number) {
  const clamped = Math.max(0, Math.min(24 * 60 - 1, Math.round(minutes)))
  return `${pad(Math.floor(clamped / 60))}:${pad(clamped % 60)}`
}

/** A todo shown on the calendar behaves like a timed or all-day block. */
export function todoMinutes(todo: ProjectTodo) {
  if (!todo.doStart) return null
  const [h, m] = todo.doStart.split(':').map(Number)
  const start = h * 60 + m
  if (todo.doEnd) {
    const [eh, em] = todo.doEnd.split(':').map(Number)
    const end = eh * 60 + em
    if (end > start) return { start, end }
  }
  return { start, end: start + 60 }
}

export function entryMinutes(entry: CalendarEntry, day: string) {
  const s = new Date(entry.startsAt)
  const e = new Date(entry.endsAt)
  const dayStart = atTime(day, '00:00')
  const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000)
  // Clamp multi-day entries to the day being rendered.
  const from = s < dayStart ? dayStart : s
  const to = e > dayEnd ? dayEnd : e
  return {
    start: from.getHours() * 60 + from.getMinutes(),
    end: Math.max(to.getHours() * 60 + to.getMinutes() || 24 * 60, from.getHours() * 60 + from.getMinutes() + 15),
  }
}

/**
 * Lays overlapping blocks side by side. Returns a column index and total column
 * count per block, so each can be positioned without covering its neighbours.
 */
export function layoutColumns<T extends { start: number; end: number }>(blocks: T[]) {
  const sorted = [...blocks].sort((a, b) => a.start - b.start || a.end - b.end)
  const out = new Map<T, { col: number; cols: number }>()
  let cluster: T[] = []
  let clusterEnd = -1

  const flush = () => {
    if (cluster.length === 0) return
    const cols: T[][] = []
    for (const b of cluster) {
      let placed = false
      for (const col of cols) {
        if (col[col.length - 1].end <= b.start) {
          col.push(b)
          placed = true
          break
        }
      }
      if (!placed) cols.push([b])
    }
    cols.forEach((col, i) => col.forEach((b) => out.set(b, { col: i, cols: cols.length })))
    cluster = []
    clusterEnd = -1
  }

  for (const b of sorted) {
    if (cluster.length > 0 && b.start >= clusterEnd) flush()
    cluster.push(b)
    clusterEnd = Math.max(clusterEnd, b.end)
  }
  flush()
  return out
}
