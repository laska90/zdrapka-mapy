// gestures on the map: pan, pinch, turn, glide, tap, long press, dragging the plan's points and line, the wheel
// (moved out of app.js: what it needs of the app comes in C, see createX in app.js)
import { see, seen } from "./seen.js";
import { state } from "./state.js";

export function createGestures(C) {
  let moved = 0;
  let last = null;
  let track = [];
  let twisted = false; // the map was turned in this gesture
  let press = null; // a finger held still: after LONG_MS a marker there (as a tap on the bare map used to)
  let markerDrag = null;
  let lineDrag = null;
  let lastTap = null;
  let wheelEnd = 0;
  const cv = C.$("map");
  // the map may not start at the window's left edge (a PC: the panel on the left): positions on it, not on the window
  let ox = 0;
  const offset = () => { ox = cv.getBoundingClientRect().left; };
  // while moving: only the last frame is shifted/scaled (cheap); the real redraw
  // comes once the fingers are off (or the wheel stops)
  function requestDraw() {
    C.view.follow(); // the GL map takes the camera at once: drawn in this frame, under the finger
    C.fullDraw(C.touching() ? 120 : 220);
  }
  // the finger's last moves (one finger panning): how fast it went when let go, for the glide after
  function trackAdd(e) { track.push([(e.clientX - ox), e.clientY, e.timeStamp]); if (track.length > 8) track.shift(); }
  /** The finger's speed over its last ~90 ms (px/ms), or null: it stood still before letting go. */
  function flickSpeed(t) {
    const recent = track.filter((q) => t - q[2] <= 90);
    if (recent.length < 2 || t - recent[recent.length - 1][2] > 45) return null;
    const a = recent[0], b = recent[recent.length - 1], dt = Math.max(8, b[2] - a[2]);
    return [(b[0] - a[0]) / dt, (b[1] - a[1]) / dt];
  }
  const LONG_MS = 480;
  cv.addEventListener("pointerdown", (e) => {
    offset();
    C.stopPlay(); C.view.stopFlight();
    if (C.$("sheet").dataset.state === "open") C.sheet("peek");
    try { cv.setPointerCapture(e.pointerId); } catch { /* a pointer already gone */ } state.ptrs.set(e.pointerId, [(e.clientX - ox), e.clientY]); moved = 0; last = null; track = [];
    clearTimeout(press?.timer);
    const x = (e.clientX - ox), y = e.clientY;
    // planning: a finger on a point of the plan drags it
    markerDrag = planning() && state.ptrs.size === 1 ? (C.view.planPointAt(x, y) >= 0 ? { i: C.view.planPointAt(x, y), x0: x, y0: y } : null) : null;
    if (!markerDrag) C.planner.closeMenu();
    // planning: a finger on the route's line pulls it: a new point there (in its leg), dragged where the finger goes
    lineDrag = planning() && C.planner.editable?.() !== false && state.ptrs.size === 1 && !markerDrag && C.view.planLineAt?.(x, y) ? { x0: x, y0: y } : null;
    press = state.ptrs.size === 1 && !markerDrag && !lineDrag ? { fired: false, timer: setTimeout(async () => {
      if (!(state.ptrs.size === 1 && moved < 6)) return;
      press.fired = true; C.haptic.bump();
      if (!planning()) { spotCard(x, y); return; }
      // planning: a point there (on the route: it goes into its leg); the finger still down drags it on
      const i = await planTap(x, y);
      if (i >= 0 && state.ptrs.size === 1) markerDrag = { i, x0: x, y0: y, fresh: true };
    }, LONG_MS) } : null;
  });
  /** A tap on the map while planning adds nothing: a word on how to add, now and then. */
  function planNudge() {
    C.planner.closeMenu();
    const n = seen("planNudges") || 0;
    if (n >= 4) return;
    see("planNudges", n + 1);
    C.toast("Przytrzymaj, żeby dodać punkt", 2000);
  }
  function planning() { return C.planner.editable() && state.cur?.key === "plan"; }
  /** A tap on the map while planning: a place there (its name), else the spot. */
  async function planTap(x, y) {
    const p = await C.view.pick(x, y);
    return C.planner.add(p && p.c !== "place" ? { x: p.x, y: p.y, n: p.n || (p.c === "parking" ? "Parking" : null) } : { x: C.view.toWorld(x, y)[0], y: C.view.toWorld(x, y)[1], n: null });
  }
  cv.addEventListener("contextmenu", (e) => e.preventDefault());
  /** The bare map at a screen point: the outings that went there (on a walked band), else a marker with the height. */
  async function spotCard(x, y) {
    if (!(C.view.zl >= 5.5 && (await C.showNear(x, y)))) C.pointCard(...C.view.toWorld(x, y));
  }
  cv.addEventListener("pointermove", (e) => {
    if (!state.ptrs.has(e.pointerId)) return;
    if (lineDrag && state.ptrs.size === 1) {
      if (Math.hypot((e.clientX - ox) - lineDrag.x0, e.clientY - lineDrag.y0) < 8) return; // still a tap: the map stays
      const [wx, wy] = C.view.toWorld(lineDrag.x0, lineDrag.y0), i = C.planner.add({ x: wx, y: wy, n: null }, true);
      lineDrag = null;
      if (i >= 0) { C.haptic.tick(); markerDrag = { i, x0: (e.clientX - ox), y0: e.clientY, fresh: true, moved: true }; }
    }
    if (markerDrag) {
      if (!markerDrag.moved && Math.hypot((e.clientX - ox) - markerDrag.x0, e.clientY - markerDrag.y0) < 7) return; // still a tap
      const [x, y] = C.view.toWorld((e.clientX - ox), e.clientY);
      C.view.movePlanPoint(markerDrag.i, x, y); markerDrag.moved = true; C.planner.closeMenu();
      C.planner.drag(markerDrag.i, x, y); // the legs at the point follow the finger
      return;
    }
    const pr = state.ptrs.get(e.pointerId);
    state.ptrs.set(e.pointerId, [(e.clientX - ox), e.clientY]);
    if (state.ptrs.size === 1) { C.view.pan((e.clientX - ox) - pr[0], e.clientY - pr[1]); moved += Math.abs((e.clientX - ox) - pr[0]) + Math.abs(e.clientY - pr[1]); trackAdd(e); }
    else track = []; // two fingers: no glide from a pinch
    if (state.follow && moved > 12) { state.follow = false; C.gpsUi(); }
    else if (state.ptrs.size === 2) {
      const [a, b] = [...state.ptrs.values()], d = Math.hypot(a[0] - b[0], a[1] - b[1]), mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2, ang = Math.atan2(b[1] - a[1], b[0] - a[0]);
      const turn = (x) => Math.atan2(Math.sin(x), Math.cos(x));
      if (last) {
        C.view.zoomAt(mx, my, d / last.d); C.view.pan(mx - last.mx, my - last.my);
        // a twist turns the map only when it is clearly a twist: about 25° (or 18° with hardly any pinch);
        // a gesture that zoomed first stays a zoom (no turning in it)
        const tw = Math.abs(turn(ang - last.a0)), zm = Math.abs(Math.log(d / last.d0));
        if (!last.turning && !last.zoomOnly && zm > 0.25 && tw < 0.15) last.zoomOnly = true;
        if (!last.turning && !last.zoomOnly && (tw > 0.44 || (tw > 0.31 && zm < 0.12))) { last.turning = true; twisted = true; last.a = ang; }
        if (last.turning) C.view.rotateAt(mx, my, turn(ang - last.a));
      }
      last = { d, mx, my, a: ang, a0: last?.a0 ?? ang, d0: last?.d0 ?? d, turning: !!last?.turning, zoomOnly: !!last?.zoomOnly }; moved += 10;
    }
    requestDraw();
  });
  /** Double tap: zoom in around the finger (smoothly), like on tourist maps. */
  function zoomTo(x, y, f, ms = 260) {
    const s0 = C.view.s, ox0 = C.view.ox, oy0 = C.view.oy, t0 = performance.now();
    const step = (now) => {
      const k = Math.min(1, (now - t0) / ms), e = 1 - (1 - k) ** 3;
      C.view.s = s0; C.view.ox = ox0; C.view.oy = oy0; C.view.zoomAt(x, y, f ** e); C.view.step();
      if (k < 1) requestAnimationFrame(step); else if (!C.view.settle()) C.view.draw();
    };
    requestAnimationFrame(step);
  }
  cv.addEventListener("pointerup", (e) => {
    lineDrag = null;
    if (markerDrag) {
      const m = markerDrag; markerDrag = null; state.ptrs.delete(e.pointerId); last = null;
      if (m.moved) { C.planner.move(m.i, ...C.view.toWorld((e.clientX - ox), e.clientY)); C.haptic.tick(); }
      else if (m.fresh) { /* a point just made by a long press, let go: nothing more */ }
      else C.planner.pointMenu(m.i, e.clientX, e.clientY); // a tap on a point: remove it, or finish there (a loop from A)
      return;
    }
    const held = press?.fired;
    clearTimeout(press?.timer); press = null;
    if (held) { state.ptrs.delete(e.pointerId); last = null; return; } // the long press did its job
    if (state.ptrs.size === 1 && moved < 6) {
      const [x, y] = [(e.clientX - ox), e.clientY], now = performance.now();
      if (lastTap && now - lastTap.t < 320 && Math.hypot(x - lastTap.x, y - lastTap.y) < 30) {
        clearTimeout(lastTap.timer); lastTap = null; state.ptrs.delete(e.pointerId); last = null;
        zoomTo(x, y, 2);
        return;
      }
      // a single tap picks a point - a moment later, in case it is the first of a double tap
      lastTap = { t: now, x, y, timer: setTimeout(async () => {
        if (planning()) { // planning: a tap near a junction dot or a sign adds it (no need to hit it); elsewhere a long press
          const p = await C.view.pick(x, y, 44);
          if (p?.c === "lift" && C.lifts?.planTap(p)) return; // a lift's station (after its other one: the ride)
          // every sign on the map counts as a junction dot (a station, a car park, a hut...); a town's name not
          if (p && p.c !== "place") C.planner.add({ x: p.x, y: p.y, n: p.n || (p.c === "parking" ? "Parking" : null) });
          else planNudge();
          return;
        }
        const g = C.gps.on && C.gpsXY();
        if (g && Math.hypot(C.view.toScreen(g[0], g[1])[0] - x, C.view.toScreen(g[0], g[1])[1] - y) < 26) { C.posCard(); return; }
        const p = await C.view.pick(x, y), r = !p && C.view.zl < 5.5 ? await C.view.rangeAt(x, y) : null;
        if (p?.c === "lift" && C.lifts?.card(p)) { /* a lift's station */ } else if (p) C.showTip(p); else if (r) C.showRange(r);
        else if (C.planner.isActive?.() && !C.planner.drafting?.()) { if (state.cur?.key !== "plan") { C.hideTip(); C.planner.show({ quiet: true }); } } // walking: a bare tap brings the route's card back (it is the default)
        else if (!C.$("tip").hidden) C.hideTip(); // a card is up: a tap on the bare map puts it away (as X); a long press makes a marker
        else spotCard(x, y); // a marker and the height there
      }, 240) };
    }
    state.ptrs.delete(e.pointerId); last = null;
    if (!state.ptrs.size && twisted) { twisted = false; if (C.view.rot && Math.abs(C.view.rot) < 0.07) C.view.rotateAt(C.view.W / 2, C.view.H / 2, -C.view.rot); } // within 4° of north: north
    if (!state.ptrs.size && moved >= 6) {
      const v = flickSpeed(e.timeStamp);
      if (v && C.view.overshoot() < 1 && C.view.fling(v[0], v[1])) { /* glides on, then settles and draws itself */ }
      else if (!C.view.settle()) C.fullDraw(30); // past the edge or the zoom limits: back, then drawn
    }
    track = [];
  });
  cv.addEventListener("pointercancel", (e) => { clearTimeout(press?.timer); press = null; state.ptrs.delete(e.pointerId); last = null; if (!state.ptrs.size) C.fullDraw(30); });
  cv.addEventListener("wheel", (e) => { offset(); e.preventDefault(); C.view.stopFlight(); C.view.zoomAt((e.clientX - ox), e.clientY, Math.exp(-e.deltaY * 0.0015)); requestDraw(); clearTimeout(wheelEnd); wheelEnd = setTimeout(() => C.view.settle(), 220); }, { passive: false });
  addEventListener("resize", () => C.view.resize());

}
