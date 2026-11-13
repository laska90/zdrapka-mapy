// Search: ranges, peaks and huts, towns, stations, outings, badge peaks; the ones picked lately.
// C: the app as these parts see it (ctx in app.js: every name read when used).
import { bearing as bearingOf, distText, outside, windShort } from "../core/hud.js";
import { fmtDate } from "./labels.js";
import { badgeFields } from "../core/badges.js";
import { state } from "./state.js";
import { stemMatch } from "./mapdata.js";

export function createSearch(C) {
  function hl(name, q) {
    const f = C.fold(name), i = f.indexOf(q);
    return i < 0 ? C.esc(name) : C.esc(name.slice(0, i)) + `<mark>${C.esc(name.slice(i, i + q.length))}</mark>` + C.esc(name.slice(i + q.length));
  }
  let searchRows = [], searchSeq = 0;
  const resultsShown = (on) => { C.$("results").hidden = !on; document.documentElement.classList.toggle("searching", on); };
  /** The search is a pill (menu | magnifier) until you search; then a panel from the top. */
  const qopen = (on) => document.documentElement.classList.toggle("qopen", on);
  /** Two places of one name: the one near you (or near what the map shows) first; up to +0.6, half at ~12 km. */
  function nearBonus(x, y) {
    const me = C.gps.on ? C.gpsXY() : null, at = me && !outside(me[0], me[1], C.view.SH) ? me : C.view.toWorld(C.view.W / 2, C.view.H / 2);
    return at ? 0.6 * Math.exp(-Math.hypot(x - at[0], y - at[1]) / 17000) : 0;
  }
  /** From where to tell the distance: my position (if on the map), else nothing. */
  function distFromMe(x, y) {
    const me = C.gps.on ? C.gpsXY() : null;
    if (!me || outside(me[0], me[1], C.view.SH)) return "";
    return `${distText(Math.hypot(x - me[0], y - me[1]))} ${windShort(bearingOf(me[0], me[1], x, y))}`;
  }
  const iconOf = (r) => r.kind === "point" && r.p.c !== "place" && r.p.c !== "station" ? `<img src="${C.pointIcon(r.p, !!state.result?.found?.[r.p.id])}" alt="">`
    : `<svg><use href="#${r.kind === "outing" ? "i-nav" : r.kind === "range" ? "i-layers" : "i-search"}"/></svg>`;
  /** The last places picked (this device), shown when the search is empty. */
  function recentRows() {
    const out = [];
    for (const r of state.settings.recent || []) {
      if (r.kind === "range") { const g = C.view.ranges?.find((q) => q.id === r.id); if (g) out.push({ kind: "range", n: g.label, sub: "", r: g }); }
      else if (r.kind === "outing") { const a = C.outingById(r.id); if (a) out.push({ kind: "outing", n: a.name, sub: `${fmtDate(a.start)} · ${C.nf(a.km)} km`, a }); }
      else if (r.p) out.push({ kind: "point", n: r.p.n, sub: r.sub || "", p: r.p });
    }
    return out;
  }
  function showRecent() {
    const rows = recentRows();
    if (!rows.length) { resultsShown(false); searchRows = []; return; }
    searchRows = rows;
    C.$("results").innerHTML = `<div class="rhead"><span>Ostatnio</span><button class="linkbtn" id="rclear">wyczyść</button></div>` + rows.map((r, i) => `<button class="res" role="option" data-i="${i}"><span class="ri">${iconOf(r)}</span><span class="rn">${C.esc(r.n)}</span><span class="rs">${C.esc(r.sub)}</span></button>`).join("");
    C.$("rclear").onclick = (e) => { e.stopPropagation(); state.settings.recent = []; C.saveSettings(); resultsShown(false); C.$("q").focus(); };
    resultsShown(true);
  }
  function remember(r) {
    const rec = r.kind === "range" ? { kind: "range", id: r.r.id } : r.kind === "outing" ? { kind: "outing", id: r.a.id } : { kind: "point", sub: r.sub, p: { id: r.p.id, c: r.p.c, n: r.p.n, e: r.p.e, x: r.p.x, y: r.p.y, p: r.p.p, ...badgeFields(r.p), d: r.p.d, f: r.p.f, v: r.p.v } };
    const same = (q) => q.kind === rec.kind && (q.id ? q.id === rec.id : q.p && q.p.n === rec.p.n && Math.hypot(q.p.x - rec.p.x, q.p.y - rec.p.y) < 300);
    state.settings.recent = [rec, ...(state.settings.recent || []).filter((q) => !same(q))].slice(0, 6); C.saveSettings();
  }
  async function runSearch() {
    qopen(true);
    const raw = C.$("q").value.trim(), q = C.fold(raw), seq = ++searchSeq;
    C.$("qx").hidden = !raw;
    if (!raw) { showRecent(); return; }
    if (q.length < 2) { resultsShown(false); searchRows = []; return; }
    const score = (n) => { const f = C.fold(n); if (!f) return -1; if (f.startsWith(q)) return 3; if (f.split(/[\s\-–]+/).some((w) => w.startsWith(q))) return 2.6; /* ("Schronisko Samotnia" for "sam": nearly as good as its start) */ return f.includes(q) ? 1 : q.length >= 4 && stemMatch(q, n) ? 0.5 : -1; };
    const rows = [];
    for (const r of C.view.ranges || []) { const sc = score(r.label); if (sc > 0) rows.push({ sc: sc + 0.6, kind: "range", n: r.label, sub: "", r }); }
    for (const a of (state.result?.activities || []).filter((a) => !a.outside)) { const sc = score(a.name); if (sc > 0) rows.push({ sc: sc - 0.2, kind: "outing", n: a.name, sub: `${fmtDate(a.start)} · ${C.nf(a.km)} km`, a }); }
    const pts = await C.view.search(q).catch(() => []);
    if (seq !== searchSeq) return;
    const seen = new Set();
    for (const p of pts) {
      const sc = score(p.n), key = `${C.fold(p.n)}:${Math.round(p.x / 3000)}:${Math.round(p.y / 3000)}`;
      if (sc <= 0 || seen.has(key)) continue;
      seen.add(key);
      const f = state.result?.found?.[p.id];
      // the context that tells two "Kopa"s apart: the range, how far from me, whether reached
      rows.push({ sc: sc + (p.c === "place" ? 0.4 : p.c === "hut" ? 0.5 : p.c === "peak" ? 0.2 : 0) + (p.kgp ? 0.3 : 0) + (f ? 0.2 : 0) + nearBonus(p.x, p.y), kind: "point", n: p.n, sub: [p.e ? `${Math.round(p.e)} m` : "", p.rl || "", distFromMe(p.x, p.y), f ? "✓" : ""].filter(Boolean).join(" · "), p });
    }
    // towns, villages and stations from the backdrop: everywhere, also far from the mountains (getting there)
    for (const [n, lon, lat, kind, pop] of C.view.townsData || []) {
      const sc = score(n);
      if (sc <= 0) continue;
      const [x, y] = C.view.xy(lon, lat), key = `${C.fold(n)}:${Math.round(x / 3000)}:${Math.round(y / 3000)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const c = kind === "station" ? "station" : "place", big = (pop || 0) >= 50000 ? 0.5 : kind === "town" ? 0.35 : kind === "city" ? 0.5 : 0.1;
      rows.push({ sc: sc + big - 0.05 + nearBonus(x, y), kind: "point", n, sub: [kind === "station" ? "stacja" : kind === "city" || kind === "town" ? "miasto" : "wieś", distFromMe(x, y)].filter(Boolean).join(" · "), p: { id: `bd:${kind}:${n}:${lon}`, c, n, x, y, p: kind === "station" ? null : kind } });
    }
    rows.sort((a, b) => b.sc - a.sc || a.n.localeCompare(b.n, "pl"));
    searchRows = rows.slice(0, 30);
    C.$("results").innerHTML = searchRows.length
      ? searchRows.map((r, i) => `<button class="res" role="option" data-i="${i}"><span class="ri">${iconOf(r)}</span><span class="rn">${hl(r.n, q)}</span><span class="rs">${C.esc(r.sub)}</span></button>`).join("")
      : `<div class="none">Nic nie znaleziono dla „${C.esc(raw)}”.</div>`;
    resultsShown(true);
  }
  function closeSearch(clear = true) {
    resultsShown(false); qopen(false);
    if (clear) { C.$("q").value = ""; C.$("qx").hidden = true; searchRows = []; }
    C.$("q").blur();
  }
  let searchT = 0;
  C.$("q").addEventListener("input", () => { clearTimeout(searchT); searchT = setTimeout(runSearch, 120); });
  C.$("q").addEventListener("focus", () => { C.drawer(false); C.layers(false); runSearch(); const q = C.$("q"); if (q.value) requestAnimationFrame(() => q.select()); }); // (the last search again: typing replaces it)
  C.$("q").addEventListener("keydown", (e) => { if (e.key === "Enter" && searchRows.length) { e.preventDefault(); pickResult(searchRows[0]); } });
  C.$("qx").onclick = () => { C.$("q").value = ""; C.$("qx").hidden = true; C.$("q").focus(); runSearch(); };
  C.$("qbtn").onclick = () => { qopen(true); C.$("q").focus(); };
  C.$("qback").onclick = () => closeSearch();
  C.$("results").onclick = (e) => { const b = e.target.closest(".res"); if (b) pickResult(searchRows[+b.dataset.i]); };
  function pickResult(r) {
    const q = C.$("q").value;
    closeSearch(false);
    remember(r);
    if (q.trim()) C.fromList("search", "Wyniki", { q });
    if (r.kind === "range") { C.sheet("peek"); C.flyView(() => C.view.fitBox(...r.r.bbox, 30)); C.showRange(r.r); return; }
    if (r.kind === "outing") { C.selectOuting(r.a.id); return; }
    const p = r.p, f = state.result?.found?.[p.id];
    C.sheet("peek");
    C.showTip({ ...p, d: !!f || p.d, f: f?.first ?? p.f, v: f?.visits ?? p.v });
    C.flyView(() => C.centerFree(p.x, p.y, Math.max(C.view.zl, p.c === "place" ? 7.6 : 8)));
  }
  return { closeSearch, runSearch };
}
