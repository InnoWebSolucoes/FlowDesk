import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { AppNotification } from '../types'
import { v4 as uuidv4 } from 'uuid'

interface NotificationState {
  notifications: AppNotification[]
  addNotification: (notif: Omit<AppNotification, 'id' | 'createdAt' | 'isRead'>) => void
  markRead: (id: string) => void
  markAllRead: () => void
  dismiss: (id: string) => void
  getUnreadCount: (userId: string) => number
  getNotificationsFor: (userId: string) => AppNotification[]
}

export const useNotificationStore = create<NotificationState>()(
  persist(
    (set, get) => ({
      notifications: [],

      addNotification: (notif) => {
        // Prevent duplicate notifications of same type+taskId within same day
        const today = new Date().toISOString().slice(0, 10)
        const exists = get().notifications.some(
          n =>
            n.type === notif.type &&
            n.taskId === notif.taskId &&
            n.targetUserId === notif.targetUserId &&
            n.createdAt.startsWith(today)
        )
        if (exists) return
        set(s => ({
          notifications: [
            {
              ...notif,
              id: uuidv4(),
              createdAt: new Date().toISOString(),
              isRead: false,
            },
            ...s.notifications,
          ].slice(0, 100), // keep max 100
        }))
      },

      markRead: (id) =>
        set(s => ({
          notifications: s.notifications.map(n => (n.id === id ? { ...n, isRead: true } : n)),
        })),

      markAllRead: () =>
        set(s => ({
          notifications: s.notifications.map(n => ({ ...n, isRead: true })),
        })),

      dismiss: (id) =>
        set(s => ({
          notifications: s.notifications.filter(n => n.id !== id),
        })),

      getUnreadCount: (userId) =>
        get().notifications.filter(
          n => !n.isRead && (n.targetUserId === userId || n.targetUserId === 'admin')
        ).length,

      getNotificationsFor: (userId) =>
        get().notifications.filter(
          n => n.targetUserId === userId || n.targetUserId === 'admin'
        ),
    }),
    { name: 'flowdesk-notifications' }
  )
)
