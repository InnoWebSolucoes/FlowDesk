import { create } from 'zustand'
import { supabase } from '../lib/supabaseClient'
import { WorkLogEntry } from '../types'

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

  load: (projectId: string) => Promise<void>
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
    set({
      entries: (data ?? []).map(toEntry),
      loadedFor: projectId,
      loading: false,
    })
  },

  add: async ({ projectId, title, description, minutes, workedOn, itemIds, links }) => {
    const { data: auth } = await supabase.auth.getUser()
    const uid = auth.user?.id
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
