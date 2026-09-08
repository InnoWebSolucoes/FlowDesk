import React, { useEffect } from 'react'
import { Outlet, useParams, useMatch, Navigate } from 'react-router-dom'
import { useProjectStore } from '../../../store/projectStore'
import { useEmployeeStore } from '../../../store/employeeStore'
import { useTaskStore } from '../../../store/taskStore'
import { AssistantLauncher } from '../../../components/shared/Assistant'
import { useT } from '../../../i18n/useT'

export function ProjectLayout() {
  const { t } = useT()
  const { projectId } = useParams<{ projectId: string }>()
  const { initialized, getProject } = useProjectStore()
  const setEmployeeScope = useEmployeeStore((s) => s.setProjectScope)
  const setTaskScope = useTaskStore((s) => s.setProjectScope)

  const project = projectId ? getProject(projectId) : undefined

  // Chat fills its own frame: a header above it and a floating hint over its
  // message box both belong to pages that scroll, which chat does not.
  const isChat = !!useMatch('/admin/projects/:projectId/chat')

  // Narrow the employee and task stores to this project, so the pages nested
  // below (Overview, Tasks, Analytics…) show only its data without each having
  // to filter. Cleared on the way out.
  useEffect(() => {
    setEmployeeScope(projectId ?? null)
    setTaskScope(projectId ?? null)
    return () => {
      setEmployeeScope(null)
      setTaskScope(null)
    }
  }, [projectId, setEmployeeScope, setTaskScope])

  // On a reload the store starts empty, so wait for the first fetch to settle
  // before deciding the project doesn't exist — otherwise a deep link to a
  // project bounces to the index before its data ever arrives.
  if (!initialized) {
    return <div className="text-text-muted text-sm py-8">{t('proj_loadingProject')}</div>
  }
  if (!project) return <Navigate to="/admin/projects" replace />

  return (
    // Full height when chat is the tab: chat fills the frame it is given, and
    // a wrapper that is only as tall as its content gives it nothing to fill.
    <div className={`animate-fade-in ${isChat ? 'h-full flex flex-col min-h-0' : ''}`}>
      {/* No project header here any more: the name is in the top bar, beside
          Flowdesk. A banner on every page cost a block of vertical space to
          repeat something the chrome already says. */}

      {/* Wrapped so the routed page can be told to grow: Outlet renders its
          child directly and takes no class of its own. */}
      {isChat ? (
        <div className="flex-1 min-h-0">
          <Outlet context={{ project }} />
        </div>
      ) : (
        <Outlet context={{ project }} />
      )}

      {/* Available from every tab inside the project. Its hint would sit on
          top of chat's message box, so chat keeps the shortcut and loses the
          reminder. */}
      {!isChat && <AssistantLauncher projectId={project.id} />}
    </div>
  )
}
