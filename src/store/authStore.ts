import { create } from 'zustand'
import { supabase } from '../lib/supabaseClient'
import { User } from '../types'

type AuthStatus = 'loading' | 'authenticated' | 'unauthenticated'

interface AuthState {
  /**
   * Who the app should behave as. Normally the signed-in account; while an
   * owner is previewing somebody's side of FlowDesk, the person being viewed.
   *
   * Every employee page reads this to decide whose todos, notes, calendar and
   * tasks to show, so swapping it here is what makes the preview real rather
   * than a mock-up that drifts from the thing it is imitating.
   */
  currentUser: User | null
  /**
   * The account actually signed in. Always the real one, never the previewed
   * person — anything that must be true of the human at the keyboard reads
   * this: who is being billed for the session, whose usage is recorded, whose
   * chat rooms are loaded, and whether the preview may be entered at all.
   */
  realUser: User | null
  /** The person being previewed, or null when not previewing. */
  viewAs: User | null
  /**
   * The page the preview was entered from, so leaving puts you back exactly
   * where you were. Rebuilding the path from the employee's project sent you
   * to the top of it instead, which meant finding your way back through the
   * project and the team list every time.
   */
  viewAsReturnTo: string | null
  /**
   * Enter or leave the preview. Owner-only, and refused for anyone else here
   * as well as by RLS — this switches what the interface shows, and showing
   * somebody an interface they cannot use would be its own kind of lie.
   */
  setViewAs: (user: User | null, returnTo?: string) => void
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
    .select('id, email, name, role, avatar_initials, join_date, project_id, is_owner')
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
    isOwner: data.is_owner ?? false,
  }
}

export const useAuthStore = create<AuthState>()((set, get) => ({
  currentUser: null,
  realUser: null,
  viewAs: null,
  viewAsReturnTo: null,
  status: 'loading',

  setViewAs: (user, returnTo) => {
    const real = get().realUser
    if (!real?.isOwner) return
    set({
      viewAs: user,
      currentUser: user ?? real,
      // Deliberately survives leaving the preview.
      //
      // Clearing it here is what sent you out of the project entirely.
      // Dropping the preview flips currentUser back to the owner while the
      // router is still on an /employee route, so ProtectedRoute bounces the
      // now-admin off it — and that redirect raced the banner's own navigate
      // and usually won. Both of them read this to decide where to go, so
      // they have to agree, which means it must still be here when the
      // redirect runs. Entering a preview overwrites it; signing in or out
      // clears it.
      viewAsReturnTo: returnTo ?? get().viewAsReturnTo,
    })
  },

  initialize: async () => {
    const { data: { session } } = await supabase.auth.getSession()
    if (session?.user) {
      const profile = await fetchProfile(session.user.id)
      set({ currentUser: profile, realUser: profile, viewAs: null, viewAsReturnTo: null, status: profile ? 'authenticated' : 'unauthenticated' })
    } else {
      set({ currentUser: null, realUser: null, viewAs: null, viewAsReturnTo: null, status: 'unauthenticated' })
    }

    supabase.auth.onAuthStateChange(async (_event, session) => {
      if (session?.user) {
        const profile = await fetchProfile(session.user.id)
        // A token refresh must not drop the preview: this fires on its own
        // every hour, and being thrown back to the admin side mid-sentence
        // would look like the app losing its place.
        const stillPreviewing = get().viewAs
        set({
          realUser: profile,
          currentUser: stillPreviewing ?? profile,
          status: profile ? 'authenticated' : 'unauthenticated',
        })
      } else {
        set({ currentUser: null, realUser: null, viewAs: null, viewAsReturnTo: null, status: 'unauthenticated' })
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
    set({ currentUser: profile, realUser: profile, viewAs: null, viewAsReturnTo: null, status: 'authenticated' })
    return { success: true }
  },

  logout: async () => {
    await supabase.auth.signOut()
    set({ currentUser: null, realUser: null, viewAs: null, viewAsReturnTo: null, status: 'unauthenticated' })
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
