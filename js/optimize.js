/* Tourenoptimierung: Start (und optional Ende) am Depot = Knoten 0.

   Zustellerlogik:
   • Haltepunkte: Stopps, die man bei einem Halt erledigt (gleiche Straße, nah beieinander, oder direkt
     nebeneinander), bilden eine Gruppe, die nie auseinandergerissen wird. Innerhalb der Gruppe wird
     die kürzeste Laufreihenfolge gewählt – egal ob die Häuser links oder rechts liegen.
   • Bei zwei gleich guten Richtungen gewinnt die, bei der mehr Häuser rechts liegen (Rechtsverkehr).
   • Vorrang: Gruppen mit rank -1 kommen zuerst, rank 1 zuletzt (z. B. selbst gewählte Straßen).
   • Suche: Nächster-Nachbar + 2-opt + Or-opt (mit Umdrehen) auf Ebene der Gruppen, mehrere Neustarts. */
(function () {
  const BIG = 1e6;                 // Strafe, wenn eine Vorrang-Regel verletzt wird
  const SIDE_PEN = 4;              // Sekunden je Haus auf der „falschen“ Seite (nur Gleichstand-Entscheider)

  function tourCost(t, D, roundtrip) {
    if (!t.length) return 0;
    let c = D[0][t[0]];
    for (let i = 0; i < t.length - 1; i++) c += D[t[i]][t[i + 1]];
    if (roundtrip) c += D[t[t.length - 1]][0];
    return c;
  }

  /* ---------- Gruppen ---------- */
  const rad = x => x * Math.PI / 180;
  function meters(a, b) {
    const R = 6371000, dLat = rad(b.lat - a.lat), dLon = rad(b.lon - a.lon);
    const s = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(s));
  }
  /** Kürzeste offene Laufreihenfolge innerhalb einer Gruppe (Luftlinie; NN von jedem Ende + 2-opt). */
  function walkOrder(ids, P) {
    if (ids.length <= 2) return ids.slice();
    const d = (a, b) => meters(P[a], P[b]);
    const len = t => { let s = 0; for (let i = 0; i + 1 < t.length; i++) s += d(t[i], t[i + 1]); return s; };
    let best = null, bl = Infinity;
    for (const s0 of ids) {
      const left = new Set(ids); left.delete(s0);
      const t = [s0];
      while (left.size) { let bj = null, bd = Infinity; for (const j of left) { const x = d(t[t.length - 1], j); if (x < bd) { bd = x; bj = j; } } t.push(bj); left.delete(bj); }
      let imp = true;
      while (imp) {
        imp = false;
        for (let i = 0; i < t.length - 1; i++) for (let k = i + 1; k < t.length; k++) {
          const c = t.slice(0, i).concat(t.slice(i, k + 1).reverse(), t.slice(k + 1));
          if (len(c) < len(t) - 0.5) { t.splice(0, t.length, ...c); imp = true; }
        }
      }
      const l = len(t); if (l < bl) { bl = l; best = t; }
    }
    return best;
  }
  /** Wie viele Häuser liegen links, wenn man die Gruppe in dieser Reihenfolge abläuft/abfährt? */
  function leftCount(seq, P) {
    if (seq.length < 2) return 0;
    const a = P[seq[0]], b = P[seq[seq.length - 1]];
    const k = Math.cos(rad(a.lat));
    const vx = (b.lon - a.lon) * k, vy = b.lat - a.lat;
    const vl = Math.hypot(vx, vy); if (vl < 1e-6) return 0;
    let n = 0;
    for (const i of seq) {
      const px = (P[i].lon - a.lon) * k, py = P[i].lat - a.lat;
      const cross = vx * py - vy * px;                 // > 0: links der Fahrtrichtung
      if (cross / vl > 0.00004) n++;                   // ~4 m Toleranz (Straßenmitte)
    }
    return n;
  }

  /**
   * Gruppen bilden. info[i] = { street, city } oder null; P[i] = {lat, lon}. Index 0 (Depot/Start) bleibt allein.
   * sameStreetM: max. Abstand zum Nachbarn in derselben Straße; anyM: max. Abstand bei beliebiger Straße.
   */
  function buildGroups(P, info, { sameStreetM = 80, anyM = 30, maxSize = 30 } = {}) {
    const n = P.length - 1, parent = Array.from({ length: n + 1 }, (_, i) => i), size = new Array(n + 1).fill(1);
    const find = x => { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; };
    const pairs = [];
    for (let i = 1; i <= n; i++) for (let j = i + 1; j <= n; j++) {
      const a = info[i], b = info[j];
      if (a && b && a.city && b.city && a.city !== b.city) continue;
      const m = meters(P[i], P[j]);
      const same = a && b && a.street && a.street === b.street;
      if (m <= anyM || (same && m <= sameStreetM)) pairs.push([m, i, j]);
    }
    pairs.sort((x, y) => x[0] - y[0]);
    for (const [, i, j] of pairs) {
      const ri = find(i), rj = find(j);
      if (ri === rj || size[ri] + size[rj] > maxSize) continue;
      parent[rj] = ri; size[ri] += size[rj];
    }
    const map = new Map();
    for (let i = 1; i <= n; i++) { const r = find(i); if (!map.has(r)) map.set(r, []); map.get(r).push(i); }
    return [...map.values()];
  }

  /* ---------- Suche auf Gruppen ---------- */
  /** Gruppen-Tour → Knotenfolge. g = [{fw, bw, rank}], t = [[gi, dir]] */
  function expand(t, G) { const out = []; for (const [gi, dir] of t) { const s = dir ? G[gi].bw : G[gi].fw; for (const x of s) out.push(x); } return out; }
  function score(t, G, D, roundtrip, affinity) {
    let c = 0, prev = 0, prevRank = -Infinity;
    for (const [gi, dir] of t) {
      const g = G[gi], s = dir ? g.bw : g.fw;
      c += D[prev][s[0]];
      if (affinity && prev) c -= affinity[prev][s[0]] || 0;
      c += dir ? g.inBw : g.inFw;
      if (g.rank < prevRank) c += BIG;
      prevRank = g.rank; prev = s[s.length - 1];
    }
    if (roundtrip && prev) c += D[prev][0];
    return c;
  }

  function nearestNeighbor(G, D, firstGi, affinity) {
    const left = new Set(G.map((_, i) => i)), t = [];
    let cur = 0, rank = -Infinity;
    const take = (gi, dir) => { t.push([gi, dir]); left.delete(gi); const s = dir ? G[gi].bw : G[gi].fw; cur = s[s.length - 1]; rank = G[gi].rank; };
    if (firstGi != null) take(firstGi, 0);
    while (left.size) {
      let best = null, bd = Infinity;
      for (const gi of left) {
        const g = G[gi];
        for (const dir of g.fw.length > 1 ? [0, 1] : [0]) {
          const s = dir ? g.bw : g.fw;
          let c = D[cur][s[0]] + (dir ? g.inBw : g.inFw) - (cur && affinity ? affinity[cur][s[0]] || 0 : 0);
          if (g.rank < rank) c += BIG;
          // Vorrang beim Start: lieber zuerst die niedrigste noch offene Stufe
          if (c < bd) { bd = c; best = [gi, dir]; }
        }
      }
      take(best[0], best[1]);
    }
    return t;
  }

  function improve(t, G, D, roundtrip, deadline, affinity) {
    const sc = x => score(x, G, D, roundtrip, affinity);
    let best = sc(t), improved = true;
    const flipAll = seg => seg.map(([gi, dir]) => [gi, G[gi].fw.length > 1 ? 1 - dir : dir]).reverse();
    while (improved && performance.now() < deadline) {
      improved = false;
      // Richtung einzelner Gruppen umdrehen
      for (let i = 0; i < t.length && !improved; i++) {
        if (G[t[i][0]].fw.length < 2) continue;
        const cand = t.slice(); cand[i] = [t[i][0], 1 - t[i][1]];
        const c = sc(cand); if (c < best - 0.5) { t = cand; best = c; improved = true; }
      }
      if (improved) continue;
      // 2-opt: Abschnitt umdrehen (Kosten voll neu → auch für Einbahnstraßen korrekt)
      for (let i = 0; i < t.length - 1 && !improved; i++) {
        for (let k = i + 1; k < t.length; k++) {
          const cand = t.slice(0, i).concat(flipAll(t.slice(i, k + 1)), t.slice(k + 1));
          const c = sc(cand);
          if (c < best - 0.5) { t = cand; best = c; improved = true; break; }
        }
        if (performance.now() > deadline) break;
      }
      if (improved) continue;
      // Or-opt: 1–3 Gruppen an eine andere Stelle verschieben (auch umgedreht)
      outer:
      for (let len = 1; len <= 3; len++) {
        for (let i = 0; i + len <= t.length; i++) {
          const seg = t.slice(i, i + len), rest = t.slice(0, i).concat(t.slice(i + len));
          for (let p = 0; p <= rest.length; p++) {
            if (p === i) continue;
            for (const s of [seg, flipAll(seg)]) {
              const cand = rest.slice(0, p).concat(s, rest.slice(p));
              const c = sc(cand);
              if (c < best - 0.5) { t = cand; best = c; improved = true; break outer; }
            }
          }
          if (performance.now() > deadline) break outer;
        }
      }
    }
    return { t, score: best };
  }

  /**
   * D: Matrix (n+1)×(n+1), 0 = Start/Depot. Liefert Reihenfolge der Knoten 1..n.
   * opts.points: [{lat, lon}] je Knoten (0..n) – für Haltepunkt-Gruppen
   * opts.info:   [{street, city}] je Knoten – gleiche Straße
   * opts.rank:   [-1|0|1] je Knoten – Vorrang (zuerst / normal / zuletzt)
   */
  function solve(D, roundtrip = true, budgetMs = 1500, affinity = null, opts = {}) {
    const n = D.length - 1;
    if (n <= 0) return { order: [], cost: 0, groups: 0 };
    const deadline = performance.now() + budgetMs;
    const P = opts.points, info = opts.info || [], rank = opts.rank || [];
    const raw = P ? buildGroups(P, info) : Array.from({ length: n }, (_, i) => [i + 1]);
    // Innerhalb der Gruppe: Laufreihenfolge; Richtung mit mehr Häusern rechts bevorzugen
    const G = raw.map(ids => {
      const fw = P ? walkOrder(ids, P) : ids, bw = fw.slice().reverse();
      let inFw = 0; for (let i = 0; i + 1 < fw.length; i++) inFw += D[fw[i]][fw[i + 1]];
      let inBw = 0; for (let i = 0; i + 1 < bw.length; i++) inBw += D[bw[i]][bw[i + 1]];
      if (P && fw.length > 1) { inFw += SIDE_PEN * leftCount(fw, P); inBw += SIDE_PEN * leftCount(bw, P); }
      const r = Math.min(...ids.map(i => rank[i] || 0)), r2 = Math.max(...ids.map(i => rank[i] || 0));
      return { fw, bw, inFw, inBw, rank: r < 0 ? -1 : r2 > 0 ? 1 : 0 };
    });
    if (G.length === 1) {
      const t = improve([[0, 0]], G, D, roundtrip, deadline, affinity).t, order = expand(t, G);
      return { order, cost: tourCost(order, D, roundtrip), groups: 1 };
    }
    // Startkandidaten: die nächsten Gruppen zum Start (in der frühesten Vorrang-Stufe)
    const minRank = Math.min(...G.map(g => g.rank));
    const firsts = G.map((g, i) => i).filter(i => G[i].rank === minRank)
      .sort((a, b) => D[0][G[a].fw[0]] - D[0][G[b].fw[0]]).slice(0, 6);
    let best = null;
    for (const f of [null, ...firsts]) {
      if (performance.now() > deadline && best) break;
      const r = improve(nearestNeighbor(G, D, f, affinity), G, D, roundtrip, deadline, affinity);
      if (!best || r.score < best.score) best = r;
    }
    const order = expand(best.t, G);
    return { order, cost: tourCost(order, D, roundtrip), groups: G.length };
  }

  window.Optimize = { solve, tourCost, buildGroups, walkOrder };
})();
