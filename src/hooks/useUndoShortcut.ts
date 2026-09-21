import { useEffect } from 'react'
import { useUndoStore } from '../store/undoStore'

/**
 * Whether the keystroke belongs to whatever is being typed in.
 *
 * Cmd+Z inside a text box is the browser's own undo, and taking it over would
 * mean a mistyped task title could only be fixed by deleting it — while the
 * "undo" it triggered instead reversed something else entirely, somewhere else
 * on the page. So anything that accepts text keeps its own undo.
 */
function isTyping(target: EventTarget | null) {
  const el = target as HTMLElement | null
  if (!el) return false
  const tag = el.tagName
  return (
    tag === 'INPUT' ||
    tag === 'TEXTAREA' ||
    tag === 'SELECT' ||
    el.isContentEditable ||
    // The note editor and chat composer are contenteditable surfaces whose
    // inner nodes report false for isContentEditable.
    !!el.closest('[contenteditable="true"]')
  )
}

/**
 * Cmd+Z to undo, Cmd+Shift+Z to redo — Ctrl on Windows and in the desktop
 * shell, and Ctrl+Y as well, which is what Windows hands people.
 *
 * Mounted once, at the top of the app: a shortcut registered per screen would
 * stop working on whichever screen forgot it.
 */
export function useUndoShortcut() {
  const undo = useUndoStore((s) => s.undo)
  const redo = useUndoStore((s) => s.redo)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey
      if (!mod) return
      if (isTyping(e.target)) return

      const key = e.key.toLowerCase()
      if (key === 'z') {
        e.preventDefault()
        if (e.shiftKey) redo()
        else undo()
        return
      }
      // Windows' other redo.
      if (key === 'y') {
        e.preventDefault()
        redo()
      }
    }

    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [undo, redo])
}
