import React from 'react'
import { usePersonColor } from '../../store/employeeStore'

/**
 * Somebody's initials on their own colour.
 *
 * The colour is the one picked for them when they were added, so it is the
 * same here as on their blocks in the calendar and across their side of the
 * app. It redraws the moment it is changed.
 */
export function Avatar({
  id,
  initials,
  name,
  size = 32,
  rounded = 'full',
  className = '',
  title,
  color,
}: {
  /** Whose avatar. The colour is looked up from this. */
  id: string | null | undefined
  /** Preferred, when the record carries them. */
  initials?: string | null
  /** Fallen back on when it does not: first letters of the first two words. */
  name?: string | null
  size?: number
  rounded?: 'full' | 'lg' | '2xl'
  className?: string
  title?: string
  /** Drawn in this instead of their saved colour: a preview while picking. */
  color?: string
}) {
  const saved = usePersonColor(id)
  const letters =
    initials?.trim() ||
    (name ?? '')
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0])
      .join('')
      .toUpperCase() ||
    '?'

  return (
    <div
      title={title ?? name ?? undefined}
      className={`${
        rounded === 'full' ? 'rounded-full' : rounded === 'lg' ? 'rounded-lg' : 'rounded-2xl'
      } flex items-center justify-center flex-shrink-0 ${className}`}
      style={{
        width: size,
        height: size,
        backgroundColor: color ?? saved,
      }}
    >
      <span
        className="text-white font-bold leading-none"
        // Scaled to the circle rather than fixed, so the same component works
        // at 24px in a list and at 64px on a profile.
        style={{ fontSize: Math.max(9, Math.round(size * 0.38)) }}
      >
        {letters}
      </span>
    </div>
  )
}
