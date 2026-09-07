import React, { useEffect } from 'react'
import { useAuthStore } from '../../store/authStore'
import { useProjectStore } from '../../store/projectStore'
import { WorkLog } from '../../components/worklog/WorkLog'
import { useT } from '../../i18n/useT'

/**
 * The employee's own write-ups. Their project is the one they are on, so
 * nothing has to be picked before they can record anything.
 */
export function MyWorkLog() {
  const { t } = useT()
  const { currentUser } = useAuthStore()
  const { projects, initialized, initialize } = useProjectStore()

  useEffect(() => {
    if (!initialized) initialize()
  }, [initialized, initialize])

  const project = projects.find((p) => p.id === currentUser?.projectId)

  if (!initialized) return <p className="text-text-muted text-sm py-8">{t('emp_loading')}</p>
  if (!project) return <p className="text-text-muted text-sm py-8">{t('emp_noProjectYet')}</p>

  return <WorkLog project={project} />
}
