import React, { useEffect, useState } from 'react'
import { MonitorSmartphone } from 'lucide-react'
import { supabase } from '../../lib/supabaseClient'
import { useAuthStore } from '../../store/authStore'

/**
 * How often somebody opens the app, and how long they stay in it.
 *
 * Owner-only, and deliberately not shown to the person it describes: the
 * table's RLS has no select branch for the subject, so this renders nothing
 * for anyone else even if the component were mounted somewhere it should not
 * be. The check here is so it is not requested at all, not the thing that
 * keeps it private — that is the database's job.
 */

interface Stats {
  sessions: number
  totalMinutes: number
  avgMinutes: number
  lastSeen: string | null
  activeDays: number
}

/** One day of use: when they started, when they were last seen, how long. */
interface DayStart {
  day: string
  firstSeen: string
  lastSeen: string
  sessions: number
  minutes: number
}

/** Just the clock: "08:42". */
function clockOf(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

/**
 * The typical start, as minutes past midnight averaged over the days shown.
 *
 * A mean is the right shape here despite being pulled about by one very late
 * day, because the question is "roughly when do they start" and a handful of
 * days is too few for a median to say anything a mean does not.
 */
function typicalStart(days: DayStart[]): string | null {
  if (days.length === 0) return null
  const mins = days.map((d) => {
    const t = new Date(d.firstSeen)
    return t.getHours() * 60 + t.getMinutes()
  })
  const avg = Math.round(mins.reduce((a, b) => a + b, 0) / mins.length)
  return `${String(Math.floor(avg / 60)).padStart(2, '0')}:${String(avg % 60).padStart(2, '0')}`
}

/** Minutes as something readable: 95 -> "1h 35m". */
function duration(mins: number): string {
  const m = Math.round(mins)
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  const rest = m % 60
  return rest === 0 ? `${h}h` : `${h}h ${rest}m`
}

/**
 * When they were last in the app, to the minute.
 *
 * "today" answered the wrong question: the point of last seen is knowing
 * whether somebody was in the app an hour ago or first thing this morning,
 * and a day is too coarse to say. Recent times are relative because that is
 * how you read them at a glance; anything older carries the clock time too,
 * since "9 days ago" alone leaves you counting back.
 */
function ago(iso: string | null): string {
  if (!iso) return '—'
  const then = new Date(iso)
  const mins = Math.floor((Date.now() - then.getTime()) / 60_000)
  const clock = then.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })

  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`

  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago · ${clock}`

  const days = Math.floor(hours / 24)
  if (days === 1) return `yesterday ${clock}`
  if (days < 7) return `${days} days ago · ${clock}`
  return `${then.toLocaleDateString()} ${clock}`
}

export function AppUsagePanel({ employeeId }: { employeeId: string }) {
  const isOwner = !!useAuthStore((s) => s.currentUser?.isOwner)
  const [stats, setStats] = useState<Stats | null>(null)
  const [days, setDays] = useState<DayStart[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!isOwner || !employeeId) {
      setLoading(false)
      return
    }
    let cancelled = false

    ;(async () => {
      // The day starts are bucketed in the reader's zone, so a day that began
      // before 01:00 local is not filed under yesterday.
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
      const startsPromise = supabase.rpc('app_session_day_starts', {
        p_user: employeeId,
        p_days: 14,
        p_tz: tz,
      })

      const { data, error } = await supabase.rpc('app_session_stats')
      if (cancelled) return
      if (error || !Array.isArray(data)) {
        setStats(null)
        setLoading(false)
        return
      }
      const row = data.find((r: { user_id: string }) => r.user_id === employeeId)
      setStats(
        row
          ? {
              sessions: Number(row.sessions ?? 0),
              totalMinutes: Number(row.total_minutes ?? 0),
              avgMinutes: Number(row.avg_minutes ?? 0),
              lastSeen: row.last_seen ?? null,
              activeDays: Number(row.active_days ?? 0),
            }
          : null,
      )

      // Not fatal if it fails: the migration may not have run yet, and the
      // rest of the panel is still worth showing.
      const { data: startRows, error: startErr } = await startsPromise
      if (cancelled) return
      if (startErr) {
        console.warn('[AppUsagePanel] day starts unavailable:', startErr.message)
        setDays([])
      } else {
        setDays(
          (Array.isArray(startRows) ? startRows : []).map((r: any) => ({
            day: r.day,
            firstSeen: r.first_seen,
            lastSeen: r.last_seen,
            sessions: Number(r.sessions ?? 0),
            minutes: Number(r.minutes ?? 0),
          })),
        )
      }
      setLoading(false)
    })()

    return () => {
      cancelled = true
    }
  }, [isOwner, employeeId])

  if (!isOwner || loading) return null

  // The first time they opened the app today: the start of their working day.
  // Rows come back newest first, and only for days they actually appeared, so
  // the top row being today is what says they have started at all.
  const todayKey = new Date().toLocaleDateString('en-CA') // YYYY-MM-DD, local
  const startedToday = days.find((d) => d.day === todayKey)?.firstSeen ?? null

  const tiles: [string, string][] = stats
    ? [
        ['Started today', startedToday ? clockOf(startedToday) : 'not yet'],
        ['Typical start', typicalStart(days) ?? '—'],
        ['Times opened', String(stats.sessions)],
        ['Total time', duration(stats.totalMinutes)],
        ['Average visit', duration(stats.avgMinutes)],
        ['Days active', String(stats.activeDays)],
        ['Last seen', ago(stats.lastSeen)],
      ]
    : []

  return (
    <div className="rounded-xl border border-border bg-surface p-4">
      <h3 className="text-text-main font-medium text-sm flex items-center gap-1.5 mb-1">
        <MonitorSmartphone size={14} className="text-text-muted" />
        App usage
      </h3>
      <p className="text-text-subtle text-[11px] mb-3">
        Only you can see this. Time counts while the app is open in front of them.
      </p>

      {!stats ? (
        <p className="text-xs text-text-subtle italic">
          Nothing recorded yet — this starts from the day tracking was added.
        </p>
      ) : (
        // Eight columns now that the two start-of-day tiles are here, with
        // last seen still taking two of them: a date and a time is a longer
        // string than the counts beside it and would otherwise wrap into two
        // cramped lines. Four across on a medium screen, two on a phone.
        <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-8 gap-3">
          {tiles.map(([label, value]) => (
            <div key={label} className={label === 'Last seen' ? 'col-span-2' : ''}>
              <p className="text-text-muted text-[11px]">{label}</p>
              <p
                className={`text-text-main font-semibold leading-tight ${
                  label === 'Last seen' ? 'text-sm mt-0.5' : 'text-lg'
                }`}
                title={label === 'Last seen' && stats.lastSeen
                  ? new Date(stats.lastSeen).toLocaleString()
                  : undefined}
              >
                {value}
              </p>
            </div>
          ))}
        </div>
      )}

      {/* The last fortnight of working days, most recent first. A single
          "started today" is a fact; a fortnight of them is the thing you
          actually want to look at, because it says whether today is normal
          for them. Days they never opened the app simply are not here —
          absence is the record, and inventing a row of dashes for a Sunday
          would read as a missed day rather than a day off. */}
      {days.length > 0 && (
        <div className="mt-4 pt-3 border-t border-border">
          <p className="text-text-muted text-[11px] mb-2">Start of day, last 14 days</p>
          <div className="space-y-1">
            {days.map((d) => {
              const isToday = d.day === todayKey
              return (
                <div
                  key={d.day}
                  className={`flex items-center gap-3 text-xs rounded-md px-2 py-1 ${
                    isToday ? 'bg-primary-light' : ''
                  }`}
                >
                  <span className={`w-28 flex-shrink-0 ${isToday ? 'text-primary font-medium' : 'text-text-muted'}`}>
                    {new Date(`${d.day}T12:00:00`).toLocaleDateString([], {
                      weekday: 'short',
                      day: 'numeric',
                      month: 'short',
                    })}
                  </span>
                  <span className={`font-semibold tabular-nums ${isToday ? 'text-primary' : 'text-text-main'}`}>
                    {clockOf(d.firstSeen)}
                  </span>
                  <span className="text-text-subtle">
                    → {clockOf(d.lastSeen)}
                  </span>
                  <span className="ml-auto text-text-subtle">
                    {duration(d.minutes)} · {d.sessions}×
                  </span>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
