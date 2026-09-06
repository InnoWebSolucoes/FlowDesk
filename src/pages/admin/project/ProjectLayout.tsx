import React, { useEffect } from 'react'
import { Outlet, useParams, useMatch, Navigate } from 'react-router-dom'
import { Building2 } from 'lucide-react'
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
      {/* Project header. The way back to the picker lives in the sidebar.
          Hidden for chat, which owns the full height of the frame. */}
      {!isChat && (
      <div className="mb-5">
        <div className="flex items-center gap-3">
          <div
            className="w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0"
            style={{ backgroundColor: `${project.color}1f`, color: project.color }}
          >
            <Building2 size={21} />
          </div>
          <div className="min-w-0">
            <h1 className="text-text-main font-semibold text-xl truncate">{project.name}</h1>
            {project.companyName && project.companyName !== project.name && (
              <p className="text-text-subtle text-sm truncate">{project.companyName}</p>
            )}
          </div>
        </div>
      </div>
      )}

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
