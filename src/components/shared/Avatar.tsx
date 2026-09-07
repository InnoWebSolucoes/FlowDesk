import React from 'react'
import { personColor, personStarLayer } from '../../lib/personColor'

/**
 * Somebody's initials on their own colour.
 *
 * Every avatar in the app used to be the same green, so a list of people was a
 * column of identical circles and only the letters told them apart. The colour
 * comes from the person's id, so it is the same here as on their blocks in the
 * calendar.
 */
export function Avatar({
  id,
  initials,
  name,
  size = 32,
  rounded = 'full',
  className = '',
  title,
}: {
  /** Whose avatar. The colour is derived from this. */
  id: string | null | undefined
  /** Preferred, when the record carries them. */
  initials?: string | null
  /** Fallen back on when it does not: first letters of the first two words. */
  name?: string | null
  size?: number
  rounded?: 'full' | 'lg' | '2xl'
  className?: string
  title?: string
}) {
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
        backgroundColor: personColor(id),
        // A starfield over the colour, for whoever has one. backgroundImage is
        // painted above backgroundColor, so the two layer without a wrapper.
        backgroundImage: personStarLayer(id),
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
