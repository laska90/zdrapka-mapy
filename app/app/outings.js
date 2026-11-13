// outings: the list (sorted, searched, by year), each one's shape, one selected on the map with its profile
// (moved out of app.js: what it needs of the app comes in C, see createX in app.js)
import { state } from "./state.js";
import { fmtDate, plural, shortName } from "./labels.js";
import { paceWord } from "../core/pace.js";
import { score as routeScore } from "../core/routes.js";
import { badgesOf } from "../core/badges.js";
import { mountGrow } from "./growprof.js";
import { kpiFingers } from "./kpi.js";

export function createOutings(C) {
  let thumbs = null;
  let oq = "";
  function outingById(id) { return state.result?.activities.find((a) => a.id === id); }
  function dur(a) { if (a.start == null || a.end == null) return ""; const m = Math.round((a.end - a.start) / 60000); return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, "0")} h`; }
  function climbTxt(a) { return a.ele ? `↑ ${C.nf(a.asc || 0, 0)} m ↓ ${C.nf(a.desc || 0, 0)} m` : ""; }
  /** The same in a list row: it wraps between the figures, never inside one. */
  /** Two lines: date · km, then the climb · the time (one line wrapped anywhere, a "·" was left hanging at its end). */
  function outingLineRow(a) {
    const line = (xs) => xs.filter(Boolean).map((t) => String(t).replace(/ /g, "\u00a0")).join(" · ");
    return `${line([fmtDate(a.start), `${C.nf(a.km)} km`])}<br>${line([climbTxt(a), dur(a)])}`;
  }
  /** Visits to a place: date + route, newest first; tap shows the route. */
  function visitRows(outs) {
    const rows = [...outs].sort((a, b) => b[1] - a[1]).map(([id, t]) => `<button class="vrow" data-o="${id}"><span>${fmtDate(t)}</span><span>${outingById(id)?.name || "wyjście"}</span></button>`);
    return `<div class="visits">${rows.slice(0, 12).join("")}${rows.length > 12 ? `<div class="tk">…i ${rows.length - 12} więcej</div>` : ""}</div>`;
  }
  function renderOutings() {
    const all = (state.result?.activities || []).filter((a) => !a.outside);
    const q = C.fold(oq.trim()), list = q ? all.filter((a) => C.fold(a.name || "").includes(q)) : all;
    C.$("ocnt").textContent = all.length || "";
    // outings without heights: their number, and a way to fill them when intervals.icu has them
    const noEle = all.filter((a) => !a.ele), icuNo = noEle.filter((a) => String(a.id).startsWith("icu-")).length;
    C.$("elestatus").textContent = noEle.length ? `Bez wysokości: ${noEle.length}` : "";
    C.$("elefill").hidden = !(icuNo && state.settings.icu?.key);
    if (!all.length) { C.$("olist").innerHTML = ""; return; }
    const search = `<div class="osearch"><svg><use href="#i-search"/></svg><input id="oq" type="search" placeholder="Szukaj w ${plural(all.length, "wyjściu", "wyjściach", "wyjściach")}" value="${C.esc(oq)}" autocomplete="off" spellcheck="false" enterkeyhint="search"></div>`;
    const keepFocus = document.activeElement?.id === "oq", caret = keepFocus ? document.activeElement.selectionStart : 0;
    if (!list.length) { C.$("olist").innerHTML = search + `<p class="empty">${q ? "Żadne wyjście nie ma tego w nazwie." : "Brak takich wyjść."}</p>`; refocus(keepFocus, caret); return; }
    const sort = SORTS[state.settings.outingSort] ? state.settings.outingSort : "date", asc = !!state.settings.outingAsc, byPace = sort === "pace", P = C.paces();
    let html = search + `<div class="seg osort">${Object.entries(SORTS).map(([k, l]) => `<button data-sort="${k}" class="${k === sort ? "on" : ""}">${l}${k === sort ? ` <span class="dir">${asc ? "↑" : "↓"}</span>` : ""}</button>`).join("")}</div>`;
    const climbOf = (a) => (a.ele ? a.asc : P[a.id]?.up) ?? null; // from the GPS heights, else from the map's profile
    const key = { date: (a) => a.start ?? 0, km: (a) => a.km ?? 0, up: climbOf, pace: (a) => P[a.id]?.idx ?? null }[sort];
    // the chosen order (largest first, or reversed); outings without the figure at the end
    const rows = [...list.filter((a) => key(a) != null)].sort((a, b) => (asc ? key(a) - key(b) : key(b) - key(a))).concat(list.filter((a) => key(a) == null));
    if (byPace) {
      const done = list.filter((a) => P[a.id]), N = C.paceNorm();
      html += `<div class="pacesum">`;
      if (state.paceJob) html += `<div class="tk">Liczę tempo… ${state.paceJob.n}/${state.paceJob.of}</div>`;
      if (done.length) {
        const med = [...done].map((a) => P[a.id].idx).sort((x, y) => x - y)[Math.floor(done.length / 2)];
        html += `<div class="tl">Tempo względem normy (jak na tablicach szlakowych, czas w ruchu bez postojów): mediana <b>${Math.round(med * 100)}%</b>.</div>`;
        if (N) html += `<div class="tl">Twoja norma z ${plural(N.n, "wyjścia", "wyjść", "wyjść")}: <b>${C.nf(N.flat)} km/h</b> po płaskim${N.climb ? ` · <b>${C.nf(N.climb, 0)} m/h</b> pod górę` : ""}${N.descent ? ` · <b>${C.nf(N.descent, 0)} m/h</b> w dół` : ""}.</div>`;
      }
      html += `</div>`;
    }
    if (sort === "up" && state.paceJob) html += `<div class="pacesum"><div class="tk">Liczę przewyższenia z mapy… ${state.paceJob.n}/${state.paceJob.of}</div></div>`;
    const side = (a) => sort === "km" ? `<span class="opace"><b>${C.nf(a.km)}</b><small>km</small></span>` : sort === "up" && climbOf(a) != null ? `<span class="opace"><b>↑${C.nf(climbOf(a), 0)}</b><small>m</small></span>` : "";
    // by date: a heading for each year (how many, how far)
    const yearOf = (a) => (a.start && a.start > 1e11 ? new Date(a.start).getFullYear() : null);
    let lastY;
    html += rows.map((a) => {
      let head = "";
      if (sort === "date" && yearOf(a) !== lastY) {
        lastY = yearOf(a);
        const ys = rows.filter((b) => yearOf(b) === lastY);
        head = `<h5 class="sec oyear">${lastY ?? "Bez daty"}<small>${plural(ys.length, "wyjście", "wyjścia", "wyjść")} · ${C.nf(ys.reduce((t, b) => t + (b.km || 0), 0), 0)} km</small></h5>`;
      }
      const p = byPace && P[a.id];
      const row = `<button class="orow${a.id === state.selected ? " on" : ""}${p || side(a) ? " withpace" : ""}" data-o="${a.id}">${thumbSvg(a.id)}<span class="on1">${a.name || "Wyjście"}</span><span class="on2">${p ? `${fmtDate(a.start)}  ·  ${C.nf(a.km)} km  ·  ↑${C.nf(climbOf(a) ?? p.up, 0)} m` : outingLineRow(a)}</span>${p ? `<span class="on2">w ruchu ${C.hm(p.moving)} · norma ${C.hm(p.norm)}</span>` : ""}${p ? `<span class="opace"><b>${Math.round(p.idx * 100)}%</b><small>${paceWord(p.idx)}</small></span>` : side(a)}</button>`;
      return head + row;
    }).join("");
    C.$("olist").innerHTML = html;
    refocus(keepFocus, caret);
    ensureThumbs(rows.map((a) => a.id));
  }

  // each outing's shape in the list (only its line): made once by the worker, kept on this device
  function thumbStore() { if (!thumbs) { try { thumbs = JSON.parse(localStorage.getItem("zdrapka.thumbs") || "{}") || {}; } catch { thumbs = {}; } } return thumbs; }
  function thumbSvg(id) { const d = thumbStore()[id]; return `<svg class="othumb" viewBox="0 0 40 40" aria-hidden="true">${d ? `<path d="${d}"/>` : ""}</svg>`; }
  async function ensureThumbs(ids) {
    const T = thumbStore(), need = ids.filter((id) => !(id in T));
    if (!need.length || ensureThumbs.busy) return;
    ensureThumbs.busy = true;
    try {
      for (let i = 0; i < need.length; i += 20) { // in batches: the first rows show up quickly
        const { thumbs: got } = await C.call("thumbs", { ids: need.slice(i, i + 20) });
        Object.assign(T, got);
        for (const [id, d] of Object.entries(got)) { const el = [...C.$("outings").querySelectorAll(".orow")].find((r) => r.dataset.o === String(id))?.querySelector(".othumb"); if (el && d) el.innerHTML = `<path d="${d}"/>`; }
      }
      const live = new Set((state.result?.activities || []).map((a) => String(a.id)));
      for (const id of Object.keys(T)) if (!live.has(id)) delete T[id];
      try { localStorage.setItem("zdrapka.thumbs", JSON.stringify(T)); } catch { /* only a cache */ }
    } catch (e) { console.warn("thumbs", e); } finally { ensureThumbs.busy = false; }
  }

  const SORTS = { date: "Data", km: "Długość", up: "W górę", pace: "Tempo" };
  // the search in the outings: the list is drawn again as you type, the field keeps the caret
  function refocus(on, caret) { if (!on) return; const el = C.$("oq"); el?.focus(); try { el?.setSelectionRange(caret, caret); } catch { /* a search field may not take it */ } }
  C.$("outings").addEventListener("input", (e) => { if (e.target.id === "oq") { oq = e.target.value; renderOutings(); } });

  // one outing: selected on the map, its profile (the last few kept)
  const profiles = new Map();
  async function selectOuting(id, { fit = true } = {}) {
    const a = outingById(id);
    if (!a) return;
    state.selected = id;
    C.sheet("peek");
    const r = await C.call("track", { activity: id });
    const t = r.track;
    if (!t) return;
    C.view.setHighlight(t.parts);
    C.outingCard(a);
    if (fit) C.flyView(() => C.fitAbove(...t.box)); else C.view.draw();
    renderOutings();
  }
  /** Places reached on this outing, placed on the profile by time (or by position). */
  function profileMarks(a, P) {
    const out = [], n = P.d.length, hasT = Number.isFinite(P.t[0]) && Number.isFinite(P.t[n - 1]);
    for (const [, f] of Object.entries(state.result?.found || {})) {
      const o = f.n && f.outs?.find(([id]) => id === a.id);
      if (!o) continue;
      let i = 0;
      if (hasT) { let lo = 0, hi = n - 1; while (lo < hi) { const m = (lo + hi) >> 1; if (P.t[m] < o[1]) lo = m + 1; else hi = m; } i = lo; }
      else { let bd = Infinity; for (let k = 0; k < n; k++) { const d = Math.hypot(P.x[k] - f.x, P.y[k] - f.y); if (d < bd) { bd = d; i = k; } } }
      out.push({ i, n: shortName(f.n), c: f.c, e: f.e, imp: routeScore({ c: f.c, e: f.e, ...(badgesOf(f, C.bpts() || []) || {}) }) });
    }
    return out;
  }
  async function showProfile(a) {
    const key = `o:${a.id}`, k = C.$("tip").querySelector(".kpi.oc"), box = k?.querySelector(".gprof");
    if (!box) return;
    let P = profiles.get(a.id);
    if (!P) {
      P = (await C.call("profile", { activity: a.id }).catch(() => ({}))).profile || null;
      if (P) { profiles.set(a.id, P); if (profiles.size > 8) profiles.delete(profiles.keys().next().value); }
    }
    if (state.cur?.key !== key || !box.isConnected) return;
    if (!P) { box.remove(); return; }
    // the way between two samples, as the plan's: the time from the watch, the climb from the profile
    const way = (i, j) => {
      let up = 0, down = 0;
      for (let q = i + 1; q <= j; q++) { const dh = P.h[q] - P.h[q - 1]; if (Number.isFinite(dh) && !P.gap?.[q]) { if (dh > 0) up += dh; else down -= dh; } }
      const ms = Number.isFinite(P.t[j]) && Number.isFinite(P.t[i]) ? P.t[j] - P.t[i] : null;
      return { ms, km: (P.d[j] - P.d[i]) / 1000, up, down };
    };
    if (!a.ele) { const w = way(0, P.d.length - 1), b = k.querySelectorAll(".krow .kc b"); if (b.length === 4) { b[2].textContent = Math.round(w.up); b[3].textContent = Math.round(w.down); } } // (no heights from the watch: the map's)
    const fig = kpiFingers(k);
    const ui = mountGrow(box, P, {
      marks: profileMarks(a, P).map((m) => ({ ...m, key: m.c })), stripes: true, clock: true, full: true, way, onMark: () => C.haptic.tick(),
      onWay: fig,
      onCursor: (i, j) => {
        if (i == null) { C.view.setCursor(null); return; }
        if (j != null) { const line = []; for (let q = i; q <= j; q++) line.push(P.x[q], P.y[q]); C.view.setCursor({ a: [P.x[i], P.y[i]], b: [P.x[j], P.y[j]], line }); return; }
        C.view.setCursor([P.x[i], P.y[i]]); if (C.playing()) C.glide(P.x[i], P.y[i]); else C.keepVisible(P.x[i], P.y[i]);
      },
    });
    if (!ui) return;
    state.curProf = { key, P, ui };
    const btn = C.$("tip").querySelector(".play");
    if (btn) { btn.hidden = false; btn.onclick = C.togglePlay; }
  }
  return { dur, outingById, renderOutings, selectOuting, showProfile, visitRows };
}
