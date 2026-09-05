import { create } from 'zustand'
import { supabase } from '../lib/supabaseClient'
import { User } from '../types'

type AuthStatus = 'loading' | 'authenticated' | 'unauthenticated'

interface AuthState {
  currentUser: User | null
  status: AuthStatus
  initialize: () => Promise<void>
  login: (email: string, password: string) => Promise<{ success: boolean; error?: string }>
  logout: () => Promise<void>
  requestPasswordReset: (email: string) => Promise<{ success: boolean; error?: string }>
  updatePassword: (newPassword: string) => Promise<{ success: boolean; error?: string }>
}

async function fetchProfile(userId: string): Promise<User | null> {
  // project_id comes along because an employee's whole workspace — their
  // todos, notes and resources — is scoped to the one project they belong to,
  // and there is no project picker on their side to get it from.
  const { data, error } = await supabase
    .from('users')
    .select('id, email, name, role, avatar_initials, join_date, project_id')
    .eq('id', userId)
    .single()

  if (error || !data) return null

  return {
    id: data.id,
    email: data.email,
    name: data.name,
    role: data.role,
    avatarInitials: data.avatar_initials,
    joinDate: data.join_date,
    projectId: data.project_id ?? null,
  }
}

export const useAuthStore = create<AuthState>()((set) => ({
  currentUser: null,
  status: 'loading',

  initialize: async () => {
    const { data: { session } } = await supabase.auth.getSession()
    if (session?.user) {
      const profile = await fetchProfile(session.user.id)
      set({ currentUser: profile, status: profile ? 'authenticated' : 'unauthenticated' })
    } else {
      set({ currentUser: null, status: 'unauthenticated' })
    }

    supabase.auth.onAuthStateChange(async (_event, session) => {
      if (session?.user) {
        const profile = await fetchProfile(session.user.id)
        set({ currentUser: profile, status: profile ? 'authenticated' : 'unauthenticated' })
      } else {
        set({ currentUser: null, status: 'unauthenticated' })
      }
    })
  },

  login: async (email, password) => {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password })
    if (error || !data.user) {
      return { success: false, error: error?.message }
    }
    const profile = await fetchProfile(data.user.id)
    if (!profile) {
      return { success: false, error: 'Profile not found' }
    }
    set({ currentUser: profile, status: 'authenticated' })
    return { success: true }
  },

  logout: async () => {
    await supabase.auth.signOut()
    set({ currentUser: null, status: 'unauthenticated' })
  },

  requestPasswordReset: async (email) => {
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/reset-password`,
    })
    if (error) return { success: false, error: error.message }
    return { success: true }
  },

  updatePassword: async (newPassword) => {
    const { error } = await supabase.auth.updateUser({ password: newPassword })
    if (error) return { success: false, error: error.message }
    return { success: true }
  },
}))
