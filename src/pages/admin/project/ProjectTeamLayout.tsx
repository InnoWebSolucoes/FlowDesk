import React from 'react'
import { NavLink, Outlet, useOutletContext, useMatch } from 'react-router-dom'
import { Users, LayoutDashboard, ListTodo, Sparkles, BarChart3, Shield } from 'lucide-react'
import { Project } from '../../../types'
import { useT } from '../../../i18n/useT'

interface Ctx { project: Project }

/**
 * The Employees section. Everything that used to live in the global sidebar —
 * overview, task management, the AI organiser and analytics — sits here as
 * sub-tabs, scoped by ProjectLayout to this project's people and tasks.
 */
export function ProjectTeamLayout() {
  const { project } = useOutletContext<Ctx>()
  const { t } = useT()

  // One person's profile is a page in its own right, not another tab in this
  // row — none of these tabs is the one you are on, so the row lights nothing
  // and costs a strip of height on a page that already runs off the bottom.
  // The profile opens with "back to employees", which is the way back to it.
  const onProfile = !!useMatch('/admin/projects/:projectId/employees/team/:id')

  const tabs = [
    { to: 'team', label: t('nav_employees'), icon: Users },
    { to: 'overview', label: t('nav_overview'), icon: LayoutDashboard },
    { to: 'tasks', label: t('nav_taskManager'), icon: ListTodo },
    { to: 'ai-organiser', label: t('nav_aiOrganiser'), icon: Sparkles },
    { to: 'analytics', label: t('nav_analytics'), icon: BarChart3 },
    // Last, because it is the one tab that is about permissions rather than
    // about the work.
    { to: 'admins', label: t('nav_admins'), icon: Shield },
  ]

  return (
    <div>
      <nav className={`items-center gap-1 mb-5 overflow-x-auto ${onProfile ? 'hidden' : 'flex'}`}>
        {tabs.map(({ to, label, icon: Icon }) => (
          <NavLink
            key={to}
            to={to}
            className={({ isActive }) =>
              `flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition-colors ${
                isActive
                  ? 'bg-primary text-white'
                  : 'text-text-muted hover:text-text-main hover:bg-surface-2'
              }`
            }
          >
            <Icon size={14} />
            {label}
          </NavLink>
        ))}
      </nav>

      <Outlet context={{ project }} />
    </div>
  )
}
