import React, { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Clock, CheckCircle2, Circle, Timer, MessageSquare, Paperclip, Trash2, Ban } from 'lucide-react'
import { Task, Category } from '../../types'
import { Badge } from './Badge'
import { useChatStore } from '../../store/chatStore'
import { useTaskStore } from '../../store/taskStore'
import { useAuthStore } from '../../store/authStore'
import { useT } from '../../i18n/useT'
import { UrgentBadge } from './Urgent'
import { URGENT_CLASS } from '../../lib/urgent'
import { format } from 'date-fns'
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
   * anyway. Editing is a click on the card itself, not a button.
   */
  onEdit?: () => void
  onDelete?: () => void
  /** Carried forward from an earlier day it was not done on. */
  carried?: boolean
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
   * When this occurrence was finished, if the caller already knows. My Tasks
   * does, from the occurrence it placed; looking it up here by date misses a
   * one-off whose tick was logged under a different day.
   */
  completedAtOverride?: string | null
  /** Marked as missed: it stopped on its day and will not move on. */
  isMissed?: boolean
  /** Offered where the person may mark it; absent on a read-only view. */
  onMarkMissed?: () => void
  onClearMissed?: () => void
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

/**
 * Says the work is late: it was for an earlier day and has been carried
 * forward. Nothing is said about work that is simply due today — that is
 * what being on today's list means.
 */
function LateBadge({ carried }: { carried?: boolean }) {
  const { t } = useT()
  if (!carried) return null
  return (
    <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-danger/10 text-danger flex-shrink-0">
      {t('deadline_overdue')}
    </span>
  )
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
  carried,
  showTiming,
  completedAtOverride,
  isMissed,
  onMarkMissed,
  onClearMissed,
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

  const completedAt = completedAtOverride !== undefined
    ? completedAtOverride
    : currentUserId && dueDate
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
  const { t, dateLocale } = useT()
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
          onClick={(e) => { e.stopPropagation(); handleToggle() }}
          className={`flex-shrink-0 mt-0.5 transition-transform ${animating ? 'animate-check' : ''}`}
          aria-label={t('taskcard_markIncomplete')}
        >
          <CheckCircle2 size={18} className="text-primary" />
        </button>
      )
    }
    if (isMissed) {
      return (
        <button
          onClick={(e) => { e.stopPropagation(); onClearMissed?.() }}
          disabled={!onClearMissed}
          className="flex-shrink-0 mt-0.5 disabled:cursor-default"
          aria-label={t('taskcard_undoMissed')}
          title={onClearMissed ? t('taskcard_undoMissed') : t('taskcard_missed')}
        >
          <Ban size={18} className="text-danger" />
        </button>
      )
    }
    if (isInProgress) {
      return (
        <button
          onClick={(e) => { e.stopPropagation(); handleToggle() }}
          className={`flex-shrink-0 mt-0.5 transition-transform ${animating ? 'animate-check' : ''}`}
          aria-label={t('taskcard_markComplete')}
        >
          <Timer size={18} className="text-amber" />
        </button>
      )
    }
    return (
      <button
        onClick={(e) => { e.stopPropagation(); handleToggle() }}
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
      onClick={onEdit}
      role={onEdit ? 'button' : undefined}
      title={onEdit ? t('taskcard_edit') : undefined}
      className={`p-3 rounded-lg border transition-all duration-200 ${onEdit ? 'cursor-pointer' : ''} ${
        isCompleted
          ? 'bg-surface-2/50 border-border opacity-70'
          : task.isUrgent
            ? `${URGENT_CLASS} border-l-4 border-l-danger hover:shadow-sm`
            : 'bg-surface border-border hover:border-border-md hover:shadow-sm'
      } ${highlighted ? HIGHLIGHT_CLASS : ''}`}
    >
      <div className="flex items-start gap-3">
        {statusButton()}

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span
              className={`text-sm font-medium ${isCompleted ? 'line-through text-text-muted' : isMissed ? 'text-text-muted' : 'text-text-main'}`}
            >
              {task.title}
            </span>
            <UrgentBadge urgent={task.isUrgent && !isCompleted} />
            {isInProgress && !isCompleted && (
              <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-amber/10 text-amber flex-shrink-0">
                {t('status_inProgress')}
              </span>
            )}
            {isMissed ? (
              <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-danger/10 text-danger flex-shrink-0">
                {t('taskcard_missed')}
              </span>
            ) : (
              <LateBadge carried={carried} />
            )}
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
              {t('taskcard_completedAt')} {format(new Date(completedAt), 'd MMM, HH:mm', dateLocale)}
            </p>
          )}
          {showTiming && !isCompleted && isInProgress && startedAt && (
            <p className="text-xs text-amber mt-1 flex items-center gap-1">
              <Timer size={11} />
              {t('taskcard_workingFor')} {elapsed(startedAt, now)} · {t('taskcard_since')}{' '}
              {format(new Date(startedAt), 'd MMM, HH:mm', dateLocale)}
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
              onClick={(e) => { e.stopPropagation(); setShowFiles(true) }}
              title={t('taskfiles_title')}
              className="flex items-center gap-1 text-xs text-text-subtle hover:text-text-main transition-colors"
            >
              <Paperclip size={13} />
            </button>

            {/* The way into this task's discussion, over in chat. */}
            <button
              onClick={(e) => { e.stopPropagation(); openDiscussion() }}
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
            {/* Missed stops it moving on to tomorrow. Only while it is still open:
                a finished task was not missed, and one already marked shows
                its own undo on the status icon. */}
            {onMarkMissed && !isCompleted && !isMissed && (
              <button
                onClick={(e) => { e.stopPropagation(); onMarkMissed?.() }}
                title={t('taskcard_markMissedHint')}
                className="flex items-center gap-1 text-[11px] font-medium text-text-subtle hover:text-danger transition-colors"
              >
                <Ban size={13} />
                {t('taskcard_markMissed')}
              </button>
            )}

            {onDelete && (
              <button
                onClick={(e) => { e.stopPropagation(); onDelete?.() }}
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

      {/* Rendered inside the card, so its clicks would bubble up and open
          the editor behind it. */}
      {showFiles && (
        <div onClick={(e) => e.stopPropagation()}>
          <TaskFiles taskId={task.id} dueDate={dueDate ?? null} onClose={() => setShowFiles(false)} />
        </div>
      )}
    </div>
  )
}
