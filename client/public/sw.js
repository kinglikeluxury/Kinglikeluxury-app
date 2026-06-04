const CACHE_NAME = 'kinglike-v5';
const urlsToCache = ['/', '/index.html'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(urlsToCache))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) =>
      Promise.all(
        cacheNames.map((name) => {
          if (name !== CACHE_NAME) return caches.delete(name);
        })
      )
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);

  // NEVER intercept API requests — let the browser go directly to the server.
  // This prevents stale cached responses from masking backend API endpoints.
  if (url.pathname.startsWith('/api/')) return;

  // NEVER cache Vite dev-server paths — these use timestamped/hashed URLs that
  // change on every server restart. Caching them causes a blank page because old
  // module URLs become invalid after a restart.
  if (
    url.pathname.startsWith('/@vite/') ||
    url.pathname.startsWith('/@react-refresh') ||
    url.pathname.startsWith('/src/') ||
    url.pathname.startsWith('/node_modules/')
  ) return;

  if (url.pathname.startsWith('/locales/')) {
    event.respondWith(fetch(event.request));
    return;
  }

  event.respondWith(
    fetch(event.request)
      .then((response) => {
        if (response.status === 200) {
          const responseClone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, responseClone));
        }
        return response;
      })
      .catch(() => caches.match(event.request))
  );
});

// ── Web Push Notifications ───────────────────────────────────────────────────
self.addEventListener('push', (event) => {
  let data = { title: 'Kinglike Luxury', body: 'You have a new notification' };
  try {
    data = event.data ? event.data.json() : data;
  } catch (e) {
    data.body = event.data ? event.data.text() : data.body;
  }

  const title = data.title || 'Kinglike Luxury';
  const options = {
    body: data.body || '',
    icon: '/icons/icon-192x192.png',
    badge: '/icons/icon-72x72.png',
    data: data.data || {},
    vibrate: [200, 100, 200],
    requireInteraction: false,
    actions: data.data && data.data.meetingLink
      ? [{ action: 'open', title: 'Join Meeting' }]
      : [{ action: 'view', title: 'View Details' }],
    tag: data.data && data.data.bookingId ? 'booking-' + data.data.bookingId : 'kinglike-notif',
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  var notifData = event.notification.data || {};
  var targetUrl = '/notifications';

  if (event.action === 'open' && notifData.meetingLink) {
    targetUrl = notifData.meetingLink;
  }

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function(clientList) {
      for (var i = 0; i < clientList.length; i++) {
        var client = clientList[i];
        if (client.url.indexOf(self.location.origin) !== -1 && 'focus' in client) {
          client.focus();
          client.navigate(targetUrl);
          return;
        }
      }
      if (clients.openWindow) return clients.openWindow(targetUrl);
    })
  );
});
