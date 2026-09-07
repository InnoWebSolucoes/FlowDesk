import React, { useEffect, useMemo, useRef, useState } from 'react'
import {
  Plus, Paperclip, Link2, X, Clock, Trash2, Loader2, NotebookPen,
} from 'lucide-react'
import { format, parseISO, startOfWeek, startOfMonth } from 'date-fns'
import { Project } from '../../types'
import { useWorkLogStore } from '../../store/workLogStore'
import { useProjectStore } from '../../store/projectStore'
import { useAuthStore } from '../../store/authStore'
import { useEmployeeStore } from '../../store/employeeStore'
import { EmptyState } from '../shared/EmptyState'
import { useT } from '../../i18n/useT'

type Grouping = 'day' | 'week' | 'month'

/**
 * The day's other work.
 *
 * Tasks cover what was planned; this is everything else — and because a
 * manager reads it to understand where the time went, it groups by day, week
 * or month rather than being one long list.
 */
export function WorkLog({ project }: { project: Project }) {
  const { t } = useT()
  const { entries, loadedFor, loading, load, add, remove } = useWorkLogStore()
  const { createItem } = useProjectStore()
  const { currentUser } = useAuthStore()
  const { employees } = useEmployeeStore()
  const fileRef = useRef<HTMLInputElement>(null)

  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [grouping, setGrouping] = useState<Grouping>('day')

  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [minutes, setMinutes] = useState('')
  const [workedOn, setWorkedOn] = useState(format(new Date(), 'yyyy-MM-dd'))
  const [itemIds, setItemIds] = useState<string[]>([])
  const [links, setLinks] = useState<{ url: string; label: string }[]>([])
  const [linkDraft, setLinkDraft] = useState('')

  useEffect(() => {
    if (loadedFor !== project.id) load(project.id)
  }, [project.id, loadedFor, load])

  const isAdmin = currentUser?.role === 'admin'
  const nameOf = (id: string) =>
    id === currentUser?.id ? t('worklog_you') : employees.find((e) => e.id === id)?.name ?? '—'

  // Grouped by the period the work happened in, newest first.
  const groups = useMemo(() => {
    const out = new Map<string, { label: string; entries: typeof entries }>()
    for (const e of entries) {
      const d = parseISO(e.workedOn)
      const key =
        grouping === 'day'
          ? e.workedOn
          : grouping === 'week'
            ? format(startOfWeek(d, { weekStartsOn: 1 }), 'yyyy-MM-dd')
            : format(startOfMonth(d), 'yyyy-MM')
      const label =
        grouping === 'day'
          ? format(d, 'EEEE d MMMM yyyy')
          : grouping === 'week'
            ? `${format(startOfWeek(d, { weekStartsOn: 1 }), 'd MMM')} – ${format(d, 'd MMM yyyy')}`
            : format(d, 'MMMM yyyy')
      if (!out.has(key)) out.set(key, { label, entries: [] })
      out.get(key)!.entries.push(e)
    }
    return [...out.entries()].sort((a, b) => b[0].localeCompare(a[0]))
  }, [entries, grouping])

  const totalOf = (list: typeof entries) =>
    list.reduce((sum, e) => sum + (e.minutes ?? 0), 0)

  const reset = () => {
    setTitle('')
    setDescription('')
    setMinutes('')
    setWorkedOn(format(new Date(), 'yyyy-MM-dd'))
    setItemIds([])
    setLinks([])
    setLinkDraft('')
  }

  const attachFiles = async (list: FileList | null) => {
    if (!list?.length) return
    setBusy(true)
    setError('')
    try {
      for (const file of Array.from(list)) {
        // A real project document, not an attachment that lives only here.
        const created = await createItem(project.id, null, { title: file.name }, file)
        if (created) setItemIds((prev) => [...prev, created.id])
      }
    } catch (e) {
      setError((e as Error).message || t('worklog_couldNotAttach'))
    } finally {
      setBusy(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  const addLink = () => {
    const url = linkDraft.trim()
    if (!url) return
    setLinks((prev) => [...prev, { url, label: url.replace(/^https?:\/\//, '').slice(0, 40) }])
    setLinkDraft('')
  }

  const submit = async () => {
    if (!title.trim()) {
      setError(t('worklog_needTitle'))
      return
    }
    setBusy(true)
    setError('')
    try {
      await add({
        projectId: project.id,
        title: title.trim(),
        description: description.trim(),
        minutes: minutes ? Number(minutes) : null,
        workedOn,
        itemIds,
        links,
      })
      reset()
      setOpen(false)
    } catch (e) {
      setError((e as Error).message || t('worklog_couldNotSave'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between gap-3 mb-4 flex-wrap">
        <div className="flex items-center gap-1 bg-surface-2 rounded-lg p-0.5">
          {(['day', 'week', 'month'] as const).map((g) => (
            <button
              key={g}
              onClick={() => setGrouping(g)}
              className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                grouping === g ? 'bg-surface text-text-main shadow-sm' : 'text-text-muted hover:text-text-main'
              }`}
            >
              {g === 'day' ? t('worklog_byDay') : g === 'week' ? t('worklog_byWeek') : t('worklog_byMonth')}
            </button>
          ))}
        </div>

        <button
          onClick={() => setOpen((v) => !v)}
          className="flex items-center gap-1.5 bg-primary text-white text-sm font-medium px-4 py-2 rounded-lg hover:bg-primary-dark transition-colors"
        >
          <Plus size={15} /> {t('worklog_add')}
        </button>
      </div>

      {error && (
        <div className="mb-3 px-3 py-2 rounded-lg bg-danger-bg border border-danger/30 text-danger text-xs">
          {error}
        </div>
      )}

      {open && (
        <div className="mb-5 bg-surface border border-border rounded-xl p-4 space-y-3">
          <input
            autoFocus
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => {
              // Enter saves: a log entry is usually one line typed in passing,
              // and reaching for the mouse to file it is most of the friction.
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                submit()
              }
            }}
            placeholder={t('worklog_titlePlaceholder')}
            className="w-full px-3 py-2 rounded-lg bg-surface-2 border border-border text-sm text-text-main focus:outline-none focus:border-primary"
          />
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            onKeyDown={(e) => {
              // Ctrl+Enter here: plain Enter has to stay a new line in a
              // box meant for more than one.
              if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                e.preventDefault()
                submit()
              }
            }}
            rows={3}
            placeholder={t('worklog_descriptionPlaceholder')}
            className="w-full px-3 py-2 rounded-lg bg-surface-2 border border-border text-sm text-text-main resize-none focus:outline-none focus:border-primary"
          />

          <div className="flex flex-wrap gap-3">
            <label className="flex flex-col gap-1">
              <span className="text-[11px] text-text-subtle">{t('worklog_day')}</span>
              <input
                type="date"
                value={workedOn}
                onChange={(e) => setWorkedOn(e.target.value)}
                className="px-2 py-1.5 rounded-md bg-surface-2 border border-border text-xs text-text-main focus:outline-none focus:border-primary"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[11px] text-text-subtle">{t('worklog_minutes')}</span>
              <input
                type="number"
                min={0}
                value={minutes}
                onChange={(e) => setMinutes(e.target.value)}
                placeholder="45"
                className="w-24 px-2 py-1.5 rounded-md bg-surface-2 border border-border text-xs text-text-main focus:outline-none focus:border-primary"
              />
            </label>
          </div>

          <input ref={fileRef} type="file" multiple onChange={(e) => attachFiles(e.target.files)} className="hidden" />
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={() => fileRef.current?.click()}
              disabled={busy}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md bg-surface-2 border border-border text-xs text-text-muted hover:text-text-main hover:border-primary/40 transition-colors disabled:opacity-60"
            >
              <Paperclip size={12} />
              {itemIds.length > 0 ? t('worklog_nAttached').replace('{n}', String(itemIds.length)) : t('worklog_attach')}
            </button>

            <div className="flex items-center gap-1.5 flex-1 min-w-[200px]">
              <input
                value={linkDraft}
                onChange={(e) => setLinkDraft(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addLink() } }}
                placeholder={t('worklog_linkPlaceholder')}
                className="flex-1 px-2.5 py-1.5 rounded-md bg-surface-2 border border-border text-xs text-text-main focus:outline-none focus:border-primary"
              />
              <button
                onClick={addLink}
                className="p-1.5 rounded-md text-text-muted hover:text-text-main"
                title={t('ui_addLink')}
              >
                <Link2 size={13} />
              </button>
            </div>
          </div>

          {links.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {links.map((l, i) => (
                <span key={i} className="flex items-center gap-1 px-2 py-1 rounded-md bg-surface-2 border border-border text-[11px] text-text-muted">
                  {l.label}
                  <button onClick={() => setLinks((p) => p.filter((_, j) => j !== i))} className="hover:text-danger">
                    <X size={10} />
                  </button>
                </span>
              ))}
            </div>
          )}

          <div className="flex gap-2">
            <button
              onClick={submit}
              disabled={busy}
              className="flex-1 flex items-center justify-center gap-2 bg-primary text-white text-sm font-medium py-2 rounded-lg hover:bg-primary-dark transition-colors disabled:opacity-60"
            >
              {busy ? <><Loader2 size={15} className="animate-spin" /> {t('worklog_saving')}</> : t('worklog_save')}
            </button>
            <button
              onClick={() => { reset(); setOpen(false) }}
              className="px-4 py-2 rounded-lg border border-border text-sm text-text-muted hover:text-text-main"
            >
              {t('ui_cancel')}
            </button>
          </div>
        </div>
      )}

      {loading && entries.length === 0 && (
        <p className="text-text-muted text-sm py-8 text-center">{t('emp_loading')}</p>
      )}

      {!loading && entries.length === 0 && (
        <EmptyState
          icon={NotebookPen}
          title={t('worklog_emptyTitle')}
          description={t('worklog_emptyDesc')}
        />
      )}

      <div className="space-y-5">
        {groups.map(([key, group]) => (
          <div key={key}>
            <div className="flex items-baseline justify-between mb-2">
              <h3 className="text-text-main font-semibold text-sm">{group.label}</h3>
              {totalOf(group.entries) > 0 && (
                <span className="text-text-subtle text-xs">
                  {Math.round((totalOf(group.entries) / 60) * 10) / 10} h
                </span>
              )}
            </div>

            <div className="space-y-2">
              {group.entries.map((e) => (
                <div key={e.id} className="bg-surface border border-border rounded-xl px-4 py-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-text-main text-sm font-medium">{e.title}</p>
                      {e.description && (
                        <p className="text-text-muted text-xs mt-1 whitespace-pre-wrap">{e.description}</p>
                      )}
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      {e.minutes != null && (
                        <span className="flex items-center gap-1 text-[11px] text-text-subtle">
                          <Clock size={11} /> {e.minutes} min
                        </span>
                      )}
                      {(e.authorId === currentUser?.id || isAdmin) && (
                        <button
                          onClick={() => remove(e.id)}
                          className="text-text-subtle hover:text-danger p-1"
                          title={t('ui_delete')}
                        >
                          <Trash2 size={12} />
                        </button>
                      )}
                    </div>
                  </div>

                  {(e.itemIds.length > 0 || e.links.length > 0) && (
                    <div className="flex flex-wrap gap-1.5 mt-2">
                      {e.itemIds.length > 0 && (
                        <span className="flex items-center gap-1 px-2 py-0.5 rounded-md bg-surface-2 border border-border text-[11px] text-text-muted">
                          <Paperclip size={10} /> {e.itemIds.length}
                        </span>
                      )}
                      {e.links.map((l, i) => (
                        <a
                          key={i}
                          href={l.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex items-center gap-1 px-2 py-0.5 rounded-md bg-surface-2 border border-border text-[11px] text-primary hover:underline"
                        >
                          <Link2 size={10} /> {l.label}
                        </a>
                      ))}
                    </div>
                  )}

                  <p className="text-text-subtle text-[10px] mt-2">
                    {nameOf(e.authorId)} · {format(parseISO(e.createdAt), 'HH:mm')}
                  </p>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
