/**
 * Push notifications to this phone.
 *
 * The desktop pop-up (desktopNotify) only works while FlowDesk is open. A phone
 * in a pocket needs the push service instead: the browser hands out a
 * subscription for this device, it is kept in push_subscriptions, and the
 * send-push edge function delivers each notification through it — Android
 * (Chrome) and iPhone (Safari 16.4+, once the app is on the Home Screen).
 */
import { supabase } from './supabaseClient'

const VAPID_PUBLIC_KEY = import.meta.env.VITE_VAPID_PUBLIC_KEY as string | undefined

/** Why turning it on did not work, when it did not. Shown under the switch. */
export let lastPushError: string | null = null

export type PushStatus =
  /** This browser cannot do push at all. */
  | 'unsupported'
  /** iPhone: push only works once FlowDesk is added to the Home Screen. */
  | 'needs-install'
  /** Blocked in the browser or phone settings; only they can undo that. */
  | 'denied'
  | 'off'
  | 'on'

function isIOS() {
  return /iPhone|iPad|iPod/.test(navigator.userAgent)
}

function isStandalone() {
  return (
    window.matchMedia?.('(display-mode: standalone)').matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  )
}

export function pushSupported() {
  return (
    typeof window !== 'undefined' &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window &&
    !!VAPID_PUBLIC_KEY
  )
}

/**
 * The service worker is registered whether or not push is on: it is what the
 * push service wakes up, and registering is free.
 */
export async function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return null
  try {
    return await navigator.serviceWorker.register('/sw.js')
  } catch {
    return null
  }
}

function urlBase64ToUint8Array(base64: string) {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4)
  const raw = atob((base64 + padding).replace(/-/g, '+').replace(/_/g, '/'))
  return Uint8Array.from(raw, (c) => c.charCodeAt(0))
}

export async function pushStatus(): Promise<PushStatus> {
  if (isIOS() && !isStandalone()) return 'needs-install'
  if (!pushSupported()) return 'unsupported'
  if (Notification.permission === 'denied') return 'denied'
  const reg = await navigator.serviceWorker.getRegistration()
  const sub = await reg?.pushManager.getSubscription()
  return sub ? 'on' : 'off'
}

/**
 * Turn push on for this device. Must be called from a tap: iPhone refuses a
 * permission prompt that the person did not ask for.
 */
export async function enablePush(userId: string): Promise<PushStatus> {
  lastPushError = null
  if (!pushSupported()) return await pushStatus()

  // Straight out of the tap that called this, and nowhere else: iOS gives one
  // chance per install and refuses a request that did not come from something
  // the person did.
  const permission = await Notification.requestPermission()
  if (permission !== 'granted') return permission === 'denied' ? 'denied' : 'off'

  const reg = (await navigator.serviceWorker.getRegistration()) ?? (await registerServiceWorker())
  if (!reg) return 'unsupported'
  await navigator.serviceWorker.ready

  let sub = await reg.pushManager.getSubscription()
  if (!sub) {
    try {
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY!),
      })
    } catch (e) {
      // The desktop shell has the API but no push service behind it.
      lastPushError = (e as Error).message
      return 'unsupported'
    }
  }

  try {
    await saveSubscription(userId, sub)
  } catch (e) {
    // The browser is subscribed but the server has never heard of it, which
    // would sit there reading "on" and deliver nothing for ever. Undo the
    // browser's half so the switch and the truth agree, and say why.
    lastPushError = (e as Error).message
    try { await sub.unsubscribe() } catch { /* already gone */ }
    return 'off'
  }
  return 'on'
}

export async function disablePush() {
  const reg = await navigator.serviceWorker.getRegistration()
  const sub = await reg?.pushManager.getSubscription()
  if (!sub) return
  await supabase.from('push_subscriptions').delete().eq('endpoint', sub.endpoint)
  await sub.unsubscribe()
}

/**
 * Throws rather than returning quietly.
 *
 * The browser's half of turning notifications on can succeed while this half
 * fails — the table missing, a policy refusing the row — and the switch then
 * sat there saying "on" over a device the server had never heard of. Nothing
 * would ever arrive, and nothing would ever say why.
 */
async function saveSubscription(userId: string, sub: PushSubscription) {
  const json = sub.toJSON()
  if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth) {
    throw new Error('This browser gave out an incomplete subscription.')
  }

  const { error } = await supabase.from('push_subscriptions').upsert(
    {
      endpoint: json.endpoint,
      user_id: userId,
      p256dh: json.keys.p256dh,
      auth: json.keys.auth,
      user_agent: navigator.userAgent.slice(0, 200),
    },
    { onConflict: 'endpoint' }
  )

  if (error) {
    console.error('[push] the subscription could not be saved:', error)
    throw new Error(error.message)
  }
}

/**
 * On every sign-in, re-save whatever subscription this device already holds.
 * The push service can rotate it, and a device that changes hands between
 * accounts should follow the person now signed in.
 */
export async function syncPush(userId: string) {
  if (!pushSupported()) return
  const reg = await registerServiceWorker()
  const sub = await reg?.pushManager.getSubscription()
  if (!sub) return
  try {
    await saveSubscription(userId, sub)
  } catch {
    // Runs on every sign-in with nobody watching, so it cannot throw into
    // start-up. The switch reports it properly when someone turns it on.
  }
}
