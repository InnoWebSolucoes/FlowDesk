import React from 'react'
import { CompletionLog, Task, Category, Employee } from '../../types'
import { Badge } from '../shared/Badge'
import { formatTimestamp } from '../../utils/taskScheduler'
import { useT } from '../../i18n/useT'

interface Props {
  completionLogs: CompletionLog[]
  tasks: Task[]
  categories: Category[]
  employees: Employee[]
  employeeId?: string
  maxItems?: number
}

export function TaskTimestampLog({ completionLogs, tasks, categories, employees, employeeId, maxItems = 50 }: Props) {
  const { t } = useT()
  const filtered = employeeId
    ? completionLogs.filter(l => l.employeeId === employeeId)
    : completionLogs

  const sorted = [...filtered]
    .sort((a, b) => new Date(b.completedAt).getTime() - new Date(a.completedAt).getTime())
    .slice(0, maxItems)

  if (!sorted.length) {
    return <p className="text-text-muted text-sm py-4 text-center">{t('chart_noCompletions')}</p>
  }

  return (
    <div className="max-h-96 overflow-y-auto space-y-1">
      {sorted.map(log => {
        const task = tasks.find(task => task.id === log.taskId)
        const category = categories.find(c => c.id === task?.categoryId)
        const employee = employees.find(e => e.id === log.employeeId)
        if (!task) return null

        return (
          <div
            key={log.id}
            className="flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-surface-2/40 transition-colors"
            style={{ borderLeft: `3px solid ${category?.color ?? '#6B6960'}` }}
          >
            {!employeeId && employee && (
              <div className="w-7 h-7 rounded-full bg-primary flex-shrink-0 flex items-center justify-center">
                <span className="text-white text-xs font-bold">{employee.avatarInitials}</span>
              </div>
            )}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                {!employeeId && employee && (
                  <span className="text-xs font-medium text-text-main">{employee.name}</span>
                )}
                <span className="text-sm text-text-main truncate">{task.title}</span>
                {category && <Badge label={category.name} color={category.color} size="sm" />}
              </div>
            </div>
            <span className="text-xs text-text-subtle flex-shrink-0">
              {formatTimestamp(log.completedAt)}
            </span>
          </div>
        )
      })}
    </div>
  )
}
