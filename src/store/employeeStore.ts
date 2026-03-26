import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { Employee, CompletionLog, EmployeeStats, DailyStats, Task } from '../types'
import { sampleEmployees } from '../data/sampleData'
import { getTasksDueOnDate } from '../utils/taskScheduler'
import { format, subDays, parseISO } from 'date-fns'

interface EmployeeState {
  employees: Employee[]
  initialized: boolean

  addEmployee: (employee: Employee) => void
  updateEmployee: (id: string, updates: Partial<Employee>) => void
  deleteEmployee: (id: string) => void
  getEmployeeStats: (employeeId: string, completionLogs: CompletionLog[], tasks: Task[]) => EmployeeStats
  initialize: () => void
}

export const useEmployeeStore = create<EmployeeState>()(
  persist(
    (set, get) => ({
      employees: [],
      initialized: false,

      initialize: () => {
        if (get().initialized) return
        set({ employees: sampleEmployees, initialized: true })
      },

      addEmployee: (employee) => set((s) => ({ employees: [...s.employees, employee] })),
      updateEmployee: (id, updates) =>
        set((s) => ({
          employees: s.employees.map((e) => (e.id === id ? { ...e, ...updates } : e)),
        })),
      deleteEmployee: (id) => set((s) => ({ employees: s.employees.filter((e) => e.id !== id) })),

      getEmployeeStats: (employeeId, completionLogs, tasks) => {
        const empLogs = completionLogs.filter((l) => l.employeeId === employeeId)
        const today = new Date()
        const dailyStats: DailyStats[] = []

        for (let i = 29; i >= 0; i--) {
          const date = subDays(today, i)
          const dow = date.getDay()
          if (dow === 0 || dow === 6) continue

          const dateStr = format(date, 'yyyy-MM-dd')
          const dueTasks = getTasksDueOnDate(tasks, employeeId, date)
          const assigned = dueTasks.length
          const completed = empLogs.filter((l) => l.dueDate === dateStr).length

          dailyStats.push({
            date: dateStr,
            employeeId,
            assigned,
            completed,
            completionRate: assigned > 0 ? Math.round((completed / assigned) * 100) : 0,
          })
        }

        const totalAssigned = dailyStats.reduce((a, d) => a + d.assigned, 0)
        const totalCompleted = dailyStats.reduce((a, d) => a + d.completed, 0)
        const completionRate = totalAssigned > 0 ? Math.round((totalCompleted / totalAssigned) * 100) : 0

        // Streak calculation (most recent days first)
        let currentStreak = 0
        let longestStreak = 0
        let tempStreak = 0
        const reversedDays = [...dailyStats].reverse()

        for (let i = 0; i < reversedDays.length; i++) {
          const day = reversedDays[i]
          if (day.assigned === 0) continue
          if (day.completionRate >= 80) {
            tempStreak++
            if (i === 0 || reversedDays.slice(0, i).every(d => d.assigned === 0 || d.completionRate >= 80)) {
              currentStreak = tempStreak
            }
            longestStreak = Math.max(longestStreak, tempStreak)
          } else {
            if (currentStreak === tempStreak && i > 0) currentStreak = tempStreak
            tempStreak = 0
          }
        }

        // Compute currentStreak properly (consecutive days from today backward)
        let streak = 0
        for (const day of reversedDays) {
          if (day.assigned === 0) continue
          if (day.completionRate >= 80) {
            streak++
          } else {
            break
          }
        }
        currentStreak = streak

        const missedTasks = dailyStats.reduce(
          (acc, d) => acc + Math.max(0, d.assigned - d.completed),
          0
        )

        const hours = empLogs.map(
          (l) => parseISO(l.completedAt).getHours() + parseISO(l.completedAt).getMinutes() / 60
        )
        const averageCompletionHour =
          hours.length > 0 ? hours.reduce((a, b) => a + b, 0) / hours.length : 12

        return {
          employeeId,
          totalAssigned,
          totalCompleted,
          completionRate,
          currentStreak,
          longestStreak,
          missedTasks,
          averageCompletionHour,
          dailyStats,
        }
      },
    }),
    { name: 'flowdesk-employees' }
  )
)
