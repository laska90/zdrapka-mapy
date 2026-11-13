// Route planning on the pack's network: waypoints snapped to the nearest way, legs found
// with A* under a cost that prefers marked trails without giving up short cuts, and options
// (fastest, most interesting, not walked yet, no steep descents, no roads). A leg never
// comes out much longer than the shortest way between its ends.

import { stdMs } from "./pace.js";

/** Cost factor per way category [marked trail, path / track, road] for each mode. */
export const MODES = {
  zalecana: { label: "Zalecana", desc: "Szlakami turystycznymi, ale bez nadkładania drogi: krótkie skróty ścieżką są w porządku.", cat: [1, 1.2, 1.45] },
  najszybsza: { label: "Najszybsza", desc: "Najkrótszy czas marszu (z podejściami), także ścieżkami i drogami.", cat: [1, 1, 1], time: true }, // walking time (Tobler, uphill and down), any way
  ciekawa: { label: "Szlakami", desc: "Trzyma się znakowanych szlaków, nawet jeśli wyjdzie trochę dłużej.", cat: [1, 1.45, 2.2] },
  nieznana: { label: "Nowe", desc: "Woli szlaki, których jeszcze nie przeszedłeś (do zdrapania).", cat: [1, 1.2, 1.5], fresh: 2 }, // where you have not walked
};
/** Big roads are walked only when there is nothing else (except in the fastest mode, a little). */
const ROAD = { tertiary: 1.25, tertiary_link: 1.25, secondary: 1.6, secondary_link: 1.6, primary: 2.5, primary_link: 2.5, trunk: 3, trunk_link: 3 };
const MAX_DETOUR = 1.45; // a leg at most this much longer than the shortest one
/** Walking time on hard ground (OSM: sac_scale T1..T6, via ferrata, rock and scree), by difficulty 0..4. */
export const DFK = [1, 1.08, 1.22, 1.5, 1.85];
const STEEP = 0.12; // descents steeper than this cost more ("no steep descents"): -20 % costs 1.8x

class Heap {
  constructor() { this.a = []; }
  get size() { return this.a.length; }
  push(c, v) { const a = this.a; a.push([c, v]); let i = a.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (a[p][0] <= a[i][0]) break; [a[p], a[i]] = [a[i], a[p]]; i = p; } }
  pop() {
    const a = this.a, top = a[0], last = a.pop();
    if (a.length) { a[0] = last; let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < a.length && a[l][0] < a[m][0]) m = l; if (r < a.length && a[r][0] < a[m][0]) m = r; if (m === i) break; [a[m], a[i]] = [a[i], a[m]]; i = m; } }
    return top;
  }
}

export class Router {
  /**
   * net: a merged network {n, lines: [Polyline], cat, hw, cols, sn, en, len, keys}
   * walked: Set of segment keys walked; height(x, y) -> metres or null (needed by the fastest
   * mode and "no steep descents"); wall: per way, the extra metres its steep unmarked stretches cost
   * (core/slope.js wallCost: a straight shortcut up a summit loses to the trail's gentler loop)
   */
  constructor(net, { walked = new Set(), height = null, wall = null } = {}) {
    this.net = net; this.walked = walked; this.height = height; this.wall = wall;
    this.adj = new Map();
    const add = (v, k) => { let a = this.adj.get(v); if (!a) this.adj.set(v, (a = [])); a.push(k); };
    this.box = new Float64Array(net.n * 4);
    for (let k = 0; k < net.n; k++) {
      add(net.sn[k], k); add(net.en[k], k);
      const { xs, ys } = net.lines[k];
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (let i = 0; i < xs.length; i++) { if (xs[i] < x0) x0 = xs[i]; if (xs[i] > x1) x1 = xs[i]; if (ys[i] < y0) y0 = ys[i]; if (ys[i] > y1) y1 = ys[i]; }
      this.box.set([x0, y0, x1, y1], k * 4);
    }
    this.nodeH = new Map();
    // connected parts of the network (a footway round a building is a world of its own): points snap
    // to a part that goes somewhere, and the second point of a leg to the first one's part
    const up = new Map(), find = (v) => { let r = v; while (up.has(r) && up.get(r) !== r) r = up.get(r); while (v !== r) { const n = up.get(v); up.set(v, r); v = n; } return r; };
    for (let k = 0; k < net.n; k++) { const a = find(net.sn[k]), b = find(net.en[k]); if (a !== b) up.set(a, b); else if (!up.has(a)) up.set(a, a); }
    this.comp = new Float64Array(net.n); this.compLen = new Map();
    for (let k = 0; k < net.n; k++) { const c = find(net.sn[k]); this.comp[k] = c; this.compLen.set(c, (this.compLen.get(c) || 0) + (net.len[k] || 0)); }
  }

  /** The nearest point of a way: {k, s (m along it), d (m away), x, y} or null beyond maxD.
   * On a part of the network that goes somewhere (over 3 km of ways), or on part `prefer`, if there is one in reach. */
  snap(x, y, maxD = 500, prefer = null) {
    const ok = (k) => (prefer != null ? this.comp[k] === prefer : this.compLen.get(this.comp[k]) >= 3000);
    return this.nearest(x, y, maxD, ok) || this.nearest(x, y, maxD, null);
  }
  nearest(x, y, maxD, ok) {
    let best = null;
    for (let k = 0; k < this.net.n; k++) {
      const b = k * 4;
      if (ok && !ok(k)) continue;
      if (x < this.box[b] - maxD || x > this.box[b + 2] + maxD || y < this.box[b + 1] - maxD || y > this.box[b + 3] + maxD) continue;
      const L = this.net.lines[k];
      for (let e = 0; e < L.xs.length - 1; e++) {
        const [d, s] = L.projectEdge(e, x, y);
        if (d <= maxD && (!best || d < best.d)) best = { k, s, d };
      }
    }
    if (best) [best.x, best.y] = this.net.lines[best.k].pointAt(best.s);
    return best;
  }

  /** Height of a node (an end of way k): cached. */
  hNode(k, end) {
    const v = end ? this.net.en[k] : this.net.sn[k];
    if (!this.nodeH.has(v)) {
      const L = this.net.lines[k], i = end ? L.xs.length - 1 : 0;
      this.nodeH.set(v, this.height ? this.height(L.xs[i], L.ys[i]) : null);
    }
    return this.nodeH.get(v);
  }

  /** Cost of going along way k for m metres, forwards (start -> end) or back. */
  costOf(k, m, fwd, o, soft = 1) {
    const net = this.net, cat = net.cat[k], M = o.mode;
    if (net.ow?.[k] && (net.ow[k] > 0) !== fwd) return Infinity; // one way only (Orla Perć)
    let f = M.cat[cat] ?? 1.5;
    if (cat === 2) f *= M.time ? (ROAD[net.hw[k]] > 2 ? 1.2 : 1) : ROAD[net.hw[k]] ?? 1;
    if (o.roads && cat === 2) f *= 2;
    if ((M.fresh || o.fresh) && this.walked.has(net.keys[k])) f *= M.fresh || 1.7;
    if (o.used?.has(net.keys[k])) f *= o.usedK || 3; // (a way this route already took: rather another one back)
    let g = null;
    if (M.time || o.steep) {
      const a = this.hNode(k, false), b = this.hNode(k, true);
      if (a != null && b != null && net.len[k] > 0) g = ((b - a) / net.len[k]) * (fwd ? 1 : -1);
    }
    if (o.steep && g != null && g < -STEEP) f *= 1 + 10 * (-g - STEEP);
    if (!M.time && cat !== 0 && this.wall?.[k]) f *= 1 + this.wall[k] / net.len[k]; // steep unmarked stretches (core/slope.js wallCost)
    const df = net.df?.[k] || 0; // hard ground: slower (fully when the time counts, a little otherwise)
    if (df) f *= M.time ? DFK[df] : 1 + (DFK[df] - 1) * 0.3;
    if (soft !== 1) f = f ** soft;
    return M.time ? (stdMs(m, g ?? 0) / 3.6e6) * 3600 * f : m * f;
  }

  /**
   * A leg from a to b (snapped points): {pieces: [[k, s0, s1]], length, cost} or null.
   * The cost model with the options; if the leg comes out much longer than the shortest way,
   * the preferences are softened (then dropped).
   */
  leg(a, b, o) {
    const short = this.astar(a, b, { mode: { cat: [1, 1, 1] } }, 1);
    if (!short) return null;
    for (const soft of [1, 0.5]) {
      const r = this.astar(a, b, o, soft);
      if (r && r.length <= short.length * MAX_DETOUR + 150) return r;
    }
    return short;
  }

  astar(a, b, o, soft) {
    const net = this.net, speed = o.mode.time ? 6 / 3.6 : 1; // the heuristic: straight on, at the best rate
    const hx = (x, y) => Math.hypot(x - b.x, y - b.y) / speed;
    const ends = (k, end) => { const L = net.lines[k], i = end ? L.xs.length - 1 : 0; return [L.xs[i], L.ys[i]]; };
    const dist = new Map(), prev = new Map(), open = new Heap(), GOAL = -1;
    const relax = (v, c, from, piece) => { if (c < (dist.get(v) ?? Infinity)) { dist.set(v, c); prev.set(v, { from, piece }); const [x, y] = v === GOAL ? [b.x, b.y] : nodeXY.get(v); open.push(c + (v === GOAL ? 0 : hx(x, y)), v); } };
    const nodeXY = new Map();
    const node = (k, end) => { const v = end ? net.en[k] : net.sn[k]; if (!nodeXY.has(v)) nodeXY.set(v, ends(k, end)); return v; };
    // from the start point along its way, both ways (and straight to the goal on the same way)
    const La = net.len[a.k] || net.lines[a.k].length;
    relax(node(a.k, false), this.costOf(a.k, a.s, false, o, soft), null, [a.k, a.s, 0]);
    relax(node(a.k, true), this.costOf(a.k, La - a.s, true, o, soft), null, [a.k, a.s, La]);
    if (a.k === b.k) relax(GOAL, this.costOf(a.k, Math.abs(b.s - a.s), b.s > a.s, o, soft), null, [a.k, a.s, b.s]);
    const Lb = net.len[b.k] || net.lines[b.k].length, bs = net.sn[b.k], be = net.en[b.k];
    const done = new Set();
    while (open.size) {
      const [, v] = open.pop();
      if (done.has(v)) continue;
      done.add(v);
      if (v === GOAL) break;
      const c = dist.get(v);
      if (v === bs) relax(GOAL, c + this.costOf(b.k, b.s, true, o, soft), v, [b.k, 0, b.s]);
      if (v === be) relax(GOAL, c + this.costOf(b.k, Lb - b.s, false, o, soft), v, [b.k, Lb, b.s]);
      for (const k of this.adj.get(v) || []) {
        const fwd = net.sn[k] === v, w = fwd ? net.en[k] : net.sn[k], L = net.len[k] || net.lines[k].length;
        if (w === v) continue; // a loop
        node(k, fwd);
        relax(w, c + this.costOf(k, L, fwd, o, soft), v, fwd ? [k, 0, L] : [k, L, 0]);
      }
    }
    if (!prev.has(GOAL)) return null;
    const pieces = [];
    for (let v = GOAL; v != null; ) { const p = prev.get(v); pieces.push(p.piece); v = p.from; }
    pieces.reverse();
    const length = pieces.reduce((s, [, s0, s1]) => s + Math.abs(s1 - s0), 0);
    return { pieces, length, cost: dist.get(GOAL) };
  }

  /** The leg as flat [x, y, ...] (pack metres). */
  line(pieces) {
    const out = [];
    for (const [k, s0, s1] of pieces) {
      const L = this.net.lines[k], pts = sub(L, Math.min(s0, s1), Math.max(s0, s1));
      if (s0 > s1) pts.reverse();
      for (const [x, y] of pts) if (!out.length || Math.hypot(out[out.length - 2] - x, out[out.length - 1] - y) > 0.5) out.push(x, y);
    }
    return out;
  }

  /**
   * The leg as runs of one kind of way: [{key, cols ("red,blue" in trail order, "" off the trails),
   * cat (0 trail, 1 path / track, 2 road), m, line: flat [x, y, ...]}] (consecutive pieces of the same kind joined).
   */
  runs(pieces) {
    const out = [];
    for (const pc of pieces) {
      const [k, s0, s1] = pc, c = this.net.cols[k];
      const cols = c?.length ? [...c].sort((a, b) => colRank(a) - colRank(b)).join(",") : "", cat = cols ? 0 : this.net.cat[k], key = `${cols}|${cat}`;
      const pts = this.line([pc]), m = Math.abs(s1 - s0), last = out[out.length - 1];
      if (last && last.key === key) {
        const L = last.line, skip = L.length >= 2 && Math.hypot(L[L.length - 2] - pts[0], L[L.length - 1] - pts[1]) < 0.5 ? 2 : 0;
        for (let i = skip; i < pts.length; i++) L.push(pts[i]);
        last.m += m;
      } else out.push({ key, cols, cat, m, line: pts });
    }
    return out;
  }

  /** Figures of a leg: km by kind of way, km of marked trails not walked yet, the trails walked (by distance). */
  stats(pieces) {
    const net = this.net, out = { m: 0, trail: 0, path: 0, road: 0, fresh: 0, cols: [], hard: 0, dfx: 0, surf: [] };
    for (const [k, s0, s1] of pieces) {
      const m = Math.abs(s1 - s0), cat = net.cat[k];
      { const g = groundOf(net.hw?.[k], net.df?.[k] || 0, net.gr?.[k] || 0), L = out.surf[out.surf.length - 1]; if (L && L[2] === g) L[1] = out.m + m; else out.surf.push([out.m, out.m + m, g]); }
      if (net.cols[k]?.length) out.cols.push([out.m, out.m + m, net.cols[k].join(",")]);
      out.m += m;
      const df = net.df?.[k] || 0;
      if (df) { out.dfx += m * (DFK[df] - 1); if (df >= 2) out.hard += m; }
      if (cat === 0) { out.trail += m; if (!this.walked.has(net.keys[k])) out.fresh += m; } else if (cat === 1) out.path += m; else out.road += m;
    }
    return out;
  }
}

/** What is underfoot on a way, as the profile shows it: "paved", "gravel" (a forest road), "earth" (a path),
 * "rock" (rocky, scree, a via ferrata, a hard scramble), "steps". From the pack's ground (OSM surface,
 * tracktype: src network/segment.py ground()), else the way's kind; hard ways (difficulty 2+) are rock. */
const GROUND = [null, "paved", "gravel", "earth", "rock", "steps"];
const PAVED = new Set(["motorway", "trunk", "primary", "secondary", "tertiary", "unclassified", "residential", "living_street", "pedestrian", "service", "primary_link", "secondary_link", "tertiary_link", "trunk_link", "road"]);
export function groundOf(hw, df = 0, gr = 0) {
  if (hw === "steps" || gr === 5) return "steps";
  if (df >= 2 || hw === "via_ferrata") return "rock";
  if (GROUND[gr]) return GROUND[gr];
  if (PAVED.has(hw)) return "paved";
  return "earth";
}

const ORDER = ["red", "blue", "green", "yellow", "black"];
const colRank = (c) => { const i = ORDER.indexOf(c); return i < 0 ? 9 : i; };

/** Steps of a description from runs placed along the route ({key, cols, cat, d0, d1}): runs shorter
 * than `min` metres join the step before (a few metres of path at a junction are not a step). */
export function describeRuns(runs, min = 250) {
  // off the trails, paths and roads make one step ("ścieżkami i drogami"), with the metres of each
  const kind = (r) => (r.cols ? r.key : r.cat === -1 ? "|-1" : r.cat === -2 ? "|lift" : "|off");
  const add = (st, r) => { st.d1 = r.d1; if (!r.cols) st.mc[r.cat] = (st.mc[r.cat] || 0) + (r.d1 - r.d0); };
  const out = [];
  for (const r of runs) {
    const last = out[out.length - 1];
    if (last && (last.key === kind(r) || r.d1 - r.d0 < min)) add(last, r);
    else { const st = { key: kind(r), cols: r.cols, cat: r.cols ? 0 : r.cat, d0: r.d0, d1: r.d0, mc: {} }; add(st, r); out.push(st); }
  }
  // a short first step joins the next one; neighbours of the same kind join
  if (out.length > 1 && out[0].d1 - out[0].d0 < min) { out[1].d0 = out[0].d0; out.shift(); }
  const merged = [];
  for (const st of out) {
    const l = merged[merged.length - 1];
    if (l && l.key === st.key) { l.d1 = st.d1; for (const [c, m] of Object.entries(st.mc)) l.mc[c] = (l.mc[c] || 0) + m; } else merged.push(st);
  }
  // off the trails: a path, a road, or both
  for (const st of merged) if (!st.cols && st.cat !== -1 && st.key !== "|lift") { const p = st.mc[1] || 0, rd = st.mc[2] || 0, t = p + rd || 1; st.cat = p / t > 0.75 ? 1 : rd / t > 0.75 ? 2 : 3; }
  for (const st of merged) delete st.mc;
  return merged;
}

/** The part of a polyline from s0 to s1 (s0 <= s1) as [[x, y]]. */
function sub(L, s0, s1) {
  const { xs, ys, cum } = L, out = [];
  out.push(L.pointAt(s0));
  for (let i = 0; i < xs.length; i++) if (cum[i] > s0 && cum[i] < s1) out.push([xs[i], ys[i]]);
  out.push(L.pointAt(s1));
  return out;
}
