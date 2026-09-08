import React from 'react'
import { useOutletContext } from 'react-router-dom'
import { Shield } from 'lucide-react'
import { Project } from '../../../types'
import { useAuthStore } from '../../../store/authStore'
import { EmptyState } from '../../../components/shared/EmptyState'
import { useT } from '../../../i18n/useT'

interface Ctx { project: Project }

/**
 * Who can manage this project.
 *
 * There is no admin tier any more: one owner account manages everything and
 * everybody else is an employee. This page used to grant and revoke that
 * tier, per project and globally; with the tier gone a grant would confer
 * nothing, so the page says so rather than offering controls that do not
 * work. The old UI is in git history if the tier is ever restored — it would
 * come back alongside the gate functions in 20260921000000_owner_only.sql,
 * which is where the tier actually lives.
 */
export function ProjectAdmins() {
  const { project } = useOutletContext<Ctx>()
  const { currentUser } = useAuthStore()
  const { t } = useT()

  if (!project) return null

  const isOwner = !!currentUser?.isOwner

  return (
    <EmptyState
      icon={Shield}
      title={isOwner ? t('proj_ownerOnlyTitle') : t('proj_onlyTheOwnerCanManageAccess')}
      description={isOwner ? t('proj_ownerOnlyBody') : t('proj_askOwnerForAccess')}
    />
  )
}
