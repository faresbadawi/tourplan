import { Alert, Pressable, ScrollView, Text, View } from 'react-native';
import type { State } from './store';
import { st } from './ui';

export function HistoryScreen({ state, onClear }: { state: State; onClear: () => void }) {
  const { history: H, settings: S } = state;
  const sum = H.reduce((a, h) => ({ pk: a.pk + h.pk, min: a.min + h.min, km: a.km + h.km }), { pk: 0, min: 0, km: 0 });
  return (
    <ScrollView contentContainerStyle={{ padding: 16, gap: 10 }}>
      <View style={st.box}>
        <Text style={st.h2}>Dein Tempo</Text>
        <Text style={[st.heroT, { color: S.accent }]}>{(S.pace.sec / 60).toFixed(1)} min <Text style={st.dim}>je Stopp</Text></Text>
        <Text style={st.dim}>{S.pace.n ? `Gelernt aus ${S.pace.n} zugestellten Stopps (ohne Fahrzeit).` : 'Wird beim Abhaken automatisch gelernt.'}</Text>
        {sum.min > 0 && <Text style={st.item}>Ø {Math.round(sum.pk / (sum.min / 60))} Pakete pro Stunde · {sum.km.toFixed(0)} km gesamt</Text>}
      </View>
      {!H.length && <Text style={st.dim}>Beendete Touren erscheinen hier.</Text>}
      {H.map(h => (
        <View key={h.at} style={st.card}>
          <View style={{ flex: 1 }}>
            <Text style={st.item}>{new Date(h.at).toLocaleDateString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit' })} · {h.stops} Stopps · {h.pk} Pakete</Text>
            <Text style={st.dim}>{Math.floor(h.min / 60)} h {Math.round(h.min % 60)} min · {h.km.toFixed(1)} km{h.skipped ? ` · ${h.skipped} übersprungen` : ''}{h.min > 5 ? ` · ${Math.round(h.pk / (h.min / 60))} P./h` : ''}</Text>
          </View>
        </View>
      ))}
      {!!H.length && <Pressable onPress={() => Alert.alert('Verlauf löschen?', '', [{ text: 'Abbrechen' }, { text: 'Löschen', style: 'destructive', onPress: onClear }])}><Text style={[st.dim, { textAlign: 'center', marginTop: 8 }]}>Verlauf löschen</Text></Pressable>}
    </ScrollView>
  );
}
