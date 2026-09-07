import React from 'react'
import { useOutletContext } from 'react-router-dom'
import { Project } from '../../../types'
import { WorkLog } from '../../../components/worklog/WorkLog'

interface Ctx { project: Project }

/** Everything the team wrote up, for whoever is reading the project. */
export function ProjectWorkLog() {
  const ctx = useOutletContext<Ctx | null>()
  if (!ctx?.project) return null
  return <WorkLog project={ctx.project} />
}
