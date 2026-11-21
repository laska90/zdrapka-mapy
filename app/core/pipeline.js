// The whole pipeline on the device: files -> activities -> matched results.

import { cleanTrack, pathLength } from "./clean.js";
import { climb } from "./elev.js";
import { effectiveSport, readFit } from "./fit.js";
import { readGpx, readTcx } from "./gpx.js";
import { Matcher } from "./matcher.js";
import { aggregate, coverage, discover, tally } from "./stats.js";
import { activityFiles, activityIdFromName } from "./zip.js";

const DUP_START_MS = 90_000;

export const DEFAULT_SPORTS = ["hiking", "walking", "trail_running", "mountaineering", "snowshoeing"];

/**
 * Parse + clean activity files. Yields progress; returns {activities, skipped}.
 * activities: [{id, sport, name, start, end, km, parts: [[{t, lat, lon, ele}]], report, ele, asc, desc}]
 */
export async function importFiles(files, opts = {}, onProgress = () => {}) {
  const sports = new Set(opts.sports || DEFAULT_SPORTS);
  const known = new Set(opts.knownIds || []);
  // the same outing can arrive twice (Garmin export + intervals.icu): same start = same outing
  const starts = [...(opts.knownStarts || [])];
  const sameStart = (t) => t != null && starts.some((s) => Math.abs(s - t) < DUP_START_MS);
  const activities = [], skipped = [];
  let n = 0;
  for await (const f of activityFiles(files)) {
    const { name, bytes } = f;
    n++;
    const id = f.id || activityIdFromName(name);
    onProgress({ stage: "parse", n, name });
    if (known.has(id)) { skipped.push({ id, reason: "already imported" }); continue; }
    let a;
    try {
      a = /\.gpx$/i.test(name) ? readGpx(bytes, id) : /\.tcx$/i.test(name) ? readTcx(bytes, id) : readFit(bytes, id);
      if (f.meta?.sport) a.sport = f.meta.sport, a.subSport = null; // (Strava's archive: its activities.csv knows the type)
      if (f.meta?.name && !a.name) a.name = f.meta.name;
    } catch (e) {
      skipped.push({ id, name, reason: `unreadable: ${e.message}` });
      continue;
    }
    // no points first (an empty or broken file has no sport either: "no GPS", not "another sport")
    if (!a.points.length) { skipped.push({ id, reason: "no GPS", name: a.name }); continue; }
    // a file saying no sport, or "other" (many apps and watches): taken as a walk
    const sport = ["unknown", "other", "generic"].includes(effectiveSport(a)) ? "hiking" : effectiveSport(a);
    if (!sports.has(sport)) { skipped.push({ id, reason: `sport ${sport}`, name: a.name }); continue; }
    if (sameStart(a.start)) { skipped.push({ id, reason: "same start" }); continue; }
    const { parts, report } = cleanTrack(a.points, opts.clean || {});
    if (!parts.length) { skipped.push({ id, reason: "nothing left after cleaning", name: a.name }); continue; }
    known.add(id);
    if (a.start != null) starts.push(a.start);
    const last = parts[parts.length - 1];
    // the climb as the watch counted it (Garmin's figure) when the file has it, else from the heights
    const c0 = climb(a.points), c = c0 && a.asc != null ? { asc: a.asc, desc: a.desc ?? c0.desc } : c0;
    activities.push({
      id, sport, name: a.name, start: a.start, end: last[last.length - 1].t,
      km: parts.reduce((s, p) => s + pathLength(p), 0) / 1000, parts, report,
      ele: !!c, asc: c?.asc ?? null, desc: c?.desc ?? null,
    });
  }
  return { activities, skipped };
}

/** Match all tracks against the region and compute everything the map shows. */
export function analyse(net, pois, tracks, opts = {}) {
  // Index only segments near the tracks: whole-region index is not needed.
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const parts of tracks.values()) for (const part of parts) for (const q of part) {
    if (q.x < x0) x0 = q.x; if (q.y < y0) y0 = q.y; if (q.x > x1) x1 = q.x; if (q.y > y1) y1 = q.y;
  }
  const m = 200;
  const near = (k) => {
    const { xs, ys } = net.lines[k];
    for (let i = 0; i < xs.length; i++) if (xs[i] >= x0 - m && xs[i] <= x1 + m && ys[i] >= y0 - m && ys[i] <= y1 + m) return true;
    return false;
  };
  const traversals = [];
  if (tracks.size) {
    const matcher = new Matcher(net, opts.match || {}, near);
    for (const [id, parts] of tracks) traversals.push(...matcher.matchActivity(id, parts));
  }
  const agg = aggregate(traversals, opts.countMode || "activities");
  const found = discover(pois, tracks, opts.radii);
  return { traversals, agg, coverage: coverage(net, agg), found, tally: tally(pois, found) };
}
