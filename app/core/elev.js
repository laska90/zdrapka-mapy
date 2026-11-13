// Total ascent / descent from a track's elevations. Watches and phones report
// barometric or GPS heights with noise of a few metres: a median of 5 points
// takes the spikes out, and a change only counts once it exceeds 3 m from the
// last turning point (hysteresis) - close to what Garmin shows.

const THRESHOLD = 3;

/** points: [{ele}] (null / NaN skipped) -> {asc, desc} in metres, or null without elevations */
export function climb(points, threshold = THRESHOLD) {
  const e = [];
  for (const p of points) if (p.ele != null && Number.isFinite(p.ele)) e.push(p.ele);
  if (e.length < 10) return null;
  const sm = e.map((_, i) => {
    const w = e.slice(Math.max(0, i - 2), i + 3).sort((a, b) => a - b);
    return w[w.length >> 1];
  });
  let asc = 0, desc = 0, ref = sm[0];
  for (const v of sm) {
    if (v - ref >= threshold) { asc += v - ref; ref = v; }
    else if (ref - v >= threshold) { desc += ref - v; ref = v; }
  }
  return { asc: Math.round(asc), desc: Math.round(desc) };
}
