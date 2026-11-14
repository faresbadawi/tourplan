/* Geocoding (Photon / Nominatim) und Routing (OSRM) – alles ohne API-Schlüssel. */
(function () {
  const PHOTON = 'https://photon.komoot.io';
  const NOMINATIM = 'https://nominatim.openstreetmap.org';
  const OSRM = 'https://router.project-osrm.org';
  const CACHE_KEY = 'tp.geocache.v2';

  let cache = {};
  try { cache = JSON.parse(localStorage.getItem(CACHE_KEY) || '{}'); } catch (_) { cache = {}; }
  function saveCache() {
    try {
      const keys = Object.keys(cache);
      if (keys.length > 800) keys.slice(0, keys.length - 800).forEach(k => delete cache[k]);
      localStorage.setItem(CACHE_KEY, JSON.stringify(cache));
    } catch (_) {}
  }

  const norm = s => s.toLowerCase()
    .replace(/ß/g, 'ss').replace(/ä/g, 'a').replace(/ö/g, 'o').replace(/ü/g, 'u')
    .replace(/str\.?\b/g, 'strasse').replace(/[^a-z0-9]/g, '');

  function labelFromPhoton(p) {
    const street = p.street || (p.type === 'street' ? p.name : '') || p.name || '';
    const line1 = [street, p.housenumber].filter(Boolean).join(' ');
    const place = [p.postcode, p.city || p.town || p.village || p.district || p.county].filter(Boolean).join(' ');
    const extra = p.name && p.street && !norm(p.name).includes(norm(p.street)) ? p.name + ', ' : '';
    return { label: (extra + [line1, place].filter(Boolean).join(', ')).trim(), city: p.city || p.town || p.village || p.district || '', postcode: p.postcode || '' };
  }

  function parseQuery(q) {
    const hn = q.match(/\b(\d{1,4}\s?[a-zA-Z]?)\b(?!\d)/);
    const plz = q.match(/\b(\d{5})\b/);
    const streetPart = q.split(/[,\d]/)[0].trim();
    const after = q.includes(',') ? q.split(',').slice(1).join(' ').replace(/\b\d{5}\b/, '').trim() : '';
    return { city: after, housenumber: hn && !(plz && hn[1] === plz[1]) ? hn[1].replace(/\s/g, '').toLowerCase() : '', plz: plz ? plz[1] : '', street: streetPart };
  }

  function score(f, parsed, bias, homeCity) {
    const p = f.properties;
    let s = 0;
    if (p.countrycode === 'DE') s += 2;
    const st = norm(p.street || p.name || '');
    const want = norm(parsed.street);
    if (want && st === want) s += 9;
    else if (want && st && (st.includes(want) || want.includes(st))) s += 4;
    const places = [p.city, p.town, p.village, p.district, p.locality, p.county].filter(Boolean).map(norm);
    if (parsed.city) {
      const c = norm(parsed.city);
      s += places.some(x => x === c || x.includes(c) || c.includes(x)) ? 8 : -6;
    } else if (homeCity && places.includes(norm(homeCity))) s += 3;
    if (parsed.housenumber) {
      if ((p.housenumber || '').toLowerCase().replace(/\s/g, '') === parsed.housenumber) s += 5;
      else if (p.housenumber) s += 1;
    }
    if (parsed.plz && p.postcode === parsed.plz) s += 4;
    if (p.osm_key === 'place' && p.type !== 'house') s -= 3;
    if (bias) {
      const [lon, lat] = f.geometry.coordinates;
      const km = haversine(bias.lat, bias.lon, lat, lon) / 1000;
      s -= Math.min(km / 8, 8);  // nahe am Depot bevorzugen
    }
    return s;
  }

  async function photon(q, bias, limit = 6) {
    const u = new URL(PHOTON + '/api/');
    u.searchParams.set('q', q);
    u.searchParams.set('limit', limit);
    u.searchParams.set('lang', 'de');
    if (bias) { u.searchParams.set('lat', bias.lat); u.searchParams.set('lon', bias.lon); }
    const r = await fetch(u);
    if (!r.ok) throw new Error('Photon ' + r.status);
    return (await r.json()).features || [];
  }

  let lastNominatim = 0;
  async function nominatim(q, bias) {
    const wait = 1100 - (Date.now() - lastNominatim);
    if (wait > 0) await new Promise(r => setTimeout(r, wait));
    lastNominatim = Date.now();
    const u = new URL(NOMINATIM + '/search');
    u.searchParams.set('q', q);
    u.searchParams.set('format', 'jsonv2');
    u.searchParams.set('addressdetails', '1');
    u.searchParams.set('countrycodes', 'de');
    u.searchParams.set('limit', '1');
    if (bias) {
      const d = 0.35;
      u.searchParams.set('viewbox', [bias.lon - d, bias.lat + d, bias.lon + d, bias.lat - d].join(','));
    }
    const r = await fetch(u, { headers: { 'Accept-Language': 'de' } });
    if (!r.ok) throw new Error('Nominatim ' + r.status);
    const j = await r.json();
    if (!j.length) return null;
    const a = j[0].address || {};
    const city = a.city || a.town || a.village || a.municipality || '';
    const line1 = [a.road, a.house_number].filter(Boolean).join(' ');
    return {
      lat: +j[0].lat, lon: +j[0].lon,
      label: [line1, [a.postcode, city].filter(Boolean).join(' ')].filter(Boolean).join(', ') || j[0].display_name,
      city, postcode: a.postcode || '', approx: !a.house_number
    };
  }

  /** Adresse → {lat, lon, label, city, postcode, approx} oder null */
  async function geocode(query, depot) {
    const key = query.trim().toLowerCase() + '|' + (depot ? depot.city : '');
    if (cache[key]) return cache[key];
    const bias = depot ? { lat: depot.lat, lon: depot.lon } : null;
    const parsed = parseQuery(query);
    const hasPlace = /,/.test(query) || parsed.plz;

    let feats = [];
    try {
      if (!hasPlace && depot && depot.city) feats = await photon(query + ' ' + depot.city, bias);
      const more = await photon(query, bias);
      feats = feats.concat(more);
    } catch (_) { /* Fallback unten */ }

    let best = null, bestScore = -Infinity;
    for (const f of feats) {
      const s = score(f, parsed, bias, depot && depot.city);
      if (s > bestScore) { bestScore = s; best = f; }
    }

    let res = null;
    if (best && bestScore > 0) {
      const [lon, lat] = best.geometry.coordinates;
      const l = labelFromPhoton(best.properties);
      const approx = !!parsed.housenumber && (best.properties.housenumber || '').toLowerCase().replace(/\s/g, '') !== parsed.housenumber;
      res = { lat, lon, label: l.label, city: l.city, postcode: l.postcode, approx };
    }
    if (!res || res.approx) {
      try {
        const q2 = !hasPlace && depot && depot.city ? query + ', ' + depot.city : query;
        const n = await nominatim(q2, bias);
        if (n && (!res || !n.approx)) res = n;
      } catch (_) {}
    }
    if (res) { cache[key] = res; saveCache(); }
    return res;
  }

  async function reverse(lat, lon) {
    const r = await fetch(`${PHOTON}/reverse?lat=${lat}&lon=${lon}&lang=de`);
    const j = await r.json();
    const f = (j.features || [])[0];
    if (!f) return null;
    const l = labelFromPhoton(f.properties);
    return { lat, lon, label: l.label, city: l.city, postcode: l.postcode };
  }

  function haversine(lat1, lon1, lat2, lon2) {
    const R = 6371000, toR = Math.PI / 180;
    const dLat = (lat2 - lat1) * toR, dLon = (lon2 - lon1) * toR;
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * toR) * Math.cos(lat2 * toR) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(a));
  }

  const coordStr = pts => pts.map(p => `${p.lon.toFixed(6)},${p.lat.toFixed(6)}`).join(';');

  /** Fahrzeit-/Distanzmatrix. Fällt auf Luftlinie × 1,35 bei 38 km/h zurück. */
  async function matrix(points) {
    try {
      if (points.length > 100) throw new Error('zu viele Punkte');
      const r = await fetch(`${OSRM}/table/v1/driving/${coordStr(points)}?annotations=duration,distance`);
      const j = await r.json();
      if (j.code !== 'Ok') throw new Error(j.code);
      const n = points.length;
      const dur = [], dist = [];
      for (let i = 0; i < n; i++) {
        dur.push([]); dist.push([]);
        for (let k = 0; k < n; k++) {
          dur[i][k] = j.durations[i][k] ?? fallbackLeg(points[i], points[k]).dur;
          dist[i][k] = j.distances ? (j.distances[i][k] ?? fallbackLeg(points[i], points[k]).dist) : fallbackLeg(points[i], points[k]).dist;
        }
      }
      return { dur, dist, source: 'osrm' };
    } catch (e) {
      const n = points.length, dur = [], dist = [];
      for (let i = 0; i < n; i++) {
        dur.push([]); dist.push([]);
        for (let k = 0; k < n; k++) { const l = fallbackLeg(points[i], points[k]); dur[i][k] = l.dur; dist[i][k] = l.dist; }
      }
      return { dur, dist, source: 'luftlinie' };
    }
  }
  function fallbackLeg(a, b) {
    const d = haversine(a.lat, a.lon, b.lat, b.lon) * 1.35;
    return { dist: d, dur: d / (38 / 3.6) };
  }

  /** Straßengeometrie + Etappen für eine feste Reihenfolge. */
  async function route(points) {
    const legs = [], geometry = [];
    const CH = 80;
    try {
      for (let s = 0; s < points.length - 1; s += CH - 1) {
        const part = points.slice(s, s + CH);
        const r = await fetch(`${OSRM}/route/v1/driving/${coordStr(part)}?overview=full&geometries=geojson&steps=false`);
        const j = await r.json();
        if (j.code !== 'Ok') throw new Error(j.code);
        j.routes[0].legs.forEach(l => legs.push({ dur: l.duration, dist: l.distance }));
        j.routes[0].geometry.coordinates.forEach(([lon, lat]) => geometry.push([lat, lon]));
      }
      return { legs, geometry, source: 'osrm' };
    } catch (_) {
      for (let i = 0; i < points.length - 1; i++) legs.push(fallbackLeg(points[i], points[i + 1]));
      return { legs, geometry: points.map(p => [p.lat, p.lon]), source: 'luftlinie' };
    }
  }

  window.Geo = { geocode, reverse, matrix, route, haversine };
})();
