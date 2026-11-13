// "Dokąd na wycieczkę?": proposals one by one, like cards to swipe. Three starts, one style:
//   from home (by car: car parks within the drive; by train: stations reachable, and back home the same day),
//   from a point (a tap on the map, the planner's first point: loops from there),
//   from where you are (the GPS, today: done before dark).
// The walks come from the worker (tripsFrom: new trails, peaks and places first, not twice the same way);
// here the starts are picked so that each card is unlike the ones before it (another range, another place).

import { dayWeather, fastestHome, koleoUrl, loadTrains, sunTimes, wxIcon } from "./trip.js";
import { glyphURL } from "./glyphs.js";
import { kpiRow } from "./kpi.js";
import { groundKey, mountGrow } from "./growprof.js";

const LENS = { s: [6, 11], m: [11, 17], l: [17, 25], xl: [24, 34] };
const LEN_WORD = { s: "krótka", m: "średnia", l: "długa", xl: "bardzo długa" };
const GO = [60, 90, 120, 150, 180];
const SIGN = ["peak", "hut", "tower", "viewpoint", "waterfall", "ruins", "ferrata", "cave"];
const HOME_LL = { lat: 51.1, lon: 17.03 }; // (no home station given: Wrocław)
import { site as mapsSite } from "./maps.js";
import { shortName } from "./labels.js";
import { state } from "./state.js";

export function createTrips(C) {
  // C: {$, call, openTip, hideTip, sheet, toast, view, fitAbove, flyView, settings, saveSettings, planner, project, unproject,
  //     mapsSite, gpsXY, gpsFix, routeTime, esc, nf, hm, hhmm, shortName, openExternal, haptic}
  let S = null;
  const fromHome = () => S.kind === "home" || S.kind === "to";
  const anyDrive = () => S.kind === "to"; // (a trip to a chosen place: however far it is, you want to get there: no limit on the way there) // (getting there from home: by car or by train) // the session: {kind, from, t0, mode, len, go, starts, shown, i, skip..., next (a promise)}
  const opt = () => (state.settings.trip ||= { mode: "car", len: "m", go: 120, note: true, at: "17:00" });
  const nextSat = (h = 9) => { const d = new Date(); const k = (6 - d.getDay() + 7) % 7 || (d.getHours() >= 12 ? 7 : 0); d.setDate(d.getDate() + k); d.setHours(h, 0, 0, 0); return d.getTime(); };

  // ---- one screen for every way: "Trasa tutaj" (to a place: from home, from me, from a point I show),
  // "Trasa stąd" (from a place: a loop, home by train, on to points I show), the menu (from home or from me)
  const CHOICES = {
    to: [["home", "Z domu"], ["me", "Ode mnie"], ["pick", "Z punktu na mapie"]],
    from: [["loop", "Pętla"], ["train", "Do domu"], ["pick", "Wskażę na mapie"]],
    menu: [["home", "Z domu"], ["me", "Stąd, gdzie jestem"]],
    place: [["loop", "Pętla stąd"], ["home", "Tutaj z domu"], ["train", "Stąd do domu"]],
  };
  const meXY = () => { const p = C.gpsXY(); return p && C.view.onMap(p[0], p[1]) ? { x: p[0], y: p[1], n: "Moja pozycja" } : null; };
  /** entry "to" | "from" | "menu"; q the place (to, from). */
  function route(entry, q = null) {
    const me = meXY(), near = me && q && Math.hypot(me.x - q.x, me.y - q.y) < 25000;
    const choice = entry === "to" ? (near ? "me" : "home") : entry === "from" || entry === "place" ? "loop" : "home";
    pickChoice(entry, q, choice);
  }
  function pickChoice(entry, q, choice) {
    const keep = S && S.entry === entry ? { liked: S.liked } : {};
    if ((entry === "to" || entry === "place") && choice === "home") open(q, true);
    else if ((entry === "from" || entry === "place") && choice === "loop") open(q);
    else if (entry === "menu" && choice === "me") { if (!meXY()) { C.toast("Włącz GPS", 3000); return; } open("me"); }
    else if (entry === "menu") open(null);
    else { // the ones that need no search: the button does it
      S = { kind: "act", entry, q, choice, form: true, shown: [], liked: [], queue: [] };
      renderForm(); C.sheet("peek"); return;
    }
    Object.assign(S, { entry, q, choice }, keep); renderForm();
  }
  function act() {
    const { entry, q, choice } = S;
    const done = () => { S = null; C.hideTip(); C.view.setPlan(null); };
    if (entry === "to" && choice === "me") { const me = meXY(); if (!me) { C.toast("Włącz GPS", 3000); return; } done(); C.planner.openTo(q, me); }
    else if (entry === "to" && choice === "pick") { done(); C.planner.openTo(q); }
    else if ((entry === "from" || entry === "place") && choice === "train") { done(); C.homeByTrain({ x: q.x, y: q.y, n: q.n }); }
    else if (entry === "from" && choice === "pick") { done(); C.planner.open(q); }
  }
  const ACT = { "to:me": ["Prowadź ode mnie", "Jedna trasa z Twojej pozycji, Twoim tempem."], "to:pick": ["Wskaż start na mapie", "Przytrzymaj palec tam, gdzie zaczynasz."],
    "place:train": ["Pokaż pociągi", "Najszybszy powrót z najbliższej stacji, z dojściem do niej."], "from:train": ["Pokaż pociągi", "Najszybszy powrót z najbliższej stacji, z dojściem do niej."], "from:pick": ["Planuj dalej", "Stukaj kolejne punkty; ostatni to meta."] };

  /** Open the proposals: from = null (home), {x, y, n} (a point), or "me" (where you are). */
  async function open(from = null, to = false) {
    const o = opt();
    let kind = from === "me" ? "me" : from ? (to ? "to" : "here") : "home", t0 = kind === "me" ? Date.now() : nextSat();
    let start = from && from !== "me" && !to ? from : null, target = to ? from : null;
    if (kind === "me") { const p = C.gpsXY(); if (!p) { C.toast("Włącz GPS", 3000); return; } start = { x: p[0], y: p[1], n: "Twoja pozycja" }; }
    S = { kind, start, target, t0, mode: kind === "home" || kind === "to" ? o.mode : "walk", len: o.len, go: o.go, upMin: o.upMin ?? null, upMax: o.upMax ?? null, adv: o.upMin != null || o.upMax != null,
      shown: [], i: 0, liked: [], skipStart: new Set(), skipRg: new Set(), tried: new Set(), avoid: new Set(), queue: [], busy: null, done: false, form: true, started: false };
    renderForm(); // (nothing is searched until you ask)
    C.sheet("peek");
  }
  function renderForm() {
    C.view.setPlan(null);
    C.openTip(head() + (S.liked.length ? likedHtml() : ""), onClose, "trip", { label: "Propozycje" });
    wireHead();
  }
  /** "Szukaj tras": the conditions as set; the cards so far stay seen. */
  async function search() {
    const o = opt(), first = !S.started || S.prepMode !== S.mode;
    S.started = true; S.form = false;
    Object.assign(o, { len: S.len, go: S.go, upMin: S.upMin, upMax: S.upMax }); if (fromHome()) o.mode = S.mode; C.saveSettings();
    if (first) {
      S.gen = (S.gen || 0) + 1; S.queue = []; render("Szukam tras…");
      try { await prepare(); } catch (e) { render(`Nie udało się: ${C.esc(e.message || e)}`); return; }
      S.prepMode = S.mode;
    }
    reset();
  }
  const upRange = () => (S.upMin != null || S.upMax != null ? [S.upMin ?? 0, S.upMax ?? 9999] : null);

  // ---- what is needed once: home (trains), the starts with what they promise
  let startsCache = null, stationStarts = null;
  async function prepare() {
    const o = opt(), s = S;
    s.T = null;
    if (fromHome()) {
      try { s.T = await loadTrains(mapsSite()); } catch { s.T = null; }
      const T = s.T, ia = T && state.settings.home?.a ? T.byName.get(state.settings.home.a.toLowerCase()) : null;
      s.home = ia != null ? { lat: T.st[ia][1], lon: T.st[ia][2], i: ia, ib: state.settings.home?.b ? T.byName.get(state.settings.home.b.toLowerCase()) ?? null : null } : { ...HOME_LL, i: null };
      if (s.mode === "train" && (!T || ia == null)) { s.mode = "car"; o.mode = "car"; C.toast(T ? "Pociągiem: najpierw podaj stację domową w ustawieniach" : "Brak rozkładu pociągów: liczę dojazd autem", 3500); }
      if (s.mode === "car") {
        startsCache ||= (await C.call("tripStarts", {})).starts;
        s.starts = startsCache.map((p) => ({ ...p, k: "parking" }));
      } else {
        if (!stationStarts) {
          const on = T.st.map((st, i) => ({ i, n: st[0], xy: C.project(st[2], st[1]) })).filter((q) => C.view.onMap(q.xy[0], q.xy[1]));
          const sc = (await C.call("tripStarts", { pts: on.map((q) => [q.xy[0], q.xy[1], q.n]) })).starts;
          stationStarts = sc.map((p, k) => ({ ...p, n: on[k].n, si: on[k].i, k: "station" }));
        }
        s.starts = stationStarts;
        s.trainsAt = null;
      }
    }
  }

  // ---- getting there and back (from home)
  const llOf = (x, y) => { const [lon, lat] = C.unproject(x, y); return { lat, lon }; };
  const km = (a, b) => Math.hypot((a.lon - b.lon) * Math.cos(a.lat * Math.PI / 180) * 111.3, (a.lat - b.lat) * 111.2);
  const carMin = (p) => 12 + (km(llOf(p.x, p.y), S.home) * 1.3) / 70 * 60;
  function trainsThere() {
    if (S.trainsAt?.t0 === S.t0) return S.trainsAt.res;
    const res = fastestHome(S.T, S.home.i, S.t0, S.starts.map((p) => p.si));
    S.trainsAt = { t0: S.t0, res };
    return res;
  }
  /** Can you get there (and back)? {min, start (ms, walking from), legs?} or null. */
  function goThere(p) {
    if (!fromHome()) return { min: 0, start: S.t0 };
    if (S.mode === "car") { const m = carMin(p); return anyDrive() || m <= S.go ? { min: m, start: S.t0 + m * 60000 } : null; }
    const j = trainsThere()[p.si];
    if (!j || !j.legs.length) return null;
    const ride = (j.arr - j.legs[0].dep) / 60000;
    if (anyDrive() ? j.legs[0].dep - S.t0 > 8 * 3600e3 : ride > S.go || j.legs[0].dep - S.t0 > 3 * 3600e3) return null;
    return { min: ride, start: j.arr + 5 * 60000, legs: j.legs };
  }
  function backHome(endName, ready) {
    const T = S.T, ie = T.byName.get(endName.toLowerCase());
    if (ie == null) return null;
    const r = fastestHome(T, ie, ready, [S.home.i, S.home.ib]), a = r[S.home.i], b = S.home.ib != null ? r[S.home.ib] : null;
    const pick = a && (!b || a.arr <= b.arr + 30 * 60000) ? { to: state.settings.home.a, j: a } : b ? { to: state.settings.home.b, j: b } : null;
    if (!pick || !pick.j.legs.length) return null;
    const late = new Date(S.t0); late.setHours(23, 45, 0, 0);
    return pick.j.arr <= late.getTime() ? pick : null;
  }

  // ---- the next card: a start unlike the last ones, its best walk not seen yet
  const rgOf = (p) => p.rg;
  function nextStart(other = true) {
    const seen = [...S.shown, ...S.queue], recent = seen.slice(-6), per = {}, last = seen[seen.length - 1]; // (the cards waiting count as seen)
    for (const c of seen) per[c.rg] = (per[c.rg] || 0) + 1;
    let best = null, bv = -Infinity;
    for (const p of S.starts) {
      const key = `${Math.round(p.x)},${Math.round(p.y)}`;
      const dT = S.target ? Math.hypot(p.x - S.target.x, p.y - S.target.y) : 0;
      if (S.target ? dT < 300 || dT > Math.min(11000, LENS[S.len][1] * 600) : false) continue;
      if (S.tried.has(key) || S.skipRg.has(rgOf(p)) || (!S.target && (p.v < 1.2 || (other && last && last.rg === p.rg)))) continue;
      if ([...S.skipStart].some(([x, y]) => Math.hypot(p.x - x, p.y - y) < 4000)) continue;
      if (seen.slice(S.target ? 0 : -4).some((c) => Math.hypot(p.x - c.start.x, p.y - c.start.y) < (S.target ? 1500 : 7000))) continue; // (not the same spot again so soon)
      const g = goThere(p);
      if (!g) continue;
      let v = S.target ? 6 - Math.abs(dT / 1000 - LENS[S.len][0] * 0.3) - g.min / 60 : 2 * Math.log1p(p.v) - 0.7 * (per[p.rg] || 0) - g.min / 60 * 0.4 - (last && last.rg === p.rg ? 2 : 0);
      recent.forEach((c, j) => { const w = 0.6 + 0.4 * (j + 1) / recent.length, d = Math.hypot(p.x - c.start.x, p.y - c.start.y); v -= w * ((p.rg === c.rg ? 1.5 : 0) + (d < 8000 ? 3 : d < 18000 ? 1.4 : 0)); });
      v += Math.random() * 0.4; // (not the same order every time)
      if (v > bv) { bv = v; best = { p, g, key }; }
    }
    return best;
  }
  /** Make the next card (from home: tries starts until one gives a walk; from a point: the next walk round it). */
  async function makeCard() {
    const [k0, k1] = LENS[S.len], avoid = [...S.avoid];
    if (!fromHome()) {
      if (!S.pool) {
        S.pool = (await C.call("tripsFrom", { start: S.start, km: [k0 * 0.85, k1 * 1.1], up: upRange(), n: 12, tries: 40, avoid })).trips;
        const [lon, lat] = C.unproject(S.start.x, S.start.y), sun = sunTimes(S.t0, lat, lon);
        S.light = S.kind === "me" && sun.set ? sun.set - 20 * 60000 : null;
      }
      while (S.pool.length) {
        const t = S.pool.shift(), ms = C.routeTime(t).ms;
        if (S.light && S.t0 + ms > S.light) continue;
        if ([...S.shown, ...S.queue].some((c) => sameish(c.t, t))) continue;
        return finish({ t, start: S.start, g: { min: 0, start: S.t0 }, rg: null, ms });
      }
      return null;
    }
    for (let n = 0; n < 14; n++) {
      const b = nextStart() || nextStart(false);
      (S.log ||= []).push(b ? `start ${b.p.n} v=${b.p.v} go=${Math.round(b.g.min)}` : `no start (${S.starts?.length} starts)`);
      if (!b) return null;
      S.tried.add(b.key);
      const p = b.p, ends = S.mode === "train" ? S.starts.filter((q) => q !== p && Math.hypot(q.x - p.x, q.y - p.y) < 14000).map((q) => [q.x, q.y, q.n]) : [];
      const nm = (towns) => C.call("nameAt", { x: p.x, y: p.y, R: 4000, towns }).then((r) => r.place?.n).catch(() => null);
      const st = { x: p.x, y: p.y, n: (p.n && p.n.length > 3 && p.n.length <= 28 ? p.n : null) || (S.mode === "car" && (await nm(true))) || (await nm(false)) || "parking" };
      if (S.mode === "car" && !/parking/i.test(st.n)) st.n = `parking, ${st.n}`;
      const ts = (await C.call("tripsFrom", { start: st, km: [k0, k1], up: upRange(), ends, n: S.target ? 2 : 3, avoid, must: S.target ? { x: S.target.x, y: S.target.y, n: S.target.n } : null }).catch(() => ({ trips: [] }))).trips;
      S.log.push(`  ${ts.length} trips`);
      for (const t of ts) {
        if ([...S.shown, ...S.queue].some((c) => sameish(c.t, t))) continue;
        const ms = C.routeTime(t).ms, c = { t, start: st, g: b.g, rg: p.rg, ms };
        if (S.mode === "train") {
          const end = t.pts[t.pts.length - 1], endName = t.loop ? st.n : end.n;
          c.back = backHome(endName, b.g.start + ms + 15 * 60000);
          if (!c.back) { S.log.push(`  no way back from ${endName}`); continue; }
          c.endName = endName;
        }
        if (await finish(c)) return c;
        break; // (bad weather there: another start)
      }
    }
    return null;
  }
  const sameish = (a, b) => { const own = (p) => !p.home && !(S.target && Math.hypot(p.x - S.target.x, p.y - S.target.y) < 300); const A = new Set(a.places.filter(own).map((p) => p.id)), B = b.places.filter(own); const k = B.filter((p) => A.has(p.id)).length; return k >= Math.max(2, Math.min(A.size, B.length) * 0.6); };
  async function finish(c) {
    const [lon, lat] = C.unproject(c.start.x, c.start.y);
    c.wx = await dayWeather(lat, lon, c.g.start);
    if (c.wx?.bad && fromHome() && !c.forced) { S.badWx = (S.badWx || 0) + 1; if (S.badWx < 6) return null; }
    return c;
  }
  function prefetch() { if (!S.busy && !S.done && !S.form && S.queue.length < 2) { const s = S, gen = S.gen; S.busy = makeCard().then((c) => { if (s !== S) return; S.busy = null; if (gen !== S.gen) { prefetch(); return; } if (c) S.queue.push(c); else S.done = true; if (S.waiting) { S.waiting = false; advance(); } else prefetch(); }).catch(() => { if (s === S) { S.busy = null; S.done = true; } }); } }
  function advance() {
    if (!S) return;
    if (S.queue.length) { const c = S.queue.shift(); S.shown.push(c); for (const p of c.t.places) S.avoid.add(p.id); S.i = S.shown.length - 1; show(); prefetch(); return; }
    if (S.done) { S.i = S.shown.length; show(); return; }
    S.waiting = true; render(S.shown.length ? "Szukam kolejnej…" : "Szukam tras…"); prefetch();
  }

  // ---- the card
  const icon = (c) => (SIGN.includes(c) ? `<img src="${glyphURL(c, false)}" alt="">` : "");
  function head() {
    const d = new Date(S.t0), p2 = (v) => String(v).padStart(2, "0");
    if (S.kind === "act") {
      const [btn, hint] = ACT[`${S.entry}:${S.choice}`];
      return `<div class="tq"><div class="thd"><h4>${S.entry === "place" ? "Wycieczki" : S.entry === "to" ? "Trasa na" : "Trasa z"}: ${C.esc(shortName(S.q.n || "punkt na mapie"))}</h4></div>${chips()}<p class="tact">${hint}</p><button class="tsearch" id="tdo">${btn}</button></div>`;
    }
    const title = S.entry === "place" ? `Wycieczki: ${C.esc(shortName((S.q || S.target || S.start).n || "punkt na mapie"))}` : S.entry === "to" ? `Trasa na: ${C.esc(shortName(S.target.n || "to miejsce"))}` : S.entry === "from" ? `Trasa z: ${C.esc(shortName(S.start.n || "punkt na mapie"))}` : S.entry === "menu" ? "Zaplanuj wycieczkę" : S.kind === "to" ? `Wycieczka na: ${C.esc(shortName(S.target.n || "to miejsce"))}` : fromHome() ? "Dokąd na wycieczkę?" : S.kind === "me" ? "Wycieczka stąd, dziś" : `Wycieczka z: ${C.esc(shortName(S.start.n || "punktu na mapie"))}`;
    const pv = `<svg viewBox="0 0 24 24"><path d="M15 6l-6 6 6 6"/></svg>`, nx = `<svg viewBox="0 0 24 24"><path d="M9 6l6 6-6 6"/></svg>`;
    const pager = !S.form && S.shown[S.i] ? `<div class="tpg"><button id="tprev" aria-label="Poprzednia" ${S.i ? "" : "disabled"}>${pv}</button><span>${S.done ? `${S.i + 1} / ${S.shown.length}` : S.i + 1}</span><button id="tnext" aria-label="Następna">${nx}</button></div>` : "";
    let h = `<div class="tq"><div class="thd"><h4>${title}</h4>${pager}</div>`;
    if (!S.form) {
      const day = S.kind === "me" ? "dziś, teraz" : `${d.toLocaleDateString("pl-PL", { weekday: "short", day: "numeric", month: "numeric" })}, ${p2(d.getHours())}:${p2(d.getMinutes())}`;
      const bits = [fromHome() ? (S.mode === "train" ? "pociągiem" : "autem") : "pętle", day, `${LENS[S.len][0]}–${LENS[S.len][1]} km`, fromHome() && !anyDrive() ? `dojazd do ${S.go % 60 ? `${Math.floor(S.go / 60)},5` : S.go / 60} h` : "", upRange() ? `↑ ${S.upMin ?? 0}–${S.upMax ?? "…"} m` : ""].filter(Boolean);
      return h + `<button class="tsum" id="tform"><span>${bits.join(" · ")}</span><b>Zmień</b></button></div>`;
    }
    h += chips();
    if (fromHome()) h += `<div class="tseg" role="group"><button data-m="car" class="${S.mode === "car" ? "on" : ""}">Autem</button><button data-m="train" class="${S.mode === "train" ? "on" : ""}">Pociągiem</button></div>`;
    h += `<div class="trow">${S.kind !== "me" ? `<input id="tday" type="date" value="${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}"><input id="ttime" type="time" step="900" value="${p2(d.getHours())}:${p2(d.getMinutes())}">` : ""}`;
    h += `<select id="tlen" aria-label="Długość">${Object.keys(LENS).map((k) => `<option value="${k}" ${k === S.len ? "selected" : ""}>${LEN_WORD[k]} ${LENS[k][0]}–${LENS[k][1]} km</option>`).join("")}</select>`;
    if (fromHome() && !anyDrive()) h += `<select id="tgo" aria-label="Dojazd">${GO.map((m) => `<option value="${m}" ${m === S.go ? "selected" : ""}>dojazd do ${m % 60 ? `${Math.floor(m / 60)},5` : m / 60} h</option>`).join("")}</select>`;
    h += `</div>`;
    h += `<details class="tadv" id="tadv" ${S.adv ? "open" : ""}><summary><svg><use href="#i-dots"/></svg><span>Więcej opcji</span></summary><div class="trow"><label>podejścia od (m)<input id="tupmin" type="number" min="0" max="3000" step="50" inputmode="numeric" placeholder="dowolnie" value="${S.upMin ?? ""}"></label><label>do (m)<input id="tupmax" type="number" min="0" max="3000" step="50" inputmode="numeric" placeholder="dowolnie" value="${S.upMax ?? ""}"></label></div></details>`;
    h += `<button class="tsearch" id="tsearch">${S.started ? "Szukaj od nowa" : "Szukaj tras"}</button>`;
    if (S.kind === "to") h += `<button class="tme" id="tquick">albo tylko dojście z najbliższego parkingu lub stacji</button>`;

    return h + `</div>`;
  }
  function chips() {
    const list = (CHOICES[S.entry] || []).filter(([k]) => !(k === "me" && !meXY()));
    if (!S.entry || !S.form || list.length < 2) return "";
    return `<div class="tlab">${S.entry === "from" ? "Dokąd" : S.entry === "place" ? "Propozycje" : "Skąd"}</div><div class="tchips" role="group">${list.map(([k, t]) => `<button data-ch="${k}" class="${k === S.choice ? "on" : ""}">${t}</button>`).join("")}</div>`;
  }
  function render(msg) {
    C.openTip(head() + `<div class="tcard tbusy"><div class="tspin"></div><p class="muted">${msg}</p></div>`, onClose, "trip", { label: "Propozycje" });
    wireHead();
  }
  function show() {
    const c = S.shown[S.i];
    if (!c) {
      C.view.setPlan(null);
      C.openTip(head() + `<div class="tcard"><p>${S.shown.length ? "To wszystkie propozycje dla tych warunków." : "Nic nie pasuje do tych warunków."} Zmień długość${fromHome() ? ", dojazd albo dzień" : ""}.</p>${S.liked.length ? likedHtml() : ""}${S.shown.length ? `<button class="pill" id="tagain">Pokaż od początku</button>` : ""}</div>`, onClose, "trip", { label: "Propozycje" });
      wireHead(); C.$("tagain")?.addEventListener("click", () => { S.i = 0; show(); });
      return;
    }
    const t = c.t, esc = C.esc, nf = C.nf, P = t.places.filter((p) => SIGN.includes(p.c)).slice(0, 6);
    const rg = c.rg != null && c.rg >= 0 ? C.view.index?.ranges?.[c.rg] : null;
    const via = t.places.filter((p) => !p.home && ['peak', 'hut', 'tower', 'viewpoint', 'ruins', 'waterfall', 'ferrata'].includes(p.c)).slice(0, 2).map((p) => esc(shortName(p.n)));
    const title = S.kind === "to" ? `${t.loop ? "Pętla z" : "Z"}: ${esc(shortName(c.start.n))}${t.loop ? "" : ` → ${esc(shortName(c.endName || t.pts[t.pts.length - 1].n || "stacja"))}`}` : !fromHome() && via.length ? `${t.loop ? "Pętla" : "Trasa"}: ${via.join(", ")}` : t.loop ? `Pętla z: ${esc(shortName(c.start.n))}` : `${esc(shortName(c.start.n))} → ${esc(shortName(c.endName || t.pts[t.pts.length - 1].n || "stacja"))}`;
    const wx = c.wx ? `<span class="twx${c.wx.bad ? " bad" : ""}">${wxIcon(c.wx.code, true, 22)}${c.wx.bad ? esc(c.wx.bad) : `${Math.round(c.wx.tmax)}°`}</span>` : "";
    let go = "";
    if (fromHome() && S.mode === "car") go = `<div class="tgo"><b>autem ok. ${C.hm(c.g.min * 60000).replace(" h", "")}</b> z domu · start ok. ${C.hhmm(c.g.start)} · powrót przed ${C.hhmm(c.g.start + c.ms + c.g.min * 60000 + 30 * 60000)}</div>`;
    if (fromHome() && S.mode === "train") { const L = c.g.legs, B = c.back.j.legs; go = `<div class="tgo"><b>${C.hhmm(L[0].dep)}</b> ${esc(L[0].label)} → ${esc(shortName(c.start.n))} <b>${C.hhmm(c.g.start - 5 * 60000)}</b>${L.length > 1 ? ` · przesiadka: ${L.slice(1).map((l) => esc(l.from)).join(", ")}` : ""}<br>powrót: <b>${C.hhmm(B[0].dep)}</b> ${esc(B[0].label)} → ${esc(c.back.to)} <b>${C.hhmm(c.back.j.arr)}</b></div>`; }
    if (S.kind === "me") go = `<div class="tgo">ruszasz teraz · na mecie ok. <b>${C.hhmm(S.t0 + c.ms)}</b>${S.light ? ` · zachód ${C.hhmm(S.light + 20 * 60000)}` : ""}</div>`;
    const back = t.twice >= 0.4 ? `<div class="tback">${nf(t.twice)} km tą samą drogą tam i z powrotem</div>` : "";
    const saved = S.liked.some((l) => l.c === c);
    const B = (id, ic, t, cls = "", dis = false) => `<button id="${id}" class="${cls}" ${dis ? "disabled" : ""}>${ic}${t}</button>`;
    const IC = { go: `<svg viewBox="0 0 24 24"><path d="M8 5.5v13l10-6.5Z"/></svg>`, save: `<svg viewBox="0 0 24 24"><path d="M7 3.5h10a1 1 0 0 1 1 1v16l-6-4-6 4v-16a1 1 0 0 1 1-1Z"/></svg>`, next: `<svg viewBox="0 0 24 24"><path d="M5 12h13M13 6l6 6-6 6"/></svg>` };
    let html = head() + `<div class="tc">
      ${rg || wx ? `<div class="ttop"><span class="trg">${esc(rg?.short || rg?.label || "")}</span>${wx}</div>` : ""}
      <h3 class="tname">${title}</h3>
      ${kpiRow({ ms: c.ms, km: t.km, up: t.up, down: t.down }, { label: "Propozycja", extra: t.freshKm > 0.05 ? `<i class="knew" title="nowych km do zdrapania">+${C.nf(t.freshKm)}</i>` : "" })}
      ${t.newPlaces ? `<div class="tnew">${t.newPlaces} ${t.newPlaces === 1 ? "nowe miejsce" : t.newPlaces < 5 ? "nowe miejsca" : "nowych miejsc"} do zdrapania</div>` : ""}
      <div class="tplaces">${P.map((p) => `<span class="${p.got ? "" : "new"}${p.badge ? " bd" : ""}">${icon(p.c)}${esc(shortName(p.n))}${p.c === "peak" && p.e ? ` <small>${Math.round(p.e)}</small>` : ""}${p.got ? "" : "<i></i>"}</span>`).join("")}</div>
      ${back}${go}
      ${fromHome() && S.mode === "train" && S.T ? `<a href="#" class="tkoleo" id="tkoleo">Bilet w Koleo</a>` : ""}
    </div>
    <div class="pthumb three tbar">${B("tyes", IC.go, "Wybierz", "pr")}${B("tlater", IC.save, saved ? "Zapisane" : "Zapisz", "", saved)}${B("tnext2", IC.next, "Następna")}</div>`;
    C.openTip(html, onClose, "trip", { label: "Propozycje" });
    wireHead(); wireCard(c);
    drawMap(c);
    // its profile: as the plan's (the same drawing on every card)
    const H = t.h || [], st = (t.km * 1000) / Math.max(1, H.length - 1), box = C.$("tip").querySelector(".tc .kpi .gprof");
    if (box && H.length >= 2) {
      const h = Float32Array.from(H, (v) => v ?? NaN), d = Float32Array.from(H, (_, k) => k * st), slope = new Float32Array(H.length);
      for (let k = 1; k < H.length; k++) slope[k] = Number.isFinite(h[k]) && Number.isFinite(h[k - 1]) ? (100 * (h[k] - h[k - 1])) / Math.max(1, st) : 0;
      mountGrow(box, { d, h, slope, step: st }, { full: true });
      // then the way itself worked out as the planner does (what is underfoot, the dot on the map under a finger,
      // the places on it): the same drawing, swapped in when it comes, only if it is this card still and the same way
      const my = (show.n = (show.n || 0) + 1);
      C.call("route", { pts: t.pts.map((q) => [q.x, q.y]), opts: { mode: "zalecana", steep: false, roads: false, fresh: false, legs: t.pts.slice(1).map(() => null) } }).then((q) => {
        const r = q?.route, b = C.$("tip").querySelector(".tc .kpi .gprof");
        if (!r?.P || show.n !== my || !b || Math.abs(r.km - t.km) > Math.max(0.3, t.km * 0.04)) return;
        const key = groundKey(r.P); if (key && !b.parentElement.querySelector(".gkey")) b.insertAdjacentHTML("afterend", key);
        C.planner.mountWay(b, r);
      }).catch(() => {});
    } else box?.remove();
  }
  const likedHtml = () => `<div class="tliked muted small">${S.liked.map((l) => `${l.later ? "Odłożone" : "Wzięte"}: <b>${C.esc(l.name)}</b>`).join("<br>")}</div>`;
  function drawMap(c) {
    const t = c.t, line = t.line;
    C.view.setPlan({ runs: [{ line, cols: "", cat: 0 }], pts: t.loop ? [[t.pts[0].x, t.pts[0].y]] : [[t.pts[0].x, t.pts[0].y], [t.pts[t.pts.length - 1].x, t.pts[t.pts.length - 1].y]], labels: [] });
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (let i = 0; i < line.length; i += 2) { x0 = Math.min(x0, line[i]); x1 = Math.max(x1, line[i]); y0 = Math.min(y0, line[i + 1]); y1 = Math.max(y1, line[i + 1]); }
    const fit = () => { const sh = C.$("sheet"), top = Math.min(sh.getBoundingClientRect().top, innerHeight - sh.offsetHeight), v = C.view, T = 70, B = Math.max(T + 120, top - 10), pad = 18;
      v.s = Math.min(Math.max(Math.min((v.W - 2 * pad) / Math.max(1, x1 - x0 + 160), (B - T - 2 * pad) / Math.max(1, y1 - y0 + 160)), 0.0004), 3);
      v.anchor((x0 + x1) / 2, (y0 + y1) / 2, v.W / 2, (T + B) / 2); };
    setTimeout(() => C.flyView(fit), 60); // (once the card is laid out; the sheet may still be sliding)
  }


  // ---- answers
  function onClose() { C.view.setPlan(null); S = null; }
  const nameOf = (c) => { const top = c.t.places.filter((p) => ["peak", "hut", "tower", "viewpoint", "ruins", "waterfall"].includes(p.c)).slice(0, 2).map((p) => shortName(p.n)); return (c.t.loop ? "Pętla" : shortName(c.start.n)) + (top.length ? `: ${top.join(", ")}` : ""); };
  function take(c) {
    const pts = c.t.pts.map((p, i) => ({ x: p.x, y: p.y, n: i === 0 ? c.start.n : i === c.t.pts.length - 1 ? (c.t.loop ? c.start.n : c.endName || p.n) : p.n, ...(i ? { via: { mode: "nieznana", other: true } } : {}) })); // (each leg the way it was found: by new trails, not back the same way)
    const name = nameOf(c);
    S.liked.push({ name });
    C.haptic?.tick?.();
    S = null; C.hideTip(); C.view.setPlan(null);
    C.planner.openSaved({ id: null, name, pts });
  }
  function later(c) {
    const name = nameOf(c);
    C.planner.keep({ name, pts: c.t.pts.map((p, i) => ({ x: p.x, y: p.y, n: i === 0 ? c.start.n : p.n, ...(i ? { via: { mode: "nieznana", other: true } } : {}) })), km: c.t.km, up: c.t.up, line: c.t.line });
    S.liked.push({ name, later: true, c }); C.toast("Zapisano", 2500);
    show();
  }
  function next() { S.i++; if (S.i < S.shown.length) show(); else advance(); }
  function prev() { if (S.i > 0) { S.i--; show(); } }
  function reset() { // the conditions changed: the cards so far stay seen, the next ones by the new conditions
    S.gen = (S.gen || 0) + 1; S.queue = []; S.done = false; S.pool = null; S.tried.clear(); S.badWx = 0; S.trainsAt = null; S.i = S.shown.length;
    S.waiting = true; render("Szukam tras…"); if (!S.busy) prefetch();
  }
  function wireHead() {
    const $ = C.$, o = opt();
    $("tip").querySelectorAll(".tchips [data-ch]").forEach((b) => (b.onclick = () => { if (b.dataset.ch !== S.choice) pickChoice(S.entry, S.q || S.target || S.start || null, b.dataset.ch); }));
    $("tdo")?.addEventListener("click", act);
    void o;
    // the conditions are only noted here; "Szukaj tras" searches
    $("tip").querySelectorAll(".tseg [data-m]").forEach((b) => (b.onclick = () => { if (S.mode === b.dataset.m) return; S.mode = b.dataset.m; if (S.started) { S.shown = []; S.liked = []; } renderForm(); }));
    $("tme")?.addEventListener("click", () => open("me"));
    $("tquick")?.addEventListener("click", () => { const q = S.target; S = null; C.hideTip(); C.view.setPlan(null); C.planTo(q); });
    $("tprev")?.addEventListener("click", prev); $("tnext")?.addEventListener("click", next);
    $("tform")?.addEventListener("click", () => { S.form = true; S.gen = (S.gen || 0) + 1; S.waiting = false; renderForm(); });
    if (!$("tlen")) return;
    const when = () => { const t = new Date(`${$("tday").value}T${$("ttime").value || "09:00"}`).getTime(); if (Number.isFinite(t)) S.t0 = t; };
    if ($("tday")) { $("tday").onchange = when; $("ttime").onchange = when; }
    $("tlen").onchange = () => { S.len = $("tlen").value; };
    if ($("tgo")) $("tgo").onchange = () => { S.go = +$("tgo").value; };
    const num = (id) => { const v = $(id).value.trim(); return v === "" ? null : Math.max(0, Math.round(+v)); };
    $("tadv").ontoggle = () => { S.adv = $("tadv").open; };
    $("tsearch").onclick = () => { S.upMin = num("tupmin"); S.upMax = num("tupmax"); if (S.upMin != null && S.upMax != null && S.upMin > S.upMax) [S.upMin, S.upMax] = [S.upMax, S.upMin]; search(); };
  }
  function wireCard(c) {
    const $ = C.$;
    $("tyes").onclick = () => take(c); $("tlater").onclick = () => later(c); $("tnext2").onclick = next;
    $("tkoleo")?.addEventListener("click", (e) => { e.preventDefault(); const L = c.g.legs[0]; C.openExternal(koleoUrl(L.from, c.start.n, L.dep - 60000)); });
  }


  /** The Friday reminder's words: the best walk for the coming Saturday (from home), worked out quietly. */
  async function weekly() {
    const o = opt(), keep = S;
    if (keep) return null;
    const mine = S = { kind: "home", target: null, t0: nextSat(), mode: o.mode, len: o.len, go: o.go, upMin: o.upMin ?? null, upMax: o.upMax ?? null, shown: [], liked: [], skipStart: new Set(), skipRg: new Set(), tried: new Set(), avoid: new Set(), queue: [] };
    try {
      await prepare();
      const c = await makeCard();
      if (!c) return null;
      const t = c.t, nw = t.places.filter((p) => !p.got && SIGN.includes(p.c)).slice(0, 2).map((p) => shortName(p.n));
      return { title: `Na sobotę: ${t.loop ? "pętla z " : ""}${shortName(c.start.n).replace(/^parking, /, "")}`, body: `${C.nf(t.km)} km · ↑${t.up} m · ${C.hm(c.ms).replace(" h", " h marszu")}${nw.length ? ` · nowe: ${nw.join(", ")}` : t.freshKm >= 1 ? ` · ${C.nf(t.freshKm)} km nowych szlaków` : ""}. Dotknij, żeby zobaczyć propozycje.` };
    } catch { return null; } finally { if (S === mine) S = null; }
  }
  return { open, route, weekly, isOpen: () => !!S, debug: () => S?.log };
}
