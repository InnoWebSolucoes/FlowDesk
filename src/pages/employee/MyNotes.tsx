import React from 'react'
import { useOutletContext } from 'react-router-dom'
import { Project } from '../../types'
import { useAuthStore } from '../../store/authStore'
import { NoteBoard } from '../../components/notes/NoteBoard'

interface Ctx { project: Project }

/** The employee's own notes board, the same one the managers have. */
export function MyNotes() {
  const { project } = useOutletContext<Ctx>()
  const currentUser = useAuthStore((s) => s.currentUser)

  if (!currentUser) return null

  return <NoteBoard project={project} ownerId={currentUser.id} />
}
