import React, { useEffect } from 'react'
import { useOutletContext } from 'react-router-dom'
import { Shield, UserPlus, X, LogOut } from 'lucide-react'
import { Project } from '../../../types'
import { useAuthStore } from '../../../store/authStore'
import { useEmployeeStore } from '../../../store/employeeStore'
import { useProjectAdminStore } from '../../../store/projectAdminStore'
import { EmptyState } from '../../../components/shared/EmptyState'
import { useT } from '../../../i18n/useT'

interface Ctx { project: Project }

/**
 * Who can manage this project.
 *
 * This was two panels — one for which projects an admin reaches, another for
 * who is an admin at all. They are different questions, but with every admin
 * reaching every project they showed the same names twice and the distinction
 * landed as a duplicate. One list now: everybody who can manage this project,
 * with the two ways off it told apart by what they actually do.
 */
export function ProjectAdmins() {
  const { t } = useT()
  const ctx = useOutletContext<Ctx | null>()
  const { currentUser } = useAuthStore()
  const { employees } = useEmployeeStore()
  const {
    byProject, admins: allAdmins, load: loadAdmins, grant, revoke, setRole,
  } = useProjectAdminStore()

  const isOwner = !!currentUser?.isOwner
  const project = ctx?.project

  useEffect(() => {
    if (isOwner && project) loadAdmins(project.id)
  }, [isOwner, project, loadAdmins])

  if (!project) return null

  if (!isOwner) {
    return (
      <EmptyState
        icon={Shield}
        title={t('proj_onlyTheOwnerCanManageAccess')}
        description={t('proj_askOwnerForAccess')}
      />
    )
  }

  const projectAdminIds = byProject[project.id] ?? []
  // On this project: the owner, who reaches everything, and whoever has been
  // granted it.
  const here = allAdmins.filter((u) => u.isOwner || projectAdminIds.includes(u.id))
  // An admin elsewhere who has not been given this one.
  const elsewhere = allAdmins.filter((u) => !u.isOwner && !projectAdminIds.includes(u.id))
  const staff = employees.filter((e) => e.role === 'employee')

  return (
    <div className="space-y-6 max-w-2xl">
      <div className="bg-surface rounded-xl border border-border p-5">
        <div className="flex items-center gap-2 mb-1">
          <Shield size={16} className="text-primary" />
          <h3 className="text-text-main font-semibold text-sm">
            {t('proj_whoCanManage')} {project.name}
          </h3>
        </div>
        <p className="text-text-muted text-xs mb-4">{t('proj_whoCanManageHint')}</p>

        <div className="flex flex-wrap gap-2">
          {here.map((a) => (
            <span
              key={a.id}
              className={`flex items-center gap-1.5 pl-3 pr-1.5 py-1 rounded-full border text-xs ${
                a.isOwner
                  ? 'bg-surface-2 border-border text-text-main'
                  : 'bg-primary-light border-primary/30 text-text-main'
              }`}
            >
              {a.name}
              {a.isOwner ? (
                <span className="text-[10px] text-text-subtle pr-1">{t('proj_owner')}</span>
              ) : (
                <>
                  {/* Two different acts, so two buttons: taking away this one
                      project, or taking away being an admin at all. */}
                  <button
                    onClick={() => revoke(project.id, a.id)}
                    title={t('proj_removeFromProject')}
                    className="p-0.5 rounded-full text-text-muted hover:text-danger transition-colors"
                  >
                    <X size={12} />
                  </button>
                  <button
                    onClick={() => setRole(a.id, 'employee')}
                    title={t('proj_makeEmployeeAgain')}
                    className="p-0.5 rounded-full text-text-muted hover:text-danger transition-colors"
                  >
                    <LogOut size={11} />
                  </button>
                </>
              )}
            </span>
          ))}
          {here.length <= 1 && (
            <p className="text-text-subtle text-xs italic self-center">
              {t('proj_onlyYouCanManageThisProject')}
            </p>
          )}
        </div>

        {elsewhere.length > 0 && (
          <div className="mt-3 pt-3 border-t border-border">
            <p className="text-text-subtle text-[11px] mb-2">{t('proj_giveAccessTo')}</p>
            <div className="flex flex-wrap gap-2">
              {elsewhere.map((u) => (
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

        {staff.length > 0 && (
          <div className="mt-3 pt-3 border-t border-border">
            <p className="text-text-subtle text-[11px] mb-2">{t('proj_promoteToAdmin')}</p>
            <div className="flex flex-wrap gap-2">
              {staff.map((e) => (
                <button
                  key={e.id}
                  onClick={() => setRole(e.id, 'admin')}
                  className="flex items-center gap-1.5 px-3 py-1 rounded-full border border-border text-xs text-text-muted hover:border-primary hover:text-text-main transition-colors"
                >
                  <Shield size={11} /> {e.name}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
