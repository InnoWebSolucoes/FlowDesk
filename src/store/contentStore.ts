import { create } from 'zustand'
import { supabase } from '../lib/supabaseClient'
import {
  ContentClient,
  ContentEdit,
  ContentOneOff,
  ContentPostDone,
  ContentPostMove,
  ContentPostRule,
  ContentRecording,
} from '../types'
import { useAuthStore } from './authStore'

const BUCKET = 'content-plans'

function toClient(r: any): ContentClient {
  return {
    id: r.id,
    projectId: r.project_id,
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
    deliverOn: r.deliver_on ?? null,
    deliverAssigneeId: r.deliver_assignee_id ?? null,
    deliverDoneAt: r.deliver_done_at ?? null,
    scheduleOn: r.schedule_on ?? null,
    scheduleAssigneeId: r.schedule_assignee_id ?? null,
    scheduleDoneAt: r.schedule_done_at ?? null,
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

function toMove(r: any): ContentPostMove {
  return { clientId: r.client_id, fromDay: r.from_day, toDay: r.to_day }
}

function toOneOff(r: any): ContentOneOff {
  return {
    id: r.id,
    projectId: r.project_id,
    clientId: r.client_id ?? null,
    day: r.day,
    title: r.title,
    detail: r.detail ?? '',
    assigneeId: r.assignee_id ?? null,
    doneAt: r.done_at ?? null,
    createdAt: r.created_at,
  }
}

/** Anyone who can be given a content task: the owner and the employees. */
export interface ContentPerson {
  id: string
  name: string
  initials: string
  /** Managers work in every project. */
  isAdmin: boolean
  /**
   * The projects they work in, so a project's lists offer its own people.
   * Null when that could not be read — then nobody is left out.
   */
  projectIds: string[] | null
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
  deliverOn: string | null
  scheduleOn: string | null
}

export interface OneOffInput {
  projectId: string
  clientId: string | null
  day: string
  title: string
  detail: string
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
  /** Single posting slots dragged off the day their rule put them on. */
  postMoves: ContentPostMove[]
  /** Work put on the calendar by hand, belonging to no pipeline. */
  oneOffs: ContentOneOff[]
  people: ContentPerson[]
  loaded: boolean
  /** Set when the tables are missing — the migration has not been run. */
  error: string | null

  load: () => Promise<void>
  subscribe: () => void
  teardown: () => void

  /** A new client, in the content calendar of the given project. */
  addClient: (input: ClientInput, projectId: string) => Promise<ContentClient>
  updateClient: (id: string, patch: Partial<ClientInput & { isArchived: boolean }>) => Promise<void>
  /**
   * Delete a client and everything under it. False when it was not deleted —
   * only the owner may — in which case nothing was touched.
   */
  deleteClient: (id: string) => Promise<boolean>

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

  /**
   * Move one posting slot to another day, or put it back. `fromDay` is always
   * the day its rule put it on, so moving a slot twice rewrites one row
   * instead of chaining moves that nothing could later undo.
   */
  movePost: (clientId: string, fromDay: string, toDay: string) => Promise<void>

  addOneOff: (input: OneOffInput) => Promise<void>
  updateOneOff: (id: string, patch: Partial<Omit<ContentOneOff, 'id' | 'projectId' | 'createdAt'>>) => Promise<void>
  deleteOneOff: (id: string) => Promise<void>
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
  deliverOn: 'deliver_on',
  deliverAssigneeId: 'deliver_assignee_id',
  deliverDoneAt: 'deliver_done_at',
  scheduleOn: 'schedule_on',
  scheduleAssigneeId: 'schedule_assignee_id',
  scheduleDoneAt: 'schedule_done_at',
}
const ruleCols: Record<string, string> = {
  weekdays: 'weekdays',
  everyWeeks: 'every_weeks',
  startsOn: 'starts_on',
  endsOn: 'ends_on',
  assigneeId: 'assignee_id',
}
const oneOffCols: Record<string, string> = {
  clientId: 'client_id',
  day: 'day',
  title: 'title',
  detail: 'detail',
  assigneeId: 'assignee_id',
  doneAt: 'done_at',
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
/**
 * The tables added for dragging and for one-off tasks, on a channel of their
 * own. A postgres_changes subscription naming a table that does not exist
 * fails the whole channel, so putting these in with the rest would mean that
 * until their migration has been run, nothing on the calendar updated live.
 */
let newTablesChannel: ReturnType<typeof supabase.channel> | null = null
let reloadTimer: ReturnType<typeof setTimeout> | null = null

export const useContentStore = create<ContentState>()((set, get) => ({
  clients: [],
  recordings: [],
  edits: [],
  rules: [],
  posted: [],
  postMoves: [],
  oneOffs: [],
  people: [],
  loaded: false,
  error: null,

  load: async () => {
    const [c, r, e, ru, p, mv, oo, u] = await Promise.all([
      supabase.from('content_clients').select('*').order('name'),
      supabase.from('content_recordings').select('*'),
      supabase.from('content_edits').select('*'),
      supabase.from('content_post_rules').select('*'),
      supabase.from('content_posts').select('*'),
      supabase.from('content_post_moves').select('*'),
      supabase.from('content_one_off_tasks').select('*'),
      supabase.from('users').select('id, name, avatar_initials, role, is_active, project_id, project_members(project_id)'),
    ])
    // Who works where is a nicety for the pickers. If it cannot be read, fall
    // back to everybody rather than to nobody.
    const users = u.error ? await supabase.from('users').select('id, name, avatar_initials, role, is_active') : u
    // The two newest tables are left out of this check on purpose: before
    // their migration has been run the calendar should still open and work,
    // minus dragging a post and minus one-off tasks.
    if (mv.error) console.error('[content] post moves unavailable:', mv.error)
    if (oo.error) console.error('[content] one-off tasks unavailable:', oo.error)
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
      postMoves: (mv.data ?? []).map(toMove),
      oneOffs: (oo.data ?? []).map(toOneOff),
      people: (users.data ?? [])
        .filter((x: any) => x.is_active !== false)
        .map(
          (x: any): ContentPerson => ({
            id: x.id,
            name: x.name,
            initials: x.avatar_initials ?? '',
            isAdmin: x.role === 'admin',
            projectIds: u.error
              ? null
              : [x.project_id, ...(x.project_members ?? []).map((m: any) => m.project_id)].filter(Boolean),
          }),
        )
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

    newTablesChannel = supabase.channel('content-calendar-live-moves')
    for (const table of ['content_post_moves', 'content_one_off_tasks']) {
      newTablesChannel.on('postgres_changes', { event: '*', schema: 'public', table }, reload)
    }
    newTablesChannel.subscribe()
  },

  teardown: () => {
    if (channel) {
      supabase.removeChannel(channel)
      channel = null
    }
    if (newTablesChannel) {
      supabase.removeChannel(newTablesChannel)
      newTablesChannel = null
    }
    set({
      clients: [], recordings: [], edits: [], rules: [], posted: [],
      postMoves: [], oneOffs: [], people: [], loaded: false, error: null,
    })
  },

  // ─── Clients ──────────────────────────────────────────────────────────────

  addClient: async (input, projectId) => {
    const { data, error } = await supabase
      .from('content_clients')
      .insert({ ...toRow({ ...input }, clientCols), project_id: projectId, created_by: me() })
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
    // Asked first, because the plans' files have to go before the client does
    // — who may touch a file follows its client, so once the client is gone
    // nobody could — and a file removed cannot be put back if the delete is
    // then refused. If the question itself fails, the delete below still
    // answers it.
    const { data: owner, error: ownerError } = await supabase.rpc('is_owner')
    if (!ownerError && owner !== true) return false

    const paths = get()
      .recordings.filter((r) => r.clientId === id && r.planPath)
      .map((r) => r.planPath as string)
    if (paths.length) await supabase.storage.from(BUCKET).remove(paths)

    // Its recordings, edits, posting days and posts go with it: every one of
    // those tables cascades from content_clients. A delete the database
    // refuses deletes no rows and reports no error, so the rows are asked
    // for back to tell the two apart.
    const { data, error } = await supabase.from('content_clients').delete().eq('id', id).select('id')
    if (error) fail('Deleting the client', error)
    if (!data?.length) return false

    set((s) => ({
      clients: s.clients.filter((c) => c.id !== id),
      recordings: s.recordings.filter((r) => r.clientId !== id),
      edits: s.edits.filter((e) => e.clientId !== id),
      rules: s.rules.filter((r) => r.clientId !== id),
      posted: s.posted.filter((p) => p.clientId !== id),
    }))
    return true
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
        deliver_on: input.deliverOn,
        schedule_on: input.scheduleOn,
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

  // ─── Moving one posting slot ──────────────────────────────────────────────

  movePost: async (clientId, fromDay, toDay) => {
    const before = get().postMoves
    const rest = before.filter((m) => !(m.clientId === clientId && m.fromDay === fromDay))

    // Dragged back to where its rule puts it: that is not a move, it is the
    // absence of one, and leaving a row saying "Tuesday → Tuesday" would
    // quietly pin the slot against a later change to the rule.
    if (fromDay === toDay) {
      if (rest.length === before.length) return
      set({ postMoves: rest })
      const { error } = await supabase
        .from('content_post_moves')
        .delete()
        .eq('client_id', clientId)
        .eq('from_day', fromDay)
      if (error) {
        set({ postMoves: before })
        fail('Putting the post back', error)
      }
      return
    }

    set({ postMoves: [...rest, { clientId, fromDay, toDay }] })
    const { error } = await supabase
      .from('content_post_moves')
      .upsert(
        { client_id: clientId, from_day: fromDay, to_day: toDay, moved_by: me(), moved_at: new Date().toISOString() },
        { onConflict: 'client_id,from_day' },
      )
    if (error) {
      set({ postMoves: before })
      fail('Moving the post', error)
    }
  },

  // ─── One-off tasks ────────────────────────────────────────────────────────

  addOneOff: async (input) => {
    const { data, error } = await supabase
      .from('content_one_off_tasks')
      .insert({
        project_id: input.projectId,
        client_id: input.clientId,
        day: input.day,
        title: input.title.trim(),
        detail: input.detail,
        assignee_id: input.assigneeId,
        created_by: me(),
      })
      .select()
      .single()
    if (error || !data) fail('Adding the task', error)
    set((s) => ({ oneOffs: [...s.oneOffs, toOneOff(data)] }))
  },

  updateOneOff: async (id, patch) => {
    const before = get().oneOffs
    set((s) => ({ oneOffs: s.oneOffs.map((o) => (o.id === id ? { ...o, ...patch } : o)) }))
    const row = toRow(patch as Record<string, unknown>, oneOffCols)
    // Who ticked it, which is not part of the task and so not in the patch.
    // Cleared along with the tick, so an unticked task does not keep the name
    // of whoever last finished it.
    if (patch.doneAt !== undefined) row.done_by = patch.doneAt ? me() : null
    const { error } = await supabase.from('content_one_off_tasks').update(row).eq('id', id)
    if (error) {
      set({ oneOffs: before })
      fail('Saving the task', error)
    }
  },

  deleteOneOff: async (id) => {
    const before = get().oneOffs
    set((s) => ({ oneOffs: s.oneOffs.filter((o) => o.id !== id) }))
    const { error } = await supabase.from('content_one_off_tasks').delete().eq('id', id)
    if (error) {
      set({ oneOffs: before })
      fail('Deleting the task', error)
    }
  },
}))
