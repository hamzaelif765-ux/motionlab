/* MotionLab v4 service worker
 * - App shell: cached on install (relative paths, works under /motionlab/)
 * - index.html / navigations: NETWORK-FIRST (updates arrive fast), cache fallback offline
 * - MediaPipe wasm + .task models + jsdelivr JS: CACHE-FIRST (big files, cached on first use)
 * - Page sends postMessage('skip') -> skipWaiting (used by the "Update available" toast)
 * Bump VERSION on every release so old caches are removed.
 */
const VERSION = 'v4.0.1';
const SHELL = 'motionlab-shell-' + VERSION;
const RUNTIME = 'motionlab-runtime-v4b'; // models/wasm (CORS responses only; old opaque entries are dropped)
const SHELL_FILES = ['./', './index.html', './manifest.json', './icon-192.png', './icon-512.png'];

// Hosts whose responses (CDN JS, wasm, model files) we cache on first use.
const RUNTIME_HOSTS = ['cdn.jsdelivr.net', 'storage.googleapis.com'];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(SHELL).then((c) =>
      // addAll fails if any file is missing; add one by one so a missing icon doesn't break install
      Promise.all(SHELL_FILES.map((u) => c.add(u).catch(() => {})))
    )
  );
  // No auto skipWaiting: the page shows "Update available" and sends 'skip'.
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys.filter((k) => (k.startsWith('motionlab-shell-') && k !== SHELL) || (k.startsWith('motionlab-runtime-') && k !== RUNTIME)).map((k) => caches.delete(k))
      );
      await self.clients.claim();
    })()
  );
});

self.addEventListener('message', (e) => {
  if (e.data === 'skip' || (e.data && e.data.type === 'SKIP_WAITING')) self.skipWaiting();
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // 1) Same-origin navigations / index.html -> network-first
  if (url.origin === location.origin && (req.mode === 'navigate' || url.pathname.endsWith('/index.html'))) {
    e.respondWith(
      (async () => {
        try {
          const fresh = await fetch(req, { cache: 'no-cache' });
          const c = await caches.open(SHELL);
          c.put('./index.html', fresh.clone());
          return fresh;
        } catch (_) {
          return (await caches.match('./index.html')) || (await caches.match('./')) || Response.error();
        }
      })()
    );
    return;
  }

  // 2) Other same-origin files (manifest, icons, sw) -> stale-while-revalidate
  if (url.origin === location.origin) {
    e.respondWith(
      (async () => {
        const cached = await caches.match(req);
        const net = fetch(req)
          .then(async (r) => {
            if (r && r.ok) (await caches.open(SHELL)).put(req, r.clone());
            return r;
          })
          .catch(() => null);
        return cached || (await net) || Response.error();
      })()
    );
    return;
  }

  // 3) MediaPipe wasm / models / CDN scripts -> cache-first
  if (RUNTIME_HOSTS.includes(url.hostname)) {
    e.respondWith(
      (async () => {
        const cached = await caches.match(req);
        if (cached && cached.type !== 'opaque') return cached;
        try {
          const r = await fetch(req);
          // Cache only full CORS 200 responses (never opaque, never 206 partial)
          if (r && r.status === 200 && r.type === 'cors') {
            (await caches.open(RUNTIME)).put(req, r.clone());
          }
          return r;
        } catch (err) {
          return Response.error();
        }
      })()
    );
  }
});
