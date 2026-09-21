import { create } from 'zustand'
import { supabase } from '../lib/supabaseClient'
import { useAuthStore } from './authStore'
import { recordUndo } from './undoStore'

/** What kind of thing is being placed in a day. */
export type DayItemKind = 'task' | 'todo' | 'entry'

/** One item's place in one person's day. */
export interface DayOrderItem {
  kind: DayItemKind
  itemId: string
}

/** `${ownerId}:${day}` — the day being arranged. */
function dayKeyFor(ownerId: string, day: string) {
  return `${ownerId}:${day}`
}

function itemKey(kind: DayItemKind, itemId: string) {
  return `${kind}:${itemId}`
}

/**
 * The order of a day's work, as somebody arranged it.
 *
 * The calendar and My Tasks both draw the same day, and until now each decided
 * its own order — urgent-first on one, guessed time-of-day buckets on the
 * other. This holds the one order they now share, so dragging a block on the
 * calendar moves it in My Tasks too.
 *
 * Kept as a position per item rather than an array per day, because the two
 * views do not draw the same items: the calendar has the person's busy blocks
 * and their own todos alongside their assigned work, My Tasks has the assigned
 * work alone. A position each means either view can order what it happens to
 * be showing without needing to know about the rest.
 */
interface DayOrderState {
  /** `${ownerId}:${day}` -> `${kind}:${itemId}` -> position. */
  positions: Record<string, Record<string, number>>
  /** Whose orders have been fetched, so a second view does not refetch. */
  loadedFor: string | null

  load: (ownerIds: string[]) => Promise<void>
  teardown: () => void
  /** Listen for a day rearranged on another screen. */
  subscribe: () => void

  /** The position of one item, or null when that day has never been arranged. */
  positionOf: (ownerId: string, day: string, kind: DayItemKind, itemId: string) => number | null
  /** Whether this day has been arranged by hand at all. */
  hasOrder: (ownerId: string, day: string) => boolean
  /**
   * Sort what a view is drawing into the day's order. Anything the day has no
   * position for keeps its place relative to the rest, after the ordered ones
   * — a task created since the day was arranged goes to the end rather than
   * jumping the queue.
   */
  sortForDay: <T>(
    ownerId: string,
    day: string,
    list: T[],
    identify: (item: T) => DayOrderItem | null,
  ) => T[]

  /** Write a day's order, in the order given. */
  setOrder: (ownerId: string, day: string, items: DayOrderItem[]) => Promise<void>
}

export const useDayOrderStore = create<DayOrderState>()((set, get) => ({
  positions: {},
  loadedFor: null,

  load: async (ownerIds) => {
    const ids = [...new Set(ownerIds.filter(Boolean))].sort()
    if (ids.length === 0) return
    const marker = ids.join(',')
    if (get().loadedFor === marker) return

    const { data, error } = await supabase
      .from('day_order')
      .select('owner_id, day, kind, item_id, position')
      .in('owner_id', ids)

    if (error) {
      // Absent until the migration has run. The views fall back to the order
      // they used before, so this is not worth shouting about.
      console.warn('[dayOrder] not available:', error.message)
      return
    }

    const positions: Record<string, Record<string, number>> = {}
    for (const row of data ?? []) {
      const dk = dayKeyFor(row.owner_id, row.day)
      ;(positions[dk] ??= {})[itemKey(row.kind, row.item_id)] = row.position
    }
    set({ positions, loadedFor: marker })
  },

  teardown: () => {
    if (channel) {
      supabase.removeChannel(channel)
      channel = null
    }
    set({ positions: {}, loadedFor: null })
  },

  subscribe: () => {
    if (channel) return
    channel = supabase
      .channel('day-order-live')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'day_order' }, () => {
        // Cheap enough to refetch whole: one row per item per arranged day.
        const marker = get().loadedFor
        if (!marker) return
        set({ loadedFor: null })
        get().load(marker.split(','))
      })
      .subscribe()
  },

  positionOf: (ownerId, day, kind, itemId) =>
    get().positions[dayKeyFor(ownerId, day)]?.[itemKey(kind, itemId)] ?? null,

  hasOrder: (ownerId, day) => {
    const day_ = get().positions[dayKeyFor(ownerId, day)]
    return !!day_ && Object.keys(day_).length > 0
  },

  sortForDay: (ownerId, day, list, identify) => {
    const positions = get().positions[dayKeyFor(ownerId, day)]
    if (!positions) return list

    // Decorated with the original index so the sort stays stable for
    // everything the day has no opinion about.
    return list
      .map((item, index) => {
        const id = identify(item)
        const pos = id ? positions[itemKey(id.kind, id.itemId)] : undefined
        return { item, index, pos }
      })
      .sort((a, b) => {
        if (a.pos != null && b.pos != null) return a.pos - b.pos
        // Unplaced work goes after placed work, in the order it arrived.
        if (a.pos != null) return -1
        if (b.pos != null) return 1
        return a.index - b.index
      })
      .map((d) => d.item)
  },

  setOrder: async (ownerId, day, items) => {
    const by = useAuthStore.getState().realUser?.id ?? null

    // The day as it stood, so Cmd+Z puts it back in that order. Read from
    // what is loaded rather than refetched: it is the order on screen that is
    // being replaced, and that is what should come back.
    const before = get().positions[dayKeyFor(ownerId, day)]
    const previous: DayOrderItem[] | null = before
      ? Object.entries(before)
          .sort((a, b) => a[1] - b[1])
          .map(([key]) => {
            const [kind, itemId] = key.split(':') as [DayItemKind, string]
            return { kind, itemId }
          })
      : null
    const rows = items.map((it, i) => ({
      owner_id: ownerId,
      day,
      kind: it.kind,
      item_id: it.itemId,
      position: i,
      updated_by: by,
      updated_at: new Date().toISOString(),
    }))

    // On screen first: a drag that waits for the network to land looks like a
    // drag that did not take.
    const dk = dayKeyFor(ownerId, day)
    set((s) => ({
      positions: {
        ...s.positions,
        [dk]: {
          ...s.positions[dk],
          ...Object.fromEntries(rows.map((r) => [itemKey(r.kind as DayItemKind, r.item_id), r.position])),
        },
      },
    }))

    const { error } = await supabase.from('day_order').upsert(rows)
    if (error) {
      console.error('[dayOrder] could not save the order:', error)
      throw new Error(error.message)
    }

    // Only worth recording against a day that had an order to go back to. The
    // first arrangement of a day has no previous order, and undoing it would
    // mean inventing one.
    if (previous?.length) {
      recordUndo({
        label: 'rearranged a day',
        undo: () => get().setOrder(ownerId, day, previous),
        redo: () => get().setOrder(ownerId, day, items),
      })
    }
  },
}))

/**
 * The live subscription. Outside the store because it is a connection, not
 * state: nothing renders from it and it must survive re-renders.
 */
let channel: ReturnType<typeof supabase.channel> | null = null
