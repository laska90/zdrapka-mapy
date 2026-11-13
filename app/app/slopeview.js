// The "Nachylenie" layer (the layers menu): how steep the ways are, a coloured band under them.
// The worker counts the contours the ways cross (core/slope.js), per tile; the map keeps a few tiles.
import { state } from "./state.js";

export function createSlope(C) {
  const tiles = new Map(); // tile no -> runs
  let timer = 0, seq = 0;
  const on = () => !!state.settings.slope;
  function show() { C.view.setSlope?.(on() ? [...tiles.values()].flat() : null); }
  function refresh() {
    clearTimeout(timer);
    if (!on()) return;
    timer = setTimeout(async () => {
      const v = C.view;
      if (!v?.toWorld || !v.map || v.map.getZoom() < 11.6) return;
      const c = [[0, 0], [v.W, 0], [0, v.H], [v.W, v.H]].map(([x, y]) => v.toWorld(x, y));
      const xs = c.map((p) => p[0]), ys = c.map((p) => p[1]), my = ++seq;
      const r = await C.call("slope", { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys), have: [...tiles.keys()] }).catch(() => null);
      if (my !== seq || !r?.tiles?.length) return;
      for (const t of r.tiles) { tiles.delete(t.no); tiles.set(t.no, t.runs); }
      while (tiles.size > 6) tiles.delete(tiles.keys().next().value);
      show();
    }, 250);
  }
  function setSlopeOn(v) {
    state.settings.slope = !!v; C.saveSettings();
    const b = C.$("lySlope"); b.setAttribute("aria-checked", String(!!v));
    show(); refresh();
  }
  function watch() {
    const m = C.view?.map;
    if (!m?.on) { setTimeout(watch, 1500); return; }
    m.on("moveend", refresh);
    C.$("lySlope").setAttribute("aria-checked", String(on()));
    if (on()) { show(); refresh(); }
  }
  C.$("lySlope").onclick = () => setSlopeOn(!on());
  watch();
  return { setSlopeOn };
}
