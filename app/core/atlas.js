// Tiled pack v3 (src/scratchcard/web/tiles.py): index, tile lookup, decoding,
// small LRU of decoded tiles. Used by the worker (matching) and the map.
// Segment keys are global: tile number * keyStride + index in the tile.

import { Polyline, decodeLine } from "./geometry.js";

export class Atlas {
  /** @param load async (path) => parsed JSON (relative to the pack root) */
  constructor(index, load, { cache = 12 } = {}) {
    this.index = index; this.load = load; this.cacheSize = cache;
    this.scale = index.scale || 10;
    this.stride = index.keyStride || 1_000_000;
    this.tiles = index.tiles;
    this.byNo = new Map(index.tiles.map((t) => [t.no, t]));
    this.cache = new Map(); // "net:no" | "lm:no" -> promise
    const { lon0, lat0, kx, ky } = index.proj;
    this.project = (lon, lat) => [(lon - lon0) * kx, -(lat - lat0) * ky];
    this.unproject = (x, y) => [lon0 + x / kx, lat0 - y / ky];
  }

  /** Tiles whose content may reach into the box (pack metres). */
  tilesIn(x0, y0, x1, y1, margin = 0) {
    return this.tiles.filter((t) => t.ext[2] >= x0 - margin && t.ext[0] <= x1 + margin && t.ext[3] >= y0 - margin && t.ext[1] <= y1 + margin);
  }

  tileOfKey(k) { return this.byNo.get(Math.floor(k / this.stride)); }

  async cached(kind, tile, make) {
    const id = `${kind}:${tile.no}`;
    let p = this.cache.get(id);
    if (p) { this.cache.delete(id); this.cache.set(id, p); return p; }
    p = make();
    this.cache.set(id, p);
    p.catch(() => this.cache.delete(id));
    while (this.cache.size > this.cacheSize * 2) this.cache.delete(this.cache.keys().next().value);
    return p;
  }

  /** A tile's file: in its pack (several packs make one map: core/packs.js), else relative. */
  path(tile, file) { return `${tile.base || ""}t/${tile.id}/${file}`; }

  /** Decoded network of one tile (its range numbers in the merged list of ranges). */
  net(tile) {
    return this.cached("net", tile, async () => {
      const raw = await this.load(this.path(tile, "net.json"));
      if (tile.rgOff) raw.rg = raw.rg.map((r) => (r >= 0 ? r + tile.rgOff : r));
      return decodeTileNet(raw, tile.no * this.stride, this.scale);
    });
  }

  lm(tile) {
    return this.cached("lm", tile, async () => {
      const lm = await this.load(this.path(tile, "lm.json"));
      if (tile.rgOff) for (const p of lm.pois || []) if (p.rg >= 0) p.rg += tile.rgOff;
      return lm;
    });
  }

  /** Several tiles as one network for the matcher (positions 0..n-1, keys[pos] = global key). */
  async merged(tiles) {
    const nets = await Promise.all(tiles.map((t) => this.net(t)));
    return mergeNets(nets);
  }
}

export function decodeTileNet(raw, base, scale = 10) {
  const n = raw.n, keys = new Float64Array(n);
  for (let i = 0; i < n; i++) keys[i] = base + i;
  return {
    n, keys, raw,
    lines: raw.geom.map((flat) => { const [xs, ys] = decodeLine(flat, scale); return new Polyline(xs, ys); }),
    cat: Int8Array.from(raw.cat),
    hw: raw.hw.map((i) => raw.hwList[i]),
    cols: raw.cols.map((c) => (c ? c.split(",") : [])),
    sn: Int32Array.from(raw.sn),
    en: Int32Array.from(raw.en),
    len: Float64Array.from(raw.len),
    rg: Int16Array.from(raw.rg),
    ow: raw.ow ? Int8Array.from(raw.ow) : null, // one way for walkers: 1 start -> end, -1 back
    gr: raw.gr ? Int8Array.from(raw.gr) : null, // what is underfoot (route.js groundOf), where the pack knows
    df: raw.df ? Int8Array.from(raw.df) : null, // how hard: 0 easy .. 4 alpine (sac_scale, rock, scree)
  };
}

export function mergeNets(nets) {
  if (nets.length === 1) return nets[0];
  const out = { n: 0, keys: [], raw: null, lines: [], cat: [], hw: [], cols: [], sn: [], en: [], len: [], rg: [], geom: [], ow: [], df: [], gr: [] };
  for (const t of nets) {
    out.n += t.n;
    for (let i = 0; i < t.n; i++) {
      out.keys.push(t.keys[i]); out.lines.push(t.lines[i]); out.cat.push(t.cat[i]); out.hw.push(t.hw[i]);
      out.cols.push(t.cols[i]); out.sn.push(t.sn[i]); out.en.push(t.en[i]); out.len.push(t.len[i]); out.rg.push(t.rg[i]);
      out.geom.push(t.raw.geom[i]); out.ow.push(t.ow ? t.ow[i] : 0); out.df.push(t.df ? t.df[i] : 0); out.gr.push(t.gr ? t.gr[i] : 0);
    }
  }
  return out;
}

/** Raw (packed) geometry of position i in a decoded or merged net. */
export const geomOf = (net, i) => (net.raw ? net.raw.geom[i] : net.geom[i]);

/** Point in polygon (ring of [x, y]). */
export function pip(x, y, ring) {
  let ins = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi + 1e-12) + xi) ins = !ins;
  }
  return ins;
}

/** Range outlines from the index (metres): [[[x, y], ...], ...] per range. */
export function rangeRings(index) {
  return index.ranges.map((r) => r.poly.map((flat) => { const [xs, ys] = decodeLine(flat, 1); return Array.from(xs, (x, i) => [x, ys[i]]); }));
}
