import React, { useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { ChevronLeft, ChevronRight, Plus, AlertTriangle, Check, FileText, ArrowRight, Archive } from 'lucide-react'
import { useAuthStore } from '../../store/authStore'
import { ContentClient } from '../../types'
import {
  addDays, formatDay, mondayOf, monthBounds, shiftMonth, todayKey, suggestCadence, CADENCE_LABEL,
} from '../../utils/contentPipeline'
import {
  ClientDialog, ContentTask, KIND_COLOR, KIND_LABEL, PlanViewer, toggleTask, useContentBase, useContentData,
  useContentTasks, usePersonName,
} from '../../components/content/contentShared'

const DOW = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

/**
 * The content calendar: every client's plans, shoots, edits and posts on one
 * month. Shaped after the agency's October plan — a month you can read at a
 * glance, filtered to one client with a click, with the same work as a
 * week-by-week checklist underneath.
 */
export function ContentCalendar() {
  const data = useContentData()
  const base = useContentBase()
  const me = useAuthStore((s) => s.currentUser?.id ?? null)
  const nameOf = usePersonName()
  const [params, setParams] = useSearchParams()

  const today = todayKey()
  const month = params.get('m') ? `${params.get('m')}-01` : monthBounds(today).first
  const filter = params.get('c') ?? 'all'
  const mine = params.get('mine') === '1'
  const { first, last } = monthBounds(month)
  const gridStart = mondayOf(first)
  const gridEnd = addDays(mondayOf(last), 6)

  const [adding, setAdding] = useState(false)
  const [viewing, setViewing] = useState<ContentTask | null>(null)
  const [showArchived, setShowArchived] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)

  const { flows, tasks } = useContentTasks(gridEnd)

  const setParam = (k: string, v: string | null) => {
    const next = new URLSearchParams(params)
    if (v === null) next.delete(k)
    else next.set(k, v)
    setParams(next, { replace: true })
  }

  const active = data.clients.filter((c) => !c.isArchived)
  const archived = data.clients.filter((c) => c.isArchived)
  const current = active.find((c) => c.id === filter) ?? null

  const shown = useMemo(
    () =>
      tasks.filter(
        (t) => (filter === 'all' || t.client.id === filter) && (!mine || t.assigneeId === me),
      ),
    [tasks, filter, mine, me],
  )
  const byDay = useMemo(() => {
    const m = new Map<string, ContentTask[]>()
    for (const t of shown) (m.get(t.day) ?? m.set(t.day, []).get(t.day)!).push(t)
    return m
  }, [shown])

  const tick = async (t: ContentTask, done: boolean) => {
    setBusy(t.key)
    try {
      await toggleTask(t, done)
    } catch (e) {
      alert((e as Error).message)
    } finally {
      setBusy(null)
    }
  }

  if (!data.loaded) return <p className="text-text-muted text-sm py-8">Loading…</p>
  if (data.error) {
    return (
      <div className="max-w-xl py-10">
        <h1 className="text-2xl font-bold text-text-main">Content calendar</h1>
        <p className="text-sm text-text-muted mt-2">
          The content calendar is not set up in the database yet. Run the migration{' '}
          <code className="text-xs bg-surface-2 px-1 py-0.5 rounded">20261016000000_content_calendar.sql</code> in the
          Supabase SQL editor, then reload.
        </p>
        <p className="text-xs text-text-subtle mt-3">{data.error}</p>
      </div>
    )
  }

  const monthName = formatDay(first, { month: 'long' })
  const year = first.slice(0, 4)
  const weeks: { from: string; to: string }[] = []
  for (let d = gridStart; d <= gridEnd; d = addDays(d, 7)) weeks.push({ from: d, to: addDays(d, 6) })
  const days: string[] = []
  for (let d = gridStart; d <= gridEnd; d = addDays(d, 1)) days.push(d)

  const visibleClients = filter === 'all' ? active : active.filter((c) => c.id === filter)

  return (
    <div className="text-text-main">
      {/* ─── Header ─────────────────────────────────────────────────────── */}
      <header>
        <div className="flex flex-wrap items-end gap-x-6 gap-y-3">
          <h1 className="text-6xl md:text-8xl font-extrabold tracking-tighter leading-[0.9]">
            {monthName}
            <span className="text-text-subtle text-3xl md:text-4xl font-bold tracking-tight ml-3">{year}</span>
          </h1>
          <div className="flex items-center gap-1 pb-2">
            <button
              onClick={() => setParam('m', shiftMonth(first, -1).slice(0, 7))}
              className="p-2 rounded-lg border border-border-md bg-surface hover:bg-surface-2"
              title="Previous month"
            >
              <ChevronLeft size={16} />
            </button>
            <button
              onClick={() => setParam('m', null)}
              className="px-3 py-1.5 text-sm font-medium rounded-lg border border-border-md bg-surface hover:bg-surface-2"
            >
              Today
            </button>
            <button
              onClick={() => setParam('m', shiftMonth(first, 1).slice(0, 7))}
              className="p-2 rounded-lg border border-border-md bg-surface hover:bg-surface-2"
              title="Next month"
            >
              <ChevronRight size={16} />
            </button>
          </div>
        </div>
        <p className="max-w-[62ch] text-text-muted mt-4 text-[1.05rem]">
          Planning, recording, editing and posting for {active.length} client{active.length === 1 ? '' : 's'}. Every
          piece of content is four tasks: its plan, its shoot, its edit and its post. Tick them off here or in the week
          lists below.
        </p>

        <ul className="flex flex-wrap gap-2 mt-6">
          <li>
            <ChipButton pressed={filter === 'all'} onClick={() => setParam('c', null)}>
              All clients
            </ChipButton>
          </li>
          {active.map((c) => (
            <li key={c.id}>
              <ChipButton
                pressed={filter === c.id}
                color={c.color}
                onClick={() => setParam('c', filter === c.id ? null : c.id)}
              >
                <span className="w-3 h-3 rounded-sm flex-shrink-0" style={{ backgroundColor: c.color }} />
                {c.name}
                <small className="font-normal text-text-muted">{c.postsPerMonth}/month</small>
              </ChipButton>
            </li>
          ))}
          <li>
            <button
              onClick={() => setAdding(true)}
              className="flex items-center gap-1.5 text-sm font-semibold px-3 py-2 rounded-md border border-dashed border-border-md text-text-muted hover:text-text-main hover:border-text-muted"
            >
              <Plus size={14} /> New client
            </button>
          </li>
        </ul>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 mt-3 min-h-[1.5rem]">
          <p className="text-sm text-text-muted" aria-live="polite">
            {current ? (
              <>
                Showing {current.name} only.{' '}
                <Link to={`${base}/${current.id}`} className="font-semibold text-primary hover:underline">
                  Open their profile →
                </Link>
              </>
            ) : (
              'Showing all clients. Click a client to see only their schedule.'
            )}
          </p>
          <label className="flex items-center gap-2 text-sm text-text-muted cursor-pointer select-none">
            <input
              type="checkbox"
              checked={mine}
              onChange={(e) => setParam('mine', e.target.checked ? '1' : null)}
              className="accent-primary"
            />
            Only my tasks
          </label>
        </div>
      </header>

      {active.length === 0 && (
        <div className="mt-10 border border-dashed border-border-md rounded-lg p-8 text-center bg-surface">
          <p className="font-semibold">No clients yet</p>
          <p className="text-sm text-text-muted mt-1 max-w-md mx-auto">
            Add a client, then in their profile add recordings, editing sessions and posting days. They show up here.
          </p>
          <button
            onClick={() => setAdding(true)}
            className="mt-4 inline-flex items-center gap-1.5 bg-primary text-white text-sm font-medium px-4 py-2 rounded-lg hover:bg-primary-dark"
          >
            <Plus size={15} /> Add the first client
          </button>
        </div>
      )}

      {/* ─── Calendar ───────────────────────────────────────────────────── */}
      <h2 className="text-2xl font-extrabold tracking-tight mt-12 mb-3">Calendar</h2>
      <div className="overflow-x-auto border border-border-md rounded-md bg-surface">
        <div className="grid grid-cols-7 min-w-[900px]">
          {DOW.map((d) => (
            <div key={d} className="px-2.5 py-2 text-xs font-semibold text-text-muted border-b border-border-md bg-surface-2/60">
              {d}
            </div>
          ))}
          {days.map((d, i) => {
            const out = d < first || d > last
            const list = byDay.get(d) ?? []
            const work = list.filter((t) => t.kind !== 'post')
            const posts = list.filter((t) => t.kind === 'post')
            return (
              <div
                key={d}
                className={`min-h-[130px] p-2 pb-2.5 flex flex-col gap-1.5 border-b border-border-md ${
                  (i + 1) % 7 ? 'border-r' : ''
                } ${out ? 'bg-surface-2/50' : ''}`}
              >
                <div className="flex justify-between items-baseline">
                  <span
                    className={`font-extrabold text-[1.05rem] ${out ? 'text-text-subtle' : ''} ${
                      d === today ? 'bg-primary text-white rounded px-1.5 -ml-0.5' : ''
                    }`}
                  >
                    {Number(d.slice(8))}
                  </span>
                  {out && <span className="text-[10px] font-medium text-text-subtle">{formatDay(d, { month: 'short' })}</span>}
                </div>
                {work.map((t) => (
                  <TaskBlock key={t.key} task={t} busy={busy === t.key} onTick={tick} onView={setViewing} base={base} nameOf={nameOf} />
                ))}
                {posts.length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-auto">
                    {posts.map((t) => (
                      <PostTag key={t.key} task={t} busy={busy === t.key} onTick={tick} nameOf={nameOf} />
                    ))}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>
      <div className="flex flex-wrap gap-x-5 gap-y-1.5 text-[0.82rem] text-text-muted mt-2.5">
        {(['plan', 'record', 'edit'] as const).map((k) => (
          <span key={k} className="inline-flex items-center gap-1.5">
            <i className="inline-block w-[3px] h-3.5" style={{ backgroundColor: KIND_COLOR[k] }} />
            {KIND_LABEL[k]}
          </span>
        ))}
        <span>Coloured tags are posts going live (client + piece number). Click one to mark it posted.</span>
        <span className="inline-flex items-center gap-1.5">
          <span className="text-[10px] font-semibold px-1.5 rounded-sm border border-dashed border-text-muted">ESP —</span>
          a slot with nothing edited in time
        </span>
      </div>

      {/* ─── Pace ───────────────────────────────────────────────────────── */}
      {visibleClients.length > 0 && (
        <>
          <h2 className="text-2xl font-extrabold tracking-tight mt-12 mb-3">How {monthName} lines up</h2>
          <div className="grid gap-4 [grid-template-columns:repeat(auto-fit,minmax(230px,1fr))]">
            {visibleClients.map((c) => (
              <PaceCard key={c.id} client={c} base={base} tasks={tasks} first={first} last={last} flow={flows[c.id]} />
            ))}
          </div>
        </>
      )}

      {/* ─── Week by week ───────────────────────────────────────────────── */}
      <h2 className="text-2xl font-extrabold tracking-tight mt-12 mb-3">Week by week</h2>
      <div className="grid gap-4 [grid-template-columns:repeat(auto-fit,minmax(270px,1fr))]">
        {weeks.map((w, i) => {
          const list = shown.filter((t) => t.day >= w.from && t.day <= w.to)
          const left = list.filter((t) => !t.done).length
          const light = list.every((t) => t.kind === 'post')
          return (
            <section
              key={w.from}
              className={`rounded-md p-4 ${light ? 'border border-dashed border-border-md' : 'bg-surface border border-border-md'}`}
            >
              <h3 className="font-semibold">Week {i + 1}</h3>
              <div className="text-sm text-text-muted mb-2.5">
                {formatDay(w.from, { day: 'numeric', month: 'short' })} – {formatDay(w.to, { day: 'numeric', month: 'short' })}
                {list.length > 0 && ` · ${left} of ${list.length} to do`}
              </div>
              {list.length === 0 ? (
                <p className="text-sm text-text-muted">Nothing to plan, record, edit or post this week.</p>
              ) : (
                <ul>
                  {list.map((t) => (
                    <li key={t.key} className="grid grid-cols-[auto_1fr] gap-2.5 items-start py-1.5 border-t border-border first:border-t-0 text-sm">
                      <input
                        id={`wk-${t.key}`}
                        type="checkbox"
                        checked={t.done}
                        disabled={busy === t.key}
                        onChange={(e) => tick(t, e.target.checked)}
                        className="mt-1 w-4 h-4 accent-primary cursor-pointer"
                      />
                      <label htmlFor={`wk-${t.key}`} className={`cursor-pointer ${t.done ? 'line-through text-text-muted' : ''}`}>
                        <span className="inline-flex items-center gap-1.5">
                          <span className="w-2 h-2 rounded-sm flex-shrink-0" style={{ backgroundColor: t.client.color }} />
                          {t.title}
                        </span>
                        <em className="not-italic text-text-muted text-xs block">
                          {formatDay(t.day)} · {KIND_LABEL[t.kind]}
                          {t.kind !== 'post' ? ` · ${t.detail}` : ''}
                          {nameOf(t.assigneeId) ? ` · ${nameOf(t.assigneeId)}` : ''}
                        </em>
                        {t.warning && !t.done && (
                          <em className="not-italic text-warning text-xs flex items-center gap-1">
                            <AlertTriangle size={11} /> {t.warning}
                          </em>
                        )}
                      </label>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )
        })}
      </div>

      {/* ─── Posting schedule ───────────────────────────────────────────── */}
      {visibleClients.length > 0 && (
        <>
          <h2 className="text-2xl font-extrabold tracking-tight mt-12 mb-3">Posting schedule</h2>
          <p className="text-sm text-text-muted max-w-[70ch] mb-4">
            Each post publishes the next piece that has been edited by its day, in the order the pieces were recorded.
            Posting days are set in each client's profile.
          </p>
          <div className="grid gap-4 [grid-template-columns:repeat(auto-fit,minmax(280px,1fr))]">
            {visibleClients.map((c) => {
              const flow = flows[c.id]
              const slots = (flow?.slots ?? []).filter((s) => s.day >= first && s.day <= last)
              return (
                <div key={c.id}>
                  <h3 className="font-semibold mb-1.5 flex items-center gap-2">
                    <span className="w-3 h-3 rounded-sm" style={{ backgroundColor: c.color }} />
                    <Link to={`${base}/${c.id}`} className="hover:underline">
                      {c.name}
                    </Link>
                  </h3>
                  <div className="overflow-x-auto bg-surface border border-border-md rounded-md">
                    {slots.length === 0 ? (
                      <p className="text-sm text-text-muted p-3">No posting days in {monthName}.</p>
                    ) : (
                      <table className="w-full text-[0.85rem] border-collapse">
                        <thead>
                          <tr className="bg-surface-2/60 text-text-muted">
                            <th className="text-left font-semibold px-3 py-2">Piece</th>
                            <th className="text-left font-semibold px-3 py-2">Goes live</th>
                            <th className="text-left font-semibold px-3 py-2">Recorded</th>
                            <th className="text-left font-semibold px-3 py-2">Posted</th>
                          </tr>
                        </thead>
                        <tbody>
                          {slots.map((s) => (
                            <tr key={s.day} className="border-t border-border">
                              <td className="px-3 py-1.5 font-semibold whitespace-nowrap" style={{ color: s.piece ? c.color : undefined }}>
                                {s.piece ? `${c.code} ${String(s.piece.n).padStart(2, '0')}` : <span className="text-warning">nothing edited</span>}
                              </td>
                              <td className="px-3 py-1.5 whitespace-nowrap">{formatDay(s.day)}</td>
                              <td className="px-3 py-1.5 whitespace-nowrap text-text-muted">
                                {s.piece ? formatDay(s.piece.recordedOn, { day: 'numeric', month: 'short' }) : '—'}
                              </td>
                              <td className="px-3 py-1.5">
                                {s.done ? <Check size={14} className="text-success" /> : <span className="text-text-subtle">—</span>}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </>
      )}

      {/* ─── Clients ────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between mt-12 mb-3">
        <h2 className="text-2xl font-extrabold tracking-tight">Clients</h2>
        <button
          onClick={() => setAdding(true)}
          className="flex items-center gap-1.5 bg-primary text-white text-sm font-medium px-4 py-2 rounded-lg hover:bg-primary-dark"
        >
          <Plus size={15} /> New client
        </button>
      </div>
      <div className="grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(250px,1fr))]">
        {(showArchived ? [...active, ...archived] : active).map((c) => {
          const next = data.recordings
            .filter((r) => r.clientId === c.id && r.recordedOn >= today)
            .sort((a, b) => a.recordedOn.localeCompare(b.recordedOn))[0]
          return (
            <Link
              key={c.id}
              to={`${base}/${c.id}`}
              className={`group bg-surface border border-border-md rounded-md p-4 border-t-4 hover:shadow-sm transition-shadow ${c.isArchived ? 'opacity-60' : ''}`}
              style={{ borderTopColor: c.color }}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-semibold truncate">{c.name}</p>
                  <p className="text-xs text-text-muted truncate">
                    {c.code}
                    {c.handle ? ` · ${c.handle}` : ''}
                    {c.isArchived ? ' · archived' : ''}
                  </p>
                </div>
                <ArrowRight size={16} className="text-text-subtle group-hover:text-text-main flex-shrink-0 mt-0.5" />
              </div>
              <p className="text-2xl font-extrabold mt-2 leading-none">
                {c.postsPerMonth}
                <span className="text-sm font-medium text-text-muted"> posts a month</span>
              </p>
              <p className="text-xs text-text-muted mt-2">
                {next ? `Next shoot ${formatDay(next.recordedOn)}` : 'No shoot booked'}
              </p>
            </Link>
          )
        })}
      </div>
      {archived.length > 0 && (
        <button
          onClick={() => setShowArchived((v) => !v)}
          className="mt-3 text-sm text-text-muted hover:text-text-main inline-flex items-center gap-1.5"
        >
          <Archive size={14} /> {showArchived ? 'Hide' : 'Show'} {archived.length} archived
        </button>
      )}

      {adding && <ClientDialog client={null} onClose={() => setAdding(false)} />}
      {viewing?.recording && (
        <PlanViewer recording={viewing.recording} client={viewing.client} onClose={() => setViewing(null)} />
      )}
    </div>
  )
}

// ─── Pieces ─────────────────────────────────────────────────────────────────

function ChipButton({
  pressed,
  color,
  onClick,
  children,
}: {
  pressed: boolean
  color?: string
  onClick: () => void
  children: React.ReactNode
}) {
  const c = color ?? '#18170F'
  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={onClick}
      className="flex items-center gap-2 text-sm font-semibold px-3 py-2 rounded-md border bg-surface text-left transition-colors"
      style={{
        borderColor: pressed ? c : 'rgba(0,0,0,0.15)',
        boxShadow: pressed ? `inset 0 0 0 1px ${c}` : undefined,
        backgroundColor: pressed ? `color-mix(in srgb, ${c} 8%, white)` : undefined,
      }}
    >
      {children}
    </button>
  )
}

function TaskBlock({
  task: t,
  busy,
  onTick,
  onView,
  base,
  nameOf,
}: {
  task: ContentTask
  busy: boolean
  onTick: (t: ContentTask, done: boolean) => void
  onView: (t: ContentTask) => void
  base: string
  nameOf: (id: string | null) => string | null
}) {
  const k = KIND_COLOR[t.kind]
  const who = nameOf(t.assigneeId)
  return (
    <div
      className={`group relative text-[0.78rem] leading-tight px-1.5 py-1 rounded-[3px] border-l-[3px] ${t.done ? 'opacity-55' : ''}`}
      style={{ borderLeftColor: k, backgroundColor: `color-mix(in srgb, ${k} 9%, transparent)` }}
      title={[t.title, t.detail, who, t.warning].filter(Boolean).join(' · ')}
    >
      <div className="flex items-start gap-1">
        <button
          onClick={() => onTick(t, !t.done)}
          disabled={busy}
          className={`mt-[1px] w-3.5 h-3.5 rounded-[3px] border flex-shrink-0 flex items-center justify-center ${
            t.done ? 'bg-success border-success text-white' : 'border-border-md bg-surface hover:border-text-muted'
          }`}
          aria-label={t.done ? 'Mark as not done' : 'Mark as done'}
        >
          {t.done && <Check size={10} strokeWidth={3} />}
        </button>
        <Link to={`${base}/${t.client.id}`} className="min-w-0 flex-1">
          <b className={`block font-semibold ${t.done ? 'line-through' : ''}`}>
            <span className="inline-block w-1.5 h-1.5 rounded-full mr-1 align-middle" style={{ backgroundColor: t.client.color }} />
            {t.title}
          </b>
          <span className="text-text-muted">{t.detail}</span>
          {who && <span className="block text-text-subtle">{who}</span>}
        </Link>
      </div>
      {(t.kind === 'plan' || t.kind === 'record') && t.recording && (t.recording.planPath || t.recording.planNotes) && (
        <button
          onClick={() => onView(t)}
          className="mt-1 ml-[18px] inline-flex items-center gap-1 text-[0.7rem] font-semibold text-blue-accent hover:underline"
        >
          <FileText size={11} /> View plan
        </button>
      )}
      {t.warning && !t.done && (
        <span className="mt-0.5 ml-[18px] flex items-center gap-1 text-[0.7rem] text-warning">
          <AlertTriangle size={10} /> {t.warning}
        </span>
      )}
    </div>
  )
}

function PostTag({
  task: t,
  busy,
  onTick,
  nameOf,
}: {
  task: ContentTask
  busy: boolean
  onTick: (t: ContentTask, done: boolean) => void
  nameOf: (id: string | null) => string | null
}) {
  const empty = !!t.warning
  const who = nameOf(t.assigneeId)
  return (
    <button
      onClick={() => !empty && onTick(t, !t.done)}
      disabled={busy || empty}
      title={
        empty
          ? `${t.client.name}: nothing edited in time for this slot`
          : `${t.client.name} · ${t.tag}${who ? ` · ${who}` : ''} — ${t.done ? 'posted, click to undo' : 'click when posted'}`
      }
      className={`text-[0.7rem] font-semibold px-1.5 py-[1px] rounded-sm inline-flex items-center gap-0.5 ${
        empty ? 'border border-dashed cursor-default bg-transparent' : 'text-white'
      } ${t.done ? 'opacity-60' : ''}`}
      style={empty ? { borderColor: t.client.color, color: t.client.color } : { backgroundColor: t.client.color }}
    >
      {t.done && <Check size={10} strokeWidth={3} />}
      {t.tag}
    </button>
  )
}

function PaceCard({
  client: c,
  base,
  tasks,
  first,
  last,
  flow,
}: {
  client: ContentClient
  base: string
  tasks: ContentTask[]
  first: string
  last: string
  flow: ReturnType<typeof useContentTasks>['flows'][string] | undefined
}) {
  const inMonth = tasks.filter((t) => t.client.id === c.id && t.day >= first && t.day <= last)
  const recorded = inMonth.filter((t) => t.kind === 'record').reduce((n, t) => n + (t.recording?.pieces ?? 0), 0)
  const shoots = inMonth.filter((t) => t.kind === 'record').length
  const edited = (flow?.edits ?? [])
    .filter((e) => e.edit.editedOn >= first && e.edit.editedOn <= last)
    .reduce((n, e) => n + e.takes, 0)
  const slots = inMonth.filter((t) => t.kind === 'post')
  const filled = slots.filter((t) => !t.warning).length
  const perShoot = shoots ? Math.round(recorded / shoots) : 0
  const cadence = suggestCadence(c.postsPerMonth, perShoot || 4)

  const short = filled < c.postsPerMonth
  return (
    <Link
      to={`${base}/${c.id}`}
      className="block bg-surface border border-border-md border-t-4 rounded-b-md px-4 py-3.5 hover:shadow-sm"
      style={{ borderTopColor: c.color }}
    >
      <strong className="block text-[1.6rem] font-extrabold leading-tight">
        {filled} / {c.postsPerMonth} posts
      </strong>
      <p className="text-[0.85rem] text-text-muted mt-1">
        <b className="text-text-main font-semibold">{c.name}</b>: {shoots} shoot{shoots === 1 ? '' : 's'} ({recorded} videos),{' '}
        {edited} edited, {slots.length} posting day{slots.length === 1 ? '' : 's'} this month.
      </p>
      {short && cadence && (
        <p className="text-[0.8rem] text-warning mt-1.5">
          {c.postsPerMonth - filled} short of the target. At {perShoot || 4} videos a shoot, record {CADENCE_LABEL[cadence.every]}.
        </p>
      )}
      {filled > 0 && filled < slots.length && (
        <p className="text-[0.8rem] text-warning mt-1">{slots.length - filled} posting day(s) have nothing edited in time.</p>
      )}
    </Link>
  )
}

