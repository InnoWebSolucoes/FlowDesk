import React, { useState } from 'react'
import { format, startOfWeek, subWeeks, parseISO } from 'date-fns'
import { useTaskStore } from '../../store/taskStore'
import { useEmployeeStore } from '../../store/employeeStore'
import { StatCard } from '../../components/shared/StatCard'
import { CompletionLineChart } from '../../components/charts/CompletionLineChart'
import { HeatmapCalendar } from '../../components/charts/HeatmapCalendar'
import { CategoryPieChart } from '../../components/charts/CategoryPieChart'
import { DayOfWeekBarChart } from '../../components/charts/DayOfWeekBarChart'
import { TimeOfDayChart } from '../../components/charts/TimeOfDayChart'
import { EmployeeLeaderboard } from '../../components/charts/EmployeeLeaderboard'
import { TaskTimestampLog } from '../../components/charts/TaskTimestampLog'
import { ComparisonBarChart } from '../../components/charts/ComparisonBarChart'
import { StreakCard } from '../../components/charts/StreakCard'
import { MissedTasksTable } from '../../components/charts/MissedTasksTable'
import { getTasksDueOnDate } from '../../utils/taskScheduler'
import { useT } from '../../i18n/useT'

interface Props {
  forEmployeeId?: string
}

export function Analytics({ forEmployeeId }: Props) {
  const { tasks, completionLogs, categories } = useTaskStore()
  const { employees, getEmployeeStats } = useEmployeeStore()
  const { t } = useT()

  const [view, setView] = useState<'company' | 'individual'>(forEmployeeId ? 'individual' : 'company')
  const [selectedEmpId, setSelectedEmpId] = useState(forEmployeeId ?? employees[0]?.id ?? '')

  const today = new Date()
  const todayStr = format(today, 'yyyy-MM-dd')
  const thisWeekStart = format(startOfWeek(today, { weekStartsOn: 1 }), 'yyyy-MM-dd')
  const thisMonthStart = format(new Date(today.getFullYear(), today.getMonth(), 1), 'yyyy-MM-dd')

  const allStats = employees.map(emp => getEmployeeStats(emp.id, completionLogs, tasks))

  const totalTasksMonth = allStats.reduce((a, s) => {
    return a + s.dailyStats.filter(d => d.date >= thisMonthStart).reduce((b, d) => b + d.assigned, 0)
  }, 0)
  const totalComplMonth = allStats.reduce((a, s) => {
    return a + s.dailyStats.filter(d => d.date >= thisMonthStart).reduce((b, d) => b + d.completed, 0)
  }, 0)
  const companyRate = totalTasksMonth > 0 ? Math.round((totalComplMonth / totalTasksMonth) * 100) : 0

  const bestEmployee = employees.reduce((best, emp) => {
    const s = getEmployeeStats(emp.id, completionLogs, tasks)
    const bs = getEmployeeStats(best.id, completionLogs, tasks)
    return s.completionRate > bs.completionRate ? emp : best
  }, employees[0])

  const taskMissMap: Record<string, number> = {}
  for (let i = 1; i <= 30; i++) {
    const d = new Date(today); d.setDate(d.getDate() - i)
    if (d.getDay() === 0 || d.getDay() === 6) continue
    const ds = format(d, 'yyyy-MM-dd')
    for (const emp of employees) {
      for (const task of getTasksDueOnDate(tasks, emp.id, d)) {
        const completed = completionLogs.some(l => l.taskId === task.id && l.employeeId === emp.id && l.dueDate === ds)
        if (!completed) taskMissMap[task.id] = (taskMissMap[task.id] ?? 0) + 1
      }
    }
  }
  const mostMissedId = Object.entries(taskMissMap).sort((a, b) => b[1] - a[1])[0]?.[0]
  const mostMissedTask = tasks.find(tsk => tsk.id === mostMissedId)

  const selectedStats = getEmployeeStats(selectedEmpId, completionLogs, tasks)
  const weekStats = selectedStats.dailyStats.filter(d => d.date >= thisWeekStart)
  const weekRate = weekStats.length > 0
    ? Math.round(weekStats.reduce((a, d) => a + d.completionRate, 0) / weekStats.filter(d => d.assigned > 0).length || 0)
    : 0
  const monthStats = selectedStats.dailyStats.filter(d => d.date >= thisMonthStart)
  const monthRate = monthStats.filter(d => d.assigned > 0).length > 0
    ? Math.round(monthStats.reduce((a, d) => a + d.completionRate, 0) / monthStats.filter(d => d.assigned > 0).length)
    : 0

  const companyLineSeries = employees.map((emp, i) => {
    const stats = getEmployeeStats(emp.id, completionLogs, tasks)
    const colors = ['#1A5C3A', '#1B4F8A', '#7A4A0A', '#7A2020']
    return { employeeId: emp.id, name: emp.name, color: colors[i % colors.length], dailyStats: stats.dailyStats }
  })

  const selectedEmp = employees.find(e => e.id === selectedEmpId)

  return (
    <div className="space-y-6 animate-fade-in">
      {!forEmployeeId && (
        <div className="flex items-center gap-1 bg-surface-2 rounded-lg p-1 w-fit">
          {(['company', 'individual'] as const).map(v => (
            <button
              key={v}
              onClick={() => setView(v)}
              className={`px-4 py-1.5 rounded-md text-sm font-medium transition-all ${
                view === v ? 'bg-surface text-text-main shadow-sm' : 'text-text-muted hover:text-text-main'
              }`}
            >
              {v === 'company' ? t('analytics_companyView') : t('analytics_individualView')}
            </button>
          ))}
        </div>
      )}

      {view === 'company' && (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <StatCard label={t('analytics_tasksMonth')} value={totalTasksMonth} color="blue" />
            <StatCard label={t('analytics_completionRate')} value={`${companyRate}%`} color={companyRate >= 80 ? 'green' : companyRate >= 60 ? 'amber' : 'red'} />
            <StatCard
              label={t('analytics_topPerformer')}
              value={bestEmployee?.name?.split(' ')[0] ?? '—'}
              subtitle={bestEmployee ? `${getEmployeeStats(bestEmployee.id, completionLogs, tasks).completionRate}%` : undefined}
              color="green"
            />
            <StatCard
              label={t('analytics_mostMissed')}
              value={mostMissedTask ? mostMissedId ? `${taskMissMap[mostMissedId]}×` : '—' : '—'}
              subtitle={mostMissedTask?.title ?? 'None'}
              color={mostMissedTask ? 'amber' : 'default'}
            />
          </div>

          <div className="bg-surface rounded-xl border border-border p-5">
            <h3 className="text-text-main font-semibold text-sm mb-4">{t('analytics_leaderboard')}</h3>
            <EmployeeLeaderboard
              employees={employees.map(emp => ({
                employeeId: emp.id,
                name: emp.name,
                avatarInitials: emp.avatarInitials,
                currentStreak: getEmployeeStats(emp.id, completionLogs, tasks).currentStreak,
                dailyStats: getEmployeeStats(emp.id, completionLogs, tasks).dailyStats,
              }))}
            />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            <div className="bg-surface rounded-xl border border-border p-5">
              <h3 className="text-text-main font-semibold text-sm mb-4">{t('analytics_completionRates')}</h3>
              <ComparisonBarChart series={companyLineSeries} />
            </div>
            <div className="bg-surface rounded-xl border border-border p-5">
              <h3 className="text-text-main font-semibold text-sm mb-4">{t('analytics_30dayTrend')}</h3>
              <CompletionLineChart series={companyLineSeries} />
            </div>
          </div>

          <div className="bg-surface rounded-xl border border-border p-5">
            <h3 className="text-text-main font-semibold text-sm mb-4">{t('analytics_recentCompletions')}</h3>
            <TaskTimestampLog
              completionLogs={completionLogs}
              tasks={tasks}
              categories={categories}
              employees={employees}
              maxItems={50}
            />
          </div>
        </>
      )}

      {view === 'individual' && (
        <>
          {!forEmployeeId && (
            <div className="flex items-center gap-3">
              <label className="text-text-muted text-sm">{t('analytics_employeeLabel')}</label>
              <select
                value={selectedEmpId}
                onChange={e => setSelectedEmpId(e.target.value)}
                className="border border-border rounded-lg px-3 py-2 text-sm text-text-main bg-surface focus:outline-none focus:border-primary"
              >
                {employees.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
              </select>
            </div>
          )}

          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <StatCard label={t('analytics_thisWeek')} value={`${weekRate}%`} color={weekRate >= 80 ? 'green' : weekRate >= 60 ? 'amber' : 'red'} />
            <StatCard label={t('analytics_thisMonth')} value={`${monthRate}%`} color={monthRate >= 80 ? 'green' : monthRate >= 60 ? 'amber' : 'red'} />
            <StatCard label={t('analytics_currentStreak')} value={`${selectedStats.currentStreak}d`} color={selectedStats.currentStreak > 5 ? 'green' : 'amber'} />
            <StatCard label={t('analytics_missed30d')} value={selectedStats.missedTasks} color={selectedStats.missedTasks === 0 ? 'green' : selectedStats.missedTasks < 5 ? 'amber' : 'red'} />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
            <StreakCard
              currentStreak={selectedStats.currentStreak}
              longestStreak={selectedStats.longestStreak}
            />
            <div className="lg:col-span-2 bg-surface rounded-xl border border-border p-5">
              <h3 className="text-text-main font-semibold text-sm mb-3">{t('analytics_heatmap')}</h3>
              <HeatmapCalendar dailyStats={selectedStats.dailyStats} />
            </div>
          </div>

          <div className="bg-surface rounded-xl border border-border p-5">
            <h3 className="text-text-main font-semibold text-sm mb-4">{t('analytics_completionTrend')}</h3>
            <CompletionLineChart
              series={[{
                employeeId: selectedEmpId,
                name: selectedEmp?.name ?? '',
                color: '#1A5C3A',
                dailyStats: selectedStats.dailyStats,
              }]}
            />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
            <div className="bg-surface rounded-xl border border-border p-5">
              <h3 className="text-text-main font-semibold text-sm mb-4">{t('analytics_byDayOfWeek')}</h3>
              <DayOfWeekBarChart dailyStats={selectedStats.dailyStats} />
            </div>
            <div className="bg-surface rounded-xl border border-border p-5">
              <h3 className="text-text-main font-semibold text-sm mb-4">{t('analytics_timeOfDay')}</h3>
              <TimeOfDayChart completionLogs={completionLogs} employeeId={selectedEmpId} />
            </div>
            <div className="bg-surface rounded-xl border border-border p-5">
              <h3 className="text-text-main font-semibold text-sm mb-4">{t('analytics_byCategory')}</h3>
              <CategoryPieChart
                completionLogs={completionLogs}
                tasks={tasks}
                categories={categories}
                employeeId={selectedEmpId}
              />
            </div>
          </div>

          <div className="bg-surface rounded-xl border border-border p-5">
            <h3 className="text-text-main font-semibold text-sm mb-4">{t('analytics_missedTasks')}</h3>
            <MissedTasksTable tasks={tasks} completionLogs={completionLogs} employees={employees} employeeId={selectedEmpId} />
          </div>

          <div className="bg-surface rounded-xl border border-border p-5">
            <h3 className="text-text-main font-semibold text-sm mb-4">{t('analytics_completionLog')}</h3>
            <TaskTimestampLog
              completionLogs={completionLogs}
              tasks={tasks}
              categories={categories}
              employees={employees}
              employeeId={selectedEmpId}
            />
          </div>
        </>
      )}
    </div>
  )
}
