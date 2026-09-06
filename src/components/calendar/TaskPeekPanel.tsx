import React from 'react'
import { useNavigate } from 'react-router-dom'
import { X, Clock, CalendarClock, Users, Tag, Repeat, CheckCircle2, ExternalLink } from 'lucide-react'
import { format, parseISO } from 'date-fns'
import { Task } from '../../types'
import type { TranslationKey } from '../../i18n/translations'
import { useTaskStore } from '../../store/taskStore'
import { useEmployeeStore } from '../../store/employeeStore'
import { useT } from '../../i18n/useT'

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
  if (f.type === 'daily') return t('taskpeek_everyWeekday')
  if (f.type === 'weekly') {
    const days = (f.days ?? []).map((d: number) => day(d)).join(', ')
    return days ? `${t('taskpeek_weekly')} · ${days}` : t('taskpeek_weekly')
  }
  if (f.type === 'monthly') {
    return `${t('taskpeek_monthly')} · ${t('task_week')} ${f.weekOfMonth ?? 1}, ${day(f.dayOfWeek ?? 1)}`
  }
  if (f.type === 'one-off') {
    return f.date ? `${t('taskpeek_onceOn')} ${f.date}` : t('taskpeek_oneOff')
  }
  return String(f.type)
}

const PRIORITY_STYLE: Record<string, string> = {
  low: 'bg-surface-2 text-text-muted border-border',
  medium: 'bg-warning-bg text-warning border-warning/30',
  high: 'bg-danger-bg text-danger border-danger/30',
}

/**
 * Everything about an assigned task, read-only.
 *
 * Clicking a task on the calendar used to do nothing at all: the block knew it
 * was a task, but the open handler only understood todos and calendar entries.
 * Editing still belongs in the task manager — this is for reading what the
 * thing actually is without leaving the week you are looking at.
 */
export function TaskPeekPanel({
  task,
  onClose,
  basePath,
}: {
  task: Task
  onClose: () => void
  /** Where this side of the app lives, for the link out to the task manager. */
  basePath?: string
}) {
  const { t } = useT()
  const { categories, completionLogs } = useTaskStore()
  const { employees } = useEmployeeStore()
  const navigate = useNavigate()

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
            <div className="flex items-center gap-1.5 mt-1.5">
              <span
                className={`px-2 py-0.5 rounded-full text-[11px] font-medium border ${
                  PRIORITY_STYLE[task.priority] ?? PRIORITY_STYLE.medium
                }`}
              >
                {task.priority}
              </span>
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
          {task.description && (
            <p className="text-sm text-text-muted whitespace-pre-wrap mb-3">{task.description}</p>
          )}

          {row(Users, t('taskpeek_assignedTo'),
            people.length > 0
              ? people.map((p) => p!.name).join(', ')
              : <span className="text-text-subtle">{t('cal_nobody')}</span>)}

          {row(Repeat, t('taskpeek_repeats'), frequencyLabel(task.frequency, t))}

          {row(CalendarClock, t('cal_deadline'),
            task.deadline
              ? format(parseISO(task.deadline), 'EEEE d MMMM yyyy')
              : <span className="text-text-subtle">{t('cal_none')}</span>)}

          {task.schedules.length > 0 && row(CalendarClock, t('taskpeek_plannedFor'),
            <div className="space-y-0.5">
              {task.schedules.filter((sc) => sc.doDate).map((sc) => {
                const who = employees.find((e) => e.id === sc.employeeId)
                return (
                  <p key={sc.employeeId}>
                    {who?.name ?? t('taskpeek_someone')} · {sc.doDate}
                  </p>
                )
              })}
            </div>)}

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

          <button
            onClick={() => navigate(`${basePath ?? ''}/employees/tasks`)}
            className="mt-4 w-full flex items-center justify-center gap-1.5 py-2 rounded-lg border border-border text-xs text-text-muted hover:border-primary/50 hover:text-text-main transition-colors"
          >
            <ExternalLink size={13} />{t('cal_openInTheTaskManager')}</button>
        </div>
      </div>
    </div>
  )
}
