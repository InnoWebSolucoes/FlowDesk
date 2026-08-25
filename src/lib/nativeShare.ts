import { supabase } from './supabaseClient'

/**
 * Sharing a document with another application.
 *
 * A web page cannot hand a real file to WhatsApp, Claude or Slack — only the
 * operating system can, so this works exclusively inside the FlowDesk desktop
 * app, which exposes the two calls below through a preload bridge. In a plain
 * browser `isNative` is false and the UI hides the actions rather than
 * offering something that would silently do nothing.
 */

interface NativeBridge {
  available: true
  dragFile: (url: string, fileName: string) => Promise<{ ok: boolean; error?: string }>
  copyFile: (url: string, fileName: string) => Promise<{ ok: boolean; error?: string }>
}

declare global {
  interface Window {
    flowdeskNative?: NativeBridge
  }
}

export const isNative = () => !!window.flowdeskNative?.available

/** A signed URL the desktop app can download. Null when there is no file. */
async function signedUrlFor(storagePath: string | null): Promise<string | null> {
  if (!storagePath) return null
  const { data } = await supabase.storage.from('attachments').createSignedUrl(storagePath, 60 * 60)
  return data?.signedUrl ?? null
}

/**
 * Hands the document to the OS as a dragged file. Call it from a dragstart
 * handler; the drop is then the operating system's business.
 */
export async function dragDocumentOut(
  storagePath: string | null,
  fileName: string | null,
): Promise<boolean> {
  const native = window.flowdeskNative
  if (!native || !storagePath) return false

  const url = await signedUrlFor(storagePath)
  if (!url) return false

  const res = await native.dragFile(url, fileName ?? 'document')
  if (!res.ok) console.error('[dragDocumentOut]', res.error)
  return res.ok
}

/**
 * Puts the document on the clipboard, ready to paste into another app.
 *
 * This is usually the better route to an app that lives in the taskbar or dock:
 * hovering a drag over a taskbar button to raise its window is a Windows shell
 * behaviour that an app-initiated drag does not reliably trigger, so dragging
 * works best onto a window that is already visible.
 */
export async function copyDocumentFile(
  storagePath: string | null,
  fileName: string | null,
): Promise<{ ok: boolean; error?: string }> {
  const native = window.flowdeskNative
  if (!native) return { ok: false, error: 'Only available in the desktop app.' }
  if (!storagePath) return { ok: false, error: 'This item has no file to copy.' }

  const url = await signedUrlFor(storagePath)
  if (!url) return { ok: false, error: 'The file could not be prepared.' }

  return native.copyFile(url, fileName ?? 'document')
}
