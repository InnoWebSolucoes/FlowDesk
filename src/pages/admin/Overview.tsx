import React from 'react'
import { format } from 'date-fns'
import { Users, CheckSquare, TrendingUp, AlertTriangle, ListTodo } from 'lucide-react'
import { useTaskStore } from '../../store/taskStore'
import { useEmployeeStore } from '../../store/employeeStore'
import { StatCard } from '../../components/shared/StatCard'
import { TaskTimestampLog } from '../../components/charts/TaskTimestampLog'
import { Badge } from '../../components/shared/Badge'
import { getTasksDueOnDate } from '../../utils/taskScheduler'
import { useT } from '../../i18n/useT'

export function Overview() {
  const { tasks, completionLogs, categories } = useTaskStore()
  const { employees } = useEmployeeStore()
  const { t } = useT()

  const today = new Date()
  const todayStr = format(today, 'yyyy-MM-dd')
  const hour = today.getHours()

  const totalEmployees = employees.length

  let totalAssignedToday = 0
  let totalCompletedToday = 0
  for (const emp of employees) {
    const due = getTasksDueOnDate(tasks, emp.id, today)
    totalAssignedToday += due.length
    totalCompletedToday += completionLogs.filter(
      l => l.employeeId === emp.id && l.dueDate === todayStr
    ).length
  }

  const overallRate = totalAssignedToday > 0
    ? Math.round((totalCompletedToday / totalAssignedToday) * 100)
    : 0

  const behindEmployees = hour < 15 ? employees.filter(emp => {
    const due = getTasksDueOnDate(tasks, emp.id, today)
    if (due.length < 2) return false
    const completed = completionLogs.filter(
      l => l.employeeId === emp.id && l.dueDate === todayStr
    ).length
    return due.length > 0 && (completed / due.length) < 0.5
  }) : []

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          label={t('overview_totalEmployees')}
          value={totalEmployees}
          icon={<Users size={18} className="text-primary" />}
          color="green"
        />
        <StatCard
          label={t('overview_assignedToday')}
          value={totalAssignedToday}
          icon={<ListTodo size={18} className="text-blue-accent" />}
          color="blue"
        />
        <StatCard
          label={t('overview_completedToday')}
          value={totalCompletedToday}
          icon={<CheckSquare size={18} className="text-primary" />}
          color="green"
        />
        <StatCard
          label={t('overview_todayRate')}
          value={`${overallRate}%`}
          icon={<TrendingUp size={18} className="text-primary" />}
          color={overallRate >= 80 ? 'green' : overallRate >= 50 ? 'amber' : 'red'}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 bg-surface rounded-xl border border-border p-5">
          <h2 className="text-text-main font-semibold text-base mb-4">{t('overview_liveActivity')}</h2>
          <TaskTimestampLog
            completionLogs={completionLogs}
            tasks={tasks}
            categories={categories}
            employees={employees}
            maxItems={30}
          />
        </div>

        <div className="space-y-4">
          {behindEmployees.length > 0 && (
            <div className="bg-amber-bg border border-amber/20 rounded-xl p-4">
              <div className="flex items-center gap-2 mb-3">
                <AlertTriangle size={16} className="text-amber" />
                <h3 className="text-amber font-semibold text-sm">{t('overview_behindToday')}</h3>
              </div>
              <div className="space-y-3">
                {behindEmployees.map(emp => {
                  const due = getTasksDueOnDate(tasks, emp.id, today)
                  const done = completionLogs.filter(
                    l => l.employeeId === emp.id && l.dueDate === todayStr
                  ).length
                  const rate = due.length > 0 ? Math.round((done / due.length) * 100) : 0
                  return (
                    <div key={emp.id}>
                      <div className="flex justify-between items-center mb-1">
                        <span className="text-sm font-medium text-text-main">{emp.name}</span>
                        <span className="text-xs text-amber font-medium">{done}/{due.length} ({rate}%)</span>
                      </div>
                      <div className="w-full bg-surface rounded-full h-1.5">
                        <div
                          className="bg-amber rounded-full h-1.5 transition-all"
                          style={{ width: `${rate}%` }}
                        />
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          <div className="bg-surface rounded-xl border border-border p-4">
            <h3 className="text-text-main font-semibold text-sm mb-3">{t('overview_employeeProgress')}</h3>
            <div className="space-y-3">
              {employees.map(emp => {
                const due = getTasksDueOnDate(tasks, emp.id, today)
                const done = completionLogs.filter(
                  l => l.employeeId === emp.id && l.dueDate === todayStr
                ).length
                const rate = due.length > 0 ? Math.round((done / due.length) * 100) : 0
                return (
                  <div key={emp.id}>
                    <div className="flex justify-between items-center mb-1">
                      <div className="flex items-center gap-2">
                        <div className="w-6 h-6 rounded-full bg-primary flex items-center justify-center">
                          <span className="text-white text-xs font-bold">{emp.avatarInitials}</span>
                        </div>
                        <span className="text-sm text-text-main">{emp.name}</span>
                      </div>
                      <span className="text-xs text-text-muted">{done}/{due.length}</span>
                    </div>
                    <div className="w-full bg-surface-2 rounded-full h-1.5">
                      <div
                        className={`rounded-full h-1.5 transition-all ${rate === 100 ? 'bg-primary' : rate >= 50 ? 'bg-amber' : 'bg-danger'}`}
                        style={{ width: `${rate}%` }}
                      />
                    </div>
                  </div>
                )
              })}
              {employees.length === 0 && (
                <p className="text-text-muted text-sm">{t('overview_noEmployees')}</p>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
