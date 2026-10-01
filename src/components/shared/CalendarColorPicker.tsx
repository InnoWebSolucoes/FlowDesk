import React, { useState } from 'react'
import { Check, Palette } from 'lucide-react'
import { Employee } from '../../types'
import { CALENDAR_COLORS, calendarColorOf } from '../../lib/personColor'
import { useEmployeeStore } from '../../store/employeeStore'
import { useT } from '../../i18n/useT'

/**
 * Pick what somebody's work is painted on the calendar of tasks.
 *
 * The manager's calendar lays several people's weeks over one another, which
 * is the only way to plan against the team's week — but every employee was
 * drawn the same purple, so the overlay said that there was work without
 * saying whose. This is the one place that colour is chosen.
 *
 * It changes nothing else about them. Avatars keep their own colouring, and
 * no other screen reads this.
 */
export function CalendarColorPicker({
  employee,
  className = '',
}: {
  employee: Employee
  className?: string
}) {
  const { t } = useT()
  const allEmployees = useEmployeeStore((s) => s.allEmployees)
  const updateEmployee = useEmployeeStore((s) => s.updateEmployee)
  const [saving, setSaving] = useState<string | null>(null)
  const [error, setError] = useState(false)

  // What the calendar actually draws them as right now, chosen or inherited.
  const current = calendarColorOf(employee.id, allEmployees)
  const chosen = employee.calendarColor ?? null

  const pick = async (color: string | null) => {
    if (color === chosen) return
    setSaving(color ?? 'none')
    setError(false)
    try {
      await updateEmployee(employee.id, { calendarColor: color })
    } catch {
      setError(true)
    } finally {
      setSaving(null)
    }
  }

  return (
    <div className={className}>
      <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-text-subtle">
        <Palette size={12} />
        {t('color_calendarColour')}
      </p>
      <p className="text-xs text-text-muted mt-0.5 max-w-[46ch]">{t('color_calendarColourHint')}</p>

      <div className="flex items-center gap-1.5 flex-wrap mt-2">
        {CALENDAR_COLORS.map((c) => (
          <button
            key={c}
            onClick={() => pick(c)}
            disabled={!!saving}
            // The ring is outside the swatch, so the colour itself is never
            // covered by the mark saying it is the one in use.
            className={`w-6 h-6 rounded-md flex items-center justify-center transition-transform disabled:opacity-60 hover:scale-110 ${
              chosen === c ? 'ring-2 ring-offset-2 ring-offset-surface ring-text-main' : ''
            }`}
            style={{ backgroundColor: c }}
            aria-label={c}
            aria-pressed={chosen === c}
            title={c}
          >
            {chosen === c && <Check size={13} className="text-white" />}
          </button>
        ))}

        {/* Back to no choice at all, which is not the same as picking the
            colour it falls back to: an unset person follows whatever the
            default becomes. */}
        <button
          onClick={() => pick(null)}
          disabled={!!saving || !chosen}
          className="ml-1 text-[11px] font-medium text-text-muted hover:text-text-main disabled:opacity-40 disabled:hover:text-text-muted"
        >
          {t('color_reset')}
        </button>
      </div>

      <p className="flex items-center gap-1.5 text-[11px] text-text-subtle mt-2">
        <span className="w-3 h-3 rounded-sm flex-shrink-0" style={{ backgroundColor: current }} />
        {chosen ? t('color_inUse') : t('color_usingDefault')}
      </p>

      {error && <p className="text-[11px] text-danger mt-1">{t('color_couldNotSave')}</p>}
    </div>
  )
}
