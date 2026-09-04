import React, { useState } from 'react'
import { Link } from 'react-router-dom'
import { Building2, Plus, Users, ListTodo, FolderOpen, X, Pencil, Trash2 } from 'lucide-react'
import { useProjectStore } from '../../store/projectStore'
import { useEmployeeStore } from '../../store/employeeStore'
import { useTaskStore } from '../../store/taskStore'
import { EmptyState } from '../../components/shared/EmptyState'
import { Project } from '../../types'

const PROJECT_COLORS = ['#6366f1', '#8b5cf6', '#ec4899', '#f59e0b', '#10b981', '#06b6d4']

export function Projects() {
  const { projects, createProject, updateProject, deleteProject } = useProjectStore()
  const { employees } = useEmployeeStore()
  const { tasks } = useTaskStore()

  const [showForm, setShowForm] = useState(false)
  const [name, setName] = useState('')
  const [companyName, setCompanyName] = useState('')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  // Right-click menu on a project card, positioned in screen coordinates.
  const [menu, setMenu] = useState<{ projectId: string; x: number; y: number } | null>(null)
  const [editing, setEditing] = useState<Project | null>(null)

  const active = projects.filter((p) => !p.isArchived)

  const handleCreate = async () => {
    if (!name.trim()) {
      setError('Project name is required.')
      return
    }
    setSubmitting(true)
    try {
      await createProject({
        name: name.trim(),
        companyName: companyName.trim() || name.trim(),
        color: PROJECT_COLORS[projects.length % PROJECT_COLORS.length],
      })
      setName('')
      setCompanyName('')
      setShowForm(false)
    } catch (e) {
      const err = e as { message?: string; code?: string; hint?: string }
      setError(err.message ? `${err.message}${err.code ? ` (${err.code})` : ''}` : 'Could not create the project.')
    } finally {
      setSubmitting(false)
    }
  }

  const addButton = (
    <button
      onClick={() => { setName(''); setCompanyName(''); setError(''); setShowForm(true) }}
      className="flex items-center gap-1.5 bg-primary text-white text-sm font-medium px-4 py-2 rounded-lg hover:bg-primary-dark transition-colors"
    >
      <Plus size={15} /> New project
    </button>
  )

  return (
    <div className="animate-fade-in">
      {active.length > 0 && <div className="flex justify-end mb-5">{addButton}</div>}

      {active.length === 0 ? (
        <EmptyState
          icon={Building2}
          title="No projects yet"
          description="Each project is a company you manage, with its own about page, resources, employees and todo list."
          action={addButton}
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {active.map((project) => {
            const memberCount = employees.filter((e) => e.projectId === project.id).length
            const taskCount = tasks.filter((t) => t.projectId === project.id && t.isActive).length

            return (
              <Link
                key={project.id}
                to={`/admin/projects/${project.id}/about`}
                onContextMenu={(e) => {
                  e.preventDefault()
                  setMenu({ projectId: project.id, x: e.clientX, y: e.clientY })
                }}
                className="block bg-surface border border-border rounded-xl p-5 hover:shadow-md hover:border-primary/40 transition-all"
              >
                <div className="flex items-start gap-3 mb-3">
                  <div
                    className="w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0"
                    style={{ backgroundColor: `${project.color}1f`, color: project.color }}
                  >
                    <Building2 size={19} />
                  </div>
                  <div className="min-w-0">
                    <h3 className="text-text-main font-semibold text-base truncate">{project.name}</h3>
                    {project.companyName && project.companyName !== project.name && (
                      <p className="text-text-subtle text-xs truncate">{project.companyName}</p>
                    )}
                  </div>
                </div>

                {project.description && (
                  <p className="text-text-muted text-sm line-clamp-2 mb-4">{project.description}</p>
                )}

                <div className="flex items-center gap-4 text-xs text-text-subtle">
                  <span className="flex items-center gap-1.5"><Users size={13} /> {memberCount}</span>
                  <span className="flex items-center gap-1.5"><ListTodo size={13} /> {taskCount}</span>
                  <span className="flex items-center gap-1.5"><FolderOpen size={13} /> Resources</span>
                </div>
              </Link>
            )
          })}
        </div>
      )}

      {/* Right-click menu */}
      {menu && (() => {
        const target = projects.find((p) => p.id === menu.projectId)
        if (!target) return null
        return (
          <>
            <div
              className="fixed inset-0 z-40"
              onClick={() => setMenu(null)}
              onContextMenu={(e) => { e.preventDefault(); setMenu(null) }}
            />
            <div
              className="fixed z-50 w-44 py-1 bg-surface border border-border rounded-lg shadow-xl"
              style={{ left: menu.x, top: menu.y }}
            >
              <button
                onClick={() => { setEditing(target); setMenu(null) }}
                className="w-full flex items-center gap-2 text-left px-3 py-1.5 text-xs text-text-main hover:bg-surface-2 transition-colors"
              >
                <Pencil size={12} /> Edit
              </button>
              <div className="h-px bg-border my-1" />
              <button
                onClick={async () => {
                  setMenu(null)
                  const members = employees.filter((e) => e.projectId === target.id).length
                  const taskCount = tasks.filter((t) => t.projectId === target.id).length
                  const warning =
                    `Delete "${target.name}"?\n\n` +
                    `This permanently removes its resources and todos, and deletes ${taskCount} task(s).\n` +
                    `${members} employee(s) will be unassigned but their accounts will remain.\n\n` +
                    `This cannot be undone.`
                  if (confirm(warning)) await deleteProject(target.id)
                }}
                className="w-full flex items-center gap-2 text-left px-3 py-1.5 text-xs text-danger hover:bg-surface-2 transition-colors"
              >
                <Trash2 size={12} /> Delete
              </button>
            </div>
          </>
        )
      })()}

      {/* Quick edit, so renaming doesn't need a trip into the project */}
      {editing && (
        <ProjectEditDialog
          project={editing}
          onClose={() => setEditing(null)}
          onSave={async (updates) => {
            await updateProject(editing.id, updates)
            setEditing(null)
          }}
        />
      )}

      {showForm && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={() => setShowForm(false)}>
          <div className="bg-surface rounded-xl w-full max-w-md p-6" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-text-main font-semibold text-lg">New project</h2>
              <button onClick={() => setShowForm(false)} className="text-text-subtle hover:text-text-main p-1">
                <X size={18} />
              </button>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-text-muted mb-1.5">Project name *</label>
                <input
                  autoFocus
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
                  placeholder="e.g. Acme Corp"
                  className="w-full px-3 py-2 rounded-lg bg-surface-2 border border-border text-sm text-text-main focus:outline-none focus:border-primary"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-text-muted mb-1.5">Company name</label>
                <input
                  value={companyName}
                  onChange={(e) => setCompanyName(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
                  placeholder="Defaults to the project name"
                  className="w-full px-3 py-2 rounded-lg bg-surface-2 border border-border text-sm text-text-main focus:outline-none focus:border-primary"
                />
              </div>

              {error && <p className="text-danger text-xs">{error}</p>}

              <div className="flex gap-2 pt-1">
                <button
                  onClick={handleCreate}
                  disabled={submitting}
                  className="flex-1 bg-primary text-white text-sm font-medium px-4 py-2 rounded-lg hover:bg-primary-dark disabled:opacity-50 transition-colors"
                >
                  {submitting ? 'Creating…' : 'Create project'}
                </button>
                <button
                  onClick={() => setShowForm(false)}
                  className="px-4 py-2 rounded-lg border border-border text-text-muted text-sm hover:bg-surface-2 transition-colors"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

/** Rename and recolour without opening the project. */
function ProjectEditDialog({
  project,
  onClose,
  onSave,
}: {
  project: Project
  onClose: () => void
  onSave: (updates: Partial<Project>) => Promise<void>
}) {
  const [name, setName] = useState(project.name)
  const [companyName, setCompanyName] = useState(project.companyName)
  const [color, setColor] = useState(project.color)
  const [saving, setSaving] = useState(false)

  const save = async () => {
    if (!name.trim()) return
    setSaving(true)
    await onSave({ name: name.trim(), companyName: companyName.trim(), color })
    setSaving(false)
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-surface rounded-xl border border-border w-full max-w-md p-6" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-text-main font-semibold text-lg">Edit project</h2>
          <button onClick={onClose} className="text-text-subtle hover:text-text-main p-1">
            <X size={18} />
          </button>
        </div>

        <div className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-text-muted mb-1.5">Project name</label>
            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && save()}
              className="w-full px-3 py-2 rounded-lg bg-surface-2 border border-border text-sm text-text-main focus:outline-none focus:border-primary"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-text-muted mb-1.5">Company name</label>
            <input
              value={companyName}
              onChange={(e) => setCompanyName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && save()}
              className="w-full px-3 py-2 rounded-lg bg-surface-2 border border-border text-sm text-text-main focus:outline-none focus:border-primary"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-text-muted mb-1.5">Colour</label>
            <input
              type="color"
              value={color}
              onChange={(e) => setColor(e.target.value)}
              className="w-10 h-10 rounded-lg border border-border cursor-pointer bg-surface-2"
            />
          </div>

          <p className="text-[11px] text-text-subtle">
            The description and contact details live in the project's About tab.
          </p>

          <div className="flex gap-2 pt-1">
            <button
              onClick={save}
              disabled={saving || !name.trim()}
              className="flex-1 bg-primary text-white text-sm font-medium px-4 py-2 rounded-lg hover:bg-primary-dark disabled:opacity-50 transition-colors"
            >
              {saving ? 'Saving…' : 'Save changes'}
            </button>
            <button
              onClick={onClose}
              className="px-4 py-2 rounded-lg border border-border text-text-muted text-sm hover:bg-surface-2 transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
