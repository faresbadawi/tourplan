import { Camera, GeoJSONSource, Layer, Map, NativeUserLocation } from '@maplibre/maplibre-react-native';
import { useMemo } from 'react';
import { Alert, Text, View } from 'react-native';
import type { Place } from './geo';
import type { State } from './store';
import { C, st } from './ui';

const STYLE = { dark: 'https://tiles.openfreemap.org/styles/dark', light: 'https://tiles.openfreemap.org/styles/liberty' };

/** Karte mit nummerierten Stopps, Route, Depot und eigenem Standort. Antippen zeigt Adresse und Pakete. */
export function MapScreen({ state, onNav, onDone }: { state: State; onNav: (p: Place) => void; onDone: (id: string) => void }) {
  const { stops, route, settings: S } = state;
  const { points, bounds } = useMemo(() => {
    const byId = Object.fromEntries(stops.map(s => [s.id, s]));
    const list = route ? route.order.map(id => byId[id]).filter(Boolean) : stops.filter(s => s.place);
    const next = route ? route.order.find(id => !route.done[id]) : undefined;
    const feats: GeoJSON.Feature[] = list.map((s, i) => ({
      type: 'Feature', id: s.id, geometry: { type: 'Point', coordinates: [s.place!.lon, s.place!.lat] },
      properties: { id: s.id, n: String(i + 1), pk: s.pk || 1, label: s.place!.label,
        c: route?.done[s.id] === 'skip' ? C.skip : route?.done[s.id] ? C.ok : s.id === next ? S.accent : '#5B8CFF', big: s.id === next ? 1 : 0 },
    }));
    if (S.depot) feats.push({ type: 'Feature', geometry: { type: 'Point', coordinates: [S.depot.lon, S.depot.lat] }, properties: { n: 'D', c: '#FFFFFF', big: 0, label: 'Depot: ' + S.depot.label, pk: 0 } });
    const ll = feats.map(f => (f.geometry as GeoJSON.Point).coordinates);
    const b = ll.length ? [Math.min(...ll.map(x => x[0])), Math.min(...ll.map(x => x[1])), Math.max(...ll.map(x => x[0])), Math.max(...ll.map(x => x[1]))] as [number, number, number, number] : null;
    return { points: { type: 'FeatureCollection', features: feats } as GeoJSON.FeatureCollection, bounds: b };
  }, [stops, route, S.depot, S.accent]);

  if (!bounds) return <View style={{ padding: 24 }}><Text style={st.dim}>Noch keine Stopps. Füge im Tab „Tour“ Adressen hinzu.</Text></View>;
  const tap = (f?: GeoJSON.Feature) => {
    const p = f?.properties; if (!p) return;
    const s = stops.find(x => x.id === p.id);
    Alert.alert(p.n === 'D' ? 'Depot' : `Stopp ${p.n}`, `${p.label}${p.pk ? `\n${p.pk} Paket${p.pk > 1 ? 'e' : ''}` : ''}`, [
      { text: 'Schließen' },
      ...(s?.place ? [{ text: 'Navigation', onPress: () => onNav(s.place!) }] : []),
      ...(s && route && !route.done[s.id] ? [{ text: 'Zugestellt', onPress: () => onDone(s.id) }] : []),
    ]);
  };
  return (
    <Map style={{ flex: 1 }} mapStyle={S.mapDark ? STYLE.dark : STYLE.light} logo={false} compass>
      <Camera initialViewState={{ bounds, padding: { top: 60, bottom: 60, left: 40, right: 40 } }} />
      {!!route?.line?.length && (
        <GeoJSONSource id="route" data={{ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: route.line } }}>
          <Layer id="route-casing" type="line" layout={{ 'line-join': 'round', 'line-cap': 'round' }} paint={{ 'line-color': '#000', 'line-width': 8, 'line-opacity': 0.35 }} />
          <Layer id="route-line" type="line" layout={{ 'line-join': 'round', 'line-cap': 'round' }} paint={{ 'line-color': S.accent, 'line-width': 5 }} />
        </GeoJSONSource>
      )}
      <GeoJSONSource id="stops" data={points} onPress={e => tap(e.nativeEvent.features[0])} hitbox={{ top: 14, bottom: 14, left: 14, right: 14 }}>
        <Layer id="stop-dot" type="circle" paint={{ 'circle-radius': ['case', ['==', ['get', 'big'], 1], 17, 13], 'circle-color': ['get', 'c'], 'circle-stroke-color': '#111', 'circle-stroke-width': 2 }} />
        <Layer id="stop-num" type="symbol" layout={{ 'text-field': ['get', 'n'], 'text-size': 13, 'text-font': ['Noto Sans Regular'], 'text-allow-overlap': true, 'text-ignore-placement': true }} paint={{ 'text-color': '#111', 'text-halo-color': '#111', 'text-halo-width': 0.4 }} />
      </GeoJSONSource>
      <NativeUserLocation />
    </Map>
  );
}
