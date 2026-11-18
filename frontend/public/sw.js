// Boca Boldisch service worker — push notifications only.
//
// Deliberately no fetch handler and no caching: the app stays a plain online
// web app, this worker exists so the browser can show lock-screen notifications
// (iOS only allows that for home-screen apps with a service worker).

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));

self.addEventListener('push', event => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: 'Boca Boldisch', body: event.data ? event.data.text() : '' };
  }
  const title = data.title || 'Boca Boldisch';
  event.waitUntil(self.registration.showNotification(title, {
    body: data.body || '',
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    tag: data.tag || undefined,
    data: { url: data.url || '/dashboard' },
  }));
});

// Tapping the notification focuses an open app window (navigating it to the
// notification's page) or opens a new one.
self.addEventListener('notificationclick', event => {
  event.notification.close();
  const target = new URL(event.notification.data?.url || '/dashboard', self.location.origin).href;
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const w of windows) {
      if (new URL(w.url).origin === self.location.origin) {
        await w.focus();
        if ('navigate' in w) await w.navigate(target).catch(() => {});
        return;
      }
    }
    await self.clients.openWindow(target);
  })());
});
