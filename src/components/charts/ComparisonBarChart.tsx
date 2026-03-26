import React from 'react'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  Legend, ResponsiveContainer, Cell
} from 'recharts'
import { DailyStats } from '../../types'
import { format, startOfWeek, subWeeks } from 'date-fns'
import { useT } from '../../i18n/useT'

interface EmployeeSeries {
  employeeId: string
  name: string
  dailyStats: DailyStats[]
}

interface Props {
  series: EmployeeSeries[]
  height?: number
}

function rateColor(rate: number) {
  if (rate >= 80) return '#1A5C3A'
  if (rate >= 60) return '#7A4A0A'
  return '#7A2020'
}

export function ComparisonBarChart({ series, height = 260 }: Props) {
  const { t } = useT()
  const today = new Date()
  const thisWeekStart = format(startOfWeek(today, { weekStartsOn: 1 }), 'yyyy-MM-dd')
  const lastMonthStart = format(subWeeks(today, 4), 'yyyy-MM-dd')

  const data = series.map(s => {
    const weekStats = s.dailyStats.filter(d => d.date >= thisWeekStart && d.assigned > 0)
    const monthStats = s.dailyStats.filter(d => d.date >= lastMonthStart && d.assigned > 0)

    const weekRate = weekStats.length > 0
      ? Math.round(weekStats.reduce((a, d) => a + d.completionRate, 0) / weekStats.length)
      : 0
    const monthRate = monthStats.length > 0
      ? Math.round(monthStats.reduce((a, d) => a + d.completionRate, 0) / monthStats.length)
      : 0

    return { name: s.name, week: weekRate, month: monthRate }
  })

  const CustomTooltip = ({ active, payload, label }: any) => {
    if (!active || !payload?.length) return null
    return (
      <div className="bg-surface border border-border rounded-lg p-3 text-xs shadow-lg">
        <p className="font-semibold text-text-main mb-2">{label}</p>
        {payload.map((p: any) => (
          <div key={p.name} className="flex items-center gap-2 mb-1">
            <span className="w-2 h-2 rounded-full" style={{ backgroundColor: p.fill }} />
            <span className="text-text-muted">{p.name === 'week' ? t('chart_thisWeekTooltip') : t('chart_thisMonthTooltip')}:</span>
            <span className="font-medium">{p.value}%</span>
          </div>
        ))}
      </div>
    )
  }

  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ top: 5, right: 10, left: -10, bottom: 5 }} barCategoryGap="20%">
        <CartesianGrid strokeDasharray="3 3" stroke="rgba(0,0,0,0.06)" />
        <XAxis dataKey="name" tick={{ fontSize: 11, fill: '#6B6960' }} tickLine={false} axisLine={false} />
        <YAxis domain={[0, 100]} tick={{ fontSize: 11, fill: '#6B6960' }} tickLine={false} axisLine={false} tickFormatter={v => `${v}%`} />
        <Tooltip content={<CustomTooltip />} />
        <Legend
          formatter={(value) => value === 'week' ? t('chart_thisWeekTooltip') : t('chart_thisMonthTooltip')}
          wrapperStyle={{ fontSize: 12 }}
        />
        <Bar dataKey="week" name="week" fill="#1A5C3A" radius={[3, 3, 0, 0]} maxBarSize={36}>
          {data.map((d, i) => <Cell key={i} fill={rateColor(d.week)} />)}
        </Bar>
        <Bar dataKey="month" name="month" fill="#1B4F8A" radius={[3, 3, 0, 0]} maxBarSize={36}>
          {data.map((d, i) => <Cell key={i} fill={rateColor(d.month)} fillOpacity={0.6} />)}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  )
}
