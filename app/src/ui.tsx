import { ActivityIndicator, Pressable, StyleSheet, Text } from 'react-native';

export const C = { bg: '#0E1116', card: '#181C24', line: '#272D38', text: '#F2F4F8', dim: '#9AA3B2', ok: '#3DD68C', err: '#FF6B6B', skip: '#F5A524' };
export const ACCENTS = ['#FFC21A', '#4C9BFF', '#FF5A5F', '#3DD68C'];
export const min = (s: number) => (s < 3600 ? `${Math.round(s / 60)} min` : `${Math.floor(s / 3600)} h ${Math.round((s % 3600) / 60)} min`);

export function Btn({ label, onPress, color, ghost, busy, small }: { label: string; onPress: () => void; color: string; ghost?: boolean; busy?: boolean; small?: boolean }) {
  return (
    <Pressable onPress={onPress} disabled={busy} style={({ pressed }) => [st.btn, small && st.btnS, ghost ? { borderColor: color, borderWidth: 1.5 } : { backgroundColor: color }, pressed && { opacity: 0.7 }]}>
      {busy ? <ActivityIndicator color={ghost ? color : '#111'} /> : <Text style={[st.btnT, small && { fontSize: 14 }, { color: ghost ? color : '#111' }]}>{label}</Text>}
    </Pressable>
  );
}

export const st = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  head: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 10, borderBottomWidth: 1, borderColor: C.line },
  title: { color: C.text, fontSize: 26, fontWeight: '800', letterSpacing: -0.5 },
  tabs: { flexDirection: 'row', borderTopWidth: 1, borderColor: C.line, backgroundColor: C.card },
  tab: { flex: 1, alignItems: 'center', paddingTop: 8 },
  tabT: { color: C.dim, fontSize: 12, fontWeight: '700', paddingBottom: 6, marginTop: 2 },
  tabBar: { height: 3, width: 40, borderRadius: 2 },
  row: { flexDirection: 'row', gap: 10, alignItems: 'center' },
  input: { minHeight: 110, backgroundColor: C.card, color: C.text, borderRadius: 14, padding: 14, fontSize: 17, textAlignVertical: 'top', borderWidth: 1, borderColor: C.line },
  field: { backgroundColor: C.bg, color: C.text, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: 16, borderWidth: 1, borderColor: C.line },
  btn: { borderRadius: 12, paddingVertical: 15, alignItems: 'center', justifyContent: 'center', minHeight: 52 },
  btnS: { paddingVertical: 10, paddingHorizontal: 14, minHeight: 42 },
  btnT: { fontSize: 16, fontWeight: '800' },
  card: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: C.card, borderRadius: 12, padding: 12, borderWidth: 1, borderColor: C.line },
  num: { width: 28, fontSize: 18, fontWeight: '800', textAlign: 'center' },
  item: { color: C.text, fontSize: 16, fontWeight: '600' },
  dim: { color: C.dim, fontSize: 14 },
  h2: { color: C.text, fontSize: 18, fontWeight: '800' },
  label: { color: C.text, fontSize: 14, fontWeight: '700' },
  pk: { backgroundColor: C.line, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 5 },
  pkT: { color: C.text, fontWeight: '700' },
  x: { color: C.dim, fontSize: 18, paddingHorizontal: 4 },
  hero: { backgroundColor: C.card, borderRadius: 18, padding: 18, gap: 10, borderWidth: 2 },
  heroT: { color: C.text, fontSize: 28, fontWeight: '800', letterSpacing: -0.5 },
  bar: { height: 6, backgroundColor: C.line, borderRadius: 3, marginTop: 6, overflow: 'hidden' },
  box: { backgroundColor: C.card, borderRadius: 16, padding: 16, gap: 12, borderWidth: 1, borderColor: C.line },
  sw: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  seg: { flexDirection: 'row', backgroundColor: C.bg, borderRadius: 10, padding: 3 },
  segI: { flex: 1, paddingVertical: 9, borderRadius: 8, alignItems: 'center' },
  segT: { color: C.text, fontWeight: '700' },
  dot: { width: 40, height: 40, borderRadius: 20, borderWidth: 3, borderColor: 'transparent' },
});
