// A town's or a village's built-up area from the map's residential patches. OSM draws a town as
// many patches (every block between two streets on its own, parks and works left out), so the
// patches are put on a grid, the gaps between them closed (a road, a stream, a small park), the
// piece at the name kept, its holes filled and its edge traced: one outline, as a person sees it.

/**
 * @param {{xs: ArrayLike<number>, ys: ArrayLike<number>}[]} rings residential patches (pack metres)
 * @param {number} x the place's name (pack metres)
 * @param {number} y
 * @param {{reach?: number, close?: number, seed?: number}} [o] reach: how far from the name the
 *   area may go; close: gaps up to twice this are closed; seed: the area must start this near the name
 * @returns {{xs: number[], ys: number[], b: number[]} | null} the outline, or null (nothing at the name)
 */
export function builtUp(rings, x, y, o = {}) {
  const reach = o.reach ?? 1500, close = o.close ?? 60, seedR = o.seed ?? 80;
  const cell = Math.max(15, Math.round(reach / 180)), r = Math.max(1, Math.round(close / cell));
  const pad = r + 2, n = Math.ceil((2 * reach) / cell) + 2 * pad;
  const x0 = x - reach - pad * cell, y0 = y - reach - pad * cell;
  let m = new Uint8Array(n * n);
  // the patches on the grid (a cell is in when its centre is)
  for (const R of rings) {
    const { xs, ys } = R, k = xs.length;
    let a = Infinity, b = -Infinity, c = Infinity, d = -Infinity;
    for (let i = 0; i < k; i++) { if (xs[i] < a) a = xs[i]; if (xs[i] > b) b = xs[i]; if (ys[i] < c) c = ys[i]; if (ys[i] > d) d = ys[i]; }
    const j0 = Math.max(0, Math.floor((c - y0) / cell)), j1 = Math.min(n - 1, Math.floor((d - y0) / cell));
    if (b < x0 || a > x0 + n * cell || j0 > j1) continue;
    const cut = [];
    for (let j = j0; j <= j1; j++) {
      const cy = y0 + (j + 0.5) * cell;
      cut.length = 0;
      for (let i = 0, p = k - 1; i < k; p = i++) if (ys[i] > cy !== ys[p] > cy) cut.push(xs[i] + ((cy - ys[i]) * (xs[p] - xs[i])) / (ys[p] - ys[i]));
      cut.sort((u, v) => u - v);
      for (let q = 0; q + 1 < cut.length; q += 2) {
        const i0 = Math.max(0, Math.ceil((cut[q] - x0) / cell - 0.5)), i1 = Math.min(n - 1, Math.floor((cut[q + 1] - x0) / cell - 0.5));
        for (let i = i0; i <= i1; i++) m[j * n + i] = 1;
      }
    }
  }
  // closing: grown by r, then shrunk by r (a round brush: the gaps go, the corners stay)
  m = morph(morph(m, n, r, true), n, r, false);
  // the piece at the name: its cell, else the nearest one within seedR
  const ci = Math.floor((x - x0) / cell), cj = Math.floor((y - y0) / cell), sr = Math.ceil(seedR / cell);
  let seed = -1, best = Infinity;
  for (let j = cj - sr; j <= cj + sr; j++) for (let i = ci - sr; i <= ci + sr; i++) {
    if (i < 0 || j < 0 || i >= n || j >= n || !m[j * n + i]) continue;
    const dd = (i - ci) ** 2 + (j - cj) ** 2;
    if (dd <= sr * sr && dd < best) { best = dd; seed = j * n + i; }
  }
  if (seed < 0) return null;
  const comp = new Uint8Array(n * n);
  flood(m, comp, n, [seed], 1);
  // holes filled: whatever the outside can't reach is inside
  const out = new Uint8Array(n * n), edge = [];
  for (let i = 0; i < n; i++) edge.push(i, (n - 1) * n + i, i * n, i * n + n - 1);
  flood(comp, out, n, edge.filter((p) => !comp[p]), 0);
  for (let p = 0; p < n * n; p++) comp[p] = out[p] ? 0 : 1;
  const ring = trace(comp, n);
  if (!ring) return null;
  // grid corners to metres, the stairs smoothed
  let pts = ring.map(([i, j]) => [x0 + i * cell, y0 + j * cell]);
  pts = thin(chaikin(chaikin(straight(pts))), cell / 4);
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  return { xs, ys, b: [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)] };
}

/** Grow (or shrink) the cells by a disc of r cells. */
function morph(m, n, r, grow) {
  const o = new Uint8Array(n * n), off = [];
  for (let dj = -r; dj <= r; dj++) for (let di = -r; di <= r; di++) if (di * di + dj * dj <= r * r + r) off.push(di, dj);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    let v = grow ? 0 : 1;
    for (let q = 0; q < off.length; q += 2) {
      const a = i + off[q], b = j + off[q + 1];
      const s = a < 0 || b < 0 || a >= n || b >= n ? (grow ? 0 : 1) : m[b * n + a];
      if (grow ? s : !s) { v = grow ? 1 : 0; break; }
    }
    o[j * n + i] = v;
  }
  return o;
}

/** Mark in `seen` the cells joined to the starts (4 ways) that have the value `want` in m. */
function flood(m, seen, n, starts, want) {
  const st = [];
  for (const p of starts) if (!seen[p] && m[p] === want) { seen[p] = 1; st.push(p); }
  while (st.length) {
    const p = st.pop(), i = p % n, j = (p - i) / n;
    for (const [a, b] of [[i + 1, j], [i - 1, j], [i, j + 1], [i, j - 1]]) {
      if (a < 0 || b < 0 || a >= n || b >= n) continue;
      const q = b * n + a;
      if (!seen[q] && m[q] === want) { seen[q] = 1; st.push(q); }
    }
  }
}

/** The outer edge of one 4-connected, hole-free piece: grid corners [i, j] (the longest loop). */
function trace(m, n) {
  const at = (i, j) => i >= 0 && j >= 0 && i < n && j < n && m[j * n + i] === 1;
  const next = new Map(); // corner -> corners an edge goes to (inside on the left)
  const add = (a, b, c, d) => { const k = a * 100003 + b; (next.get(k) || next.set(k, []).get(k)).push([c, d]); };
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    if (!at(i, j)) continue;
    if (!at(i, j - 1)) add(i + 1, j, i, j);
    if (!at(i, j + 1)) add(i, j + 1, i + 1, j + 1);
    if (!at(i - 1, j)) add(i, j, i, j + 1);
    if (!at(i + 1, j)) add(i + 1, j + 1, i + 1, j);
  }
  let bestRing = null;
  for (const [k0, list] of next) {
    while (list.length) {
      const ring = [];
      let a = Math.floor(k0 / 100003), b = k0 % 100003, [c, d] = list.pop();
      ring.push([a, b]);
      for (let guard = 0; guard < 1e6 && !(c * 100003 + d === k0); guard++) {
        ring.push([c, d]);
        const l = next.get(c * 100003 + d);
        if (!l?.length) break;
        [a, b] = [c, d];
        [c, d] = l.pop();
      }
      if (!bestRing || ring.length > bestRing.length) bestRing = ring;
    }
  }
  return bestRing && bestRing.length >= 4 ? bestRing : null;
}

/** Only the corners where the edge turns. */
function straight(p) {
  const out = [];
  for (let i = 0; i < p.length; i++) {
    const a = p[(i + p.length - 1) % p.length], b = p[i], c = p[(i + 1) % p.length];
    if ((b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]) !== 0) out.push(b);
  }
  return out;
}
/** Corners cut (a closed ring): the stairs of the grid become a soft line. */
function chaikin(p) {
  const out = [];
  for (let i = 0; i < p.length; i++) {
    const a = p[i], b = p[(i + 1) % p.length];
    out.push([0.75 * a[0] + 0.25 * b[0], 0.75 * a[1] + 0.25 * b[1]], [0.25 * a[0] + 0.75 * b[0], 0.25 * a[1] + 0.75 * b[1]]);
  }
  return out;
}

/** Points dropped where the line stays within tol of the shortcut (Douglas-Peucker, a closed ring). */
function thin(p, tol) {
  if (p.length < 8) return p;
  const keep = new Uint8Array(p.length), half = p.length >> 1;
  keep[0] = keep[half] = 1;
  const go = (a, b) => {
    const st = [[a, b]];
    while (st.length) {
      const [i, j] = st.pop(), [ax, ay] = p[i], [bx, by] = p[j % p.length], dx = bx - ax, dy = by - ay, L = Math.hypot(dx, dy) || 1;
      let w = -1, wd = tol;
      for (let k = i + 1; k < j; k++) { const d = Math.abs((p[k][0] - ax) * dy - (p[k][1] - ay) * dx) / L; if (d > wd) { wd = d; w = k; } }
      if (w > 0) { keep[w] = 1; st.push([i, w], [w, j]); }
    }
  };
  go(0, half); go(half, p.length);
  return p.filter((_, i) => keep[i]);
}
