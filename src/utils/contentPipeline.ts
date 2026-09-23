import {
  ContentClient,
  ContentEdit,
  ContentPostDone,
  ContentPostRule,
  ContentRecording,
} from '../types'

/**
 * How a client's content moves from camera to feed.
 *
 * Nothing stores individual pieces. A recording of 4 adds pieces 1–4 and the
 * next one 5–8; an editing session of 3 finishes the next three pieces that
 * were recorded by its day and not yet edited; each posting slot publishes the
 * next finished piece that is ready by its day. Everything here works that out
 * from the sessions, so changing one date or count re-flows what comes after
 * it instead of leaving a piece pointing at a session that moved.
 *
 * Dates are plain YYYY-MM-DD strings throughout and every day of the week is a
 * working day — nothing here treats a weekend differently.
 */

// ─── Dates ──────────────────────────────────────────────────────────────────

const DAY = 864e5

function toUtc(day: string) {
  const [y, m, d] = day.split('-').map(Number)
  return Date.UTC(y, m - 1, d)
}

function fromUtc(ms: number) {
  return new Date(ms).toISOString().slice(0, 10)
}

export function addDays(day: string, n: number) {
  return fromUtc(toUtc(day) + n * DAY)
}

/** 0 = Sunday … 6 = Saturday. */
export function weekdayOf(day: string) {
  return new Date(toUtc(day)).getUTCDay()
}

/** The Monday of the week a day falls in. Weeks run Monday to Sunday. */
export function mondayOf(day: string) {
  return addDays(day, -((weekdayOf(day) + 6) % 7))
}

/**
 * The Monday after a day — when a delivered batch is scheduled. A Monday's
 * own batch waits for the next one.
 */
export function mondayAfter(day: string) {
  return addDays(mondayOf(day), 7)
}

export function daysBetween(from: string, to: string) {
  return Math.round((toUtc(to) - toUtc(from)) / DAY)
}

export function todayKey() {
  const d = new Date()
  return fromUtc(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()))
}

/** First and last day of the month a day falls in. */
export function monthBounds(day: string) {
  const [y, m] = day.split('-').map(Number)
  const first = fromUtc(Date.UTC(y, m - 1, 1))
  const last = fromUtc(Date.UTC(y, m, 0))
  return { first, last }
}

export function shiftMonth(day: string, n: number) {
  const [y, m] = day.split('-').map(Number)
  return fromUtc(Date.UTC(y, m - 1 + n, 1))
}

/** A day as people read it, in the language the app is in. See useContentT. */
export function formatDay(
  day: string,
  opts: Intl.DateTimeFormatOptions = { weekday: 'short', day: 'numeric', month: 'short' },
  locale = 'en-GB',
) {
  return new Date(toUtc(day)).toLocaleDateString(locale, { ...opts, timeZone: 'UTC' })
}

// ─── Ordering ───────────────────────────────────────────────────────────────

function byDate<T extends { createdAt: string }>(dateOf: (x: T) => string) {
  return (a: T, b: T) => dateOf(a).localeCompare(dateOf(b)) || a.createdAt.localeCompare(b.createdAt)
}

export const sortRecordings = (list: ContentRecording[]) =>
  [...list].sort(byDate<ContentRecording>((r) => r.recordedOn))

export const sortEdits = (list: ContentEdit[]) => [...list].sort(byDate<ContentEdit>((e) => e.editedOn))

// ─── Pieces ─────────────────────────────────────────────────────────────────

export interface Piece {
  /** 1-based, in the order the pieces were recorded. */
  n: number
  recordingId: string
  recordedOn: string
  editId: string | null
  editedOn: string | null
  /** When its batch goes to the client for approval, and into the scheduler. */
  deliverOn: string | null
  scheduleOn: string | null
  /** The first day it can go out: edited, delivered and scheduled. */
  readyOn: string | null
  /** The slot it goes out in, when one has been reached. */
  postOn: string | null
}

/**
 * When an editing session's pieces can start going out: the latest of the
 * edit itself, its delivery for approval and its scheduling. A batch that
 * has not been approved and scheduled is not ready, however long ago it was
 * edited.
 */
export function readyOnOf(e: Pick<ContentEdit, 'editedOn' | 'deliverOn' | 'scheduleOn'>) {
  return [e.editedOn, e.deliverOn, e.scheduleOn].filter((d): d is string => !!d).sort().pop()!
}

/** How many posts a week the rules in force on a day add up to. */
export function postsPerWeekOn(rules: ContentPostRule[], day: string) {
  return rules
    .filter((r) => r.startsOn <= day && (!r.endsOn || r.endsOn >= day))
    .reduce((n, r) => n + r.weekdays.length / Math.max(1, r.everyWeeks || 1), 0)
}

export interface EditFlow {
  edit: ContentEdit
  /** When its pieces can start going out. See readyOnOf. */
  readyOn: string
  /** Recorded by this session's day and not edited by an earlier session. */
  available: number
  /** How many it actually finishes: its count, capped at what is available. */
  takes: number
  /** Pieces it asks for that had not been recorded yet. */
  short: number
  /** Numbers of the pieces it finishes. */
  from: number
  to: number
}

export interface PostSlot {
  day: string
  /** The piece it publishes, or null when nothing edited is ready by then. */
  piece: Piece | null
  done: ContentPostDone | null
  rule: ContentPostRule
}

export interface ClientFlow {
  pieces: Piece[]
  edits: EditFlow[]
  slots: PostSlot[]
}

/** Every day a client's rules post on, from the first rule up to `until`. */
export function postDays(rules: ContentPostRule[], until: string) {
  const days = new Map<string, ContentPostRule>()
  for (const rule of rules) {
    if (rule.weekdays.length === 0) continue
    const end = rule.endsOn && rule.endsOn < until ? rule.endsOn : until
    const anchor = mondayOf(rule.startsOn)
    const every = Math.max(1, rule.everyWeeks || 1)
    for (let d = rule.startsOn; d <= end; d = addDays(d, 1)) {
      if (!rule.weekdays.includes(weekdayOf(d))) continue
      const week = Math.floor(daysBetween(anchor, mondayOf(d)) / 7)
      if (week % every !== 0) continue
      // Two rules on the same day are still one post: a client posts once a
      // day, and that is what a tick is keyed by.
      if (!days.has(d)) days.set(d, rule)
    }
  }
  return [...days.entries()].sort((a, b) => a[0].localeCompare(b[0]))
}

/**
 * Follow a client's content through all four stages, up to `until`.
 * Slots are only generated up to that day, since an open-ended rule never
 * runs out; pieces and edits are always complete.
 */
export function flowFor(
  recordings: ContentRecording[],
  edits: ContentEdit[],
  rules: ContentPostRule[],
  done: ContentPostDone[],
  until: string,
): ClientFlow {
  const pieces: Piece[] = []
  for (const r of sortRecordings(recordings)) {
    for (let i = 0; i < r.pieces; i++) {
      pieces.push({
        n: pieces.length + 1,
        recordingId: r.id,
        recordedOn: r.recordedOn,
        editId: null,
        editedOn: null,
        deliverOn: null,
        scheduleOn: null,
        readyOn: null,
        postOn: null,
      })
    }
  }

  // Edits take pieces in recording order. A piece recorded after an edit's
  // day cannot be in it, however many the edit asks for.
  const flows: EditFlow[] = []
  let edited = 0
  for (const e of sortEdits(edits)) {
    const recordedBy = pieces.filter((p) => p.recordedOn <= e.editedOn).length
    const available = Math.max(0, recordedBy - edited)
    const takes = Math.min(e.pieces, available)
    const readyOn = readyOnOf(e)
    for (let i = edited; i < edited + takes; i++) {
      pieces[i].editId = e.id
      pieces[i].editedOn = e.editedOn
      pieces[i].deliverOn = e.deliverOn
      pieces[i].scheduleOn = e.scheduleOn
      pieces[i].readyOn = readyOn
    }
    flows.push({ edit: e, readyOn, available, takes, short: e.pieces - takes, from: edited + 1, to: edited + takes })
    edited += takes
  }

  // Each slot posts the next piece that is ready by its day. A slot with
  // nothing ready stays empty rather than holding a piece back, so it shows
  // up as a gap to fill.
  const doneOn = new Map(done.map((d) => [d.postedOn, d]))
  const slots: PostSlot[] = []
  let next = 0
  for (const [day, rule] of postDays(rules, until)) {
    const p = pieces[next]
    const ready = p && p.readyOn && p.readyOn <= day ? p : null
    if (ready) {
      ready.postOn = day
      next++
    }
    slots.push({ day, piece: ready, done: doneOn.get(day) ?? null, rule })
  }

  return { pieces, edits: flows, slots }
}

/**
 * How many pieces an editing session on `day` could take: recorded by then,
 * less what sessions before it already finished. `excludeId` leaves the
 * session being edited out, so its own count does not count against it.
 */
export function availableToEdit(
  recordings: ContentRecording[],
  edits: ContentEdit[],
  day: string,
  excludeId: string | null,
  createdAt = '9999',
) {
  const recordedBy = recordings.filter((r) => r.recordedOn <= day).reduce((n, r) => n + r.pieces, 0)
  const before = sortEdits(edits.filter((e) => e.id !== excludeId)).filter(
    (e) => e.editedOn < day || (e.editedOn === day && e.createdAt < createdAt),
  )
  // Replay the earlier sessions, since one that asked for more than was
  // recorded only took what there was.
  let taken = 0
  for (const e of before) {
    const avail = recordings.filter((r) => r.recordedOn <= e.editedOn).reduce((n, r) => n + r.pieces, 0) - taken
    taken += Math.min(e.pieces, Math.max(0, avail))
  }
  return { recordedBy, taken, available: Math.max(0, recordedBy - taken) }
}

/** The tag a piece carries everywhere: ESP 03. */
export function pieceTag(client: Pick<ContentClient, 'code'>, n: number) {
  return `${client.code} ${String(n).padStart(2, '0')}`
}

/**
 * How often to record for a monthly target, given how many videos a shoot
 * produces. A month is taken as 4.3 weeks.
 */
export function suggestCadence(postsPerMonth: number, perShoot: number) {
  if (postsPerMonth <= 0 || perShoot <= 0) return null
  const shootsPerMonth = postsPerMonth / perShoot
  const weeks = 4.3 / shootsPerMonth
  const every = weeks >= 3.5 ? 4 : weeks >= 1.5 ? 2 : 1
  const perMonth = Math.round((4.3 / every) * perShoot)
  return { shootsPerMonth, every, perMonth }
}
