/* Tourplan – App-Logik */
(function () {
  const $ = s => document.querySelector(s);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const uid = () => Math.random().toString(36).slice(2, 10);

  /* ---------- Zustand ---------- */
  const DEFAULTS = { name: '', depot: null, nav: 'waze', theme: 'auto', roundtrip: true, smart: true, stopMin: 2, sound: true, pois: true };
  const load = (k, d) => { try { const v = JSON.parse(localStorage.getItem(k)); return v ?? d; } catch (_) { return d; } };
  const save = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (_) {} };

  let settings = Object.assign({}, DEFAULTS, load('tp.settings', {}));
  let stops = load('tp.stops', []);
  let route = load('tp.route', null);
  let history_ = load('tp.history', []);
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
    if (origin) u.searchParams.set('origin', ll(origin));   // ohne Start = aktueller Standort
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

  /* ---------- Toast (optional mit Aktion, z. B. „Rückgängig“) ---------- */
  let toastT;
  function toast(msg, ms = 2600, action) {
    const t = $('#toast'), btn = $('#toast-act');
    $('#toast-msg').textContent = msg;
    btn.hidden = !action;
    if (action) { btn.textContent = action.label; btn.onclick = () => { t.classList.remove('show'); action.run(); }; }
    t.classList.toggle('has-act', !!action);
    t.classList.add('show');
    clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('show'), action ? 6000 : ms);
  }

  /* ---------- Töne & Vibration ---------- */
  const Sfx = {
    ctx: null,
    ac() {
      if (!settings.sound) return null;
      try {
        if (!this.ctx) this.ctx = new (window.AudioContext || window.webkitAudioContext)();
        if (this.ctx.state === 'suspended') this.ctx.resume();
        return this.ctx;
      } catch (_) { return null; }
    },
    tone(freq, at, dur, vol, type = 'sine') {
      const c = this.ac(); if (!c) return;
      const t = c.currentTime + at, o = c.createOscillator(), g = c.createGain();
      o.type = type; o.frequency.value = freq;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(vol, t + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g).connect(c.destination); o.start(t); o.stop(t + dur + 0.05);
    },
    // heller Zweiklang wie bei einer bestätigten Zahlung
    check() {
      this.tone(1174.7, 0, .16, .16); this.tone(2349.3, 0, .12, .04);
      this.tone(1568, .085, .42, .2); this.tone(3136, .085, .3, .05);
      if (settings.sound && navigator.vibrate) navigator.vibrate([12, 40, 18]);
    },
    uncheck() { this.tone(520, 0, .1, .1); if (settings.sound && navigator.vibrate) navigator.vibrate(8); },
    remove() { this.tone(330, 0, .09, .1, 'triangle'); this.tone(247, .06, .14, .1, 'triangle'); if (settings.sound && navigator.vibrate) navigator.vibrate(20); },
    done() { [784, 988, 1175, 1568].forEach((f, i) => this.tone(f, i * .09, .5, .16)); if (settings.sound && navigator.vibrate) navigator.vibrate([15, 50, 15, 50, 40]); },
  };

  /* ---------- Formatierung ---------- */
  const fmtKm = m => (m / 1000).toLocaleString('de-DE', { maximumFractionDigits: m < 10000 ? 1 : 0 }) + ' km';
  const fmtDur = s => { const m = Math.round(s / 60); return m < 60 ? `${m} Min` : `${Math.floor(m / 60)} Std ${m % 60} Min`; };
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

  /* ---------- Adress-Vorschläge ---------- */
  const PIN_ICON = '<svg viewBox="0 0 24 24"><path d="M12 21s-6.5-6-6.5-11a6.5 6.5 0 0 1 13 0c0 5-6.5 11-6.5 11z"/><circle cx="12" cy="10" r="2.2"/></svg>';
  function showSuggestions(box, list, onPick) {
    if (!list.length) { box.hidden = true; box.innerHTML = ''; return; }
    box.innerHTML = list.map((r, i) => `<button type="button" data-i="${i}">${PIN_ICON}<span><b>${esc(r.title)}</b><small>${esc(r.sub)}${r.km != null && r.km >= 1 ? ' · ' + Math.round(r.km) + ' km' : ''}</small></span></button>`).join('');
    box.hidden = false;
    box.onpointerdown = e => e.preventDefault();          // Fokus im Feld behalten
    box.onclick = e => { const b = e.target.closest('[data-i]'); if (!b) return; box.hidden = true; onPick(list[+b.dataset.i]); };
  }
  /** Vorschläge für ein einzeiliges Feld */
  function attachSuggest(input, box, getBias, onPick) {
    let t;
    input.addEventListener('input', () => {
      clearTimeout(t);
      const q = input.value.trim();
      if (q.length < 3) { box.hidden = true; return; }
      t = setTimeout(async () => {
        try {
          const list = await suggestFor(q, getBias());
          if (document.activeElement === input && input.value.trim() === q) showSuggestions(box, list, r => { input.value = r.label; onPick(r); });
        } catch (_) {}
      }, 150);
    });
    input.addEventListener('blur', () => setTimeout(() => { box.hidden = true; }, 150));
  }
  async function suggestFor(q, depot) {
    const local = depot ? Geo.streetSuggest(q, depot) : [];
    if (local.length) return local;
    return Geo.suggest(q, depot);
  }
  const picked = new Map();        // gewählter Vorschlag (Text) → Koordinaten
  const pickedPlace = new Map();   // gewählte Straße → Ort, falls die Zeile noch ohne Ort ist

  /* ---------- Depot-Prüfung (Onboarding + Einstellungen) ---------- */
  function showDepotResult(el, r, note) {
    el.hidden = false; el.className = 'geo-result ok';
    el.innerHTML = `<svg viewBox="0 0 24 24" style="color:var(--ok)"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg><span><b>${esc(r.label)}</b>${note}</span>`;
  }
  async function checkDepot(query, resultEl, box) {
    resultEl.hidden = false; resultEl.className = 'geo-result'; resultEl.textContent = 'Suche …';
    const list = await Geo.candidates(query, null);
    let r = list[0] || await Geo.geocode(query, null);
    if (!r) {
      resultEl.className = 'geo-result err';
      resultEl.innerHTML = '<span>Adresse nicht gefunden. Bitte mit PLZ und Ort angeben.</span>';
      return null;
    }
    showDepotResult(resultEl, r, list.length > 1 ? 'Bester Treffer – darunter weitere zur Auswahl' : r.approx ? 'Hausnummer ungefähr' : 'Gefunden');
    if (box && list.length > 1) return new Promise(done => {
      // weitere Treffer anbieten; ohne Auswahl gilt der erste
      showSuggestions(box, list.slice(1), pick => { showDepotResult(resultEl, pick, 'Ausgewählt'); box.dataset.pick = JSON.stringify(pick); });
      done(r);
    });
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
    const btn = $('#ob-depot-check');
    $('#ob-name').value = settings.name;
    $('#ob-depot-name').value = settings.depot?.name || '';
    $('#ob-depot-addr').value = settings.depot?.query || '';
    renderNavChoices($('#ob-nav'));
    renderThemeChoices($('#ob-theme'));

    document.querySelectorAll('[data-next]').forEach(b => b.onclick = () => { settings.name = $('#ob-name').value.trim(); show(step + 1); });
    document.querySelectorAll('[data-back]').forEach(b => b.onclick = () => show(step - 1));
    $('#ob-name').onkeydown = e => { if (e.key === 'Enter') $('[data-next]').click(); };
    $('#ob-depot-addr').addEventListener('input', () => { foundDepot = null; $('#ob-depot-result').hidden = true; btn.innerHTML = 'Prüfen &amp; weiter'; });
    $('#ob-depot-addr').onkeydown = e => { if (e.key === 'Enter') btn.click(); };
    attachSuggest($('#ob-depot-addr'), $('#ob-suggest'), () => null, r => {
      if (!r.exact) return;            // Hausnummer noch unbekannt → normal prüfen lassen
      foundDepot = r; showDepotResult($('#ob-depot-result'), r, 'Ausgewählt'); btn.textContent = 'Weiter';
    });

    $('#ob-locate').onclick = () => {
      if (!navigator.geolocation) return toast('Standort nicht verfügbar');
      toast('Standort wird ermittelt …');
      navigator.geolocation.getCurrentPosition(async pos => {
        const r = await Geo.reverse(pos.coords.latitude, pos.coords.longitude).catch(() => null);
        if (!r) return toast('Adresse zum Standort nicht gefunden');
        $('#ob-depot-addr').value = r.label;
        foundDepot = r; showDepotResult($('#ob-depot-result'), r, 'Aktueller Standort'); btn.textContent = 'Weiter';
      }, () => toast('Standortfreigabe abgelehnt'), { enableHighAccuracy: true, timeout: 10000 });
    };

    btn.onclick = async () => {
      const q = $('#ob-depot-addr').value.trim();
      if (!q) return toast('Bitte die Depot-Adresse eingeben');
      if (!foundDepot) {
        btn.classList.add('loading');
        delete $('#ob-suggest').dataset.pick;
        foundDepot = await checkDepot(q, $('#ob-depot-result'), $('#ob-suggest')).catch(() => null);
        btn.classList.remove('loading');
        if (!foundDepot) return;
        btn.textContent = 'Weiter';
        return;   // erst Ergebnis zeigen, dann bestätigen
      }
      if ($('#ob-suggest').dataset.pick) { foundDepot = JSON.parse($('#ob-suggest').dataset.pick); delete $('#ob-suggest').dataset.pick; }
      $('#ob-suggest').hidden = true;
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
  const wide = () => matchMedia('(min-width: 960px)').matches;
  const HOME_ICON = '<svg viewBox="0 0 24 24" style="width:15px;height:15px;stroke-width:2.4"><path d="M3 10.5 12 4l9 6.5V20H3z"/></svg>';
  const Map_ = {
    map: null, tiles: null, layers: null, poiLayer: null, me: null, full: false, lastFit: '',
    place() {                       // Karte in den passenden Platz hängen (Handy: im Ergebnis, breit: rechts)
      const wrap = $('#map-wrap'), slot = wide() ? $('#map-slot-desktop') : $('#map-slot-mobile');
      if (wrap.parentNode !== slot) slot.appendChild(wrap);
    },
    ensure() {
      if (!window.L) return null;
      this.place();
      if (this.map) return this.map;
      this.map = L.map($('#map'), { zoomControl: false, attributionControl: true });
      L.control.zoom({ position: 'bottomright' }).addTo(this.map);
      this.layers = L.layerGroup().addTo(this.map);
      this.poiLayer = L.layerGroup().addTo(this.map);
      this.setTiles();
      this.map.on('locationfound', e => {
        if (this.me) this.me.remove();
        this.me = L.circleMarker(e.latlng, { radius: 8, color: '#fff', weight: 3, fillColor: '#0A84D6', fillOpacity: 1 }).addTo(this.map);
      });
      this.map.on('locationerror', () => toast('Standort nicht verfügbar'));
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
      return L.marker([p.lat, p.lon], { icon: L.divIcon({ className: '', html: `<div class="pin ${cls || ''}">${html}</div>`, iconSize: [32, 32], iconAnchor: [16, 16] }) });
    },
    render(refit) {
      const depot = settings.depot;
      const hasStops = stops.some(s => s.status === 'ok');
      $('#map-empty').hidden = hasStops || !!route;
      const m = this.ensure(); if (!m || !depot) return;
      this.layers.clearLayers();
      const bounds = [[depot.lat, depot.lon]];
      const accent = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim();

      if (route) {
        L.polyline(route.geometry, { color: isDark() ? '#000' : '#fff', weight: 10, opacity: .55 }).addTo(this.layers);
        L.polyline(route.geometry, { color: accent, weight: 6, opacity: .95 }).addTo(this.layers);
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
      this.pin(depot, HOME_ICON, 'depot').bindTooltip(esc(depot.name)).addTo(this.layers);
      this.renderPois();
      // nur neu einpassen, wenn sich die Punkte geändert haben – nicht bei jedem Haken
      const key = (route ? route.order.join() : stops.filter(s => s.status === 'ok').map(s => s.id).join()) + '|' + depot.lat;
      if (key === this.lastFit && !refit) return;
      this.lastFit = key;
      setTimeout(() => {
        m.invalidateSize();
        if (bounds.length > 1) m.fitBounds(bounds, { padding: [40, 40], maxZoom: 16 }); else m.setView(bounds[0], 13);
      }, 50);
    },
    renderPois() {
      if (!this.poiLayer) return;
      this.poiLayer.clearLayers();
      const chip = $('#poi-chip');
      const list = settings.pois && route ? Pois.list : [];
      if (!list.length) { chip.hidden = true; return; }
      list.forEach(p => {
        const st = Pois.state(p);
        L.marker([p.lat, p.lon], { zIndexOffset: -200, icon: L.divIcon({ className: '', html: `<div class="poi-pin ${p.kind} ${st.open === false ? 'closed' : ''}">${p.kind === 'locker' ? 'P' : MAIL_ICON}</div>`, iconSize: [26, 26], iconAnchor: [13, 13] }) })
          .bindTooltip(esc(p.name)).on('click', () => openPoiSheet(p.id)).addTo(this.poiLayer);
      });
      const open = list.filter(p => Pois.state(p).open !== false).length;
      chip.innerHTML = `${MAIL_ICON}<span><b>${list.length}</b> Paketstelle${list.length > 1 ? 'n' : ''} an der Route${open < list.length ? ` · ${open} offen` : ''}</span>`;
      chip.hidden = false;
    },
    flyTo(p) { if (this.map) this.map.flyTo([p.lat, p.lon], 16, { duration: .6 }); },
    setFull(on, viaHistory) {
      if (on === this.full) return;
      this.full = on;
      $('#map-wrap').classList.toggle('full', on);
      document.body.classList.toggle('map-full', on);
      $('#map-close').hidden = !on; $('#map-full').hidden = on;
      if (on) history.pushState({ mapFull: true }, '');
      else if (!viaHistory && history.state && history.state.mapFull) history.back();
      this.syncTouch();
      setTimeout(() => { if (this.map) { this.map.invalidateSize(); this.lastFit = ''; this.render(); } }, 60);
    },
    syncTouch() {                    // eingebettet auf dem Handy: Antippen öffnet Vollbild, Seite bleibt scrollbar
      const inline = !this.full && !wide();
      $('#map-tap').hidden = !inline;
      if (!this.map) return;
      ['dragging', 'touchZoom', 'scrollWheelZoom', 'doubleClickZoom'].forEach(h => this.map[h][inline ? 'disable' : 'enable']());
    },
  };
  const MAIL_ICON = '<svg viewBox="0 0 24 24"><rect x="3" y="6" width="18" height="12" rx="2"/><path d="M3.5 7.5 12 13l8.5-5.5"/></svg>';
  $('#map-tap').onclick = () => Map_.setFull(true);
  $('#map-full').onclick = () => Map_.setFull(true);
  $('#map-close').onclick = () => Map_.setFull(false);
  $('#map-locate').onclick = () => { if (Map_.map) Map_.map.locate({ setView: true, maxZoom: 15, enableHighAccuracy: true }); };
  addEventListener('popstate', () => { if (Map_.full) Map_.setFull(false, true); });
  let lastWide = wide();
  addEventListener('resize', () => {
    const w = wide();
    if (w !== lastWide) { lastWide = w; Map_.place(); Map_.syncTouch(); Map_.lastFit = ''; Map_.render(); }
    else if (Map_.map) Map_.map.invalidateSize();
  });

  /* ---------- Packstationen & Postfilialen ---------- */
  const Pois = {
    list: [], key: '', loading: false,
    passTime(p) {                    // ungefähr wann man dort vorbeikommt
      if (!route) return new Date();
      const cur = currentIndex(), n = route.order.length;
      const doneShare = cur === -1 ? 1 : cur / Math.max(1, n);
      const total = route.legs.reduce((a, l) => a + l.dur, 0) + n * (settings.stopMin || 0) * 60;
      return new Date(Date.now() + Math.max(0, p.at - doneShare) * total * 1000);
    },
    state(p) { return Geo.openState(p.hours, this.passTime(p)); },
    async refresh() {
      if (!settings.pois || !route) { this.list = []; this.key = ''; Map_.renderPois(); return; }
      const key = route.order.join() + '|' + route.geometry.length;
      if (key === this.key || this.loading) return;
      this.loading = true;
      try {
        const found = await Geo.postPoints(route.geometry);
        const used = new Set(stops.map(s => s.poi).filter(Boolean));
        this.list = found.filter(p => !used.has(p.id));
        this.key = key;
      } catch (_) { this.list = []; }
      this.loading = false;
      Map_.renderPois();
    },
  };

  /* ---------- Stopps ---------- */
  const stopById = id => stops.find(s => s.id === id);
  const seenIds = new Set();
  let geoWorkers = 0;
  const pkLabel = n => `${n} Paket${n === 1 ? '' : 'e'}`;
  const lineOf = s => s.query + (s.pk ? ', ' + pkLabel(s.pk) : '');

  function addAddresses(lines) {
    const known = new Map(stops.map(s => [s.query.toLowerCase(), s]));
    let added = 0;
    for (const line of lines) {
      let { query, pk } = Speech.parseLine(line);
      if (query.length < 3) continue;
      if (!Geo.hasPlaceIn(query)) {                 // Ort aus gewähltem Vorschlag oder Straßenverzeichnis ergänzen
        const key = Geo.norm(Geo.parseQuery(query).street);
        const st = Geo.streetLookup(query, settings.depot);
        const place = pickedPlace.get(key) || (st && st.sure ? st.p : '');
        if (place) query += ', ' + place;
      }
      const ex = known.get(query.toLowerCase());
      if (ex) { if (pk) ex.pk = (ex.pk || 0) + pk; continue; }      // gleiche Adresse: Pakete zusammenzählen
      const s = { id: uid(), query, pk, status: 'pending' };
      const hit = picked.get(query);
      if (hit) { Object.assign(s, { status: 'ok', label: hit.label, lat: hit.lat, lon: hit.lon, approx: false }); Geo.remember(query, settings.depot, hit); }
      known.set(query.toLowerCase(), s);
      stops.push(s); added++;
    }
    persist(); renderStops(); Map_.render(); runGeocoding();
    return added;
  }

  /** Adresse suchen. Das Straßenverzeichnis prüft den Treffer, springt ein, wenn der Dienst nichts findet,
      und liefert Korrekturvorschläge bei Verhörern. → { r, alts } */
  async function locate(query) {
    const depot = settings.depot;
    let r = null;
    try { r = await Geo.geocode(query, depot); } catch (_) {}
    const st = Geo.streetLookup(query, depot);
    const near = x => Geo.haversine(x.lat, x.lon, st.lat, st.lon) < 3000;
    if (r && st && st.sure && !near(r)) r = null;                    // Treffer liegt nicht bei der gesuchten Straße
    if (!r && st) {
      const bare = query.split(',')[0].trim();
      let r2 = null;
      if (bare !== query) { try { r2 = await Geo.geocode(bare, { lat: st.lat, lon: st.lon, city: st.p }); } catch (_) {} }
      r = r2 && near(r2) ? r2 : { lat: st.lat, lon: st.lon, label: st.label, approx: true };   // notfalls Straßenmitte
    }
    const alts = Geo.streetFix(query, depot);
    if (alts.length) {
      const want = Geo.norm(Geo.parseQuery(query).street), got = r ? Geo.norm(r.label.split(',')[0].replace(/\s*\d+\s?[a-z]?$/i, '')) : '';
      if (!r || got !== want) return { r: null, alts };               // unbekannte Straße: lieber nachfragen als raten
    }
    return { r, alts: [] };
  }

  /** Bis zu 4 Adressen gleichzeitig suchen. */
  function runGeocoding() {
    const next = () => stops.find(s => s.status === 'pending' && !s.busy);
    const worker = async () => {
      geoWorkers++;
      try {
        let s;
        while ((s = next())) {
          s.busy = true;
          const q = s.query;
          const { r, alts } = await locate(q);
          delete s.busy;
          if (!stopById(s.id) || s.status !== 'pending' || s.query !== q) continue;   // zwischendurch gelöscht/geändert
          if (r) Object.assign(s, { status: 'ok', label: r.label, lat: r.lat, lon: r.lon, approx: r.approx, alts: null });
          else Object.assign(s, { status: 'err', alts: alts.length ? alts : null });
          persist(); renderStops(); if (!route) Map_.render();
        }
      } finally {
        geoWorkers--;
        if (!geoWorkers) geocodingDone();
      }
    };
    for (let i = geoWorkers; i < 4 && next(); i++) worker();
    if (!geoWorkers) geocodingDone();
  }
  function geocodingDone() {
    renderStops();
    // läuft schon eine Tour, kommen neue Adressen automatisch an die beste Stelle
    if (route && stops.some(s => s.status === 'ok' && !route.order.includes(s.id))) plan(true);
  }

  const ICON = {
    ok: '<svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
    warn: '<svg viewBox="0 0 24 24"><path d="M12 8v5M12 16.5v.5"/></svg>',
    edit: '<svg viewBox="0 0 24 24"><path d="M4 20h4L19 9l-4-4L4 16z"/></svg>',
    del: '<svg viewBox="0 0 24 24"><path d="M5 7h14M10 7V5h4v2M7 7l1 12h8l1-12"/></svg>',
    nav: '<svg viewBox="0 0 24 24"><path d="M4 11l16-7-7 16-2-7z"/></svg>',
    check: '<svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
    box: '<svg viewBox="0 0 24 24"><path d="M3.5 8 12 4l8.5 4v8L12 20l-8.5-4zM3.5 8 12 12l8.5-4M12 12v8"/></svg>',
    route: '<svg viewBox="0 0 24 24"><path d="M4 19c4-10 12-4 16-14"/><circle cx="4" cy="19" r="2"/><circle cx="20" cy="5" r="2"/></svg>',
  };
  const pkPill = s => s.pk ? `<span class="pk" title="${pkLabel(s.pk)}">${ICON.box}${s.pk}<i>${s.pk === 1 ? 'Paket' : 'Pakete'}</i></span>` : '';
  const newCls = id => { if (seenIds.has(id)) return ''; seenIds.add(id); return ' new'; };

  let editingId = null, openId = null;

  /** Bearbeitungszeile mit Vorschlägen und Paketzähler (für beide Listen) */
  function editorHtml(s) {
    return `<div class="editor" data-editor="${s.id}">
      <input class="ed-q" value="${esc(s.query)}" autocomplete="off" aria-label="Adresse">
      <div class="suggest" hidden></div>
      <div class="ed-row">
        <div class="stepper"><button type="button" data-step="-1" aria-label="Weniger">−</button><span><b class="ed-pk">${s.pk || 0}</b> Pakete</span><button type="button" data-step="1" aria-label="Mehr">+</button></div>
        <button class="btn ghost" data-ed="cancel">Abbrechen</button>
        <button class="btn primary" data-ed="save">Speichern</button>
      </div>
    </div>`;
  }
  function wireEditor(root) {
    const ed = root.querySelector('[data-editor]'); if (!ed) return;
    const s = stopById(ed.dataset.editor), inp = ed.querySelector('.ed-q');
    let pk = s.pk || 0, hit = null;
    attachSuggest(inp, ed.querySelector('.suggest'), () => settings.depot, r => { hit = r.exact ? r : null; });
    inp.addEventListener('input', () => { hit = null; });
    if (matchMedia('(pointer:fine)').matches) { inp.focus(); inp.select(); }
    ed.onclick = e => {
      const st = e.target.closest('[data-step]');
      if (st) { pk = Math.max(0, Math.min(999, pk + +st.dataset.step)); ed.querySelector('.ed-pk').textContent = pk; return; }
      const b = e.target.closest('[data-ed]'); if (!b) return;
      editingId = null;
      if (b.dataset.ed === 'save') {
        const parsed = Speech.parseLine(inp.value);
        const q = parsed.query || s.query;
        s.pk = parsed.pk || pk || null;
        if (q !== s.query || hit) {
          s.query = q;
          if (hit) { Object.assign(s, { status: 'ok', label: hit.label, lat: hit.lat, lon: hit.lon, approx: false }); Geo.remember(q, settings.depot, hit); }
          else Object.assign(s, { status: 'pending', label: '', approx: false });
          persist();
          if (route && s.status === 'ok') plan(false); else if (route) { renderResult(); renderStops(); runGeocoding(); } else { renderStops(); Map_.render(); runGeocoding(); }
          return;
        }
        persist();
      }
      renderStops(); if (route) renderResult();
    };
    inp.onkeydown = ev => { if (ev.key === 'Enter') ed.querySelector('[data-ed="save"]').click(); if (ev.key === 'Escape') ed.querySelector('[data-ed="cancel"]').click(); };
  }

  function renderStops() {
    // Mit laufender Tour zeigt die Liste nur, was noch nicht in der Route ist (z. B. nicht gefundene Adressen)
    const list = route ? stops.filter(s => !route.order.includes(s.id)) : stops;
    $('#stops-card').hidden = !list.length;
    $('#stop-count').textContent = list.length;
    $('#stops-card h2').firstChild.textContent = route ? 'Noch offen ' : 'Stopps ';
    $('#stop-list').innerHTML = list.map(s => {
      const cls = s.status === 'ok' ? 'ok' : s.status;
      const state = s.status === 'ok' ? ICON.ok : s.status === 'err' ? ICON.warn : '';
      const sub = s.status === 'ok' ? esc(s.label) + (s.approx ? ' · Hausnr. ungefähr' : '')
        : s.status === 'err' ? (s.alts ? 'Straße unbekannt – meintest du:' : 'Nicht gefunden – antippen und Ort ergänzen') : 'Suche …';
      if (editingId === s.id) return `<li class="stop editing" data-id="${s.id}">${editorHtml(s)}</li>`;
      return `<li class="stop swipe ${cls}${newCls(s.id)}" data-id="${s.id}">
        <div class="swipe-bg"><span></span><span class="r">${ICON.del} Löschen</span></div>
        <div class="row-main">
          <span class="state">${state}</span>
          <div class="txt"><div class="q">${esc(s.query)}</div><div class="r">${sub}</div></div>
          ${pkPill(s)}
          <div class="acts"><button data-act="edit" aria-label="Bearbeiten">${ICON.edit}</button><button data-act="del" aria-label="Löschen">${ICON.del}</button></div>
        </div>
        ${s.status === 'err' && s.alts ? `<div class="alts">${s.alts.map((a, i) => `<button data-alt="${i}">${esc(a)}</button>`).join('')}</div>` : ''}
      </li>`;
    }).join('');
    wireEditor($('#stop-list'));
    const pending = stops.some(s => s.status === 'pending');
    const okCount = stops.filter(s => s.status === 'ok').length;
    const btn = $('#optimize-btn');
    btn.hidden = !!route;
    btn.disabled = pending || okCount === 0;
    btn.lastChild.textContent = pending ? ' Adressen werden gesucht …' : ` Route optimieren (${okCount})`;
    renderGreeting();
    renderDock();
  }

  function removeStop(id) {
    const s = stopById(id); if (!s) return;
    const idx = stops.indexOf(s);
    const backup = route ? { order: route.order.slice(), done: Object.assign({}, route.done) } : null;
    stops.splice(idx, 1);
    Sfx.remove();
    const after = () => { persist(); if (route) return plan(false); renderStops(); Map_.render(); };
    if (route) { route.order = route.order.filter(x => x !== id); delete route.done[id]; }
    after();
    toast(`„${s.query}“ gelöscht`, 6000, { label: 'Rückgängig', run() {
      stops.splice(Math.min(idx, stops.length), 0, s);
      if (route && backup) { route.order = backup.order.filter(x => stopById(x)); route.done = backup.done; }
      after();
    } });
  }

  $('#stop-list').addEventListener('click', e => {
    const b = e.target.closest('[data-act]');
    const li = e.target.closest('.stop'); if (!li || li.classList.contains('editing')) return;
    const alt = e.target.closest('[data-alt]');
    if (alt) {                                        // Korrekturvorschlag übernehmen
      const s = stopById(li.dataset.id);
      Object.assign(s, { query: s.alts[+alt.dataset.alt], status: 'pending', alts: null });
      persist(); renderStops(); runGeocoding(); return;
    }
    if (b && b.dataset.act === 'del') return removeStop(li.dataset.id);
    editingId = li.dataset.id; renderStops();        // Zeile oder Stift antippen = bearbeiten
  });

  $('#clear-btn').onclick = () => {
    if (!confirm('Alle Stopps entfernen?')) return;
    stops = []; route = null; persist(); renderStops(); renderResult();
  };

  /* ---------- Wischen: rechts = erledigt, links = löschen ---------- */
  function enableSwipe(listEl, { onRight, onLeft }) {
    let st = null;
    listEl.addEventListener('pointerdown', e => {
      const main = e.target.closest('.row-main'); if (!main || e.target.closest('button, a, input')) return;
      st = { main, li: main.closest('li'), x: e.clientX, y: e.clientY, dx: 0, on: false };
    });
    listEl.addEventListener('pointermove', e => {
      if (!st) return;
      const dx = e.clientX - st.x, dy = e.clientY - st.y;
      if (!st.on) {
        if (Math.abs(dy) > 12 && Math.abs(dy) > Math.abs(dx)) { st = null; return; }
        if (Math.abs(dx) < 14) return;
        st.on = true; st.li.classList.add('swiping'); try { st.main.setPointerCapture(e.pointerId); } catch (_) {}
      }
      st.dx = onRight ? dx : Math.min(0, dx);
      st.main.style.transform = `translateX(${st.dx}px)`;
      st.li.classList.toggle('to-right', st.dx > 0); st.li.classList.toggle('to-left', st.dx < 0);
      st.li.classList.toggle('armed', Math.abs(st.dx) > 96);
    });
    const end = () => {
      if (!st) return;
      const { main, li, dx, on } = st; st = null;
      if (!on) return;
      li.dataset.swiped = '1'; setTimeout(() => delete li.dataset.swiped, 80);     // Klick nach dem Wischen unterdrücken
      const id = li.dataset.id;
      if (dx > 96 && onRight) { main.style.transform = ''; li.classList.remove('swiping', 'armed'); onRight(id); }
      else if (dx < -96) { main.style.transition = 'transform .18s ease-in'; main.style.transform = 'translateX(-110%)'; setTimeout(() => onLeft(id), 170); }
      else { main.style.transition = 'transform .28s cubic-bezier(.3,1.4,.5,1)'; main.style.transform = ''; setTimeout(() => { main.style.transition = ''; li.classList.remove('swiping', 'armed', 'to-left', 'to-right'); }, 280); }
    };
    listEl.addEventListener('pointerup', end);
    listEl.addEventListener('pointercancel', end);
  }
  enableSwipe($('#stop-list'), { onLeft: removeStop });
  enableSwipe($('#route-list'), { onLeft: removeStop, onRight: id => toggleDone(id) });

  /* ---------- Eingabe & Diktat ---------- */
  function submitInput() {
    const raw = $('#addr-input').value;
    const lines = Speech.smartParse(raw, settings.smart);
    if (!lines.length) return toast('Bitte mindestens eine Adresse eingeben');
    const n = addAddresses(lines);
    $('#addr-input').value = ''; $('#addr-suggest').hidden = true;
    toast(n ? `${n} Adresse${n > 1 ? 'n' : ''} hinzugefügt` : 'Schon in der Liste – Pakete ergänzt');
  }
  $('#add-btn').onclick = submitInput;
  $('#addr-input').addEventListener('keydown', e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) submitInput(); });

  // Vorschläge für die Zeile, in der gerade getippt wird
  (function () {
    const ta = $('#addr-input'), box = $('#addr-suggest');
    let t;
    const current = () => {
      const pos = ta.selectionStart, v = ta.value;
      const a = v.lastIndexOf('\n', pos - 1) + 1; let b = v.indexOf('\n', pos); if (b === -1) b = v.length;
      return { a, b, text: v.slice(a, b) };
    };
    ta.addEventListener('input', () => {
      clearTimeout(t);
      const line = current(), p = Speech.parseLine(line.text);
      if (p.query.length < 2 || picked.has(p.query) || /\d\s*$/.test(p.query) && pickedPlace.has(Geo.norm(Geo.parseQuery(p.query).street))) { box.hidden = true; return; }
      t = setTimeout(async () => {
        try {
          const list = await suggestFor(p.query, settings.depot);
          const now = current();
          if (document.activeElement !== ta || now.text !== line.text) return;
          showSuggestions(box, list, r => {
            const c = current(), pk = Speech.parseLine(c.text).pk;
            if (r.local && !r.hasNumber) {            // nur die Straße gewählt: Hausnummer direkt weitertippen
              pickedPlace.set(Geo.norm(r.street), r.place);
              const text = r.street + ' ';
              ta.value = ta.value.slice(0, c.a) + text + ta.value.slice(c.b);
              const caret = c.a + text.length; ta.setSelectionRange(caret, caret); ta.focus();
              return;
            }
            const text = r.label + (pk ? ', ' + pkLabel(pk) : '');
            if (r.exact) picked.set(r.label, r);
            const tail = ta.value.slice(c.b);
            ta.value = ta.value.slice(0, c.a) + text + (tail.startsWith('\n') ? tail : '\n' + tail);
            const caret = c.a + text.length + 1; ta.setSelectionRange(caret, caret); ta.focus();
          });
        } catch (_) {}
      }, 120);
    });
    ta.addEventListener('blur', () => setTimeout(() => { box.hidden = true; }, 150));
  })();

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
      document.body.classList.toggle('listening', on);
      $('#mic-btn .mic-label').textContent = on ? 'Ich höre zu …' : 'Halten & sprechen';
    },
    onError(err) {
      if (err === 'unsupported') toast('Diktat geht in diesem Browser nicht – nutze das Mikrofon deiner Tastatur', 4000);
      else if (err === 'not-allowed' || err === 'service-not-allowed') toast('Mikrofon nicht freigegeben', 3500);
      else toast('Diktat-Fehler: ' + err);
    },
    onEnd() {                                   // losgelassen: Gesagtes direkt in die Liste
      setTimeout(() => { if ($('#addr-input').value.trim()) submitInput(); }, 150);
    },
  });
  (function () {
    // Gedrückt halten = sprechen, loslassen = fertig. Kurz antippen = an/aus.
    const mic = $('#mic-btn');
    let downAt = 0, wasActive = false, down = false;
    mic.addEventListener('pointerdown', e => {
      e.preventDefault(); down = true; downAt = Date.now(); wasActive = dict.active;
      try { mic.setPointerCapture(e.pointerId); } catch (_) {}
      if (!dict.active) { dict.start(); if (navigator.vibrate) navigator.vibrate(10); }
    });
    const up = () => {
      if (!down) return; down = false;
      const held = Date.now() - downAt;
      if (wasActive || held > 450) setTimeout(() => dict.stop(), 250);   // kurz nachlaufen, damit das letzte Wort ankommt
    };
    mic.addEventListener('pointerup', up);
    mic.addEventListener('pointercancel', up);
    mic.addEventListener('contextmenu', e => e.preventDefault());
    mic.addEventListener('click', e => e.preventDefault());
  })();
  document.addEventListener('focusin', e => { if (e.target.matches('input, textarea')) document.body.classList.add('typing'); });
  document.addEventListener('focusout', () => setTimeout(() => { if (!document.activeElement.matches('input, textarea')) document.body.classList.remove('typing'); }, 50));

  /* ---------- Planung ----------
     reopt = true: offene Stopps neu sortieren (erledigte bleiben vorn stehen)
     reopt = false: Reihenfolge behalten, nur Strecke neu berechnen (nach Löschen/Bearbeiten) */
  let planning = false, planAgain = null;
  async function plan(reopt) {
    if (planning) { planAgain = planAgain || reopt; return; }
    const depot = settings.depot;
    const ok = stops.filter(s => s.status === 'ok');
    if (!ok.length) { route = null; persist(); renderStops(); renderResult(); return; }
    if (ok.length > 99) return toast('Maximal 99 Stopps pro Tour');
    planning = true; setBusy(true);
    const prev = route, first = !prev;
    try {
      const inPrev = prev ? prev.order.map(stopById).filter(s => s && s.status === 'ok') : [];
      const doneStops = inPrev.filter(s => prev.done[s.id]);
      let rest = inPrev.filter(s => !prev.done[s.id]).concat(ok.filter(s => !inPrev.includes(s)));
      let saving = prev ? prev.saving : 0, source = 'osrm';
      if (reopt && rest.length > 1) {
        const start = doneStops.length ? doneStops[doneStops.length - 1] : depot;
        const pts = [start, ...rest];
        const backIdx = settings.roundtrip && start !== depot ? pts.push(depot) - 1 : 0;
        const M = await Geo.matrix(pts);
        const n = rest.length;
        const D = Array.from({ length: n + 1 }, (_, i) => M.dur[i].slice(0, n + 1));
        if (backIdx) for (let i = 1; i <= n; i++) D[i][0] = M.dur[i][backIdx];
        const naive = Optimize.tourCost(rest.map((_, i) => i + 1), D, settings.roundtrip);
        const { order, cost } = Optimize.solve(D, settings.roundtrip);
        rest = order.map(i => rest[i - 1]);
        source = M.source;
        if (first) saving = Math.max(0, naive - cost);
      }
      const ordered = [...doneStops, ...rest];
      const R = await Geo.route([depot, ...ordered, ...(settings.roundtrip ? [depot] : [])]);
      const done = {}; doneStops.forEach(s => { done[s.id] = true; });
      route = {
        order: ordered.map(s => s.id), legs: R.legs, geometry: R.geometry,
        source: R.source === 'osrm' && source === 'osrm' ? 'osrm' : 'luftlinie',
        saving, done, created: prev ? prev.created : Date.now(), roundtrip: settings.roundtrip,
      };
      persist(); renderStops(); renderResult();
      if (first) {
        const bad = stops.filter(s => s.status === 'err').length;
        if (bad) toast(`${bad} Adresse${bad > 1 ? 'n' : ''} nicht gefunden – steht unter „Noch offen“`, 3500);
        scrollTo({ top: 0, behavior: 'smooth' });
      }
      Pois.refresh();
    } catch (e) {
      toast('Route konnte nicht berechnet werden: ' + e.message, 4000);
    } finally {
      planning = false; setBusy(false);
      if (planAgain !== null) { const r = planAgain; planAgain = null; plan(r); }
    }
  }
  function setBusy(on) {
    document.body.classList.toggle('planning', on);
    const btn = $('#optimize-btn'); btn.classList.toggle('loading', on); if (on) btn.disabled = true;
    const db = $('#dock-opt'); if (db) { db.classList.toggle('loading', on); db.disabled = on; }
  }
  $('#optimize-btn').onclick = () => plan(true);

  /* ---------- Ergebnis ---------- */
  const currentIndex = () => route ? route.order.findIndex(id => !route.done[id]) : -1;
  let justDone = null;

  function toggleDone(id) {
    if (!route || !stopById(id)) return;
    if (route.done[id]) { delete route.done[id]; Sfx.uncheck(); }
    else {
      route.done[id] = true; justDone = id;
      if (route.order.every(x => route.done[x])) Sfx.done(); else Sfx.check();
    }
    if (openId === id) openId = null;
    persist(); renderResult(); justDone = null;
  }

  /** Abschnitte für Google Maps: jeweils höchstens 10 Ziele, ab dem nächsten offenen Stopp */
  function googleSections() {
    const d = settings.depot;
    const idx = route.order.map((id, i) => ({ s: stopById(id), i })).filter(x => !route.done[x.s.id]);
    const out = []; let origin = null;
    for (let k = 0; k < idx.length; k += 10) {
      const chunk = idx.slice(k, k + 10), last = k + 10 >= idx.length;
      const toDepot = last && route.roundtrip && chunk.length < 10;
      const pts = chunk.map(x => x.s);
      out.push({
        url: toDepot ? googleMultiUrl(origin, pts, d) : googleMultiUrl(origin, pts.slice(0, -1), pts[pts.length - 1]),
        title: `Stopp ${chunk[0].i + 1}–${chunk[chunk.length - 1].i + 1}`, count: chunk.length,
        from: pts[0].label.split(',')[0], to: toDepot ? d.name : pts[pts.length - 1].label.split(',')[0],
      });
      origin = pts[pts.length - 1];
    }
    if (route.roundtrip && (idx.length % 10 === 0)) out.push({ url: googleMultiUrl(origin, [], d), title: 'Zurück zum Depot', count: 0, from: origin ? origin.label.split(',')[0] : 'Standort', to: d.name });
    return out;
  }

  function renderResult() {
    if (route && !route.order.every(id => { const s = stopById(id); return s && s.status === 'ok'; })) {
      route.order = route.order.filter(id => { const s = stopById(id); return s && s.status === 'ok'; });
      if (!route.order.length) route = null;
      persist();
    }
    document.body.classList.toggle('has-route', !!route);
    if (!route) { $('#result').hidden = true; Pois.list = []; Map_.render(); renderDock(); return; }
    $('#result').hidden = false;

    const n = route.order.length;
    const ordered = route.order.map(stopById);
    const doneCount = ordered.filter(s => route.done[s.id]).length;
    const totalDist = route.legs.reduce((a, l) => a + l.dist, 0);
    const totalDur = route.legs.reduce((a, l) => a + l.dur, 0);
    const service = (settings.stopMin || 0) * 60;
    const anyPk = ordered.some(s => s.pk);
    const pkTotal = ordered.reduce((a, s) => a + (s.pk || 1), 0);
    const pkDone = ordered.filter(s => route.done[s.id]).reduce((a, s) => a + (s.pk || 1), 0);

    // Ankunftszeiten ab jetzt hochrechnen; legs[i] führt zu Stopp i, legs[n] (nur Rundtour) zurück zum Depot
    const cur = currentIndex();
    const etas = []; let t = Date.now();
    if (cur !== -1) {
      for (let i = cur; i < n; i++) {
        if (route.done[route.order[i]]) continue;
        t += route.legs[i].dur * 1000; etas[i] = new Date(t); t += service * 1000;
      }
    }
    if (route.roundtrip && route.legs[n]) t += route.legs[n].dur * 1000;
    const endAt = new Date(t);
    const d = settings.depot;

    // Nächster Stopp
    const app = NAV[settings.nav];
    const nc = $('#next-card');
    if (cur !== -1) {
      const s = ordered[cur], leg = route.legs[cur];
      nc.innerHTML = `
        <div class="eyebrow">Nächster Stopp · ${cur + 1} von ${n}</div>
        <h3>${esc(s.label.split(',')[0])}</h3>
        <div class="sub">${esc(s.label.split(',').slice(1).join(',').trim())} · ${fmtDur(leg.dur)} · ${fmtKm(leg.dist)}${s.pk ? ' · ' + pkLabel(s.pk) : ''}</div>
        <div class="next-actions">
          <a class="btn" href="${navUrl(s)}" target="_blank" rel="noopener">${ICON.nav} Mit ${app.name} starten</a>
          <button class="btn secondary" data-done="${s.id}">${ICON.check} Erledigt</button>
        </div>
        <div class="progress"><span style="width:${doneCount / n * 100}%"></span></div>`;
    } else {
      nc.innerHTML = `
        <div class="eyebrow">Alle ${n} Stopps erledigt</div>
        <h3>${route.roundtrip ? 'Zurück zum Depot' : 'Tour geschafft'}</h3>
        <div class="sub">${route.roundtrip && route.legs[n] ? esc(d.name) + ' · ' + fmtDur(route.legs[n].dur) : 'Starke Arbeit heute.'}</div>
        <div class="next-actions">${route.roundtrip ? `<a class="btn" href="${navUrl(d)}" target="_blank" rel="noopener">${ICON.nav} Zum Depot</a>` : ''}<button class="btn${route.roundtrip ? ' secondary' : ''}" data-finish>${ICON.check} Tour beenden</button></div>
        <div class="progress"><span style="width:100%"></span></div>`;
    }

    // Übersicht: jede Zahl mit Beschriftung und Einheit
    const open = n - doneCount;
    $('#stats').innerHTML = `
      <div class="ov-head"><h2>Tour-Überblick</h2><span>${open ? `noch ${open} von ${n} Stopps` : 'alles erledigt'}</span></div>
      <dl class="ov">
        <div><dt>Stopps erledigt</dt><dd>${doneCount} von ${n}</dd></div>
        ${anyPk ? `<div><dt>Pakete zugestellt</dt><dd>${pkDone} von ${pkTotal}</dd></div>` : ''}
        <div><dt>Strecke gesamt</dt><dd>${fmtKm(totalDist)}</dd></div>
        <div><dt>Reine Fahrzeit</dt><dd>${fmtDur(totalDur)}</dd></div>
        <div><dt>${route.roundtrip ? 'Zurück am Depot' : 'Tour zu Ende'}</dt><dd>ca. ${fmtTime(endAt)} Uhr</dd></div>
      </dl>
      ${route.saving > 90 ? `<div class="saving">Die optimierte Reihenfolge spart ${fmtDur(route.saving)} Fahrzeit.</div>` : ''}
      ${route.source !== 'osrm' ? '<div class="saving" style="color:var(--warn)">Routing-Dienst nicht erreichbar – Werte geschätzt (Luftlinie)</div>' : ''}`;

    // Liste
    const rows = [`<li class="depot"><div class="row-main"><span class="num">${HOME_ICON}</span><div class="txt"><div class="q">${esc(d.name)}</div><div class="meta">Start · ${esc(d.label)}</div></div></div></li>`];
    ordered.forEach((s, i) => {
      const done = !!route.done[s.id], eta = etas[i];
      if (editingId === s.id) { rows.push(`<li class="editing" data-id="${s.id}">${editorHtml(s)}</li>`); return; }
      const [l1, ...l2] = s.label.split(',');
      const meta = [l2.join(',').trim(), done ? 'erledigt' : (eta ? 'Ankunft ca. ' + fmtTime(eta) + ' Uhr' : ''), s.approx ? 'Hausnr. ungefähr' : ''].filter(Boolean).join(' · ');
      rows.push(`<li data-id="${s.id}" class="swipe${done ? ' done' : ''}${i === cur ? ' current' : ''}${openId === s.id ? ' open' : ''}${justDone === s.id ? ' just-done' : ''}${newCls(s.id)}">
        <div class="swipe-bg"><span class="l">${ICON.check} ${done ? 'Wieder offen' : 'Erledigt'}</span><span class="r">${ICON.del} Löschen</span></div>
        <div class="row-main">
          <span class="num">${i + 1}</span>
          <div class="txt"><div class="q"><span>${esc(l1)}</span></div><div class="meta">${esc(meta)}</div></div>
          ${pkPill(s)}
          <button class="check" data-done="${s.id}" aria-pressed="${done}" aria-label="Erledigt">${ICON.check}</button>
        </div>
        ${openId === s.id ? `<div class="tray">
          <a class="btn primary" href="${navUrl(s)}" target="_blank" rel="noopener">${ICON.nav} ${app.name}</a>
          <button class="btn ghost" data-row="map">${PIN_ICON} Karte</button>
          <button class="btn ghost" data-row="edit">${ICON.edit} Bearbeiten</button>
          <button class="btn ghost danger" data-row="del">${ICON.del} Löschen</button>
        </div>` : ''}
      </li>`);
    });
    if (route.roundtrip && route.legs[n]) {
      rows.push(`<li class="depot"><div class="row-main"><span class="num">${HOME_ICON}</span><div class="txt"><div class="q">${esc(d.name)}</div><div class="meta">Ende · Ankunft ca. ${fmtTime(endAt)} Uhr</div></div></div></li>`);
    }
    $('#route-list').innerHTML = rows.join('');
    wireEditor($('#route-list'));
    Map_.render();
    renderDock();
  }

  document.addEventListener('click', e => {
    const b = e.target.closest('[data-done]'); if (!b || !route) return;
    toggleDone(b.dataset.done);
  });
  $('#route-list').addEventListener('click', e => {
    const li = e.target.closest('li[data-id]'); if (!li || li.dataset.swiped || li.classList.contains('editing')) return;
    const id = li.dataset.id, act = e.target.closest('[data-row]');
    if (act) {
      if (act.dataset.row === 'del') return removeStop(id);
      if (act.dataset.row === 'edit') { editingId = id; openId = null; return renderResult(); }
      if (act.dataset.row === 'map') { const s = stopById(id); if (!wide()) Map_.setFull(true); setTimeout(() => Map_.flyTo(s), 250); return; }
    }
    if (e.target.closest('a,button')) return;
    openId = openId === id ? null : id;
    renderResult();
  });
  function focusRouteItem(id) {
    if (Map_.full && !wide()) Map_.setFull(false);
    openId = id; renderResult();
    setTimeout(() => { const li = document.querySelector(`#route-list li[data-id="${id}"]`); if (li) li.scrollIntoView({ behavior: 'smooth', block: 'center' }); }, 120);
  }

  /* ---------- Blatt: Menü, Google-Abschnitte, Paketstellen ---------- */
  function openSheet(title, html) {
    $('#sheet-title').textContent = title; $('#sheet-body').innerHTML = html; $('#sheet').hidden = false;
  }
  const closeSheet = () => { $('#sheet').hidden = true; };
  $('#sheet-close').onclick = closeSheet;
  $('#sheet').addEventListener('click', e => { if (e.target.id === 'sheet') closeSheet(); });

  const CHEV = '<svg viewBox="0 0 24 24" class="chev"><path d="M9 6l6 6-6 6"/></svg>';
  function openMenu() {
    if (!route) return;
    const sec = googleSections();
    const open = route.order.filter(id => !route.done[id]).length;
    openSheet('Tour', `<div class="menu">
      ${sec.length === 1 ? `<a class="menu-item" href="${sec[0].url}" target="_blank" rel="noopener">${NAV.google.icon}<span><b>Restliche Route in Google Maps</b><small>${open} Stopp${open === 1 ? '' : 's'} ab deinem Standort</small></span>${CHEV}</a>`
        : sec.length ? `<button class="menu-item" data-menu="google">${NAV.google.icon}<span><b>Route in Google Maps</b><small>${open} Stopps in ${sec.length} Abschnitten</small></span>${CHEV}</button>` : ''}
      <button class="menu-item" data-menu="reopt" ${open < 2 ? 'disabled' : ''}>${ICON.route}<span><b>Offene Stopps neu optimieren</b><small>Erledigte bleiben stehen</small></span></button>
      <button class="menu-item" data-menu="share"><svg viewBox="0 0 24 24"><path d="M12 15V4M8 8l4-4 4 4M5 13v6h14v-6"/></svg><span><b>Liste teilen oder kopieren</b><small>Reihenfolge als Text</small></span></button>
      <button class="menu-item" data-menu="reset"><svg viewBox="0 0 24 24"><path d="M4 12a8 8 0 1 0 2.6-5.9M4 4v4h4"/></svg><span><b>Alle Haken zurücksetzen</b></span></button>
      <button class="menu-item" data-menu="finish"><svg viewBox="0 0 24 24"><path d="M5 21V4M5 4h12l-2.5 4L17 12H5"/></svg><span><b>Tour beenden &amp; speichern</b><small>Kommt mit Datum in den Verlauf</small></span></button>
      <button class="menu-item danger" data-menu="end">${ICON.del}<span><b>Tour verwerfen</b><small>Alle Stopps löschen, nichts speichern</small></span></button>
    </div>`);
  }
  function openGoogleSheet() {
    const sec = googleSections();
    openSheet('Route in Google Maps', `<p class="sheet-note">Google Maps nimmt höchstens 10 Ziele auf einmal. Öffne die Abschnitte der Reihe nach – der erste startet an deinem Standort.</p>
      <div class="menu">${sec.map((p, k) => `<a class="menu-item${k === 0 ? ' now' : ''}" href="${p.url}" target="_blank" rel="noopener">
        <span class="sec-num">${k + 1}</span><span><b>${p.title}${k === 0 ? ' · jetzt' : ''}</b><small>${esc(p.from)} → ${esc(p.to)}</small></span>${CHEV}</a>`).join('')}</div>`);
  }
  $('#more-btn').onclick = openMenu;
  $('#sheet-body').addEventListener('click', async e => {
    const m = e.target.closest('[data-menu]');
    if (m) {
      const a = m.dataset.menu;
      if (a === 'google') return openGoogleSheet();
      closeSheet();
      if (a === 'reopt') { plan(true); toast('Offene Stopps werden neu sortiert …'); }
      if (a === 'reset') { route.done = {}; persist(); renderResult(); }
      if (a === 'finish') return finishTour();
      if (a === 'end') { if (confirm('Tour verwerfen? Sie wird nicht im Verlauf gespeichert.')) { stops = []; route = null; persist(); renderStops(); renderResult(); } }
      if (a === 'share') {
        const d = settings.depot;
        const txt = [`Start: ${d.name} – ${d.label}`, ...route.order.map(stopById).map((s, i) => `${i + 1}. ${s.label}${s.pk ? ' (' + pkLabel(s.pk) + ')' : ''}`), route.roundtrip ? `Ende: ${d.name}` : ''].filter(Boolean).join('\n');
        try {
          if (navigator.share && matchMedia('(pointer:coarse)').matches) await navigator.share({ title: 'Tour', text: txt });
          else { await navigator.clipboard.writeText(txt); toast('Reihenfolge kopiert'); }
        } catch (_) {}
      }
      return;
    }
    const p = e.target.closest('[data-poi]');
    if (p) {
      const poi = Pois.list.find(x => x.id === p.dataset.poi); if (!poi) return;
      if (p.dataset.act === 'show') { closeSheet(); if (!wide()) Map_.setFull(true); setTimeout(() => Map_.flyTo(poi), 250); return; }
      closeSheet();
      stops.push({ id: uid(), query: poi.name, label: poi.name + (poi.addr ? ', ' + poi.addr : ''), lat: poi.lat, lon: poi.lon, status: 'ok', poi: poi.id, pk: null });
      Pois.list = Pois.list.filter(x => x !== poi);
      persist(); plan(true);
      toast(`${poi.name} als Stopp eingefügt`);
    }
  });

  function poiStatus(p) {
    const st = Pois.state(p), at = fmtTime(Pois.passTime(p));
    if (st.open === true) return { cls: 'open', text: p.hours === '24/7' ? 'rund um die Uhr' : `offen, wenn du vorbeikommst (ca. ${at})${st.until ? ' · bis ' + st.until : ''}` };
    if (st.open === false) return { cls: 'closed', text: `ca. ${at} geschlossen${st.from ? ' · öffnet ' + st.from : ''}` };
    return { cls: 'unknown', text: 'Öffnungszeiten nicht hinterlegt' };
  }
  function openPoiSheet(focusId) {
    const list = Pois.list.slice().sort((a, b) => (a.id === focusId ? -1 : b.id === focusId ? 1 : 0));
    openSheet('Paketstellen an der Route', `<p class="sheet-note">Packstationen und Postfilialen bis etwa 700 m neben deiner Strecke, in Fahrtrichtung sortiert. Daten aus OpenStreetMap.</p>
      <div class="poi-list">${list.map(p => { const st = poiStatus(p); return `<div class="poi ${st.cls}">
        <span class="poi-pin ${p.kind}">${p.kind === 'locker' ? 'P' : MAIL_ICON}</span>
        <div class="txt"><b>${esc(p.name)}</b><small>${esc(p.addr || 'ohne Adresse')} · ${p.off < 50 ? 'direkt an der Route' : p.off + ' m abseits'}</small><small class="st">${st.text}</small></div>
        <div class="poi-acts"><button class="btn ghost" data-poi="${p.id}" data-act="show">Karte</button><button class="btn primary" data-poi="${p.id}" data-act="add">+ Stopp</button></div>
      </div>`; }).join('')}</div>`);
  }
  $('#poi-chip').onclick = () => openPoiSheet();


  /* ---------- Tour beenden & Verlauf ---------- */
  const dayKey = d => { const x = new Date(d); return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`; };
  const fmtDay = d => new Date(d).toLocaleDateString('de-DE', { weekday: 'short', day: 'numeric', month: 'long', year: 'numeric' });

  function finishTour() {
    if (!route) return;
    const ordered = route.order.map(stopById).filter(Boolean);
    const open = ordered.filter(s => !route.done[s.id]).length;
    if (open && !confirm(`Noch ${open} Stopp${open === 1 ? '' : 's'} offen. Tour trotzdem beenden und speichern?`)) return;
    closeSheet();
    history_.unshift({
      id: uid(), start: route.created, end: Date.now(), depot: settings.depot.name,
      stops: ordered.length, done: ordered.length - open,
      pk: ordered.some(s => s.pk) ? ordered.reduce((a, s) => a + (s.pk || 1), 0) : null,
      pkDone: ordered.filter(s => route.done[s.id]).reduce((a, s) => a + (s.pk || 1), 0),
      dist: Math.round(route.legs.reduce((a, l) => a + l.dist, 0)), dur: Math.round(route.legs.reduce((a, l) => a + l.dur, 0)),
      list: ordered.map(s => ({ q: s.label, pk: s.pk || null, done: !!route.done[s.id] })),
    });
    history_ = history_.slice(0, 300);
    save('tp.history', history_);
    stops = []; route = null; openId = editingId = null;
    persist(); renderStops(); renderResult();
    Sfx.done();
    scrollTo({ top: 0, behavior: 'smooth' });
    toast('Tour gespeichert', 6000, { label: 'Verlauf ansehen', run: () => openHistory() });
  }
  document.addEventListener('click', e => { if (e.target.closest('[data-finish]')) finishTour(); });
  $('#finish-btn').onclick = finishTour;

  let histMonth = null, histDay = null;
  function openHistory(month) {
    const now = new Date();
    histMonth = month || histMonth || new Date(now.getFullYear(), now.getMonth(), 1);
    const y = histMonth.getFullYear(), m = histMonth.getMonth();
    const byDay = {};
    history_.forEach(t => { (byDay[dayKey(t.end)] = byDay[dayKey(t.end)] || []).push(t); });
    const first = (new Date(y, m, 1).getDay() + 6) % 7, days = new Date(y, m + 1, 0).getDate();
    const cells = [];
    for (let i = 0; i < first; i++) cells.push('<span></span>');
    for (let d = 1; d <= days; d++) {
      const k = dayKey(new Date(y, m, d)), has = byDay[k];
      cells.push(`<button class="cal-day${has ? ' has' : ''}${k === dayKey(now) ? ' today' : ''}${k === histDay ? ' sel' : ''}" ${has ? `data-day="${k}"` : 'disabled'}>${d}${has ? `<i>${has.reduce((a, t) => a + t.stops, 0)}</i>` : ''}</button>`);
    }
    const inMonth = history_.filter(t => { const e = new Date(t.end); return e.getFullYear() === y && e.getMonth() === m; });
    const shown = histDay && byDay[histDay] ? byDay[histDay] : inMonth;
    const sum = inMonth.reduce((a, t) => ({ stops: a.stops + t.stops, km: a.km + t.dist / 1000 }), { stops: 0, km: 0 });
    openSheet('Verlauf', `
      <div class="cal-head"><button class="btn ghost icon" data-cal="-1" aria-label="Vorheriger Monat"><svg viewBox="0 0 24 24"><path d="M15 6l-6 6 6 6"/></svg></button>
        <b>${histMonth.toLocaleDateString('de-DE', { month: 'long', year: 'numeric' })}</b>
        <button class="btn ghost icon" data-cal="1" aria-label="Nächster Monat"><svg viewBox="0 0 24 24"><path d="M9 6l6 6-6 6"/></svg></button></div>
      <div class="cal"><em>Mo</em><em>Di</em><em>Mi</em><em>Do</em><em>Fr</em><em>Sa</em><em>So</em>${cells.join('')}</div>
      <p class="sheet-note" style="margin:14px 0 10px">${inMonth.length ? `${inMonth.length} Tour${inMonth.length === 1 ? '' : 'en'} in diesem Monat · ${sum.stops} Stopps · ${Math.round(sum.km)} km${histDay && byDay[histDay] ? ` · gezeigt: ${fmtDay(histDay)} <button class="link" data-day="">alle zeigen</button>` : ''}` : (history_.length ? 'In diesem Monat keine Touren.' : 'Noch keine Touren gespeichert. Beende eine Tour mit „Tour beenden &amp; speichern“, dann erscheint sie hier.')}</p>
      <div class="menu">${shown.map(t => `<button class="menu-item" data-tour="${t.id}"><span class="sec-num">${new Date(t.end).getDate()}</span>
        <span><b>${fmtDay(t.end)}</b><small>${t.done} von ${t.stops} Stopps${t.pk ? ` · ${t.pkDone} von ${t.pk} Paketen` : ''} · ${fmtKm(t.dist)} · beendet ${fmtTime(new Date(t.end))} Uhr</small></span>${CHEV}</button>`).join('')}</div>`);
  }
  function openTour(id) {
    const t = history_.find(x => x.id === id); if (!t) return;
    openSheet(fmtDay(t.end), `
      <dl class="ov">
        <div><dt>Stopps erledigt</dt><dd>${t.done} von ${t.stops}</dd></div>
        ${t.pk ? `<div><dt>Pakete zugestellt</dt><dd>${t.pkDone} von ${t.pk}</dd></div>` : ''}
        <div><dt>Strecke</dt><dd>${fmtKm(t.dist)}</dd></div>
        <div><dt>Reine Fahrzeit</dt><dd>${fmtDur(t.dur)}</dd></div>
        <div><dt>Zeitraum</dt><dd>${fmtTime(new Date(t.start))}–${fmtTime(new Date(t.end))} Uhr</dd></div>
      </dl>
      <ol class="hist-list">${t.list.map(x => `<li class="${x.done ? '' : 'open'}">${esc(x.q)}${x.pk ? ` <i>${pkLabel(x.pk)}</i>` : ''}${x.done ? '' : ' <em>nicht erledigt</em>'}</li>`).join('')}</ol>
      <div class="row-actions"><button class="btn ghost danger" data-tour-del="${t.id}">Löschen</button><button class="btn ghost" data-hist-back>Zurück</button><button class="btn primary" data-tour-load="${t.id}">Adressen neu laden</button></div>`);
  }
  $('#history-open').onclick = () => { histDay = null; histMonth = null; openHistory(); };
  $('#sheet-body').addEventListener('click', e => {
    const cal = e.target.closest('[data-cal]');
    if (cal) return openHistory(new Date(histMonth.getFullYear(), histMonth.getMonth() + +cal.dataset.cal, 1));
    const day = e.target.closest('[data-day]');
    if (day) { histDay = day.dataset.day || null; return openHistory(); }
    const tour = e.target.closest('[data-tour]');
    if (tour) return openTour(tour.dataset.tour);
    if (e.target.closest('[data-hist-back]')) return openHistory();
    const del = e.target.closest('[data-tour-del]');
    if (del) { if (!confirm('Diese Tour aus dem Verlauf löschen?')) return; history_ = history_.filter(x => x.id !== del.dataset.tourDel); save('tp.history', history_); return openHistory(); }
    const ld = e.target.closest('[data-tour-load]');
    if (ld) {
      const t = history_.find(x => x.id === ld.dataset.tourLoad);
      if ((stops.length || route) && !confirm('Die Adressen kommen zu deiner aktuellen Liste dazu. Fortfahren?')) return;
      closeSheet();
      const n = addAddresses(t.list.map(x => x.q + (x.pk ? ', ' + pkLabel(x.pk) : '')));
      toast(`${n} Adresse${n === 1 ? '' : 'n'} geladen`);
    }
  });

  /* ---------- Daumen-Leiste (Handy) ---------- */
  function renderDock() {
    const dock = $('#dock');
    const okCount = stops.filter(s => s.status === 'ok').length;
    const pending = stops.some(s => s.status === 'pending');
    if (route) {
      const cur = currentIndex(), n = route.order.length;
      const s = cur !== -1 ? stopById(route.order[cur]) : settings.depot;
      const title = cur !== -1 ? s.label.split(',')[0] : (route.roundtrip ? 'Zurück zum Depot' : 'Tour geschafft');
      const sub = cur !== -1 ? `Stopp ${cur + 1} von ${n} · ${fmtDur(route.legs[cur].dur)}${s.pk ? ' · ' + pkLabel(s.pk) : ''}` : `Alle ${n} Stopps erledigt`;
      const canNav = cur !== -1 || route.roundtrip;
      dock.innerHTML = `
        <button class="dock-info" id="dock-info"><b>${esc(title)}</b><span>${sub}</span></button>
        ${cur !== -1 ? `<button class="dock-btn ghost" data-done="${s.id}" aria-label="Erledigt">${ICON.check}</button>` : ''}
        ${canNav ? `<a class="dock-btn primary" href="${navUrl(s)}" target="_blank" rel="noopener" aria-label="Navigieren">${ICON.nav}<span>Los</span></a>` : ''}`;
      $('#dock-info').onclick = () => { if (Map_.full) Map_.setFull(false); scrollTo({ top: 0, behavior: 'smooth' }); };
      dock.hidden = false;
    } else if (stops.length) {
      dock.innerHTML = `<button class="dock-wide${planning ? ' loading' : ''}" id="dock-opt" ${pending || !okCount || planning ? 'disabled' : ''}>
          ${ICON.route}
          ${pending ? 'Adressen werden gesucht …' : `Route optimieren (${okCount})`}</button>`;
      $('#dock-opt').onclick = () => plan(true);
      dock.hidden = false;
    } else dock.hidden = true;
    document.body.classList.toggle('has-dock', !dock.hidden);
  }

  /* ---------- Kopf ---------- */
  function renderGreeting() {
    const h = new Date().getHours();
    const g = h < 11 ? 'Guten Morgen' : h < 17 ? 'Hallo' : 'Guten Abend';
    const ok = stops.filter(s => s.status === 'ok').length;
    $('#greeting').innerHTML = `${g}${settings.name ? ', ' + esc(settings.name) : ''}.<small>${ok ? `${ok} Stopp${ok > 1 ? 's' : ''} ab ` : 'Start und Ziel: '}<button class="depot-link" id="depot-link">${esc(settings.depot?.name || 'Depot')}</button></small>`;
    $('#depot-link').onclick = openSettings;
    const c = Geo.streetCount();
    $('#area-hint').textContent = c ? `${c.streets} Straßen in ${c.places} Orten bekannt` : 'eine pro Zeile';
  }

  /* ---------- Straßenverzeichnis laden ---------- */
  let indexState = '';
  async function loadIndex(force) {
    if (!settings.depot || indexState === 'loading') return;
    indexState = 'loading'; renderIndexInfo();
    try { await Geo.loadStreets(settings.depot, force); indexState = ''; }
    catch (_) { indexState = 'error'; }
    renderIndexInfo(); renderGreeting();
  }
  function renderIndexInfo() {
    const c = Geo.streetCount(), el = $('#s-index');
    el.innerHTML = `<span><b>Straßenverzeichnis</b><small>${indexState === 'loading' ? 'wird geladen …' : c ? `${c.streets} Straßen in ${c.places} Orten im Umkreis von 12 km um dein Depot · Stand ${new Date(c.ts).toLocaleDateString('de-DE')}` : indexState === 'error' ? 'gerade nicht erreichbar – Vorschläge kommen solange vom Online-Dienst' : 'noch nicht geladen'}</small></span>
      <button class="btn ghost" id="s-index-load" ${indexState === 'loading' ? 'disabled' : ''}>Aktualisieren</button>`;
    $('#s-index-load').onclick = () => loadIndex(true);
  }

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
    $('#s-pois').checked = settings.pois;
    $('#s-sound').checked = settings.sound;
    $('#s-stopmin').value = settings.stopMin;
    renderNavChoices($('#s-nav'), true);
    renderThemeChoices($('#s-theme'));
    renderIndexInfo();
    $('#settings').hidden = false;
  }
  const closeSettings = () => { $('#settings').hidden = true; };
  $('#settings-open').onclick = openSettings;
  $('#settings-close').onclick = closeSettings;
  $('#settings').addEventListener('click', e => { if (e.target.id === 'settings') closeSettings(); });
  addEventListener('keydown', e => {
    if (e.key !== 'Escape') return;
    if (!$('#sheet').hidden) closeSheet(); else if (!$('#settings').hidden) closeSettings(); else if (Map_.full) Map_.setFull(false);
  });
  $('#s-depot-addr').addEventListener('input', () => { pendingDepot = null; $('#s-depot-result').hidden = true; });
  attachSuggest($('#s-depot-addr'), $('#s-suggest'), () => settings.depot, r => { if (!r.exact) return; pendingDepot = r; showDepotResult($('#s-depot-result'), r, 'Ausgewählt'); });
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
    const before = JSON.stringify([settings.depot && [settings.depot.lat, settings.depot.lon], settings.roundtrip]);
    settings.name = $('#s-name').value.trim();
    if (pendingDepot) settings.depot = Object.assign({}, pendingDepot, { query: q });
    if (settings.depot) settings.depot.name = $('#s-depot-name').value.trim() || 'Depot';
    settings.nav = $('#s-nav').dataset.value;
    settings.roundtrip = $('#s-roundtrip').checked;
    settings.smart = $('#s-ai').checked;
    settings.pois = $('#s-pois').checked;
    settings.sound = $('#s-sound').checked;
    settings.stopMin = Math.max(0, Math.min(30, +$('#s-stopmin').value || 0));
    persist(); closeSettings(); renderStops(); renderResult();
    loadIndex(false);
    if (JSON.stringify([settings.depot && [settings.depot.lat, settings.depot.lon], settings.roundtrip]) !== before && route) { toast('Gespeichert – Route wird neu berechnet'); plan(true); }
    else { toast('Gespeichert'); Pois.key = ''; Pois.refresh(); }
  };
  $('#s-reset').onclick = () => {
    if (!confirm('Alle Einstellungen, Stopps und den Verlauf löschen?')) return;
    ['tp.settings', 'tp.stops', 'tp.route', 'tp.history', 'tp.streets.v1'].forEach(k => localStorage.removeItem(k));
    location.reload();
  };

  /* ---------- Start ---------- */
  function startApp() {
    $('#app').hidden = false;
    stops.forEach(s => { delete s.busy; seenIds.add(s.id); });
    applyTheme();
    renderStops();
    renderResult();
    Map_.syncTouch();
    runGeocoding();
    Pois.refresh();
    loadIndex(false);
  }

  applyTheme();
  if (!settings.onboarded || !settings.depot) startOnboarding(); else startApp();

  if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});
})();
