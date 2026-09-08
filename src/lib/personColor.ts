/**
 * A colour per person, the same one everywhere they appear.
 *
 * These are assigned by hand, not derived. A hash spread people across a
 * palette without anyone choosing which person got which colour, so nobody
 * matched their own branding and the only way to change a colour was to
 * change the person's id. The list below is the whole of it: to give somebody
 * a colour, add them to it.
 *
 * Every colour here is dark enough to carry white text, because the calendar
 * paints blocks in the colour itself rather than a wash of it.
 */

/** FlowDesk's own green, from the logo and tailwind's `primary`. */
const FLOWDESK_GREEN = '#1A5C3A'

/**
 * Who is what colour.
 *
 * Keyed by user id. Names are in the comments because ids are unreadable and
 * the next person to edit this needs to know whose colour they are changing.
 */
const CHOSEN: Record<string, string> = {
  // InnoWeb Admin (innowebsolucoes@gmail.com) — FlowDesk's green, the same
  // one as the logo.
  '1e2001c5-72b2-44a6-9605-9954db51908e': FLOWDESK_GREEN,
  // Kasim (kasimcustodio@gmail.com) — dark blue.
  '5719747f-ccc2-4e4e-8b10-13bb026fe725': '#1B3A8A',
  // Rafael (rafamdann@gmail.com) — green, but a yellower one than FlowDesk's
  // deep forest green: the two sat 52 apart out of 441 and read as the same
  // colour side by side on a week.
  'b63d846e-1780-4040-9a3a-468fb9bfb683': '#4D7C0F',
}

/**
 * Colours for people whose id is not known here, matched on name instead.
 *
 * Ids live in the database and are not to hand, but names are on screen. A
 * name is a weaker key than an id — two people could share one, and renaming
 * somebody drops them back to the fallback — so it is only consulted after
 * the id lookup above. Moving somebody into CHOSEN once their id is known is
 * the better home for them.
 */
const CHOSEN_BY_NAME: Record<string, string> = {
  // Esmael is not an admin, so he was not in the account listing the other
  // ids came from. Purple.
  esmael: '#6B21A8',
}

/**
 * Everyone else, in a fixed order, so two people without an assigned colour
 * still look different from each other. Spaced around the wheel and all dark
 * enough for white text.
 */
const FALLBACK = [
  '#B45309', // amber
  '#9F1239', // crimson
  '#0E7490', // teal
  '#4338CA', // indigo
  '#A21CAF', // magenta
  '#3F6212', // olive
  '#334155', // slate
  '#7C2D12', // rust
] as const

/**
 * Whose colour carries a starfield. Purely decorative, and drawn as a
 * background layer so it costs nothing where it is not wanted.
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
 * Only used for people who have not been given a colour.
 */
function hash(id: string): number {
  let h = 0
  for (let i = 0; i < id.length; i++) {
    h = (h * 31 + id.charCodeAt(i)) | 0
  }
  return Math.abs(h)
}

/** The first word of a name, lowercased — how CHOSEN_BY_NAME is keyed. */
function firstName(name: string): string {
  return name.trim().split(/\s+/)[0]?.toLowerCase() ?? ''
}

/**
 * The person's colour, as an opaque hex string.
 *
 * `name` is optional and only consulted for people who have an assigned
 * colour but whose id is not recorded here yet.
 */
export function personColor(
  id: string | null | undefined,
  name?: string | null,
): string {
  if (id && CHOSEN[id]) return CHOSEN[id]

  if (name) {
    const byName = CHOSEN_BY_NAME[firstName(name)]
    if (byName) return byName
  }

  if (!id) return FALLBACK[0]
  return FALLBACK[hash(id) % FALLBACK.length]
}

/**
 * Whose todo this is: explicitly assigned, else whose list it sits on, else
 * whoever added it.
 *
 * A todo on the shared board has no owner, and one nobody has been assigned
 * has no assignee, so the pair alone left todos belonging to nobody — which
 * on the calendar meant a block with no one's colour. Every todo is created
 * by somebody, so the creator is the answer whenever the other two are
 * silent: if you added it to your own list it is yours, and it stops being
 * yours only when it is assigned to someone else.
 */
export function todoOwner(todo: {
  assigneeId?: string | null
  ownerId?: string | null
  createdBy?: string | null
}): string | null {
  return todo.assigneeId ?? todo.ownerId ?? todo.createdBy ?? null
}
