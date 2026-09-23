import { create } from 'zustand'
import { supabase } from '../lib/supabaseClient'
import {
  ContentClient,
  ContentEdit,
  ContentPostDone,
  ContentPostRule,
  ContentRecording,
} from '../types'
import { useAuthStore } from './authStore'

const BUCKET = 'content-plans'

function toClient(r: any): ContentClient {
  return {
    id: r.id,
    name: r.name,
    code: r.code,
    color: r.color,
    postsPerMonth: r.posts_per_month ?? 0,
    contactName: r.contact_name ?? '',
    contactEmail: r.contact_email ?? '',
    contactPhone: r.contact_phone ?? '',
    handle: r.handle ?? '',
    notes: r.notes ?? '',
    isArchived: !!r.is_archived,
    createdAt: r.created_at,
  }
}

function toRecording(r: any): ContentRecording {
  return {
    id: r.id,
    clientId: r.client_id,
    recordedOn: r.recorded_on,
    pieces: r.pieces,
    assigneeId: r.assignee_id,
    doneAt: r.done_at,
    notes: r.notes ?? '',
    planOn: r.plan_on,
    planAssigneeId: r.plan_assignee_id,
    planDoneAt: r.plan_done_at,
    planPath: r.plan_path,
    planName: r.plan_name,
    planMime: r.plan_mime,
    planNotes: r.plan_notes ?? '',
    createdAt: r.created_at,
  }
}

function toEdit(r: any): ContentEdit {
  return {
    id: r.id,
    clientId: r.client_id,
    editedOn: r.edited_on,
    pieces: r.pieces,
    assigneeId: r.assignee_id,
    doneAt: r.done_at,
    notes: r.notes ?? '',
    createdAt: r.created_at,
  }
}

function toRule(r: any): ContentPostRule {
  return {
    id: r.id,
    clientId: r.client_id,
    weekdays: r.weekdays ?? [],
    everyWeeks: r.every_weeks ?? 1,
    startsOn: r.starts_on,
    endsOn: r.ends_on,
    assigneeId: r.assignee_id,
    createdAt: r.created_at,
  }
}

function toDone(r: any): ContentPostDone {
  return { clientId: r.client_id, postedOn: r.posted_on, doneBy: r.done_by, doneAt: r.done_at }
}

/** Anyone who can be given a content task: the owner and the employees. */
export interface ContentPerson {
  id: string
  name: string
  initials: string
}

export interface ClientInput {
  name: string
  code: string
  color: string
  postsPerMonth: number
  contactName: string
  contactEmail: string
  contactPhone: string
  handle: string
  notes: string
}

export interface RecordingInput {
  clientId: string
  recordedOn: string
  pieces: number
  assigneeId: string | null
  planOn: string | null
  planAssigneeId: string | null
  notes?: string
}

export interface EditInput {
  clientId: string
  editedOn: string
  pieces: number
  assigneeId: string | null
}

export interface RuleInput {
  clientId: string
  weekdays: number[]
  everyWeeks: number
  startsOn: string
  endsOn: string | null
  assigneeId: string | null
}

function fail(what: string, error: { message: string } | null): never {
  console.error(`[content] ${what} failed:`, error)
  throw new Error(error?.message ?? `${what} failed.`)
}

const me = () => useAuthStore.getState().currentUser?.id ?? null

/**
 * The content calendar: clients, and the plan, recording, editing and posting
 * that every piece of their content goes through.
 *
 * Loaded whole. A firm's worth of clients and sessions is a few hundred rows,
 * and every view — the month, a client's profile, the week checklist — needs
 * all of a client's sessions to number its pieces anyway.
 */
interface ContentState {
  clients: ContentClient[]
  recordings: ContentRecording[]
  edits: ContentEdit[]
  rules: ContentPostRule[]
  posted: ContentPostDone[]
  people: ContentPerson[]
  loaded: boolean
  /** Set when the tables are missing — the migration has not been run. */
  error: string | null

  load: () => Promise<void>
  subscribe: () => void
  teardown: () => void

  addClient: (input: ClientInput) => Promise<ContentClient>
  updateClient: (id: string, patch: Partial<ClientInput & { isArchived: boolean }>) => Promise<void>
  deleteClient: (id: string) => Promise<void>

  addRecordings: (inputs: RecordingInput[]) => Promise<void>
  updateRecording: (id: string, patch: Partial<Omit<ContentRecording, 'id' | 'clientId' | 'createdAt'>>) => Promise<void>
  deleteRecording: (id: string) => Promise<void>
  uploadPlan: (recordingId: string, file: File) => Promise<void>
  removePlanFile: (recordingId: string) => Promise<void>
  planUrl: (path: string) => Promise<string | null>

  addEdit: (input: EditInput) => Promise<void>
  updateEdit: (id: string, patch: Partial<Omit<ContentEdit, 'id' | 'clientId' | 'createdAt'>>) => Promise<void>
  deleteEdit: (id: string) => Promise<void>

  addRule: (input: RuleInput) => Promise<void>
  updateRule: (id: string, patch: Partial<Omit<ContentPostRule, 'id' | 'clientId' | 'createdAt'>>) => Promise<void>
  deleteRule: (id: string) => Promise<void>

  setPosted: (clientId: string, day: string, posted: boolean) => Promise<void>
}

const recordingCols: Record<string, string> = {
  recordedOn: 'recorded_on',
  pieces: 'pieces',
  assigneeId: 'assignee_id',
  doneAt: 'done_at',
  notes: 'notes',
  planOn: 'plan_on',
  planAssigneeId: 'plan_assignee_id',
  planDoneAt: 'plan_done_at',
  planPath: 'plan_path',
  planName: 'plan_name',
  planMime: 'plan_mime',
  planNotes: 'plan_notes',
}
const editCols: Record<string, string> = {
  editedOn: 'edited_on',
  pieces: 'pieces',
  assigneeId: 'assignee_id',
  doneAt: 'done_at',
  notes: 'notes',
}
const ruleCols: Record<string, string> = {
  weekdays: 'weekdays',
  everyWeeks: 'every_weeks',
  startsOn: 'starts_on',
  endsOn: 'ends_on',
  assigneeId: 'assignee_id',
}
const clientCols: Record<string, string> = {
  name: 'name',
  code: 'code',
  color: 'color',
  postsPerMonth: 'posts_per_month',
  contactName: 'contact_name',
  contactEmail: 'contact_email',
  contactPhone: 'contact_phone',
  handle: 'handle',
  notes: 'notes',
  isArchived: 'is_archived',
}

function toRow(patch: Record<string, unknown>, cols: Record<string, string>) {
  const row: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(patch)) if (cols[k] && v !== undefined) row[cols[k]] = v
  return row
}

let channel: ReturnType<typeof supabase.channel> | null = null
let reloadTimer: ReturnType<typeof setTimeout> | null = null

export const useContentStore = create<ContentState>()((set, get) => ({
  clients: [],
  recordings: [],
  edits: [],
  rules: [],
  posted: [],
  people: [],
  loaded: false,
  error: null,

  load: async () => {
    const [c, r, e, ru, p, u] = await Promise.all([
      supabase.from('content_clients').select('*').order('name'),
      supabase.from('content_recordings').select('*'),
      supabase.from('content_edits').select('*'),
      supabase.from('content_post_rules').select('*'),
      supabase.from('content_posts').select('*'),
      supabase.from('users').select('id, name, avatar_initials, role, is_active'),
    ])
    const err = c.error ?? r.error ?? e.error ?? ru.error ?? p.error
    if (err) {
      console.error('[content] load failed:', err)
      set({ loaded: true, error: err.message })
      return
    }
    set({
      clients: (c.data ?? []).map(toClient),
      recordings: (r.data ?? []).map(toRecording),
      edits: (e.data ?? []).map(toEdit),
      rules: (ru.data ?? []).map(toRule),
      posted: (p.data ?? []).map(toDone),
      people: (u.data ?? [])
        .filter((x: any) => x.is_active !== false)
        .map((x: any) => ({ id: x.id, name: x.name, initials: x.avatar_initials ?? '' }))
        .sort((a: ContentPerson, b: ContentPerson) => a.name.localeCompare(b.name)),
      loaded: true,
      error: null,
    })
  },

  subscribe: () => {
    if (channel) return
    const reload = () => {
      // A series of ten recordings arrives as ten events; one reload covers them.
      if (reloadTimer) clearTimeout(reloadTimer)
      reloadTimer = setTimeout(() => get().load(), 300)
    }
    channel = supabase.channel('content-calendar-live')
    for (const table of ['content_clients', 'content_recordings', 'content_edits', 'content_post_rules', 'content_posts']) {
      channel.on('postgres_changes', { event: '*', schema: 'public', table }, reload)
    }
    channel.subscribe()
  },

  teardown: () => {
    if (channel) {
      supabase.removeChannel(channel)
      channel = null
    }
    set({ clients: [], recordings: [], edits: [], rules: [], posted: [], people: [], loaded: false, error: null })
  },

  // ─── Clients ──────────────────────────────────────────────────────────────

  addClient: async (input) => {
    const { data, error } = await supabase
      .from('content_clients')
      .insert({ ...toRow({ ...input }, clientCols), created_by: me() })
      .select()
      .single()
    if (error || !data) fail('Adding the client', error)
    const client = toClient(data)
    set((s) => ({ clients: [...s.clients, client].sort((a, b) => a.name.localeCompare(b.name)) }))
    return client
  },

  updateClient: async (id, patch) => {
    const { error } = await supabase.from('content_clients').update(toRow(patch, clientCols)).eq('id', id)
    if (error) fail('Saving the client', error)
    set((s) => ({ clients: s.clients.map((c) => (c.id === id ? { ...c, ...patch } : c)) }))
  },

  deleteClient: async (id) => {
    const paths = get()
      .recordings.filter((r) => r.clientId === id && r.planPath)
      .map((r) => r.planPath as string)
    const { error } = await supabase.from('content_clients').delete().eq('id', id)
    if (error) fail('Deleting the client', error)
    if (paths.length) await supabase.storage.from(BUCKET).remove(paths)
    set((s) => ({
      clients: s.clients.filter((c) => c.id !== id),
      recordings: s.recordings.filter((r) => r.clientId !== id),
      edits: s.edits.filter((e) => e.clientId !== id),
      rules: s.rules.filter((r) => r.clientId !== id),
      posted: s.posted.filter((p) => p.clientId !== id),
    }))
  },

  // ─── Recordings and their plans ───────────────────────────────────────────

  addRecordings: async (inputs) => {
    if (inputs.length === 0) return
    const rows = inputs.map((i) => ({
      client_id: i.clientId,
      recorded_on: i.recordedOn,
      pieces: i.pieces,
      assignee_id: i.assigneeId,
      plan_on: i.planOn,
      plan_assignee_id: i.planAssigneeId,
      notes: i.notes ?? '',
      created_by: me(),
    }))
    const { data, error } = await supabase.from('content_recordings').insert(rows).select()
    if (error) fail('Adding the recording', error)
    set((s) => ({ recordings: [...s.recordings, ...(data ?? []).map(toRecording)] }))
  },

  updateRecording: async (id, patch) => {
    const before = get().recordings.find((r) => r.id === id)
    set((s) => ({ recordings: s.recordings.map((r) => (r.id === id ? { ...r, ...patch } : r)) }))
    const { error } = await supabase.from('content_recordings').update(toRow(patch, recordingCols)).eq('id', id)
    if (error) {
      if (before) set((s) => ({ recordings: s.recordings.map((r) => (r.id === id ? before : r)) }))
      fail('Saving the recording', error)
    }
  },

  deleteRecording: async (id) => {
    const rec = get().recordings.find((r) => r.id === id)
    const { error } = await supabase.from('content_recordings').delete().eq('id', id)
    if (error) fail('Deleting the recording', error)
    if (rec?.planPath) await supabase.storage.from(BUCKET).remove([rec.planPath])
    set((s) => ({ recordings: s.recordings.filter((r) => r.id !== id) }))
  },

  uploadPlan: async (recordingId, file) => {
    const rec = get().recordings.find((r) => r.id === recordingId)
    if (!rec) return
    const safe = file.name.replace(/[^\w.\-]+/g, '_')
    const path = `${rec.clientId}/${recordingId}/${Date.now()}-${safe}`
    const { error: upErr } = await supabase.storage.from(BUCKET).upload(path, file, { upsert: true })
    if (upErr) fail('Uploading the plan', upErr)
    const old = rec.planPath
    await get().updateRecording(recordingId, {
      planPath: path,
      planName: file.name,
      planMime: file.type || null,
    })
    if (old && old !== path) await supabase.storage.from(BUCKET).remove([old])
  },

  removePlanFile: async (recordingId) => {
    const rec = get().recordings.find((r) => r.id === recordingId)
    if (!rec?.planPath) return
    await get().updateRecording(recordingId, { planPath: null, planName: null, planMime: null })
    await supabase.storage.from(BUCKET).remove([rec.planPath])
  },

  planUrl: async (path) => {
    const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(path, 60 * 60)
    if (error) {
      console.error('[content] plan url failed:', error)
      return null
    }
    return data?.signedUrl ?? null
  },

  // ─── Editing ──────────────────────────────────────────────────────────────

  addEdit: async (input) => {
    const { data, error } = await supabase
      .from('content_edits')
      .insert({
        client_id: input.clientId,
        edited_on: input.editedOn,
        pieces: input.pieces,
        assignee_id: input.assigneeId,
        created_by: me(),
      })
      .select()
      .single()
    if (error || !data) fail('Adding the editing session', error)
    set((s) => ({ edits: [...s.edits, toEdit(data)] }))
  },

  updateEdit: async (id, patch) => {
    const before = get().edits.find((e) => e.id === id)
    set((s) => ({ edits: s.edits.map((e) => (e.id === id ? { ...e, ...patch } : e)) }))
    const { error } = await supabase.from('content_edits').update(toRow(patch, editCols)).eq('id', id)
    if (error) {
      if (before) set((s) => ({ edits: s.edits.map((e) => (e.id === id ? before : e)) }))
      fail('Saving the editing session', error)
    }
  },

  deleteEdit: async (id) => {
    const { error } = await supabase.from('content_edits').delete().eq('id', id)
    if (error) fail('Deleting the editing session', error)
    set((s) => ({ edits: s.edits.filter((e) => e.id !== id) }))
  },

  // ─── Posting ──────────────────────────────────────────────────────────────

  addRule: async (input) => {
    const { data, error } = await supabase
      .from('content_post_rules')
      .insert({
        client_id: input.clientId,
        weekdays: input.weekdays,
        every_weeks: input.everyWeeks,
        starts_on: input.startsOn,
        ends_on: input.endsOn,
        assignee_id: input.assigneeId,
        created_by: me(),
      })
      .select()
      .single()
    if (error || !data) fail('Adding the posting days', error)
    set((s) => ({ rules: [...s.rules, toRule(data)] }))
  },

  updateRule: async (id, patch) => {
    const { error } = await supabase.from('content_post_rules').update(toRow(patch, ruleCols)).eq('id', id)
    if (error) fail('Saving the posting days', error)
    set((s) => ({ rules: s.rules.map((r) => (r.id === id ? { ...r, ...patch } : r)) }))
  },

  deleteRule: async (id) => {
    const { error } = await supabase.from('content_post_rules').delete().eq('id', id)
    if (error) fail('Deleting the posting days', error)
    set((s) => ({ rules: s.rules.filter((r) => r.id !== id) }))
  },

  setPosted: async (clientId, day, posted) => {
    const before = get().posted
    if (posted) {
      const row: ContentPostDone = { clientId, postedOn: day, doneBy: me(), doneAt: new Date().toISOString() }
      set((s) => ({ posted: [...s.posted.filter((p) => !(p.clientId === clientId && p.postedOn === day)), row] }))
      const { error } = await supabase
        .from('content_posts')
        .upsert({ client_id: clientId, posted_on: day, done_by: row.doneBy, done_at: row.doneAt })
      if (error) {
        set({ posted: before })
        fail('Ticking off the post', error)
      }
    } else {
      set((s) => ({ posted: s.posted.filter((p) => !(p.clientId === clientId && p.postedOn === day)) }))
      const { error } = await supabase.from('content_posts').delete().eq('client_id', clientId).eq('posted_on', day)
      if (error) {
        set({ posted: before })
        fail('Unticking the post', error)
      }
    }
  },
}))
