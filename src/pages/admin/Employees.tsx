import React from 'react'
import { Link } from 'react-router-dom'
import { Users } from 'lucide-react'
import { useEmployeeStore } from '../../store/employeeStore'
import { useTaskStore } from '../../store/taskStore'
import { EmptyState } from '../../components/shared/EmptyState'
import { format } from 'date-fns'
import { getTasksDueOnDate } from '../../utils/taskScheduler'
import { useT } from '../../i18n/useT'

export function Employees() {
  const { employees } = useEmployeeStore()
  const { tasks, completionLogs } = useTaskStore()
  const { t } = useT()

  const today = new Date()
  const todayStr = format(today, 'yyyy-MM-dd')

  if (employees.length === 0) {
    return (
      <EmptyState
        icon={Users}
        title={t('employees_noEmployees')}
        description={t('employees_noEmployeesDesc')}
      />
    )
  }

  return (
    <div className="animate-fade-in">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {employees.map(emp => {
          const dueTasks = getTasksDueOnDate(tasks, emp.id, today)
          const doneToday = completionLogs.filter(
            l => l.employeeId === emp.id && l.dueDate === todayStr
          ).length
          const rate = dueTasks.length > 0 ? Math.round((doneToday / dueTasks.length) * 100) : 0

          let streak = 0
          for (let i = 1; i <= 30; i++) {
            const d = new Date(today)
            d.setDate(d.getDate() - i)
            if (d.getDay() === 0 || d.getDay() === 6) continue
            const ds = format(d, 'yyyy-MM-dd')
            const due = getTasksDueOnDate(tasks, emp.id, d).length
            const done = completionLogs.filter(l => l.employeeId === emp.id && l.dueDate === ds).length
            if (due > 0 && done / due >= 0.8) streak++
            else break
          }

          return (
            <div key={emp.id} className="bg-surface rounded-xl border border-border p-5 flex flex-col gap-4">
              <div className="flex items-start gap-3">
                <div className="w-12 h-12 rounded-full bg-primary flex items-center justify-center flex-shrink-0">
                  <span className="text-white font-bold text-base">{emp.avatarInitials}</span>
                </div>
                <div className="flex-1 min-w-0">
                  <h3 className="text-text-main font-semibold text-sm">{emp.name}</h3>
                  <p className="text-text-muted text-xs mt-0.5">{emp.jobTitle}</p>
                  <p className="text-text-subtle text-xs">{emp.department}</p>
                </div>
              </div>

              <div>
                <div className="flex justify-between items-center mb-1.5">
                  <span className="text-text-muted text-xs">{t('employees_todayProgress')}</span>
                  <span className="text-text-main text-xs font-medium">{doneToday}/{dueTasks.length}</span>
                </div>
                <div className="w-full bg-surface-2 rounded-full h-2">
                  <div
                    className={`h-2 rounded-full transition-all ${
                      rate === 100 ? 'bg-primary' : rate >= 60 ? 'bg-amber' : 'bg-danger'
                    }`}
                    style={{ width: `${rate}%` }}
                  />
                </div>
                <div className="flex justify-between mt-1">
                  <span className="text-text-subtle text-xs">{rate}{t('employees_complete')}</span>
                  {streak > 0 && (
                    <span className="text-xs text-amber">🔥 {streak} {t('employees_dayStreak')}</span>
                  )}
                </div>
              </div>

              <Link
                to={`/admin/employees/${emp.id}`}
                className="w-full text-center text-sm font-medium text-primary border border-primary/30 rounded-lg py-2 hover:bg-primary-light transition-colors"
              >
                {t('employees_viewProfile')}
              </Link>
            </div>
          )
        })}
      </div>
    </div>
  )
}
