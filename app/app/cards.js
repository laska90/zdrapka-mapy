// the cards: an outing, outings nearby, a point on the map; their actions (one, the rest behind ⋯); the way there from you
// (moved out of app.js: what it needs of the app comes in C, see createX in app.js)
import { shortName } from "./labels.js";
import { badgesOf } from "../core/badges.js";
import { unprojector } from "../core/pack.js";
import { kpiFingers, kpiRow } from "./kpi.js";
import { groundKey } from "./growprof.js";
import { distText } from "../core/hud.js";
import { state } from "./state.js";

export function createCards(C) {
  // a swipe across an outing's card: the one before it (to the right) or after it (to the left), as in the
  // list; not on the profile (its cursor) or the places' row (it scrolls)
  let swipe = null;
  document.addEventListener("pointerdown", (e) => {
    swipe = state.cur?.key?.startsWith("o:") && e.target.closest("#tip") && !e.target.closest(".prof, .oscroll, input") ? { x: e.clientX, y: e.clientY } : null;
  }, true);
  document.addEventListener("pointerup", (e) => {
    const s0 = swipe; swipe = null;
    if (!s0) return;
    const dx = e.clientX - s0.x, dy = e.clientY - s0.y;
    if (Math.abs(dx) < 56 || Math.abs(dy) > Math.abs(dx) * 0.6) return;
    const list = (state.result?.activities || []).filter((q) => !q.outside), i = list.findIndex((q) => `o:${q.id}` === state.cur?.key);
    const q = i >= 0 && list[i + (dx > 0 ? 1 : -1)];
    if (!q) { C.haptic.bump(); return; }
    C.haptic.tick(); C.$("tip").dataset.slide = dx > 0 ? "r" : "l"; setTimeout(() => delete C.$("tip").dataset.slide, 400);
    state.cur = null; // (in its place, not on top: Back still goes to where the first one came from)
    C.selectOuting(q.id);
  });
  function outingCard(a) {
    const places = Object.entries(state.result?.found || {}).filter(([, f]) => f.n && f.outs?.some(([o]) => o === a.id))
      .map(([pid, f]) => ({ pid, f, t: f.outs.find(([o]) => o === a.id)[1] })).sort((x, y) => x.t - y.t);
    // as every card: the name (a pen renames it) and its date under it; the figures in one row over its profile
    // (the same as a plan's; the corner: play it back); what it scratched, the pace; places in a scrolling row
    const when = a.start != null ? new Date(a.start).toLocaleDateString("pl-PL", { weekday: "short", day: "numeric", month: "long", year: "numeric" }) : "bez daty";
    let html = `<div class="ohead"><h4>${a.name || "Wyjście"}</h4><button class="iconbtn pen" aria-label="Zmień nazwę"><svg><use href="#i-pen"/></svg></button></div>`;
    html += `<div class="odate">${when}</div>`;
    const ms = a.start != null && a.end != null ? a.end - a.start : null;
    html += kpiRow({ ms, km: a.km, up: a.ele ? a.asc || 0 : null, down: a.ele ? a.desc || 0 : null }, { cls: "oc", grp: false, label: "Wyjście", corner: `<button class="pcx play" hidden aria-label="Odtwórz trasę"><svg><use href="#i-play"/></svg></button>` });
    html += `<div class="tk onew"></div><div class="tk opl"></div>`;
    if (places.length) html += `<div class="tags oscroll">${places.map((q) => `<button data-p="${q.pid}">${shortName(q.f.n)}</button>`).join("")}</div>`;
    C.openTip(html, () => { if (state.selected !== a.id) return; state.selected = null; C.view.setHighlight(null); C.view.draw(); C.renderOutings(); }, `o:${a.id}`, { label: a.name || "Wyjście", reopen: () => C.selectOuting(a.id, { fit: false }) });
    C.showProfile(a);
    C.fillPace(a);
    // what it scratched: its trails walked for the first time (before it: the outings earlier)
    if (!a.outside) C.call("fresh", { activity: a.id }).then((r) => {
      const el = C.$("tip").querySelector(".onew"), f = r?.fresh;
      if (!el || state.cur?.key !== `o:${a.id}` || !f) return;
      el.innerHTML = f.trailKm >= 0.05 ? `<b class="onewk">+${C.nf(f.trailKm)} km</b> nowych szlaków${f.ranges[0] ? ` · ${C.esc(f.ranges[0].short || f.ranges[0].label)}` : ""}` : "bez nowych szlaków";
    }).catch(() => {});
    // everything else about it behind ⋯ (by hand: its date and its points can change)
    const del = async () => {
      if (!confirm(`Usunąć wyjście „${a.name || "Wyjście"}"?`)) return;
      C.busy("Przeliczam…");
      try { state.selected = null; C.view.setHighlight(null); C.hideTip(); C.render((await C.call("delete", { activity: a.id, settings: state.settings })).result); C.toast("Usunięto", 2500); } finally { C.idle(); }
    };
    addActs([{ icon: "share", label: "Pocztówka", more: !!a.manual, fn: () => C.postcard(a) }, // (alone: in the row, no ⋯ for one)
      ...(a.manual ? [{ icon: "pen", label: "Data i czas", more: true, fn: () => C.editWalked(a) }, { icon: "route", label: "Punkty trasy", more: true, fn: () => C.editWalkedPts(a) }, { icon: "x", label: "Usuń", more: true, fn: del }] : [])]);
    const el = C.$("tip");
    el.querySelector(".pen").onclick = async () => {
      const t = prompt("Nazwa wyjścia (puste = automatyczna):", a.title || a.name || "");
      if (t === null) return;
      await C.call("rename", { activity: a.id, title: t });
      a.title = t.trim() || null; a.name = a.title || a.auto || a.garmin;
      outingCard(a); C.renderOutings();
    };
    el.querySelectorAll("[data-p]").forEach((b) => (b.onclick = () => { const f = state.result.found[b.dataset.p]; C.showTip({ id: b.dataset.p, c: f.c, n: f.n, e: f.e, x: f.x, y: f.y, d: true, f: f.first, v: f.visits, ...(badgesOf(f, C.bpts() || []) || {}) }); C.flyView(() => C.centerFree(f.x, f.y, Math.max(C.view.zl, 8.5))); }));
  }
  C.$("outings").onclick = (e) => {
    const so = e.target.closest("[data-sort]")?.dataset.sort;
    if (so) {
      // the same again: the other way round
      if (so === (state.settings.outingSort || "date")) state.settings.outingAsc = !state.settings.outingAsc; else { state.settings.outingSort = so; state.settings.outingAsc = false; }
      C.saveSettings(); C.renderOutings(); if (so === "pace" || so === "up") C.ensurePaces(); return;
    }
    const id = e.target.closest("[data-o]")?.dataset.o;
    if (id) { C.fromList("outings", "Wyjścia"); C.selectOuting(id); }
  };
  C.$("tip").addEventListener("click", (e) => {
    const id = e.target.closest(".vrow")?.dataset.o;
    if (id) C.selectOuting(id);
    const g = C.goalById(e.target.closest("[data-goal]")?.dataset.goal);
    if (g) C.showGoal(g);
  });
  function nearCard(ids, at) {
    const title = ids.length > 1 ? `Tędy szedłeś ${ids.length}×` : "Tędy szedłeś raz", [x, y] = at.split(",").map(Number);
    C.openTip(`<h4>${title}</h4><div class="tk"><span class="el"></span></div>` + C.visitRows(ids.map((id) => [id, C.outingById(id)?.start ?? 0])), null, `n:${at}`, { label: title, pin: [x, y], reopen: () => nearCard(ids, at) });
    fillElev(`n:${at}`, x, y, (r) => `Wysokość tutaj: ~${r.h} m n.p.m.`);
    addPlanFrom({ x, y, n: null });
  }

  // ---- heights: from the contours of the map pack (the drawing worker has them)
  const elevCache = new Map();
  function elevAt(x, y) {
    const k = `${Math.round(x / 4)},${Math.round(y / 4)}`;
    if (!elevCache.has(k)) {
      elevCache.set(k, C.view.elevAt(x, y).catch(() => null));
      if (elevCache.size > 300) elevCache.delete(elevCache.keys().next().value);
    }
    return elevCache.get(k);
  }
  /** Put the height into the open card's .el once known (if that card is still open). */
  function fillElev(key, x, y, fmt, none = "") {
    elevAt(x, y).then((r) => {
      const el = state.cur?.key === key && C.$("tip").querySelector(".el");
      if (el) el.innerHTML = r ? fmt(r) : none;
    });
  }
  const coordTxt = (lat, lon) => `${Math.abs(lat).toFixed(5)}° ${lat >= 0 ? "N" : "S"}, ${Math.abs(lon).toFixed(5)}° ${lon >= 0 ? "E" : "W"}`;
  /** A tap on the map away from points and walked bands: the height there. */
  function pointCard(x, y) {
    const key = `pt:${Math.round(x)},${Math.round(y)}`, [lon, lat] = unprojector(C.view.meta)(x, y);
    C.openTip(`<h4><span class="sname">…</span><span class="el hel"></span></h4><div class="tk ssub" hidden></div>`, null, key, { label: "Punkt na mapie", pin: [x, y], reopen: () => pointCard(x, y) });
    let known = null; // (at a named place: its own height, not the terrain's guess)
    fillElev(key, x, y, (r) => known ?? `~${r.h} m`, ""); // (the height beside the name, as on a peak's card)
    C.spotName(x, y).then((s) => { // the name of the spot: the place, the trail, or the nearest name
      if (state.cur?.key !== key) return;
      const tip = C.$("tip"), h = tip.querySelector(".sname"), sub = tip.querySelector(".ssub");
      if (h) h.textContent = s.title;
      if (sub) { sub.textContent = s.sub || ""; sub.hidden = !s.sub; }
      if (s.e) { known = `${Math.round(s.e)} m`; const el = tip.querySelector(".el"); if (el) el.textContent = known; }
    });
    addPlanFrom({ x, y, n: null });
    addActs([{ icon: "share", label: "Kopiuj współrzędne", more: true, fn: () => { navigator.clipboard?.writeText(coordTxt(lat, lon)); C.toast("Skopiowano", 1500); } }]);
  }
  /** The card's row of actions, the same look on every card: [{icon, label, fn, primary, more}]. The main one
   * first (primary: amber); the rest (more) behind one ⋯ at the end of the row. */
  function addActs(list) {
    const tip = C.$("tip");
    let row = tip.querySelector(".actrow");
    if (!row) { row = document.createElement("div"); row.className = "actrow"; tip.querySelector(".tx")?.before(row); }
    for (const it of list) {
      const b = document.createElement("button");
      b.className = `act${it.primary ? " toplan" : ""}${it.more ? " am" : ""}`; b.innerHTML = `<svg><use href="#i-${it.icon}"/></svg><span>${it.label}</span>`; b.onclick = it.fn;
      let dots = row.querySelector(".amore");
      if (it.more && !dots) {
        dots = document.createElement("button"); dots.className = "act amore"; dots.setAttribute("aria-label", "Więcej");
        dots.innerHTML = `<svg><use href="#i-dots"/></svg>`; dots.onclick = () => { row.classList.toggle("open"); dots.setAttribute("aria-expanded", row.classList.contains("open")); C.placeToast(); };
        row.append(dots, Object.assign(document.createElement("i"), { className: "abr" })); // (opened: the rest on a line of its own under the row, ⋯ stays last in it, as on the plan's card)
      }
      if (dots) dots.before(b); else row.append(b);
    }
    C.placeToast();
  }
  /** "Trasa stąd" on a place's or a spot's card: planning starts there. With your position on the map:
   * also "Ode mnie tutaj", and the way from you there (time by your pace, km, up, down, its profile). */
  function addPlanFrom(q) {
    if (!q) return;
    { const who = C.friendsWhoHere?.(q), tx = C.$("tip").querySelector(".tx"); if (who) { if (tx) tx.insertAdjacentHTML("beforebegin", who); else C.$("tip").insertAdjacentHTML("beforeend", who); } } // (comparing with friends: who has been here)
    // (only when you are out there: in the mountains of the map and within a day's walk; from home it makes no sense)
    const here = hereFor(q);
    if (C.planner.isActive() && !C.planner.drafting()) {
      // walking a route: the way to here along it (when it is on it, ahead), and a way to add it; nothing here ends the route
      const key = state.cur?.key;
      addActs([{ icon: "plus", label: "Dodaj do trasy", primary: true, fn: () => { C.planner.addToActive(q); C.toast("Dodano do trasy", 2500); } },
        ...(C.planner.nearRoute() ? [{ icon: "finish", label: "Tu meta", fn: () => { C.hideTip(); C.planner.finishAt(q); } }] : [])]);
      alongWay(key, q, here);
    } else addActs([ // one way in: out there, from you to here; else from here (the rest behind ⋯)
      here ? { icon: "route", label: "Trasa", primary: true, fn: () => C.planner.openTo(q, here) } : { icon: "route", label: "Trasa", primary: true, fn: () => C.planner.open(q) },
      ...(here ? [{ icon: "route", label: "Trasa stąd", more: true, fn: () => C.planner.open(q) }] : []),
      { icon: "wx", label: "Pogoda", more: true, fn: () => C.placeWeather(q) }, { icon: "spark", label: "Wycieczki", more: true, fn: () => C.trips.route("place", { x: q.x, y: q.y, n: q.n || null }) }]);
    // (walking the route and the place is ahead on it: "po trasie" says it; the way from you only when it is off the route)
    // (walking a route: the way there on it, above; the way from you only when the place is far from what is ahead)
    if (here && Math.hypot(here.x - q.x, here.y - q.y) > 30 && !(C.planner.isActive() && !C.planner.drafting() && C.planner.near(q.x, q.y))) fromMe(state.cur?.key, here, q);
  }
  /** Walking a route: a place's way there along it (on the route's own profile, from you to it lit; off the route,
   * within 3 km of what is ahead, to where you leave it, then dashed); no way along: the way from you. Any card (a lift's station too). */
  function hereFor(q) {
    const me = C.gps.on && C.gps.fix ? C.gpsXY() : null;
    return me && C.view.onMap(me[0], me[1], 2000) && Math.hypot(me[0] - q.x, me[1] - q.y) < NEAR_ME ? { x: me[0], y: me[1], n: "Moja pozycja" } : null;
  }
  function alongWay(key, q, here = hereFor(q)) {
// the way there on the route's own profile (as on its card): from you to the place lit; off the route
    // (within 3 km of what is ahead) to where you leave it, then the way there dashed
    const near = C.planner.near(q.x, q.y);
    C.planner.toward(q.x, q.y).then((f) => {
      const tip = C.$("tip");
      // (no way along the route, e.g. the side walk over 3 km: the way from you instead; not near, it went below)
      if (!f && near && state.cur?.key === key && here && Math.hypot(here.x - q.x, here.y - q.y) > 30) fromMe(key, here, q);
      if (!f || state.cur?.key !== key || tip.querySelector(".kway.along")) return;
      const box = document.createElement("div"), w = f.way;
      box.className = "kway along";
      box.innerHTML = `<p class="kpil">${f.side ? "po trasie + dojście" : "po trasie"}</p>` + kpiRow({ ms: w.ms, km: w.km, up: w.up, down: w.down }, { lead: `<i class="kfrom"></i>`, label: "Po trasie", key: groundKey(f.route?.P) }) +
        (f.side ? `<p class="kpix">z trasy przy ${C.nf(f.atKm)} km: ${distText(f.side.km * 1000)} dojścia${f.side.up >= 10 ? `, ↑${Math.round(f.side.up)} m` : ""}${f.side.down >= 10 ? `, ↓${Math.round(f.side.down)} m` : ""}</p>` : "");
      const at = tip.querySelector(".actrow");
      (at || tip.querySelector(".tx"))?.before(box);
      const k = box.querySelector(".kpi"), pb = k.querySelector(".gprof");
      if (pb) { pb.classList.add("tow"); C.planner.mountToward(pb, f, kpiFingers(k)); }
      C.placeToast();
    });
  }

  const NEAR_ME = 25000; // m: farther than this from you, no way from you
  /** "Trasa tutaj" (you not out there): from the nearest car park or station within a few km; none: the next long press is the start. */
  async function planTo(q) {
    const s = await C.call("startNear", { x: q.x, y: q.y }).then((r) => r.start).catch(() => null);
    if (!s) { C.planner.openTo(q); return; }
    C.planner.openTo(q, { x: s.x, y: s.y, n: s.n });
    C.toast(`Start: ${s.k === "station" ? "stacja" : "parking"} ${s.n && s.n !== "Parking" ? s.n : ""} (${distText(s.d)} w linii prostej). Przeciągnij start, żeby zacząć gdzie indziej.`.replace("  ", " "), 4500);
  }
  const fromSeq = { n: 0 };
  async function fromMe(key, me, q) {
    const my = ++fromSeq.n;
    state.fromNow = { key, q, at: [me.x, me.y] };
    const r = await C.call("route", { pts: [[me.x, me.y], [q.x, q.y]], opts: state.settings.plan || {} }).then((x) => x.route).catch(() => null);
    if (my !== fromSeq.n || !r || state.cur?.key !== key || !r.km) return;
    const ms = C.routeTime(r).ms;
    const box = document.createElement("div");
    box.className = "kway src";
    box.innerHTML = `<p class="kpil">od Ciebie</p>` + kpiRow({ ms, km: r.km, up: r.up, down: r.down }, { lead: `<i class="kfrom"></i>`, label: "Od Ciebie", prof: !!r.P, key: groundKey(r.P) });
    const tip = C.$("tip"), at = tip.querySelector(".actrow"), old = tip.querySelector(".kway.src");
    if (old) old.replaceWith(box); else (at || tip.querySelector(".tx"))?.before(box);
    const k = box.querySelector(".kpi");
    const fig = kpiFingers(k);
    if (r.P) C.planner.mountWay(k.querySelector(".gprof"), r, (w, kind) => fig(w, kind === "start" ? "me" : kind)); // (it starts at you: a finger, the way from you)
    C.placeToast();
  }

  return { addActs, addPlanFrom, alongWay, coordTxt, elevAt, fillElev, fromMe, nearCard, outingCard, planTo, pointCard };
}
