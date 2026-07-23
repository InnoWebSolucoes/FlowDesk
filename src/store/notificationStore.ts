import { create } from 'zustand'
import { supabase } from '../lib/supabaseClient'
import { AppNotification } from '../types'

interface NotificationState {
  notifications: AppNotification[]
  loading: boolean

  initialize: () => Promise<void>
  addNotification: (notif: Omit<AppNotification, 'id' | 'createdAt' | 'isRead'>) => Promise<void>
  markRead: (id: string) => Promise<void>
  markAllRead: () => Promise<void>
  dismiss: (id: string) => Promise<void>
  getUnreadCount: (userId: string) => number
  getNotificationsFor: (userId: string) => AppNotification[]
}

function toNotification(row: any): AppNotification {
  return {
    id: row.id,
    type: row.type,
    title: row.title,
    message: row.message,
    taskId: row.task_id ?? undefined,
    isRead: row.is_read,
    createdAt: row.created_at,
    targetUserId: row.target_user_id,
    targetRole: row.target_role,
  }
}

export const useNotificationStore = create<NotificationState>()((set, get) => ({
  notifications: [],
  loading: false,

  initialize: async () => {
    set({ loading: true })
    const { data } = await supabase
      .from('notifications')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(100)

    set({ notifications: (data ?? []).map(toNotification), loading: false })
  },

  addNotification: async (notif) => {
    const today = new Date().toISOString().slice(0, 10)
    const exists = get().notifications.some(
      (n) =>
        n.type === notif.type &&
        n.taskId === notif.taskId &&
        n.targetUserId === notif.targetUserId &&
        n.targetRole === notif.targetRole &&
        n.createdAt.startsWith(today)
    )
    if (exists) return

    const { data, error } = await supabase
      .from('notifications')
      .insert({
        type: notif.type,
        title: notif.title,
        message: notif.message,
        task_id: notif.taskId ?? null,
        target_user_id: notif.targetUserId,
        target_role: notif.targetRole,
      })
      .select()
      .single()

    if (error || !data) return
    set((s) => ({ notifications: [toNotification(data), ...s.notifications].slice(0, 100) }))
  },

  markRead: async (id) => {
    await supabase.from('notifications').update({ is_read: true }).eq('id', id)
    set((s) => ({ notifications: s.notifications.map((n) => (n.id === id ? { ...n, isRead: true } : n)) }))
  },

  markAllRead: async () => {
    const ids = get().notifications.filter((n) => !n.isRead).map((n) => n.id)
    if (ids.length === 0) return
    await supabase.from('notifications').update({ is_read: true }).in('id', ids)
    set((s) => ({ notifications: s.notifications.map((n) => ({ ...n, isRead: true })) }))
  },

  dismiss: async (id) => {
    await supabase.from('notifications').delete().eq('id', id)
    set((s) => ({ notifications: s.notifications.filter((n) => n.id !== id) }))
  },

  getUnreadCount: (userId) =>
    get().notifications.filter((n) => !n.isRead && (n.targetUserId === userId || n.targetRole === 'admin')).length,

  getNotificationsFor: (userId) =>
    get().notifications.filter((n) => n.targetUserId === userId || n.targetRole === 'admin'),
}))
