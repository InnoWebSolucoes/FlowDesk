import React from 'react'
import { useNavigate } from 'react-router-dom'
import { X, Clock, Users, Tag, Repeat, CheckCircle2, ExternalLink, CalendarDays, Circle, Timer, Ban, Clapperboard, Upload } from 'lucide-react'
import { format, parseISO } from 'date-fns'
import { Task } from '../../types'
import type { TranslationKey } from '../../i18n/translations'
import { useTaskStore } from '../../store/taskStore'
import { useEmployeeStore } from '../../store/employeeStore'
import { useAuthStore } from '../../store/authStore'
import { useT } from '../../i18n/useT'
import { UrgentBadge } from '../shared/Urgent'
import { Linkify } from '../shared/Linkify'

const DAY_KEYS = [
  'task_sun', 'task_mon', 'task_tue', 'task_wed', 'task_thu', 'task_fri', 'task_sat',
] as const

/**
 * How often it comes round, in the words the rest of the app uses. Takes the
 * translator rather than calling the hook: this is a plain function, not a
 * component, and the day names have to follow the chosen language too.
 */
function frequencyLabel(f: Task['frequency'], t: (k: TranslationKey) => string): string {
  const day = (n: number) => t(DAY_KEYS[n] ?? 'task_mon')
  if (!f) return '—'
  if (f.type === 'daily') return t('taskpeek_everyDay')
  if (f.type === 'weekly') {
    const days = (f.days ?? []).map((d: number) => day(d)).join(', ')
    return days ? `${t('taskpeek_weekly')} · ${days}` : t('taskpeek_weekly')
  }
  if (f.type === 'bi-weekly') {
    const days = (f.days ?? []).map((d: number) => day(d)).join(', ')
    return days ? `${t('task_freqBiWeekly')} · ${days}` : t('task_freqBiWeekly')
  }
  if (f.type === 'monthly') {
    return `${t('taskpeek_monthly')} · ${t('task_week')} ${f.weekOfMonth ?? 1}, ${day(f.dayOfWeek ?? 1)}`
  }
  if (f.type === 'one-off') {
    return f.date ? `${t('taskpeek_onceOn')} ${f.date}` : t('taskpeek_oneOff')
  }
  return String(f.type)
}

/** What has happened to one day of a task, in the words the app uses. */
export type PeekStatus = 'pending' | 'in_progress' | 'completed' | 'missed'

/**
 * Everything about an assigned task, read-only.
 *
 * Clicking a task on the calendar used to do nothing at all: the block knew it
 * was a task, but the open handler only understood todos and calendar entries.
 * Editing still belongs in the task manager — this is for reading what the
 * thing actually is without leaving the week you are looking at.
 *
 * It is the employee's way in to a task's full description everywhere: a card
 * on My Tasks clamps the description to two lines, and until this opened from
 * there the rest of it could not be read at all.
 */
export function TaskPeekPanel({
  task,
  onClose,
  basePath,
  occurrenceDate,
  status,
  carried,
  showTasksLink = true,
}: {
  task: Task
  onClose: () => void
  /** Where this side of the app lives, for the link out to the task manager. */
  basePath?: string
  /**
   * The day this particular occurrence is for, when it was opened from a dated
   * list. Absent when the task is being read on its own terms.
   */
  occurrenceDate?: string
  /** What has happened to it on that day. */
  status?: PeekStatus
  /** Carried forward from an earlier day it was not done on. */
  carried?: boolean
  /**
   * Offer the way out to the task list. Off when the panel was opened from
   * that list, where the button would only reload the page you are on.
   */
  showTasksLink?: boolean
}) {
  const { t, dateLocale } = useT()
  const { categories, completionLogs } = useTaskStore()
  const { employees } = useEmployeeStore()
  const navigate = useNavigate()

  /**
   * Where the task list lives on this side of the app. The employee has one
   * list, at /employee/tasks; the manager reads a person's under their
   * project. It used to be `${basePath}/employees/tasks` for both, which on
   * the employee's side is no route at all — the button dropped them on the
   * catch-all and back to the login screen.
   */
  const tasksPath = basePath === '/employee' ? '/employee/tasks' : `${basePath ?? ''}/employees/tasks`

  /**
   * Back to the content calendar, for a task that is a step on it. A content
   * plan goes to the client's page, which is where the plan is uploaded; the
   * rest go to the calendar, on the month of the day and filtered to the
   * client. The employee has the content calendar at /employee/content.
   */
  const asEmployee = useAuthStore((s) => s.currentUser?.role === 'employee')
  const contentLink = (() => {
    if (!task.content) return null
    const base = asEmployee ? '/employee/content' : `/admin/projects/${task.projectId}/content`
    const { kind, clientId } = task.content
    if (kind === 'plan' && clientId) return { to: `${base}/${clientId}`, plan: true }
    const day = occurrenceDate ?? task.frequency.date
    const params = new URLSearchParams()
    if (day) params.set('m', day.slice(0, 7))
    if (clientId) params.set('c', clientId)
    const qs = params.toString()
    return { to: qs ? `${base}?${qs}` : base, plan: false }
  })()

  const category = categories.find((c) => c.id === task.categoryId)
  const people = task.assignedTo
    .map((id) => employees.find((e) => e.id === id))
    .filter(Boolean)

  // The most recent completions, so "is this actually getting done" is
  // answerable without opening the task manager.
  const done = completionLogs
    .filter((l) => l.taskId === task.id)
    .sort((a, b) => b.completedAt.localeCompare(a.completedAt))
    .slice(0, 5)

  // The status icon and words this occurrence has, matching the card it was
  // opened from so the popup does not appear to disagree with the list.
  const statusFace: Record<PeekStatus, { Icon: typeof Clock; label: string; cls: string }> = {
    completed: { Icon: CheckCircle2, label: t('status_completed'), cls: 'text-primary' },
    in_progress: { Icon: Timer, label: t('status_inProgress'), cls: 'text-amber' },
    missed: { Icon: Ban, label: t('taskcard_missed'), cls: 'text-danger' },
    pending: { Icon: Circle, label: t('status_pending'), cls: 'text-text-subtle' },
  }

  const row = (Icon: typeof Clock, label: string, value: React.ReactNode) => (
    <div className="flex items-start gap-2.5 py-2 border-b border-border last:border-0">
      <Icon size={14} className="text-text-subtle flex-shrink-0 mt-0.5" />
      <div className="min-w-0 flex-1">
        <p className="text-[11px] text-text-subtle">{label}</p>
        <div className="text-sm text-text-main mt-0.5">{value}</div>
      </div>
    </div>
  )

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />

      <div className="relative w-full max-w-md bg-surface rounded-xl border border-border shadow-2xl max-h-[85vh] overflow-y-auto">
        <div className="flex items-start justify-between gap-3 p-5 pb-3">
          <div className="min-w-0">
            <h2 className="text-text-main font-semibold text-base leading-snug">{task.title}</h2>
            <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
              <UrgentBadge urgent={task.isUrgent} />
              {status === 'in_progress' && (
                <span className="px-2 py-0.5 rounded-full text-[11px] font-semibold bg-amber/10 text-amber">{t('status_inProgress')}</span>
              )}
              {status === 'missed' && (
                <span className="px-2 py-0.5 rounded-full text-[11px] font-semibold bg-danger/10 text-danger">{t('taskcard_missed')}</span>
              )}
              {carried && status !== 'completed' && status !== 'missed' && (
                <span className="px-2 py-0.5 rounded-full text-[11px] font-semibold bg-danger/10 text-danger">{t('deadline_overdue')}</span>
              )}
              {!task.isActive && (
                <span className="px-2 py-0.5 rounded-full text-[11px] bg-surface-2 text-text-muted border border-border">{t('cal_retired')}</span>
              )}
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-text-subtle hover:text-text-main transition-colors flex-shrink-0"
          >
            <X size={18} />
          </button>
        </div>

        <div className="px-5 pb-5">
          {task.description ? (
            <p className="text-sm text-text-muted whitespace-pre-wrap break-words mb-3"><Linkify text={task.description} /></p>
          ) : (
            <p className="text-sm text-text-subtle italic mb-3">{t('taskpeek_noDescription')}</p>
          )}

          {occurrenceDate && row(CalendarDays, t('taskpeek_plannedFor'),
            format(parseISO(occurrenceDate), 'EEEE, d MMMM yyyy', dateLocale))}

          {status && (() => {
            const { Icon, label, cls } = statusFace[status]
            return row(Icon, t('taskpeek_status'), <span className={cls}>{label}</span>)
          })()}

          {row(Users, t('taskpeek_assignedTo'),
            people.length > 0
              ? people.map((p) => p!.name).join(', ')
              : <span className="text-text-subtle">{t('cal_nobody')}</span>)}

          {row(Repeat, t('taskpeek_repeats'), frequencyLabel(task.frequency, t))}

          {row(Tag, t('taskpeek_category'), category?.name ?? <span className="text-text-subtle">{t('cal_none')}</span>)}

          {row(Clock, t('taskpeek_estimated'),
            task.estimatedMinutes > 0
              ? `${task.estimatedMinutes} min`
              : <span className="text-text-subtle">{t('cal_notEstimated')}</span>)}

          {done.length > 0 && row(CheckCircle2, t('taskpeek_recentlyCompleted'),
            <div className="space-y-0.5">
              {done.map((l) => {
                const who = employees.find((e) => e.id === l.employeeId)
                return (
                  <p key={`${l.taskId}-${l.employeeId}-${l.dueDate}`} className="text-xs">
                    {who?.name ?? t('taskpeek_someone')} · {l.dueDate}
                    {l.wasLate && <span className="text-danger"> ({t('taskpeek_late')})</span>}
                  </p>
                )
              })}
            </div>)}

          {contentLink && (
            <button
              onClick={() => navigate(contentLink.to)}
              className="mt-4 w-full flex items-center justify-center gap-1.5 py-2 rounded-lg bg-primary text-white text-xs font-medium hover:bg-primary-dark transition-colors"
            >
              {contentLink.plan ? <Upload size={13} /> : <Clapperboard size={13} />}
              {contentLink.plan ? t('taskpeek_uploadPlan') : t('taskpeek_openContentCalendar')}
            </button>
          )}

          {showTasksLink && (
            <button
              onClick={() => navigate(tasksPath)}
              className="mt-4 w-full flex items-center justify-center gap-1.5 py-2 rounded-lg border border-border text-xs text-text-muted hover:border-primary/50 hover:text-text-main transition-colors"
            >
              <ExternalLink size={13} />{t('cal_openInTheTaskManager')}</button>
          )}
        </div>
      </div>
    </div>
  )
}
