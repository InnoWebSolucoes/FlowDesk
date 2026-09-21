import { useEffect } from 'react'
import { Undo2, AlertTriangle, Info } from 'lucide-react'
import { useUndoStore } from '../../store/undoStore'

/**
 * What Cmd+Z just did.
 *
 * Undo with no feedback is indistinguishable from a shortcut that does
 * nothing — and worse, from one that quietly reversed something off screen.
 * So it says what it took back, by name.
 *
 * Mounted once beside the app, not per screen.
 */
export function UndoToast() {
  const notice = useUndoStore((s) => s.notice)
  const clearNotice = useUndoStore((s) => s.clearNotice)

  useEffect(() => {
    if (!notice) return
    // Long enough to read, short enough not to sit over the work.
    const id = setTimeout(clearNotice, 2600)
    return () => clearTimeout(id)
  }, [notice, clearNotice])

  if (!notice) return null

  const Icon = notice.kind === 'error' ? AlertTriangle : notice.kind === 'none' ? Info : Undo2

  return (
    <div className="fixed bottom-5 left-1/2 -translate-x-1/2 z-[100] pointer-events-none animate-fade-in">
      <div
        className={`flex items-center gap-2 px-4 py-2.5 rounded-xl shadow-lg border text-sm ${
          notice.kind === 'error'
            ? 'bg-danger-bg border-danger/30 text-danger'
            : 'bg-text-main border-black/10 text-white'
        }`}
      >
        <Icon size={15} className="flex-shrink-0" />
        {notice.text}
      </div>
    </div>
  )
}
