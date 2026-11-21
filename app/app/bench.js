// The smoothness benchmark (Ustawienia → Zaawansowane → Test płynności): scenarios as the phone is used (the overview
// with the fog, the trails close in, a fling, a pinch over new ground, a plan on the map, a card and the drawer,
// Replay 3D), driven through the map's own touch handling (synthetic pointer events: the gestures' code counts and
// the time from a finger's move to its frame is measured), each run two or three times (the median kept); the
// frames against the screen's own rate (60 / 90 / 120 Hz, as the phone runs now), the map's work per frame on the
// processor and, where the phone tells, on the GPU, the long frames split by whose they were, the tiles' time from
// asked to drawn, memory. Then, for what came out slow, which layers cost it (a group off at a time). The device
// and its data, a check that the phone did not slow down while testing (the same run at the start and the end), a
// history of the results on this phone (each compared with the one before), a report to copy and a JSON file.
import { D, evAround, note, whyLong } from "./diag.js";
import { state } from "./state.js";
import { keepScreenOn } from "./native.js";

const HIST = "zdrapka.benchHist";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const frame = () => new Promise((r) => requestAnimationFrame(r));
const med = (a) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); return s[s.length >> 1]; };
const pct = (a, p) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(s.length * p))]; };
const mean = (a) => (a.length ? a.reduce((t, x) => t + x, 0) / a.length : null);
const r1 = (x) => (x == null ? null : Math.round(x * 10) / 10);

/** Frames per second the screen gives now, from the frames' spacing while the map moves: 60, 90 or 120 (or 30). */
export function rateOf(dts) {
  const m = med(dts) || 16.7;
  return m < 9.7 ? 120 : m < 13.5 ? 90 : m < 25 ? 60 : 30;
}
/** The screen's own rate, measured with nothing moving (the frames' spacing then is the screen's): 60 / 90 / 120. */
async function screenRate() {
  const d = []; let last = 0;
  for (let i = 0; i < 70; i++) { const now = await frame(); if (last) d.push(now - last); last = now; }
  const m = med(d) || 16.7;
  return m < 9.7 ? 120 : m < 13.5 ? 90 : 60;
}
/** One run's frames: spacing (ms), work (ms) -> the figures. late: over 1.5 frames of the screen; a burst: 3 and more
 * late in a row (what the eye sees as a stop). */
export function frameStats(dts, { cpu = [], gpu = [], hz = rateOf(dts) } = {}) {
  const budget = 1000 / hz, late = dts.map((d) => d > budget * 1.5);
  let bursts = 0, run = 0;
  for (const l of late) { if (l) { run++; if (run === 3) bursts++; } else run = 0; }
  return { n: dts.length, hz, p50: r1(pct(dts, 0.5)), p95: r1(pct(dts, 0.95)), p99: r1(pct(dts, 0.99)), max: Math.round(Math.max(0, ...dts)),
    late: dts.length ? r1((100 * late.filter(Boolean).length) / dts.length) : 0, bursts, cpu: r1(mean(cpu)), cpu95: r1(pct(cpu, 0.95)), gpu: r1(mean(gpu)), gpu95: r1(pct(gpu, 0.95)) };
}
/** Green, yellow or red for a scenario's frames (late share and the 95th percentile against the screen's frame). */
export function grade(s) {
  if (!s) return "grey";
  if (s.open != null) return s.open <= 150 ? "green" : s.open <= 400 ? "yellow" : "red"; // (a page opening: ms to its first frame)
  const budget = 1000 / (s.hz || 60), g = s.late <= 5 && s.p95 <= budget * 1.6 ? "green" : s.late <= 15 ? "yellow" : "red";
  // a stutter of 50 ms and more is seen, whatever the share: one a run at most yellow, three and more red
  return (s.hitch || 0) >= 3 ? "red" : (s.hitch || 0) > 0 && g === "green" ? "yellow" : g;
}

/** A tile's source in a word (the bench's split of the tiles' time): the map, the relief, the far background, the
 * app's own layers by their source id. */
export const srcGroup = (id = "") => (id.startsWith("v:") ? "mapa" : id.startsWith("r:") ? "rzeźba" : id.startsWith("tlo") ? "tło" : id || "?"); // (the app's own layers by their source: ranges, towns, mine…)
/** The stutters (frames of 40 ms and more): when (s from the start), how long, at what zoom, and why (diag.js whyLong:
 * the browser's long animation frame over it). */
export function hitchesOf(slow, loaf, t0 = 0) {
  return slow.map(([at, d, z]) => ({ t: Math.round((at - t0) / 100) / 10, d: Math.round(d), z: Math.round(z * 10) / 10, ...whyLong(loaf, at, d), ev: evAround(at, d) }));
}
/** How even the map's move is on the screen: the frames being even (each within 0.6–1.4 of the usual frame), each
 * frame's step (px) against its neighbours' mean, in % of the usual step: p95 and the jumps (over 50 %). Only moves
 * (the zoom kept) of 0.5 px a frame and more. (The step, not the speed: the map shows the camera a frame late, a
 * speed by the frame's own time would be off when the frames are not even.) */
export function evenness(moves) {
  const st = [];
  for (let i = 1; i < moves.length; i++) {
    const [ta, xa, ya, za] = moves[i - 1], [tb, xb, yb, zb] = moves[i];
    st.push({ dt: tb - ta, dd: Math.abs(zb - za) < 0.002 ? Math.hypot(xb - xa, yb - ya) : null });
  }
  const fr = med(st.map((x) => x.dt)), mv = st.filter((x) => x.dd != null && x.dd >= 0.5).map((x) => x.dd), typ = med(mv);
  if (!fr || !typ) return null;
  const ok = (x) => x.dd != null && x.dt > fr * 0.6 && x.dt < fr * 1.4, e = [];
  for (let i = 1; i < st.length - 1; i++) if (ok(st[i - 1]) && ok(st[i]) && ok(st[i + 1]) && st[i].dd + st[i - 1].dd + st[i + 1].dd >= 1.5) e.push((100 * Math.abs(st[i].dd - (st[i - 1].dd + st[i + 1].dd) / 2)) / typ);
  if (e.length < 20) return null;
  return { p95: Math.round(pct(e, 0.95)), jumps: e.filter((x) => x > 50).length, n: e.length };
}
export function createBench(C) {
  const V = () => C.view, M = () => C.view.map;
  let stopAsked = false, HZ = 60;

  // ---- one measured stretch: frames, the map's work, long frames, tiles, a finger's latency, memory
  function sampler({ finish = false } = {}) {
    const m = M(), gl = m.painter?.context?.gl, tq = gl?.getExtension?.("EXT_disjoint_timer_query_webgl2");
    // finish: no timer on the GPU (most phones): each frame waited out on the GPU (gl.finish) and timed — the GPU's
    // own work, roughly; it holds the page up, so only in its own scenario
    const fin = finish && !tq && gl;
    const dts = [], cpu = [], gpu = [], qs = [], lat = [], tiles = [], loaf = [], pend = [], tileAt = new Map(), bySrc = {}, slow = [], moves = [];
    let ref = null; const gpuSlow = [];
    let on = false, last = 0, raf = 0, paused = 0, po = null, wait = 0, inflight = 0, t0 = 0;
    const r0 = m._render;
    m._render = (...a) => {
      const st = performance.now(); let q = null;
      if (tq && on) { try { q = gl.createQuery(); gl.beginQuery(tq.TIME_ELAPSED_EXT, q); } catch { q = null; } }
      try { return r0.apply(m, a); } finally {
        if (q) { gl.endQuery(tq.TIME_ELAPSED_EXT); qs.push(q); }
        if (on) cpu.push(performance.now() - st);
        if (on && fin) { const g0 = performance.now(); gl.finish(); const g = performance.now() - g0; gpu.push(g); if (g >= 25) gpuSlow.push([performance.now(), g, m.getZoom()]); }
      }
    };
    const poll = () => {
      while (qs.length && gl.getQueryParameter(qs[0], gl.QUERY_RESULT_AVAILABLE)) {
        const q = qs.shift(), ns = gl.getQueryParameter(q, gl.QUERY_RESULT);
        if (!gl.getParameter(tq.GPU_DISJOINT_EXT)) gpu.push(ns / 1e6);
        gl.deleteQuery(q);
      }
    };
    const onRender = () => {
      const now = performance.now(); while (pend.length) lat.push(now - pend.shift());
      if (on && ref) { const q = m.project(ref); moves.push([now, q.x, q.y, m.getZoom()]); } // (a fixed point's place on the screen: how far the map went)
    };
    const key = (e) => e.tile?.tileID?.key != null ? `${e.sourceId}/${e.tile.tileID.key}` : null;
    const onLoading = (e) => { const k = key(e); if (on && k && !tileAt.has(k)) { tileAt.set(k, performance.now()); inflight = Math.max(inflight, tileAt.size); } };
    const onData = (e) => { const k = key(e); if (k && tileAt.has(k)) { const ms = performance.now() - tileAt.get(k); tiles.push(ms); (bySrc[srcGroup(e.sourceId)] ||= []).push(ms); tileAt.delete(k); } };
    const f = (now) => {
      if (on) { const d = now - last; if (d < 500) { dts.push(d); if (!m.areTilesLoaded()) wait += d; if (d >= 40) slow.push([now, d, m.getZoom()]); } else paused++; }
      last = now; if (tq) poll();
      raf = requestAnimationFrame(f);
    };
    const heap0 = performance.memory?.usedJSHeapSize;
    return {
      start() {
        m.on("render", onRender); m.on("dataloading", onLoading); m.on("data", onData);
        try { po = new PerformanceObserver((l) => loaf.push(...l.getEntries())); po.observe({ type: "long-animation-frame" }); } catch { po = null; }
        on = true; last = t0 = performance.now(); ref = m.getCenter(); raf = requestAnimationFrame(f);
      },
      input() { pend.push(performance.now()); },
      async stop() {
        // after the move: how long until the map on the screen is whole (up to 6 s)
        const te = performance.now();
        while (!m.areTilesLoaded() && performance.now() - te < 6000) await frame();
        const after = performance.now() - te;
        on = false; cancelAnimationFrame(raf);
        m._render = r0; m.off("render", onRender); m.off("dataloading", onLoading); m.off("data", onData);
        await sleep(150);
        if (tq) { poll(); for (const q of qs) gl.deleteQuery(q); }
        po?.disconnect();
        // the long frames by whose they were: the map's tiles (messages from its workers), the map's drawing, the app's
        // own code, and the rest (no script: garbage collection, the GPU, the browser)
        let lt = 0, ld = 0, la = 0, lr = 0;
        for (const e of loaf) {
          let s = 0;
          for (const sc of e.scripts || []) {
            s += sc.duration;
            const mg = /maplibre/.test(sc.sourceURL || "");
            if (mg && /message/i.test(`${sc.invokerType} ${sc.invoker}`)) lt += sc.duration; else if (mg) ld += sc.duration; else la += sc.duration;
          }
          lr += Math.max(0, e.duration - s);
        }
        const heap1 = performance.memory?.usedJSHeapSize;
        return { dts, cpu, gpu, lat, tiles, bySrc, inflight, paused, hitches: hitchesOf(slow, loaf, t0), even: evenness(moves), wait: Math.round(wait), after: Math.round(after), long: { n: loaf.length, tiles: Math.round(lt), draw: Math.round(ld), app: Math.round(la), rest: Math.round(lr) },
          heap: heap0 && heap1 ? Math.round((heap1 - heap0) / 1e6) : null, gpuOk: !!tq || !!fin, gpuMax: gpu.length ? Math.round(Math.max(...gpu)) : null,
          gpuSlow: gpuSlow.map(([at, g, z]) => ({ t: Math.round((at - t0) / 100) / 10, g: Math.round(g), z: Math.round(z * 10) / 10, ev: evAround(at, g + 20) })) };
      },
    };
  }

  // ---- fingers: pointer events into the map's own handling
  const cv = () => C.$("map");
  const rect = () => cv().getBoundingClientRect();
  function ptr(type, id, x, y) {
    const r = rect();
    cv().dispatchEvent(new PointerEvent(type, { pointerId: 100 + id, pointerType: "touch", isPrimary: id === 0, clientX: r.left + x, clientY: r.top + y, buttons: type === "pointerup" ? 0 : 1, bubbles: true, cancelable: true }));
  }
  /** A finger along a path (screen px) for ms; end: "stop" (held a moment: no glide) or "fling" (let go moving). */
  /** Past this frame, before the next one: where a real finger's events come (the browser gives them before the
   * frame's callbacks; sent from a frame callback the map would get them out of their order). */
  const between = async () => { await frame(); await new Promise((r) => setTimeout(r, 0)); };
  async function drag(S, path, ms, end = "stop") {
    const at = (q) => { const k = Math.min(path.length - 1.0001, q * (path.length - 1)), i = Math.floor(k), t = k - i; return [path[i][0] + (path[i + 1][0] - path[i][0]) * t, path[i][1] + (path[i + 1][1] - path[i][1]) * t]; };
    ptr("pointerdown", 0, ...path[0]);
    const t0 = performance.now();
    for (;;) {
      await between();
      const q = (performance.now() - t0) / ms;
      const [x, y] = at(Math.min(1, q));
      ptr("pointermove", 0, x, y); S?.input();
      if (q >= 1) break;
    }
    if (end === "stop") { for (let i = 0; i < 8; i++) { await between(); ptr("pointermove", 0, ...path[path.length - 1]); } await sleep(60); }
    ptr("pointerup", 0, ...path[path.length - 1]);
  }
  /** Two fingers apart (zoom in by lv levels) and back together, ms each way. */
  async function pinch(S, lv, ms) {
    const W = V().W, H = V().H, cx = W / 2, cy = H / 2, d0 = Math.min(W, H) * 0.12;
    ptr("pointerdown", 0, cx - d0, cy); ptr("pointerdown", 1, cx + d0, cy);
    for (const dir of [1, -1]) {
      const t0 = performance.now();
      for (;;) {
        await between();
        const q = Math.min(1, (performance.now() - t0) / ms), k = dir > 0 ? q : 1 - q, d = d0 * 2 ** (lv * k);
        ptr("pointermove", 0, cx - d, cy); ptr("pointermove", 1, cx + d, cy); S?.input();
        if (q >= 1) break;
      }
    }
    ptr("pointerup", 1, cx + d0, cy); ptr("pointerup", 0, cx - d0, cy);
  }
  // a pan's path: across the middle of the screen in direction a (radians), long px
  const across = (a, long) => { const W = V().W, H = V().H, cx = W / 2, cy = H * 0.45, dx = Math.cos(a) * long / 2, dy = Math.sin(a) * long / 2; return [[cx + dx, cy + dy], [cx - dx, cy - dy]]; };

  // ---- where: always the same spot (results compare from test to test): Andrzejówka; where it is not on the map, here
  function spot() {
    const v = V(), AT = [16.2778, 50.685], ax = (AT[0] - v.P.lon0) * v.P.kx, ay = (v.P.lat0 - AT[1]) * v.P.ky;
    const inMap = v.index.tiles.some((t) => { const e = t.ext || t.cell; return ax >= e[0] && ax <= e[2] && ay >= e[1] && ay <= e[3]; });
    return inMap ? { x: ax, y: ay, name: "Andrzejówka" } : { ...Object.fromEntries(["x", "y"].map((k, i) => [k, v.centre()[i]])), name: "bieżący widok" };
  }
  async function place(p, z, ms = 6000) {
    const v = V(), m = M();
    v.stopFlight?.(); v.rot = 0;
    v.s = v.s * 2 ** (z - m.getZoom()); v.anchor(p.x, p.y, v.W / 2, v.H / 2); v.sync(); v.draw();
    await frame(); v.s = v.s * 2 ** (z - m.getZoom()); v.anchor(p.x, p.y, v.W / 2, v.H / 2); v.sync(); // (the second: the zoom as MapLibre has it here)
    await v.settled({ ms });
    await sleep(250);
  }
  const clearTiles = () => { for (const sc of Object.values(M().style.sourceCaches || M().style.tileManagers || {})) { try { sc.clearTiles(); } catch { /* */ } } M().triggerRepaint(); };

  // ---- the scenarios: [id, name, quick?, run(S, rep) -> extra figures]
  const SC = [
    { id: "base", name: "Wzorzec (szlaki, z 13)", quick: true, z: 13, run: async (S, k) => { await drag(S, across(k * 1.1, V().W * 0.7), 1600); await drag(S, across(k * 1.1 + Math.PI, V().W * 0.7), 1600); } },
    { id: "overview", name: "Przegląd z mgłą (z 9)", quick: true, z: 9, fog: true, run: async (S, k) => { await drag(S, across(k * 1.3, V().W * 0.8), 1800); await drag(S, across(k * 1.3 + 2, V().W * 0.8), 1800); } },
    { id: "trails", name: "Szlaki z bliska (z 14,5)", quick: true, z: 14.5, run: async (S, k) => { await drag(S, across(k * 0.9 + 0.4, V().W * 0.8), 1800); await drag(S, across(k * 0.9 + 2.4, V().W * 0.8), 1800); } },
    { id: "fling", name: "Machnięcie z poślizgiem (z 12,5)", quick: true, z: 12.5, run: async (S, k) => { await drag(S, across(k * 1.7, V().W * 0.5), 220, "fling"); await sleep(1600); } },
    { id: "pinch", name: "Szczypanie po nowym terenie (z 10 → 13)", quick: true, z: 10, fresh: true, run: async (S) => { await pinch(S, 3, 1800); await sleep(400); } },
    { id: "fresh", name: "Przesuwanie po nowym terenie (z 12)", z: 12, fresh: true, run: async (S, k) => { for (let i = 0; i < 3; i++) await drag(S, across(k * 2.1, V().W * 0.9), 900); } },
    { id: "gpu", name: "Karta graficzna (z 13 ↔ 11, pomiar)", z: 13, finish: true, run: async (S, k) => { await drag(S, across(k * 1.1, V().W * 0.7), 1200); await pinch(S, -2, 1500); await drag(S, across(k * 1.1 + 2, V().W * 0.7), 1200); } },
    { id: "back", name: "Tam i z powrotem (z 12,5)", quick: true, z: 12.5, run: async (S, k) => { const p = across(k * 1.4 + 0.3, V().W * 1.4); await drag(S, p, 1300); await sleep(700); await drag(S, [p[1], p[0]], 1300); } },
    { id: "plan", name: "Z planem trasy (z 13)", quick: true, z: 13, plan: true, run: async (S, k) => { await drag(S, safe(across(k * 1.2 + 0.7, V().W * 0.7)), 1700); await drag(S, safe(across(k * 1.2 + 2.6, V().W * 0.7)), 1700); } },
    { id: "ui", name: "Karta szczytu i Postęp", ui: true },
    { id: "replay", name: "Replay 3D (8 s)", replay: true },
  ];
  // (with a plan: a finger never starts on its line or a point: it would pull the route)
  function safe(path) {
    const v = V(), hit = (x, y) => v.planPointAt?.(x, y, 30) >= 0 || v.planLineAt?.(x, y);
    for (let s = 0; s < 8 && hit(...path[0]); s++) path = path.map(([x, y]) => [x + 23, y + 17]);
    return path;
  }

  /** A temporary plan where we are (a loop of three points), unless one is on the map already; -> undo(). */
  async function tempPlan(p) {
    const P = C.planner;
    if (P.active?.() || P.isActive?.()) return () => {}; // (a plan on the map already: measured with it)
    P.open({ x: p.x - 900, y: p.y + 400 }); P.add({ x: p.x + 700, y: p.y - 500 }); P.add({ x: p.x + 1200, y: p.y + 900 });
    for (let i = 0; i < 100 && !P.route?.P; i++) await sleep(150);
    C.hideTip?.(); C.sheet?.("min");
    return () => { try { P.close(); } catch { /* */ } C.hideTip?.(); };
  }

  /** One scenario, reps times: the frames' figures (median of the runs), the rest summed or the worst. */
  async function scenario(sc, reps, progress) {
    const v = V(), p = spot(), modeWas = v.mode, runs = [];
    if (sc.ui) return uiScenario(reps);
    if (sc.replay) return replayScenario();
    if (sc.fog && modeWas !== "fog") { if (!(v.myDiscs?.length)) return { skip: "brak śladów do mgły" }; C.setMode?.("fog"); await sleep(300); }
    const undo = sc.plan ? await tempPlan(p) : null;
    try {
      for (let k = 0; k < reps && !stopAsked; k++) {
        progress(k);
        await place(p, sc.z);
        if (sc.fresh) { clearTiles(); await v.settled({ ms: 6000 }); }
        const S = sampler({ finish: !!sc.finish }); S.start();
        await sc.run(S, k);
        runs.push(await S.stop());
      }
    } finally {
      undo?.();
      if (sc.fog && modeWas !== "fog") C.setMode?.(modeWas);
    }
    const out = summarize(runs);
    if (sc.finish) out.grade = "grey"; // (its frames held up on purpose: a measure, not a grade)
    return out;
  }
  function summarize(runs) {
    if (!runs.length) return null;
    const each = runs.map((r) => frameStats(r.dts, { ...r, hz: Math.max(HZ, rateOf(r.dts)) })); // (the rate in the move: a phone resting at 60 Hz goes up to 120 as it moves)
    const pick = (k) => med(each.map((e) => e[k]).filter((x) => x != null));
    const all = (k) => runs.flatMap((r) => r[k]);
    const s = { reps: runs.length, n: pick("n"), hz: Math.max(...each.map((e) => e.hz)), p50: pick("p50"), p95: pick("p95"), p99: pick("p99"), max: Math.max(...each.map((e) => e.max)), late: pick("late"), bursts: Math.round(mean(each.map((e) => e.bursts))),
      cpu: pick("cpu"), cpu95: pick("cpu95"), gpu: pick("gpu"), gpu95: pick("gpu95"), gpuOk: runs.some((r) => r.gpuOk),
      lat: r1(pct(all("lat"), 0.5)), lat95: r1(pct(all("lat"), 0.95)), tiles: all("tiles").length, tile50: r1(pct(all("tiles"), 0.5)), tile95: r1(pct(all("tiles"), 0.95)),
      wait: Math.round(med(runs.map((r) => r.wait || 0))), after: Math.round(med(runs.map((r) => r.after || 0))), long: ["n", "tiles", "draw", "app", "rest"].reduce((o, k) => ({ ...o, [k]: Math.round(mean(runs.map((r) => r.long[k]))) }), {}), heap: runs.at(-1).heap, spread: r1(Math.max(...each.map((e) => e.late)) - Math.min(...each.map((e) => e.late))) };
    const src = {};
    for (const r of runs) for (const [g, a] of Object.entries(r.bySrc || {})) (src[g] ||= []).push(...a);
    if (Object.keys(src).length) {
      s.bySrc = Object.fromEntries(Object.entries(src).sort((a, b) => pct(b[1], 0.95) - pct(a[1], 0.95)).map(([g, a]) => [g, { n: a.length, p50: r1(pct(a, 0.5)), p95: r1(pct(a, 0.95)) }]));
      s.inflight = Math.max(...runs.map((r) => r.inflight || 0));
    }
    if (runs.some((r) => r.gpuMax != null)) { s.gpuMax = Math.max(...runs.map((r) => r.gpuMax || 0)); s.gpuSlow = runs.flatMap((r) => r.gpuSlow || []).sort((a, b) => b.g - a.g).slice(0, 4); }
    const hs = runs.flatMap((r) => r.hitches || []);
    s.hitch = r1(hs.filter((h) => h.d >= 50).length / runs.length); // (the stutters of 50 ms and more, a run)
    s.hitchList = [...hs].sort((a, b) => b.d - a.d).slice(0, 3);
    const ev = runs.map((r) => r.even).filter(Boolean);
    if (ev.length) s.even = { p95: med(ev.map((e) => e.p95)), jumps: r1(mean(ev.map((e) => e.jumps))) };
    s.grade = grade(s);
    return s;
  }
  /** A peak's card and Postęp opening: ms from the call to the first frame drawn after it, the longest frame then. */
  async function uiScenario(reps) {
    const opens = [], longs = [];
    const peak = Object.entries(state.result?.found || {}).find(([, f]) => f.c === "peak" && f.outs?.length);
    const time = async (fn) => {
      const S = sampler(); S.start(); const t0 = performance.now();
      fn(); await frame(); await frame();
      const ms = performance.now() - t0; await sleep(500);
      const r = await S.stop(); opens.push(ms); longs.push(Math.max(0, ...r.dts));
    };
    for (let k = 0; k < reps && !stopAsked; k++) {
      if (peak) { const [id, f] = peak; await time(() => C.showTip({ id, c: "peak", n: f.n, e: f.e, x: f.x, y: f.y, d: true, f: f.first, v: f.visits, outs: f.outs })); C.hideTip(); await sleep(300); }
      await time(() => C.drawer("progress")); await sleep(300);
      const b = C.$("progress").querySelector("[data-b]");
      if (b) { await time(() => b.click()); await sleep(300); }
      C.drawer(false); await sleep(400);
    }
    const s = { reps, open: Math.round(med(opens)), open95: Math.round(pct(opens, 0.95)), max: Math.round(Math.max(0, ...longs)), n: opens.length };
    s.grade = grade(s);
    return s;
  }
  /** The latest outing in Replay 3D for 8 s (the frames of its own map). */
  async function replayScenario() {
    const a = (state.result?.activities || []).filter((q) => !q.outside && q.km > 2).sort((x, y) => (y.start || 0) - (x.start || 0))[0];
    if (!a || !C.replay3d) return { skip: "brak wyjścia" };
    C.replay3d(a);
    for (let i = 0; i < 60 && !globalThis.__replay?.playing; i++) await sleep(250);
    await sleep(1500);
    const dts = []; let last = performance.now();
    const t0 = last;
    while (performance.now() - t0 < 8000) { const now = await frame(); const d = now - last; if (d < 500) dts.push(d); last = now; }
    C.replayBack?.(); await sleep(800);
    const s = { reps: 1, ...frameStats(dts, { hz: Math.max(HZ, rateOf(dts)) }) };
    s.grade = grade(s);
    return s;
  }

  // ---- why: for a scenario that came out slow, the same run with one group of layers off at a time
  async function diagnose(sc, progress) {
    const v = V(), m = M(), all = v.styleLayers(), vis0 = new Map(all.map((l) => [l.id, m.getLayoutProperty(l.id, "visibility") ?? "visible"]));
    const mine = /^(mine-|walk-|found)/, tlo = /^(tlo-|bw-|towns$|cities$)/, part = (id) => /:/.test(id) && !tlo.test(id);
    const VAR = [
      ["podpisy i znaki", (l) => l.type === "symbol"], ["Twoje ślady", (l) => mine.test(l.id)], ["tło wokół map", (l) => tlo.test(l.id)],
      ["linie mapy (drogi, szlaki, poziomice)", (l) => l.type === "line" && part(l.id)], ["wypełnienia i rzeźba", (l) => l.type === "fill" || l.type === "raster"],
      ["mgła", () => false, "fog"], ["nakładka 2D (plan, ślady na wierzchu)", () => false, "ov"], ["rozdzielczość 1×", () => false, 1],
    ];
    const p = spot(), out = [], modeWas = v.mode, fogWas = v.fog?.on;
    if (sc.fog && modeWas !== "fog") C.setMode?.("fog");
    const undo = sc.plan ? await tempPlan(p) : null;
    try {
      for (const [i, [name, off, how]] of VAR.entries()) {
        if (stopAsked) break;
        if (how === "fog" && !(v.fog?.on)) continue;
        if (how === 1 && v.dpr <= 1) continue;
        progress(`${sc.name}: bez ${name} (${i + 1}/${VAR.length})`);
        for (const l of all) m.setLayoutProperty(l.id, "visibility", off(l) ? "none" : vis0.get(l.id));
        if (how === "fog") v.fog.on = false;
        if (how === "ov") v.screen.style.visibility = "hidden";
        if (typeof how === "number") m.setPixelRatio(how);
        await place(p, sc.z);
        const S = sampler(); S.start(); await sc.run(S, 0); const r = await S.stop();
        out.push({ name, ...frameStats(r.dts, { ...r, hz: Math.max(HZ, rateOf(r.dts)) }) });
        for (const l of all) if (m.getLayer(l.id)) m.setLayoutProperty(l.id, "visibility", vis0.get(l.id));
        if (how === "fog") v.fog.on = fogWas;
        if (how === "ov") v.screen.style.visibility = "";
        if (typeof how === "number") m.setPixelRatio(v.dpr);
      }
    } finally {
      for (const l of all) if (m.getLayer(l.id)) m.setLayoutProperty(l.id, "visibility", vis0.get(l.id));
      m.setPixelRatio(v.dpr); v.screen.style.visibility = ""; if (v.fog) v.fog.on = fogWas;
      undo?.();
      if (sc.fog && modeWas !== "fog") C.setMode?.(modeWas);
    }
    return out;
  }

  // ---- the device and its data
  async function device() {
    const v = V(), m = M(), gl = m.painter?.context?.gl, dbg = gl?.getExtension?.("WEBGL_debug_renderer_info");
    let version = "web";
    try { version = (await (await fetch("version.json", { cache: "no-store" })).json()).version; } catch { /* the browser */ }
    let battery = null;
    try { const b = await navigator.getBattery?.(); if (b) battery = { level: Math.round(b.level * 100), charging: b.charging }; } catch { /* none */ }
    const w = await v.stats?.().catch(() => ({})) || {};
    const wv = /Chrome\/([\d.]+)/.exec(navigator.userAgent)?.[1] || "?";
    return { version, at: new Date().toISOString().slice(0, 16), gpu: dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : "?", webview: wv,
      screen: `${innerWidth}×${innerHeight}`, dpr: devicePixelRatio, mapDpr: v.dpr, mem: navigator.deviceMemory ?? null, cores: navigator.hardwareConcurrency ?? null,
      heap: performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1e6) : null, battery, mode: v.mode,
      prefetch: v.pre?.stats?.() || null, threads: globalThis.maplibregl?.getWorkerCount?.() ?? null, dropZooms: !!v.map?.cancelPendingTileRequestsWhileZooming, outings: state.result?.activities?.length ?? 0, discs: (v.myDiscs?.length || 0) / 4, layers: v.styleLayers().length, tiles: w.tiles ?? null, at2: spot().name };
  }

  // ---- history: the last 20 results on this phone; each compared with the one before of the same kind
  const loadHist = () => { try { return JSON.parse(localStorage.getItem(HIST) || "[]"); } catch { return []; } };
  function remember(R) {
    const h = loadHist(), prev = [...h].reverse().find((q) => q.kind === R.kind) || null;
    const brief = { kind: R.kind, at: R.device.at, version: R.device.version, hz: R.hz, sc: Object.fromEntries(R.scenarios.filter((q) => q.s && !q.s.skip).map((q) => [q.id, { late: q.s.late, p95: q.s.p95, cpu: q.s.cpu, gpu: q.s.gpu, open: q.s.open, wait: q.s.wait, after: q.s.after, grade: q.s.grade }])) };
    h.push(brief); while (h.length > 20) h.shift();
    try { localStorage.setItem(HIST, JSON.stringify(h)); } catch { /* full */ }
    return prev;
  }

  /** The whole test. kind: "quick" (~1 min: the scenarios twice) or "full" (~5 min: three times, more scenarios,
   * the why for what was slow). -> the result (also D.bench2, the report, the history). */
  async function run(kind = "quick", progress = () => {}) {
    const v = V();
    if (!v.map || !v.ready) return null;
    stopAsked = false;
    const reps = kind === "full" ? 3 : 2, list = SC.filter((q) => kind === "full" || (kind === "quick" ? q.quick : q.id === kind)); // (or one scenario by its id)
    const keep = { s: v.s, ox: v.ox, oy: v.oy, rot: v.rot };
    C.drawer(false); C.hideTip(); C.sheet("min");
    const screenOn = await keepScreenOn(true);
    v.benching = true;
    progress("mierzę odświeżanie ekranu"); await sleep(600); HZ = await screenRate();
    const t0 = performance.now(), R = { kind, device: await device(), scenarios: [], why: [], warn: [] };
    if (!screenOn) R.warn.push("ekran mógł zgasnąć w trakcie (brak blokady)");
    try {
      let i = 0;
      for (const sc of list) {
        if (stopAsked) break;
        i++;
        const s = await scenario(sc, reps, (k) => progress(`${i}/${list.length} ${sc.name}${reps > 1 && !sc.ui && !sc.replay ? ` · ${k + 1}/${reps}` : ""}`)).catch((e) => ({ skip: `błąd: ${e.message}` }));
        R.scenarios.push({ id: sc.id, name: sc.name, s });
      }
      // the same as at the start: did the phone slow down meanwhile (heat)?
      if (!stopAsked) {
        progress("sprawdzam, czy telefon nie zwolnił");
        const end = await scenario(SC[0], 1, () => {}).catch(() => null), b = R.scenarios.find((q) => q.id === "base")?.s;
        R.drift = end && b ? { late0: b.late, late1: end.late, cpu0: b.cpu, cpu1: end.cpu, p950: b.p95, p951: end.p95 } : null;
        if (R.drift && b.cpu && end.cpu > b.cpu * 1.3 && end.cpu - b.cpu > 1.5) R.warn.push(`telefon zwolnił w trakcie (praca mapy na klatkę ${b.cpu} → ${end.cpu} ms): możliwe nagrzanie, wyniki końcowe gorsze`);
      }
      // the why: in the full test, for each map scenario that was not green
      if (kind === "full") for (const q of R.scenarios) {
        const sc = SC.find((x) => x.id === q.id);
        if (stopAsked || !q.s || q.s.skip || !sc?.run || sc.fresh || q.s.grade === "green" || R.why.length >= 2) continue;
        R.why.push({ id: q.id, name: q.name, base: q.s, rows: await diagnose(sc, progress) });
      }
    } finally {
      v.benching = false;
      Object.assign(v, keep); v.camKey = ""; v.sync?.(); v.draw();
      await keepScreenOn(false);
    }
    R.ms = Math.round(performance.now() - t0);
    R.hz = Math.max(HZ, ...R.scenarios.map((q) => q.s?.hz || 0)); // (resting it may say 60: the rate in the moves)
    R.stopped = stopAsked;
    R.prev = remember(R);
    D.bench2 = R;
    note(`test płynności (${kind === "full" ? "pełny" : "szybki"}): ${Math.round(R.ms / 1000)} s`);
    return R;
  }

  // ---- what weighs on the map: a view loaded from nothing, with all its layers and then without each group of them
  // (the groups' layers hidden: their tiles not laid out, the app's own not loaded); what a group costs, and whether it
  // could be drawn beforehand into a picture (no names, nothing that changes with your outings)
  const GROUPS = [
    ["Lasy i tereny", (b) => /^area(-pat)?$/.test(b), true],
    ["Poziomice", (b) => b === "contour", true],
    ["Opisy poziomic", (b) => b === "contour-label", false],
    ["Rzeki i potoki", (b) => b === "waterline", true],
    ["Drogi i koleje", (b) => /^(road|motorway|rail)(-case)?$/.test(b), true],
    ["Ścieżki", (b) => /^(track|path|hard-path|oneway-path)$/.test(b), true],
    ["Szlaki", (b) => /^(hard|trail-.*|oneway|edu|junction)$/.test(b), false],
    ["Granice", (b) => /^(border|border-band|boundary)$/.test(b), true],
    ["Wyciągi i skały", (b) => /^(lift|lift-tick|cliff|cliff-teeth)$/.test(b), true],
    ["Nazwy i ikony", (b) => /^(place.*|poi.*|spot|valley.*|pass|parking|bus|station|ferrata|lake|lift-label)$/.test(b), false],
    ["Rzeźba terenu", (b) => b === "relief", true],
  ];
  const OWN = { ranges: "Nazwy pasm", rpeaks: "Szczyty pasm", found: "Odkryte miejsca", towns: "Miasta z daleka", bways: "Drogi z daleka", rax: "Pasma z daleka", liftst: "Stacje wyciągów" };
  const groupsNow = () => {
    const m = M(), by = new Map();
    for (const id of m.style._order) {
      const l = m.getLayer(id); if (!l?.source || l.visibility === "none") continue;
      const b = id.split(":")[0], g = GROUPS.find((q) => q[1](b)) || (l.source.includes(":") ? null : [OWN[l.source] || l.source, null, false]);
      if (!g) continue;
      if (!by.has(g[0])) by.set(g[0], { name: g[0], bake: g[2], ids: [] });
      by.get(g[0]).ids.push(id);
    }
    return [...by.values()].filter((g) => !/^(mine|plan|saved|marks|group)/.test(g.ids[0]));
  };
  /** A view from nothing: all tiles dropped, then the time till every one of them is in (ms; 8 s at most). */
  async function fromNothing() {
    const m = M();
    await sleep(150);
    clearTiles();
    const t0 = performance.now(), any = () => Object.values(m.style.tileManagers || {}).some((tm) => tm._inViewTiles?.getAllIds().length);
    while (!any() && performance.now() - t0 < 2000) { m._sourcesDirty = true; m.triggerRepaint(); await frame(); } // (asked for at the next frame: the sources marked to update)
    while (!m.areTilesLoaded() && performance.now() - t0 < 8000) await frame();
    return Math.round(performance.now() - t0);
  }
  const midOf = (a) => { const b = [...a].sort((x, y) => x - y); return b.length % 2 ? b[(b.length - 1) / 2] : (b[b.length / 2 - 1] + b[b.length / 2]) / 2; }; // (the even count: the two middle ones' mean)
  async function costRun(progress = () => {}) {
    const v = V();
    if (!v.map || !v.ready) return null;
    stopAsked = false;
    const keep = { s: v.s, ox: v.ox, oy: v.oy, rot: v.rot }, pre = localStorage.getItem("zdrapka.prefetch");
    C.drawer(false); C.hideTip(); C.sheet("min");
    const screenOn = await keepScreenOn(true);
    v.benching = true;
    localStorage.setItem("zdrapka.prefetch", "0"); // (nothing loading besides)
    const p = spot(), ZS = [10, 12.5, 14], groups = groupsNow(), R = { kind: "layers", device: await device(), zooms: ZS, base: [], groups: [] };
    const t0 = performance.now();
    try {
      for (const g of groups) g.ms = [];
      for (const [zi, z] of ZS.entries()) {
        if (stopAsked) break;
        await place(p, z);
        progress(`z ${String(z).replace(".", ",")}: wszystko`);
        await fromNothing(); // (once to warm up: the pack's file read, the glyphs)
        const all = [];
        for (let k = 0; k < 3; k++) all.push(await fromNothing());
        R.base[zi] = midOf(all);
        const bakeAll = { name: "Wszystko do upieczenia razem", bake: true, all: true, ids: groups.filter((g) => g.bake).flatMap((g) => g.ids), ms: [] };
        if (zi === 0) groups.push(bakeAll);
        for (const [gi, g] of groups.entries()) {
          if (stopAsked) break;
          progress(`z ${String(z).replace(".", ",")}: bez „${g.name}” (${gi + 1}/${groups.length})`);
          const m = M();
          for (const id of g.ids) m.setLayoutProperty(id, "visibility", "none");
          const t = [];
          try { for (let k = 0; k < 2; k++) t.push(await fromNothing()); }
          finally { for (const id of g.ids) m.setLayoutProperty(id, "visibility", "visible"); }
          g.ms[zi] = Math.round(R.base[zi] - midOf(t));
        }
      }
    } finally {
      if (pre == null) localStorage.removeItem("zdrapka.prefetch"); else localStorage.setItem("zdrapka.prefetch", pre);
      v.benching = false;
      Object.assign(v, keep); v.camKey = ""; v.sync?.(); v.draw();
      await keepScreenOn(false);
    }
    // a group's share: of the view's time from nothing, what goes without it (the mean over the zooms; the groups
    // overlap, the threads working side by side: the shares do not add up, the one for all that could be baked is measured)
    const share = (g) => { const k = g.ms.map((x, i) => (x != null && R.base[i] ? Math.max(0, x) / R.base[i] : null)).filter((x) => x != null); return k.length ? Math.round((100 * k.reduce((a, b) => a + b, 0)) / k.length) : 0; };
    R.groups = groups.map((g) => ({ name: g.name, bake: g.bake, all: !!g.all, layers: g.ids.length, ms: g.ms, share: share(g) }))
      .sort((a, b) => (a.all - b.all) || (b.share - a.share));
    R.ms = Math.round(performance.now() - t0);
    R.stopped = stopAsked;
    R.warn = screenOn ? [] : ["ekran mógł zgasnąć w trakcie (brak blokady)"];
    D.benchLayers = R;
    note(`test warstw: ${Math.round(R.ms / 1000)} s`);
    return R;
  }
  const benchStop = () => { stopAsked = true; };
  return { benchRun: run, benchStop, benchHistory: loadHist, layerCost: costRun };
}
