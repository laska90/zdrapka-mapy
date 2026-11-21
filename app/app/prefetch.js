// Tiles before they are needed (only how fast the map fills in; nothing it shows changes):
// - the tile memory sized to the phone's RAM (MapLibre keeps by default only about five screens' worth per source:
//   tiles per screen × 5 zoom levels, ~30 here, whatever maxTileCacheSize says: a place seen a moment ago was built
//   again), smaller again if the page's memory runs high;
// - the map standing still a moment: the tiles round the view (about a screen each way) and one level closer in the
//   middle (the usual next move) made in the background, so a pan or a zoom finds them ready; any move stops it;
// - a fling: the tiles where the glide will stop asked for at once, as it starts.
// The tiles made ahead load outside the map's own tiles (never drawn, never under a tap), then go to MapLibre's own
// memory as any tile seen before.
// Off for a test: localStorage "zdrapka.prefetch" = "0".

/** Tiles kept per source, by the phone's memory in GB (navigator.deviceMemory: 0.25 .. 8). */
export function cacheBudget(gb) {
  const g = gb || 4;
  return g >= 8 ? 220 : g >= 6 ? 170 : g >= 4 ? 120 : g >= 2 ? 70 : 40;
}
/** The tiles (x, y at zoom z) covering a box of lon/lat, nearest the middle first, at most max. */
export function tilesOf([w, s, e, n], z, mid, max = 40) {
  const N = 2 ** z, X = (lon) => ((lon + 180) / 360) * N, Y = (lat) => { const r = (lat * Math.PI) / 180; return ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * N; };
  const x0 = Math.max(0, Math.floor(X(w))), x1 = Math.min(N - 1, Math.floor(X(e))), y0 = Math.max(0, Math.floor(Y(n))), y1 = Math.min(N - 1, Math.floor(Y(s)));
  const cx = X(mid[0]), cy = Y(mid[1]), out = [];
  for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) out.push([x, y, Math.hypot(x + 0.5 - cx, y + 0.5 - cy)]);
  return out.sort((a, b) => a[2] - b[2]).slice(0, max).map(([x, y]) => [x, y]);
}

export function createPrefetch(view, note = () => {}) {
  const map = view.map;
  const off = () => { try { return localStorage.getItem("zdrapka.prefetch") === "0"; } catch { return false; } };
  const managers = () => Object.values(map.style?.tileManagers || map.style?.sourceCaches || {}).filter((tm) => tm?._source?.type === "vector" && tm._inViewTiles && tm._outOfViewCache);
  const held = new Map(); // tile -> its manager (held: uses + 1 while it loads)
  let budget = cacheBudget(navigator.deviceMemory), timer = 0, stats = { asked: 0, done: 0, dropped: 0, shrunk: 0 };

  // ---- the tile memory: room for the budget (the zoom levels' cap lifted), applied at the next update
  function size() {
    for (const tm of managers()) { tm._maxTileCacheSize = budget; tm._maxTileCacheZoomLevels = 60; }
    map.triggerRepaint();
  }
  // the page's memory: past 70% of what it may use, half the tiles (once a minute at most)
  let lastShrink = 0;
  setInterval(() => {
    const m = performance.memory;
    if (!m || Date.now() - lastShrink < 60000 || budget <= 30) return;
    if (m.usedJSHeapSize / m.jsHeapSizeLimit > 0.7) { budget = Math.max(30, budget >> 1); lastShrink = Date.now(); stats.shrunk++; size(); note(`kafle: mniej pamięci (${budget} na źródło)`); }
  }, 10000);

  // MapLibre's tile id (its class from any tile of the map: it is not exported)
  let IDC = null;
  const idClass = () => (IDC ||= Object.values(map.style?.tileManagers || {}).flatMap((tm) => tm?._inViewTiles?.getAllTiles?.() || [])[0]?.tileID?.constructor || null);
  // ---- holding a tile while it loads; let go: to MapLibre's memory (loaded) or dropped (not)
  function hold(tm, z, x, y) {
    const src = tm._source, ID = idClass();
    if (!ID || z < (src.minzoom ?? 0)) return;
    const cz = Math.min(z, src.maxzoom ?? 14), k = 2 ** (z - cz), id = new ID(z, 0, cz, Math.floor(x / k), Math.floor(y / k));
    if (tm._inViewTiles.getTileById(id.key) || tm._outOfViewCache.has?.(id)) return;
    const t = tm._addTile(id);
    if (!t || t.hasData?.()) return;
    // out of the map's own tiles at once: it loads on its own (never drawn, never under a finger's tap), and goes to
    // MapLibre's memory once loaded
    tm._inViewTiles.deleteTileById(id.key);
    held.set(t, tm); stats.asked++;
  }
  function release(t, keep = true) {
    const tm = held.get(t);
    if (!tm) return;
    held.delete(t);
    if (--t.uses > 0) return;
    const key = t.tileID.key;
    if (keep && t.hasData() && !tm._inViewTiles.getTileById(key)) { tm._outOfViewCache.add(t.tileID, t, t.getExpiryTimeout()); stats.done++; }
    else { t.aborted = true; tm._abortTile(t); tm._unloadTile(t); stats.dropped++; }
  }
  map.on("data", (e) => { if (e.tile && held.has(e.tile) && e.tile.hasData?.()) release(e.tile); });
  map.on("error", (e) => { if (e.tile && held.has(e.tile)) release(e.tile, false); });

  /** The tiles of a box (lon/lat) at the zoom levels zs, nearest the middle first, max in all. */
  function ask(box, mid, zs, max) {
    if (off()) return;
    let n = 0;
    for (const tm of managers()) for (const z of zs) {
      for (const [x, y] of tilesOf(box, z, mid, max - n)) { try { hold(tm, z, x, y); } catch { /* the map changed under it */ } n++; }
    }
  }
  /** The view's box widened by f screens each way (lon/lat), from the screen's corners (the map may be turned). */
  function around(f = 1, at = null) {
    const W = view.W, H = view.H, pts = [[-f * W, -f * H], [(1 + f) * W, -f * H], [-f * W, (1 + f) * H], [(1 + f) * W, (1 + f) * H]].map(([x, y]) => map.unproject([x + (at ? at[0] : 0), y + (at ? at[1] : 0)]));
    return [Math.min(...pts.map((p) => p.lng)), Math.min(...pts.map((p) => p.lat)), Math.max(...pts.map((p) => p.lng)), Math.max(...pts.map((p) => p.lat))];
  }
  // still a moment (the move over and the view's own tiles in: they first): round the view, and one level in for
  // its middle; once per place (MapLibre's "idle" seldom comes here: the map draws on for the fog, the overlay...)
  let lastAt = "";
  function idle() {
    clearTimeout(timer);
    const t0 = performance.now();
    const go = () => {
      if (map.isMoving()) return;
      if (!map.areTilesLoaded() && performance.now() - t0 < 6000) { timer = setTimeout(go, 150); return; }
      const z = Math.floor(map.getZoom()), c = map.getCenter(), key = `${z}/${c.lng.toFixed(4)}/${c.lat.toFixed(4)}`;
      if (key === lastAt || !idClass()) return;
      lastAt = key;
      const mid = [c.lng, c.lat];
      ask(around(0.9), mid, [z], 28);
      ask(around(-0.25), mid, [z + 1], 8);
    };
    timer = setTimeout(go, 250);
  }
  map.on("moveend", idle);
  // a move: what is still loading of it let go (the view's own tiles first), unless a glide asked for it
  const stop = () => { clearTimeout(timer); for (const [t] of held) if (!t.glide) release(t); };
  map.on("movestart", stop);
  // a finger down (a tap may follow: a plan's point, a card): the page's time is the finger's, the tiles wait
  document.addEventListener("pointerdown", () => { stop(); lastAt = ""; }, { capture: true, passive: true });
  document.addEventListener("pointerup", () => idle(), { capture: true, passive: true });
  /** A fling starting: the glide's end (screen px from the middle) at the zoom of now. */
  function glideTo(dx, dy) {
    if (off()) return;
    const z = Math.floor(map.getZoom()), c = map.unproject([view.W / 2 + dx, view.H / 2 + dy]);
    const before = new Set(held.keys());
    ask(around(0.15, [dx, dy]), [c.lng, c.lat], [z], 16);
    for (const [t] of held) if (!before.has(t)) { t.glide = true; setTimeout(() => release(t), 4000); }
  }
  size(); idle();
  map.on("styledata", () => setTimeout(size, 0)); // (a source added: its memory too)
  return { glideTo, idle, stats: () => ({ ...stats, budget, held: held.size, on: !off() }), resize: size };
}
