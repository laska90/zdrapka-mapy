// Route planning on the map: tap to add points (start A, stops 1, 2, ..., finish B), drag a
// point on the map to move it, drag a row's handle to change the order, X to leave. The route
// follows the network (the worker's router), with a mode and options; the card shows the
// distance, climb, time (your own pace when known), what is new to scratch, the profile.
// Plans can be saved on the device and sent to the watch as GPX.
//
// The active route ("Idę tą trasą"): the plan you walk. It stays on the map while you look at other
// places (the pill over the card says how long to the finish and brings its card back, as do Back
// with nothing left to go back to and a long press on the position button); a lock keeps the map's
// taps off it; it ends with X on the pill or "Zakończ" (Cofnij for a moment), or by itself at the finish.

import { BADGE_NAME, glyphURL, medalURL } from "./glyphs.js";
import { kpiHtml, kpiRow } from "./kpi.js";
import { groundKey, mountGrow } from "./growprof.js";
import { forecast, sunTimes, wxAlert, wxIcon, wxWord } from "./trip.js";
import { gotOf, noticesFor, whenPl } from "../core/notices.js";
import { GBINS, gbin, stdMs } from "../core/pace.js";

const PLANS = "zdrapka.plans";
const ACTIVE = "zdrapka.active";
const LAST = "zdrapka.lastRoute";
const LASTON = "zdrapka.lastOn"; // (where you were on the route last ended: for starting it again)
const esc = (t) => String(t ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

import { shortName } from "./labels.js";
import { distText } from "../core/hud.js";
import { personalTime } from "../core/pace.js";
import { isNative, native } from "./native.js";
import { pickPass } from "../core/onroute.js";

export function createPlanner(C) {
  // C: {$, view, call, openTip, hideTip, sheet, toast, nf, hm, plural, shortName, NAMES, mountProfile, routeScore,
  //     settings, saveSettings, found(), paceNorm(), personalTime(), flyView, fitAbove, shareBlob, unproject, haptic}
  let plan = null, route = null, seq = 0, timer = 0, undo = [], lockOpen = 0; // lockOpen: until when the lock is open (a second tap ends the route)
  // the active route: {name, id, locked, maxIdx, t}; shown: the plan's card is up (else only on the map)
  let act = null, shown = false, ended = null;
  // bg: the active route kept aside while another plan is open ({plan, route, act, meIdx}); it comes back when that plan closes
  let bg = null;
  /** Remember the points before a change (the undo button steps back). */
  let pendingAdd = null; // the point just added (a route that cannot reach it: the point goes back out)
  const keep = () => { undo.push(plan.pts.map((q) => ({ ...q }))); if (undo.length > 40) undo.shift(); };
  // one way of leading (the recommended); a leg may go another way (its end point's via: faster, new trails, gentler)
  const BASE = { mode: "zalecana", steep: false, roads: false, fresh: false };
  const opts = () => ({ ...BASE, legs: plan ? plan.pts.slice(1).map((q) => q.via || null) : [] });
  const word = (i, n) => (i === 0 ? "Start" : i === n - 1 && n > 1 ? "Meta" : `Punkt ${i}`);
  const badge = (i, n) => (plan?.toward ? `<svg><use href="#i-finish"/></svg>` : i === 0 ? `<svg><use href="#i-start"/></svg>` : i === n - 1 && n > 1 ? `<svg><use href="#i-finish"/></svg>` : String(i));

  /** A new plan while you walk one: the active route waits aside (still on the map, still counted),
   * and comes back when the new plan closes; only "Rozpocznij" on the new one replaces it. */
  const free = () => {
    if (!act) { if (plan && !bg) close(); return true; }
    if (!plan) return true;
    prof?.stop?.(); prof = null; figKeep = null;
    bg = { plan, route, act, meIdx };
    act = null; plan = null; route = null; meIdx = null;
    C.onBg?.(bg.route?.line || null);
    return true;
  };
  function open(start = null) {
    if (!free()) return;
    shown = true;
    plan = { id: null, name: null, pts: start ? [start] : [] };
    route = null; undo = []; Object.assign(ui, { edit: false, opts: false, more: false });
    if (start && !start.n) nameIt(start);
    C.view.setHighlight(null); C.view.setPlanning?.(true);
    render();
    C.sheet(plan.pts.length >= 2 ? "min" : "peek"); // planning: the map first (the hint while there is no route yet)
    if (plan.pts.length) recompute();
  }
  /** Planning to a place: from my position, or (without one) the next long press sets the start. */
  function openTo(dest, from = null) {
    if (!free()) return;
    open(from);
    if (from) add(dest);
    else { plan.pts = [dest]; plan.toward = true; if (!dest.n) nameIt(dest); render(); drawMarkers(); }
  }
  function openSaved(p, go = false) { if (act && act.id === p.id) { show(); return; } if (bg && bg.act.id === p.id) { close(); show(); return; } if (!free()) return; shown = true; C.view.setPlanning?.(true); undo = []; Object.assign(ui, { edit: false, opts: false, more: false }); plan = { id: p.id, name: p.name, auto: p.auto, pace: p.pace || null, pts: p.pts.map((q) => ({ ...q })) }; route = null; render(); C.sheet("min"); recompute(true); if (go) startWhenRouted = true; }
  let startWhenRouted = false;
  /** A plan from a link: a new one (not in Moje plany until saved), its points named by the map. */
  function openShared(p) { openSaved({ id: null, name: p.name || null, auto: !p.name, pace: p.pace || null, pts: p.pts }); for (const q of plan?.pts || []) if (!q.n) nameIt(q); }
  /** The plan as a link to send (the maps site's page opens it in the app). */
  async function sharePlan() {
    if (!plan || plan.pts.length < 2) return;
    const { planLink } = await import("../core/planlink.js");
    // the trip's pace goes with it (kept on the plan too: your card shows the time your friends see)
    if (!plan.pace) { const g = C.groupCurve?.(); if (g) { plan.pace = g; if (plan.id) saveQuiet(); render(); } }
    const name = plan.name || defaultName(), url = planLink({ name, pts: plan.pts.map((q) => C.unproject(q.x, q.y)), pace: plan.pace });
    const text = `${name}${route ? ` · ${C.nf(route.km)} km · ↑${Math.round(route.up)} m` : ""}`;
    try {
      const n = isNative() ? await native() : null;
      if (n?.Share) { await n.Share.share({ title: name, text, url, dialogTitle: "Wyślij plan" }); return; }
      if (navigator.share) { await navigator.share({ title: name, text, url }); return; }
      await navigator.clipboard.writeText(`${text}\n${url}`); C.toast("Link skopiowany", 2500);
    } catch (e) { if (e?.name !== "AbortError" && !/cancel/i.test(String(e?.message))) C.toast("Nie udało się wysłać: " + (e?.message || e), 5000); }
  }
  /** An outing added by hand, its points to change: o {id, name, pts, start, ms}; "Zapisz wyjście" replaces it. */
  function openOuting(o) {
    if (!free()) return;
    shown = true; C.view.setPlanning?.(true); undo = []; Object.assign(ui, { edit: false, opts: false, more: false, help: false });
    plan = { id: null, name: o.name || null, pts: o.pts.map((q) => ({ ...q })), outing: o };
    route = null; render(); C.sheet("min"); recompute(true);
    for (const q of plan.pts) if (!q.n) nameIt(q);
  }
  function close() {
    closeMenu(); prof?.stop?.(); prof = null;
    if (!plan) return;
    C.view.setPlanning?.(false); plan = null; route = null; live = null; bridge = null; clearTimeout(timer); C.view.setPlan(null);
    if (bg && !act) { // the plan opened beside the active route closed: the active one is back
      ({ plan, route, act, meIdx } = bg); bg = null; shown = false; C.onBg?.(null);
      drawMarkers(); C.onActive?.();
    }
  }
  const active = () => !!plan;
  /** The map's taps change the plan (not while you walk it locked). */
  const editable = () => !!plan && !(act && act.locked);

  // ---- the active route
  const storeActive = () => {
    const A = act && plan ? { a: act, p: plan } : bg ? { a: bg.act, p: bg.plan } : null;
    try { if (A) localStorage.setItem(ACTIVE, JSON.stringify({ ...A.a, pts: A.p.pts.map(({ x, y, n, near }) => ({ x, y, n, near })), pace: A.p.pace || undefined, opts: opts() })); else localStorage.removeItem(ACTIVE); } catch { /* full */ }
  };
  function start() {
    if (!plan || !route) return;
    if (bg) { // another route is active: this one takes its place (it stays in Moje plany)
      if (!confirm(`Zamienić aktywną trasę „${bg.act.name}” na tę?`)) return;
      remember(bg.act); bg = null; C.onBg?.(null);
    }
    if (!plan.id) saveQuiet(); // an active route is never only in memory: it is in Moje plany from the start
    act = { name: plan.name || defaultName(), auto: !plan.name || !!plan.auto, id: plan.id, locked: true, maxIdx: meIdx ?? 0, t: Date.now() };
    // the same route ended within 12 h: where you were on it (a loop or a figure of eight: which pass you are on)
    try { const L = JSON.parse(localStorage.getItem(LASTON) || "null"); if (L && L.id === act.id && route?.P?.d.length === L.n && Date.now() - L.at.t < 12 * 3600_000) { act.at = L.at; act.maxIdx = Math.max(act.maxIdx, L.maxIdx); meIdx = me ? pickPass(route.P, me, passCtx(act)) : meIdx; } } catch { /* none */ }
    undo = []; // (Back while changing the route later: only those changes, not the planning's)
    storeActive(); C.haptic.tick();
    C.view.setPlanning?.(false);
    C.gpsOn?.(); // where you are on it, from the first step
    C.prefetchTrains?.(); // (home by train without signal later)
    render(); C.$("tip").scrollTop = 0; C.sheet("min"); C.onActive?.();
    wx = null; setTimeout(() => routeWx(false), 1500); // (the route's figures first)
  }
  /** The last route walked (Moje plany shows it first, with Wznów). */
  const remember = (a) => { try { localStorage.setItem(LAST, JSON.stringify({ id: a.id, name: a.name, t: Date.now() })); } catch { /* full */ } };
  /** End the active route: Cofnij brings it back for a few seconds (not after quiet: ended for a new plan). */
  function end({ auto = false, quiet = false } = {}) {
    if (!act) return;
    ended = quiet ? null : { plan, route, act };
    remember(act);
    // where you were on it: a route started again soon (the same plan, the same route) picks up from there
    try { if (act.id && act.at && route?.P) localStorage.setItem(LASTON, JSON.stringify({ id: act.id, n: route.P.d.length, at: act.at, maxIdx: act.maxIdx || 0 })); } catch { /* full */ }
    act = null; storeActive();
    if (shown) C.hideTip(); else close(); // (the card's close ends the plan now)
    close();
    C.onActive?.(quiet ? null : { auto });
    clearTimeout(end.t);
    if (ended) end.t = setTimeout(() => { ended = null; C.onActive?.(); }, 6000);
  }
  function undoEnd() {
    if (!ended) return;
    clearTimeout(end.t);
    ({ plan, route, act } = ended); ended = null; shown = false;
    storeActive(); drawMarkers(); C.onActive?.();
    show({ quiet: true }); // (its card is the default while walking)
  }
  /** The card of the active route again (the pill, Back, a long press on the position button). */
  function show({ quiet = false } = {}) {
    if (bg && !act) { C.toast("Najpierw zamknij planowanie", 3000); return true; }
    if (!plan || !act) return false;
    shown = true; C.view.setPlanning?.(!act.locked);
    render(); C.$("tip").scrollTop = 0; C.sheet("min");
    if (!quiet) { // you and the way ahead when you are out there by it; far from it (at home): the route itself
      const P = route?.P;
      let near = false;
      if (P && me) for (let i = 0; i < P.d.length && !near; i += 4) near = Math.hypot(P.x[i] - me.x, P.y[i] - me.y) < 2000;
      if (near || !P) C.centerMe?.();
      else { let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity; for (let i = 0; i < P.d.length; i++) { x0 = Math.min(x0, P.x[i]); y0 = Math.min(y0, P.y[i]); x1 = Math.max(x1, P.x[i]); y1 = Math.max(y1, P.y[i]); } C.stopFollow?.(); C.flyView(() => C.fitAbove(x0, y0, x1, y1)); }
    }
    return true;
  }
  /** The plan's card went (another card over it is not that): the active route stays on the map. */
  function away() { if (ui.park) closeParks(); shown = false; closeMenu(); prof?.stop?.(); prof = null; C.view.setPlanning?.(false); C.onActive?.(); }
  /** The active route after a restart: on the map, its card not up. */
  function resume() {
    let r = null;
    try { r = JSON.parse(localStorage.getItem(ACTIVE) || "null"); } catch { /* none */ }
    if (!r?.pts?.length || plan) return;
    plan = { id: r.id, name: r.auto ? "" : r.name, pts: r.pts, pace: r.pace || null, folded: true };
    act = { name: r.name, auto: !!r.auto, id: r.id, locked: r.locked !== false, maxIdx: r.maxIdx || 0, at: r.at || null, t: r.t };
    shown = false; route = null; recompute();
    C.gpsOn?.(); // walking it: where you are, again
    setTimeout(() => { if (act && !shown && C.$("tip").hidden) show({ quiet: true }); }, 0); // (its card: the default while walking)
  }
  /** For the pill: {name, ms (to the finish, from you when you are on the route), off, locked}, or the end's undo. */
  function pill() {
    if (ended) return { ended: true };
    if (plan && !act && shown) { // planning: the whole route
      if (!route) return null;
      const t = timeOf(route.km, route.up, route.down, route.std, route.bins);
      return { plan: true, ms: t.ms, km: route.km, up: route.up, down: route.down };
    }
    const A = act && plan ? { act, route, meIdx } : bg ? bg : null;
    if (!A) return null;
    const R = A.route, P = R?.P, last = P ? P.d.length - 1 : 0;
    let v = null;
    if (R) v = P && A.meIdx != null ? wayOf(R, A.meIdx, last) : { ...timeOf(R.km, R.up, R.down, R.std, R.bins), km: R.km, up: R.up, down: R.down };
    const W = wx && wx.alert && act ? wx.pts[wx.alert.i] : null;
    const warn = W && W.at > Date.now() - 30 * 60000 ? { kind: wx.alert.kind, at: W.at, name: W.name } : null;
    return { name: A.act.name, ms: v?.ms ?? null, km: v?.km, up: v?.up, down: v?.down, off: !!me && P && A.meIdx == null, locked: A.act.locked, shown: shown || !!bg, wx: warn };
  }
  /** A place on the active route ahead of you: the way there along the route {ms, km, up, down}, else null. */
  function along(x, y) {
    const A = act && plan ? { route, meIdx, act } : bg;
    const P = A?.route?.P;
    if (!P) return null;
    let bi = -1, bd = Infinity;
    for (let i = 0; i < P.d.length; i++) { const d = Math.hypot(P.x[i] - x, P.y[i] - y); if (d < bd) { bd = d; bi = i; } }
    const from = A.meIdx ?? A.act?.maxIdx ?? act?.maxIdx ?? 0;
    if (bd > 150 || bi <= from) return null;
    return wayOf(A.route, from, bi);
  }
  /** A place's card while walking (on the route ahead, or off it within 3 km of what is ahead): the way there
   * along the route {route, i0 (you), i1 (the place, or where you leave the route), side (the way from there:
   * a route), way: {ms, km, up, down} all of it}, else null. */
  async function toward(x, y) {
    const A = act && plan ? { route, meIdx, act } : bg;
    const R = A?.route, P = R?.P;
    if (!P) return null;
    const from = A.meIdx ?? A.act?.maxIdx ?? 0, last = P.d.length - 1;
    let bi = -1, bd = Infinity;
    for (let i = from + 1; i <= last; i++) { const d = Math.hypot(P.x[i] - x, P.y[i] - y); if (d < bd) { bd = d; bi = i; } }
    if (bi < 0) return null;
    const me = A.meIdx != null;
    if (bd <= 150) return { route: R, i0: from, i1: bi, side: null, me, way: wayOf(R, from, bi) };
    if (bd > 3000) return null;
    const s = await C.call("route", { pts: [[P.x[bi], P.y[bi]], [x, y]], opts: opts() }).then((q) => q.route).catch(() => null);
    if (!s?.P || !s.km || s.km > 3) return null; /* near in a line, far by trails: not "beside the route" */
    const on = wayOf(R, from, bi), t = timeOf(s.km, s.up, s.down, s.std, s.bins).ms;
    return { route: R, i0: from, i1: bi, side: s, me, atKm: P.d[bi] / 1000, way: { ms: on.ms + t, km: on.km + s.km, up: on.up + s.up, down: on.down + s.down } };
  }
  /** The route's profile up to sample k, then another (the way from there) after it, on the route's step. */
  function joinProfile(P, k, S) {
    const st = P.step, d0 = P.d[k], SD = S.d[S.d.length - 1] || 0, m = Math.max(1, Math.round(SD / st));
    const d = [], h = [], x = [], y = [], slope = [];
    for (let i = 0; i <= k; i++) { d.push(P.d[i]); h.push(P.h[i]); x.push(P.x[i]); y.push(P.y[i]); slope.push(P.slope[i]); }
    let j = 0;
    for (let q = 1; q <= m; q++) {
      const at = (q / m) * SD;
      while (j < S.d.length - 2 && S.d[j + 1] < at) j++;
      const a = S.d[j], b = S.d[j + 1] ?? a, t = b > a ? Math.min(1, Math.max(0, (at - a) / (b - a))) : 0, mix = (A) => A[j] + ((A[j + 1] ?? A[j]) - A[j]) * t;
      d.push(d0 + q * st); h.push(mix(S.h)); x.push(mix(S.x)); y.push(mix(S.y)); slope.push(mix(S.slope));
    }
    return { d, h, x, y, slope, step: st };
  }
  /** Is a place on the route ahead or within 3 km of it (toward gives the way there)? */
  function nearAhead(x, y) {
    const A = act && plan ? { route, meIdx, act } : bg, P = A?.route?.P;
    if (!P) return false;
    for (let i = (A.meIdx ?? A.act?.maxIdx ?? 0) + 1; i < P.d.length; i++) if (Math.hypot(P.x[i] - x, P.y[i] - y) <= 3000) return true;
    return false;
  }
  /** The map's cursor for a finger on a profile (i), or two (i..j: the stretch between them, a dot at each end). */
  const cursorOf = (P, i, j) => { if (i == null) return null; if (j == null) return [P.x[i], P.y[i]]; const line = []; for (let k = i; k <= j; k++) line.push(P.x[k], P.y[k]); return { a: [P.x[i], P.y[i]], b: [P.x[j], P.y[j]], line }; };
  /** Its profile into a place's card (the route's own, the way to the place lit). */
  /** A way's profile in a card's figures box (a place's card: the way from you there), with its figures under the finger. */
  function mountWay(box, r, onWay = null) {
    if (!r?.P) return null;
    const found = C.found?.() || {}, SIGN = ["peak", "hut", "shelter", "tower", "viewpoint"];
    const marks = (r.places || []).filter((p) => SIGN.includes(p.c)).map((p) => ({ i: Math.max(0, Math.min(r.P.d.length - 1, Math.round(p.d / r.P.step))), n: shortName(p.n), c: p.c, key: p.c, d: !!found[p.id] }));
    return mountGrow(box, r.P, { marks, rides: rides(r), onMark: () => C.haptic.tick(), onCursor: (i, j) => C.view.setCursor(cursorOf(r.P, i, j)), way: (a, b) => wayOf(r, a, b), onWay, full: true });
  }
  function mountToward(box, f, onWay = null) {
    const r = f.route, found = C.found?.() || {}, SIGN = ["peak", "hut", "shelter", "tower", "viewpoint"];
    const marks = (r.places || []).filter((p) => SIGN.includes(p.c)).map((p) => { const md = p.c === "peak" ? C.medalsAt?.(p.x, p.y) : null; return { i: Math.max(0, Math.min(r.P.d.length - 1, Math.round(p.d / r.P.step))), n: shortName(p.n), c: p.c, key: md?.k ? `peak-${md.k}` : p.c, d: !!found[p.id] }; });
    // off the route: one profile on one scale, the route up to where you leave it and the way there after it
    // (on the route's scale the way there was squeezed: past the finish a cliff, mid-route over the route's rest)
    const S = f.side?.P, P = S ? joinProfile(r.P, f.i1, S) : r.P, cut = S ? f.i1 : null;
    const h = mountGrow(box, P, { marks: S ? marks.filter((m) => m.i <= cut) : marks, rides: rides(r).filter((q) => !S || q.d1 <= r.P.d[cut]),
      focus: { i0: f.i0, i1: S ? P.d.length - 1 : f.i1, dash: cut }, onMark: () => C.haptic.tick(), onCursor: (i, j) => C.view.setCursor(cursorOf(P, i, j)),
      way: S ? null : (a, b) => wayOf(r, a, b), onWay: S ? null : onWay, full: true });
    if (f.me) h?.setMe?.(f.i0); // (you far from the route: no dot at its start)
    return h;
  }
  /** The line in the handle's place (folded card): the route's name; off the route while walking, how far
   * the route is and which way (an arrow on the screen as the map lies). */
  function grabName() {
    const g = C.$("grab");
    if (!g || !plan) return;
    let t = act ? act.name : plan.name || (route && plan.pts.length >= 2 ? defaultName() : "");
    const P = route?.P;
    if (act && me && P && meIdx == null) {
      let bd = Infinity, bi = 0;
      for (let i = 0; i < P.d.length; i++) { const d = Math.hypot(P.x[i] - me.x, P.y[i] - me.y); if (d < bd) { bd = d; bi = i; } }
      const [ax, ay] = C.view.toScreen(me.x, me.y), [bx, by] = C.view.toScreen(P.x[bi], P.y[bi]);
      const deg = ((Math.atan2(bx - ax, ay - by) * 180) / Math.PI + 360) % 360;
      t = `Poza trasą · ${distText(bd)} ${"↑↗→↘↓↙←↖"[Math.round(deg / 45) % 8]}`;
    }
    g.dataset.name = t;
  }
  /** Walking: the quickest way from where you are to the route's finish (Skróć), or to a new finish
   * (a place's "Tu meta"); Cofnij brings the route back as it was. */
  function rerouteFromMe(dest = null) {
    if (!act || !plan) return;
    const at = me || lastMe, pos = at ? { x: at.x, y: at.y, n: null } : null, fin = dest || plan.pts.at(-1);
    if (!pos) { C.toast("Najpierw włącz GPS: liczę od Twojej pozycji", 3000); return; }
    const before = plan.pts.map((q) => ({ ...q }));
    if (!nearRoute()) { C.toast("Jesteś daleko od trasy", 3000); return; }
    const P = route?.P, left = !dest && P && meIdx != null ? wayOf(route, meIdx, P.d.length - 1).ms : null;
    plan.pts = [pos, { ...fin, via: null }]; nameIt(pos);
    if (dest && !dest.spot && !dest.n) nameIt(plan.pts.at(-1));
    const back = () => { plan.pts = before; drawMarkers(); render(); recompute(); storeActive(); };
    C.haptic.tick(); drawMarkers(); render(); recompute(); storeActive();
    // Skróć on the route: told once the new way is known (no shorter way: the route stays as it was, said so)
    if (dest) C.undoToast("Nowa meta", back, 10000);
    else shortCheck = { left, back };
  }
  let shortCheck = null;
  /** The shortened route is in (recompute): was it shorter at all? */
  function shortSaid() {
    const q = shortCheck;
    shortCheck = null;
    if (!q || !route?.P) return;
    const ms = wayOf(route, 0, route.P.d.length - 1).ms;
    if (q.left != null && ms >= q.left - 60000) { q.back(); C.toast("Już idziesz najkrótszą drogą do mety", 3500); return; }
    C.undoToast(q.left != null ? `Skrócona trasa · ${Math.round((q.left - ms) / 60000)} min krócej` : "Skrócona trasa", q.back, 10000);
  }
  const shorten = () => rerouteFromMe();
  /** Walking: from you to a lift's station, the ride, on to the finish (a station's "Jedź kolejką"). */
  function rideLift(a, b) {
    if (!act || !plan) return;
    const at = me || lastMe;
    if (!at) { C.toast("Najpierw włącz GPS: liczę od Twojej pozycji", 3000); return; }
    if (!nearRoute()) { C.toast("Jesteś daleko od trasy", 3000); return; }
    const before = plan.pts.map((q) => ({ ...q })), fin = plan.pts.at(-1), pos = { x: at.x, y: at.y, n: null };
    const finAtB = Math.hypot(fin.x - b.x, fin.y - b.y) < 60;
    plan.pts = finAtB ? [pos, a, b] : [pos, a, b, { ...fin, via: null }]; nameIt(pos);
    C.haptic.tick(); drawMarkers(); render(); recompute(); storeActive();
    C.undoToast("Trasa z kolejką", () => { plan.pts = before; drawMarkers(); render(); recompute(); storeActive(); }, 10000);
  }
  /** You out there by the route (within 5 km of it): Skróć and Tu meta, from you, make sense. */
  function nearRoute() {
    const P = route?.P;
    const at = me || lastMe;
    if (!act || !at || !P) return false;
    for (let i = 0; i < P.d.length; i++) if (Math.hypot(P.x[i] - at.x, P.y[i] - at.y) <= 5000) return true;
    return false;
  }
  /** "Dodaj do trasy" from a place's card: into the active route where it fits. */
  function addToActive(q) { if (!act || !plan) return; add(q, true); }

  /** A point: {x, y, n (a name, if a place)}. */
  /**
   * A point added: the route goes on to it (a loop: before its way back to the start, so a figure of eight
   * draws itself lobe by lobe; a point elsewhere in the route: dragging the line). fit: where it fits
   * (a point grabbed on the line and dragged, a place added to the route you walk: between the two points it lies between).
   * -> the index it got
   */
  function add(q, fit = false) {
    if (!plan) return -1;
    keep();
    let at = plan.pts.length;
    if (plan.toward && plan.pts.length === 1) { plan.pts.unshift(q); plan.toward = false; at = 0; } // planning to a place: the first press is the start
    else {
      const P = plan.pts, n = P.length, loop = n > 2 && Math.hypot(P[0].x - P[n - 1].x, P[0].y - P[n - 1].y) < 60;
      const j = fit || act ? legFor(q) : loop ? n - 2 : null;
      if (j != null) at = j + 1;
      plan.pts.splice(at, 0, q);
    }
    if (!q.n) nameIt(q);
    C.haptic.tick();
    pendingAdd = { at, was: route };
    drawMarkers(); render(); recompute();
    return at;
  }
  const NEAR_ROUTE = 250; // m
  /** The leg a new point belongs in (index of its first point), or null (the route goes on to it). */
  function legFor(q) {
    const P = plan.pts, n = P.length;
    if (n < 2) return null;
    const loop = Math.hypot(P[0].x - P[n - 1].x, P[0].y - P[n - 1].y) < 60;
    if (!loop && Math.hypot(P[0].x - q.x, P[0].y - q.y) < 60) return null; // back at the start: the loop closes there
    const L = route?.line, B = route?.bounds;
    if (L?.length >= 4 && B?.length === n) {
      // the nearest place on the route: how far along it (the legs' bounds are along the same line)
      let best = Infinity, along = 0, run = 0;
      for (let i = 2; i < L.length; i += 2) {
        const ax = L[i - 2], ay = L[i - 1], dx = L[i] - ax, dy = L[i + 1] - ay, l2 = dx * dx + dy * dy || 1;
        const u = Math.max(0, Math.min(1, ((q.x - ax) * dx + (q.y - ay) * dy) / l2)), d = Math.hypot(ax + u * dx - q.x, ay + u * dy - q.y), seg = Math.sqrt(l2);
        if (d < best) { best = d; along = run + u * seg; }
        run += seg;
      }
      // past the finish (nearest at the route's very end, off it): the route goes on to it
      const pastEnd = !loop && run - along < 30 && best > 40;
      if (best <= NEAR_ROUTE && !pastEnd) { const k = run > 0 ? (B[n - 1] || run) / run : 1; for (let j = 0; j < n - 1; j++) if (along * k <= B[j + 1]) return j; return n - 2; }
    }
    if (!loop) return null;
    // a loop, the point away from the route: where it adds the least (straight lines)
    let bj = 0, bc = Infinity;
    for (let j = 0; j < n - 1; j++) { const a = P[j], b = P[j + 1], c = Math.hypot(a.x - q.x, a.y - q.y) + Math.hypot(q.x - b.x, q.y - b.y) - Math.hypot(a.x - b.x, a.y - b.y); if (c < bc) { bc = c; bj = j; } }
    return bj;
  }
  function move(i, x, y) {
    bridge = live?.i === i && Object.keys(live.legs).length ? live.legs : null; live = null; // the live legs stay drawn until the route comes
    keep(); plan.pts[i] = { ...plan.pts[i], x, y, n: null, near: null, spot: null, via: null }; if (plan.pts[i + 1]) plan.pts[i + 1] = { ...plan.pts[i + 1], via: null }; nameIt(plan.pts[i]); recompute();
  }
  function remove(i) { keep(); plan.pts.splice(i, 1); if (plan.pts[i]) plan.pts[i] = { ...plan.pts[i], via: null }; render(); recompute(); }
  function reorder(from, to) { keep(); const [q] = plan.pts.splice(from, 1); plan.pts.splice(to, 0, q); plan.pts.forEach((p) => (p.via = null)); render(); recompute(); }
  function reverse() { keep(); plan.pts.reverse(); plan.pts.forEach((p) => (p.via = null)); C.haptic.tick(); render(); recompute(); }
  /** A leg (into point i) goes another way, or back to the recommended one (via null). */
  function setVia(i, via) {
    if (!plan?.pts[i]) return;
    if (via?.insert) { // "wydłuż przez": a new point between, the leg in two
      keep(); plan.pts.splice(i, 0, { x: via.insert.x, y: via.insert.y, n: via.insert.n }); C.haptic.tick(); render(); recompute(); return;
    }
    keep(); plan.pts[i] = { ...plan.pts[i], via }; C.haptic.tick(); recompute(); }
  function back() { if (!undo.length) return; plan.pts = undo.pop(); C.haptic.tick(); render(); recompute(); }
  /** A point tapped on the bare map gets the name of what is near it (a place, a hut, a peak). */
  async function nameIt(q) {
    const s = await C.spotName?.(q.x, q.y).catch(() => null);
    if (!s || q.n) return;
    q.spot = s; q.near = s.near && s.near.d <= 600 ? { n: s.near.n, d: s.near.d } : null; // (the route's default name: the places at its ends)
    if (plan?.pts.includes(q)) { autoName(); render(); }
  }
  const ptName = (q, i, n) => q.n || (q.spot ? C.spotLine(q.spot) : q.near ? `${q.near.n}${q.near.d > 120 ? ` · ${q.near.d < 1000 ? `${Math.round(q.near.d / 10) * 10} m` : `${C.nf(q.near.d / 1000)} km`} obok` : ""}` : i === 0 ? "Start" : i === n - 1 && n > 1 ? "Meta" : "Punkt");

  // the map: the route in the colours of the trails it follows, the legs' times, the points;
  // while a point is dragged, the legs at it follow the finger (live), then the full route comes
  let live = null, bridge = null;
  let doneAt = 0; // (the walked part redrawn every couple of profile samples)
  function drawMarkers({ over = bridge, at = null } = {}) {
    if (!plan) return;
    const legs = route?.legs || [], runs = [];
    legs.forEach((L, j) => runs.push(...(over?.[j] || L.runs || [])));
    const pts = plan.pts.map((q) => [q.x, q.y]);
    if (at) pts[at.i] = at.p;
    // walking it: the part behind you (to the furthest point reached) grey on the map
    const P = route?.P, k = act && P && !at ? Math.min(act.maxIdx || 0, P.d.length - 1) : 0, done = [];
    for (let i = 0; i <= k && k > 0; i++) done.push(P.x[i], P.y[i]);
    // the stretches closed on the day you go: a red band over the route (and over your traces)
    const closed = [];
    if (P && !at) for (const q of notes(route).closed) if (q.now) { const f = []; for (let i = 0; i < P.d.length; i++) if (P.d[i] >= q.d0 - P.step && P.d[i] <= q.d1 + P.step) f.push(P.x[i], P.y[i]); if (f.length >= 4) closed.push(f); }
    C.view.setPlan({ runs, pts, done, closed, drag: at ? at.i : null, live: !!at, toward: !!plan.toward });
  }
  /** A point being dragged to (x, y): the legs on both sides of it, one request at a time. */
  function drag(i, x, y) {
    if (!plan || !route || route.legs.length !== plan.pts.length - 1) return;
    if (!live || live.i !== i) live = { i, legs: {}, busy: false };
    live.want = live.cur = [x, y];
    if (!live.busy) pump(live);
  }
  async function pump(L) {
    const [x, y] = L.want; L.want = null; L.busy = true;
    const pairs = [], idx = [], P = plan.pts;
    if (L.i > 0) { pairs.push([[P[L.i - 1].x, P[L.i - 1].y], [x, y]]); idx.push(L.i - 1); }
    if (L.i < P.length - 1) { pairs.push([[x, y], [P[L.i + 1].x, P[L.i + 1].y]]); idx.push(L.i); }
    const o = opts(), r = await C.call("routeLegs", { pairs, opts: { ...o, legOpts: idx.map((j) => o.legs[j]) } }).catch(() => null);
    L.busy = false;
    if (live !== L || !plan) return;
    if (r) { idx.forEach((j, k) => (L.legs[j] = r.legs[k])); drawMarkers({ over: L.legs, at: { i: L.i, p: L.cur } }); }
    if (L.want) pump(L);
  }

  /** Ask the worker for the route (a little later, so quick changes make one request). */
  function recompute(fit = false) {
    clearTimeout(timer);
    if (ui.park) closeParks(); // (the car parks were for the route as it was)
    if (act) storeActive();
    if (!plan || plan.pts.length < 2) {
      route = null; if (plan) drawMarkers(); render();
      if (plan?.pts.length === 1) C.call("warmRoute", { x: plan.pts[0].x, y: plan.pts[0].y }).catch(() => {}); // (the first leg comes at once)
      return;
    }
    drawMarkers();
    const my = ++seq, added = pendingAdd;
    pendingAdd = null;
    timer = setTimeout(async () => {
      const r = await C.call("route", { pts: plan.pts.map((q) => [q.x, q.y]), opts: opts() }).catch((e) => { C.toast("Nie udało się wyznaczyć trasy: " + (e?.message || e), 5000); return null; });
      if (my !== seq || !plan || !r) return;
      // a point added where no way of the map goes (off the maps, in a lake…): not added, the plan as it was
      if (added && !act) {
        const L = r.route?.legs || [], bad = [added.at - 1, added.at].some((i) => L[i]?.none) || !Number.isFinite(r.route?.km);
        if (bad && undo.length) {
          plan.pts = undo.pop(); route = added.was;
          C.toast(plan.pts.length ? "Tu nie ma drogi w mapie: punkt nie został dodany" : "Tu nie ma drogi w mapie", 4500);
          render(); drawMarkers(); if (plan.pts.length < 2) route = null;
          return;
        }
      }
      const was = route;
      route = r.route; bridge = null;
      if (act && was && route.P) { // a changed active route: where you are on the new one (its samples are new: the old place on it means nothing)
        act.at = null; meIdx = null; const i = me ? pickPass(route.P, me, passCtx(act)) : null; // (the old place on it means nothing on the new samples)
        meIdx = i; act.maxIdx = i ?? 0; act.at = i != null ? { i, t: Date.now() } : null; storeActive();
      }
      if (shortCheck) shortSaid();
      autoName(); render(); drawMarkers();
      findVariants(my);
      if (!plan.folded && shown) { plan.folded = true; C.sheet("min"); }
      if (startWhenRouted) { startWhenRouted = false; start(); } // the first route: the card folds to its figures (pull up for the rest)
      if (fit && route.line.length >= 4) {
        let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
        for (let i = 0; i < route.line.length; i += 2) { x0 = Math.min(x0, route.line[i]); x1 = Math.max(x1, route.line[i]); y0 = Math.min(y0, route.line[i + 1]); y1 = Math.max(y1, route.line[i + 1]); }
        C.flyView(() => C.fitAbove(x0, y0, x1, y1));
      }
    }, 120);
  }

  // ---- other ways for a leg: asked one leg at a time after the route came (the card shows them at their legs)
  let variants = [];
  async function findVariants(my) {
    variants = [];
    if (!plan || !route || act?.locked) return;
    const P = plan.pts, o = opts();
    for (let i = 0; i < P.length - 1 && i < 10; i++) {
      if (my !== seq || !plan) return;
      const L = route.legs[i];
      if (!L || L.none || L.m < 400) continue;
      // places the route already goes through (any leg) or its points: never offered as "wydłuż przez"
      const skip = { ids: (route.places || []).map((q) => q.id), pts: P.map((q) => [q.x, q.y]) };
      const r = await C.call("legVariants", { a: [P[i].x, P[i].y], b: [P[i + 1].x, P[i + 1].y], opts: { ...BASE, ...(o.legs[i] || {}) }, skip }).catch(() => null);
      if (my !== seq || !plan) return;
      if (r?.out?.length || o.legs[i]) { variants[i] = r; if (shown) render(); }
    }
  }
  const VLABEL = { szybciej: "szybciej", nowe: "nowe szlaki", lagodniej: "łagodniej", kolejka: "kolejką", przez: "wydłuż przez" };
  const mins = (ms) => { const m = Math.round(ms / 60000); return m >= 60 ? `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, "0")} min` : `${m} min`; };
  /** The chips under a leg: its other ways (what each gives, what it costs), or the way it goes now. */
  function variantHtml(i) {
    const via = plan.pts[i + 1]?.via, V = variants[i], k = plan._k || 1;
    if (via) {
      const kind = via.lift ? "kolejka" : Object.entries({ szybciej: "najszybsza", nowe: "nieznana" }).find(([, m]) => m === via.mode)?.[0] || (via.steep ? "lagodniej" : null);
      return `<div class="pvar"><span class="vchip on"><b>${VLABEL[kind] || "inaczej"}</b></span><button class="vchip" data-via="${i + 1}" data-v="">wróć do zalecanej</button></div>`;
    }
    if (!V?.out?.length) return "";
    return `<div class="pvar">${V.out.map((q) => {
      const dt = (q.std - V.base.std) * k, t = `${dt < 0 ? "−" : "+"}${mins(Math.abs(dt))}`;
      const why = q.kind === "przez" ? `${esc(shortName(q.name || ""))} · ${t} · ↑${q.up - V.base.up >= 0 ? "+" : ""}${Math.round(q.up - V.base.up)} m` : q.kind === "kolejka" ? `${esc(q.name || "wyciąg")} · ${t}` : q.kind === "nowe" ? `+${C.nf((q.fresh - V.base.fresh) / 1000)} km nowych · ${t}` : q.kind === "lagodniej" ? `${t} · zejścia do ${q.steep}% zamiast ${V.base.steep}%` : t;
      return `<button class="vchip" data-via="${i + 1}" data-v='${JSON.stringify(q.opts).replace(/'/g, "&#39;")}'><b>${VLABEL[q.kind]}</b> · ${why}</button>`;
    }).join("")}</div>`;
  }

  // ---- the description: step by step, as on the signposts
  const COL_PL = { red: "czerwonym", blue: "niebieskim", green: "zielonym", yellow: "żółtym", black: "czarnym" };
  const COL_CSS = { red: "#d0202a", blue: "#2160c8", green: "#16903c", yellow: "#e0b800", black: "#1a1a1a" };
  const cap = (t) => t.charAt(0).toUpperCase() + t.slice(1);
  const howOf = (st) => {
    if (st.cols) { const c = st.cols.split(",").map((q) => COL_PL[q] || q); return `szlakiem ${c.length > 1 ? `${c.slice(0, -1).join(", ")} i ${c.at(-1)}` : c[0]}`; }
    return st.cat === -2 ? "kolejką (sprawdź, czy kursuje)" : st.cat === 1 ? "ścieżką" : st.cat === 2 ? "drogą" : st.cat === 3 ? "ścieżkami i drogami" : "bez drogi w mapie";
  };
  const barOf = (st) => {
    if (!st.cols && st.cat === -2) return "background: repeating-linear-gradient(#3d3f45 0 2px, transparent 2px 6px)";
    if (!st.cols) return st.cat === -1 ? "background: repeating-linear-gradient(#b3261e 0 3px, transparent 3px 7px)" : "background: repeating-linear-gradient(#8a5a3a 0 6px, transparent 6px 10px)";
    const c = st.cols.split(","), h = 100 / c.length;
    return `background: linear-gradient(${c.map((q, i) => `${COL_CSS[q] || "#777"} ${i * h}% ${(i + 1) * h}%`).join(", ")})`;
  };
  /** Figures of a stretch [d0, d1] of the route from its profile: standard time, climb, height at its end. */
  /** The route's climb and descent from its profile (as the legs and the walk count them), else the router's. */
  const ud = (r) => (r.P ? (({ up, down }) => ({ up, down }))(stretch(r, 0, r.P.d[r.P.d.length - 1])) : { up: r.up, down: r.down });
  /** The lift rides on a route: [{d0, d1, ms}] (its steps of kind "kolejką", the ride times from the plan's points). */
  function rides(r) {
    if (r._rides) return r._rides;
    const vias = (plan?.pts || []).map((q) => q.via?.lift).filter(Boolean), st = r.rides || []; // (exactly the rides: the description's steps join short bits to them)
    return (r._rides = st.map((x, k) => ({ d0: x.d0, d1: x.d1, ms: vias[k]?.ms || ((x.d1 - x.d0) / 2.4 + 480) * 1000 })));
  }
  /** On a lift at sample i (the ride's part: no climb, no walking time). */
  const ridden = (r, i) => { const d = r.P.d[i]; for (const q of rides(r)) if (d > q.d0 && d <= q.d1) return q; return null; };
  function stretch(r, d0, d1) {
    const P = r.P;
    if (!P) return { std: 0, up: 0, down: 0, h: null };
    const at = (dd) => Math.min(P.d.length - 1, Math.max(0, Math.round(dd / P.step)));
    let up = 0, down = 0;
    for (let i = at(d0) + 1; i <= at(d1); i++) { if (ridden(r, i)) continue; const dh = P.h[i] - P.h[i - 1]; if (Number.isFinite(dh)) { if (dh > 0) up += dh; else down -= dh; } }
    const h = P.h[at(d1)];
    return { std: P.T ? P.T[at(d1)] - P.T[at(d0)] : 0, up: Math.round(up), down: Math.round(down), h: Number.isFinite(h) ? Math.round(h) : null };
  }
  /** The route as one line: each point (A, 1, 2, ..., B) with its height, and between two points the
   * steps of the description that fall there (a trail colour, a path, a road). In edit mode: only the
   * points, with a handle to reorder and X to remove. */
  /** The medals of the badge lists for a point on one of their peaks (after its name). */
  const medalsHtml = (q) => {
    const md = C.medalsAt?.(q.x, q.y);
    return md?.k ? `<span class="pmd">${[...md.k].map((b) => `<img src="${medalURL(b, md.d)}" alt="${BADGE_NAME[b]}" title="${BADGE_NAME[b]}">`).join("")}</span>` : "";
  };
  /** A point on a named summit or hut: its height as the map writes it (1603 for Śnieżka, not the profile's 1601). */
  function mapHeight(q) {
    let best = null, bd = 80;
    for (const p of C.view.data?.names?.pois || []) {
      if ((p[2] !== "peak" && p[2] !== "hut") || !p[5] || Math.abs(p[3] - q.x) > bd || Math.abs(p[4] - q.y) > bd) continue;
      const d = Math.hypot(p[3] - q.x, p[4] - q.y);
      if (d < bd) { bd = d; best = Math.round(p[5]); }
    }
    return best;
  }
  function timelineHtml(r) {
    const n = plan.pts.length, k = plan._k || 1, b = r?.bounds || [], edit = ui.edit || !r?.steps?.length;
    const ptRow = (i) => {
      const h = mapHeight(plan.pts[i]) ?? (r && b[i] != null ? stretch(r, b[i], b[i]).h : null), at = r && b[i] != null && i > 0 ? (i === n - 1 && plan._ms ? plan._ms : stretch(r, 0, b[i]).std * k) : null, cls = plan.toward ? " b" : i === 0 ? " a" : i === n - 1 && n > 1 ? " b" : "";
      return `<div class="prow${edit ? " ed" : ""}" data-i="${i}">${edit ? `<span class="grip" aria-label="Przeciągnij, żeby zmienić kolejność">≡</span>` : ""}<b class="pl${cls}">${badge(i, n)}</b><span class="pn"><span>${esc(ptName(plan.pts[i], i, n))}${medalsHtml(plan.pts[i])}</span></span>${edit ? `<button class="iconbtn px" data-del="${i}" aria-label="Usuń punkt"><svg><use href="#i-x"/></svg></button>` : `<span class="ph">${at != null ? `<b>${plan.at ? hhmm(plan.at + at) : C.hm(at).replace(" h", "")}</b> · ` : plan.at && i === 0 ? `<b>${hhmm(plan.at)}</b> · ` : ""}${h != null ? `${h} m` : ""}</span>`}</div>`;
    };
    let html = n >= 2 && r?.steps?.length && !(act && act.locked) ? `<div class="pedit up"><button class="linkbtn" data-act="edit"><svg><use href="#i-${ui.edit ? "check" : "pen"}"/></svg>${ui.edit ? "Gotowe" : "Zmień kolejność"}</button></div>` : "";
    html += `<div class="ptime${edit ? " editing" : ""}">`;
    for (let i = 0; i < n; i++) {
      html += ptRow(i);
      if (edit || i === n - 1 || !r) continue;
      const a = b[i], z = b[i + 1], L = r.legs[i];
      if (a == null || z == null) continue;
      // the steps that fall in this leg (the parts under 80 m at its ends left out, unless that is all there is)
      const parts = r.steps.map((st) => ({ st, d0: Math.max(a, st.d0), d1: Math.min(z, st.d1) })).filter((q) => q.d1 - q.d0 > 0);
      const keep = parts.filter((q) => q.d1 - q.d0 >= 80);
      // one line for the leg: its trails as a stacked bar, its figures; a tap shows the trails one by one
      const shown = keep.length ? keep : parts.slice(0, 1), F = stretch(r, a, z), open = ui.legs.has(i);
      html += `<button class="pstep pleg${open ? " open" : ""}" data-leg="${i}" aria-expanded="${open}"><span class="pbars">${shown.map((q) => `<i style="${barOf(q.st)}; flex: ${Math.max(1, Math.round(q.d1 - q.d0))}"></i>`).join("")}</span><span class="psn">${C.hm(F.std * k)} · ${C.nf((z - a) / 1000)} km${F.up ? ` · ↑${F.up}` : ""}${F.down ? ` ↓${F.down}` : ""}</span><svg class="chev"><use href="#i-chev"/></svg></button>`;
      for (const q of open ? shown : []) {
        const f = stretch(r, q.d0, q.d1), inner = q.d1 < z - 120 && q.st.to;
        html += `<div class="pstep"><i class="pbar" style="${barOf(q.st)}"></i><span class="psn">${cap(howOf(q.st))}${inner ? ` → <b>${esc(q.st.to)}</b>` : ""}<small>${C.hm(f.std * k)} · ${C.nf((q.d1 - q.d0) / 1000)} km${f.up ? ` · ↑${f.up}` : ""}${f.down ? ` ↓${f.down}` : ""}</small></span></div>`;
      }
      if (!act?.locked) html += variantHtml(i);
      if (r.P) for (const q of notes(r).closed) if (q.d1 > a && q.d0 < z) html += `<div class="pstep warn${q.now ? "" : " soft"}"><i class="pbar" style="${barOf({ cat: -1 })}"></i><span class="psn">${esc(q.c.name)}: ${q.now ? "zamknięte" : "zamykane"} ${whenPl(q.c)} (${q.c.why})${q.c.around ? ` · obejście ${q.c.around}` : ""}</span></div>`;
      if (L?.none) html += `<div class="pstep warn"><i class="pbar" style="${barOf({ cat: -1 })}"></i><span class="psn">Tu nie ma drogi w mapie: przesuń punkt bliżej ścieżki</span></div>`;
    }
    html += `</div>`;
    return html;
  }
  const ui = { edit: false, opts: false, more: false, wx: false, legs: new Set() }; // legs: the ones opened to their trails

  // ---- on the way: when you get to the finish against the sunset, and the weather where you will be
  // (open-meteo, for up to 7 points along the rest of the route at the hours you will be there): asked
  // when the button is tapped, and while you walk once an hour by itself (a storm or rain ahead: on the pill)
  let wx = null; // {t, pts: [{i, at, lat, lon, name}], rows, alert, err, busy}
  const hhmm = (t) => new Date(t).toLocaleTimeString("pl-PL", { hour: "2-digit", minute: "2-digit" });
  function wxPoints(now = Date.now(), i0 = meIdx ?? act?.maxIdx ?? 0) {
    const r = route, P = r?.P;
    if (!P) return [];
    const last = P.d.length - 1, out = [];
    const total = wayOf(r, i0, last).ms, n = Math.max(2, Math.min(7, Math.round(total / (40 * 60000)) + 1));
    for (let k = 0; k < n; k++) {
      // equal steps of the way (distance), then the time to there
      const i = Math.round(i0 + ((last - i0) * k) / (n - 1)), ms = i > i0 ? wayOf(r, i0, i).ms : 0;
      const [lon, lat] = C.unproject(P.x[i], P.y[i]);
      const pl = (r.places || []).filter((q) => q.n && q.c !== "place" && Math.abs(q.d - P.d[i]) < 400).sort((a, b) => Math.abs(a.d - P.d[i]) - Math.abs(b.d - P.d[i]))[0];
      out.push({ i, at: now + ms, lat, lon, h: P.h[i], name: k === n - 1 ? "meta" : pl ? shortName(pl.n) : k === 0 ? "teraz" : `${C.nf(P.d[i] / 1000)} km` });
    }
    return out;
  }
  async function routeWx(force) {
    if (!act || !route?.P || wx?.busy) return;
    if (!force && wx && Date.now() - wx.t < 60 * 60000) return;
    if (!force && navigator.onLine === false) return;
    const pts = wxPoints();
    if (!pts.length) return;
    wx = { ...(wx || {}), busy: true, t: Date.now() };
    try {
      const rows = await forecast(pts);
      wx = { t: Date.now(), pts, rows, alert: wxAlert(rows), err: null };
    } catch {
      wx = { ...(wx || {}), busy: false, err: navigator.onLine === false ? "Brak internetu: pogoda pojawi się, gdy złapiesz zasięg." : "Nie udało się pobrać pogody.", t: force ? 0 : Date.now() - 50 * 60000 };
    }
    C.onActive?.();
    if (shown && ui.wx) render();
  }
  function wxHtml(t0 = Date.now(), i0 = meIdx ?? act?.maxIdx ?? 0, W = wx) {
    const r = route, P = r?.P;
    if (!P) return "";
    const last = P.d.length - 1, eta = t0 + wayOf(r, i0, last).ms;
    const [lon, lat] = C.unproject(P.x[last], P.y[last]), sun = sunTimes(eta, lat, lon);
    let html = `<div class="pwx">`;
    if (sun.set) {
      const spare = sun.set - eta, late = spare < 0, tight = !late && spare < 45 * 60000;
      html += `<p class="peta${late ? " bad" : tight ? " tight" : ""}"><span>Na mecie ok. <b>${hhmm(eta)}</b> · zachód <b>${hhmm(sun.set)}</b>${sun.dark ? ` · ciemno ok. <b>${hhmm(sun.dark)}</b>` : ""}</span>` +
        `<small>${late ? `Meta ${Math.round(-spare / 60000)} min po zachodzie: weź czołówkę albo skróć trasę.${act ? ` <button class="linkbtn" data-act="shorten">Skróć</button>` : ""}` : tight ? `Na styk: ${Math.round(spare / 60000)} min światła na mecie.` : `Zapas: ${spare >= 3600000 ? C.hm(spare) : `${Math.round(spare / 60000)} min`} światła na mecie.`}</small></p>`;
    }
    if (W?.busy && !W.rows) html += `<p class="muted small">Pobieram pogodę na trasie…</p>`;
    else if (W?.err && !W.rows) html += `<p class="muted small">${W.err}</p>`;
    if (W?.rows) {
      html += `<div class="wxrow">${W.pts.map((q, k) => {
        const w = W.rows[k];
        if (!w) return "";
        const [, word] = wxWord(w.code), cls = w.code >= 95 ? " s" : wxAlert([w])?.kind === "rain" ? " r" : "", hr = new Date(q.at).getHours();
        return `<div class="wxc${cls}"><small>${hhmm(q.at)}</small><span title="${word}">${wxIcon(w.code, hr >= 6 && hr < 19)}</span><b>${Math.round(w.temp)}°</b><span>${esc(q.name)}</span><small>${Math.round(w.gust ?? w.wind)} km/h${w.pp >= 30 ? ` · ${w.pp}%` : ""}</small></div>`;
      }).join("")}</div><p class="muted small">Prognoza open-meteo.com dla miejsc na trasie w godzinach, w których tam będziesz (wiatr w porywach) · z ${hhmm(W.t)}${W.err ? ` · ${W.err}` : ""}</p>`;
    }
    return html + `</div>`;
  }

  /** Time for the route: your own norm when it is known, else the standard (Tobler). */
  function timeOf(km, up, down, std, bins = null) {
    // a plan sent to friends carries the trip's one pace (the slowest of the group on each gradient): the same time for all
    const G = plan?.pace;
    if (G && bins?.length === G.length) return { ms: bins.reduce((t, v, b) => t + v * G[b], 0), mine: true, group: true };
    if (C.routeTime) return C.routeTime({ km, up, down, std, bins });
    const N = C.paceNorm();
    return N ? { ms: personalTime(N, km, up, down), mine: true } : { ms: std, mine: false };
  }

  /** The buttons under the thumb: undo, loop, there and back, reverse, save. */
  const PB = {
    undo: `<svg viewBox="0 0 24 24"><path d="M9 7.5 4.5 12 9 16.5"/><path d="M5 12h9.5a5 5 0 0 1 0 10H12"/></svg>`,
    loop: `<svg viewBox="0 0 24 24"><path d="M20 12a8 8 0 1 1-3-6.2"/><path d="M17 2v4h-4"/></svg>`,
    back: `<svg viewBox="0 0 24 24"><path d="M4 8h13l-3-3M20 16H7l3 3"/></svg>`,
    rev: `<svg viewBox="0 0 24 24"><path d="M7 4v16M7 20l-3-3M7 20l3-3M17 20V4M17 4l-3 3M17 4l3 3"/></svg>`,
    save: `<svg viewBox="0 0 24 24"><path d="M7 3.5h10a1 1 0 0 1 1 1v16l-6-4-6 4v-16a1 1 0 0 1 1-1Z"/></svg>`,
    go: `<svg viewBox="0 0 24 24"><path d="M8 5.5v13l10-6.5Z"/></svg>`,
    walked: `<svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>`,
    more: `<svg viewBox="0 0 24 24"><circle cx="5.5" cy="12" r="1.3" style="fill: currentColor"/><circle cx="12" cy="12" r="1.3" style="fill: currentColor"/><circle cx="18.5" cy="12" r="1.3" style="fill: currentColor"/></svg>`,
    gpx: `<svg viewBox="0 0 24 24"><rect x="7" y="6.5" width="10" height="11" rx="2.5"/><path d="M9 6.5 9.6 3h4.8l.6 3.5M9 17.5l.6 3.5h4.8l.6-3.5M12 9.5V12l1.6 1"/></svg>`,
    send: `<svg viewBox="0 0 24 24"><circle cx="17.5" cy="5.5" r="2.6"/><circle cx="6.5" cy="12" r="2.6"/><circle cx="17.5" cy="18.5" r="2.6"/><path d="m8.8 10.7 6.4-3.9M8.8 13.3l6.4 3.9"/></svg>`,
    end: `<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18"/></svg>`,
    wx: `<svg viewBox="0 0 24 24"><circle cx="8.5" cy="8.5" r="3.2"/><path d="M8.5 2.2v1.4M2.2 8.5h1.4M4 4l1 1M13 4l-1 1M7 19.5h9.5a3.5 3.5 0 0 0 .3-7 5 5 0 0 0-9.6 1.2A2.9 2.9 0 0 0 7 19.5Z"/></svg>`,
  };
  const barHtml = () => {
    const n = plan.pts.length, b = (a, t, ok = true, cls = "") => `<button data-act="${a}" class="${cls}" ${ok ? "" : "disabled"} aria-label="${t}">${PB[a]}<span>${t}</span></button>`;
    if (act) return act.locked ? `<div class="pthumb three">${b("wx", "Pogoda i zmrok", !!route, `wide${ui.wx ? " on" : ""}`)}${b("more", "Więcej", true, ui.more ? "on" : "")}</div>`
      : `<div class="pthumb six">${b("undo", "Cofnij", undo.length > 0)}${b("save", plan.id ? "Zapisz zmiany" : "Zapisz", n >= 2)}${b("send", "Wyślij plan", n >= 2)}${b("gpx", "GPX na zegarek", !!route)}</div>`;
    if (plan.outing) return `<div class="pthumb three">${b("walked", "Zapisz", !!route, "pr")}${b("undo", "Cofnij", undo.length > 0)}${b("rev", "Odwróć", n >= 2)}</div>`;
    return `<div class="pthumb six">${b("go", "Rozpocznij", !!route, "pr")}${b("rev", "Odwróć", n >= 2)}${b("save", plan.id ? "Zapisz zmiany" : "Zapisz", n >= 2)}${b("send", "Wyślij plan", n >= 2)}${b("gpx", "GPX na zegarek", !!route)}${b("more", "Więcej", true, ui.more ? "on" : "")}</div>`;
  };

  // ---- the day you go, what to know on the way (closures, parks), GOT
  const dayOf = () => plan?.at || Date.now();
  /** The notices for the route on the day you go (kept with the route until the day changes). */
  function notes(r) {
    const again = () => { if (r._notes) r._notes.day = null; if (shown) render(); drawMarkers(); }, osm = C.osmClosures?.(again) || [], list = C.noticeList?.(again), day = `${new Date(dayOf()).toDateString()}|${osm.length}|${list?.t || 0}`;
    if (r._notes?.day === day) return r._notes.v;
    const P = r.P, line = [];
    if (P) for (let i = 0; i < P.d.length; i += 3) { const [lon, lat] = C.unproject(P.x[i], P.y[i]); line.push([lon, lat, P.d[i]]); }
    const v = noticesFor(line, r.steps || [], dayOf(), osm, list || undefined);
    r._notes = { day, v };
    return v;
  }
  const gotOfRoute = (r) => { const b = r.bounds || []; let g = 0; for (let i = 0; i + 1 < b.length; i++) g += gotOf((b[i + 1] - b[i]) / 1000, stretch(r, b[i], b[i + 1]).up); return g || gotOf(r.km, r.up); };
  const whenTxt = (t) => { const d = new Date(t), today = new Date(), tm = new Date(Date.now() + 864e5); const day = d.toDateString() === today.toDateString() ? "dziś" : d.toDateString() === tm.toDateString() ? "jutro" : d.toLocaleDateString("pl-PL", { weekday: "short", day: "numeric", month: "numeric" }); return `${day}, ${hhmm(t)}`; };
  const localVal = (t) => { const d = new Date(t - new Date(t).getTimezoneOffset() * 60000); return d.toISOString().slice(0, 16); };
  let wxPlan = null; // the weather for the day you go: {key, pts, rows, alert, busy, err}
  async function planWx() {
    const r = route;
    if (!plan?.at || !r?.P || act) return;
    const key = `${plan.at}|${r.km}`;
    if (wxPlan?.key === key) return;
    if (plan.at > Date.now() + 6.5 * 864e5) { wxPlan = { key, err: "Prognoza sięga 7 dni naprzód." }; return; }
    const pts = wxPoints(plan.at, 0);
    wxPlan = { key, pts, busy: true };
    try { const rows = await forecast(pts); if (wxPlan?.key === key) wxPlan = { key, pts, rows, alert: wxAlert(rows), t: Date.now() }; }
    catch { if (wxPlan?.key === key) wxPlan = { key, pts, err: navigator.onLine === false ? "Brak internetu: pogoda pojawi się, gdy złapiesz zasięg." : "Nie udało się pobrać pogody." }; }
    if (shown) render();
  }
  function planMoreHtml(r) {
    const N = notes(r), fresh = (r.legs || []).reduce((s2, L) => s2 + (L.fresh || 0), 0) / 1000;
    // when you go (now unless chosen)
    let html = (fresh > 0.05 && !act ? `<p class="pnew"><b>+${C.nf(fresh)} km</b> nowych szlaków do zdrapania</p>` : "") + `<div class="pwhen"><label class="pwchip"><svg><use href="#i-clock"/></svg><span>Wyjście <b>${plan.at ? whenTxt(plan.at) : "teraz"}</b></span><input type="datetime-local" class="pwhenin" value="${localVal(plan.at || Date.now())}" aria-label="Dzień i godzina wyjścia"></label>${plan.at ? `<button class="iconbtn pwhenx" data-act="whenx" aria-label="Wyjście teraz"><svg><use href="#i-x"/></svg></button>` : ""}</div>`;
    // A: closed stretches (on that day: a warning; in another season: a word), the parks
    const seen = new Set();
    // (a closure in another season: only at its leg in the list below, not twice)
    for (const q of N.closed.filter((x) => x.now).filter((x) => { const k = `${x.c.name}|${whenPl(x.c)}|${x.now}`; return !seen.has(k) && seen.add(k); })) html += `<p class="pnote${q.now ? " bad" : ""}">${q.now ? "⚠ <b>Zamknięty odcinek</b> " : ""}${esc(q.c.name)} · ${q.now ? "" : "zamykany "}${whenPl(q.c)} (${q.c.why})${q.now && q.c.around ? ` · obejście ${q.c.around}` : ""}</p>`;
    // F + parks: one quiet line
    const bits = [`GOT <b>${gotOfRoute(r)}</b>`, ...N.parks.map((p) => `${p.name}: ${p.fee === true ? "wstęp płatny" : `płatne: ${p.fee}`}${p.dogs ? ` · ${p.dogs}` : ""}`)];
    html += `<p class="pmeta"><svg><use href="#i-medal"/></svg><span>${bits.join(" · ")}</span></p>`;
    // B: at that time: dusk and the weather on the way
    if (plan.at) html += wxHtml(plan.at, 0, wxPlan);
    return html;
  }

  /** What ⋯ opens: right under the row of buttons (as on every card), before the rest of the card. */
  function moreMenu(r, n) {
    if (!ui.more) return "";
    if (act && act.locked) return `<div class="pmenu"><button class="act" data-act="shorten"><svg><use href="#i-cut"/></svg><span>Skróć: najszybciej do mety</span></button><button class="act" data-act="home"><svg><use href="#i-train"/></svg><span>Pociąg do domu</span></button><button class="act" data-act="gpx"><svg><use href="#i-share"/></svg><span>GPX na zegarek</span></button><button class="act warn" data-act="end"><svg><use href="#i-stop"/></svg><span>Zakończ trasę</span></button></div>`;
    const np = variants.reduce((s2, v, i) => s2 + (v?.out?.length && !plan.pts[i + 1]?.via ? v.out.length : 0), 0); // (other ways for the legs)
    return `<div class="pmenu">${np ? `<button class="act" data-act="vars"><svg><use href="#i-route"/></svg><span>Inne warianty (${np})</span></button>` : ""}${r && isLoopNow() ? `<button class="act" data-act="park"><svg><use href="#i-map"/></svg><span>Start z parkingu</span></button>` : ""}<button class="act" data-act="walked" ${r ? "" : "disabled"}><svg><use href="#i-check"/></svg><span>Przeszedłem</span></button>${n ? `<button class="act" data-act="drive"><svg><use href="#i-map"/></svg><span>Dojazd do startu</span></button>` : ""}</div>`;
  }

  // the slope classes of the tall profile, as a key under it (core/profile.js SLOPES)
  function render() {
    if (!plan) return;
    if (shown && document.activeElement?.classList?.contains("pnamein")) return; // typing its name: not under the fingers
    if (!shown) { drawMarkers(); placeMe(); C.onActive?.(); return; }
    const n = plan.pts.length, r = route;
    // the top (what the folded card shows): the figures, the profile, the mode; then the route as one line
    // tall from the start when the card is up (added after, the profile grew from small: a flicker at every tap)
    const tall = !["min", "hidden"].includes(C.$("sheet").dataset.state);
    let html = `<div class="plan${act && act.locked ? " walk" : ""}${tall ? " big" : ""}">`;
    const tools = `<span class="ptools">${r && n >= 2 ? "" : `<button class="iconbtn pundo" data-act="undo" aria-label="Cofnij" ${undo.length ? "" : "disabled"}><svg><use href="#i-undo"/></svg></button>`}<button class="iconbtn pmore" data-act="more" aria-label="Więcej" aria-expanded="${ui.more}"><svg><use href="#i-dots"/></svg></button></span>`;
    if (r && n >= 2) {
      const t = timeOf(r.km, r.up, r.down, r.std, r.bins);
      plan._k = r.std > 0 ? t.ms / r.std : 1; plan._ms = t.ms; // (the finish's time in the list: the same as up here)
      const fresh = r.legs.reduce((s2, L) => s2 + L.fresh, 0) / 1000;
      // the figures in one row over the profile (folded: just these, planning or walking alike); the rest when it is up
      const P = r.P, last = P ? P.d.length - 1 : 0, mine = act && P && meIdx != null;
      const corner = act ? (act.locked ? `<button class="pcx lock" data-act="lock" aria-label="Odblokuj: zmiana trasy"><svg><use href="#i-lock"/></svg></button>` : `<button class="pcx endx" data-act="end" aria-label="Zakończ trasę"><svg><use href="#i-x"/></svg></button><button class="pcx lock unl" data-act="lock" aria-label="Zablokuj"><svg><use href="#i-unlock"/></svg></button>`) : `<button class="pcx" data-act="x" aria-label="Zamknij planowanie"><svg><use href="#i-x"/></svg></button>`;
      const cx = (v, lead = "", extra = "") => kpiRow(v, { lead, extra, corner, label: mine ? "Od Ciebie do mety" : "Cała trasa", key: groundKey(r?.P), grp: plan?.pace ? ["#8f8f99", "#b4b4bc", "#d0d0d6"] : true });
      // the head, as on every card: the name (a tap renames it), the card's X (walking: the lock); folded, the name is on the grab and the X in the figures' row
      const head = (name, extra = "") => `<div class="chead"><button class="pname" data-act="rename" aria-label="Zmień nazwę"><b>${esc(name)}</b><svg><use href="#i-pen"/></svg></button>${extra}${corner}</div>`;
      if (act && P) {
        const L = act.locked, off = me && meIdx == null;
        html += head(act.name); // (the lock in the corner: open, the points move; shut again, the route as it is now)
        html += cx(mine ? wayOf(r, meIdx, last) : act.maxIdx > 0 ? wayOf(r, Math.min(last, act.maxIdx), last) : { ms: t.ms, km: r.km, ...ud(r) }, // (off the route: what is left from where you left it)
        `<i class="rdot${off ? " off" : ""}" role="img" aria-label="${off ? "Poza trasą" : "Na trasie"}"></i>`);
        if (mine) {
        const nx = (r.places || []).find((q) => (q.c === "hut" || q.c === "peak" || q.c === "pass") && q.d > P.d[meIdx] + 80);
        if (nx) { const i = Math.min(last, Math.round(nx.d / P.step)), v = wayOf(r, meIdx, i); html += `<p class="pnext">dalej na trasie: ${nx.c === "hut" || nx.c === "peak" ? `<img class="gi" src="${glyphURL(nx.c)}" alt="">` : ""} <b>${esc(shortName(nx.n))}</b> · ${C.hm(v.ms).replace(" h", "")} · ${C.nf(v.km)} km${v.up >= 10 ? ` · ↑${Math.round(v.up)}` : ""}</p>`; }
        }
      } else {
        html += head(plan.name || defaultName());
        if (P) html += cx({ ms: t.ms, km: r.km, ...ud(r) }, ""); // (the new km: a line of their own in the unfolded card)
        if (!P) html += kpiHtml({ ms: t.ms, km: r.km, up: r.up, down: r.down }, { label: "Cała trasa", grow: false, fresh });
      }
      html += barHtml() + (act && !act.locked ? "" : moreMenu(r, n)) + (ui.park && !(act && act.locked) ? parkHtml() : "");
      if (act && ui.wx) html += wxHtml();
      if (!act) html += planMoreHtml(r);
    } else {
      // the question is the instruction: where from, where to
      html += `<div class="phd3"><h4>${esc(plan.name) || (plan.toward || !n ? "Skąd?" : "Dokąd?")}</h4>${tools}</div>`;
      if (plan.toward) html += `<div class="tl muted">→ ${esc(ptName(plan.pts[0], 1, 2))}</div>`;
      html += moreMenu(r, n);
    }
    if (r && n >= 2 && act && !act.locked) html += `<div class="pchips">${tools}</div>` + moreMenu(r, n);
    if (n) html += timelineHtml(r);
    html += `</div>`;
    const keepScroll = C.$("tip").querySelector(".plan") ? C.$("tip").scrollTop : 0;
    C.openTip(html, () => (act ? away() : close()), "plan", { label: act ? "Trasa" : "Plan", /* (the way back to it from a place's card: not its name, which may be the place's) */ reopen: () => (act ? show({ quiet: true }) : render()) });
    C.$("tip").scrollTop = keepScroll;
    grabName();
    wire();
    prof?.stop?.(); prof = null; figKeep = null;
    if (r?.P && C.$("tip").querySelector(".plan .gprof")) { // (one point left after Cofnij: the old route, no profile box)
      const found = C.found?.() || {}, SIGN = ["peak", "hut", "shelter", "tower", "viewpoint"];
      const el = C.$("tip"), marks = r.places.filter((p) => SIGN.includes(p.c)).map((p) => { const md = p.c === "peak" ? C.medalsAt?.(p.x, p.y) : null; return { i: Math.max(0, Math.min(r.P.d.length - 1, Math.round(p.d / r.P.step))), n: shortName(p.n), c: p.c, key: md?.k ? `peak-${md.k}` : p.c, d: !!found[p.id] }; });
      prof = mountGrow(el.querySelector(".plan .gprof"), r.P, { bounds: r.bounds || [], marks, rides: rides(r), onWay: fingerFigures, onMark: () => C.haptic.tick(), onCursor: (i, j) => C.view.setCursor(cursorOf(r.P, i, j)), onResize: () => C.placeToast?.(), way: (a, b) => wayOf(r, a, b) });
      meIdx = null; placeMe(); prof?.setDone?.(act ? act.maxIdx || 0 : 0);
    }
    grow(); C.onActive?.();
    if (plan.at && !act) planWx();
  }

  /** A finger on the profile: the card's four figures say the way to it (a dot before them: from you, from
   * the start, or walked already); the finger off, they come back. */
  let figKeep = null;
  function fingerFigures(w, kind) {
    const k = C.$("tip").querySelector(".plan .kpi.cx"), row = k?.querySelectorAll(".krow .kc b");
    if (!k || row?.length !== 4) return;
    if (!w) {
      if (figKeep) row.forEach((b, i) => (b.textContent = figKeep[i]));
      figKeep = null; k.classList.remove("fing", "f-me", "f-start", "f-past", "f-range"); k.querySelector(".korg")?.remove();
      return;
    }
    if (!figKeep) { figKeep = [...row].map((b) => b.textContent); k.querySelector(".krow").insertAdjacentHTML("afterbegin", `<i class="korg"></i>`); }
    k.classList.add("fing"); k.classList.toggle("f-me", kind === "me"); k.classList.toggle("f-start", kind === "start"); k.classList.toggle("f-past", kind === "past"); k.classList.toggle("f-range", kind === "range");
    [C.hm(w.ms).replace(" h", ""), C.nf(w.km), Math.round(w.up), Math.round(w.down)].forEach((x, i) => (row[i].textContent = x));
  }

  /** The way along the route between two profile samples: km, climb, descent and time (your pace when known). */
  function wayOf(r, a, b) {
    const P = r.P;
    let up = 0, down = 0, rideMs = 0, rideM = 0;
    const bins = GBINS.map(() => 0).concat([0]);
    let std = 0;
    for (let i = a + 1; i <= b; i++) {
      const dx = P.d[i] - P.d[i - 1], q = ridden(r, i);
      if (q) { rideMs += (q.ms * dx) / Math.max(1, q.d1 - q.d0); rideM += dx; continue; } // on the lift: its ride time, no climb
      const dh = P.h[i] - P.h[i - 1]; if (Number.isFinite(dh)) { if (dh > 0) up += dh; else down -= dh; }
      const g = (P.slope[i - 1] + P.slope[i]) / 200, t = stdMs(dx, g); std += t; bins[gbin(g)] += t;
    }
    const km = (P.d[b] - P.d[a]) / 1000;
    return { km, up, down, ms: timeOf(km - rideM / 1000, up, down, std, bins).ms + rideMs };
  }
  /** The profile tall when the card is up, small when it is folded to its buttons. */
  function grow() {
    const st = C.$("sheet").dataset.state;
    C.$("tip").querySelector(".plan")?.classList.toggle("big", !["min", "hidden"].includes(st));
  }
  new MutationObserver(() => { if (plan) grow(); }).observe(C.$("sheet"), { attributes: true, attributeFilter: ["data-state"] });

  function wire() {
    const el = C.$("tip");
    el.querySelectorAll("[data-via]").forEach((b) => (b.onclick = () => setVia(+b.dataset.via, b.dataset.v ? JSON.parse(b.dataset.v) : null)));
    el.querySelectorAll("[data-del]").forEach((b) => (b.onclick = () => remove(+b.dataset.del)));
    el.querySelectorAll("[data-act]").forEach((b) => (b.onclick = () => doAct(b.dataset.act)));
    el.querySelector(".pwhenin")?.addEventListener("change", (e) => { const t = new Date(e.target.value).getTime(); plan.at = Number.isFinite(t) ? t : null; wxPlan = null; render(); drawMarkers(); planWx(); });
    el.querySelectorAll("[data-leg]").forEach((b) => (b.onclick = () => { const i = +b.dataset.leg; if (!ui.legs.delete(i)) ui.legs.add(i); render(); }));
    el.querySelectorAll(".prow .pn").forEach((s) => (s.onclick = () => { const q = plan.pts[+s.closest(".prow").dataset.i]; C.flyView(() => C.view.centerOn(q.x, q.y, Math.max(C.view.zl, 8))); }));
    // the order: drag a row by its handle
    el.querySelectorAll(".grip").forEach((h) => {
      h.addEventListener("pointerdown", (e) => {
        e.preventDefault(); e.stopPropagation();
        const row = h.closest(".prow"), rows = [...el.querySelectorAll(".prow")], from = rows.indexOf(row), y0 = e.clientY, H = row.offsetHeight;
        h.setPointerCapture(e.pointerId); row.classList.add("lift");
        let to = from;
        const mv = (ev) => {
          const dy = ev.clientY - y0;
          row.style.transform = `translateY(${dy}px)`;
          to = Math.max(0, Math.min(rows.length - 1, from + Math.round(dy / H)));
          rows.forEach((r2, j) => { if (r2 !== row) r2.style.transform = j > from && j <= to ? `translateY(${-H}px)` : j < from && j >= to ? `translateY(${H}px)` : ""; });
        };
        const up = () => { h.removeEventListener("pointermove", mv); h.removeEventListener("pointerup", up); h.removeEventListener("pointercancel", up); rows.forEach((r2) => (r2.style.transform = "")); row.classList.remove("lift"); if (to !== from) { C.haptic.tick(); reorder(from, to); } };
        h.addEventListener("pointermove", mv); h.addEventListener("pointerup", up); h.addEventListener("pointercancel", up);
      });
    });
  }

  // ---- a tap on a point of the plan: a small menu at it
  let menuEl = null;
  function closeMenu() { menuEl?.remove(); menuEl = null; }
  function pointMenu(i, sx, sy) {
    closeMenu();
    if (!plan?.pts[i]) return;
    const n = plan.pts.length, items = [];
    const P0 = plan.pts[0], PL = plan.pts[n - 1], isLoop = n >= 3 && Math.hypot(P0.x - PL.x, P0.y - PL.y) < 60;
    if (i === 0 && n >= 2 && !isLoop) items.push(["loop", "Wróć tu na koniec (pętla)"]);
    if (i > 0 && i < n - 1) items.push(["again", "Przejdź tędy jeszcze raz (na koniec trasy)"]);
    if (i > 0 && i < n - 1) items.push(["end", "Zakończ tutaj"]);
    if (i === n - 1 && n >= 2) items.push(["start", "Zacznij tutaj"]);
    if (i === n - 1 && n >= 2 && route?.P && C.homeByTrain) items.push(["home", "Stąd pociągiem do domu"]);
    items.push(["del", "Usuń punkt"]);
    const el = (menuEl = document.createElement("div"));
    el.className = "ppop card";
    el.innerHTML = `<div class="pph">${word(i, n)} · ${esc(ptName(plan.pts[i], i, n))}</div>` + items.map(([k, t]) => `<button data-pm="${k}" class="${k === "del" ? "danger" : ""}">${t}</button>`).join("");
    document.body.append(el);
    const w = el.offsetWidth, h = el.offsetHeight;
    el.style.left = `${Math.min(Math.max(8, sx - w / 2), innerWidth - w - 8)}px`;
    el.style.top = `${sy - h - 22 < 70 ? sy + 22 : sy - h - 22}px`;
    C.haptic.tick();
    el.onclick = (e) => {
      const k = e.target.closest("[data-pm]")?.dataset.pm;
      if (!k) return;
      closeMenu();
      if (k === "del") remove(i);
      else if (k === "again") { keep(); plan.pts.push({ ...plan.pts[i], via: null }); C.haptic.tick(); render(); recompute(); }
      else if (k === "loop") { keep(); plan.pts.push({ ...plan.pts[0], via: null }); C.haptic.tick(); render(); recompute(); }
      else if (k === "end") { keep(); plan.pts.splice(i + 1); render(); recompute(); } // the points after it go (↶ brings them back)
      else if (k === "home") doAct("home");
      else if (k === "start") { keep(); const [q] = plan.pts.splice(i, 1); plan.pts.unshift(q); render(); recompute(); }
    };
  }

  function doAct(a) {
    if (a === "x") { C.$("tip").querySelector(":scope > .tx")?.click(); return; } // (the card's own close: planning ends)
    if (a === "endlock") { // the lock: a tap opens it for a few seconds, a second tap ends the route (Cofnij on the bar)
      if (lockOpen > Date.now()) { lockOpen = 0; clearTimeout(doAct.t); end(); return; }
      const b = C.$("tip").querySelector(".pcx.lock");
      lockOpen = Date.now() + 4000; C.haptic.tick();
      if (b) { b.classList.add("unl"); b.innerHTML = `<svg><use href="#i-x"/></svg>`; }
      clearTimeout(doAct.t); doAct.t = setTimeout(() => { const c = C.$("tip").querySelector(".pcx.lock"); if (c) { c.classList.remove("unl"); c.innerHTML = `<svg><use href="#i-lock"/></svg>`; } }, 4000);
      return;
    }
    if (a === "park") { ui.more = false; findParks(); return; }
    if (a === "send") { ui.more = false; render(); sharePlan(); return; }
    if (a === "parkx") { closeParks(); render(); return; }
    if (/^park\d+$/.test(a)) { useParking(+a.slice(4)); return; }
    if (a === "edit") { ui.edit = !ui.edit; ui.more = false; render(); return; }
    if (a === "opts") { ui.opts = !ui.opts; render(); return; }
    if (a === "more") { ui.more = !ui.more; if (ui.more && C.$("sheet").dataset.state === "min") C.sheet("peek"); render(); return; }
    if (a === "rename") { rename(); return; }
    if (a === "wx") { ui.wx = !ui.wx; render(); if (ui.wx) routeWx(true); return; }
    if (a === "whenx") { plan.at = null; wxPlan = null; render(); drawMarkers(); return; }
    if (a === "vars") { // the first leg with other ways, in view
      C.sheet("mid");
      setTimeout(() => { const v = C.$("tip").querySelector(".plan .pvar"); if (v) { v.scrollIntoView({ block: "center", behavior: "smooth" }); v.classList.add("flash"); setTimeout(() => v.classList.remove("flash"), 1400); } }, 260);
      return;
    }
    if (a !== "undo") ui.more = false;
    if (a === "undo") back();
    else if (a === "rev") reverse();
    else if (a === "save") save();
    else if (a === "go") start();
    else if (a === "end") end();
    else if (a === "shorten") shorten();
    else if (a === "lock") {
      act.locked = !act.locked; C.haptic.tick(); C.view.setPlanning?.(!act.locked);
      if (!act.locked) C.sheet("min"); // (changing the route: the map, not the card)
      if (act.locked && plan.id) saveQuiet(); // Gotowe: the changes kept in Moje plany too
      storeActive(); render(); findVariants(seq);
    }
    else if (a === "gpx") gpx();
    else if (a === "home" && route?.P) {
      // at the finish when you would get there: walking it now (from you), else leaving now from its start
      const P = route.P, last = P.d.length - 1, ms = wayOf(route, act && meIdx != null ? meIdx : 0, last).ms, q = plan.pts.at(-1);
      C.homeByTrain?.({ x: q.x, y: q.y, n: ptName(q, plan.pts.length - 1, plan.pts.length), at: Date.now() + ms, extend: true }); // (Prowadź: the route goes on to the station)
    }
    else if (a === "drive" && plan.pts[0]) C.directions?.(plan.pts[0].x, plan.pts[0].y, plan.pts[0].n || plan.pts[0].near?.n);
    else if (a === "walked" && route?.line?.length) {
      // a copy of the route as an outing (not tied to the saved plans): its time from the plan's estimate
      const t = timeOf(route.km, route.up, route.down, route.std, route.bins);
      C.addWalked({ line: route.line, P: route.P, km: route.km, up: route.up, down: route.down, ms: t.ms, name: plan.name || defaultName(),
        pts: plan.pts.map(({ x, y, n, via }) => ({ x, y, n: n || null, via: via || null })), outing: plan.outing || null });
    }
  }

  // ---- saved plans (on this device)
  const loadPlans = () => { try { return JSON.parse(localStorage.getItem(PLANS) || "[]"); } catch { return []; } };
  const storePlans = (list) => { try { localStorage.setItem(PLANS, JSON.stringify(list)); return true; } catch { C.toast("Nie udało się zapisać planu", 4000); return false; } };
  function save(quiet = false) {
    if (!plan.name) { plan.name = defaultName(); plan.auto = true; } // (no asking: the name is on the card, a tap changes it)
    const list = loadPlans(), rec = { id: plan.id || `p${Date.now()}`, name: plan.name, auto: plan.auto || undefined, pace: plan.pace || undefined, pts: plan.pts.map(({ x, y, n, near, via }) => ({ x, y, n, near, via })), km: route?.km ?? null, up: route?.up ?? null, line: lightLine(route?.line || []), saved: Date.now() };
    plan.id = rec.id;
    const i = list.findIndex((p) => p.id === rec.id);
    if (i >= 0) list[i] = rec; else list.unshift(rec);
    if (act) { act.id = plan.id; act.name = plan.name; act.auto = !!plan.auto; storeActive(); }
    if (storePlans(list)) { if (!quiet) { C.toast("Zapisano", 3500); render(); } C.onSaved?.(); }
  }
  /** The name on the card becomes a field: Enter or leaving it keeps the new name (saved again when the plan is saved). */
  function rename() {
    const b = C.$("tip").querySelector('.plan [data-act="rename"]');
    if (!b || !plan) return;
    const inp = document.createElement("input");
    inp.className = "pnamein"; inp.value = plan.name || act?.name || defaultName(); inp.maxLength = 60; inp.enterKeyHint = "done";
    b.replaceWith(inp); inp.focus(); inp.select();
    let done = false;
    const keep = () => {
      if (done) return; done = true;
      const v = inp.value.trim();
      if (v && v !== plan.name) { plan.name = v; plan.auto = false; if (act) { act.name = v; act.auto = false; } if (plan.id) saveQuiet(); storeActive(); C.onActive?.(); }
      render();
    };
    inp.onkeydown = (e) => { if (e.key === "Enter") inp.blur(); else if (e.key === "Escape") { inp.value = ""; inp.blur(); } };
    inp.onblur = keep;
  }
  const saveQuiet = () => save(true);
  /** A saved route's line for the map: a point every ~25 m, whole metres. */
  function lightLine(ln) {
    const out = [];
    for (let i = 0; i < ln.length; i += 2) if (!out.length || i === ln.length - 2 || Math.hypot(ln[i] - out[out.length - 2], ln[i + 1] - out[out.length - 1]) >= 25) out.push(Math.round(ln[i]), Math.round(ln[i + 1]));
    return out;
  }
  /** Lines of the saved plans (the ones saved with a route), to show on the map. */
  /** A plan kept for later (a proposal's "Może"): into Moje plany, nothing opened. */
  function keepPlan(rec) { const list = loadPlans(); list.unshift({ id: `p${Date.now()}`, name: rec.name, pts: rec.pts, km: rec.km ?? null, up: rec.up ?? null, line: rec.line || [], saved: Date.now() }); if (storePlans(list)) C.onSaved?.(); }
  const savedLines = () => loadPlans().filter((p) => p.line?.length >= 4).map((p) => ({ id: p.id, line: p.line }));
  /** A route's name made up: its ends' places, the top peak between them (a loop, or both ends the same
   * place: "Karpacz – Śnieżka – Karpacz"), else the date. */
  function defaultName() {
    const P = plan.pts, end = (q) => q && (q.n || q.near?.n || (q.spot?.near && q.spot.near.d <= 2500 ? q.spot.near.n : null));
    let a = end(P[0]), b = end(P.at(-1));
    a = a && shortName(a); b = b && shortName(b);
    const peaks = (route?.places || []).filter((p) => p.c === "peak" && p.n), top = peaks.sort((x, y) => (y.e ?? 0) - (x.e ?? 0))[0];
    const t = top && shortName(top.n);
    const loop = P.length >= 2 && Math.hypot(P[0].x - P.at(-1).x, P[0].y - P.at(-1).y) < 300;
    if (a && b && (a === b || loop)) return t && t !== a ? `${a} – ${t} – ${a}` : a;
    if (a && b) return `${a} – ${b}`;
    if ((a || b) && t && t !== (a || b)) return a ? `${a} – ${t}` : `${t} – ${b}`;
    return a || b || t || `Trasa ${new Date().toLocaleDateString("pl-PL", { day: "numeric", month: "long" })}`;
  }
  /** A name made up (not given): follows the route's changes. */
  function autoName() {
    if (!plan || (plan.name && !plan.auto)) return;
    const n = defaultName();
    if (plan.name) plan.name = n;
    if (act && act.name !== n) { act.name = n; storeActive(); grabName(); C.onActive?.(); }
  }
  /** Plany: a page of the menu (as Wyjścia, Miejsca); a plan opened from it closes the menu. */
  function listCard() { C.drawer("plansp", { push: true }); }
  function renderPlans() {
    const el = C.$("plansp");
    if (!el) return;
    let list = loadPlans(), last = null;
    try { last = JSON.parse(localStorage.getItem(LAST) || "null"); } catch { /* none */ }
    const li = last ? list.findIndex((p) => p.id === last.id) : -1;
    if (li > 0) list = [list[li], ...list.slice(0, li), ...list.slice(li + 1)]; // the last route walked first
    const html = `<div class="actrow"><button class="act" data-trips><svg><use href="#i-spark"/></svg><span>Propozycje</span></button>${list.length ? `<button class="act${C.plansOnMap() ? " on" : ""}" data-onmap aria-pressed="${C.plansOnMap()}"><svg><use href="#i-map"/></svg><span>Na mapie</span></button>` : ""}</div>` + (list.length
      ? `<div class="visits">${list.map((p) => { const on = act && act.id === p.id; return `<div class="plrow"><button class="vrow" data-plan="${p.id}"><span>${p.km != null ? `${C.nf(p.km)} km` : ""}</span><span>${esc(p.name)}${on ? `<em class="ptag">idziesz</em>` : last?.id === p.id ? `<em class="ptag last">ostatnia</em>` : ""}<small class="pdel" data-pdel="${p.id}">usuń</small></span></button><button class="act${on ? "" : " pr"}" data-go="${p.id}">${on ? "Pokaż" : last?.id === p.id ? "Wznów" : "Idę tą trasą"}</button></div>`; }).join("")}</div>`
      : "");
    el.innerHTML = html || "";
    if (!list.length) el.insertAdjacentHTML("beforeend", `<p class="muted small">Zapisane trasy pojawią się tutaj.</p>`);
    el.querySelector("[data-trips]").onclick = () => { C.drawer(false); C.tripsMenu?.(); };
    const om = el.querySelector("[data-onmap]"); // the saved plans on the map, or not
    if (om) om.onclick = () => { const v = !C.plansOnMap(); C.plansOnMap(v); om.classList.toggle("on", v); om.setAttribute("aria-pressed", v); };
    el.querySelectorAll("[data-plan]").forEach((b) => (b.onclick = (e) => {
      const del = e.target.closest("[data-pdel]");
      if (del) { e.stopPropagation(); if (confirm("Usunąć ten plan?")) { storePlans(loadPlans().filter((p) => p.id !== del.dataset.pdel)); renderPlans(); C.onSaved?.(); } return; }
      const p = loadPlans().find((q) => q.id === b.dataset.plan);
      if (p) { C.drawer(false); openSaved(p); }
    }));
    el.querySelectorAll("[data-go]").forEach((b) => (b.onclick = () => { const p = loadPlans().find((q) => q.id === b.dataset.go); if (p) { C.drawer(false); openSaved(p, true); } }));
  }

  // ---- a loop started from a car park: the ones near it, the way to the loop's nearest place; the loop's shape
  // and direction kept, only stretched to there and back
  const isLoopNow = () => { const P = plan?.pts || [], n = P.length; return n > 2 && Math.hypot(P[0].x - P[n - 1].x, P[0].y - P[n - 1].y) < 60; };
  const parkName = (c) => c.n || (c.town ? `Parking · ${c.town}` : "Parking");
  function closeParks() { ui.park = null; C.view.setCands?.(null); }
  async function findParks() {
    if (!route?.line?.length || !isLoopNow()) return;
    ui.park = { busy: true }; render();
    const my = route, r = await C.call("parkingsFor", { line: Array.from(route.line, Math.round), opts: opts() }).catch(() => null);
    if (route !== my || !ui.park) return;
    const list = (r?.parks || []).map((c) => ({ ...c, ms: c.std ? C.routeTime(c).ms : 0 })).sort((a, b) => a.ms - b.ms).slice(0, 4);
    ui.park = { list };
    const lab = (c) => (c.ms ? `+${C.hm(2 * c.ms).replace(" h", "")}` : "na trasie");
    C.view.setCands?.(list.map((c) => ({ x: c.x, y: c.y, t: lab(c), line: c.line })));
    render(); C.sheet("mid");
    setTimeout(() => C.$("tip").querySelector(".plan .ppark")?.scrollIntoView({ block: "center", behavior: "smooth" }), 260);
    if (list.length) { // the loop and the car parks in view
      const xs = [...list.map((c) => c.x)], ys = [...list.map((c) => c.y)];
      for (let i = 0; i < route.line.length; i += 2) { xs.push(route.line[i]); ys.push(route.line[i + 1]); }
      C.flyView?.(() => C.fitAbove(Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)));
    }
  }
  function parkHtml() {
    const P = ui.park;
    let h = `<div class="ppark"><div class="pph"><b>Start z parkingu</b><button class="act ic" data-act="parkx" aria-label="Zamknij"><svg><use href="#i-x"/></svg></button></div>`;
    if (P.busy) h += `<div class="muted">Szukam parkingów przy pętli…</div>`;
    else if (!P.list.length) h += `<div class="muted">Brak parkingów do 4 km od pętli.</div>`;
    else h += P.list.map((c, i) => `<button class="prk" data-act="park${i}"><i>P</i><span><b>${esc(parkName(c))}</b><small>${c.ms ? `+${C.hm(2 * c.ms)} · ${C.nf(2 * c.km)} km tam i z powrotem` : "przy samej pętli"}</small></span></button>`).join("");
    return h + "</div>";
  }
  function useParking(i) {
    const c = ui.park?.list?.[i];
    if (!c || !route?.bounds || !isLoopNow()) return;
    keep();
    const base = plan.pts.slice(0, -1).map((q) => ({ ...q })), m = base.length;
    let k = 0; while (k < route.bounds.length - 2 && route.bounds[k + 1] <= c.s) k++; // the leg the loop is joined on
    // the loop from where the way from the car park meets it: one of its points when that is right there
    // (along the route: the points as the route met them, not where they were tapped)
    const rot = (i) => [...base.slice(i), ...base.slice(0, i)], B = route.bounds;
    const i0 = Math.abs(c.s - B[k]) < 80 ? k : Math.abs(B[k + 1] - c.s) < 80 ? (k + 1) % m : -1;
    const ring = i0 >= 0 ? rot(i0) : [{ x: c.jx, y: c.jy, n: null }, ...rot((k + 1) % m)];
    const back = { ...ring[0] }; // (the way back into it: as the loop came to it)
    ring[0] = { ...ring[0], via: null };
    const park = { x: c.x, y: c.y, n: parkName(c) };
    plan.pts = c.d < 30 ? [{ ...park }, ...ring.slice(1), { ...back, ...park }] : [park, ...ring, back, { ...park, via: null }];
    if (c.d >= 30 && i0 < 0) { nameIt(plan.pts[1]); nameIt(plan.pts[plan.pts.length - 2]); }
    closeParks();
    C.haptic.tick(); render(); recompute();
  }

  // ---- GPX for the watch
  function gpx() {
    if (!route?.line?.length) return;
    const name = plan.name || defaultName(), pts = [], L = route.line, P = route.P;
    // heights from the plan's profile (the watch's climb view needs them), by the distance along the line
    const eleAt = (d) => { const h = P?.h?.[Math.min(P.h.length - 1, Math.max(0, Math.round(d / P.step)))]; return Number.isFinite(h) ? `<ele>${h.toFixed(1)}</ele>` : ""; };
    let d = 0, last = "";
    for (let i = 0; i < L.length; i += 2) {
      if (i) d += Math.hypot(L[i] - L[i - 2], L[i + 1] - L[i - 1]);
      const [lon, lat] = C.unproject(L[i], L[i + 1]), at = `lat="${lat.toFixed(6)}" lon="${lon.toFixed(6)}"`;
      if (at === last) continue; // the legs' joins: one point, not two
      last = at; pts.push(`<trkpt ${at}>${eleAt(d)}</trkpt>`);
    }
    const wpts = plan.pts.map((q, i) => { const [lon, lat] = C.unproject(q.x, q.y), b = route.bounds?.[i]; return `<wpt lat="${lat.toFixed(6)}" lon="${lon.toFixed(6)}">${b != null ? eleAt(b) : ""}<name>${esc(q.n || q.near?.n || word(i, plan.pts.length))}</name></wpt>`; }).join("\n");
    const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="Zdrapka górska" xmlns="http://www.topografix.com/GPX/1/1">\n<metadata><name>${esc(name)}</name></metadata>\n${wpts}\n<trk><name>${esc(name)}</name><trkseg>\n${pts.join("\n")}\n</trkseg></trk>\n</gpx>\n`;
    const file = name.replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-|-$/g, "").toLowerCase() || "trasa";
    // into Garmin Connect as a course (its share target takes places only, not files); in a browser: shared
    import("./native.js").then(({ openGpx }) => openGpx(`${file}.gpx`, xml))
      .then((r) => { if (!r) C.shareBlob(new Blob([xml], { type: "application/gpx+xml" }), `${file}.gpx`, name); else if (r.app === "garmin") C.toast("W Garmin Connect: zapisz trasę i wyślij na zegarek", 4000); })
      .catch(() => C.shareBlob(new Blob([xml], { type: "application/gpx+xml" }), `${file}.gpx`, name));
  }

  // ---- me on the profile: where the GPS puts me along the route (when I am on it, within a tolerance)
  let prof = null, me = null, meIdx = null, lastMe = null; // lastMe: the last fix, not fresh (no new one standing still)
  function placeMe() {
    const P = route?.P;
    if (!prof || !P || !me || !plan) { prof?.setMe?.(null); return; }
    // (a loop or a figure of eight passes here more than once: the pass that fits where you were and your heading)
    const i = pickPass(P, me, passCtx(act));
    if (i == null) { meIdx = null; prof.setMe(null); offNow(true); return; }
    meIdx = i; if (act) act.at = { i, t: Date.now() };
    prof.setMe(i); offNow(false);
  }
  /** What pickPass knows of you: the last place matched on the route (kept while off it, and over a restart:
   * act.at), the furthest point reached, your heading. */
  const passCtx = (A, cur = A === bg?.act ? bg.meIdx : meIdx) => ({ at: A?.at || (cur != null ? { i: cur, t: Date.now() } : null), maxIdx: A?.maxIdx || 0, heading: hdg && Date.now() - hdg.t < 120_000 ? hdg.a : null, now: Date.now() });
  let hdg = null, hdgFrom = null; // your heading from the fixes (once you moved 20 m): {a, t}
  function heading(p) {
    if (!p) return;
    if (!hdgFrom) { hdgFrom = { x: p.x, y: p.y }; return; }
    const dx = p.x - hdgFrom.x, dy = p.y - hdgFrom.y;
    if (Math.hypot(dx, dy) >= 20) { hdg = { a: Math.atan2(dy, dx), t: Date.now() }; hdgFrom = { x: p.x, y: p.y }; }
  }
  /** On the route or off it changed: the dot on the card (and the figures: from you, or the whole route). */
  function offNow(off) {
    const dot = C.$("tip").querySelector(".plan .kpi.cx .rdot");
    if (dot && dot.classList.contains("off") !== off) setTimeout(() => { if (shown && act) render(); }, 0);
  }
  /** Where I am on the active route (also with its card down): the furthest point reached, the finish. */
  function trackMe() {
    const P = route?.P;
    if (!act || !P || !me) return;
    if (!prof) { meIdx = pickPass(P, me, passCtx(act)); if (meIdx != null) act.at = { i: meIdx, t: Date.now() }; } // (placeMe works the profile; here the same without it)
    if (meIdx == null) return;
    if (meIdx > act.maxIdx) { const step = meIdx - doneAt >= 2 || meIdx < doneAt; act.maxIdx = meIdx; storeActive(); if (step) { doneAt = meIdx; drawMarkers(); prof?.setDone?.(meIdx); } }
    // at the finish (the last ~60 m), having walked over half of it: the route is done
    const last = P.d.length - 1;
    if (P.d[last] - P.d[meIdx] < 60 && act.maxIdx > last * 0.9) { end({ auto: true }); C.toast("Meta", 4000); }
  }
  /** The GPS fix in pack metres {x, y, acc}, or null. */
  function gps(p, last = p) {
    me = p; lastMe = last; heading(p);
    if (bg && me) { const i = bg.route?.P ? pickPass(bg.route.P, me, passCtx(bg.act)) : null; bg.meIdx = i; if (i != null) bg.act.at = { i, t: Date.now() }; if (i != null && i > bg.act.maxIdx) bg.act.maxIdx = i; if (i != null) storeActive(); C.onActive?.(); }
    if (plan) { placeMe(); trackMe(); if (act) { C.onActive?.(); refreshFigures(); grabName(); routeWx(false); } }
  }
  /** The active route's card counts from you: drawn again as you go (every ~20 s at most). */
  let figAt = 0, figIdx = null;
  function refreshFigures() {
    // the four figures at once, in place (cheap); the whole card at most every ~20 s
    const row = shown && act && route?.P && meIdx != null && !figKeep ? C.$("tip").querySelectorAll(".plan .kpi.cx .krow .kc b") : [];
    if (row.length === 4) {
      const v = wayOf(route, meIdx, route.P.d.length - 1);
      [C.hm(v.ms).replace(" h", ""), C.nf(v.km), Math.round(v.up), Math.round(v.down)].forEach((x, i) => (row[i].textContent = x));
    }
    if (!shown || !act || meIdx == null || meIdx === figIdx || Date.now() - figAt < 20000) return;
    if (figKeep) return; // (not under a finger)
    figAt = Date.now(); figIdx = meIdx; render();
  }

  // the phone put away (the screen off) with the route open for changes: shut again, as it is now
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden" && act && !act.locked) doAct("lock"); });
  return { repaint: () => { if (shown && plan) render(); }, canUndo: () => !!plan && shown && undo.length > 0 && !(act && act.locked), undo: () => back(), gps, open, openTo, close, active, editable, show, resume, pill, start, end, undoEnd, along, toward, near: nearAhead, mountToward, mountWay, addToActive, finishAt: (q) => rerouteFromMe(q), nearRoute, rideLift, isActive: () => !!act || !!bg, isShown: () => shown, draft: () => (plan && !act ? { id: plan.id, name: plan.name, pts: plan.pts.map((q) => ({ ...q })) } : null), openOuting, openShared, sharePlan, walking: () => !!act && !!act.locked && shown, drafting: () => !!bg && !act, add, move, drag, pointMenu, closeMenu, listCard, renderPlans, savedLines, keep: keepPlan, openSaved, get points() { return plan?.pts || []; }, get route() { return route; } };
}
