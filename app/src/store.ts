import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEffect, useRef, useState } from 'react';
import type { Place } from './geo';
import type { Keys } from './ai';

export type Stop = { id: string; query: string; pk: number | null; status: 'pending' | 'ok' | 'err'; place?: Place };
export type Route = { order: string[]; legs: { dur: number; dist: number }[]; done: Record<string, true | 'skip'>; doneAt?: Record<string, number>; source: string; start: Place; line?: [number, number][]; created: number };
export type Settings = { depot: Place | null; nav: 'google' | 'waze' | 'geo'; roundtrip: boolean; fromHere: boolean; accent: string; ai: Keys;
  pace: { sec: number; n: number }; mapDark: boolean; vehicle: string; access: 'hinten' | 'seite' | 'beides'; zones: number; custom: { l: number; w: number } };
export type Hist = { at: number; stops: number; skipped: number; pk: number; km: number; min: number };
export type State = { settings: Settings; stops: Stop[]; route: Route | null; history: Hist[] };

export const initial: State = {
  settings: { depot: null, nav: 'google', roundtrip: true, fromHere: false, accent: '#FFC21A', ai: { prefer: 'groq' },
    pace: { sec: 120, n: 0 }, mapDark: true, vehicle: 'etransit', access: 'hinten', zones: 3, custom: { l: 3, w: 1.7 } },
  stops: [], route: null, history: [],
};

/** Gesamter App-Zustand, dauerhaft gespeichert. */
export function usePersisted() {
  const [state, setState] = useState<State>(initial);
  const [ready, setReady] = useState(false);
  const loaded = useRef(false);
  useEffect(() => {
    AsyncStorage.getItem('tp.v1').then(s => {
      if (s) try { const j = JSON.parse(s); setState({ ...initial, ...j, settings: { ...initial.settings, ...j.settings } }); } catch {}
      loaded.current = true; setReady(true);
    });
  }, []);
  useEffect(() => { if (loaded.current) AsyncStorage.setItem('tp.v1', JSON.stringify(state)).catch(() => {}); }, [state]);
  return [state, setState, ready] as const;
}
