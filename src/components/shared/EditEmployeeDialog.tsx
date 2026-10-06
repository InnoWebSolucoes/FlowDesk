import React, { useMemo, useState } from 'react'
import { X } from 'lucide-react'
import { Employee } from '../../types'
import { useEmployeeStore, usePersonColor } from '../../store/employeeStore'
import { initialsOf, themeVars } from '../../lib/personColor'
import { useT } from '../../i18n/useT'
import { Avatar } from './Avatar'
import { ColorSwatches, colorsTakenBy } from './ColorSwatches'

const inputCls =
  'w-full px-3 py-2 rounded-lg border border-border bg-bg text-sm text-text-main focus:outline-none focus:ring-2 focus:ring-primary/30'

/**
 * Change somebody's details after they have been added: their name, what they
 * do, and their colour. Email and password are their sign-in and are not
 * changed from here.
 *
 * The dialog is drawn in the colour being picked, so the avatar and the Save
 * button show what their side of the app will look like before it is saved.
 */
export function EditEmployeeDialog({ employee, onClose }: { employee: Employee; onClose: () => void }) {
  const { t } = useT()
  const allEmployees = useEmployeeStore((s) => s.allEmployees)
  const updateEmployee = useEmployeeStore((s) => s.updateEmployee)
  const current = usePersonColor(employee.id)

  const [name, setName] = useState(employee.name)
  const [jobTitle, setJobTitle] = useState(employee.jobTitle)
  const [department, setDepartment] = useState(employee.department)
  const [color, setColor] = useState(current)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const takenBy = useMemo(() => colorsTakenBy(allEmployees, employee.id), [allEmployees, employee.id])
  const nameChanged = name.trim() !== employee.name
  const initials = nameChanged ? initialsOf(name) : employee.avatarInitials

  const save = async () => {
    if (!name.trim()) {
      setError(t('employees_requiredFields'))
      return
    }
    setSaving(true)
    setError('')
    try {
      await updateEmployee(employee.id, {
        name: name.trim(),
        jobTitle: jobTitle.trim(),
        department: department.trim(),
        // Initials follow a new name; otherwise whatever they have is kept.
        ...(nameChanged ? { avatarInitials: initialsOf(name) } : {}),
        calendarColor: color,
      })
      onClose()
    } catch (e) {
      setError((e as Error).message || t('color_couldNotSave'))
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="bg-surface rounded-xl border border-border w-full max-w-md p-5"
        style={themeVars(color)}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 mb-5">
          <Avatar id={employee.id} initials={initials} name={name} color={color} size={44} />
          <div className="flex-1 min-w-0">
            <h3 className="text-text-main font-semibold text-base truncate">{t('employees_editEmployee')}</h3>
            <p className="text-text-subtle text-xs truncate">{employee.email}</p>
          </div>
          <button onClick={onClose} className="text-text-subtle hover:text-text-main self-start" title={t('ui_close')}>
            <X size={18} />
          </button>
        </div>

        <div className="space-y-3">
          <div>
            <label className="text-xs font-medium text-text-muted mb-1 block">{t('employees_name')}</label>
            <input value={name} onChange={(e) => setName(e.target.value)} className={inputCls} />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-text-muted mb-1 block">{t('employees_jobTitle')}</label>
              <input value={jobTitle} onChange={(e) => setJobTitle(e.target.value)} className={inputCls} />
            </div>
            <div>
              <label className="text-xs font-medium text-text-muted mb-1 block">{t('employees_department')}</label>
              <input value={department} onChange={(e) => setDepartment(e.target.value)} className={inputCls} />
            </div>
          </div>

          <div className="pt-1">
            <label className="text-xs font-medium text-text-muted mb-2 block">{t('ui_colour')}</label>
            <ColorSwatches value={color} onChange={setColor} takenBy={takenBy} />
          </div>

          {error && <p className="text-danger text-xs">{error}</p>}

          <div className="flex gap-2 pt-1">
            <button
              onClick={onClose}
              className="flex-1 border border-border text-text-muted text-sm px-4 py-2 rounded-lg hover:bg-surface-2 transition-colors"
            >
              {t('ui_cancel')}
            </button>
            <button
              onClick={save}
              disabled={saving}
              className="flex-1 bg-primary text-white text-sm font-medium px-4 py-2 rounded-lg hover:bg-primary-dark disabled:opacity-50 transition-colors"
            >
              {saving ? t('ui_saving') : t('employees_save')}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
