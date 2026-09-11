import { Task, CompletionLog } from '../types'
import {
  format, startOfWeek, endOfWeek, addDays, getDay, parseISO,
  startOfMonth, endOfMonth, isWithinInterval, startOfDay, isBefore,
} from 'date-fns'

/**
 * Returns which week of the month a date falls in (1-4).
 * Week 1 = days 1–7, Week 2 = days 8–14, Week 3 = days 15–21, Week 4 = days 22+
 */
export function getWeekOfMonth(date: Date): number {
  const dayOfMonth = date.getDate()
  return Math.ceil(dayOfMonth / 7)
}

/**
 * Whether a task lands on a given day for a given person.
 *
 * The frequency is the whole answer: a one-off on its date, everything else on
 * the days its rule produces. There was briefly a per-assignee do date that
 * overrode this, which gave a one-off two dates meaning the same thing and let
 * a do date silently cancel a weekly task's recurrence. One date, and it lives
 * in the frequency.
 */
export function isTaskDueOnDate(task: Task, employeeId: string, date: Date): boolean {
  if (!task.isActive) return false
  if (!task.assignedTo.includes(employeeId)) return false

  // A recurrence describes what happens from now on, not what should have
  // happened before the task existed. Without this a new monthly task appears
  // as months of missed work the moment it is created.
  if (task.createdAt) {
    const created = startOfDay(parseISO(task.createdAt))
    if (startOfDay(date) < created) return false
  }

  const dayOfWeek = getDay(date) // 0=Sun, 1=Mon, ..., 6=Sat

  const { frequency } = task

  switch (frequency.type) {
    case 'daily':
      // Every day. Saturday and Sunday are working days like any other.
      return true

    case 'weekly': {
      const days = frequency.days ?? []
      return days.includes(dayOfWeek)
    }

    case 'monthly': {
      const weekOfMonth = getWeekOfMonth(date)
      const targetWeek = frequency.weekOfMonth ?? 1
      const targetDay = frequency.dayOfWeek ?? 1
      return weekOfMonth === targetWeek && dayOfWeek === targetDay
    }

    case 'one-off': {
      if (!frequency.date) return false
      const taskDate = format(parseISO(frequency.date), 'yyyy-MM-dd')
      const checkDate = format(date, 'yyyy-MM-dd')
      return taskDate === checkDate
    }

    default:
      return false
  }
}

/**
 * One piece of work on one day: a task, and the day it is for.
 */
export interface TaskOccurrence {
  task: Task
  /** The day this occurrence is for. Its identity, and the key its completion is logged under. */
  date: string
  /** The single day it is shown on. See taskOccurrences for the rule. */
  showOn: string
  completed: boolean
  completedAt: string | null
  /** Nothing has happened to it and its day is over, so it has moved forward onto today. */
  carried: boolean
  /** Started, or marked as missed. Either one stops it moving. */
  status: 'in_progress' | 'missed' | null
}

const keyOf = (d: Date) => format(d, 'yyyy-MM-dd')
const shiftKey = (key: string, days: number) => keyOf(addDays(parseISO(key), days))

/** A status somebody set on one occurrence: started, or marked as missed. */
export interface TaskStatusRow {
  taskId: string
  employeeId: string
  date: string
  status: 'in_progress' | 'missed'
  /** When it was set. Null on rows from before that was recorded. */
  at: string | null
}

/**
 * The store keeps statuses as two maps keyed `task:employee:day`; the rule
 * wants rows. Ids are uuids and days are yyyy-MM-dd, none of which contain a
 * colon, so the key splits cleanly.
 */
export function statusRowsFrom(
  statuses: Record<string, string>,
  startedAt: Record<string, string>,
): TaskStatusRow[] {
  const rows: TaskStatusRow[] = []
  for (const [key, status] of Object.entries(statuses)) {
    const [taskId, employeeId, date] = key.split(':')
    if (!taskId || !employeeId || !date) continue
    rows.push({
      taskId,
      employeeId,
      date,
      status: status === 'missed' ? 'missed' : 'in_progress',
      at: startedAt[key] ?? null,
    })
  }
  return rows
}

/**
 * Every occurrence of every task for one person that is shown between two
 * days, each placed on the one day it belongs on.
 *
 * The rule:
 *   - A task lives on its own day until that day is over.
 *   - If nothing has happened to it by midnight — not completed, not started,
 *     not marked as missed — it moves to the next day. It moves; it is not
 *     copied. It keeps moving a day at a time for as long as nothing happens.
 *   - The moment something does, it stops on the day that happened and stays.
 *
 * Every occurrence moves on its own. A daily task nobody touched all week puts
 * a copy on today for each day it was due: that is the backlog, and showing
 * only one would hide the work. Marking one missed is how somebody says "this
 * one is not coming with me" — it stops on the day it was marked.
 *
 * Saturday and Sunday are ordinary days here, as everywhere.
 *
 * The calendar and My Tasks both read this, so they cannot disagree about
 * which day a task is on.
 *
 * A one-off happens exactly once, so any completion or status this person
 * recorded for it applies, whatever day it was recorded under. One-offs used
 * to be logged against the day they were ticked rather than their own date,
 * and without this those old records would not count.
 *
 * `today` is the real today. A view looking at another week passes that
 * week's days as the range, but work only moves forward in real time.
 *
 * The lookback bounds how far back untouched work is gathered from: a year.
 * Anything older than that and still untouched is not brought forward.
 */
export function taskOccurrences(
  tasks: Task[],
  employeeId: string,
  logs: CompletionLog[],
  range: { from: string; to: string; today: string },
  statuses: TaskStatusRow[] = [],
  lookbackDays = 365,
): TaskOccurrence[] {
  const { from, to, today } = range

  const logByTaskDay = new Map<string, CompletionLog>()
  const latestLogByTask = new Map<string, CompletionLog>()
  for (const l of logs) {
    if (l.employeeId !== employeeId) continue
    logByTaskDay.set(`${l.taskId}|${l.dueDate}`, l)
    const prev = latestLogByTask.get(l.taskId)
    if (!prev || l.completedAt > prev.completedAt) latestLogByTask.set(l.taskId, l)
  }

  const statusByTaskDay = new Map<string, TaskStatusRow>()
  const latestStatusByTask = new Map<string, TaskStatusRow>()
  for (const r of statuses) {
    if (r.employeeId !== employeeId) continue
    statusByTaskDay.set(`${r.taskId}|${r.date}`, r)
    const prev = latestStatusByTask.get(r.taskId)
    if (!prev || (r.at ?? '') > (prev.at ?? '')) latestStatusByTask.set(r.taskId, r)
  }

  // Far enough back to gather anything still moving, far enough forward to
  // cover both the range and today.
  const lookback = shiftKey(today, -lookbackDays)
  const genFrom = from < lookback ? from : lookback
  const genTo = to > today ? to : today

  const out: TaskOccurrence[] = []

  const place = (
    task: Task,
    date: string,
    log: CompletionLog | null,
    status: TaskStatusRow | null,
  ) => {
    // The days something happened to it. The earliest is where it stopped:
    // once started, it did not keep moving on to the day it was finished.
    const happened: string[] = []
    if (log) happened.push(keyOf(parseISO(log.completedAt)))
    if (status) happened.push(status.at ? keyOf(parseISO(status.at)) : date)

    let showOn: string
    let carried = false
    if (happened.length > 0) {
      const first = happened.sort()[0]
      showOn = first > date ? first : date
    } else if (date >= today) {
      showOn = date
    } else {
      showOn = today
      carried = true
    }
    if (showOn < from || showOn > to) return
    out.push({
      task,
      date,
      showOn,
      carried,
      completed: !!log,
      completedAt: log?.completedAt ?? null,
      status: status?.status ?? null,
    })
  }

  for (const task of tasks) {
    if (!task.isActive || !task.assignedTo.includes(employeeId)) continue

    if (task.frequency.type === 'one-off') {
      const date = task.frequency.date ? task.frequency.date.slice(0, 10) : null
      if (!date || !isTaskDueOnDate(task, employeeId, parseISO(date))) continue
      place(
        task,
        date,
        logByTaskDay.get(`${task.id}|${date}`) ?? latestLogByTask.get(task.id) ?? null,
        statusByTaskDay.get(`${task.id}|${date}`) ?? latestStatusByTask.get(task.id) ?? null,
      )
      continue
    }

    for (let d = parseISO(genFrom); keyOf(d) <= genTo; d = addDays(d, 1)) {
      if (!isTaskDueOnDate(task, employeeId, d)) continue
      const date = keyOf(d)
      place(
        task,
        date,
        logByTaskDay.get(`${task.id}|${date}`) ?? null,
        statusByTaskDay.get(`${task.id}|${date}`) ?? null,
      )
    }
  }

  return out
}

/**
 * Returns all tasks assigned to this employee that are due on this specific date.
 */
export function getTasksDueOnDate(tasks: Task[], employeeId: string, date: Date): Task[] {
  return tasks.filter(task => isTaskDueOnDate(task, employeeId, date))
}

/**
 * Returns tasks grouped by ISO date string for all seven days of the week containing weekStartDate.
 */
export function getTasksDueThisWeek(
  tasks: Task[],
  employeeId: string,
  weekStartDate: Date
): Record<string, Task[]> {
  const result: Record<string, Task[]> = {}
  const monday = startOfWeek(weekStartDate, { weekStartsOn: 1 })

  for (let i = 0; i < 7; i++) {
    const day = addDays(monday, i)
    const dateKey = format(day, 'yyyy-MM-dd')
    result[dateKey] = getTasksDueOnDate(tasks, employeeId, day)
  }

  return result
}

/**
 * Returns tasks grouped by day-of-month number for every day in the given month/year.
 */
export function getTasksDueThisMonth(
  tasks: Task[],
  employeeId: string,
  month: number, // 0-indexed
  year: number
): Record<number, Task[]> {
  const result: Record<number, Task[]> = {}
  const daysInMonth = new Date(year, month + 1, 0).getDate()

  for (let day = 1; day <= daysInMonth; day++) {
    const date = new Date(year, month, day)

    const tasks_due = getTasksDueOnDate(tasks, employeeId, date)
    if (tasks_due.length > 0) {
      result[day] = tasks_due
    }
  }

  return result
}


/**
 * Format a date for display: "Mon 16 Mar 2025"
 */
export function formatDisplayDate(date: Date | string): string {
  const d = typeof date === 'string' ? parseISO(date) : date
  return format(d, 'EEE d MMM yyyy')
}

/**
 * Format a timestamp for display: "Today at 14:32" or "Mon 16 Mar at 14:32"
 */
export function formatTimestamp(isoString: string): string {
  const date = parseISO(isoString)
  const now = new Date()
  const today = format(now, 'yyyy-MM-dd')
  const yesterday = format(addDays(now, -1), 'yyyy-MM-dd')
  const dateStr = format(date, 'yyyy-MM-dd')
  const timeStr = format(date, 'HH:mm')

  if (dateStr === today) return `Today at ${timeStr}`
  if (dateStr === yesterday) return `Yesterday at ${timeStr}`
  return `${format(date, 'EEE d MMM')} at ${timeStr}`
}

/**
 * Determine time of day category for a completion timestamp.
 */
export function getTimeOfDay(isoString: string): 'early' | 'mid-morning' | 'afternoon' | 'end-of-day' {
  const date = parseISO(isoString)
  const hour = date.getHours()
  if (hour < 11) return 'early'
  if (hour < 13) return 'mid-morning'
  if (hour < 16) return 'afternoon'
  return 'end-of-day'
}
