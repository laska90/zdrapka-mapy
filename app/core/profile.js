// Elevation profile of one outing: evenly spaced samples along the track with
// height, slope and the marked trails walked there (from the matching).

import { haversine } from "./clean.js";

/** Trail colours in the order they are listed. */
export const TRAIL_ORDER = ["red", "blue", "green", "yellow", "black"];

/**
 * @param parts [[{lat, lon, t, ele}]] - the outing
 * @param travs [[t0, t1, "red,blue"]] - marked trails walked, by time
 * @param project (lon, lat) -> [x, y] pack metres
 * @returns {d, h, x, y, t, c: colour-set index per sample, cols: ["", "red", ...], gap: 1 where the track has a hole, step}
 */
export function sampleProfile(parts, travs, project, { max = 420, minStep = 8 } = {}) {
  const P = [];
  let D = 0;
  for (let k = 0; k < parts.length; k++) {
    for (let i = 0; i < parts[k].length; i++) {
      const q = parts[k][i], prev = P[P.length - 1];
      if (prev) D += haversine(prev, q);
      P.push({ ...q, d: D, gap: i === 0 && k > 0 });
    }
  }
  if (P.length < 2 || D < 50) return null;
  const step = Math.max(minStep, D / max), n = Math.floor(D / step) + 1;
  const d = new Float32Array(n), h = new Float32Array(n), x = new Float32Array(n), y = new Float32Array(n), t = new Float64Array(n), gap = new Uint8Array(n), c = new Uint8Array(n);
  const sets = [""], setIx = new Map([["", 0]]);
  const tr = [...travs].sort((a, b) => a[0] - b[0]);
  let j = 0;
  for (let s = 0; s < n; s++) {
    const at = Math.min(D, s * step);
    while (j < P.length - 2 && P[j + 1].d < at) j++;
    const a = P[j], b = P[j + 1], f = b.d > a.d ? (at - a.d) / (b.d - a.d) : 0;
    const lat = a.lat + f * (b.lat - a.lat), lon = a.lon + f * (b.lon - a.lon);
    [x[s], y[s]] = project(lon, lat);
    d[s] = at;
    t[s] = a.t != null && b.t != null ? a.t + f * (b.t - a.t) : NaN;
    h[s] = a.ele != null && b.ele != null ? a.ele + f * (b.ele - a.ele) : a.ele ?? b.ele ?? NaN;
    gap[s] = b.gap ? 1 : 0;
    // marked trails at this moment (a little slack: traversal windows end at the last point on the edge)
    const cols = new Set();
    if (Number.isFinite(t[s])) for (const [t0, t1, cs] of tr) { if (t0 > t[s] + 20000) break; if (t1 >= t[s] - 20000) for (const col of cs.split(",")) if (col) cols.add(col); }
    const key = TRAIL_ORDER.filter((q) => cols.has(q)).join(",");
    if (!setIx.has(key)) { setIx.set(key, sets.length); sets.push(key); }
    c[s] = setIx.get(key);
  }
  return { d, h, x, y, t, c, cols: sets, gap, step };
}

/** Smooth the heights (~80 m window) and add the slope (%, over ~100 m) and the extremes. */
export function finishProfile(p, { smooth = null, slope = null } = {}) {
  // heights from the map (contours) are stepped: smooth them more (a plan asks for less: steep
  // short bits must stay steep); smooth, slope: the windows' half-widths in metres
  const n = p.d.length, k = Math.max(1, Math.round((smooth ?? (p.fromMap ? 90 : 60)) / p.step)), hs = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let s = 0, m = 0;
    const r = Math.min(k, i, n - 1 - i); // symmetric, narrower at the ends: the start and end heights stay
    for (let q = i - r; q <= i + r; q++) if (Number.isFinite(p.h[q])) { s += p.h[q]; m++; }
    hs[i] = m ? s / m : NaN;
  }
  const w = Math.max(1, Math.round((slope ?? (p.fromMap ? 100 : 75)) / p.step)), sl = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const a = Math.max(0, i - w), b = Math.min(n - 1, i + w);
    sl[i] = p.d[b] > p.d[a] && Number.isFinite(hs[a]) && Number.isFinite(hs[b]) ? (100 * (hs[b] - hs[a])) / (p.d[b] - p.d[a]) : 0;
  }
  let lo = Infinity, hi = -Infinity;
  for (const v of hs) if (Number.isFinite(v)) { lo = Math.min(lo, v); hi = Math.max(hi, v); }
  return { ...p, h: hs, slope: sl, lo, hi };
}

/** Slope classes (|%|) for colouring, as on tourist maps. */
// slope classes (%, up or down): up to 5, 10, 15, 25, 35, 50 and steeper (the Tatras' steep bits are 40-60 %)
// slope classes (percent, either way): flat green, then warmer, black on the very steep (Waligóra's
// north face, the Tatras); LINE: the same, a shade deeper for a line on a light fill (flat: a darker green)
// calm, one way from green to brick (the steepest a deep brown-red, not black: black read as "danger" or "no data")
export const SLOPES = [[5, "#d3e5bd"], [10, "#ece0a4"], [15, "#efc383"], [25, "#e2956a"], [35, "#c8644f"], [Infinity, "#8e3c38"]];
export const SLOPE_LINE = ["#7aa35f", "#cdb35a", "#df9a4e", "#cf7449", "#b04f3d", "#7a2e2b"];
export const slopeClass = (pct) => SLOPES.findIndex(([m]) => Math.abs(pct) < m);
export const slopeColour = (pct) => SLOPES[slopeClass(pct)][1];

/**
 * The slope in whole stretches for a drawing W px wide: the slope over at least ±50 m (more on a long
 * route: ±3 px of it), in classes; stretches narrower than minPx join the neighbour of the nearer class (the steeper on a tie)
 * (so a short steep top stays steep, and a long route has no stripes). -> [{i, j, c}] (samples i..j, class c)
 */
export function slopeRuns(P, W, minPx = 6) {
  const n = P.d.length, D = P.d[n - 1] || 1, half = Math.max(50, (3 * D) / Math.max(1, W)), px = (a, b) => ((P.d[b] - P.d[a]) / D) * W;
  const cls = new Int8Array(n).fill(-1);
  let a = 0, b = 0;
  for (let i = 0; i < n; i++) {
    if (!Number.isFinite(P.h[i])) continue;
    while (P.d[a] < P.d[i] - half) a++;
    while (b < n - 1 && P.d[b + 1] <= P.d[i] + half) b++;
    let ia = a, ib = b;
    while (ia < i && !Number.isFinite(P.h[ia])) ia++;
    while (ib > i && !Number.isFinite(P.h[ib])) ib--;
    const s = ib > ia ? (100 * (P.h[ib] - P.h[ia])) / Math.max(1, P.d[ib] - P.d[ia]) : P.slope[i] || 0;
    cls[i] = slopeClass(s);
  }
  const R = [];
  for (let i = 0; i < n; i++) {
    if (cls[i] < 0) continue;
    const last = R[R.length - 1];
    if (last && last.c === cls[i] && last.j === i - 1) last.j = i; else R.push({ i: last && last.j === i - 1 ? i - 1 : i, j: i, c: cls[i] });
  }
  for (;;) {
    if (R.length < 2) break;
    let k = 0;
    for (let q = 1; q < R.length; q++) if (px(R[q].i, R[q].j) < px(R[k].i, R[k].j)) k = q;
    if (px(R[k].i, R[k].j) >= minPx) break;
    const nb = [k - 1, k + 1].filter((q) => q >= 0 && q < R.length && R[q].j >= R[k].i - 1 && R[q].i <= R[k].j + 1);
    if (!nb.length) { R.splice(k, 1); continue; }
    const q = nb.sort((x, y) => Math.abs(R[x].c - R[k].c) - Math.abs(R[y].c - R[k].c) || R[y].c - R[x].c || px(R[y].i, R[y].j) - px(R[x].i, R[x].j))[0];
    if (q < k) R[q].j = R[k].j; else R[q].i = R[k].i;
    R.splice(k, 1);
    const z = q < k ? q : q - 1;
    for (const w of [z - 1, z]) if (w >= 0 && w + 1 < R.length && R[w].c === R[w + 1].c && R[w].j >= R[w + 1].i - 1) { R[w].j = R[w + 1].j; R.splice(w + 1, 1); break; }
  }
  return R;
}
/** The steepest stretch that lasts (len m or more): its slope in percent, either way. */
export function steepest(P, len = 100) {
  const n = P.d.length;
  let best = 0;
  for (let i = 0, j = 0; i < n; i++) {
    if (!Number.isFinite(P.h[i])) continue;
    if (j < i) j = i;
    while (j < n - 1 && P.d[j] - P.d[i] < len) j++;
    if (P.d[j] - P.d[i] < len * 0.9 || !Number.isFinite(P.h[j])) continue;
    best = Math.max(best, (100 * Math.abs(P.h[j] - P.h[i])) / (P.d[j] - P.d[i]));
  }
  return best;
}
