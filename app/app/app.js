// App shell: wires the map, the worker and the UI together; app/state.js holds what changes while it runs.

import { outside } from "../core/hud.js";
import { projector, unprojector } from "../core/pack.js";
import { mark, note } from "./diag.js";
import { packList, packUrl } from "../core/packs.js";
import { site as mapsSite } from "./maps.js";
import { MapView, absSpec } from "./glmap.js";
import { glyphKey, glyphURL } from "./glyphs.js";
import * as haptic from "./haptics.js";
import { configureBackground, configureTrip, isNative, native } from "./native.js";
import { createPlanner } from "./planner.js";
import { see } from "./seen.js";
import { state } from "./state.js";
import { createTrips } from "./trips.js";

// the parts: each is createX(C), C being ctx below plus what the parts give back
import { createAdvanced } from "./advanced.js";
import { createBackup } from "./backup.js";
import { createFriends } from "./friends.js";
import { createAccount } from "./account.js";
import { createCloudSync } from "./cloudsync.js";
import { createCards } from "./cards.js";
import { createDrawer } from "./drawer.js";
import { createGarmin } from "./garmin.js";
import { createGestures } from "./gestures.js";
import { createGoals } from "./goals.js";
import { createGpsUi } from "./gpsui.js";
import { createIncoming } from "./incoming.js";
import { createLayers } from "./layers.js";
import { createMapsUi } from "./maps-ui.js";
import { createOutings } from "./outings.js";
import { createPace } from "./pace.js";
import { createPill } from "./pill.js";
import { createPlay } from "./play.js";
import { createPostcard } from "./postcard.js";
import { createProgress } from "./progress.js";
import { createSearch } from "./search.js";
import { createSettings } from "./settings.js";
import { createSheet } from "./sheet.js";
import { createSos } from "./sos.js";
import { createSpotName } from "./spotname.js";
import { createLifts } from "./lifts.js";
import { createSlope } from "./slopeview.js";
import { createTrain } from "./train.js";
import { createWalked } from "./walked.js";
import { createWeather } from "./weather.js";
import { createYear } from "./year.js";

function badgeIcon(B) { return `bdg-${B.id}`; } // each badge its own icon (vignettes.js)

mark("skrypt aplikacji");
function $(id) { return document.getElementById(id); }
/** A point's sign as on the map, with its booklets' medals. */
function pointIcon(p, d) { return glyphURL(glyphKey(p), d); }
function nf(v, d = 1) { return v.toLocaleString("pl-PL", { minimumFractionDigits: d, maximumFractionDigits: d }); }
function fold(t) { return (t || "").toLocaleLowerCase("pl").normalize("NFD").replace(/\p{M}/gu, "").replace(/ł/g, "l"); }
function esc(t) { return String(t).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]); }

let seq = 0;
let redrawT = 0;
let naming = false;
let backAt = 0;
let stampLoad = null;
let bgLine = null;

// ---- the app as its parts see it: app.js's own names here as getters (read when used, so the order of
// the code does not matter); each part adds what it gives (Object.assign(ctx, createX(ctx)))
const ctx = {
  get repaintPlan() { return () => planner.repaint(); }, // (friends on or off: the plan's time again)
  get $() { return $; },
  get AREA() { return AREA; },
  get badgeIcon() { return badgeIcon; },
  get busy() { return busy; },
  get call() { return call; },
  get centerFree() { return centerFree; },
  get esc() { return esc; },
  get fitAbove() { return fitAbove; },
  get flyView() { return flyView; },
  get fold() { return fold; },
  get fullDraw() { return fullDraw; },
  get haptic() { return haptic; },
  get hashOf() { return hashOf; },
  get hhmm() { return hhmm; },
  get hm() { return hm; },
  get idle() { return idle; },
  get keepVisible() { return keepVisible; },
  get loadStamps() { return loadStamps; },
  get osmClosures() { return osmClosures; },
  get noticeList() { return noticeList; },
  get nf() { return nf; },
  get pct() { return pct; },
  get placeToast() { return placeToast; },
  get planner() { return planner; },
  get pointIcon() { return pointIcon; },
  get render() { return render; },
  get ROUTE_INFO() { return ROUTE_INFO; },
  get saveSettings() { return saveSettings; },
  get SETTINGS_KEY() { return SETTINGS_KEY; },
  get showSaved() { return showSaved; },
  get stampRec() { return stampRec; },
  get toast() { return toast; },
  get touching() { return touching; },
  get tripReminder() { return tripReminder; },
  get trips() { return trips; },
  get undoToast() { return undoToast; },
  get view() { return view; },
  get work() { return work; },
};

// ---- settings (this device only)
const SETTINGS_KEY = "scratchcard.settings";
try { state.settings = { ...state.settings, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}") }; } catch { /* private mode */ }
// the map's view: Zdrapka (fog), Ślady (no fog, your traces), Mapa (plain); the old "Mgła" and "Moje ślady" switches fold into it, the icons are always on
if (state.settings.mode === "map" && state.settings.traces !== false && "traces" in state.settings) state.settings.mode = "trace";
if (!["fog", "trace", "map"].includes(state.settings.mode)) state.settings.mode = "fog";
// what is noted, not chosen, lives in seen.js now; options that are gone (made automatic or removed) go
for (const k of ["planNudges", "mapSeen", "levels"]) if (k in state.settings) { see(k, state.settings[k]); delete state.settings[k]; }
for (const k of ["zones", "accent", "relief", "lastMode", "pcFormat", "pcEnds", "lift", "sharp", "lite", "countMode", "clean", "outingSrc", "planHelp", "onbSkip", "plansV", "traces", "icons"]) delete state.settings[k];
function saveSettings() { try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(state.settings)); } catch { /* ignore */ } }

// ---- worker RPC
const worker = new Worker(new URL("./worker.js", import.meta.url), { type: "module" });
const pending = new Map();
worker.onmessage = (e) => {
  const { id, progress, ...rest } = e.data, p = pending.get(id);
  if (!p) return;
  if (progress) return p.onProgress?.(progress);
  pending.delete(id);
  rest.ok ? p.resolve(rest) : p.reject(new Error(rest.error));
};
function call(type, msg = {}, onProgress) { return new Promise((resolve, reject) => { const id = ++seq; pending.set(id, { resolve, reject, onProgress }); worker.postMessage({ id, type, ...msg }); }); }

// ---- map
const view = new MapView($("map"));
// a start that never got to calm (the WebView went down - most likely memory, the first start on new
// maps matches every outing again) makes the next one careful: lighter drawing, no backdrop
const BOOT = "zdrapka.boot";
try {
  const b = JSON.parse(localStorage.getItem(BOOT) || "null");
  state.careful = !!b && Date.now() - b.t < 15 * 60 * 1000;
  localStorage.setItem(BOOT, JSON.stringify({ t: Date.now(), n: (b?.n || 0) + 1 }));
} catch { /* no storage: as usual */ }
function calm() { try { localStorage.removeItem(BOOT); } catch { /* none */ } }
// (put away after the outings were shown: that start went fine too)
document.addEventListener("visibilitychange", () => { if (document.hidden && state.result) calm(); });
if (state.careful) view.setLite(true);
globalThis.__view = view; // for debugging / profiling
globalThis.__call = (t, m) => call(t, m); // the same, for the worker
globalThis.__plan = () => planner; // for tests
globalThis.__tip = (p) => ctx.showTip(p); // for tests
globalThis.__sheet = (s) => ctx.sheet(s); // for tests
// full redraws (tiles arriving, gesture ends) wait until no finger is on the map
function touching() { return state.ptrs.size > 0; }
function fullDraw(ms) { clearTimeout(redrawT); redrawT = setTimeout(function go() { if (touching()) redrawT = setTimeout(go, 120); else view.draw(); }, ms); }
view.hooks.redraw = () => fullDraw(250); // batch tiles arriving one after another
// the nearest goal: at most every 0.3 s while the map moves, but always (redraws keep coming while tiles load)
view.hooks.frame = () => { ctx.updateScale(); ctx.updateGpsPill(); ctx.updateCompass(); view.qgT ||= setTimeout(() => { view.qgT = 0; ctx.fillQuickGoal(); }, 300); };
view.hooks.busy = () => touching(); // background slices of the frame wait for the fingers
/** The words for the map's area: the Sudetes alone (as from the start), or several mountains. */
const AREA = {
  one: () => (view.meta?.region || "sudety") === "sudety",
  nom: () => (AREA.one() ? "Sudety" : "Góry"), acc: () => (AREA.one() ? "Sudety" : "góry"),
  gen: () => (AREA.one() ? "Sudetów" : "na mapie"), loc: () => (AREA.one() ? "w Sudetach" : "w górach"),
};
const ROUTE_INFO = {
  gss: "czerwony szlak przez całe Sudety, ze Świeradowa-Zdroju do Prudnika",
  gsb: "czerwony szlak przez polskie Beskidy, z Ustronia do Wołosatego",
  msb: "czerwony szlak z Bielska-Białej (Straconki) na Luboń Wielki",
  snp: "czerwony szlak przez całą Słowację; liczą się jego odcinki na Twojej mapie (Fatry, Niżne Tatry)",
  mag: "czerwony szlak przez słowackie Tatry, od Podbańskiej po Tatrzańską Kotlinę",
};

function busy(msg) { $("loadmsg").textContent = msg; $("loading").hidden = false; }
function idle() { $("loading").hidden = true; $("loading").classList.remove("splash"); }
/** Height of the sheet's visible strip: the buttons, toasts and attribution sit above it. */
function placeToast() {
  const sh = $("sheet");
  // a card that is all in sight (a place's, a spot's): pulling it up gives nothing, so no handle to pull
  sh.classList.toggle("nogrow", !!sh.dataset.tip && !$("tip").querySelector("div.plan") && ctx.peekHeight() < innerHeight * 0.62);
  if (sh.dataset.state === "open" || sh.classList.contains("dragging")) return;
  const st = sh.dataset.state;
  ctx.setStrip(st === "hidden" ? ctx.hiddenHeight() : st === "min" ? ctx.minHeight() : st === "mid" ? ctx.midHeight() ?? ctx.peekHeight() : ctx.peekHeight());
}
/** A message with "Cofnij" (a change to the plan): fn undoes it. */
function undoToast(msg, fn, ms = 4500, label = "Cofnij") {
  toast(msg, ms);
  const t = $("toast"), b = document.createElement("button");
  b.className = "tundo"; b.textContent = label;
  b.onclick = () => { t.hidden = true; fn(); };
  t.append(" ", b);
}
function toast(msg, ms = 4500) {
  const t = $("toast");
  t.textContent = msg; t.hidden = false; placeToast(); clearTimeout(toast.t); toast.t = setTimeout(() => (t.hidden = true), ms); }

// ---- framing the map: a flight to a view, a box or a point in the part left free by the top bar and the sheet
/** A duration as h:mm h. */
function hm(ms) { const m = Math.round(ms / 60000); return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, "0")} h`; }
/** Fly to the view a setter makes (it changes view.s/ox/oy; nothing is drawn until the flight lands). */
function flyView(set) {
  const from = ctx.viewNow();
  set();
  const to = ctx.viewNow();
  Object.assign(view, from);
  return view.flyTo(to);
}
/** Fit a box (pack metres) into the map left visible between the top bar and the sheet. */
function fitAbove(x0, y0, x1, y1) {
  const peek = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--sheet-peek")) || 84;
  const top = 64, bottom = Math.max(top + 160, view.H - peek - 14), pad = 26, m = 120;
  view.s = Math.min(Math.max(Math.min((view.W - 2 * pad) / Math.max(1, x1 - x0 + 2 * m), (bottom - top - 2 * pad) / Math.max(1, y1 - y0 + 2 * m)), 0.0004), 3);
  view.anchor((x0 + x1) / 2, (y0 + y1) / 2, view.W / 2, (top + bottom) / 2);
}
/** Centre a point (pack metres) in the map left free between the top bar and the sheet, at zoom zl. */
function centerFree(x, y, zl = 8.2) {
  const peek = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--sheet-peek")) || 84;
  const top = 64, bottom = Math.max(top + 120, view.H - peek - 10);
  view.s = 2 ** zl / 1000; view.anchor(x, y, view.W / 2, (top + bottom) / 2);
}
/** Keep a map point on screen (above the sheet) while the profile cursor moves. */
function keepVisible(x, y) {
  const peek = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--sheet-peek")) || 84;
  const [X, Y] = view.toScreen(x, y), top = 70, bottom = view.H - peek - 20;
  let dx = 0, dy = 0;
  if (X < 24) dx = 24 - X; else if (X > view.W - 24) dx = view.W - 24 - X;
  if (Y < top) dy = top - Y; else if (Y > bottom) dy = bottom - Y;
  if (dx || dy) { view.pan(dx, dy); view.quick(); clearTimeout(keepVisible.t); keepVisible.t = setTimeout(() => view.draw(), 200); }
}
// ---- work in the background (route names, the pace, heights): one small pill, so the figures moving meanwhile make sense
const jobs = new Map();
function work(id, label) {
  if (label) jobs.set(id, label); else jobs.delete(id);
  const el = $("work"), last = [...jobs.values()].at(-1);
  el.hidden = !last; if (last) el.lastElementChild.textContent = last;
}

function render(res, { fit = false } = {}) {
  state.result = res;
  note(`wyniki: ${res.activities?.length ?? 0} wyjść, analiza ${Math.round(res.ms ?? 0)} ms, dopasowano ${res.matched ?? 0}`);
  view.setResults(res);
  if (fit) fitToTracks();
  view.draw();
  ctx.renderCard();
  ctx.checkThresholds(res);
  ctx.renderJournal();
  clearTimeout(render.pace); render.pace = setTimeout(ctx.ensurePaces, 3000); // the pace of new outings, in the background
  ctx.renderOutings();
  nameOutings();
}

/** Route names come from the worker a moment after the results (first time: all at once). */
async function nameOutings() {
  if (naming || !state.result?.activities?.some((a) => !a.auto)) return;
  naming = true;
  work("names", "Nazywam trasy…");
  try {
    const { names } = await call("names");
    let n = 0;
    for (const a of state.result.activities) if (a.id in names) { a.auto = names[a.id]; if (!a.title) a.name = a.auto || a.garmin; n++; }
    if (n) { ctx.renderOutings(); const s = ctx.outingById(state.selected); if (s) ctx.outingCard(s); }
  } catch (e) { console.warn("names", e); } finally { naming = false; work("names"); }
}

function fitToTracks() {
  let r = state.result?.reveal || [];
  if (!r.length) return view.fitRegion();
  // several packs: the sheet with most of the outings (the box around all of them would be the empty land between)
  const sheets = view.SHS || [view.SH];
  if (sheets.length > 1) {
    const inS = (q, [a, b, c, d]) => q[0] >= a && q[0] <= c && q[1] >= b && q[1] <= d;
    const best = sheets.map((S) => r.filter((q) => inS(q, S))).sort((a, b) => b.length - a.length)[0];
    if (best.length) r = best;
  }
  // the area where most of the outings are (the 5th to 95th percentile, so one far trip does not stretch it)
  const xs = r.map((q) => q[0]).sort((a, b) => a - b), ys = r.map((q) => q[1]).sort((a, b) => a - b), at = (a, p) => a[Math.min(a.length - 1, Math.max(0, Math.round(p * (a.length - 1))))];
  const x0 = at(xs, 0.05), x1 = at(xs, 0.95), y0 = at(ys, 0.05), y1 = at(ys, 0.95), m = 1500;
  view.fitBox(x0 - m, y0 - m, x1 + m, y1 + m);
  // on a portrait phone the whole region is a thin strip with empty grey above and below it:
  // zoom in until its sheet fills the height (the search bar and the panel cover the last bit), on the middle of the outings
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, S = sheets.find(([a, b, c, d]) => cx >= a && cx <= c && cy >= b && cy <= d) || view.SH;
  const [sx0, sy0, sx1, sy1] = S, need = (0.8 * view.H) / (sy1 - sy0);
  if (view.s < need) {
    view.s = need;
    view.ox = view.W / 2 - cx * view.s; view.oy = view.H / 2 - cy * view.s;
    // and not off the sheet
    const vw = view.W / view.s, vh = view.H / view.s, pad = 4000;
    const vx = Math.min(Math.max(-view.ox / view.s, sx0 - pad), Math.max(sx0 - pad, sx1 + pad - vw)), vy = Math.min(Math.max(-view.oy / view.s, sy0 - pad), Math.max(sy0 - pad, sy1 + pad - vh));
    view.ox = -vx * view.s; view.oy = -vy * view.s;
  }
  view.ontoSheet();
}

function pct(v) { return nf(v, v > 0 && v < 1 ? 2 : 1); }

Object.assign(ctx, createProgress(ctx));
Object.assign(ctx, createOutings(ctx));
Object.assign(ctx, createPace(ctx));
Object.assign(ctx, createPlay(ctx));

Object.assign(ctx, createCards(ctx));
Object.assign(ctx, createGpsUi(ctx));
Object.assign(ctx, createGoals(ctx));
// ---- a tap on the folded sheet unfolds it; the ring opens the progress
$("peek").onclick = () => { if (["min", "hidden"].includes($("sheet").dataset.state)) ctx.sheet("peek"); };
$("chip").onclick = () => ctx.drawer("progress");

Object.assign(ctx, createDrawer(ctx));
Object.assign(ctx, createSheet(ctx));
createGestures(ctx);
Object.assign(ctx, createIncoming(ctx));
Object.assign(ctx, createGarmin(ctx));
Object.assign(ctx, createSettings(ctx));
createAdvanced(ctx);
Object.assign(ctx, createLayers(ctx));
Object.assign(ctx, createSearch(ctx));
// ---- Back: the phone's button (twice within 2 s leaves the app) and Escape
// nothing left to go back to: a second Back within 2 s leaves the app (not the first one, by accident)
native().then((n) => n?.App?.addListener("backButton", () => {
  if (ctx.onBack()) return;
  if (Date.now() - backAt < 2000) { n.App.exitApp(); return; }
  backAt = Date.now(); toast("Wstecz jeszcze raz: wyjście", 2000);
})).catch(() => {});
addEventListener("keydown", (e) => { if (e.key === "Escape") ctx.onBack(); });

/** Hand a file to the share sheet (the app: written to the cache first; a browser: Web Share, else a download). */
Object.assign(ctx, createBackup(ctx));
Object.assign(ctx, createFriends(ctx));
Object.assign(ctx, createAccount(ctx));
Object.assign(ctx, createCloudSync(ctx));
Object.assign(globalThis, { __friendsOpenInvite: (c) => ctx.friendsOpenInvite(c), __friendsSync: (f) => ctx.friendsSync(f), __cloudSyncUp: () => ctx.cloudBackup.syncUp() }); // for tests
// ---- home by train (train.js); getting there by car and links out of the app (sos.js)
function hhmm(t) { return new Date(t).toLocaleTimeString("pl-PL", { hour: "2-digit", minute: "2-digit" }); }
Object.assign(ctx, createTrain(ctx));
// ---- proposals for a day out (app/trips.js), and the Friday reminder of one
// (trips.js and planner.js see ctx too, with a few things of their own on top)
const trips = createTrips(Object.assign(Object.create(ctx), {
  project: (lon, lat) => projector(view.meta)(lon, lat), unproject: (x, y) => unprojector(view.meta)(x, y),
}));
globalThis.__trips = trips; // for tests
/** The next reminder (the coming Friday at the hour set) with the best walk for Saturday in its words. */
function nextFri(at) { const [h, m] = (at || "17:00").split(":").map(Number), d = new Date(); d.setHours(h, m || 0, 0, 0); d.setDate(d.getDate() + ((5 - d.getDay() + 7) % 7)); if (d.getTime() <= Date.now()) d.setDate(d.getDate() + 7); return d.getTime(); }
async function tripReminder() {
  const o = state.settings.trip || {};
  if (!isNative()) return;
  if (o.note === false) { configureTrip({ at: 0 }); return; }
  const at = nextFri(o.at), words = await trips.weekly().catch(() => null);
  configureTrip({ at, tz: new Date(at).getTimezoneOffset(), title: words?.title || "Masz plany na sobotę?", body: words?.body || "Zobacz propozycje wycieczek: nowe szlaki, szczyty i miejsca." });
}
/** Opened from the Friday reminder (or soon after it): the proposals come up by themselves, once a week. */
function tripFromReminder() {
  const o = state.settings.trip || {};
  if (o.note === false || !state.result) return;
  const fri = nextFri(o.at) - 7 * 864e5, now = Date.now();
  if (now < fri || now > fri + 5 * 3600e3 || o.seen === fri || planner.active() || trips.isOpen()) return;
  o.seen = fri; state.settings.trip = o; saveSettings();
  trips.open(null);
}
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") tripFromReminder(); });

Object.assign(ctx, createWeather(ctx));
Object.assign(ctx, createSos(ctx));
Object.assign(ctx, createSpotName(ctx));
Object.assign(ctx, createLifts(ctx));
Object.assign(ctx, createSlope(ctx));
Object.assign(ctx, createPostcard(ctx));
// the stamps of the badge peaks (drawn from photos, app/stamps-data.json): loaded once, when first wanted
/** The map packs' closed stretches of trail (closures.json: OSM tags), loaded once; then(): when they came. */
let closures = null;
function osmClosures(then) {
  if (!closures) {
    closures = [];
    Promise.all(packList(absSpec(state.regionBase)).map((p) => fetch(packUrl(p.base, "closures.json")).then((r) => (r.ok ? r.json() : [])).catch(() => [])))
      .then((l) => { closures = l.flat(); if (closures.length) then?.(); });
  }
  return closures;
}
/** The parks and closures kept by hand on the maps site (notices.json: newer than the ones built in),
 * kept on this device; asked again once a day when there is internet. -> {parks, closures} or null. */
let notices;
function noticeList(then) {
  if (notices === undefined) {
    try { notices = JSON.parse(localStorage.getItem("zdrapka.notices") || "null"); } catch { notices = null; }
    if (!notices || Date.now() - (notices.t || 0) > 864e5) {
      fetch(mapsSite() + "notices.json", { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).then((d) => {
        if (!d?.closures) return;
        notices = { t: Date.now(), parks: d.parks || [], closures: d.closures, seasons: d.seasons };
        try { localStorage.setItem("zdrapka.notices", JSON.stringify(notices)); } catch { /* full */ }
        then?.();
      }).catch(() => {});
    }
  }
  return notices;
}
function loadStamps() { return (stampLoad ||= fetch("app/stamps-data.json").then((r) => r.json()).catch(() => ({})).then((d) => (state.stampData = d))); }
function stampRec(k) { return state.stampData?.[`${k.n}|${k.ele}`] || null; }
function hashOf(t) { let h = 7; for (const ch of String(t)) h = (h * 31 + ch.charCodeAt(0)) | 0; return h >>> 0; }
Object.assign(ctx, createYear(ctx));
// ---- route planning (app/planner.js)
const planner = createPlanner(Object.assign(Object.create(ctx), {
  found: () => state.result?.found || {}, unproject: (x, y) => unprojector(view.meta)(x, y),
  onSaved: () => showSaved(), onActive: (e) => { ctx.routePill(e); if (planner.active() !== showSaved.plan) showSaved(); }, suggest: (q) => trips.open(q), tripsMenu: () => { ctx.drawer(false); trips.route("menu"); },
  plansOnMap: (v) => { if (v !== undefined) { state.settings.plansLayer = v; saveSettings(); showSaved(); } return state.settings.plansLayer === true; }, // (Plany: Na mapie)
  onBg: (line) => { bgLine = line; showSaved(); }, // the active route waiting while another plan is open: on the map
  gpsOn: () => { if (!ctx.gps.on) { state.follow = true; state.firstFix = true; ctx.gps.start(); ctx.gpsUi(); } },
  stopFollow: () => { state.follow = false; ctx.gpsUi(); }, // (the route shown instead of you: the map stops following)
  centerMe: () => { const p = ctx.gpsXY(); if (p && !outside(p[0], p[1], view.SH)) { state.follow = true; ctx.centerGps(p, view.zl < 13, true); ctx.gpsUi(); } },
}));
state.planKeep = () => planner.active() && planner.isShown() && !planner.walking(); // (walking the route: it may go right down to the handle)
state.planWalk = () => planner.walking();
Object.assign(ctx, createPill(ctx));
Object.assign(ctx, createWalked(ctx));
/** A plan sent as a link (core/planlink.js): the app opened with it (zdrapka://plan?d=…, also while running), or
 * the web app's #plan=…: opened as a new plan to change and save. */
async function sharedPlans() {
  const { decodePlan, tokenOf } = await import("../core/planlink.js");
  const take = (url) => {
    const tok = tokenOf(url); if (!tok || take.last === tok) return;
    take.last = tok;
    let p; try { p = decodePlan(tok); } catch { toast("Ten link z planem jest uszkodzony", 4000); return; }
    const proj = projector(view.meta), pts = p.pts.map(([lon, lat]) => { const [x, y] = proj(lon, lat); return { x, y, n: null }; });
    if (!pts.every((q) => view.onMap?.(q.x, q.y) ?? true)) { toast("Ten plan jest poza Twoimi mapami", 5000); return; }
    planner.openShared({ name: p.name, pts, pace: p.pace });
    toast(p.name ? `Plan: ${p.name}` : "Plan z linku", 3000);
  };
  if (/#plan=/.test(location.hash)) { take(location.href); history.replaceState(null, "", location.pathname + location.search); }
  const n = await native().catch(() => null);
  if (!n?.App) return;
  n.App.addListener("appUrlOpen", (e) => take(e?.url));
  n.App.getLaunchUrl?.().then((r) => take(r?.url)).catch(() => {});
}
/** Saved plans on the map: off unless asked for, and away while a plan or a route is open (it is the one that counts then); the active route waiting aside: always. */
function showSaved() {
  showSaved.plan = planner.active();
  const list = [...(state.settings.plansLayer === true && !showSaved.plan ? planner.savedLines() : []), ...(bgLine ? [{ id: "active", line: bgLine }] : [])];
  view.setSaved(list.length ? list : null);
}

Object.assign(ctx, createMapsUi(ctx));
// ---- start
(async () => {
  ctx.navFallback();
  try {
    state.regionBase = await ctx.mapBase();
    ctx.accessReady();
    // the map needs WebGL 2 (MapLibre 5): without it (an old laptop or phone, graphics switched off) it would wait for ever
    const gl2 = (() => { try { return !!document.createElement("canvas").getContext("webgl2"); } catch { return false; } })();
    if (!gl2) throw new Error("ta przeglądarka nie ma grafiki WebGL 2, której potrzebuje mapa. Spróbuj w aktualnym Chrome albo Firefoksie albo włącz w przeglądarce przyspieszenie sprzętowe.");
    busy("Rozkładam mapę…");
    const wait = { mapa: true, "dane szlaków": true };
    const slow = setTimeout(() => { const left = Object.keys(wait).filter((k) => wait[k]); if (left.length) $("loadmsg").textContent = `Rozkładam mapę… (wolno idzie: czekam na ${left.join(" i ")})`; }, 25000);
    await Promise.all([view.load(state.regionBase).then(() => { wait.mapa = false; mark("mapa gotowa"); }), call("init", { base: absSpec(state.regionBase) }).then(() => { wait["dane szlaków"] = false; mark("wątek analizy gotowy"); })]);
    clearTimeout(slow);
    delete state.settings.lift;
    view.mode = ctx.MODE_NAMES[state.settings.mode] ? state.settings.mode : "fog";
    ctx.applyLayers(false); ctx.applyAccent(); ctx.fillLegend(); showSaved(); planner.resume(); sharedPlans();
    $("attr").textContent = "© OpenStreetMap" + (view.meta.terrain ? " · Copernicus DEM © DLR, Airbus" : "");
    // the credit fades after 5 s or at the first touch of the map (OSMF attribution guidelines); in full it stays in Ustawienia → O aplikacji
    const fade = () => $("attr").classList.add("gone");
    setTimeout(fade, 5000); $("map").addEventListener("pointerdown", fade, { once: true });
    if (view.old) setTimeout(() => toast("Pobierz nowe mapy: menu → Mapy", 8000), 2500);
    if (view.broken) setTimeout(() => toast("Mapa nie wystartowała", 10000), 1500);
    view.resize();
    view.fitRegion();
    busy("Liczę Twoje wyjścia…");
    const first = (await call("analyse", { settings: state.settings }, ctx.progressMsg)).result;
    mark("wyniki z analizy");
    render(first, { fit: true });
    mark("wyniki na mapie");
    // the backdrop only now (not while every outing is matched; its pictures are made in a worker: the
    // page stays free); none on a careful start
    const bd = state.backdropBase && !state.careful ? view.setBackdrop(state.backdropBase).catch(() => {}) : null;
    setTimeout(calm, 20000);
    if (state.careful) setTimeout(() => toast("Tryb oszczędny", 7000), 1500);
    // the start screen stays until the map under it is drawn (its tiles in, the backdrop on), 5 s at most
    busy("Rysuję mapę…");
    const t0 = performance.now();
    await Promise.race([
      (async () => { while (view.flying) await new Promise((r) => setTimeout(r, 50)); await bd; await view.settled({ ms: 5000 }); })(),
      new Promise((r) => setTimeout(r, 5000)),
    ]);
    const t1 = performance.now();
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))); // (the last frame on the screen)
    mark("mapa gotowa pod ekranem startu"); note(`ekran startu czekał na mapę ${Math.round(t1 - t0)} ms (+ klatka ${Math.round(performance.now() - t1)} ms)`);
  } catch (err) {
    console.error(err);
    $("loadmsg").textContent = "Nie udało się wczytać mapy: " + err.message;
    return;
  }
  idle();
  $("icustatus").textContent = ctx.icuStatus();
  if (isNative()) native().then((n) => console.info(`zdrapka native: http=${!!n?.Http} runner=${!!n?.Runner}`)).catch((e) => console.error("zdrapka native", e));
  if (state.settings.icu?.key) { configureBackground(state.settings.icu); ctx.sync({ quiet: true }).then(() => ctx.refillElevations()); }
  tripFromReminder();
  setTimeout(() => tripReminder().catch(() => {}), 25000); // (quietly, once the map is up)
  if ("serviceWorker" in navigator && location.protocol === "https:" && !isNative()) navigator.serviceWorker.register("sw.js").catch(() => {});
})();
