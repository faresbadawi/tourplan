/* Tourplan – App-Logik */
(function () {
  const $ = s => document.querySelector(s);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const uid = () => Math.random().toString(36).slice(2, 10);

  /* ---------- Zustand ---------- */
  const DEFAULTS = { name: '', depot: null, nav: 'waze', theme: 'auto', roundtrip: true, smart: true, stopMin: 2, sound: true, pois: true, accent: 'blue', mapStyle: 'vec', area: null, tomtom: '', meIcon: 'arrow' };
  const load = (k, d) => { try { const v = JSON.parse(localStorage.getItem(k)); return v ?? d; } catch (_) { return d; } };
  const save = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (_) {} };

  let settings = Object.assign({}, DEFAULTS, load('tp.settings', {}));
  if (!settings.mapV2) { settings.mapStyle = 'vec'; settings.mapV2 = 1; }       // neue Vektorkarte als Standard
  // Einrichtung von einem anderen Gerät übernehmen (Link aus den Einstellungen)
  let imported = false;
  try {
    const m = location.hash.match(/^#setup=(.+)$/);
    if (m) {
      const data = JSON.parse(decodeURIComponent(escape(atob(m[1].replace(/-/g, '+').replace(/_/g, '/')))));
      if (data && data.depot && typeof data.depot.lat === 'number') { settings = Object.assign({}, DEFAULTS, data, { onboarded: true }); save('tp.settings', settings); imported = true; }
      history.replaceState(null, '', location.pathname + location.search);
    }
  } catch (_) {}
  let stops = load('tp.stops', []);
  let route = load('tp.route', null);
  if (route) delete route._sum;                     // Altlast aus Version 4/5
  let history_ = load('tp.history', []);
  const persist = () => { save('tp.settings', settings); save('tp.stops', stops); save('tp.route', route); };

  /* ---------- Navi-Apps ---------- */
  const NAV = {
    waze:   { name: 'Waze', color: '#33CCFF', ink: '#0B2C3A', icon: '<svg viewBox="0 0 24 24"><path d="M5 15.5a7.5 7.5 0 1 1 14.6-2.4c0 2.7-1.8 4.6-4.6 5.3"/><circle cx="9.5" cy="10.5" r=".6" fill="currentColor"/><circle cx="14.5" cy="10.5" r=".6" fill="currentColor"/><path d="M9.5 13.5c1.3 1.2 3.7 1.2 5 0"/><circle cx="8" cy="19" r="1.6"/><circle cx="15" cy="19" r="1.6"/></svg>' },
    google: { name: 'Google Maps', color: '#1A73E8', ink: '#fff', icon: '<svg viewBox="0 0 24 24"><path d="M12 21s-6.5-6-6.5-11a6.5 6.5 0 0 1 13 0c0 5-6.5 11-6.5 11z"/><circle cx="12" cy="10" r="2.4"/></svg>' },
    apple:  { name: 'Apple Karten', color: '#34C759', ink: '#fff', icon: '<svg viewBox="0 0 24 24"><path d="M4 7l5-2 6 2 5-2v12l-5 2-6-2-5 2z"/><path d="M9 5v12M15 7v12"/></svg>' },
    geo:    { name: 'Andere Karten-App', color: '#7B61FF', ink: '#fff', icon: '<svg viewBox="0 0 24 24"><path d="M12 21s-6.5-6-6.5-11a6.5 6.5 0 0 1 13 0c0 5-6.5 11-6.5 11z"/><circle cx="12" cy="10" r="2.4"/></svg>' },
    mapsme: { name: 'MAPS.ME', color: '#2FB75A', ink: '#fff', icon: '<svg viewBox="0 0 24 24"><path d="M4 6.5 9 4l6 2.5L20 4v13.5L15 20l-6-2.5L4 20z"/><path d="M9 4v13.5M15 6.5V20"/></svg>' },
  };
  const ll = p => `${p.lat.toFixed(6)},${p.lon.toFixed(6)}`;
  const IS_APPLE = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const IS_ANDROID = /Android/i.test(navigator.userAgent);
  /** Apple Karten gibt es nur auf Apple-Geräten; auf Android öffnet der Link nur eine Webseite – dort nimmt die App Google Maps */
  const navKey = () => ((settings.nav === 'apple' && !IS_APPLE) || (settings.nav === 'geo' && !IS_ANDROID) ? 'google' : (NAV[settings.nav] ? settings.nav : 'google'));
  function mapsmeUrl(dll, name, me) {       // Route (mit Startpunkt) oder nur der Zielpunkt
    const n = encodeURIComponent(name || 'Ziel');
    const q = me ? `route?sll=${me.lat.toFixed(6)},${me.lon.toFixed(6)}&saddr=${encodeURIComponent('Mein Standort')}&dll=${dll}&daddr=${n}&type=vehicle` : `map?v=1&ll=${dll}&n=${n}`;
    if (!IS_ANDROID) return `mapsme://${q}`;
    const store = encodeURIComponent('https://play.google.com/store/apps/details?id=com.mapswithme.maps.pro');
    return `intent://${q}#Intent;scheme=mapsme;package=com.mapswithme.maps.pro;S.browser_fallback_url=${store};end`;
  }
  function navUrl(p, app = navKey()) {
    if (app === 'waze') return `https://waze.com/ul?ll=${ll(p)}&navigate=yes`;
    if (app === 'geo') return `geo:${ll(p)}?q=${ll(p)}(${encodeURIComponent((p.label || p.name || 'Ziel').split(',')[0])})`;   // Android fragt, welche Karten-App (z. B. MAPS.ME, Organic Maps)
    if (app === 'apple') return `https://maps.apple.com/?daddr=${ll(p)}&dirflg=d`;
    if (app === 'mapsme') return `#nav-mapsme:${ll(p)}:${encodeURIComponent((p.label || p.name || 'Ziel').split(',')[0])}`;   // wird beim Antippen mit deinem Standort geöffnet
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
    root.dataset.accent = ACCENTS[settings.accent] ? settings.accent : 'blue';
    document.querySelectorAll('meta[name="theme-color"]').forEach(m => m.setAttribute('content', isDark() ? '#080E19' : '#EDF1F6'));
    Map_.setTiles();
  }
  mqDark.addEventListener('change', applyTheme);

  /* ---------- Toast (optional mit Aktion, z. B. „Rückgängig“) ---------- */
  let toastT;
  function toast(msg, ms = 2600, action) {
    const t = $('#toast'), btn = $('#toast-act');
    $('#toast-msg').textContent = msg; $('#toast-msg').hidden = !msg;
    t.style.transform = ''; t.style.opacity = '';
    btn.hidden = !action;
    if (action) { btn.textContent = action.label; btn.onclick = () => { t.classList.remove('show'); action.run(); }; }
    t.classList.toggle('has-act', !!action);
    t.classList.add('show');
    clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('show'), action ? 6000 : ms);
  }

  // Hinweis-Blase wegwischen
  (function () {
    const t = $('#toast'); let x0 = null, dx = 0;
    t.addEventListener('pointerdown', e => { if (e.target.closest('button')) return; x0 = e.clientX; dx = 0; t.style.transition = 'none'; });
    addEventListener('pointermove', e => { if (x0 == null) return; dx = e.clientX - x0; t.style.transform = `translate(calc(-50% + ${dx}px), 0)`; t.style.opacity = String(Math.max(0, 1 - Math.abs(dx) / 160)); });
    addEventListener('pointerup', () => {
      if (x0 == null) return; x0 = null; t.style.transition = '';
      if (Math.abs(dx) > 60) { t.classList.remove('show'); clearTimeout(toastT); setTimeout(() => { t.style.transform = ''; t.style.opacity = ''; }, 250); }
      else { t.style.transform = ''; t.style.opacity = ''; }
    });
  })();

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
    // Glocke: Grundton + leise Obertöne, weich ein- und lang ausklingend
    bell(freq, at, dur, vol) {
      [[1, 1], [2.76, .22], [5.4, .07]].forEach(([m, v]) => this.tone(freq * m, at, dur / (m > 1 ? m * .8 : 1), vol * v));
    },
    // „Erledigt“-Ton: kurzer Klick, dann zwei helle, aufsteigende Glockentöne (wie Bezahlt/Aufgabe erledigt)
    check() {
      const c = this.ac(); if (!c) return;
      this.tone(2600, 0, .025, .05, 'triangle');
      this.bell(1318.5, .015, .35, .2);
      this.bell(1975.5, .1, .9, .22);
      if (navigator.vibrate) navigator.vibrate([10, 60, 22]);
    },
    uncheck() { this.tone(520, 0, .1, .1); if (settings.sound && navigator.vibrate) navigator.vibrate(8); },
    remove() { this.tone(330, 0, .09, .1, 'triangle'); this.tone(247, .06, .14, .1, 'triangle'); if (settings.sound && navigator.vibrate) navigator.vibrate(20); },
    done() { [1046.5, 1318.5, 1568, 2093].forEach((f, i) => this.bell(f, i * .11, i === 3 ? 1.4 : .6, .17)); if (settings.sound && navigator.vibrate) navigator.vibrate([15, 50, 15, 50, 40]); },
  };

  /* ---------- Formatierung ---------- */
  const fmtKm = m => (m / 1000).toLocaleString('de-DE', { maximumFractionDigits: m < 10000 ? 1 : 0 }) + ' km';
  const fmtDur = s => { const m = Math.round(s / 60); return m < 60 ? `${m} Min` : `${Math.floor(m / 60)} Std ${m % 60} Min`; };
  const fmtTime = d => d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });

  /* ---------- Segmented / Choice UI ---------- */
  function renderNavChoices(el, compact) {
    el.innerHTML = Object.entries(NAV).filter(([k]) => (k !== 'apple' || IS_APPLE) && (k !== 'geo' || IS_ANDROID)).map(([k, v]) =>
      `<button class="choice" data-nav="${k}" aria-pressed="${navKey() === k}">
         <span class="logo" style="background:${v.color};color:${v.ink}">${v.icon}</span>${compact ? v.name.replace(' Maps', '').replace(' Karten', '') : v.name}
       </button>`).join('');
    el.onclick = e => {
      const b = e.target.closest('[data-nav]'); if (!b) return;
      el.dataset.value = b.dataset.nav;
      el.querySelectorAll('[data-nav]').forEach(x => x.setAttribute('aria-pressed', x === b));
    };
    el.dataset.value = navKey();
  }
  function renderMapStyleChoices(el) {
    const keys = Object.keys(MAP_STYLES).filter(k => k !== 'tomtom' || settings.tomtom);
    el.innerHTML = keys.map(k => `<button data-ms="${k}" aria-pressed="${mapStyle() === k}">${MAP_STYLES[k].name}</button>`).join('');
    el.onclick = e => {
      const b = e.target.closest('[data-ms]'); if (!b) return;
      el.querySelectorAll('button').forEach(x => x.setAttribute('aria-pressed', x === b));
      settings.mapStyle = b.dataset.ms; persist(); Map_.setTiles();
    };
  }
  const ACCENTS = { blue: ['Blau', '#1EA7F0'], yellow: ['Gelb-Orange', '#FFB400'], red: ['Rot', '#F0555C'], green: ['Grün', '#22B573'] };
  function renderAccentChoices(el) {
    el.innerHTML = Object.entries(ACCENTS).map(([k, [name, col]]) => `<button type="button" data-accent-opt="${k}" aria-pressed="${(settings.accent || 'blue') === k}" aria-label="${name}" title="${name}"><i style="background:${col}"></i><span>${name}</span></button>`).join('');
    el.onclick = e => {
      const b = e.target.closest('[data-accent-opt]'); if (!b) return;
      el.querySelectorAll('button').forEach(x => x.setAttribute('aria-pressed', x === b));
      settings.accent = b.dataset.accentOpt; applyTheme(); persist(); Map_.lastFit = ''; Map_.render(true);
    };
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
  const OSM_ATTR = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>';
  const MAP_STYLES = {
    vec: { name: 'Straßen & Hausnummern', filter: false, vector: true, attr: '&copy; <a href="https://openfreemap.org">OpenFreeMap</a> &copy; OpenMapTiles, Daten von OpenStreetMap' },
    de: { name: 'Deutschland', filter: true, attr: OSM_ATTR + ' · openstreetmap.de', url: 'https://tile.openstreetmap.de/{z}/{x}/{y}.png' },
    hot: { name: 'Klar', filter: true, attr: OSM_ATTR + ' · Humanitarian OSM Team', url: 'https://{s}.tile.openstreetmap.fr/hot/{z}/{x}/{y}.png' },
    osm: { name: 'Standard', filter: true, attr: OSM_ATTR, url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png' },
    sat: { name: 'Satellit', filter: false, attr: 'Bilder &copy; Esri, Maxar, Earthstar Geographics', url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}' },
    tomtom: { name: 'TomTom', filter: false, attr: '&copy; TomTom',
      url: dark => `https://api.tomtom.com/map/1/tile/basic/${dark ? 'night' : 'main'}/{z}/{x}/{y}.png?key=${encodeURIComponent(settings.tomtom)}` },
  };
  /** Karte hell oder dunkel – unabhängig vom Design der App wählbar */
  const mapDark = () => settings.mapMode === 'dark' ? true : settings.mapMode === 'light' ? false : isDark();
  /* ---------- Vektorkarte von OpenFreeMap: Straßennamen, Hausnummern, Gebäude; Offline-Speichern ist dort ausdrücklich erlaubt ---------- */
  const OFM = 'https://tiles.openfreemap.org';
  async function vecStyle(dark) {
    const key = 'tp.vstyle.' + (dark ? 'd' : 'l');
    let style = null;
    try { const r = await fetch(`${OFM}/styles/${dark ? 'dark' : 'liberty'}`); if (r.ok) { style = await r.json(); try { localStorage.setItem(key, JSON.stringify(style)); } catch (_) {} } } catch (_) {}
    if (!style) { try { style = JSON.parse(localStorage.getItem(key)); } catch (_) {} }
    if (!style) return null;
    style.layers = style.layers.filter(l => l.id !== 'building-3d').map(l => { if (l.id !== 'building') return l; const n = Object.assign({}, l, { minzoom: 12 }); delete n.maxzoom; return n; });
    style.layers.push({ id: 'tp-housenumber', type: 'symbol', source: 'openmaptiles', 'source-layer': 'housenumber', minzoom: 16,
      layout: { 'text-field': ['get', 'housenumber'], 'text-font': ['Noto Sans Bold'], 'text-size': ['interpolate', ['linear'], ['zoom'], 16, 11, 19, 16], 'text-padding': 1 },
      paint: { 'text-color': dark ? '#F2F6FF' : '#2D3B52', 'text-halo-color': dark ? '#0B1220' : '#FFFFFF', 'text-halo-width': 1.8 } });
    return style;
  }
  /** Grundkarte an eine Leaflet-Karte hängen (Rasterkacheln oder Vektorkarte) */
  async function attachBase(owner, map, st, dark, nativeZoom) {
    const token = owner.token = (owner.token || 0) + 1;
    if (owner.tiles) { owner.tiles.remove(); owner.tiles = null; }
    if (st.vector) {
      if (!window.L || !L.maplibreGL) { toast('Vektorkarte konnte nicht geladen werden – bitte einen anderen Kartenstil wählen', 4000); return; }
      const style = await vecStyle(dark);
      if (token !== owner.token) return;
      if (!style) { toast('Karte gerade nicht erreichbar', 3500); return; }
      owner.tiles = L.maplibreGL({ style, attribution: st.attr }).addTo(map);
    } else {
      owner.tiles = L.tileLayer(typeof st.url === 'function' ? st.url(dark) : st.url, { maxZoom: 19, subdomains: 'abc', detectRetina: false, attribution: st.attr }).addTo(map);
    }
  }
  const mapStyle = () => (MAP_STYLES[settings.mapStyle] && (settings.mapStyle !== 'tomtom' || settings.tomtom)) ? settings.mapStyle : 'vec';
  const Map_ = {
    map: null, tiles: null, layers: null, poiLayer: null, me: null, full: false, lastFit: '',
    place() {                       // Karte in den passenden Platz hängen (Handy: im Ergebnis, breit: rechts, Vollbild: direkt in die Seite)
      const wrap = $('#map-wrap'), slot = this.full ? document.body : wide() ? $('#map-slot-desktop') : route ? $('#map-slot-mobile') : $('#map-slot-home');
      if (wrap.parentNode !== slot) {
        slot.appendChild(wrap);
        // neuer Platz = neue Größe → neu einpassen, sobald das Layout steht
        this.lastFit = '';
        if (this.map) setTimeout(() => { this.map.invalidateSize(); this.lastFit = ''; this.render(true); }, 120);
      }
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
      this.map.on('dragstart', () => { this.stopPlay(); if (Me.follow) { Me.follow = false; $('#map-locate').classList.remove('on'); } });
      this.map.on('locationfound', e => {
        if (this.me) this.me.remove();
        this.me = L.circleMarker(e.latlng, { radius: 8, color: '#fff', weight: 3, fillColor: '#0A84D6', fillOpacity: 1 }).addTo(this.map);
      });
      this.map.on('locationerror', () => toast('Standort nicht verfügbar'));
      return this.map;
    },
    setTiles() {
      if (!this.map) return;
      const st = MAP_STYLES[mapStyle()], dark = mapDark();
      $('#map').classList.toggle('map-dark', dark && !!st.filter);
      // Standard-OSM wird im Dunkelmodus per CSS-Filter abgedunkelt, die anderen Stile haben eigene dunkle Kacheln
      $('#map').classList.toggle('no-filter', !st.filter);
      attachBase(this, this.map, st, dark);
    },
    cycleStyle() {
      const keys = Object.keys(MAP_STYLES).filter(k => k !== 'tomtom' || settings.tomtom);
      settings.mapStyle = keys[(keys.indexOf(mapStyle()) + 1) % keys.length]; persist(); this.setTiles();
      const old = $('#map-wrap .map-style-chip'); if (old) old.remove();
      const chip = document.createElement('div'); chip.className = 'map-style-chip'; chip.textContent = MAP_STYLES[mapStyle()].name;
      $('#map-wrap').appendChild(chip); setTimeout(() => chip.remove(), 1400);
    },
    pin(p, html, cls) {
      return L.marker([p.lat, p.lon], { icon: L.divIcon({ className: '', html: `<div class="pin ${cls || ''}">${html}</div>`, iconSize: [32, 32], iconAnchor: [16, 16] }) });
    },
    render(refit) {
      const depot = settings.depot;
      const hasStops = stops.some(s => s.status === 'ok');
      $('#map-empty').hidden = hasStops || !!route;
      const m = this.ensure(); if (!m || !depot) return;
      this.rendering = true; this.reopen = null;
      this.layers.clearLayers();
      const bounds = [[depot.lat, depot.lon]];
      const accent = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim();

      if (route) {
        L.polyline(route.geometry, { color: mapDark() ? '#000' : '#fff', weight: 10, opacity: .55 }).addTo(this.layers);
        L.polyline(route.geometry, { color: accent, weight: 6, opacity: .95 }).addTo(this.layers);
        const cur = currentIndex();
        route.order.forEach((id, i) => {
          const s = stopById(id); if (!s) return;
          const cls = route.done[id] ? 'done' : (i === cur ? 'current' : '');
          const pk = s.pk || 1;
          const parts = s.label.split(','), street = parts[0], town = parts.slice(1, 3).join(',').replace(/\b\d{5}\b\s*/, '').trim();
          const mk = this.pin(s, i + 1, cls).bindPopup(`<div class="pin-pop">
            <div class="pp-head"><span class="pp-n">${i + 1}</span><div class="pp-adr"><b>${esc(street)}</b><small>${esc(town)}</small></div></div>
            <div class="pp-pk">${ICON.box}<b>${pk}</b><span>Paket${pk === 1 ? '' : 'e'}</span></div>
            <div class="pp-act">${route.done[id] ? '' : `<button type="button" class="ok" data-pin-done="${id}">Erledigt</button>`}<button type="button" data-pin-focus="${id}">In Liste</button></div></div>`,
            { closeButton: false, offset: [0, -20], className: 'pin-popup', autoPanPadding: [24, 120], maxWidth: 240, minWidth: 220 })
            .on('popupopen', () => { if (!this.rendering) this.popId = id; }).on('popupclose', () => { if (!this.rendering) this.popId = null; }).addTo(this.layers);
          if (this.popId === id) this.reopen = mk;
          this.pinEls[id] = mk.getElement() && mk.getElement().firstElementChild;
          if (cls === 'current') mk.setZIndexOffset(1000);
          bounds.push([s.lat, s.lon]);
        });
        route.geometry.forEach(c => bounds.push(c));
      } else {
        this.seen = this.seen || new Set();
        stops.filter(s => s.status === 'ok').forEach(s => {
          const fresh = !this.seen.has(s.id); this.seen.add(s.id);        // neue Adressen „fallen“ auf die Karte
          this.pin(s, s.pk && s.pk > 1 ? `<span>${s.pk}</span>` : '', 'dot' + (fresh ? ' drop' : '')).bindTooltip(esc(s.label)).addTo(this.layers); bounds.push([s.lat, s.lon]);
        });
      }
      this.pin(depot, HOME_ICON, 'depot').bindTooltip(esc(depot.name)).addTo(this.layers);
      this.renderPois();
      if (this.reopen) this.reopen.openPopup();
      this.rendering = false;
      // nur neu einpassen, wenn sich die Punkte geändert haben – nicht bei jedem Haken
      const key = (route ? route.order.join() : stops.filter(s => s.status === 'ok').map(s => s.id).join()) + '|' + depot.lat + '|' + this.zoomOn();
      $('#map-zoom').classList.toggle('on', this.zoomOn()); $('#map-zoom').hidden = !route;
      if (key === this.lastFit && !refit) return;
      this.lastFit = key;
      setTimeout(() => {
        m.invalidateSize();
        const nx = this.nextStop();
        if (nx) m.setView([nx.lat, nx.lon], 16);
        else if (bounds.length > 1) m.fitBounds(bounds, { padding: [40, 40], maxZoom: 16 }); else m.setView(bounds[0], 13);
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
    // Mitzoomen zum nächsten Stopp – für Vollbild und kleine Karte getrennt ein-/ausschaltbar
    zoomOn() { return this.full || wide() ? settings.zoomFull !== false : !!settings.zoomSmall; },
    nextStop() { const cur = currentIndex(); return route && cur !== -1 && this.zoomOn() ? stopById(route.order[cur]) : null; },
    toggleZoom() {
      const k = this.full || wide() ? 'zoomFull' : 'zoomSmall';
      settings[k] = !this.zoomOn(); persist();
      toast(this.zoomOn() ? 'Karte folgt dem nächsten Stopp' : 'Karte zeigt die ganze Tour');
      this.lastFit = ''; this.render(true);
    },
    flyTo(p, zoom = 16, duration = .6) { if (this.map) this.map.flyTo([p.lat, p.lon], zoom, { duration }); },
    visible() { return this.map && (this.full || wide() || (!$('#result').hidden && $('#map-wrap').getBoundingClientRect().bottom > 0)); },
    /* Route abspielen: Stopp für Stopp hinfliegen, dann wieder alles zeigen */
    playing: 0,
    async play(max = Infinity) {
      if (!route || !this.map) return;
      if (this.playing) return this.stopPlay();
      const run = ++this.playToken || (this.playToken = 1);
      this.playing = run; document.querySelector('#map-play')?.classList.add('on');
      const ids = route.order.filter(id => !route.done[id]).slice(0, max);
      const wait = ms => new Promise(r => setTimeout(r, ms));
      for (const id of ids) {
        if (this.playing !== run) return;
        const s = stopById(id); if (!s) continue;
        this.map.flyTo([s.lat, s.lon], 16, { duration: 1.1 });
        await wait(1150);
        const pin = this.pinEls[id]; if (pin) { pin.classList.remove('flash'); void pin.offsetWidth; pin.classList.add('flash'); }
        await wait(650);
      }
      if (this.playing !== run) return;
      this.stopPlay(); this.lastFit = ''; this.render(true);
    },
    stopPlay() { this.playing = 0; document.querySelector('#map-play')?.classList.remove('on'); },
    pinEls: {},
    setFull(on, viaHistory) {
      if (on === this.full) return;
      this.full = on;
      $('#map-wrap').classList.toggle('full', on);
      document.body.classList.toggle('map-full', on);
      $('#map-close').hidden = !on; $('#map-full').hidden = on;
      this.place(); renderMapBar();
      if (on) history.pushState({ mapFull: true }, '');
      else if (!viaHistory && history.state && history.state.mapFull) history.back();
      this.syncTouch();
      setTimeout(() => {
        if (!this.map) return;
        this.map.invalidateSize(); this.lastFit = ''; this.render();
        if (on) Me.auto();
      }, 60);
    },
    syncTouch() {                    // eingebettet auf dem Handy: Antippen öffnet Vollbild, Seite bleibt scrollbar
      const inline = !this.full && !wide();
      $('#map-tap').hidden = !inline;
      if (!this.map) return;
      ['dragging', 'touchZoom', 'scrollWheelZoom', 'doubleClickZoom'].forEach(h => this.map[h][inline ? 'disable' : 'enable']());
    },
  };
  const MAIL_ICON = '<svg viewBox="0 0 24 24"><rect x="3" y="6" width="18" height="12" rx="2"/><path d="M3.5 7.5 12 13l8.5-5.5"/></svg>';
  $('#map').addEventListener('click', e => {
    const f = e.target.closest('[data-pin-focus]'); if (f) { Map_.map.closePopup(); focusRouteItem(f.dataset.pinFocus); return; }
    const d = e.target.closest('[data-pin-done]'); if (d) { Map_.map.closePopup(); toggleDone(d.dataset.pinDone); }
  });
  $('#map-tap').onclick = () => Map_.setFull(true);
  $('#map-full').onclick = () => Map_.setFull(true);
  $('#map-close').onclick = () => Map_.setFull(false);
  $('#map-layers').onclick = openLayerSheet;
  addEventListener('online', () => Map_.setTiles()); addEventListener('offline', () => Map_.setTiles());
  $('#map-zoom').onclick = () => Map_.toggleZoom();
  $('#map-locate').onclick = () => {
    if (Me.follow) { Me.stop(); settings.meOff = true; persist(); toast('Standort ausgeschaltet'); }      // zweites Antippen = aus
    else { settings.meOff = false; persist(); Me.start(true); toast('Karte folgt dir – nochmal tippen zum Ausschalten', 2800); }
  };

  /* ---------- Eigener Standort mit Blickrichtung (Pfeil, Lieferwagen oder Punkt) ---------- */
  const ME_ICONS = {
    arrow: { name: 'Pfeil', svg: '<svg viewBox="0 0 44 44"><path d="M22 5 34 35 22 28.5 10 35Z" fill="#1A73E8" stroke="#fff" stroke-width="3" stroke-linejoin="round"/></svg>' },
    van: { name: 'Gelber Lieferwagen', svg: '<svg viewBox="0 0 44 44"><rect x="10.5" y="13" width="3.5" height="4.5" rx="1.2" fill="#6b5500"/><rect x="30" y="13" width="3.5" height="4.5" rx="1.2" fill="#6b5500"/><rect x="13" y="4.5" width="18" height="35" rx="5.5" fill="#FFCC00" stroke="#6b5500" stroke-width="1.6"/><path d="M15.2 11.8Q22 8.2 28.8 11.8L27.8 16.4Q22 14.6 16.2 16.4Z" fill="#26282B"/><rect x="15.5" y="19" width="13" height="17.5" rx="2" fill="#FFD84D"/><rect x="13.8" y="25" width="16.4" height="2.6" fill="#D40511"/></svg>' },
    dot: { name: 'Punkt', svg: '<svg viewBox="0 0 44 44"><path class="cone" d="M22 22 13 4h18Z" fill="#1A73E8" opacity=".28"/><circle cx="22" cy="22" r="8.5" fill="#1A73E8" stroke="#fff" stroke-width="3.5"/></svg>' },
  };
  const Me = {
    watchId: null, marker: null, acc: null, pos: null, heading: null, follow: false, compassOn: false, first: true,
    html() { const k = ME_ICONS[settings.meIcon] ? settings.meIcon : 'arrow'; return `<div class="me me-${k}${this.heading == null ? ' no-heading' : ''}"><div class="me-rot">${ME_ICONS[k].svg}</div></div>`; },
    redraw() {
      if (!this.marker) return;
      this.marker.setIcon(L.divIcon({ className: '', html: this.html(), iconSize: [44, 44], iconAnchor: [22, 22] }));
      this.rotate();
    },
    rotate() {
      const el = this.marker && this.marker.getElement(); if (!el) return;
      const r = el.querySelector('.me-rot'); if (r) r.style.transform = `rotate(${this.heading || 0}deg)`;
      el.firstElementChild.classList.toggle('no-heading', this.heading == null);
    },
    async compass(fromClick) {
      if (this.compassOn) return;
      try {
        if (fromClick && window.DeviceOrientationEvent && typeof DeviceOrientationEvent.requestPermission === 'function') {
          if (await DeviceOrientationEvent.requestPermission() !== 'granted') return;
        }
      } catch (_) { return; }
      this.compassOn = true;
      const onOri = e => {
        let h = null;
        if (typeof e.webkitCompassHeading === 'number') h = e.webkitCompassHeading;          // iPhone/iPad
        else if (e.absolute && typeof e.alpha === 'number') h = 360 - e.alpha;                // Android
        if (h == null || (this.pos && this.pos.speed > 2.5)) return;                         // in Fahrt zählt die Fahrtrichtung
        h = (h + ((screen.orientation && screen.orientation.angle) || 0)) % 360;
        this.heading = h; this.rotate();
      };
      addEventListener('ondeviceorientationabsolute' in window ? 'deviceorientationabsolute' : 'deviceorientation', onOri, true);
    },
    start(fromClick) {
      const m = Map_.ensure(); if (!m) return;
      if (fromClick) { this.compass(true); this.follow = true; if (this.pos) m.flyTo([this.pos.lat, this.pos.lon], Math.max(m.getZoom(), 16), { duration: .6 }); }
      $('#map-locate').classList.toggle('on', this.follow);
      if (!this.dragWired) { this.dragWired = true; m.on('dragstart', () => { this.follow = false; $('#map-locate').classList.remove('on'); }); }
      if (this.watchId != null) return;
      if (!navigator.geolocation) return toast('Standort wird hier nicht unterstützt');
      this.watchId = navigator.geolocation.watchPosition(p => {
        const c = p.coords;
        this.pos = { lat: c.latitude, lon: c.longitude, speed: c.speed || 0, t: Date.now() };
        if (c.heading != null && !isNaN(c.heading) && (c.speed || 0) > 2.5) { this.heading = c.heading; }
        if (!this.marker) {
          this.marker = L.marker([c.latitude, c.longitude], { zIndexOffset: 2000, interactive: false, icon: L.divIcon({ className: '', html: this.html(), iconSize: [44, 44], iconAnchor: [22, 22] }) }).addTo(m);
          this.acc = L.circle([c.latitude, c.longitude], { radius: c.accuracy, color: '#1A73E8', weight: 1, opacity: .3, fillOpacity: .08, interactive: false }).addTo(m);
        } else { this.marker.setLatLng([c.latitude, c.longitude]); this.acc.setLatLng([c.latitude, c.longitude]).setRadius(c.accuracy); }
        this.rotate();
        if (this.follow) {
          if (this.first) { m.setView([c.latitude, c.longitude], Math.max(m.getZoom(), 16)); this.first = false; }
          else m.panTo([c.latitude, c.longitude], { animate: true, duration: .5 });
        }
      }, err => {
        this.watchId = null;
        if (fromClick) toast(err.code === 1 ? 'Standort nicht freigegeben – in den Browser-Einstellungen erlauben' : 'Standort gerade nicht verfügbar', 3500);
      }, { enableHighAccuracy: true, maximumAge: 2000, timeout: 20000 });
    },
    stop() {                     // Standort ganz ausschalten: Anzeige weg, kein Mitlaufen, keine GPS-Abfrage mehr
      if (this.watchId != null && navigator.geolocation) navigator.geolocation.clearWatch(this.watchId);
      this.watchId = null; this.follow = false; this.first = true; this.pos = null;
      if (this.marker) this.marker.remove(); if (this.acc) this.acc.remove();
      this.marker = this.acc = null;
      $('#map-locate').classList.remove('on');
    },
    auto() {                     // Standort schon erlaubt → im Vollbild gleich anzeigen (ohne Nachfrage), außer du hast ihn ausgeschaltet
      if (settings.meOff || this.watchId != null || !navigator.permissions) return;
      navigator.permissions.query({ name: 'geolocation' }).then(p => { if (p.state === 'granted') { this.start(false); this.compass(false); } }).catch(() => {});
    },
  };

  /* ---------- Kartenstil und Standort-Symbol selbst wählen ---------- */
  const STYLE_INFO = { vec: 'Straßennamen, Hausnummern und Gebäude – auch offline', de: 'deutsche Beschriftung, gut lesbar', hot: 'ruhig, Häuser und Wege deutlich', osm: 'die klassische OpenStreetMap', sat: 'Luftbild – Einfahrten und Höfe erkennen', tomtom: 'mit deinem TomTom-Schlüssel' };
  function openLayerSheet() {
    const keys = Object.keys(MAP_STYLES).filter(k => k !== 'tomtom' || settings.tomtom);
    openSheet('Karte', `<div class="menu">${keys.map(k => `<button class="menu-item${mapStyle() === k ? ' now' : ''}" data-style="${k}">${ICON.route}<span><b>${MAP_STYLES[k].name}</b><small>${STYLE_INFO[k]}</small></span>${mapStyle() === k ? ICON.check : ''}</button>`).join('')}</div>
      <h3 class="mini">Karte hell oder dunkel</h3>
      <div class="segmented" id="ly-mode">${[['auto', 'Wie die App'], ['light', 'Hell'], ['dark', 'Dunkel']].map(([k, v]) => `<button data-mapmode="${k}" aria-pressed="${(settings.mapMode || 'auto') === k}">${v}</button>`).join('')}</div>
      <h3 class="mini">Mein Standort als</h3>
      <div class="me-choices">${Object.entries(ME_ICONS).map(([k, v]) => `<button data-meicon="${k}" aria-pressed="${(settings.meIcon || 'arrow') === k}"><span class="me-prev">${v.svg}</span>${v.name}</button>`).join('')}</div>`);
  }
  $('#sheet-body').addEventListener('click', e => {
    const st = e.target.closest('[data-style]');
    if (st) { settings.mapStyle = st.dataset.style; persist(); Map_.setTiles(); closeSheet(); return; }
    const mm = e.target.closest('[data-mapmode]');
    if (mm) { settings.mapMode = mm.dataset.mapmode; persist(); Map_.setTiles(); Map_.lastFit = ''; Map_.render(); document.querySelectorAll('[data-mapmode]').forEach(b => b.setAttribute('aria-pressed', b === mm)); return; }
    const mi = e.target.closest('[data-meicon]');
    if (mi) { settings.meIcon = mi.dataset.meicon; persist(); Me.redraw(); document.querySelectorAll('[data-meicon]').forEach(b => b.setAttribute('aria-pressed', b === mi)); }
  });
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
      const total = route.legs.reduce((a, l) => a + l.dur, 0) + n * serviceSec();
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
  const fmtNum1 = x => (Math.round(x * 10) / 10).toLocaleString('de-DE');
  const pkLabel = n => `${n} Paket${n === 1 ? '' : 'e'}`;
  const lineOf = s => s.query + (s.pk ? ', ' + pkLabel(s.pk) : '');

  function addAddresses(lines) {
    const known = new Map(stops.map(s => [s.query.toLowerCase(), s]));
    let added = 0;
    for (const line of lines) {
      let { query, pk } = Speech.parseLine(line);
      if (query.length < 3) continue;
      let fixedFrom = null;
      const auto = !picked.has(query) && Geo.streetAuto(query);          // eindeutiger Verhörer im Zustellgebiet → gleich richtig schreiben
      if (auto) { fixedFrom = query; query = auto; }
      let ask = null;
      if (!Geo.hasPlaceIn(query)) {                 // Ort aus Auswahl, Gelerntem oder Straßenverzeichnis ergänzen
        const key = Geo.norm(Geo.parseQuery(query).street);
        const st = Geo.streetLookup(query, settings.depot);
        const place = pickedPlace.get(key) || (settings.learn || {})[key] || (st && st.sure ? st.p : '');
        if (place) query += ', ' + place;
        else {                                      // Straße gibt es in mehreren Orten → einmal fragen, dann merken
          const pl = Geo.streetPlaces(query, settings.depot);
          if (pl.length > 1) {
            const withNo = Geo.addrPlaces(query);   // Hausnummer gibt es nur in einem davon → ohne Frage nehmen
            const f = withNo && withNo.length ? pl.filter(p => withNo.includes(p.place)) : pl;
            const home = f.filter(p => p.inArea);
            if (f.length === 1) query += ', ' + f[0].place;
            else if (home.length === 1) query += ', ' + home[0].place;          // nur eine davon im Zustellgebiet → die
            else ask = (home.length > 1 ? home : f).slice(0, 5);
          }
        }
      }
      const ex = known.get(query.toLowerCase());
      if (ex) { if (pk) ex.pk = (ex.pk || 0) + pk; continue; }      // gleiche Adresse: Pakete zusammenzählen
      const s = { id: uid(), query, pk, status: ask ? 'ask' : 'pending' };
      if (ask) s.ask = ask;
      if (fixedFrom) s.fixedFrom = fixedFrom;
      const hit = picked.get(query);
      if (hit) { Object.assign(s, { status: 'ok', label: hit.label, lat: hit.lat, lon: hit.lon, approx: false }); Geo.remember(query, settings.depot, hit); }
      known.set(query.toLowerCase(), s);
      stops.push(s); added++;
    }
    persist(); renderStops(); Map_.render(); jumpAfter = added > 0; runGeocoding();
    return added;
  }

  /** Merken, in welchem Ort eine Straße gemeint ist (bei gleichnamigen Straßen) */
  function learnPlace(query) {
    const p = Geo.parseQuery(query); if (!p.city || !p.street) return;
    const places = Geo.streetPlaces(query, settings.depot).map(x => x.place);
    const city = places.find(x => Geo.norm(x) === Geo.norm(p.city.replace(/^\d{5}\s*/, '')));
    if (places.length > 1 && city) { settings.learn = Object.assign({}, settings.learn, { [Geo.norm(p.street)]: city }); persist(); }
  }

  /** Adresse suchen. Das Straßenverzeichnis prüft den Treffer, springt ein, wenn der Dienst nichts findet,
      und liefert Korrekturvorschläge bei Verhörern. → { r, alts } */
  async function locate(query) {
    const depot = settings.depot;
    const off = Geo.addrLookup(query, depot);            // Hausnummer im heruntergeladenen Gebiet → sofort und exakt
    if (off) return { r: off, alts: [] };
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
    let alts = Geo.streetFix(query, depot);
    if (!alts.length && !st && Geo.streetCount()) alts = Geo.similarStreets(query, depot, 4).filter(x => !x.exact).map(x => x.line);   // auch weiter weg Klingendes anbieten
    if (alts.length) {
      const want = Geo.norm(Geo.parseQuery(query).street), got = r ? Geo.norm(r.label.split(',')[0].replace(/\s*\d+\s?[a-z]?$/i, '')) : '';
      if (!r || got !== want) return { r: null, alts };               // unbekannte Straße: lieber nachfragen als raten
    }
    return { r, alts: [] };
  }

  /** Bis zu 4 Adressen gleichzeitig suchen. */
  /** Liegt der Punkt außerhalb des Zustellgebiets? → Ortsname, sonst '' */
  const outsideOf = p => Geo.isOutside(p.lat, p.lon) ? Geo.placeAt(p.lat, p.lon) : '';
  const refreshOutside = () => stops.forEach(s => { if (s.status === 'ok') s.outside = outsideOf(s); });

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
          if (r) Object.assign(s, { status: 'ok', label: r.label, lat: r.lat, lon: r.lon, approx: r.approx, alts: null, outside: outsideOf(r) });
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
    if (jumpAfter) { jumpAfter = false; problemIdx = 0; const l = route ? stops.filter(x => !route.order.includes(x.id)) : stops; if (problemsOf(l).length) setTimeout(jumpToProblem, 250); }
    // läuft schon eine Tour, kommen neue Adressen automatisch an die beste Stelle
    if (route && stops.some(s => s.status === 'ok' && !route.order.includes(s.id))) plan('insert');
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
    flag: '<svg viewBox="0 0 24 24"><path d="M5 21V4M5 4h12l-2.5 4L17 12H5"/></svg>',
    road: '<svg viewBox="0 0 24 24"><path d="M8 3 4 21M16 3l4 18M12 4v3M12 11v3M12 18v2"/></svg>',
    clock: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/></svg>',
    home: '<svg viewBox="0 0 24 24"><path d="M3 10.5 12 4l9 6.5V20H3z"/><path d="M9.5 20v-5h5v5"/></svg>',
    spark: '<svg viewBox="0 0 24 24"><path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M18 6l-2.5 2.5M8.5 15.5 6 18"/></svg>',
  };
  /* Dein Tempo: gelernt aus den Abständen zwischen dem Abhaken (abzüglich Fahrzeit) */
  const paceOk = () => settings.autoPace !== false && settings.pace && settings.pace.n >= 3;
  const serviceSec = () => paceOk() ? settings.pace.sec : (settings.stopMin || 0) * 60;
  function learnPace(id) {
    if (settings.autoPace === false || !route || !route.doneAt) return;
    const i = route.order.indexOf(id), prevId = route.order[i - 1], now = route.doneAt[id];
    const prevT = i > 0 ? route.doneAt[prevId] : null;        // nur wenn der Stopp direkt davor auch gerade abgehakt wurde
    if (!prevT || !route.legs[i]) return;
    const sample = (now - prevT) / 1000 - route.legs[i].dur;
    if (sample < 10 || sample > 900) return;                   // Pausen, Nachträge und Vertipper zählen nicht
    const p = settings.pace || { sec: sample, n: 0 };
    p.sec = Math.round(p.n ? p.sec * .8 + sample * .2 : sample); p.n = Math.min(999, p.n + 1);
    settings.pace = p;
  }
  /** Pakete pro Stunde in dieser Tour (ab dem ersten Abhaken) */
  function pkPerHour() {
    if (!route || !route.doneAt) return null;
    const ts = Object.entries(route.doneAt).filter(([id]) => route.done[id]).sort((a, b) => a[1] - b[1]);
    if (ts.length < 3) return null;
    const span = (ts[ts.length - 1][1] - ts[0][1]) / 3600000; if (span < .05) return null;
    const pk = ts.slice(1).reduce((a, [id]) => { const st = stopById(id); return a + (st ? st.pk || 1 : 0); }, 0);
    return Math.round(pk / span);
  }
  const pkCount = list => list.reduce((a, s) => a + (s.pk || 1), 0);
  const pkPill = s => s.pk ? `<span class="pk" title="${pkLabel(s.pk)}">${ICON.box}${s.pk}<i>${s.pk === 1 ? 'Paket' : 'Pakete'}</i></span>` : '';
  const newCls = id => { if (seenIds.has(id)) return ''; seenIds.add(id); return ' new'; };

  let editingId = null, openId = null;

  /** Bearbeitungszeile mit Vorschlägen und Paketzähler (für beide Listen) */
  /** Liste der ähnlichsten Straßen im Gebiet – für falsch erkannte Namen */
  function similarHtml(s) {
    const base = s.fixedFrom || s.query;
    const list = Geo.similarStreets(base, settings.depot, 6);
    if (!list.length) return '';
    const cur = Geo.norm(Geo.parseQuery(s.query).street);
    return `<div class="similar"><small>Ähnliche Straßen${settings.area && settings.area.length ? ' in deinem Gebiet' : ''} – antippen zum Übernehmen</small>
      <div class="sim-list">${list.map(x => `<button type="button" data-sim="${esc(x.line)}" class="${Geo.norm(x.street) === cur ? 'on' : ''}"><b>${esc(x.street)}</b><span>${esc(x.place)}${x.outside ? ' · außerhalb' : ''}</span></button>`).join('')}</div></div>`;
  }
  function editorHtml(s) {
    return `<div class="editor" data-editor="${s.id}">
      <input class="ed-q" value="${esc(s.query)}" autocomplete="off" aria-label="Adresse">
      <div class="suggest" hidden></div>
      ${similarHtml(s)}
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
      const sim = e.target.closest('[data-sim]');
      if (sim) {                                   // ähnliche Straße gewählt → Hausnummer behalten, gleich speichern
        inp.value = sim.dataset.sim; hit = null;
        ed.querySelectorAll('[data-sim]').forEach(b => b.classList.toggle('on', b === sim));
        if (!Geo.parseQuery(sim.dataset.sim).housenumber) { inp.focus(); const p = sim.dataset.sim.indexOf(','); inp.setSelectionRange(p, p); return; }
        delete s.fixedFrom;
        ed.querySelector('[data-ed="save"]').click(); return;
      }
      const st = e.target.closest('[data-step]');
      if (st) { pk = Math.max(0, Math.min(999, pk + +st.dataset.step)); ed.querySelector('.ed-pk').textContent = pk; return; }
      const b = e.target.closest('[data-ed]'); if (!b) return;
      editingId = null;
      if (b.dataset.ed === 'save') {
        const parsed = Speech.parseLine(inp.value);
        const q = parsed.query || s.query;
        s.pk = parsed.pk || pk || null;
        if (q !== s.query || hit) {
          s.query = q; delete s.ask; learnPlace(q);
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
    const pkn = pkCount(list);
    $('#stop-pk').textContent = list.length ? `· ${pkn} Paket${pkn === 1 ? '' : 'e'}` : '';
    $('#stops-card h2').firstChild.textContent = route ? 'Noch offen ' : 'Stopps ';
    $('#stop-list').innerHTML = list.map((s, idx) => {
      const cls = s.status === 'ok' ? 'ok' : s.status;
      const state = s.status === 'ok' ? ICON.ok : s.status === 'err' ? ICON.warn : '';
      const sub = s.status === 'ok' ? esc(s.label) + (s.approx ? ' · Hausnr. ungefähr' : '') + (s.outside ? ` <span class="tag-out">außerhalb</span>` : '') + (s.fixedFrom ? `<br><span class="fixed-note">korrigiert aus „${esc(s.fixedFrom)}“</span>` : '')
        : s.status === 'ask' ? 'Diese Straße gibt es mehrmals – welcher Ort?'
        : s.status === 'err' ? (s.alts ? 'Straße unbekannt – meintest du:' : 'Nicht gefunden – antippen und Ort ergänzen') : 'Suche …';
      if (editingId === s.id) return `<li class="stop editing" data-id="${s.id}">${editorHtml(s)}</li>`;
      return `<li class="stop swipe ${cls}${newCls(s.id)}" data-id="${s.id}">
        <div class="swipe-bg"><span></span><span class="r">${ICON.del} Löschen</span></div>
        <div class="row-main">
          ${route ? '' : `<span class="n">${idx + 1}</span>`}<span class="state">${state}</span>
          <div class="txt"><div class="q">${esc(s.query)}</div><div class="r">${sub}</div></div>
          ${pkPill(s)}
          <div class="acts"><button data-act="edit" aria-label="Bearbeiten">${ICON.edit}</button><button data-act="del" aria-label="Löschen">${ICON.del}</button></div>
        </div>
        ${s.status === 'ask' ? `<div class="alts ask">${s.ask.map(a => `<button data-ask="${esc(a.place)}">${esc(a.place)}${a.inArea ? '' : ' <small>außerhalb</small>'}</button>`).join('')}</div>` : ''}
        ${s.status === 'ok' && s.outside ? `<div class="alts"><button data-area-add="${esc(s.outside)}">${esc(s.outside)} gehört zu meinem Gebiet</button></div>` : ''}
        ${s.status === 'err' && s.alts ? `<div class="alts">${s.alts.map((a, i) => `<button data-alt="${i}">${esc(a)}</button>`).join('')}</div>` : ''}
      </li>`;
    }).join('');
    wireEditor($('#stop-list'));
    renderProblem(list);
    const pending = stops.some(s => s.status === 'pending');
    const okCount = stops.filter(s => s.status === 'ok').length;
    const btn = $('#optimize-btn');
    btn.hidden = !!route;
    btn.disabled = pending || okCount === 0;
    btn.lastChild.textContent = pending ? ' Adressen werden gesucht …' : ` Route optimieren (${okCount})`;
    renderGreeting();
    renderDock();
  }

  /* Großer Hinweis oben in der Liste: nicht gefundene oder mehrdeutige Adressen */
  let problemIdx = 0, jumpAfter = false;
  const problemsOf = list => list.filter(s => s.status === 'err' || s.status === 'ask');
  function renderProblem(list) {
    const box = $('#problem'), bad = problemsOf(list);
    box.hidden = !bad.length;
    if (!bad.length) return;
    box.innerHTML = `<div class="pb-ico">!</div><div class="pb-txt"><b>${bad.length} Adresse${bad.length > 1 ? 'n' : ''} bitte korrigieren</b><span>Straße nicht gefunden oder mehrmals vorhanden</span></div><button class="btn primary" data-jump>Jetzt korrigieren</button>`;
    box.querySelector('[data-jump]').onclick = () => jumpToProblem();
  }
  function jumpToProblem() {
    const list = route ? stops.filter(s => !route.order.includes(s.id)) : stops, bad = problemsOf(list);
    if (!bad.length) return;
    const s = bad[problemIdx++ % bad.length];
    if (s.status === 'err') editingId = s.id;               // Bearbeiten mit ähnlichen Straßen öffnet sich gleich
    renderStops();
    const li = document.querySelector(`#stop-list [data-id="${s.id}"]`);
    if (li) { li.scrollIntoView({ behavior: 'smooth', block: 'center' }); li.classList.add('flash'); setTimeout(() => li.classList.remove('flash'), 1800); }
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
    toast('', 5000, { label: '↶ Rückgängig', run() {
      stops.splice(Math.min(idx, stops.length), 0, s);
      if (route && backup) { route.order = backup.order.filter(x => stopById(x)); route.done = backup.done; }
      after();
    } });
  }

  $('#stop-list').addEventListener('click', e => {
    const b = e.target.closest('[data-act]');
    const li = e.target.closest('.stop'); if (!li || li.classList.contains('editing')) return;
    const ak = e.target.closest('[data-ask]');
    if (ak) {                                         // Ort gewählt → übernehmen und für diese Straße merken
      const s = stopById(li.dataset.id), key = Geo.norm(Geo.parseQuery(s.query).street);
      settings.learn = Object.assign({}, settings.learn, { [key]: ak.dataset.ask });
      // gleiche Straße in anderen offenen Fragen gleich mit beantworten
      stops.forEach(x => { if (x.status === 'ask' && Geo.norm(Geo.parseQuery(x.query).street) === key) { x.query += ', ' + ak.dataset.ask; x.status = 'pending'; delete x.ask; } });
      persist(); renderStops(); runGeocoding();
      toast(`Gemerkt: ${Geo.parseQuery(s.query).street} → ${ak.dataset.ask}`);
      return;
    }
    const aa = e.target.closest('[data-area-add]');
    if (aa) { addToArea(aa.dataset.areaAdd); return; }
    const alt = e.target.closest('[data-alt]');
    if (alt) {                                        // Korrekturvorschlag übernehmen
      const s = stopById(li.dataset.id);
      Object.assign(s, { query: s.alts[+alt.dataset.alt], status: 'pending', alts: null }); learnPlace(s.query);
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
  /** Text → Adresszeilen: mit Gemini-Schlüssel per KI, sonst (oder bei Fehler) mit der eigenen Erkennung */
  let aiBusy = false;
  async function toLines(raw, busyEl) {
    if (!settings.aiKey || !raw.trim() || !window.AI) return parseText(raw);
    aiBusy = true; if (busyEl) busyEl.classList.add('loading');
    try {
      const lines = await AI.parse(raw, settings.aiKey, Geo.streetNames());
      if (lines.length) return lines;
    } catch (e) { toast('KI gerade nicht erreichbar – normale Erkennung', 3000); }
    finally { aiBusy = false; if (busyEl) busyEl.classList.remove('loading'); }
    return parseText(raw);
  }
  async function submitInput() {
    if (aiBusy) return;
    const raw = $('#addr-input').value;
    const lines = await toLines(raw, $('#add-btn'));
    if (!lines.length) return toast('Bitte mindestens eine Adresse eingeben');
    const n = addAddresses(lines);
    $('#addr-input').value = ''; $('#addr-suggest').hidden = true;
    toast(n ? `${n} Adresse${n > 1 ? 'n' : ''} hinzugefügt` : 'Schon in der Liste – Pakete ergänzt');
  }
  $('#add-btn').onclick = submitInput;
  $('#addr-input').addEventListener('keydown', e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) submitInput(); });

  // Vorschläge für die Zeile, in der gerade getippt wird
  function lineSuggest(ta, box) {
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
  }
  lineSuggest($('#addr-input'), $('#addr-suggest'));
  lineSuggest($('#q-input'), $('#q-suggest'));

  /* Diktat: alles Gesagte sammeln und als Ganzes aufteilen – so wird ein langer Satz mit mehreren
     Adressen sauber in Straße, Hausnummer, Ort und Pakete zerlegt, auch über Sprechpausen hinweg. */
  const placeNames = () => Geo.places(settings.depot).map(p => p.name);
  const parseText = raw => Speech.smartParse(raw, settings.smart, placeNames());
  let dictTarget = null, dictBase = '', dictHeard = '', dictOnEnd = null;
  const dict = new Speech.Dictation({
    onFinal(text) {
      if (!dictTarget) return;
      dictHeard = (dictHeard + ' ' + text).trim();
      const parsed = parseText(dictHeard).join('\n');
      dictTarget.value = (dictBase.trim() ? dictBase.replace(/\s*$/, '\n') : '') + parsed + (parsed ? '\n' : '');
      dictTarget.scrollTop = dictTarget.scrollHeight;
    },
    onInterim(t) { $('#interim').textContent = t; $('#q-interim').textContent = t; },
    onState(on) {
      $('#mic-btn').classList.toggle('live', on && dictTarget === $('#addr-input'));
      $('#q-mic').classList.toggle('live', on && dictTarget === $('#q-input'));
      document.body.classList.toggle('listening', on);
      $('#mic-btn .mic-label').textContent = on && dictTarget === $('#addr-input') ? 'Ich höre zu …' : 'Halten & sprechen';
      $('#q-state').textContent = on ? 'Ich höre zu … zum Beenden antippen' : 'Antippen und sprechen';
    },
    onError(err) {
      if (err === 'unsupported') toast('Diktat geht in diesem Browser nicht – nutze das Mikrofon deiner Tastatur', 4000);
      else if (err === 'not-allowed' || err === 'service-not-allowed') toast('Mikrofon nicht freigegeben', 3500);
      else toast('Diktat-Fehler: ' + err);
    },
    onEnd() { const f = dictOnEnd; dictOnEnd = null; if (f) setTimeout(f, 150); },
  });
  function startDict(ta, onEnd) {
    if (dict.active) dict.stop();
    dictTarget = ta; dictBase = ta.value; dictHeard = ''; dictOnEnd = onEnd;
    dict.start(); if (navigator.vibrate) navigator.vibrate(10);
  }
  (function () {
    // Gedrückt halten = sprechen, loslassen = fertig. Kurz antippen = an/aus.
    const mic = $('#mic-btn');
    let downAt = 0, wasActive = false, down = false;
    mic.addEventListener('pointerdown', e => {
      e.preventDefault(); down = true; downAt = Date.now(); wasActive = dict.active;
      try { mic.setPointerCapture(e.pointerId); } catch (_) {}
      if (!dict.active) startDict($('#addr-input'), () => { if ($('#addr-input').value.trim()) submitInput(); });
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

  /* ---------- Schnell-Eingabe über das Mikrofon oben ---------- */
  async function quickSubmit() {
    if (aiBusy) return;
    const ta = $('#q-input');
    if (settings.aiKey && ta.value.trim()) $('#q-state').textContent = 'KI sortiert die Adressen …';
    const lines = await toLines(ta.value, $('#q-add'));
    $('#q-state').textContent = dict.active ? 'Ich höre zu … zum Beenden antippen' : 'Antippen und sprechen';
    if (!lines.length) return;
    const before = new Set(stops.map(s => s.id));
    addAddresses(lines);
    ta.value = ''; $('#q-suggest').hidden = true;
    const added = stops.filter(s => !before.has(s.id));
    $('#q-added').insertAdjacentHTML('afterbegin', added.map(s => {
      if (s.status === 'ask') return `<li data-qid="${s.id}">${ICON.warn}<span>${esc(s.query)}<small>gibt es mehrmals – welcher Ort?</small></span>${pkPill(s)}
        <div class="sim-list q">${s.ask.map(a => `<button type="button" data-qask="${esc(a.place)}"><b>${esc(a.place)}</b><span>${a.inArea ? 'dein Gebiet' : 'außerhalb'}</span></button>`).join('')}</div></li>`;
      const known = Geo.streetLookup(s.query, settings.depot) || Geo.addrLookup(s.query, settings.depot);
      const sim = known ? [] : Geo.similarStreets(s.fixedFrom || s.query, settings.depot, 4).filter(x => !x.exact);
      return `<li data-qid="${s.id}">${known ? ICON.check : ICON.warn}<span>${esc(s.query)}${s.fixedFrom ? `<small class="fixed-note">korrigiert aus „${esc(s.fixedFrom)}“</small>` : ''}</span>${pkPill(s)}
        ${sim.length ? `<div class="sim-list q">${sim.map(x => `<button type="button" data-qsim="${esc(x.line)}"><b>${esc(x.street)}</b><span>${esc(x.place)}</span></button>`).join('')}</div>` : ''}</li>`;
    }).join(''));
    if (navigator.vibrate) navigator.vibrate(15);
  }
  function openQuick() {
    $('#q-added').innerHTML = ''; $('#q-input').value = ''; $('#q-interim').textContent = '';
    $('#quick').hidden = false;
    if (Speech.supported) startDict($('#q-input'), quickSubmit);
    else $('#q-input').focus();
  }
  function closeQuick() {
    if (dict.active) { dictOnEnd = null; dict.stop(); }
    if ($('#q-input').value.trim()) quickSubmit();
    $('#quick').hidden = true;
    const n = $('#q-added').children.length;
    if (n) toast(`${n} Adresse${n > 1 ? 'n' : ''} hinzugefügt`);
  }
  $('#top-mic').onclick = openQuick;
  $('#q-added').addEventListener('click', e => {
    const qa = e.target.closest('[data-qask]');
    if (qa) {
      const li = qa.closest('li'), s = stopById(li.dataset.qid); if (!s) return;
      const key = Geo.norm(Geo.parseQuery(s.query).street);
      settings.learn = Object.assign({}, settings.learn, { [key]: qa.dataset.qask });
      stops.forEach(x => { if (x.status === 'ask' && Geo.norm(Geo.parseQuery(x.query).street) === key) { x.query += ', ' + qa.dataset.qask; x.status = 'pending'; delete x.ask; } });
      persist(); renderStops(); runGeocoding();
      li.querySelector('span').textContent = s.query; li.querySelector('.sim-list').remove(); li.firstElementChild.outerHTML = ICON.check;
      return;
    }
    const b = e.target.closest('[data-qsim]'); if (!b) return;
    const li = b.closest('li'), s = stopById(li.dataset.qid); if (!s) return;
    const line = b.dataset.qsim;
    Object.assign(s, { query: line, status: 'pending', alts: null, label: '' }); delete s.fixedFrom; delete s.ask; learnPlace(line);
    persist(); renderStops(); runGeocoding();
    li.querySelector('span').textContent = line; li.querySelector('.sim-list').remove();
    li.firstElementChild.outerHTML = ICON.check;
  });
  $('#quick-close').onclick = closeQuick;
  $('#quick').addEventListener('click', e => { if (e.target.id === 'quick') closeQuick(); });
  $('#q-add').onclick = () => { if (dict.active && dictTarget === $('#q-input')) { dict.stop(); } else quickSubmit(); };
  (function () {
    // Großes Mikrofon: antippen = an/aus, gedrückt halten = sprechen solange gehalten
    const mic = $('#q-mic'); let downAt = 0, wasActive = false;
    mic.addEventListener('pointerdown', e => {
      e.preventDefault(); downAt = Date.now(); wasActive = dict.active && dictTarget === $('#q-input');
      if (!wasActive) startDict($('#q-input'), quickSubmit);
    });
    mic.addEventListener('pointerup', () => {
      const held = Date.now() - downAt;
      if (wasActive || held > 600) setTimeout(() => dict.stop(), 250);
    });
    mic.addEventListener('contextmenu', e => e.preventDefault());
  })();

  /* ---------- Tour beenden oder abbrechen (Knopf oben) ---------- */
  $('#tour-stop').onclick = () => {
    if (!route) return;
    const open = route.order.filter(id => !route.done[id]).length;
    openSheet('Tour beenden', `<div class="menu">
      <button class="menu-item" data-menu="finish">${ICON.flag}<span><b>Beenden &amp; speichern</b><small>${open ? `${open} Stopp${open === 1 ? '' : 's'} noch offen – ` : ''}kommt mit Datum in den Verlauf</small></span></button>
      <button class="menu-item danger" data-menu="end">${ICON.del}<span><b>Tour abbrechen</b><small>Alle Stopps löschen, nichts speichern</small></span></button>
    </div>`);
  };

  document.addEventListener('focusin', e => { if (e.target.matches('input, textarea')) document.body.classList.add('typing'); });
  document.addEventListener('focusout', () => setTimeout(() => { if (!document.activeElement.matches('input, textarea')) document.body.classList.remove('typing'); }, 50));

  /* ---------- Planung ----------
     reopt = true: offene Stopps neu sortieren (erledigte bleiben vorn stehen)
     reopt = false: Reihenfolge behalten, nur Strecke neu berechnen (nach Löschen/Bearbeiten) */
  let planning = false, planAgain = null, gpsNote = '';
  function whereAmI(timeout = 6000) {                          // aktuelle Position (frisch genug oder kurz nachfragen)
    if (Me.pos && Date.now() - (Me.pos.t || 0) < 90000) return Promise.resolve(Me.pos);
    if (!navigator.geolocation) return Promise.resolve(null);
    return new Promise(res => navigator.geolocation.getCurrentPosition(
      p => res({ lat: p.coords.latitude, lon: p.coords.longitude, t: Date.now() }), () => res(null),
      { enableHighAccuracy: true, maximumAge: 30000, timeout }));
  }
  async function plan(reopt) {
    if (planning) { planAgain = planAgain || reopt; return; }
    const depot = settings.depot;
    const ok = stops.filter(s => s.status === 'ok');
    if (!ok.length) { route = null; persist(); renderStops(); renderResult(); return; }
    if (ok.length > 300) return toast('Maximal 300 Stopps pro Tour');
    planning = true; setBusy(true);
    const prev = route, first = !prev;
    try {
      const inPrev = prev ? prev.order.map(stopById).filter(s => s && s.status === 'ok') : [];
      const doneStops = inPrev.filter(s => prev.done[s.id]);
      let rest = inPrev.filter(s => !prev.done[s.id]).concat(ok.filter(s => !inPrev.includes(s)));
      let saving = prev ? prev.saving : 0, source = 'osrm';
      const fresh = prev ? ok.filter(s => !inPrev.includes(s)) : [];
      if (reopt === 'insert' && fresh.length && rest.length > fresh.length) {
        // Neue Adressen an der günstigsten Stelle einfügen – die übrige Reihenfolge bleibt genau so, wie sie war
        const base = rest.slice(0, rest.length - fresh.length);
        const start = doneStops.length ? doneStops[doneStops.length - 1] : depot;
        const nodes = [start, ...base, ...fresh], dIdx = nodes.length;
        const M = await Geo.matrix([...nodes, depot]);
        source = M.source;
        const d = (a, b) => M.dur[a][b];
        const seq = base.map((_, i) => i + 1);
        fresh.forEach((_, k) => {
          const f = base.length + 1 + k; let bestP = seq.length, bestC = Infinity;
          for (let q = 0; q <= seq.length; q++) {
            const a = q === 0 ? 0 : seq[q - 1], nx = q === seq.length ? (settings.roundtrip ? dIdx : -1) : seq[q];
            const c = d(a, f) + (nx === -1 ? 0 : d(f, nx) - d(a, nx));
            if (c < bestC - 1e-6) { bestC = c; bestP = q; }
          }
          seq.splice(bestP, 0, f);
        });
        rest = seq.map(i => nodes[i]);
      } else if (reopt && rest.length > 1) {
        let start = doneStops.length ? doneStops[doneStops.length - 1] : depot, fromMe = false;
        if (!first) {                                        // laufende Tour: ab dem Punkt, an dem du gerade bist
          const me = await whereAmI();
          if (me) { start = { lat: me.lat, lon: me.lon, label: 'Dein Standort' }; fromMe = true; }
        }
        gpsNote = fromMe ? 'Neu sortiert – ab deinem Standort' : (first ? '' : 'Standort nicht verfügbar – sortiert ab dem letzten erledigten Stopp');
        const pts = [start, ...rest];
        const backIdx = settings.roundtrip && start !== depot ? pts.push(depot) - 1 : 0;
        const M = await Geo.matrix(pts);
        const n = rest.length;
        const D = Array.from({ length: n + 1 }, (_, i) => M.dur[i].slice(0, n + 1));
        if (backIdx) for (let i = 1; i <= n; i++) D[i][0] = M.dur[i][backIdx];
        const naive = Optimize.tourCost(rest.map((_, i) => i + 1), D, settings.roundtrip);
        const { order, cost } = Optimize.solve(D, settings.roundtrip, n > 150 ? 6000 : n > 80 ? 4000 : 2500);
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
        doneAt: prev && prev.doneAt ? prev.doneAt : {},
      };
      persist(); renderStops(); renderResult();
      if (gpsNote) { toast(gpsNote, 3200); gpsNote = ''; }
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
  document.addEventListener('click', async e => {              // MAPS.ME: Route ab deinem Standort, direkt in der App (kein leerer Tab)
    const a = e.target.closest('a[href^="#nav-mapsme:"]'); if (!a) return;
    e.preventDefault();
    const [, dll, name] = a.getAttribute('href').split(':');
    const hadPos = Me.pos && Date.now() - (Me.pos.t || 0) < 90000;
    if (!hadPos) toast('Standort wird bestimmt …', 3000);
    const me = await whereAmI(3500);
    location.href = mapsmeUrl(dll, decodeURIComponent(name), me);
  });
  function goDepot() {                                     // Navigation zum Depot starten
    const d = settings.depot; if (!d) return;
    closeSheet();
    toast(`Navigation zum Depot (${NAV[navKey()].name})`, 1800);
    const u = navUrl(d);
    if (u.startsWith('#nav-mapsme:')) { const a = document.createElement('a'); a.href = u; document.body.appendChild(a); a.click(); a.remove(); }
    else window.open(u, '_blank', 'noopener');
  }
  $('#top-depot').onclick = () => {                        // erst nachfragen, damit es nicht aus Versehen passiert
    const d = settings.depot; if (!d) return;
    const open = route ? route.order.filter(id => !route.done[id]).length : 0;
    openSheet('Zum Depot fahren?', `<div class="dlg">
      <div class="dlg-ico">${ICON.home}</div>
      <p class="dlg-name">${esc(d.name || 'Depot')}</p>
      <p class="dlg-sub">${esc((d.label || '').split(',').slice(0, 2).join(','))}</p>
      ${open ? `<p class="dlg-warn">Es sind noch <b>${open} Stopp${open === 1 ? '' : 's'}</b> offen.</p>` : ''}
      <p class="dlg-sub">Die Navigation startet mit ${esc(NAV[navKey()].name)}.</p>
      <div class="dlg-act"><button type="button" class="btn ghost" id="dep-no">Abbrechen</button><button type="button" class="btn primary" id="dep-yes">${ICON.nav} Ja, zum Depot</button></div></div>`);
    $('#dep-no').onclick = closeSheet; $('#dep-yes').onclick = goDepot;
  };

  /* ---------- Ergebnis ---------- */
  const currentIndex = () => route ? route.order.findIndex(id => !route.done[id]) : -1;
  let justDone = null;

  function toggleDone(id) {
    if (!route || !stopById(id)) return;
    if (route.done[id]) { delete route.done[id]; if (route.doneAt) delete route.doneAt[id]; Sfx.uncheck(); }
    else {
      route.done[id] = true; justDone = id;
      (route.doneAt = route.doneAt || {})[id] = Date.now(); learnPace(id);
      if (route.order.every(x => route.done[x])) Sfx.done(); else Sfx.check();
    }
    if (openId === id) openId = null;
    persist(); renderResult(); justDone = null;
    const cur = currentIndex();
    if (route.done[id] && cur !== -1 && Map_.visible() && Map_.zoomOn()) setTimeout(() => Map_.flyTo(stopById(route.order[cur]), 16, 1.2), 350);
    if (route.done[id] && cur === -1) setTimeout(showDone, 500);
  }

  /* ---------- Geschafft! ---------- */
  function showDone() {
    if (!route || document.querySelector('.done-ov')) return;
    const ordered = route.order.map(stopById).filter(Boolean), d = settings.depot;
    const pk = pkCount(ordered), km = route.legs.reduce((a, l) => a + l.dist, 0);
    const mins = Math.round((Date.now() - route.created) / 60000);
    const colors = ['#33CCFF', '#0A84D6', '#FFCC00', '#2FD08E', '#FF6B57', '#ffffff'];
    const conf = Array.from({ length: 36 }, (_, i) => `<i style="left:${Math.random() * 100}%;background:${colors[i % colors.length]};animation-delay:${(Math.random() * .6).toFixed(2)}s;animation-duration:${(1.8 + Math.random() * 1.4).toFixed(2)}s;transform:rotate(${Math.round(Math.random() * 360)}deg)"></i>`).join('');
    const el = document.createElement('div');
    el.className = 'done-ov';
    el.innerHTML = `<div class="confetti">${conf}</div>
      <div class="done-card">
        <div class="done-badge"><svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg></div>
        <h2>Geschafft${settings.name ? ', ' + esc(settings.name) : ''}!</h2>
        <p>Alle Stopps sind erledigt. Stark gemacht.</p>
        <div class="done-stats"><div><b>${ordered.length}</b><span>Stopps</span></div><div><b>${pk}</b><span>Pakete</span></div><div><b>${fmtKm(km)}</b><span>Strecke</span></div>${mins > 0 && mins < 1440 ? `<div><b>${fmtDur(mins * 60)}</b><span>unterwegs</span></div>` : ''}</div>
        ${route.roundtrip ? `<a class="btn primary wide big" href="${navUrl(d)}" target="_blank" rel="noopener">${ICON.nav} Zurück zum Depot</a>` : ''}
        <button class="btn ${route.roundtrip ? 'ghost' : 'primary'} wide" data-done-act="save">${ICON.flag} Tour beenden &amp; speichern</button>
        <button class="link" data-done-act="close">Später</button>
      </div>`;
    document.body.appendChild(el);
    el.addEventListener('click', e => {
      const b = e.target.closest('[data-done-act]');
      if (e.target === el || b || e.target.closest('a')) el.remove();
      if (b && b.dataset.doneAct === 'save') finishTour();
    });
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
    const service = serviceSec();
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
    const app = NAV[navKey()];
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

    // Übersicht: Kacheln mit Symbol, Wert und Beschriftung
    const open = n - doneCount, pkLeft = pkTotal - pkDone;
    const tile = (ic, val, label, extra = '', cls = '') => `<div class="${cls}"><span class="ic">${ic}</span><dd>${val}</dd><dt>${label}</dt>${extra}</div>`;
    const bar = f => `<div class="bar"><span style="width:${Math.round(f * 100)}%"></span></div>`;
    $('#stats').innerHTML = `
      <div class="ov-head"><h2>Tour-Überblick</h2><span>${open ? `noch ${open} von ${n} Stopps` : 'alles erledigt'}</span></div>
      <dl class="ov tiles">
        ${tile(ICON.flag, `${doneCount} / ${n}`, 'Stopps erledigt', bar(doneCount / n))}
        ${tile(ICON.box, pkLeft, `Paket${pkLeft === 1 ? '' : 'e'} übrig${anyPk ? ` von ${pkTotal}` : ''}`, bar(pkTotal ? pkDone / pkTotal : 0))}
        ${tile(ICON.road, fmtKm(totalDist), 'Strecke gesamt')}
        ${tile(ICON.clock, fmtDur(totalDur), 'Reine Fahrzeit')}
        ${(() => { const h = pkPerHour(); return paceOk() || h ? tile(ICON.spark, h ? `${h} Pakete/Std` : `${fmtNum1(settings.pace.sec / 60)} Min`, paceOk() ? `Dein Tempo · ${fmtNum1(settings.pace.sec / 60)} Min pro Stopp` : 'Dein Tempo in dieser Tour', '', 'wide') : ''; })()}
        ${tile(ICON.home, `ca. ${fmtTime(endAt)} Uhr`, route.roundtrip ? 'Zurück am Depot' : 'Tour zu Ende', '', 'wide')}
      </dl>
      ${route.saving > 90 ? `<div class="saving">Die optimierte Reihenfolge spart ${fmtDur(route.saving)} Fahrzeit.</div>` : ''}
      ${route.source !== 'osrm' ? '<div class="saving" style="color:var(--warn)">Routing-Dienst nicht erreichbar – Werte geschätzt (Luftlinie)</div>' : ''}`;
    // nur für die Anzeige oben – nicht mitspeichern (sonst wird das Datum beim Neuladen zu Text)
    Object.defineProperty(route, '_sum', { value: { n, doneCount, pkTotal, pkDone, endAt, totalDist }, enumerable: false, configurable: true, writable: true });

    // Liste
    const rows = [`<li class="depot"><div class="row-main"><span class="num">${HOME_ICON}</span><div class="txt"><div class="q">${esc(d.name)}</div><div class="meta">Start · ${esc(d.label)}</div></div></div></li>`];
    ordered.forEach((s, i) => {
      const done = !!route.done[s.id], eta = etas[i];
      if (editingId === s.id) { rows.push(`<li class="editing" data-id="${s.id}">${editorHtml(s)}</li>`); return; }
      const [l1, ...l2] = s.label.split(',');
      const meta = [l2.join(',').trim(), done ? 'erledigt' : (eta ? 'Ankunft ca. ' + fmtTime(eta) + ' Uhr' : ''), s.approx ? 'Hausnr. ungefähr' : '', s.outside ? 'außerhalb (' + s.outside + ')' : ''].filter(Boolean).join(' · ');
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
  /* Kopf: Fortschritt der ganzen Tour, Mikrofon, Tour beenden */
  function renderTop() {
    $('#tour-stop').hidden = true; $('#topstrip').hidden = true;
    const bar = $('#tour-bar');
    document.body.classList.toggle('touring', !!route);
    if (!route || !route._sum) { bar.innerHTML = ''; return; }
    const { n, doneCount, pkTotal, pkDone, endAt } = route._sum;
    const f = n ? doneCount / n : 0, C = 2 * Math.PI * 22;
    bar.innerHTML = `<div class="tb-ring"><svg viewBox="0 0 52 52"><circle cx="26" cy="26" r="22" class="bg"/><circle cx="26" cy="26" r="22" class="fg" style="stroke-dasharray:${C};stroke-dashoffset:${C * (1 - f)}"/></svg><b><span>${doneCount}</span><small>/${n}</small></b></div>
      <div class="tb-txt"><b>${doneCount === n ? 'Alle Stopps erledigt' : `Noch ${n - doneCount} Stopp${n - doneCount === 1 ? '' : 's'}`}</b>
        <span>${ICON.box}${pkTotal - pkDone} Paket${pkTotal - pkDone === 1 ? '' : 'e'} übrig</span><span>${ICON.home}zurück ca. ${fmtTime(new Date(endAt))} Uhr</span></div>
      <button class="tb-end" id="tb-end" aria-label="Tour beenden">${ICON.flag}<span>Beenden</span></button>`;
    $('#tb-end').onclick = () => $('#tour-stop').onclick();
  }

  /* Leiste im Kartenvollbild: nur nächster Stopp, Haken und Navigation */
  function renderMapBar() {
    const bar = $('#map-bar');
    if (!route || !Map_.full) { bar.hidden = true; return; }
    const cur = currentIndex(), n = route.order.length;
    const s = cur !== -1 ? stopById(route.order[cur]) : settings.depot;
    const title = cur !== -1 ? s.label.split(',')[0] : (route.roundtrip ? 'Zurück zum Depot' : 'Tour geschafft');
    const sub = cur !== -1 ? `Stopp ${cur + 1} von ${n} · ${fmtDur(route.legs[cur].dur)}${s.pk ? ' · ' + pkLabel(s.pk) : ''}` : `Alle ${n} Stopps erledigt`;
    bar.innerHTML = `<span class="mb-num">${cur !== -1 ? cur + 1 : HOME_ICON}</span>
      <button class="mb-info" id="mb-info"><b>${esc(title)}</b><span>${sub}</span></button>
      ${cur !== -1 ? `<button class="dock-btn ok" data-done="${s.id}" aria-label="Erledigt">${ICON.check}</button>` : `<button class="dock-btn ok" data-finish aria-label="Tour beenden">${ICON.flag}</button>`}
      ${cur !== -1 || route.roundtrip ? `<a class="dock-btn primary" href="${navUrl(s)}" target="_blank" rel="noopener" aria-label="Navigieren">${ICON.nav}<span>Los</span></a>` : ''}`;
    bar.hidden = false;
    $('#mb-info').onclick = () => Map_.flyTo(s, 16, .8);
  }

  function renderDock() {
    renderTop(); renderMapBar();
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
    const today = new Date().toLocaleDateString('de-DE', { weekday: 'long', day: 'numeric', month: 'long' });
    const last = history_[0];
    const lastTxt = last ? ` · letzte Tour ${new Date(last.end).toDateString() === new Date(Date.now() - 864e5).toDateString() ? 'gestern' : new Date(last.end).toLocaleDateString('de-DE', { day: 'numeric', month: 'short' })}: ${last.stops} Stopps` : '';
    $('#greeting').innerHTML = `<span class="g-date">${today}${lastTxt}</span>${g}${settings.name ? ', ' + esc(settings.name) : ''}.<small>${ok ? `${ok} Stopp${ok > 1 ? 's' : ''} ab ` : 'Start und Ziel: '}<button class="depot-link" id="depot-link">${esc(settings.depot?.name || 'Depot')}</button></small>`;
    $('#depot-link').onclick = openSettings;
    const c = Geo.streetCount();
    const a = Geo.addrCount();
    $('#area-hint').textContent = indexState === 'loading' || indexState === 'addr' ? 'Gebiet wird gespeichert …' : c ? `${c.streets} Straßen${a ? ', ' + a.n.toLocaleString('de-DE') + ' Hausnummern' : ''} gespeichert` : 'eine pro Zeile';
  }

  /* ---------- Straßenverzeichnis laden ---------- */
  var indexState = '';
  async function loadIndex(force) {
    if (!settings.depot || indexState === 'loading' || indexState === 'addr') return;
    indexState = 'loading'; renderIndexInfo(); renderGreeting();
    const C = regionCenter(), R = regionR();
    // Straßen und Hausnummern gleichzeitig laden (halbiert die Wartezeit)
    const addrJob = Geo.loadAddresses(C, force, R).then(() => null, e => e || new Error('addr'));
    try { await Geo.loadStreets(C, force, R); indexState = ''; }
    catch (_) { indexState = 'error'; }
    applyArea(); renderAreaCard(); renderStops();
    const streetsFailed = indexState === 'error';
    indexState = 'addr'; renderIndexInfo(); renderGreeting();
    const addrErr = await addrJob;
    indexState = streetsFailed ? 'error' : addrErr ? 'addr-error' : '';
    if (!addrErr) {
      // schon eingetragene, nur ungefähr gefundene Adressen jetzt exakt setzen
      let better = 0;
      stops.forEach(s => { if (s.status !== 'ok' || !s.approx) return; const r = Geo.addrLookup(s.query, settings.depot); if (r) { Object.assign(s, { lat: r.lat, lon: r.lon, label: r.label, approx: false }); better++; } });
      if (better) { persist(); if (route) plan(false); else { renderStops(); Map_.render(); } }
    }
    renderIndexInfo(); renderGreeting();
  }
  function renderIndexInfo() {
    const c = Geo.streetCount(), a = Geo.addrCount(), el = $('#s-index');
    const st = indexState === 'loading' ? 'Straßen werden geladen …' : indexState === 'addr' ? 'Hausnummern werden geladen … (kann eine Minute dauern)'
      : c ? `${c.streets} Straßen in ${c.places} Orten${a ? ` · ${a.n.toLocaleString('de-DE')} Hausnummern` : ''} · Stand ${new Date(c.ts).toLocaleDateString('de-DE')}${indexState === 'addr-error' ? ' · Hausnummern gerade nicht erreichbar' : ''}`
      : indexState === 'error' ? 'gerade nicht erreichbar – später noch mal versuchen' : 'noch nicht geladen';
    el.innerHTML = `<span><b>Gebiet offline gespeichert</b><small>${st}</small><small>12 km um dein Depot aus OpenStreetMap: Straßen und Hausnummern. Danach findet die App Adressen sofort, auch ohne Netz.</small></span>
      <button class="btn ${c && a ? 'ghost' : 'primary'}" id="s-index-load" ${indexState === 'loading' || indexState === 'addr' ? 'disabled' : ''}>${c && a ? 'Aktualisieren' : 'Herunterladen'}</button>`;
    $('#s-index-load').onclick = () => loadIndex(true);
  }


  const regionCenter = () => settings.region ? { lat: settings.region.lat, lon: settings.region.lon } : settings.depot;
  const regionR = () => settings.region ? settings.region.r : 12000;

  /* ---------- Gebiet auf der Karte wählen (Mittelpunkt + Radius) ---------- */
  const lon2x = (lon, z) => Math.floor((lon + 180) / 360 * 2 ** z);
  const lat2y = (lat, z) => { const r = lat * Math.PI / 180; return Math.floor((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * 2 ** z); };
  const x2lon = (x, z) => x / 2 ** z * 360 - 180;
  const y2lat = (y, z) => { const n = Math.PI - 2 * Math.PI * y / 2 ** z; return 180 / Math.PI * Math.atan(.5 * (Math.exp(n) - Math.exp(-n))); };
  function tilesFor(lat, lon, rM, z) {
    const dLat = rM / 111320, dLon = rM / (111320 * Math.cos(lat * Math.PI / 180)), out = [];
    const x0 = lon2x(lon - dLon, z), x1 = lon2x(lon + dLon, z), y0 = lat2y(lat + dLat, z), y1 = lat2y(lat - dLat, z);
    for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) {
      const cLat = y2lat(y + .5, z), cLon = x2lon(x + .5, z);
      const half = Geo.haversine(y2lat(y, z), x2lon(x, z), cLat, cLon);
      if (Geo.haversine(lat, lon, cLat, cLon) <= rM + half) out.push([z, x, y]);
    }
    return out;
  }
  /* Offline-Karte: Vektorkacheln von OpenFreeMap (Zoom 0–14, höhere Stufen werden daraus gezoomt). Erlaubt bis 3000 Kacheln je Download, 4 gleichzeitig. */
  function vecPlan(lat, lon, rM) {
    let list = [];
    for (let z = 0; z <= 14; z++) list = list.concat(tilesFor(lat, lon, rM, z));
    return list;
  }
  async function vecDownload(lat, lon, rM, onProgress) {
    if (!window.caches) throw new Error('kein Speicher');
    const cache = await caches.open('tourplan-offline');
    const put = async url => { const r = await fetch(url); if (r.ok) { await cache.put(url, r.clone()); return r; } if (r.status === 404 || r.status === 204) return null; throw new Error(String(r.status)); };
    const tj = await (await put(`${OFM}/planet`)).json();
    const fonts = new Set(), sprites = new Set();
    for (const st of ['liberty', 'dark']) {
      const r = await put(`${OFM}/styles/${st}`); const d = await r.json();
      d.layers.forEach(l => { const f = (l.layout || {})['text-font']; if (Array.isArray(f)) fonts.add(f.filter(x => typeof x === 'string').join(',')); });
      if (d.sprite) sprites.add(d.sprite);
    }
    fonts.add('Noto Sans Bold');
    const extra = [];
    sprites.forEach(sp => ['.json', '.png', '@2x.json', '@2x.png'].forEach(x => extra.push(sp + x)));
    fonts.forEach(f => ['0-255', '256-511'].forEach(r => extra.push(encodeURI(`${OFM}/fonts/${f}/${r}.pbf`))));
    const list = vecPlan(lat, lon, rM), total = list.length + extra.length;
    let done = 0, fail = 0, i = 0, j = 0;
    const tick = () => { done++; onProgress(done, total, fail); };
    const work = async () => {
      while (j < extra.length) { const u = extra[j++]; try { await put(u); } catch (_) { fail++; } tick(); }
      while (i < list.length) {
        const [z, x, y] = list[i++];
        try { await put(tj.tiles[0].replace('{z}', z).replace('{x}', x).replace('{y}', y)); } catch (_) { fail++; }
        tick();
      }
    };
    await Promise.all([work(), work(), work(), work()]);
    return { total, fail, tiles: list.length };
  }

  const Region = {
    map: null, circle: null, pin: null, center: null, r: 8,
    open() {
      if (!window.L) return;
      $('#region').hidden = false; document.body.classList.add('map-full');
      const c = settings.region || settings.depot;
      this.center = L.latLng(c.lat, c.lon);
      this.r = settings.region ? Math.round(settings.region.r / 1000) : 8;
      $('#rg-range').value = this.r;
      if (!this.map) {
        this.map = L.map($('#region-map'), { zoomControl: false, zoomSnap: .25 });
        this.map.on('click', e => this.setCenter(e.latlng, true));
      }
      const st = MAP_STYLES[mapStyle()];
      attachBase(this, this.map, st, mapDark());
      $('#region-map').classList.toggle('no-filter', !st.filter); $('#region-map').classList.toggle('map-dark', mapDark() && !!st.filter);
      setTimeout(() => { this.map.invalidateSize(); this.map.setView(this.center, this.zoomFor()); this.setCenter(this.center); this.fit(); }, 30);
      $('#rg-status').textContent = ''; $('#rg-progress').hidden = true; $('#rg-save').disabled = false;
    },
    close() { $('#region').hidden = true; document.body.classList.remove('map-full'); },
    fit() {                         // Kreis immer ganz im sichtbaren Teil der Karte (über dem Bedienfeld)
      if (!this.circle) return;
      const side = innerWidth >= 960, ph = $('.region-panel').offsetHeight;
      this.map.fitBounds(this.circle.getBounds(), { animate: false, paddingTopLeft: [28, 76], paddingBottomRight: side ? [440, 28] : [28, ph + 24] });
    },
    placeHandle() {                 // Griff am rechten Kreisrand
      if (!this.handle || !this.center) return;
      const c = this.center, dLon = this.r * 1000 / (111320 * Math.cos(c.lat * Math.PI / 180));
      this.handle.setLatLng([c.lat, c.lng + dLon]);
    },
    setCenter(ll, fromTap) {
      this.center = ll;
      const color = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim();
      if (!this.pin) {
        this.pin = L.marker(ll, { draggable: true, icon: L.divIcon({ className: '', html: '<div class="rg-pin"></div>', iconSize: [34, 34], iconAnchor: [17, 17] }) }).addTo(this.map);
        this.pin.on('drag', e => { this.center = e.target.getLatLng(); this.update(); });
        this.pin.on('dragend', () => { this.update(true); this.fit(); });
      } else this.pin.setLatLng(ll);
      if (!this.circle) this.circle = L.circle(ll, { radius: this.r * 1000, color, weight: 3, fillColor: color, fillOpacity: .12, interactive: false }).addTo(this.map);
      this.circle.setLatLng(ll);
      if (!this.handle) {            // Rand anfassen und ziehen = Umkreis größer oder kleiner
        this.handle = L.marker(ll, { draggable: true, zIndexOffset: 500, icon: L.divIcon({ className: '', html: '<div class="rg-handle"><svg viewBox="0 0 24 24"><path d="M8 7 3 12l5 5M16 7l5 5-5 5M3 12h18"/></svg></div>', iconSize: [44, 44], iconAnchor: [22, 22] }) }).addTo(this.map);
        this.handle.on('drag', e => {
          this.r = Math.max(1, Math.min(20, Math.round(this.map.distance(this.center, e.target.getLatLng()) / 1000)));
          $('#rg-range').value = this.r; this.circle.setRadius(this.r * 1000); $('#rg-r').textContent = this.r + ' km';
        });
        this.handle.on('dragend', () => { this.update(true); this.fit(); });
      }
      if (fromTap) { this.circle.setRadius(1); this.grow(); if (navigator.vibrate) navigator.vibrate(10); }   // Kreis „zieht sich auf“
      else this.update(true);
    },
    grow() {
      const target = this.r * 1000, t0 = performance.now();
      const step = now => {
        const f = Math.min(1, (now - t0) / 450), e = 1 - Math.pow(1 - f, 3);
        this.circle.setRadius(Math.max(1, target * e));
        if (f < 1) requestAnimationFrame(step); else { this.update(true); this.fit(); }
      };
      requestAnimationFrame(step);
    },
    zoomFor() { return Math.max(8, Math.min(14, Math.round(Math.log2(40000 / this.r)) + 3)); },
    update(full) {
      if (!this.map || !this.center) return;
      const c = this.center, rM = this.r * 1000;
      this.circle.setLatLng(c).setRadius(rM);
      $('#rg-r').textContent = this.r + ' km';
      this.placeHandle();
      if (!full) return;
      const covered = Geo.streetsCover(c.lat, c.lng, rM);
      const pl = covered ? Geo.placesInCircle(c.lat, c.lng, rM) : [];
      const sel = new Set(settings.area || []);
      $('#rg-places').innerHTML = covered
        ? (pl.length ? `<details class="rg-det"><summary>${pl.length} Orte im Kreis <small>antippen: einzelne abwählen</small></summary><div class="area-chips">${pl.map(p => `<button type="button" data-place="${esc(p.name)}" aria-pressed="${!settings.area || sel.has(p.name) || !settings.region ? 'true' : 'false'}">${esc(p.name)}<small>${p.count} Str.</small></button>`).join('')}</div></details>` : '<small>Keine Orte im Kreis.</small>')
        : '<small>Die Orte in diesem Kreis werden beim Speichern geladen.</small>';
      const n = vecPlan(c.lat, c.lng, rM).length;
      $('#rg-tiles').disabled = false;
      $('#rg-tiles-info').textContent = `${n} Kartenteile, ca. ${Math.max(7, Math.round(n * 22 / 1024 + 6))} MB · Straßennamen, Hausnummern und Gebäude`;
    },
    async save() {
      const c = this.center, rM = this.r * 1000;
      const chips = [...$('#rg-places').querySelectorAll('[data-place]')];
      const chosen = chips.length ? chips.filter(b => b.getAttribute('aria-pressed') === 'true').map(b => b.dataset.place) : null;
      settings.region = { lat: +c.lat.toFixed(5), lon: +c.lng.toFixed(5), r: rM };
      persist();
      $('#rg-save').disabled = true; $('#rg-progress').hidden = false;
      const bar = f => { $('#rg-bar').style.width = Math.round(f * 100) + '%'; };
      let idxDone = false, tDone = 0, tAll = 0, tFail = 0, tErr = '';
      const show = () => {
        bar(Math.max(.05, (idxDone ? .35 : .1) + (tAll ? .65 * tDone / tAll : (idxDone ? .65 : 0))));
        $('#rg-status').textContent = (tAll && tDone < tAll ? `Karte wird gespeichert … ${tDone} von ${tAll}` : tAll ? 'Karte gespeichert' : '') + (idxDone ? '' : (tAll ? ' · ' : '') + 'Straßen und Hausnummern werden geladen … (bis zu 2 Minuten)');
      };
      show();
      // Karte und Straßenverzeichnis gleichzeitig laden – spart Wartezeit
      const tilesJob = (async () => {
        if (!$('#rg-tiles').checked) return;
        try { await caches.delete('tourplan-offline'); } catch (_) {}
        try {
          const r = await vecDownload(c.lat, c.lng, rM, (d, t, f) => { tDone = d; tAll = t; tFail = f; show(); });
          tAll = r.total; tFail = r.fail;
          if (r.fail < r.total / 4) { settings.region.vec = Date.now(); persist(); } else tErr = 'viele Kartenteile fehlen';
        } catch (e) { tErr = e.message || 'Fehler'; tFail = tAll = tAll || 1; }
      })();
      await loadIndex(true); idxDone = true; show();
      // Gebiet = gewählte Orte, sonst alle Orte im Kreis
      const inCircle = Geo.placesInCircle(c.lat, c.lng, rM).map(p => p.name);
      settings.area = chosen && chosen.length ? chosen : inCircle; settings.areaAuto = false; settings.areaOk = true;
      applyArea(); renderAreaCard(); renderStops();
      await tilesJob;
      Map_.setTiles();
      bar(1);
      const a = Geo.addrCount(), sc = Geo.streetCount();
      const failed = indexState === 'error' || indexState === 'addr-error';
      $('#rg-status').textContent =
        tErr ? `Die Karte konnte nicht vollständig gespeichert werden (${tErr}). Bitte mit gutem Netz noch einmal versuchen.` : failed ? `Der Kartendienst für Straßen ist gerade überlastet – bisherige Daten bleiben (${sc ? sc.streets : 0} Straßen). Später in den Einstellungen „Aktualisieren“ tippen.${settings.region.z ? ' Karte ist gespeichert.' : ''}`
        : `Fertig: ${sc ? sc.streets : 0} Straßen, ${a ? a.n.toLocaleString('de-DE') : 0} Hausnummern${settings.region.vec ? ', Karte offline' : ''} gespeichert.`;
      $('#rg-save').disabled = false;
      toast(failed ? 'Gebiet gespeichert – Straßen später aktualisieren' : 'Gebiet gespeichert');
      setTimeout(() => this.close(), failed ? 5000 : 1600);
    },
  };
  $('#rg-range').addEventListener('input', e => { Region.r = +e.target.value; Region.update(); clearTimeout(Region.t); Region.t = setTimeout(() => { Region.update(true); Region.fit(); }, 350); });
  $('#rg-close').onclick = () => Region.close();
  $('#rg-save').onclick = () => Region.save();
  $('#rg-places').addEventListener('click', e => { const b = e.target.closest('[data-place]'); if (b) b.setAttribute('aria-pressed', b.getAttribute('aria-pressed') !== 'true'); });

  /* ---------- Zustellgebiet ---------- */
  function defaultArea() {                    // Ort des Depots plus Orte, die sehr nah dran liegen
    const list = Geo.places(settings.depot);
    if (!list.length) return null;
    return list.filter((p, i) => i === 0 || p.km < 2.5).map(p => p.name);
  }
  function applyArea() {
    if (!settings.area && Geo.streetCount()) { settings.area = defaultArea(); settings.areaAuto = true; persist(); }
    Geo.setArea(settings.area || []);
    refreshOutside(); persist();
  }
  function addToArea(name) {
    settings.area = Array.from(new Set([...(settings.area || []), name])); settings.areaAuto = false;
    applyArea(); renderStops(); renderResult(); renderAreaCard();
    toast(`${name} gehört jetzt zu deinem Zustellgebiet`);
  }
  function renderAreaChips(el) {
    const list = Geo.places(settings.depot).slice(0, 40), sel = new Set(settings.area || []);
    if (!list.length) { el.innerHTML = '<small class="muted">Erscheint, sobald das Straßenverzeichnis geladen ist.</small>'; return; }
    el.innerHTML = list.map(p => `<button type="button" data-place="${esc(p.name)}" aria-pressed="${sel.has(p.name)}">${esc(p.name)}<small>${p.km < 1 ? '' : Math.round(p.km) + ' km'}</small></button>`).join('');
    el.onclick = e => {
      const b = e.target.closest('[data-place]'); if (!b) return;
      b.setAttribute('aria-pressed', b.getAttribute('aria-pressed') !== 'true');
    };
  }
  const readAreaChips = el => [...el.querySelectorAll('[data-place][aria-pressed="true"]')].map(b => b.dataset.place);
  function renderAreaCard() {
    const el = $('#area-card');
    if (!settings.areaAuto || settings.areaOk || !settings.area || !settings.area.length || route) { el.innerHTML = ''; return; }
    el.innerHTML = `<section class="card area-card"><span class="ic" style="color:var(--accent)">${PIN_ICON}</span>
      <div class="txt"><b>Dein Zustellgebiet: ${esc(settings.area.join(', '))}</b>Adressen außerhalb werden markiert. Stimmt das?</div>
      <button class="btn ghost" id="area-edit">Anpassen</button><button class="btn primary" id="area-ok">Passt</button></section>`;
    $('#area-ok').onclick = () => { settings.areaOk = true; persist(); renderAreaCard(); };
    $('#area-edit').onclick = () => { settings.areaOk = true; persist(); renderAreaCard(); openSettings(); sPage('area'); };
  }

  /* Einrichtung auf ein anderes Gerät übertragen: alles steckt im Link, nichts geht über einen Server */
  async function shareSetup() {
    const data = Object.assign({}, settings, { theme: settings.theme === 'auto' ? (isDark() ? 'dark' : 'light') : settings.theme });
    delete data.onboarded;
    const b64 = btoa(unescape(encodeURIComponent(JSON.stringify(data)))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    const url = location.origin + location.pathname + '#setup=' + b64;
    try {
      if (navigator.share && matchMedia('(pointer:coarse)').matches) await navigator.share({ title: 'Tourplan einrichten', url });
      else { await navigator.clipboard.writeText(url); toast('Link kopiert – auf dem anderen Gerät öffnen', 4000); }
    } catch (_) {}
  }

  /* ---------- Einstellungen ---------- */
  function sPage(name) {
    let cur = null;
    document.querySelectorAll('#settings .s-page').forEach(p => { p.hidden = p.dataset.page !== name; if (!p.hidden) cur = p; });
    $('#settings-title').textContent = name === 'main' ? 'Einstellungen' : cur.dataset.title;
    $('#s-back').hidden = name === 'main';
    $('#settings .sheet').scrollTop = 0;
  }
  $('#settings').addEventListener('click', e => { const g = e.target.closest('[data-go]'); if (g) sPage(g.dataset.go); });
  $('#s-back').onclick = () => sPage('main');
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
    $('#s-autopace').checked = settings.autoPace !== false;
    $('#s-pace-info').textContent = settings.pace && settings.pace.n ? `Gelernt: ${fmtNum1(settings.pace.sec / 60)} Min pro Stopp (aus ${settings.pace.n} Stopps)${settings.pace.n < 3 ? ' – gilt ab 3 Stopps' : ''}` : 'Noch nichts gelernt – nach den ersten Stopps rechnet die App mit deinem Tempo.';
    $('#s-pace-reset').hidden = !(settings.pace && settings.pace.n);
    $('#s-pace-reset').onclick = () => { delete settings.pace; persist(); $('#s-pace-info').textContent = 'Zurückgesetzt.'; $('#s-pace-reset').hidden = true; if (route) renderResult(); };
    renderNavChoices($('#s-nav'), true);
    renderThemeChoices($('#s-theme'));
    renderAccentChoices($('#s-accent'));
    renderMapStyleChoices($('#s-mapstyle'));
    $('#s-meicon').innerHTML = Object.entries(ME_ICONS).map(([k, v]) => `<button data-mi="${k}" aria-pressed="${(settings.meIcon || 'arrow') === k}">${v.name.replace('Gelber ', '')}</button>`).join('');
    $('#s-meicon').onclick = e => { const b = e.target.closest('[data-mi]'); if (!b) return; settings.meIcon = b.dataset.mi; persist(); Me.redraw(); $('#s-meicon').querySelectorAll('button').forEach(x => x.setAttribute('aria-pressed', x === b)); };
    renderAreaChips($('#s-area'));
    $('#s-tomtom').value = settings.tomtom || '';
    $('#s-ai-key').value = settings.aiKey || '';
    renderIndexInfo();
    const ar = settings.area || [];
    $('#s-area-sum').textContent = ar.length ? ar.slice(0, 3).join(', ') + (ar.length > 3 ? ` + ${ar.length - 3} weitere` : '') : 'noch nicht festgelegt';
    $('#s-keys-sum').textContent = [settings.tomtom ? 'TomTom ✓' : 'TomTom –', settings.aiKey ? 'KI ✓' : 'KI –'].join(' · ');
    sPage('main');
    $('#settings').hidden = false;
  }
  const closeSettings = () => { $('#settings').hidden = true; };
  $('#settings-open').onclick = openSettings;
  $('#settings-close').onclick = closeSettings;
  $('#settings').addEventListener('click', e => { if (e.target.id === 'settings') closeSettings(); });
  addEventListener('keydown', e => {
    if (e.key !== 'Escape') return;
    if (!$('#region').hidden) Region.close(); else if (!$('#quick').hidden) closeQuick(); else if (!$('#sheet').hidden) closeSheet(); else if (!$('#settings').hidden) closeSettings(); else if (Map_.full) Map_.setFull(false);
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
    settings.autoPace = $('#s-autopace').checked;
    if ($('#s-area [data-place]')) { const a = readAreaChips($('#s-area')); settings.area = a; settings.areaAuto = false; settings.areaOk = true; }
    settings.tomtom = $('#s-tomtom').value.trim();
    settings.aiKey = $('#s-ai-key').value.trim();
    Geo.setKeys({ tomtom: settings.tomtom });
    applyArea(); Map_.setTiles(); renderAreaCard();
    persist(); closeSettings(); renderStops(); renderResult();
    loadIndex(false);
    if (JSON.stringify([settings.depot && [settings.depot.lat, settings.depot.lon], settings.roundtrip]) !== before && route) { toast('Gespeichert – Route wird neu berechnet'); plan(true); }
    else { toast('Gespeichert'); Pois.key = ''; Pois.refresh(); }
  };
  $('#s-transfer').onclick = shareSetup;
  $('#s-region').onclick = () => { closeSettings(); Region.open(); };
  $('#s-ai-test').onclick = async () => {
    const k = $('#s-ai-key').value.trim(), note = $('#s-ai-note');
    if (!k) { note.textContent = 'Erst einen Schlüssel eintragen.'; return; }
    note.textContent = 'Teste …';
    try { const m = await AI.test(k); note.textContent = `✓ Schlüssel funktioniert (${m}). Mit „Speichern“ übernehmen.`; }
    catch (e) { note.textContent = 'Schlüssel wird nicht angenommen: ' + e.message; }
  };
  $('#s-tomtom-test').onclick = async () => {
    const k = $('#s-tomtom').value.trim(), note = $('#s-tomtom-note');
    if (!k) { note.textContent = 'Erst einen Schlüssel eintragen.'; return; }
    note.textContent = 'Teste …';
    try { await Geo.tomtomTest(k); note.textContent = '✓ Schlüssel funktioniert. Mit „Speichern“ übernehmen.'; }
    catch (e) { note.textContent = 'Schlüssel wird nicht angenommen (' + e.message + ').'; }
  };
  $('#s-reset').onclick = () => {
    if (!confirm('Alle Einstellungen, Stopps und den Verlauf löschen?')) return;
    ['tp.settings', 'tp.stops', 'tp.route', 'tp.history', 'tp.streets.v1'].forEach(k => localStorage.removeItem(k));
    location.reload();
  };

  /* ---------- Start ---------- */
  function startApp() {
    $('#app').hidden = false;
    Geo.setKeys({ tomtom: settings.tomtom });
    applyArea(); renderAreaCard();
    if (imported) setTimeout(() => toast('Einrichtung übernommen – gleiche Einstellungen wie auf dem anderen Gerät', 4500), 400);
    stops.forEach(s => { delete s.busy; seenIds.add(s.id); });
    applyTheme();
    renderStops();
    renderResult();
    Map_.syncTouch();
    runGeocoding();
    Pois.refresh();
    loadIndex(false);
    setTimeout(() => Me.auto(), 900);             // Standort schon erlaubt → gleich auf der Startkarte zeigen
    $('#howto-btn').onclick = () => openSheet('So schreibst oder sagst du Adressen', `<div class="howto">${$('#howto-tpl').innerHTML}</div>`);
  }

  applyTheme();
  if (!settings.onboarded || !settings.depot) startOnboarding(); else startApp();
  setTimeout(() => { const sp = $('#splash'); if (sp) { sp.classList.add('hide'); setTimeout(() => sp.remove(), 450); } }, 700);

  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) navigator.serviceWorker.register('sw.js').catch(() => {});
})();
