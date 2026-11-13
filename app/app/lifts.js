// Cable cars and chair lifts: their stations on the map (lower ▲, upper ▼), a station's card, and the
// ride in a route. Planning, a tap on a station adds it; a tap on the other station of the same lift
// right after it makes that leg the ride (the leg's via.lift: the worker walks to it, rides, walks on).

import { distText } from "../core/hud.js";

const KIND = { lift_main: "Kolej gondolowa", lift_chair: "Kolej krzesełkowa" };

export function createLifts(C) {
  const known = new Map(); // lid -> the lift: {lid, c, n, m, ms, xs, ys, lo, hi} (xs, ys from the lower station)
  let timer = 0, seq = 0;

  const ends = (L) => { const k = L.xs.length - 1; return { lo: { x: L.xs[0], y: L.ys[0] }, hi: { x: L.xs[k], y: L.ys[k] } }; };
  const title = (L) => L.n || KIND[L.c] || "Kolej";
  /** A station as a plan's point; with via: the ride from the other station to it. */
  const point = (L, end, ride = false) => {
    const e = ends(L)[end], q = { x: e.x, y: e.y, n: null }; // (named by the place there: "Karpacz – Kopa", not the lift's own name)
    if (ride) {
      const up = end === "hi", xs = up ? L.xs : [...L.xs].reverse(), ys = up ? L.ys : [...L.ys].reverse();
      q.via = { lift: { xs, ys, ms: L.ms, n: L.n } };
    }
    return q;
  };

  function draw() {
    // one sign per station: a middle one (the top of one lift, the bottom of the next) both ways
    const list = [];
    for (const L of known.values()) {
      const e = ends(L);
      for (const end of ["lo", "hi"]) {
        const q = list.find((o) => Math.hypot(o.x - e[end].x, o.y - e[end].y) < 80);
        if (q) { q.at.push(`${L.lid}|${end}`); if (q.end !== end) q.end = "mid"; continue; }
        list.push({ lid: L.lid, end, n: title(L), at: [`${L.lid}|${end}`], ...e[end] });
      }
    }
    C.view.setLiftStations?.(list);
  }
  /** The lifts around what is on the screen (close in only: far out they are too small to tap). */
  function refresh() {
    clearTimeout(timer);
    timer = setTimeout(async () => {
      const v = C.view;
      if (!v?.toWorld || !v.map || v.map.getZoom() < 11.5) return;
      const c = [[0, 0], [v.W, 0], [0, v.H], [v.W, v.H]].map(([x, y]) => v.toWorld(x, y));
      const xs = c.map((p) => p[0]), ys = c.map((p) => p[1]), my = ++seq;
      const r = await C.call("liftStations", { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) }).catch(() => null);
      if (my !== seq || !r?.lifts) return;
      let added = false;
      for (const L of r.lifts) if (!known.has(L.lid)) { known.set(L.lid, L); added = true; }
      if (added) draw();
    }, 350);
  }
  function watch() {
    const m = C.view?.map;
    if (!m?.on) { setTimeout(watch, 1500); return; }
    m.on("moveend", refresh);
    refresh();
  }
  watch();

  /** Planning: a tap on a station. Right after the lift's other station (the last point): the ride. */
  function planTap(p) {
    const at = String(p.at || `${p.lid}|${p.end}`).split(",").map((k) => { const [lid, end] = k.split("|"); return { L: known.get(lid), end }; }).filter((o) => o.L);
    if (!at.length) return false;
    const P = C.planner.points, n = P.length, loop = n > 2 && Math.hypot(P[0].x - P[n - 1].x, P[0].y - P[n - 1].y) < 60;
    const prev = loop ? P[n - 2] : P[n - 1];
    // the lift whose other station is the last point: this tap rides it
    const hit = prev && at.find(({ L, end }) => { const o = ends(L)[end === "lo" ? "hi" : "lo"]; return Math.hypot(prev.x - o.x, prev.y - o.y) < 80; });
    const { L, end } = hit || at[0];
    C.planner.add(point(L, end, !!hit));
    if (hit) C.toast(end === "hi" ? "Wjazd kolejką" : "Zjazd kolejką", 2000);
    return true;
  }

  /** A station's card: its lift(s), the ride; up or down from here. */
  function card(p) {
    const at = String(p.at || `${p.lid}|${p.end}`).split(",").map((k) => { const [lid, end] = k.split("|"); return { L: known.get(lid), end }; }).filter((o) => o.L);
    if (!at.length) return false;
    const first = at[0], h = first.end === "lo" ? first.L.lo : first.L.hi;
    const walking = C.planner.isActive() && !C.planner.drafting();
    const name = at.length > 1 ? at.find((o) => o.end === "lo")?.L.n || title(first.L) : title(first.L);
    let html = `<h4>${C.esc(name)}${h != null ? `<span class="el hel"> ${h} m</span>` : ""}</h4><div class="tk">${KIND[first.L.c] || "Kolej"} · ${at.length > 1 && at.some((o) => o.end !== first.end) ? "stacja pośrednia" : first.end === "lo" ? "dolna stacja" : "górna stacja"}</div>`;
    const same = at.length > 1 && at.every((o) => o.end === first.end); // (two lifts from one station, the same way: say which)
    for (const { L, end } of at) {
      const h2 = end === "lo" ? L.hi : L.lo;
      html += `<div class="tl">${end === "lo" ? "Na górę" : "Na dół"}${same ? ` (${C.esc(title(L))})` : ""}: ${distText(L.m)} · ok. ${Math.round(L.ms / 60000)} min z czekaniem${h2 != null ? ` · do ${h2} m` : ""}</div>`;
    }
    html += `<div class="tl muted small">Sprawdź, czy kursuje.</div>`;
    const key = `lift:${at.map((o) => o.L.lid).join("+")}:${first.end}`;
    C.openTip(html, null, key, { label: name, pin: [p.x, p.y, "place"], reopen: () => card(p) });
    const acts = [];
    for (const { L, end } of at) {
      const other = end === "lo" ? "hi" : "lo";
      if (walking) { if (C.planner.nearRoute()) acts.push({ icon: "route", label: same ? title(L) : at.length > 1 ? (end === "lo" ? "Kolejką w górę" : "Kolejką w dół") : "Jedź kolejką", primary: !acts.length, fn: () => { C.hideTip(); C.planner.rideLift(point(L, end), point(L, other, true)); } }); }
      else acts.push({ icon: "route", label: same ? title(L) : end === "lo" ? "Wjedź na górę" : "Zjedź na dół", primary: !acts.length, fn: () => { C.hideTip(); C.planner.open(point(L, end)); C.planner.add(point(L, other, true)); } });
    }
    if (acts.length) C.addActs(acts);
    if (walking) C.alongWay(key, { x: p.x, y: p.y, n: name }); // (as any place's card: the way there along the route, on its profile)
    return true;
  }

  const lifts = { refresh, planTap, card };
  return { lifts };
}
