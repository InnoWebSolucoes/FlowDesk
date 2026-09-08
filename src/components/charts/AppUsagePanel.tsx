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

/** Minutes as something readable: 95 -> "1h 35m". */
function duration(mins: number): string {
  const m = Math.round(mins)
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  const rest = m % 60
  return rest === 0 ? `${h}h` : `${h}h ${rest}m`
}

function ago(iso: string | null): string {
  if (!iso) return '—'
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000)
  if (days === 0) return 'today'
  if (days === 1) return 'yesterday'
  if (days < 30) return `${days} days ago`
  return new Date(iso).toLocaleDateString()
}

export function AppUsagePanel({ employeeId }: { employeeId: string }) {
  const isOwner = !!useAuthStore((s) => s.currentUser?.isOwner)
  const [stats, setStats] = useState<Stats | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!isOwner || !employeeId) {
      setLoading(false)
      return
    }
    let cancelled = false

    ;(async () => {
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
      setLoading(false)
    })()

    return () => {
      cancelled = true
    }
  }, [isOwner, employeeId])

  if (!isOwner || loading) return null

  const tiles: [string, string][] = stats
    ? [
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
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
          {tiles.map(([label, value]) => (
            <div key={label}>
              <p className="text-text-muted text-[11px]">{label}</p>
              <p className="text-text-main font-semibold text-lg leading-tight">{value}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
