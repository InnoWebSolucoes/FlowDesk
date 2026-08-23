import { create } from 'zustand'
import { supabase } from '../lib/supabaseClient'
import { Task, CompletionLog, Category, TaskComment, TaskAttachment, ActivityLog } from '../types'
import { getTasksDueOnDate, getTasksDueThisWeek, getTasksDueThisMonth, getTimeOfDay } from '../utils/taskScheduler'
import { format } from 'date-fns'

interface TaskState {
  /** Tasks of the project being viewed, or all when unscoped. */
  tasks: Task[]
  /** Every task, regardless of scope. */
  allTasks: Task[]
  scopedProjectId: string | null
  setProjectScope: (projectId: string | null) => void
  completionLogs: CompletionLog[]
  categories: Category[]
  loading: boolean
  taskStatuses: Record<string, 'in_progress'>
  taskComments: TaskComment[]
  activityLogs: ActivityLog[]

  initialize: () => Promise<void>

  addTask: (task: Omit<Task, 'id' | 'createdAt'>) => Promise<void>
  updateTask: (id: string, updates: Partial<Task>) => Promise<void>
  deleteTask: (id: string) => Promise<void>

  completeTask: (taskId: string, employeeId: string, dueDate: string) => Promise<void>
  uncompleteTask: (taskId: string, employeeId: string, dueDate: string) => Promise<void>
  isTaskCompleted: (taskId: string, employeeId: string, date: string) => boolean

  setInProgress: (taskId: string, empId: string, date: string) => Promise<void>
  clearInProgress: (taskId: string, empId: string, date: string) => Promise<void>
  isInProgress: (taskId: string, empId: string, date: string) => boolean

  addComment: (comment: Omit<TaskComment, 'id' | 'createdAt'> & { attachments: TaskAttachment[] }) => Promise<TaskComment>
  deleteComment: (commentId: string) => Promise<void>
  getTaskComments: (taskId: string) => TaskComment[]

  addActivityLog: (log: Omit<ActivityLog, 'id' | 'timestamp'>) => Promise<void>
  getActivityLogs: (taskId: string) => ActivityLog[]

  addCategory: (category: Omit<Category, 'id'>) => Promise<Category>
  updateCategory: (id: string, updates: Partial<Category>) => Promise<void>
  deleteCategory: (id: string) => Promise<void>

  getProjectTasks: (projectId: string) => Task[]
  getTasksDueToday: (employeeId: string, date: Date) => Task[]
  getTasksDueThisWeek: (employeeId: string, weekStart: Date) => Record<string, Task[]>
  getTasksDueThisMonth: (employeeId: string, month: number, year: number) => Record<number, Task[]>
}

function toTask(row: any): Task {
  return {
    id: row.id,
    projectId: row.project_id,
    title: row.title,
    description: row.description,
    assignedTo: (row.task_assignments ?? []).map((a: any) => a.employee_id),
    frequency: row.frequency,
    categoryId: row.category_id,
    priority: row.priority,
    associatedTool: row.associated_tool ?? undefined,
    estimatedMinutes: row.estimated_minutes,
    createdAt: row.created_at,
    createdBy: row.created_by,
    isActive: row.is_active,
  }
}

function toCompletionLog(row: any): CompletionLog {
  return {
    id: row.id,
    taskId: row.task_id,
    employeeId: row.employee_id,
    completedAt: row.completed_at,
    dueDate: row.due_date,
    wasLate: row.was_late,
    timeOfDay: row.time_of_day,
  }
}

function toComment(row: any): TaskComment {
  return {
    id: row.id,
    taskId: row.task_id,
    authorId: row.author_id,
    content: row.content,
    createdAt: row.created_at,
    attachments: (row.task_attachments ?? []).map((a: any) => ({
      id: a.id,
      name: a.name,
      type: a.type,
      size: a.size,
      storagePath: a.storage_path,
      uploadedAt: a.uploaded_at,
      uploadedBy: a.uploaded_by,
    })),
  }
}

function toActivityLog(row: any): ActivityLog {
  return {
    id: row.id,
    taskId: row.task_id,
    actorId: row.actor_id,
    action: row.action,
    detail: row.detail ?? undefined,
    timestamp: row.timestamp,
  }
}

/** Keep `allTasks` authoritative and re-derive the scoped `tasks` from it. */
function applyTasks(scopedProjectId: string | null, all: Task[]) {
  return {
    allTasks: all,
    tasks: scopedProjectId ? all.filter((t) => t.projectId === scopedProjectId) : all,
  }
}

export const useTaskStore = create<TaskState>()((set, get) => ({
  tasks: [],
  allTasks: [],
  scopedProjectId: null,

  setProjectScope: (projectId) =>
    set((s) => ({
      scopedProjectId: projectId,
      tasks: projectId ? s.allTasks.filter((t) => t.projectId === projectId) : s.allTasks,
    })),

  completionLogs: [],
  categories: [],
  loading: false,
  taskStatuses: {},
  taskComments: [],
  activityLogs: [],

  initialize: async () => {
    set({ loading: true })

    const [tasksRes, categoriesRes, logsRes, statusesRes, commentsRes, activityRes] = await Promise.all([
      supabase.from('tasks').select('*, task_assignments(employee_id)'),
      supabase.from('categories').select('*'),
      supabase.from('completion_logs').select('*'),
      supabase.from('task_statuses').select('*'),
      supabase.from('task_comments').select('*, task_attachments(*)'),
      supabase.from('activity_logs').select('*'),
    ])

    const taskStatuses: Record<string, 'in_progress'> = {}
    for (const row of statusesRes.data ?? []) {
      taskStatuses[`${row.task_id}:${row.employee_id}:${row.due_date}`] = 'in_progress'
    }

    set({
      ...applyTasks(get().scopedProjectId, (tasksRes.data ?? []).map(toTask)),
      categories: categoriesRes.data ?? [],
      completionLogs: (logsRes.data ?? []).map(toCompletionLog),
      taskStatuses,
      taskComments: (commentsRes.data ?? []).map(toComment),
      activityLogs: (activityRes.data ?? []).map(toActivityLog),
      loading: false,
    })
  },

  addTask: async (task) => {
    const { data, error } = await supabase
      .from('tasks')
      .insert({
        project_id: task.projectId,
        title: task.title,
        description: task.description,
        frequency: task.frequency,
        category_id: task.categoryId,
        priority: task.priority,
        associated_tool: task.associatedTool ?? null,
        estimated_minutes: task.estimatedMinutes,
        created_by: task.createdBy,
        is_active: task.isActive,
      })
      .select()
      .single()

    if (error || !data) return

    if (task.assignedTo.length > 0) {
      await supabase
        .from('task_assignments')
        .insert(task.assignedTo.map((employeeId) => ({ task_id: data.id, employee_id: employeeId })))
    }

    set((s) => applyTasks(s.scopedProjectId, [
      ...s.allTasks,
      toTask({ ...data, task_assignments: task.assignedTo.map(id => ({ employee_id: id })) }),
    ]))
  },

  updateTask: async (id, updates) => {
    const patch: Record<string, unknown> = {}
    if (updates.title !== undefined) patch.title = updates.title
    if (updates.description !== undefined) patch.description = updates.description
    if (updates.frequency !== undefined) patch.frequency = updates.frequency
    if (updates.categoryId !== undefined) patch.category_id = updates.categoryId
    if (updates.priority !== undefined) patch.priority = updates.priority
    if (updates.associatedTool !== undefined) patch.associated_tool = updates.associatedTool
    if (updates.estimatedMinutes !== undefined) patch.estimated_minutes = updates.estimatedMinutes
    if (updates.isActive !== undefined) patch.is_active = updates.isActive

    if (Object.keys(patch).length > 0) {
      await supabase.from('tasks').update(patch).eq('id', id)
    }

    if (updates.assignedTo !== undefined) {
      await supabase.from('task_assignments').delete().eq('task_id', id)
      if (updates.assignedTo.length > 0) {
        await supabase
          .from('task_assignments')
          .insert(updates.assignedTo.map((employeeId) => ({ task_id: id, employee_id: employeeId })))
      }
    }

    set((s) => applyTasks(s.scopedProjectId, s.allTasks.map((t) => (t.id === id ? { ...t, ...updates } : t))))
  },

  deleteTask: async (id) => {
    await supabase.from('tasks').delete().eq('id', id)
    set((s) => applyTasks(s.scopedProjectId, s.allTasks.filter((t) => t.id !== id)))
  },

  completeTask: async (taskId, employeeId, dueDate) => {
    const now = new Date()
    const isoNow = now.toISOString()
    const wasLate = now.getHours() >= 16
    const timeOfDay = getTimeOfDay(isoNow)

    const { data, error } = await supabase
      .from('completion_logs')
      .insert({
        task_id: taskId,
        employee_id: employeeId,
        completed_at: isoNow,
        due_date: dueDate,
        was_late: wasLate,
        time_of_day: timeOfDay,
      })
      .select()
      .single()

    if (!error && data) {
      set((s) => ({ completionLogs: [...s.completionLogs, toCompletionLog(data)] }))
      await get().addActivityLog({ taskId, actorId: employeeId, action: 'completed' })
    }
  },

  uncompleteTask: async (taskId, employeeId, dueDate) => {
    await supabase
      .from('completion_logs')
      .delete()
      .eq('task_id', taskId)
      .eq('employee_id', employeeId)
      .eq('due_date', dueDate)

    set((s) => ({
      completionLogs: s.completionLogs.filter(
        (log) => !(log.taskId === taskId && log.employeeId === employeeId && log.dueDate === dueDate)
      ),
    }))

    await get().addActivityLog({ taskId, actorId: employeeId, action: 'uncompleted' })
  },

  isTaskCompleted: (taskId, employeeId, date) => {
    const dateStr = date.length === 10 ? date : format(new Date(date), 'yyyy-MM-dd')
    return get().completionLogs.some(
      (log) => log.taskId === taskId && log.employeeId === employeeId && log.dueDate === dateStr
    )
  },

  setInProgress: async (taskId, empId, date) => {
    const key = `${taskId}:${empId}:${date}`
    await supabase.from('task_statuses').upsert({ task_id: taskId, employee_id: empId, due_date: date, status: 'in_progress' })
    set((s) => ({ taskStatuses: { ...s.taskStatuses, [key]: 'in_progress' } }))
    await get().addActivityLog({ taskId, actorId: empId, action: 'in_progress' })
  },

  clearInProgress: async (taskId, empId, date) => {
    const key = `${taskId}:${empId}:${date}`
    await supabase.from('task_statuses').delete().eq('task_id', taskId).eq('employee_id', empId).eq('due_date', date)
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

  addComment: async (comment) => {
    const { data, error } = await supabase
      .from('task_comments')
      .insert({ task_id: comment.taskId, author_id: comment.authorId, content: comment.content })
      .select()
      .single()

    if (error || !data) throw error ?? new Error('Failed to add comment')

    if (comment.attachments.length > 0) {
      await supabase.from('task_attachments').insert(
        comment.attachments.map((a) => ({
          comment_id: data.id,
          name: a.name,
          type: a.type,
          size: a.size,
          storage_path: a.storagePath,
          uploaded_by: a.uploadedBy,
        }))
      )
    }

    const newComment: TaskComment = {
      id: data.id,
      taskId: data.task_id,
      authorId: data.author_id,
      content: data.content,
      createdAt: data.created_at,
      attachments: comment.attachments,
    }

    set((s) => ({ taskComments: [...s.taskComments, newComment] }))
    await get().addActivityLog({ taskId: comment.taskId, actorId: comment.authorId, action: 'commented' })
    if (comment.attachments.length > 0) {
      await get().addActivityLog({
        taskId: comment.taskId,
        actorId: comment.authorId,
        action: 'file_uploaded',
        detail: comment.attachments.map((a) => a.name).join(', '),
      })
    }
    return newComment
  },

  deleteComment: async (commentId) => {
    await supabase.from('task_comments').delete().eq('id', commentId)
    set((s) => ({ taskComments: s.taskComments.filter((c) => c.id !== commentId) }))
  },

  getTaskComments: (taskId) => get().taskComments.filter((c) => c.taskId === taskId),

  addActivityLog: async (log) => {
    const { data, error } = await supabase
      .from('activity_logs')
      .insert({ task_id: log.taskId, actor_id: log.actorId, action: log.action, detail: log.detail ?? null })
      .select()
      .single()

    if (!error && data) {
      set((s) => ({ activityLogs: [...s.activityLogs, toActivityLog(data)] }))
    }
  },

  getActivityLogs: (taskId) => get().activityLogs.filter((l) => l.taskId === taskId),

  addCategory: async (category) => {
    const { data, error } = await supabase.from('categories').insert(category).select().single()
    if (error || !data) throw error ?? new Error('Failed to add category')
    set((s) => ({ categories: [...s.categories, data] }))
    return data
  },

  updateCategory: async (id, updates) => {
    await supabase.from('categories').update(updates).eq('id', id)
    set((s) => ({ categories: s.categories.map((c) => (c.id === id ? { ...c, ...updates } : c)) }))
  },

  deleteCategory: async (id) => {
    await supabase.from('categories').delete().eq('id', id)
    set((s) => ({ categories: s.categories.filter((c) => c.id !== id) }))
  },

  getProjectTasks: (projectId) => get().allTasks.filter((t) => t.projectId === projectId),
  getTasksDueToday: (employeeId, date) => getTasksDueOnDate(get().tasks, employeeId, date),
  getTasksDueThisWeek: (employeeId, weekStart) => getTasksDueThisWeek(get().tasks, employeeId, weekStart),
  getTasksDueThisMonth: (employeeId, month, year) => getTasksDueThisMonth(get().tasks, employeeId, month, year),
}))
