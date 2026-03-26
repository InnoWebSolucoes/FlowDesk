import React from 'react'
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Legend, ReferenceLine
} from 'recharts'
import { format, parseISO } from 'date-fns'
import { DailyStats } from '../../types'

interface Series {
  employeeId: string
  name: string
  color: string
  dailyStats: DailyStats[]
}

interface Props {
  series: Series[]
  height?: number
}

const COLORS = ['#1A5C3A', '#1B4F8A', '#7A4A0A', '#7A2020']

export function CompletionLineChart({ series, height = 280 }: Props) {
  // Build unified date list
  const dateSet = new Set<string>()
  series.forEach(s => s.dailyStats.forEach(d => dateSet.add(d.date)))
  const dates = Array.from(dateSet).sort()

  const data = dates.map(date => {
    const point: Record<string, any> = {
      date,
      label: format(parseISO(date), 'MMM d'),
    }
    series.forEach(s => {
      const stat = s.dailyStats.find(d => d.date === date)
      point[s.employeeId] = stat ? stat.completionRate : null
      point[`${s.employeeId}_completed`] = stat ? stat.completed : 0
      point[`${s.employeeId}_assigned`] = stat ? stat.assigned : 0
    })
    return point
  })

  const CustomTooltip = ({ active, payload, label }: any) => {
    if (!active || !payload?.length) return null
    return (
      <div className="bg-surface border border-border rounded-lg shadow-lg p-3 text-xs">
        <p className="font-semibold text-text-main mb-2">{label}</p>
        {payload.map((p: any) => (
          <div key={p.dataKey} className="flex items-center gap-2 mb-1">
            <span className="w-2 h-2 rounded-full" style={{ backgroundColor: p.color }} />
            <span className="text-text-muted">{p.name}:</span>
            <span className="font-medium text-text-main">{p.value ?? 0}%</span>
            <span className="text-text-subtle">
              ({data.find(d => d.label === label)?.[`${p.dataKey}_completed`] ?? 0}/
              {data.find(d => d.label === label)?.[`${p.dataKey}_assigned`] ?? 0} tasks)
            </span>
          </div>
        ))}
      </div>
    )
  }

  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={data} margin={{ top: 5, right: 10, left: -10, bottom: 5 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="rgba(0,0,0,0.06)" />
        <XAxis
          dataKey="label"
          tick={{ fontSize: 11, fill: '#6B6960' }}
          tickLine={false}
          axisLine={false}
          interval={Math.floor(dates.length / 6)}
        />
        <YAxis
          domain={[0, 100]}
          tick={{ fontSize: 11, fill: '#6B6960' }}
          tickLine={false}
          axisLine={false}
          tickFormatter={(v) => `${v}%`}
        />
        <Tooltip content={<CustomTooltip />} />
        {series.length > 1 && <Legend wrapperStyle={{ fontSize: 12 }} />}
        <ReferenceLine y={80} stroke="#1A5C3A" strokeDasharray="4 4" strokeOpacity={0.4} />
        {series.map((s, i) => (
          <Line
            key={s.employeeId}
            type="monotone"
            dataKey={s.employeeId}
            name={s.name}
            stroke={s.color || COLORS[i % COLORS.length]}
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 5, strokeWidth: 0 }}
            connectNulls={false}
          />
        ))}
      </LineChart>
    </ResponsiveContainer>
  )
}
