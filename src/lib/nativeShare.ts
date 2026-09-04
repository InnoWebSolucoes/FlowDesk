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
  prepareFile: (url: string, fileName: string) => Promise<{ ok: boolean; error?: string }>
  dragFile: (url: string, fileName: string) => Promise<{ ok: boolean; error?: string }>
  copyFile: (url: string, fileName: string) => Promise<{ ok: boolean; error?: string }>
  openWhatsapp?: (
    phone?: string,
    message?: string,
  ) => Promise<{ ok: boolean; error?: string; phone?: string }>
  whatsappTab?: (open?: boolean) => Promise<{ ok: boolean; open?: boolean; mode?: string }>
  onWhatsappState?: (cb: (s: { open: boolean; mode: string }) => void) => () => void
  claudeTab?: (open?: boolean) => Promise<{ ok: boolean; open?: boolean }>
  onClaudeState?: (cb: (s: { docked: boolean }) => void) => () => void
}

declare global {
  interface Window {
    flowdeskNative?: NativeBridge
  }
}

export const isNative = () => !!window.flowdeskNative?.available

/**
 * Downloads a document ahead of a drag so the gesture does not have to wait.
 * Safe to call repeatedly; the copy is reused.
 */
export async function prepareDocument(storagePath: string | null, fileName: string | null) {
  const native = window.flowdeskNative
  if (!native?.prepareFile || !storagePath) return
  const url = await signedUrlFor(storagePath)
  if (url) native.prepareFile(url, fileName ?? 'document').catch(() => {})
}

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

/**
 * Opens the WhatsApp panel inside the desktop app, jumping straight to a
 * conversation when given a phone number.
 *
 * Outside the desktop app this falls back to wa.me in the browser, so a contact
 * phone stays clickable everywhere rather than being dead on the web.
 */
export async function openWhatsapp(
  phone?: string | null,
  message?: string,
): Promise<{ ok: boolean; error?: string }> {
  const native = window.flowdeskNative

  if (native?.openWhatsapp) {
    return native.openWhatsapp(phone ?? undefined, message)
  }

  // Browser fallback. wa.me needs the same digits-only form the desktop app
  // builds, and without a number there is nothing to open but WhatsApp itself.
  const digits = normalisePhoneDigits(phone)
  if (phone && !digits) return { ok: false, error: 'That phone number is not usable.' }

  const url = digits
    ? `https://wa.me/${digits}${message ? `?text=${encodeURIComponent(message)}` : ''}`
    : 'https://web.whatsapp.com/'
  window.open(url, '_blank', 'noopener')
  return { ok: true }
}

/**
 * True when WhatsApp can be shown as a tab — desktop app only. In a browser the
 * sidebar hides the tab rather than offering one that could do nothing.
 */
export const canDockWhatsapp = () => !!window.flowdeskNative?.whatsappTab

/** Shows or hides WhatsApp docked over the page. `undefined` toggles. */
export async function setWhatsappTab(open?: boolean) {
  const native = window.flowdeskNative
  if (!native?.whatsappTab) return { ok: false }
  return native.whatsappTab(open)
}

/** Subscribes to WhatsApp opening or closing, however it was triggered. */
export function onWhatsappState(cb: (s: { open: boolean; mode: string }) => void) {
  return window.flowdeskNative?.onWhatsappState?.(cb) ?? (() => {})
}

/** True when Claude can be shown as a full-width tab — desktop app only. */
export const canDockClaude = () => !!window.flowdeskNative?.claudeTab

/** Shows or hides Claude filling the page. `undefined` toggles. */
export async function setClaudeTab(open?: boolean) {
  const native = window.flowdeskNative
  if (!native?.claudeTab) return { ok: false }
  return native.claudeTab(open)
}

/** Subscribes to Claude's tab opening or closing, however it was triggered. */
export function onClaudeState(cb: (s: { docked: boolean }) => void) {
  return window.flowdeskNative?.onClaudeState?.(cb) ?? (() => {})
}

/**
 * Digits only, with a country code. Numbers are typed however the manager types
 * them, and a bare 10/11-digit number is Brazilian — the same assumption the
 * desktop app's normalisePhone makes. Keep the two in step: if they disagree,
 * the same contact opens a different chat in the app than in the browser.
 */
export function normalisePhoneDigits(raw?: string | null): string | null {
  const text = String(raw ?? '').trim()
  let digits = text.replace(/\D/g, '')
  if (!digits) return null

  // A leading + (or 00) means the country code is already present — adding 55
  // would turn a US or Portuguese number into someone else's Brazilian one.
  const hasCountryCode = text.startsWith('+') || digits.startsWith('00')
  if (digits.startsWith('00')) digits = digits.slice(2)

  if (!hasCountryCode && (digits.length === 10 || digits.length === 11)) {
    digits = '55' + digits
  }
  return digits.length >= 10 ? digits : null
}
