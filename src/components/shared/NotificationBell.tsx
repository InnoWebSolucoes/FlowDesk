import React, { useState, useEffect, useRef } from 'react'
import {
  Bell, X, CheckCircle2, AlertTriangle, MessageSquare, Clock, Calendar,
  PlayCircle, RotateCcw, Paperclip,
} from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { useNotificationStore } from '../../store/notificationStore'
import { useTaskStore } from '../../store/taskStore'
import { useAuthStore } from '../../store/authStore'
import { useEmployeeStore } from '../../store/employeeStore'
import { format, differenceInDays, parseISO } from 'date-fns'
import { useT } from '../../i18n/useT'
import { AppNotification } from '../../types'
import { getTasksDueOnDate } from '../../utils/taskScheduler'
import { withHighlight } from '../../lib/highlight'

function notifIcon(type: AppNotification['type']) {
  switch (type) {
    case 'task_assigned': return <CheckCircle2 size={14} className="text-primary" />
    case 'task_due_today': return <Clock size={14} className="text-amber" />
    case 'task_due_tomorrow': return <Calendar size={14} className="text-amber" />
    case 'task_overdue': return <AlertTriangle size={14} className="text-danger" />
    case 'comment_added': return <MessageSquare size={14} className="text-primary" />
    case 'workload_alert': return <AlertTriangle size={14} className="text-amber" />
    case 'inactivity_alert': return <AlertTriangle size={14} className="text-danger" />
    case 'task_started': return <PlayCircle size={14} className="text-primary" />
    case 'task_completed': return <CheckCircle2 size={14} className="text-success" />
    case 'task_reopened': return <RotateCcw size={14} className="text-amber" />
    case 'file_uploaded': return <Paperclip size={14} className="text-primary" />
    case 'chat_message': return <MessageSquare size={14} className="text-primary" />
    default: return <Bell size={14} className="text-text-muted" />
  }
}

export function NotificationBell() {
  const { t } = useT()
  const { currentUser } = useAuthStore()
  const { tasks, completionLogs } = useTaskStore()
  const { employees } = useEmployeeStore()
  const { notifications, addNotification, markRead, markAllRead, dismiss, getUnreadCount, getNotificationsFor } = useNotificationStore()

  const [open, setOpen] = useState(false)
  const panelRef = useRef<HTMLDivElement>(null)
  const navigate = useNavigate()

  const userId = currentUser?.id ?? ''
  const role = currentUser?.role ?? 'employee'

  // Generate due-date notifications on mount
  useEffect(() => {
    const today = new Date()
    const todayStr = format(today, 'yyyy-MM-dd')
    const tomorrow = new Date(today)
    tomorrow.setDate(tomorrow.getDate() + 1)
    const tomorrowStr = format(tomorrow, 'yyyy-MM-dd')

    for (const task of tasks) {
      if (task.frequency.type !== 'one-off' || !task.frequency.date) continue
      const taskDate = task.frequency.date

      const days = differenceInDays(parseISO(taskDate), today)

      if (days < 0) {
        // Overdue
        for (const empId of task.assignedTo) {
          addNotification({
            type: 'task_overdue',
            title: t('notif_overdue'),
            message: task.title,
            taskId: task.id,
            targetUserId: empId,
            targetRole: null,
          })
        }
        // Also alert admin
        addNotification({
          type: 'task_overdue',
          title: t('notif_overdue'),
          message: task.title,
          taskId: task.id,
          targetUserId: null,
          targetRole: 'admin',
        })
      } else if (taskDate === todayStr) {
        for (const empId of task.assignedTo) {
          addNotification({
            type: 'task_due_today',
            title: t('notif_dueToday'),
            message: task.title,
            taskId: task.id,
            targetUserId: empId,
            targetRole: null,
          })
        }
      } else if (taskDate === tomorrowStr) {
        for (const empId of task.assignedTo) {
          addNotification({
            type: 'task_due_tomorrow',
            title: t('notif_dueTomorrow'),
            message: task.title,
            taskId: task.id,
            targetUserId: empId,
            targetRole: null,
          })
        }
      }
    }

    // Workload alert for admin
    if (role === 'admin' && employees.length > 0) {
      const counts = employees.map(emp => getTasksDueOnDate(tasks, emp.id, today).length)
      const avg = counts.reduce((a, b) => a + b, 0) / counts.length
      if (avg > 0) {
        employees.forEach((emp, i) => {
          if (counts[i] > avg * 1.5) {
            addNotification({
              type: 'workload_alert',
              title: t('notif_workloadAlert'),
              message: `${emp.name}: ${counts[i]} tasks`,
              targetUserId: null,
              targetRole: 'admin',
            })
          }
        })
      }
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Close on outside click
  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  const userNotifs = getNotificationsFor(userId).slice(0, 30)
  const unreadCount = getUnreadCount(userId)

  const handleOpen = () => {
    setOpen(o => !o)
  }

  const handleMarkRead = (id: string) => {
    markRead(id)
  }

  const handleDismiss = (e: React.MouseEvent, id: string) => {
    e.stopPropagation()
    dismiss(id)
  }

  /**
   * Take the reader to whatever the notification is about — and point at it.
   *
   * Landing on the right page was never enough: My Tasks and the task manager
   * both show long lists, so the reader still had to find the one row the
   * notification meant. Every route built here therefore carries
   * `?highlight=<id>`, which the destination list uses to ring that row and
   * scroll it into view for a few seconds.
   */
  const openNotification = (notif: AppNotification) => {
    setOpen(false)

    // A message points at its room, not at a page of rows — the room itself is
    // the thing, and chat opens it directly.
    if (notif.conversationId) {
      navigate(
        `${role === 'admin' ? '/admin/chat' : '/employee/chat'}?conversation=${notif.conversationId}`
      )
      return
    }

    if (!notif.taskId) {
      // Workload and inactivity alerts are about a person, not one task, so
      // the team list is as specific as this can get.
      if (notif.type === 'workload_alert' || notif.type === 'inactivity_alert') {
        navigate(role === 'admin' ? '/admin/projects' : '/employee/tasks')
      }
      return
    }

    if (role !== 'admin') {
      navigate(withHighlight('/employee/tasks', notif.taskId))
      return
    }

    // The task carries its project, which is the only way to build the admin
    // route to it. Without it there is nowhere specific to go.
    const task = tasks.find(x => x.id === notif.taskId)
    navigate(
      task?.projectId
        ? withHighlight(`/admin/projects/${task.projectId}/employees/tasks`, notif.taskId)
        : '/admin/projects'
    )
  }

  return (
    <div className="relative" ref={panelRef}>
      <button
        onClick={handleOpen}
        className="relative p-2 rounded-lg hover:bg-surface-2 transition-colors"
        aria-label={t('notif_bell')}
      >
        <Bell size={20} className="text-text-muted" />
        {unreadCount > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] bg-danger text-white text-[10px] font-bold rounded-full flex items-center justify-center px-1">
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-2 w-80 bg-surface border border-border rounded-xl shadow-lg z-50 overflow-hidden">
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-border">
            <span className="text-text-main font-semibold text-sm">{t('notif_bell')}</span>
            <div className="flex items-center gap-2">
              {unreadCount > 0 && (
                <button
                  onClick={markAllRead}
                  className="text-xs text-primary hover:underline"
                >
                  {t('notif_markAllRead')}
                </button>
              )}
              <button onClick={() => setOpen(false)} className="text-text-subtle hover:text-text-main">
                <X size={14} />
              </button>
            </div>
          </div>

          {/* Notifications list */}
          <div className="max-h-96 overflow-y-auto">
            {userNotifs.length === 0 ? (
              <div className="py-10 flex flex-col items-center gap-2">
                <Bell size={28} className="text-text-subtle" />
                <p className="text-text-muted text-sm font-medium">{t('notif_empty')}</p>
                <p className="text-text-subtle text-xs">{t('notif_emptyDesc')}</p>
              </div>
            ) : (
              <div className="divide-y divide-border">
                {userNotifs.map(notif => (
                  <div
                    key={notif.id}
                    onClick={() => {
                      handleMarkRead(notif.id)
                      openNotification(notif)
                    }}
                    className={`flex items-start gap-3 px-4 py-3 cursor-pointer hover:bg-surface-2 transition-colors ${!notif.isRead ? 'bg-primary/5' : ''}`}
                  >
                    <div className="flex-shrink-0 mt-0.5">
                      {notifIcon(notif.type)}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className={`text-xs font-semibold ${notif.isRead ? 'text-text-muted' : 'text-text-main'}`}>
                        {notif.title}
                      </p>
                      <p className="text-xs text-text-muted truncate">{notif.message}</p>
                      <p className="text-[10px] text-text-subtle mt-0.5">
                        {format(parseISO(notif.createdAt), 'dd MMM HH:mm')}
                      </p>
                    </div>
                    {!notif.isRead && (
                      <span className="w-2 h-2 rounded-full bg-primary flex-shrink-0 mt-1" />
                    )}
                    <button
                      onClick={(e) => handleDismiss(e, notif.id)}
                      className="flex-shrink-0 text-text-subtle hover:text-text-main mt-0.5"
                    >
                      <X size={12} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
