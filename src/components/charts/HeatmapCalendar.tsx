import React from 'react'
import { format, subWeeks, startOfWeek, addDays, isSameMonth } from 'date-fns'
import { DailyStats } from '../../types'
import { useT } from '../../i18n/useT'

interface Props {
  dailyStats: DailyStats[]
  weeks?: number
}

function getRateColor(rate: number, hasData: boolean, isWeekend: boolean): string {
  if (isWeekend) return '#ECEAE3'
  if (!hasData) return '#F5F4EF'
  if (rate === 0) return '#F5F4EF'
  if (rate < 50) return '#C6E2D2'
  if (rate < 80) return '#6DB98A'
  if (rate < 100) return '#2D8A57'
  return '#1A5C3A'
}

export function HeatmapCalendar({ dailyStats, weeks = 12 }: Props) {
  const { t, dateLocale } = useT()
  const today = new Date()
  const startDate = startOfWeek(subWeeks(today, weeks - 1), { weekStartsOn: 1 })

  const statMap: Record<string, DailyStats> = {}
  dailyStats.forEach(d => { statMap[d.date] = d })

  const columns: Date[][] = []
  for (let w = 0; w < weeks; w++) {
    const weekStart = addDays(startDate, w * 7)
    const days: Date[] = []
    for (let d = 0; d < 7; d++) {
      days.push(addDays(weekStart, d))
    }
    columns.push(days)
  }

  // Day labels (Mon, Wed, Fri)
  const dayLabels = [t('day_mon'), t('day_tue'), t('day_wed'), t('day_thu'), t('day_fri'), t('day_sat'), t('day_sun')]

  // Month labels
  const monthLabels: { label: string; col: number }[] = []
  columns.forEach((week, i) => {
    const firstDay = week[0]
    if (i === 0 || !isSameMonth(firstDay, columns[i - 1][0])) {
      monthLabels.push({ label: format(firstDay, 'MMM', dateLocale), col: i })
    }
  })

  return (
    <div className="overflow-x-auto">
      <div className="inline-flex flex-col gap-1">
        {/* Month labels */}
        <div className="flex gap-1 ml-6">
          {columns.map((_, i) => {
            const ml = monthLabels.find(m => m.col === i)
            return (
              <div key={i} className="w-4 text-center">
                {ml && <span className="text-xs text-text-subtle">{ml.label}</span>}
              </div>
            )
          })}
        </div>

        {/* Grid */}
        <div className="flex gap-1">
          {/* Day labels */}
          <div className="flex flex-col gap-1 mr-1">
            {dayLabels.map((d, i) => (
              <div key={i} className="w-4 h-4 flex items-center justify-center">
                {(i === 0 || i === 2 || i === 4) && (
                  <span className="text-xs text-text-subtle">{d.charAt(0)}</span>
                )}
              </div>
            ))}
          </div>

          {/* Cells */}
          {columns.map((week, wi) => (
            <div key={wi} className="flex flex-col gap-1">
              {week.map((day, di) => {
                const dateStr = format(day, 'yyyy-MM-dd')
                const isFuture = day > today
                const isWeekend = di === 5 || di === 6
                const stat = statMap[dateStr]
                const hasData = !!stat && stat.assigned > 0
                const rate = stat?.completionRate ?? 0
                const bg = isFuture ? '#F5F4EF' : getRateColor(rate, hasData, isWeekend)

                return (
                  <div
                    key={di}
                    className="w-4 h-4 rounded-sm cursor-default group relative"
                    style={{ backgroundColor: bg, opacity: isFuture ? 0.3 : 1 }}
                    title={
                      hasData
                        ? `${format(day, 'EEE d MMM', dateLocale)}: ${stat.completed}/${stat.assigned} (${rate}%)`
                        : format(day, 'EEE d MMM', dateLocale)
                    }
                  />
                )
              })}
            </div>
          ))}
        </div>

        {/* Legend */}
        <div className="flex items-center gap-2 mt-2 ml-6">
          <span className="text-xs text-text-subtle">{t('chart_less')}</span>
          {['#F5F4EF', '#C6E2D2', '#6DB98A', '#2D8A57', '#1A5C3A'].map((c, i) => (
            <div key={i} className="w-3 h-3 rounded-sm" style={{ backgroundColor: c }} />
          ))}
          <span className="text-xs text-text-subtle">{t('chart_more')}</span>
        </div>
      </div>
    </div>
  )
}
