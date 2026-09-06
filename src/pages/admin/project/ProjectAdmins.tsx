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
 * Who may run this project, and who is an admin at all.
 *
 * Both are the owner's to decide, and the policies enforce it — this page just
 * keeps the controls somewhere they can be found, rather than buried above the
 * team list where they had nothing to do with the people below them.
 */
export function ProjectAdmins() {
  const { t } = useT()
  const { project } = useOutletContext<Ctx>()
  const { currentUser } = useAuthStore()
  const { employees } = useEmployeeStore()
  const {
    byProject, admins: allAdmins, load: loadAdmins, grant, revoke, setRole,
  } = useProjectAdminStore()

  const isOwner = !!currentUser?.isOwner

  useEffect(() => {
    if (isOwner) loadAdmins(project.id)
  }, [isOwner, project.id, loadAdmins])

  const projectAdminIds = byProject[project.id] ?? []
  const admins = allAdmins.filter((u) => projectAdminIds.includes(u.id))
  const grantable = allAdmins.filter((u) => !u.isOwner && !projectAdminIds.includes(u.id))
  const staff = employees.filter((e) => e.role === 'employee')

  if (!isOwner) {
    return (
      <EmptyState
        icon={Shield}
        title={t('proj_onlyTheOwnerCanManageAccess')}
        description="Ask them to add or remove an admin on this project."
      />
    )
  }

  return (
    <div className="space-y-6 max-w-2xl">
      {/* Who runs this project. */}
      <div className="bg-surface rounded-xl border border-border p-5">
        <div className="flex items-center gap-2 mb-1">
          <Shield size={16} className="text-primary" />
          <h3 className="text-text-main font-semibold text-sm">Who can manage {project.name}</h3>
        </div>
        <p className="text-text-muted text-xs mb-4">
          An admin added here can do everything you can inside this project — create
          and delete tasks, people and documents — and nothing outside it.
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
                title={`Remove ${a.name}'s access to this project`}
                className="p-0.5 rounded-full text-text-muted hover:text-danger transition-colors"
              >
                <X size={12} />
              </button>
            </span>
          ))}
          {admins.length === 0 && (
            <p className="text-text-subtle text-xs italic">{t('proj_onlyYouCanManageThisProject')}</p>
          )}
        </div>

        {grantable.length > 0 && (
          <div className="mt-3 pt-3 border-t border-border">
            <p className="text-text-subtle text-[11px] mb-2">{t('proj_giveAccessTo')}</p>
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

      {/* Who is an admin at all. Not a per-project decision, so it stands apart
          from the panel above. */}
      <div className="bg-surface rounded-xl border border-border p-5">
        <h3 className="text-text-main font-semibold text-sm mb-1">{t('proj_admins')}</h3>
        <p className="text-text-muted text-xs mb-4">{t('proj_beingAnAdminIsCompanyWide')}</p>

        <div className="flex flex-wrap gap-2">
          {allAdmins.map((a) => (
            <span
              key={a.id}
              className={`flex items-center gap-1.5 pl-3 pr-1.5 py-1 rounded-full border text-xs ${
                a.isOwner
                  ? 'bg-surface-2 border-border text-text-main'
                  : 'border-border text-text-muted'
              }`}
            >
              {a.name}
              {a.isOwner ? (
                <span className="text-[10px] text-text-subtle pr-1">owner</span>
              ) : (
                <button
                  onClick={() => setRole(a.id, 'employee')}
                  title={`Make ${a.name} an employee again`}
                  className="p-0.5 rounded-full hover:text-danger transition-colors"
                >
                  <LogOut size={11} />
                </button>
              )}
            </span>
          ))}
        </div>

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
