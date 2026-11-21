// Replay 3D's reckoning (app/replay.js films it): the outing's figures along it — the climbing and the descending
// so far (a 4 m hysteresis, as a watch counts, not every grid wobble), the highest point so far, the pace — and
// the camera's moves: the overview of the whole outing it starts from, the bearing it follows (a look 250 m
// ahead, drawn towards a place to be reached soon), its tilt (lower where the way ahead climbs steeply: the
// slope in front, not the camera in it), the moments at the places reached (a slow turn round them), the end's
// slow circle. Pure, so tested on their own.

import { bearingXY, wrap180, pointAt } from "./navradar.js";

/** Along the profile P ({d, h, t?}): {up[i], down[i], max[i]} so far (m), and the pace at i (km/h from the watch's times, ±150 m; null without). */
export function figures(P, step = 4) {
  const n = P.d.length, up = new Float64Array(n), down = new Float64Array(n), max = new Float64Array(n), pace = new Array(n).fill(null);
  let ref = null, u = 0, dn = 0, hi = -Infinity;
  for (let i = 0; i < n; i++) {
    const h = P.h[i];
    if (Number.isFinite(h)) {
      if (ref == null) ref = h;
      else if (h - ref >= step) { u += h - ref; ref = h; } else if (ref - h >= step) { dn += ref - h; ref = h; }
      hi = Math.max(hi, h);
    }
    up[i] = u; down[i] = dn; max[i] = Number.isFinite(hi) ? hi : NaN;
  }
  if (Number.isFinite(P.t?.[0])) {
    let a = 0, b = 0;
    for (let i = 0; i < n; i++) {
      while (a < i && P.d[i] - P.d[a] > 150) a++;
      while (b < n - 1 && P.d[b] - P.d[i] < 150) b++;
      const dt = P.t[b] - P.t[a], dd = P.d[b] - P.d[a];
      pace[i] = Number.isFinite(dt) && dt > 0 ? (dd / (dt / 1000)) * 3.6 : null;
    }
  }
  return { up, down, max, pace };
}

/** Index of the last sample at or before d. */
export function idxAt(P, d) {
  let lo = 0, hi = P.d.length - 1;
  if (d >= P.d[hi]) return hi;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (P.d[m] <= d) lo = m; else hi = m; }
  return lo;
}

/** The watch's time at d (ms), or, without one, a walk of start + 4 km/h (the light still turns with the day). */
export function timeAlong(P, d, start) {
  const i = idxAt(P, d), j = Math.min(P.d.length - 1, i + 1), a = P.t?.[i], b = P.t?.[j];
  if (Number.isFinite(a) && Number.isFinite(b) && P.d[j] > P.d[i]) return a + ((d - P.d[i]) / (P.d[j] - P.d[i])) * (b - a);
  if (Number.isFinite(a)) return a;
  return start + (d / 1000 / 4) * 3600000;
}

/**
 * Where the camera wants to look while following, at d: the bearing to a point 250 m on (drawn up to 60 % towards
 * a place reached within the next 400 m: it comes into the picture), and the tilt (58°, down to 46° where the way
 * ahead climbs more than 12 %). places: [{d, x, y}] (pack metres).
 */
export function followAim(P, d, places = []) {
  const D = P.d[P.d.length - 1], here = pointAt(P, d), on = pointAt(P, Math.min(D, d + 250));
  let b = Math.hypot(on[0] - here[0], on[1] - here[1]) > 20 ? bearingXY(on[0] - here[0], on[1] - here[1]) : null;
  const next = places.find((p) => p.d > d + 30 && p.d < d + 400);
  if (b != null && next && Math.hypot(next.x - here[0], next.y - here[1]) > 40) {
    const w = 0.6 * (1 - (next.d - d) / 400);
    b = (b + wrap180(bearingXY(next.x - here[0], next.y - here[1]) - b) * w + 360) % 360;
  }
  const i = idxAt(P, d), j = idxAt(P, Math.min(D, d + 300)), dh = P.h[j] - P.h[i], dd = P.d[j] - P.d[i];
  const climb = Number.isFinite(dh) && dd > 50 ? (100 * dh) / dd : 0;
  const pitch = 58 - Math.max(0, Math.min(12, climb - 12));
  return { bearing: b, pitch, climb, ahead: b != null ? bearingXY(on[0] - here[0], on[1] - here[1]) : null };
}

/** How far to swing the camera to the side on a climb (0: behind the walker .. 1: side on): from 16 % up to 26 %. */
export const sideOf = (climb) => Math.max(0, Math.min(1, (climb - 16) / 10));

/**
 * The heights the route crosses, every `step` m (100 m; 50 m where it spans less than 400 m, 10 m under 100 m): [{d, h}] —
 * flags along it, where they crowd the way is steep.
 */
export function heightFlags(P, step = null) {
  let lo = Infinity, hi = -Infinity;
  for (const h of P.h) if (Number.isFinite(h)) { lo = Math.min(lo, h); hi = Math.max(hi, h); }
  const st = step ?? (hi - lo < 100 ? 10 : hi - lo < 400 ? 50 : 100), out = [];
  // (a height flagged is flagged again only once the route went half a step away from it: a wobble round it is not
  // crossing it again)
  const away = new Map();
  for (let i = 1; i < P.d.length; i++) {
    const a = P.h[i - 1], b = P.h[i];
    if (!Number.isFinite(a) || !Number.isFinite(b)) continue;
    for (const [v, far] of away) if (!far && Math.abs(b - v) >= st / 2) away.set(v, true);
    if (a === b) continue;
    for (let v = Math.ceil(Math.min(a, b) / st) * st; v <= Math.max(a, b); v += st) {
      if (v === a || away.get(v) === false) continue;
      out.push({ d: P.d[i - 1] + ((v - a) / (b - a)) * (P.d[i] - P.d[i - 1]), h: v });
      away.set(v, false);
    }
  }
  return out.sort((p, q) => p.d - q.d);
}

/** An angle eased towards another by k (0..1), the short way round. */
export const easeAngle = (a, b, k) => (a + wrap180(b - a) * k + 360) % 360;
/** Smooth start and stop, 0..1. */
export const ease = (t) => { const x = Math.max(0, Math.min(1, t)); return x * x * (3 - 2 * x); };

/**
 * The summit worth looking at from here, going on bearing: of the named peaks [{n, e, x, y}] 0.7–6 km off and
 * within 65° of the way, the highest (a nearer one counts a little higher); the one looked at so far (cur) kept
 * while it is still there and not 80 m worse (no turning from one to the next and back). null: none.
 */
export function peakAim(here, bearing, peaks, cur = null) {
  let best = null, bs = -Infinity, cs = -Infinity;
  for (const p of peaks) {
    const dx = p.x - here[0], dy = p.y - here[1], dist = Math.hypot(dx, dy);
    if (dist < 700 || dist > 6000 || !Number.isFinite(p.e)) continue;
    if (Math.abs(wrap180(bearingXY(dx, dy) - bearing)) > 65) continue;
    const sc = p.e + 250 * (1 - dist / 6000);
    if (sc > bs) { bs = sc; best = p; }
    if (cur && p.n === cur.n) cs = sc;
  }
  return cur && cs > bs - 80 ? peaks.find((p) => p.n === cur.n) : best;
}
