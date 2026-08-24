import React, { useEffect } from 'react'
import { Outlet, useParams, Navigate } from 'react-router-dom'
import { Building2 } from 'lucide-react'
import { useProjectStore } from '../../../store/projectStore'
import { useEmployeeStore } from '../../../store/employeeStore'
import { useTaskStore } from '../../../store/taskStore'
import { AssistantLauncher } from '../../../components/shared/Assistant'

export function ProjectLayout() {
  const { projectId } = useParams<{ projectId: string }>()
  const { initialized, getProject } = useProjectStore()
  const setEmployeeScope = useEmployeeStore((s) => s.setProjectScope)
  const setTaskScope = useTaskStore((s) => s.setProjectScope)

  const project = projectId ? getProject(projectId) : undefined

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
    return <div className="text-text-muted text-sm py-8">Loading project…</div>
  }
  if (!project) return <Navigate to="/admin/projects" replace />

  return (
    <div className="animate-fade-in">
      {/* Project header. The way back to the picker lives in the sidebar. */}
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

      <Outlet context={{ project }} />

      {/* Available from every tab inside the project. */}
      <AssistantLauncher projectId={project.id} />
    </div>
  )
}
