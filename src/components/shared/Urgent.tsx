import React from 'react'
import { Flame } from 'lucide-react'
import { useT } from '../../i18n/useT'

/** Says a task or todo is urgent. Renders nothing when it is not. */
export function UrgentBadge({ urgent }: { urgent: boolean }) {
  const { t } = useT()
  if (!urgent) return null
  return (
    <span className="inline-flex items-center gap-0.5 text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded-full bg-danger text-white flex-shrink-0">
      <Flame size={10} />
      {t('urgent_label')}
    </span>
  )
}

/** Marks something urgent or not. The only level there is. */
export function UrgentToggle({
  urgent,
  onChange,
  disabled,
  compact,
}: {
  urgent: boolean
  onChange: (urgent: boolean) => void
  disabled?: boolean
  /** Icon only, for rows with no room for a label. */
  compact?: boolean
}) {
  const { t } = useT()
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => onChange(!urgent)}
      aria-pressed={urgent}
      title={urgent ? t('urgent_unmark') : t('urgent_mark')}
      className={`inline-flex items-center gap-1.5 rounded-lg border text-xs font-medium transition-colors disabled:opacity-50 disabled:cursor-default ${
        compact ? 'p-1.5' : 'px-3 py-2'
      } ${
        urgent
          ? 'bg-danger text-white border-danger hover:opacity-90'
          : 'bg-surface text-text-muted border-border hover:text-danger hover:border-danger/40'
      }`}
    >
      <Flame size={compact ? 13 : 14} />
      {!compact && t('urgent_label')}
    </button>
  )
}
