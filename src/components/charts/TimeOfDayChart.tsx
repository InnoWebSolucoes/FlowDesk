import React from 'react'
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts'
import { CompletionLog } from '../../types'
import { useT } from '../../i18n/useT'

interface Props {
  completionLogs: CompletionLog[]
  employeeId?: string
  height?: number
}

export function TimeOfDayChart({ completionLogs, employeeId, height = 220 }: Props) {
  const { t } = useT()
  const logs = employeeId ? completionLogs.filter(l => l.employeeId === employeeId) : completionLogs

  const bucketKeys = {
    early: t('chart_before11'),
    'mid-morning': t('chart_11to1'),
    afternoon: t('chart_1to4'),
    other: t('chart_after4'),
  }

  const counts: Record<string, number> = {
    [bucketKeys.early]: 0,
    [bucketKeys['mid-morning']]: 0,
    [bucketKeys.afternoon]: 0,
    [bucketKeys.other]: 0,
  }

  logs.forEach(log => {
    if (log.timeOfDay === 'early') counts[bucketKeys.early]++
    else if (log.timeOfDay === 'mid-morning') counts[bucketKeys['mid-morning']]++
    else if (log.timeOfDay === 'afternoon') counts[bucketKeys.afternoon]++
    else counts[bucketKeys.other]++
  })

  const total = logs.length
  const data = Object.entries(counts).map(([window, count]) => ({
    window,
    count,
    pct: total > 0 ? Math.round((count / total) * 100) : 0,
  }))

  const CustomTooltip = ({ active, payload, label }: any) => {
    if (!active || !payload?.length) return null
    return (
      <div className="bg-surface border border-border rounded-lg p-3 text-xs shadow-lg">
        <p className="font-semibold text-text-main">{label}</p>
        <p className="text-text-muted mt-1">{payload[0].value} {t('task_tasks')} ({data.find(d => d.window === label)?.pct}%)</p>
      </div>
    )
  }

  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ top: 5, right: 10, left: -10, bottom: 5 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="rgba(0,0,0,0.06)" />
        <XAxis dataKey="window" tick={{ fontSize: 10, fill: '#6B6960' }} tickLine={false} axisLine={false} />
        <YAxis tick={{ fontSize: 11, fill: '#6B6960' }} tickLine={false} axisLine={false} />
        <Tooltip content={<CustomTooltip />} />
        <Bar dataKey="count" fill="#1B4F8A" radius={[4, 4, 0, 0]} maxBarSize={60} />
      </BarChart>
    </ResponsiveContainer>
  )
}
