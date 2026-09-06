import { create } from 'zustand'
import { supabase } from '../lib/supabaseClient'
import { Employee, CompletionLog, EmployeeStats, DailyStats, Task } from '../types'
import { getTasksDueOnDate } from '../utils/taskScheduler'
import { format, subDays, parseISO } from 'date-fns'

interface CreateEmployeeInput {
  name: string
  email: string
  password: string
  jobTitle: string
  department: string
  projectId?: string | null
}

interface EmployeeState {
  /** Employees of the project currently being viewed, or all when unscoped. */
  employees: Employee[]
  /** Every employee, regardless of scope. */
  allEmployees: Employee[]
  /** Project the list above is narrowed to; null means no narrowing. */
  scopedProjectId: string | null
  setProjectScope: (projectId: string | null) => void
  loading: boolean

  initialize: () => Promise<void>
  createEmployee: (input: CreateEmployeeInput) => Promise<{ success: boolean; error?: string }>
  /** Put an existing person on another project, keeping the ones they have. */
  addToProject: (employeeId: string, projectId: string) => Promise<void>
  removeFromProject: (employeeId: string, projectId: string) => Promise<void>
  updateEmployee: (id: string, updates: Partial<Employee>) => Promise<void>
  deleteEmployee: (id: string) => Promise<{ success: boolean; error?: string }>
  getEmployeeStats: (employeeId: string, completionLogs: CompletionLog[], tasks: Task[]) => EmployeeStats
  getProjectEmployees: (projectId: string) => Employee[]
}

function toEmployee(row: any): Employee {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    role: 'employee',
    avatarInitials: row.avatar_initials,
    joinDate: row.join_date,
    jobTitle: row.job_title ?? '',
    department: row.department ?? '',
    managerId: row.manager_id,
    projectId: row.project_id ?? null,
    projectIds: (row.project_members ?? []).map((m: any) => m.project_id),
  }
}

/** Narrow the visible list to one project, so pages reading `employees` are
 *  scoped without each needing to know about projects. */
function scoped(all: Employee[], projectId: string | null) {
  if (!projectId) return all
  // Membership decides who is on a project, not the primary column: someone
  // whose main project is elsewhere still works here and must show up here.
  return all.filter((e) =>
    e.projectIds?.length ? e.projectIds.includes(projectId) : e.projectId === projectId,
  )
}

export const useEmployeeStore = create<EmployeeState>()((set, get) => ({
  employees: [],
  allEmployees: [],
  scopedProjectId: null,
  loading: false,

  setProjectScope: (projectId) =>
    set((s) => ({ scopedProjectId: projectId, employees: scoped(s.allEmployees, projectId) })),

  initialize: async () => {
    set({ loading: true })
    const { data, error } = await supabase
      .from('users')
      .select('id, email, name, avatar_initials, join_date, job_title, department, manager_id, project_id, project_members(project_id)')
      .eq('role', 'employee')
      .order('name')

    if (!error && data) {
      const all = data.map(toEmployee)
      set((s) => ({ allEmployees: all, employees: scoped(all, s.scopedProjectId), loading: false }))
    } else {
      set({ loading: false })
    }
  },

  createEmployee: async (input) => {
    const { data, error } = await supabase.functions.invoke('create-employee', {
      body: input,
    })

    if (error) {
      let message = error.message
      try {
        const ctx = (error as any).context
        // A 404 means the function was never deployed to this project, which
        // otherwise surfaces as an opaque "failed to send a request".
        if (ctx?.status === 404) {
          return {
            success: false,
            error:
              'The create-employee function is not deployed to Supabase yet. Run "supabase functions deploy create-employee".',
          }
        }
        if (ctx?.json) {
          const body = await ctx.json()
          if (body?.error) message = body.error
        }
      } catch {
        // ignore parse failures, fall back to error.message
      }
      return { success: false, error: message }
    }

    if (data?.error) {
      return { success: false, error: data.error }
    }

    await get().initialize()
    return { success: true }
  },

  addToProject: async (employeeId, projectId) => {
    const { error } = await supabase
      .from('project_members')
      .insert({ user_id: employeeId, project_id: projectId })
    if (error && !error.message.includes('duplicate')) {
      console.error('[addToProject] failed:', error)
      throw new Error(error.message)
    }
    await get().initialize()
  },

  removeFromProject: async (employeeId, projectId) => {
    const { error } = await supabase
      .from('project_members')
      .delete()
      .eq('user_id', employeeId)
      .eq('project_id', projectId)
    if (error) {
      console.error('[removeFromProject] failed:', error)
      throw new Error(error.message)
    }
    await get().initialize()
  },

  updateEmployee: async (id, updates) => {
    const patch: Record<string, unknown> = {}
    if (updates.name !== undefined) patch.name = updates.name
    if (updates.jobTitle !== undefined) patch.job_title = updates.jobTitle
    if (updates.department !== undefined) patch.department = updates.department
    if (updates.avatarInitials !== undefined) patch.avatar_initials = updates.avatarInitials
    if (updates.projectId !== undefined) patch.project_id = updates.projectId

    await supabase.from('users').update(patch).eq('id', id)
    set((s) => {
      // Re-derive the scoped list: a project change can move someone in or out.
      const all = s.allEmployees.map((e) => (e.id === id ? { ...e, ...updates } : e))
      return { allEmployees: all, employees: scoped(all, s.scopedProjectId) }
    })
  },

  deleteEmployee: async (id) => {
    const { data, error } = await supabase.functions.invoke('delete-employee', {
      body: { employeeId: id },
    })

    if (error || data?.error) {
      return { success: false, error: data?.error ?? error?.message }
    }

    set((s) => {
      const all = s.allEmployees.filter((e) => e.id !== id)
      return { allEmployees: all, employees: scoped(all, s.scopedProjectId) }
    })
    return { success: true }
  },

  getProjectEmployees: (projectId) => get().allEmployees.filter((e) => e.projectId === projectId),

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
}))
