import { Task } from '../types'
import { format, startOfWeek, addDays, getDay, parseISO } from 'date-fns'

/**
 * Returns which week of the month a date falls in (1-4).
 * Week 1 = days 1–7, Week 2 = days 8–14, Week 3 = days 15–21, Week 4 = days 22+
 */
export function getWeekOfMonth(date: Date): number {
  const dayOfMonth = date.getDate()
  return Math.ceil(dayOfMonth / 7)
}

/**
 * Returns whether a task is due on a specific date for a given employee.
 */
export function isTaskDueOnDate(task: Task, employeeId: string, date: Date): boolean {
  if (!task.isActive) return false
  if (!task.assignedTo.includes(employeeId)) return false

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
