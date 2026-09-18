import { create } from 'zustand'
import { supabase } from '../lib/supabaseClient'
import { WorkLogEntry } from '../types'
import { useAuthStore } from './authStore'

function toEntry(row: any): WorkLogEntry {
  return {
    id: row.id,
    projectId: row.project_id,
    authorId: row.author_id,
    workedOn: row.worked_on,
    title: row.title,
    description: row.description ?? '',
    minutes: row.minutes ?? null,
    createdAt: row.created_at,
    itemIds: (row.work_log_items ?? [])
      .filter((i: any) => i.item_id)
      .map((i: any) => i.item_id),
    links: (row.work_log_items ?? [])
      .filter((i: any) => i.url)
      .map((i: any) => ({ url: i.url as string, label: (i.label as string) ?? '' })),
  }
}

/**
 * What people actually did, beyond what they were assigned.
 *
 * A task covers the work that was planned. A day contains more than that — a
 * call, a fix, an hour on something nobody wrote down — and this is where that
 * goes, with whatever backs it up.
 */
interface WorkLogState {
  entries: WorkLogEntry[]
  loadedFor: string | null
  loading: boolean
  /**
   * Just enough about an entry to name its discussion and get back to it, by
   * id. Chat names a room after the entry it is about, and a manager's rooms
   * span projects — more than the one project `entries` holds at a time — so
   * this is kept apart from it.
   */
  entryInfo: Record<string, { title: string; authorId: string; projectId: string }>

  load: (projectId: string) => Promise<void>
  /** Look up the entries not already known. */
  ensureEntryInfo: (entryIds: string[]) => Promise<void>
  add: (input: {
    projectId: string
    title: string
    description: string
    minutes: number | null
    workedOn: string
    itemIds: string[]
    links: { url: string; label: string }[]
  }) => Promise<void>
  remove: (id: string) => Promise<void>
}

export const useWorkLogStore = create<WorkLogState>()((set, get) => ({
  entries: [],
  loadedFor: null,
  loading: false,
  entryInfo: {},

  ensureEntryInfo: async (entryIds) => {
    const have = get().entryInfo
    const missing = [...new Set(entryIds)].filter((id) => id && !have[id])
    if (missing.length === 0) return

    const { data } = await supabase
      .from('work_log_entries')
      .select('id, title, author_id, project_id')
      .in('id', missing)

    if (!data?.length) return
    set((s) => ({
      entryInfo: {
        ...s.entryInfo,
        ...Object.fromEntries(
          data.map((r) => [r.id, { title: r.title, authorId: r.author_id, projectId: r.project_id }])
        ),
      },
    }))
  },

  load: async (projectId) => {
    set({ loading: true })
    const { data, error } = await supabase
      .from('work_log_entries')
      .select('*, work_log_items(item_id, url, label)')
      .eq('project_id', projectId)
      .order('worked_on', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(500)

    if (error) {
      console.error('[workLog] load failed:', error)
      set({ loading: false })
      return
    }
    const entries = (data ?? []).map(toEntry)
    set((s) => ({
      entries,
      loadedFor: projectId,
      loading: false,
      // Whatever has been loaded here, chat can name without asking again.
      entryInfo: {
        ...s.entryInfo,
        ...Object.fromEntries(
          entries.map((e) => [e.id, { title: e.title, authorId: e.authorId, projectId: e.projectId }])
        ),
      },
    }))
  },

  add: async ({ projectId, title, description, minutes, workedOn, itemIds, links }) => {
    // Whoever the app is acting as. Viewing an employee's side as them, that
    // is the employee: the entry is theirs, and saving it under the real
    // account put it on a list nobody was looking at.
    const uid = useAuthStore.getState().currentUser?.id
    if (!uid) throw new Error('You are not signed in.')

    const { data, error } = await supabase
      .from('work_log_entries')
      .insert({
        project_id: projectId,
        author_id: uid,
        worked_on: workedOn,
        title,
        description,
        minutes,
      })
      .select()
      .single()

    if (error || !data) {
      console.error('[workLog] add failed:', error)
      throw new Error(error?.message ?? 'That could not be saved.')
    }

    // Documents and links are rows of their own, so a submission can carry
    // several of each.
    const attachments = [
      ...itemIds.map((item_id) => ({ entry_id: data.id, item_id, url: null, label: null })),
      ...links.map((l) => ({ entry_id: data.id, item_id: null, url: l.url, label: l.label })),
    ]
    if (attachments.length > 0) {
      const { error: attErr } = await supabase.from('work_log_items').insert(attachments)
      if (attErr) {
        console.error('[workLog] attachments failed:', attErr)
        throw new Error(`Saved, but the attachments did not: ${attErr.message}`)
      }
    }

    set((s) => ({
      entries: [
        { ...toEntry(data), itemIds, links },
        ...s.entries,
      ],
    }))
  },

  remove: async (id) => {
    const { error } = await supabase.from('work_log_entries').delete().eq('id', id)
    if (error) {
      console.error('[workLog] delete failed:', error)
      throw new Error(error.message)
    }
    set((s) => ({ entries: s.entries.filter((e) => e.id !== id) }))
  },
}))
