// @ts-nocheck — übernommen aus js/speech.js (reine Funktionen)
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
  function smartParse(text, smart = true, places = []) {
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
        .replace(/([a-wyzäöüß])(\d)/gi, '$1 $2');
    }
    const clean = t.split('\n')
      .map(l => l.trim().replace(/\s{2,}/g, ' ').replace(/^(?:[-•*]|\d{1,2}[.)])\s+/, '').replace(/[.;]+$/, ''));
    return (smart ? clean.flatMap(l => splitSpoken(l, places)) : clean)
      .map(l => l.trim().replace(/[.,;]+$/, ''))
      .filter(l => l.length > 2)
      .map(l => l.charAt(0).toUpperCase() + l.slice(1));
  }

  /* Ein langer Satz mit mehreren Adressen → einzelne Zeilen.
     „Hauptstraße 5 3 Pakete Bahnhofstraße 12 und 14 Am Markt 3 in Wittingen ein Paket“
     → „Hauptstraße 5, 3 Pakete“ · „Bahnhofstraße 12“ · „Bahnhofstraße 14“ · „Am Markt 3, Wittingen, 1 Paket“ */
  const UNIT = /^(x|×|mal|stk\.?|stück|pakete?n?|päckchen|sendung(en)?|pkt\.?|pk\.?)$/i;
  const HN = /^\d{1,4}[a-h]?(?:[-–\/]\d{1,4}[a-h]?)?$/i;
  const FILL = /^(und|dann|danach|sowie|plus|außerdem|noch|bitte|äh|ähm|also|dazu)$/i;
  const flat = s => s.toLowerCase().replace(/ß/g, 'ss').replace(/ä/g, 'a').replace(/ö/g, 'o').replace(/ü/g, 'u').replace(/[^a-z0-9]/g, '');

  function splitSpoken(line, places) {
    const T = line.replace(/,/g, ' , ').replace(/\b(\d{1,4}[a-h]?)\s*([-–—])\s*(\d{1,3})\b/gi, '$1 $2 $3').split(/\s+/).filter(Boolean), n = T.length;
    const placeSet = new Set((places || []).map(flat));
    // Paketangabe ab Position j? → { pk, len }
    const pkAt = j => {
      let k = j;
      while (k < n && /^(mit|und|,)$/i.test(T[k])) k++;
      const a = T[k] || '', b = T[k + 1] || '';
      let m;
      if (/^(ein|eine|einem|einen)$/i.test(a) && /^(paket|päckchen|sendung)$/i.test(b)) return { pk: 1, len: k + 2 - j };
      if (/^\d{1,3}$/.test(a) && UNIT.test(b)) return { pk: +a, len: k + 2 - j };
      if (/^[-–—]$/.test(a) && /^\d{1,3}$/.test(b)) return { pk: +b, len: k + 2 - j };
      if ((m = a.match(/^[-–—](\d{1,3})$/))) return { pk: +m[1], len: k + 1 - j };
      if ((m = a.match(/^(\d{1,3})[x×]$/i)) || (m = a.match(/^[x×](\d{1,3})$/i)) || (m = a.match(/^\((\d{1,3})\)$/))) return { pk: +m[1], len: k + 1 - j };
      if (/^[x×]$/i.test(a) && /^\d{1,3}$/.test(b)) return { pk: +b, len: k + 2 - j };
      return null;
    };
    const isHouse = j => j < n && HN.test(T[j]) && !pkAt(j);
    if (!T.some((_, j) => isHouse(j))) return [line];
    const out = [];
    const fmt = (street, hn, place, pk) => [street + ' ' + hn, place, pk ? pk + (pk === 1 ? ' Paket' : ' Pakete') : ''].filter(Boolean).join(', ');
    let i = 0;
    while (i < n) {
      while (i < n && (T[i] === ',' || FILL.test(T[i]))) i++;
      let pk = null, p = pkAt(i);
      if (p) { pk = p.pk; i += p.len; while (i < n && /^[,:–-]$/.test(T[i])) i++; }
      const start = i;
      while (i < n && !isHouse(i)) i++;
      if (i >= n) {                                   // Rest ohne Hausnummer
        const rest = T.slice(start).filter(t => t !== ',').join(' ');
        if (rest) out.push({ raw: rest + (pk ? ', ' + pk + ' Pakete' : '') });
        break;
      }
      const street = T.slice(start, i).filter(t => t !== ',').join(' ');
      const nums = [T[i++]];
      for (;;) {                                      // Pakete und weitere Hausnummern derselben Straße
        if ((p = pkAt(i))) { pk = (pk || 0) + p.pk; i += p.len; continue; }
        if (/^(und|sowie|,)$/i.test(T[i] || '') && isHouse(i + 1) && (i + 2 >= n || isHouse(i + 2) || pkAt(i + 2) || FILL.test(T[i + 2]) || T[i + 2] === ',')) { nums.push(T[i + 1]); i += 2; continue; }
        break;
      }
      // Ort?
      let nextH = i; while (nextH < n && !isHouse(nextH)) nextH++;
      let place = '';
      if (nextH >= n) {                               // letzte Adresse: der Rest ist Ort (und evtl. Pakete)
        const rest = [];
        while (i < n) { if ((p = pkAt(i))) { pk = (pk || 0) + p.pk; i += p.len; } else { if (T[i] !== ',' && !/^in$/i.test(T[i])) rest.push(T[i]); i++; } }
        place = rest.join(' ');
      } else {
        let j = i; const comma = T[j] === ','; if (comma) j++;
        const inWord = /^in$/i.test(T[j] || ''); if (inWord) j++;
        let len = 0;
        if (/^\d{5}$/.test(T[j] || '') && j + 2 < nextH) len = 2;
        else {
          for (let l = Math.min(3, nextH - j - 1); l >= 1 && !len; l--) if (placeSet.has(flat(T.slice(j, j + l).join('')))) len = l;
          if (!len && comma) { let c = j; while (c < nextH && T[c] !== ',') c++; if (c < nextH - 1 && c > j && c - j <= 4) len = c - j; }
          if (!len && inWord && j + 1 < nextH) len = 1;
        }
        if (len) { place = T.slice(j, j + len).join(' '); i = j + len; if ((p = pkAt(i))) { pk = (pk || 0) + p.pk; i += p.len; } }
      }
      if (!street && out.length && out[out.length - 1].street) nums.forEach(h => out.push({ street: out[out.length - 1].street, hn: h, place: place || out[out.length - 1].place, pk }));
      else nums.forEach((h, x) => out.push({ street, hn: h, place, pk: x === 0 || nums.length === 1 ? pk : null }));
    }
    return out.map(o => o.raw || fmt(o.street, o.hn, o.place, o.pk));
  }

  /** „Hauptstraße 5, 3 Pakete“ / „3x Hauptstraße 5“ / „Hauptstraße 5 (3)“ → { query, pk } */
  function parseLine(line) {
    let q = line.trim(), pk = null;
    const U = '(?:x|×|mal|stk\\.?|stück|pakete?n?|päckchen|sendungen?|pkt\\.?|pk\\.?)';
    q = q.replace(/\b(?:ein|eine|einem)\s+(paket|päckchen|sendung)\b/i, '1 $1');
    let m;
    // „Hauptstraße 5 - 3“ / „Hauptstraße 5-3“ / „Hauptstraße 5, Ort - 3“: Zahl nach dem Strich = Pakete
    if ((m = q.match(/(\d{1,4}[a-z]?)\s*[-–—]\s*(\d{1,3})\s*$/i)) || (m = q.match(/(,\s*[^,\d]+?)\s+[-–—]\s*(\d{1,3})\s*$/))) {
      pk = +m[2]; q = q.slice(0, m.index) + m[1];
    }
    else if ((m = q.match(new RegExp('^(\\d{1,3})\\s*' + U + '(?![a-zäöü])[\\s:,-]*', 'i')))) { pk = +m[1]; q = q.slice(m[0].length); }
    else if ((m = q.match(new RegExp('[\\s,;:–-]+(?:mit\\s+)?(\\d{1,3})\\s*' + U + '$', 'i')))) { pk = +m[1]; q = q.slice(0, m.index); }
    else if ((m = q.match(/[\s,]+[x×]\s*(\d{1,3})$/i))) { pk = +m[1]; q = q.slice(0, m.index); }
    else if ((m = q.match(/\s*\((\d{1,3})\)$/))) { pk = +m[1]; q = q.slice(0, m.index); }
    q = q.replace(/[\s,;:–-]+$/, '').trim();
    if (q) q = q.charAt(0).toUpperCase() + q.slice(1);
    return { query: q, pk: pk && pk > 0 ? pk : null };
  }

export { smartParse, parseLine };
