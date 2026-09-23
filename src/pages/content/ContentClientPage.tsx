import React, { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import {
  ChevronLeft, Pencil, Archive, ArchiveRestore, Trash2, Plus, Upload, FileText, X, AlertTriangle, Video,
  Scissors, Send, ClipboardList, Mail, Phone, AtSign, User,
} from 'lucide-react'
import { useAuthStore } from '../../store/authStore'
import { useContentStore } from '../../store/contentStore'
import { ContentClient, ContentEdit, ContentPostRule, ContentRecording } from '../../types'
import {
  addDays, availableToEdit, CADENCE_LABEL, daysBetween, flowFor, formatDay, pieceTag, sortRecordings, suggestCadence,
  todayKey, WEEKDAY_SHORT,
} from '../../utils/contentPipeline'
import {
  ClientDialog, KIND_COLOR, PersonSelect, PlanViewer, useContentBase, useContentData, usePersonName,
} from '../../components/content/contentShared'

/** Monday first, the way the calendar is drawn. Values are still 0 = Sunday. */
const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0]

const input =
  'text-sm bg-surface border border-border-md rounded-md px-2 py-1.5 text-text-main focus:outline-none focus:ring-2 focus:ring-primary/30'
const label = 'block text-xs font-medium text-text-muted mb-1'

function report(e: unknown) {
  alert((e as Error).message)
}

/**
 * One client: their profile, and the four stages their content goes through.
 *
 * The flow is top to bottom: add recordings (each with the content plan that
 * has to come before it), then editing sessions that take some of what has
 * been recorded, then the days the finished pieces go out.
 */
export function ContentClientPage() {
  const { clientId } = useParams()
  const data = useContentData()
  const base = useContentBase()
  const navigate = useNavigate()
  const isOwner = useAuthStore((s) => !!s.realUser?.isOwner || s.realUser?.role === 'admin')
  const [editing, setEditing] = useState(false)
  const [viewing, setViewing] = useState<ContentRecording | null>(null)

  const client = data.clients.find((c) => c.id === clientId)
  const recordings = useMemo(() => data.recordings.filter((r) => r.clientId === clientId), [data.recordings, clientId])
  const edits = useMemo(() => data.edits.filter((e) => e.clientId === clientId), [data.edits, clientId])
  const rules = useMemo(() => data.rules.filter((r) => r.clientId === clientId), [data.rules, clientId])
  const posted = useMemo(() => data.posted.filter((p) => p.clientId === clientId), [data.posted, clientId])

  const today = todayKey()
  // Far enough ahead that every piece recorded so far has reached a slot.
  const latest = [...recordings.map((r) => r.recordedOn), ...edits.map((e) => e.editedOn), today].sort().pop()!
  const until = addDays(latest, 120)
  const flow = useMemo(() => flowFor(recordings, edits, rules, posted, until), [recordings, edits, rules, posted, until])

  if (!data.loaded) return <p className="text-text-muted text-sm py-8">Loading…</p>
  if (!client) {
    return (
      <div className="py-10">
        <Link to={base} className="text-sm text-text-muted hover:text-text-main inline-flex items-center gap-1">
          <ChevronLeft size={14} /> Content calendar
        </Link>
        <p className="mt-4 text-text-muted">This client does not exist any more.</p>
      </div>
    )
  }

  const recorded = flow.pieces.length
  const edited = flow.pieces.filter((p) => p.editId).length
  const scheduled = flow.pieces.filter((p) => p.postOn).length
  const postedCount = flow.slots.filter((s) => s.done && s.piece).length
  const emptyAhead = flow.slots.filter((s) => !s.piece && s.day >= today && s.day <= addDays(today, 60))

  const remove = async () => {
    if (!confirm(`Delete ${client.name} and all their recordings, edits, posting days and plans? This cannot be undone.`)) return
    try {
      await data.deleteClient(client.id)
      navigate(base)
    } catch (e) {
      report(e)
    }
  }

  return (
    <div className="text-text-main max-w-6xl">
      <Link to={base} className="text-sm text-text-muted hover:text-text-main inline-flex items-center gap-1">
        <ChevronLeft size={14} /> Content calendar
      </Link>

      {/* ─── Profile ────────────────────────────────────────────────────── */}
      <header className="mt-4 flex flex-wrap items-start gap-4 justify-between">
        <div className="flex items-start gap-4 min-w-0">
          <div
            className="w-14 h-14 rounded-lg flex items-center justify-center text-white font-extrabold text-lg flex-shrink-0"
            style={{ backgroundColor: client.color }}
          >
            {client.code}
          </div>
          <div className="min-w-0">
            <h1 className="text-4xl md:text-5xl font-extrabold tracking-tight leading-none">{client.name}</h1>
            <p className="text-text-muted mt-2">
              {client.postsPerMonth} posts a month
              {client.isArchived && <span className="ml-2 text-xs font-semibold uppercase bg-surface-2 px-1.5 py-0.5 rounded">Archived</span>}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setEditing(true)} className="flex items-center gap-1.5 text-sm font-medium px-3 py-2 rounded-lg border border-border-md bg-surface hover:bg-surface-2">
            <Pencil size={14} /> Edit profile
          </button>
          <button
            onClick={() => data.updateClient(client.id, { isArchived: !client.isArchived }).catch(report)}
            className="flex items-center gap-1.5 text-sm font-medium px-3 py-2 rounded-lg border border-border-md bg-surface hover:bg-surface-2"
          >
            {client.isArchived ? <ArchiveRestore size={14} /> : <Archive size={14} />}
            {client.isArchived ? 'Restore' : 'Archive'}
          </button>
          {isOwner && (
            <button onClick={remove} className="p-2 rounded-lg border border-border-md bg-surface text-danger hover:bg-danger-bg" title="Delete client">
              <Trash2 size={15} />
            </button>
          )}
        </div>
      </header>

      <div className="grid gap-4 md:grid-cols-[1fr_1.4fr] mt-6">
        <div className="bg-surface border border-border-md rounded-md p-4 text-sm space-y-2">
          {[
            [User, client.contactName],
            [Mail, client.contactEmail],
            [Phone, client.contactPhone],
            [AtSign, client.handle],
          ]
            .filter(([, v]) => v)
            .map(([Icon, v], i) => {
              const I = Icon as typeof User
              return (
                <p key={i} className="flex items-center gap-2">
                  <I size={14} className="text-text-subtle" /> {v as string}
                </p>
              )
            })}
          {client.notes ? (
            <p className="whitespace-pre-wrap text-text-muted pt-1">{client.notes}</p>
          ) : (
            !client.contactName && !client.contactEmail && !client.contactPhone && !client.handle && (
              <p className="text-text-muted">
                No contact details yet.{' '}
                <button onClick={() => setEditing(true)} className="text-primary font-medium hover:underline">
                  Add them
                </button>
              </p>
            )
          )}
        </div>

        {/* The pipeline at a glance. */}
        <div className="grid grid-cols-4 gap-2">
          {[
            ['Recorded', recorded, KIND_COLOR.record, `${recordings.length} shoot${recordings.length === 1 ? '' : 's'}`],
            ['Edited', edited, KIND_COLOR.edit, recorded - edited ? `${recorded - edited} waiting` : 'all caught up'],
            ['Scheduled', scheduled, KIND_COLOR.post, edited - scheduled ? `${edited - scheduled} without a day` : 'all have a day'],
            ['Posted', postedCount, '#1B4F8A', `${scheduled - postedCount} to go`],
          ].map(([name, n, color, sub]) => (
            <div key={name as string} className="bg-surface border border-border-md rounded-md px-3 py-3 border-t-4" style={{ borderTopColor: color as string }}>
              <p className="text-xs font-medium text-text-muted">{name}</p>
              <p className="text-3xl font-extrabold leading-tight">{n as number}</p>
              <p className="text-[0.72rem] text-text-muted">{sub}</p>
            </div>
          ))}
        </div>
      </div>

      {emptyAhead.length > 0 && (
        <div className="mt-4 flex items-start gap-2 bg-warning-bg text-warning rounded-md px-4 py-3 text-sm">
          <AlertTriangle size={16} className="flex-shrink-0 mt-0.5" />
          <span>
            {emptyAhead.length} posting day{emptyAhead.length === 1 ? '' : 's'} in the next two months {emptyAhead.length === 1 ? 'has' : 'have'} nothing
            edited in time: {emptyAhead.slice(0, 6).map((s) => formatDay(s.day, { day: 'numeric', month: 'short' })).join(', ')}
            {emptyAhead.length > 6 ? '…' : ''}. Add a recording or an editing session before then.
          </span>
        </div>
      )}

      {/* ─── 1. Recordings ──────────────────────────────────────────────── */}
      <Stage n={1} icon={<Video size={18} />} title="Recordings" color={KIND_COLOR.record}>
        <p className="text-sm text-text-muted mb-4 max-w-[70ch]">
          Every shoot needs a content plan first — it is a task of its own, due a few days before, with a place to upload
          the plan.
        </p>
        <RecordingForm client={client} recordings={recordings} />
        <div className="mt-4 space-y-2">
          {sortRecordings(recordings).map((r) => (
            <RecordingRow key={r.id} recording={r} client={client} flow={flow} onView={() => setViewing(r)} />
          ))}
        </div>
      </Stage>

      {/* ─── 2. Editing ─────────────────────────────────────────────────── */}
      <Stage n={2} icon={<Scissors size={18} />} title="Editing" color={KIND_COLOR.edit}>
        <p className="text-sm text-text-muted mb-4 max-w-[70ch]">
          Drag the bar to choose how many of the recorded videos a session edits. It can only take what has been
          recorded by its day and not edited yet, oldest first.
        </p>
        <EditForm client={client} recordings={recordings} edits={edits} />
        <div className="mt-4 space-y-2">
          {flow.edits.map((f) => (
            <EditRow key={f.edit.id} client={client} edit={f.edit} recordings={recordings} edits={edits} from={f.from} to={f.to} short={f.short} />
          ))}
        </div>
      </Stage>

      {/* ─── 3. Posting ─────────────────────────────────────────────────── */}
      <Stage n={3} icon={<Send size={18} />} title="Posting" color={KIND_COLOR.post}>
        <p className="text-sm text-text-muted mb-4 max-w-[70ch]">
          Pick the days they post. Each posting day publishes the next edited piece.
        </p>
        <RuleForm client={client} defaultStart={edits.map((e) => e.editedOn).sort()[0] ?? today} />
        <div className="mt-4 space-y-2">
          {rules.map((r) => (
            <RuleRow key={r.id} rule={r} client={client} />
          ))}
        </div>
      </Stage>

      {/* ─── Pieces ─────────────────────────────────────────────────────── */}
      <Stage n={4} icon={<ClipboardList size={18} />} title="Every piece" color="#1B4F8A">
        {flow.pieces.length === 0 ? (
          <p className="text-sm text-text-muted">Pieces appear here once a recording is added.</p>
        ) : (
          <div className="overflow-x-auto bg-surface border border-border-md rounded-md">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="bg-surface-2/60 text-text-muted">
                  <th className="text-left font-semibold px-3 py-2">Piece</th>
                  <th className="text-left font-semibold px-3 py-2">Recorded</th>
                  <th className="text-left font-semibold px-3 py-2">Edited</th>
                  <th className="text-left font-semibold px-3 py-2">Goes live</th>
                  <th className="text-left font-semibold px-3 py-2">Posted</th>
                </tr>
              </thead>
              <tbody>
                {flow.pieces.map((p) => {
                  const slot = p.postOn ? flow.slots.find((s) => s.day === p.postOn) : null
                  return (
                    <tr key={p.n} className="border-t border-border">
                      <td className="px-3 py-1.5 font-semibold whitespace-nowrap" style={{ color: client.color }}>
                        {pieceTag(client, p.n)}
                      </td>
                      <td className="px-3 py-1.5 whitespace-nowrap">{formatDay(p.recordedOn)}</td>
                      <td className="px-3 py-1.5 whitespace-nowrap">
                        {p.editedOn ? formatDay(p.editedOn) : <span className="text-text-subtle">not yet</span>}
                      </td>
                      <td className="px-3 py-1.5 whitespace-nowrap">
                        {p.postOn ? formatDay(p.postOn) : <span className="text-text-subtle">{p.editedOn ? 'no posting day yet' : '—'}</span>}
                      </td>
                      <td className="px-3 py-1.5">
                        {slot && (
                          <input
                            type="checkbox"
                            checked={!!slot.done}
                            onChange={(e) => data.setPosted(client.id, slot.day, e.target.checked).catch(report)}
                            className="w-4 h-4 accent-primary cursor-pointer"
                          />
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </Stage>

      {editing && <ClientDialog client={client} onClose={() => setEditing(false)} />}
      {viewing && <PlanViewer recording={viewing} client={client} onClose={() => setViewing(null)} />}
    </div>
  )
}

// ─── Layout ─────────────────────────────────────────────────────────────────

function Stage({ n, icon, title, color, children }: { n: number; icon: React.ReactNode; title: string; color: string; children: React.ReactNode }) {
  return (
    <section className="mt-12">
      <h2 className="text-2xl font-extrabold tracking-tight mb-2 flex items-center gap-2.5">
        <span className="w-8 h-8 rounded-md text-white flex items-center justify-center" style={{ backgroundColor: color }}>
          {icon}
        </span>
        <span className="text-text-subtle">{n}.</span> {title}
      </h2>
      {children}
    </section>
  )
}

function DoneBox({ done, onChange, label: text }: { done: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <label className={`flex items-center gap-1.5 text-sm cursor-pointer select-none ${done ? 'text-success font-medium' : 'text-text-muted'}`}>
      <input type="checkbox" checked={done} onChange={(e) => onChange(e.target.checked)} className="w-4 h-4 accent-primary" />
      {text}
    </label>
  )
}

/** A number that saves when you leave it, not on every keystroke. */
function NumberField({ value, min = 1, max = 99, onCommit, className = '' }: { value: number; min?: number; max?: number; onCommit: (n: number) => void; className?: string }) {
  const [v, setV] = useState(String(value))
  useEffect(() => setV(String(value)), [value])
  const commit = () => {
    const n = Math.min(max, Math.max(min, Math.round(Number(v) || min)))
    setV(String(n))
    if (n !== value) onCommit(n)
  }
  return (
    <input
      type="number"
      min={min}
      max={max}
      value={v}
      onChange={(e) => setV(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
      className={`${input} w-16 ${className}`}
    />
  )
}

/**
 * The bar that sets how many videos an editing session takes. Moves freely
 * while dragged and saves when let go.
 */
function PieceSlider({ value, max, onChange, onCommit, color }: { value: number; max: number; onChange?: (n: number) => void; onCommit?: (n: number) => void; color: string }) {
  const [v, setV] = useState(value)
  useEffect(() => setV(value), [value])
  const top = Math.max(1, max)
  const commit = () => v !== value && onCommit?.(v)
  return (
    <div className="flex items-center gap-3 flex-1 min-w-[200px]">
      <input
        type="range"
        min={1}
        max={top}
        step={1}
        value={Math.min(v, top)}
        disabled={max < 1}
        onChange={(e) => {
          const n = Number(e.target.value)
          setV(n)
          onChange?.(n)
        }}
        onPointerUp={commit}
        onKeyUp={commit}
        onBlur={commit}
        className="flex-1 h-2 cursor-pointer disabled:cursor-not-allowed"
        style={{ accentColor: color }}
      />
      <span className="text-sm font-semibold tabular-nums whitespace-nowrap w-24 text-right">
        {max < 1 ? '0 available' : `${Math.min(v, top)} / ${max} videos`}
      </span>
    </div>
  )
}

// ─── Recordings ─────────────────────────────────────────────────────────────

function RecordingForm({ client, recordings }: { client: ContentClient; recordings: ContentRecording[] }) {
  const addRecordings = useContentStore((s) => s.addRecordings)
  const me = useAuthStore((s) => s.currentUser?.id ?? null)
  const [open, setOpen] = useState(recordings.length === 0)
  const [date, setDate] = useState(() => addDays(todayKey(), 7))
  const [pieces, setPieces] = useState(4)
  const [every, setEvery] = useState(0)
  const [times, setTimes] = useState(2)
  const [who, setWho] = useState<string | null>(null)
  const [planBefore, setPlanBefore] = useState(2)
  const [planner, setPlanner] = useState<string | null>(me)
  const [saving, setSaving] = useState(false)

  const dates = every ? Array.from({ length: Math.max(1, times) }, (_, i) => addDays(date, i * every * 7)) : [date]
  const cadence = suggestCadence(client.postsPerMonth, pieces)

  const save = async () => {
    setSaving(true)
    try {
      await addRecordings(
        dates.map((d) => ({
          clientId: client.id,
          recordedOn: d,
          pieces,
          assigneeId: who,
          planOn: addDays(d, -planBefore),
          planAssigneeId: planner,
        })),
      )
      setOpen(false)
    } catch (e) {
      report(e)
    } finally {
      setSaving(false)
    }
  }

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="flex items-center gap-1.5 text-sm font-medium px-3 py-2 rounded-lg border border-dashed border-border-md text-text-muted hover:text-text-main hover:border-text-muted">
        <Plus size={14} /> Add recording
      </button>
    )
  }

  return (
    <div className="bg-surface border border-border-md rounded-md p-4">
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label className={label}>First shoot</label>
          <input type="date" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} className={input} />
        </div>
        <div>
          <label className={label}>Videos per shoot</label>
          <NumberField value={pieces} onCommit={setPieces} />
        </div>
        <div>
          <label className={label}>Repeat</label>
          <select value={every} onChange={(e) => setEvery(Number(e.target.value))} className={input}>
            <option value={0}>Just once</option>
            <option value={1}>Every week</option>
            <option value={2}>Every 2 weeks</option>
            <option value={3}>Every 3 weeks</option>
            <option value={4}>Every 4 weeks</option>
          </select>
        </div>
        {every > 0 && (
          <div>
            <label className={label}>How many shoots</label>
            <NumberField value={times} max={52} onCommit={setTimes} />
          </div>
        )}
        <div>
          <label className={label}>Recorded by</label>
          <PersonSelect value={who} onChange={setWho} />
        </div>
      </div>
      <div className="flex flex-wrap items-end gap-3 mt-3">
        <div>
          <label className={label}>Content plan due</label>
          <select value={planBefore} onChange={(e) => setPlanBefore(Number(e.target.value))} className={input}>
            {[0, 1, 2, 3, 4, 5, 7, 10, 14].map((n) => (
              <option key={n} value={n}>
                {n === 0 ? 'The day of the shoot' : `${n} day${n === 1 ? '' : 's'} before`}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className={label}>Planned by</label>
          <PersonSelect value={planner} onChange={setPlanner} />
        </div>
      </div>

      {cadence && (
        <p className="text-xs text-text-muted mt-3">
          {client.postsPerMonth} posts a month at {pieces} videos a shoot is about {cadence.shootsPerMonth.toFixed(1).replace(/\.0$/, '')} shoots a
          month — record {CADENCE_LABEL[cadence.every]}.{' '}
          {every !== cadence.every && (
            <button
              onClick={() => {
                setEvery(cadence.every)
                setTimes(Math.max(2, Math.round(4.3 / cadence.every)))
              }}
              className="text-primary font-semibold hover:underline"
            >
              Use that
            </button>
          )}
        </p>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3 mt-4 pt-3 border-t border-border">
        <p className="text-sm text-text-muted">
          {dates.length === 1 ? 'One shoot' : `${dates.length} shoots`}:{' '}
          <span className="text-text-main">{dates.map((d) => formatDay(d)).join(', ')}</span> · {dates.length * pieces} videos
        </p>
        <div className="flex gap-2">
          {recordings.length > 0 && (
            <button onClick={() => setOpen(false)} className="text-sm px-3 py-2 rounded-lg text-text-muted hover:bg-surface-2">
              Cancel
            </button>
          )}
          <button onClick={save} disabled={saving} className="text-sm font-medium px-4 py-2 rounded-lg bg-primary text-white hover:bg-primary-dark disabled:opacity-50">
            {saving ? 'Adding…' : dates.length === 1 ? 'Add recording' : `Add ${dates.length} recordings`}
          </button>
        </div>
      </div>
    </div>
  )
}

function RecordingRow({
  recording: r,
  client,
  flow,
  onView,
}: {
  recording: ContentRecording
  client: ContentClient
  flow: ReturnType<typeof flowFor>
  onView: () => void
}) {
  const { updateRecording, deleteRecording, uploadPlan, removePlanFile } = useContentStore()
  const fileRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)
  const [notes, setNotes] = useState(r.planNotes)
  const [showNotes, setShowNotes] = useState(!!r.planNotes)
  useEffect(() => setNotes(r.planNotes), [r.planNotes])

  const own = flow.pieces.filter((p) => p.recordingId === r.id)
  const edited = own.filter((p) => p.editId).length
  const hasPlan = !!(r.planPath || r.planNotes)

  const save = (patch: Parameters<typeof updateRecording>[1]) => updateRecording(r.id, patch).catch(report)

  const upload = async (file: File | undefined) => {
    if (!file) return
    setUploading(true)
    try {
      await uploadPlan(r.id, file)
    } catch (e) {
      report(e)
    } finally {
      setUploading(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  return (
    <div className="bg-surface border border-border-md rounded-md border-l-4" style={{ borderLeftColor: KIND_COLOR.record }}>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
        <input
          type="date"
          value={r.recordedOn}
          onChange={(e) => {
            const d = e.target.value
            if (!d) return
            // The plan moves with the shoot, keeping its lead time.
            const shift = daysBetween(r.recordedOn, d)
            save({ recordedOn: d, planOn: r.planOn ? addDays(r.planOn, shift) : null })
          }}
          className={`${input} font-semibold`}
        />
        <span className="flex items-center gap-1.5 text-sm">
          <NumberField value={r.pieces} onCommit={(n) => save({ pieces: n })} /> videos
        </span>
        <span className="text-xs font-semibold" style={{ color: client.color }}>
          {own.length ? `${pieceTag(client, own[0].n)}–${String(own[own.length - 1].n).padStart(2, '0')}` : ''}
        </span>
        <span className="text-xs text-text-muted">{edited} of {own.length} edited</span>
        <PersonSelect value={r.assigneeId} onChange={(id) => save({ assigneeId: id })} placeholder="Recorded by…" />
        <DoneBox done={!!r.doneAt} onChange={(v) => save({ doneAt: v ? new Date().toISOString() : null })} label="Recorded" />
        <button
          onClick={() => confirm(`Delete the ${formatDay(r.recordedOn)} recording and its plan?`) && deleteRecording(r.id).catch(report)}
          className="ml-auto p-1.5 rounded-md text-text-subtle hover:text-danger hover:bg-danger-bg"
          title="Delete recording"
        >
          <Trash2 size={14} />
        </button>
      </div>

      {/* The content plan: its own task, due before the shoot. */}
      <div className="border-t border-border bg-blue-bg/40 px-4 py-3">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <span className="text-sm font-semibold flex items-center gap-1.5" style={{ color: KIND_COLOR.plan }}>
            <FileText size={14} /> Content plan
          </span>
          <span className="flex items-center gap-1.5 text-sm text-text-muted">
            due
            <input type="date" value={r.planOn ?? ''} onChange={(e) => save({ planOn: e.target.value || null })} className={input} />
          </span>
          <PersonSelect value={r.planAssigneeId} onChange={(id) => save({ planAssigneeId: id })} placeholder="Planned by…" />
          <DoneBox done={!!r.planDoneAt} onChange={(v) => save({ planDoneAt: v ? new Date().toISOString() : null })} label="Planned" />

          <div className="flex items-center gap-2 ml-auto">
            {r.planPath ? (
              <>
                <button onClick={onView} className="flex items-center gap-1.5 text-sm font-medium px-2.5 py-1.5 rounded-md bg-surface border border-border-md hover:bg-surface-2 max-w-[220px]">
                  <FileText size={13} className="flex-shrink-0" />
                  <span className="truncate">{r.planName ?? 'View plan'}</span>
                </button>
                <button
                  onClick={() => fileRef.current?.click()}
                  className="text-xs font-medium text-text-muted hover:text-text-main"
                  disabled={uploading}
                >
                  {uploading ? 'Uploading…' : 'Replace'}
                </button>
                <button onClick={() => removePlanFile(r.id).catch(report)} className="p-1 text-text-subtle hover:text-danger" title="Remove file">
                  <X size={13} />
                </button>
              </>
            ) : (
              <button
                onClick={() => fileRef.current?.click()}
                disabled={uploading}
                className="flex items-center gap-1.5 text-sm font-medium px-2.5 py-1.5 rounded-md bg-surface border border-border-md hover:bg-surface-2"
              >
                <Upload size={13} /> {uploading ? 'Uploading…' : 'Upload plan'}
              </button>
            )}
            {!showNotes && (
              <button onClick={() => setShowNotes(true)} className="text-xs font-medium text-text-muted hover:text-text-main">
                Write it here
              </button>
            )}
            {hasPlan && !r.planPath && (
              <button onClick={onView} className="text-xs font-medium text-blue-accent hover:underline">
                View
              </button>
            )}
            <input ref={fileRef} type="file" className="hidden" onChange={(e) => upload(e.target.files?.[0])} />
          </div>
        </div>
        {showNotes && (
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            onBlur={() => notes !== r.planNotes && save({ planNotes: notes })}
            placeholder={`Ideas, hooks, shot list for the ${r.pieces} videos…`}
            className={`${input} w-full mt-3 min-h-[90px]`}
          />
        )}
      </div>
    </div>
  )
}

// ─── Editing ────────────────────────────────────────────────────────────────

function EditForm({ client, recordings, edits }: { client: ContentClient; recordings: ContentRecording[]; edits: ContentEdit[] }) {
  const addEdit = useContentStore((s) => s.addEdit)
  const lastShoot = sortRecordings(recordings).pop()?.recordedOn
  const [open, setOpen] = useState(false)
  const [date, setDate] = useState(() => (lastShoot ? addDays(lastShoot, 1) : todayKey()))
  const [who, setWho] = useState<string | null>(null)
  const { available, recordedBy, taken } = availableToEdit(recordings, edits, date, null)
  const [pieces, setPieces] = useState(available)
  const [saving, setSaving] = useState(false)

  // Following the day: moving it changes what there is to edit.
  useEffect(() => setPieces(available), [available])

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        disabled={recordings.length === 0}
        title={recordings.length === 0 ? 'Add a recording first' : undefined}
        className="flex items-center gap-1.5 text-sm font-medium px-3 py-2 rounded-lg border border-dashed border-border-md text-text-muted hover:text-text-main hover:border-text-muted disabled:opacity-50 disabled:cursor-not-allowed"
      >
        <Plus size={14} /> Add editing session
      </button>
    )
  }

  const save = async () => {
    if (available < 1) return
    setSaving(true)
    try {
      await addEdit({ clientId: client.id, editedOn: date, pieces: Math.min(pieces, available), assigneeId: who })
      setOpen(false)
    } catch (e) {
      report(e)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="bg-surface border border-border-md rounded-md p-4">
      <div className="flex flex-wrap items-end gap-4">
        <div>
          <label className={label}>Editing day</label>
          <input type="date" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} className={input} />
        </div>
        <div className="flex-1 min-w-[260px]">
          <label className={label}>Videos to edit</label>
          <PieceSlider value={pieces} max={available} onChange={setPieces} color={client.color} />
        </div>
        <div>
          <label className={label}>Edited by</label>
          <PersonSelect value={who} onChange={setWho} />
        </div>
      </div>
      <p className="text-xs text-text-muted mt-3">
        By {formatDay(date)}: {recordedBy} recorded, {taken} already edited, so {available} available
        {available < 1 ? ' — pick a day after a shoot.' : '.'}
      </p>
      <div className="flex justify-end gap-2 mt-3 pt-3 border-t border-border">
        <button onClick={() => setOpen(false)} className="text-sm px-3 py-2 rounded-lg text-text-muted hover:bg-surface-2">
          Cancel
        </button>
        <button onClick={save} disabled={saving || available < 1} className="text-sm font-medium px-4 py-2 rounded-lg bg-primary text-white hover:bg-primary-dark disabled:opacity-50">
          {saving ? 'Adding…' : `Edit ${Math.min(pieces, available)} video${Math.min(pieces, available) === 1 ? '' : 's'}`}
        </button>
      </div>
    </div>
  )
}

function EditRow({
  client,
  edit: e,
  recordings,
  edits,
  from,
  to,
  short,
}: {
  client: ContentClient
  edit: ContentEdit
  recordings: ContentRecording[]
  edits: ContentEdit[]
  from: number
  to: number
  short: number
}) {
  const { updateEdit, deleteEdit } = useContentStore()
  const { available } = availableToEdit(recordings, edits, e.editedOn, e.id, e.createdAt)
  const save = (patch: Parameters<typeof updateEdit>[1]) => updateEdit(e.id, patch).catch(report)

  return (
    <div className="bg-surface border border-border-md rounded-md border-l-4 px-4 py-3" style={{ borderLeftColor: KIND_COLOR.edit }}>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <input type="date" value={e.editedOn} onChange={(ev) => ev.target.value && save({ editedOn: ev.target.value })} className={`${input} font-semibold`} />
        <PieceSlider value={e.pieces} max={available} onCommit={(n) => save({ pieces: n })} color={client.color} />
        <span className="text-xs font-semibold w-24" style={{ color: client.color }}>
          {to >= from ? `${pieceTag(client, from)}${to > from ? `–${String(to).padStart(2, '0')}` : ''}` : ''}
        </span>
        <PersonSelect value={e.assigneeId} onChange={(id) => save({ assigneeId: id })} placeholder="Edited by…" />
        <DoneBox done={!!e.doneAt} onChange={(v) => save({ doneAt: v ? new Date().toISOString() : null })} label="Edited" />
        <button
          onClick={() => confirm('Delete this editing session?') && deleteEdit(e.id).catch(report)}
          className="ml-auto p-1.5 rounded-md text-text-subtle hover:text-danger hover:bg-danger-bg"
          title="Delete editing session"
        >
          <Trash2 size={14} />
        </button>
      </div>
      {short > 0 && (
        <p className="text-xs text-warning mt-2 flex items-center gap-1">
          <AlertTriangle size={12} /> Set to {e.pieces}, but only {e.pieces - short} had been recorded and not edited by then.
        </p>
      )}
    </div>
  )
}

// ─── Posting ────────────────────────────────────────────────────────────────

function WeekdayPicker({ value, onChange, color }: { value: number[]; onChange: (v: number[]) => void; color: string }) {
  return (
    <div className="flex gap-1">
      {WEEK_ORDER.map((d) => {
        const on = value.includes(d)
        return (
          <button
            key={d}
            type="button"
            aria-pressed={on}
            onClick={() => onChange(on ? value.filter((x) => x !== d) : [...value, d].sort())}
            className={`w-11 py-1.5 text-xs font-semibold rounded-md border transition-colors ${on ? 'text-white' : 'bg-surface text-text-muted border-border-md hover:text-text-main'}`}
            style={on ? { backgroundColor: color, borderColor: color } : undefined}
          >
            {WEEKDAY_SHORT[d]}
          </button>
        )
      })}
    </div>
  )
}

function perMonthOf(days: number, every: number) {
  return Math.round((days * 4.3) / every)
}

function RuleForm({ client, defaultStart }: { client: ContentClient; defaultStart: string }) {
  const addRule = useContentStore((s) => s.addRule)
  const [open, setOpen] = useState(false)
  const [days, setDays] = useState<number[]>([])
  const [every, setEvery] = useState(1)
  const [start, setStart] = useState(defaultStart)
  const [end, setEnd] = useState('')
  const [who, setWho] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  if (!open) {
    return (
      <button
        onClick={() => {
          setStart(defaultStart)
          setOpen(true)
        }}
        className="flex items-center gap-1.5 text-sm font-medium px-3 py-2 rounded-lg border border-dashed border-border-md text-text-muted hover:text-text-main hover:border-text-muted"
      >
        <Plus size={14} /> Add posting days
      </button>
    )
  }

  const save = async () => {
    if (days.length === 0) return
    setSaving(true)
    try {
      await addRule({ clientId: client.id, weekdays: days, everyWeeks: every, startsOn: start, endsOn: end || null, assigneeId: who })
      setOpen(false)
      setDays([])
    } catch (e) {
      report(e)
    } finally {
      setSaving(false)
    }
  }

  const perMonth = perMonthOf(days.length, every)
  return (
    <div className="bg-surface border border-border-md rounded-md p-4">
      <div className="flex flex-wrap items-end gap-4">
        <div>
          <label className={label}>Post on</label>
          <WeekdayPicker value={days} onChange={setDays} color={client.color} />
        </div>
        <div>
          <label className={label}>Every</label>
          <select value={every} onChange={(e) => setEvery(Number(e.target.value))} className={input}>
            <option value={1}>Week</option>
            <option value={2}>2 weeks</option>
          </select>
        </div>
        <div>
          <label className={label}>From</label>
          <input type="date" value={start} onChange={(e) => e.target.value && setStart(e.target.value)} className={input} />
        </div>
        <div>
          <label className={label}>Until (optional)</label>
          <input type="date" value={end} min={start} onChange={(e) => setEnd(e.target.value)} className={input} />
        </div>
        <div>
          <label className={label}>Posted by</label>
          <PersonSelect value={who} onChange={setWho} />
        </div>
      </div>
      <p className={`text-xs mt-3 ${days.length && perMonth !== client.postsPerMonth ? 'text-warning' : 'text-text-muted'}`}>
        {days.length === 0
          ? 'Pick the days of the week they post.'
          : `${days.length} day${days.length === 1 ? '' : 's'} ${every === 1 ? 'a week' : 'every 2 weeks'} is about ${perMonth} posts a month — the target is ${client.postsPerMonth}.`}
      </p>
      <div className="flex justify-end gap-2 mt-3 pt-3 border-t border-border">
        <button onClick={() => setOpen(false)} className="text-sm px-3 py-2 rounded-lg text-text-muted hover:bg-surface-2">
          Cancel
        </button>
        <button onClick={save} disabled={saving || days.length === 0} className="text-sm font-medium px-4 py-2 rounded-lg bg-primary text-white hover:bg-primary-dark disabled:opacity-50">
          {saving ? 'Adding…' : 'Add posting days'}
        </button>
      </div>
    </div>
  )
}

function RuleRow({ rule: r, client }: { rule: ContentPostRule; client: ContentClient }) {
  const { updateRule, deleteRule } = useContentStore()
  const save = (patch: Parameters<typeof updateRule>[1]) => updateRule(r.id, patch).catch(report)
  return (
    <div className="bg-surface border border-border-md rounded-md border-l-4 px-4 py-3 flex flex-wrap items-center gap-x-4 gap-y-2" style={{ borderLeftColor: KIND_COLOR.post }}>
      <WeekdayPicker value={r.weekdays} onChange={(v) => v.length && save({ weekdays: v })} color={client.color} />
      <select value={r.everyWeeks} onChange={(e) => save({ everyWeeks: Number(e.target.value) })} className={input}>
        <option value={1}>every week</option>
        <option value={2}>every 2 weeks</option>
      </select>
      <span className="flex items-center gap-1.5 text-sm text-text-muted">
        from
        <input type="date" value={r.startsOn} onChange={(e) => e.target.value && save({ startsOn: e.target.value })} className={input} />
        until
        <input type="date" value={r.endsOn ?? ''} min={r.startsOn} onChange={(e) => save({ endsOn: e.target.value || null })} className={input} />
      </span>
      <PersonSelect value={r.assigneeId} onChange={(id) => save({ assigneeId: id })} placeholder="Posted by…" />
      <span className="text-xs text-text-muted">≈ {perMonthOf(r.weekdays.length, r.everyWeeks)}/month</span>
      <button
        onClick={() => confirm('Delete these posting days?') && deleteRule(r.id).catch(report)}
        className="ml-auto p-1.5 rounded-md text-text-subtle hover:text-danger hover:bg-danger-bg"
        title="Delete posting days"
      >
        <Trash2 size={14} />
      </button>
    </div>
  )
}

