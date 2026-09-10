import React, { useState } from 'react'
import { Task } from '../../types'
import { useTaskStore } from '../../store/taskStore'
import { useEmployeeStore } from '../../store/employeeStore'
import { TaskForm } from '../../pages/admin/TaskManager'
import { useT } from '../../i18n/useT'

/**
 * Editing one task from wherever it happens to be on screen.
 *
 * The form itself is the task manager's, not a copy of it: a manager editing
 * from somebody's day should get the fields they already know — title,
 * description, category, priority, estimate, who it is for, how often, which
 * day — rather than a cut-down editor that quietly drifts from the real one.
 * This only supplies the shell, the save and the delete.
 *
 * Creating is deliberately not here. A new task needs a project, which comes
 * from its assignees, and that resolution lives in the task manager where the
 * "All tasks" section already offers it.
 */
export function TaskEditDialog({ task, onClose }: { task: Task; onClose: () => void }) {
  const { t } = useT()
  const { categories, updateTask, deleteTask, addCategory } = useTaskStore()
  const { employees } = useEmployeeStore()
  const staff = employees.filter((e) => e.role === 'employee')

  const [confirmDelete, setConfirmDelete] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const save = async (data: Partial<Task>) => {
    setBusy(true)
    setError('')
    try {
      await updateTask(task.id, data)
      onClose()
    } catch (e) {
      // The store throws with the reason; swallowing it closed the dialog on a
      // failed save and looked exactly like a successful one.
      setError((e as Error).message || t('task_couldNotSave'))
    } finally {
      setBusy(false)
    }
  }

  const remove = async () => {
    setBusy(true)
    setError('')
    try {
      await deleteTask(task.id)
      onClose()
    } catch (e) {
      setError((e as Error).message || t('task_couldNotDelete'))
    } finally {
      setBusy(false)
    }
  }

  const recurring = task.frequency?.type && task.frequency.type !== 'one-off'

  return (
    <div
      className="fixed inset-0 bg-black/40 z-50 flex items-start justify-center p-4 overflow-y-auto"
      onClick={onClose}
    >
      <div className="w-full max-w-lg my-8" onClick={(e) => e.stopPropagation()}>
        {/* Deleting is a bin beside Cancel inside the form, not a panel under
            it. It was below, which meant scrolling past the whole editor to
            reach it — a long way to go for the one control you already knew
            you wanted. */}
        <TaskForm
          initial={task}
          onSave={save}
          onCancel={onClose}
          categories={categories}
          employees={staff}
          onAddCategory={addCategory}
          onDelete={() => setConfirmDelete(true)}
        />

        {/* What deleting actually costs, which differs. A one-off is one
            piece of work. A recurring task is every occurrence it has ever
            produced and every one it would have produced — so that is said
            plainly rather than left for the manager to discover. */}
        {confirmDelete && (
          <div className="bg-surface rounded-xl border border-danger/40 mt-3 p-4">
            <p className="text-sm text-text-main font-medium mb-1">
              {recurring ? t('task_deleteRecurringTitle') : t('task_deleteOneOffTitle')}
            </p>
            <p className="text-xs text-text-muted mb-3">
              {recurring ? t('task_deleteRecurringBody') : t('task_deleteOneOffBody')}
            </p>

            {error && (
              <p className="text-sm text-danger bg-danger-bg border border-danger/30 rounded-lg px-3 py-2 mb-3">
                {error}
              </p>
            )}

            <div className="flex items-center gap-2 flex-wrap">
              <button
                disabled={busy}
                onClick={remove}
                className="bg-danger text-white text-sm font-medium px-4 py-2 rounded-lg hover:opacity-90 disabled:opacity-50 transition-opacity"
              >
                {busy
                  ? t('ui_deleting')
                  : recurring ? t('task_deleteRecurringConfirm') : t('ui_delete')}
              </button>
              <button
                onClick={() => setConfirmDelete(false)}
                className="border border-border text-text-muted text-sm px-4 py-2 rounded-lg hover:bg-surface-2 transition-colors"
              >
                {t('ui_cancel')}
              </button>
            </div>
          </div>
        )}

        {error && !confirmDelete && (
          <p className="text-sm text-danger bg-danger-bg border border-danger/30 rounded-lg px-3 py-2 mt-3">
            {error}
          </p>
        )}
      </div>
    </div>
  )
}
