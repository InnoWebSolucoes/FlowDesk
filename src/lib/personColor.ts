/**
 * What colour a piece of work is drawn in.
 *
 * This used to be a colour per person, so a week with several people's work
 * on it could be read at a glance. There is one manager now and the people
 * whose work appears on a calendar are the employees, so the useful question
 * is no longer "whose is this" but "is this ours or theirs" — two colours
 * rather than eight, and no hashing to decide which.
 */

/** The one account that manages everything. */
const INNOWEB_ID = '1e2001c5-72b2-44a6-9605-9954db51908e'

/**
 * Employees' work. One purple for all of them: any given calendar shows a
 * single employee's week, so a colour each distinguished nothing the board
 * was not already saying.
 */
const EMPLOYEE = '#6B21A8'

/**
 * InnoWeb's own. Grey, because the manager's todos sit alongside the work
 * they have handed out, and the work handed out is what should stand out.
 */
const INNOWEB = '#6B7280'

/**
 * The colour for whoever this work belongs to.
 *
 * Everything belongs to somebody — an employee, or InnoWeb. A missing id
 * falls to the employee colour rather than a third "nobody" colour: work
 * owned by no one is a bug to fix where it is created, not a state to give
 * a swatch to.
 */
export function personColor(id: string | null | undefined): string {
  return id === INNOWEB_ID ? INNOWEB : EMPLOYEE
}

/**
 * The colours offered for a person's calendar colour.
 *
 * Chosen to be told apart from each other when three of them sit in one day
 * of a week view, and to carry white text: a block on the calendar is filled
 * with the person's colour and labelled in white, so a pale swatch would be a
 * block you cannot read. The first is the employee purple the calendar used
 * for everybody, so "what it was before" is a choice like any other.
 */
export const CALENDAR_COLORS = [
  '#6B21A8', '#1D4ED8', '#0E7A6A', '#15803D', '#A16207', '#B45309',
  '#B91C1C', '#BE185D', '#7E22CE', '#0F766E', '#334155', '#6B7280',
] as const

/**
 * Whether a string is one of our hex colours. The column is checked in the
 * database too; this stops a bad value reaching the stylesheet from a stale
 * row that predates the check.
 */
export function isHexColor(v: string | null | undefined): v is string {
  return !!v && /^#[0-9A-Fa-f]{6}$/.test(v)
}

/**
 * What to paint one person's work on the calendar of tasks: the colour chosen
 * on their profile, or the old two-colour answer when nobody has chosen one.
 *
 * Deliberately separate from personColor, which Avatars use. A colour set here
 * is about reading a calendar with several people's weeks on it, and spreading
 * it to avatars would change how people are drawn all over the app — which is
 * not what was asked for and not what it means.
 */
export function calendarColorOf(
  id: string | null | undefined,
  people: { id: string; calendarColor?: string | null }[],
): string {
  const chosen = people.find((p) => p.id === id)?.calendarColor
  return isHexColor(chosen) ? chosen : personColor(id)
}

/** Is this InnoWeb's own work rather than an employee's? */
export function isInnoweb(id: string | null | undefined): boolean {
  return id === INNOWEB_ID
}

/**
 * Whose todo this is: explicitly assigned, else whose list it sits on, else
 * whoever added it.
 *
 * A todo on the shared board has no owner, and one nobody has been assigned
 * has no assignee, so the pair alone left todos belonging to nobody. Every
 * todo is created by somebody, so the creator is the answer whenever the
 * other two are silent: if you added it to your own list it is yours, and it
 * stops being yours only when it is assigned to someone else.
 */
export function todoOwner(todo: {
  assigneeId?: string | null
  ownerId?: string | null
  createdBy?: string | null
}): string | null {
  return todo.assigneeId ?? todo.ownerId ?? todo.createdBy ?? null
}
