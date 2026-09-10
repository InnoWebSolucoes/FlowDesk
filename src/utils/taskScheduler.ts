import { Task } from '../types'
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
 * The day a task counts for, for one person, when it is being worked on today.
 *
 * Completion is recorded per day, so this is the key both sides of that have
 * to agree on: the day a completion is written against, and the day it is
 * looked up under. They did not agree, and the result was work coming back
 * from the dead.
 *
 * A task owed from an earlier day still shows in Today, because overdue work
 * carries forward. Ticking it wrote the log against *today*, while the task
 * belonged to its own earlier day — so the next morning the lookup for that
 * earlier day found nothing, and a task finished weeks ago was pending again.
 * Every day, forever, with an Overdue badge on it.
 *
 * So: whichever day the task is actually for. A one-off's own date, and today
 * for a recurrence — which comes round again tomorrow and is genuinely a
 * different piece of work each time.
 */
export function taskOccurrenceDay(task: Task, _employeeId: string, today: string): string {
  if (task.frequency.type === 'one-off' && task.frequency.date) {
    return task.frequency.date.slice(0, 10)
  }
  return today
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
 * Everything this employee must finish on or before `through`.
 *
 * This is what the My Tasks tabs ask for, and it is deliberately cumulative:
 * "this week" means everything due by the end of the week, today's work
 * included, not just Monday-to-Friday's recurrences. Anything already overdue
 * is included too — a task that was due yesterday is still owed today, and
 * dropping it off the list is how work goes missing.
 *
 * A task counts when its frequency puts it on any day in range — a one-off on
 * its date, a recurrence on the days its rule produces.
 */
export function getTasksDueThrough(
  tasks: Task[],
  employeeId: string,
  through: Date,
  options: { from?: Date } = {},
): Task[] {
  const end = startOfDay(through)
  // Overdue work carries forward unless a start is given explicitly.
  const from = options.from ? startOfDay(options.from) : null

  const inRange = (d: Date) => {
    const day = startOfDay(d)
    if (day > end) return false
    return from ? day >= from : true
  }

  return tasks.filter((task) => {
    if (!task.isActive) return false
    if (!task.assignedTo.includes(employeeId)) return false

    // Otherwise, does its recurrence put it on any day in the window? Walk the
    // days rather than reasoning about the rule, which keeps this correct for
    // every frequency type without duplicating the matching logic.
    const walkFrom = from ?? startOfDay(addDays(end, -60))
    for (let d = walkFrom; d <= end; d = addDays(d, 1)) {
      if (isTaskDueOnDate(task, employeeId, d)) return true
    }
    return false
  })
}

/** Everything owed by the end of the week containing `date`. */
export function getTasksDueThisWeekCumulative(tasks: Task[], employeeId: string, date: Date): Task[] {
  return getTasksDueThrough(tasks, employeeId, endOfWeek(date, { weekStartsOn: 1 }))
}

/** Everything owed by the end of the month containing `date`. */
export function getTasksDueThisMonthCumulative(tasks: Task[], employeeId: string, date: Date): Task[] {
  return getTasksDueThrough(tasks, employeeId, endOfMonth(date))
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
