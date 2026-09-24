import React from 'react'
import { Navigate, useLocation, useParams } from 'react-router-dom'
import { useProjectStore } from '../../store/projectStore'

/**
 * The content calendar used to live at /admin/content, outside any project.
 * It belongs to a project now, so an old link — or a window left open on the
 * old address — lands on the same page inside the project that has it.
 */
export function ContentRedirect() {
  const { initialized, projects } = useProjectStore()
  const params = useParams()
  const { search } = useLocation()

  if (!initialized) return null

  const project = projects.find((p) => p.hasContentCalendar && !p.isArchived)
  if (!project) return <Navigate to="/admin/projects" replace />

  const rest = params['*'] ? `/${params['*']}` : ''
  return <Navigate to={`/admin/projects/${project.id}/content${rest}${search}`} replace />
}
