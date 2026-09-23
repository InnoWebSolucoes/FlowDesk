import React, { useEffect, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { X, ExternalLink, Loader2, AlertCircle } from 'lucide-react'
import { useContentStore, ClientInput } from '../../store/contentStore'
import { ContentClient, ContentRecording } from '../../types'
import { ClientFlow, flowFor, formatDay, pieceTag, todayKey } from '../../utils/contentPipeline'
import { fileKind } from '../resources/ResourceThumbnail'

// ─── Colours ────────────────────────────────────────────────────────────────

/** One colour per stage, the same everywhere the stage is drawn. */
export const KIND_COLOR: Record<ContentTaskKind, string> = {
  plan: '#1B4F8A',
  record: '#18170F',
  edit: '#6B6960',
  deliver: '#1F8A4C',
  schedule: '#C23B3B',
  post: '#7A4A0A',
}

export const KIND_LABEL: Record<ContentTaskKind, string> = {
  plan: 'Content plan',
  record: 'Recording',
  edit: 'Editing',
  deliver: 'Delivery',
  schedule: 'Scheduling',
  post: 'Posting',
}

/** How a task starts when it is written as an instruction: "Record ESP". */
export const KIND_VERB: Record<ContentTaskKind, string> = {
  plan: 'Plan',
  record: 'Record',
  edit: 'Edit',
  deliver: 'Deliver',
  schedule: 'Schedule',
  post: 'Post',
}

/** Client swatches, distinct enough side by side on a busy calendar day. */
export const CLIENT_COLORS = [
  '#0E7A6A', '#7B3D9E', '#2360A8', '#B8700C', '#B8336A', '#5E7D1A', '#8C5A2E', '#C23B3B', '#3D5A80', '#6B4E9B',
]

// ─── Loading ────────────────────────────────────────────────────────────────

/** Load the calendar once and keep it live while any content page is open. */
export function useContentData() {
  const store = useContentStore()
  useEffect(() => {
    if (!store.loaded) store.load()
    store.subscribe()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  return store
}

/** Where the content pages live on this side of the app. */
export function useContentBase() {
  const { pathname } = useLocation()
  return pathname.startsWith('/admin') ? '/admin/content' : '/employee/content'
}

// ─── Tasks ──────────────────────────────────────────────────────────────────

export type ContentTaskKind = 'plan' | 'record' | 'edit' | 'deliver' | 'schedule' | 'post'

/** One task, on one day, for one client — or a batch of them. */
export interface ContentTask {
  key: string
  kind: ContentTaskKind
  day: string
  client: ContentClient
  title: string
  detail: string
  assigneeId: string | null
  done: boolean
  /** Something is wrong with it: a post with nothing edited, an edit short of footage. */
  warning: string | null
  /** For posts: the tag it carries, e.g. ESP 03. */
  tag?: string
  /** For plans: the recording, so its file can be opened. */
  recording?: ContentRecording
  /** For deliveries and scheduling: how many pieces the batch holds. */
  pieces?: number
  /**
   * Set on a batch: several clients' deliveries, or their scheduling, done in
   * one go on one day. Ticking the batch ticks each of them.
   */
  members?: ContentTask[]
}

/** Every client's flow and every task, with posting slots generated up to `until`. */
export function useContentTasks(until: string) {
  const { clients, recordings, edits, rules, posted } = useContentStore()
  const flows: Record<string, ClientFlow> = {}
  const tasks: ContentTask[] = []
  const today = todayKey()

  for (const client of clients) {
    if (client.isArchived) continue
    const recs = recordings.filter((r) => r.clientId === client.id)
    const flow = flowFor(
      recs,
      edits.filter((e) => e.clientId === client.id),
      rules.filter((r) => r.clientId === client.id),
      posted.filter((p) => p.clientId === client.id),
      until,
    )
    flows[client.id] = flow

    for (const r of recs) {
      const own = flow.pieces.filter((p) => p.recordingId === r.id)
      const range = own.length ? ` · ${pieceTag(client, own[0].n)}–${String(own[own.length - 1].n).padStart(2, '0')}` : ''
      if (r.planOn) {
        tasks.push({
          key: `plan:${r.id}`,
          kind: 'plan',
          day: r.planOn,
          client,
          title: `Plan ${client.name}`,
          detail: `for the ${formatDay(r.recordedOn, { day: 'numeric', month: 'short' })} shoot${r.planPath ? ' · plan uploaded' : ''}`,
          assigneeId: r.planAssigneeId,
          done: !!r.planDoneAt,
          warning: null,
          recording: r,
        })
      }
      tasks.push({
        key: `record:${r.id}`,
        kind: 'record',
        day: r.recordedOn,
        client,
        title: `Record ${client.name}`,
        detail: `${r.pieces} video${r.pieces === 1 ? '' : 's'}${range}`,
        assigneeId: r.assigneeId,
        done: !!r.doneAt,
        // Only once the plan was due. Every shoot booked ahead has no plan
        // yet, and saying so on all of them says nothing.
        warning:
          r.planOn && r.planOn < today && !r.doneAt && !r.planDoneAt && !r.planPath && !r.planNotes
            ? 'No content plan yet'
            : null,
        recording: r,
      })
    }

    for (const f of flow.edits) {
      const range = `${pieceTag(client, f.from)}${f.to > f.from ? `–${String(f.to).padStart(2, '0')}` : ''}`
      tasks.push({
        key: `edit:${f.edit.id}`,
        kind: 'edit',
        day: f.edit.editedOn,
        client,
        title: `Edit ${client.name}`,
        // "3 of 4 available" only when it leaves some for a later session.
        detail:
          f.takes === 0
            ? 'nothing recorded to edit'
            : f.takes === f.available
              ? `${f.takes} video${f.takes === 1 ? '' : 's'} · ${range}`
              : `${f.takes} of ${f.available} available · ${range}`,
        assigneeId: f.edit.assigneeId,
        done: !!f.edit.doneAt,
        warning: f.short > 0 ? `${f.short} more than had been recorded by then` : null,
      })

      // Then the batch goes to the client for approval, and once approved
      // into the scheduler.
      if (f.edit.deliverOn) {
        tasks.push({
          key: `deliver:${f.edit.id}`,
          kind: 'deliver',
          day: f.edit.deliverOn,
          client,
          title: `Deliver ${client.name}`,
          detail: `${f.takes} piece${f.takes === 1 ? '' : 's'} for approval`,
          assigneeId: f.edit.deliverAssigneeId,
          done: !!f.edit.deliverDoneAt,
          warning: f.edit.deliverOn < f.edit.editedOn ? 'Before the edit' : null,
          pieces: f.takes,
        })
      }
      if (f.edit.scheduleOn) {
        tasks.push({
          key: `schedule:${f.edit.id}`,
          kind: 'schedule',
          day: f.edit.scheduleOn,
          client,
          title: `Schedule ${client.name}`,
          detail: `${f.takes} piece${f.takes === 1 ? '' : 's'}`,
          assigneeId: f.edit.scheduleAssigneeId,
          done: !!f.edit.scheduleDoneAt,
          warning:
            f.edit.scheduleOn < (f.edit.deliverOn ?? f.edit.editedOn) ? 'Before it has been delivered' : null,
          pieces: f.takes,
        })
      }
    }

    for (const s of flow.slots) {
      tasks.push({
        key: `post:${client.id}:${s.day}`,
        kind: 'post',
        day: s.day,
        client,
        title: s.piece ? `Post ${pieceTag(client, s.piece.n)}` : `Post ${client.name}`,
        detail: s.piece ? `${client.name}` : `${client.name} · nothing edited in time`,
        assigneeId: s.rule.assigneeId,
        done: !!s.done,
        warning: s.piece ? null : 'Nothing edited in time for this slot',
        tag: s.piece ? pieceTag(client, s.piece.n) : `${client.code} —`,
      })
    }
  }

  tasks.sort(byDayThenStage)
  return { flows, tasks }
}

/**
 * Scheduling comes first in a day — it is done in the morning so that day's
 * posts go out — and delivery last, once the day's editing is finished.
 */
const STAGE_ORDER: Record<ContentTaskKind, number> = { schedule: 0, plan: 1, record: 2, edit: 3, deliver: 4, post: 5 }

function byDayThenStage(a: ContentTask, b: ContentTask) {
  return a.day.localeCompare(b.day) || STAGE_ORDER[a.kind] - STAGE_ORDER[b.kind] || a.client.name.localeCompare(b.client.name)
}

/** Client codes as a batch is named: "SHZ + TAS", or "ESP, OKU, DER, OLU". */
export function codesOf(clients: ContentClient[]) {
  const codes = clients.map((c) => c.code)
  return codes.length === 2 ? codes.join(' + ') : codes.join(', ')
}

/**
 * Deliveries and scheduling on the same day are one job: one approval
 * package, one session in the scheduler. They are kept per client, so each
 * can be moved on its own, and drawn as a batch — "Schedule 28 pieces · ESP,
 * OKU, DER, OLU" — the way the plan is written. Everything else passes
 * through as it is.
 */
export function groupBatches(tasks: ContentTask[]): ContentTask[] {
  const out: ContentTask[] = []
  const batches = new Map<string, ContentTask[]>()
  for (const t of tasks) {
    if (t.kind !== 'deliver' && t.kind !== 'schedule') {
      out.push(t)
      continue
    }
    const k = `${t.kind}|${t.day}`
    const members = batches.get(k)
    if (members) {
      members.push(t)
      continue
    }
    batches.set(k, [t])
    // A placeholder, swapped for the batch once all its members are known.
    out.push({ ...t, key: `batch:${k}` })
  }

  return out.map((t) => {
    if (!t.key.startsWith('batch:')) return t
    const members = batches.get(t.key.slice('batch:'.length))!
    if (members.length === 1) return members[0]
    const pieces = members.reduce((n, m) => n + (m.pieces ?? 0), 0)
    const who = new Set(members.map((m) => m.assigneeId))
    return {
      ...members[0],
      key: t.key,
      title: `${KIND_VERB[t.kind]} ${pieces} pieces`,
      detail: `${codesOf(members.map((m) => m.client))}${t.kind === 'deliver' ? ' · for approval' : ''}`,
      assigneeId: who.size === 1 ? members[0].assigneeId : null,
      done: members.every((m) => m.done),
      warning: members.find((m) => m.warning)?.warning ?? null,
      pieces,
      members,
    }
  })
}

/** Tick a task off, or back on, whichever kind it is. A batch ticks every member. */
export async function toggleTask(task: ContentTask, done: boolean): Promise<void> {
  if (task.members) {
    await Promise.all(task.members.filter((m) => m.done !== done).map((m) => toggleTask(m, done)))
    return
  }
  const s = useContentStore.getState()
  const at = done ? new Date().toISOString() : null
  const id = task.key.split(':')[1]
  switch (task.kind) {
    case 'plan':
      return s.updateRecording(id, { planDoneAt: at })
    case 'record':
      return s.updateRecording(id, { doneAt: at })
    case 'edit':
      return s.updateEdit(id, { doneAt: at })
    case 'deliver':
      return s.updateEdit(id, { deliverDoneAt: at })
    case 'schedule':
      return s.updateEdit(id, { scheduleDoneAt: at })
    case 'post':
      return s.setPosted(task.client.id, task.day, done)
  }
}

// ─── People ─────────────────────────────────────────────────────────────────

export function usePersonName() {
  const people = useContentStore((s) => s.people)
  return (id: string | null) => (id ? people.find((p) => p.id === id)?.name ?? 'Someone' : null)
}

/** Who does it. A plain native select: these sit in dense rows. */
export function PersonSelect({
  value,
  onChange,
  placeholder = 'Anyone',
  className = '',
}: {
  value: string | null
  onChange: (id: string | null) => void
  placeholder?: string
  className?: string
}) {
  const people = useContentStore((s) => s.people)
  return (
    <select
      value={value ?? ''}
      onChange={(e) => onChange(e.target.value || null)}
      className={`text-sm bg-surface border border-border-md rounded-md px-2 py-1.5 text-text-main focus:outline-none focus:ring-2 focus:ring-primary/30 ${className}`}
    >
      <option value="">{placeholder}</option>
      {people.map((p) => (
        <option key={p.id} value={p.id}>
          {p.name}
        </option>
      ))}
    </select>
  )
}

// ─── Plan viewer ────────────────────────────────────────────────────────────

/** The content plan for a recording, shown in place. */
export function PlanViewer({ recording, client, onClose }: { recording: ContentRecording; client: ContentClient; onClose: () => void }) {
  const planUrl = useContentStore((s) => s.planUrl)
  const [url, setUrl] = useState<string | null | 'loading'>('loading')

  useEffect(() => {
    let cancelled = false
    if (!recording.planPath) {
      setUrl(null)
      return
    }
    planUrl(recording.planPath).then((u) => !cancelled && setUrl(u))
    return () => {
      cancelled = true
    }
  }, [recording.planPath, planUrl])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const kind = fileKind(recording.planMime, recording.planName)

  let body: React.ReactNode
  if (url === 'loading') {
    body = (
      <div className="flex-1 flex items-center justify-center text-text-muted">
        <Loader2 className="animate-spin" size={20} />
      </div>
    )
  } else if (!url) {
    body = null
  } else if (kind === 'image') {
    body = (
      <div className="flex-1 overflow-auto bg-surface-2 flex items-center justify-center p-4">
        <img src={url} alt={recording.planName ?? 'Content plan'} className="max-w-full max-h-full object-contain" />
      </div>
    )
  } else if (kind === 'doc' || kind === 'sheet' || kind === 'slide') {
    body = (
      <iframe
        title="Content plan"
        className="flex-1 w-full border-0 bg-white"
        src={`https://view.officeapps.live.com/op/embed.aspx?src=${encodeURIComponent(url)}`}
      />
    )
  } else if (kind === 'pdf' || kind === 'text' || kind === 'code') {
    body = <iframe title="Content plan" className="flex-1 w-full border-0 bg-white" src={url} />
  } else if (kind === 'video') {
    body = <video src={url} controls className="flex-1 w-full bg-black" />
  } else {
    body = (
      <div className="flex-1 flex flex-col items-center justify-center gap-3 text-text-muted text-sm p-6 text-center">
        <AlertCircle size={20} />
        This file cannot be shown here.
        <a href={url} target="_blank" rel="noreferrer" className="text-primary font-medium underline">
          Open it in a new tab
        </a>
      </div>
    )
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="bg-surface rounded-xl shadow-xl w-full max-w-5xl h-[85vh] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 px-4 py-3 border-b border-border">
          <span className="w-3 h-3 rounded-sm flex-shrink-0" style={{ backgroundColor: client.color }} />
          <div className="min-w-0 flex-1">
            <p className="font-semibold text-text-main truncate">
              Content plan · {client.name}
            </p>
            <p className="text-xs text-text-muted truncate">
              Shoot on {formatDay(recording.recordedOn)} · {recording.pieces} videos
              {recording.planName ? ` · ${recording.planName}` : ''}
            </p>
          </div>
          {typeof url === 'string' && url !== 'loading' && (
            <a
              href={url}
              target="_blank"
              rel="noreferrer"
              className="p-1.5 rounded-md text-text-muted hover:bg-surface-2"
              title="Open in a new tab"
            >
              <ExternalLink size={16} />
            </a>
          )}
          <button onClick={onClose} className="p-1.5 rounded-md text-text-muted hover:bg-surface-2" title="Close">
            <X size={16} />
          </button>
        </div>
        {recording.planNotes && (
          <div className={`px-4 py-3 text-sm text-text-main whitespace-pre-wrap border-b border-border ${body ? 'max-h-40 overflow-auto' : 'flex-1 overflow-auto'}`}>
            {recording.planNotes}
          </div>
        )}
        {body}
        {!body && !recording.planNotes && (
          <div className="flex-1 flex items-center justify-center text-sm text-text-muted">No plan has been added yet.</div>
        )}
      </div>
    </div>
  )
}

// ─── Client form ────────────────────────────────────────────────────────────

/** Adding a client, or editing one's profile. */
export function ClientDialog({
  client,
  onClose,
  onSaved,
}: {
  client: ContentClient | null
  onClose: () => void
  onSaved?: (c: ContentClient) => void
}) {
  const { clients, addClient, updateClient } = useContentStore()
  const [form, setForm] = useState<ClientInput>(() =>
    client
      ? {
          name: client.name,
          code: client.code,
          color: client.color,
          postsPerMonth: client.postsPerMonth,
          contactName: client.contactName,
          contactEmail: client.contactEmail,
          contactPhone: client.contactPhone,
          handle: client.handle,
          notes: client.notes,
        }
      : {
          name: '',
          code: '',
          color: CLIENT_COLORS[clients.length % CLIENT_COLORS.length],
          postsPerMonth: 8,
          contactName: '',
          contactEmail: '',
          contactPhone: '',
          handle: '',
          notes: '',
        },
  )
  const [codeTouched, setCodeTouched] = useState(!!client)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const set = <K extends keyof ClientInput>(k: K, v: ClientInput[K]) => setForm((f) => ({ ...f, [k]: v }))

  const save = async () => {
    if (!form.name.trim()) return setError('Give the client a name.')
    const code = (form.code.trim() || form.name.replace(/[^A-Za-zÀ-ÿ]/g, '').slice(0, 3)).toUpperCase()
    setSaving(true)
    setError('')
    try {
      const input = { ...form, name: form.name.trim(), code }
      if (client) {
        await updateClient(client.id, input)
        onSaved?.({ ...client, ...input })
      } else {
        const created = await addClient(input)
        onSaved?.(created)
      }
      onClose()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  const input = 'w-full text-sm bg-surface border border-border-md rounded-md px-3 py-2 text-text-main focus:outline-none focus:ring-2 focus:ring-primary/30'
  const label = 'block text-xs font-medium text-text-muted mb-1'

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-surface rounded-xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <h2 className="font-semibold text-text-main">{client ? 'Edit client' : 'New client'}</h2>
          <button onClick={onClose} className="p-1.5 rounded-md text-text-muted hover:bg-surface-2">
            <X size={16} />
          </button>
        </div>
        <div className="p-5 space-y-4">
          <div className="grid grid-cols-[1fr_90px] gap-3">
            <div>
              <label className={label}>Name</label>
              <input
                autoFocus
                className={input}
                value={form.name}
                onChange={(e) => {
                  set('name', e.target.value)
                  if (!codeTouched) set('code', e.target.value.replace(/[^A-Za-zÀ-ÿ]/g, '').slice(0, 3).toUpperCase())
                }}
                placeholder="Espaço Luanda"
              />
            </div>
            <div>
              <label className={label}>Code</label>
              <input
                className={`${input} uppercase`}
                maxLength={4}
                value={form.code}
                onChange={(e) => {
                  setCodeTouched(true)
                  set('code', e.target.value.toUpperCase())
                }}
                placeholder="ESP"
              />
            </div>
          </div>

          <div>
            <label className={label}>Posts a month</label>
            <div className="flex items-center gap-3">
              <input
                type="number"
                min={0}
                max={90}
                className={`${input} w-24`}
                value={form.postsPerMonth}
                onChange={(e) => set('postsPerMonth', Math.max(0, Number(e.target.value) || 0))}
              />
              <span className="text-xs text-text-muted">
                About {(form.postsPerMonth / 4.3).toFixed(1).replace(/\.0$/, '')} a week. Recording frequency is planned from this.
              </span>
            </div>
          </div>

          <div>
            <label className={label}>Colour</label>
            <div className="flex flex-wrap gap-2">
              {CLIENT_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => set('color', c)}
                  className={`w-7 h-7 rounded-md transition-transform ${form.color === c ? 'ring-2 ring-offset-2 ring-text-main scale-110' : ''}`}
                  style={{ backgroundColor: c }}
                  aria-label={c}
                />
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={label}>Contact</label>
              <input className={input} value={form.contactName} onChange={(e) => set('contactName', e.target.value)} />
            </div>
            <div>
              <label className={label}>Handle</label>
              <input className={input} value={form.handle} onChange={(e) => set('handle', e.target.value)} placeholder="@espacoluanda" />
            </div>
            <div>
              <label className={label}>Email</label>
              <input className={input} type="email" value={form.contactEmail} onChange={(e) => set('contactEmail', e.target.value)} />
            </div>
            <div>
              <label className={label}>Phone</label>
              <input className={input} value={form.contactPhone} onChange={(e) => set('contactPhone', e.target.value)} />
            </div>
          </div>

          <div>
            <label className={label}>Notes</label>
            <textarea
              className={`${input} min-h-[80px]`}
              value={form.notes}
              onChange={(e) => set('notes', e.target.value)}
              placeholder="Tone, what they like, what to avoid, where they shoot…"
            />
          </div>

          {error && <p className="text-sm text-danger">{error}</p>}
        </div>
        <div className="flex justify-end gap-2 px-5 py-4 border-t border-border">
          <button onClick={onClose} className="text-sm px-4 py-2 rounded-lg text-text-muted hover:bg-surface-2">
            Cancel
          </button>
          <button
            onClick={save}
            disabled={saving}
            className="text-sm font-medium px-4 py-2 rounded-lg bg-primary text-white hover:bg-primary-dark disabled:opacity-50"
          >
            {saving ? 'Saving…' : client ? 'Save' : 'Add client'}
          </button>
        </div>
      </div>
    </div>
  )
}
