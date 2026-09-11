import React, { useEffect, useMemo, useState } from 'react'
import { format, addDays, addWeeks } from 'date-fns'
import { ChevronDown, ChevronRight, ChevronLeft, PartyPopper, Search } from 'lucide-react'
import { useTaskStore } from '../../store/taskStore'
import { useAuthStore } from '../../store/authStore'
import { TaskCard } from '../../components/shared/TaskCard'
import { taskOccurrences, TaskOccurrence, statusRowsFrom } from '../../utils/taskScheduler'
import { Task } from '../../types'
import { useT } from '../../i18n/useT'
import { useHighlight } from '../../hooks/useHighlight'
import { TaskEditDialog } from '../../components/shared/TaskEditDialog'

const TABS = ['today', 'week', 'month'] as const
export type TaskPeriod = typeof TABS[number]

/**
 * One occurrence as a card, with every action pointed at the day that
 * occurrence is for.
 *
 * This wiring used to be written out four times — the three time blocks, the
 * completed list, and the week and month grids — each working out its own
 * idea of which day to tick against. That is where finished work kept coming
 * back: one copy logged a tick under today, another looked for it under a
 * different day. One component, one day: the occurrence's own.
 */
function OccurrenceCard({
  occ, empId, categories, highlight, readOnly, onEditTask, showTiming,
}: {
  occ: TaskOccurrence
  empId: string
  categories: any[]
  highlight: ReturnType<typeof useHighlight>
  readOnly?: boolean
  onEditTask?: (task: Task) => void
  showTiming?: boolean
}) {
  const {
    completionLogs, completeTask, uncompleteTask, setInProgress, clearInProgress,
    markMissed, clearMissed,
  } = useTaskStore()
  const { task, date } = occ

  const undo = () => {
    if (readOnly) return
    if (task.frequency.type === 'one-off') {
      // Any tick finishes a one-off, whatever day it was logged under, so
      // taking it back has to clear all of them — clearing only this day's
      // would leave an older tick still holding it done.
      const days = new Set(
        completionLogs
          .filter((l) => l.taskId === task.id && l.employeeId === empId)
          .map((l) => l.dueDate),
      )
      days.forEach((d) => uncompleteTask(task.id, empId, d))
    } else {
      uncompleteTask(task.id, empId, date)
    }
  }

  return (
    <TaskCard
      task={task}
      isCompleted={occ.completed}
      // From the occurrence, so the card and the day it is placed on agree.
      isInProgress={occ.status === 'in_progress'}
      isMissed={occ.status === 'missed'}
      category={categories.find((c) => c.id === task.categoryId)}
      onComplete={() => { if (!readOnly) completeTask(task.id, empId, date) }}
      onUncomplete={undo}
      // A manager reading somebody's day does not start it for them.
      onSetInProgress={readOnly ? undefined : () => setInProgress(task.id, empId, date)}
      onClearInProgress={readOnly ? undefined : () => clearInProgress(task.id, empId, date)}
      onMarkMissed={readOnly ? undefined : () => markMissed(task.id, empId, date)}
      onClearMissed={readOnly ? undefined : () => clearMissed(task.id, empId, date)}
      currentUserId={empId}
      dueDate={date}
      completedAtOverride={occ.completedAt}
      onEdit={onEditTask ? () => onEditTask(task) : undefined}
      showTiming={showTiming}
      highlighted={highlight.isHighlighted(task.id)}
      highlightRef={highlight.ref}
    />
  )
}

type CardProps = Omit<Parameters<typeof OccurrenceCard>[0], 'occ'>

const occKey = (occ: TaskOccurrence) => `${occ.task.id}-${occ.date}`

function TimeBlock({
  label, occurrences, cardProps,
}: { label: string; occurrences: TaskOccurrence[]; cardProps: CardProps }) {
  if (occurrences.length === 0) return null
  return (
    <div className="mb-5">
      <h3 className="text-text-muted text-xs font-semibold uppercase tracking-wide mb-2">{label}</h3>
      <div className="space-y-2">
        {occurrences.map((occ) => (
          <OccurrenceCard key={occKey(occ)} occ={occ} {...cardProps} />
        ))}
      </div>
    </div>
  )
}

/**
 * What the period holds in total, above the day-by-day breakdown. Counted from
 * the same occurrences the rows below show, so the bar and the rows cannot
 * disagree.
 */
function OwedSummary({ label, total, done }: { label: string; total: number; done: number }) {
  if (total === 0) return null
  const pct = Math.min(100, Math.round((done / total) * 100))
  return (
    <div className="bg-surface border border-border rounded-xl p-4">
      <div className="flex justify-between text-sm mb-2">
        <span className="text-text-main font-medium">{label}</span>
        <span className="text-text-muted">{done} / {total}</span>
      </div>
      <div className="w-full bg-surface-2 rounded-full h-2 overflow-hidden">
        <div
          className="bg-primary rounded-full h-2 transition-all duration-500"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  )
}

/**
 * Somebody's tasks, broken into today, this week and this month.
 *
 * The employee's own page renders it whole, with its three tabs. The manager's
 * view of an employee renders it one period at a time, so the profile can show
 * the same three sections above the full task list — what a manager sees of
 * somebody's day should be the day that person is actually looking at.
 *
 * Which day a task is on comes from taskOccurrences, the same rule the
 * calendar uses: on its own day until that day is over, then moved forward a
 * day at a time while nothing has happened to it, and stopped on the day it is
 * completed, started or marked missed.
 */
export function MyTasks({
  employeeId,
  readOnly,
  section,
  manage,
}: {
  /** Whose tasks. Defaults to the signed-in user — their own page. */
  employeeId?: string
  /** Read the work, do not tick it off. */
  readOnly?: boolean
  /** Render only this period, without the tab bar. Omitted, all three tabs. */
  section?: TaskPeriod
  /**
   * Offer the task editor on each card. The manager's view of somebody's week
   * sets it; an employee's own list never does, because tasks are the
   * manager's to change and RLS would refuse the write anyway — a pencil there
   * would be a button that fails.
   */
  manage?: boolean
} = {}) {
  const { currentUser } = useAuthStore()
  const { tasks, categories, completionLogs, taskStatuses, taskStartedAt, taskMoves } = useTaskStore()
  const { t, dateLocale } = useT()
  // Controlled from outside when a single section was asked for, so the
  // manager's four-section view drives which period is on screen.
  const [ownTab, setOwnTab] = useState<TaskPeriod>('today')
  const tab = section ?? ownTab
  const setTab = setOwnTab
  // Today starts open, because it is the day you came here to read — but it is
  // only a starting point, and can be folded away to see the rest of the week.
  const [expandedDays, setExpandedDays] = useState<Set<string>>(
    () => new Set([format(new Date(), 'yyyy-MM-dd')]),
  )
  const [expandedWeeks, setExpandedWeeks] = useState<Set<number>>(new Set([0, 1, 2, 3]))
  // The task open in the editor, if any.
  const [editingTask, setEditingTask] = useState<Task | null>(null)
  /**
   * How far back or forward from today the view is looking, in whole periods:
   * days on the Today tab, weeks on the week tab, four-week blocks on the month
   * tab. Zero is now, and "Today" puts it back.
   */
  const [offset, setOffset] = useState(0)
  const onEditTask = manage ? (task: Task) => setEditingTask(task) : undefined

  // Filters (today tab only)
  const [searchQuery, setSearchQuery] = useState('')
  const [filterPriority, setFilterPriority] = useState('')
  const [filterCategoryId, setFilterCategoryId] = useState('')
  const [completedCollapsed, setCompletedCollapsed] = useState(false)

  const highlight = useHighlight()

  const empId = employeeId ?? currentUser?.id ?? ''

  // Two todays. The real one decides where work has moved to — a task only
  // carries forward in real time. The anchored one is the day the view is
  // looking at, which the arrows move; stepping back a week must not pretend
  // last week is now and pile this week's overdue work onto it.
  const realToday = new Date()
  const realTodayStr = format(realToday, 'yyyy-MM-dd')
  const today =
    offset === 0
      ? realToday
      : tab === 'today'
        ? addDays(realToday, offset)
        : tab === 'week'
          ? addWeeks(realToday, offset)
          : addWeeks(realToday, offset * 4)
  const todayStr = format(today, 'yyyy-MM-dd')

  // Yesterday, today, and the next five — the calendar's week exactly, so the
  // two views of the same week line up.
  const weekDays = Array.from({ length: 7 }, (_, i) => {
    const d = addDays(today, i - 1)
    return { date: d, dateStr: format(d, 'yyyy-MM-dd') }
  })

  // Four weeks rolling from yesterday, in rows of seven — the calendar's month,
  // which is also four weeks and does not care where the calendar month starts.
  const monthDays = Array.from({ length: 28 }, (_, i) => {
    const d = addDays(today, i - 1)
    return { date: d, dateStr: format(d, 'yyyy-MM-dd') }
  })
  const monthByWeek: { weekNum: number; days: { date: Date; dateStr: string }[] }[] = []
  for (let i = 0; i < monthDays.length; i += 7) {
    monthByWeek.push({ weekNum: i / 7, days: monthDays.slice(i, i + 7) })
  }

  // One pass covering every day any of the three tabs can show: the month's
  // span already contains the week's and the anchored day.
  const rangeFrom = monthDays[0].dateStr
  const rangeTo = monthDays[monthDays.length - 1].dateStr

  const occurrences = useMemo(
    () =>
      empId
        ? taskOccurrences(
            tasks,
            empId,
            completionLogs,
            { from: rangeFrom, to: rangeTo, today: realTodayStr },
            // Started and missed both stop a task moving on.
            statusRowsFrom(taskStatuses, taskStartedAt),
            365,
            // Days the owner dragged elsewhere on the calendar.
            taskMoves,
          )
        : [],
    [tasks, empId, completionLogs, taskStatuses, taskStartedAt, taskMoves, rangeFrom, rangeTo, realTodayStr],
  )

  const byDay = useMemo(() => {
    const map = new Map<string, TaskOccurrence[]>()
    for (const occ of occurrences) {
      const list = map.get(occ.showOn) ?? []
      list.push(occ)
      map.set(occ.showOn, list)
    }
    return map
  }, [occurrences])

  const onDay = (dateStr: string) => byDay.get(dateStr) ?? []
  const countDone = (list: TaskOccurrence[]) => list.filter((o) => o.completed).length

  // ── Today ────────────────────────────────────────────────────────────────
  const todayAll = onDay(todayStr)

  const matchesFilters = (occ: TaskOccurrence) => {
    const task = occ.task
    const q = searchQuery.toLowerCase()
    if (q && !task.title.toLowerCase().includes(q) && !task.description.toLowerCase().includes(q)) return false
    if (filterPriority && task.priority !== filterPriority) return false
    if (filterCategoryId && task.categoryId !== filterCategoryId) return false
    return true
  }

  const todayShown = todayAll.filter(matchesFilters)
  const pendingOcc = todayShown.filter((o) => !o.completed)
  const completedOcc = todayShown.filter((o) => o.completed)

  const totalToday = todayAll.length
  const doneToday = countDone(todayAll)
  const progressPct = totalToday > 0 ? Math.min(100, Math.round((doneToday / totalToday) * 100)) : 0
  const allDone = totalToday > 0 && doneToday === totalToday

  const hasFilters = searchQuery || filterPriority || filterCategoryId
  const noResults = hasFilters && todayShown.length === 0 && totalToday > 0

  // When the last of today's work was finished, for the "all done" line.
  const lastFinish = todayAll
    .map((o) => o.completedAt)
    .filter((v): v is string => !!v)
    .sort()
    .pop()

  const morning: TaskOccurrence[] = []
  const afternoon: TaskOccurrence[] = []
  const endOfDay: TaskOccurrence[] = []
  pendingOcc.forEach((occ) => {
    const cat = categories.find((c) => c.id === occ.task.categoryId)
    const catName = cat?.name?.toLowerCase() ?? ''
    if (catName.includes('engagement') || catName.includes('social')) morning.push(occ)
    else if (catName.includes('report') || catName.includes('admin')) endOfDay.push(occ)
    else afternoon.push(occ)
  })

  // ── Week and month totals, from the same occurrences as their rows ───────
  const weekAll = weekDays.flatMap(({ dateStr }) => onDay(dateStr))
  const monthAll = monthDays.flatMap(({ dateStr }) => onDay(dateStr))

  const toggleDay = (ds: string) => {
    setExpandedDays((prev) => {
      const next = new Set(prev)
      next.has(ds) ? next.delete(ds) : next.add(ds)
      return next
    })
  }

  const toggleWeek = (n: number) => {
    setExpandedWeeks((prev) => {
      const next = new Set(prev)
      next.has(n) ? next.delete(n) : next.add(n)
      return next
    })
  }

  const tabCls = (tab_: TaskPeriod) =>
    `px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
      tab === tab_ ? 'border-primary text-primary' : 'border-transparent text-text-muted hover:text-text-main'
    }`

  const cardProps: CardProps = {
    empId,
    categories,
    highlight,
    readOnly,
    onEditTask,
    showTiming: manage,
  }

  /**
   * A highlighted task is no use behind a filter or inside a collapsed
   * section, so arriving with one clears whatever would hide it: the filters
   * go, the completed list opens, and the tab switches to whichever period
   * actually contains the task.
   */
  useEffect(() => {
    const id = highlight.activeId
    if (!id) return
    // The parent decides which period is showing when it asked for one, so
    // jumping to another tab here would fight it and land on nothing.
    if (section) return

    setSearchQuery('')
    setFilterPriority('')
    setFilterCategoryId('')
    setCompletedCollapsed(false)

    const has = (dateStr: string) => onDay(dateStr).some((o) => o.task.id === id)

    if (has(todayStr)) {
      setTab('today')
      return
    }
    const weekDay = weekDays.find(({ dateStr }) => has(dateStr))
    if (weekDay) {
      setTab('week')
      setExpandedDays((prev) => new Set(prev).add(weekDay.dateStr))
      return
    }
    const monthWeek = monthByWeek.find(({ days }) => days.some(({ dateStr }) => has(dateStr)))
    if (monthWeek) {
      setTab('month')
      setExpandedWeeks((prev) => new Set(prev).add(monthWeek.weekNum))
    }
    // Only when the highlight changes: re-running as the lists re-derive would
    // fight the user's own tab and filter choices for as long as the ring is up.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [highlight.activeId])

  // What the arrows are stepping through, so the label says which period is on
  // screen rather than leaving you counting weeks back from today.
  const periodLabel =
    tab === 'today'
      ? format(today, 'EEEE d MMMM yyyy', dateLocale)
      : tab === 'week'
        ? `${format(weekDays[0].date, 'd MMM', dateLocale)} – ${format(weekDays[weekDays.length - 1].date, 'd MMM yyyy', dateLocale)}`
        : `${format(monthDays[0].date, 'd MMM', dateLocale)} – ${format(monthDays[monthDays.length - 1].date, 'd MMM yyyy', dateLocale)}`

  return (
    <div className={section ? 'animate-fade-in' : 'max-w-2xl mx-auto animate-fade-in'}>
      {/* Stepping back through the past, the way the calendar does. One period
          at a time, whichever period the tab is showing. */}
      {manage && (
        <div className="flex items-center gap-1 mb-4">
          <button
            onClick={() => setOffset((o) => o - 1)}
            title={t('mytasks_previousPeriod')}
            className="p-1.5 rounded-md text-text-muted hover:bg-surface-2 transition-colors"
          >
            <ChevronLeft size={16} />
          </button>
          <button
            onClick={() => setOffset((o) => o + 1)}
            title={t('mytasks_nextPeriod')}
            className="p-1.5 rounded-md text-text-muted hover:bg-surface-2 transition-colors"
          >
            <ChevronRight size={16} />
          </button>
          {offset !== 0 && (
            <button
              onClick={() => setOffset(0)}
              className="ml-1 px-2.5 py-1 rounded-md text-xs font-medium text-text-muted hover:bg-surface-2 border border-border transition-colors"
            >
              {t('ui_today')}
            </button>
          )}
          <span className="ml-2 text-sm font-medium text-text-main">{periodLabel}</span>
          {offset !== 0 && (
            <span className="ml-2 text-[11px] text-amber bg-amber/10 px-1.5 py-0.5 rounded">
              {t('mytasks_notNow')}
            </span>
          )}
        </div>
      )}
      {!section && (
        <div className="border-b border-border flex gap-0 mb-6">
          {TABS.map((tab_) => (
            <button key={tab_} onClick={() => setTab(tab_)} className={tabCls(tab_)}>
              {tab_ === 'today' ? t('mytasks_today') : tab_ === 'week' ? t('mytasks_thisWeek') : t('mytasks_thisMonth')}
            </button>
          ))}
        </div>
      )}

      {tab === 'today' && (
        <div>
          {/* Filter bar */}
          <div className="flex flex-wrap gap-2 mb-4">
            <div className="relative flex-1 min-w-[160px]">
              <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-subtle" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder={t('mytasks_search')}
                className="w-full pl-7 pr-3 py-1.5 text-xs bg-surface border border-border rounded-lg text-text-main placeholder-text-subtle focus:outline-none focus:border-primary"
              />
            </div>
            <select
              value={filterPriority}
              onChange={(e) => setFilterPriority(e.target.value)}
              className="text-xs bg-surface border border-border rounded-lg px-2 py-1.5 text-text-main focus:outline-none focus:border-primary"
            >
              <option value="">{t('mytasks_allPriorities')}</option>
              <option value="high">{t('task_priorityHigh')}</option>
              <option value="medium">{t('task_priorityMedium')}</option>
              <option value="low">{t('task_priorityLow')}</option>
            </select>
            <select
              value={filterCategoryId}
              onChange={(e) => setFilterCategoryId(e.target.value)}
              className="text-xs bg-surface border border-border rounded-lg px-2 py-1.5 text-text-main focus:outline-none focus:border-primary"
            >
              <option value="">{t('mytasks_allCategories')}</option>
              {categories.map((cat) => (
                <option key={cat.id} value={cat.id}>{cat.name}</option>
              ))}
            </select>
          </div>

          {totalToday > 0 && (
            <div className="mb-6">
              <div className="flex justify-between text-sm mb-2">
                <span className="text-text-muted">{doneToday} {t('mytasks_of')} {totalToday} {t('mytasks_tasksComplete')}</span>
                <span className="font-medium text-text-main">{progressPct}%</span>
              </div>
              <div className="w-full bg-surface-2 rounded-full h-2.5 overflow-hidden">
                <div
                  className="bg-primary rounded-full h-2.5 transition-all duration-500"
                  style={{ width: `${progressPct}%` }}
                />
              </div>
            </div>
          )}

          {allDone && (
            <div className="bg-success-bg border border-success/20 rounded-xl p-5 mb-5 flex items-center gap-3">
              <PartyPopper size={22} className="text-primary flex-shrink-0" />
              <div>
                <p className="text-primary font-semibold text-sm">{t('mytasks_allDone')}</p>
                <p className="text-text-muted text-xs mt-0.5">
                  {t('mytasks_completedAt')} {format(lastFinish ? new Date(lastFinish) : new Date(), 'HH:mm')}
                </p>
              </div>
            </div>
          )}

          {totalToday === 0 && (
            <div className="text-center py-12">
              <p className="text-text-muted">{t('mytasks_noTasks')}</p>
            </div>
          )}

          {noResults && (
            <div className="text-center py-8">
              <p className="text-text-muted text-sm">{t('mytasks_noResults')}</p>
            </div>
          )}

          {!allDone && !noResults && (
            <>
              <TimeBlock label={t('mytasks_morning')} occurrences={morning} cardProps={cardProps} />
              <TimeBlock label={t('mytasks_afternoon')} occurrences={afternoon} cardProps={cardProps} />
              <TimeBlock label={t('mytasks_endOfDay')} occurrences={endOfDay} cardProps={cardProps} />
            </>
          )}

          {completedOcc.length > 0 && !allDone && (
            <div>
              <button
                onClick={() => setCompletedCollapsed((c) => !c)}
                className="flex items-center gap-2 text-text-muted text-xs font-semibold uppercase tracking-wide mb-2 hover:text-text-main transition-colors"
              >
                {completedCollapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
                {t('mytasks_completeBadge')} ({completedOcc.length})
              </button>
              {!completedCollapsed && (
                <div className="space-y-2">
                  {completedOcc.map((occ) => (
                    <OccurrenceCard key={occKey(occ)} occ={occ} {...cardProps} />
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {tab === 'week' && (
        <div className="space-y-3">
          <OwedSummary
            label={t('mytasks_owedThisWeek')}
            total={weekAll.length}
            done={countDone(weekAll)}
          />
          {weekDays.map(({ date, dateStr }) => {
            const dayOcc = onDay(dateStr)
            const done = countDone(dayOcc)
            const total = dayOcc.length
            // Past, today and future are judged against the real today, so the
            // Today badge stays on today while the arrows look at another week.
            const isCurrentDay = dateStr === realTodayStr
            const isPast = dateStr < realTodayStr
            const isFuture = dateStr > realTodayStr
            const isExpanded = expandedDays.has(dateStr)

            let badge: string
            if (total === 0) badge = t('mytasks_noTasksBadge')
            else if (done === total) badge = t('mytasks_completeBadge')
            else if (isFuture) badge = `${total} ${t('task_tasks')}`
            else badge = `${done}/${total} ${t('mytasks_done')}`

            return (
              <div key={dateStr} className={`bg-surface rounded-xl border transition-all ${isCurrentDay ? 'border-primary/40 shadow-sm' : 'border-border'}`}>
                <button
                  onClick={() => toggleDay(dateStr)}
                  className={`w-full flex items-center justify-between px-4 py-3 ${isPast ? 'opacity-70' : ''}`}
                >
                  <div className="flex items-center gap-3">
                    {isExpanded ? <ChevronDown size={15} className="text-text-subtle" /> : <ChevronRight size={15} className="text-text-subtle" />}
                    <span className={`text-sm font-medium ${isCurrentDay ? 'text-primary' : 'text-text-main'}`}>
                      {format(date, 'EEEE d MMMM', dateLocale)}
                      {isCurrentDay && <span className="ml-2 text-xs bg-primary text-white px-1.5 py-0.5 rounded">{t('mytasks_todayBadge')}</span>}
                    </span>
                  </div>
                  <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                    done === total && total > 0 ? 'bg-success-bg text-success' : 'bg-surface-2 text-text-muted'
                  }`}>
                    {badge}
                  </span>
                </button>

                {isExpanded && total > 0 && (
                  <div className="px-4 pb-4 space-y-2">
                    {dayOcc.map((occ) => (
                      <OccurrenceCard key={occKey(occ)} occ={occ} {...cardProps} />
                    ))}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {tab === 'month' && (
        <div className="space-y-3">
          <OwedSummary
            label={t('mytasks_owedThisMonth')}
            total={monthAll.length}
            done={countDone(monthAll)}
          />
          {monthByWeek.map(({ weekNum: wn, days }) => {
            const weekStart = days[0].date
            const weekEnd = days[days.length - 1].date
            const weekOcc = days.flatMap(({ dateStr }) => onDay(dateStr))
            const isExpanded = expandedWeeks.has(wn)

            return (
              <div key={wn} className="bg-surface rounded-xl border border-border">
                <button
                  onClick={() => toggleWeek(wn)}
                  className="w-full flex items-center justify-between px-4 py-3"
                >
                  <div className="flex items-center gap-3">
                    {isExpanded ? <ChevronDown size={15} className="text-text-subtle" /> : <ChevronRight size={15} className="text-text-subtle" />}
                    <span className="text-sm font-medium text-text-main">
                      {format(weekStart, 'd MMM', dateLocale)} – {format(weekEnd, 'd MMM', dateLocale)}
                    </span>
                  </div>
                  <span className="text-xs text-text-muted">
                    {countDone(weekOcc)}/{weekOcc.length} {t('task_tasks')}
                  </span>
                </button>

                {isExpanded && (
                  <div className="px-4 pb-4 space-y-4">
                    {days.map(({ date, dateStr }) => {
                      const dayOcc = onDay(dateStr)
                      if (dayOcc.length === 0) return null
                      return (
                        <div key={dateStr}>
                          <p className="text-xs font-medium text-text-muted mb-2">{format(date, 'EEEE d', dateLocale)}</p>
                          <div className="space-y-2">
                            {dayOcc.map((occ) => (
                              <OccurrenceCard key={occKey(occ)} occ={occ} {...cardProps} />
                            ))}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {editingTask && (
        <TaskEditDialog task={editingTask} onClose={() => setEditingTask(null)} />
      )}
    </div>
  )
}
