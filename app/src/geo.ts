// Adresssuche (Photon, Ersatz Nominatim) und Routing (OSRM) – ohne Schlüssel.
export type Pt = { lat: number; lon: number };
export type Place = Pt & { label: string; city: string; approx?: boolean };

const UA = { 'User-Agent': 'Tourplan-App/1.0' };
/** Abbruch nach ms (AbortSignal.timeout gibt es nicht überall in React Native). */
export function timeout(ms: number) { const c = new AbortController(); setTimeout(() => c.abort(), ms); return c.signal; }
const wait = (ms: number) => new Promise(r => setTimeout(r, ms));
const norm = (s: string) => s.toLowerCase().replace(/ß/g, 'ss').replace(/ä/g, 'a').replace(/ö/g, 'o').replace(/ü/g, 'u')
  .replace(/str\.?\b/g, 'strasse').replace(/[^a-z0-9]/g, '');

async function getJson(url: string, ms = 8000) {
  const r = await fetch(url, { headers: UA, signal: timeout(ms) });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return r.json();
}

export function haversine(a: Pt, b: Pt) {
  const R = 6371000, t = Math.PI / 180, dLat = (b.lat - a.lat) * t, dLon = (b.lon - a.lon) * t;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * t) * Math.cos(b.lat * t) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** Adresse → Koordinaten. Bevorzugt Treffer mit passender Straße/Hausnummer nahe am Depot. */
export async function geocode(q: string, near?: Place | null): Promise<Place | null> {
  const hn = (q.match(/\b(\d{1,4}\s?[a-z]?)\b(?!\d)/i)?.[1] || '').replace(/\s/g, '').toLowerCase();
  const street = norm(q.split(/[,\d]/)[0]);
  const query = !q.includes(',') && near?.city ? `${q}, ${near.city}` : q;
  let url = `https://photon.komoot.io/api/?limit=6&lang=de&q=${encodeURIComponent(query)}`;
  if (near) url += `&lat=${near.lat}&lon=${near.lon}`;
  let best: Place | null = null, bestS = -Infinity;
  for (let i = 0; i < 2 && !best; i++) {
    try {
      for (const f of (await getJson(url)).features || []) {
        const p = f.properties, [lon, lat] = f.geometry.coordinates;
        const st = norm(p.street || p.name || '');
        let s = p.countrycode === 'DE' ? 2 : 0;
        s += st === street ? 9 : st && (st.includes(street) || street.includes(st)) ? 4 : -7;
        const ph = (p.housenumber || '').toLowerCase().replace(/\s/g, '');
        if (hn) s += ph === hn ? 5 : ph ? 1 : 0;
        if (near) s -= Math.min(haversine(near, { lat, lon }) / 8000, 8);
        if (s > bestS && s > 0) {
          bestS = s;
          const city = p.city || p.town || p.village || p.district || '';
          best = { lat, lon, city, approx: !!hn && ph !== hn,
            label: [[p.street || p.name, p.housenumber].filter(Boolean).join(' '), [p.postcode, city].filter(Boolean).join(' ')].filter(Boolean).join(', ') };
        }
      }
    } catch { await wait(600); }
  }
  if (best) return best;
  try {
    const n = (await getJson(`https://nominatim.openstreetmap.org/search?format=jsonv2&addressdetails=1&limit=1&countrycodes=de&q=${encodeURIComponent(query)}`))[0];
    if (n) { const a = n.address || {}; return { lat: +n.lat, lon: +n.lon, label: n.display_name.split(',').slice(0, 3).join(','), city: a.city || a.town || a.village || '', approx: true }; }
  } catch {}
  return null;
}

export async function reverse(p: Pt): Promise<Place> {
  try {
    const f = (await getJson(`https://photon.komoot.io/reverse?lat=${p.lat}&lon=${p.lon}&lang=de`)).features[0].properties;
    const city = f.city || f.town || f.village || '';
    return { ...p, city, label: [[f.street || f.name, f.housenumber].filter(Boolean).join(' '), city].filter(Boolean).join(', ') };
  } catch { return { ...p, city: '', label: 'Mein Standort' }; }
}

const OSRM = 'https://router.project-osrm.org';
const coords = (pts: Pt[]) => pts.map(p => `${p.lon.toFixed(6)},${p.lat.toFixed(6)}`).join(';');
const crow = (a: Pt, b: Pt) => { const d = haversine(a, b) * 1.35; return { dur: d / (38 / 3.6), dist: d }; };

/** Fahrzeit-Tabelle (Sekunden). Bei Ausfall Luftlinie. */
export async function matrix(pts: Pt[]): Promise<{ dur: number[][]; source: string }> {
  if (pts.length <= 100) for (let i = 0; i < 3; i++) {
    try {
      const j = await getJson(`${OSRM}/table/v1/driving/${coords(pts)}?annotations=duration`, 20000);
      if (j.code === 'Ok') return { dur: j.durations.map((r: (number | null)[], a: number) => r.map((v, b) => v ?? crow(pts[a], pts[b]).dur)), source: 'osrm' };
    } catch {}
    await wait(1200 * (i + 1));
  }
  return { dur: pts.map(a => pts.map(b => crow(a, b).dur)), source: 'luftlinie' };
}

/** Fahrzeit und Strecke je Abschnitt in Reihenfolge, dazu die Linie für die Karte ([lon, lat]). */
export async function legs(pts: Pt[]): Promise<{ legs: { dur: number; dist: number }[]; line: [number, number][] }> {
  if (pts.length < 2) return { legs: [], line: [] };
  try {
    const out: { dur: number; dist: number }[] = [], line: [number, number][] = [];
    for (let s = 0; s < pts.length - 1; s += 79) {
      const j = await getJson(`${OSRM}/route/v1/driving/${coords(pts.slice(s, s + 80))}?overview=full&geometries=geojson`, 20000);
      if (j.code !== 'Ok') throw 0;
      j.routes[0].legs.forEach((l: any) => out.push({ dur: l.duration, dist: l.distance }));
      line.push(...j.routes[0].geometry.coordinates);
    }
    return { legs: out, line };
  } catch { return { legs: pts.slice(1).map((p, i) => crow(pts[i], p)), line: pts.map(p => [p.lon, p.lat]) }; }
}
