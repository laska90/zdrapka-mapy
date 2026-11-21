// Height tiles for the map engine's 3D terrain, made on the spot from the app's own height grids (the 90 m
// grid of core/horizon.js, the 30 m ground near you from the contour lines when given): no tiles to download,
// works offline. Terrarium encoding (MapLibre raster-dem "terrarium"): h = R*256 + G + B/256 - 32768.

import { heightAt, groundAt } from "./horizon.js";

/** The web-mercator tile (z, x, y) as heights: RGBA terrarium, size x size, one sample per pixel centre. */
export function demTile(dem, z, x, y, size = 256) {
  const out = new Uint8ClampedArray(size * size * 4), n = 2 ** z;
  for (let j = 0; j < size; j++) {
    const my = (y + (j + 0.5) / size) / n, lat = (Math.atan(Math.sinh(Math.PI * (1 - 2 * my))) * 180) / Math.PI;
    for (let i = 0; i < size; i++) {
      const lon = ((x + (i + 0.5) / size) / n) * 360 - 180;
      const h = (dem.nearGrid ? groundAt(dem, lat, lon) : heightAt(dem, lat, lon)) ?? 0;
      const v = Math.max(0, Math.min(65535.99, h + 32768)), q = (j * size + i) * 4;
      out[q] = Math.floor(v / 256); out[q + 1] = Math.floor(v) % 256; out[q + 2] = Math.floor((v % 1) * 256); out[q + 3] = 255;
    }
  }
  return out;
}

/** The grid's bounds as a MapLibre source's bounds: [west, south, east, north]. */
export function demBounds(dem) {
  return [dem.lon0, dem.lat0 - (dem.h - 1) * dem.dlat, dem.lon0 + (dem.w - 1) * dem.dlon, dem.lat0];
}
