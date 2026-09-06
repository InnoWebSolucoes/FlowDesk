import { create } from 'zustand'
import { supabase } from '../lib/supabaseClient'

/**
 * Who may run a project.
 *
 * The owner reaches everything; everyone else is an admin only of the projects
 * they appear here for. Only the owner can write to this table — the policy
 * enforces it, so an admin cannot widen their own reach by calling these.
 */
interface ProjectAdminState {
  /** project id -> the user ids who administer it. */
  byProject: Record<string, string[]>
  /** Every admin account, so the owner can pick who to grant access to. */
  admins: { id: string; name: string; email: string; isOwner: boolean }[]
  loading: boolean
  load: (projectId: string) => Promise<void>
  grant: (projectId: string, userId: string) => Promise<void>
  revoke: (projectId: string, userId: string) => Promise<void>
  /**
   * Make someone an admin, or put them back to being an employee. Owner-only:
   * the users policy refuses it for anyone else, this just keeps the control
   * out of their way.
   */
  setRole: (userId: string, role: 'admin' | 'employee') => Promise<void>
}

export const useProjectAdminStore = create<ProjectAdminState>()((set, get) => ({
  byProject: {},
  admins: [],
  loading: false,

  load: async (projectId) => {
    set({ loading: true })
    const { data, error } = await supabase
      .from('project_admins')
      .select('user_id')
      .eq('project_id', projectId)

    if (error) {
      console.error('[projectAdmins] load failed:', error)
      set({ loading: false })
      return
    }
    // The admin roster comes along, because the grant list is meaningless
    // without the names to choose from.
    const { data: people } = await supabase
      .from('users')
      .select('id, name, email, is_owner')
      .eq('role', 'admin')

    set((s) => ({
      byProject: { ...s.byProject, [projectId]: (data ?? []).map((r) => r.user_id) },
      admins: (people ?? []).map((p: any) => ({
        id: p.id, name: p.name, email: p.email, isOwner: !!p.is_owner,
      })),
      loading: false,
    }))
  },

  grant: async (projectId, userId) => {
    const { error } = await supabase
      .from('project_admins')
      .insert({ project_id: projectId, user_id: userId })
    if (error) {
      console.error('[projectAdmins] grant failed:', error)
      throw new Error(error.message)
    }
    await get().load(projectId)
  },

  setRole: async (userId, role) => {
    const { error } = await supabase.from('users').update({ role }).eq('id', userId)
    if (error) {
      console.error('[projectAdmins] role change failed:', error)
      throw new Error(error.message)
    }
    // Dropping back to employee leaves their grants behind, where they would
    // silently take effect again if they were ever promoted a second time.
    if (role === 'employee') {
      await supabase.from('project_admins').delete().eq('user_id', userId)
    }
  },

  revoke: async (projectId, userId) => {
    const { error } = await supabase
      .from('project_admins')
      .delete()
      .eq('project_id', projectId)
      .eq('user_id', userId)
    if (error) {
      console.error('[projectAdmins] revoke failed:', error)
      throw new Error(error.message)
    }
    await get().load(projectId)
  },
}))
