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

  return (
    <div
      className="fixed inset-0 bg-black/40 z-50 flex items-start justify-center p-4 overflow-y-auto"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg my-8"
        onClick={(e) => e.stopPropagation()}
      >
        <TaskForm
          initial={task}
          onSave={save}
          onCancel={onClose}
          categories={categories}
          employees={staff}
          onAddCategory={addCategory}
        />

        <div className="bg-surface rounded-xl border border-border mt-3 p-4">
          {error && (
            <p className="text-sm text-danger bg-danger-bg border border-danger/30 rounded-lg px-3 py-2 mb-3">
              {error}
            </p>
          )}

          {/* Deleting sits below the form rather than inside it, behind its own
              confirmation: it is the one action here that cannot be undone, and
              a manager going quickly through a week should not lose a task to a
              mis-aimed click. */}
          {confirmDelete ? (
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-sm text-text-main flex-1 min-w-[12rem]">
                {t('task_deleteConfirm')}
              </span>
              <button
                disabled={busy}
                onClick={remove}
                className="bg-danger text-white text-sm font-medium px-4 py-2 rounded-lg hover:opacity-90 disabled:opacity-50 transition-opacity"
              >
                {busy ? t('ui_deleting') : t('ui_delete')}
              </button>
              <button
                onClick={() => setConfirmDelete(false)}
                className="border border-border text-text-muted text-sm px-4 py-2 rounded-lg hover:bg-surface-2 transition-colors"
              >
                {t('ui_cancel')}
              </button>
            </div>
          ) : (
            <button
              onClick={() => setConfirmDelete(true)}
              className="text-sm text-danger hover:underline"
            >
              {t('taskcard_delete')}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
