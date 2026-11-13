// How steep the ways are, for the map's "Nachylenie" layer. As on paper: count the contours a way crosses.
// Each way's crossings with the 10 m contours give its height along it (piecewise linear between them);
// sampled every ~40 m, the grade of each stretch over its neighbours, the stretches of one band joined into
// runs. Up or down alike: the layer says "steep here". (Fast: a grid of the contours' segments, no rays.)

/** The bands: grade (%) from which a band starts; under the first one nothing is drawn. */
export const SLOPE_BANDS = [8, 15, 25, 35];
export const bandOf = (g) => { let b = 0; while (b < SLOPE_BANDS.length && g >= SLOPE_BANDS[b]) b++; return b; };

const CELL = 100;
/** The contours' segments by grid cell: lines [{e, xs, ys}] (any number of sets). */
export function contourIndex(sets) {
  const cells = new Map();
  for (const lines of sets) for (const L of lines) {
    const { xs, ys, e } = L;
    for (let i = 1; i < xs.length; i++) {
      const cx0 = Math.floor(Math.min(xs[i - 1], xs[i]) / CELL), cx1 = Math.floor(Math.max(xs[i - 1], xs[i]) / CELL);
      const cy0 = Math.floor(Math.min(ys[i - 1], ys[i]) / CELL), cy1 = Math.floor(Math.max(ys[i - 1], ys[i]) / CELL);
      for (let cx = cx0; cx <= cx1; cx++) for (let cy = cy0; cy <= cy1; cy++) {
        const key = cx * 100003 + cy;
        let a = cells.get(key); if (!a) cells.set(key, (a = []));
        a.push(xs[i - 1], ys[i - 1], xs[i], ys[i], e);
      }
    }
  }
  return cells;
}

/** Where the way (xs, ys) crosses the contours: [[s (metres along), level]], by s. */
function crossings(cells, xs, ys) {
  const out = [];
  let s0 = 0;
  for (let i = 1; i < xs.length; i++) {
    const ax = xs[i - 1], ay = ys[i - 1], bx = xs[i], by = ys[i], sx = bx - ax, sy = by - ay, sl = Math.hypot(sx, sy);
    const seen = new Set();
    const cx0 = Math.floor(Math.min(ax, bx) / CELL), cx1 = Math.floor(Math.max(ax, bx) / CELL), cy0 = Math.floor(Math.min(ay, by) / CELL), cy1 = Math.floor(Math.max(ay, by) / CELL);
    for (let cx = cx0; cx <= cx1; cx++) for (let cy = cy0; cy <= cy1; cy++) {
      const a = cells.get(cx * 100003 + cy); if (!a) continue;
      for (let j = 0; j < a.length; j += 5) {
        const px = a[j], py = a[j + 1], qx = a[j + 2] - px, qy = a[j + 3] - py, den = sx * qy - sy * qx;
        if (Math.abs(den) < 1e-9) continue;
        const t = ((px - ax) * qy - (py - ay) * qx) / den, u = ((px - ax) * sy - (py - ay) * sx) / den;
        if (t < 0 || t > 1 || u < 0 || u > 1) continue;
        const key = `${Math.round(t * 1e4)}|${a[j + 4]}`; // (a segment in two cells: once)
        if (seen.has(key)) continue; seen.add(key);
        out.push([s0 + t * sl, a[j + 4]]);
      }
    }
    s0 += sl;
  }
  return out.sort((p, q) => p[0] - q[0]);
}

/** A way's grades (%) every ~step metres: {n, d, g: [per stretch]} or null (flat as far as the contours tell). */
function gradesOf(cells, L, step) {
  const len = L.length;
  if (!(len > 5)) return null;
  const C = crossings(cells, L.xs, L.ys);
  if (C.length < 2) return null; // (no level changes along it)
  const n = Math.max(1, Math.round(len / step)), d = len / n, hs = [];
  let j = 0;
  for (let i = 0; i <= n; i++) { // the height at s: between the crossings around it
    const s = (len * i) / n;
    while (j < C.length - 1 && C[j + 1][0] < s) j++;
    if (s <= C[0][0]) hs.push(C[0][1]);
    else if (j >= C.length - 1) hs.push(C[C.length - 1][1]);
    else { const [s1, e1] = C[j], [s2, e2] = C[j + 1]; hs.push(s2 > s1 ? e1 + ((e2 - e1) * (s - s1)) / (s2 - s1) : e1); }
  }
  const g = [];
  for (let i = 0; i < n; i++) { const a = Math.max(0, i - 1), c = Math.min(n, i + 2); g.push((Math.abs(hs[c] - hs[a]) / ((c - a) * d)) * 100); } // (the stretch and one on each side)
  return { n, d, g };
}

/**
 * net: a decoded network (lines, n); cells: contourIndex(...).
 * -> [{b: 1..4, c: the way's category (0 trail, 1 path, 2 road), line: [x, y, ...]}] (pack metres), only band 1 and up.
 */
export function slopeRuns(net, cells, { step = 40, only = null } = {}) {
  const out = [];
  for (let k = 0; k < net.n; k++) {
    if (only && !only(k)) continue;
    const L = net.lines[k], G = gradesOf(cells, L, step);
    if (!G) continue;
    const { n, d } = G;
    let run = null;
    for (let i = 0; i < n; i++) {
      const b = bandOf(G.g[i]);
      const [x0, y0] = L.pointAt(i * d), [x1, y1] = L.pointAt((i + 1) * d);
      if (run && run.b === b) { run.line.push(x1, y1); continue; }
      if (run && run.b) out.push(run);
      run = { b, c: net.cat?.[k] ?? 1, line: [x0, y0, x1, y1] };
    }
    if (run && run.b) out.push(run);
  }
  return out;
}

/** Unmarked ways steeper than this (%), up or down, cost more to the router: 40 % costs 5x, at most 8x. */
export const WALL = 20, WALLK = 0.2;
/**
 * For the router: per way, the extra metres its steep stretches cost (marked trails: none: a trail
 * goes where it goes). Float32Array by way.
 */
export function wallCost(net, cells, { step = 40 } = {}) {
  const out = new Float32Array(net.n);
  for (let k = 0; k < net.n; k++) {
    if (net.cat[k] === 0) continue;
    const G = gradesOf(cells, net.lines[k], step);
    if (!G) continue;
    let x = 0;
    for (const g of G.g) if (g > WALL) x += G.d * (Math.min(8, 1 + WALLK * (g - WALL)) - 1);
    out[k] = x;
  }
  return out;
}
