/* Optionale KI-Texterkennung: Groq (kostenloser Schlüssel „gsk_…“ von console.groq.com).
   Zerlegt diktierten Text in Adressen und gleicht Straßennamen mit dem eigenen Gebiet ab.
   (Ein Google-Gemini-Schlüssel „AIza…“ wird ebenfalls erkannt.) */
(function () {
  const GROQ_MODELS = ['llama-3.3-70b-versatile', 'openai/gpt-oss-120b', 'llama-3.1-8b-instant'];
  const GEMINI_MODELS = ['gemini-flash-latest', 'gemini-2.5-flash', 'gemini-2.0-flash'];
  const good = {};
  const kind = key => /^AIza/.test(key) ? 'gemini' : 'groq';

  async function groq(key, model, system, user, timeout) {
    const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST', signal: AbortSignal.timeout(timeout),
      headers: { 'Authorization': 'Bearer ' + key, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, temperature: 0, response_format: { type: 'json_object' },
        messages: [{ role: 'system', content: system }, { role: 'user', content: user }] }),
    });
    if (!r.ok) {
      let m = 'Fehler ' + r.status; try { m = (await r.json()).error.message || m; } catch (_) {}
      const e = new Error(r.status === 401 ? 'Schlüssel ungültig' : r.status === 429 ? 'Kontingent kurz erschöpft – gleich nochmal' : m);
      e.model = r.status === 404 || (r.status === 400 && /model/i.test(m)); throw e;
    }
    const j = await r.json();
    return ((j.choices || [])[0] || {}).message?.content || '';
  }
  async function gemini(key, model, system, user, timeout) {
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(key)}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(timeout),
      body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: system + '\n\n' + user }] }], generationConfig: { temperature: 0, responseMimeType: 'application/json' } }),
    });
    if (!r.ok) { let m = 'Fehler ' + r.status; try { m = (await r.json()).error.message || m; } catch (_) {} const e = new Error(m); e.model = r.status === 404; throw e; }
    const j = await r.json();
    return (((j.candidates || [])[0] || {}).content || { parts: [] }).parts.map(p => p.text || '').join('');
  }
  async function ask(key, system, user, timeout = 12000) {
    const k = kind(key), list = k === 'groq' ? GROQ_MODELS : GEMINI_MODELS, fn = k === 'groq' ? groq : gemini;
    let last;
    for (const m of good[k] ? [good[k], ...list.filter(x => x !== good[k])] : list) {
      try { const t = await fn(key, m, system, user, timeout); good[k] = m; return t; }
      catch (e) { last = e; if (!e.model) throw e; }
    }
    throw last;
  }

  /** Text → Adresszeilen „Straße Nr, Ort, N Pakete“ */
  async function parse(text, key, streets) {
    // eigenes Gebiet zuerst, Liste knapp halten (kostenlose Kontingente zählen Wörter)
    const seen = new Set(), names = [];
    for (const s of streets) { const k = s.n + '|' + s.p; if (seen.has(k)) continue; seen.add(k); names.push(`${s.n} (${s.p})${s.a ? '' : '*'}`); if (names.length >= 450) break; }
    const system = `Du hilfst einem Paketzusteller in Deutschland. Er diktiert oder tippt Adressen; die Spracherkennung macht Fehler.
Zerlege den Text in einzelne Zustell-Adressen.
Regeln:
- Jede Hausnummer ist ein eigener Stopp („Lindenweg 3 und 5“ = zwei Stopps).
- Paketzahl: „Pakete“, „Päckchen“, „x“, oder eine Zahl nach einem Bindestrich hinter der Hausnummer („Hauptstraße 5 - 3“ = 3 Pakete). Ohne Angabe: null.
- Straßennamen: nimm wenn möglich genau einen Namen aus der Liste (auch bei anders gehörtem, ähnlich klingendem Namen). Mit * markierte liegen außerhalb des Gebiets – nur wenn eindeutig gemeint.
- place: nur wenn der Ort genannt wurde oder die Straße nur in einem Ort der Liste vorkommt, sonst leer.
- Erfinde keine Adressen.
Antworte nur mit JSON: {"stops":[{"street":"…","number":"…","place":"…","packages":Zahl oder null}]}
Straßen im Gebiet: ${names.join('; ') || '(keine Liste)'}`;
    const out = await ask(key, system, 'Text: ' + text);
    const j = JSON.parse(out.replace(/^```(json)?|```$/g, '').trim());
    return (j.stops || []).filter(s => s && s.street).map(s => {
      const pk = +s.packages > 0 ? +s.packages : 0;
      return [[s.street, s.number].filter(Boolean).join(' ').trim(), (s.place || '').trim(), pk ? `${pk} Paket${pk === 1 ? '' : 'e'}` : ''].filter(Boolean).join(', ');
    });
  }
  async function test(key) {
    await ask(key, 'Antworte nur mit JSON.', 'Gib {"ok":true} zurück.', 12000);
    return (kind(key) === 'groq' ? 'Groq · ' : 'Gemini · ') + good[kind(key)];
  }

  window.AI = { parse, test };
})();
