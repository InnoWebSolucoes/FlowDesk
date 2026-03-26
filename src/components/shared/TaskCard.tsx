import React, { useState } from 'react'
import { Clock, CheckCircle2, Circle } from 'lucide-react'
import { Task, Category } from '../../types'
import { Badge } from './Badge'
import { useT } from '../../i18n/useT'

interface TaskCardProps {
  task: Task
  isCompleted: boolean
  category?: Category
  onComplete: () => void
  onUncomplete: () => void
  showEmployee?: boolean
  employeeName?: string
}

const priorityColors: Record<string, string> = {
  high: '#7A2020',
  medium: '#7A4A0A',
  low: '#1A5C3A',
}

export function TaskCard({
  task,
  isCompleted,
  category,
  onComplete,
  onUncomplete,
  showEmployee,
  employeeName,
}: TaskCardProps) {
  const [animating, setAnimating] = useState(false)
  const { t } = useT()

  const handleToggle = () => {
    setAnimating(true)
    setTimeout(() => setAnimating(false), 300)
    if (isCompleted) {
      onUncomplete()
    } else {
      onComplete()
    }
  }

  return (
    <div
      className={`flex items-start gap-3 p-3 rounded-lg border transition-all duration-200 ${
        isCompleted
          ? 'bg-surface-2/50 border-border opacity-70'
          : 'bg-surface border-border hover:border-border-md hover:shadow-sm'
      }`}
    >
      <button
        onClick={handleToggle}
        className={`flex-shrink-0 mt-0.5 transition-transform ${animating ? 'animate-check' : ''}`}
        aria-label={isCompleted ? t('taskcard_markIncomplete') : t('taskcard_markComplete')}
      >
        {isCompleted ? (
          <CheckCircle2 size={18} className="text-primary" />
        ) : (
          <Circle size={18} className="text-text-subtle hover:text-primary transition-colors" />
        )}
      </button>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span
            className={`text-sm font-medium ${isCompleted ? 'line-through text-text-muted' : 'text-text-main'}`}
          >
            {task.title}
          </span>
          <span
            className="w-2 h-2 rounded-full flex-shrink-0"
            style={{ backgroundColor: priorityColors[task.priority] }}
            title={task.priority}
          />
        </div>

        {task.description && (
          <p className="text-xs text-text-muted mt-0.5 line-clamp-2">{task.description}</p>
        )}

        <div className="flex items-center gap-2 mt-1.5 flex-wrap">
          {category && <Badge label={category.name} color={category.color} size="sm" />}
          <span className="flex items-center gap-1 text-xs text-text-subtle">
            <Clock size={11} />
            ~{task.estimatedMinutes} {t('taskcard_min')}
          </span>
          {showEmployee && employeeName && (
            <span className="text-xs text-text-subtle">• {employeeName}</span>
          )}
        </div>
      </div>
    </div>
  )
}
