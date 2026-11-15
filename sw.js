const CACHE = 'tourplan-v6';
const TILES = 'tourplan-tiles', MAX_TILES = 6000;
let puts = 0;
const trim = c => c.keys().then(ks => Promise.all(ks.slice(0, Math.max(0, ks.length - MAX_TILES)).map(k => c.delete(k))));
const SHELL = ['./', 'index.html', 'css/app.css', 'js/geo.js', 'js/optimize.js', 'js/speech.js', 'js/app.js', 'manifest.webmanifest', 'icons/icon.svg', 'icons/icon-192.png', 'icons/icon-512.png'];
self.addEventListener('install', e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL))); self.skipWaiting(); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE && k !== TILES).map(k => caches.delete(k))))); self.clients.claim(); });
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  // Kartenkacheln: einmal gesehen = gespeichert (schneller, weniger Ruckeln, unterwegs auch ohne Netz)
  if (/(^|\.)(tile\.openstreetmap\.(de|org|fr)|arcgisonline\.com)$/.test(u.hostname)) {
    e.respondWith(caches.open(TILES).then(c => c.match(e.request).then(hit => hit || fetch(e.request).then(r => {
      if (r.ok || r.type === 'opaque') { c.put(e.request, r.clone()); if (++puts % 200 === 0) trim(c); }
      return r;
    }))));
    return;
  }
  if (u.origin !== location.origin) return;           // APIs, Fonts: immer live
  e.respondWith(fetch(e.request).then(r => { const c = r.clone(); caches.open(CACHE).then(x => x.put(e.request, c)); return r; }).catch(() => caches.match(e.request)));
});
