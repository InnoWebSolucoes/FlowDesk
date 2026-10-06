import { create } from 'zustand'
import { supabase } from '../lib/supabaseClient'
import { Employee, CompletionLog, EmployeeStats, DailyStats, Task } from '../types'
import { getTasksDueOnDate } from '../utils/taskScheduler'
import { format, subDays, parseISO } from 'date-fns'
import { isHexColor, cachedColor, defaultColor, rememberColors } from '../lib/personColor'

interface CreateEmployeeInput {
  name: string
  email: string
  password: string
  jobTitle: string
  department: string
  projectId?: string | null
  /** Their colour, picked in the same form they are added with. */
  calendarColor?: string | null
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
  /**
   * `warning` is set when the person was created but their colour did not
   * save: they exist, so it is not a failure, but it should not pass silently.
   */
  createEmployee: (input: CreateEmployeeInput) => Promise<{ success: boolean; error?: string; warning?: string }>
  /** Put an existing person on another project, keeping the ones they have. */
  addToProject: (employeeId: string, projectId: string) => Promise<void>
  removeFromProject: (employeeId: string, projectId: string) => Promise<void>
  updateEmployee: (id: string, updates: Partial<Employee>) => Promise<void>
  deleteEmployee: (id: string) => Promise<{ success: boolean; error?: string }>
  /** Stop somebody signing in, or let them back in, without losing anything. */
  setEmployeeActive: (id: string, active: boolean) => Promise<{ success: boolean; error?: string }>
  getEmployeeStats: (employeeId: string, completionLogs: CompletionLog[], tasks: Task[]) => EmployeeStats
  getProjectEmployees: (projectId: string) => Employee[]
}

function toEmployee(row: any): Employee {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    avatarInitials: row.avatar_initials,
    joinDate: row.join_date,
    jobTitle: row.job_title ?? '',
    department: row.department ?? '',
    managerId: row.manager_id,
    role: row.role ?? 'employee',
    // Rows predating the column are people who are still here.
    isActive: row.is_active ?? true,
    projectId: row.project_id ?? null,
    projectIds: (row.project_members ?? []).map((m: any) => m.project_id),
    // Null until somebody picks one; they are drawn in the default until then.
    calendarColor: row.calendar_color ?? null,
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
    /**
     * Asked for twice: once with the calendar colour, and again without it if
     * that column is not there yet.
     *
     * Postgres rejects the whole select over one unknown column, so naming a
     * column before its migration has run does not return the other fields
     * with a gap — it returns nothing at all, and every screen that reads the
     * team then shows an empty team and no work. The column is newer than the
     * database it has to run against, so it is asked for as an extra and
     * never as a requirement.
     */
    const COLS =
      'id, email, name, role, avatar_initials, join_date, job_title, department, manager_id, project_id, is_active, project_members(project_id)'
    const withColour = await supabase.from('users').select(`${COLS}, calendar_color`).order('name')
    const res = withColour.error
      ? await supabase.from('users').select(COLS).order('name')
      : withColour
    const error = res.error
    // The two selects differ by one column, so their row types differ; the
    // mapper reads whatever is there and defaults the rest.
    const data = res.data as Record<string, unknown>[] | null

    if (!error && data) {
      const all = data.map(toEmployee)
      // Before the set, so the redraw it causes already sees the new colours.
      rememberColors(all)
      set((s) => ({ allEmployees: all, employees: scoped(all, s.scopedProjectId), loading: false }))
    } else {
      set({ loading: false })
    }
  },

  createEmployee: async ({ calendarColor, ...input }) => {
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

    // The colour is written here rather than sent to the function, so the
    // function does not need redeploying for it. Its users row is made by the
    // signup trigger inside the same insert, so it is there to update by the
    // time the function answers.
    let warning: string | undefined
    if (isHexColor(calendarColor) && data?.id) {
      const { error: colourErr } = await supabase
        .from('users')
        .update({ calendar_color: calendarColor })
        .eq('id', data.id)
      if (colourErr) warning = colourErr.message
    }

    await get().initialize()
    return { success: true, warning }
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
    if (updates.calendarColor !== undefined) patch.calendar_color = updates.calendarColor

    // Surfaced rather than swallowed: a write that RLS or a missing column
    // refuses used to leave the screen showing the new value and the database
    // holding the old one, which reads as "saved" and is not.
    const { error } = await supabase.from('users').update(patch).eq('id', id)
    if (error) throw new Error(error.message)
    set((s) => {
      // Re-derive the scoped list: a project change can move someone in or out.
      const all = s.allEmployees.map((e) => (e.id === id ? { ...e, ...updates } : e))
      if (updates.calendarColor !== undefined) rememberColors(all)
      return { allEmployees: all, employees: scoped(all, s.scopedProjectId) }
    })
  },

  setEmployeeActive: async (id, active) => {
    const { data, error } = await supabase.functions.invoke('deactivate-employee', {
      body: { employeeId: id, active },
    })

    if (error || data?.error) {
      // supabase-js discards the body on a non-2xx, so the specific reason
      // has to be read off the response before falling back to its generic
      // "Edge Function returned a non-2xx status code".
      let reason = data?.error as string | undefined
      if (!reason && error) {
        const res = (error as { context?: Response }).context
        if (res && typeof res.json === 'function') {
          const body = await res.json().catch(() => null)
          if (body?.error) reason = body.error
        }
      }
      return { success: false, error: reason ?? error?.message }
    }

    set((s) => {
      const all = s.allEmployees.map((e) => (e.id === id ? { ...e, isActive: active } : e))
      return { allEmployees: all, employees: scoped(all, s.scopedProjectId) }
    })
    return { success: true }
  },

  deleteEmployee: async (id) => {
    const { data, error } = await supabase.functions.invoke('delete-employee', {
      body: { employeeId: id },
    })

    if (error || data?.error) {
      // On a non-2xx, supabase-js discards the body and hands back a
      // FunctionsHttpError whose message is always the same unhelpful
      // "Edge Function returned a non-2xx status code". The function does say
      // what went wrong — forbidden, missing id, deleting your own account —
      // so read it off the response before falling back to that.
      let reason = data?.error as string | undefined
      if (!reason && error) {
        const res = (error as { context?: Response }).context
        if (res && typeof res.json === 'function') {
          const body = await res.json().catch(() => null)
          if (body?.error) reason = body.error
        }
      }
      return { success: false, error: reason ?? error?.message }
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

/**
 * Somebody's colour, kept current: it redraws when it is changed.
 *
 * Until the team has loaded, last load's copy stands in for it, so their side
 * of the app does not open in the default and switch a moment later.
 */
export function usePersonColor(id: string | null | undefined): string {
  const loaded = useEmployeeStore((s) => s.allEmployees.length > 0)
  const chosen = useEmployeeStore((s) => s.allEmployees.find((e) => e.id === id)?.calendarColor)
  if (isHexColor(chosen)) return chosen
  return (loaded ? undefined : cachedColor(id)) ?? defaultColor(id)
}
