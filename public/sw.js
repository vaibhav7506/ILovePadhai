const VERSION = 'examforge-shell-v6-2026-07-30';
const RUNTIME = 'examforge-runtime-v6';
const EXPLICIT = 'examforge-explicit-downloads-v1';
const CORE = ['/', '/index.html', '/manifest.webmanifest', '/favicon.svg', '/pwa-icon.svg'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(VERSION).then((cache) => cache.addAll(CORE)));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => ![VERSION, RUNTIME, EXPLICIT].includes(key))
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
  if (event.data?.type === 'CACHE_SHELL') {
    const urls = Array.isArray(event.data.urls)
      ? event.data.urls
          .slice(0, 100)
          .filter((value) => {
            if (typeof value !== 'string') return false;
            const url = new URL(value, self.location.origin);
            return url.origin === self.location.origin && !url.pathname.startsWith('/api/');
          })
          .map((value) => new URL(value, self.location.origin).href)
      : [];
    event.waitUntil(
      caches
        .open(RUNTIME)
        .then(async (cache) => {
          await Promise.all(
            urls.map(async (url) => {
              try {
                const response = await fetch(url);
                if (response.ok) await cache.put(url, response);
              } catch {
                // A later page load can retry individual shell resources.
              }
            }),
          );
        })
        .then(() => event.ports[0]?.postMessage({ cached: true })),
    );
  }
});

async function networkFirst(request) {
  const cache = await caches.open(RUNTIME);
  try {
    const response = await fetch(request);
    if (response.ok) await cache.put(request, response.clone());
    return response;
  } catch {
    return (await cache.match(request, { ignoreVary: true })) ?? Response.error();
  }
}

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;

  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request).catch(async () => {
        const cache = await caches.open(VERSION);
        return (await cache.match('/', { ignoreVary: true })) ?? Response.error();
      }),
    );
    return;
  }

  if (url.pathname.startsWith('/api/')) {
    const safePublic =
      url.pathname === '/api/offline/catalogue' ||
      url.pathname.startsWith('/api/offline/notes/') ||
      url.pathname.startsWith('/api/offline/practice/') ||
      url.pathname === '/api/content/overview' ||
      url.pathname === '/api/notes' ||
      url.pathname === '/api/papers/recent';
    if (safePublic) event.respondWith(networkFirst(event.request));
    return;
  }

  event.respondWith(
    caches.match(event.request, { ignoreVary: true }).then(
      (cached) =>
        cached ??
        fetch(event.request).then(async (response) => {
          if (response.ok) {
            const cache = await caches.open(RUNTIME);
            await cache.put(event.request, response.clone());
          }
          return response;
        }),
    ),
  );
});

self.addEventListener('sync', (event) => {
  if (event.tag !== 'examforge-attempt-recovery') return;
  event.waitUntil(
    self.clients
      .matchAll({ type: 'window', includeUncontrolled: true })
      .then((clients) =>
        Promise.all(clients.map((client) => client.postMessage({ type: 'EXAMFORGE_SYNC' }))),
      ),
  );
});
