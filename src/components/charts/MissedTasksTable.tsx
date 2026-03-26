import React from 'react'
import { CompletionLog, Task, Employee } from '../../types'
import { format, parseISO } from 'date-fns'
import { getTasksDueOnDate } from '../../utils/taskScheduler'
import { subDays } from 'date-fns'
import { useT } from '../../i18n/useT'

interface Props {
  tasks: Task[]
  completionLogs: CompletionLog[]
  employees: Employee[]
  employeeId?: string
}

interface MissedRow {
  taskTitle: string
  employeeName: string
  dueDate: string
  daysAgo: number
}

export function MissedTasksTable({ tasks, completionLogs, employees, employeeId }: Props) {
  const { t, dateLocale } = useT()
  const today = new Date()
  const missed: MissedRow[] = []

  const empList = employeeId ? employees.filter(e => e.id === employeeId) : employees

  for (let i = 1; i <= 30; i++) {
    const date = subDays(today, i)
    const dow = date.getDay()
    if (dow === 0 || dow === 6) continue
    const dateStr = format(date, 'yyyy-MM-dd')

    for (const emp of empList) {
      const due = getTasksDueOnDate(tasks, emp.id, date)
      for (const task of due) {
        const completed = completionLogs.some(
          l => l.taskId === task.id && l.employeeId === emp.id && l.dueDate === dateStr
        )
        if (!completed) {
          missed.push({
            taskTitle: task.title,
            employeeName: emp.name,
            dueDate: dateStr,
            daysAgo: i,
          })
        }
      }
    }
  }

  missed.sort((a, b) => a.daysAgo - b.daysAgo)
  const display = missed.slice(0, 20)

  if (!display.length) {
    return <p className="text-text-muted text-sm py-4 text-center">{t('chart_noMissed')}</p>
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border">
            <th className="text-left text-text-muted font-medium py-2 px-3 text-xs">{t('chart_task')}</th>
            {!employeeId && <th className="text-left text-text-muted font-medium py-2 px-3 text-xs">{t('chart_employee')}</th>}
            <th className="text-left text-text-muted font-medium py-2 px-3 text-xs">{t('chart_dueDate')}</th>
            <th className="text-left text-text-muted font-medium py-2 px-3 text-xs">{t('chart_daysAgo')}</th>
          </tr>
        </thead>
        <tbody>
          {display.map((row, i) => (
            <tr key={i} className="border-b border-border/50 bg-danger-bg/30 hover:bg-danger-bg/50 transition-colors">
              <td className="py-2 px-3 text-text-main">{row.taskTitle}</td>
              {!employeeId && <td className="py-2 px-3 text-text-muted">{row.employeeName}</td>}
              <td className="py-2 px-3 text-text-muted">
                {format(parseISO(row.dueDate), 'EEE d MMM', dateLocale)}
              </td>
              <td className="py-2 px-3 text-danger text-xs font-medium">{row.daysAgo}{t('chart_dAgo')}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
