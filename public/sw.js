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

  // Always shown, even with FlowDesk open in front of you.
  //
  // Skipping it when a window is visible looks tidier and is a trap: a push
  // handler that shows nothing breaks the promise made by userVisibleOnly, and
  // the browser answers with its own "this site was updated in the background"
  // notice and eventually drops the subscription. The app's own pop-up carries
  // the same tag as this one, so when both fire they collapse into a single
  // notification rather than appearing twice.
  event.waitUntil(
    self.registration.showNotification(data.title || 'FlowDesk', {
      body: data.body || '',
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      // Keyed by title so a run of messages from one person replaces
      // itself rather than stacking up — the same rule as the desktop.
      tag: 'flowdesk:' + (data.title || ''),
      data: { url: data.url || '/' },
    })
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
