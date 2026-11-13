// The planned route's profile in its figures box: one drawing that grows with the card (folded: small;
// up: tall), the same in both: a quiet fill, the line in the slope's colours, a grid of 3-4 round heights
// (written at the right), the distances under it. Tall, also the names of the main places over it and the
// plan's points numbered (as on the map) on its base. Its box's height (style.css .gprof, animated) says
// how far between the two it is; the drawing follows on every frame.
// A finger on it: a line, the dot, the slope beside it and the height at the foot; the way to there goes to
// onWay (the card's figures show it, from you or from the start).

import { SLOPES, SLOPE_LINE, slopeRuns, steepest } from "../core/profile.js";

const H0 = 100, H1 = 170; // the box folded / up (style.css .gprof)
const nf = (v, d = 1) => v.toLocaleString("pl-PL", { minimumFractionDigits: d, maximumFractionDigits: d });
const lerp = (a, b, t) => a + (b - a) * t;
// what matters most on a profile: a peak of the lists, a peak (higher first), a hut, the rest
const rank = (m, P) => (m.c === "peak" ? 3000 + (m.key && /star|list|k/.test(m.key) ? 2000 : 0) + (P.h[m.i] || 0) : m.c === "hut" ? 1000 : 0);
/** The places worth a sign: one per name (a peak and its hut of the same name a few hundred metres apart: the peak). */
function placesOf(marks, P) {
  const S = marks.filter((m) => Number.isFinite(P.h[m.i])).sort((a, b) => rank(b, P) - rank(a, P)), out = [];
  for (const m of S) if (!out.some((o) => o.n && o.n === m.n && Math.abs(P.d[o.i] - P.d[m.i]) < 600)) out.push(m);
  return out;
}
// the textures, drawn once (a tile each) and filled as patterns
const PAT = new Map();
function groundPattern(g, k) {
  if (PAT.has(k)) return PAT.get(k);
  // faint and sparse, one ink: the profile's line stays what you read first
  const z = 14, c = document.createElement("canvas"); c.width = c.height = z * 2; // (2x: sharp on a phone)
  const q = c.getContext("2d"); q.scale(2, 2);
  const ink = (a) => `rgba(70,66,80,${a})`;
  if (k === "paved") { q.fillStyle = ink(0.07); q.fillRect(0, 0, z, z); }
  else if (k === "gravel") { q.fillStyle = ink(0.26); q.fillRect(z / 4, z / 4, 1.3, 1.3); q.fillRect(z * 0.75, z * 0.75, 1.3, 1.3); }
  else if (k === "rock") { q.strokeStyle = ink(0.24); q.lineWidth = 0.9; q.beginPath(); for (const o of [-z, 0, z]) { q.moveTo(o, z); q.lineTo(o + z, 0); } q.stroke(); }
  else if (k === "steps") { q.strokeStyle = ink(0.24); q.lineWidth = 0.9; q.beginPath(); q.moveTo(0, z / 2); q.lineTo(z, z / 2); q.stroke(); }
  const p = g.createPattern(c, "repeat");
  p.setTransform?.(new DOMMatrix().scale(0.5));
  PAT.set(k, p);
  return p;
}
/** The key to what is underfoot under a way's profile (its kinds; a path, plain, named when others are there):
 * in the card's own markup (kpiRow's key), so the card keeps its height while the profile redraws. */
export function groundKey(P) {
  const items = groundItems(P);
  return items ? `<div class="gkey">${items}</div>` : "";
}
/** The key's items with each kind's share of the way (or of the stretch a..b, metres along it; what no kind covers: path). */
function groundItems(P, a = 0, b = Infinity) {
  const S = P?.surf || [];
  if (!S.some((q) => q[2] !== "earth")) return "";
  const D = P.d[P.d.length - 1] || 1, lo = Math.max(0, a), hi = Math.min(D, b), len = Math.max(1, hi - lo), m = new Map();
  for (const [d0, d1, k] of S) { const o = Math.min(hi, d1) - Math.max(lo, d0); if (o > 0 && k !== "earth") m.set(k, (m.get(k) || 0) + o); }
  m.set("earth", Math.max(0, len - [...m.values()].reduce((x, y) => x + y, 0)));
  const whole = a <= 0 && b >= D, on = new Set(S.map((q) => q[2]));
  // the whole way: every kind on it (a sliver: "<1%"); a stretch: only those on it
  return GKEY.filter(([k]) => (whole ? on.has(k) || (k === "earth" && m.get(k) >= 1) : m.get(k) >= 1)).map(([k, t]) => {
    const pc = (100 * (m.get(k) || 0)) / len;
    return `<span><i class="g-${k}"></i>${t}<b>${pc < 1 ? "<1" : Math.round(pc)}%</b></span>`;
  }).join("");
}
const GKEY = [["paved", "asfalt, bruk"], ["gravel", "szuter"], ["earth", "ścieżka"], ["rock", "kamienie"], ["steps", "schody"]];
const TC = { red: "#d0202a", blue: "#2160c8", green: "#16903c", yellow: "#e0b800", black: "#1a1a1a" }; // (the trails' colours, under an outing's profile)
const nice = (span) => { const r = span / 3, p = 10 ** Math.floor(Math.log10(Math.max(1, r))); return [1, 2, 2.5, 5, 10].map((k) => k * p).find((k) => k >= r); };

/**
 * box: the .gprof element (a canvas goes in); P: the route's profile; steps: [{d0, d1, cols, cat}];
 * bounds: the plan's points along it (m); marks: [{i, n}] (peaks on the way); readEl: the line under the box;
 * onResize: on every frame the box grows or shrinks (the sheet follows); way(i0, i1): the way between two
 * samples {km, up, down, ms} (the bubble: to the finger from you, or from the start);
 * places: [{i, n, c}] every named place on the way (the line under the box says what comes next under the finger).
 */
export function mountGrow(box, P, { bounds = [], marks = [], rides = [], onCursor, onMark, onResize, way = null, onWay = null, focus = null, stripes = false, clock = false, full = false } = {}) {
  box.innerHTML = `<canvas aria-label="Przekrój trasy: przeciągnij palcem, dwoma palcami odcinek"></canvas>`;
  const cv = box.querySelector("canvas"), g = cv.getContext("2d");
  const n = P.d.length, D = P.d[n - 1] || 1;
  let lo = Infinity, hi = -Infinity, maxS = 0;
  for (let i = 0; i < n; i++) if (Number.isFinite(P.h[i])) { lo = Math.min(lo, P.h[i]); hi = Math.max(hi, P.h[i]); maxS = Math.max(maxS, Math.abs(P.slope[i] || 0)); }
  if (!Number.isFinite(lo)) { box.hidden = true; return null; }
  maxS = steepest(P); // (over 100 m at least: not one bump of the contours)
  let runsFor = null; const runs = (W) => (runsFor?.W === W ? runsFor.R : (runsFor = { W, R: slopeRuns(P, W) }).R);
  // a place's card (focus {i0, i1, dash}): the way from you (i0) to it (i1) lit, the rest grey; a place off the
  // route: P is the route up to where you leave it (dash) and the way there after it, drawn dashed
  const dash = focus?.dash ?? null;
  if (hi - lo < 20) { const m = (hi + lo) / 2; lo = m - 10; hi = m + 10; }
  const ystep = nice(hi - lo);
  let cur = null, me = null, done = 0, t = 0, lastMark = null, sel = null; // sel: two fingers, [i0, i1] (the stretch between them)
  const L = 2, R = 28; // the heights written in a narrow column at the right
  const kmStep = (span) => { const r = span / 4, p = 10 ** Math.floor(Math.log10(Math.max(0.1, r))); return [1, 2, 2.5, 5, 10].map((k) => k * p).find((k) => k >= r); };
  // the names over the profile (tall): the most important places first, as many as fit side by side (at most 3)
  let namesFor = null;
  const names = (W) => {
    if (namesFor?.W === W) return namesFor.v;
    const X = (d) => L + ((W - L - R) * d) / D, out = [];
    g.font = "600 11px system-ui, sans-serif";
    for (const m of placesOf(marks, P)) {
      if (out.length >= 3) break;
      const x = X(P.d[m.i]), w = g.measureText(m.n).width + 14, x0 = Math.min(W - R - w, Math.max(L, x - 5));
      if (out.some((o) => x0 < o.x0 + o.w + 8 && o.x0 < x0 + w + 8)) continue;
      out.push({ m, x, x0, w });
    }
    return (namesFor = { W, v: out }).v;
  };
  // an outing's: the marked trails walked as stripes under the base (stripes), the time of day under the finger (clock)
  const cols = stripes && P.cols && P.c ? P.cols : null, gap = (i) => !!P.gap?.[i];
  const geom = () => {
    const W = cv.clientWidth, H = cv.clientHeight, T = lerp(10, 26, t), B = cols ? 23 : 16, span = hi - lo;
    const y0 = lo - span * 0.06, y1 = hi + span * 0.08;
    return { W, H, T, B, y0, y1, X: (d) => L + ((W - L - R) * d) / D, Y: (h) => T + (H - T - B) * (1 - (h - y0) / (y1 - y0)), base: H - B };
  };

  function draw() {
    const H = cv.clientHeight;
    if (!H) return;
    // how tall (small .. big): fixed while the finger is on it
    if (cur == null) t = full ? 1 : Math.max(0, Math.min(1, (box.clientHeight - H0) / (H1 - H0))); // (full: a card's own, always the tall one)
    const dpr = Math.min(3, devicePixelRatio || 1), W = cv.clientWidth;
    if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(H * dpr)) { cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); }
    g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, W, H);
    const { T, X, Y, base, y0, y1 } = geom();
    // the grid: 3-4 round heights, written at the right (numbers only)
    g.font = "11px system-ui, sans-serif"; g.textBaseline = "middle"; g.textAlign = "right";
    for (let h = Math.ceil(y0 / ystep) * ystep; h <= y1; h += ystep) {
      const y = Math.round(Y(h)) + 0.5;
      if (y < T - 2 || y > base) continue;
      g.strokeStyle = "rgba(29,31,30,.08)"; g.lineWidth = 1; g.beginPath(); g.moveTo(L, y); g.lineTo(W - R, y); g.stroke();
      g.fillStyle = "#6b6f6d"; g.fillText(String(h), W - 2, y);
    }
    // the names (tall): a sign and the name over the place, a dotted line down to it
    if (t > 0.05) {
      g.globalAlpha = t; g.textBaseline = "alphabetic"; g.textAlign = "left";
      for (const q of names(W)) {
        const peak = q.m.c === "peak", ink = peak ? "#5b3fd0" : "#6b6f6d";
        g.setLineDash([2, 3]); g.strokeStyle = peak ? "rgba(91,63,208,.3)" : "rgba(29,31,30,.2)"; g.lineWidth = 1;
        g.beginPath(); g.moveTo(Math.round(q.x) + 0.5, T - 4); g.lineTo(Math.round(q.x) + 0.5, Y(P.h[q.m.i])); g.stroke(); g.setLineDash([]);
        g.fillStyle = ink;
        const sy = T - 9;
        if (peak) { g.beginPath(); g.moveTo(q.x0 + 1, sy + 3); g.lineTo(q.x0 + 5, sy - 4); g.lineTo(q.x0 + 9, sy + 3); g.closePath(); g.fill(); }
        else { g.beginPath(); g.arc(q.x0 + 5, sy, 3, 0, 7); g.fill(); }
        g.font = "600 11px system-ui, sans-serif"; g.fillText(q.m.n, q.x0 + 12, sy + 4);
      }
      g.globalAlpha = 1;
    }
    // the fill: one quiet colour; the line carries the slope (the same in both sizes)
    g.fillStyle = "rgba(120,110,150,.14)";
    { // (an outing's track with gaps: a shape per piece)
      let x0 = null, xl = null;
      const shut = () => { if (x0 != null) { g.lineTo(xl, base); g.closePath(); g.fill(); } x0 = null; };
      for (let i = 0; i < n; i++) {
        if (!Number.isFinite(P.h[i]) || (i > 0 && gap(i))) { shut(); if (!Number.isFinite(P.h[i])) continue; }
        const x = X(P.d[i]), y = Y(P.h[i]);
        if (x0 == null) { g.beginPath(); g.moveTo(x, base); x0 = x; }
        g.lineTo(x, y); xl = x;
      }
      shut();
    }
    // what is underfoot (a planned way's P.surf, core/route.js groundOf): a texture in the fill, one ink;
    // a path (earth) plain, paved flat grey, gravel dots, rock hatched, steps lines
    if (P.surf?.length) {
      g.save(); g.beginPath(); g.moveTo(X(0), base);
      for (let i = 0; i < n; i++) if (Number.isFinite(P.h[i])) g.lineTo(X(P.d[i]), Y(P.h[i]));
      g.lineTo(X(D), base); g.closePath(); g.clip();
      for (const [d0, d1, k] of P.surf) {
        if (k === "earth") continue;
        const x0 = Math.max(X(0), X(d0)), w = Math.min(X(D), X(d1)) - x0; // (within the profile)
        if (!(w > 0.5) || !Number.isFinite(w)) continue;
        g.fillStyle = groundPattern(g, k); g.fillRect(x0, 0, w, base); // (one fill a stretch: cheap under a moving finger)
      }
      g.restore();
    }
    // walking it: the part behind you greyed (as on the map)
    const dn = Math.min(done, n - 1);
    // a place's card: the way to it, a light amber under it
    const fa = focus ? Math.max(0, Math.min(n - 1, focus.i0)) : 0, fb = focus ? Math.max(fa, Math.min(n - 1, focus.i1)) : n - 1;
    if (focus && fb > fa) {
      g.beginPath(); g.moveTo(X(P.d[fa]), base); for (let i = fa; i <= fb; i++) if (Number.isFinite(P.h[i])) g.lineTo(X(P.d[i]), Y(P.h[i])); g.lineTo(X(P.d[fb]), base); g.closePath();
      g.fillStyle = "rgba(232,147,12,.2)"; g.fill();
    }
    if (dn > 0 && !focus) {
      g.beginPath(); g.moveTo(X(0), base); for (let i = 0; i <= dn; i++) if (Number.isFinite(P.h[i])) g.lineTo(X(P.d[i]), Y(P.h[i])); g.lineTo(X(P.d[dn]), base); g.closePath();
      g.fillStyle = "rgba(29,31,30,.07)"; g.fill();
    }
    const path = (i0, i1) => { g.beginPath(); let pen = false; for (let i = i0; i <= i1; i++) { if (!Number.isFinite(P.h[i])) { pen = false; continue; } if (i > i0 && gap(i)) pen = false; const x = X(P.d[i]), y = Y(P.h[i]); if (pen) g.lineTo(x, y); else { g.moveTo(x, y); pen = true; } } };
    g.lineJoin = "round"; g.lineCap = "round"; g.lineWidth = lerp(3, 3.4, t);
    // in colour: what is ahead (a place's card: only the way to it), grey the rest
    const ca = focus ? fa : dn, cb = focus ? fb : n - 1;
    const end = dash ?? n - 1, cz = Math.min(cb, end); // (past dash: the way off the route, dashed below)
    for (const r of runs(W)) {
      if (r.i >= end && dash != null) continue;
      if (r.i < ca || r.j > cz) { path(r.i, Math.min(r.j, end)); g.strokeStyle = "#bcb8c2"; g.stroke(); }
      const a = Math.max(r.i, ca), b = Math.min(r.j, cz);
      if (b > a) { path(a, b); g.strokeStyle = SLOPE_LINE[r.c]; g.stroke(); }
    }
    // the place: off the route the way there from where you leave it, dashed; a ring where the place is
    if (focus) {
      if (dash != null && dash < fb) {
        path(dash, fb); g.strokeStyle = "#fff"; g.lineWidth = 4; g.stroke();
        path(dash, fb); g.setLineDash([5, 4]); g.strokeStyle = "#e8930c"; g.lineWidth = 2.6; g.lineCap = "round"; g.stroke(); g.setLineDash([]);
        g.fillStyle = "#e8930c"; g.beginPath(); g.arc(X(P.d[dash]), Y(P.h[dash]), 3, 0, 7); g.fill();
      }
      g.fillStyle = "#fff"; g.strokeStyle = "#e8930c"; g.lineWidth = 2.4; g.beginPath(); g.arc(X(P.d[fb]), Y(P.h[fb]), 4.6, 0, 7); g.fill(); g.stroke();
    }
    // a lift ride: over the slope's colours a dark rope, dashed (no walking there)
    for (const q of rides) {
      const i0 = Math.max(0, Math.round(q.d0 / P.step)), i1 = Math.min(n - 1, Math.round(q.d1 / P.step));
      path(i0, i1); g.strokeStyle = "#fff"; g.lineWidth = lerp(3.6, 4, t); g.stroke();
      g.setLineDash([5, 4]); path(i0, i1); g.strokeStyle = "#3f4347"; g.lineWidth = 2; g.stroke(); g.setLineDash([]);
    }
    g.lineCap = "butt";
    // the marked trails walked: stripes under the base, in their colours
    if (cols) {
      const by = base + 2, bh = 5;
      for (let i = 0; i < n - 1; i++) {
        const cs = cols[P.c[i]];
        if (!cs || gap(i + 1)) continue;
        const list = cs.split(","), x0 = X(P.d[i]), x1 = X(P.d[i + 1]) + 0.6;
        list.forEach((c, k) => { g.fillStyle = TC[c] || "#888"; g.fillRect(x0, by + (bh * k) / list.length, x1 - x0, bh / list.length + 0.3); });
      }
    }
    // the distances: small 0 · half · all, tall a round step
    g.font = "11px system-ui, sans-serif"; g.fillStyle = "#6b6f6d"; g.textBaseline = "alphabetic";
    const km = D / 1000, st = t > 0.5 ? kmStep(km) : null;
    const ticks = st ? Array.from({ length: Math.floor(km / st + 1e-9) + 1 }, (_, k) => k * st) : [0, km / 2];
    const endTxt = `${nf(km, km < 10 ? 1 : 0)} km`, endW = g.measureText(endTxt).width;
    for (const k of ticks) {
      const x = X(k * 1000), txt = k === 0 ? "0" : nf(k, k % 1 ? 1 : 0);
      if (k > 0 && X(D) - endW - (x + g.measureText(txt).width / 2) < 8) continue; // (the end's label there: no overlap)
      g.textAlign = k === 0 ? "left" : "center"; g.fillText(txt, k === 0 ? X(0) + 2 : x, H - 3);
    }
    g.textAlign = "right"; g.fillText(endTxt, X(D), H - 3);
    // the plan's points (tall): numbered as on the map, on the base line
    if (t > 0.05) {
      g.globalAlpha = t; g.font = "700 9px system-ui, sans-serif"; g.textAlign = "center"; g.textBaseline = "middle";
      bounds.slice(1, -1).forEach((b, k) => { const x = X(b); g.fillStyle = "#d9821a"; g.beginPath(); g.arc(x, base, 6.5, 0, 7); g.fill(); g.fillStyle = "#fff"; g.fillText(String(k + 1), x, base + 0.5); });
      g.globalAlpha = 1;
    }
    // me (the GPS) on the route
    if (me != null && Number.isFinite(P.h[me])) {
      const x = X(P.d[me]), y = Y(P.h[me]);
      g.fillStyle = "rgba(26,115,232,.18)"; g.beginPath(); g.arc(x, y, 9, 0, 7); g.fill();
      g.fillStyle = "#fff"; g.beginPath(); g.arc(x, y, 5.5, 0, 7); g.fill();
      g.fillStyle = "#1a73e8"; g.beginPath(); g.arc(x, y, 4, 0, 7); g.fill();
    }
    // two fingers: the stretch between them lit, a line at each end with its height (the way: in the card's figures)
    if (sel) {
      const [a, b] = sel, xa = X(P.d[a]), xb = X(P.d[b]);
      g.fillStyle = "rgba(91,43,209,.10)"; g.fillRect(xa, T - 4, xb - xa, base - T + 4);
      g.font = "700 11px system-ui, sans-serif"; g.textBaseline = "alphabetic";
      for (const [i, x, left] of [[a, xa, true], [b, xb, false]]) {
        if (!Number.isFinite(P.h[i])) continue;
        const y = Y(P.h[i]);
        g.strokeStyle = "#5b2bd1"; g.lineWidth = 1.5; g.beginPath(); g.moveTo(Math.round(x) + 0.5, T - 4); g.lineTo(Math.round(x) + 0.5, base); g.stroke();
        g.fillStyle = "#fff"; g.lineWidth = 2.5; g.beginPath(); g.arc(x, y, 4.5, 0, 7); g.fill(); g.stroke();
        const ht = `${Math.round(P.h[i])} m`, hw = g.measureText(ht).width, hx = left ? Math.max(L, x - 5 - hw) : Math.min(W - R - hw, x + 5);
        g.lineWidth = 3; g.strokeStyle = "rgba(255,255,255,.85)"; g.textAlign = "left"; g.strokeText(ht, hx, base - 5); g.fillStyle = "#1d1f1e"; g.fillText(ht, hx, base - 5);
      }
      // the stretch's slope: on average (up or down) and its steepest 100 m, a pill over its middle
      if (Number.isFinite(P.h[a]) && Number.isFinite(P.h[b]) && P.d[b] > P.d[a]) {
        // (on average: up and down alike, over its length: a stretch up and back down is not "flat")
        let ud = 0, upm = 0; for (let i = a + 1; i <= b; i++) if (Number.isFinite(P.h[i]) && Number.isFinite(P.h[i - 1])) { const dh = P.h[i] - P.h[i - 1]; ud += Math.abs(dh); if (dh > 0) upm += dh; }
        const avg = (100 * ud) / (P.d[b] - P.d[a]), mx = Math.max(avg, steepest({ d: P.d.slice(a, b + 1), h: P.h.slice(a, b + 1) }, Math.min(100, (P.d[b] - P.d[a]) * 0.9)));
        // (no figures in the card for it, a place's card: the stretch's own in the pill)
        const txt = onWay && way ? `śr. ${Math.round(avg)}% · max ${Math.round(mx)}%` : `${nf((P.d[b] - P.d[a]) / 1000, 1)} km · ↑${Math.round(upm)} ↓${Math.round(ud - upm)} · śr. ${Math.round(avg)}%`;
        g.font = "700 11px system-ui, sans-serif"; g.textBaseline = "middle";
        const tw = g.measureText(txt).width + 14, bx = Math.max(L, Math.min(W - R - tw, (xa + xb) / 2 - tw / 2));
        // where it hides nothing of the line: above it, else under it (in the stretch's fill), else at the top
        let top = Infinity, low = -Infinity;
        for (let i = 0; i < n; i++) { const x = X(P.d[i]); if (x < bx - 2 || x > bx + tw + 2 || !Number.isFinite(P.h[i])) continue; const y = Y(P.h[i]); top = Math.min(top, y); low = Math.max(low, y); }
        const by = top - 22 >= 0 ? top - 22 : base - 20 - (low + 4) >= 18 ? Math.max(low + 4, (low + base - 20 - 18) / 2) : T - 2;
        g.fillStyle = SLOPE_LINE[Math.max(0, SLOPES.findIndex(([m]) => avg < m))] || SLOPE_LINE[SLOPE_LINE.length - 1]; g.beginPath(); g.roundRect(bx, by, tw, 18, 9); g.fill(); /* (the colour: the average) */
        g.fillStyle = "#fff"; g.textAlign = "left"; g.fillText(txt, bx + 7, by + 9.5);
      }
    }
    // the finger: a line, the dot, the slope beside it, the height at the foot (the way: in the card's figures)
    if (!sel && cur != null && Number.isFinite(P.h[cur])) {
      const x = X(P.d[cur]), y = Y(P.h[cur]);
      g.strokeStyle = "#1d1f1e"; g.lineWidth = 1; g.beginPath(); g.moveTo(Math.round(x) + 0.5, T - 4); g.lineTo(Math.round(x) + 0.5, base); g.stroke();
      g.fillStyle = "#fff"; g.strokeStyle = "#5b2bd1"; g.lineWidth = 2.5; g.beginPath(); g.arc(x, y, 5, 0, 7); g.fill(); g.stroke();
      const onLift = rides.some((q) => P.d[cur] > q.d0 && P.d[cur] <= q.d1), sp = onLift ? 0 : P.slope[cur] || 0;
      const txt = onLift ? "kolejka" : `${sp > 0.5 ? "↗" : sp < -0.5 ? "↘" : "→"} ${Math.round(Math.abs(sp))}%`;
      g.font = "700 11px system-ui, sans-serif"; g.textBaseline = "middle";
      const tw = g.measureText(txt).width + 14, right = x + 10 + tw <= W - R, bx = right ? x + 9 : x - 9 - tw, by = Math.max(2, Math.min(base - 20, y - 9));
      g.fillStyle = onLift ? "#3f4347" : SLOPE_LINE[Math.max(0, SLOPES.findIndex(([m]) => Math.abs(sp) < m))]; g.beginPath(); g.roundRect(bx, by, tw, 18, 9); g.fill();
      g.fillStyle = "#fff"; g.textAlign = "left"; g.fillText(txt, bx + 7, by + 9.5);
      const tm = clock && Number.isFinite(P.t?.[cur]) ? ` · ${new Date(P.t[cur]).toLocaleTimeString("pl-PL", { hour: "2-digit", minute: "2-digit" })}` : "";
      const ht = `${Math.round(P.h[cur])} m${tm}`; g.font = "700 11px system-ui, sans-serif"; g.textBaseline = "alphabetic";
      const hw = g.measureText(ht).width, hx = x - 5 - hw >= L ? x - 5 - hw : x + 5;
      const hy = y > (T + base) / 2 ? T + 8 : base - 5; // (the dot low: the height at the line's top, clear of the slope's pill)
      g.lineWidth = 3; g.strokeStyle = "rgba(255,255,255,.85)"; g.textAlign = "left"; g.strokeText(ht, hx, hy); g.fillStyle = "#1d1f1e"; g.fillText(ht, hx, hy);
    }
    tell();
  }

  // the finger's way, for the card's figures: from you (on the route behind the finger), else from the start;
  // behind you the way walked already
  let told = null;
  // the key under the box: its shares for the stretch between two fingers, back to the whole way after
  let keyFor = null;
  function tellKey() {
    const want = sel ? `${sel[0]}-${sel[1]}` : "";
    if (want === keyFor) return;
    keyFor = want;
    const el = box.parentElement?.querySelector(".gkey"), h = el && groundItems(P, sel ? P.d[sel[0]] : 0, sel ? P.d[sel[1]] : Infinity);
    if (el && h) { if (!el.style.minHeight) el.style.minHeight = `${el.offsetHeight}px`; el.innerHTML = h; } // (the card keeps its height)
  }
  function tell() {
    tellKey();
    if (!onWay) return;
    if (sel && way) { const key = `${sel[0]}-${sel[1]}`; if (told === key) return; told = key; onWay(way(sel[0], sel[1]), "range"); return; }
    if (cur == null || !way) { if (told != null) { told = null; onWay(null); } return; }
    if (told === cur) return;
    told = cur;
    const fromMe = me != null && cur > me;
    onWay(way(fromMe ? me : 0, cur), fromMe ? "me" : me != null ? "past" : "start");
  }
  const at = (e) => { const r = cv.getBoundingClientRect(); return Math.max(0, Math.min(n - 1, Math.round(((e.clientX - r.left - L) / Math.max(1, r.width - L - R)) * D / P.step))); };
  // the finger moves faster than frames come (120 Hz touch): one redraw per frame, the latest place
  let want = null, raf = 0;
  const set = (i) => { want = i; if (!raf) raf = requestAnimationFrame(() => { raf = 0; place(want); }); };
  const place = (i) => {
    if (i == null || i === cur) return;
    cur = i; draw(); onCursor?.(i);
    const { X } = geom(), mk = marks.find((m) => Math.abs(X(P.d[m.i]) - X(P.d[i])) < 8) || null;
    if (mk && mk !== lastMark) onMark?.(mk);
    lastMark = mk;
  };
  // one finger: the place under it; two: the stretch between them (stays while either is still down)
  const fingers = new Map(); let wasTwo = false, fixed = null; // fixed: one of two fingers lifted, its end stays (the other moves on)
  const two = () => { const v = [...fingers.values()]; if (v.length === 1 && fixed != null) v.push(fixed); if (v.length < 2) return; const a = Math.min(v[0], v[1]), b = Math.max(v[0], v[1]); if (b - a < 1) return; if (sel && sel[0] === a && sel[1] === b) return; sel = [a, b]; cur = null; draw(); onCursor?.(a, b); };
  const end = () => { cancelAnimationFrame(raf); raf = 0; want = null; cur = null; sel = null; wasTwo = false; fixed = null; lastMark = null; draw(); onCursor?.(null); };
  cv.addEventListener("pointerdown", (e) => { e.stopPropagation(); cv.setPointerCapture(e.pointerId); fingers.set(e.pointerId, at(e)); if (fingers.size >= 2) { wasTwo = true; fixed = null; two(); } else if (wasTwo) two(); else set(at(e)); });
  // a mouse (a PC): the place under it as it hovers, gone when it leaves
  cv.addEventListener("pointermove", (e) => { if (e.pointerType === "mouse" && !e.buttons && !fingers.size) set(at(e)); });
  cv.addEventListener("pointerleave", (e) => { if (e.pointerType === "mouse" && !fingers.size) end(); });
  cv.addEventListener("pointermove", (e) => { if (!cv.hasPointerCapture(e.pointerId)) return; fingers.set(e.pointerId, at(e)); if (fingers.size >= 2 || wasTwo) two(); else set(at(e)); });
  const up = (e) => { const i = fingers.get(e.pointerId); fingers.delete(e.pointerId); if (!fingers.size) end(); else if (wasTwo && fingers.size === 1) fixed = i; };
  cv.addEventListener("pointerup", up);
  cv.addEventListener("pointercancel", up);
  cv.addEventListener("touchstart", (e) => e.stopPropagation(), { passive: true }); // not a drag of the sheet

  const ro = new ResizeObserver(() => { draw(); onResize?.(); });
  ro.observe(box);
  requestAnimationFrame(draw);
  return {
    redraw: draw,
    setMe(i) { if (i === me) return; me = i; draw(); },
    setDone(i) { if (i === done) return; done = i || 0; draw(); },
    clear() { cur = null; draw(); },
    /** The cursor (a sample) now, or null; seek(i): put it there (an outing played back). */
    at: () => cur,
    seek(i) { place(Math.max(0, Math.min(n - 1, Math.round(i)))); },
    stop() { ro.disconnect(); },
  };
}
