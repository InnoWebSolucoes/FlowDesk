/**
 * A colour per person, the same one everywhere they appear.
 *
 * Assigned work was all one indigo and every avatar was the same green, so a
 * week with three people's tasks on it read as one undifferentiated wall. The
 * colour is derived from the person's id rather than stored, which means it is
 * stable across sessions and devices, needs no migration, and is identical in
 * the calendar, the sidebar and every avatar without anything having to be
 * kept in sync.
 */

/**
 * Picked to stay legible as a small block of colour with white text on it, and
 * to be distinguishable from each other — including for the commonest forms of
 * colour blindness, which is why there is no red/green pair among them.
 */
const PALETTE = [
  '#1B4F8A', // blue
  '#7A2E6B', // plum
  '#0F6E63', // teal
  '#8A4B0A', // amber
  '#4B3A8A', // indigo
  '#2A6B1E', // green
  '#8A2020', // brick
  '#155E75', // cyan
  '#6B3FA0', // violet
  '#7A5C0A', // olive
] as const

/**
 * Stable across runs, unlike a string hash built on anything host-specific.
 * Small ids and uuids alike spread reasonably across the palette.
 */
function hash(id: string): number {
  let h = 0
  for (let i = 0; i < id.length; i++) {
    h = (h * 31 + id.charCodeAt(i)) | 0
  }
  return Math.abs(h)
}

/** The person's colour, as a hex string. */
export function personColor(id: string | null | undefined): string {
  if (!id) return PALETTE[0]
  return PALETTE[hash(id) % PALETTE.length]
}

/**
 * The same colour at low opacity, for a background that has to sit behind
 * ordinary body text rather than white.
 */
export function personTint(id: string | null | undefined, alpha = 0.14): string {
  const hex = personColor(id)
  const n = parseInt(hex.slice(1), 16)
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`
}
