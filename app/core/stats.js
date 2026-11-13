// Aggregation, coverage and discoveries (ports of match/run.py aggregate,
// stats/coverage.py and stats/discover.py). Pack metres, times in ms.

import { mergeIntervals } from "./geometry.js";

/** Per segment: {count, passes, partial, activities:Set, intervals, frac, first, last} */
export function aggregate(traversals, countMode = "activities", mergeGap = 0.02) {
  const agg = new Map();
  for (const t of traversals) {
    let a = agg.get(t.k);
    if (!a) agg.set(t.k, (a = { count: 0, passes: 0, partial: 0, activities: new Set(), fullIn: new Set(), intervals: [], first: t.t0, last: t.t1 }));
    if (t.full) { a.passes++; a.fullIn.add(t.activity); } else a.partial++;
    a.activities.add(t.activity);
    a.intervals.push([t.lo, t.hi]);
    a.first = Math.min(a.first, t.t0);
    a.last = Math.max(a.last, t.t1);
  }
  for (const a of agg.values()) {
    a.count = countMode === "activities" ? a.fullIn.size : a.passes;
    delete a.fullIn;
    a.intervals = mergeIntervals(a.intervals, mergeGap);
    a.frac = Math.min(1, a.intervals.reduce((s, [lo, hi]) => s + hi - lo, 0));
  }
  return agg;
}

/** Coverage: % only for marked trails (in-region, unique geometry); km for the rest. */
export function coverage(net, agg) {
  const total = [0, 0, 0], walked = [0, 0, 0], colTotal = {}, colWalked = {}, atLeast = { 2: 0, 5: 0, 10: 0 };
  for (let k = 0; k < net.n; k++) {
    if (!net.inRegion[k]) continue;
    const km = net.len[k] / 1000, a = agg.get(k), f = a ? a.frac : 0, c = net.cat[k];
    total[c] += km;
    walked[c] += km * f;
    if (c === 0) {
      for (const col of net.cols[k]) { colTotal[col] = (colTotal[col] || 0) + km; colWalked[col] = (colWalked[col] || 0) + km * f; }
      for (const n of [2, 5, 10]) if (a && a.count >= n) atLeast[n] += km;
    }
  }
  return {
    trails: { totalKm: total[0], walkedKm: walked[0], pct: total[0] ? (100 * walked[0]) / total[0] : 0, atLeast, byColor: Object.fromEntries(Object.keys(colTotal).sort().map((c) => [c, { totalKm: colTotal[c], walkedKm: colWalked[c] }])) },
    pathsKm: walked[1],
    roadsKm: walked[2],
  };
}

export const DISCOVER_RADII = { peak: 100, hut: 75, tower: 75, viewpoint: 75, ruins: 100, waterfall: 75 };

/**
 * pois: [{id, c, x, y, ...}], tracks: Map activityId -> parts [[{t, x, y}]]
 * Returns Map poiId -> {first, last, visits:Set, minDist}
 */
export function discover(pois, tracks, radii = DISCOVER_RADII) {
  const cell = Math.max(...Object.values(radii), ...pois.map((p) => Math.max(p.r || 0, p.ar || 0)));
  const grid = new Map();
  const key = (cx, cy) => cx * 1_000_003 + cy;
  for (const [aid, parts] of tracks) for (const part of parts) for (const q of part) {
    const kk = key(Math.floor(q.x / cell), Math.floor(q.y / cell));
    let arr = grid.get(kk);
    if (!arr) grid.set(kk, (arr = []));
    arr.push(aid, q.t, q.x, q.y);
  }
  const out = new Map();
  for (const p of pois) {
    const d = { first: null, last: null, visits: new Set(), minDist: Infinity };
    // the summit itself, and (a summit with no way to it) its access point on a trail
    const spots = [[p.x, p.y, p.r ?? radii[p.c] ?? 100, true]];
    if (p.ax != null) spots.push([p.ax, p.ay, p.ar ?? 60, false]);
    for (const [sx, sy, r, own] of spots) {
      const cx = Math.floor(sx / cell), cy = Math.floor(sy / cell);
      for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
        const arr = grid.get(key(cx + dx, cy + dy));
        if (!arr) continue;
        for (let i = 0; i < arr.length; i += 4) {
          const dist = Math.hypot(arr[i + 2] - sx, arr[i + 3] - sy);
          if (own && dist < d.minDist) d.minDist = dist;
          if (dist > r) continue;
          d.visits.add(arr[i]);
          d.first = d.first === null ? arr[i + 1] : Math.min(d.first, arr[i + 1]);
          d.last = d.last === null ? arr[i + 1] : Math.max(d.last, arr[i + 1]);
        }
      }
    }
    out.set(p.id, d);
  }
  return out;
}

export const DISCOVERABLE = ["peak", "hut", "tower", "viewpoint", "ruins", "waterfall"];

/** {category: [discovered, total]} for named, in-region points (unnamed knolls
 * and benches are not goals) */
export function tally(pois, found) {
  const t = {};
  for (const c of DISCOVERABLE) t[c] = [0, 0];
  for (const p of pois) {
    if (!p.in || !t[p.c] || !p.n) continue;
    t[p.c][1]++;
    if (found.get(p.id)?.first != null) t[p.c][0]++;
  }
  return t;
}
