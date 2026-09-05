import React, { useState } from 'react'
import { Link } from 'react-router-dom'
import { Users, Plus, Trash2, X } from 'lucide-react'
import { useEmployeeStore } from '../../store/employeeStore'
import { useTaskStore } from '../../store/taskStore'
import { EmptyState } from '../../components/shared/EmptyState'
import { format } from 'date-fns'
import { getTasksDueOnDate } from '../../utils/taskScheduler'
import { useT } from '../../i18n/useT'
import { Employee } from '../../types'

interface FormState {
  name: string
  email: string
  password: string
  jobTitle: string
  department: string
}

const emptyForm: FormState = { name: '', email: '', password: '', jobTitle: '', department: '' }

export function Employees() {
  const { employees, createEmployee, deleteEmployee } = useEmployeeStore()
  const { tasks, completionLogs } = useTaskStore()
  const { t } = useT()

  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState<FormState>(emptyForm)
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [pendingDelete, setPendingDelete] = useState<Employee | null>(null)
  const [deleting, setDeleting] = useState(false)

  const today = new Date()
  const todayStr = format(today, 'yyyy-MM-dd')

  const openForm = () => {
    setForm(emptyForm)
    setError('')
    setShowForm(true)
  }

  const closeForm = () => setShowForm(false)

  const handleCreate = async () => {
    const { name, email, password, jobTitle, department } = form
    if (!name.trim() || !email.trim() || !password.trim() || !jobTitle.trim() || !department.trim()) {
      setError(t('employees_requiredFields'))
      return
    }

    setSubmitting(true)
    const result = await createEmployee({
      name: name.trim(),
      email: email.trim(),
      password,
      jobTitle: jobTitle.trim(),
      department: department.trim(),
    })
    setSubmitting(false)

    if (!result.success) {
      setError(result.error?.toLowerCase().includes('already') ? t('employees_emailInUse') : (result.error ?? t('employees_requiredFields')))
      return
    }

    setShowForm(false)
  }

  const confirmDelete = async () => {
    if (!pendingDelete) return
    setDeleting(true)
    await deleteEmployee(pendingDelete.id)
    setDeleting(false)
    setPendingDelete(null)
  }

  const addButton = (
    <button
      onClick={openForm}
      className="flex items-center gap-1.5 bg-primary text-white text-sm font-medium px-4 py-2 rounded-lg hover:bg-primary-dark transition-colors"
    >
      <Plus size={15} /> {t('employees_addEmployee')}
    </button>
  )

  return (
    <div className="animate-fade-in">
      {employees.length > 0 && (
        <div className="flex justify-end mb-5">{addButton}</div>
      )}

      {employees.length === 0 ? (
        <EmptyState
          icon={Users}
          title={t('employees_noEmployees')}
          description={t('employees_noEmployeesDesc')}
          action={addButton}
        />
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {employees.map(emp => {
            const dueTasks = getTasksDueOnDate(tasks, emp.id, today)
            const doneToday = completionLogs.filter(
              l => l.employeeId === emp.id && l.dueDate === todayStr
            ).length
            const rate = dueTasks.length > 0 ? Math.round((doneToday / dueTasks.length) * 100) : 0

            let streak = 0
            for (let i = 1; i <= 30; i++) {
              const d = new Date(today)
              d.setDate(d.getDate() - i)
              if (d.getDay() === 0 || d.getDay() === 6) continue
              const ds = format(d, 'yyyy-MM-dd')
              const due = getTasksDueOnDate(tasks, emp.id, d).length
              const done = completionLogs.filter(l => l.employeeId === emp.id && l.dueDate === ds).length
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
                    <h3 className="text-text-main font-semibold text-sm">{emp.name}</h3>
                    <p className="text-text-muted text-xs mt-0.5">{emp.jobTitle}</p>
                    <p className="text-text-subtle text-xs">{emp.department}</p>
                  </div>
                  <button
                    onClick={() => setPendingDelete(emp)}
                    className="text-text-subtle hover:text-danger transition-colors p-1 rounded flex-shrink-0"
                    title={t('employees_delete')}
                  >
                    <Trash2 size={15} />
                  </button>
                </div>

                <div>
                  <div className="flex justify-between items-center mb-1.5">
                    <span className="text-text-muted text-xs">{t('employees_todayProgress')}</span>
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
                    <span className="text-text-subtle text-xs">{rate}{t('employees_complete')}</span>
                    {streak > 0 && (
                      <span className="text-xs text-amber">🔥 {streak} {t('employees_dayStreak')}</span>
                    )}
                  </div>
                </div>

                <Link
                  to={emp.projectId ? `/admin/projects/${emp.projectId}/employees/team/${emp.id}` : "/admin/projects"}
                  className="w-full text-center text-sm font-medium text-primary border border-primary/30 rounded-lg py-2 hover:bg-primary-light transition-colors"
                >
                  {t('employees_viewProfile')}
                </Link>
              </div>
            )
          })}
        </div>
      )}

      {showForm && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={closeForm}>
          <div
            className="bg-surface rounded-xl border border-border w-full max-w-md p-5"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-text-main font-semibold text-base">{t('employees_addEmployee')}</h3>
              <button onClick={closeForm} className="text-text-subtle hover:text-text-main transition-colors">
                <X size={18} />
              </button>
            </div>

            <div className="space-y-3">
              <div>
                <label className="text-xs font-medium text-text-muted mb-1 block">{t('employees_name')}</label>
                <input
                  value={form.name}
                  onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                  className="w-full px-3 py-2 rounded-lg border border-border bg-bg text-sm text-text-main focus:outline-none focus:ring-2 focus:ring-primary/30"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-text-muted mb-1 block">{t('employees_email')}</label>
                <input
                  type="email"
                  value={form.email}
                  onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
                  className="w-full px-3 py-2 rounded-lg border border-border bg-bg text-sm text-text-main focus:outline-none focus:ring-2 focus:ring-primary/30"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-text-muted mb-1 block">{t('employees_password')}</label>
                <input
                  type="text"
                  value={form.password}
                  onChange={e => setForm(f => ({ ...f, password: e.target.value }))}
                  className="w-full px-3 py-2 rounded-lg border border-border bg-bg text-sm text-text-main focus:outline-none focus:ring-2 focus:ring-primary/30"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-text-muted mb-1 block">{t('employees_jobTitle')}</label>
                <input
                  value={form.jobTitle}
                  onChange={e => setForm(f => ({ ...f, jobTitle: e.target.value }))}
                  className="w-full px-3 py-2 rounded-lg border border-border bg-bg text-sm text-text-main focus:outline-none focus:ring-2 focus:ring-primary/30"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-text-muted mb-1 block">{t('employees_department')}</label>
                <input
                  value={form.department}
                  onChange={e => setForm(f => ({ ...f, department: e.target.value }))}
                  className="w-full px-3 py-2 rounded-lg border border-border bg-bg text-sm text-text-main focus:outline-none focus:ring-2 focus:ring-primary/30"
                />
              </div>

              {error && <p className="text-danger text-xs">{error}</p>}
            </div>

            <div className="flex justify-end gap-2 mt-5">
              <button
                onClick={closeForm}
                disabled={submitting}
                className="text-sm font-medium text-text-muted px-4 py-2 rounded-lg hover:bg-surface-2 transition-colors disabled:opacity-60"
              >
                {t('employees_cancel')}
              </button>
              <button
                onClick={handleCreate}
                disabled={submitting}
                className="bg-primary text-white text-sm font-medium px-4 py-2 rounded-lg hover:bg-primary-dark transition-colors disabled:opacity-60"
              >
                {t('employees_create')}
              </button>
            </div>
          </div>
        </div>
      )}

      {pendingDelete && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={() => setPendingDelete(null)}>
          <div
            className="bg-surface rounded-xl border border-border w-full max-w-sm p-5"
            onClick={e => e.stopPropagation()}
          >
            <h3 className="text-text-main font-semibold text-base mb-2">{t('employees_deleteConfirmTitle')}</h3>
            <p className="text-text-muted text-sm mb-5">
              {t('employees_deleteConfirmDesc').replace('{name}', pendingDelete.name)}
            </p>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setPendingDelete(null)}
                disabled={deleting}
                className="text-sm font-medium text-text-muted px-4 py-2 rounded-lg hover:bg-surface-2 transition-colors disabled:opacity-60"
              >
                {t('employees_cancel')}
              </button>
              <button
                onClick={confirmDelete}
                disabled={deleting}
                className="bg-danger text-white text-sm font-medium px-4 py-2 rounded-lg hover:opacity-90 transition-opacity disabled:opacity-60"
              >
                {t('employees_delete')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
