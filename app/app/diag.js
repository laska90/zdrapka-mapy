// Diagnostics (Ustawienia → Diagnostyka): how long the start took, how often the GL map
// draws while it moves, main-thread stalls, memory. A text report
// to copy and send; no data about the tracks themselves.

export const D = { t: {}, long: { n: 0, ms: 0, max: 0 }, blit: { n: 0, ms: 0, max: 0 }, frames: 0, notes: [] };

/** First time something happened (ms since the app started). */
export const mark = (k) => { D.t[k] ??= Math.round(performance.now()); };
export const note = (s) => { D.notes.push(`${Math.round(performance.now())} ms: ${s}`); if (D.notes.length > 12) D.notes.shift(); };

try {
  new PerformanceObserver((l) => {
    for (const e of l.getEntries()) { D.long.n++; D.long.ms += e.duration; D.long.max = Math.max(D.long.max, e.duration); }
  }).observe({ type: "longtask", buffered: true });
} catch { /* not supported */ }

// the frames' spread while moving: up to 9 ms (120 Hz), 17 (60 Hz), 34, 50, more
D.hist = [0, 0, 0, 0, 0];
const EDGES = [9.5, 18.5, 35, 50]; // (one frame at 60 Hz with its jitter: up to 18.5 ms; 17 split it in two)
// the screen's rate as the page gets it (60 / 90 / 120 Hz): the median of 40 frames, a moment after the start
if (typeof requestAnimationFrame !== "undefined") setTimeout(() => {
  const d = []; let last = 0;
  const f = (t) => { if (last) d.push(t - last); last = t; if (d.length < 40) requestAnimationFrame(f); else { d.sort((a, b) => a - b); D.hz = Math.round(1000 / d[20]); } };
  requestAnimationFrame(f);
}, 8000);
export function blitTook(ms, at = null) {
  D.blit.n++; D.blit.ms += ms; D.blit.max = Math.max(D.blit.max, ms);
  let i = 0; while (i < EDGES.length && ms > EDGES[i]) i++;
  D.hist[i]++;
  if (at) realFrame(ms, at);
}

// ---- why a frame was long: the browser's long animation frame over it (Chrome/WebView 123+). Its scripts by whose
// they were (the map's tiles: messages from its workers; the map's drawing; the app), the page's style and layout
// (forced by a script reading the layout after a change: which script), the rest (no script: the garbage collection
// or the browser's own work); none over it: the page's thread was free, the frame was lost past it (GPU, system).
export function whyLong(loaf, at, d) {
  const e = loaf.find((x) => x.startTime < at && x.startTime + x.duration > at - d);
  if (!e) return { why: "poza stroną", top: "" };
  const end = e.startTime + e.duration, by = { kafle: 0, rysowanie: 0, aplikacja: 0 };
  let s = 0, forced = 0, best = null, fBest = null;
  for (const sc of e.scripts || []) {
    s += sc.duration; forced += sc.forcedStyleAndLayoutDuration || 0;
    const mg = /maplibre/.test(sc.sourceURL || "");
    by[mg && /message/i.test(`${sc.invokerType} ${sc.invoker}`) ? "kafle" : mg ? "rysowanie" : "aplikacja"] += sc.duration;
    if (!best || sc.duration > best.duration) best = sc;
    if ((sc.forcedStyleAndLayoutDuration || 0) > (fBest?.forcedStyleAndLayoutDuration || 0)) fBest = sc;
  }
  const layout = e.styleAndLayoutStart ? end - e.styleAndLayoutStart : 0, render = e.renderStart ? (e.styleAndLayoutStart || end) - e.renderStart : 0;
  const name = (sc) => (sc ? `${sc.sourceFunctionName || sc.invoker || "?"}${sc.sourceURL ? ` (${sc.sourceURL.split("/").pop().split("?")[0]})` : ""}` : "");
  const parts = { ...by, "układ strony": layout, "wymuszony układ": forced, "bez skryptu": Math.max(0, e.duration - s - layout) };
  const [why] = Object.entries(parts).sort((a, b) => b[1] - a[1])[0];
  const top = why === "wymuszony układ" ? name(fBest) : ["kafle", "rysowanie", "aplikacja"].includes(why) ? name(best) : "";
  return { why, top, ms: { skrypty: Math.round(s), klatka: Math.round(render), układ: Math.round(layout), wymuszony: Math.round(forced) } };
}
// what happened around a stutter: tiles arriving (by source: their first upload to the GPU comes with the next
// frame), the app's worker answering (by what was asked) — the last seconds of it
const EV = [];
export const noteEv = (k) => { const t = performance.now(); EV.push([t, k]); while (EV.length > 400 || (EV.length && t - EV[0][0] > 10000)) EV.shift(); };
/** The events in a frame's time (and a moment before: a tile in just before the frame is drawn in it), counted. */
export function evAround(at, d) {
  const n = {};
  for (const [t, k] of EV) if (t > at - d - 60 && t <= at) n[k] = (n[k] || 0) + 1;
  return Object.entries(n).sort((a, b) => b[1] - a[1]).map(([k, c]) => `${k}${c > 1 ? ` ×${c}` : ""}`).join(", ");
}
// the long animation frames of the last seconds, for the real use's stutters
const LOAF = [];
try { new PerformanceObserver((l) => { LOAF.push(...l.getEntries()); while (LOAF.length > 40) LOAF.shift(); }).observe({ type: "long-animation-frame" }); } catch { /* not supported */ }

// ---- the frames of real use (no test): while the map moves, by where it was (zoom band, the map's look, a plan on
// it or not): how many frames, how many late (over 1.5 frames of the screen's rate). Kept on the phone for this
// version of the app (zdrapka.realperf), saved now and then: the report shows where it really stutters.
const REAL = "zdrapka.realperf";
let real = null, realSaved = 0, fastRun = 0;
function realLoad(version) {
  try { const r = JSON.parse(localStorage.getItem(REAL) || "null"); if (r && r.v === version) return r; } catch { /* none */ }
  return { v: version, since: Date.now(), b: {} };
}
export function realStart(version) { real = realLoad(version); }
const band = (z) => (z < 10 ? "z<10" : z < 12.5 ? "z10-12.5" : z < 14 ? "z12.5-14" : "z14+");
function realFrame(ms, { z, mode, plan }) {
  if (!real || ms > 500) return;
  // (resting at 60, the screen goes faster as the map moves: 20 frames running under 3/4 of the frame, the rate up)
  if (ms > 4 && ms < 750 / (D.hz || 60)) { if (++fastRun >= 20) { D.hz = ms < 9.7 ? 120 : 90; fastRun = 0; } } else fastRun = 0;
  const budget = 1000 / (D.hz || 60), k = `${band(z)} ${mode}${plan ? " +plan" : ""}`, b = (real.b[k] ||= [0, 0, 0]);
  b[0]++; if (ms > budget * 1.5) b[1]++; if (ms > budget * 3.5) b[2]++;
  if (ms >= 50) { // a stutter: why (the long frame is reported a moment later: looked at then)
    const at = performance.now();
    setTimeout(() => { const w = whyLong(LOAF, at, ms); (real.h ||= []).push({ d: Math.round(ms), z: Math.round(z * 10) / 10, mode, plan: !!plan, why: w.why, top: w.top, ms: w.ms, ev: evAround(at, ms), at: Date.now() }); if (real.h.length > 40) real.h.shift(); }, 300);
  }
  if (Date.now() - realSaved > 20000) { realSaved = Date.now(); try { localStorage.setItem(REAL, JSON.stringify(real)); } catch { /* full */ } }
}
/** The real use's frames: [{where, n, late %, stops %}] most used first, and since when. */
/** A finger's pan, how even it went (evenness from bench.js), kept with the resampling on or off. */
export function realEven(e, on) {
  if (!real) return;
  const k = on ? "on" : "off", a = ((real.ev ||= {})[k] ||= { n: 0, p95: 0, jumps: 0, frames: 0 });
  a.n++; a.p95 += e.p95; a.jumps += e.jumps; a.frames += e.n;
  try { localStorage.setItem(REAL, JSON.stringify(real)); } catch { /* full */ }
}
/** The real use's stutters as lines: by why, then the last ones. */
export function realHitchLines(RU) {
  const by = {};
  for (const h of RU.hitches) (by[h.why] ||= []).push(h);
  const ev = RU.even && Object.entries(RU.even).map(([k, a]) => `${k === "on" ? "wygładzanie wł." : "wył."}: nierówność p95 ${Math.round(a.p95 / a.n)}%, skoki ${Math.round((1000 * a.jumps) / Math.max(1, a.frames)) / 10} na 100 klatek (${a.n} przesunięć)`).join(" · ");
  return [...(ev ? [`RÓWNOŚĆ RUCHU PALCEM: ${ev}`] : []), `SZARPNIĘCIA W UŻYCIU (≥50 ms, ostatnie ${RU.hitches.length}): ${Object.entries(by).sort((a, b) => b[1].length - a[1].length).map(([w, a]) => `${w} ${a.length}`).join(" · ")}`,
    ...RU.hitches.slice(-8).reverse().map((h) => `  ${h.d} ms · z ${String(h.z).replace(".", ",")} ${h.mode}${h.plan ? " +plan" : ""} · ${h.why}${h.top ? ` ${h.top}` : ""}${h.ms ? ` [skrypty ${h.ms.skrypty}, układ ${h.ms.układ}]` : ""}${h.ev ? ` · w tej chwili: ${h.ev}` : ""} · ${new Date(h.at).toISOString().slice(11, 19)}`)];
}
export function realUse() {
  if (!real) return null;
  const rows = Object.entries(real.b).filter(([, b]) => b[0] >= 60).map(([where, b]) => ({ where, n: b[0], late: Math.round((1000 * b[1]) / b[0]) / 10, stops: Math.round((1000 * b[2]) / b[0]) / 10 })).sort((a, b) => b.n - a.n);
  return { since: real.since, v: real.v, rows, hitches: real.h || [], even: real.ev || null };
}

// The long frames (over 50 ms) and what was in them (Chrome's long animation frames): the scripts by
// where they came from (a frame callback, a message from a worker, an event...), the page's layout,
// and the rest (time no script owns: garbage collection, the GPU, the browser). The longest 12 kept.
D.loaf = [];
const short = (u) => (u || "").split("?")[0].split("/").pop() || "-";
try {
  new PerformanceObserver((l) => {
    for (const e of l.getEntries()) {
      const scripts = (e.scripts || []).map((s) => ({ ms: Math.round(s.duration), what: `${s.invokerType || "?"}${s.invoker ? " " + String(s.invoker).slice(0, 40) : ""}`, fn: `${s.sourceFunctionName || "?"} ${short(s.sourceURL)}${s.sourceCharPosition > 0 ? ":" + s.sourceCharPosition : ""}`, layout: Math.round(s.forcedStyleAndLayoutDuration || 0) }))
        .sort((a, b) => b.ms - a.ms).slice(0, 3);
      const inScripts = (e.scripts || []).reduce((t, s) => t + s.duration, 0);
      const render = e.renderStart ? Math.round(e.startTime + e.duration - e.renderStart) : 0, layout = e.styleAndLayoutStart ? Math.round(e.startTime + e.duration - e.styleAndLayoutStart) : 0;
      D.loaf.push({ at: Math.round(e.startTime), ms: Math.round(e.duration), block: Math.round(e.blockingDuration || 0), scripts, js: Math.round(inScripts), render, layout, other: Math.max(0, Math.round(e.duration - inScripts - render)) });
      D.loaf.sort((a, b) => b.ms - a.ms); D.loaf.length = Math.min(D.loaf.length, 12);
    }
  }).observe({ type: "long-animation-frame", buffered: true });
} catch { /* not supported */ }

const fmt = (o) => (o == null ? "-" : typeof o === "object" ? JSON.stringify(o) : String(o));

/** Text report: page side + the map's numbers (view.stats()). */
export async function report(view, { result, settings } = {}) {
  let version = "web";
  try { version = (await (await fetch("version.json", { cache: "no-store" })).json()).version; } catch { /* browser */ }
  const w = await view.stats().catch((e) => ({ error: String(e) }));
  const mem = performance.memory ? `${Math.round(performance.memory.usedJSHeapSize / 1e6)} / ${Math.round(performance.memory.jsHeapSizeLimit / 1e6)} MB` : "-";
  const L = [
    `Zdrapka ${version} · ${new Date().toISOString().slice(0, 16)}`,
    `ekran ${innerWidth}×${innerHeight} css px, dpr ${devicePixelRatio} (rysuję ${view.dpr}), pamięć urządzenia ${navigator.deviceMemory ?? "?"} GB, rdzenie ${navigator.hardwareConcurrency ?? "?"}`,
    `${navigator.userAgent}`,
    `GPU: ${fmt(w.gpu)}`,
    `tryb ${view.mode}, lekkie rysowanie: ${view.lite ? "tak" : "nie"}, zoom ${w.zoom ?? "-"}`,
    `wyjścia ${result?.activities?.length ?? 0}, dziury ${w.discs ?? "-"}, ślady ${w.mine ?? "-"}`,
    "",
    "START (ms od uruchomienia):",
    ...Object.entries(D.t).map(([k, v]) => `  ${k}: ${v}`),
    `  analiza w tle: ${result?.ms != null ? Math.round(result.ms) : "-"} ms, dopasowano ${result?.matched ?? "-"} wyjść`,
    "",
    "MAPA (MapLibre GL):",
    `  części: ${fmt(w.parts)}, kafle na ekranie: ${fmt(w.tiles)}, w pamięci poza ekranem: ${fmt(w.cached)}, błędy mapy: ${fmt(w.errs)}`,
    `  z wyprzedzeniem: ${fmt(w.prefetch)}`,
    `  na ekranie: ${fmt(w.drawn)}`,
    `  klatki w ruchu: ${D.blit.n}, śr. odstęp ${D.blit.n ? (D.blit.ms / D.blit.n).toFixed(1) : "-"} ms, najdłuższy ${Math.round(D.blit.max)} ms`,
    "",
    "WĄTEK STRONY:",
    `  zatrzymania >50 ms: ${D.long.n}, razem ${Math.round(D.long.ms)} ms, najdłuższe ${Math.round(D.long.max)} ms`,
    `  pamięć JS: ${mem}`,
  ];
  if (D.blit.n) L.splice(L.indexOf("WĄTEK STRONY:") - 1, 0, `  klatki: ≤9,5 ms ${D.hist[0]}, ≤18,5 ${D.hist[1]}, ≤35 ${D.hist[2]}, ≤50 ${D.hist[3]}, dłuższe ${D.hist[4]}; ekran ${D.hz || "?"} Hz`, `  kafle w pamięci / masek mgły: ${fmt(w.tiles)} / ${fmt(w.fogMasks)}, krążków mgły ${fmt(w.fogDiscs)}`);
  const RU = realUse();
  if (RU?.rows.length) L.push("", `PRAWDZIWE UŻYCIE (wersja ${RU.v}, od ${new Date(RU.since).toISOString().slice(0, 10)}; klatki w ruchu, spóźnione >1,5 klatki, zacięcia >3,5 klatki):`,
    ...RU.rows.slice(0, 12).map((r) => `  ${r.where}: ${r.n} klatek, spóźnione ${r.late}%, zacięcia ${r.stops}%`));
  if (RU?.hitches.length) L.push(...realHitchLines(RU));
  if (D.bench2) L.push("", D.benchText?.(D.bench2) || "");
  if (D.loaf.length) L.push("", "DŁUGIE KLATKI (najdłuższe; ms od startu: czas = skrypty + rysowanie + reszta):",
    ...D.loaf.map((f) => `  ${f.at}: ${f.ms} ms = js ${f.js} + rys. ${f.render} + reszta ${f.other}${f.scripts.length ? "\n" + f.scripts.map((s) => `      ${s.ms} ms ${s.what} → ${s.fn}${s.layout ? ` (układ ${s.layout})` : ""}`).join("\n") : ""}`));
  const E = D.elev;
  if (E) L.push("", "WYSOKOŚĆ Z MAPY a z zegarka (ostatnie wyjścia):",
    `  wyjścia ${E.n}, próbek ${E.samples}: różnica mediana ${E.medAbs} m, 90% w ${E.p90} m, mapa ${E.bias >= 0 ? "wyżej" : "niżej"} o ${Math.abs(E.bias)} m`,
    `  podejścia z mapy: ${E.climbRatio != null ? `${Math.round(E.climbRatio * 100)}% zegarka` : "-"}`);
  if (D.notes.length) L.push("", "ZDARZENIA:", ...D.notes.map((n) => "  " + n));
  if (w.error) L.push("", "błąd: " + w.error);
  return L.join("\n");
}
