// Web Push in the service worker (Part R3), loaded by the generated sw.js
// (pwa.config.js importScripts). The server sends { title, link } only, so
// the notification shows a title and opens the app at the link; the details
// are read after signing in.
self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = {};
  }
  const title = typeof data.title === 'string' && data.title ? data.title.slice(0, 120) : 'Shift Handover';
  // Only paths inside the app are followed.
  const link = typeof data.link === 'string' && data.link.startsWith('/') && !data.link.startsWith('//') ? data.link : '/';
  event.waitUntil(self.registration.showNotification(title, {
    icon: '/icons/pwa-192.png',
    badge: '/icons/pwa-192.png',
    tag: 'shms',
    renotify: true,
    data: { link },
  }));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = new URL(event.notification.data?.link || '/', self.location.origin).href;
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of windows) {
      if (new URL(client.url).origin === self.location.origin) {
        await client.focus();
        if ('navigate' in client) return client.navigate(url);
        return undefined;
      }
    }
    return self.clients.openWindow(url);
  })());
});
