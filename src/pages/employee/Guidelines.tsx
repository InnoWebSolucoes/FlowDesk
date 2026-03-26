import React from 'react'
import { BookOpen, Clock } from 'lucide-react'
import { useToolStore } from '../../store/toolStore'
import { useAuthStore } from '../../store/authStore'
import { format, parseISO } from 'date-fns'
import { EmptyState } from '../../components/shared/EmptyState'
import { useT } from '../../i18n/useT'

export function Guidelines() {
  const { currentUser } = useAuthStore()
  const { getGuidelines } = useToolStore()
  const { t, dateLocale } = useT()

  const empId = currentUser!.id
  const guidelines = getGuidelines(empId)

  return (
    <div className="max-w-3xl mx-auto animate-fade-in">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-text-main font-bold text-lg">{t('guidelines_title')}</h2>
        {guidelines?.updatedAt && (
          <div className="flex items-center gap-1.5 text-text-subtle text-xs">
            <Clock size={12} />
            {t('guidelines_updated')} {format(parseISO(guidelines.updatedAt), 'EEE d MMM yyyy HH:mm', dateLocale)}
          </div>
        )}
      </div>

      {!guidelines ? (
        <EmptyState
          icon={BookOpen}
          title={t('guidelines_noGuidelines')}
          description={t('guidelines_noGuidelinesDesc')}
        />
      ) : (
        <div
          className="bg-surface rounded-xl border border-border p-6 tiptap-content leading-relaxed"
          dangerouslySetInnerHTML={{ __html: guidelines.content }}
        />
      )}
    </div>
  )
}
