import React, { useState } from 'react'
import { Task } from '../../types'
import { useTaskStore } from '../../store/taskStore'
import { useEmployeeStore } from '../../store/employeeStore'
import { TaskForm } from '../../pages/admin/TaskManager'
import { useCreateTask } from '../../hooks/useCreateTask'
import { useT } from '../../i18n/useT'
import { DeleteTaskDialog } from './DeleteTaskDialog'

/**
 * Editing one task from wherever it happens to be on screen.
 *
 * The form itself is the task manager's, not a copy of it: a manager editing
 * from somebody's day should get the fields they already know — title,
 * description, category, urgent, estimate, who it is for, how often, which
 * day — rather than a cut-down editor that quietly drifts from the real one.
 * This only supplies the shell, the save and the delete.
 *
 * Creating is NewTaskDialog, below.
 */
export function TaskEditDialog({
  task,
  onClose,
}: {
  task: Task
  onClose: () => void
}) {
  const { t } = useT()
  const { categories, updateTask, deleteTask, addCategory } = useTaskStore()
  const { employees } = useEmployeeStore()
  const staff = employees.filter((e) => e.role === 'employee')

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

  // Deleting a one-off is one click, no confirmation: the bin is beside Cancel
  // and a step in between was one more thing to click through every time. A
  // repeating task is the exception — that click used to take every day it had
  // ever produced, so it asks which is meant.
  const [confirming, setConfirming] = useState(false)

  const remove = async () => {
    if (task.frequency.type !== 'one-off') {
      setConfirming(true)
      return
    }
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
          onDelete={busy ? undefined : remove}
        />

        {error && (
          <p className="text-sm text-danger bg-danger-bg border border-danger/30 rounded-lg px-3 py-2 mt-3">
            {error}
          </p>
        )}
      </div>

      {/* A repeating task's bin asks which is meant rather than taking every
          day it has ever produced. */}
      {confirming && (
        <DeleteTaskDialog
          task={task}
          onClose={() => {
            setConfirming(false)
            // Gone or kept, the editor is done either way.
            onClose()
          }}
        />
      )}
    </div>
  )
}

/**
 * A new task, started from somebody's day, week or month rather than from the
 * task manager. Same form, starting assigned to that person; the project is
 * worked out from the assignees by useCreateTask, as it is in the manager.
 */
export function NewTaskDialog({
  employeeId,
  date,
  onClose,
}: {
  employeeId: string
  /** The day it was started from, when it came from a calendar. */
  date?: string
  onClose: () => void
}) {
  const { t } = useT()
  const { categories, addCategory } = useTaskStore()
  const { employees } = useEmployeeStore()
  const staff = employees.filter((e) => e.role === 'employee')
  const createTask = useCreateTask()
  const [error, setError] = useState('')

  const save = async (data: Partial<Task>) => {
    setError('')
    try {
      if (await createTask(data)) onClose()
    } catch (e) {
      setError((e as Error).message || t('task_couldNotSave'))
    }
  }

  return (
    <div
      className="fixed inset-0 bg-black/40 z-50 flex items-start justify-center p-4 overflow-y-auto"
      onClick={onClose}
    >
      <div className="w-full max-w-lg my-8" onClick={(e) => e.stopPropagation()}>
        <TaskForm
          onSave={save}
          onCancel={onClose}
          categories={categories}
          employees={staff}
          defaultAssignee={employeeId}
          defaultDate={date}
          onAddCategory={addCategory}
        />
        {error && (
          <p className="text-sm text-danger bg-danger-bg border border-danger/30 rounded-lg px-3 py-2 mt-3">
            {error}
          </p>
        )}
      </div>
    </div>
  )
}
