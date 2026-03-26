import React from 'react'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, ReferenceLine
} from 'recharts'
import { DailyStats } from '../../types'
import { parseISO, getDay } from 'date-fns'
import { useT } from '../../i18n/useT'

interface Props {
  dailyStats: DailyStats[]
  height?: number
}

const DAY_INDICES = [1, 2, 3, 4, 5] // Mon–Fri

export function DayOfWeekBarChart({ dailyStats, height = 220 }: Props) {
  const { t } = useT()
  const DAY_NAMES = [t('day_mon'), t('day_tue'), t('day_wed'), t('day_thu'), t('day_fri')]

  const dayTotals: Record<number, { sum: number; count: number }> = {}
  DAY_INDICES.forEach(d => { dayTotals[d] = { sum: 0, count: 0 } })

  dailyStats.forEach(stat => {
    if (stat.assigned === 0) return
    const dow = getDay(parseISO(stat.date))
    if (dayTotals[dow]) {
      dayTotals[dow].sum += stat.completionRate
      dayTotals[dow].count++
    }
  })

  const data = DAY_INDICES.map((dow, i) => ({
    day: DAY_NAMES[i],
    avg: dayTotals[dow].count > 0
      ? Math.round(dayTotals[dow].sum / dayTotals[dow].count)
      : 0,
  }))

  const CustomTooltip = ({ active, payload, label }: any) => {
    if (!active || !payload?.length) return null
    return (
      <div className="bg-surface border border-border rounded-lg p-3 text-xs shadow-lg">
        <p className="font-semibold text-text-main">{label}</p>
        <p className="text-text-muted mt-1">{t('chart_avgCompletion')} <span className="font-medium text-text-main">{payload[0].value}%</span></p>
      </div>
    )
  }

  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ top: 5, right: 10, left: -10, bottom: 5 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="rgba(0,0,0,0.06)" />
        <XAxis dataKey="day" tick={{ fontSize: 11, fill: '#6B6960' }} tickLine={false} axisLine={false} />
        <YAxis domain={[0, 100]} tick={{ fontSize: 11, fill: '#6B6960' }} tickLine={false} axisLine={false} tickFormatter={v => `${v}%`} />
        <Tooltip content={<CustomTooltip />} />
        <ReferenceLine y={80} stroke="#1A5C3A" strokeDasharray="4 4" strokeOpacity={0.4} />
        <Bar dataKey="avg" fill="#1A5C3A" radius={[4, 4, 0, 0]} maxBarSize={48} />
      </BarChart>
    </ResponsiveContainer>
  )
}
