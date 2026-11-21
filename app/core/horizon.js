// Which peaks you see from where you stand, and where they sit in a camera
// frame. Pure geometry on a height grid: no image recognition.
//
// The grid (HDEM, see encodeDem) is lon/lat cell centres, row 0 at the north.
// Rays leave the observer along great circles; a point at distance d sits
// below the observer's tangent plane by d²(1-k)/2R (Earth's curvature, less
// the light bent by the air: k ≈ 0.13 by day). A peak is seen when no ground
// between rises to a higher elevation angle than the peak itself.

export const R_EARTH = 6371000;
export const K_REFRACTION = 0.13;
const RAD = Math.PI / 180, DEG = 180 / Math.PI;
const MAGIC = 0x4d454448; // "HDEM" little-endian
const HEADER = 40;
export const NODATA = -32768;

// ---- grid ---------------------------------------------------------------

/** Grid -> ArrayBuffer: "HDEM", u16 version, u16 0, u32 w, u32 h, f64 lon0, f64 lat0, f32 dlon, f32 dlat, then Int16 heights (m) row by row from the north. */
export function encodeDem({ w, h, lon0, lat0, dlon, dlat, data }) {
  const buf = new ArrayBuffer(HEADER + w * h * 2), v = new DataView(buf);
  v.setUint32(0, MAGIC, true); v.setUint16(4, 1, true);
  v.setUint32(8, w, true); v.setUint32(12, h, true);
  v.setFloat64(16, lon0, true); v.setFloat64(24, lat0, true);
  v.setFloat32(32, dlon, true); v.setFloat32(36, dlat, true);
  new Int16Array(buf, HEADER).set(data);
  return buf;
}

export function decodeDem(buf) {
  const v = new DataView(buf);
  if (v.getUint32(0, true) !== MAGIC) throw new Error("not an HDEM grid");
  const w = v.getUint32(8, true), h = v.getUint32(12, true);
  return {
    w, h, lon0: v.getFloat64(16, true), lat0: v.getFloat64(24, true),
    dlon: v.getFloat32(32, true), dlat: v.getFloat32(36, true),
    data: new Int16Array(buf, HEADER, w * h),
  };
}

/** Height (m) at lat, lon, bilinear between cell centres; null outside the grid or on a gap. */
export function heightAt(dem, lat, lon) {
  const x = (lon - dem.lon0) / dem.dlon, y = (dem.lat0 - lat) / dem.dlat;
  const i = Math.floor(x), j = Math.floor(y);
  if (i < 0 || j < 0 || i >= dem.w - 1 || j >= dem.h - 1) return null;
  const fx = x - i, fy = y - j, d = dem.data, o = j * dem.w + i;
  const a = d[o], b = d[o + 1], c = d[o + dem.w], e = d[o + dem.w + 1];
  if (a === NODATA || b === NODATA || c === NODATA || e === NODATA) return null;
  return (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + e * fx) * fy;
}

// ---- sphere -------------------------------------------------------------

/** Initial great-circle bearing, degrees clockwise from north, 0..360. */
export function bearing(lat1, lon1, lat2, lon2) {
  const p1 = lat1 * RAD, p2 = lat2 * RAD, dl = (lon2 - lon1) * RAD;
  const y = Math.sin(dl) * Math.cos(p2);
  const x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl);
  return (Math.atan2(y, x) * DEG + 360) % 360;
}

/** Great-circle distance, metres (haversine). */
export function distance(lat1, lon1, lat2, lon2) {
  const p1 = lat1 * RAD, p2 = lat2 * RAD, dp = p2 - p1, dl = (lon2 - lon1) * RAD;
  const a = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  return 2 * R_EARTH * Math.asin(Math.min(1, Math.sqrt(a)));
}

/** The point d metres away along bearing az (degrees): [lat, lon]. */
export function destination(lat, lon, az, d) {
  const p1 = lat * RAD, t = az * RAD, dr = d / R_EARTH;
  const p2 = Math.asin(Math.sin(p1) * Math.cos(dr) + Math.cos(p1) * Math.sin(dr) * Math.cos(t));
  const l2 = lon * RAD + Math.atan2(Math.sin(t) * Math.sin(dr) * Math.cos(p1), Math.cos(dr) - Math.sin(p1) * Math.sin(p2));
  return [p2 * DEG, l2 * DEG];
}

/** How far a point d metres away sits below the tangent plane, refraction included. */
export const drop = (d, k = K_REFRACTION) => (d * d * (1 - k)) / (2 * R_EARTH);

/** Elevation angle (degrees) from height h0 to height h1 at distance d. */
export const elevationAngle = (h0, h1, d, k = K_REFRACTION) => Math.atan2(h1 - h0 - drop(d, k), d) * DEG;

// Distances along a ray: one grid cell near the observer, then growing by
// `grow` of the distance (a far ridge needs no 30 m steps).
function rayDistances(minStep, maxDist, grow) {
  const ds = [];
  for (let d = minStep; d < maxDist; d += Math.max(minStep, d * grow)) ds.push(d);
  ds.push(maxDist);
  return Float64Array.from(ds);
}

function cellMetres(dem, lat) {
  const g = dem.nearGrid ?? dem; // (the fine near grid: finer steps near you)
  return Math.min(g.dlat * RAD * R_EARTH, g.dlon * RAD * R_EARTH * Math.cos(lat * RAD));
}

/** Observer height: the ground under them (given, e.g. a summit's height, or the grid's) plus eye height; null off the grid. */
export function observerHeight(dem, { lat, lon, eye = 1.7, ground = null }) {
  const g = ground ?? groundAt(dem, lat, lon);
  return g == null ? null : g + eye;
}

// ---- panorama -----------------------------------------------------------

/**
 * The horizon all round: for each bearing (step degrees from 0), the highest
 * elevation angle of the ground and how far away that ground is.
 * @returns {{step, n, h0, angle: Float32Array, dist: Float32Array}}
 */
export function panorama(dem, obs, { step = 0.1, maxDist = 150000, grow = 0.01, k = K_REFRACTION, ridges = false, ridgeDrop = 0.15 } = {}) {
  const h0 = observerHeight(dem, obs);
  if (h0 == null) return null;
  const n = Math.round(360 / step);
  const ds = rayDistances(cellMetres(dem, obs.lat), maxDist, grow);
  const m = ds.length, sinD = new Float64Array(m), cosD = new Float64Array(m), dropD = new Float64Array(m);
  for (let s = 0; s < m; s++) { const r = ds[s] / R_EARTH; sinD[s] = Math.sin(r); cosD[s] = Math.cos(r); dropD[s] = drop(ds[s], k); }
  const p1 = obs.lat * RAD, l1 = obs.lon * RAD, sp1 = Math.sin(p1), cp1 = Math.cos(p1);
  const angle = new Float32Array(n), dist = new Float32Array(n), rAz = [], rAng = [], eps = Math.tan(ridgeDrop * RAD);
  for (let a = 0; a < n; a++) {
    const t = a * step * RAD, st = Math.sin(t), ct = Math.cos(t);
    let best = -Infinity, bestD = 0, open = false;
    for (let s = 0; s < m; s++) {
      const sp2 = sp1 * cosD[s] + cp1 * sinD[s] * ct;
      const lat = Math.asin(sp2) * DEG;
      const lon = (l1 + Math.atan2(st * sinD[s] * cp1, cosD[s] - sp1 * sp2)) * DEG;
      const h = groundAt(dem, lat, lon);
      if (h == null) break; // off the grid: the horizon is whatever came before
      const tan = (h - h0 - dropD[s]) / ds[s];
      if (tan > best) { best = tan; bestD = ds[s]; open = true; }
      else if (ridges && open && tan < best - eps) { rAz.push(a); rAng.push(Math.atan(best) * DEG); open = false; } // a nearer ridge's edge, with ground falling away behind it
    }
    angle[a] = best === -Infinity ? NaN : Math.atan(best) * DEG;
    dist[a] = bestD;
  }
  return { step, n, h0, angle, dist, ...(ridges ? { ridgeAz: Uint16Array.from(rAz), ridgeAngle: Float32Array.from(rAng) } : {}) };
}

/** Horizon elevation angle at any bearing, linear between the panorama's rays. */
export function horizonAt(pano, az) {
  const x = (((az % 360) + 360) % 360) / pano.step, i = Math.floor(x) % pano.n, f = x - Math.floor(x);
  return pano.angle[i] * (1 - f) + pano.angle[(i + 1) % pano.n] * f;
}

// ---- peaks --------------------------------------------------------------

/**
 * One peak seen from obs: bearing, distance, elevation angle, and whether the
 * ground between hides it. The peak's own height is its OSM `ele` when known
 * (a 30-90 m grid rounds summits down), else the grid's.
 * margin: degrees the peak clears the highest ground before it (negative: hidden).
 */
export function peakView(dem, obs, peak, { k = K_REFRACTION, h0 = observerHeight(dem, obs), grow = 0.005, guard = 0.02, tol = 0.02 } = {}) {
  const top = peak.ele ?? groundAt(dem, peak.lat, peak.lon);
  if (h0 == null || top == null) return null;
  const v = sightTo(dem, obs, h0, peak.lat, peak.lon, top, { k, grow, guard, tol });
  return v && { ...peak, ...v };
}

/** The highest elevation angle of the ground along bearing az from obs, up to distance end (m). */
function groundMax(dem, obs, h0, az, end, k, grow) {
  let best = -Infinity;
  for (const s of rayDistances(cellMetres(dem, obs.lat), Math.max(end, 1), grow)) {
    if (s >= end) break;
    const [lat, lon] = destination(obs.lat, obs.lon, az, s);
    const h = groundAt(dem, lat, lon);
    if (h == null) continue;
    const a = elevationAngle(h0, h, s, k);
    if (a > best) best = a;
  }
  return best;
}

/** A point of height top seen from obs (eye at h0): {az, dist, angle, margin, visible}; null at obs. */
function sightTo(dem, obs, h0, lat, lon, top, { k = K_REFRACTION, grow = 0.005, guard = 0.02, tol = 0.02 } = {}) {
  const d = distance(obs.lat, obs.lon, lat, lon);
  if (d < 1) return null;
  const az = bearing(obs.lat, obs.lon, lat, lon), angle = elevationAngle(h0, top, d, k);
  // stop short of the point: its own shoulders are not "ground before it"
  const best = groundMax(dem, obs, h0, az, d - Math.max(2 * cellMetres(dem, lat), guard * d), k, grow);
  const margin = best === -Infinity ? Infinity : angle - best;
  return { az, dist: d, angle, margin, visible: margin >= -tol };
}

/**
 * A way on the ground (points {lat, lon, h}: h its height, e.g. the route's profile) as seen from
 * obs: each point's bearing, elevation angle and whether the ground before it hides it. The point
 * stands on whichever is higher, its own height or the grid's (the grid has the forest's top: a path
 * under the trees counts as seen where the trees over it are).
 */
export function wayView(dem, obs, pts, { k = K_REFRACTION, h0 = observerHeight(dem, obs), grow = 0.01, tol = 0.05 } = {}) {
  if (h0 == null) return [];
  return pts.map((p) => {
    const g = groundAt(dem, p.lat, p.lon), top = Math.max(p.h ?? -Infinity, g ?? -Infinity);
    if (!Number.isFinite(top)) return null;
    const v = sightTo(dem, obs, h0, p.lat, p.lon, top, { k, grow, guard: 0.01, tol });
    return v && (v.dist < 150 ? { ...v, visible: true } : v);
  });
}

/**
 * Peaks seen from obs, nearest first. With a panorama, each also says whether
 * it stands on the skyline (nothing behind it higher) - those read best.
 */
export function visiblePeaks(dem, obs, peaks, { maxDist = 150000, pano = null, skyTol = 0.05, ...o } = {}) {
  const h0 = observerHeight(dem, obs);
  if (h0 == null) return [];
  const out = [];
  for (const p of peaks) {
    if (distance(obs.lat, obs.lon, p.lat, p.lon) > maxDist) continue;
    const v = peakView(dem, obs, p, { ...o, h0 });
    if (!v || !v.visible) continue;
    if (pano) v.skyline = v.angle >= horizonAt(pano, v.az) - skyTol;
    out.push(v);
  }
  return out.sort((a, b) => a.dist - b.dist);
}

// ---- camera -------------------------------------------------------------

/** The inverse of project: a pixel of the camera frame -> {az, el} (degrees) of the direction it shows. */
export function unproject(px, py, { heading, pitch = 0, roll = 0, hfov, width, height }) {
  const f = width / 2 / Math.tan((hfov * RAD) / 2);
  let u = px - width / 2, v = height / 2 - py;
  const rl = -roll * RAD, cr = Math.cos(rl), sr = Math.sin(rl);
  [u, v] = [u * cr - v * sr, u * sr + v * cr];
  let x = u, y = f, z = v;
  const pt = -pitch * RAD, cp = Math.cos(pt), sp = Math.sin(pt);
  [y, z] = [y * cp + z * sp, -y * sp + z * cp];
  const hd = -heading * RAD, ch = Math.cos(hd), sh = Math.sin(hd);
  [x, y] = [x * ch - y * sh, x * sh + y * ch];
  const n = Math.hypot(x, y, z);
  return { az: (Math.atan2(x, y) * DEG + 360) % 360, el: Math.asin(z / n) * DEG };
}

/**
 * Where a direction (bearing az, elevation el, degrees) lands in a camera
 * frame, or null behind the camera / outside the frame. Camera: heading
 * (bearing of the optical axis), pitch (up +), roll (clockwise +), hfov
 * (horizontal field of view), width, height (px). Pinhole model.
 */
export function project(az, el, { heading, pitch = 0, roll = 0, hfov, width, height }, { clip = true } = {}) {
  // direction in east-north-up
  const a = az * RAD, e = el * RAD;
  let x = Math.sin(a) * Math.cos(e), y = Math.cos(a) * Math.cos(e), z = Math.sin(e);
  // undo heading (rotate about up so the axis points north = +y)
  const hd = heading * RAD, ch = Math.cos(hd), sh = Math.sin(hd);
  [x, y] = [x * ch - y * sh, x * sh + y * ch];
  // undo pitch (rotate about the camera's right axis = +x)
  const pt = pitch * RAD, cp = Math.cos(pt), sp = Math.sin(pt);
  [y, z] = [y * cp + z * sp, -y * sp + z * cp];
  if (y <= 0) return null;
  // image plane: right = x, up = z, forward = y; then undo roll
  const f = width / 2 / Math.tan((hfov * RAD) / 2);
  let u = (f * x) / y, v = (f * z) / y;
  const rl = roll * RAD, cr = Math.cos(rl), sr = Math.sin(rl);
  [u, v] = [u * cr - v * sr, u * sr + v * cr];
  const px = width / 2 + u, py = height / 2 - v;
  if (clip && (px < 0 || px > width || py < 0 || py > height)) return null;
  return { x: px, y: py };
}

/**
 * Where the back camera looks, from W3C device orientation (absolute alpha):
 * heading (bearing of the optical axis), pitch (up +), roll (clockwise +, of
 * the picture as the screen shows it, screenAngle = screen.orientation.angle).
 */
export function cameraPose(alpha, beta, gamma, screenAngle = 0) {
  const cA = Math.cos(alpha * RAD), sA = Math.sin(alpha * RAD), cB = Math.cos(beta * RAD), sB = Math.sin(beta * RAD), cG = Math.cos(gamma * RAD), sG = Math.sin(gamma * RAD);
  // device axes in east-north-up (R = Rz(alpha) Rx(beta) Ry(gamma))
  const X = [cA * cG - sA * sB * sG, sA * cG + cA * sB * sG, -cB * sG];
  const Y = [-sA * cB, cA * cB, sB];
  const Z = [cA * sG + sA * sB * cG, sA * sG - cA * sB * cG, cB * cG];
  return poseFromAxes(X, Y, Z, screenAngle);
}

/** The same from Android's rotation matrix (SensorManager.getRotationMatrixFromVector: row-major, device to east-north-up). */
export function cameraPoseFromMatrix(m, screenAngle = 0) {
  return poseFromAxes([m[0], m[3], m[6]], [m[1], m[4], m[7]], [m[2], m[5], m[8]], screenAngle);
}

/** The back camera's pose from the device's axes in east-north-up (it looks along -Z; the screen turned by screenAngle). */
function poseFromAxes(X, Y, Z, screenAngle) {
  const F = Z.map((v) => -v);
  const t = screenAngle * RAD, ct = Math.cos(t), st = Math.sin(t);
  const right = X.map((v, i) => ct * v - st * Y[i]), up = X.map((v, i) => st * v + ct * Y[i]);
  const heading = (Math.atan2(F[0], F[1]) * DEG + 360) % 360;
  const pitch = Math.asin(Math.max(-1, Math.min(1, F[2]))) * DEG;
  const roll = Math.atan2(-right[2], up[2]) * DEG;
  return { heading, pitch, roll };
}

/**
 * Slanted labels (as on a panorama board): each needs only a narrow strip of
 * the frame, so many fit along a skyline. Items {x, y (the summit, px), pri}:
 * the higher pri first, kept when no kept label stands within `gap` px. Each
 * kept label gets `ay`, where its leader ends and its text starts: a little
 * above the highest summit near it, so neighbours line up.
 */
export function spreadLabels(items, { gap = 24, max = 24, lift = 28, near = 70, top = 0 } = {}) {
  const kept = [];
  for (const it of [...items].sort((a, b) => b.pri - a.pri)) {
    if (kept.length >= max) break;
    if (kept.some((k) => Math.abs(k.x - it.x) < gap)) continue;
    kept.push(it);
  }
  return kept.sort((a, b) => a.x - b.x).map((it) => {
    let hi = it.y;
    for (const o of kept) if (Math.abs(o.x - it.x) < near && o.y < hi) hi = o.y;
    return { ...it, ay: Math.max(top, hi - lift) };
  });
}

const wrap180 = (a) => ((((a + 180) % 360) + 360) % 360) - 180;

/**
 * One step of smoothing the camera's pose: strong while the phone is held still (no tremble), weak
 * while it turns (no lag). k (0..1, the share of the new reading) grows with how far the reading
 * moved since the last one: 0.06 still, up to 0.7 at 6° and more. Heading and roll on the circle.
 */
export function smoothPose(prev, next) {
  if (!prev) return { ...next };
  const dh = wrap180(next.heading - prev.heading), dp = next.pitch - prev.pitch, dr = wrap180(next.roll - prev.roll);
  const move = Math.max(Math.abs(dh), Math.abs(dp), Math.abs(dr));
  const k = Math.min(0.7, 0.06 + 0.11 * move);
  return { heading: (prev.heading + k * dh + 360) % 360, pitch: prev.pitch + k * dp, roll: prev.roll + k * dr };
}

/**
 * The ground near you, finer than the grid: a lon/lat grid of ~cell metres over radius R round obs,
 * from the map's contour lines (10 m apart; the grid's 90 m cells round a near hill down by tens of
 * metres and blur its shape). The lines are burnt into the cells they cross, the cells between are
 * filled by relaxation (each the mean of its neighbours: smooth between two levels), starting from
 * the coarse grid. Cells with no line within reach keep the coarse grid's height.
 * lines: [{e, pts: [[lon, lat], ...]}]. Returns a grid like decodeDem's, as Float32.
 */
export function nearGround(dem, obs, lines, { R = 3000, cell = 30, iters = 160 } = {}) {
  const dlat = (cell / R_EARTH) * DEG, dlon = dlat / Math.cos(obs.lat * RAD);
  const n = Math.ceil(R / cell), w = 2 * n + 1, h = 2 * n + 1;
  const lon0 = obs.lon - n * dlon, lat0 = obs.lat + n * dlat;
  const data = new Float32Array(w * h), fixed = new Uint8Array(w * h);
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) data[j * w + i] = heightAt(dem, lat0 - j * dlat, lon0 + i * dlon) ?? 0;
  const sum = new Float32Array(w * h), cnt = new Uint16Array(w * h);
  for (const L of lines) {
    const P = L.pts;
    for (let k = 1; k < P.length; k++) {
      const [ax, ay] = P[k - 1], [bx, by] = P[k];
      const fx0 = (ax - lon0) / dlon, fy0 = (lat0 - ay) / dlat, fx1 = (bx - lon0) / dlon, fy1 = (lat0 - by) / dlat;
      const steps = Math.max(1, Math.ceil(Math.hypot(fx1 - fx0, fy1 - fy0) * 2));
      for (let s = 0; s <= steps; s++) {
        const i = Math.round(fx0 + ((fx1 - fx0) * s) / steps), j = Math.round(fy0 + ((fy1 - fy0) * s) / steps);
        if (i < 0 || j < 0 || i >= w || j >= h) continue;
        sum[j * w + i] += L.e; cnt[j * w + i]++;
      }
    }
  }
  for (let q = 0; q < w * h; q++) if (cnt[q]) { data[q] = sum[q] / cnt[q]; fixed[q] = 1; }
  // relax the free cells (red-black Gauss-Seidel, over-relaxed: converges in ~100 sweeps on 200 x 200)
  for (let it = 0; it < iters; it++) {
    for (let c = 0; c < 2; c++) {
      for (let j = 1; j < h - 1; j++) for (let i = 1 + ((j + c) & 1); i < w - 1; i += 2) {
        const q = j * w + i;
        if (fixed[q]) continue;
        const m = (data[q - 1] + data[q + 1] + data[q - w] + data[q + w]) / 4;
        data[q] += 1.8 * (m - data[q]);
      }
    }
  }
  return { w, h, lon0, lat0, dlon, dlat, data, near: true };
}

/** Height at lat, lon on the fine near grid where it has one, else on the coarse grid. */
export function groundAt(dem, lat, lon) {
  const g = dem.nearGrid;
  if (g) {
    const x = (lon - g.lon0) / g.dlon, y = (g.lat0 - lat) / g.dlat;
    if (x >= 0 && y >= 0 && x < g.w - 1 && y < g.h - 1) return heightAt(g, lat, lon);
  }
  return heightAt(dem, lat, lon);
}

/**
 * Names in rows by distance (as planes of depth: near ones in the row closest to the skyline, the
 * farthest at the top). items {x, y (the summit), w (the text's width), band (0 near, 1, 2 far), pri}:
 * the higher pri first; one is left out when its text would touch another in its row, when its leader
 * (from its row down to its summit) would run through a nearer row's text, or when its text would lie
 * on a leader already there. Texts are kept inside [pad, W - pad] (the leader stays on the summit).
 * @returns the placed items with `ty` (the text's baseline) and `tx` (the text's centre)
 */
export function depthRows(items, { rowY, W, gap = 14, pad = 6 } = {}) {
  const placed = [];
  const box = (it, tx) => [tx - it.w / 2 - gap / 2, tx + it.w / 2 + gap / 2];
  for (const it of [...items].sort((a, b) => b.pri - a.pri)) {
    const ty = rowY[it.band], tx = Math.max(pad + it.w / 2, Math.min(W - pad - it.w / 2, it.x));
    const [x0, x1] = box(it, tx);
    const clash = placed.some((p) => {
      const [p0, p1] = box(p, p.tx);
      if (p.band === it.band) return x0 < p1 && x1 > p0;
      // a leader through a text: the farther one's leader passes the nearer one's row (lower on the screen)
      if (p.band < it.band) return it.x > p0 && it.x < p1 && p.ty < it.y;
      return p.x > x0 && p.x < x1 && ty < p.y;
    });
    if (!clash) placed.push({ ...it, tx, ty });
  }
  return placed;
}
