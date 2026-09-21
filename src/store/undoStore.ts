import { create } from 'zustand'

/**
 * One thing that was done, and how to take it back.
 *
 * `undo` and `redo` are closures over whatever the action needed — the row it
 * deleted, the day it moved something from — so the stack itself never has to
 * know what kind of action it is holding.
 */
export interface UndoEntry {
  /** Named in the toast: "Undone — moved a task". */
  label: string
  undo: () => Promise<void>
  redo: () => Promise<void>
}

/**
 * Cmd+Z across the app.
 *
 * Every action that changes the plan records how to reverse itself as it
 * happens, rather than the stack trying to work it out afterwards. That is the
 * only way this can be exact: an action knows what it replaced, and a minute
 * later nothing else does.
 *
 * In memory and per session, which is what Cmd+Z means everywhere else — it
 * takes back what *you* just did, on this screen, not what somebody did to the
 * project yesterday. Reloading starts a fresh stack.
 *
 * It is not a transaction log and does not pretend the work is exclusively
 * yours: somebody else may have changed the same task since. An undo that the
 * database refuses says so and stays undone rather than lying about it.
 */
interface UndoState {
  past: UndoEntry[]
  future: UndoEntry[]
  /**
   * True while an undo or redo is being applied. The actions being replayed go
   * through the same store methods as everything else, and without this each
   * would record itself onto the stack it is being popped from.
   */
  busy: boolean
  /** What just happened, for the toast. Cleared by the toast itself. */
  notice: { text: string; kind: 'ok' | 'none' | 'error' } | null

  record: (entry: UndoEntry) => void
  undo: () => Promise<void>
  redo: () => Promise<void>
  clearNotice: () => void
  /** Emptied on sign-out: one person's actions are not another's to take back. */
  reset: () => void
}

/** How many steps back it is worth being able to go. */
const LIMIT = 50

export const useUndoStore = create<UndoState>()((set, get) => ({
  past: [],
  future: [],
  busy: false,
  notice: null,

  record: (entry) => {
    // Replaying is not doing.
    if (get().busy) return
    set((s) => ({
      past: [...s.past, entry].slice(-LIMIT),
      // A new action is a new branch: whatever had been undone is no longer
      // reachable, the same as every other editor.
      future: [],
    }))
  },

  undo: async () => {
    const { past, busy } = get()
    if (busy) return
    const entry = past[past.length - 1]
    if (!entry) {
      set({ notice: { text: 'Nothing to undo', kind: 'none' } })
      return
    }

    set({ busy: true })
    try {
      await entry.undo()
      set((s) => ({
        past: s.past.slice(0, -1),
        future: [...s.future, entry],
        notice: { text: `Undone — ${entry.label}`, kind: 'ok' },
      }))
    } catch (e) {
      // Left on the stack: it did not happen, so it is still the last thing
      // that did.
      set({ notice: { text: (e as Error).message || 'That could not be undone', kind: 'error' } })
    } finally {
      set({ busy: false })
    }
  },

  redo: async () => {
    const { future, busy } = get()
    if (busy) return
    const entry = future[future.length - 1]
    if (!entry) {
      set({ notice: { text: 'Nothing to redo', kind: 'none' } })
      return
    }

    set({ busy: true })
    try {
      await entry.redo()
      set((s) => ({
        future: s.future.slice(0, -1),
        past: [...s.past, entry],
        notice: { text: `Redone — ${entry.label}`, kind: 'ok' },
      }))
    } catch (e) {
      set({ notice: { text: (e as Error).message || 'That could not be redone', kind: 'error' } })
    } finally {
      set({ busy: false })
    }
  },

  clearNotice: () => set({ notice: null }),

  reset: () => set({ past: [], future: [], notice: null }),
}))

/**
 * Record an action, from anywhere.
 *
 * A plain function rather than a hook so store actions can call it: they are
 * not components and have no hooks to call.
 */
export function recordUndo(entry: UndoEntry) {
  useUndoStore.getState().record(entry)
}
