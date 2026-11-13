// An outing added by hand: a planned route walked without the watch; its date, time and points changed later.
// C: the app as these parts see it (ctx in app.js: every name read when used).
import { projector, unprojector } from "../core/pack.js";
import { state } from "./state.js";

export function createWalked(C) {
  let walkedRoute = null;
  const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  function addWalked(r) {
    walkedRoute = r;
    const o = r.outing; // changing an outing added by hand: its date and time as they were
    C.$("wkh").textContent = o ? o.name || "Wyjście" : "Przeszedłem";
    C.$("wkok").textContent = o ? "Zapisz" : "Dodaj";
    C.$("wkdate").max = ymd(new Date());
    C.$("wkdate").value = o ? (o.start != null ? ymd(new Date(o.start)) : "") : ymd(new Date());
    const ms = o?.ms || r.ms;
    C.$("wktime").value = ms ? C.hm(ms).replace(" h", "") : "";
    C.$("walked").hidden = false;
  }
  const outingMs = (a) => (a.start != null && a.end != null && a.end > a.start ? a.end - a.start : null);
  /** An outing added by hand: its date and walking time. */
  function editWalked(a) { addWalked({ outing: { id: a.id, name: a.name, km: a.km, start: a.start, ms: outingMs(a) } }); }
  /** An outing added by hand: its points again in the planner (older ones kept no points: taken along the line every ~700 m). */
  async function editWalkedPts(a) {
    const S = await import("./store.js"), full = await S.getActivity(a.id);
    let pts = full?.planPts;
    if (!pts?.length) {
      const pr = projector(C.view.meta), line = (full?.parts || []).flat().map((q) => pr(q.lon, q.lat));
      if (line.length < 2) { C.toast("Brak trasy", 3000); return; }
      pts = [{ x: line[0][0], y: line[0][1] }];
      let d = 0;
      for (let i = 1; i < line.length; i++) {
        d += Math.hypot(line[i][0] - line[i - 1][0], line[i][1] - line[i - 1][1]);
        if (d >= 700 && i < line.length - 1) { pts.push({ x: line[i][0], y: line[i][1] }); d = 0; }
      }
      const z = line[line.length - 1], l = pts[pts.length - 1];
      if (Math.hypot(z[0] - l.x, z[1] - l.y) < 250 && pts.length > 1) pts.pop();
      pts.push({ x: z[0], y: z[1] });
    }
    state.selected = null; C.view.setHighlight(null); C.hideTip();
    C.planner.openOuting({ id: a.id, name: a.name, km: a.km, start: a.start, ms: outingMs(a), pts });
  }
  C.$("wkx").onclick = () => (C.$("walked").hidden = true);
  C.$("walked").onclick = (e) => { if (e.target === C.$("walked")) C.$("walked").hidden = true; };
  /** "3:15", "3.15", "3h", "195" (minutes) -> ms, or null. */
  function parseDur(t) {
    t = (t || "").trim().replace(/\s*h$/i, "");
    if (!t) return null;
    let m = t.match(/^(\d{1,2})[:.,](\d{1,2})$/);
    if (m) return (+m[1] * 60 + +m[2]) * 60000;
    m = t.match(/^(\d{1,3})$/);
    if (m) return (+m[1] <= 12 ? +m[1] * 60 : +m[1]) * 60000; // a small number: hours, else minutes
    return NaN;
  }
  C.$("wkok").onclick = async () => {
    const r = walkedRoute;
    if (!r) return;
    const typed = parseDur(C.$("wktime").value);
    if (Number.isNaN(typed)) { C.toast("Czas jako godziny:minuty", 4000); return; }
    const o = r.outing, dv = C.$("wkdate").value;
    const ms = typed ?? (o ? o.ms : null) ?? r.ms ?? 0;
    // the clock: from 9:00 of the day given (no date: from 0, the outing has no date); along the route by the plan's times
    const start = dv ? new Date(`${dv}T09:00`).getTime() : null, base = start ?? 0;
    let act;
    if (r.line) {
      const P = r.P, L = r.line, un = unprojector(C.view.meta), Tt = P?.T?.at(-1) || 0, at = (d) => Math.min((P?.d?.length || 1) - 1, Math.max(0, Math.round(d / (P?.step || 1))));
      const pts = [];
      let d = 0;
      for (let i = 0; i < L.length; i += 2) {
        if (i) d += Math.hypot(L[i] - L[i - 2], L[i + 1] - L[i - 1]);
        const [lon, lat] = un(L[i], L[i + 1]), k = at(d), h = P?.h?.[k];
        const f = Tt ? P.T[k] / Tt : d / Math.max(1, r.km * 1000);
        pts.push({ t: Math.round(base + f * ms), lat, lon, ele: Number.isFinite(h) ? h : null });
      }
      act = { id: `man-${Date.now()}`, sport: "hiking", name: null, start, end: start != null && ms ? start + ms : null, km: r.km, parts: [pts], ele: true, asc: r.up, desc: r.down, manual: true, planPts: r.pts || null };
    } else {
      // only the date and the time: the same line, its clock moved and stretched
      const S = await import("./store.js"), old = await S.getActivity(o.id);
      if (!old) { C.toast("Nie znalazłem tego wyjścia", 3000); return; }
      const all = old.parts.flat(), t0 = all[0]?.t ?? 0, span = (all.at(-1)?.t ?? t0) - t0, k = ms && span > 0 ? ms / span : 1;
      const parts = old.parts.map((p) => p.map((q) => ({ ...q, t: Math.round(base + (q.t - t0) * k) })));
      act = { ...old, id: `man-${Date.now()}`, name: null, start, end: start != null && ms ? start + ms : null, parts };
    }
    C.$("walked").hidden = true;
    C.busy(o ? "Zapisuję zmiany…" : "Dodaję wyjście…");
    try {
      if (o) {
        state.selected = null; C.view.setHighlight(null);
        C.render((await C.call("replaceManual", { old: o.id, act, settings: state.settings })).result);
        if (r.line) C.hideTip(); // (the planner's card: the outing's points are done)
        C.toast("Zapisano", 2000);
        C.selectOuting(act.id);
      } else {
        C.render((await C.call("addManual", { act, settings: state.settings })).result);
        C.toast("Dodano", 2000);
      }
      C.haptic.tick?.();
    } catch (e) { C.toast((o ? "Nie udało się zapisać: " : "Nie udało się dodać: ") + (e?.message || e), 5000); } finally { C.idle(); }
  };

  return { addWalked, editWalked, editWalkedPts };
}
