/* Geocoding (Photon / Nominatim) und Routing (OSRM) – alles ohne API-Schlüssel. */
(function () {
  const PHOTON = 'https://photon.komoot.io';
  const NOMINATIM = 'https://nominatim.openstreetmap.org';
  const OSRM = 'https://router.project-osrm.org';
  const CACHE_KEY = 'tp.geocache.v3';
  const OVERPASS = ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter'];

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

  // Photon verträgt keine großen Schübe (antwortet dann mit 503): höchstens 3 Anfragen gleichzeitig, bei Fehler kurz warten und wiederholen
  let active = 0, photonFails = 0, photonDownUntil = 0; const waiting = [];
  const slot = () => new Promise(res => { if (active < 3) { active++; res(); } else waiting.push(res); });
  const release = () => { const n = waiting.shift(); if (n) n(); else active--; };
  async function photon(q, bias, limit = 6) {
    const u = new URL(PHOTON + '/api/');
    u.searchParams.set('q', q);
    u.searchParams.set('limit', limit);
    u.searchParams.set('lang', 'de');
    if (bias) { u.searchParams.set('lat', bias.lat); u.searchParams.set('lon', bias.lon); }
    let lastErr;
    for (let attempt = 0; attempt < 3; attempt++) {
      if (Date.now() < photonDownUntil) throw new Error('Photon pausiert');
      await slot();
      try {
        const r = await fetch(u, { signal: AbortSignal.timeout(5000) });
        if (r.ok) { photonFails = 0; return (await r.json()).features || []; }
        lastErr = new Error('Photon ' + r.status);
      } catch (e) { lastErr = e; } finally { release(); }
      // Dienst nicht erreichbar: eine Minute lang direkt den Ersatzdienst nehmen statt jede Adresse warten zu lassen
      if (++photonFails >= 4) { photonDownUntil = Date.now() + 60000; photonFails = 0; break; }
      await new Promise(r => setTimeout(r, 300 * (attempt + 1)));
    }
    throw lastErr;
  }

  // Nominatim erlaubt höchstens eine Anfrage pro Sekunde → strikt nacheinander
  let lastNominatim = 0, nomChain = Promise.resolve();
  function nominatim(q, bias) {
    const run = nomChain.then(() => nominatimNow(q, bias));
    nomChain = run.catch(() => {});
    return run;
  }
  async function nominatimNow(q, bias) {
    const wait = 1050 - (Date.now() - lastNominatim);
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
    const r = await fetch(u, { headers: { 'Accept-Language': 'de' }, signal: AbortSignal.timeout(8000) });
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
    const jobs = [photon(query, bias).catch(() => [])];
    if (!hasPlace && depot && depot.city) jobs.unshift(photon(query + ' ' + depot.city, bias).catch(() => []));
    (await Promise.all(jobs)).forEach(f => { feats = feats.concat(f); });

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
    if (!res) {
      try {
        const q2 = !hasPlace && depot && depot.city ? query + ', ' + depot.city : query;
        const n = await nominatim(q2, bias);
        if (n) res = n;
      } catch (_) {}
    }
    if (res) { cache[key] = res; saveCache(); }
    return res;
  }


  /** Bekannte Koordinaten merken (z. B. aus einem gewählten Vorschlag) → keine Suche mehr nötig. */
  function remember(query, depot, res) {
    cache[query.trim().toLowerCase() + '|' + (depot ? depot.city : '')] = res; saveCache();
  }

  /** Vorschläge während des Tippens. */
  let suggestCtl = null;
  async function suggest(q, depot) {
    if (suggestCtl) suggestCtl.abort();
    suggestCtl = new AbortController();
    const u = new URL(PHOTON + '/api/');
    u.searchParams.set('q', q); u.searchParams.set('limit', '12'); u.searchParams.set('lang', 'de');
    if (depot) { u.searchParams.set('lat', depot.lat); u.searchParams.set('lon', depot.lon); }
    if (Date.now() < photonDownUntil) return [];
    const r = await fetch(u, { signal: suggestCtl.signal });
    if (!r.ok) return [];
    const parsed = parseQuery(q), bias = depot ? { lat: depot.lat, lon: depot.lon } : null;
    const seen = new Set(), out = [];
    ((await r.json()).features || [])
      .filter(f => f.properties.countrycode === 'DE')
      .map(f => ({ f, s: score(f, parsed, bias, depot && depot.city) }))
      .sort((a, b) => b.s - a.s)
      .forEach(({ f }) => {
        const p = f.properties, l = labelFromPhoton(p);
        const street = p.street || (p.type === 'street' ? p.name : '');
        const place = [p.postcode, l.city].filter(Boolean).join(' ');
        // Zusteller brauchen die Adresse, nicht den Namen des Geschäfts: Straße + Nummer nach vorn
        const title = street ? [street, p.housenumber || parsed.housenumber].filter(Boolean).join(' ') : l.label.split(',')[0];
        const label = street ? [title, place].filter(Boolean).join(', ') : l.label;
        if (!label || seen.has(label)) return;
        seen.add(label);
        const [lon, lat] = f.geometry.coordinates;
        const hint = street && p.name && p.name !== street ? p.name : '';
        out.push({ lat, lon, label, city: l.city, postcode: l.postcode, title,
          sub: [street ? place : l.label.split(',').slice(1).join(',').trim(), hint].filter(Boolean).join(' · '),
          exact: !!p.housenumber || !parsed.housenumber,       // false = nur die Straße ist bekannt, Hausnummer wird noch gesucht
          km: bias ? haversine(bias.lat, bias.lon, lat, lon) / 1000 : null });
      });
    return out.slice(0, 5);
  }

  /* ---------- Öffnungszeiten (vereinfachtes OSM-Format) ---------- */
  const DAYS = ['su', 'mo', 'tu', 'we', 'th', 'fr', 'sa'];
  /** → { open: true|false|null, until: 'HH:MM'|null }  (null = unbekannt) */
  function openState(oh, date) {
    if (!oh) return { open: null, until: null };
    if (/^\s*24\/7\s*$/.test(oh)) return { open: true, until: null };
    const day = DAYS[date.getDay()], mins = date.getHours() * 60 + date.getMinutes();
    let todays = null, understood = false;
    for (const rule of oh.toLowerCase().split(';')) {
      const m = rule.trim().match(/^((?:(?:mo|tu|we|th|fr|sa|su|ph)(?:\s*-\s*(?:mo|tu|we|th|fr|sa|su))?\s*,?\s*)+)?\s*(.*)$/);
      if (!m) continue;
      const dayPart = (m[1] || '').trim(), timePart = m[2].trim();
      let applies = !dayPart;
      if (dayPart) {
        for (const tok of dayPart.split(',').map(x => x.trim()).filter(Boolean)) {
          const [a, b] = tok.split('-').map(x => x.trim());
          if (a === 'ph') continue;
          const ia = DAYS.indexOf(a), ib = b ? DAYS.indexOf(b) : ia, id = DAYS.indexOf(day);
          if (ia < 0 || ib < 0) continue;
          if (ia <= ib ? (id >= ia && id <= ib) : (id >= ia || id <= ib)) applies = true;
        }
      }
      const spans = [...timePart.matchAll(/(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})/g)].map(t => [+t[1] * 60 + +t[2], +t[3] * 60 + +t[4]]);
      const off = /\b(off|closed)\b/.test(timePart);
      if (spans.length || off) understood = true;
      if (applies && (spans.length || off)) todays = off ? [] : spans;
    }
    if (!understood) return { open: null, until: null };
    if (!todays) return { open: false, until: null };
    const hit = todays.find(([a, b]) => mins >= a && mins < b);
    const hhmm = v => String(Math.floor(v / 60)).padStart(2, '0') + ':' + String(v % 60).padStart(2, '0');
    if (hit) return { open: true, until: hhmm(hit[1]) };
    const next = todays.filter(([a]) => a > mins).sort((x, y) => x[0] - y[0])[0];
    return { open: false, until: null, from: next ? hhmm(next[0]) : null };
  }

  /** Packstationen und Postfilialen entlang einer Route (OpenStreetMap / Overpass). */
  async function postPoints(geometry, maxOffM = 700) {
    if (!geometry || geometry.length < 2) return [];
    let s = 90, w = 180, n = -90, e = -180;
    geometry.forEach(([la, lo]) => { s = Math.min(s, la); n = Math.max(n, la); w = Math.min(w, lo); e = Math.max(e, lo); });
    const pad = 0.012, bb = [s - pad, w - pad, n + pad, e + pad].map(v => v.toFixed(5)).join(',');
    const q = `[out:json][timeout:20];(nwr["amenity"="parcel_locker"](${bb});nwr["amenity"="post_office"](${bb}););out center tags;`;
    let els = null;
    for (const url of OVERPASS) {
      try {
        const r = await fetch(url, { method: 'POST', body: new URLSearchParams({ data: q }), signal: AbortSignal.timeout(15000) });
        if (!r.ok) continue;
        els = (await r.json()).elements; break;
      } catch (_) {}
    }
    if (!els) throw new Error('overpass');
    // Route ausdünnen, damit der Abstandstest schnell bleibt
    const step = Math.max(1, Math.floor(geometry.length / 1500));
    const line = geometry.filter((_, i) => i % step === 0);
    const out = [];
    for (const el of els) {
      const t = el.tags || {}, lat = el.lat ?? el.center?.lat, lon = el.lon ?? el.center?.lon;
      if (lat == null) continue;
      const who = [t.brand, t.operator, t.name, t.network].filter(Boolean).join(' ').toLowerCase();
      if (/hermes|dpd|gls|ups|amazon|fedex|myflexbox/.test(who) && !/dhl|deutsche post/.test(who)) continue;
      const locker = t.amenity === 'parcel_locker';
      if (locker && !/dhl|packstation|poststation|deutsche post/.test(who)) continue;
      let off = Infinity, at = 0;
      for (let i = 0; i < line.length; i++) {
        const d = haversine(lat, lon, line[i][0], line[i][1]);
        if (d < off) { off = d; at = i; }
      }
      if (off > maxOffM) continue;
      const addr = [[t['addr:street'], t['addr:housenumber']].filter(Boolean).join(' '), [t['addr:postcode'], t['addr:city']].filter(Boolean).join(' ')].filter(Boolean).join(', ');
      const partner = t.operator && !/^(dhl|deutsche post)/i.test(t.operator) ? t.operator : '';
      out.push({
        id: el.type[0] + el.id, lat, lon, kind: locker ? 'locker' : 'office',
        name: locker ? (/poststation/.test(who) ? 'Poststation' : 'Packstation') + (t.ref ? ' ' + t.ref : '') : (t.name && !/^postfiliale$/i.test(t.name) ? t.name : 'Postfiliale') + (partner ? ' · ' + partner : ''),
        addr, hours: t.opening_hours || (locker ? '24/7' : ''), off: Math.round(off), at: at / Math.max(1, line.length - 1),
      });
    }
    return out.sort((a, b) => a.at - b.at);
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
      const r = await fetch(`${OSRM}/table/v1/driving/${coordStr(points)}?annotations=duration,distance`, { signal: AbortSignal.timeout(12000) });
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
        const r = await fetch(`${OSRM}/route/v1/driving/${coordStr(part)}?overview=full&geometries=geojson&steps=false`, { signal: AbortSignal.timeout(12000) });
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

  window.Geo = { geocode, reverse, matrix, route, haversine, suggest, remember, openState, postPoints };
})();
