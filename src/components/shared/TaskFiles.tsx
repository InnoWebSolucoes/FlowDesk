import React, { useEffect, useRef, useState } from 'react'
import { Paperclip, X, Trash2, Download, Loader2 } from 'lucide-react'
import { useTaskStore } from '../../store/taskStore'
import { useAuthStore } from '../../store/authStore'
import { useT } from '../../i18n/useT'

/**
 * The work itself, attached to the task it was done for.
 *
 * Attachments used to hang off a comment, and comments were replaced by chat —
 * so someone finishing a task had nowhere to put what they had produced. A
 * photograph of the finished thing, the report that was written, the export
 * that was sent: this is where they go, against the day the work was done, so
 * a recurring task keeps each round's evidence separate.
 */
export function TaskFiles({
  taskId,
  dueDate,
  onClose,
}: {
  taskId: string
  /** The day being shown, so a recurring task files each round separately. */
  dueDate: string | null
  onClose: () => void
}) {
  const { t } = useT()
  const { taskFiles, loadTaskFiles, uploadTaskFile, deleteTaskFile, getTaskFileUrl } =
    useTaskStore()
  const { currentUser } = useAuthStore()
  const inputRef = useRef<HTMLInputElement>(null)

  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    loadTaskFiles(taskId)
  }, [taskId, loadTaskFiles])

  // This task's files for the day in question; a task done every week should
  // not show last week's photographs against this week's round.
  const files = taskFiles.filter(
    (f) => f.taskId === taskId && (dueDate === null || f.dueDate === dueDate || f.dueDate === null),
  )

  const add = async (list: FileList | null) => {
    if (!list?.length) return
    setError('')
    setBusy(true)
    try {
      for (const file of Array.from(list)) {
        await uploadTaskFile(taskId, dueDate, file)
      }
    } catch (e) {
      setError((e as Error).message || t('taskfiles_couldNotAttach'))
    } finally {
      setBusy(false)
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  const open = async (path: string) => {
    const url = await getTaskFileUrl(path)
    if (url) window.open(url, '_blank', 'noopener,noreferrer')
    else setError(t('taskfiles_couldNotOpen'))
  }

  const remove = async (id: string) => {
    setError('')
    try {
      await deleteTaskFile(id)
    } catch (e) {
      setError((e as Error).message || t('taskfiles_couldNotRemove'))
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />

      <div className="relative w-full max-w-md bg-surface rounded-xl border border-border shadow-2xl max-h-[80vh] flex flex-col">
        <div className="flex items-center justify-between px-5 py-3 border-b border-border">
          <div className="flex items-center gap-2">
            <Paperclip size={15} className="text-primary" />
            <h3 className="text-text-main font-semibold text-sm">{t('taskfiles_title')}</h3>
          </div>
          <button onClick={onClose} className="text-text-subtle hover:text-text-main">
            <X size={17} />
          </button>
        </div>

        <div className="p-5 overflow-y-auto">
          <p className="text-text-muted text-xs mb-3">{t('taskfiles_hint')}</p>

          {error && (
            <div className="mb-3 px-3 py-2 rounded-lg bg-danger-bg border border-danger/30 text-danger text-xs">
              {error}
            </div>
          )}

          <input
            ref={inputRef}
            type="file"
            multiple
            onChange={(e) => add(e.target.files)}
            className="hidden"
          />
          <button
            onClick={() => inputRef.current?.click()}
            disabled={busy}
            className="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg border border-dashed border-border text-xs text-text-muted hover:border-primary hover:text-text-main transition-colors disabled:opacity-60"
          >
            {busy ? (
              <><Loader2 size={14} className="animate-spin" /> {t('taskfiles_uploading')}</>
            ) : (
              <><Paperclip size={14} /> {t('taskfiles_add')}</>
            )}
          </button>

          <div className="mt-3 space-y-1.5">
            {files.map((f) => (
              <div
                key={f.id}
                className="flex items-center gap-2 px-3 py-2 rounded-lg bg-surface-2 border border-border"
              >
                <button
                  onClick={() => open(f.storagePath)}
                  className="flex-1 min-w-0 text-left"
                  title={t('taskfiles_openFile')}
                >
                  <p className="text-xs text-text-main truncate">{f.name}</p>
                  <p className="text-[10px] text-text-subtle">
                    {Math.max(1, Math.round(f.size / 1024))} KB
                    {f.dueDate ? ` · ${f.dueDate}` : ''}
                  </p>
                </button>
                <button
                  onClick={() => open(f.storagePath)}
                  className="text-text-subtle hover:text-text-main p-1"
                  title={t('taskfiles_openFile')}
                >
                  <Download size={13} />
                </button>
                {f.uploadedBy === currentUser?.id && (
                  <button
                    onClick={() => remove(f.id)}
                    className="text-text-subtle hover:text-danger p-1"
                    title={t('ui_remove')}
                  >
                    <Trash2 size={13} />
                  </button>
                )}
              </div>
            ))}
            {files.length === 0 && !busy && (
              <p className="text-text-subtle text-xs italic text-center py-3">
                {t('taskfiles_none')}
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
