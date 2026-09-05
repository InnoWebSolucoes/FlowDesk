import { CalendarEntryKind, CalendarEntry } from '../../types'

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

export const pad = (n: number) => String(n).padStart(2, '0')

/** Local YYYY-MM-DD. Everything on this calendar is a day, not an instant. */
export function dayKey(d: Date) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** A local Date at midnight on a YYYY-MM-DD day. */
export function dayDate(day: string) {
  const [y, m, d] = day.split('-').map(Number)
  return new Date(y, m - 1, d, 0, 0, 0, 0)
}

/** Whether an entry covers a given day. Both ends are inclusive. */
export function entryCoversDay(entry: CalendarEntry, day: string) {
  return entry.startsOn <= day && entry.endsOn >= day
}

/** The days an entry spans, inclusive, as YYYY-MM-DD keys. */
export function entryDays(entry: CalendarEntry): string[] {
  const out: string[] = []
  const end = dayDate(entry.endsOn)
  for (let d = dayDate(entry.startsOn); d <= end; d = new Date(d.getTime() + 864e5)) {
    out.push(dayKey(d))
  }
  return out
}

/** True when an entry covers more than the one day. */
export function isMultiDay(entry: CalendarEntry) {
  return entry.endsOn > entry.startsOn
}
