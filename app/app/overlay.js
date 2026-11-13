// What the page draws by hand over the GL map, on the 2D canvas over it (#map, which also takes the
// touches): the plan, saved plans, the chosen outing, a town's area, the pin, the profile cursor, the
// GPS dot. Lines in pack metres are laid out on screen every frame (exact projection, glmap.js);
// only on frames where the camera or something here changed (the map also draws frames for tiles and
// fades), lines off the screen skipped, and an empty layer is left alone.

import { drawMapSign } from "./glyphs.js";

const boxes = new WeakMap();
/** A flat line's box (pack metres), kept per line. */
function bboxOf(f) {
  let b = boxes.get(f);
  if (b) return b;
  b = [Infinity, Infinity, -Infinity, -Infinity];
  for (let i = 0; i < f.length; i += 2) { const x = f[i], y = f[i + 1]; if (x < b[0]) b[0] = x; if (x > b[2]) b[2] = x; if (y < b[1]) b[1] = y; if (y > b[3]) b[3] = y; }
  boxes.set(f, b);
  return b;
}

export class Overlay {
  constructor(view) {
    this.v = view; this.g = view.screen.getContext("2d");
    this.sel = "#5b2bd1"; this.ui = "#5b2bd1";
    this.plan = null; this.saved = null; this.hl = null; this.area = null; this.pin = null; this.cursor = null; this.gps = null;
  }
  /** Flat [x, y, ...] lines (pack metres) as one screen path (CSS px); close: rings. */
  P(flats, close = false) {
    const p = new Path2D(), v = this.v, w = this.view || this.viewBox();
    for (const f of flats || []) {
      if (!f || f.length < 4) continue;
      const b = bboxOf(f);
      if (b[2] < w[0] || b[0] > w[2] || b[3] < w[1] || b[1] > w[3]) continue; // off the screen
      let [x, y] = v.toScreen(f[0], f[1]); p.moveTo(x, y);
      for (let i = 2; i < f.length; i += 2) { [x, y] = v.toScreen(f[i], f[i + 1]); p.lineTo(x, y); }
      if (close) p.closePath();
    }
    return p;
  }
  /** Everything, for the view as it is now (after the GL map moved, or when something here changed). */
  /** The screen in pack metres (a box round it, turned or not, with a margin for line widths). */
  viewBox() {
    const v = this.v, m = 40, c = [[-m, -m], [v.W + m, -m], [-m, v.H + m], [v.W + m, v.H + m]].map(([x, y]) => v.toWorld(x, y));
    return [Math.min(...c.map((q) => q[0])), Math.min(...c.map((q) => q[1])), Math.max(...c.map((q) => q[0])), Math.max(...c.map((q) => q[1]))];
  }
  /** Something here changed: drawn with the map's next frame. */
  draw() {
    this.ver = (this.ver || 0) + 1;
    if (this.v.map) { this.v.map.triggerRepaint(); return; } // drawn with the map's frame (glmap.js "render")
    if (this.raf) return;
    this.raf = requestAnimationFrame(() => { this.raf = 0; this.drawNow(); });
  }
  /** With the map's frame (glmap.js "render"): drawn only when the camera or something here changed. */
  frame() {
    const key = `${this.v.camKey}|${this.ver || 0}|${this.v.dpr}|${this.g.canvas.width}x${this.g.canvas.height}`;
    if (key === this.lastKey) return;
    this.lastKey = key;
    this.drawNow();
  }
  empty() { return !(this.saved && !this.plan) && !this.area && !this.hl && !this.plan && !this.cursor && !this.gps && !this.pin; }
  drawNow() {
    const v = this.v, g = this.g, d = v.dpr, s = v.s;
    if (this.empty() || !v.P) { // nothing to draw: clear once, then leave the canvas be
      if (this.inked) { g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, g.canvas.width, g.canvas.height); this.inked = false; }
      return;
    }
    g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, g.canvas.width, g.canvas.height);
    this.inked = true;
    this.view = this.viewBox();
    if (this.saved && !this.glPlan) this.drawSaved(g, d, s); // (in the map itself once it has the plan layers: glmap planLayer)
    if (this.area) this.drawArea(g, d, s);
    if (this.hl) this.drawHighlight(g, d, s);
    if (this.plan) this.drawPlan(g, d, s);
    if (this.cursor) this.drawCursor(g, d, s);
    if (this.pin) { this.drawPin(g, d, s); this.drawPinTag(g, d); }
    if (this.plan) this.drawPlanMarks(g, d, s);
    if (this.gps) this.drawGps(g, d, s); // last: your dot over everything (never lost among the route's marks)
    this.view = null;
  }
  /** A planned route: {runs: [{line: flat [x, y, ...] (pack metres), cols: "red,blue" | "", cat}], pts: [[x, y]],
   * done: flat line of the active route already walked, drag: the point being moved} (null clears). */
  setPlan(plan) {
    if (!plan) { this.plan = null; this.draw(); return; }
    const runs = (plan.runs || []).filter((r) => r.line?.length >= 4).map((r) => {
      return { line: r.line, cols: r.cols ? r.cols.split(",") : [], cat: r.cat };
    });
    this.plan = { runs, pts: plan.pts || [], done: plan.done || null, closed: plan.closed || [], drag: plan.drag ?? null, live: !!plan.live, toward: !!plan.toward };
    this.draw();
  }
  /** Saved plans: [{line: flat [x, y, ...]}] drawn as a dashed line (null or [] clears). */
  setSaved(list) {
    if (!list?.length) { this.saved = null; this.draw(); return; }
    this.saved = list.map((q) => q.line); this.draw();
  }
  drawSaved(g, d, s) {
    g.save();
    g.setTransform(d, 0, 0, d, 0, 0);
    g.lineCap = "round"; g.lineJoin = "round";
    // as the plan's line (white casing, the accent), lighter: a plan in waiting
    g.strokeStyle = "rgba(255,255,255,.85)"; g.lineWidth = 6.5; const sp = this.P(this.saved); g.stroke(sp);
    g.strokeStyle = this.selA(0.55); g.lineWidth = 3.5; g.stroke(sp);
    g.restore();
  }
  /** Moving a plan's point with the finger: just the marker (the route follows on release). */
  movePlanPoint(i, x, y) { if (!this.plan?.pts[i]) return; this.plan.pts[i] = [x, y]; this.plan.drag = i; this.draw(); }
  /** Is the plan's route line under a screen position (within r px)? (Dragging the line makes a point.) */
  planLineAt(sx, sy, r = 16) {
    for (const run of this.plan?.runs || []) {
      const L = run.line;
      let [px, py] = this.v.toScreen(L[0], L[1]);
      for (let i = 2; i < L.length; i += 2) {
        const [x, y] = this.v.toScreen(L[i], L[i + 1]), dx = x - px, dy = y - py, l2 = dx * dx + dy * dy;
        const t = l2 ? Math.max(0, Math.min(1, ((sx - px) * dx + (sy - py) * dy) / l2)) : 0;
        if (Math.hypot(px + t * dx - sx, py + t * dy - sy) <= r) return true;
        px = x; py = y;
      }
    }
    return false;
  }
  /** The plan's point under a screen position (within r px), or -1. */
  planPointAt(sx, sy, r = 24) {
    const pts = this.plan?.pts || [];
    let best = -1, bd = r;
    pts.forEach((q, i) => {
      if (!q) return;
      const [X, Y] = this.v.toScreen(q[0], q[1]);
      const d = Math.hypot(X - sx, Y - sy);
      if (d < bd || (d === bd && i === 0)) { bd = d; best = i; }
    });
    return best;
  }
  /** The plan (only until the map has its own plan layers, glmap planLayer): the highlighter band and the
   * stretches off the trails, as there. */
  drawPlan(g, d) {
    if (this.glPlan) return;
    const { runs, live } = this.plan;
    g.save(); g.setTransform(d, 0, 0, d, 0, 0); g.lineCap = "round"; g.lineJoin = "round";
    for (const r of runs) r.p = this.P([r.line]);
    g.globalAlpha = live ? 0.7 : 1; g.strokeStyle = "#f6cf7c"; g.lineWidth = 16;
    for (const r of runs) g.stroke(r.p);
    g.globalAlpha = 1;
    for (const r of runs) {
      if (r.cols.length) continue;
      g.setLineDash(r.cat === -1 ? [2, 5] : [6, 4]); g.strokeStyle = r.cat === -1 ? "#b3261e" : "#5a3a1c"; g.lineWidth = 2; g.stroke(r.p); g.setLineDash([]);
    }
    g.restore();
  }
  /** The plan's points, easy to find on the band: the start a green disc with a flag, the finish a dark one with
   * a chequered flag, the points between amber discs with their numbers (as in the card's list); the one being
   * moved bigger, with a halo. A loop (the finish on the start): one disc, half green, half dark. */
  drawPlanMarks(g, d) {
    const { pts, drag, toward } = this.plan, n = pts.length;
    g.save(); g.setTransform(d, 0, 0, d, 0, 0);
    g.textAlign = "center"; g.textBaseline = "middle";
    const order = pts.map((q, i) => i).filter((i) => i !== 0 && i !== n - 1).concat(n > 1 ? [n - 1, 0] : [0]);
    const P0 = pts[0], PZ = pts[n - 1], loop = n > 2 && P0 && PZ && Math.hypot(P0[0] - PZ[0], P0[1] - PZ[1]) * this.v.s < 10;
    const flag = (x, y, finish) => {
      g.strokeStyle = "#fff"; g.lineWidth = 1.5; g.lineCap = "round";
      g.beginPath(); g.moveTo(x - 3, y - 4.5); g.lineTo(x - 3, y + 4.5); g.stroke();
      g.fillStyle = "#fff";
      if (!finish) { g.beginPath(); g.moveTo(x - 3, y - 4.5); g.lineTo(x + 4, y - 2); g.lineTo(x - 3, y + 0.5); g.closePath(); g.fill(); }
      else for (let a = 0; a < 3; a++) for (let b = 0; b < 2; b++) if ((a + b) % 2 === 0) g.fillRect(x - 3 + a * 2.4, y - 4.5 + b * 2.4, 2.4, 2.4);
    };
    for (const i of order) {
      const q = pts[i];
      if (!q) continue;
      const [x, y] = this.v.toScreen(q[0], q[1]), big = i === drag ? 1.25 : 1, last = (i === n - 1 && n > 1) || toward, first = i === 0 && !toward, r = (first || last ? 9.5 : 8.5) * big;
      if (big > 1) { g.beginPath(); g.arc(x, y, 22, 0, 7); g.fillStyle = this.selA(0.2); g.fill(); }
      g.shadowColor = "rgba(0,0,0,.3)"; g.shadowBlur = 4;
      g.beginPath(); g.arc(x, y, r + 2, 0, 7); g.fillStyle = "#fff"; g.fill(); g.shadowBlur = 0; g.shadowColor = "transparent";
      if (first && loop) {
        g.beginPath(); g.arc(x, y, r, Math.PI / 2, Math.PI * 1.5); g.fillStyle = "#2e7d32"; g.fill();
        g.beginPath(); g.arc(x, y, r, -Math.PI / 2, Math.PI / 2); g.fillStyle = "#26282b"; g.fill();
        flag(x, y, false);
      } else if (first || last) { g.beginPath(); g.arc(x, y, r, 0, 7); g.fillStyle = first ? "#2e7d32" : "#26282b"; g.fill(); flag(x, y, !first); }
      else { g.beginPath(); g.arc(x, y, r, 0, 7); g.fillStyle = "#d9820f"; g.fill(); g.fillStyle = "#fff"; g.font = `700 ${Math.round(10.5 * big)}px system-ui, sans-serif`; g.fillText(String(i), x, y + 0.5); }
    }
    g.restore();
  }
  /** One outing drawn on top: parts as flat [x, y, ...] in pack metres (null clears). */
  setHighlight(parts) {
    if (!parts) { this.hl = null; this.draw(); return; }
    const a = parts.find((f) => f.length >= 2), b = [...parts].reverse().find((f) => f.length >= 2);
    this.hl = { flats: parts.filter((f) => f.length >= 4), start: a && [a[0], a[1]], end: b && [b[b.length - 2], b[b.length - 1]] };
    this.draw();
  }
  /** Violet: what is yours (a walked outing, a place, a town's area); sel is the plan's amber. */
  mineA(a) { return `rgba(91,43,209,${a})`; }
  selA(a) { const h = (this.sel || "#5b2bd1").replace("#", ""), n = parseInt(h.length === 3 ? h.replace(/./g, "$&$&") : h, 16); return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a})`; }
  /** A town's or village's built-up area (rings as flat [x, y, ...] in pack metres), or null. */
  setArea(rings) {
    this.area = rings?.length ? rings : null;
    this.draw();
  }
  drawArea(g, d, s) {
    const col = (a) => this.mineA(a);
    const all = this.P(this.area, true);
    g.save(); g.setTransform(d, 0, 0, d, 0, 0);
    g.fillStyle = col(0.08); g.fill(all, "nonzero");
    g.restore();
    // the outline of the whole: drawn twice as wide on a layer of its own, then the inside of every
    // patch cut out of it - the edges two patches share vanish, the outer half of the rest stays
    const c = (this._area ||= document.createElement("canvas"));
    if (c.width !== g.canvas.width || c.height !== g.canvas.height) { c.width = g.canvas.width; c.height = g.canvas.height; }
    const t = c.getContext("2d");
    t.setTransform(1, 0, 0, 1, 0, 0); t.clearRect(0, 0, c.width, c.height);
    t.setTransform(d, 0, 0, d, 0, 0); t.lineJoin = "round";
    t.strokeStyle = "rgba(255,255,255,.85)"; t.lineWidth = 7; t.stroke(all);
    t.strokeStyle = col(0.95); t.lineWidth = 3.6; t.setLineDash([7, 4.5]); t.stroke(all); t.setLineDash([]);
    t.globalCompositeOperation = "destination-out"; t.fillStyle = "#000"; t.fill(all, "nonzero"); t.globalCompositeOperation = "source-over";
    g.save(); g.setTransform(1, 0, 0, 1, 0, 0); g.drawImage(c, 0, 0); g.restore();
  }
  /** A tapped spot (a small pin); null clears. */
  setPin(p) { const same = p && this.pin && p[0] === this.pin[0] && p[1] === this.pin[1]; this.pin = p; if (!same) this.pinT = performance.now(); this.draw(); }
  /** The profile cursor on the route: [x, y], or {a, b, line} (two fingers: the stretch between them); null clears. */
  // the cursor moves with a finger on a profile while the map stands still: just this layer again
  // (not the whole map's frame, fog and all)
  setCursor(p) { if (!p && !this.cursor) return; this.cursor = p; if (this.v.map && !this.v.map.isMoving()) this.drawNow(); else this.draw(); }

  /** The selected outing: a light halo, a violet line, start (open) and end (filled) dots. */
  drawHighlight(g, d, s) {
    const { flats, start, end } = this.hl, p = this.P(flats);
    g.save();
    g.setTransform(d, 0, 0, d, 0, 0);
    g.lineCap = "round"; g.lineJoin = "round";
    g.strokeStyle = "rgba(255,250,236,.92)"; g.lineWidth = 8.5; g.stroke(p);
    g.strokeStyle = this.mineA(1); g.lineWidth = 4.2; g.stroke(p);
    g.setTransform(d, 0, 0, d, 0, 0);
    const dot = (q, fill) => {
      if (!q) return;
      const [x, y] = this.v.toScreen(q[0], q[1]);
      g.beginPath(); g.arc(x, y, 7.5, 0, 7); g.fillStyle = "rgba(255,250,236,.95)"; g.fill();
      g.beginPath(); g.arc(x, y, 5, 0, 7); g.fillStyle = fill ? this.mineA(1) : "#fff"; g.fill(); g.lineWidth = 2.4; g.strokeStyle = this.mineA(1); g.stroke();
    };
    dot(start, false); dot(end, true);
    g.restore();
  }

  /** A tapped spot: a map pin; a point (peak, hut...): a white disc under its sign with a dark ring;
   * a place name: a dot. */
  drawPin(g, d, s) {
    const [px, py, kind, key, reached] = this.pin, [x, y] = this.v.toScreen(px, py), INK = "#1d1f1e", HALO = "rgba(255,255,255,.96)";
    // it comes in with a little spring
    const t = Math.min(1, (performance.now() - (this.pinT || 0)) / 260), c1 = 1.9, k = 1 + (c1 + 1) * (t - 1) ** 3 + c1 * (t - 1) ** 2;
    if (t < 1) requestAnimationFrame(() => this.draw());
    g.save(); g.setTransform(d, 0, 0, d, 0, 0);
    g.lineCap = "round"; g.lineJoin = "round";
    if (kind === "poi" && key) { // the sign, bigger, on a white disc
      g.translate(x, y); g.scale(k, k); g.translate(-x, -y);
      g.shadowColor = "rgba(0,0,0,.3)"; g.shadowBlur = 8; g.shadowOffsetY = 2;
      g.beginPath(); g.arc(x, y, 17, 0, 7); g.fillStyle = HALO; g.fill();
      g.shadowColor = "transparent";
      g.lineWidth = 2.2; g.strokeStyle = INK; g.stroke();
      drawMapSign(g, key, x, y + (key.startsWith("peak") ? 1 : 0), 20, reached); // (the map's own sign, bigger)
      g.restore();
      return;
    }
    if (kind === "place") { // a town or village (its built-up area is outlined when the map has it): a small dot
      g.beginPath(); g.arc(x, y, 6.5, 0, 7); g.fillStyle = HALO; g.fill();
      g.beginPath(); g.arc(x, y, 4, 0, 7); g.fillStyle = this.mineA(1); g.fill();
      return;
    }
    if (kind === "poi") {
      const cy = y, r = 14;
      g.shadowColor = "rgba(0,0,0,.28)"; g.shadowBlur = 6; g.shadowOffsetY = 1;
      g.beginPath(); g.arc(x, cy, r, 0, 7); g.fillStyle = HALO; g.fill();
      g.shadowColor = "transparent";
      g.lineWidth = 5; g.strokeStyle = HALO; g.stroke();
      g.lineWidth = 2.2; g.strokeStyle = INK; g.stroke();
    } else {
      // a teardrop pin standing on the point
      const pin = new Path2D(), r = 9, cy = y - 22, C = this.mineA(1);
      pin.moveTo(x, y); pin.bezierCurveTo(x - 3, y - 7, x - r, cy + 6, x - r, cy); pin.arc(x, cy, r, Math.PI, 0); pin.bezierCurveTo(x + r, cy + 6, x + 3, y - 7, x, y); pin.closePath();
      g.fillStyle = "rgba(0,0,0,.18)"; g.beginPath(); g.ellipse(x, y, 5, 2, 0, 0, 7); g.fill();
      g.shadowColor = "rgba(0,0,0,.35)"; g.shadowBlur = 4; g.shadowOffsetY = 1.5;
      g.fillStyle = C; g.fill(pin);
      g.shadowColor = "transparent"; g.lineWidth = 1.6; g.strokeStyle = "#fff"; g.stroke(pin);
      g.beginPath(); g.arc(x, cy, 3.4, 0, 7); g.fillStyle = "#fff"; g.fill();
    }
    g.restore();
  }

  /** The height at the chosen spot, in a small tag beside it. */
  drawPinTag(g, d) {
    const t = this.pin[5];
    if (!t) return;
    const [x, y] = this.v.toScreen(this.pin[0], this.pin[1]), kind = this.pin[2], dx = kind === "poi" && this.pin[3] ? 24 : 14;
    g.save(); g.setTransform(d, 0, 0, d, 0, 0);
    g.font = "700 13px system-ui, sans-serif"; g.textBaseline = "middle";
    const w = g.measureText(t).width + 14;
    g.shadowColor = "rgba(0,0,0,.25)"; g.shadowBlur = 6; g.shadowOffsetY = 1;
    g.fillStyle = "#fff"; g.beginPath(); g.roundRect(x + dx, y - 11, w, 22, 8); g.fill();
    g.shadowColor = "transparent"; g.fillStyle = "#1d1f1e"; g.fillText(t, x + dx + 7, y + 0.5);
    g.restore();
  }
  drawCursor(g, d, s) {
    const V = (a) => `rgba(91,43,209,${a})`; // (violet, as the profile's finger: the route under it is amber)
    const c = this.cursor, dot = (x, y) => {
      g.beginPath(); g.arc(x, y, 15, 0, 7); g.fillStyle = V(0.2); g.fill();
      g.shadowColor = "rgba(0,0,0,.3)"; g.shadowBlur = 4;
      g.beginPath(); g.arc(x, y, 8.5, 0, 7); g.fillStyle = "#fff"; g.fill();
      g.shadowColor = "transparent";
      g.beginPath(); g.arc(x, y, 5.8, 0, 7); g.fillStyle = V(1); g.fill();
    };
    g.save(); g.setTransform(d, 0, 0, d, 0, 0);
    if (Array.isArray(c)) { const [x, y] = this.v.toScreen(c[0], c[1]); dot(x, y); }
    else { // two fingers on the profile: the stretch between them lit on the map, a dot at each end
      if (c.line?.length >= 4) {
        g.beginPath(); for (let i = 0; i < c.line.length; i += 2) { const [x, y] = this.v.toScreen(c.line[i], c.line[i + 1]); if (i) g.lineTo(x, y); else g.moveTo(x, y); }
        g.lineJoin = "round"; g.lineCap = "round"; g.strokeStyle = V(0.5); g.lineWidth = 5; g.stroke();
      }
      for (const p of [c.a, c.b]) { const [x, y] = this.v.toScreen(p[0], p[1]); dot(x, y); }
    }
    g.restore();
  }

  /** Blue dot: accuracy circle, a cone for the way the phone points, the dot. */
  drawGps(g, d, s) {
    const { x: gx, y: gy, acc, heading, stale } = this.gps, [x, y] = this.v.toScreen(gx, gy);
    if (x < -200 || y < -200 || x > this.v.W + 200 || y > this.v.H + 200) return;
    const blue = stale ? "#8a8f98" : "#1a73e8";
    g.save(); g.setTransform(d, 0, 0, d, 0, 0);
    const r = (acc || 0) * s;
    if (r > 10) {
      g.beginPath(); g.arc(x, y, Math.min(r, 4000), 0, 7);
      g.fillStyle = stale ? "rgba(138,143,152,.12)" : "rgba(26,115,232,.12)"; g.fill();
      g.lineWidth = 1; g.strokeStyle = stale ? "rgba(138,143,152,.45)" : "rgba(26,115,232,.45)"; g.stroke();
    }
    if (heading != null && !stale) {
      const a = ((heading - 90) * Math.PI) / 180 + this.v.rot, w = 0.55, R = 46; // the map turned: the cone turns with it
      const cg = g.createRadialGradient(x, y, 4, x, y, R);
      cg.addColorStop(0, "rgba(26,115,232,.55)"); cg.addColorStop(1, "rgba(26,115,232,0)");
      g.beginPath(); g.moveTo(x, y); g.arc(x, y, R, a - w, a + w); g.closePath(); g.fillStyle = cg; g.fill();
    }
    g.shadowColor = "rgba(0,0,0,.35)"; g.shadowBlur = 5;
    g.beginPath(); g.arc(x, y, 9.5, 0, 7); g.fillStyle = "#fff"; g.fill();
    g.shadowBlur = 0;
    g.beginPath(); g.arc(x, y, 6.8, 0, 7); g.fillStyle = blue; g.fill();
    g.restore();
  }

}
