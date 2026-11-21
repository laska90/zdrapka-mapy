// The navigation radar's reckoning (app/navradar.js draws it): where you are along the active route, its
// junctions (where a marked trail leaves it), each junction's arms and where they lead, the turn you take
// there, how near the next one is (the radar zooms in on it), and the climb ahead in the app's slope classes.
// Pack metres: x east, y south (north is -y).

import { SLOPES } from "./profile.js";

export const COL_NAME = { red: "czerwony", blue: "niebieski", green: "zielony", yellow: "żółty", black: "czarny" };
const COL_INS = { red: "czerwonym", blue: "niebieskim", green: "zielonym", yellow: "żółtym", black: "czarnym" };
const RAD = Math.PI / 180;

/** Clockwise from north, for a step (dx, dy) in pack metres. */
export const bearingXY = (dx, dy) => ((Math.atan2(dx, -dy) / RAD) + 360) % 360;
export const wrap180 = (a) => ((a % 360) + 540) % 360 - 180;

/** The trails' names: "czerwony + niebieski"; ins: "czerwonym i niebieskim" (how you go). */
export function colsText(cols, ins = false) {
  const cs = (Array.isArray(cols) ? cols : String(cols || "").split(",")).filter((c) => COL_NAME[c]);
  if (!cs.length) return ins ? "ścieżką" : "bez znaków";
  if (!ins) return cs.map((c) => COL_NAME[c]).join(" + ");
  const w = cs.map((c) => COL_INS[c]);
  return w.length > 1 ? `${w.slice(0, -1).join(", ")} i ${w[w.length - 1]}` : w[0];
}

/** The route's runs along it: [{d0, d1, cols}] (metres along the route, as its profile counts them). */
export function runsAlong(route) {
  const out = [];
  let D = 0, px = null, py = null;
  for (const leg of route?.legs || []) for (const run of leg.runs || []) {
    const L = run.line, d0 = D;
    for (let i = 0; i < L.length; i += 2) { if (px != null) D += Math.hypot(L[i] - px, L[i + 1] - py); px = L[i]; py = L[i + 1]; }
    out.push({ d0, d1: D, cols: run.cols || "" });
  }
  // (the profile's length can differ a little from the lines': scale to it)
  const PD = route?.P?.d?.length ? route.P.d[route.P.d.length - 1] : D;
  if (D > 0 && PD > 0 && Math.abs(PD - D) > 1) for (const r of out) { r.d0 *= PD / D; r.d1 *= PD / D; }
  return out;
}
export const colsAt = (runs, d) => (runs.find((r) => d >= r.d0 && d <= r.d1) || runs[runs.length - 1] || { cols: "" }).cols;

/** The point d metres along the profile P ({x, y, d}). */
export function pointAt(P, d) {
  const n = P.d.length;
  if (d <= P.d[0]) return [P.x[0], P.y[0]];
  if (d >= P.d[n - 1]) return [P.x[n - 1], P.y[n - 1]];
  let lo = 0, hi = n - 1;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (P.d[m] <= d) lo = m; else hi = m; }
  const t = (d - P.d[lo]) / ((P.d[hi] - P.d[lo]) || 1);
  return [P.x[lo] + t * (P.x[hi] - P.x[lo]), P.y[lo] + t * (P.y[hi] - P.y[lo])];
}
/** The profile's height at d (null where it has none). */
export function heightAt(P, d) {
  const n = P.d.length;
  let lo = 0, hi = n - 1;
  if (d <= P.d[0]) return P.h[0]; if (d >= P.d[n - 1]) return P.h[n - 1];
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (P.d[m] <= d) lo = m; else hi = m; }
  const t = (d - P.d[lo]) / ((P.d[hi] - P.d[lo]) || 1), a = P.h[lo], b = P.h[hi];
  return Number.isFinite(a) && Number.isFinite(b) ? a + t * (b - a) : null;
}

/** The nearest point of the profile's line to (x, y): {d (along), dist, x, y}; from..to: only that stretch (samples). */
export function nearestOn(P, x, y, from = 0, to = P.d.length - 1) {
  let best = { d: P.d[from] ?? 0, dist: Infinity, x: P.x[from], y: P.y[from] };
  for (let i = Math.max(1, from + 1); i <= to; i++) {
    const ax = P.x[i - 1], ay = P.y[i - 1], dx = P.x[i] - ax, dy = P.y[i] - ay, L2 = dx * dx + dy * dy;
    const t = L2 ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / L2)) : 0;
    const qx = ax + t * dx, qy = ay + t * dy, dd = Math.hypot(x - qx, y - qy);
    if (dd < best.dist) best = { d: P.d[i - 1] + t * (P.d[i] - P.d[i - 1]), dist: dd, x: qx, y: qy };
  }
  return best;
}

// ---- the trails' network: ways [{cols, xs, ys}] between nodes (their ends)
const nodeKey = (x, y) => `${Math.round(x / 3)},${Math.round(y / 3)}`;
/** The nodes: key -> {x, y, ends: [{w (way index), start (the way starts here)}]}. Ends within ~3 m are one node. */
export function nodesOf(ways) {
  const nodes = new Map();
  ways.forEach((w, i) => {
    const n = w.xs.length;
    for (const [k, start] of [[0, true], [n - 1, false]]) {
      const key = nodeKey(w.xs[k], w.ys[k]);
      let nd = nodes.get(key);
      if (!nd) nodes.set(key, (nd = { key, x: w.xs[k], y: w.ys[k], ends: [] }));
      nd.ends.push({ w: i, start });
    }
  });
  return nodes;
}
/** A way's points from a node: [[x, y], ...]. */
const fromEnd = (w, start) => { const out = []; for (let k = 0; k < w.xs.length; k++) { const i = start ? k : w.xs.length - 1 - k; out.push([w.xs[i], w.ys[i]]); } return out; };
/** The distance from pt to a polyline [[x, y], ...]. */
function segDist(pts, [x, y]) {
  let best = Infinity;
  for (let i = 1; i < pts.length; i++) {
    const [ax, ay] = pts[i - 1], dx = pts[i][0] - ax, dy = pts[i][1] - ay, L2 = dx * dx + dy * dy;
    const t = L2 ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / L2)) : 0;
    best = Math.min(best, Math.hypot(x - ax - t * dx, y - ay - t * dy));
  }
  return best;
}
const lenOf = (pts) => { let s = 0; for (let i = 1; i < pts.length; i++) s += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]); return s; };

/**
 * The arms of a node: each way leaving it, followed on through the next nodes (straight on where only one way
 * goes on, else the way that keeps one of its colours) up to len metres for drawing, and further (far m) to
 * find where it leads: the first named place within 150 m of it, past the first 150 m.
 * -> [{cols, pts (len m), to: name | null, toD (m)}]
 */
export function armsOf(node, ways, nodes, places = [], { len = 450, far = 4000 } = {}) {
  const out = [];
  for (const e of node.ends) {
    const w0 = ways[e.w], cols0 = w0.cols.split(",");
    let pts = fromEnd(w0, e.start), used = new Set([e.w]), at = pts[pts.length - 1];
    let total = lenOf(pts);
    while (total < far) {
      const nd = nodes.get(nodeKey(at[0], at[1]));
      if (!nd) break;
      const next = nd.ends.filter((q) => !used.has(q.w));
      if (!next.length) break;
      const keep = next.length === 1 ? next[0] : next.find((q) => ways[q.w].cols.split(",").some((c) => cols0.includes(c)));
      if (!keep) break;
      used.add(keep.w);
      const more = fromEnd(ways[keep.w], keep.start).slice(1);
      total += lenOf([at, ...more]); pts = pts.concat(more); at = pts[pts.length - 1];
    }
    // where it leads: the first named place along it (not the node's own one)
    let to = null, toD = Infinity, s = 0;
    for (let i = 1; i < pts.length; i++) {
      const [ax, ay] = pts[i - 1], dx = pts[i][0] - ax, dy = pts[i][1] - ay, L = Math.hypot(dx, dy);
      if (s > toD) break;
      for (const p of places) {
        if (Math.hypot(p.x - node.x, p.y - node.y) < 150) continue;
        const t = L ? Math.max(0, Math.min(1, ((p.x - ax) * dx + (p.y - ay) * dy) / (L * L))) : 0, at = s + t * L;
        if (at >= 150 && at < toD && Math.hypot(p.x - ax - t * dx, p.y - ay - t * dy) < 150) { to = p.n; toD = at; }
      }
      s += L;
    }
    if (!to) toD = null;
    // the drawn part: len m
    const cut = [pts[0]]; s = 0;
    for (let i = 1; i < pts.length && s < len; i++) { s += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]); cut.push(pts[i]); }
    out.push({ cols: w0.cols, pts: cut, to, toD });
  }
  return out;
}

/**
 * The junctions on the route: nodes of three ways or more (marked trails) within tol m of its line, by d along
 * it; two within 25 m: one. Each: {d, x, y, name (a named place within 120 m), arms, mine (the arm the route
 * goes on by: index), from (the arm it comes by)}.
 */
export function junctionsOn(P, ways, places = [], { tol = 15 } = {}) {
  if (!P?.d?.length || !ways?.length) return [];
  const nodes = nodesOf(ways), out = [];
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (let i = 0; i < P.d.length; i++) { x0 = Math.min(x0, P.x[i]); x1 = Math.max(x1, P.x[i]); y0 = Math.min(y0, P.y[i]); y1 = Math.max(y1, P.y[i]); }
  for (const nd of nodes.values()) {
    if (nd.ends.length < 3 || nd.x < x0 - tol || nd.x > x1 + tol || nd.y < y0 - tol || nd.y > y1 + tol) continue;
    const q = nearestOn(P, nd.x, nd.y);
    if (q.dist > tol) continue;
    out.push({ d: q.d, x: nd.x, y: nd.y, node: nd });
  }
  out.sort((a, b) => a.d - b.d);
  const merged = [];
  for (const j of out) if (!merged.length || j.d - merged[merged.length - 1].d > 25) merged.push(j);
  const D = P.d[P.d.length - 1];
  return merged.map((j) => {
    const arms = armsOf(j.node, ways, nodes, places);
    const near = (pt) => { let bi = -1, bd = Infinity; arms.forEach((a, i) => { const dd = segDist(a.pts, pt); if (dd < bd) { bd = dd; bi = i; } }); return bd < 30 ? bi : -1; };
    const mine = j.d < D - 20 ? near(pointAt(P, Math.min(D, j.d + 45))) : -1, from = j.d > 20 ? near(pointAt(P, Math.max(0, j.d - 45))) : -1;
    const name = places.filter((p) => Math.hypot(p.x - j.x, p.y - j.y) < 120).sort((a, b) => Math.hypot(a.x - j.x, a.y - j.y) - Math.hypot(b.x - j.x, b.y - j.y))[0]?.n || null;
    return { d: j.d, x: j.x, y: j.y, name, arms, mine, from: from === mine ? -1 : from };
  });
}

/** The turn at d along the route: the way in (the 30 m before) to the way out (the 45 m after). -> {deg (+ right), word} */
export function turnAt(P, d) {
  const D = P.d[P.d.length - 1], a = pointAt(P, Math.max(0, d - 30)), b = pointAt(P, d), c = pointAt(P, Math.min(D, d + 45));
  const deg = wrap180(bearingXY(c[0] - b[0], c[1] - b[1]) - bearingXY(b[0] - a[0], b[1] - a[1]));
  const side = deg < 0 ? "w lewo" : "w prawo", m = Math.abs(deg);
  return { deg, word: m < 30 ? "prosto" : m < 120 ? side : `ostro ${side}` };
}

/** How far zoomed in on a junction: 0 (the whole route) .. 1 (the junction filling the circle). toNext: m to the
 * next junction ahead (null: none); sincePrev: m since the last one passed. */
export function zoomIn(toNext, sincePrev) {
  const s = (k) => k * k * (3 - 2 * k);
  const a = toNext == null ? 0 : Math.max(0, Math.min(1, (160 - toNext) / 100));
  const b = sincePrev == null ? 0 : Math.max(0, Math.min(1, 1 - (sincePrev - 20) / 50));
  return s(Math.max(a, b));
}

export const slopeClassOf = (pct) => Math.max(0, SLOPES.findIndex(([m]) => Math.abs(pct) < m));

/**
 * The climb ahead from d: the steepest point up (P.slope) and the unbroken stretch round it as steep as its
 * class's floor (25 % or 15 %). -> {max, from (m from you to its start), to (to its end), len, avg (%), now (you are on it)} | null (nothing over 8 %)
 */
export function climbAhead(P, d) {
  const n = P.d.length;
  let i0 = 0;
  while (i0 < n - 1 && P.d[i0] < d) i0++;
  let k = -1;
  for (let i = i0; i < n; i++) if (Number.isFinite(P.slope?.[i]) && (k < 0 || P.slope[i] > P.slope[k])) k = i;
  if (k < 0 || P.slope[k] < 8) return null;
  const max = P.slope[k], band = max >= 25 ? 25 : max >= 15 ? 15 : 8;
  let i = k, j = k;
  while (i > i0 && P.slope[i - 1] >= band) i--;
  while (j < n - 1 && P.slope[j + 1] >= band) j++;
  const len = P.d[j] - P.d[i], avg = len > 0 && Number.isFinite(P.h[j]) && Number.isFinite(P.h[i]) ? (100 * (P.h[j] - P.h[i])) / len : max;
  return { max, from: Math.max(0, P.d[i] - d), to: Math.max(0, P.d[j] - d), len, avg, now: P.d[i] <= d + 5 };
}
