import React, { useState } from 'react'
import { format, startOfWeek, addDays, startOfMonth, getDaysInMonth } from 'date-fns'
import { ChevronDown, ChevronRight, PartyPopper, Search } from 'lucide-react'
import { useTaskStore } from '../../store/taskStore'
import { useAuthStore } from '../../store/authStore'
import { TaskCard } from '../../components/shared/TaskCard'
import { getTasksDueOnDate, getTasksDueThisWeek } from '../../utils/taskScheduler'
import { Task } from '../../types'
import { useT } from '../../i18n/useT'

const TABS = ['today', 'week', 'month'] as const
type Tab = typeof TABS[number]

function TimeBlock({
  label,
  tasks,
  completedIds,
  categories,
  onComplete,
  onUncomplete,
  empId,
  todayStr,
}: {
  label: string
  tasks: Task[]
  completedIds: Set<string>
  categories: any[]
  onComplete: (id: string) => void
  onUncomplete: (id: string) => void
  empId: string
  todayStr: string
}) {
  const { isInProgress: isInProgressFn, setInProgress, clearInProgress } = useTaskStore()

  if (tasks.length === 0) return null
  return (
    <div className="mb-5">
      <h3 className="text-text-muted text-xs font-semibold uppercase tracking-wide mb-2">{label}</h3>
      <div className="space-y-2">
        {tasks.map(task => (
          <TaskCard
            key={task.id}
            task={task}
            isCompleted={completedIds.has(task.id)}
            isInProgress={isInProgressFn(task.id, empId, todayStr)}
            category={categories.find(c => c.id === task.categoryId)}
            onComplete={() => onComplete(task.id)}
            onUncomplete={() => onUncomplete(task.id)}
            onSetInProgress={() => setInProgress(task.id, empId, todayStr)}
            onClearInProgress={() => clearInProgress(task.id, empId, todayStr)}
            currentUserId={empId}
            dueDate={todayStr}
          />
        ))}
      </div>
    </div>
  )
}

export function MyTasks() {
  const { currentUser } = useAuthStore()
  const { tasks, categories, completionLogs, completeTask, uncompleteTask, isTaskCompleted } = useTaskStore()
  const { t, dateLocale } = useT()
  const [tab, setTab] = useState<Tab>('today')
  const [expandedDays, setExpandedDays] = useState<Set<string>>(new Set())
  const [expandedWeeks, setExpandedWeeks] = useState<Set<number>>(new Set([0, 1, 2, 3]))

  // Filters (today tab only)
  const [searchQuery, setSearchQuery] = useState('')
  const [filterPriority, setFilterPriority] = useState('')
  const [filterCategoryId, setFilterCategoryId] = useState('')

  const empId = currentUser!.id
  const today = new Date()
  const todayStr = format(today, 'yyyy-MM-dd')

  const todayTasksRaw = getTasksDueOnDate(tasks, empId, today)
  const completedToday = completionLogs.filter(l => l.employeeId === empId && l.dueDate === todayStr)
  const completedIds = new Set(completedToday.map(l => l.taskId))

  // Apply filters to today tasks
  const todayTasks = todayTasksRaw.filter(task => {
    if (searchQuery && !task.title.toLowerCase().includes(searchQuery.toLowerCase()) && !task.description.toLowerCase().includes(searchQuery.toLowerCase())) return false
    if (filterPriority && task.priority !== filterPriority) return false
    if (filterCategoryId && task.categoryId !== filterCategoryId) return false
    return true
  })

  const pendingTasks = todayTasks.filter(task => !completedIds.has(task.id))
  const completedTasksList = todayTasks.filter(task => completedIds.has(task.id))

  const totalToday = todayTasksRaw.length
  const doneToday = completedIds.size
  const progressPct = totalToday > 0 ? Math.round((doneToday / totalToday) * 100) : 0
  const allDone = totalToday > 0 && doneToday === totalToday

  const hasFilters = searchQuery || filterPriority || filterCategoryId
  const noResults = hasFilters && todayTasks.length === 0 && totalToday > 0

  const handleComplete = (taskId: string) => completeTask(taskId, empId, todayStr)
  const handleUncomplete = (taskId: string) => uncompleteTask(taskId, empId, todayStr)

  const morning: Task[] = []
  const afternoon: Task[] = []
  const endOfDay: Task[] = []

  pendingTasks.forEach(task => {
    const cat = categories.find(c => c.id === task.categoryId)
    const catName = cat?.name?.toLowerCase() ?? ''
    if (catName.includes('engagement') || catName.includes('social')) morning.push(task)
    else if (catName.includes('report') || catName.includes('admin')) endOfDay.push(task)
    else afternoon.push(task)
  })

  const monday = startOfWeek(today, { weekStartsOn: 1 })
  const weekTaskMap = getTasksDueThisWeek(tasks, empId, today)
  const weekDays = Array.from({ length: 5 }, (_, i) => {
    const d = addDays(monday, i)
    return { date: d, dateStr: format(d, 'yyyy-MM-dd') }
  })

  const toggleDay = (ds: string) => {
    setExpandedDays(prev => {
      const next = new Set(prev)
      next.has(ds) ? next.delete(ds) : next.add(ds)
      return next
    })
  }

  const monthStart = startOfMonth(today)
  const daysInMonth = getDaysInMonth(today)

  const monthByWeek: { weekNum: number; days: { date: Date; dateStr: string }[] }[] = []
  let currentWeek: { date: Date; dateStr: string }[] = []
  let weekNum = 0

  for (let d = 1; d <= daysInMonth; d++) {
    const date = new Date(today.getFullYear(), today.getMonth(), d)
    const dow = date.getDay()
    if (dow === 0 || dow === 6) continue

    if (dow === 1 && currentWeek.length > 0) {
      monthByWeek.push({ weekNum, days: currentWeek })
      weekNum++
      currentWeek = []
    }
    currentWeek.push({ date, dateStr: format(date, 'yyyy-MM-dd') })
  }
  if (currentWeek.length > 0) monthByWeek.push({ weekNum, days: currentWeek })

  const toggleWeek = (n: number) => {
    setExpandedWeeks(prev => {
      const next = new Set(prev)
      next.has(n) ? next.delete(n) : next.add(n)
      return next
    })
  }

  const tabCls = (tab_: Tab) =>
    `px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
      tab === tab_ ? 'border-primary text-primary' : 'border-transparent text-text-muted hover:text-text-main'
    }`

  const [completedCollapsed, setCompletedCollapsed] = useState(false)

  return (
    <div className="max-w-2xl mx-auto animate-fade-in">
      <div className="border-b border-border flex gap-0 mb-6">
        {TABS.map(tab_ => (
          <button key={tab_} onClick={() => setTab(tab_)} className={tabCls(tab_)}>
            {tab_ === 'today' ? t('mytasks_today') : tab_ === 'week' ? t('mytasks_thisWeek') : t('mytasks_thisMonth')}
          </button>
        ))}
      </div>

      {tab === 'today' && (
        <div>
          {/* Filter bar */}
          <div className="flex flex-wrap gap-2 mb-4">
            <div className="relative flex-1 min-w-[160px]">
              <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-subtle" />
              <input
                type="text"
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                placeholder={t('mytasks_search')}
                className="w-full pl-7 pr-3 py-1.5 text-xs bg-surface border border-border rounded-lg text-text-main placeholder-text-subtle focus:outline-none focus:border-primary"
              />
            </div>
            <select
              value={filterPriority}
              onChange={e => setFilterPriority(e.target.value)}
              className="text-xs bg-surface border border-border rounded-lg px-2 py-1.5 text-text-main focus:outline-none focus:border-primary"
            >
              <option value="">{t('mytasks_allPriorities')}</option>
              <option value="high">{t('task_priorityHigh')}</option>
              <option value="medium">{t('task_priorityMedium')}</option>
              <option value="low">{t('task_priorityLow')}</option>
            </select>
            <select
              value={filterCategoryId}
              onChange={e => setFilterCategoryId(e.target.value)}
              className="text-xs bg-surface border border-border rounded-lg px-2 py-1.5 text-text-main focus:outline-none focus:border-primary"
            >
              <option value="">{t('mytasks_allCategories')}</option>
              {categories.map(cat => (
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
              <div className="w-full bg-surface-2 rounded-full h-2.5">
                <div
                  className="bg-primary rounded-full h-2.5 transition-all duration-500"
                  style={{ width: `${progressPct}%` }}
                />
              </div>
            </div>
          )}

          {allDone && totalToday > 0 && (
            <div className="bg-success-bg border border-success/20 rounded-xl p-5 mb-5 flex items-center gap-3">
              <PartyPopper size={22} className="text-primary flex-shrink-0" />
              <div>
                <p className="text-primary font-semibold text-sm">{t('mytasks_allDone')}</p>
                <p className="text-text-muted text-xs mt-0.5">
                  {t('mytasks_completedAt')} {format(new Date(completedToday.sort((a, b) =>
                    new Date(b.completedAt).getTime() - new Date(a.completedAt).getTime()
                  )[0]?.completedAt ?? new Date()), 'HH:mm')}
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
              <TimeBlock
                label={t('mytasks_morning')}
                tasks={morning}
                completedIds={completedIds}
                categories={categories}
                onComplete={handleComplete}
                onUncomplete={handleUncomplete}
                empId={empId}
                todayStr={todayStr}
              />
              <TimeBlock
                label={t('mytasks_afternoon')}
                tasks={afternoon}
                completedIds={completedIds}
                categories={categories}
                onComplete={handleComplete}
                onUncomplete={handleUncomplete}
                empId={empId}
                todayStr={todayStr}
              />
              <TimeBlock
                label={t('mytasks_endOfDay')}
                tasks={endOfDay}
                completedIds={completedIds}
                categories={categories}
                onComplete={handleComplete}
                onUncomplete={handleUncomplete}
                empId={empId}
                todayStr={todayStr}
              />
            </>
          )}

          {completedTasksList.length > 0 && !allDone && (
            <div>
              <button
                onClick={() => setCompletedCollapsed(c => !c)}
                className="flex items-center gap-2 text-text-muted text-xs font-semibold uppercase tracking-wide mb-2 hover:text-text-main transition-colors"
              >
                {completedCollapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
                {t('mytasks_completeBadge')} ({completedTasksList.length})
              </button>
              {!completedCollapsed && (
                <div className="space-y-2">
                  {completedTasksList.map(task => (
                    <TaskCard
                      key={task.id}
                      task={task}
                      isCompleted={true}
                      category={categories.find(c => c.id === task.categoryId)}
                      onComplete={() => {}}
                      onUncomplete={() => handleUncomplete(task.id)}
                      currentUserId={empId}
                      dueDate={todayStr}
                    />
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {tab === 'week' && (
        <div className="space-y-3">
          {weekDays.map(({ date, dateStr }) => {
            const dayTasks = weekTaskMap[dateStr] ?? []
            const done = completionLogs.filter(l => l.employeeId === empId && l.dueDate === dateStr).length
            const total = dayTasks.length
            const rate = total > 0 ? Math.round((done / total) * 100) : 0
            const isPast = date < today && dateStr !== todayStr
            const isCurrentDay = dateStr === todayStr
            const isFuture = date > today
            const isExpanded = expandedDays.has(dateStr) || isCurrentDay

            let badge: string
            if (total === 0) badge = t('mytasks_noTasksBadge')
            else if (done === total) badge = t('mytasks_completeBadge')
            else if (isFuture) badge = `${total} ${t('task_tasks')}`
            else badge = `${done}/${total} ${t('mytasks_done')}`

            return (
              <div key={dateStr} className={`bg-surface rounded-xl border transition-all ${isCurrentDay ? 'border-primary/40 shadow-sm' : 'border-border'}`}>
                <button
                  onClick={() => toggleDay(dateStr)}
                  className={`w-full flex items-center justify-between px-4 py-3 ${isPast && !isCurrentDay ? 'opacity-70' : ''}`}
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
                    {dayTasks.map(task => (
                      <TaskCard
                        key={task.id}
                        task={task}
                        isCompleted={isTaskCompleted(task.id, empId, dateStr)}
                        category={categories.find(c => c.id === task.categoryId)}
                        onComplete={() => completeTask(task.id, empId, dateStr)}
                        onUncomplete={() => uncompleteTask(task.id, empId, dateStr)}
                        currentUserId={empId}
                        dueDate={dateStr}
                      />
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
          {monthByWeek.map(({ weekNum: wn, days }) => {
            const weekStart = days[0].dateStr
            const weekEnd = days[days.length - 1].dateStr
            let totalWeek = 0, doneWeek = 0
            days.forEach(({ date, dateStr }) => {
              const dt = getTasksDueOnDate(tasks, empId, date)
              totalWeek += dt.length
              doneWeek += completionLogs.filter(l => l.employeeId === empId && l.dueDate === dateStr).length
            })
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
                      {t('mytasks_week')} {wn + 1}, {format(new Date(weekStart), 'd MMM', dateLocale)}, {format(new Date(weekEnd), 'd MMM', dateLocale)}
                    </span>
                  </div>
                  <span className="text-xs text-text-muted">
                    {doneWeek}/{totalWeek} {t('task_tasks')}
                  </span>
                </button>

                {isExpanded && (
                  <div className="px-4 pb-4 space-y-4">
                    {days.map(({ date, dateStr }) => {
                      const dt = getTasksDueOnDate(tasks, empId, date)
                      if (dt.length === 0) return null
                      return (
                        <div key={dateStr}>
                          <p className="text-xs font-medium text-text-muted mb-2">{format(date, 'EEEE d', dateLocale)}</p>
                          <div className="space-y-2">
                            {dt.map(task => (
                              <TaskCard
                                key={task.id}
                                task={task}
                                isCompleted={isTaskCompleted(task.id, empId, dateStr)}
                                category={categories.find(c => c.id === task.categoryId)}
                                onComplete={() => completeTask(task.id, empId, dateStr)}
                                onUncomplete={() => uncompleteTask(task.id, empId, dateStr)}
                                currentUserId={empId}
                                dueDate={dateStr}
                              />
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
    </div>
  )
}
