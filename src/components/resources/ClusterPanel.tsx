import React, { useMemo, useState } from 'react'
import {
  X, Trash2, Copy, FolderOpen, Shield, Globe, Users, UserCog, UserCheck,
  ArrowRight, Layers,
} from 'lucide-react'
import { format, parseISO } from 'date-fns'
import { ResourceCluster, ResourceAccess } from '../../types'
import { useProjectStore } from '../../store/projectStore'
import { useEmployeeStore } from '../../store/employeeStore'
import { FileKindIcon } from './ResourceThumbnail'

const COLORS = [
  '#6366f1', '#0ea5e9', '#10b981', '#f59e0b',
  '#ef4444', '#ec4899', '#8b5cf6', '#64748b',
]

const ACCESS_OPTIONS: {
  value: ResourceAccess
  label: string
  hint: string
  Icon: typeof Globe
}[] = [
  { value: 'everyone', label: 'Everyone', hint: 'Anyone working on this project', Icon: Globe },
  { value: 'employees', label: 'Employees', hint: 'Managers and staff on this project', Icon: Users },
  { value: 'managers', label: 'Managers only', hint: 'Nobody else can open it', Icon: UserCog },
  {
    value: 'specific',
    label: 'Specific people',
    hint: 'Only those named below, and everything inside opens for them',
    Icon: UserCheck,
  },
  {
    value: 'relative',
    label: 'Shared, keep file permissions',
    hint: 'Those named may enter, but each document still applies its own access',
    Icon: Shield,
  },
]

/**
 * A cluster's details, the counterpart to ResourceItemPanel for documents.
 *
 * Until now a cluster could be renamed and recoloured from a context menu and
 * nothing more — its access, the thing that decides who sees everything
 * inside it, could not be reached from the app at all.
 *
 * The distinction that matters here is between the two sharing modes.
 * "Specific people" opens the cluster AND everything in it to whoever is
 * named: a managers-only document inside becomes readable, because cluster
 * access is inherited. "Shared, keep file permissions" lets them in and then
 * judges each document on its own access, which is what you want when the
 * cluster is a place rather than a permission.
 */
export function ClusterPanel({
  cluster,
  onClose,
  onOpen,
  onDelete,
  onDuplicate,
}: {
  cluster: ResourceCluster
  onClose: () => void
  /** Navigate into the cluster on the canvas. */
  onOpen: () => void
  onDelete: () => void
  onDuplicate: () => void
}) {
  const { clusters, items, updateCluster, setClusterAccess } = useProjectStore()
  const { allEmployees } = useEmployeeStore()

  const [title, setTitle] = useState(cluster.title)

  const named = cluster.accessUserIds ?? []
  const namesAPerson = cluster.access === 'specific' || cluster.access === 'relative'

  // Only people on this project can be named: access is scoped to it anyway,
  // so offering anyone else would create rows that never grant anything.
  const candidates = useMemo(
    () => allEmployees.filter((e) => e.projectId === cluster.projectId),
    [allEmployees, cluster.projectId],
  )

  const children = useMemo(
    () => clusters.filter((c) => c.parentClusterId === cluster.id),
    [clusters, cluster.id],
  )

  const contents = useMemo(
    () => items.filter((i) => i.clusterIds.includes(cluster.id)),
    [items, cluster.id],
  )

  // Which clusters this one sits inside, outermost first. Access is inherited,
  // so a permissive cluster inside a restricted one is still restricted — and
  // that is invisible unless the chain is shown.
  const ancestors = useMemo(() => {
    const chain: ResourceCluster[] = []
    let current = cluster.parentClusterId
    let depth = 0
    while (current && depth < 32) {
      const parent = clusters.find((c) => c.id === current)
      if (!parent) break
      chain.unshift(parent)
      current = parent.parentClusterId
      depth++
    }
    return chain
  }, [clusters, cluster.parentClusterId])

  const restrictingAncestor = ancestors.find(
    (a) => a.access !== 'everyone' && a.access !== 'relative',
  )

  const commitTitle = () => {
    const next = title.trim()
    if (next && next !== cluster.title) updateCluster(cluster.id, { title: next })
    else if (!next) setTitle(cluster.title)
  }

  const toggleNamed = (userId: string) => {
    const next = named.includes(userId) ? named.filter((id) => id !== userId) : [...named, userId]
    setClusterAccess(cluster.id, cluster.access, next)
  }

  const chooseAccess = (value: ResourceAccess) => {
    setClusterAccess(cluster.id, value, named)
  }

  return (
    <aside
      data-canvas-ui
      className="absolute top-0 right-0 h-full w-full sm:w-[380px] bg-surface border-l border-border shadow-xl flex flex-col z-30"
    >
      <header className="flex items-center justify-between gap-2 px-4 py-3 border-b border-border flex-shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <span
            className="w-3 h-3 rounded-full flex-shrink-0"
            style={{ backgroundColor: cluster.color }}
          />
          <span className="text-text-main font-medium text-sm truncate">{cluster.title}</span>
        </div>
        <button onClick={onClose} className="text-text-subtle hover:text-text-main p-1 rounded flex-shrink-0">
          <X size={18} />
        </button>
      </header>

      <div className="flex-1 overflow-y-auto p-4 space-y-5">
        {/* Name */}
        <section>
          <label className="block text-xs font-medium text-text-muted mb-1.5">Name</label>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onBlur={commitTitle}
            onKeyDown={(e) => {
              if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
              if (e.key === 'Escape') setTitle(cluster.title)
            }}
            className="w-full px-3 py-2 rounded-lg bg-surface-2 border border-border text-sm text-text-main focus:outline-none focus:border-primary"
          />
        </section>

        {/* Colour */}
        <section>
          <label className="block text-xs font-medium text-text-muted mb-1.5">Colour</label>
          <div className="flex flex-wrap gap-1.5">
            {COLORS.map((c) => (
              <button
                key={c}
                onClick={() => updateCluster(cluster.id, { color: c })}
                title={c}
                className={`w-7 h-7 rounded-full border-2 transition-transform hover:scale-110 ${
                  cluster.color === c ? 'border-text-main scale-110' : 'border-transparent'
                }`}
                style={{ backgroundColor: c }}
              />
            ))}
          </div>
        </section>

        {/* Access */}
        <section>
          <label className="flex items-center gap-1.5 text-xs font-medium text-text-muted mb-1.5">
            <Shield size={13} /> Who can open this cluster
          </label>

          <div className="space-y-1">
            {ACCESS_OPTIONS.map((opt) => {
              const active = cluster.access === opt.value
              return (
                <button
                  key={opt.value}
                  onClick={() => chooseAccess(opt.value)}
                  className={`w-full flex items-start gap-2 px-3 py-2 rounded-lg border text-left transition-colors ${
                    active
                      ? 'border-primary bg-primary-light'
                      : 'border-border hover:bg-surface-2'
                  }`}
                >
                  <opt.Icon
                    size={14}
                    className={`mt-0.5 flex-shrink-0 ${active ? 'text-primary' : 'text-text-muted'}`}
                  />
                  <span className="min-w-0">
                    <span
                      className={`block text-xs font-medium ${
                        active ? 'text-primary' : 'text-text-main'
                      }`}
                    >
                      {opt.label}
                    </span>
                    <span className="block text-[11px] text-text-subtle">{opt.hint}</span>
                  </span>
                </button>
              )
            })}
          </div>

          {/* Who, when the level names people. */}
          {namesAPerson && (
            <div className="mt-2 border border-border rounded-lg p-2">
              <p className="text-[11px] text-text-subtle mb-1.5">
                {cluster.access === 'relative'
                  ? 'These people may enter. Documents inside still apply their own access.'
                  : 'These people can open the cluster and everything inside it.'}
              </p>
              {candidates.length === 0 ? (
                <p className="text-xs text-text-subtle italic">Nobody is on this project yet.</p>
              ) : (
                <div className="space-y-0.5 max-h-44 overflow-y-auto">
                  {candidates.map((emp) => (
                    <label
                      key={emp.id}
                      className="flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-surface-2 cursor-pointer"
                    >
                      <input
                        type="checkbox"
                        checked={named.includes(emp.id)}
                        onChange={() => toggleNamed(emp.id)}
                        className="accent-primary"
                      />
                      <span className="text-xs text-text-main truncate flex-1">{emp.name}</span>
                      {emp.jobTitle && (
                        <span className="text-[10px] text-text-subtle truncate">{emp.jobTitle}</span>
                      )}
                    </label>
                  ))}
                </div>
              )}
            </div>
          )}

          <p className="text-[11px] text-text-subtle mt-1.5">
            Managers always have access, so a cluster can never be locked away from
            the people responsible for it.
          </p>

          {/* Inherited restriction, which is otherwise invisible from here. */}
          {restrictingAncestor && (
            <div className="mt-2 flex items-start gap-2 px-3 py-2 rounded-lg bg-warning-bg border border-warning/30">
              <Layers size={13} className="text-warning mt-0.5 flex-shrink-0" />
              <p className="text-[11px] text-warning">
                This sits inside <strong>{restrictingAncestor.title}</strong>, which is
                restricted. Access is inherited, so nobody blocked there can reach this
                cluster however it is set here.
              </p>
            </div>
          )}
        </section>

        {/* Where it sits */}
        {ancestors.length > 0 && (
          <section>
            <label className="block text-xs font-medium text-text-muted mb-1.5">Inside</label>
            <div className="flex items-center gap-1 flex-wrap text-[11px] text-text-muted">
              {ancestors.map((a, i) => (
                <React.Fragment key={a.id}>
                  {i > 0 && <ArrowRight size={10} className="text-text-subtle" />}
                  <span className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-surface-2">
                    <span
                      className="w-2 h-2 rounded-full"
                      style={{ backgroundColor: a.color }}
                    />
                    {a.title}
                  </span>
                </React.Fragment>
              ))}
            </div>
          </section>
        )}

        {/* Contents */}
        <section>
          <label className="block text-xs font-medium text-text-muted mb-1.5">
            Contents — {children.length} cluster{children.length === 1 ? '' : 's'},{' '}
            {contents.length} document{contents.length === 1 ? '' : 's'}
          </label>

          {children.length === 0 && contents.length === 0 ? (
            <p className="text-xs text-text-subtle italic">Empty.</p>
          ) : (
            <div className="space-y-1 max-h-56 overflow-y-auto">
              {children.map((c) => (
                <div
                  key={c.id}
                  className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg border border-border bg-surface-2"
                >
                  <span
                    className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                    style={{ backgroundColor: c.color }}
                  />
                  <span className="text-xs text-text-main truncate flex-1">{c.title}</span>
                  {c.access !== 'everyone' && (
                    <Shield size={11} className="text-text-subtle flex-shrink-0" />
                  )}
                </div>
              ))}
              {contents.map((i) => (
                <div
                  key={i.id}
                  className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg border border-border"
                >
                  <FileKindIcon mime={i.mimeType} fileName={i.fileName} size={12} />
                  <span className="text-xs text-text-main truncate flex-1">{i.title}</span>
                  {i.access !== 'everyone' && (
                    <Shield size={11} className="text-text-subtle flex-shrink-0" />
                  )}
                </div>
              ))}
            </div>
          )}
        </section>

        <p className="text-[11px] text-text-subtle">
          Created {cluster.createdAt ? format(parseISO(cluster.createdAt), 'd MMM yyyy') : '—'}
        </p>
      </div>

      <footer className="border-t border-border p-3 flex items-center gap-2 flex-shrink-0">
        <button
          onClick={onOpen}
          className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-primary text-white text-sm font-medium hover:bg-primary-dark transition-colors"
        >
          <FolderOpen size={15} /> Open
        </button>
        <button
          onClick={onDuplicate}
          title="Duplicate"
          className="px-3 py-2 rounded-lg border border-border text-text-muted hover:text-primary hover:border-primary transition-colors"
        >
          <Copy size={15} />
        </button>
        <button
          onClick={onDelete}
          title="Delete cluster"
          className="px-3 py-2 rounded-lg border border-border text-text-muted hover:text-danger hover:border-danger transition-colors"
        >
          <Trash2 size={15} />
        </button>
      </footer>
    </aside>
  )
}
