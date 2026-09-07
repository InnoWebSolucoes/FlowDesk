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
 * Eight hues spaced around the wheel, and eight rather than ten deliberately.
 *
 * The list used to hold near-duplicates — orange beside amber, teal beside
 * cyan — and once the calendar diluted them into block backgrounds those pairs
 * were 7 units apart in RGB out of a possible 441. Indistinguishable. Dropping
 * indigo and cyan, whose neighbours already covered them, and pushing the rest
 * apart takes the closest pair to 32.
 *
 * Warm and cool alternate, because consecutive entries are what two people
 * added one after another will get.
 */
const PALETTE = [
  '#1D4ED8', // blue
  '#DC2626', // red
  '#0891B2', // cyan
  '#B8860B', // gold
  '#7C3AED', // violet
  '#3F9142', // green
  '#DB2777', // magenta
  '#334155', // slate
] as const

/**
 * Colours chosen for a particular person, which win over the derived one.
 *
 * The palette exists so nobody has to be assigned a colour by hand, but a
 * specific request beats a hash, and asking for one is a perfectly good
 * reason to have it.
 */
const CHOSEN: Record<string, string> = {
  // Kasim — midnight blue.
  '5719747f-ccc2-4e4e-8b10-13bb026fe725': '#0B1E3D',
}

/**
 * Whose avatar gets a starfield over its colour. Purely decorative, and drawn
 * as a background layer so it costs nothing where it is not wanted.
 */
const STARRED = new Set<string>([
  '5719747f-ccc2-4e4e-8b10-13bb026fe725', // Kasim
])

/** Does this person's colour carry stars? */
export function personHasStars(id: string | null | undefined): boolean {
  return !!id && STARRED.has(id)
}

/**
 * A scattering of stars as a CSS background, layered over the flat colour.
 * Fixed positions rather than random ones, so the avatar does not change
 * between renders.
 */
export function personStarLayer(id: string | null | undefined): string | undefined {
  if (!personHasStars(id)) return undefined
  const star = (x: number, y: number, r: number, a: number) =>
    `radial-gradient(circle ${r}px at ${x}% ${y}%, rgba(255,255,255,${a}) 0%, rgba(255,255,255,0) 100%)`
  return [
    star(18, 22, 1.1, 0.95),
    star(72, 16, 0.8, 0.75),
    star(38, 62, 0.9, 0.85),
    star(84, 58, 1.1, 0.9),
    star(58, 84, 0.7, 0.7),
    star(12, 78, 0.8, 0.8),
    star(90, 34, 0.6, 0.6),
  ].join(', ')
}

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
  return CHOSEN[id] ?? PALETTE[hash(id) % PALETTE.length]
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
