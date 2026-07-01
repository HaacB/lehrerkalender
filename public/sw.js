const CACHE = 'lehrerkalender-v3';
const ASSETS = [
  '/',
  '/index.html',
  '/login.html',
  '/manifest.json',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/vendor/tabler/tabler-icons.min.css',
  '/vendor/tabler/fonts/tabler-icons.woff2'
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  // Nur eigene GET-Requests behandeln.
  if (e.request.method !== 'GET' || url.origin !== self.location.origin) return;
  // Dynamische/Auth-Endpunkte NIE aus dem Cache bedienen (immer frische Serverdaten).
  if (url.pathname.startsWith('/api') || url.pathname.startsWith('/auth')) return;

  // Statische Assets: Cache-first mit Netz-Fallback (Offline-Fähigkeit der PWA).
  e.respondWith(
    caches.match(e.request).then(cached => {
      if (cached) return cached;
      return fetch(e.request).then(resp => {
        if (resp && resp.status === 200 && resp.type === 'basic') {
          const clone = resp.clone();
          caches.open(CACHE).then(c => c.put(e.request, clone));
        }
        return resp;
      }).catch(() => cached);
    })
  );
});
