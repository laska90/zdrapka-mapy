// Kompas trasy: the active route as a radar turned like the phone. Between junctions the whole route ahead;
// ~150 m before a junction (where a marked trail leaves the route) it zooms in until the junction fills the
// circle: every trail there in its colour, an orange arrow on the arm you take, where each arm leads at the
// circle's edge. The route you walk has the plan's orange edge, what you walked is violet, you are blue. On
// the right the route's height bar in the app's slope colours; on the card the next step and the climb ahead.
//
// Fingers: pinch to zoom, one finger to move round, N on the rim: north up (again: the phone's way), the bar:
// a finger on it shows that height on the route, a trail's sign: a look along it. The pill takes you back to
// the guide; it comes back by itself 15 s after the last touch once you walked on 30 m. (core/navradar.js
// reckons: junctions, arms, turns, the zoom, the climb.)

import { projector, unprojector } from "../core/pack.js";
import { createNavTerrain, onGrid } from "./navterrain.js";
import { loadDem, DEM_URL, camOverrides } from "./peakcam.js";
import { SLOPE_LINE } from "../core/profile.js";
import { TC } from "./glstyle.js";
import { junctionsOn, turnAt, zoomIn, climbAhead, runsAlong, colsAt, colsText, nearestOn, pointAt, heightAt, bearingXY, wrap180, slopeClassOf } from "../core/navradar.js";

const ORANGE = "#f0a01e", VIOLET = "#6e48dc", ME = "#1a56c4", DISC = "#1d2220", DIRS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
const FAR_M = 750, NEAR_M = 130; // what the circle's radius holds: the whole route ahead / a junction close in
const colOf = (cols) => TC[String(cols || "").split(",")[0]] || "#8a8f8c";
const fmtM = (m) => (m < 1000 ? `${Math.max(10, Math.round(m / 10) * 10)} m` : `${(m / 1000).toFixed(1).replace(".", ",")} km`);
const sCol = (pct) => SLOPE_LINE[slopeClassOf(pct)];
const slopeText = (p) => `${p > 0.5 ? "↗" : p < -0.5 ? "↘" : "→"} ${Math.round(Math.abs(p))}%`;
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

/** The last way out of the rectangle R ({x0, y0, x1, y1}) along a screen polyline, or null. */
function exitRect(pts, R) {
  const ins = ([x, y]) => x > R.x0 && x < R.x1 && y > R.y0 && y < R.y1;
  let hit = null;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i];
    if (!ins(a) || ins(b) || !Number.isFinite(b[0])) continue;
    let lo = 0, hi = 1;
    for (let k = 0; k < 24; k++) { const m = (lo + hi) / 2; if (ins([a[0] + (b[0] - a[0]) * m, a[1] + (b[1] - a[1]) * m])) lo = m; else hi = m; }
    hit = [a[0] + (b[0] - a[0]) * lo, a[1] + (b[1] - a[1]) * lo];
  }
  return hit;
}

/** A label cut to maxW px (the canvas's current font), with "…". */
function fitIn(g, t, maxW) {
  if (g.measureText(t).width <= maxW) return t;
  let lo = 0, hi = t.length;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (g.measureText(`${t.slice(0, m)}…`).width <= maxW) lo = m; else hi = m; }
  return `${t.slice(0, lo).trimEnd()}…`;
}

/** The last way out of the circle (cx, cy, r) along a screen polyline [[x, y]], or null. */
function exitPoint(pts, cx, cy, r) {
  let hit = null;
  for (let i = 1; i < pts.length; i++) {
    const [ax, ay] = pts[i - 1], [bx, by] = pts[i], ina = Math.hypot(ax - cx, ay - cy) < r, inb = Math.hypot(bx - cx, by - cy) < r;
    if (!ina || inb) continue;
    let lo = 0, hi = 1;
    for (let k = 0; k < 24; k++) { const m = (lo + hi) / 2; if (Math.hypot(ax + (bx - ax) * m - cx, ay + (by - ay) * m - cy) < r) lo = m; else hi = m; }
    hit = [ax + (bx - ax) * lo, ay + (by - ay) * lo];
  }
  return hit;
}

export function createNavRadar(C) {
  const $ = (id) => document.getElementById(id);
  const root = $("navradar"), cv = $("nrcanvas"), g = cv.getContext("2d"), fit = (t, w) => fitIn(g, t, w);
  let open = false, timer = 0, dirty = true;
  // the world: the route, its runs and junctions, the trails round it
  let route = null, P = null, runs = [], J = [], net = null, netBox = null, netSeq = 0;
  // the view: the scale drawn (eases to the wanted one), north up, a hand on it, a look along a trail, the bar's finger
  let shownS = null, northUp = false, manual = null, peek = null, scrub = null, last = null, cardKey = "";
  let hits = { signs: [], N: null, bar: null }, frameInfo = null;
  // 3D: the height grid (the camera's, loaded once), the terrain, the route on it (again when you walked on 8 m)
  let want3d = (() => { try { return localStorage.getItem("zdrapka.nav3d") !== "0"; } catch { return true; } })();
  let dem = null, demLoading = false, demStatus = "", t3 = null, onDem = null, geoAt = -1e9, pitchNow = 58;

  // ---- where you are: the GPS on the pack's metres
  function meNow() {
    const f = C.gps?.fix, meta = C.view?.meta;
    if (!f || !meta) return null;
    const [x, y] = projector(meta)(f.lon, f.lat);
    return { x, y, acc: f.acc, t: f.t };
  }

  // ---- the route and the trails round it (once per route; a long one: 4 km round you, again after 2 km)
  function syncRoute() {
    const r = C.planner?.activeRoute?.();
    if (r === route) return;
    route = r; P = r?.P || null; runs = r ? runsAlong(r) : []; J = []; net = null; netBox = null; dirty = true; onDem = null; geoAt = -1e9;
    if (P) loadNet();
  }
  const ll = (p) => unprojector(C.view.meta)(p[0], p[1]);
  // (the grid covers 13.2–19.3° E, 49.0–52.0° N: elsewhere its 16 MB are not fetched)
  const GRID = [13.2, 49.0, 19.3, 52.0];
  async function loadDem3d() {
    if (dem || demLoading || typeof maplibregl === "undefined" || !P) return;
    const a = ll([P.x[0], P.y[0]]), z = ll([P.x[P.x.length - 1], P.y[P.y.length - 1]]);
    if (![a, z].every(([lon, lat]) => lon > GRID[0] && lon < GRID[2] && lat > GRID[1] && lat < GRID[3])) return;
    demLoading = true;
    try { dem = await loadDem(camOverrides().dem || DEM_URL, (t) => { demStatus = t; dirty = true; }); } catch { dem = null; }
    demLoading = false; demStatus = ""; dirty = true;
  }
  /** The terrain: wanted, the grid there and the route on it (else the flat radar). */
  function sync3d() {
    if (dem && P && onDem == null) { const pts = []; for (let i = 0; i < P.d.length; i += 10) pts.push(ll([P.x[i], P.y[i]])); onDem = onGrid(dem, pts); }
    const can = !!(dem && P && onDem), on = can && want3d;
    $("nr3d").hidden = !can; $("nr3d").textContent = on ? "3D" : "2D";
    if (on && !t3) { try { t3 = createNavTerrain(root, cv, dem, C.view?.parts, () => { dirty = true; }); geoAt = -1e9; } catch { t3 = null; want3d = false; } }
    if (!on && t3) { t3.destroy(); t3 = null; }
    return !!t3;
  }
  /** The route for the terrain: walked violet, ahead run by run in its colours. */
  function routeGeo(d) {
    const n = P.d.length, walked = [], feats = [];
    for (let i = 0; i < n && P.d[i] <= d; i++) walked.push(ll([P.x[i], P.y[i]]));
    walked.push(ll(pointAt(P, d)));
    if (walked.length > 1) feats.push({ type: "Feature", properties: { w: 1, cols: "" }, geometry: { type: "LineString", coordinates: walked } });
    for (const rn of runs) {
      if (rn.d1 < d) continue;
      const a = Math.max(d, rn.d0), pts = [ll(pointAt(P, a))];
      for (let i = 0; i < n; i++) if (P.d[i] > a && P.d[i] < rn.d1) pts.push(ll([P.x[i], P.y[i]]));
      pts.push(ll(pointAt(P, rn.d1)));
      if (pts.length > 1) feats.push({ type: "Feature", properties: { w: 0, cols: rn.cols || "" }, geometry: { type: "LineString", coordinates: pts } });
    }
    return { type: "FeatureCollection", features: feats };
  }
  function loadNet(me = null) {
    if (!P || !C.call) return;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (let i = 0; i < P.d.length; i++) { x0 = Math.min(x0, P.x[i]); x1 = Math.max(x1, P.x[i]); y0 = Math.min(y0, P.y[i]); y1 = Math.max(y1, P.y[i]); }
    let box = [x0 - 600, y0 - 600, x1 + 600, y1 + 600];
    if (Math.hypot(x1 - x0, y1 - y0) > 25000) { const c = me || { x: P.x[0], y: P.y[0] }; box = [c.x - 4000, c.y - 4000, c.x + 4000, c.y + 4000]; }
    netBox = { box, at: me, long: box[2] - box[0] < x1 - x0 + 1000 };
    const my = ++netSeq;
    C.call("trailsNear", { x0: box[0], y0: box[1], x1: box[2], y1: box[3] }).then((res) => {
      if (my !== netSeq || !res) return;
      net = res; J = junctionsOn(P, res.ways, res.places); dirty = true;
    }).catch(() => {});
  }

  // ---- the layout: the circle between the trails' pill and the card, the bar at the right
  function layout() {
    const W = cv.clientWidth, H = cv.clientHeight, dpr = devicePixelRatio || 1;
    if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(H * dpr)) { cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); }
    const rr = (el) => el.getBoundingClientRect(), cvr = rr(cv);
    const top = rr($("nrtrail")).bottom - cvr.top + 10, offShown = !$("nroff").hidden;
    const bottom = (offShown ? rr($("nroff")).top : rr($("nrcard")).top) - cvr.top - 30;
    const barW = 52, r = Math.max(60, Math.min((W - barW - 28) / 2, (bottom - top) / 2));
    const cx = 12 + (W - barW - 24) / 2, cy = top + (bottom - top) / 2;
    // (the drawn region: the circle; 3D: the frame between the pill and the card, left of the bar)
    return { W, H, dpr, top, bottom, r, cx, cy, barX: W - 28, x0: cx - r, x1: cx + r, inside: (x, y, m = 0) => Math.hypot(x - cx, y - cy) < r - m, exit: (pts) => exitPoint(pts, cx, cy, r) };
  }

  // ---- one frame: what is where, then the drawing (only when something changed)
  function frame() {
    if (!open) return;
    syncRoute();
    if (!P) { status("Brak aktywnej trasy."); return; }
    const me = meNow(), mi = C.planner?.meAt?.() ?? null, n = P.d.length, D = P.d[n - 1];
    let d = 0, off = false, offBy = 0, back = null;
    if (me) {
      const q = nearestOn(P, me.x, me.y, mi != null ? Math.max(0, mi - 8) : 0, mi != null ? Math.min(n - 1, mi + 8) : n - 1);
      d = q.d;
      if (mi == null && q.dist > 40) { off = true; offBy = q.dist; back = [q.x, q.y]; }
    } else if (mi != null) d = P.d[mi];
    // a long route: the trails again when you are 2 km from where they were loaded
    if (me && netBox?.long && netBox.at && Math.hypot(me.x - netBox.at.x, me.y - netBox.at.y) > 2000) loadNet(me);
    const pos = me ? [me.x, me.y] : pointAt(P, d);
    const next = off ? null : J.find((j) => j.d > d + 3) || null, prev = off ? null : [...J].reverse().find((j) => j.d <= d + 3) || null;
    const toNext = next ? next.d - d : null, sincePrev = prev ? d - prev.d : null;
    const k = off ? 0 : zoomIn(toNext, sincePrev), zj = k > 0 ? (toNext != null && toNext < 160 ? next : prev) : null;
    const heading = C.gps?.heading ?? null, rot = northUp || heading == null ? 0 : heading;
    // the hand back to the guide: 15 s after the last touch once you walked on 30 m; a look along a trail: 4 s
    const now = Date.now();
    if (manual && now - manual.t > 15000 && me && manual.at && Math.hypot(me.x - manual.at[0], me.y - manual.at[1]) > 30) manual = null;
    if (peek && now > peek.until) peek = null;
    const L = layout();
    // the bar's finger: you and that place on the route, both in the circle
    const sp = scrub ? [P.x[scrub.i], P.y[scrub.i]] : null, sd = sp ? Math.hypot(sp[0] - pos[0], sp[1] - pos[1]) : 0;
    const wantS = sp ? (L.r * 0.85) / Math.max(150, sd * 0.75 + 60) : peek?.s ?? manual?.s ?? (L.r * 0.92) / (FAR_M + (NEAR_M - FAR_M) * k);
    shownS = shownS == null ? wantS : shownS + (wantS - shownS) * 0.3;
    const easing = Math.abs(shownS - wantS) / wantS > 0.004;
    if (!easing) shownS = wantS;
    const center = sp ? [pos[0] + (sp[0] - pos[0]) * 0.55, pos[1] + (sp[1] - pos[1]) * 0.55] : peek?.center || (manual?.pan ? [pos[0] + manual.pan[0], pos[1] + manual.pan[1]] : pos);
    const in3d = sync3d();
    // the terrain's tilt: back behind you between junctions, nearly flat at one (a hand on it: as it was)
    const wantPitch = sp || peek ? 30 : manual ? pitchNow : 58 - 48 * k;
    const easingP = Math.abs(wantPitch - pitchNow) > 0.5;
    pitchNow = easingP ? pitchNow + (wantPitch - pitchNow) * 0.3 : wantPitch;
    const key = JSON.stringify([Math.round(pos[0]), Math.round(pos[1]), Math.round(rot), shownS.toFixed(4), Math.round(center[0]), Math.round(center[1]), J.length, !!net, off, northUp, scrub?.i, L.W, L.H, !!manual, !!peek, heading == null, in3d, Math.round(pitchNow)]);
    frameInfo = { d, D, off, offBy, back, next, prev, toNext, sincePrev, k, zj, heading, rot, me, pos, mi };
    card(frameInfo);
    if (key !== last || dirty || easing || easingP) { last = key; dirty = false; if (in3d) draw3d(L, frameInfo, center); else draw(L, frameInfo, center); }
    status(demStatus || (me ? "" : C.gps?.on ? "Szukam pozycji…" : ""));
  }
  function status(t) { $("nrsub").dataset.status = t || ""; }

  // ---- the drawing
  function draw(L, F, center) {
    const { W, H, dpr, r, cx, cy } = L, s = shownS, rot = F.rot * (Math.PI / 180);
    const oy = cy + r * 0.35, cosR = Math.cos(-rot), sinR = Math.sin(-rot);
    const V = (p) => { const vx = p[0] - center[0], vy = p[1] - center[1]; return [cx + s * (vx * cosR - vy * sinR), oy + s * (vx * sinR + vy * cosR)]; };
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, W, H);
    // the disc and its rings (from you)
    g.fillStyle = DISC; g.strokeStyle = "rgba(255,255,255,.18)"; g.lineWidth = 1.5;
    g.beginPath(); g.arc(cx, cy, r, 0, 7); g.fill(); g.stroke();
    g.save(); g.beginPath(); g.arc(cx, cy, r - 1, 0, 7); g.clip();
    const ring = [25, 50, 100, 250, 500, 1000, 2500, 5000].find((m) => m * s >= r * 0.36) || 5000, mePx = V(F.pos);
    g.setLineDash([3, 4]); g.strokeStyle = "rgba(255,255,255,.13)"; g.lineWidth = 1;
    for (let q = 1; q <= 3; q++) { g.beginPath(); g.arc(mePx[0], mePx[1], ring * q * s, 0, 7); g.stroke(); }
    g.setLineDash([]);
    g.font = "10px system-ui, sans-serif"; g.fillStyle = "rgba(255,255,255,.55)"; g.fillText(`${ring} m`, mePx[0] + 5, mePx[1] - ring * s - 4);
    const line = (pts, col, w, alpha = 1, dash = null) => { if (pts.length < 2) return; g.globalAlpha = alpha; g.strokeStyle = col; g.lineWidth = w; g.lineCap = "round"; g.lineJoin = "round"; g.setLineDash(dash || []); g.beginPath(); pts.forEach((p, i) => { const [x, y] = V(p); if (i) g.lineTo(x, y); else g.moveTo(x, y); }); g.stroke(); g.globalAlpha = 1; g.setLineDash([]); };
    // the other trails: close to a junction, or when you look round yourself
    const others = net && (F.k > 0.05 || manual || peek) ? (manual || peek ? 0.6 : 0.85 * F.k) : 0;
    if (others) for (const w of net.ways) { const pts = w.xs.map((x, i) => [x, w.ys[i]]); line(pts, colOf(w.cols), F.k > 0.5 ? 6 : 4, others); }
    // the route: walked violet; ahead in its trails' colours in the plan's orange edge
    const n = P.d.length, doneP = [], aheadP = [];
    for (let i = 0; i < n; i++) { if (P.d[i] <= F.d) doneP.push([P.x[i], P.y[i]]); if (P.d[i] >= F.d) aheadP.push([P.x[i], P.y[i]]); }
    const here = pointAt(P, F.d); doneP.push(here); aheadP.unshift(here);
    line(doneP, VIOLET, 6);
    line(aheadP, ORANGE, 15); line(aheadP, "#0d100e", 10.5, 0.6);
    for (const rn of runs) {
      if (rn.d1 < F.d) continue;
      const pts = [pointAt(P, Math.max(F.d, rn.d0))];
      for (let i = 0; i < n; i++) if (P.d[i] > Math.max(F.d, rn.d0) && P.d[i] < rn.d1) pts.push([P.x[i], P.y[i]]);
      pts.push(pointAt(P, rn.d1));
      const cs = String(rn.cols || "").split(",").filter((c) => TC[c]);
      line(pts, cs.length ? TC[cs[0]] : "#9aa09c", 7.5);
      if (cs[1]) line(pts, TC[cs[1]], 2.6);
    }
    marks(L, F, V, mePx);
    g.restore();
    // north on the rim (a tap: north up / the phone's way)
    const nr = -rot, nx = cx + Math.sin(nr) * (r - 14), ny = cy - Math.cos(nr) * (r - 14);
    g.font = "800 13px system-ui, sans-serif"; g.textAlign = "center"; g.fillStyle = "#e0262e"; g.fillText("N", nx, ny + 5);
    if (northUp) { g.strokeStyle = "#e0262e"; g.lineWidth = 1.5; g.beginPath(); g.arc(nx, ny, 11, 0, 7); g.stroke(); }
    g.textAlign = "left";
    hits = { signs: [], N: { x: nx, y: ny, r: 22 }, bar: null };
    signs(L, F, V);
    bar(L, F);
  }

  // ---- 3D: the terrain behind you, the marks over it
  function draw3d(L, F, center) {
    const { W, H, dpr } = L, c = ll(center);
    // the scale: what the circle would hold, a little more (the tilt shows far further)
    const mpp = 1 / (shownS * 1.15), zoom = Math.log2((40075016.686 * Math.cos((c[1] * Math.PI) / 180)) / (512 * mpp));
    const cardTop = L.bottom + 30, yMe = L.top + (L.bottom - L.top) * 0.74;
    t3.setCamera({ center: c, zoom, bearing: F.rot, pitch: pitchNow, padding: { top: Math.max(0, 2 * yMe - cardTop), bottom: Math.max(0, H - cardTop), left: 0, right: 56 } });
    if (Math.abs(F.d - geoAt) > 8) { geoAt = F.d; t3.setRoute(routeGeo(F.d)); }
    t3.setTrails(manual || peek ? 0.7 : 0.3 + 0.55 * F.k);
    const V = (p) => t3.project(ll(p)), R = { x0: 0, y0: L.top - 6, x1: W - 58, y1: cardTop - 6 };
    const L3 = { ...L, rect: R, x0: R.x0, x1: R.x1, r: (R.x1 - R.x0) / 2, inside: (x, y, m = 0) => x > R.x0 + m && x < R.x1 - m && y > R.y0 + m && y < R.y1 - m, exit: (pts) => exitRect(pts, R) };
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, W, H);
    marks(L3, F, V, V(F.pos));
    // north: a small compass at the frame's corner (a tap: north up / the phone's way)
    const nx = 34, ny = L.top + 22, nr = (-F.rot * Math.PI) / 180;
    g.fillStyle = "rgba(20,22,21,.62)"; g.beginPath(); g.arc(nx, ny, 17, 0, 7); g.fill();
    if (northUp) { g.strokeStyle = "#e0262e"; g.lineWidth = 1.5; g.stroke(); }
    g.save(); g.translate(nx, ny); g.rotate(nr);
    g.fillStyle = "#e0262e"; g.beginPath(); g.moveTo(0, -12); g.lineTo(5, 0); g.lineTo(-5, 0); g.closePath(); g.fill();
    g.fillStyle = "rgba(255,255,255,.75)"; g.beginPath(); g.moveTo(0, 12); g.lineTo(5, 0); g.lineTo(-5, 0); g.closePath(); g.fill();
    g.restore();
    hits = { signs: [], N: { x: nx, y: ny, r: 22 }, bar: null };
    signs(L3, F, V);
    bar(L, F);
  }

  /** What is drawn over the route alike in 2D and 3D: the junctions ahead (the arrow on your arm at the one zoomed
   * on), the goal's flag, the way back when off the route, the bar's finger, you with the compass's cone. */
  function marks(L, F, V, mePx) {
    // the junctions ahead: dots; the one zoomed on: the arrow on the arm you take
    for (const j of J) if (j.d > F.d - 30) { const [x, y] = V([j.x, j.y]); g.fillStyle = "#fff"; g.strokeStyle = "#0d100e"; g.lineWidth = 2; g.beginPath(); g.arc(x, y, j === F.zj ? 7 : 4.5, 0, 7); g.fill(); g.stroke(); }
    if (F.zj && F.k > 0.2 && F.zj.mine >= 0) {
      const a = F.zj.arms[F.zj.mine], j0 = V([F.zj.x, F.zj.y]);
      let tip = null, acc = 0;
      for (let i = 1; i < a.pts.length && !tip; i++) { const p0 = V(a.pts[i - 1]), p1 = V(a.pts[i]), l = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]); if (acc + l >= 44) { const t = (44 - acc) / l; tip = [p0[0] + (p1[0] - p0[0]) * t, p0[1] + (p1[1] - p0[1]) * t]; } acc += l; }
      if (tip) { const ang = Math.atan2(tip[1] - j0[1], tip[0] - j0[0]); g.save(); g.translate(tip[0], tip[1]); g.rotate(ang); g.fillStyle = ORANGE; g.strokeStyle = "#0d100e"; g.lineWidth = 1.5; g.beginPath(); g.moveTo(0, 0); g.lineTo(-17, -10); g.lineTo(-17, 10); g.closePath(); g.fill(); g.stroke(); g.restore(); }
    }
    // the goal: a flag (its name when it is inside)
    const n = P.d.length, end = V([P.x[n - 1], P.y[n - 1]]), goal = C.planner?.goal?.() || "Cel";
    g.font = "18px system-ui, sans-serif"; g.textAlign = "center"; g.fillStyle = ORANGE; g.fillText("⚑", end[0], end[1] + 6);
    if (L.inside(end[0], end[1], 10)) { g.font = "700 12px system-ui, sans-serif"; const gl = fit(goal, L.r * 1.2), half = g.measureText(gl).width / 2 + 8, gx = Math.max(L.x0 + half, Math.min(L.x1 - half, end[0])); g.lineWidth = 3; g.strokeStyle = DISC; g.strokeText(gl, gx, end[1] - 12); g.fillText(gl, gx, end[1] - 12); }
    g.textAlign = "left";
    // off the route: the way back, dashed
    if (F.off && F.back) { const b = V(F.back); g.setLineDash([4, 4]); g.strokeStyle = "#fff"; g.lineWidth = 2; g.beginPath(); g.moveTo(mePx[0], mePx[1]); g.lineTo(b[0], b[1]); g.stroke(); g.setLineDash([]); }
    // the bar's finger: that place on the route
    if (scrub) { const [x, y] = V([P.x[scrub.i], P.y[scrub.i]]); g.strokeStyle = "#fff"; g.lineWidth = 2.5; g.beginPath(); g.arc(x, y, 9, 0, 7); g.stroke(); g.fillStyle = sCol(P.slope[scrub.i] || 0); g.beginPath(); g.arc(x, y, 5, 0, 7); g.fill(); }
    // you: the compass's doubt as a cone, the arrow your way
    const yourWay = F.heading == null ? null : (F.heading - F.rot) * (Math.PI / 180);
    if (yourWay != null) {
      g.save(); g.translate(mePx[0], mePx[1]); g.rotate(yourWay);
      g.fillStyle = "rgba(90,150,255,.20)"; g.beginPath(); g.moveTo(0, 0); g.arc(0, 0, 66, -Math.PI / 2 - 0.34, -Math.PI / 2 + 0.34); g.closePath(); g.fill();
      g.fillStyle = ME; g.strokeStyle = "#fff"; g.lineWidth = 2.5; g.beginPath(); g.moveTo(0, -13); g.lineTo(10, 10); g.lineTo(0, 5); g.lineTo(-10, 10); g.closePath(); g.fill(); g.stroke();
      g.restore();
    } else { g.fillStyle = ME; g.strokeStyle = "#fff"; g.lineWidth = 2.5; g.beginPath(); g.arc(mePx[0], mePx[1], 8, 0, 7); g.fill(); g.stroke(); }
  }

  // ---- the signs at the circle's edge: where each arm of the junction leads (yours ringed orange), or the goal
  function signs(L, F, V) {
    const { cx, cy, r, W } = L, placed = [], goal = C.planner?.goal?.() || "Cel";
    const sign = (pts, label, cols, mine, arm) => {
      const at = L.exit(pts.map(V));
      if (!at) return;
      g.font = `${mine ? 800 : 650} 12px system-ui, sans-serif`;
      label = fit(label, Math.min(W - 110, r * 1.5));
      const w = g.measureText(label).width + 36, h = 23;
      let x, y;
      if (L.rect) { const R = L.rect; x = at[0] - w / 2; y = at[1] - h / 2; if (at[1] <= R.y0 + 2) y = R.y0 + 6; if (at[1] >= R.y1 - 2) y = R.y1 - h - 6; if (at[0] <= R.x0 + 2) x = R.x0 + 6; if (at[0] >= R.x1 - 2) x = R.x1 - w - 6; }
      else { const ux = (at[0] - cx) / r, uy = (at[1] - cy) / r; x = cx + ux * (r - 24) - w / 2 + ux * (w / 2 - 16); y = cy + uy * (r - 24) - h / 2; }
      x = Math.max(6, Math.min(W - 60 - w, x));
      for (const p of placed) if (Math.abs(p[0] - x) < w && Math.abs(p[1] - y) < h + 3) y += y >= p[1] ? h + 4 : -(h + 4);
      placed.push([x, y]);
      g.fillStyle = "rgba(0,0,0,.35)"; g.beginPath(); g.roundRect(x, y + 1.5, w, h, 7); g.fill();
      g.fillStyle = "#fff"; g.beginPath(); g.roundRect(x, y, w, h, 7); g.fill();
      if (mine) { g.strokeStyle = ORANGE; g.lineWidth = 3; g.stroke(); }
      g.fillStyle = "#fff"; g.strokeStyle = "#cfd3d1"; g.lineWidth = 1; g.beginPath(); g.roundRect(x + 7, y + 6.5, 17, 10, 1.5); g.fill(); g.stroke();
      g.fillStyle = colOf(cols); g.fillRect(x + 7, y + 9.8, 17, 3.4);
      g.fillStyle = "#1d1f1e"; g.fillText(label, x + 30, y + 16);
      hits.signs.push({ x, y, w, h, label, mine, arm });
    };
    const j = F.zj;
    if (j && F.k > 0.2) {
      j.arms.forEach((a, i) => { if (i === j.from) return; const mine = i === j.mine; sign(a.pts, mine ? a.to || goal : a.to || colsText(a.cols), mine ? colsAt(runs, Math.min(F.D, j.d + 30)) || a.cols : a.cols, mine, a); });
    } else if (!F.off) {
      const pts = []; for (let i = 0; i < P.d.length; i++) if (P.d[i] >= F.d) pts.push([P.x[i], P.y[i]]);
      const act = C.planner?.pill?.();
      sign(pts, act?.ms ? `${goal} · ${C.hm(act.ms)}` : goal, colsAt(runs, F.d), true, null);
    }
  }

  // ---- the height bar: the route from its lowest point to its highest; each climb in its slope's colour, walked violet
  function bar(L, F) {
    const x = L.barX, y0 = L.top + 34, y1 = L.bottom - 4, n = P.d.length;
    let lo = Infinity, hi = -Infinity;
    for (let i = 0; i < n; i++) if (Number.isFinite(P.h[i])) { lo = Math.min(lo, P.h[i]); hi = Math.max(hi, P.h[i]); }
    if (!(hi > lo)) return;
    const Y = (h) => y1 - ((y1 - y0) * (h - lo)) / (hi - lo);
    g.fillStyle = "rgba(20,22,21,.62)"; g.beginPath(); g.roundRect(x - 18, y0 - 26, 36, y1 - y0 + 48, 18); g.fill();
    g.fillStyle = "rgba(255,255,255,.12)"; g.beginPath(); g.roundRect(x - 3.5, y0, 7, y1 - y0, 3.5); g.fill();
    // (walked first, what is ahead over it: where the route comes by a height again, the bar shows it to come)
    for (const ahead of [false, true]) for (let i = 1; i < n; i++) {
      const a = P.h[i - 1], b = P.h[i];
      if (!(Number.isFinite(a) && Number.isFinite(b)) || a === b || (P.d[i] > F.d) !== ahead) continue;
      g.fillStyle = ahead ? sCol(P.slope[i] || 0) : VIOLET; g.fillRect(x - 3.5, Y(Math.max(a, b)), 7, Math.abs(Y(a) - Y(b)) + 0.6);
    }
    const hEnd = P.h[n - 1];
    g.font = "13px system-ui, sans-serif"; g.textAlign = "center"; g.fillStyle = ORANGE; g.fillText("⚑", x + (Number.isFinite(hEnd) && hEnd < hi - 1 ? 13 : 0), Number.isFinite(hEnd) && hEnd < hi - 1 ? Y(hEnd) + 5 : y0 - 10);
    const label = (t, yy) => { g.font = "700 11.5px system-ui, sans-serif"; g.textAlign = "right"; g.lineWidth = 3; g.strokeStyle = "#151917"; g.strokeText(t, x - 24, yy); g.fillStyle = "#fff"; g.fillText(t, x - 24, yy); };
    const pill = (pct, yy, rightX) => { g.font = "700 11.5px system-ui, sans-serif"; const t = slopeText(pct), w = g.measureText(t).width + 14; g.fillStyle = sCol(pct); g.beginPath(); g.roundRect(rightX - w, yy, w, 19, 9.5); g.fill(); g.fillStyle = "#fff"; g.textAlign = "left"; g.fillText(t, rightX - w + 7, yy + 13.5); };
    label(String(Math.round(hi)), y0 + 4);
    const h = heightAt(P, F.d);
    if (Number.isFinite(h)) {
      const yy = Y(h);
      g.fillStyle = ME; g.strokeStyle = "#fff"; g.lineWidth = 2; g.beginPath(); g.arc(x, yy, 7, 0, 7); g.fill(); g.stroke();
      label(`${Math.round(h)} m`, yy + 4);
      pill(P.slope[Math.min(n - 1, P.d.findIndex((v) => v >= F.d))] || 0, yy - 30, x - 24);
    }
    if (scrub) {
      const hh = P.h[scrub.i], yy = Y(hh);
      g.strokeStyle = "#fff"; g.lineWidth = 2; g.beginPath(); g.arc(x, yy, 8, 0, 7); g.stroke();
      const t = `${Math.round(hh)} m · ${slopeText(P.slope[scrub.i] || 0)} · ${P.d[scrub.i] > F.d ? `za ${fmtM(P.d[scrub.i] - F.d)}` : "za tobą"}`;
      g.font = "700 12px system-ui, sans-serif"; const w = g.measureText(t).width + 16;
      g.fillStyle = "#fff"; g.beginPath(); g.roundRect(x - 26 - w, yy - 12, w, 24, 12); g.fill();
      g.fillStyle = "#1d1f1e"; g.textAlign = "left"; g.fillText(t, x - 18 - w, yy + 4);
    }
    g.textAlign = "left";
    hits.bar = { x0: x - 26, x1: L.W, y0: y0 - 12, y1: y1 + 12, Y, lo, hi };
  }

  // ---- the words: the top, the trails' pill, off the route, the card
  function card(F) {
    const act = C.planner?.pill?.(), goal = C.planner?.goal?.() || "Cel", h = F.heading;
    const head = `${goal}${act?.ms ? ` · ${C.hm(act.ms)}` : ""}`;
    const st = $("nrsub").dataset.status;
    const sub = st || [h != null ? `${Math.round(h)}° ${DIRS[Math.round(h / 45) % 8]}` : "bez kompasu", F.me?.acc != null ? `GPS ±${Math.round(F.me.acc)} m` : null].filter(Boolean).join(" · ");
    let a, b, trail;
    const cols = colsAt(runs, F.d);
    if (F.off) {
      const rel = h != null ? wrap180(bearingXY(F.back[0] - F.me.x, F.back[1] - F.me.y) - h) : null;
      const side = rel == null ? `na ${DIRS[Math.round(bearingXY(F.back[0] - F.me.x, F.back[1] - F.me.y) / 45) % 8]}` : rel < -30 ? "w lewo" : rel > 30 ? "w prawo" : "przed tobą";
      a = "Najpierw wróć na trasę"; b = `<em>${fmtM(F.offBy)} ${side}</em>, potem ${colsText(cols, true)}`;
      trail = `<span>poza trasą</span>`;
      $("nrofft").textContent = `Poza trasą · ${fmtM(F.offBy)}`; $("nroffs").textContent = `wróć ${side}, najkrócej na ${colsText(cols).split(" + ")[0]}`;
    } else {
      const j = F.next;
      if (j && F.toNext < 1500) {
        const t = turnAt(P, j.d), out = colsAt(runs, Math.min(F.D, j.d + 30)), arm = j.mine >= 0 ? j.arms[j.mine] : null;
        a = F.toNext < 20 ? `Teraz · ${j.name || "rozwidlenie"}` : `Za ${fmtM(F.toNext)} · ${j.name || "rozwidlenie"}`;
        b = `<em>${t.word}</em>, ${colsText(out, true)}${arm?.to ? ` → ${esc(arm.to)}` : ""}`;
      } else {
        const c = colsText(cols, true);
        a = `${c[0].toUpperCase()}${c.slice(1)} dalej`; b = j ? `bez rozwidleń przez ${fmtM(F.toNext)}` : `do celu bez rozwidleń`;
      }
      trail = cols.split(",").filter((c) => TC[c]).map((c) => `<i style="--c:${TC[c]}"></i>`).join("") + `<span>${colsText(cols)}</span>`;
    }
    const goalV = act ? [act.ms ? C.hm(act.ms) : null, act.km != null ? `${act.km.toFixed(1).replace(".", ",")} km` : null, act.up != null ? `↑ ${Math.round(act.up)} m` : null].filter(Boolean).join(" · ") : "";
    const c = F.off ? null : climbAhead(P, F.d);
    const climb = c ? `<i style="background:${sCol(c.max)}">${slopeText(c.max)}</i><span>${c.now ? `teraz stromo · jeszcze ${fmtM(c.to)} po ${Math.round(c.avg)}%` : `najstromiej · za ${fmtM(c.from)}, ${fmtM(c.len)} po ${Math.round(c.avg)}%`}</span>` : "";
    const pill = manual || peek ? "↺ prowadź" : northUp && h != null ? "N ↑" : "";
    const k = JSON.stringify([head, sub, a, b, trail, goal, goalV, climb, F.off, pill]);
    if (k === cardKey) return;
    cardKey = k;
    $("nrhead").textContent = head; $("nrsub").textContent = sub;
    $("nra").textContent = a; $("nrb").innerHTML = b;
    $("nrtrail").innerHTML = trail; $("nrtrail").classList.toggle("off", F.off);
    $("nrgoal").textContent = goal; $("nrgoalv").textContent = goalV;
    $("nrclimb").innerHTML = climb;
    $("nrpill").textContent = pill; $("nrpill").hidden = !pill;
    const wasOff = !$("nroff").hidden;
    $("nroff").hidden = !F.off;
    if (F.off) { const cr = $("nrcard").getBoundingClientRect(); $("nroff").style.top = ""; $("nroff").style.bottom = `${innerHeight - cr.top + 8}px`; }
    if (wasOff !== F.off) dirty = true;
  }

  // ---- fingers
  const pts = new Map();
  let gest = null; // {kind: "pan" | "pinch" | "bar" | "tap", ...}
  const toWorld = (dx, dy) => { const t = (frameInfo?.rot || 0) * (Math.PI / 180), c = Math.cos(t), s = Math.sin(t); return [(dx * c - dy * s) / shownS, (dx * s + dy * c) / shownS]; };
  function handHere() { const F = frameInfo; manual = { s: manual?.s ?? shownS, pan: manual?.pan ?? (peek ? [peek.center[0] - F.pos[0], peek.center[1] - F.pos[1]] : [0, 0]), t: Date.now(), at: F?.me ? [F.me.x, F.me.y] : null }; peek = null; }
  function scrubAt(y) {
    const B = hits.bar; if (!B || !P) return;
    const h = B.lo + ((B.Y(B.lo) - y) / (B.Y(B.lo) - B.Y(B.hi))) * (B.hi - B.lo), d = frameInfo?.d ?? 0;
    let bi = -1, bd = Infinity;
    for (let i = 0; i < P.d.length; i++) { if (!Number.isFinite(P.h[i])) continue; const e = Math.abs(P.h[i] - h) + (P.d[i] < d ? 1e4 : 0) + P.d[i] * 1e-4; if (e < bd) { bd = e; bi = i; } }
    scrub = bi >= 0 ? { i: bi } : null; dirty = true;
  }
  cv.addEventListener("pointerdown", (e) => {
    cv.setPointerCapture(e.pointerId);
    const r0 = cv.getBoundingClientRect(), x = e.clientX - r0.left, y = e.clientY - r0.top;
    pts.set(e.pointerId, { x, y });
    const B = hits.bar;
    if (pts.size === 1 && B && x >= B.x0 && y >= B.y0 && y <= B.y1) { gest = { kind: "bar" }; scrubAt(y); frame(); return; }
    if (pts.size === 2) { const [a, b] = [...pts.values()]; gest = { kind: "pinch", d0: Math.hypot(a.x - b.x, a.y - b.y), s0: shownS }; handHere(); return; }
    gest = { kind: "tap", x0: x, y0: y, x, y };
  });
  cv.addEventListener("pointermove", (e) => {
    if (!pts.has(e.pointerId) || !gest) return;
    const r0 = cv.getBoundingClientRect(), x = e.clientX - r0.left, y = e.clientY - r0.top, p = pts.get(e.pointerId);
    const dx = x - p.x, dy = y - p.y; p.x = x; p.y = y;
    if (gest.kind === "bar") { scrubAt(y); frame(); return; }
    if (gest.kind === "pinch" && pts.size >= 2) {
      const [a, b] = [...pts.values()], L = layout();
      manual.s = Math.max(L.r / 6000, Math.min(L.r / 40, (gest.s0 * Math.hypot(a.x - b.x, a.y - b.y)) / (gest.d0 || 1)));
      const w = toWorld(dx / 2, dy / 2); manual.pan[0] -= w[0]; manual.pan[1] -= w[1]; manual.t = Date.now(); frame(); return;
    }
    if (gest.kind === "tap" && Math.hypot(x - gest.x0, y - gest.y0) > 8) { gest.kind = "pan"; handHere(); }
    if (gest.kind === "pan") { const w = toWorld(dx, dy); manual.pan[0] -= w[0]; manual.pan[1] -= w[1]; manual.t = Date.now(); frame(); }
  });
  const up = (e) => {
    const p = pts.get(e.pointerId); pts.delete(e.pointerId);
    if (gest?.kind === "bar" && !pts.size) { scrub = null; gest = null; dirty = true; frame(); return; }
    if (gest?.kind === "tap" && p && e.type === "pointerup") tap(p.x, p.y);
    if (!pts.size) gest = null; else if (gest?.kind === "pinch") gest = { kind: "pan" };
  };
  cv.addEventListener("pointerup", up); cv.addEventListener("pointercancel", up);
  function tap(x, y) {
    const N = hits.N;
    if (N && Math.hypot(x - N.x, y - N.y) <= N.r) { northUp = !northUp; dirty = true; frame(); return; }
    const sg = hits.signs.find((q) => x >= q.x - 4 && x <= q.x + q.w + 4 && y >= q.y - 4 && y <= q.y + q.h + 4);
    if (sg?.arm) {
      // a look along that trail: its drawn part, whole, for 4 s
      const a = sg.arm.pts, q = a[a.length - 1], L = layout(), len = Math.hypot(q[0] - a[0][0], q[1] - a[0][1]);
      peek = { center: [(a[0][0] + q[0]) / 2, (a[0][1] + q[1]) / 2], s: (L.r * 0.8) / Math.max(80, len / 2 + 40), until: Date.now() + 4000 };
      dirty = true; frame();
    }
  }
  $("nrpill").onclick = () => { if (manual || peek) { manual = null; peek = null; } else northUp = false; dirty = true; frame(); };
  $("nrcard").onclick = () => { $("nrcard").classList.toggle("mini"); dirty = true; requestAnimationFrame(frame); };
  $("nrx").onclick = () => close();
  $("nr3d").onclick = () => { want3d = !want3d; try { localStorage.setItem("zdrapka.nav3d", want3d ? "1" : "0"); } catch { /* private */ } dirty = true; frame(); };
  addEventListener("resize", () => { dirty = true; });

  // ---- open, close, the button (only with an active route)
  function syncBtn() {
    const on = !!C.planner?.isActive?.();
    $("navradarbtn").hidden = !on;
    if (!on && open) close();
  }
  function show() {
    if (open || !C.planner?.isActive?.()) return;
    open = true; root.hidden = false; document.documentElement.classList.add("pcopen");
    manual = peek = scrub = null; shownS = null; last = null; cardKey = ""; dirty = true; route = null;
    if (C.gps && !C.gps.on) { C.gps.start(); C.gpsUi?.(); }
    syncRoute(); loadDem3d();
    frame();
    timer = setInterval(frame, 66); // (~15 a second: the compass's pace; drawn only when something moved)
  }
  function close() {
    if (!open) return;
    open = false; root.hidden = true; document.documentElement.classList.remove("pcopen");
    clearInterval(timer); timer = 0; pts.clear(); gest = null;
    t3?.destroy(); t3 = null;
  }
  /** Back: a hand on the view first (back to the guide), then the view. */
  function back() { if (manual || peek) { manual = peek = null; dirty = true; frame(); } else close(); }
  $("navradarbtn").onclick = (e) => { e.stopPropagation(); C.layers?.(false); show(); };

  // (for tests: what is drawn)
  globalThis.__navradar = {
    get open() { return open; }, get f() { return frameInfo && { d: frameInfo.d, k: frameInfo.k, toNext: frameInfo.toNext, off: frameInfo.off, heading: frameInfo.heading }; },
    get s() { return shownS; }, get junctions() { return J.map((j) => ({ d: Math.round(j.d), name: j.name, arms: j.arms.map((a) => ({ cols: a.cols, to: a.to })), mine: j.mine, from: j.from })); },
    get signs() { return hits.signs.map(({ x, y, w, h, label, mine }) => ({ x, y, w, h, label, mine })); }, get N() { return hits.N; }, get bar() { return hits.bar && { x0: hits.bar.x0, y0: hits.bar.y0, y1: hits.bar.y1 }; },
    get mode() { return t3 ? "3d" : "2d"; }, get pitch() { return pitchNow; }, get t3() { return t3 ? { ready: t3.ready, frames: t3.frames } : null; },
    get manual() { return !!manual; }, get peek() { return !!peek; }, get northUp() { return northUp; }, get scrub() { return scrub?.i ?? null; }, get net() { return net ? net.ways.length : null; },
    age: (ms) => { if (manual) manual.t -= ms; if (manual?.at) manual.at = [manual.at[0] - 1000, manual.at[1]]; frame(); },
    frame, show, close,
  };
  return { navOpen: () => open, closeNav: close, navBack: back, openNav: show, navBtn: syncBtn };
}
