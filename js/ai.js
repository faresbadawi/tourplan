/* Optionale KI-Texterkennung mit Google Gemini (kostenloser Schlüssel von aistudio.google.com).
   Zerlegt diktierten Text in Adressen und gleicht Straßennamen mit dem eigenen Gebiet ab. */
(function () {
  const MODELS = ['gemini-flash-latest', 'gemini-2.5-flash', 'gemini-2.0-flash'];
  let good = null;                       // zuletzt funktionierendes Modell

  async function call(key, model, prompt, timeout) {
    const u = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(key)}`;
    const r = await fetch(u, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(timeout),
      body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: prompt }] }], generationConfig: { temperature: 0, responseMimeType: 'application/json' } }),
    });
    if (r.status === 404) { const e = new Error('Modell nicht verfügbar'); e.model = true; throw e; }
    if (!r.ok) { let m = 'Fehler ' + r.status; try { m = (await r.json()).error.message || m; } catch (_) {} throw new Error(m); }
    const j = await r.json();
    return (((j.candidates || [])[0] || {}).content || { parts: [] }).parts.map(p => p.text || '').join('');
  }
  async function ask(key, prompt, timeout = 12000) {
    let last;
    for (const m of good ? [good, ...MODELS.filter(x => x !== good)] : MODELS) {
      try { const t = await call(key, m, prompt, timeout); good = m; return t; }
      catch (e) { last = e; if (!e.model) throw e; }
    }
    throw last;
  }

  /** Text → Adresszeilen „Straße Nr, Ort, N Pakete“ */
  async function parse(text, key, streets) {
    const names = streets.slice(0, 1500).map(s => `${s.n} (${s.p})${s.a ? '' : ' *'}`).join('; ');
    const prompt = `Du hilfst einem Paketzusteller in Deutschland. Er hat Adressen diktiert oder getippt; die Spracherkennung macht Fehler.
Zerlege den Text in einzelne Zustell-Adressen.
Regeln:
- Jede Hausnummer ist ein eigener Stopp („Lindenweg 3 und 5“ = zwei Stopps).
- Paketzahl: Wörter wie „Pakete“, „Päckchen“, „x“, oder eine Zahl nach einem Bindestrich hinter der Hausnummer („Hauptstraße 5 - 3“ = 3 Pakete). Ohne Angabe: null.
- Straßennamen: nimm, wenn möglich, genau einen Namen aus der Liste unten (auch wenn er anders gehört wurde, z. B. ähnlicher Klang). Straßen mit * liegen außerhalb des Zustellgebiets – nur nehmen, wenn eindeutig gemeint.
- place: nur angeben, wenn der Ort genannt wurde oder die Straße nur in einem Ort der Liste vorkommt.
- Erfinde keine Adressen.
Antworte nur mit JSON: {"stops":[{"street":"…","number":"…","place":"…oder leer","packages":Zahl oder null}]}

Straßen im Gebiet: ${names || '(keine Liste)'}

Text: """${text}"""`;
    const out = await ask(key, prompt);
    const j = JSON.parse(out.replace(/^```(json)?|```$/g, '').trim());
    return (j.stops || []).filter(s => s && s.street).map(s => {
      const pk = +s.packages > 0 ? +s.packages : 0;
      return [[s.street, s.number].filter(Boolean).join(' ').trim(), (s.place || '').trim(), pk ? `${pk} Paket${pk === 1 ? '' : 'e'}` : ''].filter(Boolean).join(', ');
    });
  }
  async function test(key) { await ask(key, 'Antworte nur mit {"ok":true}', 10000); return good; }

  window.AI = { parse, test };
})();
