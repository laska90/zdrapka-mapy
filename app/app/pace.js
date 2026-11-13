// pace: time in motion against the standard (core/pace.js), cached on this device; route times from it
// (moved out of app.js: what it needs of the app comes in C, see createX in app.js)
import { PACE_V, paceWord, personalCurve, personalNorm, personalTime } from "../core/pace.js";
import { D } from "./diag.js";
import { state } from "./state.js";

export function createPace(C) {
  const paceSig = () => `${PACE_V}|nz`;
  let paceStore = null;
  function paces() {
    if (!paceStore) { try { const s = JSON.parse(localStorage.getItem("zdrapka.pace") || "null"); paceStore = s?.sig === paceSig() ? s : { sig: paceSig(), items: {} }; } catch { paceStore = { sig: paceSig(), items: {} }; } }
    if (paceStore.sig !== paceSig()) paceStore = { sig: paceSig(), items: {} };
    return paceStore.items;
  }
  const savePaces = () => { try { localStorage.setItem("zdrapka.pace", JSON.stringify(paceStore)); } catch { /* full or blocked: computed again next time */ } };
  const paceNorm = () => personalNorm(Object.values(paces()).filter(Boolean));
  let curveMemo = null;
  /** Your pace by gradient (core/pace.js personalCurve), worked out again when the outings' paces change. */
  function paceCurve() {
    const items = Object.values(paces()).filter(Boolean), key = `${paceStore?.sig}|${items.length}`;
    if (curveMemo?.key !== key) curveMemo = { key, c: personalCurve(items) };
    return curveMemo.c;
  }
  /** Time for a way {km, up, down, std, bins}: your pace by gradient when it is known, else your
   * three-figure norm, else the standard. -> {ms, mine} */
  function routeTime(r) {
    // with friends on the map: you walk together, so each kind of ground goes at the pace of whoever is slowest on it
    // (one may be slow uphill, another downhill): per gradient bin the slowest rate; with three-figure norms the
    // slowest of each term (flat, up, down); anyone without a pace by the standard
    const g = C.groupPaces?.();
    if (g) {
      const { bins } = r, byBin = g.filter((q) => q.curve && bins?.length === q.curve.r?.length), rest = g.filter((q) => !byBin.includes(q));
      let ms = byBin.length ? bins.reduce((t, v, b) => t + v * Math.max(...byBin.map((q) => q.curve.r[b])), 0) : 0;
      const ns = rest.map((q) => q.norm).filter(Boolean);
      if (ns.length) {
        const lo = (k) => { const v = ns.map((n) => n[k]).filter((x) => x > 0); return v.length ? Math.min(...v) : 0; };
        ms = Math.max(ms, personalTime({ flat: lo("flat"), climb: lo("climb"), descent: lo("descent") }, r.km, r.up, r.down));
      }
      if (rest.some((q) => !q.norm)) ms = Math.max(ms, r.std || 0);
      return { ms, mine: true, group: true };
    }
    return oneTime(r, paceCurve(), paceNorm());
  }
  function oneTime({ km, up, down, std, bins }, K, N, plain = false) {
    if (plain) { if (K && bins?.length === K.r?.length) return { ms: bins.reduce((t, v, b) => t + v * K.r[b], 0) }; return { ms: N ? personalTime(N, km, up, down) : std }; }
    if (K && bins?.length === K.r.length) return { ms: bins.reduce((t, v, b) => t + v * K.r[b], 0), mine: true };
    return N ? { ms: personalTime(N, km, up, down), mine: true } : { ms: std, mine: false };
  }
  /** Work out the pace of outings not done yet, a few at a time in the background. */
  async function ensurePaces() {
    if (state.paceJob || !state.result) return;
    const P = paces(), todo = state.result.activities.filter((a) => !a.outside && !a.manual && !(a.id in P)).map((a) => a.id); // by hand: no clock of its own
    if (!todo.length) return;
    state.paceJob = { n: 0, of: todo.length };
    try {
      for (let i = 0; i < todo.length; i += 8) {
        if (todo.length > 8) C.work("pace", `Liczę tempo wyjść… ${state.paceJob.n}/${todo.length}`);
        const r = await C.call("paces", { ids: todo.slice(i, i + 8) });
        Object.assign(paces(), r.paces || {});
        state.paceJob.n = Math.min(todo.length, i + 8);
        savePaces();
        if (state.settings.outingSort === "pace" || state.settings.outingSort === "up") C.renderOutings();
        const s = C.outingById(state.selected); if (s && state.cur?.key === `o:${s.id}`) fillPace(s);
      }
    } catch (e) { console.warn("paces", e); }
    finally { state.paceJob = null; C.work("pace"); if (state.settings.outingSort === "pace" || state.settings.outingSort === "up") C.renderOutings(); }
    elevCheck();
  }
  /** Once a start, quietly: the map's heights against the watch's on your last outings (Diagnostyka). */
  async function elevCheck() {
    if (elevCheck.done || !state.result) return;
    elevCheck.done = true;
    const ids = [...state.result.activities].filter((a) => !a.outside && !a.manual).sort((a, b) => (b.start || 0) - (a.start || 0)).slice(0, 25).map((a) => a.id);
    try { D.elev = (await C.call("elevcheck", { ids })).check; } catch (e) { console.warn("elevcheck", e); }
  }
  /** The pace line on an outing's card. */
  function fillPace(a) {
    const el = C.$("tip").querySelector(".opl"), p = paces()[a.id];
    if (!el) return;
    if (!p) { el.textContent = a.id in paces() ? "" : ""; return; }
    const N = paceNorm(), mine = N ? personalTime(N, p.km, p.up, p.down) : null, h = (ms) => C.hm(ms).replace(" h", "");
    // one short line; a tap shows what the figure is made of
    el.innerHTML = `<button class="pchip" aria-expanded="false">w ruchu <b>${h(p.moving)}</b>${p.stops > 60000 ? ` · postoje ${h(p.stops)}` : ""} · tempo <b>${Math.round(p.idx * 100)}%</b> <svg class="chev"><use href="#i-chev"/></svg></button>` +
      `<div class="pmore" hidden>norma ${C.hm(p.norm)}${mine ? ` · Twoja norma ${C.hm(mine)}` : ""} · ${paceWord(p.idx)} (100% = norma z tablic szlakowych, bez postojów)</div>`;
    el.querySelector(".pchip").onclick = (e) => { const m = el.querySelector(".pmore"); m.hidden = !m.hidden; e.currentTarget.setAttribute("aria-expanded", !m.hidden); C.placeToast(); };
  }
  return { ensurePaces, fillPace, paceCurve, paceNorm, paces, routeTime };
}
