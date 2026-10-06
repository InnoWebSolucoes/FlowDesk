import React, { useState } from 'react'
import { AlertTriangle, X } from 'lucide-react'
import { Project } from '../../types'
import { supabase } from '../../lib/supabaseClient'
import { useAuthStore } from '../../store/authStore'
import { useEmployeeStore } from '../../store/employeeStore'
import { useProjectStore } from '../../store/projectStore'
import { useTaskStore } from '../../store/taskStore'
import { useT } from '../../i18n/useT'

const inputCls =
  'w-full px-3 py-2 rounded-lg border border-border bg-bg text-sm text-text-main focus:outline-none focus:ring-2 focus:ring-danger/30'

/**
 * Deleting a project, in three steps that cannot be clicked through.
 *
 * A project is the business: its tasks and every tick on them, its lists,
 * notes, resources, work logs, chat and content calendar all go with it. It
 * used to go on one click. Now it takes reading what will be lost, typing the
 * project's name, and entering your password again — and the database checks
 * the name itself and refuses any delete that was not confirmed this way.
 *
 * The safe choice is the prominent one at every step.
 */
export function DeleteProjectDialog({
  project,
  onClose,
  onDeleted,
}: {
  project: Project
  onClose: () => void
  onDeleted: () => void
}) {
  const { t } = useT()
  const realUser = useAuthStore((s) => s.realUser)
  const deleteProject = useProjectStore((s) => s.deleteProject)
  const taskCount = useTaskStore((s) => s.allTasks.filter((x) => x.projectId === project.id).length)
  const peopleCount = useEmployeeStore(
    (s) => s.allEmployees.filter((e) => e.role === 'employee' && e.projectIds?.includes(project.id)).length,
  )

  const [step, setStep] = useState<1 | 2 | 3>(1)
  const [typed, setTyped] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const nameMatches = typed.trim() === project.name.trim()

  const finish = async () => {
    if (!realUser?.email || !password) return
    setBusy(true)
    setError('')
    // Who is at the keyboard, asked again: an unlocked computer is not enough.
    const { error: authErr } = await supabase.auth.signInWithPassword({ email: realUser.email, password })
    if (authErr) {
      setError(t('projdel_wrongPassword'))
      setBusy(false)
      return
    }
    try {
      await deleteProject(project.id, typed)
      onDeleted()
    } catch (e) {
      setError((e as Error).message)
      setBusy(false)
    }
  }

  // Focused on the first step, so Enter keeps the project. On the other two
  // the field is focused instead, or typing would go nowhere.
  const keepButton = (
    <button
      autoFocus={step === 1}
      onClick={onClose}
      className="flex-1 bg-primary text-white text-sm font-medium px-4 py-2 rounded-lg hover:bg-primary-dark transition-colors"
    >
      {t('projdel_keep')}
    </button>
  )

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={busy ? undefined : onClose}>
      <div className="bg-surface rounded-xl border border-border w-full max-w-md p-5" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start gap-3 mb-4">
          <div className="w-9 h-9 rounded-full bg-danger-bg flex items-center justify-center flex-shrink-0">
            <AlertTriangle size={17} className="text-danger" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-text-subtle">
              {t('projdel_step').replace('{n}', String(step))}
            </p>
            <h3 className="text-text-main font-semibold text-base break-words">
              {t('projdel_title').replace('{name}', project.name)}
            </h3>
          </div>
          {!busy && (
            <button onClick={onClose} className="text-text-subtle hover:text-text-main" title={t('ui_close')}>
              <X size={18} />
            </button>
          )}
        </div>

        {step === 1 && (
          <>
            <p className="text-sm text-text-main mb-2">{t('projdel_cannotUndo')}</p>
            <ul className="text-sm text-text-muted list-disc pl-5 space-y-1 mb-3">
              <li>{t('projdel_tasks').replace('{n}', String(taskCount))}</li>
              <li>{t('projdel_lists')}</li>
              <li>{t('projdel_logs')}</li>
              {project.hasContentCalendar && <li>{t('projdel_content')}</li>}
            </ul>
            {peopleCount > 0 && (
              <p className="text-sm text-text-muted mb-4">{t('projdel_people').replace('{n}', String(peopleCount))}</p>
            )}
            <div className="flex gap-2">
              {keepButton}
              <button
                onClick={() => setStep(2)}
                className="flex-1 border border-danger/40 text-danger text-sm font-medium px-4 py-2 rounded-lg hover:bg-danger-bg transition-colors"
              >
                {t('projdel_continue')}
              </button>
            </div>
          </>
        )}

        {step === 2 && (
          <>
            <p className="text-sm text-text-main mb-1">{t('projdel_typeName')}</p>
            <p className="text-sm font-semibold text-text-main mb-2 break-words">{project.name}</p>
            <input
              autoFocus
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              onPaste={(e) => e.preventDefault()}
              autoComplete="off"
              spellCheck={false}
              className={`${inputCls} mb-4`}
            />
            <div className="flex gap-2">
              {keepButton}
              <button
                onClick={() => setStep(3)}
                disabled={!nameMatches}
                className="flex-1 border border-danger/40 text-danger text-sm font-medium px-4 py-2 rounded-lg hover:bg-danger-bg disabled:opacity-40 disabled:hover:bg-transparent transition-colors"
              >
                {t('projdel_continue')}
              </button>
            </div>
          </>
        )}

        {step === 3 && (
          <>
            <p className="text-sm text-text-main mb-2">{t('projdel_enterPassword')}</p>
            <input
              autoFocus
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && finish()}
              placeholder={t('projdel_password')}
              autoComplete="current-password"
              className={`${inputCls} mb-3`}
            />
            {error && <p className="text-xs text-danger mb-3">{error}</p>}
            <div className="flex gap-2">
              {keepButton}
              <button
                onClick={finish}
                disabled={!password || busy}
                className="flex-1 bg-danger text-white text-sm font-medium px-4 py-2 rounded-lg hover:opacity-90 disabled:opacity-40 transition-opacity"
              >
                {busy ? t('projdel_deleting') : t('projdel_deleteForever')}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
