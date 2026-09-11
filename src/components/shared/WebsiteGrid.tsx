import React, { useState } from 'react'
import { Pencil, Trash2, X } from 'lucide-react'
import { Website } from '../../types'
import { useToolStore } from '../../store/toolStore'
import { Favicon } from './Favicon'
import { useT } from '../../i18n/useT'

/**
 * Somebody's websites as the icon grid, with a way to change them.
 *
 * The same grid sits in an employee's own Toolbox and in the manager's view of
 * that employee, so editing lives here once rather than twice. "Edit sites"
 * switches the tiles from links into editable tiles, each with a pencil and a
 * bin. A separate mode rather than icons on every tile, because on a phone
 * there is no hover to hide them behind, and a grid of icons that each carry
 * two more buttons is a grid of buttons.
 *
 * Removing takes the site off this person's list. A site can be on several
 * people's lists, and one person tidying theirs must not delete it for the
 * rest; it disappears altogether only when nobody has it any more.
 */
export function WebsiteGrid({
  sites,
  employeeId,
  canManage,
}: {
  sites: Website[]
  /** Whose list this is, so removing takes it off theirs and nobody else's. */
  employeeId: string
  canManage: boolean
}) {
  const { t } = useT()
  const { updateWebsite, removeWebsiteFor } = useToolStore()
  const [managing, setManaging] = useState(false)
  const [editing, setEditing] = useState<Website | null>(null)
  const [draft, setDraft] = useState({ name: '', url: '', description: '' })
  const [removing, setRemoving] = useState<Website | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const startEdit = (site: Website) => {
    setError('')
    setDraft({ name: site.name, url: site.url, description: site.description ?? '' })
    setEditing(site)
  }

  const save = async () => {
    if (!editing) return
    const raw = draft.url.trim()
    if (!raw) return
    // A bare domain is what people type; without a scheme the link opens
    // relative to the app and goes nowhere.
    const url = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`
    setBusy(true)
    setError('')
    try {
      await updateWebsite(editing.id, {
        url,
        name: draft.name.trim() || new URL(url).hostname.replace(/^www\./, ''),
        description: draft.description.trim(),
      })
      setEditing(null)
    } catch (e) {
      setError((e as Error).message || t('toolbox_siteCouldNotSave'))
    } finally {
      setBusy(false)
    }
  }

  const remove = async () => {
    if (!removing) return
    setBusy(true)
    setError('')
    try {
      await removeWebsiteFor(removing.id, employeeId)
      setRemoving(null)
    } catch (e) {
      setError((e as Error).message || t('toolbox_siteCouldNotRemove'))
    } finally {
      setBusy(false)
    }
  }

  const tile = 'flex flex-col items-center gap-2 p-3 rounded-xl transition-colors min-w-0'
  const icon = 'w-10 h-10 rounded-xl object-contain bg-surface border border-border p-1.5 shadow-sm'
  const letter = 'w-10 h-10 rounded-xl bg-primary-light border border-border shadow-sm flex items-center justify-center text-primary font-semibold'
  const label = 'text-text-main text-xs text-center leading-tight line-clamp-2 w-full break-words'
  const field = 'w-full px-3 py-2 rounded-lg border border-border bg-bg text-sm text-text-main focus:outline-none focus:ring-2 focus:ring-primary/30'

  return (
    <div>
      {canManage && sites.length > 0 && (
        <div className="flex justify-end mb-2">
          <button
            onClick={() => setManaging((m) => !m)}
            className={`flex items-center gap-1.5 text-xs font-medium px-2.5 py-1.5 rounded-lg transition-colors ${
              managing ? 'bg-primary text-white' : 'text-text-muted hover:bg-surface-2 hover:text-text-main'
            }`}
          >
            {managing ? <X size={13} /> : <Pencil size={13} />}
            {managing ? t('toolbox_siteDoneManaging') : t('toolbox_siteManage')}
          </button>
        </div>
      )}

      <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8 gap-2">
        {sites.map((w) =>
          managing ? (
            <div key={w.id} className={`${tile} bg-surface-2/60 border border-dashed border-border`}>
              <Favicon url={w.url} name={w.name} className={icon} letterClassName={letter} />
              <span className={label}>{w.name}</span>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => startEdit(w)}
                  title={t('toolbox_siteEdit')}
                  className="p-1.5 rounded-md text-text-muted hover:text-primary hover:bg-surface transition-colors"
                >
                  <Pencil size={14} />
                </button>
                <button
                  onClick={() => { setError(''); setRemoving(w) }}
                  title={t('toolbox_siteRemove')}
                  className="p-1.5 rounded-md text-text-muted hover:text-danger hover:bg-surface transition-colors"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            </div>
          ) : (
            <a
              key={w.id}
              href={w.url}
              target="_blank"
              rel="noopener noreferrer"
              title={w.description || w.url}
              className={`group ${tile} hover:bg-surface-2`}
            >
              <Favicon
                url={w.url}
                name={w.name}
                className={`${icon} group-hover:shadow transition-shadow`}
                letterClassName={letter}
              />
              <span className={label}>{w.name}</span>
            </a>
          ),
        )}
      </div>

      {editing && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={() => setEditing(null)}>
          <div className="bg-surface rounded-xl border border-border w-full max-w-md p-5" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-text-main font-semibold text-base">{t('toolbox_siteEdit')}</h3>
              <button onClick={() => setEditing(null)} className="text-text-subtle hover:text-text-main" title={t('ui_close')}>
                <X size={18} />
              </button>
            </div>
            <div className="space-y-3">
              <label className="block">
                <span className="text-xs font-medium text-text-muted mb-1 block">{t('toolbox_websiteUrlLabel')}</span>
                <input
                  type="url"
                  value={draft.url}
                  onChange={(e) => setDraft((d) => ({ ...d, url: e.target.value }))}
                  placeholder={t('toolbox_websiteUrl')}
                  className={field}
                />
              </label>
              <label className="block">
                <span className="text-xs font-medium text-text-muted mb-1 block">{t('toolbox_websiteNameLabel')}</span>
                <input
                  type="text"
                  value={draft.name}
                  onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
                  placeholder={t('toolbox_websiteName')}
                  className={field}
                />
              </label>
              <textarea
                value={draft.description}
                onChange={(e) => setDraft((d) => ({ ...d, description: e.target.value }))}
                placeholder={t('toolbox_websiteDesc')}
                rows={2}
                className={`${field} resize-none`}
              />
              {error && <p className="text-danger text-xs">{error}</p>}
              <div className="flex gap-2">
                <button
                  onClick={save}
                  disabled={busy || !draft.url.trim()}
                  className="flex-1 bg-primary text-white text-sm font-medium px-4 py-2 rounded-lg hover:bg-primary-dark disabled:opacity-50 transition-colors"
                >
                  {t('toolbox_siteSave')}
                </button>
                <button
                  onClick={() => setEditing(null)}
                  className="flex-1 border border-border text-text-muted text-sm px-4 py-2 rounded-lg hover:bg-surface-2 transition-colors"
                >
                  {t('ui_cancel')}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {removing && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={() => setRemoving(null)}>
          <div className="bg-surface rounded-xl border border-border w-full max-w-sm p-5" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-text-main font-semibold text-base mb-2 break-words">
              {t('toolbox_siteRemoveConfirm').replace('{name}', removing.name)}
            </h3>
            <p className="text-text-muted text-sm mb-4">{t('toolbox_siteRemoveConfirmBody')}</p>
            {error && <p className="text-danger text-xs mb-3">{error}</p>}
            <div className="flex gap-2">
              <button
                onClick={remove}
                disabled={busy}
                className="flex-1 bg-danger text-white text-sm font-medium px-4 py-2 rounded-lg hover:opacity-90 disabled:opacity-50 transition-opacity"
              >
                {busy ? t('ui_deleting') : t('toolbox_siteRemove')}
              </button>
              <button
                onClick={() => setRemoving(null)}
                className="flex-1 border border-border text-text-muted text-sm px-4 py-2 rounded-lg hover:bg-surface-2 transition-colors"
              >
                {t('ui_cancel')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
