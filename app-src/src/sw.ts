/// <reference lib="webworker" />
/**
 * AAP Attendance service worker.
 *  - App files are served from the phone → the app opens instantly, also offline.
 *  - Hashed file names (main-AB12CD.js) never change content → cache forever.
 *  - The page is refreshed in the background; its new files are downloaded BEFORE the new
 *    page is stored, so the app can never open half-updated (or broken offline).
 *  - A new version is announced by the app's "Update available" pop-up (version.json).
 */
export {};
const sw = self as unknown as ServiceWorkerGlobalScope;
declare const __APP_VERSION__: string;
declare const __PRECACHE__: string[];

const CACHE = 'aap-attendance-' + __APP_VERSION__;
const PAGE = './';
const ASSET_RE = /(?:src|href)="((?:assets|models|wasm)\/[^"]+|config\.js\?v=[^"]+)"/g;

async function fromAnyCache(url: string): Promise<Response | undefined> {
  return caches.match(url); // hashed files: the old cache already has them → no re-download
}

async function put(cache: Cache, url: string, fresh = false): Promise<boolean> {
  try {
    const hit = !fresh && (await fromAnyCache(url));
    const res = hit || (await fetch(url, { cache: 'no-cache' }));
    if (!res.ok) return false;
    await cache.put(url, res.clone());
    return true;
  } catch { return false; }
}

sw.addEventListener('install', e => {
  e.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await put(cache, PAGE, true);
    await Promise.all(__PRECACHE__.map(u => put(cache, u)));
    await sw.skipWaiting();
  })());
});

sw.addEventListener('activate', e => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)));
    await sw.clients.claim();
  })());
});

/** Fresh page from the network; stored only after all its files are stored. */
async function refreshPage(): Promise<Response> {
  const res = await fetch(PAGE, { cache: 'no-cache', credentials: 'same-origin' });
  if (!res.ok) return res;
  const html = await res.clone().text();
  const cache = await caches.open(CACHE);
  const urls = Array.from(html.matchAll(ASSET_RE), m => m[1]);
  const ok = await Promise.all(urls.map(u => put(cache, u)));
  if (ok.every(Boolean)) await cache.put(PAGE, res.clone());
  return res;
}

sw.addEventListener('fetch', e => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== sw.location.origin) return; // API calls go straight to Google
  const path = url.pathname;
  if (path.startsWith('/download/') || path.startsWith('/.well-known/') || path.endsWith('/version.json')) return;

  if (req.mode === 'navigate') {
    // the page: cached copy at once (whatever ?e=…&t=… is in the address); fresh copy saved for next time
    e.respondWith((async () => {
      const hit = await caches.match(PAGE);
      const net = refreshPage();
      if (hit) { e.waitUntil(net.catch(() => null)); return hit; }
      return net;
    })());
    return;
  }
  // files: cache first, network as fallback (then kept)
  e.respondWith((async () => {
    const hit = await caches.match(req);
    if (hit) return hit;
    const res = await fetch(req);
    if (res.ok && (/\/(assets|models|wasm|icons)\//.test(path) || url.search.startsWith('?v='))) {
      const copy = res.clone();
      e.waitUntil(caches.open(CACHE).then(c => c.put(req, copy)));
    }
    return res;
  })());
});
