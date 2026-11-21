// Where a GPS fix is on a route (its profile's samples P: {x, y, d}), when the route passes the spot more than
// once (a loop's start and finish, a figure of eight, there and back): each pass near the fix is a candidate,
// and the one that fits how you walk wins.
//   - from the last place you were matched (at {i, t}, kept also while off the route or the app closed): the
//     pass about as far on along the route as you could have walked since (back along the route costs much more);
//   - your heading (from the last fixes): a pass going the other way costs more;
//   - with neither: the first pass not yet walked (from the furthest point reached on).

const WALK = 1.6; // m/s: a brisk walk, the most a fix can have moved on along the route (plus a margin)
const ang = (a) => Math.abs(((a + 3 * Math.PI) % (2 * Math.PI)) - Math.PI);

/**
 * P: {x, y, d} (samples every P.step metres); p: {x, y, acc}; o: {at: {i, t} | null, maxIdx, heading (rad, pack
 * coords: atan2(dy, dx)) | null, now (ms)}. -> the sample index, or null (off the route).
 */
export function pickPass(P, p, o = {}) {
  if (!P || !p) return null;
  const n = P.d.length, step = P.step || (n > 1 ? P.d[1] - P.d[0] : 20), tol = Math.max(60, Math.min(150, p.acc || 0)) + step / 2;
  // the passes: runs of samples within reach, each with its nearest sample
  const runs = []; let run = null;
  for (let i = 0; i < n; i++) {
    const d = Math.hypot(P.x[i] - p.x, P.y[i] - p.y);
    if (d > tol) { run = null; continue; }
    if (!run || i - run.last > 2) runs.push((run = { i, d, last: i }));
    else { run.last = i; if (d < run.d) { run.i = i; run.d = d; } }
  }
  if (!runs.length) return null;
  if (runs.length === 1) return runs[0].i;
  const now = o.now ?? Date.now(), at = o.at && o.at.i < n ? o.at : null, maxIdx = o.maxIdx || 0;
  let best = null, bs = Infinity;
  for (const r of runs) {
    let s = r.d;
    if (at) {
      const dt = Math.max(0, (now - (at.t || now)) / 1000), reach = dt * WALK + 150, delta = P.d[r.i] - P.d[at.i];
      if (delta < -60) s += 3000 - delta; // (back along the route: possible, rarely)
      else if (delta > reach) s += 1500 + (delta - reach); // (further on than you could have walked)
      else s += Math.max(0, delta) * 0.05; // (of the plausible ones: the nearer on)
    } else if (r.i < maxIdx - 2) s += 400; // (no last place: rather the stretch not walked yet)
    if (o.heading != null && r.i > 0 && r.i < n - 1) {
      const dir = Math.atan2(P.y[r.i + 1] - P.y[r.i - 1], P.x[r.i + 1] - P.x[r.i - 1]);
      s += 250 * (1 - Math.cos(ang(dir - o.heading))); // (the more this pass turns from your heading: 500 the other way)
    }
    if (s < bs) { bs = s; best = r.i; }
  }
  return best;
}
