/* Tourenoptimierung: Start (und optional Ende) am Depot = Knoten 0.
   Nächster-Nachbar-Start + 2-opt + Or-opt, mehrere Neustarts innerhalb eines Zeitbudgets. */
(function () {
  function tourCost(t, D, roundtrip) {
    if (!t.length) return 0;
    let c = D[0][t[0]];
    for (let i = 0; i < t.length - 1; i++) c += D[t[i]][t[i + 1]];
    if (roundtrip) c += D[t[t.length - 1]][0];
    return c;
  }

  function nearestNeighbor(n, D, first) {
    const left = new Set(); for (let i = 1; i <= n; i++) left.add(i);
    const t = [];
    let cur = 0;
    if (first) { t.push(first); left.delete(first); cur = first; }
    while (left.size) {
      let best = -1, bd = Infinity;
      for (const j of left) if (D[cur][j] < bd) { bd = D[cur][j]; best = j; }
      t.push(best); left.delete(best); cur = best;
    }
    return t;
  }

  function improve(t, D, roundtrip, deadline) {
    let best = tourCost(t, D, roundtrip);
    let improved = true;
    while (improved && performance.now() < deadline) {
      improved = false;
      // 2-opt: Segment umdrehen (Kosten voll neu berechnen → auch für Einbahnstraßen korrekt)
      for (let i = 0; i < t.length - 1 && !improved; i++) {
        for (let k = i + 1; k < t.length; k++) {
          const cand = t.slice(0, i).concat(t.slice(i, k + 1).reverse(), t.slice(k + 1));
          const c = tourCost(cand, D, roundtrip);
          if (c < best - 0.5) { t = cand; best = c; improved = true; break; }
        }
      }
      if (improved) continue;
      // Or-opt: 1–3 Stopps an eine andere Stelle verschieben
      outer:
      for (let len = 1; len <= 3; len++) {
        for (let i = 0; i + len <= t.length; i++) {
          const seg = t.slice(i, i + len);
          const rest = t.slice(0, i).concat(t.slice(i + len));
          for (let p = 0; p <= rest.length; p++) {
            if (p === i) continue;
            for (const s of [seg, seg.slice().reverse()]) {
              const cand = rest.slice(0, p).concat(s, rest.slice(p));
              const c = tourCost(cand, D, roundtrip);
              if (c < best - 0.5) { t = cand; best = c; improved = true; break outer; }
            }
          }
        }
      }
    }
    return { t, cost: best };
  }

  /** D: Matrix (n+1)×(n+1), 0 = Depot. Liefert Reihenfolge der Knoten 1..n. */
  function solve(D, roundtrip = true, budgetMs = 1500) {
    const n = D.length - 1;
    if (n <= 0) return { order: [], cost: 0 };
    if (n === 1) return { order: [1], cost: tourCost([1], D, roundtrip) };
    const deadline = performance.now() + budgetMs;

    // Startkandidaten: die nächsten Stopps zum Depot
    const firsts = Array.from({ length: n }, (_, i) => i + 1).sort((a, b) => D[0][a] - D[0][b]).slice(0, 6);
    let best = null;
    for (const f of [null, ...firsts]) {
      if (performance.now() > deadline && best) break;
      const r = improve(nearestNeighbor(n, D, f), D, roundtrip, deadline);
      if (!best || r.cost < best.cost) best = r;
    }
    return { order: best.t, cost: best.cost };
  }

  window.Optimize = { solve, tourCost };
})();
