// Track cleaning (port of src/scratchcard/ingest/clean.py).
// Points: {t (ms), lat, lon, ele}. Returns {parts: [[point]], report}.

const R = 6371008.8;
const rad = (d) => (d * Math.PI) / 180;

export function haversine(a, b) {
  const p1 = rad(a.lat), p2 = rad(b.lat), dp = p2 - p1, dl = rad(b.lon - a.lon);
  const h = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function pathLength(pts) {
  let s = 0;
  for (let i = 1; i < pts.length; i++) s += haversine(pts[i - 1], pts[i]);
  return s;
}

export const CLEAN_DEFAULTS = {
  maxSpeedKmh: 15, speedWindowS: 60, spikeSpeedKmh: 40, maxGapM: 200,
  minPartPoints: 10, minPartM: 100,
};

function dropSpikes(points, kmh, report) {
  if (points.length < 3) return points;
  const vmax = kmh / 3.6, keep = [points[0]];
  for (let i = 1; i < points.length - 1; i++) {
    const prev = keep[keep.length - 1], cur = points[i], nxt = points[i + 1];
    const dt1 = Math.max((cur.t - prev.t) / 1000, 1), dt2 = Math.max((nxt.t - cur.t) / 1000, 1), dts = Math.max((nxt.t - prev.t) / 1000, 1);
    if (haversine(prev, cur) / dt1 > vmax && haversine(cur, nxt) / dt2 > vmax && haversine(prev, nxt) / dts <= vmax) {
      report.dropped.spike = (report.dropped.spike || 0) + 1;
      continue;
    }
    keep.push(cur);
  }
  keep.push(points[points.length - 1]);
  return keep;
}

function fastMask(points, kmh, windowS) {
  const n = points.length, fast = new Array(n).fill(false);
  if (n < 2) return fast;
  const cum = [0];
  for (let i = 1; i < n; i++) cum.push(cum[i - 1] + haversine(points[i - 1], points[i]));
  const vmax = kmh / 3.6;
  let j = 0;
  for (let i = 0; i < n; i++) {
    j = Math.max(j, i);
    while (j < n - 1 && (points[j].t - points[i].t) / 1000 < windowS) j++;
    const dt = (points[j].t - points[i].t) / 1000;
    if (dt <= 0) continue;
    if ((dt >= windowS || j === n - 1) && (cum[j] - cum[i]) / dt > vmax) for (let k = i; k <= j; k++) fast[k] = true;
  }
  return fast;
}

export function cleanTrack(points, params = {}) {
  const p = { ...CLEAN_DEFAULTS, ...params };
  const report = { rawPoints: points.length, keptPoints: 0, dropped: {}, parts: 0 };
  const bump = (k, n = 1) => (report.dropped[k] = (report.dropped[k] || 0) + n);

  const runs = [points];
  const parts = [];
  for (let run of runs) {
    if (!run.length) continue;
    run = dropSpikes(run, p.spikeSpeedKmh, report); // 2
    const fast = fastMask(run, p.maxSpeedKmh, p.speedWindowS); // 3
    let cur = [];
    run.forEach((pt, i) => {
      if (fast[i]) {
        bump("too_fast");
        if (cur.length) { parts.push(cur); cur = []; }
        return;
      }
      if (cur.length && haversine(cur[cur.length - 1], pt) > p.maxGapM) { parts.push(cur); cur = []; } // 4
      cur.push(pt);
    });
    if (cur.length) parts.push(cur);
  }
  const kept = []; // 5
  for (const part of parts) {
    if (part.length < p.minPartPoints || pathLength(part) < p.minPartM) bump("short_part", part.length);
    else kept.push(part);
  }
  report.parts = kept.length;
  report.keptPoints = kept.reduce((s, x) => s + x.length, 0);
  return { parts: kept, report };
}
