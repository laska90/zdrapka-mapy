// What an outing walked for the first time: the stretches of ways no earlier outing had
// covered (a way's walked part is an interval of its length, as fractions 0..1).

import { decodeLine, mergeIntervals, Polyline, substring } from "./geometry.js";

/** a minus b (both merged, sorted [lo, hi] lists); pieces shorter than `min` are dropped. */
export function subtract(a, b, min = 0) {
  const out = [];
  for (const [lo0, hi] of a) {
    let lo = lo0;
    for (const [blo, bhi] of b) {
      if (bhi <= lo || blo >= hi) continue;
      if (blo > lo) out.push([lo, blo]);
      lo = Math.max(lo, bhi);
      if (lo >= hi) break;
    }
    if (lo < hi) out.push([lo, hi]);
  }
  return out.filter(([lo, hi]) => hi - lo > min);
}

const sum = (iv) => iv.reduce((s, [lo, hi]) => s + hi - lo, 0);

/**
 * mine: the outing's traversals [[key, full, lo, hi, ...]]; before: the traversals of the outings
 * before it (same shape); segs: {key: [len, cat, cols, rg, geom]}; scale: the geometry's scale.
 * -> {lines: [flat [x, y, ...]], km, trailKm, totalKm, trailTotalKm, ranges: {rg: km of new trails}, walked: {rg: km walked}}
 */
export function freshOf(mine, before, segs, scale = 10) {
  const old = new Map(), my = new Map();
  for (const t of before) (old.get(t[0]) || old.set(t[0], []).get(t[0])).push([t[2], t[3]]);
  for (const t of mine) (my.get(t[0]) || my.set(t[0], []).get(t[0])).push([t[2], t[3]]);
  const out = { lines: [], km: 0, trailKm: 0, totalKm: 0, trailTotalKm: 0, ranges: {}, walked: {} };
  for (const [key, ivs] of my) {
    const seg = segs[key];
    if (!seg) continue;
    const [len, cat, , rg, geom] = seg, m = mergeIntervals(ivs, 0.02), km = (len / 1000);
    out.totalKm += sum(m) * km;
    if (rg >= 0) out.walked[rg] = (out.walked[rg] || 0) + sum(m) * km;
    if (cat === 0) out.trailTotalKm += sum(m) * km;
    const f = subtract(m, mergeIntervals(old.get(key) || [], 0.02), Math.min(0.5, 25 / Math.max(1, len)));
    if (!f.length) continue;
    const fk = sum(f) * km;
    out.km += fk;
    if (cat === 0) { out.trailKm += fk; if (rg >= 0) out.ranges[rg] = (out.ranges[rg] || 0) + fk; }
    if (geom) {
      const [xs, ys] = decodeLine(geom, scale), L = new Polyline(xs, ys);
      for (const [lo, hi] of f) out.lines.push(substring(L, lo, hi).flat());
    }
  }
  return out;
}
