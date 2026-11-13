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
const EDGES = [9, 17.5, 34, 50];
export function blitTook(ms) {
  D.blit.n++; D.blit.ms += ms; D.blit.max = Math.max(D.blit.max, ms);
  let i = 0; while (i < EDGES.length && ms > EDGES[i]) i++;
  D.hist[i]++;
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
    `  części: ${fmt(w.parts)}, kafle w pamięci: ${fmt(w.tiles)}, błędy mapy: ${fmt(w.errs)}`,
    `  na ekranie: ${fmt(w.drawn)}`,
    `  klatki w ruchu: ${D.blit.n}, śr. odstęp ${D.blit.n ? (D.blit.ms / D.blit.n).toFixed(1) : "-"} ms, najdłuższy ${Math.round(D.blit.max)} ms`,
    "",
    "WĄTEK STRONY:",
    `  zatrzymania >50 ms: ${D.long.n}, razem ${Math.round(D.long.ms)} ms, najdłuższe ${Math.round(D.long.max)} ms`,
    `  pamięć JS: ${mem}`,
  ];
  if (D.blit.n) L.splice(L.indexOf("WĄTEK STRONY:") - 1, 0, `  klatki: ≤9 ms ${D.hist[0]}, ≤17 ${D.hist[1]}, ≤34 ${D.hist[2]}, ≤50 ${D.hist[3]}, dłuższe ${D.hist[4]}`, `  kafle w pamięci / masek mgły: ${fmt(w.tiles)} / ${fmt(w.fogMasks)}, krążków mgły ${fmt(w.fogDiscs)}`);
  if (D.bench?.length) {
    L.push("", `TEST PŁYNNOŚCI (${D.benchAt || "-"}; zoom mapy GL; klatka: średnia / 90% w, wolnych = dłuższych niż 1,5 klatki ekranu;`,
      "  praca mapy na klatkę: procesor i GPU, średnio / 90% w; na 120 Hz mieści się do ~8 ms):");
    let z = null;
    const sv = (o) => (o ? `${o.mean.toFixed(1)}/${o.p90.toFixed(1)}` : "-");
    for (const b of D.bench) {
      if (b.zoom !== z) { z = b.zoom; L.push(`  z ${z}:`); }
      L.push(`    ${b.hz ?? "?"} Hz ${b.mean.toFixed(1).padStart(5)}/${String(b.p90).padStart(2)} ms, wolnych ${String(b.slow).padStart(2)}%, CPU ${sv(b.cpu)}, GPU ${sv(b.gpu)}  ${b.name}`);
    }
  }
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
