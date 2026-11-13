// goals: the badge peaks not reached yet (nearby, on the progress page), thresholds reached, a range's card, a place's visits, what is near a point
// (moved out of app.js: what it needs of the app comes in C, see createX in app.js)
import { see, seen } from "./seen.js";
import { state } from "./state.js";
import { badgeFields, badgeSummits } from "../core/badges.js";
import { MEDALS, THRESHOLDS, distText, levelOf, nearest, nextThreshold, outside, windShort } from "../core/hud.js";
import { peakIcon, vignetteURL } from "./vignettes.js";
import { patchURL } from "./patches.js";
import { decodeLine } from "../core/geometry.js";
import { plural } from "./labels.js";

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
    C.sheet("peek");
    C.showTip(goalProps(g)); C.flyView(() => C.centerFree(g.x, g.y, Math.max(C.view.zl, 8)));
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
      ? `<h5 class="sec">Cele w okolicy</h5>` + list.map((g) => `<button class="goal" data-goal="${g.id}"><img src="${vignetteURL(peakIcon(goalProps(g)), false)}" alt=""><span class="gn">${g.n}</span><span class="gd">${g.e} m · ${distText(g.d)} ${windShort(g.deg)}</span></button>`).join("")
      : "";
  }

  /** Thresholds of walked trails (25 / 50 / 75 / 100 %) passed by the new results: a message. */
  function checkThresholds(res) {
    const now = { all: levelOf(res.coverage?.trails.pct || 0) }, names = { all: C.AREA.nom() };
    for (const r of res.ranges || []) { now[r.id] = levelOf(r.coverage?.trails.pct || 0); names[r.id] = r.label; }
    const before = seen("levels");
    see("levels", now);
    if (!before) return;
    const ups = Object.keys(now).filter((k) => now[k] > (before[k] ?? 0)).map((k) => `${names[k]}: ${THRESHOLDS[now[k] - 1]}%!`);
    if (!ups.length) return;
    C.toast(ups.slice(0, 2).join(" · ") + (ups.length > 2 ? ` · i ${ups.length - 2} więcej` : ""), 6500);
    C.haptic.reward();
  }
  /** A medal and "what is missing to the next threshold" for a coverage figure. */
  /** The sign of a marked trail (PTTK): white, a red band across. */
  function pctTxt(p) { return p >= 10 ? Math.round(p) : C.nf(p, p < 1 ? 1 : 0); }
  /** A long route's card: km walked, what is left to the next threshold, the route on the map. */
  function routeCard(id) {
    const L = (state.result?.routes || []).find((q) => q.id === id), R = (C.view.index?.routes || []).find((q) => q.id === id);
    if (!L) return;
    const nx = THRESHOLDS.find((t) => L.pct < t - 1e-9), left = nx != null ? (L.km * nx) / 100 - L.walkedKm : 0;
    let html = `<img class="rpatch${L.walkedKm > 0 ? "" : " off"}" src="${patchURL(L.id)}" alt=""><h4>${L.name}</h4><div class="tk">${R ? C.ROUTE_INFO[L.id] || "" : ""}</div>`;
    html += `<div class="ostats"><span><b>${pctTxt(L.pct)}</b>%</span><span><b>${C.nf(L.walkedKm, 1)}</b> z ${C.nf(L.km, 0)} km</span>${medal(L.pct)}</div>`;
    html += `<div class="bar th"><i style="width:${Math.min(100, L.pct)}%"></i></div>`;
    html += nx != null ? `<div class="tl">Do ${nx}% brakuje ${C.nf(Math.max(0, left), left < 10 ? 1 : 0)} km.</div>` : `<div class="tl">Cały szlak przeszedłeś! Gratulacje.</div>`;
    html += `<div class="tl muted small">Liczą się odcinki przebyte w całości lub w części, tak jak w procencie szlaków.</div>`;
    C.sheet("peek"); // the map first: the route on it
    C.openTip(html, () => { C.view.setHighlight(null); C.view.routeSplit?.(null); }, `route:${id}`, { label: L.name, reopen: () => routeCard(id) });
    if (R?.line?.length) {
      // the whole route on the map (your walked stretches glow on the map under it)
      const parts = R.line.map((f) => { const [xs, ys] = decodeLine(f, 1), out = []; for (let i = 0; i < xs.length; i++) out.push(xs[i], ys[i]); return out; });
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const pt of parts) for (let i = 0; i < pt.length; i += 2) { x0 = Math.min(x0, pt[i]); x1 = Math.max(x1, pt[i]); y0 = Math.min(y0, pt[i + 1]); y1 = Math.max(y1, pt[i + 1]); }
      // what you walked of it in violet, the rest in grey dashes; the gaps: the nearest one to go for
      const gaps = C.view.routeSplit?.(parts) || [];
      const all = () => C.flyView(() => C.fitAbove(x0, y0, x1, y1));
      if (gaps.length) {
        const [mx, my] = (C.gps.on && C.gps.fix && C.gpsXY()) || C.view.centre(), dist = (g) => Math.min(Math.hypot(g.a[0] - mx, g.a[1] - my), Math.hypot(g.b[0] - mx, g.b[1] - my));
        const g = [...gaps].sort((p, q) => dist(p) - dist(q))[0], left = gaps.reduce((t, q) => t + q.km, 0);
        const box = document.createElement("div");
        box.className = "rgap";
        box.innerHTML = `<div class="tl"><b>${plural(gaps.length, "luka", "luki", "luk")}</b> do przejścia, razem ${C.nf(left, 0)} km. Najbliższa: <b>${C.nf(g.km, g.km < 10 ? 1 : 0)} km</b>.</div>`;
        C.$("tip").querySelector(".tx")?.before(box);
        const gx0 = Math.min(...g.pts.map((q) => q[0])), gx1 = Math.max(...g.pts.map((q) => q[0])), gy0 = Math.min(...g.pts.map((q) => q[1])), gy1 = Math.max(...g.pts.map((q) => q[1]));
        C.addActs([{ icon: "route", label: "Zaplanuj najbliższą lukę", fn: () => { C.view.routeSplit?.(null); C.planner.open({ x: g.a[0], y: g.a[1] }); C.planner.add({ x: g.b[0], y: g.b[1] }); } },
          { icon: "pin", label: "Pokaż ją", fn: () => C.flyView(() => C.fitAbove(gx0, gy0, gx1, gy1)) }, { icon: "map", label: "Cały szlak", fn: all }]);
      } else C.addActs([{ icon: "map", label: "Pokaż cały szlak", fn: all }]);
      all();
    }
  }
  function medal(pct) { const l = levelOf(pct); return l ? `<span class="medal m${l}" title="${MEDALS[l]}"></span>` : ""; }
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
    box.innerHTML = outs.length ? `<div class="tl">${outs.length > 1 ? `Byłeś tu ${outs.length}×` : "Byłeś tu raz"}</div>` + C.visitRows(outs) : ""; // (never here: nothing, as on a peak's card)
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
