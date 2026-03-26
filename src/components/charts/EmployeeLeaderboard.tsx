import React from 'react'
import { DailyStats } from '../../types'
import { format, startOfWeek, subWeeks } from 'date-fns'
import { useT } from '../../i18n/useT'

interface EmployeeRow {
  employeeId: string
  name: string
  avatarInitials: string
  currentStreak: number
  dailyStats: DailyStats[]
}

interface Props {
  employees: EmployeeRow[]
}

function rateColor(rate: number) {
  if (rate >= 80) return 'text-success'
  if (rate >= 60) return 'text-amber'
  return 'text-danger'
}

function rateBg(rate: number) {
  if (rate >= 80) return 'bg-success-bg'
  if (rate >= 60) return 'bg-amber-bg'
  return 'bg-danger-bg'
}

function calcWeekRate(stats: DailyStats[], weekStart: string) {
  const weekStats = stats.filter(d => d.date >= weekStart && d.assigned > 0)
  if (!weekStats.length) return 0
  return Math.round(weekStats.reduce((a, d) => a + d.completionRate, 0) / weekStats.length)
}

export function EmployeeLeaderboard({ employees }: Props) {
  const { t } = useT()
  const today = new Date()
  const thisWeekStart = format(startOfWeek(today, { weekStartsOn: 1 }), 'yyyy-MM-dd')
  const lastWeekStart = format(startOfWeek(subWeeks(today, 1), { weekStartsOn: 1 }), 'yyyy-MM-dd')
  const lastWeekEnd = thisWeekStart

  const rows = employees.map(emp => {
    const thisWeek = calcWeekRate(emp.dailyStats, thisWeekStart)
    const lastWeekStats = emp.dailyStats.filter(d => d.date >= lastWeekStart && d.date < lastWeekEnd && d.assigned > 0)
    const lastWeek = lastWeekStats.length > 0
      ? Math.round(lastWeekStats.reduce((a, d) => a + d.completionRate, 0) / lastWeekStats.length)
      : 0
    const trend = thisWeek - lastWeek

    const todayStr = format(today, 'yyyy-MM-dd')
    const todayStat = emp.dailyStats.find(d => d.date === todayStr)

    return {
      ...emp,
      thisWeekRate: thisWeek,
      trend,
      todayCompleted: todayStat?.completed ?? 0,
      todayAssigned: todayStat?.assigned ?? 0,
    }
  }).sort((a, b) => b.thisWeekRate - a.thisWeekRate)

  const medals = ['🥇', '🥈', '🥉']

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border">
            <th className="text-left text-text-muted font-medium py-2 px-3 text-xs">{t('chart_rank')}</th>
            <th className="text-left text-text-muted font-medium py-2 px-3 text-xs">{t('chart_employee')}</th>
            <th className="text-left text-text-muted font-medium py-2 px-3 text-xs">{t('chart_tasksToday')}</th>
            <th className="text-left text-text-muted font-medium py-2 px-3 text-xs">{t('chart_thisWeek')}</th>
            <th className="text-left text-text-muted font-medium py-2 px-3 text-xs">{t('chart_streak')}</th>
            <th className="text-left text-text-muted font-medium py-2 px-3 text-xs">{t('chart_trend')}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={row.employeeId} className="border-b border-border/50 hover:bg-surface-2/40 transition-colors">
              <td className="py-3 px-3">
                <span className="text-base">{medals[i] ?? `#${i + 1}`}</span>
              </td>
              <td className="py-3 px-3">
                <div className="flex items-center gap-2">
                  <div className="w-7 h-7 rounded-full bg-primary flex items-center justify-center flex-shrink-0">
                    <span className="text-white text-xs font-bold">{row.avatarInitials}</span>
                  </div>
                  <span className="font-medium text-text-main">{row.name}</span>
                </div>
              </td>
              <td className="py-3 px-3 text-text-muted">
                {row.todayCompleted}/{row.todayAssigned}
              </td>
              <td className="py-3 px-3">
                <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${rateBg(row.thisWeekRate)} ${rateColor(row.thisWeekRate)}`}>
                  {row.thisWeekRate}%
                </span>
              </td>
              <td className="py-3 px-3 text-text-muted">
                🔥 {row.currentStreak} {t('chart_days')}
              </td>
              <td className="py-3 px-3">
                {row.trend !== 0 && (
                  <span className={`text-xs font-medium ${row.trend > 0 ? 'text-success' : 'text-danger'}`}>
                    {row.trend > 0 ? '↑' : '↓'} {Math.abs(row.trend)}%
                  </span>
                )}
                {row.trend === 0 && <span className="text-xs text-text-subtle">—</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
