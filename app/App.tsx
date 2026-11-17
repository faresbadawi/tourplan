import { StatusBar } from 'expo-status-bar';
import * as Location from 'expo-location';
import { useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, Linking, Platform, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { aiParse, aiTest, Provider } from './src/ai';
import { geocode, legs, matrix, Place, reverse } from './src/geo';
import { solve } from './src/optimize';
import { parseLine, smartParse } from './src/parse';
import { Route, Settings, State, Stop, usePersisted } from './src/store';
import { ACCENTS, Btn, C, min, st } from './src/ui';
import { MapScreen } from './src/MapScreen';
import { LoadScreen } from './src/LoadScreen';
import { HistoryScreen } from './src/HistoryScreen';

const uid = () => Math.random().toString(36).slice(2, 10);

type Tab = 'tour' | 'map' | 'load' | 'hist' | 'set';
const TABS: [Tab, string, string][] = [['tour', '📋', 'Tour'], ['map', '🗺️', 'Karte'], ['load', '🚚', 'Laderaum'], ['hist', '📈', 'Verlauf'], ['set', '⚙️', 'Optionen']];

export default function App() {
  const [state, setState, ready] = usePersisted();
  const [tab, setTab] = useState<Tab>('tour');
  const A = state.settings.accent;
  const set = (p: Partial<State>) => setState(s => ({ ...s, ...p }));
  const setS = (p: Partial<Settings>) => setState(s => ({ ...s, settings: { ...s.settings, ...p } }));
  return (
    <SafeAreaProvider>
      <SafeAreaView style={st.root} edges={['top', 'bottom']}>
        <StatusBar style="light" />
        <View style={st.head}>
          <Text style={st.title}>Tour<Text style={{ color: A }}>plan</Text></Text>
          {state.route && (tab === 'tour' || tab === 'map') && <Progress route={state.route} pace={state.settings.pace.sec} accent={A} />}
        </View>
        <View style={{ flex: 1 }}>
          {!ready ? <ActivityIndicator color={A} style={{ marginTop: 40 }} />
            : tab === 'set' ? <SettingsView s={state.settings} onChange={setS} />
            : tab === 'map' ? <MapScreen state={state} onNav={p => navigate(p, state.settings.nav)} onDone={id => setState(s => markDone(s, id, true))} />
            : tab === 'load' ? <LoadScreen state={state} onChange={setS} />
            : tab === 'hist' ? <HistoryScreen state={state} onClear={() => set({ history: [] })} />
            : state.route ? <Drive state={state} set={set} setState={setState} />
            : <Plan state={state} setState={setState} onNeedDepot={() => setTab('set')} />}
        </View>
        <View style={st.tabs}>
          {TABS.map(([k, ic, l]) => (
            <Pressable key={k} onPress={() => setTab(k)} style={st.tab}>
              <Text style={{ fontSize: 18, opacity: tab === k ? 1 : 0.55 }}>{ic}</Text>
              <Text style={[st.tabT, tab === k && { color: A }]}>{l}</Text>
              <View style={[st.tabBar, tab === k && { backgroundColor: A }]} />
            </Pressable>
          ))}
        </View>
      </SafeAreaView>
    </SafeAreaProvider>
  );
}


/* ---------- Planen: Adressen eingeben, prüfen, optimieren ---------- */
function Plan({ state, setState, onNeedDepot }: { state: State; setState: React.Dispatch<React.SetStateAction<State>>; onNeedDepot: () => void }) {
  const { settings: S, stops } = state, A = S.accent;
  const [text, setText] = useState('');
  const [busy, setBusy] = useState<'' | 'ai' | 'opt'>('');
  const [msg, setMsg] = useState('');
  const hasAi = !!(S.ai.groq?.trim() || S.ai.gemini?.trim());

  const patch = (id: string, p: Partial<Stop>) => setState(s => ({ ...s, stops: s.stops.map(x => (x.id === id ? { ...x, ...p } : x)) }));
  async function add(items: { query: string; pk: number | null }[]) {
    const fresh: Stop[] = items.filter(i => i.query).map(i => ({ id: uid(), query: i.query, pk: i.pk, status: 'pending' }));
    setState(s => ({ ...s, stops: [...s.stops, ...fresh] }));
    setText('');
    for (let i = 0; i < fresh.length; i += 2)   // höchstens 2 gleichzeitig (Photon sperrt sonst)
      await Promise.all(fresh.slice(i, i + 2).map(async x => {
        const p = await geocode(x.query, S.depot);
        patch(x.id, p ? { status: 'ok', place: p } : { status: 'err' });
      }));
  }
  const addLocal = () => add(smartParse(text, true, S.depot?.city ? [S.depot.city] : []).map((l: string) => parseLine(l)));
  async function addAi() {
    setBusy('ai'); setMsg('');
    try { const r = await aiParse(text, S.ai, S.depot?.city); setMsg(`${r.stops.length} Adressen erkannt (${r.used === 'groq' ? 'Groq' : 'Gemini'})`); await add(r.stops); }
    catch (e: any) { setMsg('KI: ' + e.message + ' – nutze einfache Erkennung'); addLocal(); }
    finally { setBusy(''); }
  }
  async function optimize() {
    const ok = stops.filter(s => s.status === 'ok' && s.place);
    if (!ok.length) return;
    let start = S.depot;
    if (S.fromHere || !start) {
      const perm = await Location.requestForegroundPermissionsAsync();
      if (perm.granted) { const p = await Location.getCurrentPositionAsync({}); start = await reverse({ lat: p.coords.latitude, lon: p.coords.longitude }); }
    }
    if (!start) { Alert.alert('Startpunkt fehlt', 'Bitte Depot in den Einstellungen festlegen oder Standort erlauben.', [{ text: 'Zum Depot', onPress: onNeedDepot }]); return; }
    setBusy('opt');
    try {
      const pts = [start, ...ok.map(s => s.place!)];
      const { dur, source } = await matrix(pts);
      const { order } = solve(dur, S.roundtrip, 1500);
      const ids = (order as number[]).map(i => ok[i - 1].id);
      const seq = [start, ...ids.map(id => ok.find(s => s.id === id)!.place!), ...(S.roundtrip && S.depot ? [S.depot] : [])];
      const r = await legs(seq);
      const route: Route = { order: ids, legs: r.legs, line: r.line, done: {}, doneAt: {}, source, start, created: Date.now() };
      setState(s => ({ ...s, route }));
    } finally { setBusy(''); }
  }

  const nOk = stops.filter(s => s.status === 'ok').length, pk = stops.reduce((a, s) => a + (s.pk || 1), 0);
  return (
    <FlatList
      data={stops} keyExtractor={s => s.id} contentContainerStyle={{ padding: 16, gap: 8 }} keyboardShouldPersistTaps="handled"
      ListHeaderComponent={<View style={{ gap: 10, marginBottom: 6 }}>
        <TextInput value={text} onChangeText={setText} multiline placeholder={'Adressen tippen oder per Mikrofon der Tastatur diktieren\nz. B. „Hauptstraße 5 - 3, Lindenweg 3 und 5“'}
          placeholderTextColor={C.dim} style={st.input} />
        <View style={st.row}>
          <View style={{ flex: 1 }}><Btn label="Hinzufügen" color={A} ghost onPress={addLocal} /></View>
          {hasAi && <View style={{ flex: 1 }}><Btn label="✨ Mit KI" color={A} busy={busy === 'ai'} onPress={addAi} /></View>}
        </View>
        {!!msg && <Text style={st.dim}>{msg}</Text>}
        {!!stops.length && <View style={[st.row, { justifyContent: 'space-between' }]}>
          <Text style={st.h2}>{stops.length} Stopps · {pk} Pakete</Text>
          <Pressable onPress={() => Alert.alert('Liste leeren?', '', [{ text: 'Abbrechen' }, { text: 'Leeren', style: 'destructive', onPress: () => setState(s => ({ ...s, stops: [] })) }])}><Text style={st.dim}>Leeren</Text></Pressable>
        </View>}
      </View>}
      renderItem={({ item: s, index }) => (
        <Pressable style={st.card} disabled={s.status !== 'err'} onPress={async () => {
          patch(s.id, { status: 'pending' });
          const p = await geocode(s.query, S.depot);
          patch(s.id, p ? { status: 'ok', place: p } : { status: 'err' });
        }}>
          <Text style={[st.num, { color: A }]}>{index + 1}</Text>
          <View style={{ flex: 1 }}>
            <Text style={st.item}>{s.place?.label || s.query}</Text>
            <Text style={[st.dim, s.status === 'err' && { color: C.err }]}>
              {s.status === 'pending' ? 'Suche …' : s.status === 'err' ? 'Nicht gefunden – antippen für neuen Versuch' : s.place?.approx ? 'Hausnummer ungefähr' : 'Gefunden'}
            </Text>
          </View>
          <Pressable onPress={() => setState(st2 => ({ ...st2, stops: st2.stops.map(x => (x.id === s.id ? { ...x, pk: ((x.pk || 1) % 9) + 1 } : x)) }))} style={st.pk}>
            <Text style={st.pkT}>{s.pk || 1}📦</Text>
          </Pressable>
          <Pressable hitSlop={10} onPress={() => setState(st2 => ({ ...st2, stops: st2.stops.filter(x => x.id !== s.id) }))}><Text style={st.x}>✕</Text></Pressable>
        </Pressable>
      )}
      ListFooterComponent={nOk ? <View style={{ marginTop: 10 }}><Btn label={`Route optimieren (${nOk})`} color={A} busy={busy === 'opt'} onPress={optimize} /></View> : undefined}
    />
  );
}

/* ---------- Fahren: Stopp für Stopp ---------- */
function navigate(p: Place, nav: Settings['nav']) {
  const ll = `${p.lat},${p.lon}`;
  const url = nav === 'waze' ? `https://waze.com/ul?ll=${ll}&navigate=yes`
    : nav === 'geo' ? (Platform.OS === 'ios' ? `maps:?daddr=${ll}` : `geo:${ll}?q=${ll}`)
    : Platform.OS === 'android' ? `google.navigation:q=${ll}` : `https://www.google.com/maps/dir/?api=1&destination=${ll}&travelmode=driving`;
  Linking.openURL(url).catch(() => Linking.openURL(`https://www.google.com/maps/dir/?api=1&destination=${ll}`));
}

function Progress({ route, pace, accent }: { route: Route; pace: number; accent: string }) {
  const n = route.order.length, d = Object.keys(route.done).length;
  const left = route.legs.slice(d).reduce((a, l) => a + l.dur, 0) + (n - d) * pace;
  const eta = new Date(Date.now() + left * 1000).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
  return (
    <View style={{ marginTop: 8 }}>
      <Text style={st.dim}>{d} / {n} erledigt · noch ca. {min(left)} · fertig ≈ {eta}</Text>
      <View style={st.bar}><View style={{ width: `${(d / n) * 100}%`, height: '100%', backgroundColor: accent, borderRadius: 3 }} /></View>
    </View>
  );
}

/** Stopp abhaken/überspringen/zurücksetzen. Beim Zustellen wird das Tempo (Zeit je Stopp ohne Fahrt) gelernt. */
function markDone(s: State, id: string, v: true | 'skip' | null): State {
  const r = s.route; if (!r) return s;
  const done = { ...r.done }, doneAt = { ...(r.doneAt || {}) }, now = Date.now();
  let pace = s.settings.pace;
  if (v) {
    const i = r.order.indexOf(id), prev = Math.max(r.created, ...Object.values(doneAt));
    const sec = (now - prev) / 1000 - (r.legs[i]?.dur || 0);
    if (v === true && Object.keys(done).length && sec > 10 && sec < 900) { const n = Math.min(pace.n + 1, 50); pace = { n, sec: (pace.sec * (n - 1) + sec) / n }; }
    done[id] = v; doneAt[id] = now;
  } else { delete done[id]; delete doneAt[id]; }
  return { ...s, route: { ...r, done, doneAt }, settings: { ...s.settings, pace } };
}

function Drive({ state, set, setState }: { state: State; set: (p: Partial<State>) => void; setState: React.Dispatch<React.SetStateAction<State>> }) {
  const { route, stops, settings: S } = state as State & { route: Route };
  const A = S.accent;
  const byId = useMemo(() => Object.fromEntries(stops.map(s => [s.id, s])), [stops]);
  const nextIdx = route.order.findIndex(id => !route.done[id]);
  const cur = nextIdx >= 0 ? byId[route.order[nextIdx]] : null;
  const mark = (id: string, v: true | 'skip' | null) => setState(s => markDone(s, id, v));
  const total = route.legs.reduce((a, l) => a + l.dist, 0) / 1000;
  const skipped = Object.values(route.done).filter(v => v === 'skip').length;
  const finish = () => Alert.alert('Tour beenden?', 'Die Tour kommt in den Verlauf, die Stopp-Liste wird geleert.', [{ text: 'Abbrechen' }, { text: 'Beenden', style: 'destructive', onPress: () => {
    const ids = Object.keys(route.done), pk = ids.filter(id => route.done[id] === true).reduce((a, id) => a + (byId[id]?.pk || 1), 0);
    const end = Math.max(route.created, ...Object.values(route.doneAt || {}));
    const h = { at: route.created, stops: ids.length - skipped, skipped, pk, km: total, min: (end - route.created) / 60000 };
    set({ route: null, stops: [], history: ids.length ? [h, ...state.history].slice(0, 200) : state.history });
  } }]);

  return (
    <ScrollView contentContainerStyle={{ padding: 16, gap: 12 }}>
      {cur ? (
        <View style={[st.hero, { borderColor: A }]}>
          <Text style={[st.dim, { color: A, fontWeight: '700' }]}>NÄCHSTER STOPP {nextIdx + 1}</Text>
          <Text style={st.heroT}>{cur.place?.label.split(',')[0]}</Text>
          <Text style={st.dim}>{cur.place?.label.split(',').slice(1).join(',').trim()} · {cur.pk || 1} Paket{(cur.pk || 1) > 1 ? 'e' : ''} · {min(route.legs[nextIdx]?.dur || 0)}</Text>
          <Btn label="Navigation starten" color={A} onPress={() => navigate(cur.place!, S.nav)} />
          <View style={st.row}>
            <View style={{ flex: 2 }}><Btn label="✓ Zugestellt" color={C.ok} onPress={() => mark(cur.id, true)} /></View>
            <View style={{ flex: 1 }}><Btn label="Überspringen" color={C.skip} ghost onPress={() => mark(cur.id, 'skip')} /></View>
          </View>
        </View>
      ) : (
        <View style={[st.hero, { borderColor: C.ok }]}>
          <Text style={st.heroT}>Geschafft! 🎉</Text>
          <Text style={st.dim}>{route.order.length - skipped} zugestellt{skipped ? ` · ${skipped} übersprungen (zurück ins Depot)` : ''} · {total.toFixed(1)} km</Text>
          {S.roundtrip && S.depot && <Btn label="Zum Depot" color={A} onPress={() => navigate(S.depot!, S.nav)} />}
        </View>
      )}
      {route.source !== 'osrm' && <Text style={[st.dim, { color: C.skip }]}>Routing-Dienst nicht erreichbar – Reihenfolge nach Luftlinie.</Text>}
      <Text style={st.h2}>Alle Stopps · {total.toFixed(1)} km</Text>
      {route.order.map((id, i) => {
        const s = byId[id], d = route.done[id];
        if (!s) return null;
        return (
          <Pressable key={id} onLongPress={() => mark(id, d ? null : true)} style={[st.card, i === nextIdx && { borderColor: A }, !!d && { opacity: 0.45 }]}>
            <Text style={[st.num, { color: d === 'skip' ? C.skip : d ? C.ok : A }]}>{d === 'skip' ? '↺' : d ? '✓' : i + 1}</Text>
            <Text style={[st.item, { flex: 1 }]} numberOfLines={1}>{s.place?.label}</Text>
            <Text style={st.dim}>{s.pk || 1}📦</Text>
          </Pressable>
        );
      })}
      <Text style={[st.dim, { textAlign: 'center' }]}>Lange drücken: Stopp abhaken oder zurücksetzen</Text>
      <View style={st.row}>
        <View style={{ flex: 1 }}><Btn label="Bearbeiten" color={C.dim} ghost onPress={() => set({ route: null })} /></View>
        <View style={{ flex: 1 }}><Btn label="Tour beenden" color={C.err} ghost onPress={finish} /></View>
      </View>
    </ScrollView>
  );
}

/* ---------- Einstellungen ---------- */
function SettingsView({ s, onChange }: { s: Settings; onChange: (p: Partial<Settings>) => void }) {
  const A = s.accent;
  const [depotQ, setDepotQ] = useState('');
  const [busy, setBusy] = useState('');
  const [info, setInfo] = useState<Record<string, string>>({});
  const keys = useRef(s.ai);
  async function findDepot(here?: boolean) {
    setBusy('depot');
    try {
      let p: Place | null = null;
      if (here) {
        const perm = await Location.requestForegroundPermissionsAsync();
        if (perm.granted) { const c = (await Location.getCurrentPositionAsync({})).coords; p = await reverse({ lat: c.latitude, lon: c.longitude }); }
      } else p = await geocode(depotQ);
      if (p) { onChange({ depot: p }); setDepotQ(''); } else Alert.alert('Nicht gefunden');
    } finally { setBusy(''); }
  }
  async function test(p: Provider) {
    const k = s.ai[p]; if (!k) return;
    setBusy(p);
    try { const m = await aiTest(p, k); setInfo(i => ({ ...i, [p]: '✓ funktioniert · ' + m })); }
    catch (e: any) { setInfo(i => ({ ...i, [p]: '✕ ' + e.message })); }
    finally { setBusy(''); }
  }
  const Choice = <T extends string>({ value, options, onPick }: { value: T; options: [T, string][]; onPick: (v: T) => void }) => (
    <View style={st.seg}>{options.map(([v, l]) => (
      <Pressable key={v} onPress={() => onPick(v)} style={[st.segI, value === v && { backgroundColor: A }]}><Text style={[st.segT, value === v && { color: '#111' }]}>{l}</Text></Pressable>
    ))}</View>
  );
  const keyField = (p: Provider, label: string, ph: string, link: string) => (
    <View style={{ gap: 6 }}>
      <Text style={st.label}>{label}</Text>
      <View style={st.row}>
        <TextInput defaultValue={s.ai[p]} placeholder={ph} placeholderTextColor={C.dim} secureTextEntry autoCapitalize="none" autoCorrect={false}
          style={[st.field, { flex: 1 }]} onChangeText={v => { keys.current = { ...keys.current, [p]: v.trim() }; }} onEndEditing={() => onChange({ ai: { ...s.ai, ...keys.current } })} />
        <Btn small label="Testen" color={A} ghost busy={busy === p} onPress={() => test(p)} />
      </View>
      <Text style={[st.dim, info[p]?.startsWith('✕') && { color: C.err }, info[p]?.startsWith('✓') && { color: C.ok }]}>
        {info[p] || <Text onPress={() => Linking.openURL(link)}>Kostenloser Schlüssel: <Text style={{ color: A }}>{link.replace('https://', '')}</Text></Text>}
      </Text>
    </View>
  );
  return (
    <ScrollView contentContainerStyle={{ padding: 16, gap: 18 }} keyboardShouldPersistTaps="handled">
      <View style={st.box}>
        <Text style={st.h2}>Depot</Text>
        <Text style={st.item}>{s.depot?.label || 'Noch nicht festgelegt'}</Text>
        <TextInput value={depotQ} onChangeText={setDepotQ} placeholder="Adresse des Depots" placeholderTextColor={C.dim} style={st.field} onSubmitEditing={() => findDepot()} />
        <View style={st.row}>
          <View style={{ flex: 1 }}><Btn small label="Suchen" color={A} busy={busy === 'depot'} onPress={() => findDepot()} /></View>
          <View style={{ flex: 1 }}><Btn small label="Mein Standort" color={A} ghost onPress={() => findDepot(true)} /></View>
        </View>
        <View style={st.sw}><Text style={st.item}>Rundtour (zurück zum Depot)</Text><Switch value={s.roundtrip} onValueChange={v => onChange({ roundtrip: v })} trackColor={{ true: A }} /></View>
        <View style={st.sw}><Text style={st.item}>Ab aktuellem Standort starten</Text><Switch value={s.fromHere} onValueChange={v => onChange({ fromHere: v })} trackColor={{ true: A }} /></View>
      </View>
      <View style={st.box}>
        <Text style={st.h2}>Navigation</Text>
        <Choice value={s.nav} onPick={nav => onChange({ nav })} options={[['google', 'Google Maps'], ['waze', 'Waze'], ['geo', 'Andere']]} />
        <View style={st.sw}><Text style={st.item}>Dunkle Karte</Text><Switch value={s.mapDark} onValueChange={v => onChange({ mapDark: v })} trackColor={{ true: A }} /></View>
      </View>
      <View style={st.box}>
        <Text style={st.h2}>KI-Texterkennung</Text>
        <Text style={st.dim}>Zerlegt diktierten Text in Adressen und korrigiert Hörfehler. Mit zwei Schlüsseln springt der zweite Dienst automatisch ein.</Text>
        {keyField('groq', 'Groq-Schlüssel', 'gsk_…', 'https://console.groq.com/keys')}
        {keyField('gemini', 'Google-Gemini-Schlüssel', 'AIza…', 'https://aistudio.google.com/apikey')}
        <Text style={st.label}>Zuerst verwenden</Text>
        <Choice value={s.ai.prefer || 'groq'} onPick={prefer => onChange({ ai: { ...s.ai, ...keys.current, prefer } })} options={[['groq', 'Groq'], ['gemini', 'Gemini']]} />
      </View>
      <View style={st.box}>
        <Text style={st.h2}>Farbe</Text>
        <View style={st.row}>{ACCENTS.map(c => <Pressable key={c} onPress={() => onChange({ accent: c })} style={[st.dot, { backgroundColor: c }, s.accent === c && { borderColor: C.text }]} />)}</View>
      </View>
    </ScrollView>
  );
}

