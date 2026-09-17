// FlowDesk's service worker. It exists for one reason: a phone only receives
// push notifications through a service worker, so this is what wakes up when
// the push service delivers one and shows it. Nothing is cached here — the app
// still needs the network, exactly as it did before.

self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()))

self.addEventListener('push', (event) => {
  let data = {}
  try {
    data = event.data ? event.data.json() : {}
  } catch {
    data = { title: 'FlowDesk', body: event.data ? event.data.text() : '' }
  }

  event.waitUntil(
    (async () => {
      // If FlowDesk is open on screen right now, the app's own pop-up has
      // already shown this one; a second copy from here would just be noise.
      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
      if (windows.some((w) => w.visibilityState === 'visible')) return

      await self.registration.showNotification(data.title || 'FlowDesk', {
        body: data.body || '',
        icon: '/icon-192.png',
        badge: '/icon-192.png',
        // Keyed by title so a run of messages from one person replaces
        // itself rather than stacking up — the same rule as the desktop.
        tag: 'flowdesk:' + (data.title || ''),
        data: { url: data.url || '/' },
      })
    })()
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const url = (event.notification.data && event.notification.data.url) || '/'
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
      const existing = windows[0]
      if (existing) {
        await existing.focus()
        if ('navigate' in existing) {
          try { await existing.navigate(url) } catch { /* cross-origin or gone */ }
        }
        return
      }
      await self.clients.openWindow(url)
    })()
  )
})
