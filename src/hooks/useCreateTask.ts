import { useTaskStore } from '../store/taskStore'
import { useEmployeeStore } from '../store/employeeStore'
import { useAuthStore } from '../store/authStore'
import { useT } from '../i18n/useT'

/**
 * Creating a task, wherever it is started from. A new task has no project of
 * its own: it takes its first assignee's, and refuses assignees from another
 * project. That rule lives here once so the task manager and an employee's
 * profile cannot disagree about it. Resolves false when it refused, and
 * throws when the save itself failed.
 */
export function useCreateTask() {
  const { addTask, scopedProjectId } = useTaskStore()
  // Unscoped: the person may be looked at from outside their own project.
  const { allEmployees: employees } = useEmployeeStore()
  const { currentUser } = useAuthStore()
  const { t } = useT()

  return async (data: any): Promise<boolean> => {
    if (!currentUser) return false
    // An employee belongs to exactly one project, so the assignees fix the task's project.
    const assignee = employees.find(e => e.id === data.assignedTo[0])
    const projectId = assignee?.projectId
    if (!projectId) {
      // Naming the person makes this actionable: the fix is to put them on
      // a project, and without the name there is no way to know who.
      alert(
        assignee
          ? `${assignee.name} is not assigned to a project yet, so this task has nowhere to live. Add them to a project first.`
          : t('task_errorNoProject')
      )
      return false
    }
    // Only the first assignee's project is used, so anyone from another
    // project would be attached to a task their project never shows.
    const strays = data.assignedTo
      .map((id: string) => employees.find(e => e.id === id))
      .filter((e: any) => e && e.projectId !== projectId)
    if (strays.length > 0) {
      alert(
        `${strays.map((e: any) => e.name).join(', ')} ${strays.length === 1 ? 'is' : 'are'} on a different project, and a task can only belong to one. Create a separate task for them.`
      )
      return false
    }

    await addTask({ ...data, projectId, createdBy: currentUser.id })

    // The list on screen is filtered to the project being viewed. A task
    // for someone on a different project saves fine and then vanishes,
    // which reads exactly like a failed save — so say where it went.
    if (scopedProjectId && projectId !== scopedProjectId) {
      alert(
        `Task saved. It belongs to ${assignee.name}'s project, not the one you are viewing, so it will not appear in this list.`
      )
    }
    return true
  }
}
