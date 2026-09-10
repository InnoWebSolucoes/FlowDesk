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
  const isWeekday = dayOfWeek >= 1 && dayOfWeek <= 5

  const { frequency } = task

  switch (frequency.type) {
    case 'daily':
      return isWeekday

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
  /** Missed and still owed, so moved forward onto today. */
  carried: boolean
}

const keyOf = (d: Date) => format(d, 'yyyy-MM-dd')
const shiftKey = (key: string, days: number) => keyOf(addDays(parseISO(key), days))

/**
 * Every occurrence of every task for one person that is shown between two
 * days, each placed on the one day it belongs on.
 *
 * The rule, from the point of view of the person doing the work:
 *   - A task lives on its own day until that day is over.
 *   - If it is not done by midnight it moves to the next day, and keeps moving
 *     a day at a time until it is done.
 *   - Once done, it stays on the day it was done.
 *
 * The calendar and My Tasks both read this. They used to decide separately —
 * the calendar from the recurrence alone, My Tasks from "anything due in the
 * last sixty days", with done checked against today — so the same task sat on
 * different days in each, and a weekly Monday task stayed on Today every day
 * for two months even after it was ticked.
 *
 * A repeating task carries forward only until its next occurrence arrives.
 * Taken literally, a daily task missed for three weeks would put fifteen
 * copies of itself on today. So a miss moves forward until the next one is
 * due, and then stays on its own day as a miss — still counted as missed —
 * while the new one takes its place. At most one carried copy per repeating
 * task; a one-off carries until it is done.
 *
 * A one-off happens exactly once, so any completion by this person finishes
 * it, whatever day the log was written under. One-offs used to be logged
 * against the day they were ticked rather than their own date, and without
 * this those old ticks would not count and finished work would come back.
 *
 * `today` is the real today. A view looking at another week passes that
 * week's days as the range, but work only moves forward in real time.
 */
export function taskOccurrences(
  tasks: Task[],
  employeeId: string,
  logs: CompletionLog[],
  range: { from: string; to: string; today: string },
  lookbackDays = 60,
): TaskOccurrence[] {
  const { from, to, today } = range

  const byTaskDay = new Map<string, CompletionLog>()
  const latestByTask = new Map<string, CompletionLog>()
  for (const l of logs) {
    if (l.employeeId !== employeeId) continue
    byTaskDay.set(`${l.taskId}|${l.dueDate}`, l)
    const prev = latestByTask.get(l.taskId)
    if (!prev || l.completedAt > prev.completedAt) latestByTask.set(l.taskId, l)
  }

  // Far enough back to find anything still being carried, far enough forward
  // to cover both the range and today.
  const lookback = shiftKey(today, -lookbackDays)
  const genFrom = from < lookback ? from : lookback
  const genTo = to > today ? to : today

  const out: TaskOccurrence[] = []

  const place = (task: Task, date: string, next: string | null, log: CompletionLog | null) => {
    let showOn: string
    let carried = false
    if (log) {
      const doneDay = keyOf(parseISO(log.completedAt))
      // Finished after its next occurrence had already replaced it: it was
      // never on anyone's list that day, so it stays on its own day.
      if (next && next <= doneDay) showOn = date
      else showOn = doneDay > date ? doneDay : date
    } else if (date >= today) {
      showOn = date
    } else if (next && next <= today) {
      showOn = date
    } else {
      showOn = today
      carried = true
    }
    if (showOn < from || showOn > to) return
    out.push({ task, date, showOn, completed: !!log, completedAt: log?.completedAt ?? null, carried })
  }

  for (const task of tasks) {
    if (!task.isActive || !task.assignedTo.includes(employeeId)) continue

    if (task.frequency.type === 'one-off') {
      const date = task.frequency.date ? task.frequency.date.slice(0, 10) : null
      if (!date || !isTaskDueOnDate(task, employeeId, parseISO(date))) continue
      place(task, date, null, byTaskDay.get(`${task.id}|${date}`) ?? latestByTask.get(task.id) ?? null)
      continue
    }

    const dates: string[] = []
    for (let d = parseISO(genFrom); keyOf(d) <= genTo; d = addDays(d, 1)) {
      if (isTaskDueOnDate(task, employeeId, d)) dates.push(keyOf(d))
    }
    for (let i = 0; i < dates.length; i++) {
      const next = i + 1 < dates.length ? dates[i + 1] : null
      place(task, dates[i], next, byTaskDay.get(`${task.id}|${dates[i]}`) ?? null)
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
 * Returns tasks grouped by ISO date string for Mon-Fri of the week containing weekStartDate.
 */
export function getTasksDueThisWeek(
  tasks: Task[],
  employeeId: string,
  weekStartDate: Date
): Record<string, Task[]> {
  const result: Record<string, Task[]> = {}
  const monday = startOfWeek(weekStartDate, { weekStartsOn: 1 })

  for (let i = 0; i < 5; i++) {
    const day = addDays(monday, i)
    const dateKey = format(day, 'yyyy-MM-dd')
    result[dateKey] = getTasksDueOnDate(tasks, employeeId, day)
  }

  return result
}

/**
 * Returns tasks grouped by day-of-month number for all weekdays in the given month/year.
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
    const dayOfWeek = getDay(date)
    if (dayOfWeek === 0 || dayOfWeek === 6) continue // skip weekends

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
