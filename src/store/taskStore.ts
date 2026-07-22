import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { Task, CompletionLog, Category, TaskComment, TaskAttachment, ActivityLog } from '../types'
import { sampleTasks, sampleCategories, generateHistoricalData } from '../data/sampleData'
import { getTasksDueOnDate, getTasksDueThisWeek, getTasksDueThisMonth, getTimeOfDay } from '../utils/taskScheduler'
import { format } from 'date-fns'
import { v4 as uuidv4 } from 'uuid'

interface TaskState {
  tasks: Task[]
  completionLogs: CompletionLog[]
  categories: Category[]
  initialized: boolean
  taskStatuses: Record<string, 'in_progress'>
  taskComments: TaskComment[]
  activityLogs: ActivityLog[]

  // Task actions
  addTask: (task: Task) => void
  updateTask: (id: string, updates: Partial<Task>) => void
  deleteTask: (id: string) => void

  // Completion actions
  completeTask: (taskId: string, employeeId: string, dueDate: string) => void
  uncompleteTask: (taskId: string, employeeId: string, dueDate: string) => void
  isTaskCompleted: (taskId: string, employeeId: string, date: string) => boolean

  // In-progress status actions
  setInProgress: (taskId: string, empId: string, date: string) => void
  clearInProgress: (taskId: string, empId: string, date: string) => void
  isInProgress: (taskId: string, empId: string, date: string) => boolean

  // Comment actions
  addComment: (comment: Omit<TaskComment, 'id' | 'createdAt'> & { attachments: TaskAttachment[] }) => TaskComment
  deleteComment: (commentId: string) => void
  getTaskComments: (taskId: string) => TaskComment[]

  // Activity log actions
  addActivityLog: (log: Omit<ActivityLog, 'id' | 'timestamp'>) => void
  getActivityLogs: (taskId: string) => ActivityLog[]

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
      taskStatuses: {},
      taskComments: [],
      activityLogs: [],

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

        get().addActivityLog({ taskId, actorId: employeeId, action: 'completed' })
      },

      uncompleteTask: (taskId, employeeId, dueDate) => {
        set((s) => ({
          completionLogs: s.completionLogs.filter(
            (log) =>
              !(log.taskId === taskId && log.employeeId === employeeId && log.dueDate === dueDate)
          ),
        }))

        get().addActivityLog({ taskId, actorId: employeeId, action: 'uncompleted' })
      },

      isTaskCompleted: (taskId, employeeId, date) => {
        const dateStr = date.length === 10 ? date : format(new Date(date), 'yyyy-MM-dd')
        return get().completionLogs.some(
          (log) =>
            log.taskId === taskId && log.employeeId === employeeId && log.dueDate === dateStr
        )
      },

      setInProgress: (taskId, empId, date) => {
        const key = `${taskId}:${empId}:${date}`
        set((s) => ({ taskStatuses: { ...s.taskStatuses, [key]: 'in_progress' } }))
        get().addActivityLog({ taskId, actorId: empId, action: 'in_progress' })
      },

      clearInProgress: (taskId, empId, date) => {
        const key = `${taskId}:${empId}:${date}`
        set((s) => {
          const next = { ...s.taskStatuses }
          delete next[key]
          return { taskStatuses: next }
        })
      },

      isInProgress: (taskId, empId, date) => {
        const key = `${taskId}:${empId}:${date}`
        return get().taskStatuses[key] === 'in_progress'
      },

      addComment: (comment) => {
        const newComment: TaskComment = {
          ...comment,
          id: uuidv4(),
          createdAt: new Date().toISOString(),
        }
        set((s) => ({ taskComments: [...s.taskComments, newComment] }))
        get().addActivityLog({ taskId: comment.taskId, actorId: comment.authorId, action: 'commented' })
        if (comment.attachments.length > 0) {
          get().addActivityLog({
            taskId: comment.taskId,
            actorId: comment.authorId,
            action: 'file_uploaded',
            detail: comment.attachments.map(a => a.name).join(', '),
          })
        }
        return newComment
      },

      deleteComment: (commentId) => {
        set((s) => ({ taskComments: s.taskComments.filter(c => c.id !== commentId) }))
      },

      getTaskComments: (taskId) => {
        return get().taskComments.filter(c => c.taskId === taskId)
      },

      addActivityLog: (log) => {
        const entry: ActivityLog = {
          ...log,
          id: uuidv4(),
          timestamp: new Date().toISOString(),
        }
        set((s) => ({ activityLogs: [...s.activityLogs, entry] }))
      },

      getActivityLogs: (taskId) => {
        return get().activityLogs.filter(l => l.taskId === taskId)
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
