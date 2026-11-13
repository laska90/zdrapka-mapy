// Planar geometry in pack metres: polylines with linear referencing, grid index,
// interval helpers. Port of src/scratchcard/match/geometry.py.

export function decodeLine(flat, scale = 1) {
  const n = flat.length >> 1, xs = new Float64Array(n), ys = new Float64Array(n);
  let x = 0, y = 0;
  for (let i = 0; i < n; i++) {
    if (i === 0) { x = flat[0]; y = flat[1]; } else { x += flat[2 * i]; y += flat[2 * i + 1]; }
    xs[i] = x / scale; ys[i] = y / scale;
  }
  return [xs, ys];
}

export class Polyline {
  constructor(xs, ys) {
    this.xs = xs; this.ys = ys;
    const cum = new Float64Array(xs.length);
    for (let i = 1; i < xs.length; i++) cum[i] = cum[i - 1] + Math.hypot(xs[i] - xs[i - 1], ys[i] - ys[i - 1]);
    this.cum = cum;
  }
  get length() { return this.cum[this.cum.length - 1]; }
  pointAt(s) {
    const { xs, ys, cum } = this, n = xs.length;
    for (let e = 0; e < n - 1; e++) {
      if (cum[e + 1] >= s || e === n - 2) {
        const seg = cum[e + 1] - cum[e];
        const t = seg === 0 ? 0 : Math.min(1, Math.max(0, (s - cum[e]) / seg));
        return [xs[e] + t * (xs[e + 1] - xs[e]), ys[e] + t * (ys[e + 1] - ys[e])];
      }
    }
    return [xs[0], ys[0]];
  }
  /** [distance, s] from point to edge e */
  projectEdge(e, px, py) {
    const x1 = this.xs[e], y1 = this.ys[e], dx = this.xs[e + 1] - x1, dy = this.ys[e + 1] - y1;
    const l2 = dx * dx + dy * dy;
    const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / l2));
    const fx = x1 + t * dx, fy = y1 + t * dy;
    return [Math.hypot(px - fx, py - fy), this.cum[e] + t * (this.cum[e + 1] - this.cum[e])];
  }
  distanceTo(px, py) {
    let best = Infinity;
    for (let e = 0; e < this.xs.length - 1; e++) best = Math.min(best, this.projectEdge(e, px, py)[0]);
    return best;
  }
}

const key = (cx, cy) => (cx + 1_000_000) * 2_000_003 + (cy + 1_000_000);

/** Uniform grid over polyline edges, padded by the search radius. */
export class GridIndex {
  constructor(lines, radius, cell = 64, filter = null) {
    this.lines = lines; this.cell = cell; this.cells = new Map();
    for (let k = 0; k < lines.length; k++) {
      if (filter && !filter(k)) continue;
      const { xs, ys } = lines[k];
      for (let e = 0; e < xs.length - 1; e++) {
        const x0 = Math.floor((Math.min(xs[e], xs[e + 1]) - radius) / cell), x1 = Math.floor((Math.max(xs[e], xs[e + 1]) + radius) / cell);
        const y0 = Math.floor((Math.min(ys[e], ys[e + 1]) - radius) / cell), y1 = Math.floor((Math.max(ys[e], ys[e + 1]) + radius) / cell);
        for (let cx = x0; cx <= x1; cx++) for (let cy = y0; cy <= y1; cy++) {
          const kk = key(cx, cy);
          let arr = this.cells.get(kk);
          if (!arr) this.cells.set(kk, (arr = []));
          arr.push(k, e);
        }
      }
    }
  }
  /** Map line index -> [distance, s] for every line within radius. */
  nearestPerLine(px, py, radius) {
    const out = new Map();
    const arr = this.cells.get(key(Math.floor(px / this.cell), Math.floor(py / this.cell)));
    if (!arr) return out;
    for (let i = 0; i < arr.length; i += 2) {
      const k = arr[i], [d, s] = this.lines[k].projectEdge(arr[i + 1], px, py);
      if (d <= radius) { const cur = out.get(k); if (!cur || d < cur[0]) out.set(k, [d, s]); }
    }
    return out;
  }
}

export function mergeIntervals(intervals, gap = 0) {
  const out = [];
  for (const [lo, hi] of [...intervals].sort((a, b) => a[0] - b[0] || a[1] - b[1])) {
    if (out.length && lo <= out[out.length - 1][1] + gap) out[out.length - 1][1] = Math.max(out[out.length - 1][1], hi);
    else out.push([lo, hi]);
  }
  return out;
}

/** Part of a polyline between length fractions f0 < f1, as [[x, y], ...]. */
export function substring(line, f0, f1) {
  const { xs, ys, cum } = line, total = line.length, n = xs.length;
  if (f0 <= 0 && f1 >= 1) return Array.from(xs, (x, i) => [x, ys[i]]);
  if (total === 0) return [[xs[0], ys[0]], [xs[n - 1], ys[n - 1]]];
  const a = f0 * total, b = f1 * total;
  const out = [line.pointAt(a)];
  for (let i = 0; i < n; i++) if (cum[i] > a && cum[i] < b) out.push([xs[i], ys[i]]);
  out.push(line.pointAt(b));
  return out;
}

/** The box round flat [x, y, ...] lines: [x0, y0, x1, y1]. */
export function boxOf(parts) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of parts) for (let i = 0; i < p.length; i += 2) { x0 = Math.min(x0, p[i]); x1 = Math.max(x1, p[i]); y0 = Math.min(y0, p[i + 1]); y1 = Math.max(y1, p[i + 1]); }
  return [x0, y0, x1, y1];
}
