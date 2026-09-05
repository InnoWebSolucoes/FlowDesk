import React from 'react'
import { useOutletContext } from 'react-router-dom'
import { Project } from '../../types'
import { useAuthStore } from '../../store/authStore'
import { TodoBoard } from '../../components/todos/TodoBoard'

interface Ctx { project: Project }

/**
 * The employee's own to-do list: the same tabbed board the managers have, on
 * their own id rather than the shared one. They create, rename, duplicate and
 * delete their lists freely — it is theirs.
 */
export function MyTodos() {
  const { project } = useOutletContext<Ctx>()
  const currentUser = useAuthStore((s) => s.currentUser)

  if (!currentUser) return null

  return (
    <TodoBoard
      project={project}
      ownerId={currentUser.id}
      basePath="/employee"
      emptyDescription="This list is yours. Add what you need to get done, in as many lists as you like."
    />
  )
}
