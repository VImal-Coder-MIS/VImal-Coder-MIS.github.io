/* AAP Attendance service worker v14.0.0
 * App files are served from the phone's cache → the app opens instantly (no waiting for the network).
 * They are refreshed in the background; a new version is announced by the "Update available" pop-up. */
const CACHE = 'aap-attendance-14.0.0';
const SHELL = ['./', './styles.css?v=14.0.0', './app.js?v=14.0.0', './config.js?v=14.0.0',
  './manifest.webmanifest', './icons/icon-192.png', './icons/icon-512.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE)
    .then(c => Promise.all(SHELL.map(u => fetch(u, { cache: 'no-cache' }).then(r => r.ok ? c.put(u, r) : null).catch(() => null))))
    .then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

function refresh(cacheKey, url) {
  return fetch(url, { cache: 'no-cache', credentials: 'same-origin' }).then(res => {
    if (res.ok) caches.open(CACHE).then(c => c.put(cacheKey, res.clone()));
    return res;
  });
}

self.addEventListener('fetch', e => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin) return;
  if (url.pathname.indexOf('/download/') === 0 || url.pathname.indexOf('/.well-known/') === 0 || url.pathname.endsWith('/version.json')) return;

  if (req.mode === 'navigate') {
    // the page itself: cached copy instantly (whatever ?e=…&t=… is in the address), fresh copy saved for next time
    e.respondWith(caches.match('./').then(hit => {
      const net = refresh('./', url.origin + url.pathname);
      if (hit) { e.waitUntil(net.catch(() => null)); return hit; }
      return net;
    }));
    return;
  }
  // styles / script / icons: versioned file names → cache first
  e.respondWith(caches.match(req).then(hit => hit || refresh(req, req.url)));
});
