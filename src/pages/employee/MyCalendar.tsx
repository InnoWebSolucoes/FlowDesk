import React from 'react'
import { useOutletContext } from 'react-router-dom'
import { Project } from '../../types'
import { useAuthStore } from '../../store/authStore'
import { CalendarBoard } from '../../components/calendar/CalendarBoard'

interface Ctx { project: Project }

/**
 * The employee's planning calendar: their own todos on the days they mean to
 * do them, plus their working hours, busy blocks and time off. The same tool
 * the managers have, on their own board.
 */
export function MyCalendar() {
  const { project } = useOutletContext<Ctx>()
  const currentUser = useAuthStore((s) => s.currentUser)

  if (!currentUser) return null

  return (
    <CalendarBoard
      project={project}
      ownerId={currentUser.id}
      basePath="/employee"
    />
  )
}
