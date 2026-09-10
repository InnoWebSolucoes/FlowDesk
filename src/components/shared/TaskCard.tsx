import React, { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Clock, CheckCircle2, Circle, Timer, MessageSquare, Paperclip, Pencil, Trash2 } from 'lucide-react'
import { Task, Category } from '../../types'
import { Badge } from './Badge'
import { useChatStore } from '../../store/chatStore'
import { useTaskStore } from '../../store/taskStore'
import { useAuthStore } from '../../store/authStore'
import { useT } from '../../i18n/useT'
import { differenceInDays, parseISO } from 'date-fns'
import { HIGHLIGHT_CLASS } from '../../lib/highlight'
import { TaskFiles } from './TaskFiles'

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
   * Manager actions. Present only where somebody may actually change the
   * task — the employee's own list gets neither, and RLS would refuse them
   * anyway, so offering a pencil there would be a button that fails.
   */
  onEdit?: () => void
  onDelete?: () => void
  /**
   * Show when this was finished and how long it has been under way.
   *
   * A manager's question, not the worker's: somebody doing the task already
   * knows when they started it, and a running clock on your own list reads as
   * being timed. Only the manager's view of an employee sets it — including
   * not while previewing their side, where the point is to see exactly what
   * they see.
   */
  showTiming?: boolean
  /**
   * Rings the card and scrolls it into view. Set when a notification pointed
   * at this task, so the reader is not left hunting a long list for it.
   */
  highlighted?: boolean
  highlightRef?: (node: HTMLElement | null) => void
}

/** "2h 14m", "45m", "3d 2h" — how long something has been going. */
function elapsed(fromIso: string, nowMs: number): string {
  const mins = Math.max(0, Math.floor((nowMs - new Date(fromIso).getTime()) / 60_000))
  if (mins < 60) return `${mins}m`
  const hours = Math.floor(mins / 60)
  if (hours < 24) {
    const rest = mins % 60
    return rest === 0 ? `${hours}h` : `${hours}h ${rest}m`
  }
  const days = Math.floor(hours / 24)
  const restH = hours % 24
  return restH === 0 ? `${days}d` : `${days}d ${restH}h`
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
  onEdit,
  onDelete,
  showTiming,
  highlighted,
  highlightRef,
}: TaskCardProps) {
  const { completionLogs, inProgressSince } = useTaskStore()

  // Re-read the clock once a minute, and only while something is actually
  // under way: without it "working for 5m" would sit there saying 5m for the
  // rest of the afternoon.
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!isInProgress || isCompleted) return
    const id = setInterval(() => setNow(Date.now()), 60_000)
    return () => clearInterval(id)
  }, [isInProgress, isCompleted])

  const completedAt = currentUserId && dueDate
    ? completionLogs.find(
        (l) => l.taskId === task.id && l.employeeId === currentUserId && l.dueDate === dueDate,
      )?.completedAt ?? null
    : null
  const startedAt = currentUserId && dueDate
    ? inProgressSince(task.id, currentUserId, dueDate)
    : null

  const [animating, setAnimating] = useState(false)
  const [opening, setOpening] = useState(false)
  const [showFiles, setShowFiles] = useState(false)
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
      // Inside the project the task belongs to, so opening its discussion
      // does not drop the manager out of the project they were working in.
      const base =
        currentUser?.role === 'admin'
          ? `/admin/projects/${task.projectId}/chat`
          : '/employee/chat'
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

          {/* When it was finished, or how long it has been under way. The
              badge said *that* it was started and never for how long, which is
              the half that tells you whether it is actually moving. */}
          {showTiming && isCompleted && completedAt && (
            <p className="text-xs text-success mt-1 flex items-center gap-1">
              <CheckCircle2 size={11} />
              {t('taskcard_completedAt')} {new Date(completedAt).toLocaleString([], {
                day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
              })}
            </p>
          )}
          {showTiming && !isCompleted && isInProgress && startedAt && (
            <p className="text-xs text-amber mt-1 flex items-center gap-1">
              <Timer size={11} />
              {t('taskcard_workingFor')} {elapsed(startedAt, now)} · {t('taskcard_since')}{' '}
              {new Date(startedAt).toLocaleString([], {
                day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
              })}
            </p>
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

            {/* One group, pinned right. These used to be four direct children
                of a justify-between row, so the browser spread them evenly
                across the whole card and the pencil ended up nowhere near the
                paperclip it belongs beside. */}
            <div className="flex items-center gap-2.5 flex-shrink-0">
            {/* What the work produced, kept against the task. */}
            <button
              onClick={() => setShowFiles(true)}
              title={t('taskfiles_title')}
              className="flex items-center gap-1 text-xs text-text-subtle hover:text-text-main transition-colors"
            >
              <Paperclip size={13} />
            </button>

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

            {/* Changing the task itself, for whoever may. Beside the other
                two rather than hidden behind a hover: on a touch screen
                there is no hover, and a manager going through somebody's
                week is exactly who needs these. */}
            {onEdit && (
              <button
                onClick={onEdit}
                title={t('taskcard_edit')}
                className="flex items-center gap-1 text-xs text-text-subtle hover:text-primary transition-colors"
              >
                <Pencil size={13} />
              </button>
            )}
            {onDelete && (
              <button
                onClick={onDelete}
                title={t('taskcard_delete')}
                className="flex items-center gap-1 text-xs text-text-subtle hover:text-danger transition-colors"
              >
                <Trash2 size={13} />
              </button>
            )}
            </div>
          </div>
        </div>
      </div>

      {showFiles && (
        <TaskFiles taskId={task.id} dueDate={dueDate ?? null} onClose={() => setShowFiles(false)} />
      )}
    </div>
  )
}
