import React from 'react'
import { Outlet } from 'react-router-dom'
import { Building2 } from 'lucide-react'
import { useAuthStore } from '../../store/authStore'
import { useProjectStore } from '../../store/projectStore'
import { useT } from '../../i18n/useT'

/**
 * The employee's side of a project.
 *
 * An admin picks a project and works inside it; an employee belongs to exactly
 * one, so there is no picker — the project comes from their profile. Beyond
 * that this is the admin's ProjectLayout: the same header, and the project
 * handed to the tabs below through the outlet context, so the pages nested
 * here can be written against the same shape.
 */
export function EmployeeWorkspace() {
  const { t } = useT()
  const currentUser = useAuthStore((s) => s.currentUser)
  const { initialized, getProject } = useProjectStore()

  const project = currentUser?.projectId ? getProject(currentUser.projectId) : undefined

  // The store starts empty on a reload, so wait for the first fetch before
  // concluding there is no project — otherwise every tab flashes the empty
  // state on the way in.
  if (!initialized) {
    return <div className="text-text-muted text-sm py-8">{t('emp_loading')}</div>
  }

  // An employee with no project has nothing to show here. That is a setup
  // problem for their manager, not something they can fix, so say so plainly.
  if (!project) {
    return (
      <div className="max-w-md py-12 text-center mx-auto">
        <div className="w-12 h-12 rounded-xl bg-surface-2 flex items-center justify-center mx-auto mb-3">
          <Building2 size={22} className="text-text-subtle" />
        </div>
        <h2 className="text-text-main font-semibold mb-1">{t('emp_noProjectYet')}</h2>
        <p className="text-text-muted text-sm">
          You have not been added to a project. Ask your manager to assign you to one,
          and your lists, notes and files will appear here.
        </p>
      </div>
    )
  }

  return (
    <div className="animate-fade-in">
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
    </div>
  )
}
