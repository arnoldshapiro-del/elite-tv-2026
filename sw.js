/* 2026 Elite TV — service worker.

   What it is for: once you have opened the app, it opens again even with no signal —
   the page, its icons and the posters you have already seen come straight off the disk.

   Three deliberate rules, in this order:
   1. Anything under /api/ is NEVER touched. Showtimes, films in theatres and the live
      search all move with the clock; a cached answer there would be a wrong answer.
      Same for anything that isn't a plain GET.
   2. The app's own files are network-first — the newest copy always wins when there is
      a connection, and the cached copy is the fallback when there isn't.
   3. Posters, backdrops and the Google fonts are cache-first, because a poster never
      changes once published. They go in their own cache with a cap so the browser
      doesn't fill up over months of browsing.
   Everything else from other sites (YouTube, ticket links) is left completely alone.
*/
const CACHE = 'elite-tv-v1';
const MEDIA_CACHE = 'elite-tv-media-v1';
const MEDIA_CAP = 120;
const MEDIA_HOSTS = [
  'fonts.googleapis.com',
  'fonts.gstatic.com',
  'media.themoviedb.org',
  'image.tmdb.org'
];

self.addEventListener('install', event => {
  // No pre-cache list: whatever gets used gets kept. Take over straight away.
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(
      names.filter(n => n !== CACHE && n !== MEDIA_CACHE).map(n => caches.delete(n))
    );
    await self.clients.claim();
  })());
});

/* Keep the media cache from growing forever — oldest entries out first. */
async function trimMediaCache() {
  const cache = await caches.open(MEDIA_CACHE);
  const keys = await cache.keys();
  if (keys.length <= MEDIA_CAP) return;
  const excess = keys.length - MEDIA_CAP;
  for (let i = 0; i < excess; i++) await cache.delete(keys[i]);
}

/* App's own files: try the network, fall back to what we saved last time. */
async function networkFirst(request) {
  const cache = await caches.open(CACHE);
  try {
    const fresh = await fetch(request);
    if (fresh && fresh.ok) cache.put(request, fresh.clone());
    return fresh;
  } catch (err) {
    const hit = await cache.match(request);
    if (hit) return hit;
    // Offline and never seen this exact URL — for a page request, serve the app shell.
    if (request.mode === 'navigate') {
      const shell = await cache.match('/index.html') || await cache.match('/');
      if (shell) return shell;
    }
    throw err;
  }
}

/* Posters and fonts: answer from the cache instantly, refresh quietly in the background. */
async function cacheFirst(request) {
  const cache = await caches.open(MEDIA_CACHE);
  const hit = await cache.match(request);
  if (hit) {
    fetch(request).then(fresh => {
      if (fresh && (fresh.ok || fresh.type === 'opaque')) {
        cache.put(request, fresh.clone()).then(trimMediaCache);
      }
    }).catch(() => {});
    return hit;
  }
  const fresh = await fetch(request);
  if (fresh && (fresh.ok || fresh.type === 'opaque')) {
    await cache.put(request, fresh.clone());
    trimMediaCache();
  }
  return fresh;
}

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;                 // rule 1 — leave writes alone

  let url;
  try { url = new URL(request.url); } catch (err) { return; }

  if (url.origin === self.location.origin) {
    if (url.pathname.startsWith('/api/')) return;       // rule 1 — live data, never cached
    event.respondWith(networkFirst(request));           // rule 2
    return;
  }

  if (MEDIA_HOSTS.indexOf(url.hostname) >= 0) {
    event.respondWith(cacheFirst(request));             // rule 3
  }
  // anything else off-site (YouTube, ticket pages) passes straight through
});
