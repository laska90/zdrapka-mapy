/* global maplibregl */
// The 3D terrain's heights for every 3D view (Szczyty w aparacie, Kompas trasy, Replay 3D): one map protocol
// making terrarium tiles on the spot from the app's own height grids (core/demtiles.js: offline, nothing to
// download). Each grid gets its own key in the tiles' address, so a finer grid (the 30 m ground near you) is
// new tiles, and two views on two grids keep theirs.

import { demTile, demBounds } from "../core/demtiles.js";

const grids = new Map(), keys = new WeakMap();
let on = false, next = 0;

function register() {
  if (on) return;
  on = true;
  maplibregl.addProtocol("hdem", async (req) => {
    const [k, z, x, y] = req.url.replace("hdem://", "").replace(/\?.*$/, "").split("/").map(Number);
    const dem = grids.get(k)?.deref(), S = 256;
    if (!dem) throw new Error("no grid");
    const cv = new OffscreenCanvas(S, S);
    cv.getContext("2d").putImageData(new ImageData(demTile(dem, z, x, y, S), S, S), 0, 0);
    return { data: await (await cv.convertToBlob({ type: "image/png" })).arrayBuffer() };
  });
}

/**
 * The raster-dem source of a grid. shade: a second source of the same heights for the relief's shading (the
 * engine warns when terrain and hillshade share one).
 */
export function demSource(dem, { shade = false } = {}) {
  register();
  let k = keys.get(dem);
  if (k == null) { k = ++next; keys.set(dem, k); grids.set(k, new WeakRef(dem)); }
  return { type: "raster-dem", tiles: [`hdem://${k}/{z}/{x}/{y}${shade ? "?s" : ""}`], tileSize: 256, maxzoom: 12, encoding: "terrarium", bounds: demBounds(dem) };
}
