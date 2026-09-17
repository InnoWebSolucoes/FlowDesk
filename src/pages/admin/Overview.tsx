import React, { useEffect, useMemo, useState } from 'react'
import { format } from 'date-fns'
import { useNavigate, useOutletContext } from 'react-router-dom'
import {
  Users, CheckCircle2, Timer, Ban, Flame, LogOut, UserX, UserCheck, Trash2, Activity,
} from 'lucide-react'
import { useTaskStore } from '../../store/taskStore'
import { useEmployeeStore } from '../../store/employeeStore'
import { TaskTimestampLog } from '../../components/charts/TaskTimestampLog'
import { taskOccurrences, statusRowsFrom, TaskOccurrence } from '../../utils/taskScheduler'
import { useT } from '../../i18n/useT'
import { Avatar } from '../../components/shared/Avatar'
import { ProjectEmployees, MemberActions } from './project/ProjectEmployees'
import { Employee, Project } from '../../types'

/** One person's day, counted from the same occurrences their My Tasks shows. */
interface Day {
  all: TaskOccurrence[]
  done: number
  working: number
  missed: number
  late: number
  urgentOpen: number
  /** What they are on right now, if anything. */
  current: TaskOccurrence | null
}

function elapsed(since: string, now: number) {
  const mins = Math.max(0, Math.floor((now - new Date(since).getTime()) / 60_000))
  if (mins < 60) return `${mins}m`
  const h = Math.floor(mins / 60)
  const m = mins % 60
  return m === 0 ? `${h}h` : `${h}h ${m}m`
}

/**
 * The project at a glance: everyone on it, and where each of them is with
 * today. One card per person carries the whole answer — how much is done,
 * what is under way, what has slipped — so the page reads in one pass
 * instead of asking the reader to cross-reference tiles, alerts and lists.
 *
 * Counted with the rule My Tasks uses, so a card and the person's own
 * list can never disagree: unfinished work from earlier days is here as
 * late, missed work stays where it stopped.
 */
export function Overview() {
  const { tasks, completionLogs, categories, taskStatuses, taskStartedAt, taskMoves, inProgressSince } = useTaskStore()
  const { employees } = useEmployeeStore()
  const { t } = useT()
  const navigate = useNavigate()
  // Inside a project the team is the page; the project-less overview has no
  // team to draw.
  const ctx = useOutletContext<{ project?: Project } | null>()
  const project = ctx?.project

  // For the "working for" clocks.
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 60_000)
    return () => clearInterval(id)
  }, [])

  const todayStr = format(new Date(), 'yyyy-MM-dd')
  const staff = employees.filter((e) => e.role === 'employee')

  const days = useMemo(() => {
    const out = new Map<string, Day>()
    const statuses = statusRowsFrom(taskStatuses, taskStartedAt)
    const range = { from: todayStr, to: todayStr, today: todayStr }
    for (const emp of staff) {
      const all = taskOccurrences(tasks, emp.id, completionLogs, range, statuses, 365, taskMoves)
        .filter((o) => o.showOn === todayStr)
      const day: Day = {
        all,
        done: all.filter((o) => o.completed).length,
        working: all.filter((o) => !o.completed && o.status === 'in_progress').length,
        missed: all.filter((o) => !o.completed && o.status === 'missed').length,
        late: all.filter((o) => !o.completed && o.carried && o.status !== 'missed').length,
        urgentOpen: all.filter((o) => !o.completed && o.task.isUrgent).length,
        current: all.find((o) => !o.completed && o.status === 'in_progress') ?? null,
      }
      out.set(emp.id, day)
    }
    return out
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tasks, completionLogs, taskStatuses, taskStartedAt, taskMoves, todayStr, employees])

  // The team's day, summed.
  const totals = useMemo(() => {
    const sum = { assigned: 0, done: 0, working: 0, late: 0, missed: 0, urgent: 0 }
    for (const d of days.values()) {
      sum.assigned += d.all.length
      sum.done += d.done
      sum.working += d.working
      sum.late += d.late
      sum.missed += d.missed
      sum.urgent += d.urgentOpen
    }
    return sum
  }, [days])
  const rate = totals.assigned > 0 ? Math.round((totals.done / totals.assigned) * 100) : 0

  const tiles: { label: string; value: number | string; icon: React.ReactNode; tone: string }[] = [
    { label: t('overview_totalEmployees'), value: staff.length, icon: <Users size={15} />, tone: 'text-text-muted' },
    { label: t('overview_assignedToday'), value: totals.assigned, icon: <Activity size={15} />, tone: 'text-blue-accent' },
    { label: t('overview_completedToday'), value: totals.done, icon: <CheckCircle2 size={15} />, tone: 'text-success' },
    { label: t('status_inProgress'), value: totals.working, icon: <Timer size={15} />, tone: 'text-amber' },
    { label: t('deadline_overdue'), value: totals.late, icon: <Ban size={15} />, tone: totals.late > 0 ? 'text-danger' : 'text-text-muted' },
    { label: t('urgent_label'), value: totals.urgent, icon: <Flame size={15} />, tone: totals.urgent > 0 ? 'text-danger' : 'text-text-muted' },
  ]

  const renderMember = (emp: Employee, actions: MemberActions) => {
    const day = days.get(emp.id) ?? { all: [], done: 0, working: 0, missed: 0, late: 0, urgentOpen: 0, current: null }
    const total = day.all.length
    const remaining = total - day.done - day.working - day.missed
    const pct = (n: number) => (total > 0 ? `${(n / total) * 100}%` : '0%')
    const startedAt = day.current ? inProgressSince(day.current.task.id, emp.id, day.current.date) : null
    const allDone = total > 0 && day.done === total
    // Something needs a look: late work, missed work, or an afternoon with
    // nothing done yet.
    const attention = day.late > 0 || day.missed > 0 || (new Date().getHours() >= 12 && total > 0 && day.done === 0 && day.working === 0)
    const stop = (e: React.MouseEvent) => e.stopPropagation()

    return (
      <div
        key={emp.id}
        onClick={() => navigate(`/admin/projects/${project!.id}/employees/team/${emp.id}`)}
        role="button"
        title={t('proj_viewProfile')}
        className={`group bg-surface rounded-xl border p-4 flex flex-col gap-3 cursor-pointer transition-colors hover:border-primary/40 ${
          attention ? 'border-danger/40' : 'border-border'
        } ${emp.isActive ? '' : 'opacity-60'}`}
      >
        <div className="flex items-start gap-3">
          <Avatar id={emp.id} initials={emp.avatarInitials} name={emp.name} size={40} />
          <div className="flex-1 min-w-0">
            <p className="text-text-main font-semibold text-sm truncate flex items-center gap-1.5">
              <span className="truncate">{emp.name}</span>
              {!emp.isActive && (
                <span className="flex-shrink-0 text-[10px] font-medium uppercase tracking-wide text-warning bg-warning/10 border border-warning/30 rounded px-1.5 py-0.5">
                  {t('proj_inactive')}
                </span>
              )}
            </p>
            <p className="text-text-muted text-xs truncate">{emp.jobTitle}</p>
          </div>
          {/* Shown on hover, so the card reads as the person's day and not
              as a row of buttons. */}
          <div className="flex items-center gap-0.5 flex-shrink-0 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity" onClick={stop}>
            <button onClick={actions.removeFromProject} className="text-text-subtle hover:text-warning p-1 rounded" title={t('proj_removeFromThisProjectKeepsThe')}>
              <LogOut size={13} />
            </button>
            <button onClick={actions.toggleActive} className={`p-1 rounded ${emp.isActive ? 'text-text-subtle hover:text-warning' : 'text-warning hover:text-success'}`} title={emp.isActive ? t('proj_deactivate') : t('proj_reactivate')}>
              {emp.isActive ? <UserX size={13} /> : <UserCheck size={13} />}
            </button>
            <button onClick={actions.remove} className="text-text-subtle hover:text-danger p-1 rounded" title={t('proj_deleteEmployee')}>
              <Trash2 size={13} />
            </button>
          </div>
        </div>

        {/* The day as one bar: done, under way, missed, and what is left. */}
        <div>
          <div className="flex items-baseline justify-between mb-1.5">
            <span className="text-xs text-text-muted">{t('ui_today')}</span>
            <span className={`text-xs font-semibold tabular-nums ${allDone ? 'text-success' : 'text-text-main'}`}>
              {day.done}/{total}
            </span>
          </div>
          <div className="w-full h-2 rounded-full bg-surface-2 overflow-hidden flex">
            <div className="h-full bg-success transition-all" style={{ width: pct(day.done) }} />
            <div className="h-full bg-amber transition-all" style={{ width: pct(day.working) }} />
            <div className="h-full bg-danger transition-all" style={{ width: pct(day.missed) }} />
            <div className="h-full bg-transparent" style={{ width: pct(Math.max(0, remaining)) }} />
          </div>
        </div>

        {/* Only what is true of this person today. A card with nothing here
            is a day with nothing to flag. */}
        <div className="flex flex-wrap gap-1.5 min-h-[1.25rem]">
          {total === 0 && (
            <span className="text-[11px] text-text-subtle">{t('overview_nothingToday')}</span>
          )}
          {day.urgentOpen > 0 && (
            <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded-full bg-danger text-white">
              <Flame size={10} /> {day.urgentOpen} {t('urgent_label')}
            </span>
          )}
          {day.late > 0 && (
            <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-danger/10 text-danger">
              {day.late} {t('deadline_overdue')}
            </span>
          )}
          {day.missed > 0 && (
            <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-danger/10 text-danger">
              {day.missed} {t('taskcard_missed')}
            </span>
          )}
          {allDone && (
            <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-success-bg text-success">
              {t('overview_allDone')}
            </span>
          )}
          {attention && day.late === 0 && day.missed === 0 && (
            <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-amber-bg text-amber">
              {t('overview_nothingDoneYet')}
            </span>
          )}
        </div>

        {/* What they are on right now, with how long. The one line that
            says whether the day is moving. */}
        {day.current && (
          <div className="flex items-start gap-1.5 text-xs text-amber bg-amber-bg rounded-lg px-2.5 py-1.5">
            <Timer size={13} className="flex-shrink-0 mt-0.5" />
            <span className="min-w-0">
              <span className="text-text-main font-medium line-clamp-1">{day.current.task.title}</span>
              {startedAt && (
                <span className="text-[11px]">{t('taskcard_workingFor')} {elapsed(startedAt, now)}</span>
              )}
            </span>
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="space-y-5 animate-fade-in">
      {/* Today in numbers, one strip. */}
      <div className="grid grid-cols-3 lg:grid-cols-6 gap-2">
        {tiles.map((tile) => (
          <div key={tile.label} className="bg-surface rounded-xl border border-border px-3 py-2.5 flex items-center gap-2.5">
            <span className={`flex-shrink-0 ${tile.tone}`}>{tile.icon}</span>
            <div className="min-w-0">
              <p className="text-text-main text-lg font-bold leading-none tabular-nums">{tile.value}</p>
              <p className="text-text-muted text-[11px] truncate mt-0.5">{tile.label}</p>
            </div>
          </div>
        ))}
      </div>

      {totals.assigned > 0 && (
        <div className="flex items-center gap-3">
          <div className="flex-1 h-1.5 rounded-full bg-surface-2 overflow-hidden">
            <div className={`h-full transition-all ${rate === 100 ? 'bg-success' : rate >= 50 ? 'bg-amber' : 'bg-danger'}`} style={{ width: `${rate}%` }} />
          </div>
          <span className="text-xs text-text-muted tabular-nums">{rate}% · {t('overview_todayRate')}</span>
        </div>
      )}

      {/* The team, each with their day. Adding and assigning people lives
          in the same block, so the roster and the read on it are one thing. */}
      {project && <ProjectEmployees title={t('nav_employees')} renderMember={renderMember} />}

      <div className="bg-surface rounded-xl border border-border p-4">
        <h2 className="text-text-main font-semibold text-sm mb-3">{t('overview_liveActivity')}</h2>
        <TaskTimestampLog
          completionLogs={completionLogs}
          tasks={tasks}
          categories={categories}
          employees={employees}
          maxItems={15}
        />
      </div>
    </div>
  )
}
