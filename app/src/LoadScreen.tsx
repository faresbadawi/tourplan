import { useMemo, useState } from 'react';
import { Image, Linking, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import type { Settings, State } from './store';
import { C, st } from './ui';

export const VEHICLES: Record<string, { name: string; info: string; l: number; w: number; img?: any }> = {
  etransit: { name: 'Ford E-Transit', info: 'Hochdach · ca. 18 m³', l: 4.8, w: 1.78, img: require('../assets/vehicles/etransit.jpg') },
  ecustom: { name: 'Ford E-Transit Custom', info: 'ca. 6,7 m³', l: 2.9, w: 1.65, img: require('../assets/vehicles/ecustom.jpg') },
  workxl: { name: 'StreetScooter Work XL', info: 'ca. 20 m³', l: 4.8, w: 2.0, img: require('../assets/vehicles/workxl.jpg') },
  workl: { name: 'StreetScooter Work L', info: 'ca. 8 m³', l: 3.3, w: 1.75, img: require('../assets/vehicles/workl.jpg') },
  work: { name: 'StreetScooter Work', info: 'ca. 4,3 m³', l: 2.4, w: 1.6, img: require('../assets/vehicles/work.jpg') },
  sprinter: { name: 'Mercedes Sprinter', info: 'ca. 10,5 m³', l: 3.3, w: 1.78, img: require('../assets/vehicles/sprinter.jpg') },
  vito: { name: 'Mercedes Vito / VW Transporter', info: 'ca. 6 m³', l: 2.7, w: 1.69, img: require('../assets/vehicles/vito.jpg') },
  custom: { name: 'Eigene Maße', info: 'Länge und Breite selbst eingeben', l: 3, w: 1.7 },
};
const CREDITS = 'Fotos: Wikimedia Commons – JustAnotherCarDesigner (CC0), Alexander Migl (CC BY-SA 4.0), Geoprofi Lars (CC BY-SA 4.0), Superbass (CC BY-SA 4.0), ManuelB701 (CC0), Herranderssvensson (CC BY-SA 3.0), Thomas doerfer (CC BY-SA 3.0)';
const ZC = ['#FFC21A', '#4C9BFF', '#3DD68C', '#FF7AB6'];

/** Laderaum: Stopps nach Reihenfolge und Paketzahl auf Bereiche verteilen. Erste Stopps liegen an der Tür. */
export function LoadScreen({ state, onChange }: { state: State; onChange: (p: Partial<Settings>) => void }) {
  const { settings: S, stops, route } = state;
  const v = { ...VEHICLES[S.vehicle] || VEHICLES.etransit, ...(S.vehicle === 'custom' ? S.custom : {}) };
  const [pick, setPick] = useState(false);
  const [open, setOpen] = useState(0);

  const zones = useMemo(() => {
    const byId = Object.fromEntries(stops.map(s => [s.id, s]));
    const list = (route ? route.order.map(id => byId[id]) : stops.filter(s => s.status === 'ok')).filter(Boolean);
    const total = list.reduce((a, s) => a + (s.pk || 1), 0) || 1;
    const out = Array.from({ length: S.zones }, () => ({ stops: [] as { n: number; label: string; pk: number; done: boolean }[], pk: 0 }));
    let acc = 0;
    list.forEach((s, i) => {
      const z = Math.min(S.zones - 1, Math.floor((acc / total) * S.zones));
      acc += s.pk || 1;
      out[z].stops.push({ n: i + 1, label: s.place?.label.split(',')[0] || s.query, pk: s.pk || 1, done: !!route?.done[s.id] });
      out[z].pk += s.pk || 1;
    });
    return out;
  }, [stops, route, S.zones]);

  // Grundriss: Fahrerseite oben, Tür hinten rechts im Bild. Bereich A (erste Stopps) an der Tür.
  const rearFirst = S.access !== 'seite';
  const order = rearFirst ? [...zones.keys()].reverse() : [...zones.keys()];
  const Seg = <T extends string | number>({ value, opts, onPick }: { value: T; opts: [T, string][]; onPick: (v: T) => void }) => (
    <View style={st.seg}>{opts.map(([k, l]) => <Pressable key={String(k)} onPress={() => onPick(k)} style={[st.segI, value === k && { backgroundColor: S.accent }]}><Text style={[st.segT, value === k && { color: '#111' }]}>{l}</Text></Pressable>)}</View>
  );

  return (
    <ScrollView contentContainerStyle={{ padding: 16, gap: 14 }}>
      <Pressable onPress={() => setPick(!pick)} style={[st.box, { flexDirection: 'row', alignItems: 'center' }]}>
        {v.img && <Image source={v.img} style={{ width: 84, height: 56, borderRadius: 8 }} />}
        <View style={{ flex: 1 }}><Text style={st.h2}>{v.name}</Text><Text style={st.dim}>{v.info} · Laderaum {v.l} × {v.w} m</Text></View>
        <Text style={{ color: S.accent, fontWeight: '800' }}>{pick ? 'Fertig' : 'Ändern'}</Text>
      </Pressable>
      {pick && <View style={{ gap: 8 }}>
        {Object.entries(VEHICLES).map(([k, x]) => (
          <Pressable key={k} onPress={() => { onChange({ vehicle: k }); if (k !== 'custom') setPick(false); }} style={[st.card, S.vehicle === k && { borderColor: S.accent }]}>
            {x.img ? <Image source={x.img} style={{ width: 64, height: 42, borderRadius: 6 }} /> : <View style={{ width: 64 }} />}
            <View style={{ flex: 1 }}><Text style={st.item}>{x.name}</Text><Text style={st.dim}>{x.info}</Text></View>
          </Pressable>
        ))}
        {S.vehicle === 'custom' && <View style={st.row}>
          {(['l', 'w'] as const).map(d => <TextInput key={d} keyboardType="decimal-pad" defaultValue={String(S.custom[d])} placeholder={d === 'l' ? 'Länge m' : 'Breite m'} placeholderTextColor={C.dim}
            style={[st.field, { flex: 1 }]} onEndEditing={e => { const n = parseFloat(e.nativeEvent.text.replace(',', '.')); if (n > 0.5 && n < 10) onChange({ custom: { ...S.custom, [d]: n } }); }} />)}
        </View>}
        <Text style={[st.dim, { fontSize: 11 }]} onPress={() => Linking.openURL('https://commons.wikimedia.org')}>{CREDITS}</Text>
      </View>}

      <Text style={st.label}>Zugang</Text>
      <Seg value={S.access} opts={[['hinten', 'Hinten'], ['seite', 'Seitentür'], ['beides', 'Beides']]} onPick={access => onChange({ access })} />
      <Text style={st.label}>Bereiche</Text>
      <Seg value={S.zones} opts={[[2, '2'], [3, '3'], [4, '4']]} onPick={zones => onChange({ zones })} />

      <View style={{ gap: 4 }}>
        <Text style={[st.dim, { textAlign: 'center' }]}>◀ Fahrerkabine · Laderaum · {S.access === 'seite' ? 'Seitentür vorn' : 'Hecktür'} ▶</Text>
        <View style={{ flexDirection: 'row', aspectRatio: v.l / v.w, borderWidth: 3, borderColor: C.text, borderRadius: 10, overflow: 'hidden' }}>
          {order.map(z => (
            <Pressable key={z} onPress={() => setOpen(z)} style={{ flex: Math.max(zones[z].pk, 1), backgroundColor: ZC[z] + (open === z ? 'FF' : '55'), alignItems: 'center', justifyContent: 'center', borderRightWidth: 1, borderColor: C.bg }}>
              <Text style={{ fontSize: 30, fontWeight: '900', color: '#111' }}>{String.fromCharCode(65 + z)}</Text>
              <Text style={{ fontWeight: '800', color: '#111' }}>{zones[z].stops.length} St. · {zones[z].pk} P.</Text>
            </Pressable>
          ))}
        </View>
        {S.access !== 'hinten' && <View style={{ flexDirection: 'row', justifyContent: rearFirst ? 'flex-start' : 'flex-start', marginLeft: '8%' }}><View style={{ width: '28%', height: 6, backgroundColor: S.accent, borderRadius: 3 }} /><Text style={[st.dim, { marginLeft: 6 }]}>Seitentür</Text></View>}
      </View>

      <View style={[st.box, { borderColor: ZC[open] }]}>
        <Text style={st.h2}>Bereich {String.fromCharCode(65 + open)}</Text>
        <Text style={st.dim}>Einladen in dieser Reihenfolge (späte Stopps zuerst, nach hinten)</Text>
        {!zones[open]?.stops.length ? <Text style={st.dim}>Keine Stopps in diesem Bereich.</Text>
          : [...zones[open].stops].reverse().map(s => (
            <View key={s.n} style={[st.row, s.done && { opacity: 0.4 }]}>
              <Text style={[st.num, { color: ZC[open] }]}>{s.n}</Text>
              <Text style={[st.item, { flex: 1 }]} numberOfLines={1}>{s.label}</Text>
              <Text style={st.dim}>{s.pk}📦</Text>
            </View>
          ))}
      </View>
    </ScrollView>
  );
}
