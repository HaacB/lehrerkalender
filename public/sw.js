const CACHE = 'lehrerkalender-v14';
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
  const req = e.request;
  const url = new URL(req.url);
  // Nur eigene GET-Requests behandeln.
  if (req.method !== 'GET' || url.origin !== self.location.origin) return;
  // Dynamische/Auth-Endpunkte NIE aus dem Cache bedienen (immer frische Serverdaten).
  if (url.pathname.startsWith('/api') || url.pathname.startsWith('/auth')) return;

  // Oberfläche (HTML/Navigation): NETWORK-FIRST. Online kommt immer die neueste
  // Version; nur bei fehlender Verbindung wird die zwischengespeicherte Seite
  // genutzt. Das verhindert, dass nach einem Update noch die alte App erscheint.
  const istSeite =
    req.mode === 'navigate' || url.pathname === '/' || url.pathname.endsWith('.html');

  if (istSeite) {
    e.respondWith(
      fetch(req)
        .then(resp => {
          if (resp && resp.status === 200 && resp.type === 'basic') {
            const clone = resp.clone();
            caches.open(CACHE).then(c => c.put(req, clone));
          }
          return resp;
        })
        .catch(() => caches.match(req).then(c => c || caches.match('/index.html')))
    );
    return;
  }

  // Übrige statische Assets (Icons, Schriften, CSS): CACHE-FIRST mit Netz-Fallback
  // — die ändern sich selten und sollen die App schnell/offline-fähig halten.
  e.respondWith(
    caches.match(req).then(cached => {
      if (cached) return cached;
      return fetch(req).then(resp => {
        if (resp && resp.status === 200 && resp.type === 'basic') {
          const clone = resp.clone();
          caches.open(CACHE).then(c => c.put(req, clone));
        }
        return resp;
      }).catch(() => cached);
    })
  );
});
