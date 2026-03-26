import React from 'react'
import { useT } from '../../i18n/useT'

interface Props {
  currentStreak: number
  longestStreak: number
}

export function StreakCard({ currentStreak, longestStreak }: Props) {
  const { t } = useT()
  const isHot = currentStreak > 5

  return (
    <div className={`rounded-xl border p-5 flex items-center gap-4 ${isHot ? 'bg-amber-bg border-amber/20' : 'bg-surface border-border'}`}>
      <div className="text-4xl select-none">🔥</div>
      <div>
        <p className="text-3xl font-bold text-text-main leading-none">{currentStreak}</p>
        <p className="text-text-muted text-sm mt-0.5">{t('chart_daysInARow')}</p>
        <p className="text-text-subtle text-xs mt-1">{t('chart_longestStreak')} {longestStreak} {t('chart_days')}</p>
      </div>
    </div>
  )
}
