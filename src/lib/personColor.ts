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
 * How far apart two colours must be to read as different once the calendar
 * has diluted them into block backgrounds. Out of a possible 441; the
 * palette above was spaced so its closest pair clears it.
 */
const MIN_DISTANCE = 32

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

/** #rgb or #rrggbb to its three channels. Null if it is neither. */
function channels(hex: string): [number, number, number] | null {
  const h = hex.trim().replace(/^#/, '')
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h
  if (!/^[0-9a-fA-F]{6}$/.test(full)) return null
  const n = parseInt(full, 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

const hex2 = (n: number) => Math.round(Math.max(0, Math.min(255, n))).toString(16).padStart(2, '0')

/**
 * How far apart two colours are, summed over the channels. The same crude
 * measure the palette was spaced by, and crude is the point: it is what
 * survives being diluted into a calendar block background.
 */
function distance(a: string, b: string): number {
  const x = channels(a)
  const y = channels(b)
  if (!x || !y) return 441
  return Math.abs(x[0] - y[0]) + Math.abs(x[1] - y[1]) + Math.abs(x[2] - y[2])
}

/**
 * The entity's colour first, then the palette, skipping anything too close to it.
 *
 * Stepping along the brand hue was the obvious idea and it does not survive
 * the edges: a midnight-blue or near-white brand has no room in one
 * direction, and its people collapse into the same near-black. So only the
 * first person wears the brand colour itself, and the rest come from the
 * palette that was already spaced to stay apart — minus any entry that would
 * be mistaken for the brand colour beside it.
 */
function brandRamp(brand: string): string[] {
  const rest = PALETTE.filter((c) => distance(c, brand) >= MIN_DISTANCE)
  return [brand, ...rest]
}

/**
 * The person's colour, as a hex string.
 *
 * A hand-picked colour wins; then the entity's brand colour, so people read
 * as belonging to the company they work for; then the neutral palette, for
 * anyone whose entity has not set one.
 *
 * `roster` is the ids of everyone on the project. Given it, colours are
 * handed out by position, which is the only way to guarantee two people on
 * one calendar never share one — hashing each id independently collides
 * however well spaced the palette is. Without it the hash is used, so every
 * existing caller keeps working unchanged.
 */
export function personColor(
  id: string | null | undefined,
  brand?: string | null,
  roster?: readonly string[] | null,
): string {
  if (!id) return PALETTE[0]
  const chosen = CHOSEN[id]
  if (chosen) return chosen

  const ramp = brand && channels(brand) ? brandRamp(brand) : [...PALETTE]

  if (roster && roster.length > 0) {
    // Sorted so the order is the roster's membership, not the order it
    // happened to load in; a colour must not change between renders.
    const ordered = [...new Set(roster)].sort()
    const seat = ordered.indexOf(id)
    if (seat >= 0) {
      // Anyone with a hand-picked colour does not consume a ramp seat, so
      // the people who need one get as far through the ramp as possible
      // before it has to wrap.
      const seatsUsed = ordered.slice(0, seat).filter((x) => !CHOSEN[x]).length
      return ramp[seatsUsed % ramp.length]
    }
  }

  return ramp[hash(id) % ramp.length]
}

/**
 * The same colour at low opacity, for a background that has to sit behind
 * ordinary body text rather than white.
 */
export function personTint(
  id: string | null | undefined,
  alpha = 0.14,
  brand?: string | null,
): string {
  const c = channels(personColor(id, brand))
  if (!c) return `rgba(0, 0, 0, ${alpha})`
  return `rgba(${c[0]}, ${c[1]}, ${c[2]}, ${alpha})`
}

/** Exported so the spacing rule can be checked, not for rendering. */
export const __test = { brandRamp, distance, PALETTE, MIN_DISTANCE }

/**
 * The ids of everyone on a project, in the order colours are handed out in.
 *
 * Both the calendar and the team page need this list and they must agree: a
 * different roster gives the same person a different seat, and their avatar
 * would stop matching their blocks. Membership is `projectIds` where the
 * record carries it and the legacy single `projectId` where it does not.
 */
export function projectRoster(
  people: readonly { id: string; projectId?: string | null; projectIds?: string[] }[],
  projectId: string | null | undefined,
): string[] {
  if (!projectId) return []
  return people
    .filter((p) => (p.projectIds?.length ? p.projectIds.includes(projectId) : p.projectId === projectId))
    .map((p) => p.id)
    .sort()
}
