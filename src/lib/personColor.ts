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
 * A deadline: when something is due, rather than when it is meant to be
 * done. Drawn as a faded outline rather than filled, so a week of due dates
 * does not read as a week of work.
 */
export const DEADLINE_RED = '#DC2626'

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
