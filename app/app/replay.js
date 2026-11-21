// Replay 3D: an outing flown over again on the terrain, as the map shows it (navterrain.js: the packs' ground,
// roads, paths, huts, peaks, passes, car parks, on the height grid's relief; off the grid: flat), in the light
// of its own hour: the sun where it stood that day at that place, from the night through the golden hour to
// noon (core/sun.js) — the relief lit from the sun's side, the sky and the haze with it.
//
// The film: first the whole outing from above, then down behind the walker; it follows the way 250 m ahead,
// turning towards a place it is about to reach, lower where the slope ahead climbs; at each summit, hut or
// viewpoint reached it stops for a slow turn round it (the name, the height); at the end a slow circle and the
// summary. The pace goes along the distance, not the clock (a lunch break would stop the film).
// Fingers: drag to turn round and tilt, pinch to zoom (the pill "↺ kamera" gives the camera back); a tap
// pauses; the profile seeks. The card: the watch's clock, the time out, km, climbing and descending so far,
// the height, the slope in the app's classes, the pace.

import { unprojector, projector } from "../core/pack.js";
import { SLOPE_LINE } from "../core/profile.js";
import { sunPosition, lightFor } from "../core/sun.js";
import { figures, idxAt, timeAlong, followAim, easeAngle, ease, heightFlags, peakAim } from "../core/replaycam.js";
import { slopeClassOf, bearingXY, pointAt, heightAt } from "../core/navradar.js";
import { createNavTerrain, onGrid } from "./navterrain.js";
import { mountGrow } from "./growprof.js";
import { peakList } from "./peaks.js";
import { loadDem, DEM_URL, camOverrides } from "./peakcam.js";
import { state } from "./state.js";

const GRID = [13.2, 49.0, 19.3, 52.0], SPEEDS = [1, 2, 4, 0.5], VIOLET = "#6e48dc";
// (the pace: short, never standing still — the walker keeps going through a moment, only slower)
const MOMENT = new Set(["peak", "hut"]);
const INTRO_HOLD = 500, INTRO_FLY = 1700, MOMENT_MS = 1800, MOMENT_PACE = 0.35, OUTRO_ORBIT = 5000, OUTRO_UP = 1500;
const sCol = (p) => SLOPE_LINE[slopeClassOf(p)];
const km = (m) => `${(m / 1000).toFixed(1).replace(".", ",")} km`;

export function createReplay(C) {
  const $ = (id) => document.getElementById(id);
  const root = $("replay"), cv = $("rpcanvas"), g = cv.getContext("2d");
  let open = false, P = null, D = 0, F = null, t3 = null, raf = 0, playing = false, d = 0, speed = 1, dur = 30000, lastT = 0, seq = 0;
  let peaks = [], aimPk = null, aimAt = -1e9, pkW = 0, climbS = 0, sideOn = false;
  let dem = null, ll = null, start = 0, places = [], popped = null, geoAt = -1, seeking = null, act = null;
  // the camera: where it is; its phase (intro, follow, moment, outro, done); the hand on it (turn, tilt, zoom)
  let cam = null, phase = "intro", phaseT = 0, momentP = null, done = new Set(), overview = null, hand = { db: 0, dp: 0, dz: 0 }, handBack = 0;
  let fps = 0, fpsN = 0, fpsT = 0;
  let lightAt = 0, sun = null, waitGround = 0, flags = [], side = 0, sideSign = 1, sideAt = -1e9, walkAt = 0, pview = null;

  // ---- the places reached on it: placed by the watch's time (else by where they are), as the outing's profile does
  function placesOf(a) {
    const out = [], n = P.d.length, hasT = Number.isFinite(P.t?.[0]) && Number.isFinite(P.t?.[n - 1]);
    for (const f of Object.values(state.result?.found || {})) {
      const o = f.n && f.outs?.find(([id]) => id === a.id);
      if (!o) continue;
      let i = 0;
      if (hasT) { let lo = 0, hi = n - 1; while (lo < hi) { const m = (lo + hi) >> 1; if (P.t[m] < o[1]) lo = m + 1; else hi = m; } i = lo; }
      else { let bd = Infinity; for (let k = 0; k < n; k++) { const q = Math.hypot(P.x[k] - f.x, P.y[k] - f.y); if (q < bd) { bd = q; i = k; } } }
      out.push({ d: P.d[i], n: f.n, e: f.e, c: f.c, x: f.x, y: f.y });
    }
    return out.sort((p, q) => p.d - q.d);
  }

  // ---- the track for the terrain: behind the walker, ahead of it
  /** Where names are worth showing: squares (lon/lat) of r m round the route every 0.75 r, and round its ends. */
  function focusOf() {
    const sq = ([x, y], r) => { const [lo, la] = ll([x, y]), dla = r / 111320, dlo = r / (111320 * Math.cos((la * Math.PI) / 180)); return [[[lo - dlo, la - dla], [lo + dlo, la - dla], [lo + dlo, la + dla], [lo - dlo, la + dla], [lo - dlo, la - dla]]]; };
    const near = [];
    for (let x = 0; x <= D; x += 600) near.push(sq(pointAt(P, x), 800));
    near.push(sq(pointAt(P, D), 800));
    return { near: { type: "MultiPolygon", coordinates: near }, ends: { type: "MultiPolygon", coordinates: [sq(pointAt(P, 0), 400), sq(pointAt(P, D), 400)] }, peaks: places.filter((p) => p.c === "peak").map((p) => p.n) };
  }
  /** The whole route in its slope's colours (set once). */
  function routeGeo() {
    const f = (c, col) => ({ type: "Feature", properties: { w: 0, cols: "", col }, geometry: { type: "LineString", coordinates: c } }), feats = [];
    let run = [], col = null;
    for (let i = 0; i < P.d.length; i++) {
      const p = ll([P.x[i], P.y[i]]), c = sCol(P.slope?.[i] ?? 0);
      if (col == null) col = c;
      if (c !== col && run.length) { run.push(p); feats.push(f(run, col)); run = [p]; col = c; continue; }
      run.push(p);
    }
    if (run.length > 1) feats.push(f(run, col));
    return { type: "FeatureCollection", features: feats };
  }
  /** What is walked, up to dd. */
  function walkedGeo(dd) {
    const c = [];
    for (let i = 0; i < P.d.length && P.d[i] <= dd; i++) c.push(ll([P.x[i], P.y[i]]));
    c.push(ll(pointAt(P, dd)));
    return { type: "FeatureCollection", features: c.length > 1 ? [{ type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: c } }] : [] };
  }


  // ---- the light of the hour at the walker's place (again when the sun moved half a degree)
  function relight(now, force = false) {
    if (!t3?.ready || (!force && now - lightAt < 400)) return;
    lightAt = now;
    const [lon, lat] = ll(pointAt(P, d)), s = sunPosition(timeAlong(P, d, start), lat, lon);
    if (!force && sun && Math.abs(s.alt - sun.alt) < 0.5 && Math.abs(s.az - sun.az) < 2) return;
    sun = s; const L = lightFor(s); t3.setLight(L);
  }

  // ---- the camera
  const H_ = () => cv.clientHeight;
  function padding() {
    const H = H_(), cardTop = $("rpcard").getBoundingClientRect().top - cv.getBoundingClientRect().top, yMe = 96 + (cardTop - 96) * 0.66;
    return { top: Math.max(0, 2 * yMe - cardTop), bottom: Math.max(0, H - cardTop), left: 0, right: 0 };
  }
  function overviewCam() {
    let w = 180, s = 90, e = -180, n = -90;
    for (let i = 0; i < P.d.length; i += 4) { const [lo, la] = ll([P.x[i], P.y[i]]); w = Math.min(w, lo); e = Math.max(e, lo); s = Math.min(s, la); n = Math.max(n, la); }
    const a = pointAt(P, 0), b = pointAt(P, D), bear = Math.hypot(b[0] - a[0], b[1] - a[1]) > 300 ? bearingXY(b[0] - a[0], b[1] - a[1]) : followAim(P, 0).bearing ?? 0;
    const pad = padding(), fit = t3.map.cameraForBounds([[w, s], [e, n]], { padding: { top: 110, bottom: pad.bottom + 30, left: 30, right: 30 }, bearing: bear, pitch: 45 }) || {};
    return { center: fit.center ? [fit.center.lng ?? fit.center[0], fit.center.lat ?? fit.center[1]] : ll(pointAt(P, D / 2)), zoom: Math.min(15, (fit.zoom ?? 13) - 0.15), bearing: bear, pitch: 45 };
  }
  function followCam(dt) {
    const aim = followAim(P, d, places), here = ll(pointAt(P, d));
    // on a climb the camera swings to the side (the slope seen in profile: the line goes up the picture), from the
    // lower side; calm: the climb smoothed over seconds, the side taken from 22 % and left under 15 % (no going
    // back and forth on a wobbly slope), which side chosen again only every 300 m; the zoom and the tilt steady
    if (aim.climb != null) climbS += (aim.climb - climbS) * Math.min(1, dt / 1500);
    if (climbS >= 22) sideOn = true; else if (climbS <= 15) sideOn = false;
    side += ((sideOn ? 1 : 0) - side) * Math.min(1, dt / 2500);
    if (sideOn && d - sideAt > 300 && aim.ahead != null) {
      sideAt = d;
      const q = pointAt(P, d), L = 250, at = (b) => { const r = (b * Math.PI) / 180; return ll([q[0] + Math.sin(r) * L, q[1] - Math.cos(r) * L]); };
      const hl = t3.map.queryTerrainElevation?.(at(aim.ahead - 90)) ?? 0, hr = t3.map.queryTerrainElevation?.(at(aim.ahead + 90)) ?? 0;
      sideSign = hr <= hl ? 1 : -1; // (the camera stands on the lower side: looks across the slope, not into it)
    }
    // the summit worth seeing ahead: the camera turns a little towards it (half the angle, 35° at most), chosen
    // again every 200 m; not in the side view (that one looks across the slope)
    if (aim.bearing != null && d - aimAt > 200) { aimAt = d; aimPk = peakAim(pointAt(P, d), aim.bearing, peaks, aimPk); }
    let toPk = 0;
    if (aimPk && aim.bearing != null) { const q = pointAt(P, d); toPk = Math.max(-35, Math.min(35, 0.5 * (((bearingXY(aimPk.x - q[0], aimPk.y - q[1]) - aim.bearing + 540) % 360) - 180))); }
    pkW += ((aimPk ? 1 - side : 0) - pkW) * Math.min(1, dt / 2500);
    const k = Math.min(1, dt / 2200), target = aim.bearing == null ? null : (aim.bearing + toPk * pkW - sideSign * 60 * side + 360) % 360;
    const bearing = target == null ? cam?.bearing ?? 0 : cam ? easeAngle(cam.bearing, target, k) : target;
    // (low: the horizon and the summits in the picture, not only the ground at your feet)
    const wantPitch = 69 + 3 * side;
    const pitch = cam ? cam.pitch + (wantPitch - cam.pitch) * Math.min(1, dt / 2500) : wantPitch;
    const zoom = 14.9 - (speed >= 4 ? 0.35 : speed >= 2 ? 0.15 : 0);
    return { center: here, zoom: cam ? cam.zoom + (zoom - cam.zoom) * Math.min(1, dt / 2000) : zoom, bearing, pitch };
  }
  const mixCam = (a, b, t) => ({ center: [a.center[0] + (b.center[0] - a.center[0]) * t, a.center[1] + (b.center[1] - a.center[1]) * t], zoom: a.zoom + (b.zoom - a.zoom) * t, bearing: easeAngle(a.bearing, b.bearing, t), pitch: a.pitch + (b.pitch - a.pitch) * t });
  function camera(now, dt, raw = dt) {
    const el = now - phaseT;
    if (phase === "intro") {
      const f = followCam(1e6);
      cam = el < INTRO_HOLD ? overview : mixCam(overview, f, ease((el - INTRO_HOLD) / INTRO_FLY));
      if (el >= INTRO_HOLD + INTRO_FLY) { phase = "follow"; cam = f; }
    } else if (phase === "follow") cam = followCam(dt);
    else if (phase === "moment") {
      // a slow turn round the place (no closer: the zoom stays put)
      const t = ease(el / MOMENT_MS), f = followCam(dt);
      cam = { center: f.center, zoom: f.zoom, bearing: (momentP.b0 + 40 * t) % 360, pitch: f.pitch };
      if (el >= MOMENT_MS) { phase = "follow"; momentP = null; }
      else if (cam) cam = { ...cam }; // (the follow camera eases back from where the swing left it)
    } else if (phase === "outro") {
      const c = ll(pointAt(P, D));
      if (el < OUTRO_ORBIT) { const t = el / OUTRO_ORBIT; cam = { center: c, zoom: 14.75, bearing: (phase0.b + 360 * ease(t)) % 360, pitch: 58 }; }
      else if (el < OUTRO_ORBIT + OUTRO_UP) cam = mixCam({ center: c, zoom: 14.75, bearing: phase0.b, pitch: 58 }, overview, ease((el - OUTRO_ORBIT) / OUTRO_UP));
      else { phase = "done"; cam = overview; summary(true); }
    }
    // the hand on it, eased back to nothing after "↺ kamera"
    if (handBack) { const k = Math.min(1, raw / 350); hand = { db: hand.db * (1 - k), dp: hand.dp * (1 - k), dz: hand.dz * (1 - k) }; if (Math.abs(hand.db) + Math.abs(hand.dp) + Math.abs(hand.dz) < 0.05) { hand = { db: 0, dp: 0, dz: 0 }; handBack = 0; } }
    const shown = { center: cam.center, zoom: cam.zoom + hand.dz, bearing: (cam.bearing + hand.db + 360) % 360, pitch: Math.max(0, Math.min(78, cam.pitch + hand.dp)), padding: padding() };
    t3.setCamera(shown);
  }
  const phase0 = { b: 0 };

  // ---- one frame
  function tick(now) {
    if (!open) return;
    // (60 frames a second at most: the phone's screen may ask for 120, the map would draw each one)
    if (lastT && now - lastT < 15.5) { raf = requestAnimationFrame(tick); return; }
    const raw = now - (lastT || now), dt = Math.min(100, raw); lastT = now;
    fpsN++; if (now - fpsT > 1000) { fps = (fpsN * 1000) / (now - fpsT); fpsN = 0; fpsT = now; }
    if (!t3?.ready) { raf = requestAnimationFrame(tick); return; }
    if (!overview) { overview = overviewCam(); cam = overview; phaseT = now; relight(now, true); waitGround = now; }
    if (waitGround && phase === "intro") { if (t3.map.areTilesLoaded() || now - waitGround > 4000) waitGround = 0; else phaseT = now; }
    // the walker moves while playing and following (stopped by the intro, a moment, the end)
    if (playing && !seeking && (phase === "follow" || phase === "moment")) {
      d = Math.min(D, d + (dt / dur) * D * speed * (phase === "moment" ? MOMENT_PACE : 1));
      const p = phase === "follow" && speed < 2 ? places.find((q) => !done.has(q) && q.d <= d && MOMENT.has(q.c)) : null;
      for (const q of places) if (q.d <= d) done.add(q);
      if (p) { phase = "moment"; phaseT = now; momentP = { ...p, b0: cam.bearing, z0: cam.zoom, p0: cam.pitch }; popped = { p, until: now + MOMENT_MS }; C.haptic?.tick?.(); }
      else { const q = places.filter((x) => x.d <= d).pop(); if (q && popped?.p !== q && (speed >= 2 || !MOMENT.has(q.c)) && now - (q.shownAt || 0) > 4000) { q.shownAt = now; popped = { p: q, until: now + 2200 }; } }
      if (d >= D) { phase = "outro"; phaseT = now; phase0.b = cam.bearing; playing = false; momentP = null; }
    }
    if (popped && now > popped.until) popped = null;
    camera(now, dt, raw);
    if ((now - walkAt > 160 && Math.abs(d - geoAt) > 2) || (d === D && geoAt !== D)) { geoAt = d; walkAt = now; t3.setWalked(walkedGeo(d)); }
    relight(now);
    draw();
    hud();
    raf = requestAnimationFrame(tick);
  }
  function draw() {
    const W = cv.clientWidth, H = cv.clientHeight, dpr = Math.min(2, devicePixelRatio || 1);
    if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(H * dpr)) { cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); }
    g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, W, H);
    const cardTop = $("rpcard").getBoundingClientRect().top - cv.getBoundingClientRect().top, V = (p) => t3.project(ll(p));
    // the places reached: a violet ring at each (the map names them)
    for (const p of places) {
      if (p.d > d + 1) continue;
      const [x, y] = V([p.x, p.y]);
      if (!(y > 60 && y < cardTop - 8)) continue;
      g.strokeStyle = VIOLET; g.lineWidth = 3; g.beginPath(); g.arc(x, y, 13, 0, 7); g.stroke();
      g.strokeStyle = "#fff"; g.lineWidth = 1.5; g.beginPath(); g.arc(x, y, 15.5, 0, 7); g.stroke();
    }
    // the heights the route crosses: a flag every 100 m (50 m) of height; where they crowd, the way is steep
    g.font = "700 11px system-ui, sans-serif";
    const drawn = [];
    for (const fl of flags) {
      const [x, y] = V(pointAt(P, fl.d));
      if (!(y > 70 && y < cardTop - 10 && x > -40 && x < W + 40)) continue;
      // (flags crowding on screen, a steep wall seen from afar: every other one)
      if (drawn.some(([a, b]) => Math.abs(a - x) < 44 && Math.abs(b - y) < 20)) continue;
      drawn.push([x, y]);
      const past = fl.d <= d, t = `${fl.h}`, w = g.measureText(t).width + 10;
      g.globalAlpha = past ? 0.55 : 1;
      g.strokeStyle = "#1d1f1e"; g.lineWidth = 1.6; g.beginPath(); g.moveTo(x, y); g.lineTo(x, y - 26); g.stroke();
      g.fillStyle = "#fff"; g.beginPath(); g.roundRect(x, y - 38, w, 15, 3); g.fill(); g.strokeStyle = "#1d1f1e"; g.lineWidth = 1; g.stroke();
      g.fillStyle = "#1d1f1e"; g.textAlign = "left"; g.fillText(t, x + 5, y - 26.5);
      g.globalAlpha = 1;
    }
    // chevrons on the steep stretches ahead (25 % and more), pointing the way you go
    for (let i = Math.max(1, idxAt(P, d)); i < P.d.length - 1 && P.d[i] < d + 1500; i += 2) {
      if (P.d[i] <= d || !(Math.abs(P.slope?.[i] ?? 0) >= 25)) continue;
      const a = V([P.x[i - 1], P.y[i - 1]]), b = V([P.x[i + 1], P.y[i + 1]]), m = V([P.x[i], P.y[i]]);
      if (!(m[1] > 70 && m[1] < cardTop - 10)) continue;
      const ang = Math.atan2(b[1] - a[1], b[0] - a[0]); // (the way you go: up a climb, down a descent)
      g.save(); g.translate(m[0], m[1]); g.rotate(ang); g.strokeStyle = "#fff"; g.lineWidth = 2.6; g.lineCap = "round"; g.lineJoin = "round";
      g.beginPath(); g.moveTo(-4, -5); g.lineTo(2, 0); g.lineTo(-4, 5); g.stroke(); g.restore();
    }
    // the walker, with its height above the start
    if (phase !== "done") {
      const [hx, hy] = V(pointAt(P, d));
      g.fillStyle = "rgba(110,72,220,.28)"; g.beginPath(); g.arc(hx, hy, 17, 0, 7); g.fill();
      g.fillStyle = "#fff"; g.strokeStyle = VIOLET; g.lineWidth = 4; g.beginPath(); g.arc(hx, hy, 8, 0, 7); g.fill(); g.stroke();
      const h = heightAt(P, d), h0 = P.h.find(Number.isFinite);
      if (Number.isFinite(h) && Number.isFinite(h0) && Math.abs(h - h0) >= 5) {
        const t = `${h >= h0 ? "+" : "−"}${Math.round(Math.abs(h - h0))} m`;
        g.font = "800 13px system-ui, sans-serif"; const w = g.measureText(t).width + 14;
        g.fillStyle = VIOLET; g.beginPath(); g.roundRect(hx - 14 - w, hy - 30, w, 21, 10.5); g.fill();
        g.fillStyle = "#fff"; g.textAlign = "left"; g.fillText(t, hx - 7 - w, hy - 15);
      }
    }
    // the place just reached: its name and height
    if (popped) {
      const p = popped.p, t = `${p.n}${p.e ? ` · ${Math.round(p.e)} m` : ""}`;
      g.font = "800 16px system-ui, sans-serif"; const w = g.measureText(t).width + 30, x = W / 2 - w / 2, y = 100;
      g.fillStyle = "rgba(0,0,0,.3)"; g.beginPath(); g.roundRect(x, y + 2, w, 36, 18); g.fill();
      g.fillStyle = "#fff"; g.beginPath(); g.roundRect(x, y, w, 36, 18); g.fill(); g.strokeStyle = VIOLET; g.lineWidth = 2.5; g.stroke();
      g.fillStyle = "#1d1f1e"; g.textAlign = "left"; g.fillText(t, x + 15, y + 24);
    }
  }

  // ---- the card: the clock, the time out, km, up and down so far, the height, the slope, the pace; the profile
  let hudKey = "";
  function hud() {
    const i = idxAt(P, d), t = timeAlong(P, d, start), hasT = Number.isFinite(P.t?.[0]), pace = F.pace[i];
    const clock = new Date(t).toLocaleTimeString("pl-PL", { hour: "2-digit", minute: "2-digit" });
    const out = hasT ? C.hm(t - P.t[0]) : "";
    const k = [clock, out, Math.round(d / 10), playing, speed, Math.round(F.up[i]), Math.round(F.down[i]), pace != null ? Math.round(pace * 10) : "", phase, !!(hand.db || hand.dp || hand.dz)].join("|");
    if (k !== hudKey) {
      hudKey = k;
      $("rpclock").textContent = `${hasT ? "" : "~"}${clock}`; $("rpout").textContent = out ? `w drodze ${out}` : "";
      $("rpkm").textContent = `${km(d)} / ${km(D)}`;
      $("rpup").textContent = `↑ ${Math.round(F.up[i])} m`; $("rpdown").textContent = `↓ ${Math.round(F.down[i])} m`;
      $("rppace").textContent = pace != null && pace > 0.3 ? `${pace.toFixed(1).replace(".", ",")} km/h` : "";
      const end = d >= D || phase === "outro" || phase === "done";
      $("rpplay").innerHTML = `<svg><use href="#i-${playing ? "pause" : end ? "replay3d" : "play"}"/></svg>`;
      $("rpplay").setAttribute("aria-label", playing ? "Pauza" : end ? "Od początku" : "Odtwórz");
      $("rpspeed").textContent = `×${speed === 0.5 ? "½" : speed}`;
      $("rpcam").hidden = !(hand.db || hand.dp || hand.dz) || !!handBack;
    }
    profile();
  }
  // the profile: the same drawing as an outing's card (growprof.js), walked violet up to the walker, the cursor
  // on it (its slope and height); a finger takes the film there
  function profile() { pview?.walk(d / P.step); }

  // ---- the summary at the end
  function summary(on) {
    $("rpsum").hidden = !on;
    if (!on || !P) return;
    const n = P.d.length - 1, hasT = Number.isFinite(P.t?.[0]) && Number.isFinite(P.t?.[n]);
    const cells = [["Dystans", km(D)], ["W drodze", hasT ? C.hm(P.t[n] - P.t[0]) : "—"], ["Podejścia", `↑ ${Math.round(F.up[n])} m`], ["Zejścia", `↓ ${Math.round(F.down[n])} m`], ["Najwyżej", `${Math.round(F.max[n])} m`], ["Miejsca", String(places.length)]];
    $("rpsumg").innerHTML = cells.map(([a, b]) => `<div><span>${a}</span><b>${b}</b></div>`).join("");
    $("rpsump").textContent = places.length ? places.map((p) => p.n).join(" · ") : "";
  }

  // ---- fingers: drag turns and tilts, pinch zooms, a tap pauses; the profile seeks; the buttons
  // (a seek is a cut: the side view as the slope there wants it at once)
  const cut = () => { climbS = followAim(P, d).climb ?? 0; sideOn = climbS >= 22; side = sideOn ? 1 : 0; sideAt = -1e9; aimAt = -1e9; };
  const seekTo = (to) => { d = Math.max(0, Math.min(D, to)); cut(); geoAt = -1; walkAt = 0; popped = null; done = new Set(places.filter((p) => p.d <= d)); if (phase !== "follow") { phase = "follow"; momentP = null; summary(false); } };
  const onCursor = (i) => { if (i == null) { endSeek(); return; } seeking ??= { was: playing }; seekTo(P.d[i]); };
  const endSeek = () => { if (seeking) { playing = seeking.was; seeking = null; } };
  const pts = new Map();
  let gest = null;
  cv.addEventListener("pointerdown", (e) => {
    cv.setPointerCapture(e.pointerId); pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pts.size === 2) { const [a, b] = [...pts.values()]; gest = { kind: "pinch", d0: Math.hypot(a.x - b.x, a.y - b.y), z0: hand.dz }; }
    else gest = { kind: "tap", x0: e.clientX, y0: e.clientY };
    handBack = 0;
  });
  cv.addEventListener("pointermove", (e) => {
    const p = pts.get(e.pointerId); if (!p || !gest) return;
    const dx = e.clientX - p.x, dy = e.clientY - p.y; p.x = e.clientX; p.y = e.clientY;
    if (gest.kind === "pinch" && pts.size >= 2) { const [a, b] = [...pts.values()]; hand.dz = Math.max(-3, Math.min(2.5, gest.z0 + Math.log2(Math.hypot(a.x - b.x, a.y - b.y) / (gest.d0 || 1)))); return; }
    if (gest.kind === "tap" && Math.hypot(e.clientX - gest.x0, e.clientY - gest.y0) > 8) gest.kind = "turn";
    if (gest.kind === "turn") { hand.db = (hand.db - dx * 0.35) % 360; hand.dp = Math.max(-50, Math.min(20, hand.dp - dy * 0.25)); }
  });
  const up = (e) => {
    pts.delete(e.pointerId);
    if (gest?.kind === "tap" && e.type === "pointerup" && !pts.size) toggle();
    if (!pts.size) gest = null; else if (gest?.kind === "pinch") gest = { kind: "turn" };
  };
  cv.addEventListener("pointerup", up); cv.addEventListener("pointercancel", up);
  cv.addEventListener("wheel", (e) => { e.preventDefault(); hand.dz = Math.max(-3, Math.min(2.5, hand.dz - e.deltaY / 500)); handBack = 0; }, { passive: false });
  function restart() { waitGround = 0; d = 0; climbS = 0; sideOn = false; side = 0; geoAt = -1; popped = null; done = new Set(); summary(false); phase = "intro"; phaseT = performance.now(); overview = overviewCam(); cam = overview; }
  function toggle() {
    if (phase === "intro" && playing) { phaseT = performance.now() - INTRO_HOLD - INTRO_FLY; waitGround = 0; return; }
    if (phase === "outro") { phaseT = performance.now() - OUTRO_ORBIT - OUTRO_UP; return; }
    if (phase === "done" || d >= D) { restart(); playing = true; hudKey = ""; return; }
    playing = !playing; hudKey = "";
  }
  $("rpplay").onclick = (e) => { e.stopPropagation(); toggle(); };
  $("rpspeed").onclick = (e) => { e.stopPropagation(); speed = SPEEDS[(SPEEDS.indexOf(speed) + 1) % SPEEDS.length]; hudKey = ""; };
  $("rpback").onclick = (e) => { e.stopPropagation(); restart(); hudKey = ""; };
  $("rpagain").onclick = (e) => { e.stopPropagation(); restart(); playing = true; hudKey = ""; };
  $("rpcam").onclick = (e) => { e.stopPropagation(); handBack = 1; hudKey = ""; };
  $("rpx").onclick = () => close();


  // ---- open, close
  async function show(a) {
    if (open || !a) return;
    const my = ++seq;
    open = true; root.hidden = false; document.documentElement.classList.add("pcopen");
    P = null; d = 0; speed = 1; playing = false; geoAt = -1; popped = null; hudKey = ""; act = a; phase = "intro"; overview = null; cam = null; hand = { db: 0, dp: 0, dz: 0 }; handBack = 0; done = new Set(); sun = null; summary(false);
    $("rpname").textContent = a.name || "Wyjście";
    $("rpdate").textContent = a.start != null ? new Date(a.start).toLocaleDateString("pl-PL", { day: "numeric", month: "long", year: "numeric" }) : "";
    $("rpstatus").textContent = "Wczytuję ślad…"; $("rpstatus").hidden = false;
    const prof = (await C.call("profile", { activity: a.id }).catch(() => null))?.profile || null;
    if (my !== seq || !open) return;
    if (!prof?.d?.length) { $("rpstatus").textContent = "Brak śladu tego wyjścia."; return; }
    P = prof; D = P.d[P.d.length - 1]; F = figures(P); ll = (p) => unprojector(C.view.meta)(p[0], p[1]);
    // (no watch: the day of the outing from 9:00, walked at 4 km/h, for the light)
    const day = new Date(a.start ?? Date.now()); if (day.getHours() === 0 && day.getMinutes() === 0) day.setHours(9);
    start = Number.isFinite(P.t?.[0]) ? P.t[0] : day.getTime();
    dur = Math.max(18000, Math.min(90000, (D / 1000) * 3000));
    places = placesOf(a); flags = heightFlags(P); side = 0; sideAt = -1e9; climbS = 0; sideOn = false; aimPk = null; aimAt = -1e9; pkW = 0;
    // (the summits the app knows, for the camera to look at: app/peaks.js, as Szczyty w aparacie names them)
    { const pr = projector(C.view.meta); peaks = peakList(C).map((p) => { const [x, y] = pr(p.lon, p.lat); return { n: p.name, e: p.ele, x, y }; }); }
    // the terrain: the grid where the outing lies on it (fetched once, kept), else flat
    const pts = []; for (let i = 0; i < P.d.length; i += 8) pts.push(ll([P.x[i], P.y[i]]));
    const inGrid = pts.every(([lon, lat]) => lon > GRID[0] && lon < GRID[2] && lat > GRID[1] && lat < GRID[3]);
    if (inGrid && typeof maplibregl !== "undefined") { try { dem = await loadDem(camOverrides().dem || DEM_URL, (t) => { $("rpstatus").textContent = t; }); } catch { dem = null; } }
    if (my !== seq || !open) return;
    const [lon0, lat0] = ll(pointAt(P, 0));
    try { t3 = createNavTerrain(root, cv, dem && onGrid(dem, pts) ? dem : null, C.view?.parts, () => {}, { kind: "replay", light: lightFor(sunPosition(start, lat0, lon0)), exaggeration: 1.6, focus: focusOf() }); } catch { t3 = null; }
    if (!t3) { $("rpstatus").textContent = "Ten telefon nie pokaże mapy 3D."; return; }
    $("rpstatus").hidden = true;
    t3.setRoute(routeGeo()); t3.setWalked(walkedGeo(0));
    pview?.stop(); pview = mountGrow($("rpprof"), P, { marks: places.map((p) => ({ i: Math.round(p.d / P.step), n: p.n, c: p.c })), stripes: true, clock: true, hover: false, onCursor });
    lastT = 0; raf = requestAnimationFrame(tick);
    // (the film starts once the map is there: the intro's overview first)
    const go = () => { if (!open || my !== seq) return; if (!t3?.ready) { setTimeout(go, 200); return; } playing = true; phaseT = performance.now(); hudKey = ""; };
    go();
  }
  function close() {
    if (!open) return;
    open = false; seq++; root.hidden = true; document.documentElement.classList.remove("pcopen");
    cancelAnimationFrame(raf); raf = 0; playing = false; pview?.stop(); pview = null; t3?.destroy(); t3 = null; summary(false);
  }

  // (for tests)
  globalThis.__replay = {
    get open() { return open; }, get playing() { return playing; }, get d() { return d; }, get D() { return D; }, get ready() { return !!t3?.ready; },
    get places() { return places.map((p) => p.n); }, get fps() { return fps; }, get mapFrames() { return t3?.frames ?? 0; }, get grid() { return !!dem; }, get phase() { return phase; }, get sun() { return sun; },
    get hand() { return { ...hand }; }, get act() { return act?.id; }, get side() { return side; }, get flags() { return flags.length; }, get aim() { return aimPk?.n ?? null; },
    get figures() { const i = P ? idxAt(P, d) : 0; return F ? { up: F.up[i], down: F.down[i], max: F.max[i] } : null; },
    look(db, dp, dz) { hand = { db, dp, dz }; handBack = 0; },
    steepest() { let best = 0, at = 0; for (let x = 0; x < D - 100; x += 20) { const c = followAim(P, x).climb; if (c > best) { best = c; at = x; } } return { d: at, climb: best }; },
    jump(v) { d = v; cut(); geoAt = -1; done = new Set(places.filter((p) => p.d <= d)); phase = "follow"; summary(false); },
    end() { d = D; phase = "outro"; phaseT = performance.now() - OUTRO_ORBIT - OUTRO_UP; playing = false; },
    show, close,
  };
  return { replayOpen: () => open, replayBack: close, replay3d: show };
}
