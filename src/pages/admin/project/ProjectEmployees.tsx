import React, { useState } from 'react'
import { Link, useOutletContext } from 'react-router-dom'
import { Users, Plus, Trash2, X, UserPlus, LogOut, UserX, UserCheck } from 'lucide-react'
import { format } from 'date-fns'
import { Project, Employee } from '../../../types'
import { useEmployeeStore } from '../../../store/employeeStore'
import { useTaskStore } from '../../../store/taskStore'
import { EmptyState } from '../../../components/shared/EmptyState'
import { getTasksDueOnDate } from '../../../utils/taskScheduler'
import { useT } from '../../../i18n/useT'
import { Avatar } from '../../../components/shared/Avatar'

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
  const { t } = useT()
  const { project } = useOutletContext<Ctx>()
  const { employees, createEmployee, deleteEmployee, setEmployeeActive, addToProject, removeFromProject } = useEmployeeStore()
  const { tasks, completionLogs } = useTaskStore()

  const [showForm, setShowForm] = useState(false)
  const [showAssign, setShowAssign] = useState(false)
  const [form, setForm] = useState<FormState>(emptyForm)
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [pendingDelete, setPendingDelete] = useState<Employee | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [pageError, setPageError] = useState('')

  const toggleActive = async (emp: Employee) => {
    setPageError('')
    try {
      const res = await setEmployeeActive(emp.id, !emp.isActive)
      if (res?.success === false) {
        setPageError(res.error || 'That could not be changed.')
      }
    } catch (e) {
      setPageError((e as Error).message || 'That could not be changed.')
    }
  }

  const today = new Date()
  const todayStr = format(today, 'yyyy-MM-dd')

  // Membership decides who is on a project now, so somebody can be here and on
  // another client at the same time.
  const isOn = (e: Employee) =>
    e.projectIds?.length ? e.projectIds.includes(project.id) : e.projectId === project.id

  // The store now carries managers too, because their calendars are needed
  // elsewhere. This page is about staff, so it narrows again here.
  const staff = employees.filter((e) => e.role === 'employee')
  const members = staff.filter(isOn)

  // Only the owner hands out admin access; the policy enforces it too, this
  // just keeps the controls out of everyone else's way.
  // Anyone not already here can be added, including people who work elsewhere.
  const addable = staff.filter((e) => !isOn(e))

  const handleCreate = async () => {
    const { name, email, password, jobTitle, department } = form
    if (!name.trim() || !email.trim() || !password.trim()) {
      setError(t('err_nameEmailPassword'))
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

  const addButton = (
    <div className="flex gap-2">
      {addable.length > 0 && (
        <button
          onClick={() => setShowAssign(true)}
          className="flex items-center gap-1.5 border border-border text-text-muted text-sm font-medium px-4 py-2 rounded-lg hover:bg-surface-2 transition-colors"
        >
          <UserPlus size={15} />{t('proj_assignExisting')}</button>
      )}
      <button
        onClick={() => { setForm(emptyForm); setError(''); setShowForm(true) }}
        className="flex items-center gap-1.5 bg-primary text-white text-sm font-medium px-4 py-2 rounded-lg hover:bg-primary-dark transition-colors"
      >
        <Plus size={15} />{t('proj_addEmployee')}</button>
    </div>
  )

  return (
    <div>
      {/* Errors from the row buttons — deactivating, removing from a project.
          The other two error slots live inside modals, so a failure out here
          had nowhere to appear and the button looked inert. */}
      {pageError && (
        <div className="mb-4 flex items-start gap-2 text-sm text-danger bg-danger-bg border border-danger/30 rounded-lg px-3 py-2">
          <span className="flex-1">{pageError}</span>
          <button onClick={() => setPageError('')} className="hover:opacity-70" title={t('ui_close')}>
            <X size={14} />
          </button>
        </div>
      )}

      {members.length > 0 && <div className="flex justify-end mb-5">{addButton}</div>}

      {/* Who may run this project. An admin granted here can do everything the
          owner can inside it, and nothing outside it. */}
      {members.length === 0 ? (
        <EmptyState
          icon={Users}
          title={t('proj_noEmployeesOnThisProject')}
          description={t('proj_addOrAssign')}
          action={addButton}
        />
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {members.map((emp) => {
            const dueTasks = getTasksDueOnDate(tasks, emp.id, today)
            const doneToday = completionLogs.filter((l) => l.employeeId === emp.id && l.dueDate === todayStr).length
            // Capped at 100. A completion log survives the task being
            // deactivated or unassigned, so somebody can have more logs for
            // today than they have tasks due today — which made the rate come
            // out above 100 and the bar run straight out of its track.
            const rate = dueTasks.length > 0
              ? Math.min(100, Math.round((doneToday / dueTasks.length) * 100))
              : 0

            let streak = 0
            for (let i = 1; i <= 30; i++) {
              const d = new Date(today)
              d.setDate(d.getDate() - i)
              const ds = format(d, 'yyyy-MM-dd')
              const due = getTasksDueOnDate(tasks, emp.id, d).length
              const done = completionLogs.filter((l) => l.employeeId === emp.id && l.dueDate === ds).length
              if (due > 0 && done / due >= 0.8) streak++
              else break
            }

            return (
              <div key={emp.id} className="bg-surface rounded-xl border border-border p-5 flex flex-col gap-4">
                <div className="flex items-start gap-3">
                  <Avatar id={emp.id} initials={emp.avatarInitials} name={emp.name} size={48} />
                  <div className="flex-1 min-w-0">
                    <h3 className="text-text-main font-semibold text-sm truncate flex items-center gap-1.5">
                      <span className="truncate">{emp.name}</span>
                      {!emp.isActive && (
                        <span className="flex-shrink-0 text-[10px] font-medium uppercase tracking-wide text-warning bg-warning/10 border border-warning/30 rounded px-1.5 py-0.5">
                          {t('proj_inactive')}
                        </span>
                      )}
                    </h3>
                    <p className="text-text-muted text-xs mt-0.5 truncate">{emp.jobTitle}</p>
                    <p className="text-text-subtle text-xs truncate">{emp.department}</p>
                  </div>
                  <div className="flex flex-col gap-1 flex-shrink-0">
                    {/* No "make an admin" here any more. The admin tier was
                        removed — one owner, everybody else an employee — so
                        promoting would grant nothing the app honours, while
                        still setting the role = 'admin' that the
                        delete-employee function checks. */}
                    <button
                      onClick={() => removeFromProject(emp.id, project.id)}
                      className="text-text-subtle hover:text-warning transition-colors p-1 rounded"
                      title={t('proj_removeFromThisProjectKeepsThe')}
                    >
                      <LogOut size={14} />
                    </button>
                    {/* Deactivating is the reversible one, so it sits above
                        delete: somebody who has left usually wants their
                        record kept. */}
                    <button
                      onClick={() => toggleActive(emp)}
                      className={`transition-colors p-1 rounded ${
                        emp.isActive
                          ? 'text-text-subtle hover:text-warning'
                          : 'text-warning hover:text-success'
                      }`}
                      title={emp.isActive ? t('proj_deactivate') : t('proj_reactivate')}
                    >
                      {emp.isActive ? <UserX size={14} /> : <UserCheck size={14} />}
                    </button>
                    <button
                      onClick={() => setPendingDelete(emp)}
                      className="text-text-subtle hover:text-danger transition-colors p-1 rounded"
                      title={t('proj_deleteEmployee')}
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>

                <div>
                  <div className="flex justify-between items-center mb-1.5">
                    <span className="text-text-muted text-xs">{t('ui_today')}</span>
                    <span className="text-text-main text-xs font-medium">{doneToday}/{dueTasks.length}</span>
                  </div>
                  {/* overflow-hidden as well as the cap: the fill is rounded
                      to the same radius as the track, so it has to be clipped
                      by it rather than merely sized to it. */}
                  <div className="w-full bg-surface-2 rounded-full h-2 overflow-hidden">
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
                >{t('proj_viewProfile')}</Link>
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
                  <Avatar id={emp.id} initials={emp.avatarInitials} name={emp.name} size={36} />
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
            <p className="text-text-muted text-sm mb-4">{t('proj_thisPermanentlyDeletesTheirAccount')}</p>
            {error && (
              <p className="text-sm text-danger bg-danger-bg border border-danger/30 rounded-lg px-3 py-2 mb-3">
                {error}
              </p>
            )}
            <div className="flex gap-2">
              <button
                disabled={deleting}
                onClick={async () => {
                  // The result was thrown away and the dialog closed either
                  // way, so a refusal — forbidden, or the account being your
                  // own — was indistinguishable from the button doing
                  // nothing at all. Say what happened instead.
                  setDeleting(true)
                  setError('')
                  try {
                    const res = await deleteEmployee(pendingDelete.id)
                    if (res?.success === false) {
                      setError(res.error || 'That employee could not be deleted.')
                      return
                    }
                    setPendingDelete(null)
                  } catch (e) {
                    setError((e as Error).message || 'That employee could not be deleted.')
                  } finally {
                    setDeleting(false)
                  }
                }}
                className="flex-1 bg-danger text-white text-sm font-medium px-4 py-2 rounded-lg hover:opacity-90 transition-opacity"
              >{deleting ? t('ui_deleting') : t('ui_delete')}</button>
              <button
                onClick={() => setPendingDelete(null)}
                className="flex-1 border border-border text-text-muted text-sm px-4 py-2 rounded-lg hover:bg-surface-2 transition-colors"
              >{t('ui_cancel')}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
