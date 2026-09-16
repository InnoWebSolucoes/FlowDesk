/**
 * Urgent work goes first, everything else keeps the order it came in.
 *
 * There are no priority levels: a task or todo is either urgent or it is not,
 * and the urgent ones always sit at the top of whatever list they are in.
 * Array.prototype.sort is stable, so the order within each half is kept.
 */
export function urgentFirst<T extends { isUrgent?: boolean }>(list: T[]): T[] {
  return [...list].sort((a, b) => Number(!!b.isUrgent) - Number(!!a.isUrgent))
}

/** The highlight an urgent card or row gets, so it stands out the same everywhere. */
export const URGENT_CLASS = 'border-danger/60 bg-danger-bg/60 ring-1 ring-danger/30'
