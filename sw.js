const CACHE_NAME = 'treva-app-shell-v8';
const PRECACHE_URLS = [
  './',
  './manifest.webmanifest',
  './assets/icons/icon-192.png',
  './assets/icons/icon-512.png',
  './assets/icons/apple-touch-icon.png',
  './assets/css/styles.css?v=6.14'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return Promise.allSettled(
        PRECACHE_URLS.map((url) =>
          cache.add(new Request(url, { cache: 'reload' })).catch(() => null)
        )
      );
    }).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key.startsWith('treva-app-shell-') && key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      )
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

function shouldBypassServiceWorker(request, url) {
  if (request.method !== 'GET') return true;
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return true;
  if (url.origin !== self.location.origin) return true;
  if (request.headers.has('range')) return true;

  const path = url.pathname.toLowerCase();
  if (
    path.endsWith('/api.php') ||
    path.endsWith('/stream.php') ||
    path.endsWith('/config.php') ||
    path.endsWith('/sw.js')
  ) {
    return true;
  }

  return false;
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);

  if (shouldBypassServiceWorker(request, url)) {
    return;
  }

  // Network-first so live PHP state, scenes, and hot edits always take priority,
  // while falling back cleanly to the cached shell when temporarily offline.
  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response && response.ok && response.type === 'basic') {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(request, copy).catch(() => null);
          });
        }
        return response;
      })
      .catch(() =>
        caches.match(request).then((cached) => {
          if (cached) return cached;
          if (request.mode === 'navigate') {
            return caches.match('./');
          }
          return Response.error();
        })
      )
  );
});
