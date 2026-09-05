import React from 'react'
import { useOutletContext } from 'react-router-dom'
import { Project } from '../../../types'
import { TodoBoard } from '../../../components/todos/TodoBoard'

interface Ctx { project: Project }

/**
 * The managers' shared to-do board. Owner null is what makes it shared: every
 * admin on the project sees the same tabs. The employees' boards are the same
 * component with their own id.
 */
export function ProjectTodos() {
  const { project } = useOutletContext<Ctx>()

  return (
    <TodoBoard
      project={project}
      ownerId={null}
      basePath={`/admin/projects/${project.id}`}
      emptyDescription="These todos are for you and the other managers, employees never see them."
    />
  )
}
