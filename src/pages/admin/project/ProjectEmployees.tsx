import React, { useEffect, useState } from 'react'
import { Link, useOutletContext } from 'react-router-dom'
import { Users, Plus, Trash2, X, UserPlus, LogOut, Shield } from 'lucide-react'
import { format } from 'date-fns'
import { Project, Employee } from '../../../types'
import { useEmployeeStore } from '../../../store/employeeStore'
import { useTaskStore } from '../../../store/taskStore'
import { useAuthStore } from '../../../store/authStore'
import { useProjectAdminStore } from '../../../store/projectAdminStore'
import { EmptyState } from '../../../components/shared/EmptyState'
import { getTasksDueOnDate } from '../../../utils/taskScheduler'

interface Ctx { project: Project }

interface FormState {
  name: string
  email: string
  password: string
  jobTitle: string
  department: string
}

const emptyForm: FormState = { name: '', email: '', password: '', jobTitle: '', department: '' }

export function ProjectEmployees() {
  const { project } = useOutletContext<Ctx>()
  const { employees, createEmployee, deleteEmployee, updateEmployee, addToProject } = useEmployeeStore()
  const { currentUser } = useAuthStore()
  const { byProject, admins: allAdmins, load: loadAdmins, grant, revoke } = useProjectAdminStore()
  const { tasks, completionLogs } = useTaskStore()

  const [showForm, setShowForm] = useState(false)
  const [showAssign, setShowAssign] = useState(false)
  const [form, setForm] = useState<FormState>(emptyForm)
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [pendingDelete, setPendingDelete] = useState<Employee | null>(null)

  const today = new Date()
  const todayStr = format(today, 'yyyy-MM-dd')

  // Membership decides who is on a project now, so somebody can be here and on
  // another client at the same time.
  const isOn = (e: Employee) =>
    e.projectIds?.length ? e.projectIds.includes(project.id) : e.projectId === project.id

  const members = employees.filter(isOn)

  // Only the owner hands out admin access; the policy enforces it too, this
  // just keeps the controls out of everyone else's way.
  const isOwner = !!currentUser?.isOwner
  const projectAdminIds = byProject[project.id] ?? []
  const admins = allAdmins.filter((u) => projectAdminIds.includes(u.id))
  const grantable = allAdmins.filter((u) => !u.isOwner && !projectAdminIds.includes(u.id))
  // Anyone not already here can be added, including people who work elsewhere.
  const addable = employees.filter((e) => !isOn(e))

  const handleCreate = async () => {
    const { name, email, password, jobTitle, department } = form
    if (!name.trim() || !email.trim() || !password.trim()) {
      setError('Name, email and password are required.')
      return
    }

    setSubmitting(true)
    const result = await createEmployee({
      name: name.trim(),
      email: email.trim(),
      password,
      jobTitle: jobTitle.trim(),
      department: department.trim(),
      projectId: project.id,
    })
    setSubmitting(false)

    if (!result.success) {
      setError(result.error?.toLowerCase().includes('already') ? 'That email is already in use.' : (result.error ?? 'Could not create the employee.'))
      return
    }
    setForm(emptyForm)
    setShowForm(false)
  }

  useEffect(() => {
    if (isOwner) loadAdmins(project.id)
  }, [isOwner, project.id, loadAdmins])

  const addButton = (
    <div className="flex gap-2">
      {addable.length > 0 && (
        <button
          onClick={() => setShowAssign(true)}
          className="flex items-center gap-1.5 border border-border text-text-muted text-sm font-medium px-4 py-2 rounded-lg hover:bg-surface-2 transition-colors"
        >
          <UserPlus size={15} /> Assign existing
        </button>
      )}
      <button
        onClick={() => { setForm(emptyForm); setError(''); setShowForm(true) }}
        className="flex items-center gap-1.5 bg-primary text-white text-sm font-medium px-4 py-2 rounded-lg hover:bg-primary-dark transition-colors"
      >
        <Plus size={15} /> Add employee
      </button>
    </div>
  )

  return (
    <div>
      {members.length > 0 && <div className="flex justify-end mb-5">{addButton}</div>}

      {/* Who may run this project. An admin granted here can do everything the
          owner can inside it, and nothing outside it. */}
      {isOwner && (
        <div className="mb-6 bg-surface rounded-xl border border-border p-5">
          <div className="flex items-center gap-2 mb-1">
            <Shield size={16} className="text-primary" />
            <h3 className="text-text-main font-semibold text-sm">Who can manage this project</h3>
          </div>
          <p className="text-text-muted text-xs mb-4">
            An admin added here can do everything you can inside {project.name}, and
            nothing outside it. Only you can change this list.
          </p>

          <div className="flex flex-wrap gap-2">
            {admins.map((a) => (
              <span
                key={a.id}
                className="flex items-center gap-1.5 pl-3 pr-1.5 py-1 rounded-full bg-primary-light border border-primary/30 text-xs text-text-main"
              >
                {a.name}
                <button
                  onClick={() => revoke(project.id, a.id)}
                  title={`Remove ${a.name}'s access`}
                  className="p-0.5 rounded-full text-text-muted hover:text-danger transition-colors"
                >
                  <X size={12} />
                </button>
              </span>
            ))}
            {admins.length === 0 && (
              <p className="text-text-subtle text-xs italic">
                Only you can manage this project.
              </p>
            )}
          </div>

          {grantable.length > 0 && (
            <div className="mt-3 pt-3 border-t border-border">
              <p className="text-text-subtle text-[11px] mb-2">Give access to</p>
              <div className="flex flex-wrap gap-2">
                {grantable.map((u) => (
                  <button
                    key={u.id}
                    onClick={() => grant(project.id, u.id)}
                    className="flex items-center gap-1.5 px-3 py-1 rounded-full border border-border text-xs text-text-muted hover:border-primary hover:text-text-main transition-colors"
                  >
                    <UserPlus size={11} /> {u.name}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {members.length === 0 ? (
        <EmptyState
          icon={Users}
          title="No employees on this project"
          description="Add a new employee, or assign someone who isn't on a project yet."
          action={addButton}
        />
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {members.map((emp) => {
            const dueTasks = getTasksDueOnDate(tasks, emp.id, today)
            const doneToday = completionLogs.filter((l) => l.employeeId === emp.id && l.dueDate === todayStr).length
            const rate = dueTasks.length > 0 ? Math.round((doneToday / dueTasks.length) * 100) : 0

            let streak = 0
            for (let i = 1; i <= 30; i++) {
              const d = new Date(today)
              d.setDate(d.getDate() - i)
              if (d.getDay() === 0 || d.getDay() === 6) continue
              const ds = format(d, 'yyyy-MM-dd')
              const due = getTasksDueOnDate(tasks, emp.id, d).length
              const done = completionLogs.filter((l) => l.employeeId === emp.id && l.dueDate === ds).length
              if (due > 0 && done / due >= 0.8) streak++
              else break
            }

            return (
              <div key={emp.id} className="bg-surface rounded-xl border border-border p-5 flex flex-col gap-4">
                <div className="flex items-start gap-3">
                  <div className="w-12 h-12 rounded-full bg-primary flex items-center justify-center flex-shrink-0">
                    <span className="text-white font-bold text-base">{emp.avatarInitials}</span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <h3 className="text-text-main font-semibold text-sm truncate">{emp.name}</h3>
                    <p className="text-text-muted text-xs mt-0.5 truncate">{emp.jobTitle}</p>
                    <p className="text-text-subtle text-xs truncate">{emp.department}</p>
                  </div>
                  <div className="flex flex-col gap-1 flex-shrink-0">
                    <button
                      onClick={() => updateEmployee(emp.id, { projectId: null })}
                      className="text-text-subtle hover:text-warning transition-colors p-1 rounded"
                      title="Remove from this project (keeps the account)"
                    >
                      <LogOut size={14} />
                    </button>
                    <button
                      onClick={() => setPendingDelete(emp)}
                      className="text-text-subtle hover:text-danger transition-colors p-1 rounded"
                      title="Delete employee"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>

                <div>
                  <div className="flex justify-between items-center mb-1.5">
                    <span className="text-text-muted text-xs">Today</span>
                    <span className="text-text-main text-xs font-medium">{doneToday}/{dueTasks.length}</span>
                  </div>
                  <div className="w-full bg-surface-2 rounded-full h-2">
                    <div
                      className={`h-2 rounded-full transition-all ${
                        rate === 100 ? 'bg-primary' : rate >= 60 ? 'bg-amber' : 'bg-danger'
                      }`}
                      style={{ width: `${rate}%` }}
                    />
                  </div>
                  <div className="flex justify-between mt-1">
                    <span className="text-text-subtle text-xs">{rate}% complete</span>
                    {streak > 0 && <span className="text-xs text-amber">🔥 {streak} day streak</span>}
                  </div>
                </div>

                <Link
                  to={`/admin/projects/${project.id}/employees/team/${emp.id}`}
                  className="w-full text-center text-sm font-medium text-primary border border-primary/30 rounded-lg py-2 hover:bg-primary-light transition-colors"
                >
                  View profile
                </Link>
              </div>
            )
          })}
        </div>
      )}

      {/* Create employee */}
      {showForm && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={() => setShowForm(false)}>
          <div className="bg-surface rounded-xl border border-border w-full max-w-md p-5" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-text-main font-semibold text-base">Add employee to {project.name}</h3>
              <button onClick={() => setShowForm(false)} className="text-text-subtle hover:text-text-main">
                <X size={18} />
              </button>
            </div>

            <div className="space-y-3">
              {([
                ['Name', 'name', 'text'],
                ['Email', 'email', 'email'],
                ['Password', 'password', 'password'],
                ['Job title', 'jobTitle', 'text'],
                ['Department', 'department', 'text'],
              ] as const).map(([label, key, type]) => (
                <div key={key}>
                  <label className="text-xs font-medium text-text-muted mb-1 block">{label}</label>
                  <input
                    type={type}
                    value={form[key]}
                    onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))}
                    className="w-full px-3 py-2 rounded-lg border border-border bg-bg text-sm text-text-main focus:outline-none focus:ring-2 focus:ring-primary/30"
                  />
                </div>
              ))}

              {error && <p className="text-danger text-xs">{error}</p>}

              <button
                onClick={handleCreate}
                disabled={submitting}
                className="w-full bg-primary text-white text-sm font-medium px-4 py-2 rounded-lg hover:bg-primary-dark disabled:opacity-50 transition-colors"
              >
                {submitting ? 'Creating…' : 'Create employee'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Assign existing */}
      {showAssign && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={() => setShowAssign(false)}>
          <div className="bg-surface rounded-xl border border-border w-full max-w-md p-5" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-text-main font-semibold text-base">Assign to {project.name}</h3>
              <button onClick={() => setShowAssign(false)} className="text-text-subtle hover:text-text-main">
                <X size={18} />
              </button>
            </div>

            <div className="space-y-2 max-h-80 overflow-y-auto">
              {addable.map((emp) => (
                <button
                  key={emp.id}
                  onClick={async () => {
                    await addToProject(emp.id, project.id)
                    if (addable.length === 1) setShowAssign(false)
                  }}
                  className="w-full flex items-center gap-3 p-2.5 rounded-lg border border-border hover:border-primary hover:bg-surface-2 transition-colors text-left"
                >
                  <div className="w-9 h-9 rounded-full bg-primary flex items-center justify-center flex-shrink-0">
                    <span className="text-white text-xs font-bold">{emp.avatarInitials}</span>
                  </div>
                  <div className="min-w-0">
                    <p className="text-text-main text-sm font-medium truncate">{emp.name}</p>
                    <p className="text-text-subtle text-xs truncate">
                      {emp.jobTitle || emp.email}
                      {emp.projectIds?.length > 0 && ` · already on ${emp.projectIds.length} project(s)`}
                    </p>
                  </div>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Delete confirm */}
      {pendingDelete && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={() => setPendingDelete(null)}>
          <div className="bg-surface rounded-xl border border-border w-full max-w-sm p-5" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-text-main font-semibold text-base mb-2">Delete {pendingDelete.name}?</h3>
            <p className="text-text-muted text-sm mb-4">
              This permanently deletes their account and history. This cannot be undone.
            </p>
            <div className="flex gap-2">
              <button
                onClick={async () => { await deleteEmployee(pendingDelete.id); setPendingDelete(null) }}
                className="flex-1 bg-danger text-white text-sm font-medium px-4 py-2 rounded-lg hover:opacity-90 transition-opacity"
              >
                Delete
              </button>
              <button
                onClick={() => setPendingDelete(null)}
                className="flex-1 border border-border text-text-muted text-sm px-4 py-2 rounded-lg hover:bg-surface-2 transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
