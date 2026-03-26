import React, { useState } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import {
  format, startOfWeek, addDays, addWeeks, subWeeks,
  startOfMonth, addMonths, subMonths, getDaysInMonth
} from 'date-fns'
import { useTaskStore } from '../../store/taskStore'
import { useAuthStore } from '../../store/authStore'
import { getTasksDueOnDate } from '../../utils/taskScheduler'
import { useT } from '../../i18n/useT'

export function MyGantt() {
  const { currentUser } = useAuthStore()
  const { tasks, categories, completionLogs } = useTaskStore()
  const { t, dateLocale } = useT()
  const [viewMode, setViewMode] = useState<'week' | 'month'>('week')
  const [refDate, setRefDate] = useState(new Date())

  const empId = currentUser!.id
  const today = new Date()
  const todayStr = format(today, 'yyyy-MM-dd')

  const weekStart = startOfWeek(refDate, { weekStartsOn: 1 })
  const weekDays = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i))
  const monthStart = startOfMonth(refDate)
  const daysInMonth = getDaysInMonth(refDate)
  const monthDays = Array.from({ length: daysInMonth }, (_, i) => addDays(monthStart, i))
  const days = viewMode === 'week' ? weekDays : monthDays

  const prev = () => {
    if (viewMode === 'week') setRefDate(d => subWeeks(d, 1))
    else setRefDate(d => subMonths(d, 1))
  }
  const next = () => {
    if (viewMode === 'week') setRefDate(d => addWeeks(d, 1))
    else setRefDate(d => addMonths(d, 1))
  }

  const isToday = (d: Date) => format(d, 'yyyy-MM-dd') === todayStr
  const periodLabel = viewMode === 'week'
    ? `${format(weekDays[0], 'MMM d', dateLocale)} – ${format(weekDays[6], 'MMM d, yyyy', dateLocale)}`
    : format(refDate, 'MMMM yyyy', dateLocale)

  return (
    <div className="animate-fade-in">
      <div className="flex items-center gap-3 mb-5 flex-wrap">
        <div className="flex items-center gap-1 bg-surface-2 rounded-lg p-1">
          {(['week', 'month'] as const).map(v => (
            <button
              key={v}
              onClick={() => setViewMode(v)}
              className={`px-3 py-1.5 rounded-md text-sm font-medium transition-all ${
                viewMode === v ? 'bg-surface text-text-main shadow-sm' : 'text-text-muted hover:text-text-main'
              }`}
            >
              {v === 'week' ? t('gantt_weekView') : t('gantt_monthView')}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <button onClick={prev} className="p-1.5 border border-border rounded-lg hover:bg-surface-2 transition-colors">
            <ChevronLeft size={15} />
          </button>
          <span className="text-sm font-medium text-text-main min-w-48 text-center">{periodLabel}</span>
          <button onClick={next} className="p-1.5 border border-border rounded-lg hover:bg-surface-2 transition-colors">
            <ChevronRight size={15} />
          </button>
        </div>
        <button onClick={() => setRefDate(new Date())} className="text-sm text-primary border border-primary/30 rounded-lg px-3 py-1.5 hover:bg-primary-light transition-colors">
          {t('gantt_today')}
        </button>
      </div>

      <div className="bg-surface rounded-xl border border-border overflow-hidden">
        <div className="overflow-x-auto">
          <div className="min-w-max">
            <div className="flex border-b border-border bg-bg/40">
              <div className="w-36 flex-shrink-0 px-3 py-2 text-xs font-medium text-text-muted border-r border-border">
                {t('gantt_task')}
              </div>
              {days.map((day, i) => (
                <div
                  key={i}
                  className={`flex-shrink-0 text-center py-2 text-xs font-medium ${
                    isToday(day) ? 'bg-primary-light text-primary' :
                    day.getDay() === 0 || day.getDay() === 6 ? 'text-text-subtle bg-surface-2/30' : 'text-text-muted'
                  }`}
                  style={{ width: viewMode === 'week' ? '90px' : '32px' }}
                >
                  {viewMode === 'week'
                    ? <>{format(day, 'EEE', dateLocale)}<br />{format(day, 'd MMM', dateLocale)}</>
                    : format(day, 'd')}
                </div>
              ))}
            </div>

            {tasks.filter(task => task.assignedTo.includes(empId) && task.isActive).map(task => {
              const cat = categories.find(c => c.id === task.categoryId)
              return (
                <div key={task.id} className="flex border-b border-border/50 hover:bg-surface-2/20 transition-colors">
                  <div className="w-36 flex-shrink-0 px-3 py-2 border-r border-border">
                    <p className="text-xs font-medium text-text-main line-clamp-2 leading-tight">{task.title}</p>
                    {cat && <div className="w-1.5 h-1.5 rounded-full mt-1" style={{ backgroundColor: cat.color }} />}
                  </div>
                  {days.map((day, di) => {
                    const dateStr = format(day, 'yyyy-MM-dd')
                    const isDue = getTasksDueOnDate([task], empId, day).length > 0
                    const completed = isDue && completionLogs.some(
                      l => l.taskId === task.id && l.employeeId === empId && l.dueDate === dateStr
                    )
                    const color = cat?.color ?? '#6B6960'
                    const isWeekend = day.getDay() === 0 || day.getDay() === 6

                    return (
                      <div
                        key={di}
                        className={`flex-shrink-0 flex items-center justify-center py-2 ${
                          isToday(day) ? 'bg-primary-light/30' : isWeekend ? 'bg-surface-2/20' : ''
                        }`}
                        style={{ width: viewMode === 'week' ? '90px' : '32px' }}
                        title={isDue ? `${task.title} — ${completed ? t('gantt_done') : t('gantt_pending')}` : undefined}
                      >
                        {isDue && (
                          viewMode === 'week' ? (
                            <div
                              className="rounded text-xs px-1.5 py-0.5 w-full mx-0.5"
                              style={{
                                backgroundColor: color + '25',
                                borderLeft: `3px solid ${completed ? color : color + '80'}`,
                                color,
                              }}
                            >
                              {completed ? '✓' : '~'}{task.estimatedMinutes}m
                            </div>
                          ) : (
                            <div
                              className="w-2 h-2 rounded-full"
                              style={{ backgroundColor: completed ? color : color + '60' }}
                            />
                          )
                        )}
                      </div>
                    )
                  })}
                </div>
              )
            })}
          </div>
        </div>

        <div className="px-4 py-3 border-t border-border flex flex-wrap gap-3">
          {categories.filter(cat => tasks.some(task => task.categoryId === cat.id && task.assignedTo.includes(empId))).map(cat => (
            <div key={cat.id} className="flex items-center gap-1.5">
              <div className="w-3 h-3 rounded-sm" style={{ backgroundColor: cat.color }} />
              <span className="text-xs text-text-muted">{cat.name}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
