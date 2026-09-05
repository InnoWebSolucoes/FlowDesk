import React from 'react'
import { useOutletContext } from 'react-router-dom'
import { Project } from '../../../types'
import { CalendarBoard } from '../../../components/calendar/CalendarBoard'

/**
 * The managers' planning calendar: the shared todo board's do dates, alongside
 * everyone's busy blocks. Employees get the same component on their own board.
 */
export function ProjectCalendar() {
  const { project } = useOutletContext<{ project: Project }>()

  return (
    <CalendarBoard
      project={project}
      ownerId={null}
      basePath={`/admin/projects/${project.id}`}
    />
  )
}
