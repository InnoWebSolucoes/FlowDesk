import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { Task, CompletionLog, Category } from '../types'
import { sampleTasks, sampleCategories, generateHistoricalData } from '../data/sampleData'
import { getTasksDueOnDate, getTasksDueThisWeek, getTasksDueThisMonth, getTimeOfDay } from '../utils/taskScheduler'
import { format } from 'date-fns'
import { v4 as uuidv4 } from 'uuid'

interface TaskState {
  tasks: Task[]
  completionLogs: CompletionLog[]
  categories: Category[]
  initialized: boolean

  // Task actions
  addTask: (task: Task) => void
  updateTask: (id: string, updates: Partial<Task>) => void
  deleteTask: (id: string) => void

  // Completion actions
  completeTask: (taskId: string, employeeId: string, dueDate: string) => void
  uncompleteTask: (taskId: string, employeeId: string, dueDate: string) => void
  isTaskCompleted: (taskId: string, employeeId: string, date: string) => boolean

  // Category actions
  addCategory: (category: Category) => void
  updateCategory: (id: string, updates: Partial<Category>) => void
  deleteCategory: (id: string) => void

  // Query helpers
  getTasksDueToday: (employeeId: string, date: Date) => Task[]
  getTasksDueThisWeek: (employeeId: string, weekStart: Date) => Record<string, Task[]>
  getTasksDueThisMonth: (employeeId: string, month: number, year: number) => Record<number, Task[]>

  // Init
  initialize: () => void
}

export const useTaskStore = create<TaskState>()(
  persist(
    (set, get) => ({
      tasks: [],
      completionLogs: [],
      categories: [],
      initialized: false,

      initialize: () => {
        const state = get()
        if (state.initialized) return
        const historicalLogs = generateHistoricalData(sampleTasks)
        set({
          tasks: sampleTasks,
          categories: sampleCategories,
          completionLogs: historicalLogs,
          initialized: true,
        })
      },

      addTask: (task) => set((s) => ({ tasks: [...s.tasks, task] })),
      updateTask: (id, updates) =>
        set((s) => ({ tasks: s.tasks.map((t) => (t.id === id ? { ...t, ...updates } : t)) })),
      deleteTask: (id) => set((s) => ({ tasks: s.tasks.filter((t) => t.id !== id) })),

      completeTask: (taskId, employeeId, dueDate) => {
        const now = new Date()
        const isoNow = now.toISOString()
        const hour = now.getHours()
        const wasLate = hour >= 16
        const timeOfDay = getTimeOfDay(isoNow)

        const log: CompletionLog = {
          id: uuidv4(),
          taskId,
          employeeId,
          completedAt: isoNow,
          dueDate,
          wasLate,
          timeOfDay,
        }
        set((s) => ({ completionLogs: [...s.completionLogs, log] }))
      },

      uncompleteTask: (taskId, employeeId, dueDate) => {
        set((s) => ({
          completionLogs: s.completionLogs.filter(
            (log) =>
              !(log.taskId === taskId && log.employeeId === employeeId && log.dueDate === dueDate)
          ),
        }))
      },

      isTaskCompleted: (taskId, employeeId, date) => {
        const dateStr = date.length === 10 ? date : format(new Date(date), 'yyyy-MM-dd')
        return get().completionLogs.some(
          (log) =>
            log.taskId === taskId && log.employeeId === employeeId && log.dueDate === dateStr
        )
      },

      addCategory: (category) => set((s) => ({ categories: [...s.categories, category] })),
      updateCategory: (id, updates) =>
        set((s) => ({
          categories: s.categories.map((c) => (c.id === id ? { ...c, ...updates } : c)),
        })),
      deleteCategory: (id) => set((s) => ({ categories: s.categories.filter((c) => c.id !== id) })),

      getTasksDueToday: (employeeId, date) => getTasksDueOnDate(get().tasks, employeeId, date),
      getTasksDueThisWeek: (employeeId, weekStart) =>
        getTasksDueThisWeek(get().tasks, employeeId, weekStart),
      getTasksDueThisMonth: (employeeId, month, year) =>
        getTasksDueThisMonth(get().tasks, employeeId, month, year),
    }),
    {
      name: 'flowdesk-tasks',
    }
  )
)
