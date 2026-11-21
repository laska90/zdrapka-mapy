// Pace of an outing against a standard: the time in motion (stops left out) compared with
// Tobler's hiking function over the outing's own profile, and your own norm fitted over
// all outings (km/h on the flat, m/h up, m/h down).

import { haversine } from "./clean.js";

export const PACE_V = 2; // bump when the method changes (cached figures are recomputed)

/**
 * Time in motion (ms) of a track: in windows of ~1 min, moving when it got at least ~20 m
 * further (GPS jitter while standing does not count); a long hole in the record (auto-pause,
 * no fix) counts only if it covered ground at walking pace.
 * parts: [[{t, lat, lon}]]
 */
export function movingTime(parts, { win = 60_000, minMove = 20, hole = 300_000 } = {}) {
  let moving = 0;
  for (const part of parts) {
    const flush = (s, e) => {
      const W = part[e].t - part[s].t;
      if (W > 0 && haversine(part[s], part[e]) >= (minMove * Math.min(W, win)) / win) moving += W;
    };
    let s = 0;
    for (let e = 1; e < part.length; e++) {
      const dt = part[e].t - part[e - 1].t;
      if (!(dt >= 0)) continue;
      if (dt > hole) {
        if (e - 1 > s) flush(s, e - 1);
        if (haversine(part[e - 1], part[e]) / (dt / 1000) > 0.3) moving += dt; // > ~1 km/h on average
        s = e;
        continue;
      }
      if (part[e].t - part[s].t >= win) { flush(s, e); s = e; }
    }
    if (part.length - 1 > s) flush(s, part.length - 1);
  }
  return moving;
}

/** Tobler's hiking function: walking speed (km/h) on a gradient (rise / run). */
export const tobler = (g) => 6 * Math.exp(-3.5 * Math.abs(g + 0.05));

/**
 * The standard walking time, hours per km along the way, on a gradient g (rise / run). On gentle
 * ground Tobler's function; from 8 % on it goes over to the trail signs' rule (DIN 33466 as the Tatra signs use it: 4 km/h,
 * 320 m/h up, 500 m/h down, the larger of the two plus half the smaller), whichever is slower, and
 * descents steeper than 25 % slower still (rocks, knees). Up and down the same way differ.
 */
export function stdHoursPerKm(g) {
  const tob = 1 / tobler(g), a = Math.abs(g);
  if (a <= 0.08) return tob;
  const th = 0.25, tv = g > 0 ? (1000 * g) / 320 : ((1000 * a) / 500) * (1 + Math.max(0, a - 0.25) * 2);
  const din = Math.max(th, tv) + Math.min(th, tv) / 2, w = Math.min(1, (a - 0.08) / 0.1);
  return tob + w * (Math.max(tob, din) - tob);
}
/** Standard time (ms) for dx metres on a gradient g. */
export const stdMs = (dx, g) => (dx / 1000) * stdHoursPerKm(g) * 3.6e6;

/** Gradient classes for the personal pace (edges, rise / run): steep down ... flat ... steep up. */
export const GBINS = [-0.3, -0.2, -0.12, -0.06, -0.02, 0.02, 0.06, 0.12, 0.2, 0.3];
export const gbin = (g) => { let i = 0; while (i < GBINS.length && g >= GBINS[i]) i++; return i; };

/** Standard time (ms) over a profile {d, h, gap, slope (%)}; also the climb and descent there. */
export function standardTime(P) {
  let ms = 0, up = 0, down = 0;
  for (let i = 0; i < P.d.length - 1; i++) {
    if (P.gap[i + 1]) continue;
    const dx = P.d[i + 1] - P.d[i];
    if (!(dx > 0)) continue;
    const g = (P.slope[i] + P.slope[i + 1]) / 200;
    ms += stdMs(dx, g);
    const dh = P.h[i + 1] - P.h[i];
    if (Number.isFinite(dh)) { if (dh > 0) up += dh; else down -= dh; }
  }
  return { ms, up, down };
}

/**
 * Pace of one outing. act: {start, end, parts}, P: its profile.
 * idx = standard time / time in motion: 1 = Tobler's pace, 1.2 = 20 % faster.
 */
export function paceOf(act, P) {
  const moving = movingTime(act.parts), first = act.parts[0]?.[0]?.t, last = act.parts.at(-1)?.at(-1)?.t;
  const elapsed = Number.isFinite(first) && Number.isFinite(last) ? last - first : null;
  if (!P || !(moving > 10 * 60_000)) return null;
  const st = standardTime(P), km = P.d[P.d.length - 1] / 1000;
  if (km < 1 || !(st.ms > 0)) return null;
  // by gradient class: the standard time and your time there (in motion: stops and jumps left out)
  const bins = GBINS.map(() => [0, 0]).concat([[0, 0]]);
  if (P.t) for (let i = 0; i < P.d.length - 1; i++) {
    if (P.gap[i + 1]) continue;
    const dx = P.d[i + 1] - P.d[i], dt = P.t[i + 1] - P.t[i];
    if (!(dx > 0) || !(dt > 0)) continue;
    const kmh = dx / 1000 / (dt / 3.6e6);
    if (kmh < 0.8 || kmh > 12) continue;
    const g = (P.slope[i] + P.slope[i + 1]) / 200, b = bins[gbin(g)];
    b[0] += stdMs(dx, g); b[1] += dt;
  }
  return { v: PACE_V, km, up: Math.round(st.up), down: Math.round(st.down), moving, elapsed, stops: elapsed != null ? Math.max(0, elapsed - moving) : null, norm: Math.round(st.ms), idx: st.ms / moving, bins: bins.map(([a, b]) => [Math.round(a), Math.round(b)]) };
}

/** A word for an index (against Tobler's pace). */
export function paceWord(idx) {
  return idx >= 1.1 ? "szybko" : idx >= 0.9 ? "równo z normą" : idx >= 0.75 ? "spokojnie" : "spacerowo";
}

/**
 * Your own norm from your outings: time in motion = km / flat + up / climb + down / descent,
 * least squares with all three rates positive (a term that does not help is dropped).
 * rows: [{km, up, down, moving (ms)}] -> {flat (km/h), climb (m/h), descent (m/h) or null, n} or null.
 */
export function personalNorm(rows) {
  const R = rows.filter((r) => r && r.km > 1 && r.moving > 0);
  if (R.length < 5) return null;
  const X = R.map((r) => [r.km, r.up, r.down]), y = R.map((r) => r.moving / 3.6e6);
  let best = null;
  for (const use of [[0, 1, 2], [0, 1], [0, 2], [0]]) {
    const k = use.length, A = Array.from({ length: k }, () => new Array(k).fill(0)), b = new Array(k).fill(0);
    for (let i = 0; i < X.length; i++) for (let p = 0; p < k; p++) { b[p] += X[i][use[p]] * y[i]; for (let q = 0; q < k; q++) A[p][q] += X[i][use[p]] * X[i][use[q]]; }
    const c = solve(A, b);
    // a rate outside what people walk means the outings cannot tell it apart: leave the term out
    const LIM = [[1.5, 9], [100, 2500], [150, 6000]];
    if (!c || c.some((v, p) => !(v > 0) || 1 / v < LIM[use[p]][0] || 1 / v > LIM[use[p]][1])) continue;
    let err = 0;
    for (let i = 0; i < X.length; i++) { let f = 0; use.forEach((u, p) => (f += c[p] * X[i][u])); err += (f - y[i]) ** 2; }
    if (!best || err < best.err - 1e-9) { const coef = [0, 0, 0]; use.forEach((u, p) => (coef[u] = c[p])); best = { err, coef }; }
    if (best && use.length === 3) break; // all three positive: that is the fit
  }
  if (!best) return null;
  const [a, b, c] = best.coef;
  return { flat: 1 / a, climb: b > 0 ? 1 / b : null, descent: c > 0 ? 1 / c : null, n: R.length };
}

/**
 * Your pace by gradient class from your outings (paceOf bins): how much longer than the standard
 * you take there (r > 1 slower). A class with little of your walking leans on your overall ratio.
 * -> {r: [ratio per class], all, hours} or null (too little).
 */
export function personalCurve(rows) {
  const R = rows.filter((r) => r?.bins?.length === GBINS.length + 1);
  if (R.length < 5) return null;
  const S = GBINS.map(() => 0).concat([0]), A = S.slice();
  for (const r of R) r.bins.forEach(([s, a], b) => { S[b] += s; A[b] += a; });
  const sS = S.reduce((x, y) => x + y, 0), sA = A.reduce((x, y) => x + y, 0);
  if (sS < 2 * 3.6e6) return null;
  const all = sA / sS, K = 20 * 60000; // 20 min of the standard: the weight of the overall ratio in each class
  return { r: S.map((s, b) => (A[b] + K * all) / (s + K)), all, hours: sA / 3.6e6 };
}

/** Your own time (ms) for a route of km, up, down by your norm. */
export const personalTime = (N, km, up, down) => 3.6e6 * (km / N.flat + (N.climb ? up / N.climb : 0) + (N.descent ? down / N.descent : 0));

function solve(A, b) {
  const n = b.length, M = A.map((r, i) => [...r, b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    if (Math.abs(M[p][c]) < 1e-12) return null;
    [M[c], M[p]] = [M[p], M[c]];
    for (let r = 0; r < n; r++) if (r !== c) { const f = M[r][c] / M[c][c]; for (let q = c; q <= n; q++) M[r][q] -= f * M[c][q]; }
  }
  return M.map((r, i) => r[n] / r[i]);
}
