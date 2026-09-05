import React, { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Clock, CheckCircle2, Circle, Timer, MessageSquare } from 'lucide-react'
import { Task, Category } from '../../types'
import { Badge } from './Badge'
import { useChatStore } from '../../store/chatStore'
import { useAuthStore } from '../../store/authStore'
import { useT } from '../../i18n/useT'
import { differenceInDays, parseISO } from 'date-fns'
import { HIGHLIGHT_CLASS } from '../../lib/highlight'

interface TaskCardProps {
  task: Task
  isCompleted: boolean
  isInProgress?: boolean
  category?: Category
  onComplete: () => void
  onUncomplete: () => void
  onSetInProgress?: () => void
  onClearInProgress?: () => void
  showEmployee?: boolean
  employeeName?: string
  currentUserId?: string
  dueDate?: string
  /**
   * Rings the card and scrolls it into view. Set when a notification pointed
   * at this task, so the reader is not left hunting a long list for it.
   */
  highlighted?: boolean
  highlightRef?: (node: HTMLElement | null) => void
}

const priorityColors: Record<string, string> = {
  high: '#7A2020',
  medium: '#7A4A0A',
  low: '#1A5C3A',
}

function DeadlineBadge({ task }: { task: Task }) {
  const { t } = useT()
  if (task.frequency.type !== 'one-off' || !task.frequency.date) return null

  const days = differenceInDays(parseISO(task.frequency.date), new Date())

  if (days < 0) {
    return (
      <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-danger/10 text-danger flex-shrink-0">
        {t('deadline_overdue')}
      </span>
    )
  }
  if (days === 0) {
    return (
      <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-amber/10 text-amber flex-shrink-0">
        {t('deadline_today')}
      </span>
    )
  }
  if (days === 1) {
    return (
      <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-amber/10 text-amber flex-shrink-0">
        {t('deadline_tomorrow')}
      </span>
    )
  }
  if (days <= 3) {
    return (
      <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-amber/10 text-text-muted flex-shrink-0">
        {t('deadline_inDays').replace('{n}', days.toString())}
      </span>
    )
  }
  return null
}

export function TaskCard({
  task,
  isCompleted,
  isInProgress,
  category,
  onComplete,
  onUncomplete,
  onSetInProgress,
  onClearInProgress,
  showEmployee,
  employeeName,
  currentUserId,
  dueDate,
  highlighted,
  highlightRef,
}: TaskCardProps) {
  const [animating, setAnimating] = useState(false)
  const [opening, setOpening] = useState(false)
  const { t } = useT()
  const navigate = useNavigate()
  const { currentUser } = useAuthStore()
  // Discussion of a task lives in chat now, not on the card. The count is of
  // that room, so the card still says whether there is anything to read.
  const { conversations, messages, openTaskRoom } = useChatStore()

  const room = conversations.find((c) => c.taskId === task.id)
  const messageCount = room ? (messages[room.id] ?? []).length : 0

  /**
   * Open this task's discussion. The room is created on demand, so a task
   * nobody has talked about yet still has somewhere to go — it just does not
   * exist until someone opens it.
   */
  const openDiscussion = async () => {
    setOpening(true)
    try {
      const conv = await openTaskRoom(task.id, task.projectId)
      if (!conv) return
      const base = currentUser?.role === 'admin' ? '/admin/chat' : '/employee/chat'
      navigate(`${base}?conversation=${conv.id}`)
    } finally {
      setOpening(false)
    }
  }

  const handleToggle = () => {
    setAnimating(true)
    setTimeout(() => setAnimating(false), 300)

    if (isCompleted) {
      onUncomplete()
      if (onClearInProgress) onClearInProgress()
    } else if (isInProgress) {
      // in_progress → completed
      if (onClearInProgress) onClearInProgress()
      onComplete()
    } else {
      // pending → ?
      if (onSetInProgress) {
        onSetInProgress()
      } else {
        onComplete()
      }
    }
  }

  const statusButton = () => {
    if (isCompleted) {
      return (
        <button
          onClick={handleToggle}
          className={`flex-shrink-0 mt-0.5 transition-transform ${animating ? 'animate-check' : ''}`}
          aria-label={t('taskcard_markIncomplete')}
        >
          <CheckCircle2 size={18} className="text-primary" />
        </button>
      )
    }
    if (isInProgress) {
      return (
        <button
          onClick={handleToggle}
          className={`flex-shrink-0 mt-0.5 transition-transform ${animating ? 'animate-check' : ''}`}
          aria-label={t('taskcard_markComplete')}
        >
          <Timer size={18} className="text-amber" />
        </button>
      )
    }
    return (
      <button
        onClick={handleToggle}
        className={`flex-shrink-0 mt-0.5 transition-transform ${animating ? 'animate-check' : ''}`}
        aria-label={onSetInProgress ? t('status_startTask') : t('taskcard_markComplete')}
      >
        <Circle size={18} className="text-text-subtle hover:text-primary transition-colors" />
      </button>
    )
  }

  return (
    <div
      ref={highlighted ? highlightRef : undefined}
      className={`p-3 rounded-lg border transition-all duration-200 ${
        isCompleted
          ? 'bg-surface-2/50 border-border opacity-70'
          : 'bg-surface border-border hover:border-border-md hover:shadow-sm'
      } ${highlighted ? HIGHLIGHT_CLASS : ''}`}
    >
      <div className="flex items-start gap-3">
        {statusButton()}

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
            {isInProgress && !isCompleted && (
              <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-amber/10 text-amber flex-shrink-0">
                {t('status_inProgress')}
              </span>
            )}
            <DeadlineBadge task={task} />
          </div>

          {task.description && (
            <p className="text-xs text-text-muted mt-0.5 line-clamp-2">{task.description}</p>
          )}

          <div className="flex items-center justify-between mt-1.5">
            <div className="flex items-center gap-2 flex-wrap">
              {category && <Badge label={category.name} color={category.color} size="sm" />}
              {/* 0 means no estimate was given; showing "~0 min" would read
                  as a real one. */}
              {task.estimatedMinutes > 0 && (
                <span className="flex items-center gap-1 text-xs text-text-subtle">
                  <Clock size={11} />
                  ~{task.estimatedMinutes} {t('taskcard_min')}
                </span>
              )}
              {showEmployee && employeeName && (
                <span className="text-xs text-text-subtle">• {employeeName}</span>
              )}
            </div>

            {/* The way into this task's discussion, over in chat. */}
            <button
              onClick={openDiscussion}
              disabled={opening}
              title={t('taskcard_discuss')}
              className="flex items-center gap-1 text-xs text-text-subtle hover:text-text-main transition-colors disabled:opacity-50"
            >
              <MessageSquare size={13} />
              {messageCount > 0 && <span>{messageCount}</span>}
            </button>
          </div>
        </div>
      </div>

    </div>
  )
}
