const CACHE = 'tourplan-v26';
const TILES = 'tourplan-tiles', OFFLINE = 'tourplan-offline', MAX_TILES = 6000;
let puts = 0;
const trim = c => c.keys().then(ks => Promise.all(ks.slice(0, Math.max(0, ks.length - MAX_TILES)).map(k => c.delete(k))));
const SHELL = ['./', 'index.html', 'css/app.css', 'js/geo.js', 'js/optimize.js', 'js/speech.js', 'js/ai.js', 'js/app.js', 'manifest.webmanifest', 'icons/icon-192.png', 'icons/icon-512.png'];
const TILE_HOST = /(^|\.)(tile\.openstreetmap\.(de|org|fr)|arcgisonline\.com)$/;
// a./b./c.-Subdomains zeigen dieselbe Kachel → ein gemeinsamer Schlüssel
const tileKey = url => url.replace(/\/\/[abc]\.tile\.openstreetmap\.fr\//, '//a.tile.openstreetmap.fr/');

// Beim Installieren und bei jeder Anfrage beim Server nachfragen (nicht aus dem Browser-Zwischenspeicher), damit Updates sofort ankommen
self.addEventListener('install', e => { e.waitUntil(caches.open(CACHE).then(c => Promise.all(SHELL.map(u => fetch(u, { cache: 'reload' }).then(r => r.ok ? c.put(u, r) : null))))); self.skipWaiting(); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => ![CACHE, TILES, OFFLINE].includes(k)).map(k => caches.delete(k))))); self.clients.claim(); });
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  // Kartenkacheln: gespeicherte (Offline-Gebiet oder schon gesehen) zuerst, sonst laden und merken
  if (TILE_HOST.test(u.hostname)) {
    const key = tileKey(u.href);
    e.respondWith(caches.match(key).then(hit => hit || fetch(e.request).then(r => {
      if (r.ok || r.type === 'opaque') { const c = r.clone(); caches.open(TILES).then(x => { x.put(key, c); if (++puts % 200 === 0) trim(x); }); }
      return r;
    })));
    return;
  }
  // Vektorkarte (OpenFreeMap): gespeicherte Teile zuerst; Stil und Kachel-Verzeichnis zuerst live (mit Ersatz aus dem Speicher)
  if (u.hostname === 'tiles.openfreemap.org') {
    const fixed = /\/planet\/\d|\/fonts\/|\/sprites\//.test(u.pathname);
    e.respondWith((async () => {
      const find = async () => (await caches.match(e.request, { cacheName: OFFLINE, ignoreVary: true })) || (await caches.match(e.request, { cacheName: TILES, ignoreVary: true }));
      if (fixed) { const hit = await find(); if (hit) return hit; }
      try {
        const r = await fetch(e.request);
        if (r.ok) { const c = r.clone(); caches.open(fixed ? TILES : OFFLINE).then(x => { x.put(e.request, c); if (fixed && ++puts % 200 === 0) trim(x); }); }
        return r;
      } catch (err) { const hit = await find(); if (hit) return hit; throw err; }
    })());
    return;
  }
  if (u.origin !== location.origin) return;           // APIs, Fonts: immer live
  e.respondWith(fetch(e.request, { cache: 'no-cache' }).then(r => { const c = r.clone(); caches.open(CACHE).then(x => x.put(e.request, c)); return r; }).catch(() => caches.match(e.request)));
});
