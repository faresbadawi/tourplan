// KI-Texterkennung mit Groq und/oder Google Gemini. Fällt bei Fehlern automatisch auf den anderen Dienst zurück.
export type Provider = 'groq' | 'gemini';
export type Keys = { groq?: string; gemini?: string; prefer?: Provider };

const MODELS: Record<Provider, string[]> = {
  groq: ['llama-3.3-70b-versatile', 'openai/gpt-oss-120b', 'llama-3.1-8b-instant'],
  gemini: ['gemini-flash-latest', 'gemini-2.5-flash', 'gemini-2.0-flash'],
};
const good: Partial<Record<Provider, string>> = {};

class AiError extends Error { model = false; retry = false; }
async function fail(r: Response) {
  let m = 'Fehler ' + r.status;
  try { m = (await r.json()).error?.message || m; } catch {}
  const e = new AiError(r.status === 401 || r.status === 403 ? 'Schlüssel ungültig' : r.status === 429 ? 'Kontingent kurz erschöpft' : m);
  e.model = r.status === 404 || (r.status === 400 && /model/i.test(m));
  e.retry = r.status === 429 || r.status >= 500;
  return e;
}

async function call(p: Provider, key: string, model: string, system: string, user: string): Promise<string> {
  const signal = AbortSignal.timeout(15000);
  if (p === 'groq') {
    const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST', signal, headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, temperature: 0, response_format: { type: 'json_object' }, messages: [{ role: 'system', content: system }, { role: 'user', content: user }] }),
    });
    if (!r.ok) throw await fail(r);
    return (await r.json()).choices?.[0]?.message?.content || '';
  }
  const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
    method: 'POST', signal, headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
    body: JSON.stringify({ systemInstruction: { parts: [{ text: system }] }, contents: [{ role: 'user', parts: [{ text: user }] }],
      generationConfig: { temperature: 0, responseMimeType: 'application/json' } }),
  });
  if (!r.ok) throw await fail(r);
  return ((await r.json()).candidates?.[0]?.content?.parts || []).map((x: any) => x.text || '').join('');
}

async function askOne(p: Provider, key: string, system: string, user: string) {
  const list = good[p] ? [good[p]!, ...MODELS[p].filter(m => m !== good[p])] : MODELS[p];
  let last: unknown;
  for (const m of list) {
    try { const t = await call(p, key, m, system, user); good[p] = m; return t; }
    catch (e) { last = e; if (!(e instanceof AiError && (e.model || e.retry))) throw e; }
  }
  throw last;
}

/** Fragt den bevorzugten Dienst, bei Fehler den anderen. Liefert Text und genutzten Dienst. */
async function ask(keys: Keys, system: string, user: string) {
  const order = (['groq', 'gemini'] as Provider[]).sort(a => (a === keys.prefer ? -1 : 1)).filter(p => keys[p]?.trim());
  if (!order.length) throw new Error('Kein KI-Schlüssel hinterlegt');
  let last: any;
  for (const p of order) {
    try { return { text: await askOne(p, keys[p]!.trim(), system, user), used: p }; } catch (e) { last = e; }
  }
  throw last;
}

const SYSTEM = `Du hilfst einem Paketzusteller in Deutschland. Er diktiert oder tippt Adressen; die Spracherkennung macht Fehler.
Zerlege den Text in einzelne Zustell-Adressen.
Regeln:
- Jede Hausnummer ist ein eigener Stopp („Lindenweg 3 und 5“ = zwei Stopps).
- Paketzahl: „Pakete“, „Päckchen“, „x“, oder eine Zahl nach einem Bindestrich hinter der Hausnummer („Hauptstraße 5 - 3“ = 3 Pakete). Ohne Angabe: null.
- Korrigiere offensichtliche Hörfehler bei Straßennamen (z. B. „Bahnhofstrasse“ → „Bahnhofstraße“).
- place: nur wenn der Ort genannt wurde, sonst leer.
- Erfinde keine Adressen.
Antworte nur mit JSON: {"stops":[{"street":"…","number":"…","place":"…","packages":Zahl oder null}]}`;

export type AiStop = { query: string; pk: number | null };

/** Freitext → Adressen mit Paketzahl. */
export async function aiParse(text: string, keys: Keys, homeCity?: string) {
  const { text: out, used } = await ask(keys, SYSTEM + (homeCity ? `\nZustellort meist: ${homeCity}` : ''), 'Text: ' + text);
  const j = JSON.parse(out.replace(/^\s*```(json)?|```\s*$/g, '').trim());
  const stops: AiStop[] = (j.stops || []).filter((s: any) => s?.street).map((s: any) => ({
    query: [[s.street, s.number].filter(Boolean).join(' '), s.place].filter(Boolean).join(', ').trim(),
    pk: +s.packages > 0 ? +s.packages : null,
  }));
  return { stops, used };
}

export async function aiTest(p: Provider, key: string) {
  await askOne(p, key.trim(), 'Antworte nur mit JSON.', 'Gib {"ok":true} zurück.');
  return good[p]!;
}
