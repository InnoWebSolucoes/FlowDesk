/**
 * Desktop pop-up notifications.
 *
 * The bell tells you what happened once you look at it, which is no use while
 * you are in another window — a chat message in particular is worth nothing if
 * the other person only learns of it on their next visit. The browser's own
 * Notification API gives a real system pop-up in the desktop shell as well as
 * in a browser, so this needs nothing from the native side.
 */

/** Asked for once, the first time there is something worth showing. */
let asked = false

export function canNotify() {
  return typeof window !== 'undefined' && 'Notification' in window
}

/**
 * Ask permission, but only when there is a reason to. Prompting on load is how
 * an app teaches people to click Block.
 */
export async function requestNotifyPermission() {
  if (!canNotify() || asked) return
  asked = true
  if (Notification.permission === 'default') {
    try {
      await Notification.requestPermission()
    } catch {
      // Denied or unavailable; the bell still carries everything.
    }
  }
}

export function notifyDesktop(title: string, body: string, onClick?: () => void) {
  if (!canNotify() || Notification.permission !== 'granted') return

  // Deliberately not suppressed while the window is visible.
  // visibilityState is 'visible' whenever the window is not minimised — which
  // includes sitting behind whatever you are actually working in — so
  // suppressing on it meant the pop-up almost never appeared. WhatsApp raises
  // one whether or not its window is on screen, and this matches that.

  try {
    const n = new Notification(title, {
      body,
      icon: '/logo.svg',
      // Keyed by title so a run of messages from one person replaces itself
      // rather than stacking up.
      tag: `flowdesk:${title}`,
    })
    if (onClick) {
      n.onclick = () => {
        window.focus()
        onClick()
        n.close()
      }
    }
  } catch {
    // Some shells refuse to construct one; nothing here is worth throwing for.
  }
}
