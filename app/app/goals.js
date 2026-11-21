// goals: the badge peaks not reached yet (nearby, on the progress page), thresholds reached, a range's card, a place's visits, what is near a point
// (moved out of app.js: what it needs of the app comes in C, see createX in app.js)
import { see, seen } from "./seen.js";
import { state } from "./state.js";
import { badgeFields, badgeSummits } from "../core/badges.js";
import { bearing as bearingOf, distText, levelOf, nearest, nextThreshold, outside, windShort } from "../core/hud.js";
import { ringSVG } from "./marks.js";
import { thresholdBar, trailSVG } from "./marks.js";
import { decodeLine } from "../core/geometry.js";
import { shortName } from "./labels.js";

/** The long routes' marking colours (their line on the map). */
const ROUTE_COL = { gss: "#d0202a", gsb: "#d0202a" };
export function createGoals(C) {
  let goalsOf = null;
  let goalList = [];
  /** The badge peaks in the map not reached yet (kept until the results change: it runs after every pan). */
  function goals() {
    if (goalsOf === state.result && goalList.length) return goalList;
    const got = state.result?.badges || {}, [x0, y0, x1, y1] = C.view.index?.bounds || [0, 0, 0, 0];
    const S = (state.summits ||= C.bpts() ? badgeSummits(C.bpts()) : null) || [];
    goalsOf = state.result;
    return (goalList = S.filter((g) => !g.ids.some((id) => got[id]) && g.x >= x0 && g.x <= x1 && g.y >= y0 && g.y <= y1));
  }
  function goalProps(g) { return { c: "peak", n: g.n, e: g.e, x: g.x, y: g.y, d: false, f: null, v: 0, outs: [], ...badgeFields(g) }; }
  function showGoal(g) {
    // (how far: from you, or from the middle of the map as the strip reckons it, before the map flies there)
    const me = C.gps.on ? C.gpsXY() : null, [x, y] = me && !outside(me[0], me[1], C.view.SH) ? me : C.view.toWorld(C.view.W / 2, C.view.H / 2);
    C.sheet("peek");
    C.showTip({ ...goalProps(g), dist: g.d ?? Math.hypot(g.x - x, g.y - y), deg: g.deg ?? bearingOf(x, y, g.x, g.y) }); // (from the strip: its own figures) C.flyView(() => C.centerFree(g.x, g.y, Math.max(C.view.zl, 8)));
  }
  function goalById(id) { return goals().find((g) => g.id === id); }
  /** "Cele w okolicy": the three nearest peaks still to climb, from my position (or the middle of the map). */
  function fillGoals() {
    const box = C.$("goals");
    if (!box || !C.view.meta) return;
    const me = C.gps.on ? C.gpsXY() : null, inMap = me && !outside(me[0], me[1], C.view.SH);
    const [x, y] = inMap ? me : C.view.toWorld(C.view.W / 2, C.view.H / 2);
    const list = nearest(goals(), x, y, 3);
    box.innerHTML = list.length
      ? `<h5 class="sec">Cele w okolicy</h5>` + list.map((g) => `<button class="goal" data-goal="${g.id}">${ringSVG([], 40)}<span class="gn">${g.n}</span><span class="gd">${g.e} m · ${distText(g.d)} ${windShort(g.deg)}</span></button>`).join("")
      : "";
  }

  /** Thresholds of walked trails (25 / 50 / 75 / 100 %) passed by the new results: a message. */
  function checkThresholds(res) {
    const now = { all: levelOf(res.coverage?.trails.pct || 0) }, names = { all: C.AREA.nom() };
    for (const r of res.ranges || []) { now[r.id] = levelOf(r.coverage?.trails.pct || 0); names[r.id] = r.short || r.label; }
    // only when new outings came (not the first results after a start or a backup read: all its thresholds at once)
    const n = (res.activities || []).length, before = seen("levels");
    see("levels", { ...now, _n: n });
    if (!before || !(before._n > 0) || n <= before._n) return;
    const ups = Object.keys(now).filter((k) => k !== "_n").filter((k) => now[k] > (before[k] ?? 0)).map((k) => `${names[k]}: ${now[k]} z 4 odcinków`); // (the four parts of its bar)
    if (!ups.length) return;
    C.toast(ups.slice(0, 2).join(" · ") + (ups.length > 2 ? ` · i ${ups.length - 2} więcej` : ""), 6500);
    C.haptic.reward();
  }
  /** A medal and "what is missing to the next threshold" for a coverage figure. */
  /** The sign of a marked trail (PTTK): white, a red band across. */
  function pctTxt(p) { return p >= 10 ? Math.round(p) : C.nf(p, p < 1 ? 1 : 0); }
  /** A long route's card: km walked, what is left to the next threshold, the route on the map. */
  /** A long route's page in Postęp (as a badge's): its post, the % and km, the thresholds, Pokaż na mapie, the nearest
   * gap to plan; its gaps from the nearest, each a tap: that gap on the map with Zaplanuj and the next one. */
  function routeParts(id) {
    const R = (C.view.index?.routes || []).find((q) => q.id === id);
    if (!R?.line?.length) return null;
    const parts = R.line.map((f) => { const [xs, ys] = decodeLine(f, 1), out = []; for (let i = 0; i < xs.length; i++) out.push(xs[i], ys[i]); return out; });
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const pt of parts) for (let i = 0; i < pt.length; i += 2) { x0 = Math.min(x0, pt[i]); x1 = Math.max(x1, pt[i]); y0 = Math.min(y0, pt[i + 1]); y1 = Math.max(y1, pt[i + 1]); }
    return { parts, box: [x0, y0, x1, y1] };
  }
  const gapNames = new Map(); // route id -> [names of each gap] (from the route's places, once reckoned)
  function routeCard(id) {
    const L = (state.result?.routes || []).find((q) => q.id === id);
    if (!L) return;
    state.openRoute = id;
    const RP = routeParts(id), col = ROUTE_COL[L.id] || "#d0202a";
    const gaps = RP ? C.view.routeSplit?.(RP.parts, { draw: false }) || [] : [];
    // out there (the GPS on): from the nearest to you; else along the route, from its start
    const me = C.gps.on && C.gps.fix ? C.gpsXY() : null, names = gapNames.get(id);
    gaps.forEach((g, i) => { g.i = i; if (me) { g.d = Math.min(Math.hypot(g.a[0] - me[0], g.a[1] - me[1]), Math.hypot(g.b[0] - me[0], g.b[1] - me[1])); g.deg = bearingOf(me[0], me[1], (g.a[0] + g.b[0]) / 2, (g.a[1] + g.b[1]) / 2); } g.km0 = names?.[i]?.d ?? i; });
    const order = [...gaps].sort((p, q) => (me ? p.d - q.d : p.km0 - q.km0)), left = gaps.reduce((t, q) => t + q.km, 0);
    let html = `<div class="bhead"><button class="iconbtn" id="bback" aria-label="Wróć"><svg><use href="#i-back"/></svg></button>${trailSVG(44, col, L.walkedKm > 0)}<div><h4>${L.name}</h4><div class="tk">${C.ROUTE_INFO[L.id] || ""}</div></div></div>`;
    html += `<div class="rbig"><b>${pctTxt(L.pct)}%</b><span>${C.nf(L.walkedKm, 1)} z ${C.nf(L.km, 0)} km</span></div><div class="thwrap">${thresholdBar(L.pct)}</div>`;
    html += `<div class="bacts"><button class="btn" data-rshow><svg><use href="#i-map"/></svg><span>Pokaż na mapie</span></button>${order.length && me ? `<button class="btn primary" data-rgap="${order[0].i}" data-plan="1"><svg><use href="#i-route"/></svg><span>Zaplanuj najbliższą lukę</span></button>` : ""}</div>`;
    if (order.length) html += `<h5 class="sec">Luki · ${order.length} · ${C.nf(left, 0)} km</h5>` + order.map((g, k) => `<button class="rgrow" data-rgap="${g.i}"><span class="rgn">${k + 1}</span><b>${names?.[g.i]?.t || `${C.nf(g.km, g.km < 10 ? 1 : 0)} km szlaku`}</b><span class="rgk">${C.nf(g.km, g.km < 10 ? 1 : 0)} km</span><small>${me ? `${distText(g.d)} ${windShort(g.deg)}` : names && !/^km /.test(names[g.i]?.t || "") ? `od km ${C.nf(g.km0 / 1000, 0)}` : ""}</small></button>`).join("");
    const el = C.$("progress");
    el.innerHTML = html;
    el.closest(".dbody")?.scrollTo?.(0, 0);
    C.$("bback").onclick = (e) => { e.stopPropagation(); state.openRoute = null; C.renderCard(); };
    el.onclick = (e) => {
      if (e.target.closest("[data-rshow]")) { showRoute(id); return; }
      const gb = e.target.closest("[data-rgap]");
      if (!gb) return;
      const g = gaps[+gb.dataset.rgap];
      if (gb.dataset.plan) { C.drawer(false); C.view.routeSplit?.(null); C.planner.open({ x: g.a[0], y: g.a[1] }); C.planner.add({ x: g.b[0], y: g.b[1] }); return; }
      showGap(id, gaps, order, order.indexOf(g));
    };
    if (RP && gaps.length && !names) nameGaps(id, gaps);
  }
  /** The gaps' names: the named places nearest their two ends along the route (from the route's own profile). */
  async function nameGaps(id, gaps) {
    const r = await C.call("longRoute", { route: id }).then((q) => q.long).catch(() => null);
    if (!r?.P) return;
    const P = r.P, n = P.d.length, places = (r.places || []).filter((p) => p.n);
    const dOf = ([x, y]) => { let bi = 0, bd = Infinity; for (let i = 0; i < n; i += 3) { const dd = Math.hypot(P.x[i] - x, P.y[i] - y); if (dd < bd) { bd = dd; bi = i; } } return P.d[bi]; };
    const near = (d) => places.reduce((b, p) => (!b || Math.abs(p.d - d) < Math.abs(b.d - d) ? p : b), null);
    const out = gaps.map((g) => { const da = dOf(g.a), db = dOf(g.b), lo = Math.min(da, db), hi = Math.max(da, db), A = near(lo), B = near(hi); return { d: lo, t: A && B && A !== B ? `${shortName(A.n)} → ${shortName(B.n)}` : `km ${C.nf(lo / 1000, 0)}–${C.nf(hi / 1000, 0)}` }; });
    gapNames.set(id, out);
    if (state.openRoute === id && !C.$("progress").hidden) routeCard(id);
  }
  /** The whole route on the map (walked violet, the rest in its colour), the drawer closed, a chip back to its page. */
  function showRoute(id) {
    const L = (state.result?.routes || []).find((q) => q.id === id), RP = routeParts(id);
    if (!L || !RP) return;
    C.drawer(false);
    C.view.routeSplit?.(RP.parts, { color: ROUTE_COL[L.id] || "#d0202a" });
    C.flyView(() => C.fitAbove(...RP.box));
    C.mapChip?.({ icon: trailSVG(28, ROUTE_COL[L.id] || "#d0202a", true), label: `${L.name} · ${pctTxt(L.pct)}%`, open: () => { C.drawer("progress"); routeCard(id); }, off: () => { C.view.routeSplit?.(null); if (state.cur?.key?.startsWith("gap:")) C.hideTip(); } });
  }
  /** One gap on the map: its card with Zaplanuj and the next gap (in the page's order). */
  function showGap(id, gaps, order, k) {
    const L = (state.result?.routes || []).find((q) => q.id === id), g = order[k];
    if (!g) return;
    showRoute(id);
    const xs = g.pts.map((q) => q[0]), ys = g.pts.map((q) => q[1]);
    C.flyView(() => C.fitAbove(Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)));
    const nm = gapNames.get(id)?.[g.i]?.t || "";
    C.openTip(`<h4>Luka ${k + 1} · ${C.nf(g.km, g.km < 10 ? 1 : 0)} km</h4><div class="tk">${nm ? `${nm} · ` : ""}${L.name}</div>`, null, `gap:${id}:${g.i}`, { label: L.name, reopen: () => showGap(id, gaps, order, k) });
    C.addActs([{ icon: "route", label: "Zaplanuj", fn: () => { C.view.routeSplit?.(null); C.mapChip?.(null); C.planner.open({ x: g.a[0], y: g.a[1] }); C.planner.add({ x: g.b[0], y: g.b[1] }); } },
      ...(order[k + 1] ? [{ icon: "chev", label: "Następna luka", fn: () => showGap(id, gaps, order, k + 1) }] : [])]);
  }
  function medal() { return ""; } // (the metal circles are gone: the thresholds are the four parts of the bar, marks.js thresholdBar)
  function missing(c) { const n = nextThreshold(c.trails.pct, c.trails.totalKm, c.trails.walkedKm); return n ? `do ${n.t}%: brakuje ${C.nf(n.km, n.km < 10 ? 1 : 0)} km` : "komplet!"; }

  /** A town or village: every outing that went through it or only touched it - its built-up area
   * on the map (the residential patches at its name and next to them), else a circle of its rough size. */
  const PLACE_R = { city: 2500, town: 1300, village: 600 };
  async function placeVisits(p, key) {
    let ids = [];
    let area = null;
    try { const r = await C.call("nearPlace", { x: p.x, y: p.y, r: PLACE_R[p.p] ?? 600, kind: p.p }); ids = r.ids || []; area = r.area; } catch { /* the list stays empty */ }
    const box = state.cur?.key === key ? C.$("tip").querySelector(".pvis") : null;
    if (!box) return;
    const outs = ids.map((id) => [id, C.outingById(id)?.start ?? 0]).filter(([id]) => C.outingById(id));
    box.innerHTML = outs.length ? `<h5 class="sec">Wizyty · ${outs.length}</h5>` + C.visitRows(outs) : ""; // (never here: nothing, as on a peak's card)
    C.placeToast();
    if (area) {
      C.view.setPin(null); C.view.setArea(area); // the place itself outlined, not a marker on its name
      // on screen above the card (at this zoom): moved there when the card covers it
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const f of area) for (let i = 0; i < f.length; i += 2) { x0 = Math.min(x0, f[i]); x1 = Math.max(x1, f[i]); y0 = Math.min(y0, f[i + 1]); y1 = Math.max(y1, f[i + 1]); }
      const peek = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--sheet-peek")) || 84;
      const corners = [[x0, y0], [x1, y0], [x0, y1], [x1, y1]].map(([x, y]) => C.view.toScreen(x, y));
      const hidden = corners.some(([sx, sy]) => sy > C.view.H - peek - 12 || sy < 64 || sx < 8 || sx > C.view.W - 8);
      const fits = (x1 - x0) * C.view.s < C.view.W - 40 && (y1 - y0) * C.view.s < C.view.H - peek - 64 - 40;
      if (hidden) C.flyView(() => (fits ? C.centerFree((x0 + x1) / 2, (y0 + y1) / 2, C.view.zl) : C.fitAbove(x0, y0, x1, y1))); // too big here: out until it fits
    }
  }
  /** A tap on a scratched band away from any point: the outings that went there. */
  async function showNear(x, y) {
    const [wx, wy] = C.view.toWorld(x, y);
    const r = await C.call("near", { x: wx, y: wy });
    if (!r.ids.length) return false;
    C.nearCard(r.ids, `${Math.round(wx)},${Math.round(wy)}`);
    return true;
  }

  return { checkThresholds, fillGoals, goalById, goalProps, goals, medal, missing, pctTxt, placeVisits, routeCard, showGoal, showNear };
}
