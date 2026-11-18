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
    else if (want.length > 4) s -= 7;                 // ganz andere Straße: sehr wahrscheinlich falsch
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
  function nominatim(q, bias, limit = 1) {
    const run = nomChain.then(() => nominatimNow(q, bias, limit));
    nomChain = run.catch(() => {});
    return run;
  }
  async function nominatimNow(q, bias, limit) {
    const wait = 1050 - (Date.now() - lastNominatim);
    if (wait > 0) await new Promise(r => setTimeout(r, wait));
    lastNominatim = Date.now();
    const u = new URL(NOMINATIM + '/search');
    u.searchParams.set('q', q);
    u.searchParams.set('format', 'jsonv2');
    u.searchParams.set('addressdetails', '1');
    u.searchParams.set('countrycodes', 'de');
    u.searchParams.set('limit', String(limit));
    if (bias) {
      const d = 0.35;
      u.searchParams.set('viewbox', [bias.lon - d, bias.lat + d, bias.lon + d, bias.lat - d].join(','));
    }
    const r = await fetch(u, { headers: { 'Accept-Language': 'de' }, signal: AbortSignal.timeout(8000) });
    if (!r.ok) throw new Error('Nominatim ' + r.status);
    const j = await r.json();
    const list = j.map(x => {
      const a = x.address || {};
      const city = a.city || a.town || a.village || a.municipality || a.hamlet || '';
      const line1 = [a.road, a.house_number].filter(Boolean).join(' ');
      return {
        lat: +x.lat, lon: +x.lon,
        label: [line1, [a.postcode, city].filter(Boolean).join(' ')].filter(Boolean).join(', ') || x.display_name,
        city, postcode: a.postcode || '', approx: !a.house_number
      };
    });
    return limit === 1 ? (list[0] || null) : list;
  }

  /* ---------- TomTom (optional, eigener Schlüssel) ----------
     Genauere Hausnummern; wird zuerst gefragt, wenn ein Schlüssel hinterlegt ist. */
  let ttKey = '', hereKey = '';
  const setKeys = k => { ttKey = (k && k.tomtom || '').trim(); hereKey = (k && k.here || '').trim(); };
  /* HERE (optional, eigener Schlüssel von platform.here.com) – wird vor TomTom gefragt */
  async function here(q, bias, { limit = 5, signal } = {}) {
    if (!hereKey) return [];
    const u = new URL('https://geocode.search.hereapi.com/v1/geocode');
    u.searchParams.set('q', q); u.searchParams.set('in', 'countryCode:DEU'); u.searchParams.set('lang', 'de');
    u.searchParams.set('limit', String(limit)); u.searchParams.set('apiKey', hereKey);
    if (bias) u.searchParams.set('at', bias.lat + ',' + bias.lon);
    const r = await fetch(u, { signal: signal || AbortSignal.timeout(6000) });
    if (!r.ok) throw new Error('HERE ' + r.status);
    return ((await r.json()).items || []).filter(x => x.address && x.position).map(x => {
      const a = x.address, city = a.city || a.district || '';
      const line1 = [a.street, a.houseNumber].filter(Boolean).join(' ');
      return { lat: x.position.lat, lon: x.position.lng, street: a.street || '', hn: (a.houseNumber || '').toLowerCase().replace(/\s/g, ''),
        label: [line1, [a.postalCode, city].filter(Boolean).join(' ')].filter(Boolean).join(', ') || a.label, city, postcode: a.postalCode || '',
        km: bias ? haversine(bias.lat, bias.lon, x.position.lat, x.position.lng) / 1000 : null };
    });
  }
  /** Bezahlter/genauer Dienst mit eigenem Schlüssel: HERE, sonst TomTom */
  const pro = (q, bias, opt) => hereKey ? here(q, bias, opt) : tomtom(q, bias, opt);
  async function tomtom(q, bias, { limit = 5, typeahead = false, signal } = {}) {
    if (!ttKey) return [];
    const u = new URL(`https://api.tomtom.com/search/2/${typeahead ? 'search' : 'geocode'}/${encodeURIComponent(q)}.json`);
    u.searchParams.set('key', ttKey); u.searchParams.set('countrySet', 'DE'); u.searchParams.set('language', 'de-DE');
    u.searchParams.set('limit', String(limit));
    if (typeahead) { u.searchParams.set('typeahead', 'true'); u.searchParams.set('idxSet', 'PAD,Addr,Str'); }
    if (bias) { u.searchParams.set('lat', bias.lat); u.searchParams.set('lon', bias.lon); if (typeahead) u.searchParams.set('radius', '40000'); }
    const r = await fetch(u, { signal: signal || AbortSignal.timeout(6000) });
    if (!r.ok) throw new Error('TomTom ' + r.status);
    return ((await r.json()).results || []).filter(x => x.address && x.position).map(x => {
      const a = x.address, city = a.municipalitySubdivision && a.municipality && norm(a.municipalitySubdivision) !== norm(a.municipality) ? a.municipalitySubdivision : (a.municipality || a.municipalitySubdivision || '');
      const line1 = [a.streetName, a.streetNumber].filter(Boolean).join(' ');
      return { lat: x.position.lat, lon: x.position.lon, street: a.streetName || '', hn: (a.streetNumber || '').toLowerCase().replace(/\s/g, ''),
        label: [line1, [a.postalCode, city].filter(Boolean).join(' ')].filter(Boolean).join(', ') || a.freeformAddress, city, postcode: a.postalCode || '',
        km: bias ? haversine(bias.lat, bias.lon, x.position.lat, x.position.lon) / 1000 : null };
    });
  }
  async function tomtomGeocode(query, depot) {
    const parsed = parseQuery(query), want = norm(parsed.street);
    const hasPlace = /,/.test(query) || parsed.plz;
    const q = !hasPlace && depot && depot.city ? query + ', ' + depot.city : query;
    const list = await pro(q, depot, { limit: 5 }).catch(() => []);
    const ok = list.filter(x => !want || norm(x.street) === want || norm(x.street).includes(want))
      .filter(x => x.km === null || x.km < 60)
      .sort((a, b) => ((b.hn === parsed.housenumber) - (a.hn === parsed.housenumber)) || (a.km || 0) - (b.km || 0));
    const b = ok[0];
    return b ? { lat: b.lat, lon: b.lon, label: b.label, city: b.city, postcode: b.postcode, approx: !!parsed.housenumber && b.hn !== parsed.housenumber } : null;
  }

  /** Mehrere Kandidaten für eine ausdrücklich gestartete Suche (Knopf „Prüfen“). */
  async function candidates(query, depot) {
    let list = [];
    try { list = (await suggest(query, depot)).filter(x => x.exact); } catch (_) {}
    if (!list.length) {
      try {
        const seen = new Set();
        list = (await nominatim(query, null, 5)).filter(x => !seen.has(x.label) && seen.add(x.label))
          .map(x => Object.assign(x, { title: x.label.split(',')[0], sub: x.label.split(',').slice(1).join(',').trim(), exact: true, km: null }));
      } catch (_) {}
    }
    return list;
  }

  /** Adresse → {lat, lon, label, city, postcode, approx} oder null */
  async function geocode(query, depot) {
    const key = query.trim().toLowerCase() + '|' + (depot ? depot.city : '');
    if (cache[key]) return cache[key];
    const bias = depot ? { lat: depot.lat, lon: depot.lon } : null;
    const parsed = parseQuery(query);
    const hasPlace = /,/.test(query) || parsed.plz;
    if (ttKey || hereKey) {
      const t = await tomtomGeocode(query, depot);
      if (t && !t.approx) { cache[key] = t; saveCache(); return t; }
    }

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
    if (ttKey || hereKey) {
      const parsed = parseQuery(q);
      const list = await pro(q, depot, { limit: 8, typeahead: true, signal: suggestCtl.signal }).catch(() => []);
      const seen = new Set();
      const out = list.filter(x => x.label && !seen.has(x.label) && seen.add(x.label)).slice(0, 5).map(x => Object.assign(x, {
        title: x.label.split(',')[0], sub: x.label.split(',').slice(1).join(',').trim(), exact: !!x.hn || !parsed.housenumber }));
      if (out.length) return out;
    }
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


  /* ---------- Straßenverzeichnis des Zustellgebiets ----------
     Einmal aus OpenStreetMap geladen und auf dem Gerät gespeichert. Liefert Vorschläge sofort
     und ohne Netz und erkennt Verhörer/Tippfehler („Ortsfelder“ → „Ortfelder“). */
  const STREETS_KEY = 'tp.streets.v1', STREET_RADIUS = 12000;
  let streets = null;
  try { streets = JSON.parse(localStorage.getItem(STREETS_KEY) || 'null'); } catch (_) {}
  if (streets) streets.list.forEach(x => { x.k = norm(x.n); });

  const streetCount = () => streets ? { streets: streets.list.length, places: new Set(streets.list.map(x => x.p)).size, ts: streets.ts } : null;

  /* Große Overpass-Abfrage: Hauptserver (bei „zu viele Anfragen“ kurz warten und nochmal), dann Ersatzserver */
  async function overpassText(q, valid) {
    const get = async (url, signal) => {
      const r = await fetch(url, { method: 'POST', body: new URLSearchParams({ data: q }), signal });
      if (!r.ok) throw new Error(url + ' ' + r.status);
      const t = await r.text();
      if (!valid(t)) throw new Error('leer');
      return t;
    };
    // Hauptserver zuerst; antwortet er nach 10 Sekunden nicht, fragen wir zusätzlich die Ersatzserver.
    // Die erste gültige Antwort gewinnt – so wartet man nicht minutenlang auf einen überlasteten Server.
    const MAIN = 'https://overpass-api.de/api/interpreter';
    const mirrors = ['https://overpass.private.coffee/api/interpreter', 'https://overpass.kumi.systems/api/interpreter', 'https://maps.mail.ru/osm/tools/overpass/api/interpreter'];
    const ctl = new AbortController(), stop = setTimeout(() => ctl.abort(), 120000);
    const later = (ms, url) => new Promise((res, rej) => {
      const t = setTimeout(() => get(url, ctl.signal).then(res, rej), ms);
      ctl.signal.addEventListener('abort', () => { clearTimeout(t); rej(new Error('abbruch')); });
    });
    try { return await Promise.any([get(MAIN, ctl.signal), later(10000, mirrors[0]), later(10000, mirrors[1]), later(25000, mirrors[2])]); }
    catch (_) { return null; }
    finally { clearTimeout(stop); ctl.abort(); }
  }
  async function loadStreets(depot, force, radius = STREET_RADIUS) {
    if (!depot) return null;
    if (!force && streets && haversine(depot.lat, depot.lon, streets.lat, streets.lon) < 1500 && (streets.r || STREET_RADIUS) === radius && Date.now() - streets.ts < 30 * 864e5) return streetCount();
    const la = depot.lat.toFixed(5), lo = depot.lon.toFixed(5);
    const q = `[out:csv(::type,name,::lat,::lon;false;"|")][timeout:90];(way["highway"]["name"](around:${radius},${la},${lo});node["place"~"^(city|town|village|hamlet|suburb)$"](around:${radius + 3000},${la},${lo}););out center qt;`;
    const text = await overpassText(q, t => /^(way|node)\|/m.test(t));
    if (!text) throw new Error('Straßenverzeichnis nicht erreichbar');
    const places = [], ways = [];
    text.split('\n').forEach(line => {
      const [type, name, lat, lon] = line.split('|');
      if (!name || !lat) return;
      (type === 'node' ? places : ways).push({ n: name.trim(), lat: +lat, lon: +lon });
    });
    const byKey = new Map();
    for (const w of ways) {
      let p = '', bd = Infinity;
      for (const pl of places) { const d = haversine(w.lat, w.lon, pl.lat, pl.lon); if (d < bd) { bd = d; p = pl.n; } }
      const key = norm(w.n) + '|' + p;
      const e = byKey.get(key);
      if (e) { e.lat += w.lat; e.lon += w.lon; e.c++; } else byKey.set(key, { n: w.n, p, lat: w.lat, lon: w.lon, c: 1 });
    }
    const list = [...byKey.values()].map(e => ({ n: e.n, p: e.p, lat: +(e.lat / e.c).toFixed(5), lon: +(e.lon / e.c).toFixed(5) }));
    streets = { lat: depot.lat, lon: depot.lon, r: radius, ts: Date.now(), list };
    try { localStorage.setItem(STREETS_KEY, JSON.stringify(streets)); } catch (_) {}
    streets.list.forEach(x => { x.k = norm(x.n); });
    return streetCount();
  }

  // Editierdistanz mit Abbruch, sobald sie größer als max wird
  function lev(a, b, max) {
    if (Math.abs(a.length - b.length) > max) return max + 1;
    let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
    for (let i = 1; i <= a.length; i++) {
      const cur = [i]; let rowMin = i;
      for (let j = 1; j <= b.length; j++) {
        cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
        if (cur[j] < rowMin) rowMin = cur[j];
      }
      if (rowMin > max) return max + 1;
      prev = cur;
    }
    return prev[b.length];
  }
  /* Zustellgebiet: die Orte, in denen zugestellt wird. Straßen dort haben Vorrang, alles andere gilt als „außerhalb“. */
  let area = new Set();
  const setArea = names => { area = new Set((names || []).map(norm)); };
  const inArea = x => !area.size || area.has(norm(x.p));
  const nearest = (lat, lon) => { let b = null, bd = Infinity; for (const x of streets ? streets.list : []) { const d = haversine(lat, lon, x.lat, x.lon); if (d < bd) { bd = d; b = x; } } return b; };
  /** Ort, in dem ein Punkt liegt (Ort der nächstgelegenen Straße). */
  const placeAt = (lat, lon) => { const x = nearest(lat, lon); return x ? x.p : ''; };
  const isOutside = (lat, lon) => { const p = placeAt(lat, lon); return !!p && area.size > 0 && !area.has(norm(p)); };
  /** Alle Orte des Verzeichnisses, die nächsten am Depot zuerst. */
  function places(depot) {
    const m = new Map();
    for (const x of streets ? streets.list : []) {
      const km = depot ? haversine(depot.lat, depot.lon, x.lat, x.lon) / 1000 : 0, e = m.get(x.p);
      if (e) { e.count++; e.km = Math.min(e.km, km); } else if (x.p) m.set(x.p, { name: x.p, count: 1, km });
    }
    return [...m.values()].sort((a, b) => a.km - b.km);
  }

  const withNumber = (x, hn) => [[x.n, hn].filter(Boolean).join(' '), x.p].filter(Boolean).join(', ');
  const placeHit = (x, city) => { const c = norm(city); return !!c && (norm(x.p) === c || norm(x.p).includes(c) || c.includes(norm(x.p))); };

  /** Vorschläge aus dem Verzeichnis: Anfang passt, enthält, oder fast gleich geschrieben. */
  function streetSuggest(text, depot, limit = 6) {
    if (!streets) return [];
    const parsed = parseQuery(text), want = norm(parsed.street);
    if (want.length < 2) return [];
    const out = [];
    for (const x of streets.list) {
      let rank = -1;
      if (x.k.startsWith(want)) rank = 0;
      else if (want.length >= 4 && x.k.includes(want)) rank = 1;
      else if (want.length >= 5) {
        const d = Math.min(lev(want, x.k.slice(0, want.length), 1), lev(want, x.k.slice(0, want.length - 1), 1), lev(want, x.k.slice(0, want.length + 1), 1));
        if (d <= 1) rank = 2;
      }
      if (rank < 0) continue;
      if (parsed.city && placeHit(x, parsed.city)) rank -= 0.5;
      if (!inArea(x)) rank += 0.6;
      const km = depot ? haversine(depot.lat, depot.lon, x.lat, x.lon) / 1000 : 0;
      out.push({ rank, km, x });
    }
    out.sort((a, b) => a.rank - b.rank || a.km - b.km);
    return out.slice(0, limit).map(({ x, km, rank }) => ({
      street: x.n, place: x.p, lat: x.lat, lon: x.lon, title: [x.n, parsed.housenumber].filter(Boolean).join(' '),
      sub: x.p + (inArea(x) ? '' : ' · außerhalb') + (Math.round(rank) >= 2 ? ' · ähnlich geschrieben' : ''), label: withNumber(x, parsed.housenumber),
      exact: false, local: true, hasNumber: !!parsed.housenumber, km,
    }));
  }

  /** Straße genau im Verzeichnis? → Eintrag (bei mehreren Orten: genannter Ort, sonst der nächste am Depot). */
  function streetLookup(query, depot) {
    if (!streets) return null;
    const parsed = parseQuery(query), want = norm(parsed.street);
    const hits = streets.list.filter(x => x.k === want);
    if (!hits.length) return null;
    const inPlace = parsed.city ? hits.filter(x => placeHit(x, parsed.city)) : [];
    if (parsed.city && !inPlace.length) return null;            // Ort genannt, aber dort nicht im Verzeichnis
    const home = hits.filter(inArea);
    const pool = inPlace.length ? inPlace : home.length ? home : hits;
    const best = pool.slice().sort((a, b) => haversine(depot.lat, depot.lon, a.lat, a.lon) - haversine(depot.lat, depot.lon, b.lat, b.lon))[0];
    return { n: best.n, p: best.p, lat: best.lat, lon: best.lon, sure: inPlace.length > 0 || hits.length === 1 || (area.size > 0 && home.length === 1), outside: !inArea(best), label: withNumber(best, parsed.housenumber) };
  }

  /** Straße unbekannt? → ähnlich geschriebene Straßen als Korrekturvorschlag (fertige Adresszeilen). */
  function streetFix(query, depot) {
    if (!streets) return [];
    const parsed = parseQuery(query), want = norm(parsed.street);
    if (want.length < 5 || streets.list.some(x => x.k === want)) return [];
    const max = want.length >= 12 ? 3 : 2, out = [];
    for (const x of streets.list) {
      const d = lev(want, x.k, max);
      if (d <= max) out.push({ d: d - (parsed.city && placeHit(x, parsed.city) ? 0.5 : 0) - (inArea(x) ? 0.25 : 0), km: haversine(depot.lat, depot.lon, x.lat, x.lon) / 1000, x });
    }
    out.sort((a, b) => a.d - b.d || a.km - b.km);
    const seen = new Set();
    return out.map(o => withNumber(o.x, parsed.housenumber)).filter(l => !seen.has(l) && seen.add(l)).slice(0, 3);
  }
  /* Kölner Phonetik: gleich klingende Wörter bekommen denselben Code („Ortsfelder“ ≈ „Ortfelder“, „Mayer“ ≈ „Meier“) */
  function koeln(w) {
    w = w.toLowerCase().replace(/ä/g, 'a').replace(/ö/g, 'o').replace(/ü/g, 'u').replace(/ß/g, 's').replace(/[^a-z]/g, '');
    let out = '';
    for (let i = 0; i < w.length; i++) {
      const c = w[i], p = w[i - 1] || '', n = w[i + 1] || '';
      let d;
      if ('aeijouy'.includes(c)) d = '0';
      else if (c === 'h') d = '';
      else if (c === 'b') d = '1';
      else if (c === 'p') d = n === 'h' ? '3' : '1';
      else if (c === 'd' || c === 't') d = 'csz'.includes(n) ? '8' : '2';
      else if ('fvw'.includes(c)) d = '3';
      else if ('gkq'.includes(c)) d = '4';
      else if (c === 'c') d = i === 0 ? ('ahkloqrux'.includes(n) ? '4' : '8') : ('sz'.includes(p) || !'ahkoqux'.includes(n) ? '8' : '4');
      else if (c === 'x') d = 'ckq'.includes(p) ? '8' : '48';
      else if (c === 'l') d = '5';
      else if (c === 'm' || c === 'n') d = '6';
      else if (c === 'r') d = '7';
      else if (c === 's' || c === 'z') d = '8';
      else d = '';
      out += d;
    }
    out = out.replace(/(.)\1+/g, '$1');
    return out[0] + out.slice(1).replace(/0/g, '');
  }
  // Straßen-Suffixe gesprochen oft anders („straße“/„str“/„weg“) – für den Klangvergleich nur der Namensteil
  const SUFFIX = /(strasse|weg|allee|platz|ring|gasse|damm|chaussee|pfad|stieg|steig|hof|feld|berg|kamp|winkel|graben|ufer|markt|wall|siedlung)$/;
  const stem = k => k.replace(SUFFIX, '') || k;
  function phon(x) { if (!x.ph) { x.ph = koeln(x.k); x.ps = koeln(stem(x.k)); } return x; }

  /** Ähnlichste Straßen zu einer (vielleicht falsch erkannten) Eingabe – nach Schreibweise und Klang, eigenes Gebiet zuerst. */
  function similarStreets(text, depot, limit = 6) {
    if (!streets) return [];
    const parsed = parseQuery(text), want = norm(parsed.street);
    if (want.length < 3) return [];
    const wph = koeln(want), wps = koeln(stem(want)), max = Math.max(3, Math.round(want.length * .45));
    const seen = new Map();
    for (const x of streets.list) {
      phon(x);
      const d = lev(want, x.k, max);
      let sc = d <= max ? d / Math.max(want.length, x.k.length) * 10 : 99;
      if (x.ph === wph) sc = Math.min(sc, 1.2);
      else if (x.ps === wps && wps.length >= 2) sc = Math.min(sc, 2.2);
      else { const pd = lev(wph, x.ph, 2); if (pd <= 1) sc = Math.min(sc, 2.8 + pd); }
      if (x.k.startsWith(want.slice(0, 4))) sc -= .6;
      if (sc > 6) continue;
      if (!inArea(x)) sc += 1.5;
      if (parsed.city && placeHit(x, parsed.city)) sc -= 1;
      const km = depot ? haversine(depot.lat, depot.lon, x.lat, x.lon) / 1000 : 0;
      sc += km / 40;
      const key = x.k + '|' + x.p, prev = seen.get(key);
      if (!prev || prev.sc > sc) seen.set(key, { sc, x, km });
    }
    return [...seen.values()].sort((a, b) => a.sc - b.sc).slice(0, limit).map(({ x, km }) => ({
      street: x.n, place: x.p, line: withNumber(x, parsed.housenumber), outside: !inArea(x), km, exact: x.k === want }));
  }

  /** Alle Orte, in denen es genau diese Straße gibt – eigenes Gebiet zuerst, dann nach Entfernung. */
  function streetPlaces(query, depot) {
    if (!streets) return [];
    const want = norm(parseQuery(query).street), m = new Map();
    for (const x of streets.list) if (x.k === want && x.p && !m.has(x.p)) m.set(x.p, x);
    return [...m.values()].sort((a, b) => (inArea(b) - inArea(a)) || (depot ? haversine(depot.lat, depot.lon, a.lat, a.lon) - haversine(depot.lat, depot.lon, b.lat, b.lon) : 0))
      .map(x => ({ place: x.p, inArea: inArea(x), km: depot ? haversine(depot.lat, depot.lon, x.lat, x.lon) / 1000 : 0 }));
  }
  /** Orte (mit Straßenzahl) innerhalb eines Kreises – für die Gebietswahl auf der Karte */
  function placesInCircle(lat, lon, rM) {
    const m = new Map();
    for (const x of streets ? streets.list : []) {
      if (!x.p || haversine(lat, lon, x.lat, x.lon) > rM) continue;
      const e = m.get(x.p); if (e) e.count++; else m.set(x.p, { name: x.p, count: 1, km: haversine(lat, lon, x.lat, x.lon) / 1000 });
    }
    return [...m.values()].sort((a, b) => b.count - a.count);
  }
  const streetsCover = (lat, lon, rM) => !!streets && haversine(lat, lon, streets.lat, streets.lon) + rM <= (streets.r || STREET_RADIUS) + 300;

  /** Verhörer, der sich eindeutig auflösen lässt (genau eine fast gleich geschriebene Straße im Zustellgebiet) → korrigierte Zeile. */
  function streetAuto(query) {
    if (!streets || !area.size) return null;
    const parsed = parseQuery(query), want = norm(parsed.street);
    if (parsed.city || want.length < 6 || streets.list.some(x => x.k === want)) return null;
    const max = want.length >= 11 ? 2 : 1;
    let best = [], bd = max + 1;
    for (const x of streets.list) {
      if (!inArea(x)) continue;
      const d = lev(want, x.k, max);
      if (d < bd) { bd = d; best = [x]; } else if (d === bd && d <= max && !best.some(b => b.k === x.k)) best.push(x);
    }
    if (bd <= max && best.length === 1) return withNumber(best[0], parsed.housenumber);
    // sonst: genau eine gleich klingende Straße im Gebiet
    const wph = koeln(want);
    const same = streets.list.filter(x => inArea(x) && phon(x).ph === wph && lev(want, x.k, 4) <= 4);
    const names = new Set(same.map(x => x.k));
    return names.size === 1 ? withNumber(same[0], parsed.housenumber) : null;
  }
  /* ---------- Hausnummern des Gebiets (offline) ----------
     Alle Adressen mit Hausnummer aus OpenStreetMap, auf dem Gerät gespeichert → exakte Treffer ohne Netz. */
  const ADDR_KEY = 'tp.addr.v1';
  let addr = null;
  try { addr = JSON.parse(localStorage.getItem(ADDR_KEY) || 'null'); } catch (_) {}
  const addrCount = () => addr ? { n: addr.n, ts: addr.ts } : null;
  async function loadAddresses(depot, force, radius = STREET_RADIUS) {
    if (!depot) return null;
    if (!force && addr && haversine(depot.lat, depot.lon, addr.lat, addr.lon) < 1500 && (addr.r || STREET_RADIUS) === radius && Date.now() - addr.ts < 30 * 864e5) return addrCount();
    const la = depot.lat.toFixed(5), lo = depot.lon.toFixed(5);
    const q = `[out:csv("addr:street","addr:housenumber",::lat,::lon,"addr:city","addr:postcode";false;"|")][timeout:90];nwr["addr:housenumber"]["addr:street"](around:${radius},${la},${lo});out center qt;`;
    const text = await overpassText(q, t => /\|\d/.test(t));
    if (!text) throw new Error('Adressen nicht erreichbar');
    const cities = [], ci = new Map(), map = {};
    let n = 0;
    text.split('\n').forEach(line => {
      const [st, hn, lat, lon, city, pc] = line.split('|');
      if (!st || !hn || !lat) return;
      const c = (pc ? pc + ' ' : '') + (city || '');
      if (!ci.has(c)) { ci.set(c, cities.length); cities.push(c); }
      const k = norm(st);
      (map[k] = map[k] || { n: st, a: [] }).a.push([hn.toLowerCase().replace(/\s/g, ''), +(+lat).toFixed(5), +(+lon).toFixed(5), ci.get(c)]);
      n++;
    });
    addr = { lat: depot.lat, lon: depot.lon, r: radius, ts: Date.now(), n, cities, map };
    try { localStorage.setItem(ADDR_KEY, JSON.stringify(addr)); } catch (_) { try { localStorage.removeItem(ADDR_KEY); } catch (__) {} }
    return addrCount();
  }
  /** „Lindenweg 3, Hankensbüttel“ → exakter Punkt aus dem Offline-Verzeichnis oder null */
  function addrLookup(query, depot) {
    if (!addr) return null;
    const parsed = parseQuery(query), e = addr.map[norm(parsed.street)];
    if (!e || !parsed.housenumber) return null;
    let hits = e.a.filter(a => a[0] === parsed.housenumber);
    if (!hits.length) return null;
    const placeOf = a => { const c = addr.cities[a[3]] || ''; return c.replace(/^\d{5}\s*/, '') || placeAt(a[1], a[2]); };
    if (parsed.city) {
      const c = norm(parsed.city), m = hits.filter(a => { const p = norm(placeOf(a)), sp = norm(placeAt(a[1], a[2])); return p.includes(c) || c.includes(p) || sp === c; });
      if (!m.length) return null;
      hits = m;
    } else if (area.size) {
      const inside = hits.filter(a => !isOutside(a[1], a[2]));
      if (inside.length) hits = inside;
    }
    const best = hits.slice().sort((a, b) => haversine(depot.lat, depot.lon, a[1], a[2]) - haversine(depot.lat, depot.lon, b[1], b[2]))[0];
    const pc = (addr.cities[best[3]] || '').match(/^\d{5}/);
    const place = placeAt(best[1], best[2]) || placeOf(best);
    return { lat: best[1], lon: best[2], label: `${e.n} ${parsed.housenumber}, ${pc ? pc[0] + ' ' : ''}${place}`, approx: false, city: place, postcode: pc ? pc[0] : '' };
  }

  /** Orte, in denen es diese Straße MIT dieser Hausnummer gibt (aus dem Offline-Verzeichnis) */
  function addrPlaces(query) {
    if (!addr) return null;
    const parsed = parseQuery(query), e = addr.map[norm(parsed.street)];
    if (!e || !parsed.housenumber) return null;
    return [...new Set(e.a.filter(a => a[0] === parsed.housenumber).map(a => placeAt(a[1], a[2])).filter(Boolean))];
  }
  const hasPlaceIn = q => /,/.test(q) || /\b\d{5}\b/.test(q);

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
  /** Fahrzeit-Tabelle. Bis 100 Punkte in einer Anfrage; bis 200 in Blöcken (je 50 × 50); darüber Luftlinie. */
  async function matrix(points) {
    const n = points.length;
    const dur = Array.from({ length: n }, () => new Array(n).fill(null)), dist = Array.from({ length: n }, () => new Array(n).fill(null));
    const table = async idx => {                       // volle Tabelle für eine Teilmenge der Punkte
      for (let attempt = 0; ; attempt++) {              // bis zu 3 Versuche – der kostenlose Dienst ist manchmal kurz überlastet, Luftlinie würde die Reihenfolge verändern
        try { return await tableOnce(idx); } catch (e) { if (attempt >= 2) throw e; await new Promise(r => setTimeout(r, 1200 * (attempt + 1))); }
      }
    };
    const tableOnce = async idx => {
      const r = await fetch(`${OSRM}/table/v1/driving/${coordStr(idx.map(i => points[i]))}?annotations=duration,distance`, { signal: AbortSignal.timeout(15000) });
      const j = await r.json();
      if (j.code !== 'Ok') throw new Error(j.code);
      idx.forEach((gi, a) => idx.forEach((gk, c) => {
        if (j.durations[a][c] != null) dur[gi][gk] = j.durations[a][c];
        if (j.distances && j.distances[a][c] != null) dist[gi][gk] = j.distances[a][c];
      }));
    };
    let source = 'osrm';
    try {
      if (n > 200) throw new Error('zu viele Punkte');
      if (n <= 100) await table(points.map((_, i) => i));
      else {
        const chunks = []; for (let i = 0; i < n; i += 50) chunks.push(Array.from({ length: Math.min(50, n - i) }, (_, k) => i + k));
        for (let a = 0; a < chunks.length; a++) for (let c = a + 1; c < chunks.length; c++) await table(chunks[a].concat(chunks[c]));
        if (chunks.length === 1) await table(chunks[0]);
      }
    } catch (e) { source = 'luftlinie'; }
    for (let i = 0; i < n; i++) for (let k = 0; k < n; k++) {
      if (dur[i][k] == null || dist[i][k] == null) { const l = fallbackLeg(points[i], points[k]); if (dur[i][k] == null) dur[i][k] = l.dur; if (dist[i][k] == null) dist[i][k] = l.dist; }
    }
    return { dur, dist, source };
  }
  async function route(points) {
    const legs = [], geometry = [];
    const CH = 80;
    try {
      for (let s = 0; s < points.length - 1; s += CH - 1) {
        const part = points.slice(s, s + CH);
        let j = null;
        for (let attempt = 0; attempt < 3 && !j; attempt++) {
          try {
            const r = await fetch(`${OSRM}/route/v1/driving/${coordStr(part)}?overview=full&geometries=geojson&steps=false`, { signal: AbortSignal.timeout(15000) });
            const jj = await r.json(); if (jj.code === 'Ok') j = jj;
          } catch (_) {}
          if (!j && attempt < 2) await new Promise(r => setTimeout(r, 1200 * (attempt + 1)));
        }
        if (!j) throw new Error('route');
        j.routes[0].legs.forEach(l => legs.push({ dur: l.duration, dist: l.distance }));
        j.routes[0].geometry.coordinates.forEach(([lon, lat]) => geometry.push([lat, lon]));
      }
      return { legs, geometry, source: 'osrm' };
    } catch (_) {
      for (let i = 0; i < points.length - 1; i++) legs.push(fallbackLeg(points[i], points[i + 1]));
      return { legs, geometry: points.map(p => [p.lat, p.lon]), source: 'luftlinie' };
    }
  }

  window.Geo = { setKeys, hereTest: k => { const o = hereKey; hereKey = k; return here('Berlin', null, { limit: 1 }).finally(() => { hereKey = o; }); }, tomtomTest: k => { const o = ttKey; ttKey = k; return tomtom('Berlin', null, { limit: 1 }).finally(() => { ttKey = o; }); }, geocode, reverse, matrix, route, haversine, suggest, remember, openState, postPoints, candidates, loadStreets, streetCount, streetSuggest, streetLookup, streetFix, streetNames: () => streets ? streets.list.map(x => ({ n: x.n, p: x.p, a: inArea(x) })).sort((a, b) => b.a - a.a) : [], streetAuto, similarStreets, streetPlaces, placesInCircle, streetsCover, loadAddresses, addrCount, addrLookup, addrPlaces, koeln, setArea, places, placeAt, isOutside, hasPlaceIn, parseQuery, norm };
})();
