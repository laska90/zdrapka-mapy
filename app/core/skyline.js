// The skyline in a picture, and how far the camera's heading and tilt are off: the line where the sky
// meets the ground found in the image, laid over the horizon the height grid gives (core/horizon.js);
// the shift that fits them best corrects the compass. Two ways to the picture's skyline: plain image
// arithmetic (alignHorizon, no model) or a sky mask from a segmentation model (skyFromMask + matchSky).

import { horizonAt, unproject } from "./horizon.js";

/**
 * The sky's lower edge in each column of an RGBA picture (w x h, small: ~200 px wide is plenty).
 * The sky is above, brighter and bluer than the ground and smooth; the line is the path across the
 * picture that best follows such an edge, without jumping (dynamic programming over the columns).
 * @returns {{y: Float32Array, conf: Float32Array}} the edge's row per column (NaN: none), its strength
 */
export function detectSkyline(rgba, w, h, { maxJump = Math.max(2, Math.round(h / 40)), jumpCost = 0.04, skipTop = 0 } = {}) {
  const L = new Float32Array(w * h), B = new Float32Array(w * h);
  for (let i = 0, q = 0; i < w * h; i++, q += 4) {
    const r = rgba[q], g = rgba[q + 1], b = rgba[q + 2];
    L[i] = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    B[i] = (b - r) / 255;
  }
  // texture: how busy the picture is at each pixel; the share of it above each row, per column
  const T = new Float32Array(w * h);
  for (let y = 1; y < h; y++) for (let x = 1; x < w; x++) {
    const i = y * w + x;
    T[i] = Math.abs(L[i] - L[i - 1]) + Math.abs(L[i] - L[i - w]);
  }
  const k = Math.max(1, Math.round(h / 60)); // (the edge measured over a few rows)
  const S = new Float32Array(w * h).fill(-1);
  for (let x = 0; x < w; x++) {
    let cumT = 0;
    for (let y = 0; y < h; y++) {
      const i = y * w + x;
      if (y >= skipTop) cumT += T[i];
      if (y < Math.max(k, skipTop) || y >= h - k) continue; // (skipTop: rows over the picture, e.g. a screenshot's buttons)
      let la = 0, lb = 0, ba = 0, bb = 0;
      for (let d = 1; d <= k; d++) { la += L[i - d * w]; lb += L[i + d * w]; ba += B[i - d * w]; bb += B[i + d * w]; }
      la /= k; lb /= k; ba /= k; bb /= k;
      const edge = Math.max(0, la - lb) + 0.6 * Math.max(0, ba - bb);
      const busyAbove = cumT / (y + 1 - Math.min(y, skipTop)); // (the sky above is smooth)
      S[i] = edge - 2.5 * busyAbove;
    }
  }
  // the best path: score of the edge minus a cost for each row it jumps between columns
  const acc = new Float32Array(w * h), from = new Int16Array(w * h);
  for (let y = 0; y < h; y++) acc[y * w] = S[y * w];
  for (let x = 1; x < w; x++) {
    for (let y = 0; y < h; y++) {
      let best = -Infinity, by = y;
      for (let d = -maxJump; d <= maxJump; d++) {
        const yy = y + d;
        if (yy < 0 || yy >= h) continue;
        const v = acc[yy * w + x - 1] - jumpCost * Math.abs(d);
        if (v > best) { best = v; by = yy; }
      }
      acc[y * w + x] = best + S[y * w + x];
      from[y * w + x] = by;
    }
  }
  let yEnd = 0;
  for (let y = 1; y < h; y++) if (acc[y * w + w - 1] > acc[yEnd * w + w - 1]) yEnd = y;
  const yOut = new Float32Array(w), conf = new Float32Array(w);
  for (let x = w - 1, y = yEnd; x >= 0; x--) {
    yOut[x] = y; conf[x] = Math.max(0, S[y * w + x]);
    if (x) y = from[y * w + x];
  }
  for (let x = 0; x < w; x++) if (conf[x] < 0.02) yOut[x] = NaN; // (no edge there: no say)
  return { y: yOut, conf };
}

const median = (a) => { const s = Float64Array.from(a).sort(); const n = s.length; return n ? (n & 1 ? s[n >> 1] : (s[n / 2 - 1] + s[n / 2]) / 2) : NaN; };

/**
 * How far the camera's heading and pitch are off: the shift of the grid's horizon that best lies on the
 * skyline found in the picture. sky: detectSkyline's result for a picture of the camera's frame scaled to
 * w x h; cam: the pose and field of view it was drawn with. Searches heading shifts within ±range degrees.
 * @returns {{dh, dp, err, share, sure}|null} dh, dp: degrees to add to the heading and the pitch; share: the
 * part of the skyline that lies on the horizon; err: its typical misfit (degrees); sure: the fit stands
 * out (no other shift nearly as good)
 */
export function matchHorizon(sky, w, h, pano, cam, { range = 15, step = 0.1 } = {}) {
  const c = { ...cam, width: w, height: h }, pts = [];
  for (let x = 0; x < w; x += 1) {
    const y = sky.y[x];
    if (!Number.isFinite(y)) continue;
    const d = unproject(x + 0.5, y + 0.5, c);
    if (d) pts.push(d);
  }
  if (pts.length < w * 0.3) return null;
  // Things near you (trees, the slope you stand on, a pole) stand above the far horizon, never below it: so
  // the fit is the shift that lays the most of the picture's skyline within `tol` of the grid's horizon
  // (the rest: in front of it), then its typical misfit among those.
  const n = Math.round((2 * range) / step) + 1, score = new Float32Array(n), dps = new Float32Array(n), errs = new Float32Array(n);
  const r = new Float64Array(pts.length), tol = 0.35;
  for (let s = 0; s < n; s++) {
    const dh = -range + s * step;
    for (let i = 0; i < pts.length; i++) r[i] = horizonAt(pano, pts[i].az + dh) - pts[i].el;
    r.sort();
    let best = 0, bi = 0;
    for (let i = 0, j = 0; i < r.length; i++) { while (r[i] - r[j] > 2 * tol) j++; if (i - j + 1 > best) { best = i - j + 1; bi = j; } }
    const win = r.subarray(bi, bi + best), dp = median(win);
    score[s] = best / pts.length; dps[s] = dp;
    errs[s] = median(Array.from(win, (v) => Math.abs(v - dp)));
  }
  let b = 0;
  for (let s = 1; s < n; s++) if (score[s] > score[b] || (score[s] === score[b] && errs[s] < errs[b])) b = s;
  // the next best fit away from this one: a fit that stands out is one to trust
  let b2 = 0;
  for (let s = 0; s < n; s++) if (Math.abs(s - b) * step > 2.5) b2 = Math.max(b2, score[s]);
  const err = errs[b], share = score[b];
  return { dh: -range + b * step, dp: dps[b], err, share, sure: share > 0.35 && share > 1.3 * b2 && b > 0 && b < n - 1 };
}

/**
 * The same correction found straight on the picture's edges, without picking one skyline first: the
 * grid's horizon is laid on the picture at each heading and pitch shift, and the shift whose line runs
 * along the most "sky above, ground below" edge wins. Robust to a skyline the picture does not show
 * clearly (haze, a near tree): those columns just add little. rgba w x h, cam as for matchHorizon.
 * @returns {{dh, dp, score, sure}|null}
 */
export function alignHorizon(rgba, w, h, pano, cam, { range = 15, prange = 6, step = 0.2, skipTop = 0, regionW = 0, shapeW = 0.7 } = {}) {
  const L = new Float32Array(w * h), B = new Float32Array(w * h);
  for (let i = 0, q = 0; i < w * h; i++, q += 4) {
    L[i] = (0.299 * rgba[q] + 0.587 * rgba[q + 1] + 0.114 * rgba[q + 2]) / 255;
    B[i] = (rgba[q + 2] - rgba[q]) / 255;
  }
  const k = Math.max(1, Math.round(h / 80)), E = new Float32Array(w * h);
  for (let y = Math.max(k, skipTop); y < h - k; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x;
    let la = 0, lb = 0, ba = 0, bb = 0;
    for (let d = 1; d <= k; d++) { la += L[i - d * w]; lb += L[i + d * w]; ba += B[i - d * w]; bb += B[i + d * w]; }
    E[i] = Math.max(0, (la - lb) / k) + 0.6 * Math.max(0, (ba - bb) / k);
  }
  // (a pixel's tolerance: the strongest edge within a row of it)
  const Em = new Float32Array(w * h);
  for (let y = 1; y < h - 1; y++) for (let x = 0; x < w; x++) { const i = y * w + x; Em[i] = Math.max(E[i - w], E[i], E[i + w]); }
  // how much each pixel looks like sky (bright, bluish, smooth), summed down each column: a band over the
  // line should look like sky, a band under it like ground (the shape, not just a thin edge, has to fit)
  const P = new Float32Array(w * h), cum = new Float32Array(w * (h + 1));
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
    const i = y * w + x, t = Math.abs(L[i + 1] - L[i - 1]) + Math.abs(L[i + w] - L[i - w]);
    P[i] = L[i] + 0.6 * B[i] - 4 * t;
  }
  for (let x = 0; x < w; x++) for (let y = 0; y < h; y++) cum[(y + 1) * w + x] = cum[y * w + x] + (y < skipTop ? 0 : P[y * w + x]);
  const band = Math.max(3, Math.round(h / 12));
  const region = (x, y) => {
    const a0 = Math.max(skipTop, y - band), b1 = Math.min(h, y + 1 + band);
    if (y - a0 < 2 || b1 - y - 1 < 2) return 0;
    return (cum[y * w + x] - cum[a0 * w + x]) / (y - a0) - (cum[b1 * w + x] - cum[(y + 1) * w + x]) / (b1 - y - 1);
  };
  // each column's direction: its azimuth at the frame's middle row and how elevation maps to rows there
  const f = w / 2 / Math.tan((cam.hfov * Math.PI) / 360), cols = [];
  for (let x = 0; x < w; x++) {
    const t = (x + 0.5 - w / 2) / f, az = cam.heading + (Math.atan(t) * 180) / Math.PI, fx = f * Math.sqrt(1 + t * t);
    cols.push({ az, fx });
  }
  const nh = Math.round((2 * range) / step) + 1, np = Math.round((2 * prange) / step) + 1, sc = new Float32Array(nh * np);
  for (let a = 0; a < nh; a++) {
    const dh = -range + a * step, hz = cols.map((c) => horizonAt(pano, c.az + dh));
    // (where the horizon rises or falls it says which way you look; where it is flat, only how high: those
    // columns count for less, or a long flat ridge would fit any heading)
    const sl = hz.map((v, x) => Math.abs((hz[Math.min(w - 1, x + 2)] - hz[Math.max(0, x - 2)]) * f / 4 / 57.3));
    const ms = sl.reduce((m, v) => m + v, 0) / w || 1, wt = sl.map((v) => shapeW * Math.min(4, v / ms) + (1 - shapeW));
    for (let p = 0; p < np; p++) {
      const pitch = cam.pitch + (-prange + p * step);
      let s = 0;
      for (let x = 0; x < w; x++) {
        const y = Math.round(h / 2 - cols[x].fx * Math.tan(((hz[x] - pitch) * Math.PI) / 180));
        if (y > skipTop && y < h - 1) s += wt[x] * (Em[y * w + x] + regionW * Math.max(-0.2, region(x, y)));
      }
      sc[a * np + p] = s / w;
    }
  }
  const profOf = () => Array.from({ length: nh }, (_, a) => { let m = 0; for (let p = 0; p < np; p++) m = Math.max(m, sc[a * np + p]); return m; });
  let b = 0;
  for (let i = 1; i < sc.length; i++) if (sc[i] > sc[b]) b = i;
  const ba = Math.floor(b / np), bp = b % np;
  let b2 = 0;
  for (let a = 0; a < nh; a++) if (Math.abs(a - ba) * step > 2.5) for (let p = 0; p < np; p++) b2 = Math.max(b2, sc[a * np + p]);
  const score = sc[b];
  // how much the best heading stands out of the rest (0: a flat ridge, any heading fits)
  const sorted = [...profOf()].sort((p, q) => p - q), medS = sorted[sorted.length >> 1], stand = score > 0 ? (score - medS) / score : 0;
  const at0 = sc[Math.round(range / step) * np + Math.round(prange / step)];

  return { dh: -range + ba * step, dp: -prange + bp * step, score, second: b2, at0, prof: profOf(), stand, sure: stand > 0.25 && score > 1.03 * b2 && ba > 0 && ba < nh - 1 && bp > 0 && bp < np - 1 };
}

// ---- from a sky mask ---------------------------------------------------
// A segmentation model (tools/skyseg: u2netp sky model, MIT) tells sky from ground far better than edges
// do: haze, a pale ridge, snow under a white sky. Its mask gives the skyline; matchSky fits it.

/**
 * The skyline from a sky mask: per column, the row where the sky that starts at the top (below skipTop)
 * ends, to a fraction of a row. mask: probabilities (0..1), mw x mh, laid over a w x h frame.
 * Columns that start on ground (a tree over the top) or are sky to the bottom: NaN.
 * @returns {{y: Float32Array}} rows in the w x h frame
 */
export function skyFromMask(mask, mw, mh, w, h, { skipTop = 0 } = {}) {
  const y = new Float32Array(w).fill(NaN), r0 = Math.ceil((skipTop * mh) / h);
  for (let x = 0; x < w; x++) {
    const mx = Math.min(mw - 1, Math.floor(((x + 0.5) * mw) / w));
    let r = r0;
    if (r >= mh || mask[r * mw + mx] < 0.5) continue;
    while (r < mh && mask[r * mw + mx] >= 0.5) r++;
    if (r >= mh) continue;
    const a = mask[(r - 1) * mw + mx], b = mask[r * mw + mx];
    y[x] = ((r - 1 + (a - 0.5) / Math.max(1e-6, a - b) + 0.5) * h) / mh - 0.5;
  }
  return { y };
}

/**
 * Heading and pitch correction from a reliable skyline (skyFromMask): each heading shift within ±range
 * is scored by how many skyline points lie near the grid's horizon at the best pitch shift (a soft count,
 * sigma degrees: trees and poles in front only lower it). Sure only when one fit stands: a narrow peak
 * (a flat ridge fits at any heading: then only the pitch is worth taking) and no rival peak nearly as good
 * (a round dome can fit two ways).
 * @returns {{dh, dp, score, width, rival, sure, pitchSure}|null}
 */
export function matchSky(sky, w, h, pano, cam, { range = 15, step = 0.1, sigma = 0.25 } = {}) {
  const c = { ...cam, width: w, height: h }, pts = [];
  for (let x = 0; x < w; x++) {
    const y = sky.y[x];
    if (!Number.isFinite(y)) continue;
    const d = unproject(x + 0.5, y + 0.5, c);
    if (d) pts.push(d);
  }
  if (pts.length < w * 0.3) return null;
  const n = Math.round((2 * range) / step) + 1, score = new Float32Array(n), dps = new Float32Array(n), r = new Float64Array(pts.length);
  for (let s = 0; s < n; s++) {
    const dh = -range + s * step;
    for (let i = 0; i < pts.length; i++) r[i] = horizonAt(pano, pts[i].az + dh) - pts[i].el;
    r.sort();
    let best = -1, bdp = 0;
    for (let dp = r[0], j0 = 0; dp <= r[r.length - 1]; dp += 0.05) {
      while (r[j0] < dp - 4 * sigma) j0++;
      let sc = 0;
      for (let i = j0; i < r.length && r[i] < dp + 4 * sigma; i++) { const u = (r[i] - dp) / sigma; sc += Math.exp(-u * u / 2); }
      if (sc > best) { best = sc; bdp = dp; }
    }
    score[s] = best / pts.length; dps[s] = bdp;
  }
  let b = 0;
  for (let s = 1; s < n; s++) if (score[s] > score[b]) b = s;
  let lo = b, hi = b;
  while (lo > 0 && score[lo - 1] >= 0.95 * score[b]) lo--;
  while (hi < n - 1 && score[hi + 1] >= 0.95 * score[b]) hi++;
  let rival = 0;
  for (let s = 1; s < n - 1; s++) {
    if ((s >= lo && s <= hi) || score[s] < score[s - 1] || score[s] < score[s + 1]) continue;
    let dip = Infinity;
    for (let j = Math.min(s, b); j <= Math.max(s, b); j++) dip = Math.min(dip, score[j]);
    if (dip < 0.97 * Math.min(score[s], score[b])) rival = Math.max(rival, score[s] / score[b]);
  }
  const width = (hi - lo) * step, ok = score[b] > 0.3;
  return { dh: -range + b * step, dp: dps[b], score: score[b], width, rival, pitchSure: ok, sure: ok && width < 3 && rival < 0.92 && lo > 0 && hi < n - 1 };
}
