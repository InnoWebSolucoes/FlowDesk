import React, { useMemo, useState } from 'react'
import { X, FolderOpen, CheckCircle2, ChevronRight, Home, Search, CornerDownLeft } from 'lucide-react'
import { useProjectStore } from '../../store/projectStore'
import { FileKindIcon } from '../resources/ResourceThumbnail'
import { useT } from '../../i18n/useT'

export interface LinkKey {
  itemId?: string
  clusterId?: string
}

/**
 * Picks documents and clusters to link to something (a todo, a calendar entry).
 *
 * Clusters are both selectable and browsable: the row selects, the chevron
 * opens it. Searching flattens everything, since when you're searching you
 * want the result wherever it lives.
 */
export function ResourceLinkPicker({
  projectId,
  title,
  subtitle,
  initial,
  onClose,
  onSave,
}: {
  projectId: string
  title?: string
  subtitle?: string
  initial: LinkKey[]
  onClose: () => void
  onSave: (links: LinkKey[]) => Promise<void>
}) {
  const { t } = useT()
  const { clusters, items } = useProjectStore()
  const [selected, setSelected] = useState<LinkKey[]>(initial)
  const [query, setQuery] = useState('')
  const [openCluster, setOpenCluster] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const projectClusters = useMemo(
    () => clusters.filter((c) => c.projectId === projectId),
    [clusters, projectId],
  )
  const projectItems = useMemo(
    () => items.filter((i) => i.projectId === projectId),
    [items, projectId],
  )

  const q = query.trim().toLowerCase()
  const searching = q.length > 0

  // Browsing shows one level; searching flattens the whole project.
  const visibleClusters = searching
    ? projectClusters.filter((c) => c.title.toLowerCase().includes(q))
    : projectClusters.filter((c) => (c.parentClusterId ?? null) === openCluster)

  const visibleItems = searching
    ? projectItems.filter((i) => i.title.toLowerCase().includes(q))
    : projectItems.filter((i) =>
        openCluster === null
          ? i.showAtTopLevel || (i.clusterIds.length === 0 && !i.clusterId)
          : i.clusterIds.includes(openCluster) || i.clusterId === openCluster,
      )

  const isSelected = (key: LinkKey) =>
    selected.some((s) => (key.itemId ? s.itemId === key.itemId : s.clusterId === key.clusterId))

  const toggle = (key: LinkKey) =>
    setSelected((prev) =>
      isSelected(key)
        ? prev.filter((s) => (key.itemId ? s.itemId !== key.itemId : s.clusterId !== key.clusterId))
        : [...prev, key],
    )

  /** Breadcrumb chain for the cluster currently open. */
  const trail = useMemo(() => {
    const out: { id: string; title: string }[] = []
    let id = openCluster
    while (id) {
      const c = projectClusters.find((x) => x.id === id)
      if (!c) break
      out.unshift({ id: c.id, title: c.title })
      id = c.parentClusterId
    }
    return out
  }, [openCluster, projectClusters])

  const pathOf = (clusterId: string | null): string => {
    const parts: string[] = []
    let id = clusterId
    while (id) {
      const c = projectClusters.find((x) => x.id === id)
      if (!c) break
      parts.unshift(c.title)
      id = c.parentClusterId
    }
    return parts.length > 0 ? parts.join(' › ') : 'Space'
  }

  return (
    <div className="fixed inset-0 bg-black/40 z-[60] flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="bg-surface rounded-xl border border-border w-full max-w-lg flex flex-col max-h-[80vh]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-border flex-shrink-0">
          <div className="min-w-0">
            <h3 className="text-text-main font-semibold text-base">{title ?? 'Link resources'}</h3>
            {subtitle && <p className="text-text-subtle text-xs truncate">{subtitle}</p>}
          </div>
          <button onClick={onClose} className="text-text-subtle hover:text-text-main p-1 flex-shrink-0">
            <X size={18} />
          </button>
        </div>

        <div className="px-5 py-3 border-b border-border flex-shrink-0 space-y-2">
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-subtle" />
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t('ui_searchEverythingInThisProject')}
              className="w-full pl-9 pr-3 py-2 rounded-lg bg-surface-2 border border-border text-sm text-text-main focus:outline-none focus:border-primary"
            />
          </div>

          {!searching && (
            <div className="flex items-center gap-1 text-xs flex-wrap">
              <button
                onClick={() => setOpenCluster(null)}
                className={`flex items-center gap-1 px-1.5 py-0.5 rounded ${
                  openCluster === null ? 'text-text-main font-medium' : 'text-text-muted hover:bg-surface-2'
                }`}
              >
                <Home size={12} /> Space
              </button>
              {trail.map((t) => (
                <React.Fragment key={t.id}>
                  <ChevronRight size={12} className="text-text-subtle" />
                  <button
                    onClick={() => setOpenCluster(t.id)}
                    className={`px-1.5 py-0.5 rounded truncate max-w-[10rem] ${
                      t.id === openCluster ? 'text-text-main font-medium' : 'text-text-muted hover:bg-surface-2'
                    }`}
                  >
                    {t.title}
                  </button>
                </React.Fragment>
              ))}
            </div>
          )}
        </div>

        <div className="flex-1 overflow-y-auto p-3 space-y-1">
          {visibleClusters.length === 0 && visibleItems.length === 0 && (
            <p className="text-text-subtle text-sm text-center py-8">
              {searching ? 'Nothing matches that.' : 'This cluster is empty.'}
            </p>
          )}

          {visibleClusters.map((c) => {
            const key = { clusterId: c.id }
            const childCount =
              projectClusters.filter((x) => x.parentClusterId === c.id).length +
              projectItems.filter((i) => i.clusterIds.includes(c.id)).length
            return (
              <div
                key={c.id}
                className={`flex items-center gap-1 rounded-lg border transition-colors ${
                  isSelected(key) ? 'border-primary bg-primary-light' : 'border-transparent hover:bg-surface-2'
                }`}
              >
                <button onClick={() => toggle(key)} className="flex items-center gap-2.5 p-2.5 flex-1 min-w-0 text-left">
                  <FolderOpen size={16} style={{ color: c.color }} className="flex-shrink-0" />
                  <div className="min-w-0 flex-1">
                    <p className="text-text-main text-sm truncate">{c.title}</p>
                    <p className="text-text-subtle text-[11px] truncate">
                      Cluster · {childCount} item{childCount === 1 ? '' : 's'}
                      {searching && ` · ${pathOf(c.parentClusterId)}`}
                    </p>
                  </div>
                  {isSelected(key) && <CheckCircle2 size={15} className="text-primary flex-shrink-0" />}
                </button>
                <button
                  onClick={() => {
                    setQuery('')
                    setOpenCluster(c.id)
                  }}
                  className="p-2 mr-1 rounded-md text-text-subtle hover:text-primary hover:bg-surface"
                  title={t('ui_openThisCluster')}
                >
                  <ChevronRight size={16} />
                </button>
              </div>
            )
          })}

          {visibleItems.map((i) => {
            const key = { itemId: i.id }
            return (
              <button
                key={i.id}
                onClick={() => toggle(key)}
                className={`w-full flex items-center gap-2.5 p-2.5 rounded-lg border text-left transition-colors ${
                  isSelected(key) ? 'border-primary bg-primary-light' : 'border-transparent hover:bg-surface-2'
                }`}
              >
                <span className="text-text-muted flex-shrink-0">
                  <FileKindIcon mime={i.links.length > 0 ? null : i.mimeType} size={16} />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-text-main text-sm truncate">{i.title}</p>
                  <p className="text-text-subtle text-[11px] truncate">{pathOf(i.clusterId)}</p>
                </div>
                {isSelected(key) && <CheckCircle2 size={15} className="text-primary flex-shrink-0" />}
              </button>
            )
          })}
        </div>

        <div className="px-5 py-3 border-t border-border flex items-center gap-2 flex-shrink-0">
          <span className="text-text-subtle text-xs flex-1">
            {selected.length} selected
            {!searching && <span className="hidden sm:inline"> · <CornerDownLeft size={10} className="inline" /> chevron opens a cluster</span>}
          </span>
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-lg border border-border text-text-muted text-sm hover:bg-surface-2 transition-colors"
          >{t('ui_cancel')}</button>
          <button
            onClick={async () => {
              setSaving(true)
              await onSave(selected)
              setSaving(false)
            }}
            disabled={saving}
            className="px-4 py-2 rounded-lg bg-primary text-white text-sm font-medium hover:bg-primary-dark disabled:opacity-50 transition-colors"
          >
            {saving ? 'Saving…' : 'Save links'}
          </button>
        </div>
      </div>
    </div>
  )
}
