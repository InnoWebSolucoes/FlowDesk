import React from 'react'
import { useOutletContext } from 'react-router-dom'
import { Project } from '../../../types'
import { NoteBoard } from '../../../components/notes/NoteBoard'

interface Ctx { project: Project }

/**
 * The managers' shared notes board. Owner null is what makes it shared; each
 * employee gets the same board under their own id.
 */
export function ProjectNotes() {
  const { project } = useOutletContext<Ctx>()

  return <NoteBoard project={project} ownerId={null} />
}
