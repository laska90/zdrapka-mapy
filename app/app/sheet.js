// the sheet: its heights and folding, dragging it, the card on it (openTip/hideTip), Back through the cards
// (moved out of app.js: what it needs of the app comes in C, see createX in app.js)
import { state } from "./state.js";
import { isNative } from "./native.js";
import { note } from "./diag.js";

export function createSheet(C) {
  let goingBack = false;
  let lastSheet = "peek";
  // the toast floats above the tip when both are up
  /** Height of the sheet's strip when it shows the card (or the figures). */
  function peekHeight() {
    const sh = C.$("sheet");
    return sh.querySelector(".grab").offsetHeight + (sh.dataset.tip ? C.$("tip").offsetHeight : C.$("peek").offsetHeight);
  }
  /** Folded down: only the handle and the title line (the card's name, or the region's). */
  function minHeight() {
    const sh = C.$("sheet");
    // walking the active route: folded to its name, the figures (to the finish) and the small profile; the buttons out of sight
    const wp = sh.dataset.tip && state.planWalk() ? C.$("tip").querySelector(".plan .kpi.gx .gprof") : null;
    if (wp) return Math.round(Math.min(peekHeight(), wp.getBoundingClientRect().bottom - sh.getBoundingClientRect().top - Math.max(0, wp.getBoundingClientRect().height - 100) + 10));
    const el = sh.dataset.tip ? C.$("tip").querySelector(".plan .kpi.cx") || C.$("tip").querySelector(".plan .pthumb") || C.$("tip").querySelector(".plan .psub") || C.$("tip").querySelector(".phd3, h4") : C.$("peek").querySelector(".phd, .pqa .qa");
    if (!el) return Math.min(peekHeight(), sh.querySelector(".grab").offsetHeight + 40);
    // a plan's profile grows with the card: folded it is small again (its box 58 px, the line under it gone)
    const gp = sh.dataset.tip ? C.$("tip").querySelector(".plan .gprof") : null, gr = gp && C.$("tip").querySelector(".plan.big .gread");
    const nm = sh.dataset.tip ? C.$("tip").querySelector(".plan.big > .pname") : null; // (the name shows only above the folded card)
    const extra = gp ? Math.max(0, gp.getBoundingClientRect().height - 100) + (gr ? gr.offsetHeight + 8 : 0) + (nm && C.$("tip").querySelector(".plan .kpi.cx") ? nm.offsetHeight + 4 : 0) : 0;
    const sc = sh.dataset.tip ? C.$("tip").scrollTop : 0; // (the card scrolled: where its top part is unscrolled)
    return Math.round(Math.min(peekHeight(), el.getBoundingClientRect().bottom + sc - sh.getBoundingClientRect().top + (el.classList.contains("cx") ? 5 : 12) - extra));
  }
  /** A plan's card in the middle: its figures and the profile, the steps under it out of sight
   * (null when there is no profile, or it would be about the same as folded or up). */
  function midHeight() {
    const sh = C.$("sheet"), el = sh.dataset.tip && !compactPlan() ? C.$("tip").querySelector(".plan .prof") : null; // (the compact plan card: two heights only)
    if (!el) return null;
    const h = Math.round(el.getBoundingClientRect().bottom - sh.getBoundingClientRect().top + 24);
    return h > minHeight() + 40 && h < peekHeight() - 30 ? h : null;
  }
  /** Folded right down: the handle only (just the map). */
  function hiddenHeight() { return C.$("sheet").querySelector(".grab").offsetHeight + 4; }
  function setStrip(h) { return document.documentElement.style.setProperty("--sheet-peek", `${Math.round(h)}px`); }
  function viewNow() { return { s: C.view.s, ox: C.view.ox, oy: C.view.oy, rot: C.view.rot }; }
  // Cards in the sheet keep a history: opening one from another (a place on a route, a
  // visit on a place card, a peak from a list) can go back - the button on the card, or
  // the phone's back button. onClose runs when a card leaves the history (closed, or
  // left by going back), not when another card is opened on top of it.
  function openTip(html, onClose = null, key = null, nav = null) {
    const el = C.$("tip");
    if (state.cur?.key !== key) { C.stopPlay?.(); state.curProf = null; }
    if (state.cur && state.cur.key !== key) {
      if (!goingBack && state.cur.label) { state.navStack.push({ ...state.cur, view: viewNow() }); if (state.navStack.length > 25) state.navStack.shift().onClose?.(); }
      else state.cur.onClose?.();
    }
    if (state.cur?.key !== key) C.view.setCursor(null);
    const refold = !(key === "plan" && state.cur?.key === "plan"); // the plan's card redrawn (a point added...): it stays as folded as it was
    // another card on top of an outing's: the route is no longer highlighted (Back brings it back)
    if (state.cur?.key?.startsWith("o:") && state.cur.key !== key && !key?.startsWith("o:")) { state.selected = null; C.view.setHighlight(null); C.renderOutings(); }
    state.cur = { key, onClose, label: nav?.label, reopen: nav?.reopen };
    C.view.setPin(nav?.pin || null); C.view.setArea(null);
    const back = isNative() ? null : state.navStack[state.navStack.length - 1]; // in the app the phone's own Back does it (no extra button)
    el.innerHTML = (back ? `<button class="back"><svg><use href="#i-back"/></svg><span>${back.label}</span></button>` : "") + html +
      `<button class="iconbtn tx" aria-label="Zamknij"><svg><use href="#i-x"/></svg></button>`;
    el.querySelector(".tx").onclick = hideTip;
    el.querySelector(".back")?.addEventListener("click", goBack);
    el.hidden = false; C.$("sheet").dataset.tip = "1";
    if (refold && ["min", "hidden", "mid"].includes(C.$("sheet").dataset.state)) sheet("peek"); // a tap on the map: the card comes up
    C.placeToast();
    try { C.routePill(); } catch { /* (before the planner is up) */ }
  }
  function hideTip() {
    C.stopPlay(); state.curProf = null;
    C.$("tip").hidden = true; C.$("tip").innerHTML = ""; delete C.$("sheet").dataset.tip; C.placeToast(); C.view.setPin(null); C.view.setArea(null); C.view.setCursor(null);
    const all = [state.cur, ...state.navStack.splice(0)].filter(Boolean);
    state.cur = null;
    // a card over the route's (planning or walking): × goes back to the route, it does not end it
    const route = state.cur === null && all[0]?.key !== "plan" ? all.find((c) => c.key === "plan" && c.reopen) : null;
    if (route) {
      for (const c of all) if (c !== route) c.onClose?.();
      route.reopen(); sheet("min");
      try { C.routePill(); } catch { /* (before the planner is up) */ }
      return;
    }
    for (const c of all) c.onClose?.();
    // walking a route: its card is what is under every other one (closing another card: back to it)
    if (all.length && !all.some((c) => c.key === "plan") && C.planner?.isActive?.() && !C.planner.drafting?.() && !C.planner.isShown?.()) C.planner.show({ quiet: true });
    try { C.routePill(); } catch { /* (before the planner is up) */ }
  }
  /** Back to the card before: its view and its card again. */
  function goBack() {
    const prev = state.navStack.pop();
    if (!prev) return hideTip();
    goingBack = true;
    try {
      if (prev.list) { // the card was opened from a list in the sheet: back to the list
        state.cur?.onClose?.(); state.cur = null;
        C.$("tip").hidden = true; delete C.$("sheet").dataset.tip; C.view.setPin(null); C.view.setCursor(null);
        sheet("peek");
        if (prev.list === "search") { C.$("q").value = prev.q || ""; C.runSearch(); } // back to the results
        else { state.dstack = prev.dstack || []; C.drawer(prev.list === "home" ? null : prev.list, { keep: true, back: true }); }
      } else {
        // the card being left goes now (reopen may finish asynchronously, after this flag)
        const left = state.cur; state.cur = null; left?.onClose?.();
        C.flyView(() => Object.assign(C.view, prev.view));
        prev.reopen?.();
      }
    } finally { goingBack = false; }
  }
  /** Remember the list a card is opened from (Back returns to it). */
  function fromList(tab, label, extra = {}) {
    C.drawer(false);
    if (state.cur && !goingBack) state.navStack.push({ ...state.cur, view: viewNow() });
    state.cur = null;
    state.navStack.push({ key: `list:${tab}`, list: tab, label, dstack: [...state.dstack], ...extra });
  }
  // sheet: min (handle + title) <-> peek (the card or the figures) <-> open (the lists);
  // dragged freely with the finger, it settles on the nearest (or the next one, flicked)
  /** A plan's compact card (planner.js .kpi.cx): two heights only, folded (small profile) and up (tall one). */
  function compactPlan() { return !!C.$("sheet").dataset.tip && !!C.$("tip").querySelector(".plan .kpi.cx"); }
  function sheet(to) {
    const sh = C.$("sheet");
    if ((to === "open" || to === "mid") && compactPlan()) to = "peek";
    if (to === "hidden" && state.planKeep()) to = "min"; // planning: never lost
    if (document.documentElement.classList.contains("wide") && to !== "hidden") to = "open"; // (a PC: the card in the panel, whole)
    if (to === "min" && sh.dataset.tip) C.$("tip").scrollTop = 0; // folded: its top part (a card scrolled down measured nothing: the sheet went down to the handle)
    sh.dataset.state = to;
    C.$("grab").setAttribute("aria-label", to === "open" ? "Zwiń" : "Rozwiń");
    if (to !== "open") C.placeToast();
    else C.fillGoals();
    if (to !== lastSheet) { lastSheet = to; C.haptic.tick(); }
  }
  // Android app drawn edge to edge, but no bottom inset reported: the navigation
  // bar would cover the sheet - keep a typical button bar's height free.
  function navFallback() {
    if (!isNative()) return;
    const probe = document.createElement("div");
    probe.style.cssText = "position:fixed;visibility:hidden;padding-bottom:var(--safe-b)";
    document.body.append(probe);
    const b = parseFloat(getComputedStyle(probe).paddingBottom) || 0;
    probe.remove();
    const full = innerHeight >= screen.height - 4;
    note(`wcięcia: dół ${b}px, okno ${innerWidth}x${innerHeight}, ekran ${screen.width}x${screen.height}`);
    if (!b && full) document.documentElement.style.setProperty("--nav-fallback", "48px");
  }
  /** The phone's back button: close what is open, step back through cards, else leave. */
  function onBack() {
    if (!C.$("sos").hidden) { C.$("sos").hidden = true; return true; }
    if (!C.$("booklet").hidden) { C.closeBooklet(); return true; }
    if (!C.$("year").hidden) { C.closeYear(); return true; }
    if (!C.$("walked").hidden) { C.$("walked").hidden = true; return true; }
    if (!C.$("results").hidden || document.activeElement === C.$("q")) { C.closeSearch(); return true; }
    if (!C.$("modes").hidden) { C.layers(false); return true; }
    if (C.drawerOpen()) { C.drawerBack(); return true; }
    // the sheet folded right down (only its handle left): Back brings it up again
    if (C.$("sheet").dataset.state === "hidden") { sheet(state.planWalk() ? "min" : "peek"); return true; }
    // planning: Back takes the last move back (as the planner's help says); with nothing left to take back
    // the plan closes, with "Cofnij" for a few seconds
    if (state.cur?.key === "plan" && C.planner.canUndo()) { C.planner.undo(); C.haptic.tick?.(); return true; }
    if (state.cur?.key === "plan" && C.planner.draft()?.pts.length) {
      const d = C.planner.draft(); if (state.navStack.length) goBack(); else hideTip(); // (the card under it again: proposals, a place)
      C.undoToast("Zamknięto planowanie", () => C.planner.openSaved(d), 5000);
      return true;
    }
    if (state.navStack.length) { goBack(); return true; }
    // walking a route: Back with nothing left brings its card (from its card: the app goes, the route stays)
    if (C.planner.drafting() && !C.$("tip").hidden) { hideTip(); return true; } // a plan beside the active route: closed, the route is back
    if (C.planner.isActive()) { if (C.planner.isShown()) return false; C.planner.show(); return true; }
    if (!C.$("tip").hidden) { hideTip(); return true; }
    if (C.$("sheet").dataset.state === "open") { sheet("peek"); return true; }
    return false;
  }
  // dragging the sheet
  // drag the sheet by any part of it: the handle, the figures, the card, the tabs, and the
  // lists too (a list at its top dragged down folds the sheet; a short card never scrolls).
  // A tap stays a tap (the drag starts after 8 px of vertical movement).
  {
    const sh = C.$("sheet"), grab = C.$("grab");
    let drag = null, start = null, touch = null, justDragged = false;
    // where the sheet rests in each state, as its translateY (0 = all of it up)
    const restings = () => {
      const full = sh.offsetHeight, safe = Math.max(0, parseFloat(getComputedStyle(sh).paddingBottom) - 10);
      const mid = midHeight();
      // planning: the card never goes away (its figures and buttons are the plan), at the least folded
      const keep = state.planKeep();
      const cp = compactPlan(), pk = Math.max(0, full - peekHeight() - safe);
      return { open: cp ? pk : 0, peek: Math.max(0, full - peekHeight() - safe), mid: mid == null || cp ? null : Math.max(0, full - mid - safe), min: Math.max(0, full - minHeight() - safe), hidden: keep ? null : Math.max(0, full - hiddenHeight() - safe), full, safe };
    };
    const ty = () => new DOMMatrix(getComputedStyle(sh).transform).m42;
    // a plan's profile grows with the card under the finger (folded: small, up: tall); the card's top
    // stays under the finger while it grows (the sheet is anchored at the bottom)
    const G0 = 100, G1 = 170; // the profile's box folded / tall (style.css .gprof)
    const begin = (y) => {
      const gp = sh.dataset.tip ? C.$("tip").querySelector(".plan .gprof") : null, big = !!gp?.closest(".plan.big");
      drag = { base: ty(), stops: restings(), y0: y, trail: [[performance.now(), y]], gp, gr: gp && C.$("tip").querySelector(".plan .gread"), p0: big ? 1 : 0, raw: ty() };
      if (gp) drag.span = Math.max(60, drag.stops.min - drag.stops.peek);
      sh.classList.add("dragging"); document.documentElement.classList.add("sdrag");
    };
    const growTo = (d, y) => {
      const p = Math.max(0, Math.min(1, d.p0 - (y - d.y0) / d.span));
      d.gp.style.height = `${G0 + p * (G1 - G0)}px`;
      if (d.gr) Object.assign(d.gr.style, { maxHeight: `${24 * p}px`, opacity: p, margin: `${-6 + 6 * p}px 2px ${2 * p}px` });
      return sh.offsetHeight - d.stops.full; // what the sheet grew by (often nothing: the card is cut at its height)
    };
    const move = (y) => {
      const d = drag;
      d.trail.push([performance.now(), y]); if (d.trail.length > 6) d.trail.shift();
      // follows the finger; past the bottom it gives way only a little
      let t = d.base + y - d.y0;
      const low = d.stops.hidden ?? d.stops.min;
      if (t > low) t = low + (t - low) * 0.25;
      t = Math.max(0, t);
      d.raw = t;
      if (d.gp) t += growTo(d, y);
      sh.style.transform = `translateY(${t}px)`;
      // the buttons over the map ride along until the card's height (above it the lists cover them)
      setStrip(d.stops.full - Math.max(t, d.stops.peek) - d.stops.safe);
    };
    const finish = () => {
      const d = drag, t = d.raw, a = d.trail[0], b = d.trail[d.trail.length - 1], v = (b[1] - a[1]) / Math.max(1, b[0] - a[0]); // px/ms, + = down
      drag = null;
      const order = ["open", "peek", "mid", "min", "hidden"].map((k) => [k, d.stops[k]]).filter(([, y]) => y != null); // mid: a plan's figures + profile
      let to;
      if (Math.abs(v) > 0.35) to = v < 0 ? [...order].reverse().find(([, y]) => y < t - 4) || order[0] : order.find(([, y]) => y > t + 4) || order[order.length - 1];
      else to = order.reduce((best, o) => (Math.abs(o[1] - t) < Math.abs(best[1] - t) ? o : best));
      sh.classList.remove("dragging"); document.documentElement.classList.remove("sdrag"); sh.style.transform = "";
      if (d.gp) { d.gp.style.height = ""; if (d.gr) Object.assign(d.gr.style, { maxHeight: "", opacity: "", margin: "" }); } // the state's size, animated from here
      sheet(to[0]);
      justDragged = true; setTimeout(() => (justDragged = false), 50);
    };
    const noDrag = "input, textarea, .prof canvas, .oscroll";
    // mouse, and fingers on the parts that do not scroll
    sh.addEventListener("pointerdown", (e) => {
      if (e.target.closest(noDrag) || e.target.closest(".panes") || (e.pointerType === "touch" && e.target.closest(".tip"))) return;
      start = { x: e.clientX, y: e.clientY, id: e.pointerId };
    });
    // on the window: a finger leaving the sheet before the drag starts (folded, it is a thin strip) still drags it
    addEventListener("pointermove", (e) => {
      if (!start || e.pointerId !== start.id) return;
      if (!drag) {
        const dy = e.clientY - start.y;
        if (Math.abs(dy) < 8 || Math.abs(dy) < Math.abs(e.clientX - start.x)) return;
        sh.setPointerCapture(start.id); begin(e.clientY);
      }
      move(e.clientY);
    });
    const up = (e) => { if (!start || e.pointerId !== start.id) return; start = null; if (drag) finish(); };
    addEventListener("pointerup", up); addEventListener("pointercancel", up);
    // fingers on what can scroll (the card, the lists): the sheet moves unless the content should scroll
    sh.addEventListener("touchstart", (e) => {
      const el = e.target.closest(".tip, .panes");
      touch = el && !e.target.closest(noDrag) && e.touches.length === 1 ? { el, x: e.touches[0].clientX, y: e.touches[0].clientY, on: false } : null;
    }, { passive: true });
    sh.addEventListener("touchmove", (e) => {
      if (!touch) return;
      const q = e.touches[0], dy = q.clientY - touch.y;
      if (!touch.on) {
        if (Math.abs(dy) < 8 && Math.abs(q.clientX - touch.x) < 8) return;
        const el = touch.el, scrolls = el.scrollHeight > el.clientHeight + 1;
        const take = Math.abs(dy) >= Math.abs(q.clientX - touch.x) && e.cancelable && (!(sh.dataset.state === "open" || (sh.dataset.state === "peek" && compactPlan())) || !scrolls || (dy > 0 && el.scrollTop <= 0));
        if (!take) { touch = null; return; }
        touch.on = true; begin(q.clientY);
      }
      e.preventDefault();
      move(q.clientY);
    }, { passive: false });
    const tend = () => { if (touch?.on && drag) finish(); touch = null; };
    sh.addEventListener("touchend", tend); sh.addEventListener("touchcancel", tend);
    // the click that ends a drag is not a tap
    sh.addEventListener("click", (e) => { if (justDragged) { e.stopPropagation(); e.preventDefault(); } }, true);
    const next = () => (compactPlan() ? (sh.dataset.state === "peek" ? "min" : "peek") : sh.dataset.state === "min" && midHeight() != null ? "mid" : ({ hidden: "peek", min: "peek", mid: "peek", peek: sh.dataset.tip || C.$("peek").querySelector(".glist .qa + .qa") ? "open" : "min", open: "peek" })[sh.dataset.state] || "peek");
    grab.addEventListener("click", () => sheet(next()));
    grab.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); sheet(next()); } });
  }

  return { fromList, goBack, hiddenHeight, hideTip, midHeight, minHeight, navFallback, onBack, openTip, peekHeight, setStrip, sheet, viewNow };
}
