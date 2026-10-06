import React from 'react'
import { Check } from 'lucide-react'
import { Employee } from '../../types'
import { PERSON_COLORS, personColor } from '../../lib/personColor'
import { TranslationKey } from '../../i18n/translations'
import { useT } from '../../i18n/useT'

const same = (a: string, b: string) => a.toUpperCase() === b.toUpperCase()

/**
 * Colour → the first names of the other employees already drawn in it, so a
 * form can say who a colour would be shared with. Counts the default too:
 * two people nobody has picked for are both purple on the calendar, and that
 * is exactly the clash this is here to show.
 */
export function colorsTakenBy(people: Employee[], exceptId?: string): Record<string, string[]> {
  const taken: Record<string, string[]> = {}
  for (const p of people) {
    if (p.role !== 'employee' || p.id === exceptId) continue
    const hex = personColor(p.id, people).toUpperCase()
    ;(taken[hex] ??= []).push(p.name.split(' ')[0])
  }
  return taken
}

/** The first colour nobody has yet, for someone new. */
export function firstFreeColor(taken: Record<string, string[]>): string {
  return (PERSON_COLORS.find((c) => !taken[c.hex.toUpperCase()]) ?? PERSON_COLORS[0]).hex
}

/**
 * A row of colours to pick somebody's from.
 *
 * Controlled, and saves nothing itself: it sits in the add and edit forms and
 * the colour is written with the rest of the form. A colour somebody else
 * already has carries a dot and is named underneath once picked, so two
 * people on one calendar are not given the same colour by accident — but it
 * can still be chosen.
 */
export function ColorSwatches({
  value,
  onChange,
  takenBy = {},
}: {
  value: string
  onChange: (hex: string) => void
  takenBy?: Record<string, string[]>
}) {
  const { t } = useT()

  const options: { hex: string; label: string }[] = PERSON_COLORS.map((c) => ({
    hex: c.hex,
    label: t(`color_name_${c.name}` as TranslationKey),
  }))
  // A colour picked before this palette is still theirs, so it is shown and
  // stays selected rather than silently becoming one of these on save.
  if (!options.some((o) => same(o.hex, value))) options.unshift({ hex: value, label: value })

  const sharedWith = takenBy[value.toUpperCase()]

  return (
    <div>
      <div role="radiogroup" aria-label={t('ui_colour')} className="flex flex-wrap gap-2.5">
        {options.map(({ hex, label }) => {
          const on = same(hex, value)
          const others = takenBy[hex.toUpperCase()]
          return (
            <button
              key={hex}
              type="button"
              role="radio"
              aria-checked={on}
              aria-label={label}
              title={others ? `${label} · ${others.join(', ')}` : label}
              onClick={() => onChange(hex)}
              className="w-7 h-7 rounded-full flex items-center justify-center transition-transform hover:scale-110 focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-text-main"
              // The ring is the swatch's own colour, held off it by a gap of
              // white, so the selected one reads as larger rather than
              // outlined in some third colour.
              style={{ backgroundColor: hex, boxShadow: on ? `0 0 0 2px #fff, 0 0 0 4px ${hex}` : undefined }}
            >
              {on ? (
                <Check size={14} strokeWidth={3} className="text-white" />
              ) : others ? (
                <span className="w-1.5 h-1.5 rounded-full bg-white/80" />
              ) : null}
            </button>
          )
        })}
      </div>
      <p className="text-[11px] text-text-subtle mt-2.5">
        {sharedWith ? t('color_sameAs').replace('{names}', sharedWith.join(', ')) : t('color_hint')}
      </p>
    </div>
  )
}
