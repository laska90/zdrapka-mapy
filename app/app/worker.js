// Background worker: import files, keep them in IndexedDB, match each outing
// once against the tiles it crosses (results cached per outing), and send the
// map everything it needs. Nothing leaves the device.

import { Atlas, geomOf, pip, rangeRings } from "../core/atlas.js";
import { badgePoints, badgesOf } from "../core/badges.js";
import { accessOf, withAccess } from "../core/access.js";
import { GBINS, gbin, paceOf, stdMs } from "../core/pace.js";
const PLAN_SMOOTH = { smooth: 40, slope: 50 }; // a plan's heights from the map: steep short bits stay steep
import { MODES, Router, describeRuns } from "../core/route.js";
import { Polyline } from "../core/geometry.js";
import { pickAnchor, routeName } from "../core/routes.js";
import { Matcher } from "../core/matcher.js";
import { freshOf } from "../core/fresh.js";
import { finishProfile, sampleProfile } from "../core/profile.js";
import { contourLines, heightAt } from "../core/contour-elev.js";
import { contourIndex, slopeRuns, wallCost } from "../core/slope.js";
import { decodeLine } from "../core/geometry.js";
import { builtUp } from "../core/builtup.js";
import { importFiles } from "../core/pipeline.js";
import { DISCOVERABLE, aggregate, discover } from "../core/stats.js";
import { activityIds, allMeta, allResults, allTitles, clearActivities, deleteActivity, getActivity, putActivities, putResult, setTitle } from "./store.js";
import { mergeSide, openPacks, packUrl } from "../core/packs.js";
import { glueLines, simplifyXY } from "../core/groupcode.js";
import { movingTime, personalNorm } from "../core/pace.js"; // (a friend without the app: their norm)

const MATCH_V = 5; // bump when matching changes: every outing is matched again
const MANUAL_V = 1; // the same for the outings added by hand only
const REVEAL_R = 220, SUMMIT_R = 450, REVEAL_STEP = 50; // discs of ~220 m every 50 m: continuous, half the shapes of 30 m

let atlas = null, index = null, rings = null, badgePts = null, badgeFull = null, lastLive = [], lastSettings = {}, access = null;
const NAME_V = 1; // bump when route naming changes: names are made again

/** spec: a pack's base or the packs on the phone [{id, base, groups}]: one map (core/packs.js). */
async function init(spec) {
  const load = async (u) => {
    const r = await fetch(u);
    if (!r.ok) throw new Error(`${u}: HTTP ${r.status}`);
    return r.json();
  };
  const opened = await openPacks(spec, load);
  index = opened.index;
  atlas = new Atlas(index, load, { cache: 4 });
  rings = rangeRings(index);
  // optional (tools/access.mjs), one per pack
  access = mergeSide(await Promise.all(opened.packs.map((p) => load(packUrl(p.base, "access.json")).catch(() => null))));
  badgeFull = badgePoints(atlas.project);
  badgePts = badgeFull.map((k) => withAccess({ id: k.id, c: "peak", x: k.x, y: k.y, r: k.r }, accessOf({ id: k.id, x: k.x, y: k.y }, access, [k])));
}

// deterministic per-activity seed
const seedOf = (s) => { let h = 2166136261; for (const c of String(s)) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return h >>> 0; };
function rng(seed) { let t = seed; return () => { t = (Math.imul(t, 1664525) + 1013904223) >>> 0; return t / 4294967296; }; }

function revealFor(id, parts) {
  const out = [], r = rng(seedOf(id));
  for (const part of parts) {
    let last = null;
    const phase = r() * 100;
    part.forEach((q, i) => {
      if (last && Math.hypot(q.x - last.x, q.y - last.y) < REVEAL_STEP) return;
      const rad = REVEAL_R * (1 + 0.18 * Math.sin(i / 23 + phase) + 0.1 * Math.sin(i / 7.3 + 2 * phase));
      out.push(Math.round(q.x), Math.round(q.y), Math.round(rad), Math.floor(r() * 1e4));
      last = q;
    });
  }
  return out;
}


const sigOf = (settings) => `${index.snapshot}|${index.tiles.length}|${MATCH_V}|a${access ? `${access.v}:${Object.keys(access.peaks).length}` : 0}`;

/** Match one outing against the tiles it crosses. */
/** Points every <= 8 m along a line (x, y, t interpolated). */
function densify(part, step = 8) {
  const out = [];
  for (let i = 0; i < part.length; i++) {
    const q = part[i], p = part[i - 1];
    if (p) {
      const d = Math.hypot(q.x - p.x, q.y - p.y), k = Math.floor(d / step);
      for (let j = 1; j < k; j++) { const f = j / k; out.push({ t: p.t + (q.t - p.t) * f, x: p.x + (q.x - p.x) * f, y: p.y + (q.y - p.y) * f }); }
    }
    out.push(q);
  }
  return out;
}
async function matchOne(act, settings, sig) {
  const meta = { id: act.id, sig, name: act.name, sport: act.sport, start: act.start, km: act.km };
  let parts = act.parts.map((p) => p.map((q) => { const [x, y] = atlas.project(q.lon, q.lat); return { t: q.t, x, y }; }));
  // an outing added by hand is the planned line: its corners only, far apart on straight stretches. The matcher
  // wants a track (a point every few metres): without points in between, long stretches came out as holes
  if (act.manual) parts = parts.map((p) => densify(p));
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const part of parts) for (const q of part) { if (q.x < x0) x0 = q.x; if (q.y < y0) y0 = q.y; if (q.x > x1) x1 = q.x; if (q.y > y1) y1 = q.y; }
  // list peaks reached (by coordinates: also outside the map)
  const badges = [];
  for (const [id, d] of discover(badgePts, new Map([[act.id, parts]]))) if (d.first != null) badges.push([id, d.first]);
  const tiles = parts.length ? atlas.tilesIn(x0, y0, x1, y1, 300) : [];
  if (!tiles.length) return { ...meta, outside: true, segs: {}, trav: [], found: [], reveal: [], badges };

  const net = await atlas.merged(tiles), m = 200;
  const near = (k) => {
    const { xs, ys } = net.lines[k];
    for (let i = 0; i < xs.length; i++) if (xs[i] >= x0 - m && xs[i] <= x1 + m && ys[i] >= y0 - m && ys[i] <= y1 + m) return true;
    return false;
  };
  const traversals = new Matcher(net, {}, near).matchActivity(act.id, parts);
  const segs = {}, trav = [];
  for (const t of traversals) {
    const key = net.keys[t.k];
    segs[key] ??= [net.len[t.k], net.cat[t.k], net.cols[t.k].join(","), net.rg[t.k], geomOf(net, t.k)];
    trav.push([key, t.full ? 1 : 0, t.lo, t.hi, t.t0, t.t1]);
  }
  const off = offWays(parts, traversals);
  const lms = await Promise.all(tiles.map((t) => atlas.lm(t)));
  // a summit with no way to it is reached from its access point on a trail
  const pois = lms.flatMap((l) => l.pois).map((p) => (p.c === "peak" ? withAccess(p, accessOf(p, access, badgeFull.filter((k) => k.ax != null && Math.hypot(k.x - p.x, k.y - p.y) < 400))) : p));
  const found = [];
  const disc = discover(pois, new Map([[act.id, parts]]));
  for (const p of pois) {
    const d = disc.get(p.id);
    if (d && d.first != null) found.push([p.id, d.first, p.c, p.n, p.e, p.x, p.y, p.rg]);
  }
  return { ...meta, outside: false, segs, trav, found, reveal: revealFor(act.id, parts), badges, off };
}

/** The stretches of a track on no way of the map (a path it lacks, across a meadow): the track
 * itself, simplified, so the traces have no gaps there. Delta-encoded at the pack's scale. */
function offWays(parts, traversals) {
  const iv = traversals.map((t) => [t.t0 - 15000, t.t1 + 15000]).sort((a, b) => a[0] - b[0]);
  const covered = (t) => { for (const [a, b] of iv) { if (a > t) return false; if (t <= b) return true; } return false; };
  const sc = atlas.scale, out = [];
  const flush = (run) => {
    if (run.length < 3) return;
    let len = 0;
    for (let i = 1; i < run.length; i++) len += Math.hypot(run[i].x - run[i - 1].x, run[i].y - run[i - 1].y);
    // a real stretch, not the scribble of a stop (a start, a rest): it gets somewhere
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const q of run) { if (q.x < x0) x0 = q.x; if (q.x > x1) x1 = q.x; if (q.y < y0) y0 = q.y; if (q.y > y1) y1 = q.y; }
    const span = Math.hypot(x1 - x0, y1 - y0);
    if (len < 80 || span < 70 || len > span * 3) return;
    const f = simplify(run.map((q) => [q.x, q.y]), 4), enc = [];
    let px = 0, py = 0;
    for (let i = 0; i < f.length; i += 2) { const x = Math.round(f[i] * sc), y = Math.round(f[i + 1] * sc); enc.push(i ? x - px : x, i ? y - py : y); px = x; py = y; }
    out.push(enc);
  };
  for (const part of parts) {
    if (part.some((q) => q.t == null)) continue; // no times: no way to tell
    let run = [];
    for (const q of part) { if (covered(q.t)) { flush(run); run = []; } else run.push(q); }
    flush(run);
  }
  return out;
}

/** % of each range's area inside the scratched holes, on a 200 m grid: only
 * cells under a hole are tested; a range's cell count comes from its area. */
function discoveredPct(reveal) {
  const cell = 200, hit = new Map();
  for (const [x, y, r] of reveal) {
    for (let cy = Math.floor((y - r) / cell); cy <= Math.floor((y + r) / cell); cy++) for (let cx = Math.floor((x - r) / cell); cx <= Math.floor((x + r) / cell); cx++) {
      const px = (cx + 0.5) * cell, py = (cy + 0.5) * cell;
      if ((px - x) ** 2 + (py - y) ** 2 <= r * r) hit.set(cx * 1e6 + cy, [px, py]);
    }
  }
  const pts = [...hit.values()];
  return index.ranges.map((rg, i) => {
    const tot = Math.max(1, Math.round((rg.areaKm2 * 1e6) / (cell * cell)));
    let h = 0;
    for (const ring of rings[i]) {
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const [x, y] of ring) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
      for (const [px, py] of pts) if (px >= x0 && px <= x1 && py >= y0 && py <= y1 && pip(px, py, ring)) h++;
    }
    return [Math.min(h, tot), tot];
  });
}

/** Name an outing: where it started and ended, and the main places reached (core/routes.js). */
async function autoName(r, m, settings) {
  const act = await getActivity(r.id);
  if (!act) return null;
  const parts = act.parts;
  if (!parts.length) return null;
  const a = parts[0][0], b = parts[parts.length - 1][parts[parts.length - 1].length - 1];
  const [ax, ay] = atlas.project(a.lon, a.lat), [bx, by] = atlas.project(b.lon, b.lat);
  const near = async (x, y) => {
    const out = [];
    for (const t of atlas.tilesIn(x - 5000, y - 5000, x + 5000, y + 5000)) {
      const lm = await atlas.lm(t), d = (q) => Math.hypot(q.x - x, q.y - y);
      for (const p of lm.places || []) out.push({ n: p.n, k: p.p, d: d(p) });
      for (const p of lm.anchors || []) out.push({ n: p.n, k: p.k, d: d(p) });
      for (const p of lm.pois || []) if (p.c === "hut" && p.n) out.push({ n: p.n, k: "hut", d: d(p) });
    }
    return out;
  };
  const visited = (r.found || []).map(([, t, c, n, e, x, y]) => ({ n, c, e, t, ...(badgesOf({ c, n, x, y }, badgeFull) || {}) }));
  return routeName({
    start: pickAnchor(await near(ax, ay)), end: pickAnchor(await near(bx, by)),
    loop: Math.hypot(ax - bx, ay - by) < 1000, km: m?.km || 0, visited, fallback: m?.name || "",
  });
}

/** Route names for outings that have none yet (or older naming / map data): in the
 * background after the map is up. Returns {id: name} of the new ones. */
async function nameAll() {
  const metaById = new Map((await allMeta()).map((m) => [m.id, m])), nameSig = `${NAME_V}|${index.snapshot}`, out = {};
  for (const r of lastLive) {
    if (r.autoSig === nameSig) continue;
    try { r.auto = await autoName(r, metaById.get(r.id), lastSettings); } catch (e) { console.warn("name", r.id, e); r.auto = null; }
    r.autoSig = nameSig;
    await putResult(r);
    out[r.id] = r.auto;
  }
  return out;
}

/** Outings that passed within their scratched band of a point (newest first). */
// ---- a town's or a village's built-up area (core/builtup.js): for "the outings that went through the place"
function inRing(R, x, y) {
  const { xs, ys } = R;
  let c = false;
  for (let i = 0, j = xs.length - 1; i < xs.length; j = i++) if (ys[i] > y !== ys[j] > y && x < ((xs[j] - xs[i]) * (y - ys[i])) / (ys[j] - ys[i]) + xs[i]) c = !c;
  return c;
}
/** Distance from (x, y) to a ring (0 inside). */
function ringDist(R, x, y) {
  if (inRing(R, x, y)) return 0;
  const { xs, ys } = R;
  let best = Infinity;
  for (let i = 0, j = xs.length - 1; i < xs.length; j = i++) {
    const ax = xs[j], ay = ys[j], dx = xs[i] - ax, dy = ys[i] - ay, L = dx * dx + dy * dy;
    const t = L ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / L)) : 0;
    const d = Math.hypot(x - ax - t * dx, y - ay - t * dy);
    if (d < best) best = d;
  }
  return best;
}
const boxGap = (a, b) => Math.max(0, a[0] - b[2], b[0] - a[2], a[1] - b[3], b[1] - a[3]);
// how far a place may reach from its name, and the gaps between its patches that still join them
const BUILT = { city: { reach: 5000, close: 120 }, town: { reach: 3000, close: 90 }, village: { reach: 1500, close: 60 } };
async function placeArea(x, y, kind) {
  const o = BUILT[kind] || BUILT.village, rings = [];
  for (const t of atlas.tilesIn(x - o.reach, y - o.reach, x + o.reach, y + o.reach)) {
    const lm = await atlas.lm(t);
    for (const [cat, rs] of lm.areas || []) if (cat === "residential" && rs.length) { const [xs, ys] = decodeLine(rs[0], atlas.scale); rings.push({ xs, ys }); }
  }
  const A = builtUp(rings, x, y, o);
  return A ? [A] : null;
}

async function outingsNear(x, y, R = 0, area = null) {
  if (area) {
    // a place's built-up area: an outing whose band touches it
    const meta = new Map((await allMeta()).map((m) => [m.id, m])), out = [];
    let bx0 = Infinity, by0 = Infinity, bx1 = -Infinity, by1 = -Infinity;
    for (const A of area) { bx0 = Math.min(bx0, A.b[0]); by0 = Math.min(by0, A.b[1]); bx1 = Math.max(bx1, A.b[2]); by1 = Math.max(by1, A.b[3]); }
    for (const r of lastLive) {
      const v = r.reveal || [];
      let hit = false;
      for (let i = 0; i < v.length && !hit; i += 4) {
        const cx = v[i], cy = v[i + 1], rr = v[i + 2] * 0.9;
        if (cx < bx0 - rr || cx > bx1 + rr || cy < by0 - rr || cy > by1 + rr) continue;
        for (const A of area) if (boxGap(A.b, [cx - rr, cy - rr, cx + rr, cy + rr]) === 0 && ringDist(A, cx, cy) <= rr) { hit = true; break; }
      }
      if (hit) out.push(r.id);
    }
    return out.sort((a, b) => (meta.get(b)?.start || 0) - (meta.get(a)?.start || 0));
  }
  return outingsNearPoint(x, y, R);
}
async function outingsNearPoint(x, y, R = 0) {
  // R > 0: a place (a town, a village) of about that radius - an outing that only touched it counts
  const meta = new Map((await allMeta()).map((m) => [m.id, m])), out = [];
  for (const r of lastLive) {
    const v = r.reveal || [];
    for (let i = 0; i < v.length; i += 4) {
      const dx = v[i] - x, dy = v[i + 1] - y, rr = v[i + 2] * 0.9 + R;
      if (dx * dx + dy * dy <= rr * rr) { out.push(r.id); break; }
    }
  }
  return out.sort((a, b) => (meta.get(b)?.start || 0) - (meta.get(a)?.start || 0));
}

/** A track for drawing: pack metres, simplified (~4 m), as flat [x0, y0, x1, y1, ...] per part. */
async function trackOf(id) {
  const act = await getActivity(id);
  if (!act) return null;
  const parts = act.parts.map((p) => {
    const xy = p.map((q) => atlas.project(q.lon, q.lat));
    return simplify(xy, 4);
  });
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const f of parts) for (let i = 0; i < f.length; i += 2) { x0 = Math.min(x0, f[i]); x1 = Math.max(x1, f[i]); y0 = Math.min(y0, f[i + 1]); y1 = Math.max(y1, f[i + 1]); }
  return { parts, box: [x0, y0, x1, y1] };
}

/** A small picture of an outing's shape (only its line, as on Strava): an SVG path in a 40x40 box. */
async function thumbOf(id) {
  const act = await getActivity(id);
  if (!act?.parts?.length) return null;
  const parts = act.parts.map((p) => p.map((q) => atlas.project(q.lon, q.lat))).filter((p) => p.length > 1);
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of parts) for (const [x, y] of p) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  const span = Math.max(x1 - x0, y1 - y0);
  if (!(span > 0)) return null;
  const k = 34 / span, ox = 20 - ((x1 - x0) * k) / 2, oy = 20 - ((y1 - y0) * k) / 2, f = (v) => Math.round(v * 10) / 10;
  return parts.map((p) => {
    const q = simplify(p, span / 90);
    let d = "";
    for (let i = 0; i < q.length; i += 2) d += (i ? " " : "M") + f(ox + (q[i] - x0) * k) + " " + f(oy + (q[i + 1] - y0) * k);
    return d;
  }).join("");
}

/** Elevation profile: samples with height, slope and marked trails (core/profile.js);
 * heights the track lacks come from the map's contours. */
async function profileOf(id) {
  const act = await getActivity(id);
  if (!act) return null;
  const parts = act.parts, r = lastLive.find((q) => q.id === id);
  const travs = (r?.trav || []).map(([key, , , , t0, t1]) => [t0, t1, r.segs?.[key]?.[2] || ""]).filter((q) => q[2]);
  const p = sampleProfile(parts, travs, atlas.project);
  if (!p) return null;
  await mapHeights(p);
  return finishProfile(p);
}

/**
 * How well the map's heights (from the contours) match the watch's along your outings: per sample
 * the difference, per outing the climb both ways (the map's smoothed as a plan's). For the report.
 * -> {n, samples, medAbs, bias, p90, climbRatio} or null
 */
async function elevCheck(ids) {
  const diffs = [], ratios = [];
  let n = 0;
  for (const id of ids) {
    const act = await getActivity(id);
    if (!act) continue;
    const g = sampleProfile(act.parts, [], atlas.project);
    if (!g || g.h.filter(Number.isFinite).length < g.h.length * 0.8) continue; // no watch heights
    const m = { ...g, h: new Float32Array(g.h.length).fill(NaN) };
    for (let i = 0; i < g.h.length; i++) {
      const x = g.x[i], y = g.y[i], sets = await Promise.all(atlas.tilesIn(x - 700, y - 700, x + 700, y + 700).map(contoursOf));
      const e = heightAt(sets, x, y);
      if (e) m.h[i] = e.h;
      if (e && Number.isFinite(g.h[i]) && i % 3 === 0) diffs.push(e.h - g.h[i]);
    }
    if (m.h.filter(Number.isFinite).length < m.h.length * 0.8) continue; // off the map
    const climb = (P) => { let u = 0; for (let i = 1; i < P.h.length; i++) { const d = P.h[i] - P.h[i - 1]; if (d > 0) u += d; } return u; };
    m.fromMap = true;
    const watch = climb(finishProfile(g)), map = climb(finishProfile(m, PLAN_SMOOTH));
    if (watch > 100) ratios.push(map / watch);
    n++;
  }
  if (!diffs.length) return null;
  const med = (a) => { const b = [...a].sort((p, q) => p - q); return b[Math.floor(b.length / 2)]; };
  const abs = diffs.map(Math.abs).sort((p, q) => p - q);
  return { n, samples: diffs.length, medAbs: Math.round(med(abs)), bias: Math.round(med(diffs)), p90: Math.round(abs[Math.floor(abs.length * 0.9)]), climbRatio: ratios.length ? +med(ratios).toFixed(2) : null };
}

/** Contour lines of a tile, decoded once (a few kept). */
const contourCache = new Map();
function contoursOf(t) {
  if (!contourCache.has(t.no)) {
    contourCache.set(t.no, atlas.load(atlas.path(t, "terrain.json")).then((tr) => contourLines(tr, decodeLine, atlas.scale)).catch(() => []));
    while (contourCache.size > 12) contourCache.delete(contourCache.keys().next().value);
  }
  return contourCache.get(t.no);
}
/** The "Nachylenie" layer: per tile around the box (but those the map has), the steep stretches of its ways. */
const slopeCache = new Map();
async function slopeTiles(x0, y0, x1, y1, have) {
  const out = [];
  for (const t of atlas.tilesIn(x0, y0, x1, y1)) {
    if (have.includes(t.no)) continue;
    if (!slopeCache.has(t.no)) {
      slopeCache.set(t.no, (async () => {
        const [net, sets] = await Promise.all([atlas.net(t), Promise.all(atlas.tilesIn(...t.ext, 100).map(contoursOf))]);
        return slopeRuns(net, contourIndex(sets)).map((r) => ({ b: r.b, c: r.c, line: r.line.map(Math.round) }));
      })().catch(() => []));
      while (slopeCache.size > 6) slopeCache.delete(slopeCache.keys().next().value);
    }
    out.push({ no: t.no, runs: await slopeCache.get(t.no) });
  }
  return out;
}
/** Heights a profile lacks (no GPS heights), from the contours. */
async function mapHeights(p) {
  let miss = 0;
  for (const v of p.h) if (!Number.isFinite(v)) miss++;
  if (!miss) return;
  for (let i = 0; i < p.h.length; i++) {
    if (Number.isFinite(p.h[i])) continue;
    const x = p.x[i], y = p.y[i], sets = await Promise.all(atlas.tilesIn(x - 700, y - 700, x + 700, y + 700).map(contoursOf));
    const e = heightAt(sets, x, y);
    if (e) p.h[i] = e.h;
  }
  p.fromMap = miss > p.h.length / 2;
}

// ---- route planning: waypoints -> legs along the network, with the profile and the time
const routers = new Map();
const LEG_STEP = 20; // m: one grid for every leg, whatever the route's length
const legMemo = new Map();
/** A leg's standard time, climb and descent (whole metres) from its own profile; the same line always
 * gives the same figures. */
/** A leg's figures on hard ground: its time (and the time per gradient) longer by its share of it. */
function hardened(f, st) {
  const k = st?.m > 0 && st.dfx ? 1 + st.dfx / st.m : 1;
  if (st) st.k = k;
  return k === 1 ? f : { ...f, std: f.std * k, bins: f.bins?.map((b) => Math.round(b * k)) };
}
async function legFigures(ln) {
  const key = ln.join(",");
  if (legMemo.has(key)) return legMemo.get(key);
  let D = 0;
  const part = [];
  for (let i = 0; i < ln.length; i += 2) { if (i) D += Math.hypot(ln[i] - ln[i - 2], ln[i + 1] - ln[i - 1]); const [lon, lat] = atlas.unproject(ln[i], ln[i + 1]); part.push({ lat, lon, t: D }); }
  const bins = GBINS.map(() => 0).concat([0]);
  let f = { std: D > 0 ? stdMs(D, 0) : 0, up: 0, down: 0, bins };
  if (D > 0) bins[gbin(0)] = f.std;
  let P = D > 60 ? sampleProfile([part], [], atlas.project, { max: Infinity, minStep: LEG_STEP }) : null;
  if (P) {
    await mapHeights(P);
    P = finishProfile(P, PLAN_SMOOTH);
    let std = 0, up = 0, down = 0, steep = 0;
    bins.fill(0);
    for (let i = 1; i < P.d.length; i++) {
      const dx = P.d[i] - P.d[i - 1], g = (P.slope[i - 1] + P.slope[i]) / 200, dh = P.h[i] - P.h[i - 1], t = stdMs(dx, g);
      std += t; bins[gbin(g)] += t;
      if (Number.isFinite(g) && -g > steep) steep = -g;
      if (Number.isFinite(dh)) { if (dh > 0) up += dh; else down -= dh; }
    }
    // the last bit of the line past the grid's last sample: flat
    const tail = stdMs(D - P.d.at(-1), 0);
    std += tail; bins[gbin(0)] += tail;
    f = { std, up: Math.round(up), down: Math.round(down), bins: bins.map(Math.round), steep: Math.round(steep * 100) };
  }
  legMemo.set(key, f);
  while (legMemo.size > 200) legMemo.delete(legMemo.keys().next().value);
  return f;
}
let walkedSet = null, walkedOf = null;
function walkedKeys() {
  if (walkedOf !== lastLive) { walkedSet = new Set(); for (const r of lastLive) for (const t of r.trav || []) walkedSet.add(t[0]); walkedOf = lastLive; }
  return walkedSet;
}
/** A router over the tiles around a box (kept for the next call). */
async function routerFor(x0, y0, x1, y1, heights) {
  const m = Math.max(2500, 0.3 * Math.hypot(x1 - x0, y1 - y0)), tiles = atlas.tilesIn(x0, y0, x1, y1, m);
  const key = tiles.map((t) => t.no).join(",") + (heights ? "|h" : "");
  // one already made (or being made) over these tiles or more, with heights if they are needed: that one
  for (const [k, r] of routers) {
    const [nos, h] = k.split("|"), have = new Set(nos.split(","));
    if ((h || !heights) && tiles.every((t) => have.has(String(t.no)))) { const R = await r; R.walked = walkedKeys(); return R; }
  }
  const job = buildRouter(tiles, heights);
  routers.set(key, job);
  while (routers.size > 3) routers.delete(routers.keys().next().value);
  try { return await job; } catch (e) { routers.delete(key); throw e; }
}
/** A plan's start set: the router around it made now, while the next point is looked for (the first leg was slow). */
function warmRouter(x, y) {
  (async () => {
    await routerFor(x - 4000, y - 4000, x + 4000, y + 4000, true);
    // and what the first route reads after it: the places along (lm) and the heights (the contours' index, made on first use)
    for (const t of atlas.tilesIn(x - 2500, y - 2500, x + 2500, y + 2500)) { await atlas.lm(t).catch(() => null); const sets = [await contoursOf(t)]; heightAt(sets, x, y); }
  })().catch(() => {});
}
async function buildRouter(tiles, heights) {
  const net = await atlas.merged(tiles);
  let height = null;
  if (heights) { const sets = await Promise.all(tiles.map(contoursOf)); height = (x, y) => heightAt(sets, x, y, { R: 400 })?.h ?? null; }
  const wall = wallCost(net, contourIndex(await Promise.all(tiles.map(contoursOf)))); // (steep unmarked shortcuts cost more)
  return new Router(net, { walked: walkedKeys(), height, wall });
}
/**
 * pts: [[x, y]] (pack metres), o: {mode, steep, roads, fresh}
 * -> {pts (snapped), legs: [{line, m, trail, path, road, fresh, std}], line, km, up, down, std, P, places}
 */
/** Cable cars and chair lifts near a box (from the tiles' lm.json: [kind, name, line]): {c, n, xs, ys, m}. */
async function liftsNear(x0, y0, x1, y1) {
  const out = [], seen = new Set();
  for (const t of atlas.tilesIn(x0, y0, x1, y1, 1500)) {
    const lm = await atlas.lm(t).catch(() => null);
    for (const [c, n, flat] of lm?.lifts || []) {
      if (seen.has(flat)) continue;
      seen.add(flat);
      const [xs, ys] = decodeLine(flat, atlas.scale);
      let m = 0; for (let i = 1; i < xs.length; i++) m += Math.hypot(xs[i] - xs[i - 1], ys[i] - ys[i - 1]);
      if (m > 200) out.push({ c, n, xs: Array.from(xs), ys: Array.from(ys), m });
    }
  }
  return out;
}
/** The stations of the cable cars and chair lifts in a box (drag lifts not: no ride for walkers): each lift's
 * ends, the lower one first (by the contours), its ride time. */
async function liftStations(x0, y0, x1, y1) {
  const out = [];
  for (const L of await liftsNear(x0, y0, x1, y1)) {
    if (L.c !== "lift_main" && L.c !== "lift_chair") continue;
    const n = L.xs.length, ends = [[L.xs[0], L.ys[0]], [L.xs[n - 1], L.ys[n - 1]]];
    const hs = [];
    for (const [x, y] of ends) { const sets = await Promise.all(atlas.tilesIn(x - 500, y - 500, x + 500, y + 500).map(contoursOf)); hs.push(heightAt(sets, x, y, { R: 400 })?.h ?? null); }
    const flip = hs[0] != null && hs[1] != null && hs[0] > hs[1];
    const xs = flip ? [...L.xs].reverse() : L.xs, ys = flip ? [...L.ys].reverse() : L.ys, [ha, hb] = flip ? [hs[1], hs[0]] : hs;
    out.push({ lid: `${Math.round(xs[0])}_${Math.round(ys[0])}`, c: L.c, n: L.n || null, m: Math.round(L.m), ms: rideMs(L),
      xs: xs.map(Math.round), ys: ys.map(Math.round), lo: ha != null ? Math.round(ha) : null, hi: hb != null ? Math.round(hb) : null });
  }
  return out;
}
/** A lift's ride: the time on it (a little waiting included), by kind. */
const rideMs = (L) => ((L.m / (L.c === "lift_main" ? 6 : 2.4)) + 8 * 60) * 1000;
/** One walking leg between two points (pack metres), with the options: {line, runs, stats} or null. */
async function walkLeg([ax, ay], [bx, by], opts) {
  const heights = !!(opts.mode.time || opts.steep);
  const R = await routerFor(Math.min(ax, bx), Math.min(ay, by), Math.max(ax, bx), Math.max(ay, by), heights);
  const a = R.snap(ax, ay), b = a ? R.snap(bx, by, 500, R.comp[a.k]) : null, r = a && b ? R.leg(a, b, opts) : null;
  return r ? { line: R.line(r.pieces), runs: R.runs(r.pieces), stats: R.stats(r.pieces) } : null;
}
/** A leg that rides a lift (via.lift: {xs, ys, ms, n}): walk to its station, ride, walk on. */
async function liftLeg(A, B, lift, opts) {
  const n = lift.xs.length, S = [lift.xs[0], lift.ys[0]], E = [lift.xs[n - 1], lift.ys[n - 1]];
  const w1 = await walkLeg(A, S, opts), w2 = await walkLeg(E, B, opts);
  if (!w1 || !w2) return null;
  const rl = []; for (let i = 0; i < n; i++) rl.push(lift.xs[i], lift.ys[i]);
  let lm = 0; for (let i = 1; i < n; i++) lm += Math.hypot(lift.xs[i] - lift.xs[i - 1], lift.ys[i] - lift.ys[i - 1]);
  const ride = { cols: "", cat: -2, m: lm, line: rl, key: "|lift" };
  const f1 = hardened(await legFigures(w1.line), w1.stats), f2 = hardened(await legFigures(w2.line), w2.stats);
  const s1 = w1.stats, s2 = w2.stats, shift = (cols, d) => cols.map(([a, b, c]) => [a + d, b + d, c]);
  const stats = { m: s1.m + lm + s2.m, trail: s1.trail + s2.trail, path: s1.path + s2.path, road: s1.road + s2.road, fresh: s1.fresh + s2.fresh, hard: (s1.hard || 0) + (s2.hard || 0), dfx: 0,
    cols: [...s1.cols, ...shift(s2.cols, s1.m + lm)] };
  const bins = f1.bins.map((b, i) => b + (f2.bins[i] || 0));
  return { line: [...w1.line, ...rl, ...w2.line], runs: [...w1.runs, ride, ...w2.runs], stats, fig: { std: f1.std + f2.std + lift.ms, up: f1.up + f2.up, down: f1.down + f2.down, bins, steep: Math.max(f1.steep || 0, f2.steep || 0) } };
}
const optsOf = (o) => ({ mode: MODES[o.mode] || MODES.zalecana, steep: !!o.steep, roads: !!o.roads, fresh: !!o.fresh });
/** The ways (global keys) of a leg's pieces: what the next legs had rather not walk again. */
const usedOf = (R, pieces, into) => { for (const [k] of pieces) into.add(R.net.keys[k]); return into; };
async function planRoute(pts, o) {
  const legs = [], snapped = [], used = new Set(); // (legs marked "other": not back the way the route came, if it can be helped)
  for (let i = 0; i < pts.length - 1; i++) {
    const opts = optsOf({ ...o, ...(o.legs?.[i] || {}) }), heights = !!(opts.mode.time || opts.steep);
    if (o.legs?.[i]?.other) opts.used = used;
    const [ax, ay] = pts[i], [bx, by] = pts[i + 1];
    if (o.legs?.[i]?.lift) { // this leg rides a lift (chosen on the card): walk, ride, walk
      const L = await liftLeg(pts[i], pts[i + 1], o.legs[i].lift, optsOf({ ...o, lift: null }));
      if (L) {
        if (!i) snapped.push([ax, ay]);
        snapped.push([bx, by]);
        legs.push({ line: L.line, runs: L.runs, ...L.stats, fixed: L.fig });
        continue;
      }
    }
    const R = await routerFor(...(o.box || [Math.min(ax, bx), Math.min(ay, by), Math.max(ax, bx), Math.max(ay, by)]), heights); // (box: one router for many ways)
    const a = R.snap(ax, ay), b = a ? R.snap(bx, by, 500, R.comp[a.k]) : R.snap(bx, by);
    if (!i) snapped.push(a ? [a.x, a.y] : null);
    snapped.push(b ? [b.x, b.y] : null);
    const r = a && b ? R.leg(a, b, opts) : null;
    if (!r) { const m = Math.hypot(bx - ax, by - ay); legs.push({ line: [ax, ay, bx, by], m, none: true, cols: [], runs: [{ key: "|-1", cols: "", cat: -1, m, line: [ax, ay, bx, by] }] }); continue; }
    legs.push({ line: R.line(r.pieces), runs: R.runs(r.pieces), ...R.stats(r.pieces) });
    usedOf(R, r.pieces, used);
  }
  if (pts.length === 1) { const R = await routerFor(pts[0][0], pts[0][1], pts[0][0], pts[0][1], false), a = R.snap(...pts[0]); snapped.push(a ? [a.x, a.y] : null); setTimeout(() => warmRouter(...pts[0]), 0); }
  // the whole line, its profile (heights from the contours) and the standard time per leg
  const line = [], bounds = [0], travs = [], surf = []; // (surf: the ground along, [d0, d1, kind] in the line's metres)
  let D = 0;
  for (const L of legs) {
    for (let i = 0; i < L.line.length; i += 2) { if (line.length) D += Math.hypot(L.line[i] - line[line.length - 2], L.line[i + 1] - line[line.length - 1]); line.push(L.line[i], L.line[i + 1]); }
    for (const [d0, d1, c] of L.cols || []) travs.push([bounds.at(-1) + d0, bounds.at(-1) + d1, c]);
    { const b = bounds.at(-1), k = L.m ? (D - b) / L.m : 1; for (const [d0, d1, g] of L.surf || []) surf.push([b + d0 * k, b + d1 * k, g]); }
    bounds.push(D);
  }
  // each leg's figures on its own (a fixed grid, its own heights): adding a point never changes the
  // legs before it, and the route's figures are their sums
  let std = 0, up = 0, down = 0;
  for (let i = 0; i < legs.length; i++) {
    const f = legs[i].fixed || hardened(await legFigures(legs[i].line), legs[i]);
    Object.assign(legs[i], f, { km: (bounds[i + 1] - bounds[i]) / 1000 });
    std += f.std; up += f.up; down += f.down;
  }
  let P = null;
  if (line.length >= 4 && D > 60) {
    const part = [];
    let d = 0;
    for (let i = 0; i < line.length; i += 2) { if (i) d += Math.hypot(line[i] - line[i - 2], line[i + 1] - line[i - 1]); const [lon, lat] = atlas.unproject(line[i], line[i + 1]); part.push({ lat, lon, t: d }); }
    P = sampleProfile([part], travs, atlas.project);
    if (P) {
      await mapHeights(P);
      P = finishProfile(P, PLAN_SMOOTH);
      // standard time (Tobler) along the profile, cumulative: each leg's share
      const T = new Float64Array(P.d.length);
      for (let i = 1; i < P.d.length; i++) {
        const dx = P.d[i] - P.d[i - 1], g = (P.slope[i - 1] + P.slope[i]) / 200;
        T[i] = T[i - 1] + stdMs(dx, g);
      }
      // hard ground (sac_scale, rock, scree): each leg's time stretched by its share of it
      { // a leg riding a lift: its share of the profile takes the ride's time, not walking up the cable
        const raw = legs.map(() => 0);
        for (let j = 0, i = 1; i < P.d.length; i++) { while (j < legs.length - 1 && P.d[i] > bounds[j + 1]) j++; raw[j] += T[i] - T[i - 1]; }
        legs.forEach((L, j) => { if (L.fixed && raw[j] > 0) L.k = L.fixed.std / raw[j]; }); }
      { let acc = 0, prev = 0; for (let j = 0, i = 1; i < P.d.length; i++) { while (j < legs.length - 1 && P.d[i] > bounds[j + 1]) j++; const dt = T[i] - prev; prev = T[i]; acc += dt * (legs[j]?.k || 1); T[i] = acc; } }
      P.T = T;
      P.t.fill(NaN); // no clock on a plan
      P.surf = surf;
    }
  }
  // the description: the route's runs placed along it, joined into steps (a trail colour, a path, a road)
  const all = [];
  let d0 = 0;
  for (const L of legs) for (const r of L.runs) { all.push({ ...r, d0, d1: d0 + r.m }); d0 += r.m; }
  const k = d0 > 0 ? D / d0 : 1; // the runs' metres to the line's (the joins drop a few)
  for (const r of all) { r.d0 *= k; r.d1 *= k; }
  const steps = describeRuns(all);

  const places = [];
  if (line.length >= 4) {
    const xs = [], ys = [];
    for (let i = 0; i < line.length; i += 2) { xs.push(line[i]); ys.push(line[i + 1]); }
    const PL = new Polyline(Float64Array.from(xs), Float64Array.from(ys));
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (let i = 0; i < xs.length; i++) { x0 = Math.min(x0, xs[i]); x1 = Math.max(x1, xs[i]); y0 = Math.min(y0, ys[i]); y1 = Math.max(y1, ys[i]); }
    const lms = await Promise.all(atlas.tilesIn(x0, y0, x1, y1, 200).map((t) => atlas.lm(t)));
    const near = (x, y, r = 60) => { if (x < x0 - r - 20 || x > x1 + r + 20 || y < y0 - r - 20 || y > y1 + r + 20) return null; let best = null; for (let e = 0; e < xs.length - 1; e++) { const [dd, sAt] = PL.projectEdge(e, x, y); if (dd <= r && (!best || dd < best[0])) best = [dd, sAt]; } return best; };
    const seen = new Set();
    for (const lm of lms) for (const p0 of lm.pois) {
      if (!p0.n || seen.has(p0.id)) continue;
      const p = p0.c === "peak" ? withAccess(p0, accessOf(p0, access, badgeFull.filter((k) => k.ax != null && Math.hypot(k.x - p0.x, k.y - p0.y) < 400))) : p0;
      const hit = near(p.x, p.y, p.c === "hut" ? 160 : 60) || (p.ax != null ? near(p.ax, p.ay) : null); // (a hut stands a little off its trail)
      if (!hit) continue;
      seen.add(p.id);
      places.push({ id: p.id, c: p.c, n: p.n, e: p.e, x: p.x, y: p.y, d: hit[1] });
    }
    places.sort((a, b) => a.d - b.d);
  }
  // each step: its time (the standard), climb, where it ends (a named place there, else the nearest name) and how high
  const at = (dd) => (P ? Math.min(P.d.length - 1, Math.max(0, Math.round(dd / P.step))) : 0);
  const tAt = (dd) => (P?.T ? P.T[at(dd)] : 0);
  for (const st of steps) {
    st.m = st.d1 - st.d0; st.std = tAt(st.d1) - tAt(st.d0);
    let su = 0, sd = 0;
    if (P) for (let i = at(st.d0) + 1; i <= at(st.d1); i++) { const dh = P.h[i] - P.h[i - 1]; if (Number.isFinite(dh)) { if (dh > 0) su += dh; else sd -= dh; } }
    st.up = Math.round(su); st.down = Math.round(sd);
    st.h = P && Number.isFinite(P.h[at(st.d1)]) ? Math.round(P.h[at(st.d1)]) : null;
    const near = places.filter((q) => Math.abs(q.d - st.d1) < 220).sort((a, b) => Math.abs(a.d - st.d1) - Math.abs(b.d - st.d1))[0];
    if (near) st.to = near.n;
    else {
      const j = Math.min(line.length - 2, 2 * Math.round(((line.length / 2 - 1) * st.d1) / Math.max(1, D)));
      const nm = line.length >= 4 ? await nameAt(line[j], line[j + 1], 350) : null;
      if (nm) st.to = nm.n;
    }
  }
  const bins = GBINS.map(() => 0).concat([0]);
  for (const L of legs) L.bins?.forEach((v, b) => (bins[b] += v));
  const hardKm = legs.reduce((s, L) => s + (L.hard || 0), 0) / 1000;
  return { hardKm, bins, pts: snapped, legs: legs.map((L) => ({ m: L.m, km: L.km, up: L.up, down: L.down, bins: L.bins, trail: L.trail || 0, path: L.path || 0, road: L.road || 0, fresh: L.fresh || 0, std: L.std || 0, none: !!L.none, runs: L.runs.map(({ cols, cat, line: ln }) => ({ cols, cat, line: ln })) })), line, km: D / 1000, up, down, std, P, places, bounds, steps, rides: all.filter((r) => r.cat === -2).map((r) => ({ d0: r.d0, d1: r.d1 })) };
}

/** Quick legs while a point is dragged: just the lines, as runs (no profile, no places). */
async function planLegs(pairs, o) {
  const out = [];
  for (let j = 0; j < pairs.length; j++) {
    const [[ax, ay], [bx, by]] = pairs[j], opts = optsOf({ ...o, ...(o.legOpts?.[j] || {}) }), heights = !!(opts.mode.time || opts.steep);
    const R = await routerFor(Math.min(ax, bx), Math.min(ay, by), Math.max(ax, bx), Math.max(ay, by), heights);
    const a = R.snap(ax, ay), b = a ? R.snap(bx, by, 500, R.comp[a.k]) : null, r = a && b ? R.leg(a, b, opts) : null;
    out.push(r ? R.runs(r.pieces).map(({ cols, cat, line: ln }) => ({ cols, cat, line: ln })) : [{ cols: "", cat: -1, line: [ax, ay, bx, by] }]);
  }
  return out;
}

/**
 * Other ways for one leg (a -> b) than the one taken: faster, over trails not walked yet, gentler
 * (no steep descents). Only the ones that really go another way and give something: the plan keeps
 * its points, the card offers them at that leg.  -> [{kind, std, up, down, km, fresh, steep}] with
 * the base leg's figures as {base}.
 */
const VARIANTS = { szybciej: { mode: "najszybsza" }, nowe: { mode: "nieznana" }, lagodniej: { mode: "zalecana", steep: true } };
async function legVariants(a0, b0, base, skip = null) {
  const go = async (o) => {
    const opts = optsOf(o), heights = !!(opts.mode.time || opts.steep);
    const [ax, ay] = a0, [bx, by] = b0;
    const R = await routerFor(Math.min(ax, bx), Math.min(ay, by), Math.max(ax, bx), Math.max(ay, by), heights);
    const a = R.snap(ax, ay), b = a ? R.snap(bx, by, 500, R.comp[a.k]) : null, r = a && b ? R.leg(a, b, opts) : null;
    if (!r) return null;
    const line = R.line(r.pieces), st = R.stats(r.pieces), f = hardened(await legFigures(line), st);
    let m = 0;
    for (let i = 2; i < line.length; i += 2) m += Math.hypot(line[i] - line[i - 2], line[i + 1] - line[i - 1]);
    return { line, km: m / 1000, fresh: st.fresh || 0, ...f };
  };
  const cells = (ln) => { const S = new Set(); for (let i = 0; i < ln.length - 2; i += 2) { const L = Math.hypot(ln[i + 2] - ln[i], ln[i + 3] - ln[i + 1]), n = Math.max(1, Math.ceil(L / 20)); for (let k = 0; k <= n; k++) S.add(`${Math.round((ln[i] + (ln[i + 2] - ln[i]) * k / n) / 40)},${Math.round((ln[i + 1] + (ln[i + 3] - ln[i + 1]) * k / n) / 40)}`); } return S; };
  const B = await go(base || {});
  if (!B) return { base: null, out: [] };
  const bc = cells(B.line), out = [];
  for (const [kind, o] of Object.entries(VARIANTS)) {
    if ((base?.mode || "zalecana") === o.mode && !!base?.steep === !!o.steep) continue;
    const V = await go({ ...base, ...o });
    if (!V) continue;
    // how much of it runs elsewhere
    const vc = cells(V.line);
    let off = 0;
    for (const c of vc) { const [x, y] = c.split(",").map(Number); let hit = false; for (let dx = -1; dx <= 1 && !hit; dx++) for (let dy = -1; dy <= 1 && !hit; dy++) hit = bc.has(`${x + dx},${y + dy}`); if (!hit) off++; }
    const dt = V.std - B.std;
    if (off / Math.max(1, vc.size) < 0.15) continue;
    const worth = kind === "szybciej" ? dt <= -Math.max(5 * 60000, B.std * 0.08)
      : kind === "nowe" ? V.fresh - B.fresh >= 500 && dt <= 60 * 60000
      : B.steep >= 25 && V.steep <= B.steep - 5 && dt <= 45 * 60000;
    if (worth) out.push({ kind, opts: o, std: V.std, up: V.up, down: V.down, km: V.km, fresh: V.fresh, steep: V.steep, line: V.line });
  }
  // through a place worth it near the way (a peak of the lists, a high peak, a hut): "przez Kasprowy · +40 min"
  try {
    const L = B.line, xs = [], ys = [];
    for (let i = 0; i < L.length; i += 2) { xs.push(L[i]); ys.push(L[i + 1]); }
    let bx0 = Infinity, by0 = Infinity, bx1 = -Infinity, by1 = -Infinity;
    for (let i = 0; i < xs.length; i++) { bx0 = Math.min(bx0, xs[i]); bx1 = Math.max(bx1, xs[i]); by0 = Math.min(by0, ys[i]); by1 = Math.max(by1, ys[i]); }
    const dist = (x, y) => { let d = Infinity; for (let i = 0; i < xs.length; i += 3) d = Math.min(d, Math.hypot(xs[i] - x, ys[i] - y)); return d; };
    const lms = await Promise.all(atlas.tilesIn(bx0, by0, bx1, by1, 1800).map((t) => atlas.lm(t)));
    const skipIds = new Set(skip?.ids || []);
    const listed = new Set(badgeFull.filter((k) => k.x >= bx0 - 1800 && k.x <= bx1 + 1800 && k.y >= by0 - 1800 && k.y <= by1 + 1800).map((k) => `${Math.round(k.x / 200)},${Math.round(k.y / 200)}`));
    const score = (p) => p.c === "hut" ? 60 : p.c === "peak" ? (p.e || 0) / 25 + (listed.has(`${Math.round(p.x / 200)},${Math.round(p.y / 200)}`) ? 60 : 0) : 0;
    const cands = lms.flatMap((l) => l.pois).filter((p) => p.n && (p.c === "peak" || p.c === "hut") && score(p) >= 60)
      .filter((p) => !skipIds.has(p.id) && !(skip?.pts || []).some(([x, y]) => Math.hypot(x - p.x, y - p.y) < 250))
      .map((p) => ({ p, d: dist(p.x, p.y) })).filter((q) => q.d > 150 && q.d < 1800).sort((a, b) => score(b.p) - score(a.p)).slice(0, 3);
    let best = null;
    for (const { p } of cands) {
      const opts = optsOf(base || {});
      const w1 = await walkLeg(a0, [p.x, p.y], opts), w2 = w1 && await walkLeg([p.x, p.y], b0, opts);
      if (!w1 || !w2) continue;
      const f1 = hardened(await legFigures(w1.line), w1.stats), f2 = hardened(await legFigures(w2.line), w2.stats), std = f1.std + f2.std, dt = std - B.std;
      if (dt < 10 * 60000 || dt > 75 * 60000) continue; // a real detour, but not half a day
      const val = score(p) / (dt / 60000);
      if (!best || val > best.val) best = { val, kind: "przez", opts: { insert: { x: p.x, y: p.y, n: p.n } }, std, up: f1.up + f2.up, down: f1.down + f2.down, km: (w1.stats.m + w2.stats.m) / 1000, fresh: w1.stats.fresh + w2.stats.fresh, steep: Math.max(f1.steep || 0, f2.steep || 0), name: p.n, line: [...w1.line, ...w2.line] };
    }
    if (best) { delete best.val; out.push(best); }
  } catch (e) { console.warn("through variant", e); }
  // a cable car or a chair lift near the way: walk to it, ride, walk on (only when it saves a good while)
  try {
    const [ax, ay] = a0, [bx, by] = b0, D = Math.hypot(bx - ax, by - ay);
    const lifts = await liftsNear(Math.min(ax, bx) - 2500, Math.min(ay, by) - 2500, Math.max(ax, bx) + 2500, Math.max(ay, by) + 2500);
    let best = null;
    for (const L of lifts.slice(0, 8)) for (const rev of [false, true]) {
      const xs = rev ? [...L.xs].reverse() : L.xs, ys = rev ? [...L.ys].reverse() : L.ys, n = xs.length;
      const dS = Math.hypot(xs[0] - ax, ys[0] - ay), dE = Math.hypot(xs[n - 1] - bx, ys[n - 1] - by);
      if (dS + dE > D * 0.9 + 800) continue; // the lift must carry a good part of the way
      const lift = { xs, ys, ms: rideMs(L), n: L.n || null, c: L.c };
      const V = await liftLeg(a0, b0, lift, optsOf({ ...base, lift: null }));
      if (!V) continue;
      const dt = V.fig.std - B.std;
      if (dt <= -15 * 60000 && (!best || V.fig.std < best.std)) best = { kind: "kolejka", opts: { lift: { xs: xs.map(Math.round), ys: ys.map(Math.round), ms: lift.ms, n: lift.n } }, std: V.fig.std, up: V.fig.up, down: V.fig.down, km: V.stats.m / 1000, fresh: V.stats.fresh, steep: V.fig.steep, name: L.n, line: V.line };
    }
    if (best) out.push(best);
  } catch (e) { console.warn("lift variant", e); }
  return { base: { std: B.std, up: B.up, down: B.down, km: B.km, fresh: B.fresh, steep: B.steep }, out };
}

/** Pace of outings (time in motion against the standard over their profile), one by one. */
async function pacesOf(ids, progress) {
  const out = {};
  let n = 0;
  for (const id of ids) {
    progress({ stage: "pace", n: ++n, of: ids.length });
    try {
      const act = await getActivity(id);
      if (!act) continue;
      out[id] = paceOf({ parts: act.parts }, await profileOf(id));
    } catch (e) { console.warn("pace", id, e); }
  }
  return out;
}

/** Douglas-Peucker (iterative) -> Float32Array [x, y, ...]. */
function simplify(pts, tol) {
  const n = pts.length;
  if (n < 3) return Float32Array.from(pts.flat());
  const keep = new Uint8Array(n); keep[0] = keep[n - 1] = 1;
  const stack = [[0, n - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    const [ax, ay] = pts[a], [bx, by] = pts[b], dx = bx - ax, dy = by - ay, L = Math.hypot(dx, dy) || 1;
    let md = 0, mi = -1;
    for (let i = a + 1; i < b; i++) { const d = Math.abs((pts[i][0] - ax) * dy - (pts[i][1] - ay) * dx) / L; if (d > md) { md = d; mi = i; } }
    if (md > tol) { keep[mi] = 1; stack.push([a, mi], [mi, b]); }
  }
  const out = [];
  for (let i = 0; i < n; i++) if (keep[i]) out.push(pts[i][0], pts[i][1]);
  return Float32Array.from(out);
}

/** Coverage per range (+ the whole region: only trails inside ranges make the headline %). */
function coverageOf(agg, segs) {
  const R = index.ranges, cov = R.map(emptyCov), total = emptyCov();
  R.forEach((r, i) => { cov[i].trails.totalKm = r.trailKm; for (const [c, km] of Object.entries(r.byColor)) cov[i].trails.byColor[c] = { totalKm: km, walkedKm: 0 }; });
  for (const [k, a] of agg) {
    const [len, cat, cols, rg] = segs.get(k), km = (len / 1000) * a.frac;
    for (const c of rg >= 0 ? [cov[rg], total] : [total]) {
      if (cat === 0) {
        if (c === total && rg < 0) continue;
        c.trails.walkedKm += km;
        for (const col of cols ? cols.split(",") : []) if (c.trails.byColor[col]) c.trails.byColor[col].walkedKm += km;
        for (const lim of [2, 5, 10]) if (a.count >= lim) c.trails.atLeast[lim] += len / 1000;
      } else if (cat === 1) c.pathsKm += km; else c.roadsKm += km;
    }
  }
  total.trails.totalKm = R.reduce((s, r) => s + (r.na ? 0 : r.trailKm), 0); // (parts not on the phone: not counted)
  for (const c of [...cov, total]) c.trails.pct = c.trails.totalKm ? (100 * c.trails.walkedKm) / c.trails.totalKm : 0;
  return { cov, total };
}

/** Coverage from the outings that started before t (the year's "before" and "after"). */
async function coverageUntil(t) {
  const meta = new Map((await allMeta()).map((m) => [m.id, m])), travs = [], segs = new Map();
  for (const r of lastLive) {
    if (r.outside || !((meta.get(r.id)?.start ?? Infinity) < t)) continue;
    for (const [k, full, lo, hi, a, b] of r.trav) { travs.push({ k, activity: r.id, full: !!full, lo, hi, t0: a, t1: b }); if (!segs.has(k)) segs.set(k, r.segs[k]); }
  }
  return coverageOf(aggregate(travs, "activities"), segs);
}
/** The ranges a year moved on: [{id, label, before, after (% of trails), km (new trail km)}], most first. */
async function yearRanges(year) {
  const a = await coverageUntil(new Date(year, 0, 1).getTime()), b = await coverageUntil(new Date(year + 1, 0, 1).getTime());
  const out = index.ranges.map((r, i) => ({ id: r.id, label: r.label, short: r.short, before: a.cov[i].trails.pct, after: b.cov[i].trails.pct, km: b.cov[i].trails.walkedKm - a.cov[i].trails.walkedKm }))
    .filter((r) => r.km > 0.05).sort((x, y) => y.km - x.km);
  return { ranges: out, before: a.total.trails.pct, after: b.total.trails.pct, km: b.total.trails.walkedKm - a.total.trails.walkedKm };
}

/** What an outing walked for the first time (core/fresh.js), as lines to draw and km. */
async function freshFor(id) {
  const me = lastLive.find((r) => r.id === id);
  if (!me || me.outside) return null;
  const meta = new Map((await allMeta()).map((m) => [m.id, m])), t = meta.get(id)?.start ?? 0, before = [];
  for (const r of lastLive) if (r.id !== id && !r.outside && (meta.get(r.id)?.start ?? Infinity) < t) before.push(...r.trav);
  const f = freshOf(me.trav, before, me.segs, index.scale || 10);
  const list = (o) => Object.entries(o).map(([rg, km]) => ({ id: index.ranges[rg]?.id, label: index.ranges[rg]?.label, short: index.ranges[rg]?.short, km })).filter((r) => r.id).sort((a, b) => b.km - a.km);
  return { ...f, ranges: list(f.ranges), walked: list(f.walked) };
}

// ---- the trip planner: walks worth a day out (new trails, peaks and places), from a start
// (a car park, a station, a point on the map). Loops through one or two places of interest, or from a
// station to another one. Everything worked out here from the map and your outings.
let tripKnown = { found: new Set(), badges: new Set() }, tripPois = null;
const TRIP_V = { peak: 1, hut: 1, tower: 0.9, viewpoint: 0.7, waterfall: 0.8, ruins: 0.55, ferrata: 1, cave: 0.4, shelter: 0.25, rock: 0.12, spring: 0.08 };
/** Every place of interest and every car park of the map (light copies, kept): {pois, parks}. */
async function tripIndex() {
  if (tripPois) return tripPois;
  const pois = [], parks = [], seen = new Set();
  for (const t of atlas.tiles) {
    const lm = await atlas.lm(t).catch(() => null);
    for (const p of lm?.pois || []) {
      if (seen.has(p.id) || TRIP_V[p.c] == null) continue;
      seen.add(p.id);
      const bk = p.c === "peak" ? badgeFull.filter((k) => Math.hypot(k.x - p.x, k.y - p.y) < 250) : [];
      let v = TRIP_V[p.c] * (p.n ? 1 : 0.3);
      if (p.c === "peak") v *= p.e > 1100 ? 1.5 : p.e > 800 ? 1.2 : p.e > 500 ? 0.9 : 0.5;
      const badge = bk.length > 0, gotBadge = bk.some((k) => tripKnown.badges.has(k.id)), got = tripKnown.found.has(p.id) || gotBadge;
      if (badge && !gotBadge) v += 1.6;
      if (got) v *= 0.3; // been there: still nice, not new
      pois.push({ id: p.id, c: p.c, n: p.n, e: p.e, x: p.x, y: p.y, rg: p.rg, v, got, badge });
    }
    for (const a of lm?.anchors || []) if (a.k === "parking") parks.push({ x: a.x, y: a.y, n: a.n || null });
  }
  atlas.cache.clear();
  return (tripPois = { pois, parks });
}
const near2 = (list, x, y, R) => list.filter((p) => Math.abs(p.x - x) < R && Math.abs(p.y - y) < R && Math.hypot(p.x - x, p.y - y) < R);
/** What a start promises: the value of what is new around it (within R), and its range. */
async function tripStarts(pts, R = 6000) {
  const { pois, parks } = await tripIndex();
  const list = pts || parks.map((p) => [p.x, p.y, p.n]);
  return list.map(([x, y, n]) => {
    const around = near2(pois, x, y, R);
    let v = 0, rg = -1, best = -1;
    const vs = around.map((p) => p.v * (1 - Math.hypot(p.x - x, p.y - y) / (R * 1.6))).sort((a, b) => b - a);
    vs.forEach((w, i) => (v += w * 0.88 ** i)); // (a crowd of rocks is not twenty peaks)
    for (const p of around) if (p.v > best && p.rg >= 0) { best = p.v; rg = p.rg; }
    return { x, y, n: n || null, v: Math.round(v * 10) / 10, rg };
  });
}
/** The metres of a route walked twice (pieces over the same way overlapping). */
function twiceOf(pieces) {
  const by = new Map(); let tw = 0;
  for (const [k, s0, s1] of pieces) {
    const a = Math.min(s0, s1), b = Math.max(s0, s1), L = by.get(k) || [];
    for (const [c, d] of L) tw += Math.max(0, Math.min(b, d) - Math.max(a, c));
    L.push([a, b]); by.set(k, L);
  }
  return tw;
}
/**
 * Trips from a start: o {start: {x, y, n}, km: [min, max], up: [min, max], ends: [[x, y, n]] (stations a walk
 * may end at instead of the start), n (how many), avoid: [poi ids] (shown already)} -> [trip], best first;
 * trip {pts: [{x, y, n}], km, up, down, std, line, h, places, freshKm, newPlaces, twice}.
 */
async function tripsFrom(o) {
  const { pois } = await tripIndex(), S = o.start, [k0, k1] = o.km, T = (k0 + k1) / 2 * 1000;
  const M = o.must ? { ...o.must, id: "must", v: 3 } : null; // (a place the walk must reach: a peak from the booklet)
  const reach = Math.max(T * 0.45, M ? Math.hypot(M.x - S.x, M.y - S.y) * 1.35 : 0), avoid = new Set(o.avoid || []);
  const cand = near2(pois, S.x, S.y, reach).filter((p) => p.n && p.v >= 0.25 && Math.hypot(p.x - S.x, p.y - S.y) > 600).sort((a, b) => b.v - a.v).slice(0, 26);
  const ends = (o.ends || []).map(([x, y, n]) => ({ x, y, n }));
  // pairs (and singles) whose straight way round is about the length (the way on the ground ~1.3x)
  const opts = [], d = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  const close = (B) => { const out = [S]; for (const E of ends) if (d(B, E) < reach * 0.8 && d(E, S) > 1500) out.push(E); return out; };
  for (let i = 0; i < cand.length; i++) {
    const A = cand[i];
    for (const E of close(A)) { const L = (d(S, A) + d(A, E)) * 1.3; if (L >= k0 * 900 && L <= k1 * 1050 && E !== S) opts.push({ via: [A], E, L, pv: A.v * 1.2 }); }
    for (let j = i + 1; j < cand.length; j++) {
      const B = cand[j];
      if (d(A, B) < 700) continue;
      for (const [P, Q] of [[A, B], [B, A]]) for (const E of close(Q)) {
        const L = (d(S, P) + d(P, Q) + d(Q, E)) * 1.3;
        if (L < k0 * 900 || L > k1 * 1050) continue;
        if (E === S) { // a loop: the two not on the same side in a line (that is there and back)
          const a1 = Math.atan2(P.y - S.y, P.x - S.x), a2 = Math.atan2(Q.y - S.y, Q.x - S.x); let da = Math.abs(a1 - a2); if (da > Math.PI) da = 2 * Math.PI - da;
          if (da < 0.45) continue;
          if (P === B) continue; // (a loop either way round: one of them)
        }
        opts.push({ via: [P, Q], E, L, pv: P.v + Q.v - (avoid.has(P.id) ? 1 : 0) - (avoid.has(Q.id) ? 1 : 0) });
      }
    }
  }
  if (M) { // only walks through it: there and on to one more place, or there and back another way
    opts.length = 0;
    const lo = k0 * 650, hi = k1 * 1250;
    for (const E of close(M)) { const L = (d(S, M) + d(M, E)) * 1.3; if (L >= lo && L <= hi) opts.push({ via: [M], E, L, pv: 1.5 }); }
    for (const Q of cand) {
      if (d(M, Q) < 700) continue;
      for (const [P, Z] of [[M, Q], [Q, M]]) for (const E of close(Z)) {
        if (E === S && P === Q) continue; // (a loop either way round: one of them)
        const L = (d(S, P) + d(P, Z) + d(Z, E)) * 1.3;
        if (L >= lo && L <= hi) opts.push({ via: [P, Z], E, L, pv: 3 + Q.v - (avoid.has(Q.id) ? 1 : 0) });
      }
    }
  }
  if (!opts.length) return [];
  opts.sort((a, b) => b.pv - a.pv);
  const pick = [];
  for (const q of opts) { if (pick.length >= (o.tries || 7)) break; if (pick.some((p) => p.via.every((v) => q.via.includes(v)) && p.E === q.E)) continue; pick.push(q); }
  // each one on the ground: new trails, the places on the way, not twice the same way
  const R = await routerFor(S.x - reach, S.y - reach, S.x + reach, S.y + reach, false);
  const out = [];
  for (const q of pick) {
    const pts = [S, ...q.via, q.E], pieces = [], mode = { ...optsOf({ mode: "nieznana" }), used: new Set() }; // (each leg rather not on the ways before it)
    let ok = true, a = R.snap(S.x, S.y, 800);
    if (!a) return [];
    for (let i = 1; i < pts.length && ok; i++) { const b = R.snap(pts[i].x, pts[i].y, 500, R.comp[a.k]); const r = b ? R.leg(a, b, mode) : null; if (!r) ok = false; else { pieces.push(...r.pieces); usedOf(R, r.pieces, mode.used); a = b; } }
    if (!ok) continue;
    const st = R.stats(pieces), km = st.m / 1000, tw = twiceOf(pieces);
    if (km < k0 * (M ? 0.6 : 0.85) || km > k1 * (M ? 1.3 : 1.12)) continue;
    const line = R.line(pieces), xs = [], ys = [];
    for (let i = 0; i < line.length; i += 2) { xs.push(line[i]); ys.push(line[i + 1]); }
    const PL = new Polyline(Float64Array.from(xs), Float64Array.from(ys));
    let x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
    const on = pois.filter((p) => p.x > x0 - 200 && p.x < x1 + 200 && p.y > y0 - 200 && p.y < y1 + 200).filter((p) => { for (let e = 0; e < xs.length - 1; e++) if (PL.projectEdge(e, p.x, p.y)[0] < (p.c === "hut" ? 160 : 90)) return true; return false; });
    const val = on.map((p) => p.v).sort((a, b) => b - a).reduce((s, v, i) => s + v * 0.85 ** i, 0), fresh = st.fresh / 1000, newP = on.filter((p) => !p.got && p.n && p.v >= 0.5).length;
    const score = val + 2.2 * (fresh / Math.max(1, km)) * Math.min(1, km / 10) * 3 - 9 * (tw / st.m) - 0.6 * (st.road / st.m) * 3 - (on.some((p) => avoid.has(p.id)) ? 1.5 : 0);
    out.push({ q, pts, pieces, line, km, st, tw, on, fresh, newP, score });
  }
  out.sort((a, b) => b.score - a.score);
  // the figures (heights, time) for the best ones; climbs out of range dropped
  const res = [];
  for (const c of out) {
    if (res.length >= (o.n || 3)) break;
    const away = c.on.filter((p) => Math.hypot(p.x - S.x, p.y - S.y) > 1200 && p.v >= 0.3); // (what is round the start is on every loop)
    if (res.some((r) => r.places.filter((p) => !p.home && away.some((q) => q.id === p.id)).length >= Math.max(2, Math.min(3, away.length * 0.6)))) continue; // (another way to the same places)
    const f = hardened(await legFigures(c.line), c.st);
    if (o.up && (f.up < o.up[0] * 0.95 || f.up > o.up[1] * 1.05)) continue;
    const h = [], N = Math.min(120, c.line.length / 2);
    { const hs = await heightsAlong(c.line, N); for (const v of hs) h.push(v); }
    const lite = [];
    for (let i = 0; i < c.line.length; i += 2) if (i % 6 === 0 || i === c.line.length - 2) lite.push(Math.round(c.line[i]), Math.round(c.line[i + 1]));
    res.push({ pts: c.pts.map((p) => ({ x: p.x, y: p.y, n: p.n || null })), km: Math.round(c.km * 10) / 10, up: f.up, down: f.down, std: f.std, bins: f.bins, line: lite, h,
      places: c.on.filter((p) => p.n).sort((a, b) => b.v - a.v).map((p) => ({ id: p.id, c: p.c, n: p.n, e: p.e, x: p.x, y: p.y, got: p.got, badge: p.badge, home: Math.hypot(p.x - S.x, p.y - S.y) <= 1200 })),
      freshKm: Math.round(c.fresh * 10) / 10, newPlaces: c.newP, twice: Math.round(c.tw / 100) / 10, road: Math.round(c.st.road / 100) / 10, score: Math.round(c.score * 100) / 100, loop: c.q.E === S });
  }
  return res;
}
/** Heights along a line (pack metres, flat) at n even steps (from the contours). */
async function heightsAlong(line, n) {
  const xs = [], ys = []; for (let i = 0; i < line.length; i += 2) { xs.push(line[i]); ys.push(line[i + 1]); }
  const tiles = atlas.tilesIn(Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys), 500), sets = await Promise.all(tiles.map(contoursOf));
  const PL = new Polyline(Float64Array.from(xs), Float64Array.from(ys)), L = PL.length, out = [];
  for (let i = 0; i < n; i++) { const [x, y] = PL.pointAt((L * i) / Math.max(1, n - 1)); const h = heightAt(sets, x, y, { R: 400 })?.h; out.push(h == null ? null : Math.round(h)); }
  return out;
}

/** Where to start a walk to a spot: the nearest car park or station 400 m - 8 km away (a station counts a little nearer). */
async function startNear(x, y, R = 8000) {
  let best = null;
  for (const t of atlas.tilesIn(x - R, y - R, x + R, y + R)) {
    const lm = await atlas.lm(t);
    for (const p of lm.anchors || []) {
      if (p.k !== "parking" && p.k !== "station") continue;
      const d = Math.hypot(p.x - x, p.y - y), w = d * (p.k === "station" ? 0.85 : 1) * (p.n ? 1 : 1.1);
      if (d >= 400 && d <= R && (!best || w < best.w)) best = { x: p.x, y: p.y, n: p.n || (p.k === "station" ? "Stacja" : "Parking"), k: p.k, d: Math.round(d), w };
    }
  }
  return best;
}

/**
 * Car parks for a loop (line: [x, y, ...] pack metres): those within 2 km of it, each with the way from it to the
 * nearest place of the loop (jx, jy; s: metres along the line there) and that way's figures, the best few.
 */
async function parkingsFor(line, o, R = 2000) {
  if (!line || line.length < 4) return [];
  // the loop every ~25 m, with the distance along it
  const S = []; let d = 0;
  for (let i = 0; i < line.length; i += 2) {
    if (i) d += Math.hypot(line[i] - line[i - 2], line[i + 1] - line[i - 1]);
    if (!S.length || d - S[S.length - 1][2] >= 25 || i === line.length - 2) S.push([line[i], line[i + 1], d]);
  }
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of S) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
  const found = [];
  for (const t of atlas.tilesIn(x0 - R, y0 - R, x1 + R, y1 + R)) {
    const lm = await atlas.lm(t);
    for (const p of lm.anchors || []) {
      if (p.k !== "parking" || p.x < x0 - R || p.x > x1 + R || p.y < y0 - R || p.y > y1 + R) continue;
      let best = null;
      for (const q of S) { const dd = Math.hypot(q[0] - p.x, q[1] - p.y); if (!best || dd < best.d) best = { d: dd, q }; }
      if (best && best.d <= R && !found.some((f) => Math.hypot(f.x - p.x, f.y - p.y) < 700)) found.push({ x: p.x, y: p.y, n: p.n || null, jx: best.q[0], jy: best.q[1], s: best.q[2], d: best.d });
    }
  }
  found.sort((a, b) => a.d - b.d);
  const out = [];
  for (const f of found.slice(0, 8)) {
    let r = null;
    if (f.d < 30) r = { km: 0, up: 0, down: 0, std: 0 };
    else { try { const w = await planRoute([[f.x, f.y], [f.jx, f.jy]], { ...o, legs: [] }); if (!(w.legs || []).some((L) => L.none)) r = { km: w.km, up: w.up, down: w.down, std: w.std, bins: w.bins, line: Array.from(w.line, Math.round) }; } catch { r = null; } }
    if (!r) continue;
    const town = f.n ? null : await nameAt(f.x, f.y, 1500, true).catch(() => null);
    out.push({ ...f, n: f.n || null, town: town?.n || null, ...r });
  }
  return out;
}

/** A name for a spot (a planned point): the nearest named place, hut, peak or anchor within 600 m. */
async function nameAt(x, y, R = 600, townsOnly = false) {
  let best = null;
  for (const t of atlas.tilesIn(x - R, y - R, x + R, y + R)) {
    const lm = await atlas.lm(t);
    const consider = (p, n, w = 1) => { if (!n) return; const d = Math.hypot(p.x - x, p.y - y) * w; if (d <= R && (!best || d < best.d)) best = { n, d, raw: Math.hypot(p.x - x, p.y - y), x: p.x, y: p.y }; };
    if (!townsOnly) for (const p of lm.pois || []) consider(p, p.n, p.c === "peak" || p.c === "hut" ? 0.8 : 1);
    if (!townsOnly) for (const p of lm.anchors || []) if (p.k !== "parking") consider(p, p.n, p.k === "pass" ? 0.7 : 1);
    for (const p of lm.places || []) consider(p, p.n, 1.3);
  }
  return best ? { n: best.n, d: Math.round(best.raw), x: best.x, y: best.y } : null;
}

const emptyCov = () => ({ trails: { totalKm: 0, walkedKm: 0, pct: 0, byColor: {}, atLeast: { 2: 0, 5: 0, 10: 0 } }, pathsKm: 0, roadsKm: 0 });

const routeSets = {};
async function analyseAll(settings = {}, onProgress = () => {}) {
  const t0 = performance.now(), sig = sigOf(settings);
  const [ids, cached] = await Promise.all([activityIds(), allResults()]);
  const results = new Map(cached.map((r) => [r.id, r]));
  // outings added by hand: matched again once their line is made dense (MANUAL_V), the rest as they were
  const sigFor = (id) => (String(id).startsWith("man-") ? `${sig}|m${MANUAL_V}` : sig);
  const todo = ids.filter((id) => results.get(id)?.sig !== sigFor(id));
  let n = 0;
  for (const id of todo) {
    onProgress({ stage: "match", n: ++n, of: todo.length });
    const act = await getActivity(id);
    if (!act) continue;
    const r = await matchOne(act, settings, sigFor(id));
    await putResult(r);
    results.set(id, r);
  }
  const live = ids.map((id) => results.get(id)).filter(Boolean);
  atlas.cache.clear(); // decoded tiles are big; the next import fetches what it needs

  const meta = await allMeta();
  lastLive = live; lastSettings = settings;

  // aggregate over all outings
  const travs = [], segs = new Map(), found = new Map(), reveal = [], badges = new Map(), off = [];
  // reveal discs: [x, y, r, seed, g] - g: outing number (>= 0), or -visits for a summit
  let og = 0;
  for (const r of live) {
    for (const [id, first] of r.badges || []) {
      const b = badges.get(id);
      if (!b) badges.set(id, { first, visits: 1, outs: [[r.id, first]] }); else { b.first = Math.min(b.first, first); b.visits++; b.outs.push([r.id, first]); }
    }
    if (r.outside) continue;
    for (const f of r.off || []) off.push(f);
    for (const [k, full, lo, hi, a, b] of r.trav) { travs.push({ k, activity: r.id, full: !!full, lo, hi, t0: a, t1: b }); if (!segs.has(k)) segs.set(k, r.segs[k]); }
    for (const [id, first, c, nm, e, x, y, rg] of r.found) {
      const f = found.get(id);
      if (!f) found.set(id, { first, visits: 1, c, n: nm, e, x, y, rg, outs: [[r.id, first]] });
      else { f.first = Math.min(f.first, first); f.visits++; f.outs.push([r.id, first]); }
    }
    const g = og++;
    for (let i = 0; i < r.reveal.length; i += 4) reveal.push([r.reveal[i], r.reveal[i + 1], r.reveal[i + 2], r.reveal[i + 3], g]);
  }
  for (const [id, f] of found) if (f.c === "peak") reveal.push([Math.round(f.x), Math.round(f.y), SUMMIT_R, seedOf(id) % 1e4, -f.visits]);
  for (const k of badgePts) if (badges.has(k.id) && ![...found.values()].some((f) => f.c === "peak" && Math.hypot(f.x - k.x, f.y - k.y) < 300)) reveal.push([Math.round(k.x), Math.round(k.y), SUMMIT_R, seedOf(k.id) % 1e4, -badges.get(k.id).visits]);
  const agg = aggregate(travs, "activities");
  const { cov, total } = coverageOf(agg, segs);
  const R = index.ranges;

  // discoveries per range
  const tally = R.map((r) => Object.fromEntries(DISCOVERABLE.map((c) => [c, [0, r.pois[c] || 0]])));
  const tallyAll = Object.fromEntries(DISCOVERABLE.map((c) => [c, [0, R.reduce((s, r) => s + (r.na ? 0 : r.pois[c] || 0), 0)]]));
  for (const f of found.values()) {
    if (f.rg < 0 || !f.n || !tally[f.rg][f.c]) continue;
    tally[f.rg][f.c][0]++; tallyAll[f.c][0]++;
  }
  const dp = discoveredPct(reveal);
  const dpAll = dp.reduce((s, [h, t], i) => (R[i].na ? s : [s[0] + h, s[1] + t]), [0, 0]);

  const ranges = R.map((r, i) => ({ id: r.id, label: r.label, short: r.short, coverage: cov[i], tally: tally[i], discoveredPct: dp[i][1] ? (100 * dp[i][0]) / dp[i][1] : 0 })).filter((r, i) => !R[i].na);
  // long routes (the Główny Szlak Sudecki): km walked of their segments (pack: index.routes)
  const routes = (index.routes || []).map((L) => {
    const set = (routeSets[L.id] ||= new Set(L.keys));
    let w = 0;
    for (const [k, a] of agg) if (set.has(k)) w += (segs.get(k)[0] / 1000) * a.frac;
    return { id: L.id, name: L.name, km: L.km, walkedKm: w, pct: L.km ? Math.min(100, (100 * w) / L.km) : 0 };
  });
  const res = new Map(live.map((r) => [r.id, r]));
  const titles = new Map((await allTitles()).map((t) => [t.id, t.title]));
  tripKnown = { found: new Set(found.keys()), badges: new Set(badges.keys()) }; tripPois = null;
  return {
    agg: [...agg].map(([k, a]) => [k, a.count, a.intervals, segs.get(k)[2], segs.get(k)[4]]),
    reveal,
    off,
    found: Object.fromEntries(found),
    badges: Object.fromEntries(badges),
    coverage: total,
    tally: tallyAll,
    discoveredPct: dpAll[1] ? (100 * dpAll[0]) / dpAll[1] : 0,
    ranges,
    routes,
    matched: todo.length,
    ms: performance.now() - t0,
    activities: meta.map((a) => {
      const r = res.get(a.id), title = titles.get(a.id) || null, auto = r?.auto || null;
      return { id: a.id, name: title || auto || a.name, title, auto, garmin: a.name, sport: a.sport, start: a.start, end: a.end, km: a.km, ele: !!a.ele, asc: a.asc, desc: a.desc, outside: !!r?.outside, manual: !!a.manual };
    }).sort((a, b) => (b.start ?? -1) - (a.start ?? -1)),
  };
}


// ---- friends (app/friends.js): what you share (your walked stretches, each once, as lines) and what a
// friend's file is on this map (their lines matched like an outing: the stretches, the summits)
function aggOf(results) {
  const travs = [], segs = new Map(), found = new Map();
  for (const r of results) {
    if (r.outside) continue;
    for (const [k, full, lo, hi, a, b] of r.trav) { travs.push({ k, activity: r.id, full: !!full, lo, hi, t0: a, t1: b }); if (!segs.has(k)) segs.set(k, r.segs[k]); }
    for (const [id, , c, n, e, x, y] of r.found) if (c === "peak" && !found.has(id)) found.set(id, [id, n, e, x, y]);
  }
  return { agg: aggregate(travs, "activities"), segs, found };
}
// the stretch [lo, hi] (fractions) of a line [[x, y]]
function stretch(pts, lo, hi) {
  const cum = [0]; for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  const L = cum[cum.length - 1] || 1, a = lo * L, b = hi * L, at = (s) => { let i = 1; while (i < pts.length - 1 && cum[i] < s) i++; const t = (s - cum[i - 1]) / ((cum[i] - cum[i - 1]) || 1); return [pts[i - 1][0] + t * (pts[i][0] - pts[i - 1][0]), pts[i - 1][1] + t * (pts[i][1] - pts[i - 1][1])]; };
  const out = [at(a)]; for (let i = 1; i < pts.length - 1; i++) if (cum[i] > a && cum[i] < b) out.push(pts[i]); out.push(at(b));
  return out;
}
/** Results -> the lines to share: every walked stretch once, glued, simplified to ~10 m, in lon/lat. -> {lines, km} */
function shareLinesOf(results) {
  const { agg, segs } = aggOf(results), sc = atlas.scale, whole = [], parts = [];
  let m = 0;
  for (const [k, a] of agg) {
    const [xs, ys] = decodeLine(segs.get(k)[4], sc);
    if (xs.length < 2) continue;
    const pts = Array.from(xs, (x, i) => [x, ys[i]]), len = segs.get(k)[0];
    if (a.intervals.length === 1 && a.intervals[0][0] <= 0.03 && a.intervals[0][1] >= 0.97) { whole.push(pts); m += len; continue; }
    for (const [lo, hi] of a.intervals) if ((hi - lo) * len > 25) { parts.push(stretch(pts, lo, hi)); m += (hi - lo) * len; }
  }
  const lines = glueLines(whole, parts).map((l) => simplifyXY(l, 10).map(([x, y]) => atlas.unproject(x, y).map((v) => Math.round(v * 1e5) / 1e5)));
  return { lines, km: m / 1000 };
}
/** A friend's lines on this map: matched as outings added by hand. -> {agg: [[k, intervals, geom]], found: [[id, n, e, x, y]], km} */
async function friendOnMap(lines, settings, onProgress) {
  const results = [];
  let i = 0;
  for (const l of lines) {
    onProgress({ stage: "friend", n: ++i, of: lines.length });
    let t = 0;
    const part = l.map(([lon, lat], j) => { if (j) { const [a, b] = l[j - 1]; t += (Math.hypot((lon - a) * 70000, (lat - b) * 111000) / 1.2) * 1000; } return { t, lat, lon }; });
    if (part.length < 2) continue;
    const [x, y] = atlas.project(part[0].lon, part[0].lat);
    if (!atlas.tilesIn(x - 1, y - 1, x + 1, y + 1, 5000).length) continue; // (not on these maps)
    results.push(await matchOne({ id: `friend-${i}`, manual: true, parts: [part] }, settings, "friend"));
  }
  atlas.cache.clear();
  const { agg, segs, found } = aggOf(results);
  let km = 0;
  const out = [...agg].map(([k, a]) => { km += (segs.get(k)[0] * a.frac) / 1000; return [k, a.intervals, segs.get(k)[4]]; });
  return { agg: out, found: [...found.values()], km };
}
/** A friend without the app: their exported outings (a Strava zip, GPX files) -> what their file would hold. */
async function friendFromFiles(files, settings, onProgress) {
  const { activities } = await importFiles(files, {}, onProgress);
  const results = [], rows = [];
  let i = 0;
  for (const a of activities) {
    onProgress({ stage: "match", n: ++i, of: activities.length });
    results.push(await matchOne({ ...a, id: `ff-${i}` }, settings, "friend"));
    if (a.ele) rows.push({ km: a.km, up: a.asc || 0, down: a.desc || 0, moving: movingTime(a.parts) });
  }
  atlas.cache.clear();
  const { lines, km } = shareLinesOf(results);
  return { lines, km, pace: { norm: personalNorm(rows), curve: null, n: rows.length }, outings: activities.length };
}

self.onmessage = async (e) => {
  const { id, type, ...msg } = e.data;
  const reply = (data) => self.postMessage({ id, ...data });
  const progress = (p) => self.postMessage({ id, progress: p });
  try {
    if (type === "init") { await init(msg.base); reply({ ok: true, tiles: index.tiles.length }); }
    else if (type === "analyse") reply({ ok: true, result: await analyseAll(msg.settings, progress) });
    else if (type === "shareLines") reply({ ok: true, ...shareLinesOf(lastLive) });
    else if (type === "friendOnMap") reply({ ok: true, ...(await friendOnMap(msg.lines, msg.settings || lastSettings, progress)) });
    else if (type === "friendFromFiles") reply({ ok: true, ...(await friendFromFiles(msg.files, msg.settings || lastSettings, progress)) });
    else if (type === "import") {
      // outings stored before elevations were kept come in again and are replaced (same id,
      // or the same start under another id, e.g. intervals.icu then the Garmin export)
      const meta = await allMeta(), full = meta.filter((m) => m.ele), bare = meta.filter((m) => !m.ele);
      const { activities, skipped } = await importFiles(msg.files, { knownIds: full.map((m) => m.id), knownStarts: full.map((m) => m.start).filter((t) => t != null) }, progress);
      const titles = new Map((await allTitles()).map((t) => [t.id, t.title])), added = [];
      let refreshed = 0;
      for (const a of activities) {
        const old = bare.find((m) => m.id === a.id || (m.start != null && a.start != null && Math.abs(m.start - a.start) < 90_000));
        if (!old) { added.push(a); continue; }
        refreshed++;
        if (old.id !== a.id) { await deleteActivity(old.id); if (titles.has(old.id)) { await setTitle(a.id, titles.get(old.id)); await setTitle(old.id, null); } }
      }
      await putActivities(activities);
      const result = await analyseAll(msg.settings, progress);
      const out = new Set(lastLive.filter((r) => r.outside).map((r) => r.id)); // (kept, but no map of ours has them)
      reply({ ok: true, added: added.map((a) => ({ id: a.id, name: a.name, start: a.start, km: a.km, outside: out.has(a.id) })), refreshed, skipped, result });
    } else if (type === "addManual") {
      // an outing added by hand (from a planned route): stored like the imported ones, then scratched
      await putActivities([msg.act]);
      reply({ ok: true, result: await analyseAll(msg.settings, progress) });
    } else if (type === "replaceManual") {
      // an outing added by hand, changed (its date, its points): the new one in its place, its own name kept
      const title = (await allTitles()).find((t) => t.id === msg.old)?.title;
      await deleteActivity(msg.old);
      if (title) { await setTitle(msg.act.id, title); await setTitle(msg.old, null); }
      await putActivities([msg.act]);
      reply({ ok: true, result: await analyseAll(msg.settings, progress) });
    } else if (type === "delete") { await deleteActivity(msg.activity); reply({ ok: true, result: await analyseAll(msg.settings, progress) }); }
    else if (type === "names") reply({ ok: true, names: await nameAll() });
    else if (type === "near") reply({ ok: true, ids: await outingsNear(msg.x, msg.y, msg.r || 0) });
    else if (type === "nearPlace") {
      // a town or village: by its built-up area when the map has it, else a circle of its rough size
      const area = await placeArea(msg.x, msg.y, msg.kind);
      const ids = area ? await outingsNear(msg.x, msg.y, 0, area) : await outingsNear(msg.x, msg.y, msg.r || 600);
      reply({ ok: true, ids, area: area ? area.map((A) => { const f = []; for (let i = 0; i < A.xs.length; i++) f.push(Math.round(A.xs[i]), Math.round(A.ys[i])); return f; }) : null });
    }
    else if (type === "warmRoute") { warmRouter(msg.x, msg.y); reply({ ok: true }); }
    else if (type === "route") reply({ ok: true, route: await planRoute(msg.pts, msg.opts || {}) });
    else if (type === "routesTo") { // from one point to several (stations): one router for them all, figures only
      const [ax, ay] = msg.from, xs = [ax, ...msg.to.map((q) => q[0])], ys = [ay, ...msg.to.map((q) => q[1])];
      const box = [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)], out = [];
      for (const b of msg.to) {
        const r = await planRoute([msg.from, b], { ...(msg.opts || {}), box }).catch(() => null);
        out.push(r && !(r.legs || []).some((L) => L.none) ? { km: r.km, up: r.up, down: r.down, std: r.std, bins: r.bins } : null);
      }
      reply({ ok: true, routes: out });
    }
    else if (type === "routeLegs") reply({ ok: true, legs: await planLegs(msg.pairs, msg.opts || {}) });
    else if (type === "legVariants") reply({ ok: true, ...(await legVariants(msg.a, msg.b, msg.opts || {}, msg.skip || null)) });
    else if (type === "fresh") reply({ ok: true, fresh: await freshFor(msg.activity) });
    else if (type === "yearRanges") reply({ ok: true, ...(await yearRanges(msg.year)) });
    else if (type === "tripStarts") reply({ ok: true, starts: await tripStarts(msg.pts || null, msg.R) });
    else if (type === "tripsFrom") reply({ ok: true, trips: await tripsFrom(msg) });
    else if (type === "parkingsFor") { let parks = await parkingsFor(msg.line, msg.opts || {}); if (!parks.length) parks = await parkingsFor(msg.line, msg.opts || {}, 4000); reply({ ok: true, parks }); } // (none within 2 km: within 4)
    else if (type === "startNear") reply({ ok: true, start: await startNear(msg.x, msg.y) });
    else if (type === "slope") reply({ ok: true, tiles: await slopeTiles(msg.x0, msg.y0, msg.x1, msg.y1, msg.have || []) });
    else if (type === "liftStations") reply({ ok: true, lifts: await liftStations(msg.x0, msg.y0, msg.x1, msg.y1) });
    else if (type === "nameAt") reply({ ok: true, place: await nameAt(msg.x, msg.y, msg.R || 600, !!msg.towns) });
    else if (type === "paces") reply({ ok: true, paces: await pacesOf(msg.ids, progress) });
    else if (type === "elevcheck") reply({ ok: true, check: await elevCheck(msg.ids) });
    else if (type === "thumbs") { const out = {}; for (const id of msg.ids || []) { try { out[id] = await thumbOf(id); } catch { out[id] = null; } } reply({ ok: true, thumbs: out }); }
    else if (type === "track") { const t = await trackOf(msg.activity); reply({ ok: true, track: t }); }
    else if (type === "profile") reply({ ok: true, profile: await profileOf(msg.activity) });
    else if (type === "rename") { await setTitle(msg.activity, (msg.title || "").trim() || null); reply({ ok: true }); }
    else if (type === "clear") { await clearActivities(); reply({ ok: true, result: await analyseAll(msg.settings, progress) }); }
  } catch (err) {
    reply({ ok: false, error: String(err?.stack || err) });
  }
};
