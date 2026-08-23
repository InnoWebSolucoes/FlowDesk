import React from 'react'
import { NavLink, Outlet, useParams, Navigate, Link } from 'react-router-dom'
import { Building2, Info, FolderOpen, Users, ListTodo, ChevronLeft } from 'lucide-react'
import { useProjectStore } from '../../../store/projectStore'

const TABS = [
  { to: 'about', label: 'About', icon: Info },
  { to: 'resources', label: 'Resources', icon: FolderOpen },
  { to: 'employees', label: 'Employees', icon: Users },
  { to: 'todos', label: 'Todos', icon: ListTodo },
]

export function ProjectLayout() {
  const { projectId } = useParams<{ projectId: string }>()
  const { projects, loading, getProject } = useProjectStore()

  const project = projectId ? getProject(projectId) : undefined

  // Wait for the store before deciding the project doesn't exist.
  if (loading && projects.length === 0) {
    return <div className="text-text-muted text-sm py-8">Loading project…</div>
  }
  if (!project) return <Navigate to="/admin/projects" replace />

  return (
    <div className="animate-fade-in">
      {/* Project header */}
      <div className="mb-5">
        <Link
          to="/admin/projects"
          className="inline-flex items-center gap-1 text-xs text-text-subtle hover:text-text-main mb-3 transition-colors"
        >
          <ChevronLeft size={13} /> All projects
        </Link>

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

      {/* Tabs */}
      <nav className="flex items-center gap-1 border-b border-border mb-5 overflow-x-auto">
        {TABS.map(({ to, label, icon: Icon }) => (
          <NavLink
            key={to}
            to={to}
            className={({ isActive }) =>
              `flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium border-b-2 -mb-px whitespace-nowrap transition-colors ${
                isActive
                  ? 'border-primary text-primary'
                  : 'border-transparent text-text-muted hover:text-text-main'
              }`
            }
          >
            <Icon size={15} />
            {label}
          </NavLink>
        ))}
      </nav>

      <Outlet context={{ project }} />
    </div>
  )
}
