import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { User } from '../types'
import { adminUser } from '../data/sampleData'

interface AuthState {
  currentUser: User | null
  isAuthenticated: boolean
  login: (email: string, password: string, employees: User[]) => boolean
  logout: () => void
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      currentUser: null,
      isAuthenticated: false,

      login: (email, password, employees) => {
        // Check admin
        if (email === adminUser.email && password === adminUser.password) {
          set({ currentUser: adminUser as User, isAuthenticated: true })
          return true
        }

        // Check employees
        const employee = employees.find(
          (e) => e.email === email && e.password === password
        )
        if (employee) {
          set({ currentUser: employee, isAuthenticated: true })
          return true
        }

        return false
      },

      logout: () => {
        set({ currentUser: null, isAuthenticated: false })
      },
    }),
    {
      name: 'flowdesk-auth',
    }
  )
)
