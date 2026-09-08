import { supabase } from './supabaseClient'

/**
 * Records that somebody is using the app, and for how long.
 *
 * Measured with a heartbeat rather than by pairing an open event with a close
 * one. Browsers do not reliably fire anything on close — a phone that sleeps
 * or a tab killed under memory pressure simply stops, and `beforeunload` never
 * runs — so a session ended that way would either be lost or left open
 * forever. A heartbeat moves `ended_at` forward while the app is actually in
 * front of somebody; when it stops, the row already holds the last moment we
 * knew they were there.
 *
 * Time spent with the window hidden does not count. The tab left open in the
 * background all weekend is not eight hours of use, and counting it that way
 * would make the numbers meaningless.
 */

/** How often to extend the session while the app is visible. */
const HEARTBEAT_MS = 60_000

/**
 * Idle long enough that the next beat starts a fresh session rather than
 * extending the old one. Coming back after lunch is a new visit; glancing at
 * another tab for a moment is not.
 */
const SESSION_GAP_MS = 30 * 60_000

let sessionId: string | null = null
let timer: ReturnType<typeof setInterval> | null = null
let lastBeat = 0
let userId: string | null = null

/** Roughly what they are using, for when a number needs explaining. */
function platform(): string {
  if (typeof navigator === 'undefined') return ''
  // The desktop shell sets this; otherwise fall back to the browser's UA.
  const isDesktop = typeof window !== 'undefined' && !!(window as { flowdeskDesktop?: unknown }).flowdeskDesktop
  return (isDesktop ? 'desktop ' : 'web ') + (navigator.userAgent ?? '').slice(0, 180)
}

async function startSession() {
  if (!userId) return
  // Through a function rather than a plain insert: reading this table is the
  // owner's alone, and `insert ... returning` needs select privilege, so a
  // direct insert would give an employee no id back and their visits would go
  // unrecorded. The function returns the id without granting them any read.
  const { data, error } = await supabase.rpc('app_session_start', {
    p_platform: platform(),
  })

  // Tracking must never interrupt the app: a refused call or a dropped
  // connection means this visit goes unrecorded, and that is all.
  if (error || !data) {
    sessionId = null
    return
  }
  sessionId = data as string
  lastBeat = Date.now()
}

async function beat() {
  if (!userId) return
  // Only while they are actually looking at it.
  if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return

  const now = Date.now()

  // Away long enough that this is a new visit rather than the same one.
  if (!sessionId || now - lastBeat > SESSION_GAP_MS) {
    await startSession()
    return
  }

  lastBeat = now
  // Scoped to the caller's own row inside the function, and returns nothing.
  await supabase.rpc('app_session_beat', { p_session: sessionId })
}

/**
 * Begin recording for this user. Safe to call again — a second call for the
 * same person is ignored, and for a different person starts them a session.
 */
export function startTracking(id: string) {
  if (userId === id && timer) return
  stopTracking()
  userId = id

  void startSession()
  timer = setInterval(() => void beat(), HEARTBEAT_MS)

  // Coming back to the tab should extend or reopen straight away rather than
  // waiting up to a full beat.
  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', onVisibility)
  }
}

function onVisibility() {
  if (document.visibilityState === 'visible') void beat()
}

/** Stop recording, on sign-out or teardown. */
export function stopTracking() {
  if (timer) {
    clearInterval(timer)
    timer = null
  }
  if (typeof document !== 'undefined') {
    document.removeEventListener('visibilitychange', onVisibility)
  }
  sessionId = null
  userId = null
  lastBeat = 0
}
