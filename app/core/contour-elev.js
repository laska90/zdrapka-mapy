// Height of any point from the pack's contour lines (10 m, from the Copernicus
// 30 m DEM): no raw DEM is shipped, but between two neighbouring contours the
// height is close to linear in the distance to each.
//
// Rays go out from the point in RAYS directions; the first contour each one
// crosses bounds the point's "band". Two levels among those first crossings
// (lo and lo + step): interpolate by the nearest distance to each. One level
// only (a hilltop, a hollow, a flat): the next crossing on the rays says which
// way the ground goes, and the slope there is extrapolated, capped below the
// next level.

const RAYS = 24;

/** Contours of a terrain.json, decoded once: [{e, xs, ys, b: [x0, y0, x1, y1]}]. */
export function contourLines(terrain, decodeLine, scale = 10) {
  return (terrain?.contours || []).map(([, e, flat]) => {
    const [xs, ys] = decodeLine(flat, scale);
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (let i = 0; i < xs.length; i++) { const x = xs[i], y = ys[i]; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    return { e, xs, ys, b: [x0, y0, x1, y1] };
  });
}

/**
 * Height (m) at x, y from lines (any number of sets, e.g. neighbouring tiles),
 * or null if no contour is within R metres (a plain: no way to tell).
 * @returns {{h: number, kind: "band"|"top"|"hollow"} | null}
 */
export function heightAt(sets, x, y, { R = 700, step = 10 } = {}) {
  const dx = new Float64Array(RAYS), dy = new Float64Array(RAYS);
  for (let k = 0; k < RAYS; k++) { dx[k] = Math.cos((2 * Math.PI * k) / RAYS); dy[k] = Math.sin((2 * Math.PI * k) / RAYS); }
  // per ray: the two nearest crossings (distance, level)
  const t1 = new Float64Array(RAYS).fill(Infinity), e1 = new Float64Array(RAYS);
  const t2 = new Float64Array(RAYS).fill(Infinity), e2 = new Float64Array(RAYS);
  const add = (k, t, e) => {
    if (t < t1[k]) { t2[k] = t1[k]; e2[k] = e1[k]; t1[k] = t; e1[k] = e; }
    else if (t < t2[k]) { t2[k] = t; e2[k] = e; }
  };
  for (const lines of sets) for (const L of lines) {
    const b = L.b;
    if (b[0] > x + R || b[2] < x - R || b[1] > y + R || b[3] < y - R) continue;
    const { xs, ys, e } = L;
    for (let i = 1; i < xs.length; i++) {
      const ax = xs[i - 1] - x, ay = ys[i - 1] - y, bx = xs[i] - x, by = ys[i] - y;
      if ((ax > R && bx > R) || (ax < -R && bx < -R) || (ay > R && by > R) || (ay < -R && by < -R)) continue;
      const sx = bx - ax, sy = by - ay;
      for (let k = 0; k < RAYS; k++) {
        // p + t*d = a + u*s  ->  solve for t (along the ray) and u (along the segment)
        const den = dx[k] * sy - dy[k] * sx;
        if (Math.abs(den) < 1e-12) continue;
        const t = (ax * sy - ay * sx) / den, u = (ax * dy[k] - ay * dx[k]) / den;
        if (t >= 0 && t <= R && u >= 0 && u <= 1) add(k, t, e);
      }
    }
  }
  const near = new Map(); // level -> nearest first-crossing distance
  for (let k = 0; k < RAYS; k++) if (t1[k] < Infinity) near.set(e1[k], Math.min(near.get(e1[k]) ?? Infinity, t1[k]));
  if (!near.size) return null;
  const levels = [...near.keys()].sort((a, b) => near.get(a) - near.get(b));
  const a = levels[0], da = near.get(a);
  if (da < 0.5) return { h: a, kind: "band" };
  const b = levels.find((l) => Math.abs(l - a) === step) ?? levels.find((l) => l !== a);
  if (b != null) {
    const db = near.get(b);
    return { h: a + ((b - a) * da) / (da + db), kind: "band" };
  }
  // one level all around: up or down from it, and how steep just outside
  const ests = [];
  let up = 0, down = 0;
  for (let k = 0; k < RAYS; k++) {
    if (t1[k] === Infinity || t2[k] === Infinity || e2[k] === e1[k]) continue;
    const dir = Math.sign(a - e2[k]); // +1: the ground falls beyond the line, so the point is above it
    if (dir > 0) up++; else down++;
    ests.push([dir, t1[k] / Math.max(5, t2[k] - t1[k])]);
  }
  const dir = up >= down ? 1 : -1;
  const fr = ests.filter((q) => q[0] === dir).map((q) => q[1]).sort((p, q) => p - q);
  // the nearest edge is the most reliable: a low quantile of the extrapolations
  const f = fr.length ? fr[Math.floor(fr.length * 0.25)] : 0.5;
  return { h: a + dir * Math.min(0.9, f) * step, kind: dir > 0 ? "top" : "hollow" };
}
