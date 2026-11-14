/* Tourplan – App-Logik */
(function () {
  const $ = s => document.querySelector(s);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const uid = () => Math.random().toString(36).slice(2, 10);

  /* ---------- Zustand ---------- */
  const DEFAULTS = { name: '', depot: null, nav: 'waze', theme: 'auto', roundtrip: true, smart: true, stopMin: 2 };
  const load = (k, d) => { try { const v = JSON.parse(localStorage.getItem(k)); return v ?? d; } catch (_) { return d; } };
  const save = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (_) {} };

  let settings = Object.assign({}, DEFAULTS, load('tp.settings', {}));
  let stops = load('tp.stops', []);
  let route = load('tp.route', null);
  const persist = () => { save('tp.settings', settings); save('tp.stops', stops); save('tp.route', route); };

  /* ---------- Navi-Apps ---------- */
  const NAV = {
    waze:   { name: 'Waze', color: '#33CCFF', ink: '#0B2C3A', icon: '<svg viewBox="0 0 24 24"><path d="M5 15.5a7.5 7.5 0 1 1 14.6-2.4c0 2.7-1.8 4.6-4.6 5.3"/><circle cx="9.5" cy="10.5" r=".6" fill="currentColor"/><circle cx="14.5" cy="10.5" r=".6" fill="currentColor"/><path d="M9.5 13.5c1.3 1.2 3.7 1.2 5 0"/><circle cx="8" cy="19" r="1.6"/><circle cx="15" cy="19" r="1.6"/></svg>' },
    google: { name: 'Google Maps', color: '#1A73E8', ink: '#fff', icon: '<svg viewBox="0 0 24 24"><path d="M12 21s-6.5-6-6.5-11a6.5 6.5 0 0 1 13 0c0 5-6.5 11-6.5 11z"/><circle cx="12" cy="10" r="2.4"/></svg>' },
    apple:  { name: 'Apple Karten', color: '#34C759', ink: '#fff', icon: '<svg viewBox="0 0 24 24"><path d="M4 7l5-2 6 2 5-2v12l-5 2-6-2-5 2z"/><path d="M9 5v12M15 7v12"/></svg>' },
  };
  const ll = p => `${p.lat.toFixed(6)},${p.lon.toFixed(6)}`;
  function navUrl(p, app = settings.nav) {
    if (app === 'waze') return `https://waze.com/ul?ll=${ll(p)}&navigate=yes`;
    if (app === 'apple') return `https://maps.apple.com/?daddr=${ll(p)}&dirflg=d`;
    return `https://www.google.com/maps/dir/?api=1&destination=${ll(p)}&travelmode=driving`;
  }
  function googleMultiUrl(origin, pts, dest) {
    const u = new URL('https://www.google.com/maps/dir/');
    u.searchParams.set('api', '1');
    u.searchParams.set('origin', ll(origin));
    u.searchParams.set('destination', ll(dest));
    if (pts.length) u.searchParams.set('waypoints', pts.map(ll).join('|'));
    u.searchParams.set('travelmode', 'driving');
    return u.toString();
  }

  /* ---------- Theme ---------- */
  const mqDark = matchMedia('(prefers-color-scheme: dark)');
  const isDark = () => settings.theme === 'dark' || (settings.theme === 'auto' && mqDark.matches);
  function applyTheme() {
    const root = document.documentElement;
    if (settings.theme === 'auto') root.removeAttribute('data-theme'); else root.dataset.theme = settings.theme;
    document.querySelectorAll('meta[name="theme-color"]').forEach(m => m.setAttribute('content', isDark() ? '#17181A' : '#F6F5F1'));
    Map_.setTiles();
  }
  mqDark.addEventListener('change', applyTheme);

  /* ---------- Toast ---------- */
  let toastT;
  function toast(msg, ms = 2600) {
    const t = $('#toast'); t.textContent = msg; t.classList.add('show');
    clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('show'), ms);
  }

  /* ---------- Formatierung ---------- */
  const fmtKm = m => (m / 1000).toLocaleString('de-DE', { maximumFractionDigits: m < 10000 ? 1 : 0 }) + ' km';
  const fmtDur = s => { const m = Math.round(s / 60); return m < 60 ? `${m} Min` : `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')} h`; };
  const fmtTime = d => d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });

  /* ---------- Segmented / Choice UI ---------- */
  function renderNavChoices(el, compact) {
    el.innerHTML = Object.entries(NAV).map(([k, v]) =>
      `<button class="choice" data-nav="${k}" aria-pressed="${settings.nav === k}">
         <span class="logo" style="background:${v.color};color:${v.ink}">${v.icon}</span>${compact ? v.name.replace(' Maps', '').replace(' Karten', '') : v.name}
       </button>`).join('');
    el.onclick = e => {
      const b = e.target.closest('[data-nav]'); if (!b) return;
      el.dataset.value = b.dataset.nav;
      el.querySelectorAll('[data-nav]').forEach(x => x.setAttribute('aria-pressed', x === b));
    };
    el.dataset.value = settings.nav;
  }
  function renderThemeChoices(el) {
    const opts = { auto: 'Automatisch', light: 'Hell', dark: 'Dunkel' };
    el.innerHTML = Object.entries(opts).map(([k, v]) => `<button data-theme-opt="${k}" aria-pressed="${settings.theme === k}">${v}</button>`).join('');
    el.onclick = e => {
      const b = e.target.closest('[data-theme-opt]'); if (!b) return;
      el.querySelectorAll('button').forEach(x => x.setAttribute('aria-pressed', x === b));
      settings.theme = b.dataset.themeOpt; applyTheme(); persist();
    };
  }

  /* ---------- Depot-Prüfung (Onboarding + Einstellungen) ---------- */
  async function checkDepot(query, resultEl) {
    resultEl.hidden = false; resultEl.className = 'geo-result'; resultEl.textContent = 'Suche …';
    const r = await Geo.geocode(query, null);
    if (!r) {
      resultEl.className = 'geo-result err';
      resultEl.innerHTML = '<span>Adresse nicht gefunden. Bitte mit PLZ und Ort angeben.</span>';
      return null;
    }
    resultEl.className = 'geo-result ok';
    resultEl.innerHTML = `<svg viewBox="0 0 24 24" style="color:var(--ok)"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg><span><b>${esc(r.label)}</b>${r.approx ? 'Hausnummer ungefähr' : 'Gefunden'}</span>`;
    return r;
  }

  /* ---------- Onboarding ---------- */
  function startOnboarding() {
    $('#onboarding').hidden = false; $('#app').hidden = true;
    let step = 0, foundDepot = settings.depot;
    const steps = [...document.querySelectorAll('.ob-step')];
    const show = i => {
      step = i;
      steps.forEach((s, k) => s.hidden = k !== i);
      document.querySelectorAll('.ob-progress span').forEach((s, k) => s.classList.toggle('on', k <= i));
      const f = steps[i].querySelector('input'); if (f && matchMedia('(pointer:fine)').matches) f.focus();
    };
    $('#ob-name').value = settings.name;
    $('#ob-depot-name').value = settings.depot?.name || '';
    $('#ob-depot-addr').value = settings.depot?.query || '';
    renderNavChoices($('#ob-nav'));
    renderThemeChoices($('#ob-theme'));

    document.querySelectorAll('[data-next]').forEach(b => b.onclick = () => { settings.name = $('#ob-name').value.trim(); show(step + 1); });
    document.querySelectorAll('[data-back]').forEach(b => b.onclick = () => show(step - 1));
    $('#ob-name').onkeydown = e => { if (e.key === 'Enter') $('[data-next]').click(); };
    $('#ob-depot-addr').oninput = () => { foundDepot = null; $('#ob-depot-result').hidden = true; };
    $('#ob-depot-addr').onkeydown = e => { if (e.key === 'Enter') $('#ob-depot-check').click(); };

    $('#ob-locate').onclick = () => {
      if (!navigator.geolocation) return toast('Standort nicht verfügbar');
      toast('Standort wird ermittelt …');
      navigator.geolocation.getCurrentPosition(async pos => {
        const r = await Geo.reverse(pos.coords.latitude, pos.coords.longitude).catch(() => null);
        if (!r) return toast('Adresse zum Standort nicht gefunden');
        $('#ob-depot-addr').value = r.label;
        foundDepot = r;
        const el = $('#ob-depot-result');
        el.hidden = false; el.className = 'geo-result ok';
        el.innerHTML = `<span><b>${esc(r.label)}</b>Aktueller Standort</span>`;
      }, () => toast('Standortfreigabe abgelehnt'), { enableHighAccuracy: true, timeout: 10000 });
    };

    $('#ob-depot-check').onclick = async () => {
      const q = $('#ob-depot-addr').value.trim();
      if (!q) return toast('Bitte die Depot-Adresse eingeben');
      const btn = $('#ob-depot-check');
      if (!foundDepot) {
        btn.classList.add('loading');
        foundDepot = await checkDepot(q, $('#ob-depot-result')).catch(() => null);
        btn.classList.remove('loading');
        if (!foundDepot) return;
        btn.textContent = 'Weiter';
        return;   // erst Ergebnis zeigen, dann bestätigen
      }
      settings.depot = Object.assign({}, foundDepot, { query: q, name: $('#ob-depot-name').value.trim() || 'Depot' });
      btn.innerHTML = 'Prüfen &amp; weiter';
      show(2);
    };

    $('#ob-finish').onclick = () => {
      settings.nav = $('#ob-nav').dataset.value;
      settings.onboarded = true;
      persist();
      $('#onboarding').hidden = true;
      startApp();
    };
    show(settings.depot && settings.onboarded ? 1 : 0);
  }

  /* ---------- Karte ---------- */
  const Map_ = {
    map: null, el: null, tiles: null, layers: null,
    container() { return matchMedia('(min-width: 960px)').matches ? $('#map-desktop') : $('#map-mobile'); },
    ensure() {
      const el = this.container();
      if (!el || !window.L) return null;
      if (this.map && this.el === el) return this.map;
      if (this.map) { this.map.remove(); this.map = null; }
      this.el = el;
      this.map = L.map(el, { zoomControl: false, attributionControl: true });
      L.control.zoom({ position: 'bottomright' }).addTo(this.map);
      this.layers = L.layerGroup().addTo(this.map);
      this.setTiles();
      return this.map;
    },
    setTiles() {
      if (!this.map) return;
      if (this.tiles) this.tiles.remove();
      // OSM-Standardkacheln; im Dunkelmodus per CSS-Filter abgedunkelt
      this.tiles = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
      }).addTo(this.map);
    },
    pin(p, html, cls) {
      return L.marker([p.lat, p.lon], { icon: L.divIcon({ className: '', html: `<div class="pin ${cls || ''}">${html}</div>`, iconSize: [28, 28], iconAnchor: [14, 14] }) });
    },
    render() {
      const depot = settings.depot;
      const hasStops = stops.some(s => s.status === 'ok');
      $('#map-empty').hidden = hasStops || !!route;
      const m = this.ensure(); if (!m || !depot) return;
      this.layers.clearLayers();
      const bounds = [[depot.lat, depot.lon]];
      const accent = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim();

      if (route) {
        L.polyline(route.geometry, { color: isDark() ? '#000' : '#fff', weight: 9, opacity: .5 }).addTo(this.layers);
        L.polyline(route.geometry, { color: accent, weight: 5, opacity: .95 }).addTo(this.layers);
        const cur = currentIndex();
        route.order.forEach((id, i) => {
          const s = stopById(id); if (!s) return;
          const cls = route.done[id] ? 'done' : (i === cur ? 'current' : '');
          this.pin(s, i + 1, cls).bindTooltip(esc(s.label)).on('click', () => focusRouteItem(id)).addTo(this.layers);
          bounds.push([s.lat, s.lon]);
        });
        route.geometry.forEach(c => bounds.push(c));
      } else {
        stops.filter(s => s.status === 'ok').forEach(s => { this.pin(s, '•').bindTooltip(esc(s.label)).addTo(this.layers); bounds.push([s.lat, s.lon]); });
      }
      this.pin(depot, '<svg viewBox="0 0 24 24" style="width:14px;height:14px;stroke-width:2.4"><path d="M3 10.5 12 4l9 6.5V20H3z"/></svg>', 'depot')
        .bindTooltip(esc(depot.name)).addTo(this.layers);
      setTimeout(() => {
        m.invalidateSize();
        if (bounds.length > 1) m.fitBounds(bounds, { padding: [36, 36], maxZoom: 16 }); else m.setView(bounds[0], 13);
      }, 50);
    },
    flyTo(p) { if (this.map) this.map.flyTo([p.lat, p.lon], 16, { duration: .6 }); },
  };
  let lastWide = matchMedia('(min-width: 960px)').matches;
  addEventListener('resize', () => {
    const w = matchMedia('(min-width: 960px)').matches;
    if (w !== lastWide) { lastWide = w; Map_.render(); }
  });

  /* ---------- Stopps ---------- */
  const stopById = id => stops.find(s => s.id === id);
  let geoRunning = false;

  function addAddresses(lines) {
    if (!lines.length) return 0;
    const known = new Set(stops.map(s => s.query.toLowerCase()));
    let added = 0;
    for (const q of lines) {
      if (known.has(q.toLowerCase())) continue;
      known.add(q.toLowerCase());
      stops.push({ id: uid(), query: q, status: 'pending' });
      added++;
    }
    invalidateRoute();
    persist(); renderStops(); runGeocoding();
    return added;
  }

  async function runGeocoding() {
    if (geoRunning) return;
    geoRunning = true;
    try {
      let next;
      while ((next = stops.find(s => s.status === 'pending'))) {
        const s = next;
        let r = null;
        try { r = await Geo.geocode(s.query, settings.depot); } catch (_) {}
        if (!stopById(s.id)) continue;            // zwischendurch gelöscht
        if (s.status !== 'pending') continue;     // zwischendurch geändert
        if (r) Object.assign(s, { status: 'ok', label: r.label, lat: r.lat, lon: r.lon, approx: r.approx });
        else s.status = 'err';
        persist(); renderStops(); Map_.render();
      }
    } finally { geoRunning = false; }
  }

  function invalidateRoute() { if (route) { route = null; $('#result').hidden = true; } }

  const ICON = {
    ok: '<svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
    warn: '<svg viewBox="0 0 24 24"><path d="M12 8v5M12 16.5v.5"/></svg>',
    edit: '<svg viewBox="0 0 24 24"><path d="M4 20h4L19 9l-4-4L4 16z"/></svg>',
    del: '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18"/></svg>',
    nav: '<svg viewBox="0 0 24 24"><path d="M4 11l16-7-7 16-2-7z"/></svg>',
    check: '<svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
  };

  function renderStops() {
    $('#stops-card').hidden = !stops.length;
    $('#stop-count').textContent = stops.length;
    $('#stop-list').innerHTML = stops.map(s => {
      const cls = s.status === 'ok' ? (s.approx ? 'ok approx' : 'ok') : s.status;
      const state = s.status === 'ok' ? ICON.ok : s.status === 'err' ? ICON.warn : '';
      const sub = s.status === 'ok' ? esc(s.label) + (s.approx ? ' · Hausnr. ungefähr' : '')
        : s.status === 'err' ? 'Nicht gefunden – tippe auf ✎ und ergänze z. B. den Ort' : 'Suche …';
      return `<li class="stop ${cls}" data-id="${s.id}">
        <span class="state">${state}</span>
        <div class="txt"><div class="q">${esc(s.query)}</div><div class="r">${sub}</div></div>
        <div class="acts"><button data-act="edit" aria-label="Bearbeiten">${ICON.edit}</button><button data-act="del" aria-label="Entfernen">${ICON.del}</button></div>
      </li>`;
    }).join('');
    const pending = stops.some(s => s.status === 'pending');
    const okCount = stops.filter(s => s.status === 'ok').length;
    const btn = $('#optimize-btn');
    btn.disabled = pending || okCount === 0;
    btn.lastChild.textContent = pending ? ' Adressen werden gesucht …' : ` Route optimieren (${okCount})`;
    renderGreeting();
    renderDock();
  }

  $('#stop-list').addEventListener('click', e => {
    const b = e.target.closest('[data-act]'); if (!b) return;
    const li = b.closest('.stop'); const s = stopById(li.dataset.id);
    if (b.dataset.act === 'del') {
      stops = stops.filter(x => x !== s);
      invalidateRoute(); persist(); renderStops(); Map_.render();
    } else if (b.dataset.act === 'edit') {
      const q = li.querySelector('.q');
      q.innerHTML = `<input value="${esc(s.query)}" aria-label="Adresse bearbeiten">`;
      const inp = q.querySelector('input'); inp.focus(); inp.select();
      const commit = () => {
        const v = inp.value.trim();
        if (v && v !== s.query) { Object.assign(s, { query: v, status: 'pending', label: '', approx: false }); invalidateRoute(); persist(); runGeocoding(); }
        renderStops();
      };
      inp.onkeydown = ev => { if (ev.key === 'Enter') inp.blur(); if (ev.key === 'Escape') { inp.value = s.query; inp.blur(); } };
      inp.onblur = commit;
    }
  });

  $('#clear-btn').onclick = () => {
    if (!confirm('Alle Stopps entfernen?')) return;
    stops = []; route = null; $('#result').hidden = true; persist(); renderStops(); Map_.render();
  };

  /* ---------- Eingabe & Diktat ---------- */
  function submitInput() {
    const raw = $('#addr-input').value;
    const lines = Speech.smartParse(raw, settings.smart);
    if (!lines.length) return toast('Bitte mindestens eine Adresse eingeben');
    const n = addAddresses(lines);
    $('#addr-input').value = '';
    toast(n ? `${n} Adresse${n > 1 ? 'n' : ''} hinzugefügt` : 'Schon in der Liste');
  }
  $('#add-btn').onclick = submitInput;
  $('#addr-input').addEventListener('keydown', e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) submitInput(); });

  const dict = new Speech.Dictation({
    onFinal(text) {
      const ta = $('#addr-input');
      const parsed = Speech.smartParse(text, settings.smart).join('\n');
      if (!parsed) return;
      ta.value = (ta.value.trim() ? ta.value.replace(/\s*$/, '\n') : '') + parsed + '\n';
      ta.scrollTop = ta.scrollHeight;
    },
    onInterim(t) { $('#interim').textContent = t; },
    onState(on) {
      $('#mic-btn').classList.toggle('live', on);
      $('#mic-btn .mic-label').textContent = on ? 'Hört zu …' : 'Diktieren';
    },
    onError(err) {
      if (err === 'unsupported') toast('Diktat geht hier nicht – nutze das Mikrofon deiner Tastatur', 4000);
      else if (err === 'not-allowed' || err === 'service-not-allowed') toast('Mikrofon nicht freigegeben', 3500);
      else toast('Diktat-Fehler: ' + err);
    },
  });
  $('#mic-btn').onclick = () => dict.toggle();
  document.addEventListener('focusin', e => { if (e.target.matches('input, textarea')) document.body.classList.add('typing'); });
  document.addEventListener('focusout', () => setTimeout(() => { if (!document.activeElement.matches('input, textarea')) document.body.classList.remove('typing'); }, 50));

  /* ---------- Optimierung ---------- */
  async function optimize() {
    const ok = stops.filter(s => s.status === 'ok');
    const bad = stops.filter(s => s.status === 'err').length;
    if (!ok.length) return;
    if (ok.length > 99) return toast('Maximal 99 Stopps pro Tour');
    const btn = $('#optimize-btn');
    btn.classList.add('loading'); btn.disabled = true;
    const db = $('#dock-opt'); if (db) { db.classList.add('loading'); db.disabled = true; }
    try {
      const depot = settings.depot;
      const pts = [depot, ...ok];
      const M = await Geo.matrix(pts);
      const naive = Optimize.tourCost(ok.map((_, i) => i + 1), M.dur, settings.roundtrip);
      const { order, cost } = Optimize.solve(M.dur, settings.roundtrip);
      const orderedStops = order.map(i => ok[i - 1]);
      const seq = [depot, ...orderedStops, ...(settings.roundtrip ? [depot] : [])];
      const R = await Geo.route(seq);
      route = {
        order: orderedStops.map(s => s.id),
        legs: R.legs, geometry: R.geometry,
        source: R.source === 'osrm' && M.source === 'osrm' ? 'osrm' : 'luftlinie',
        saving: Math.max(0, naive - cost),
        done: {}, created: Date.now(), startAt: Date.now(), roundtrip: settings.roundtrip,
      };
      persist();
      renderResult();
      if (bad) toast(`${bad} Adresse${bad > 1 ? 'n' : ''} nicht gefunden – übersprungen`, 3500);
      $('#result').scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch (e) {
      toast('Optimierung fehlgeschlagen: ' + e.message, 4000);
    } finally {
      btn.classList.remove('loading'); renderStops();
    }
  }
  $('#optimize-btn').onclick = optimize;

  /* ---------- Ergebnis ---------- */
  const currentIndex = () => route ? route.order.findIndex(id => !route.done[id]) : -1;

  function renderResult() {
    if (!route) { $('#result').hidden = true; Map_.render(); renderDock(); return; }
    const valid = route.order.every(stopById);
    if (!valid) { route = null; persist(); return renderResult(); }
    $('#result').hidden = false;

    const n = route.order.length;
    const doneCount = route.order.filter(id => route.done[id]).length;
    const totalDist = route.legs.reduce((a, l) => a + l.dist, 0);
    const totalDur = route.legs.reduce((a, l) => a + l.dur, 0);
    const service = (settings.stopMin || 0) * 60;

    // Ankunftszeiten ab jetzt (bzw. ab letztem erledigten Stopp) hochrechnen
    const cur = currentIndex();
    // legs[i] führt zu Stopp i, legs[n] (nur Rundtour) zurück zum Depot
    const etas = []; let t = Date.now();
    if (cur !== -1) {
      for (let i = cur; i < n; i++) {
        if (route.done[route.order[i]]) continue;
        t += route.legs[i].dur * 1000; etas[i] = new Date(t); t += service * 1000;
      }
    }
    if (route.roundtrip) t += route.legs[n].dur * 1000;
    const endAt = new Date(t);

    // Nächster Stopp
    const app = NAV[settings.nav];
    const nc = $('#next-card');
    if (cur !== -1) {
      const s = stopById(route.order[cur]);
      const leg = route.legs[cur];
      nc.innerHTML = `
        <div class="eyebrow">Nächster Stopp · ${cur + 1} von ${n}</div>
        <h3>${esc(s.label.split(',')[0])}</h3>
        <div class="sub">${esc(s.label.split(',').slice(1).join(',').trim())} · ${fmtDur(leg.dur)} · ${fmtKm(leg.dist)}</div>
        <div class="next-actions">
          <a class="btn" href="${navUrl(s)}" target="_blank" rel="noopener">${ICON.nav} Mit ${app.name} starten</a>
          <button class="btn secondary" data-done="${s.id}">${ICON.check} Erledigt</button>
        </div>
        <div class="progress"><span style="width:${doneCount / n * 100}%"></span></div>`;
    } else {
      const d = settings.depot;
      nc.innerHTML = `
        <div class="eyebrow">Alle ${n} Stopps erledigt</div>
        <h3>${route.roundtrip ? 'Zurück zum Depot' : 'Tour geschafft'}</h3>
        <div class="sub">${route.roundtrip ? esc(d.name) + ' · ' + fmtDur(route.legs[route.legs.length - 1].dur) : 'Starke Arbeit heute.'}</div>
        ${route.roundtrip ? `<div class="next-actions"><a class="btn" href="${navUrl(d)}" target="_blank" rel="noopener">${ICON.nav} Mit ${app.name} zum Depot</a></div>` : ''}
        <div class="progress"><span style="width:100%"></span></div>`;
    }

    // Kennzahlen
    $('#stats').innerHTML = `
      <div class="stat"><b>${n}</b><span>Stopps</span></div>
      <div class="stat"><b>${fmtKm(totalDist).replace(' km', '')}</b><span>Kilometer</span></div>
      <div class="stat"><b>${fmtDur(totalDur)}</b><span>Fahrzeit</span></div>
      <div class="stat"><b>${fmtTime(endAt)}</b><span>${route.roundtrip ? 'zurück am Depot' : 'Tourende'}</span></div>
      ${route.saving > 90 ? `<div class="saving">↓ ${fmtDur(route.saving)} kürzer als in der eingegebenen Reihenfolge</div>` : ''}
      ${route.source !== 'osrm' ? '<div class="saving" style="color:var(--warn)">Routing-Dienst nicht erreichbar – Werte geschätzt (Luftlinie)</div>' : ''}`;

    // Export
    const ordered = route.order.map(stopById);
    const parts = [];
    const d = settings.depot;
    let origin = d;
    for (let i = 0; i < ordered.length; i += 10) {
      const chunk = ordered.slice(i, i + 10);
      const isLast = i + 10 >= ordered.length;
      let dest, wps;
      if (isLast && route.roundtrip && chunk.length < 10) { dest = d; wps = chunk; }
      else { dest = chunk[chunk.length - 1]; wps = chunk.slice(0, -1); }
      parts.push({ url: googleMultiUrl(origin, wps, dest), from: i + 1, to: i + chunk.length });
      origin = chunk[chunk.length - 1];
    }
    if (route.roundtrip && ordered.length % 10 === 0) parts.push({ url: googleMultiUrl(origin, [], d), from: 'Depot', to: '' });
    $('#export').innerHTML =
      parts.map((p, k) => `<a class="btn ghost" href="${p.url}" target="_blank" rel="noopener">${NAV.google.icon} ${parts.length > 1 ? `Google Maps ${k + 1}/${parts.length}` : 'Ganze Route in Google Maps'}</a>`).join('') +
      `<button class="btn ghost" id="copy-btn"><svg viewBox="0 0 24 24"><rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3"/></svg> Liste kopieren</button>`;
    $('#copy-btn').onclick = async () => {
      const txt = [`Start: ${d.name} – ${d.label}`, ...ordered.map((s, i) => `${i + 1}. ${s.label}`), route.roundtrip ? `Ende: ${d.name}` : ''].filter(Boolean).join('\n');
      try {
        if (navigator.share && matchMedia('(pointer:coarse)').matches) await navigator.share({ title: 'Tour', text: txt });
        else { await navigator.clipboard.writeText(txt); toast('Reihenfolge kopiert'); }
      } catch (_) {}
    };

    // Liste
    const rows = [`<li class="depot"><span class="num"><svg viewBox="0 0 24 24" style="width:15px;height:15px"><path d="M3 10.5 12 4l9 6.5V20H3z"/></svg></span><div class="txt"><div class="q">${esc(d.name)}</div><div class="meta">Start · ${esc(d.label)}</div></div></li>`];
    ordered.forEach((s, i) => {
      const done = !!route.done[s.id];
      const eta = etas[i];
      rows.push(`<li data-id="${s.id}" class="${done ? 'done' : ''} ${i === cur ? 'current' : ''}">
        <span class="num">${i + 1}</span>
        <div class="txt"><div class="q">${esc(s.label)}</div>
          <div class="meta">${done ? 'erledigt' : (eta ? 'ca. ' + fmtTime(eta) + ' · ' : '') + fmtKm(route.legs[i].dist)}${s.approx ? ' · Hausnr. ungefähr' : ''}</div></div>
        <a class="go" href="${navUrl(s)}" target="_blank" rel="noopener" aria-label="Navigieren">${ICON.nav}</a>
        <button class="check" data-done="${s.id}" aria-pressed="${done}" aria-label="Erledigt">${ICON.check}</button>
      </li>`);
    });
    if (route.roundtrip) {
      const last = route.legs[route.legs.length - 1];
      rows.push(`<li class="depot"><span class="num"><svg viewBox="0 0 24 24" style="width:15px;height:15px"><path d="M3 10.5 12 4l9 6.5V20H3z"/></svg></span><div class="txt"><div class="q">${esc(d.name)}</div><div class="meta">Ende · ${fmtKm(last.dist)} · ca. ${fmtTime(endAt)}</div></div></li>`);
    }
    $('#route-list').innerHTML = rows.join('');
    Map_.render();
    renderDock();
  }

  document.addEventListener('click', e => {
    const b = e.target.closest('[data-done]'); if (!b || !route) return;
    const id = b.dataset.done;
    route.done[id] = !route.done[id];
    if (!route.done[id]) delete route.done[id];
    persist(); renderResult();
    if (route.done[id] && b.closest('#next-card') && navigator.vibrate) navigator.vibrate(15);
  });
  $('#route-list').addEventListener('click', e => {
    if (e.target.closest('a,button')) return;
    const li = e.target.closest('li[data-id]'); if (!li) return;
    const s = stopById(li.dataset.id); if (s) Map_.flyTo(s);
  });
  function focusRouteItem(id) {
    const li = document.querySelector(`#route-list li[data-id="${id}"]`);
    if (li) { li.scrollIntoView({ behavior: 'smooth', block: 'center' }); li.animate([{ background: 'var(--accent-soft)' }, { background: 'transparent' }], 1200); }
  }
  $('#reset-done').onclick = () => { if (route) { route.done = {}; persist(); renderResult(); } };


  /* ---------- Daumen-Leiste (Handy) ---------- */
  function renderDock() {
    const dock = $('#dock');
    const okCount = stops.filter(s => s.status === 'ok').length;
    const pending = stops.some(s => s.status === 'pending');
    if (route) {
      const cur = currentIndex(), n = route.order.length;
      const s = cur !== -1 ? stopById(route.order[cur]) : settings.depot;
      const title = cur !== -1 ? s.label.split(',')[0] : (route.roundtrip ? 'Zurück zum Depot' : 'Tour geschafft');
      const sub = cur !== -1 ? `Stopp ${cur + 1} von ${n} · ${fmtDur(route.legs[cur].dur)}` : `Alle ${n} Stopps erledigt`;
      const canNav = cur !== -1 || route.roundtrip;
      dock.innerHTML = `
        <button class="dock-info" id="dock-info"><b>${esc(title)}</b><span>${sub}</span></button>
        ${cur !== -1 ? `<button class="dock-btn ghost" data-done="${s.id}" aria-label="Erledigt">${ICON.check}</button>` : ''}
        ${canNav ? `<a class="dock-btn primary" href="${navUrl(s)}" target="_blank" rel="noopener" aria-label="Navigieren">${ICON.nav}<span>Los</span></a>` : ''}`;
      $('#dock-info').onclick = () => $('#next-card').scrollIntoView({ behavior: 'smooth', block: 'start' });
      dock.hidden = false;
    } else if (stops.length) {
      dock.innerHTML = `<button class="dock-wide" id="dock-opt" ${pending || !okCount ? 'disabled' : ''}>
          <svg viewBox="0 0 24 24"><path d="M4 19c4-10 12-4 16-14"/><circle cx="4" cy="19" r="2"/><circle cx="20" cy="5" r="2"/></svg>
          ${pending ? 'Adressen werden gesucht …' : `Route optimieren (${okCount})`}</button>`;
      $('#dock-opt').onclick = optimize;
      dock.hidden = false;
    } else dock.hidden = true;
    document.body.classList.toggle('has-dock', !dock.hidden);
  }

  /* ---------- Kopf ---------- */
  function renderGreeting() {
    const h = new Date().getHours();
    const g = h < 11 ? 'Guten Morgen' : h < 17 ? 'Hallo' : 'Guten Abend';
    const ok = stops.filter(s => s.status === 'ok').length;
    $('#greeting').innerHTML = `${g}${settings.name ? ', ' + esc(settings.name) : ''}.<small>${ok ? `${ok} Stopp${ok > 1 ? 's' : ''} geplant ab ${esc(settings.depot?.name || 'Depot')}` : 'Welche Adressen stehen heute an?'}</small>`;
    $('#depot-chip-label').textContent = settings.depot?.name || 'Depot';
  }

  $('#theme-toggle').onclick = () => { settings.theme = isDark() ? 'light' : 'dark'; applyTheme(); persist(); if (route) renderResult(); };

  /* ---------- Einstellungen ---------- */
  let pendingDepot = null;
  function openSettings() {
    pendingDepot = null;
    $('#s-name').value = settings.name || '';
    $('#s-depot-name').value = settings.depot?.name || '';
    $('#s-depot-addr').value = settings.depot?.query || settings.depot?.label || '';
    $('#s-depot-result').hidden = true;
    $('#s-roundtrip').checked = settings.roundtrip;
    $('#s-ai').checked = settings.smart;
    $('#s-stopmin').value = settings.stopMin;
    renderNavChoices($('#s-nav'), true);
    renderThemeChoices($('#s-theme'));
    $('#settings').hidden = false;
  }
  const closeSettings = () => { $('#settings').hidden = true; };
  $('#settings-open').onclick = openSettings;
  $('#depot-chip').onclick = openSettings;
  $('#settings-close').onclick = closeSettings;
  $('#settings').addEventListener('click', e => { if (e.target.id === 'settings') closeSettings(); });
  addEventListener('keydown', e => { if (e.key === 'Escape' && !$('#settings').hidden) closeSettings(); });
  $('#s-depot-addr').oninput = () => { pendingDepot = null; };
  $('#s-depot-check').onclick = async () => {
    const q = $('#s-depot-addr').value.trim(); if (!q) return;
    pendingDepot = await checkDepot(q, $('#s-depot-result')).catch(() => null);
  };
  $('#s-save').onclick = async () => {
    const q = $('#s-depot-addr').value.trim();
    const depotChanged = settings.depot && q !== (settings.depot.query || settings.depot.label);
    if (depotChanged && !pendingDepot) {
      pendingDepot = await checkDepot(q, $('#s-depot-result')).catch(() => null);
      if (!pendingDepot) return;
    }
    const before = JSON.stringify([settings.depot, settings.roundtrip]);
    settings.name = $('#s-name').value.trim();
    if (pendingDepot) settings.depot = Object.assign({}, pendingDepot, { query: q });
    if (settings.depot) settings.depot.name = $('#s-depot-name').value.trim() || 'Depot';
    settings.nav = $('#s-nav').dataset.value;
    settings.roundtrip = $('#s-roundtrip').checked;
    settings.smart = $('#s-ai').checked;
    settings.stopMin = Math.max(0, Math.min(30, +$('#s-stopmin').value || 0));
    if (JSON.stringify([settings.depot, settings.roundtrip]) !== before && route) { route = null; toast('Einstellungen gespeichert – bitte Route neu optimieren'); }
    else toast('Gespeichert');
    persist(); closeSettings(); renderStops(); renderResult();
  };
  $('#s-reset').onclick = () => {
    if (!confirm('Alle Einstellungen und Stopps löschen?')) return;
    ['tp.settings', 'tp.stops', 'tp.route'].forEach(k => localStorage.removeItem(k));
    location.reload();
  };

  /* ---------- Start ---------- */
  function startApp() {
    $('#app').hidden = false;
    applyTheme();
    renderStops();
    renderResult();
    Map_.render();
    runGeocoding();
  }

  applyTheme();
  if (!settings.onboarded || !settings.depot) startOnboarding(); else startApp();

  if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});
})();
