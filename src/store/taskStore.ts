import { create } from 'zustand'
import { supabase } from '../lib/supabaseClient'
import { TaskSchedule, Task, CompletionLog, Category, TaskComment, TaskAttachment, ActivityLog } from '../types'
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
  /** Re-read everything. Used by the live subscription below. */
  refresh: () => Promise<void>
  /** Stop listening for live task changes. */
  teardown: () => void

  addTask: (task: Omit<Task, 'id' | 'createdAt' | 'schedules'> & { schedules?: TaskSchedule[] }) => Promise<void>
  /**
   * When one person plans to do a task. Stored on their assignment, so two
   * people assigned the same task can schedule it independently.
   */
  setTaskDoDate: (
    taskId: string,
    employeeId: string,
    schedule: { doDate: string | null; doStart?: string | null; doEnd?: string | null },
  ) => Promise<void>
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
    deadline: row.deadline ?? null,
    schedules: (row.task_assignments ?? []).map((a: any) => ({
      employeeId: a.employee_id,
      doDate: a.do_date ?? null,
      doStart: a.do_start ?? null,
      doEnd: a.do_end ?? null,
    })),
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

/**
 * Live subscription. Kept outside the store because it is a connection, not
 * state, and must survive re-renders.
 */
let channel: ReturnType<typeof supabase.channel> | null = null

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
    await get().refresh()

    // Without this, an employee had to reload to see a task an admin had just
    // assigned them: every one of these tables is written by someone else's
    // client, so a fetch on mount was never going to show it.
    if (channel) return
    const refetch = () => { get().refresh() }
    channel = supabase
      .channel('tasks-live')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tasks' }, refetch)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'task_assignments' }, refetch)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'completion_logs' }, refetch)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'task_statuses' }, refetch)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'task_comments' }, refetch)
      .subscribe()
  },

  teardown: () => {
    if (!channel) return
    supabase.removeChannel(channel)
    channel = null
  },

  refresh: async () => {
    set({ loading: true })

    // The scheduling columns arrive with the task-dates migration. Asking for
    // them before it has run makes PostgREST reject the whole query, which
    // emptied the task list entirely and looked exactly like every task having
    // been deleted. Fall back to the shape that has always existed instead.
    const fetchTasks = async () => {
      const withDates = await supabase
        .from('tasks')
        .select('*, task_assignments(employee_id, do_date, do_start, do_end)')

      if (!withDates.error) return withDates

      console.warn(
        '[tasks] scheduling columns missing, falling back — run the task-dates migration:',
        withDates.error.message,
      )
      return supabase.from('tasks').select('*, task_assignments(employee_id)')
    }

    const [tasksRes, categoriesRes, logsRes, statusesRes, commentsRes, activityRes] = await Promise.all([
      fetchTasks(),
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

    // A failed fetch must not be mistaken for "there are no tasks": blanking
    // the list on error is what made a missing column look like data loss.
    if (tasksRes.error) {
      console.error('[tasks] load failed:', tasksRes.error)
      set({ loading: false })
      return
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
    const base = {
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
    }

    // deadline arrives with the task-dates migration. Retry without it rather
    // than refusing to create the task at all when that has not run yet.
    let { data, error } = await supabase
      .from('tasks')
      .insert({ ...base, deadline: task.deadline || null })
      .select()
      .single()

    if (error) {
      console.warn('[addTask] retrying without deadline — run the task-dates migration:', error.message)
      ;({ data, error } = await supabase.from('tasks').insert(base).select().single())
    }

    // Swallowing this made a failed save look like a successful one: the form
    // closed, nothing appeared, and there was nothing to go on. Throw so the
    // caller can say what went wrong.
    if (error || !data) {
      console.error('[addTask] failed:', error)
      throw new Error(error?.message ?? 'The task could not be saved.')
    }

    if (task.assignedTo.length > 0) {
      const { error: assignError } = await supabase
        .from('task_assignments')
        .insert(task.assignedTo.map((employeeId) => ({ task_id: data.id, employee_id: employeeId })))

      // The task exists but reaches nobody, which looks identical to a task
      // that was never created. Say so rather than leaving it orphaned.
      if (assignError) {
        console.error('[addTask] assignments failed:', assignError)
        throw new Error(`The task was created but could not be assigned: ${assignError.message}`)
      }
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
    if (updates.deadline !== undefined) patch.deadline = updates.deadline || null
    if (updates.isActive !== undefined) patch.is_active = updates.isActive

    if (Object.keys(patch).length > 0) {
      let { error } = await supabase.from('tasks').update(patch).eq('id', id)
      if (error && 'deadline' in patch) {
        // Same pre-migration fallback as addTask: keep the rest of the edit
        // rather than losing the whole change.
        console.warn('[updateTask] retrying without deadline:', error.message)
        const { deadline: _drop, ...legacy } = patch
        if (Object.keys(legacy).length > 0) {
          ;({ error } = await supabase.from('tasks').update(legacy).eq('id', id))
        } else {
          error = null
        }
      }
      if (error) {
        console.error('[updateTask] failed:', error)
        throw new Error(error.message)
      }
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

  setTaskDoDate: async (taskId, employeeId, schedule) => {
    const patch = {
      do_date: schedule.doDate || null,
      do_start: schedule.doStart ?? null,
      do_end: schedule.doEnd ?? null,
    }
    const { error } = await supabase
      .from('task_assignments')
      .update(patch)
      .eq('task_id', taskId)
      .eq('employee_id', employeeId)

    if (error) {
      console.error('[setTaskDoDate] failed:', error)
      throw new Error(error.message)
    }

    set((s) => applyTasks(s.scopedProjectId, s.allTasks.map((t) => {
      if (t.id !== taskId) return t
      const schedules = t.schedules.some((x) => x.employeeId === employeeId)
        ? t.schedules.map((x) =>
            x.employeeId === employeeId
              ? { ...x, doDate: schedule.doDate, doStart: schedule.doStart ?? null, doEnd: schedule.doEnd ?? null }
              : x)
        : [...t.schedules, {
            employeeId,
            doDate: schedule.doDate,
            doStart: schedule.doStart ?? null,
            doEnd: schedule.doEnd ?? null,
          }]
      return { ...t, schedules }
    })))
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
