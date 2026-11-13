// the side panel (menu): its pages (outings, places, ranges, plans, settings), Back within it, a swipe closes it
// (moved out of app.js: what it needs of the app comes in C, see createX in app.js)
import { state } from "./state.js";

export function createDrawer(C) {
  let dpage = null;
  // Its home is the menu; a page opened from it goes back to it, one opened straight (the
  // progress ring, Back from a card) closes on Back.
  const DPAGES = { progress: "Postęp", outings: "Wyjścia", journal: "Miejsca", ranges: "Pasma", legendp: "Legenda mapy", mapsp: "Mapy w telefonie", setp: "Ustawienia", plansp: "Plany", friendsp: "Znajomi", kontop: "Konto" };
  /** drawer(false): closed; drawer(null): its menu; drawer("outings"): that page. keep: the page as it was left (its scroll);
   * push: Back returns to the page shown now (else Back closes the panel); back: going back (the stack as it is). */
  function drawer(page, { keep = false, push = false, back = false } = {}) {
    const el = C.$("drawer");
    if (page === false && wideQ.matches) page = null; // (a PC: the panel stays, closing it goes back to its menu)
    if (page === false) {
      if (el.hidden || el.classList.contains("out")) return;
      el.classList.remove("on"); el.classList.add("out"); C.$("menubtn").setAttribute("aria-expanded", "false");
      clearTimeout(drawer.t); drawer.t = setTimeout(() => { el.hidden = true; el.classList.remove("out"); }, 240);
      return;
    }
    clearTimeout(drawer.t); el.classList.remove("out");
    const wasOpen = !el.hidden && el.classList.contains("on");
    if (el.hidden) { el.hidden = false; C.layers(false); C.closeSearch(false); el.getBoundingClientRect(); }
    if (!wasOpen && !back) state.dstack = [];
    el.classList.add("on"); C.$("menubtn").setAttribute("aria-expanded", "true");
    if (!back) { if (push && wasOpen && page !== dpage) state.dstack.push(dpage); else if (!push) state.dstack = []; }
    dpage = page;
    C.$("dhome").hidden = !!page;
    for (const id of Object.keys(DPAGES)) C.$(id).hidden = id !== page;
    C.$("dtitle").textContent = page ? DPAGES[page] : C.view.meta?.label ? `Zdrapka · ${C.view.meta.label}` : "Zdrapka górska";
    C.$("dback").hidden = !page && !state.dstack.length;
    if (page === "progress") C.fillGoals();
    if (page === "mapsp") C.renderMapsPage();
    if (page === "setp") C.renderSettings();
    if (page === "plansp") C.planner.renderPlans();
    if (page === "friendsp") { C.renderFriendsPage(); C.friendsSync(true); }
    if (page === "kontop") C.renderAccount();
    if (!keep) el.querySelector(".dbody").scrollTop = 0;
  }
  // a wide screen (a PC): the menu is a panel always on the left, the map beside it, a card over the panel
  const wideQ = matchMedia("(min-width: 1100px)");
  function applyWide() {
    document.documentElement.classList.toggle("wide", wideQ.matches);
    if (wideQ.matches) drawer(dpage, { keep: true }); else { const el = C.$("drawer"); el.hidden = true; el.classList.remove("on", "out"); }
    try { C.view.resize(); } catch { /* not up yet */ }
  }
  wideQ.addEventListener("change", applyWide);
  // in a browser (not the app): where to get the app
  if (!globalThis.Capacitor?.isNativePlatform?.() && !globalThis.androidBridge) Object.assign(C.$("apkrow"), { hidden: false, href: "../pobierz/" });
  setTimeout(applyWide, 0);
  function drawerOpen() { return !C.$("drawer").hidden && !C.$("drawer").classList.contains("out") && !(wideQ.matches && !dpage && !state.dstack.length); }
  C.$("menubtn").onclick = () => (drawerOpen() ? drawer(false) : drawer(null));
  C.$("dx").onclick = () => drawer(false);
  function drawerBack() {
    if (dpage === "progress" && state.openBadge) { state.openBadge = null; C.renderCard(); return; } // a badge's page: back to Progress
    if (state.dstack.length) drawer(state.dstack.pop(), { keep: true, back: true }); else drawer(false);
  }
  C.$("dback").onclick = drawerBack;
  C.$("drawer").querySelector(".dscrim").onclick = () => drawer(false);
  C.$("dhome").addEventListener("click", (e) => { const p = e.target.closest("[data-p]")?.dataset.p; if (p) drawer(p, { push: true }); });
  // a swipe to the left closes it
  {
    const pn = C.$("drawer").querySelector(".dpanel");
    let t0 = null;
    pn.addEventListener("touchstart", (e) => { t0 = e.touches.length === 1 ? { x: e.touches[0].clientX, y: e.touches[0].clientY, dx: 0 } : null; }, { passive: true });
    pn.addEventListener("touchmove", (e) => {
      if (!t0) return;
      const dx = e.touches[0].clientX - t0.x, dy = e.touches[0].clientY - t0.y;
      if (!t0.on && (Math.abs(dy) > 12 || dx > 8)) { t0 = null; pn.style.transform = ""; return; }
      if (dx < -10) { t0.on = true; t0.dx = dx; pn.style.transition = "none"; pn.style.transform = `translateX(${Math.min(0, dx + 10)}px)`; }
    }, { passive: true });
    const end = () => { if (t0?.on) { pn.style.transition = ""; pn.style.transform = ""; if (t0.dx < -70) drawer(false); } t0 = null; };
    pn.addEventListener("touchend", end); pn.addEventListener("touchcancel", end);
  }
  return { drawer, drawerBack, drawerOpen };
}
