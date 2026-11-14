/* Diktat (Web Speech API, de-DE) + intelligente Aufbereitung gesprochener Adressen. */
(function () {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;

  const ONES = { null: 0, eins: 1, ein: 1, eine: 1, zwei: 2, zwo: 2, drei: 3, vier: 4, 'fünf': 5, sechs: 6, sieben: 7, acht: 8, neun: 9 };
  const TEENS = { zehn: 10, elf: 11, 'zwölf': 12, dreizehn: 13, vierzehn: 14, 'fünfzehn': 15, sechzehn: 16, siebzehn: 17, achtzehn: 18, neunzehn: 19 };
  const TENS = { zwanzig: 20, 'dreißig': 30, dreissig: 30, vierzig: 40, 'fünfzig': 50, sechzig: 60, siebzig: 70, achtzig: 80, neunzig: 90 };

  function wordToNumber(w) {
    w = w.toLowerCase();
    let base = 0;
    const h = w.match(/^(ein|zwei|drei|vier|fünf|sechs|sieben|acht|neun)?hundert(.*)$/);
    if (h) { base = (h[1] ? ONES[h[1]] : 1) * 100; w = h[2].replace(/^und/, ''); if (!w) return base; }
    if (w in ONES && w !== 'null') return base + ONES[w];
    if (w in TEENS) return base + TEENS[w];
    if (w in TENS) return base + TENS[w];
    const m = w.match(/^(ein|zwei|drei|vier|fünf|sechs|sieben|acht|neun)und(\w+)$/);
    if (m && m[2] in TENS) return base + ONES[m[1]] + TENS[m[2]];
    return null;
  }

  const STREET_END = /(straße|strasse|str\.?|weg|allee|platz|ring|gasse|damm|chaussee|pfad|steig|stieg|hof|feld|berg|kamp|winkel|graben|ufer|markt|wall|siedlung|nummer)$/i;

  /** Rohtext (getippt oder diktiert) → Liste sauberer Adresszeilen */
  function smartParse(text, smart = true) {
    let t = text.replace(/\r/g, '');
    if (smart) {
      t = t
        .replace(/\b(nächste adresse|neue adresse|nächste|nächster|neue zeile|absatz|und dann|danach)\b[.,]?/gi, '\n')
        .replace(/\s*;\s*/g, '\n')
        .replace(/\s+komma\s+/gi, ', ')
        .replace(/\bhausnummer\s+/gi, '');
      // Zahlwörter → Ziffern
      t = t.split('\n').map(line => {
        const toks = line.split(/(\s+)/);
        for (let i = 0; i < toks.length; i++) {
          const raw = toks[i];
          const w = raw.replace(/[.,]$/, '');
          if (!w.trim()) continue;
          const n = wordToNumber(w);
          if (n === null) continue;
          const isArticle = /^(ein|eine|eins)$/i.test(w);
          const prev = (toks[i - 2] || '').replace(/[.,]$/, '');
          if (isArticle && !STREET_END.test(prev)) continue;
          toks[i] = String(n) + raw.slice(w.length);
        }
        return toks.join('');
      }).join('\n');
      t = t
        .replace(/(\d+)\s+([a-hA-H])\b(?!\w)/g, (_, n, l) => n + l.toLowerCase())   // „12 a“ → „12a“
        .replace(/\bstr\.?(?=\s|\d|,|$)/gi, 'Straße')
        .replace(/([a-zäöüß])str\.?(?=\s|\d|,|$)/gi, '$1straße')
        .replace(/([a-zäöüß])(\d)/gi, '$1 $2');
    }
    return t.split('\n')
      .map(l => l.trim().replace(/\s{2,}/g, ' ').replace(/^(?:[-•*]|\d{1,2}[.)])\s+/, '').replace(/[.,;]+$/, ''))
      .filter(l => l.length > 2)
      .map(l => l.charAt(0).toUpperCase() + l.slice(1));
  }

  class Dictation {
    constructor({ onFinal, onInterim, onState, onError }) {
      this.supported = !!SR;
      this.cb = { onFinal, onInterim, onState, onError };
      this.active = false;
    }
    toggle() { this.active ? this.stop() : this.start(); }
    start() {
      if (!SR) { this.cb.onError('unsupported'); return; }
      const r = new SR();
      r.lang = 'de-DE';
      r.continuous = true;
      r.interimResults = true;
      r.onresult = e => {
        let interim = '';
        for (let i = e.resultIndex; i < e.results.length; i++) {
          const res = e.results[i];
          if (res.isFinal) this.cb.onFinal(res[0].transcript.trim());
          else interim += res[0].transcript;
        }
        this.cb.onInterim(interim);
      };
      r.onerror = e => { if (e.error !== 'no-speech' && e.error !== 'aborted') this.cb.onError(e.error); };
      r.onend = () => {
        // Safari/Chrome beenden gern nach Pausen – weiterlauschen, solange aktiv
        if (this.active) { try { r.start(); return; } catch (_) {} }
        this.active = false; this.cb.onState(false); this.cb.onInterim('');
      };
      this.rec = r;
      this.active = true;
      try { r.start(); this.cb.onState(true); }
      catch (err) { this.active = false; this.cb.onError(err.message); }
    }
    stop() {
      this.active = false;
      if (this.rec) try { this.rec.stop(); } catch (_) {}
      this.cb.onState(false);
    }
  }

  window.Speech = { Dictation, smartParse, supported: !!SR };
})();
