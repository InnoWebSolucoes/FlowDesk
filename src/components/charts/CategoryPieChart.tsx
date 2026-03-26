import React from 'react'
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from 'recharts'
import { CompletionLog, Task, Category } from '../../types'
import { useT } from '../../i18n/useT'

interface Props {
  completionLogs: CompletionLog[]
  tasks: Task[]
  categories: Category[]
  employeeId?: string
}

export function CategoryPieChart({ completionLogs, tasks, categories, employeeId }: Props) {
  const { t } = useT()
  const logs = employeeId ? completionLogs.filter(l => l.employeeId === employeeId) : completionLogs

  const catData = categories.map(cat => {
    const catTasks = tasks.filter(task => task.categoryId === cat.id)
    const completed = logs.filter(l => catTasks.some(task => task.id === l.taskId)).length
    return { name: cat.name, value: completed, color: cat.color }
  }).filter(d => d.value > 0)

  if (catData.length === 0) {
    return <div className="flex items-center justify-center h-48 text-text-muted text-sm">{t('chart_noData')}</div>
  }

  const CustomTooltip = ({ active, payload }: any) => {
    if (!active || !payload?.length) return null
    const d = payload[0]
    const total = catData.reduce((a, b) => a + b.value, 0)
    return (
      <div className="bg-surface border border-border rounded-lg p-3 text-xs shadow-lg">
        <p className="font-semibold text-text-main mb-1">{d.name}</p>
        <p className="text-text-muted">{d.value} {t('chart_tasksCompleted')}</p>
        <p className="text-text-muted">{Math.round((d.value / total) * 100)}{t('chart_ofTotal')}</p>
      </div>
    )
  }

  return (
    <ResponsiveContainer width="100%" height={260}>
      <PieChart>
        <Pie
          data={catData}
          cx="50%"
          cy="45%"
          outerRadius={90}
          innerRadius={40}
          dataKey="value"
          label={({ name, percent }) => `${name} ${Math.round((percent ?? 0) * 100)}%`}
          labelLine={false}
        >
          {catData.map((entry, i) => (
            <Cell key={i} fill={entry.color} />
          ))}
        </Pie>
        <Tooltip content={<CustomTooltip />} />
      </PieChart>
    </ResponsiveContainer>
  )
}
