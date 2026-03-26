import React from 'react'
import { TrendingUp, TrendingDown } from 'lucide-react'
import { useT } from '../../i18n/useT'

interface StatCardProps {
  label: string
  value: string | number
  trend?: { value: number; label?: string }
  icon?: React.ReactNode
  color?: 'default' | 'green' | 'amber' | 'red' | 'blue'
  subtitle?: string
}

const colorMap = {
  default: 'bg-surface border-border',
  green: 'bg-success-bg border-success/20',
  amber: 'bg-amber-bg border-amber/20',
  red: 'bg-danger-bg border-danger/20',
  blue: 'bg-blue-bg border-blue-accent/20',
}

export function StatCard({ label, value, trend, icon, color = 'default', subtitle }: StatCardProps) {
  const { t } = useT()
  return (
    <div className={`rounded-xl border p-5 ${colorMap[color]}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <p className="text-text-muted text-sm mb-1">{label}</p>
          <p className="text-text-main text-2xl font-bold leading-none">{value}</p>
          {subtitle && <p className="text-text-muted text-xs mt-1 truncate">{subtitle}</p>}
          {trend !== undefined && (
            <div className={`flex items-center gap-1 mt-2 text-xs font-medium ${trend.value >= 0 ? 'text-success' : 'text-danger'}`}>
              {trend.value >= 0 ? <TrendingUp size={12} /> : <TrendingDown size={12} />}
              <span>{Math.abs(trend.value)}% {trend.label ?? t('statcard_vsLastPeriod')}</span>
            </div>
          )}
        </div>
        {icon && (
          <div className="w-9 h-9 rounded-lg bg-surface/60 flex items-center justify-center flex-shrink-0">
            {icon}
          </div>
        )}
      </div>
    </div>
  )
}
