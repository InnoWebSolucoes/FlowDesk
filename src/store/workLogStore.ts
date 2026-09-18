import { create } from 'zustand'
import { supabase } from '../lib/supabaseClient'
import { WorkLogComment, WorkLogEntry } from '../types'
import { useAuthStore } from './authStore'

function toComment(row: any): WorkLogComment {
  return {
    id: row.id,
    entryId: row.entry_id,
    authorId: row.author_id,
    body: row.body,
    createdAt: row.created_at,
  }
}

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
   * The comments on each entry, by entry id, oldest first. Loaded for the
   * whole project in one go, so every card can show its count without a
   * request of its own.
   */
  comments: Record<string, WorkLogComment[]>

  load: (projectId: string) => Promise<void>
  /** Say something on an entry. */
  addComment: (entryId: string, body: string) => Promise<void>
  removeComment: (id: string, entryId: string) => Promise<void>
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

export const useWorkLogStore = create<WorkLogState>()((set) => ({
  entries: [],
  loadedFor: null,
  loading: false,
  comments: {},

  addComment: async (entryId, body) => {
    // Whoever the app is acting as, for the same reason add() uses it: viewing
    // an employee's side as them, the words are theirs.
    const uid = useAuthStore.getState().currentUser?.id
    if (!uid) throw new Error('You are not signed in.')

    const { data, error } = await supabase
      .from('work_log_comments')
      .insert({ entry_id: entryId, author_id: uid, body })
      .select()
      .single()

    if (error || !data) {
      console.error('[workLog] comment failed:', error)
      throw new Error(error?.message ?? 'That could not be saved.')
    }

    set((s) => ({
      comments: { ...s.comments, [entryId]: [...(s.comments[entryId] ?? []), toComment(data)] },
    }))
  },

  removeComment: async (id, entryId) => {
    const { error } = await supabase.from('work_log_comments').delete().eq('id', id)
    if (error) {
      console.error('[workLog] comment delete failed:', error)
      throw new Error(error.message)
    }
    set((s) => ({
      comments: {
        ...s.comments,
        [entryId]: (s.comments[entryId] ?? []).filter((c) => c.id !== id),
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
    set({ entries, loadedFor: projectId, loading: false })

    // The comments on all of them, in one request rather than one per card.
    if (entries.length === 0) {
      set({ comments: {} })
      return
    }

    const { data: rows } = await supabase
      .from('work_log_comments')
      .select('*')
      .in('entry_id', entries.map((e) => e.id))
      .order('created_at', { ascending: true })

    const comments: Record<string, WorkLogComment[]> = {}
    for (const row of rows ?? []) {
      const c = toComment(row)
      ;(comments[c.entryId] ??= []).push(c)
    }
    set({ comments })
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
