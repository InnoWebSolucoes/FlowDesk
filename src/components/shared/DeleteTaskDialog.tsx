import { useState } from 'react'
import { Loader2 } from 'lucide-react'
import { format } from 'date-fns'
import { Task } from '../../types'
import { useTaskStore } from '../../store/taskStore'
import { useEmployeeStore } from '../../store/employeeStore'
import { useT } from '../../i18n/useT'

/**
 * Deleting an assigned task, where "delete" has two meanings.
 *
 * A repeating task is not one thing on one day: it is every day its rule
 * produces, past and future. Deleting it used to take all of them, from a
 * single click, without ever saying so — a task somebody wanted gone from one
 * day disappeared from every day instead, and there was no way back.
 *
 * So the two meanings are two buttons now, and which appear depends on what is
 * actually being deleted:
 *
 *   a one-off  — one day is all it has, so there is nothing to choose between.
 *   repeating  — the one day, and the whole series, each named as such.
 *
 * One day is recorded as a skip rather than a deletion, so the schedule goes
 * on producing every other day exactly as it did.
 */
export function DeleteTaskDialog({
  task,
  /**
   * The day being deleted, when the caller knows which one is meant — the
   * calendar does, a list of tasks does not. Without it, the day on offer is
   * today, which is the day a task list reports the status of.
   */
  occurrence,
  onClose,
}: {
  task: Task
  occurrence?: { employeeId: string; date: string }
  onClose: () => void
}) {
  const { t } = useT()
  const { deleteTask, deleteTaskOccurrence } = useTaskStore()
  const { employees } = useEmployeeStore()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const repeats = task.frequency.type !== 'one-off'
  const day = occurrence?.date ?? format(new Date(), 'yyyy-MM-dd')
  // Whose day is being removed. A task nobody is assigned to has no occurrence
  // to skip, so the whole task is the only thing that can go.
  const people = occurrence ? [occurrence.employeeId] : task.assignedTo
  const canSkipDay = repeats && people.length > 0

  // Named when it is one person's day, so it is clear whose day is going.
  const whose =
    people.length === 1
      ? employees.find((e) => e.id === people[0])?.name ?? t('task_deleteWhichThisPerson')
      : t('task_deleteWhichThisPerson')

  const run = async (fn: () => Promise<void>) => {
    setBusy(true)
    setError('')
    try {
      await fn()
      onClose()
    } catch (e) {
      setError((e as Error).message || t('task_couldNotDelete'))
    } finally {
      setBusy(false)
    }
  }

  const deleteDay = () =>
    run(async () => {
      // Everyone the task is on for that day, so the day leaves the task
      // rather than one person's copy of it.
      for (const empId of people) {
        await deleteTaskOccurrence(task.id, empId, day)
      }
    })

  return (
    <div
      className="fixed inset-0 bg-black/40 z-[70] flex items-center justify-center p-4"
      onClick={busy ? undefined : onClose}
    >
      <div
        className="bg-surface rounded-xl border border-border w-full max-w-sm p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-text-main font-semibold text-base mb-1">
          {canSkipDay ? t('task_deleteWhichTitle') : t('task_deleteOneOffTitle')}
        </h3>
        <p className="text-text-subtle text-xs mb-2 truncate">{task.title}</p>
        <p className="text-text-muted text-sm mb-4">
          {canSkipDay
            ? t('task_deleteWhichBody').replace('{name}', whose)
            : t('task_deleteOneOffBody')}
        </p>

        {error && <p className="text-danger text-xs mb-3">{error}</p>}

        <div className="flex flex-col gap-2">
          {canSkipDay && (
            <button
              disabled={busy}
              onClick={deleteDay}
              className="w-full flex items-center justify-center gap-2 bg-danger text-white text-sm font-medium py-2 rounded-lg hover:opacity-90 transition-opacity disabled:opacity-60"
            >
              {busy && <Loader2 size={14} className="animate-spin" />}
              {t('task_deleteOnlyThis').replace(
                '{date}',
                format(new Date(`${day}T00:00:00`), 'd MMM')
              )}
            </button>
          )}
          <button
            disabled={busy}
            onClick={() => run(() => deleteTask(task.id))}
            className={`w-full flex items-center justify-center gap-2 text-sm font-medium py-2 rounded-lg transition-colors disabled:opacity-60 ${
              canSkipDay
                // The wider of the two, so it is the outlined one: the choice
                // that takes less should be the one that is easy to hit.
                ? 'border border-danger/40 text-danger hover:bg-danger-bg'
                : 'bg-danger text-white hover:opacity-90'
            }`}
          >
            {busy && !canSkipDay && <Loader2 size={14} className="animate-spin" />}
            {canSkipDay ? t('task_deleteEveryRepeat') : t('ui_delete')}
          </button>
          <button
            disabled={busy}
            onClick={onClose}
            className="w-full py-2 rounded-lg border border-border text-sm text-text-muted hover:text-text-main disabled:opacity-60"
          >
            {t('ui_cancel')}
          </button>
        </div>
      </div>
    </div>
  )
}
