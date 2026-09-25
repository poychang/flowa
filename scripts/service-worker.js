/* Generated build replaces the version and the public static-asset allowlist. */
const VERSION = '__VERSION__';
const ASSETS = __ASSETS__;
const PREFIX = 'flowa-shell-';
const CACHE = PREFIX + VERSION;
const allowed = new Set(ASSETS);
self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    try {
      // No runtime caching: room responses, credentials and documents never enter CacheStorage.
      for (let i = 0; i < ASSETS.length; i += 16) {
        await cache.addAll(ASSETS.slice(i, i + 16).map(url => new Request(url, { cache: 'reload', credentials: 'omit' })));
      }
    } catch (error) { await caches.delete(CACHE); throw error; }
    // Updates intentionally remain waiting until the user has saved a checkpoint.
  })());
});
self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const older = (await caches.keys()).filter(key => key.startsWith(PREFIX) && key !== CACHE);
    // Keep the preceding asset set for a still-running page; never touch IndexedDB.
    await Promise.all(older.slice(0, -1).map(key => caches.delete(key)));
    await self.clients.claim();
  })());
});
self.addEventListener('fetch', event => {
  const request = event.request, url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin || url.search || request.headers.has('Authorization')) return;
  const shell = request.mode === 'navigate' && ['/', '/index.html'].includes(url.pathname);
  const path = shell ? '/index.html' : url.pathname;
  if (!allowed.has(path) && !path.startsWith('/assets/')) return;
  event.respondWith((async () => {
    const current = await caches.open(CACHE);
    const response = await current.match(path);
    if (response) return response;
    // Old hashed chunks can still be requested by a page finishing an update.
    for (const key of await caches.keys()) {
      if (key.startsWith(PREFIX) && key !== CACHE) { const previous = await (await caches.open(key)).match(path); if (previous) return previous; }
    }
    return fetch(request);
  })());
});
self.addEventListener('message', event => {
  event.waitUntil((async () => {
    const reply = value => event.ports[0]?.postMessage(value);
    if (event.data?.type === 'STATUS') {
      const cache = await caches.open(CACHE);
      reply({ ready: (await cache.keys()).length === ASSETS.length, version: VERSION });
    } else if (event.data?.type === 'ACTIVATE') {
      const windows = (await self.clients.matchAll({ type: 'window', includeUncontrolled: true }))
        .filter(client => new URL(client.url).origin === self.location.origin);
      if (windows.length !== 1 || windows[0].id !== event.source?.id) { reply({ error: 'other-tabs' }); return; }
      reply({ ok: true });
      await self.skipWaiting();
    }
  })());
});
