// The map on the page, drawn by MapLibre GL from the packs' vector tiles (g/<part>.pmtiles) and
// relief (g/<part>-relief.pmtiles). It keeps the old view's API (render.js): a camera of s (px per
// pack metre at 50° N), ox, oy (where the view's middle is: ((W/2 - ox) / s, (H/2 - oy) / s) in pack
// metres) and rot (the map turned clockwise, radians); the page moves it with anchor / pan / zoomAt /
// rotateAt and calls quick() / draw() / blit(), as before. Screen <-> pack metres is exact web
// mercator (the same as the GL map), so the fingers stay on their spot.
// Over the GL canvas a 2D canvas (the page's #map, it takes the touches) carries what is drawn by
// hand: the plan, the chosen outing, the pin, the GPS dot (overlay.js).

/* global maplibregl, pmtiles */
import { decodeLine } from "../core/geometry.js";
import { openPacks, packUrl } from "../core/packs.js";
import { pip } from "../core/atlas.js";
import { sources, layers, labels, PAPER, ICON_SIZE, POI_TEXT, HALO, DOT, PLATE, INK, FILL } from "./glstyle.js";
import { drawMapSign, drawPlate, drawPlateSign, PEAK_TOP, MAP_COL } from "./glyphs.js";
import { FogLayer } from "./glfog.js";
import { RANGE_LABELS, RANGE_EXTRA, RANGE_ZOOMS, FAR_PEAKS } from "./range-lines.js";
import { KGP } from "../core/badges.js";
import { Overlay } from "./overlay.js";
/** The plan's highlighter band: far out (narrow, stronger) and close in (wide, pale). */
const PLAN_FAR = "#eea127", PLAN_BAND = "#f6cf7c";
/** "r,g,b" at alpha a over the light green ground of the map, as an opaque colour. */
const GROUND = [222, 230, 200];
const mix = (rgb, a) => `rgb(${String(rgb).split(",").map((v, i) => Math.round(GROUND[i] * (1 - a) + +v * a)).join(",")})`;
import { MapData } from "./mapdata.js";
import { blitTook, mark, note, noteEv } from "./diag.js";
import { cacheBudget, createPrefetch } from "./prefetch.js";
const rgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);

/** A 40 m cell as one number (the packs: some 15000 cells across, either side of 0). */
const cellKey = (cx, cy) => (cx + 32768) * 65536 + (cy + 32768);

/** Far out (Poświata): the big cities (r 1) and the places hikers set out from (r 2: resorts, gateways). */
const TOWNS = [
  ["Kraków", 19.94, 50.06, 1], ["Wrocław", 17.03, 51.11, 1], ["Katowice", 19.02, 50.26, 1], ["Ostrava", 18.29, 49.82, 1], ["Rzeszów", 22.0, 50.04, 1], ["Košice", 21.26, 48.72, 1],
  ["Kielce", 20.63, 50.87, 1], ["Opole", 17.93, 50.67, 1], ["Hradec Králové", 15.83, 50.21, 1], ["Liberec", 15.06, 50.77, 1], ["Olomouc", 17.25, 49.59, 1], ["Dresden", 13.74, 51.05, 1],
  ["Bielsko-Biała", 19.04, 49.82, 1], ["Jelenia Góra", 15.73, 50.9, 1], ["Wałbrzych", 16.28, 50.77, 1], ["Žilina", 18.74, 49.22, 1], ["Nowy Sącz", 20.69, 49.62, 1], ["Tarnów", 20.99, 50.01, 1],
  ["Banská Bystrica", 19.15, 48.74, 1], ["Prešov", 21.24, 49.0, 1], ["Krosno", 21.77, 49.69, 1], ["Kłodzko", 16.65, 50.44, 1], ["Nowy Targ", 20.03, 49.48, 1], ["Poprad", 20.3, 49.06, 1],
  ["Zakopane", 19.95, 49.3, 2], ["Karpacz", 15.76, 50.78, 2], ["Szklarska Poręba", 15.52, 50.83, 2], ["Świeradów-Zdrój", 15.33, 50.91, 2], ["Szczyrk", 19.03, 49.72, 2], ["Wisła", 18.86, 49.66, 2],
  ["Ustroń", 18.81, 49.72, 2], ["Krynica-Zdrój", 20.96, 49.42, 2], ["Szczawnica", 20.49, 49.43, 2], ["Rabka-Zdrój", 19.96, 49.61, 2], ["Ustrzyki Dolne", 22.59, 49.43, 2], ["Wetlina", 22.47, 49.14, 2],
  ["Cisna", 22.33, 49.21, 2], ["Zawoja", 19.54, 49.64, 2], ["Korbielów", 19.34, 49.56, 2], ["Kudowa-Zdrój", 16.24, 50.44, 2], ["Duszniki-Zdrój", 16.39, 50.4, 2], ["Polanica-Zdrój", 16.51, 50.41, 2],
  ["Międzygórze", 16.78, 50.23, 2], ["Lądek-Zdrój", 16.88, 50.34, 2], ["Bukowina Tatrzańska", 20.11, 49.34, 2], ["Muszyna", 20.9, 49.36, 2], ["Komańcza", 22.06, 49.34, 2], ["Špindlerův Mlýn", 15.61, 50.73, 2],
  ["Pec pod Sněžkou", 15.73, 50.69, 2], ["Harrachov", 15.43, 50.77, 2], ["Jeseník", 17.2, 50.23, 2], ["Karlova Studánka", 17.31, 50.07, 2], ["Starý Smokovec", 20.22, 49.14, 2], ["Štrbské Pleso", 20.06, 49.12, 2],
  ["Ždiar", 20.27, 49.27, 2], ["Terchová", 19.03, 49.26, 2], ["Liptovský Mikuláš", 19.61, 49.08, 2], ["Ružomberok", 19.3, 49.08, 2], ["Martin", 18.92, 49.07, 2], ["Święta Katarzyna", 20.89, 50.9, 2],
  ["Nowa Słupia", 21.09, 50.86, 2], ["Żywiec", 19.19, 49.69, 2], ["Limanowa", 20.42, 49.71, 2], ["Sokołowsko", 16.24, 50.68, 2],
];

export const absSpec = (spec) => (typeof spec === "string" ? new URL(spec, location.href).href : spec.map((p) => ({ ...p, base: new URL(p.base, location.href).href })));

const SHARP = 1.5, DEG = Math.PI / 180;
const psi = (lat) => Math.log(Math.tan(Math.PI / 4 + (lat * DEG) / 2)); // mercator y of a latitude (radians of arc)
const lat_ = (y) => (2 * Math.atan(Math.exp(y)) - Math.PI / 2) / DEG;

let protocol = null;
/** PMTiles over HTTP range requests; where the server sends the whole file instead (some file
 * servers on phones), the whole file once, kept in memory. */
class WholeFile {
  constructor(url) { this.url = url; this.buf = null; }
  getKey() { return this.url; }
  async getBytes(offset, length) {
    this.buf ||= fetch(this.url).then((r) => { if (!r.ok) throw new Error(`${r.status} ${this.url}`); return r.arrayBuffer(); });
    let b;
    try { b = await this.buf; } catch (e) { this.buf = null; throw e; } // (a failed download: again at the next tile, not never)
    return { data: b.slice(offset, offset + length) };
  }
}
class RangeOrWhole {
  constructor(url) { this.url = url; this.range = new pmtiles.FetchSource(url); this.whole = null; }
  getKey() { return this.url; }
  async getBytes(offset, length, signal, etag) {
    if (this.whole) return this.whole.getBytes(offset, length);
    try {
      const r = await this.range.getBytes(offset, length, signal, etag);
      // a server that answers a range with more than it (the whole file, or from the range's start to
      // the end): take the range out, from where the bytes look right (a tile or directory: gzip; a
      // relief tile: WebP; the header at 0 either way)
      if (r.data.byteLength > length) {
        if (!this.warned) { this.warned = true; note(`pmtiles: serwer oddał ${Math.round(r.data.byteLength / 1e6)} MB zamiast zakresu (${this.url.split("/").pop()})`); }
        const looks = (o) => { if (o + 4 > r.data.byteLength) return false; const v = new Uint8Array(r.data, o, 4); return (v[0] === 0x1f && v[1] === 0x8b) || (v[0] === 0x52 && v[1] === 0x49 && v[2] === 0x46 && v[3] === 0x46); };
        const from = offset && looks(offset) && !looks(0) ? offset : 0;
        return { ...r, data: r.data.slice(from, from + length) };
      }
      return r;
    } catch (e) {
      if (signal?.aborted) throw e;
      // only a server that cannot answer a range at all (pmtiles says so) gets the whole file; a network hiccup
      // (Failed to fetch, a timeout) is only that: the tile fails, the map asks again later; never the whole
      // file over the internet for one bad moment (it was: a pack's tiles gone for the whole visit)
      if (!/byte serving|content-length|range/i.test(String(e?.message || e))) {
        if (!this.hiccup) { this.hiccup = true; note(`pmtiles: ${this.url.split("/").pop()}: ${String(e?.message || e).slice(0, 100)} (spróbuję jeszcze raz)`); }
        throw e;
      }
      console.warn("pmtiles: no range requests, whole file", this.url, e?.message);
      note(`pmtiles: cały plik ${this.url.split("/").pop()}: ${String(e?.message || e).slice(0, 120)}`);
      this.whole = new WholeFile(this.url);
      return this.whole.getBytes(offset, length);
    }
  }
}
/**
 * A pack as one map (one source instead of one per part; packs built with split_parts.py, index.split): each tile
 * lives in one part's file (g/<part>.pmtiles: the tiles it owns, with the whole pack's features); a part's
 * own features in the tiles another part owns are in g/<part>-edge.pmtiles (for a phone without that part).
 * Asked for a tile: the owners' files of the parts on the phone, else their edges (the biggest).
 */
class PackRouter {
  /** files: [{own, edge}] (PMTiles; edge may fail: an older download). */
  constructor(files) { this.files = files.map((f) => ({ ...f, box: null, dead: { own: false, edge: false } })); }
  async header() {
    const hs = await Promise.all(this.files.map(async (f) => { try { const h = await f.own.getHeader(); f.box = [h.minLon, h.minLat, h.maxLon, h.maxLat]; return h; } catch { f.dead.own = true; return null; } }));
    const ok = hs.filter(Boolean);
    if (!ok.length) return null;
    return { minzoom: Math.min(...ok.map((h) => h.minZoom)), maxzoom: Math.max(...ok.map((h) => h.maxZoom)), tileType: ok[0].tileType,
      bounds: [Math.min(...ok.map((h) => h.minLon)), Math.min(...ok.map((h) => h.minLat)), Math.max(...ok.map((h) => h.maxLon)), Math.max(...ok.map((h) => h.maxLat))] };
  }
  async tile(z, x, y, signal) {
    const n = 2 ** z, lon0 = (x / n) * 360 - 180, lon1 = ((x + 1) / n) * 360 - 180;
    const lat = (k) => (Math.atan(Math.sinh(Math.PI * (1 - (2 * k) / n))) * 180) / Math.PI, lat0 = lat(y + 1), lat1 = lat(y);
    const near = this.files.filter((f) => !f.box || !(f.box[2] < lon0 || f.box[0] > lon1 || f.box[3] < lat0 || f.box[1] > lat1));
    const get = async (f, k) => { if (f.dead[k]) return null; try { return (await f[k].getZxy(z, x, y, signal)) || null; } catch (e) { if (signal?.aborted) throw e; if (!/abort/i.test(e?.name || "")) f.dead[k] = k === "edge"; return null; } };
    const own = await Promise.all(near.map((f) => get(f, "own")));
    const hit = own.find(Boolean);
    if (hit) return hit.data;
    const edge = (await Promise.all(near.map((f) => get(f, "edge")))).filter(Boolean);
    return edge.length ? edge.reduce((a, b) => (b.data.byteLength > a.data.byteLength ? b : a)).data : null;
  }
}
const ROUTERS = new Map();
let zpackOn = false;
function zpackProtocol() {
  if (zpackOn) return;
  zpackOn = true;
  // zpack://<router>/{z}/{x}/{y}
  maplibregl.addProtocol("zpack", async (params, abort) => {
    const m = /^zpack:\/\/([^/]+)\/(\d+)\/(\d+)\/(\d+)/.exec(params.url), r = m && ROUTERS.get(m[1]);
    if (!r) throw new Error(`zpack: ${params.url}`);
    const data = await r.tile(+m[2], +m[3], +m[4], abort?.signal);
    // no relief there (outside its parts): "not found", so MapLibre counts the tile done (with no data it waited on
    // it for ever: the map never whole, never idle, at the far zooms)
    if (!data && r.raster) throw Object.assign(new Error("no tile"), { status: 404 });
    return { data: data ? new Uint8Array(data) : new Uint8Array() };
  });
}
function pmtilesProtocol() {
  if (protocol) return protocol;
  protocol = new pmtiles.Protocol();
  maplibregl.addProtocol("pmtiles", protocol.tile);
  return protocol;
}

/** What the map sends to the GPU, a frame (for the stutters' "around": a frame lost past the page, with programs
 * made — the GPU compiles them — or much uploaded, says what held the GPU up): the GL context's calls counted;
 * -> a function for each frame's end, noting the frame's sum when it is worth it. */
function watchGpu(gl) {
  if (!gl || gl.__watched) return null;
  gl.__watched = true;
  let prog = 0, tex = 0, buf = 0;
  const dims = (a, i) => (typeof a[i] === "number" ? [a[i], a[i + 1]] : null);
  const texB = (f, a) => { const src = a[a.length - 1], d = f === "texImage2D" ? (a.length >= 9 ? dims(a, 3) : null) : (a.length >= 9 ? dims(a, 4) : null); const [w, h] = d || [src?.width || 0, src?.height || 0]; return w * h * 4; };
  const wrap = (f, add) => { const o = gl[f]; if (typeof o !== "function") return; gl[f] = function (...a) { try { add(f, a); } catch { /* counting only */ } return o.apply(gl, a); }; };
  wrap("linkProgram", () => { prog++; });
  wrap("texImage2D", (f, a) => { tex += texB(f, a); });
  wrap("texSubImage2D", (f, a) => { tex += texB(f, a); });
  wrap("bufferData", (f, a) => { buf += typeof a[1] === "number" ? a[1] : a[1]?.byteLength || 0; });
  wrap("bufferSubData", (f, a) => { buf += a[2]?.byteLength || 0; });
  const mb = (b) => `${Math.round(b / 1e5) / 10} MB`;
  return () => {
    if (prog || tex >= 256e3 || buf >= 512e3) noteEv(`GPU: ${[prog ? `programy ${prog}` : "", tex >= 256e3 ? `obrazy ${mb(tex)}` : "", buf >= 512e3 ? `dane ${mb(buf)}` : ""].filter(Boolean).join(", ")}`);
    prog = 0; tex = 0; buf = 0;
  };
}
/** The tiles' tuning, with 8 cores and more (off by zdrapka.tune = "0", the A/B's first half): 5 threads cutting tiles
 * (MapLibre gives one but on Safari) and a pinch's in-between zooms dropped. On the phone (1.0.248): a pinch over new
 * ground waited 2.6 → 1.4 s, the overview 550 → 234 ms. */
export const tileTuning = () => { try { return localStorage.getItem("zdrapka.tune") !== "0" && (navigator.hardwareConcurrency || 0) >= 8; } catch { return false; } };
export class MapView {
  constructor(canvas, hooks = {}) {
    this.screen = canvas; this.hooks = hooks; this.mode = "fog";
    this.s = 0.01; this.ox = 0; this.oy = 0; this.rot = 0; this.W = 1; this.H = 1; this.dpr = 1;
    this.glow = true; this.icons = true; this.trace = "123,85,230";
    let box = document.getElementById("gl");
    if (!box) { box = document.createElement("div"); box.id = "gl"; canvas.before(box); }
    this.box = box;
    this.ov = new Overlay(this);
    this.data = null;
    this.camKey = "";
  }

  // ---- loading
  /** spec: a pack's base, or the packs on the phone [{id, base, groups}] (core/packs.js). */
  async load(spec) {
    const abs = absSpec(spec), { index, packs } = await openPacks(abs, async (u) => (await fetch(u)).json());
    this.index = this.meta = index;
    const P = index.proj;
    this.P = P; this.psi0 = psi(P.lat0);
    // px per radian of mercator for s = 1 (px per pack metre at lat0)
    this.k1 = P.ky / DEG * Math.cos(P.lat0 * DEG);
    const [x0, y0, x1, y1] = index.bounds;
    this.SH = [x0 + 1500, y0 + 1500, x1 - 1500, y1 - 1500];
    this.SHS = (index.sheets?.length ? index.sheets : [index.bounds]).map(([a, b, c, d]) => [a + 1500, b + 1500, c - 1500, d - 1500]);
    this.ranges = index.ranges.map((r) => {
      let b = [Infinity, Infinity, -Infinity, -Infinity];
      const rings = r.poly.map((flat) => { const [xs, ys] = decodeLine(flat, 1); return Array.from(xs, (x, i) => [x, ys[i]]); });
      for (const ring of rings) for (const [x, y] of ring) b = [Math.min(b[0], x), Math.min(b[1], y), Math.max(b[2], x), Math.max(b[3], y)];
      return { id: r.id, label: r.label, short: r.short, bbox: b, na: r.na, rings };
    });
    this.allRanges = this.ranges;
    this.ranges = this.ranges.filter((r) => !r.na);
    // the parts on the phone: one vector and one relief source each; a pack built as one map (index.split):
    // one source for the whole pack (its parts on the phone behind it: PackRouter)
    this.parts = [];
    for (const p of packs) {
      const groups = p.groups || [...new Set(p.index.tiles.map((t) => t.grp || p.index.region))];
      if (!p.index.vector) { console.warn(`pack ${p.index.region}: no vector tiles (an older download)`); this.old = true; continue; }
      if (p.index.split && groups.length > 1) {
        const id = String(p.index.region).replace(/[^\w-]/g, "_"), file = (g, k) => new pmtiles.PMTiles(new RangeOrWhole(packUrl(p.base, `g/${g}${k}.pmtiles`)));
        const vec = new PackRouter(groups.map((g) => ({ own: file(g, ""), edge: file(g, "-edge") })));
        const rel = p.index.relief ? new PackRouter(groups.map((g) => ({ own: file(g, "-relief"), edge: file(g, "-relief-edge") }))) : null;
        const [hv, hr] = await Promise.all([vec.header(), rel?.header()]);
        if (!hv) { note(`mapa: ${id}: brak plików części`); continue; }
        ROUTERS.set(id, vec); if (rel && hr) { rel.raster = true; ROUTERS.set(`${id}~r`, rel); }
        zpackProtocol();
        this.parts.push({ id, groups, tiles: [`zpack://${id}/{z}/{x}/{y}`], minzoom: hv.minzoom, maxzoom: hv.maxzoom, bounds: hv.bounds,
          ...(rel && hr ? { relief: true, reliefTiles: [`zpack://${id}~r/{z}/{x}/{y}`], reliefMin: hr.minzoom, reliefMax: hr.maxzoom, reliefBounds: hr.bounds } : {}) });
        continue;
      }
      // (a pack built with the parts' shaded relief: g/<part>-relief.pmtiles beside the vector tiles)
      for (const g of groups) this.parts.push({ id: `${p.index.region}-${g}`.replace(/[^\w-]/g, "_"), url: "pmtiles://" + packUrl(p.base, `g/${g}.pmtiles`), raw: packUrl(p.base, `g/${g}.pmtiles`),
        ...(p.index.relief ? { relief: "pmtiles://" + packUrl(p.base, `g/${g}-relief.pmtiles`), rawRelief: packUrl(p.base, `g/${g}-relief.pmtiles`) } : {}) });
    }
    const proto = pmtilesProtocol();
    for (const p of this.parts) for (const u of [p.raw, p.rawRelief].filter(Boolean)) proto.add(new pmtiles.PMTiles(new RangeOrWhole(u)));
    if (this.parts.some((p) => p.tiles)) note(`mapa: paczki jako jedna mapa (źródła: ${this.parts.length})`);
    this.data = new MapData(this, packs);
    this.measure();
    await this.makeMap();
    this.loaded = true;
  }

  /** The style's layers in order as {id, type, source} (map.getStyle() copies the whole style with every
   * GeoJSON source's data, megabytes: hundreds of ms on a phone). */
  styleLayers(map = this.map) { return (map?.getLayersOrder?.() || []).map((id) => map.getLayer(id)).filter(Boolean); }

  makeMap() {
    try { const c = document.createElement("canvas"), gl = c.getContext("webgl2"); note(gl ? `WebGL2: ${gl.getParameter(gl.VERSION)}` : "brak WebGL2 w tym WebView"); } catch (e) { note(`WebGL2: ${e.message}`); }
    const root = new URL("../vendor/fonts/", import.meta.url).href;
    const [cx, cy] = this.centre(), [lon, lat] = this.ll(cx, cy);
    this.fog = new FogLayer();
    this.fog.tint = rgb(INK.paper); this.fog.wash = 0.28; this.fog.shade = rgb("#6b4a2a"); // (washed towards the paper; the holes' edge in brown ink)
    const tune = tileTuning(); // (5 threads for the tiles on 8 cores and more; a pinch's in-between zooms not loaded; the A/B in the smoothness test)
    if (tune) try { maplibregl.setWorkerCount(Math.max(maplibregl.getWorkerCount(), 5)); } catch { /* the pool already made: the next start */ }
    this.map = new maplibregl.Map({
      container: this.box, interactive: false, attributionControl: false,
      style: { version: 8, glyphs: root + "{fontstack}/{range}.pbf", sources: sources(this.parts), layers: [...layers(this.parts, { accent: this.trace }), ...labels(this.parts)] },
      center: [lon, lat], zoom: this.zoom(), bearing: this.bearing(),
      pixelRatio: this.dpr, fadeDuration: 150, maxZoom: 19, minZoom: 3, renderWorldCopies: false,
      maxTileCacheSize: cacheBudget(navigator.deviceMemory), maxTileCacheZoomLevels: 60, refreshExpiredTiles: false, cancelPendingTileRequestsWhileZooming: tune, // (the tiles by the phone's memory, not ~5 screens; asked for in a pinch: finished, not asked again)
      canvasContextAttributes: { antialias: false, preserveDrawingBuffer: false, powerPreference: "default" },
    });
    this.map.on("styleimagemissing", (e) => this.icon(e.id));
    const gpuNote = watchGpu(this.map.painter?.context?.gl);
    this.map.on("render", () => {
      this.ov.frame();
      const now = performance.now();
      this.renderedAt = now;
      gpuNote?.();
      if (this.lastR && now - this.lastR < 250 && now - (this.camAt || 0) < 120) blitTook(now - this.lastR, this.benching ? null : { z: this.map.getZoom(), mode: this.mode, plan: !!this.ov.plan?.pts?.length }); // frame to frame while moving (and by where: real use)
      this.lastR = now;
    });
    this.map.once("idle", () => mark("mapa narysowana"));
    this.map.on("idle", () => { this.idleN = (this.idleN || 0) + 1; const ws = this.settleWaiters || []; this.settleWaiters = []; for (const w of ws) w.res(true); });
    // ready once the style is in (the tiles come as they come); a map that never gets there does not
    // hold the app up: after 20 s it goes on without it (what went wrong is in Diagnostyka)
    return new Promise((res) => {
      let done = false;
      const ready = () => { if (done) return; done = true; this.styleIn = true; try { this.addMine(); } catch (e) { note(`mapa: ${e.message}`); } try { if (this.ov.plan) this.planLayer(); } catch (e) { note(`plan: ${e.message}`); } try { if (this.liftSt) this.setLiftStations(this.liftSt); } catch (e) { note(`lifts: ${e.message}`); } this.ready = true; this.autoSharp(); try { this.pre ||= createPrefetch(this, note); } catch (e) { note(`kafle z wyprzedzeniem: ${e.message}`); } if (this.bdWant) this.setBackdrop(this.bdWant); res(); };
      if (this.map.isStyleLoaded()) ready(); else this.map.once("style.load", ready);
      this.map.once("load", () => mark("mapa wczytana"));
      this.map.on("error", (e) => { const m = (e.sourceId ? `[${e.sourceId}] ` : "") + (e.error?.message || String(e)); console.warn("map:", m); this.errs = (this.errs || 0) + 1; if (this.errs <= 6) note(`mapa: ${m.slice(0, 160)}`); });
      setTimeout(() => { if (!done) { note("mapa: styl nie wczytał się w 20 s"); this.broken = true; done = true; res(); } }, 20000);
    });
  }

  /** The signs as images, made (drawn at once: the map asks synchronously) when the map first wants
   * one ("peak-kts@d", "hut@n"); 2 px per CSS px, the sign a little left of the middle (the medals on its right). */
  icon(id) {
    if (id.startsWith("gdots:")) { // friends who have been on a summit: a dot each, in their colours, on a white pill
      const cs = id.slice(6).split(","), k = 3, r = 3.6, gap = 2.4, W = Math.ceil(cs.length * (2 * r + gap) - gap + 6), H = Math.ceil(2 * r + 5), c = new OffscreenCanvas(W * k, H * k), g = c.getContext("2d");
      g.scale(k, k); g.fillStyle = "rgba(255,255,255,.9)"; g.beginPath(); g.roundRect(0, 0, W, H, H / 2); g.fill();
      cs.forEach((col, i) => { g.beginPath(); g.arc(3 + r + i * (2 * r + gap), H / 2, r, 0, 7); g.fillStyle = col; g.fill(); });
      this.map.addImage(id, g.getImageData(0, 0, W * k, H * k), { pixelRatio: k });
      return;
    }
    if (id.startsWith("pat-")) { // the ground's textures (16 px tiles, repeating): dwarf pine rings, scree stones, rock hatching
      const kind = id.slice(4), atlas = true, k = 2, B = kind === "scrub" ? 22 : 16, c = new OffscreenCanvas(B * k, B * k), g = c.getContext("2d");
      g.scale(k, k); g.lineCap = "round";
      if (kind === "scrub") { g.strokeStyle = atlas ? "rgba(70,110,50,.42)" : "rgba(60,110,50,.4)"; g.lineWidth = 0.8; for (const [x, y, r] of [[4, 5, 1.5], [7.5, 6.5, 1.2], [15, 13, 1.5], [17.5, 15.5, 1.2], [8, 18.5, 1.3]]) { g.beginPath(); g.arc(x, y, r, 0, 7); g.stroke(); } }
      else if (kind === "scree") { g.fillStyle = "rgba(95,85,75,.5)"; for (const [x, y, r] of [[3, 3, 0.9], [10, 5, 0.7], [6, 10, 0.8], [13, 12, 1], [2, 14, 0.6], [12, 1, 0.5]]) { g.beginPath(); g.arc(x, y, r, 0, 7); g.fill(); } }
      else if (kind === "bare") { g.strokeStyle = "rgba(95,85,75,.35)"; g.lineWidth = 0.7; for (const [x, y] of [[2, 6], [9, 2], [11, 12], [4, 14]]) { g.beginPath(); g.moveTo(x, y); g.lineTo(x + 3, y - 2.5); g.stroke(); } }
      this.map.addImage(id, g.getImageData(0, 0, B * k, B * k), { pixelRatio: k });
      return;
    }
    if (id === "spot") { const k = 3, B = 6, c = new OffscreenCanvas(B * k, B * k), g = c.getContext("2d"); g.scale(k, k); g.fillStyle = "#6d5d4c"; g.beginPath(); g.arc(3, 3, 1.5, 0, 7); g.fill(); this.map.addImage(id, g.getImageData(0, 0, B * k, B * k), { pixelRatio: k }); return; }
    const DOTS = { dot: [3.6, "#5e5a55", 1.3], "dot-n": [4.3, "#4a4642", 1.5], pdot: [4.6, "#5e5a55", 1.6], "pdot-n": [5.2, "#4a4642", 1.8] }; // small, quiet (planning: a little bigger, never amber: amber is the plan's points)
    if (DOTS[id]) { // a junction: a white dot with a ring
      const [r, col, w] = DOTS[id], k = 2, B = Math.ceil((r + w) * 2 + 2), c = new OffscreenCanvas(B * k, B * k), g = c.getContext("2d");
      g.scale(k, k); g.beginPath(); g.arc(B / 2, B / 2, r, 0, 7); g.fillStyle = "#fff"; g.fill(); g.lineWidth = w; g.strokeStyle = col; g.stroke();
      this.map.addImage(id, g.getImageData(0, 0, B * k, B * k), { pixelRatio: k });
      return;
    }
    // getting there: one graphite square each (stations, bus stops, car parks, lifts), drawn at 4x (sharp on any screen)
    const square = (draw) => { const k = 4, B = 26, c = new OffscreenCanvas(B * k, B * k), g = c.getContext("2d"); g.scale(k, k); g.lineJoin = "round"; g.lineCap = "round"; draw(g, B / 2); this.map.addImage(id, g.getImageData(0, 0, B * k, B * k), { pixelRatio: k }); };
    const SQ = 19;
    // (the train: Material Icons "train", Apache License 2.0)
    if (id === "station-plate") return square((g, m) => drawPlateSign(g, m, m, SQ, MAP_COL.go, "M12 2c-4 0-8 .5-8 4v9.5C4 17.43 5.57 19 7.5 19L6 20.5v.5h2.23l2-2H14l2 2h2v-.5L16.5 19c1.93 0 3.5-1.57 3.5-3.5V6c0-3.5-3.58-4-8-4zM7.5 17c-.83 0-1.5-.67-1.5-1.5S6.67 14 7.5 14s1.5.67 1.5 1.5S8.33 17 7.5 17zm3.5-7H6V6h5v4zm2 0V6h5v4h-5zm3.5 7c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5 1.5.67 1.5 1.5-.67 1.5-1.5 1.5z", 0.7));
    if (id === "bus-plate" || id === "parking-hi") return square((g, m) => drawMapSign(g, id === "bus-plate" ? "bus" : "parking", m, m, 16 * 1.2, false)); // (bare, printed in: PLATE draws them a little smaller)
    if (id === "parking" || id === "station" || id === "bus" || id === "pass") { // (the same signs where the plates are not used)
      const k = 2, B = 32, c = new OffscreenCanvas(B * k, B * k), g = c.getContext("2d");
      g.scale(k, k); drawMapSign(g, id, B / 2, B / 2, 16, false);
      this.map.addImage(id, g.getImageData(0, 0, B * k, B * k), { pixelRatio: k });
      return;
    }
    if (id === "lift-lo" || id === "lift-hi" || id === "lift-mid") return square((g, m) => { // a lift's station: a cabin on its rope; a small arrow in the corner: up from here (lower), down (upper)
      drawPlate(g, m, m, SQ, MAP_COL.go);
      const x0 = m - SQ / 2, y0 = m - SQ / 2, q = SQ / 17; g.translate(x0, y0); g.scale(q, q); g.translate(-x0, -y0);
      g.strokeStyle = "#fff"; g.lineWidth = 1.2; g.beginPath(); g.moveTo(x0 + 2.6, y0 + 6.4); g.lineTo(x0 + 11, y0 + 4.2); g.stroke(); g.beginPath(); g.moveTo(x0 + 7, y0 + 5.4); g.lineTo(x0 + 7, y0 + 8); g.stroke();
      g.fillStyle = "#fff"; g.beginPath(); g.roundRect(x0 + 3.9, y0 + 8, 6.2, 5.8, 1.3); g.fill();
      g.fillStyle = MAP_COL.go; g.fillRect(x0 + 5, y0 + 9.1, 1.7, 1.8); g.fillRect(x0 + 7.3, y0 + 9.1, 1.7, 1.8);
      const cx = x0 + 13.6, cy = y0 + 11; g.fillStyle = "#fff"; g.beginPath();
      if (id === "lift-mid") { g.moveTo(cx, cy - 4); g.lineTo(cx + 1.8, cy - 1.6); g.lineTo(cx - 1.8, cy - 1.6); g.closePath(); g.moveTo(cx, cy + 4); g.lineTo(cx + 1.8, cy + 1.6); g.lineTo(cx - 1.8, cy + 1.6); }
      else if (id === "lift-lo") { g.moveTo(cx, cy - 2.4); g.lineTo(cx + 2, cy + 1); g.lineTo(cx - 2, cy + 1); } else { g.moveTo(cx, cy + 2.4); g.lineTo(cx + 2, cy - 1); g.lineTo(cx - 2, cy - 1); }
      g.closePath(); g.fill();
    });
    const m = /^(.*)@([dn])$/.exec(id);
    if (!m || this.map.hasImage(id)) return;
    const k = 4, B = 32, c = new OffscreenCanvas(B * k, B * k), g = c.getContext("2d");
    g.scale(k, k);
    drawMapSign(g, m[1], B / 2, B / 2, 16, m[2] === "d"); // (each kind its own size: glyphs.js)
    this.map.addImage(id, g.getImageData(0, 0, B * k, B * k), { pixelRatio: k });
  }

  /** The ranges' names: from the hand-laid table (range-lines.js), b0..b3: shown in that band of zoom; a range
   * not in it (another region): at its outline's middle, auto: placed by the map closer in. */
  rangeLabels() {
    const out = [];
    for (const r of this.ranges) {
      const big = (r.top || 0) >= 1300 ? 1 : 0, hand = RANGE_LABELS[r.id];
      if (hand === null) continue;
      if (hand) {
        for (const [bands, lon, lat, n] of hand) out.push(this.rangeLabel(bands, lon, lat, n, big, r));
        continue;
      }
      const ring = r.rings.reduce((p, q) => (q.length > p.length ? q : p), []), m = ring.length || 1;
      let x = 0, y = 0; for (const q of ring) { x += q[0]; y += q[1]; }
      out.push({ type: "Feature", properties: { n: (r.short || r.label).split(" / ")[0], big, top: r.top || 0, id: r.id, auto: 1 }, geometry: { type: "Point", coordinates: this.ll(x / m, y / m) } });
    }
    // (the mountains' own name far out, with its ranges)
    for (const [bands, lon, lat, n, with_] of RANGE_EXTRA) if (this.ranges.some((r) => r.id === with_)) out.push(this.rangeLabel(bands, lon, lat, n, 2, { id: n, top: 9999 }));
    return out;
  }
  rangeLabel(bands, lon, lat, n, big, r) {
    const b = Object.fromEntries(RANGE_ZOOMS.slice(1).map((_, k) => [`b${k}`, bands.includes(String(k)) ? 1 : 0]));
    return { type: "Feature", properties: { n, big, top: r.top || 0, id: r.id, ...b }, geometry: { type: "Point", coordinates: [lon, lat] } };
  }
  /** The order the names are placed in (the first placed wins a place; MapLibre places from the top layer
   * down): one rule for every zoom. 1 the towns over 15 000, 2 the booklets' summits, 3 huts, 4 the other
   * towns and villages, 5 stations, passes, parkings, bus stops, the lifts' stations, 6 the other peaks,
   * 7 towers, castles, viewpoints, rocks, shelters, springs. (The ranges' names are under all, never in
   * the way: they do not take a place.) */
  labelOrder() {
    const map = this.map;
    if (!map?.getLayer("cities")) return;
    // the packs' town names in two: the towns over 15 000 (by the backdrop's population; the packs have only
    // city / town / village: Karpacz is a "town") with the big ones, the rest with the villages
    const big = (this.townsData || []).filter((r) => r[3] !== "station" && (r[4] || 0) >= 15000).map((r) => r[0]);
    if (big.length) for (const l of map.getStyle().layers) {
      if (!/^place-(big|far):[^~]*$/.test(l.id) || map.getLayer(`${l.id}~top`)) continue;
      const f = l.filter, isBig = ["in", ["get", "n"], ["literal", big]];
      map.addLayer({ ...l, id: `${l.id}~top`, filter: ["all", f, isBig] });
      map.setFilter(l.id, ["all", f, ["!", isBig]]);
    }
    const ids = this.styleLayers(map).map((l) => l.id), part = (re) => ids.filter((id) => re.test(id));
    const order = [
      // (the towns first: where am I, where do I go; then what you reached, the booklets', the huts; the villages
      // before the plain peaks)
      // (what you reached is placed BEFORE the map's own sign of the same place: the map's one is hidden then (feature
      // state), but a hidden sign still takes its place; placed first, it pushed the reached hut off the map: Andrzejówka)
      "cities", "towns-big", ...part(/^place-(big|far):.*~top$/), "towns", ...part(/^place-(big|far):[^~]*$/), ...part(/^station:/),
      "found-far", "found-mid-peak", "found-peak", "found-mid", "found", ...part(/^poi-list:/), ...part(/^poi-hut:/), "liftst:1",
      ...part(/^place:/), "rpeaks",
      ...part(/^pass:/), ...part(/^parking:/), ...part(/^bus:/), "liftst:0",
      ...part(/^poi-far:/), ...part(/^poi:/),
      "found-minor", ...part(/^poi-minor-far:/), ...part(/^poi-minor:/), "found-water", ...part(/^poi-shelter:/), ...part(/^poi-water:/),
    ].filter((id) => map.getLayer(id));
    // the first under all the others, each next under the one before: from the bottom one up
    let above = null;
    for (const id of order) { if (above) map.moveLayer(id, above); else map.moveLayer(id); above = id; }
    // (moved to the top: the GPS dot and the plan's points stay over the names)
    for (const id of ["me", "me-acc", "plan-pts", "plan-pt"]) if (map.getLayer(id)) map.moveLayer(id);
  }
  /** The ranges' highest named peaks (from the packs' names): the far map's peaks, and which names show far out. */
  rangeTops() {
    const pois = this.data.names?.pois || [], map = this.map;
    const inside = (ring, x, y) => { let c = false; for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) { const [xi, yi] = ring[i], [xj, yj] = ring[j]; if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c; } return c; };
    const peaks = [], listed = [...KGP.map((q) => [...this.xy(q.lon, q.lat), q.n, q.ele]), ...FAR_PEAKS.map(([n, lon, lat, e]) => [...this.xy(lon, lat), n, e])];
    this.rpeakPts = [];
    for (const r of this.ranges) {
      let best = null;
      for (const p of pois) if (p[2] === "peak" && p[5] && p[1] && (!best || p[5] > best[5]) && p[3] >= r.bbox[0] && p[3] <= r.bbox[2] && p[4] >= r.bbox[1] && p[4] <= r.bbox[3] && r.rings.some((g) => inside(g, p[3], p[4]))) best = p;
      if (!best) continue;
      r.top = Math.round(best[5]);
      // the peaks named far out: from a list (the Korona Gór Polski and the best known over the border), the same
      // at every zoom; "the highest in each rough outline" looked arbitrary (Borowa, not Chełmiec; Kamenec).
      // A range with none on the list: its highest.
      const mine = listed.filter((q) => q[0] >= r.bbox[0] && q[0] <= r.bbox[2] && q[1] >= r.bbox[1] && q[1] <= r.bbox[3] && r.rings.some((g) => inside(g, q[0], q[1])));
      for (const q of mine.length ? mine.filter((q) => !q[4] && (q[4] = 1)) : [[best[3], best[4], best[1].split(" / ")[0], r.top]]) {
        this.rpeakPts.push([q[0], q[1]]);
        peaks.push({ type: "Feature", properties: { n: q[2], e: q[3] }, geometry: { type: "Point", coordinates: this.ll(q[0], q[1]) } });
      }
    }
    map?.getSource("ranges")?.setData({ type: "FeatureCollection", features: this.rangeLabels() });
    map?.getSource("rpeaks")?.setData({ type: "FeatureCollection", features: peaks });
  }

  /** What is mine: the walked stretches (a GeoJSON source), the fog over it all, under the names. */
  addMine() {
    const map = this.map, first = this.styleLayers(map).find((l) => l.type === "symbol")?.id;
    map.addSource("mine", { type: "geojson", data: { type: "FeatureCollection", features: [] }, tolerance: 0.6, buffer: 32 });
    const n = ["get", "n"];
    // the band under what I walked (stronger the more often), over the map, under the fog's edge
    const trailTop = this.styleLayers(map).find((l) => l.id.startsWith("trail-0"))?.id;
    map.addLayer({ id: "mine-band", type: "line", source: "mine", minzoom: 10.4, layout: { "line-cap": "round", "line-join": "round" },
      // opaque, the trace's colour already mixed with a light green ground (was see-through: where two
      // stretches met or a line bent, the band showed twice as dark); stronger the more often
      paint: { "line-color": ["interpolate", ["linear"], n, ...[[1, 0.35], [3, 0.55], [6, 0.72], [12, 0.88]].flatMap(([k, a]) => [k, mix(this.trace, a)])], "line-opacity": ["interpolate", ["linear"], ["zoom"], 10.4, 0, 11.4, 1], // (from 10.4: under it unseen, its tiles not laid out)
        "line-width": ["interpolate", ["linear"], ["zoom"], 9, 3, 11, 7, 13, 12, 15, 20, 17, 28] } }, trailTop);
    // the fog over the ground only (the land, the contours, the roads and paths): what tells by colour (the trails, the plan,
    // a closure, your traces) stays over it, clear everywhere; dark lines read under the fog anyway (it takes the colour, not the light)
    map.addLayer(this.fog, map.getLayer("saved-band") ? "saved-band" : "mine-band");
    this.stackPlan(); // (a plan drawn before your traces came: over them still)
    // Poświata: far out the map is quiet and what you walked glows (a wide soft violet band, a line in it);
    // it gives way to the fog closer in (glfog.js fades in from z 9.8 to 11.2)
    const far = (a) => ["interpolate", ["linear"], ["zoom"], 5, a, 10.4, a, 11.6, 0];
    const Zw = (a) => ["interpolate", ["linear"], ["zoom"], 6, a[0], 9, a[1], 12, a[2]];
    const lay = { "line-cap": "round", "line-join": "round" };
    // a wide soft band along what you walked (stronger where you walk often), a line in it; gone closer in (the fog's bands)
    map.addLayer({ id: "walk-glow", type: "line", source: "mine", maxzoom: 10.8, layout: lay, paint: { "line-color": "#fbfaf6",
      "line-opacity": ["interpolate", ["linear"], ["zoom"], 5, 0.85, 9.8, 0.85, 10.8, 0], "line-blur": 0.5, "line-width": ["interpolate", ["linear"], ["zoom"], 6, 4, 9, 5, 10.8, 6] } }, first); // (a thin light edge under the line: it reads on the green, never a blot)
    map.addLayer({ id: "walk-line", type: "line", source: "mine", maxzoom: 11.8, layout: lay, paint: { "line-color": "#5a22e0", "line-opacity": far(1), "line-width": Zw([1.5, 2.1, 2.8]) } }, first);
    // far out the walked bands are too thin to see: the network as green lines over the fog
    map.addLayer({ id: "mine-far", type: "line", source: "mine", maxzoom: 13.6, layout: { "line-cap": "round", "line-join": "round" },
      paint: { "line-color": "#2f6b4f", "line-opacity": ["interpolate", ["linear"], ["zoom"], 10.4, 0, 11.4, 0.9, 12.6, 0.9, 13.6, 0], "line-width": ["interpolate", ["linear"], ["zoom"], 8, 1.4, 11, 2, 13, 2.6] } }, first);
    // far out: the ranges' names (laid by hand: range-lines.js) and their highest peaks
    map.addSource("ranges", { type: "geojson", data: { type: "FeatureCollection", features: this.rangeLabels() } });
    map.addSource("rpeaks", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
    if (!map.hasImage("rpeak")) {
      const k = 2, B = 14, c = new OffscreenCanvas(B * k, B * k), g = c.getContext("2d");
      g.scale(k, k); g.beginPath(); g.moveTo(7, 2.5); g.lineTo(12, 11); g.lineTo(2, 11); g.closePath(); g.fillStyle = PEAK_TOP; g.fill(); g.lineWidth = 1.2; g.strokeStyle = "#fff"; g.stroke();
      map.addImage("rpeak", g.getImageData(0, 0, B * k, B * k), { pixelRatio: k });
    }
    map.addLayer({ id: "rpeaks", type: "symbol", source: "rpeaks", minzoom: 7.9, maxzoom: 10.8, filter: [">=", ["get", "e"], 700],
      layout: { "icon-image": "rpeak", "icon-anchor": "bottom", "text-field": ["format", ["get", "n"], { "text-font": ["literal", ["Noto Sans Bold"]] }, " ", {}, ["to-string", ["get", "e"]], { "text-font": ["literal", ["Noto Sans Regular"]], "font-scale": 0.9, "text-color": INK.ele }],
        "text-font": ["literal", ["Noto Sans Bold"]], "text-size": 11.5, "text-anchor": "top", "text-offset": [0, 0.15], "text-padding": 2, "symbol-sort-key": ["-", 0, ["get", "e"]] },
      paint: { "text-color": INK.text, "text-halo-color": "rgba(250,248,242,.95)", "text-halo-width": 1.8, "text-opacity": 1 } }); // (full to its last zoom: faded, it still kept the near layer's own name of the peak away)
    // each name shown in its bands of zoom (b0..b3), crossing over at the bands' edges; gone closer in (the
    // villages, the trails); a little bigger for the high ranges. Always shown, under all the other names and
    // your traces (the background they are); laid where they cross no town's name (the table's test).
    const Z = RANGE_ZOOMS, op = [];
    const K = Z.length - 1;
    for (let k = 0; k < K; k++) op.push(k ? Z[k] + 0.04 : Z[0], ["get", `b${k}`], k < K - 1 ? Z[k + 1] - 0.04 : 9.9, ["get", `b${k}`]); // (a short cross-over: a name that moves is never seen twice for long)
    const size = (a) => ["+", a, ["*", 1.5, ["get", "big"]]]; // (big 2: the mountains' own name)
    const rlay = { "text-field": ["upcase", ["get", "n"]], "text-font": ["literal", ["Noto Sans Regular"]], "text-size": ["interpolate", ["linear"], ["zoom"], 6, size(10.5), 8.5, size(12), 10, size(13.5)],
      "text-letter-spacing": ["case", ["==", ["get", "big"], 2], 0.5, 0.16], "text-line-height": 1.1, "text-max-width": 60, "text-anchor": "center" };
    const rpaint = { "text-color": "#6f6458", "text-halo-color": "rgba(245,243,237,.85)", "text-halo-width": 1.6 };
    map.addLayer({ id: "ranges", type: "symbol", source: "ranges", maxzoom: 10.8, filter: ["!", ["has", "auto"]],
      layout: { ...rlay, "text-allow-overlap": true, "text-ignore-placement": true }, paint: { ...rpaint, "text-opacity": ["interpolate", ["linear"], ["zoom"], ...op, 10.8, 0] } });
    // (a range not in the table: closer in, where its name fits)
    map.addLayer({ id: "ranges-auto", type: "symbol", source: "ranges", minzoom: Z[2], maxzoom: 10.8, filter: ["has", "auto"],
      layout: { ...rlay, "text-max-width": 9, "text-padding": 4, "symbol-sort-key": ["-", 0, ["get", "top"]] }, paint: { ...rpaint, "text-opacity": ["interpolate", ["linear"], ["zoom"], 9.9, 1, 10.8, 0] } });
    // the ranges' names under your traces (they are the background; a trace is never covered by a name)
    for (const id of ["ranges", "ranges-auto"]) if (map.getLayer("walk-glow")) map.moveLayer(id, "walk-glow");
    this.data.namesReady.then(() => { try { this.rangeTops(); if (this.liftSt) this.setLiftStations(this.liftSt); } catch (e) { note(`pasma: ${e.message}`); } });
    // the points reached, in colour over the pale ones (always shown: they are what you collect)
    map.addSource("found", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
    // what you reached, in colour, by the same zoom levels as the map's signs (glstyle.js): far out
    // only the summits, spaced out; then the huts too; close in all, the springs last
    // peaks first, then huts, then the rest (two signs on one spot: the peak shows, not the viewpoint over it)
    // a hut first, then a named peak, then the rest; anything without a name last (an unnamed knoll never hides a hut)
    const RANK = ["case", ["==", ["coalesce", ["get", "n"], ""], ""], 3, ["match", ["get", "c"], "hut", 0, "peak", 1, 2]];
    const fl = (id, z0, z1, kinds, spaced, before) => map.addLayer({ id, type: "symbol", source: "found", minzoom: z0, maxzoom: z1,
      filter: kinds[0] === "!" ? ["!", ["in", ["get", "c"], ["literal", kinds.slice(1)]]] : ["in", ["get", "c"], ["literal", kinds]],
      layout: { "icon-image": ["concat", ["get", "key"], ["case", ["==", ["get", "c"], "peak"], "@d", "@n"]], "icon-size": ICON_SIZE, "icon-padding": spaced ? 16 : 2, "symbol-sort-key": ["-", ["*", 10000, RANK], ["coalesce", ["get", "e"], 0]], ...POI_TEXT },
      paint: { "text-color": INK.text, ...HALO } }, before); // (a peak reached: its triangle violet; the other places as the others)
    const underHuts0 = this.styleLayers(map).find((l) => /^poi-hut:/.test(l.id))?.id;
    fl("found-far", 8.5, 10, ["peak"], true, underHuts0);
    fl("found-mid", 10, 12, ["hut"], true);
    fl("found-mid-peak", 10, 12, ["peak"], true, underHuts0);
    // the huts reached on top of everything; the peaks reached under the map's huts (a hut always wins)
    fl("found", 12, 24, ["hut"], false);
    fl("found-peak", 12, 24, ["peak"], false, underHuts0);
    // the smaller places reached: under the map's peaks and huts (placed after them, never over them)
    const under = this.styleLayers(map).find((l) => /^poi:/.test(l.id))?.id;
    fl("found-minor", 13, 24, ["tower", "viewpoint", "ruins", "rock", "cave", "shelter"], false, under);
    fl("found-water", 14, 24, ["waterfall", "spring"], false, under);
    this.labelOrder();
    this.applyMode();
  }

  // ---- what is mine
  /** The 40 m cells along what was walked (key: cellKey), for the planner's walked / not walked split. */
  get walkedCells() {
    if (this.cells || !this.cellsOf) return this.cells || new Set();
    const { agg, sc } = this.cellsOf, cells = (this.cells = new Set()), C = 40;
    for (const [, , , , flat] of agg) {
      const [xs, ys] = decodeLine(flat, sc);
      for (let i = 1; i < xs.length; i++) { const L = Math.hypot(xs[i] - xs[i - 1], ys[i] - ys[i - 1]), k = Math.max(1, Math.ceil(L / 20)); for (let j = 0; j <= k; j++) cells.add(cellKey(Math.floor((xs[i - 1] + ((xs[i] - xs[i - 1]) * j) / k) / C), Math.floor((ys[i - 1] + ((ys[i] - ys[i - 1]) * j) / k) / C))); }
    }
    return cells;
  }

  setResults(res) {
    const { agg = [], reveal = [], found = {}, badges = {}, off = [] } = res || {};
    this.res = { found, badges };
    const sc = this.index.scale || 10, feats = [];
    const line = (xs, ys, lo = 0, hi = 1) => {
      // the stretch [lo, hi] of the line (fractions of its length), lon/lat
      const n = xs.length, cum = new Float64Array(n);
      for (let i = 1; i < n; i++) cum[i] = cum[i - 1] + Math.hypot(xs[i] - xs[i - 1], ys[i] - ys[i - 1]);
      // a stretch ending within ~30 m of the line's end: to the end (the junction passed; no holes where two meet)
      const L = cum[n - 1] || 1, a = lo * L < 30 ? 0 : lo * L, b = L - hi * L < 30 ? L : hi * L, out = [];
      const at = (s) => { let i = 1; while (i < n - 1 && cum[i] < s) i++; const t = (s - cum[i - 1]) / ((cum[i] - cum[i - 1]) || 1); return this.ll(xs[i - 1] + t * (xs[i] - xs[i - 1]), ys[i - 1] + t * (ys[i] - ys[i - 1])); };
      out.push(at(a));
      for (let i = 1; i < n - 1; i++) if (cum[i] > a && cum[i] < b) out.push(this.ll(xs[i], ys[i]));
      out.push(at(b));
      return out;
    };
    this.cellsOf = { agg, sc }; this.cells = null; // (the walked cells: made when the planner first asks, walkedCells)
    for (const [, n, intervals, , flat] of agg) {
      const [xs, ys] = decodeLine(flat, sc);
      if (xs.length < 2) continue;
      const parts = intervals.map(([lo, hi]) => line(xs, ys, lo, hi)).filter((c) => c.length >= 2);
      if (parts.length) feats.push({ type: "Feature", properties: { n }, geometry: { type: "MultiLineString", coordinates: parts } });
    }
    for (const flat of off) {
      const [xs, ys] = decodeLine(flat, sc);
      if (xs.length >= 2) feats.push({ type: "Feature", properties: { n: 1, off: 1 }, geometry: { type: "LineString", coordinates: Array.from(xs, (x, i) => this.ll(x, ys[i])) } });
    }
    this.mineFeats = feats; // (kept: tests, diagnostics)
    this.map?.getSource("mine")?.setData({ type: "FeatureCollection", features: feats });
    const had = (this.mineN || 0) > 0;
    this.mineN = feats.length;
    if (had !== feats.length > 0) this.applyMode();
    // the discs, in mercator units (0..1)
    const d = new Float32Array(reveal.length * 4), P = this.P;
    reveal.forEach(([x, y, r, seed], i) => {
      const lon = P.lon0 + x / P.kx, lat = P.lat0 - y / P.ky;
      d[i * 4] = (lon + 180) / 360; d[i * 4 + 1] = 0.5 - psi(lat) / (2 * Math.PI);
      d[i * 4 + 2] = r / (40075016.686 * Math.cos(lat * DEG)); d[i * 4 + 3] = (seed % 1000) * 0.0063;
    });
    this.myDiscs = d;
    this.fog?.setDiscs(this.group ? this.groupDiscs() : d);
    this.revealN = reveal.length;
    this.data?.setReveal(reveal);
    // the points reached: their signs in colour, with names
    const prev = this.reached || new Set(), now = new Set(Object.keys(found));
    for (const p of this.parts || []) {
      for (const id of prev) if (!now.has(id)) this.map?.setFeatureState({ source: `v:${p.id}`, sourceLayer: "poi", id }, { d: false });
      for (const id of now) this.map?.setFeatureState({ source: `v:${p.id}`, sourceLayer: "poi", id }, { d: true });
    }
    this.reached = now;
    this.data?.setFound(found, badges);
    const pts = Object.entries(found).filter(([, f]) => f.x != null && f.c).map(([id, f]) => {
      const p = this.data.mark({ id, c: f.c, n: f.n, e: f.e, x: f.x, y: f.y });
      return { type: "Feature", properties: { id, c: p.c, n: p.n || "", key: p.key, ...(p.e != null ? { e: p.e } : {}) }, geometry: { type: "Point", coordinates: this.ll(p.x, p.y) } };
    });
    if (this.map?.getSource("found")) this.geo(this.map, "found", pts);
  }

  // ---- look
  applyMode() {
    const map = this.map;
    if (!map?.getLayer("fog")) return;
    const m = this.mode, cmp = !!this.group; // (with friends: the same looks, everyone's bands in their colours, the fog off where any of them was)
    // the fog only once something is walked: a first look at an empty Zdrapka is the full map, not a washed-out one
    this.fog.on = m === "fog" && (cmp || (this.mineN || 0) > 0);
    for (const id of ["group-glow", "group-line", "group-tops"]) if (map.getLayer(id)) map.setLayoutProperty(id, "visibility", cmp && this.glow ? "visible" : "none");
    map.setLayoutProperty("mine-band", "visibility", this.glow && !cmp ? "visible" : "none");
    map.setLayoutProperty("mine-far", "visibility", "none"); // (Poświata shows the walked far out now)
    for (const id of ["walk-glow", "walk-line", "walk-core"]) if (map.getLayer(id)) map.setLayoutProperty(id, "visibility", this.glow && !cmp ? "visible" : "none");
    // the shading of the slopes: off unless asked for (the contours show the ground)
    const vis = this.icons ? "visible" : "none";
    for (const l of this.styleLayers(map)) if (/^poi[-:]/.test(l.id)) map.setLayoutProperty(l.id, "visibility", vis);
    map.triggerRepaint();
  }
  /** Planning: the junction dots bigger and ringed in the accent (easier to hit). */
  setPlanning(on) {
    if (this.planning === !!on || !this.map) return;
    this.planning = !!on;
    for (const l of this.styleLayers()) if (l.id.startsWith("junction:")) this.map.setLayoutProperty(l.id, "icon-image", DOT(this.planning));
    // where a trip can start, planning: car parks (z 13, a bold P on a blue plate) and bus stops (z 12) earlier; stations
    // as always (their place in the names' order too: over the other peaks, under the towns)
    const map = this.map, P = this.planning, ids = this.styleLayers().map((l) => l.id);
    for (const id of ids) {
      const m = id.match(/^(parking|bus):/); if (!m) continue;
      map.setLayerZoomRange(id, P ? (m[1] === "parking" ? 13 : 12) : 15, 24); // (the packs have car parks from z 13)
    }
  }
  setLayers({ glow = true, icons = true } = {}) { this.glow = glow; this.icons = icons; this.applyMode(); }
  setLite(on) { this.lite = !!on; this.measure(); }
  /** The sharpness the map draws at on this phone: 1.5 unless it was too much for it (autoSharp). */
  sharp() { try { const v = +JSON.parse(localStorage.getItem("zdrapka.sharp") || "null")?.dpr; return v >= 1 && v <= SHARP ? v : SHARP; } catch { return SHARP; } }
  /** Automatic sharpness: while the map moves, how many frames come late (over 1.6 frames of the screen's own rate);
   * a third of them late over ~1.5 s of moving: one step less sharp (1.5 → 1.25 → 1), kept for this phone. A strong
   * phone never sees it; a weaker one gets a smooth map with a little softer lines. */
  autoSharp() {
    const m = this.map; if (!m || this.autoSharpOn) return;
    this.autoSharpOn = true;
    let on = false, last = 0, dts = [], raf = 0, lastStep = 0;
    const tick = (t) => { if (!on) return; if (last) dts.push(t - last); last = t; raf = requestAnimationFrame(tick); };
    m.on("movestart", () => { if (on) return; on = true; last = 0; raf = requestAnimationFrame(tick); });
    // (a tile in: noted for the stutters' "around" — its first upload to the GPU comes with the next frame)
    m.on("data", (e) => { if (e.tile && e.dataType === "source") { const id = e.sourceId || ""; noteEv(`kafel ${id.startsWith("v:") ? "mapa" : id.startsWith("r:") ? "rzeźba" : id.startsWith("tlo") ? "tło" : id}`); } });
    m.on("moveend", () => {
      on = false; cancelAnimationFrame(raf);
      if (this.benching) { dts = []; return; }
      if (dts.length < 90 || this.lite) return;
      const sorted = [...dts].sort((a, b) => a - b), frame = sorted[Math.floor(sorted.length * 0.1)] || 16.7;
      const late = dts.filter((d) => d > frame * 1.6).length / dts.length;
      dts = [];
      const cur = Math.min(this.sharp(), window.devicePixelRatio || 1);
      if (late < 0.33 || cur <= 1 || Date.now() - lastStep < 30_000) return;
      const next = cur > 1.25 ? 1.25 : 1;
      lastStep = Date.now();
      try { localStorage.setItem("zdrapka.sharp", JSON.stringify({ dpr: next, late: Math.round(late * 100), t: Date.now() })); } catch { /* none */ }
      note(`ostrość mapy: ${cur}× → ${next}× (${Math.round(late * 100)}% klatek spóźnionych przy ${Math.round(1000 / frame)} Hz)`);
      this.measure(); this.draw();
    });
  }
  /** "Ostrość mapy": px per CSS px (1..3; null: the default, 1.5). */
  /** The backdrop (tlo: land cover and relief round and between the packs, towns): far out the map
   * is this (Poświata): the forests as smooth shapes, the relief's light and shade, both fading out at
   * the edges (no hard end), the big towns and the mountain resorts named; it gives way to the packs'
   * own map in the neighbourhood. The camera stays over it. base: its folder. */
  async setBackdrop(base) {
    const map = this.map;
    if (!map || !this.ready) { this.bdWant = base; return; } // (when the map is up)
    if (!base || this.backdrop === base) return;
    this.backdrop = base; // (once: a second call while this one loads would lay it all twice)
    let ix;
    try { ix = await (await fetch(packUrl(base, "index.json"))).json(); } catch (e) { note(`tło: ${e.message}`); this.backdrop = null; return; }
    const P = ix.proj, ll = (x, y) => [P.lon0 + x / P.kx, P.lat0 - y / P.ky];
    const corners = ([x0, y0, x1, y1]) => [ll(x0, y0), ll(x1, y0), ll(x1, y1), ll(x0, y1)];
    const before = this.styleLayers(map).find((l) => /^area[:-]/.test(l.id))?.id;
    // far out the land; closer in it stays under the packs' own map, fainter (no blank paper between the packs)
    const far = (a, near, z1 = 9.2) => ["interpolate", ["linear"], ["zoom"], 5, a, z1, a, z1 + 1.2, near, 12, near, 13.5, 0];
    const put = (id, url, rect, op, near) => {
      if (map.getLayer(id)) map.removeLayer(id);
      if (map.getSource(id)) map.removeSource(id);
      map.addSource(id, { type: "image", url, coordinates: corners(rect) });
      map.addLayer({ id, type: "raster", source: id, maxzoom: 13.5, paint: { "raster-opacity": id === "tlo-relief" ? ["interpolate", ["linear"], ["zoom"], 5, 0.5, 8.8, 0.5, 10, 0.14, 12, 0.06, 13.5, 0] : far(op, near), "raster-fade-duration": 0, "raster-resampling": "linear" } }, before);
    };
    let places = null;
    try {
      // the land and the relief pictures, made in a worker (bdworker.js): the page stays free
      const abs = (f) => new URL(packUrl(base, f), location.href).href;
      const pics = await new Promise((res, rej) => {
        const w = new Worker(new URL("./bdworker.js", import.meta.url), { type: "module" });
        w.onmessage = ({ data }) => { w.terminate(); if (data.error) rej(new Error(data.error)); else res(data); };
        w.onerror = (e) => { w.terminate(); rej(new Error(e.message || "worker")); };
        w.postMessage({ land: ix.landcover?.file && !ix.vector?.file ? abs(ix.landcover.file) : null, relief: ix.relief?.file ? abs(ix.relief.file) : null, places: ix.places?.file ? abs(ix.places.file) : null });
      });
      places = pics.places;
      if (pics.land) put("tlo-land", URL.createObjectURL(pics.land), ix.landcover.rect, 1, 0.8);
      if (pics.relief) put("tlo-relief", URL.createObjectURL(pics.relief), ix.relief.rect, 0.45, 0.14);
    } catch (e) { note(`tło: ${e.message}`); }
    // ---- the land as vector tiles (a newer backdrop): sharp woods, water, rivers and the countries' borders
    // far out (the pictures blurred them); the land picture is then not used, the relief stays as light shade
    if (ix.vector?.file) {
      try {
        if (map.getLayer("tlo-land")) map.setLayoutProperty("tlo-land", "visibility", "none");
        for (const id of ["tlo-forest", "tlo-water", "tlo-river", "tlo-border-band", "tlo-border"]) if (map.getLayer(id)) map.removeLayer(id);
        if (map.getSource("tlo-v")) map.removeSource("tlo-v");
        map.addSource("tlo-v", { type: "vector", url: "pmtiles://" + packUrl(base, ix.vector.file), maxzoom: 10 });
        const Z = (...st) => ["interpolate", ["linear"], ["zoom"], ...st];
        const under = this.styleLayers(map).find((l) => /^area[:-]/.test(l.id))?.id;
        // under the packs' own areas (their woods from the neighbourhood on: the same green)
        map.addLayer({ id: "tlo-forest", type: "fill", source: "tlo-v", "source-layer": "forest", paint: { "fill-color": FILL.forest } }, under);
        if (map.getLayer("tlo-relief")) map.moveLayer("tlo-relief", under);
        map.addLayer({ id: "tlo-water", type: "fill", source: "tlo-v", "source-layer": "water", paint: { "fill-color": FILL.water } }, under);
        map.addLayer({ id: "tlo-river", type: "line", source: "tlo-v", "source-layer": "river", maxzoom: 11, layout: { "line-cap": "round", "line-join": "round" },
          paint: { "line-color": INK.waterFar, "line-width": Z(6, 0.5, 10, 1.1), "line-opacity": Z(6, 0.75, 10, 0.75, 11, 0) } }, under);
        // the border as on tourist maps: a wide soft band, a dark dash-dot line (over the land, under the roads);
        // closer in the packs' own border (the same look) takes over
        const top = this.styleLayers(map).find((l) => /^road-(case|minor-case)/.test(l.id))?.id;
        map.addLayer({ id: "tlo-border-band", type: "line", source: "tlo-v", "source-layer": "border", maxzoom: 10.6, layout: { "line-join": "round" },
          paint: { "line-color": "#dcdad4", "line-blur": 1.5, "line-width": Z(5, 7, 8, 9, 10.6, 8) } }, top); // (opaque: no darker blots where the line folds; soft edges)
        map.addLayer({ id: "tlo-border", type: "line", source: "tlo-v", "source-layer": "border", maxzoom: 10.6, layout: { "line-join": "round" },
          paint: { "line-color": INK.border, "line-width": Z(5, 1.4, 9, 2, 10.6, 1.8), "line-dasharray": [3.5, 1.6, 1, 1.6] } }, top);
        for (const l of this.styleLayers(map)) if (/^(border|border-band):/.test(l.id)) map.setLayerZoomRange(l.id, 10.6, 24);
        this.vecBackdrop = true;
      } catch (e) { note(`tło, wektor: ${e.message}`); }
    }
    // ---- names far out: the cities (a dot, the name moving round it to make room), the towns by size, the
    // mountain resorts closer in (the packs' own names from the neighbourhood on)
    places ||= [];
    const popOf = new Map();
    for (const [n, , , , pop] of places) if (pop) popOf.set(n, Math.max(pop, popOf.get(n) || 0));
    const seen = new Set(TOWNS.map((t) => t[0]));
    const feats = TOWNS.map(([n, lon, lat, r]) => ({ type: "Feature", properties: { n, r, p: popOf.get(n) || (r === 1 ? 60000 : 3000) }, geometry: { type: "Point", coordinates: [lon, lat] } }));
    this.townsData = places;
    this.labelOrder();
    if (ix.bounds) this.bdBounds = ix.bounds; // (the search: towns, villages and stations also between the packs)
    for (const [n, lon, lat, p, pop] of places) if (p !== "station" && p !== "village" && !seen.has(n)) { seen.add(n); feats.push({ type: "Feature", properties: { n, r: 3, p: pop || (p === "city" ? 50000 : 3000) }, geometry: { type: "Point", coordinates: [lon, lat] } }); }
    for (const id of ["towns", "towns-big", "cities"]) if (map.getLayer(id)) map.removeLayer(id);
    if (map.getSource("towns")) map.removeSource("towns");
    map.addSource("towns", { type: "geojson", data: { type: "FeatureCollection", features: feats } });
    if (!map.hasImage("town-dot")) {
      const k = 2, B = 12, c = new OffscreenCanvas(B * k, B * k), g = c.getContext("2d");
      g.scale(k, k); g.beginPath(); g.arc(B / 2, B / 2, 3.6, 0, 7); g.fillStyle = "#fff"; g.fill(); g.lineWidth = 1.6; g.strokeStyle = INK.place; g.stroke();
      map.addImage("town-dot", g.getImageData(0, 0, B * k, B * k), { pixelRatio: k });
    }
    const pop = ["coalesce", ["get", "p"], 0], halo = { "text-halo-color": "rgba(245,243,237,.95)", "text-halo-width": 2 };
    // the towns (under the ranges' names and the peaks): by size as you come closer, the resorts (green) from the regions' scale
    const lowest = this.styleLayers(map).find((l) => l.id === "ranges")?.id;
    map.addLayer({ id: "towns", type: "symbol", source: "towns", maxzoom: 11.5,
      filter: ["all", ["<", pop, 60000], ["step", ["zoom"], false, 7.6, ["any", [">=", pop, 15000], ["==", ["get", "r"], 2]], 8.5, [">=", pop, 4000], 9.3, true]],
      layout: { "text-field": ["get", "n"], "text-font": ["literal", ["Noto Sans Bold"]], "text-size": ["interpolate", ["linear"], ["zoom"], 7.6, 11.5, 10, 13.5], "text-max-width": 8,
        "text-padding": ["interpolate", ["linear"], ["zoom"], 9, 3, 10, 20], // (the packs' own name of a town from z 10: one of the two shows)
        "symbol-sort-key": ["-", 0, pop] },
      paint: { "text-color": INK.place, ...halo } }, lowest);
    // the cities over everything far out (what you find your way by)
    map.addLayer({ id: "cities", type: "symbol", source: "towns", maxzoom: 11.5, filter: [">=", pop, 60000],
      layout: { "icon-image": ["step", ["zoom"], "town-dot", 9.6, ""], "text-field": ["get", "n"], "text-font": ["literal", ["Noto Sans Bold"]], "text-size": ["interpolate", ["linear"], ["zoom"], 6, 13.5, 9, 15.5, 11, 17],
        "text-variable-anchor": ["left", "top", "bottom"], "text-radial-offset": 0.75, "text-padding": 3, "symbol-sort-key": ["-", 0, pop] }, // (never left of its dot: read as the next town's)
      paint: { "text-color": INK.place, ...halo } });
    if (!map.getLayer("towns-big")) {
      const t = map.getStyle().layers.find((l) => l.id === "towns");
      map.addLayer({ ...t, id: "towns-big", filter: ["all", t.filter, [">=", pop, 15000]] });
      map.setFilter("towns", ["all", t.filter, ["<", pop, 15000]]);
    }
    this.labelOrder();
    // ---- the ways there (far out and between the packs): motorways, main roads, railways
    if (ix.ways?.file) {
      try {
        // (by its address: MapLibre's worker fetches and parses it, megabytes, not the page)
        const ways = new URL(packUrl(base, ix.ways.file), location.href).href;
        for (const id of ["bw-rail", "bw-road-case", "bw-road-p", "bw-road"]) if (map.getLayer(id)) map.removeLayer(id);
        if (map.getSource("bways")) map.removeSource("bways");
        map.addSource("bways", { type: "geojson", data: ways, tolerance: 0.5 });
        const k = ["get", "k"], Z = (...st) => ["interpolate", ["linear"], ["zoom"], ...st];
        // under the fog and the names
        const at = map.getLayer("fog") ? "fog" : this.styleLayers(map).find((l) => l.type === "symbol")?.id;
        // as on road maps: motorways orange, main roads yellow, a white casing; railways from the regions' scale
        map.addLayer({ id: "bw-rail", type: "line", source: "bways", minzoom: 8.4, maxzoom: 11.2, filter: ["==", k, "rail"], paint: { "line-color": "#8f8c94", "line-opacity": Z(8.4, 0, 8.9, 0.8, 10.6, 0.8, 11.2, 0), "line-width": Z(8.4, 0.7, 11, 1.3) } }, at);
        map.addLayer({ id: "bw-road-p", type: "line", source: "bways", minzoom: 7.4, maxzoom: 11.2, filter: ["==", k, "primary"], layout: { "line-cap": "round", "line-join": "round" },
          paint: { "line-color": "#b4ac9f", "line-opacity": Z(7.4, 0, 7.9, 1, 10.6, 1, 11.2, 0), "line-width": Z(7.4, 0.8, 9, 1.4, 11, 2) } }, at);
        map.addLayer({ id: "bw-road-case", type: "line", source: "bways", maxzoom: 11.2, filter: ["in", k, ["literal", ["motorway", "trunk"]]], layout: { "line-cap": "round", "line-join": "round" },
          paint: { "line-color": "#8f877b", "line-opacity": Z(6, 1, 10.6, 1, 11.2, 0), "line-width": Z(6, 2.6, 9, 4.4, 11, 5.8) } }, at);
        map.addLayer({ id: "bw-road", type: "line", source: "bways", maxzoom: 11.2, filter: ["in", k, ["literal", ["motorway", "trunk"]]], layout: { "line-cap": "round", "line-join": "round" },
          paint: { "line-color": "#ffffff", "line-opacity": Z(6, 1, 10.6, 1, 11.2, 0), "line-width": Z(6, 1.2, 9, 2.4, 11, 3.2) } }, at);
        // the border over the roads (as on tourist maps: a road never cuts it)
        for (const id of ["tlo-border-band", "tlo-border"]) if (map.getLayer(id)) map.moveLayer(id, at);
      } catch (e) { note(`tło, drogi: ${e.message}`); }
    }
    this.backdrop = base;
   
  }
  scheduleOverview() { this.applyMode(); }
  renderOverview() {}

  // ---- camera: pack metres <-> lon/lat <-> screen (exact web mercator, as the GL map)

  /** A page's own summits on the map at every zoom (a badge's: its signs dark or violet, their names), over the rest;
   * [{x, y, n, key, d}] or null (off). */
  setMarks(list) {
    const map = this.map;
    if (!map) return;
    const fc = { type: "FeatureCollection", features: (list || []).map((q) => ({ type: "Feature", properties: { n: q.n, key: q.key, d: q.d ? 1 : 0, e: q.e || 0 }, geometry: { type: "Point", coordinates: this.ll(q.x, q.y) } })) };
    if (!map.getSource("marks")) {
      map.addSource("marks", { type: "geojson", data: fc });
      map.addLayer({ id: "marks", type: "symbol", source: "marks", layout: { "icon-image": ["concat", ["get", "key"], ["case", ["==", ["get", "d"], 1], "@d", "@n"]], "icon-size": ICON_SIZE, "icon-allow-overlap": true, "icon-padding": 0,
        "symbol-sort-key": ["-", 0, ["get", "d"]], "text-field": ["step", ["zoom"], "", 10.5, ["get", "n"]], "text-font": ["Noto Sans Bold"], "text-size": 11.5, "text-anchor": "top", "text-offset": [0, 0.9], "text-optional": true },
        paint: { "text-color": "#3a3640", "text-halo-color": "rgba(255,255,255,.92)", "text-halo-width": 1.4 } });
    } else map.getSource("marks").setData(fc);
  }
  /** Only the places reached (Odkryte miejsca → Pokaż na mapie): the other peaks' and places' signs hidden. */
  onlyFound(on) {
    this.foundOnly = !!on;
    const map = this.map;
    if (!map) return;
    for (const l of map.getStyle().layers) if (/^(poi(-[a-z-]+)?:|rpeaks$)/.test(l.id)) map.setLayoutProperty(l.id, "visibility", on ? "none" : "visible");
  }
  // ---- friends (app/friends.js): who walked where, side by side in their colours where they share a way
  /** list: [{color, agg: [[key, intervals, geom]], found: [[id, n, e, x, y]]}] (you first) or null (off). */
  setGroup(list) {
    this.group = list || null; // ([] : nobody shown, e.g. you switched off to look at no one's or only friends')
    const map = this.map;
    if (!map) return;
    const sc = this.index.scale || 10, feats = [], peaks = [], who = new Map();
    if (this.group) {
      // a crew of more than four: one layer for all of them (wider and stronger the more of them walked it), beside mine
      const crowd = this.group.filter((p) => p.crowd), solo = this.group.map((p, i) => ({ p, i })).filter(({ p }) => !p.crowd);
      const lanes = solo.map(({ p, i }) => ({ color: p.color, rows: p.agg.map(([k, iv, flat]) => [k, iv.map(([lo, hi]) => [lo, hi, 0, String(i)]), flat]) }));
      if (crowd.length) {
        const byKey = new Map();
        this.group.forEach((p, i) => { if (!p.crowd) return; for (const [k, iv, flat] of p.agg) { if (!byKey.has(k)) byKey.set(k, { flat, iv: [] }); for (const [lo, hi] of iv) byKey.get(k).iv.push([lo, hi, i]); } });
        const rows = [];
        for (const [k, { flat, iv }] of byKey) {
          const cuts = [...new Set(iv.flatMap(([lo, hi]) => [lo, hi]))].sort((a, b) => a - b), out = [];
          for (let j = 1; j < cuts.length; j++) {
            const m = (cuts[j - 1] + cuts[j]) / 2, ids = iv.filter(([lo, hi]) => lo <= m && m <= hi).map((q) => q[2]);
            if (!ids.length) continue;
            const key = [...new Set(ids)].sort((a, b) => a - b).join(","), last = out[out.length - 1];
            if (last && last[3] === key && Math.abs(last[1] - cuts[j - 1]) < 1e-9) last[1] = cuts[j]; else out.push([cuts[j - 1], cuts[j], key.split(",").length, key]);
          }
          if (out.length) rows.push([k, out, flat]);
        }
        lanes.push({ color: crowd[0].color, crowd: true, rows });
      }
      lanes.forEach((ln, i) => { for (const [k] of ln.rows) { if (!who.has(k)) who.set(k, []); who.get(k).push(i); } });
      lanes.forEach((ln, i) => {
        // near: an opaque band in their colour under the trails, as my own band is (colour mixed with the ground)
        const band = mix(String(ln.color).replace("#", "").match(/../g).map((h) => parseInt(h, 16)).join(","), 0.62);
        for (const [k, intervals, flat] of ln.rows) {
          const [xs, ys] = decodeLine(flat, sc);
          if (xs.length < 2) continue;
          const n = xs.length, cum = new Float64Array(n);
          for (let j = 1; j < n; j++) cum[j] = cum[j - 1] + Math.hypot(xs[j] - xs[j - 1], ys[j] - ys[j - 1]);
          const L = cum[n - 1] || 1, ws = who.get(k), off = ws.indexOf(i) - (ws.length - 1) / 2;
          for (const [lo, hi, cnt, ids] of intervals) {
            const a = lo * L < 30 ? 0 : lo * L, b = L - hi * L < 30 ? L : hi * L, at = (s2) => { let j = 1; while (j < n - 1 && cum[j] < s2) j++; const t = (s2 - cum[j - 1]) / ((cum[j] - cum[j - 1]) || 1); return this.ll(xs[j - 1] + t * (xs[j] - xs[j - 1]), ys[j - 1] + t * (ys[j] - ys[j - 1])); };
            const c = [at(a)]; for (let j = 1; j < n - 1; j++) if (cum[j] > a && cum[j] < b) c.push(this.ll(xs[j], ys[j])); c.push(at(b));
            const props = { c: ln.color, b: band, off, p: ids };
            if (ln.crowd) props.n = cnt;
            feats.push({ type: "Feature", properties: props, geometry: { type: "LineString", coordinates: c } });
          }
        }
      });
      const tops = new Map();
      this.group.forEach((p) => { for (const [id, , , x, y] of p.found || []) { if (!tops.has(id)) tops.set(id, { x, y, cs: [] }); if (!tops.get(id).cs.includes(p.color)) tops.get(id).cs.push(p.color); } });
      for (const t of tops.values()) peaks.push({ type: "Feature", properties: { icon: `gdots:${t.cs.join(",")}` }, geometry: { type: "Point", coordinates: this.ll(t.x, t.y) } });
    }
    const fc = (f) => ({ type: "FeatureCollection", features: f });
    if (!map.getSource("group")) {
      map.addSource("group", { type: "geojson", data: fc(feats) });
      map.addSource("group-tops", { type: "geojson", data: fc(peaks) });
      const first = map.getStyle().layers.find((l) => l.type === "symbol")?.id, lay = { "line-cap": "round", "line-join": "round" };
      // far out: a wide soft band each (side by side), fading in closer; then the lines, side by side on a shared way
      map.addLayer({ id: "group-glow", type: "line", source: "group", maxzoom: 11.2, layout: lay, paint: { "line-color": ["get", "c"], "line-blur": 1.5,
        "line-width": ["interpolate", ["linear"], ["zoom"], 8, 4, 10, 6], "line-opacity": ["interpolate", ["linear"], ["zoom"], 8, 0.75, 10.4, 0.75, 11.2, 0],
        "line-offset": ["interpolate", ["linear"], ["zoom"], 8, ["*", ["get", "off"], 4], 11, ["*", ["get", "off"], 6]] } }, first);
      // near: bands side by side under the trails, like my own band (each a bit narrower, so 4 still fit)
      const trailTop = this.styleLayers(map).find((l) => l.id.startsWith("trail-0"))?.id, W = [11, 4, 13, 7, 15, 10, 17, 14];
      // (a crew's one layer: its width and strength by how many walked it, 1 to 6 and more)
      const m = ["min", ["coalesce", ["get", "n"], 1], 6], cw = (v) => ["case", ["has", "n"], ["*", v, ["+", 0.45, ["*", 0.18, m]]], v];
      const wz = (k = 1) => ["interpolate", ["linear"], ["zoom"], ...W.flatMap((v, j) => (j % 2 ? [k === 1 ? cw(v) : ["*", ["get", "off"], v]] : [v]))];
      map.addLayer({ id: "group-line", type: "line", source: "group", minzoom: 10.2, layout: lay, paint: { "line-color": ["case", ["has", "n"], ["get", "c"], ["get", "b"]],
        "line-opacity": ["interpolate", ["linear"], ["zoom"], 10.4, 0, 11.2, ["case", ["has", "n"], ["+", 0.3, ["*", 0.11, m]], 1]], "line-width": wz(), "line-offset": wz(0) } }, trailTop || first);
      map.addLayer({ id: "group-tops", type: "symbol", source: "group-tops", minzoom: 9.5, layout: { "icon-image": ["get", "icon"], "icon-anchor": "bottom", "icon-offset": [0, -10], "icon-allow-overlap": true, "icon-ignore-placement": true } });
    } else { map.getSource("group").setData(fc(feats)); map.getSource("group-tops").setData(fc(peaks)); }
    this.groupFeats = feats;
    if (this.myDiscs) this.fog?.setDiscs(this.group ? this.groupDiscs() : this.myDiscs);
    this.applyMode();
  }
  /** The fog's clear discs for the group: mine if I am in it, and ~220 m discs every 50 m along the others' ways. */
  groupDiscs() {
    // (mine as they are, joined at the end: a long history has hundreds of thousands of numbers, too many to spread)
    const out = [], me = this.group.some((p) => p.me), mine = me && this.myDiscs ? this.myDiscs : new Float32Array(0);
    for (const f of this.groupFeats || []) {
      if (this.group[+f.properties.p]?.me) continue;
      let last = null;
      for (const [lon, lat] of f.geometry.coordinates) {
        const mx = (lon + 180) / 360, my = 0.5 - psi(lat) / (2 * Math.PI), m1 = 1 / (40075016.686 * Math.cos(lat * DEG));
        if (last && Math.hypot(mx - last[0], my - last[1]) < 50 * m1) continue;
        out.push(mx, my, 220 * m1, ((mine.length + out.length) % 997) * 0.0063); last = [mx, my];
      }
    }
    const all = new Float32Array(mine.length + out.length);
    all.set(mine); all.set(out, mine.length);
    return all;
  }
  /** Who of the group has walked within ~16 px of a point on screen: their indexes. */
  groupAt(lon, lat) {
    if (!this.group || !this.map?.getLayer("group-line")) return new Set();
    const p = this.map.project([lon, lat]), r = 16;
    return new Set(this.map.queryRenderedFeatures([[p.x - r, p.y - r], [p.x + r, p.y + r]], { layers: ["group-line"] }).flatMap((f) => String(f.properties.p).split(",").map(Number)));
  }
  ll(x, y) { const P = this.P; return [P.lon0 + x / P.kx, P.lat0 - y / P.ky]; }
  xy(lon, lat) { const P = this.P; return [(lon - P.lon0) * P.kx, -(lat - P.lat0) * P.ky]; }
  /** The middle of the view in pack metres (for a view state v). */
  centre(v = this) { return [((v.W ?? this.W) / 2 - v.ox) / v.s, ((v.H ?? this.H) / 2 - v.oy) / v.s]; }
  get zl() { return Math.log2(this.s * 1000); }
  /** MapLibre's zoom for a scale s (512 px tiles: 512 * 2^z px round the world). */
  zoom(s = this.s) { return Math.log2((s * this.k1 * 2 * Math.PI) / 512); }
  bearing(rot = this.rot) { return (-rot * 180) / Math.PI; }
  toScreen(x, y, v = this) {
    if (!this.P) return [0, 0];
    const [cx, cy] = this.centre(v), K = v.s * this.k1, P = this.P;
    const X = ((x - cx) / P.kx) * DEG * K, Y = -(psi(P.lat0 - y / P.ky) - psi(P.lat0 - cy / P.ky)) * K;
    const r = v.rot || 0, W2 = (v.W ?? this.W) / 2, H2 = (v.H ?? this.H) / 2;
    if (!r) return [W2 + X, H2 + Y];
    const c = Math.cos(r), n = Math.sin(r);
    return [W2 + X * c - Y * n, H2 + X * n + Y * c];
  }
  toWorld(sx, sy, v = this) {
    if (!this.P) return [0, 0];
    const [cx, cy] = this.centre(v), K = v.s * this.k1, P = this.P, r = v.rot || 0, W2 = (v.W ?? this.W) / 2, H2 = (v.H ?? this.H) / 2;
    let X = sx - W2, Y = sy - H2;
    if (r) { const c = Math.cos(r), n = Math.sin(r); [X, Y] = [X * c + Y * n, -X * n + Y * c]; }
    const x = cx + (X / K / DEG) * P.kx, lat = lat_(psi(P.lat0 - cy / P.ky) - Y / K);
    return [x, (P.lat0 - lat) * P.ky];
  }
  /** Put the world point (x, y) at the screen point (sx, sy) (scale and turn kept). */
  anchor(x, y, sx, sy) {
    if (!this.P) return;
    const K = this.s * this.k1, P = this.P, r = this.rot || 0;
    let X = sx - this.W / 2, Y = sy - this.H / 2;
    if (r) { const c = Math.cos(r), n = Math.sin(r); [X, Y] = [X * c + Y * n, -X * n + Y * c]; }
    const cx = x - (X / K / DEG) * P.kx, lat = lat_(psi(P.lat0 - y / P.ky) + Y / K), cy = (P.lat0 - lat) * P.ky;
    this.ox = this.W / 2 - cx * this.s; this.oy = this.H / 2 - cy * this.s;
  }
  /** Move the map by (dx, dy) screen px. Past the sheet's edge the map resists (a third of the move). */
  pan(dx, dy) {
    const before = this.SH ? this.overshoot() : 0, keep = [this.ox, this.oy];
    const go = (k) => { const [wx, wy] = this.toWorld(this.W / 2 - dx * k, this.H / 2 - dy * k); this.anchor(wx, wy, this.W / 2, this.H / 2); };
    go(1);
    if (this.SH && this.overshoot() > before + 0.5) { [this.ox, this.oy] = keep; go(0.33); }
  }
  limits() {
    const [x0, y0, x1, y1] = this.SH, m = 2 * 24;
    let lo = Math.max((this.W - m) / (x1 - x0), (this.H - m) / (y1 - y0)) * 0.6;
    const B = this.bdBounds; // (the backdrop in: it always fills the screen, never a map floating in blank)
    if (B) lo = Math.max(lo, this.W / (B[2] - B[0]), this.H / (B[3] - B[1]));
    lo = Math.max(lo, 2 ** (6.5 - 5.65) / 1000); // (not past z 6.5: further out the backdrop ends)
    return { lo, hi: 2 ** 10.5 / 1000 };
  }
  clampCentre(cx, cy, s = this.s) {
    const c = Math.abs(Math.cos(this.rot || 0)), n = Math.abs(Math.sin(this.rot || 0));
    const hw = (this.W / 2 * c + this.H / 2 * n) / s, hh = (this.W / 2 * n + this.H / 2 * c) / s, e = 0.5 * Math.min(hw, hh) + 40000; // (the backdrop reaches 80 km past the packs: edge ranges can be centred)
    // the packs, or (once it is in) the backdrop round them: towns far from the mountains can be centred too.
    // (Not "the screen inside the backdrop": far out there was no room left to pan, the finger hit a wall.)
    const B = this.bdBounds, [x0, y0, x1, y1] = B ? [Math.min(this.SH[0], B[0] + 20000), Math.min(this.SH[1], B[1] + 20000), Math.max(this.SH[2], B[2] - 20000), Math.max(this.SH[3], B[3] - 20000)] : this.SH;
    return [Math.min(Math.max(cx, x0 - e), x1 + e), Math.min(Math.max(cy, y0 - e), y1 + e)];
  }
  ontoSheet() {
    if (!this.SHS) return;
    const [cx, cy] = this.centre();
    let best = null, bd = Infinity;
    for (const [x0, y0, x1, y1] of this.SHS) {
      const m = Math.min(8000, (x1 - x0) / 4, (y1 - y0) / 4), px = Math.min(Math.max(cx, x0 + m), x1 - m), py = Math.min(Math.max(cy, y0 + m), y1 - m), d = Math.hypot(px - cx, py - cy);
      if (d < bd) { bd = d; best = [px, py]; }
    }
    if (bd > 0) this.anchor(best[0], best[1], this.W / 2, this.H / 2);
  }
  overshoot() {
    const [cx, cy] = this.centre(), [ax, ay] = this.clampCentre(cx, cy);
    return Math.hypot(cx - ax, cy - ay) * this.s;
  }
  settle(ms = 280) {
    if (!this.SH) return false;
    const { lo, hi } = this.limits(), s1 = Math.min(Math.max(this.s, lo), hi);
    const [cx, cy] = this.centre(), [tx, ty] = this.clampCentre(cx, cy, s1);
    if (Math.abs(Math.log(s1 / this.s)) < 0.002 && Math.hypot(tx - cx, ty - cy) * s1 < 0.5) return false;
    cancelAnimationFrame(this.settling);
    const s0 = this.s, t0 = performance.now();
    const step = (now) => {
      const k = Math.min(1, (now - t0) / ms), e = 1 - (1 - k) ** 3;
      this.s = s0 * (s1 / s0) ** e; this.anchor(cx + (tx - cx) * e, cy + (ty - cy) * e, this.W / 2, this.H / 2);
      if (k < 1) { this.step(); this.settling = requestAnimationFrame(step); } else { this.settling = 0; this.draw(); }
    };
    this.settling = requestAnimationFrame(step);
    return true;
  }
  northUp() {
    if (!this.rot) return Promise.resolve();
    const [wx, wy] = this.centre(), keep = { ox: this.ox, oy: this.oy, rot: this.rot };
    this.rot = 0; this.anchor(wx, wy, this.W / 2, this.H / 2);
    const to = { s: this.s, ox: this.ox, oy: this.oy, rot: 0 };
    Object.assign(this, keep);
    return this.flyTo(to);
  }
  rotateAt(x, y, a) { const [wx, wy] = this.toWorld(x, y); this.rot = Math.atan2(Math.sin(this.rot + a), Math.cos(this.rot + a)); this.anchor(wx, wy, x, y); }
  measure() {
    // pixels per CSS px the map draws at: 1.5 (smooth at 120 Hz on a Galaxy S23; the setting "Ostrość mapy" sets it,
    // up to the screen's own), 1 when light
    this.dpr = this.lite ? 1 : Math.min(this.sharp(), window.devicePixelRatio || 1);
    const [cx, cy] = this.P ? this.centre() : [0, 0];
    this.W = this.screen.clientWidth || innerWidth; this.H = this.screen.clientHeight || innerHeight;
    if (this.P) this.anchor(cx, cy, this.W / 2, this.H / 2);
    this.screen.width = this.W * this.dpr; this.screen.height = this.H * this.dpr;
    if (this.map) { this.map.setPixelRatio(this.dpr); this.map.resize(); }
  }
  resize() { this.measure(); this.draw(); }
  fitBox(x0, y0, x1, y1, pad = 24) {
    this.s = Math.min((this.W - 2 * pad) / Math.max(1, x1 - x0), (this.H - 2 * pad) / Math.max(1, y1 - y0));
    this.s = Math.min(Math.max(this.s, 0.0004), 3);
    this.anchor((x0 + x1) / 2, (y0 + y1) / 2, this.W / 2, this.H / 2 + 20);
  }
  fitRegion() {
    const [x0, y0, x1, y1] = this.SH;
    this.s = Math.max((this.W - 48) / (x1 - x0), (this.H - 48) / (y1 - y0)); this.anchor((x0 + x1) / 2, (y0 + y1) / 2, this.W / 2, this.H / 2);
    this.ontoSheet();
  }
  zoomAt(x, y, f) {
    const [wx, wy] = this.toWorld(x, y);
    if (this.SH) {
      const { lo, hi } = this.limits();
      if ((f < 1 && this.s < lo) || (f > 1 && this.s > hi)) f **= 0.33;
      this.s = Math.min(Math.max(this.s * f, lo * 0.75), hi * 1.35);
    } else this.s = Math.min(Math.max(this.s * f, 0.0004), 3);
    this.anchor(wx, wy, x, y);
  }
  centerOn(x, y, zl = 8.2) { this.s = 2 ** zl / 1000; this.anchor(x, y, this.W / 2, this.H * 0.58); }

  /** The GL map to the camera (once per change). */
  sync() {
    if (!this.map || !this.P) return false;
    const key = `${this.s}|${this.ox}|${this.oy}|${this.rot}|${this.W}|${this.H}`;
    if (key === this.camKey) return false;
    this.camKey = key; this.camAt = performance.now();
    const [cx, cy] = this.centre();
    this.map.jumpTo({ center: this.ll(cx, cy), zoom: this.zoom(), bearing: this.bearing() });
    return true;
  }
  draw() { this.sync(); this.ov.draw(); this.hooks.frame?.(); }
  quick() { this.draw(); }
  /** Under the finger (an input event, before the frame's callbacks): the GL map gets the camera now,
   * so it draws in this very frame (from a frame callback it would be the next one: a frame behind
   * the finger); the page's bits (scale, compass) with the frame. */
  follow() {
    this.sync();
    this.hookRaf ||= requestAnimationFrame(() => { this.hookRaf = 0; this.hooks.frame?.(); });
  }
  /** A frame of an animation (from a frame callback): the camera to the GL map, drawn with its next frame
   * (not map.redraw() here: the map's own frame callback may come in the same frame, it was drawn twice). */
  step() {
    if (!this.sync()) this.ov.draw();
    this.hooks.frame?.();
  }
  /** A frame of a gesture or a glide, from a frame callback at the frame's time ts that came first in the frame
   * (registered at the start of the one before): the camera to the GL map and the map drawn now, in this frame
   * (its own callback put off) — not left to its own callback, which came now before ours and now after: the camera
   * shown now a frame late, now not, and the map went by uneven steps (most at 60 Hz). Drawn already in this frame
   * (its callback was first): with the next one. */
  stepNow(ts) {
    if (!this.sync()) this.ov.draw();
    else if (!(this.renderedAt > ts)) this.map.redraw();
    this.hooks.frame?.();
  }
  // (the smoothness test: app/bench.js; this.benching while it runs keeps the automatic sharpness out)
  /** The map glides on after a flick (vx, vy: px/ms) and slows down, as on other maps; false: too slow. */
  fling(vx, vy) {
    const v = Math.hypot(vx, vy), MAX = 5;
    if (v < 0.3) return false;
    if (v > MAX) { vx *= MAX / v; vy *= MAX / v; }
    cancelAnimationFrame(this.settling);
    const TAU = 330, t0 = performance.now();
    let done = 0;
    this.pre?.glideTo(-vx * TAU, -vy * TAU); // (where the glide stops: its tiles asked for now)
    const go = (now) => {
      this.settling = requestAnimationFrame(go); // (first: the next frame's callback before the map's own, see stepNow)
      const t = now - t0, d = TAU * (1 - Math.exp(-t / TAU)), dd = d - done; // how far by now, of v·TAU in all
      done = d;
      this.pan(vx * dd, vy * dd);
      const left = Math.hypot(vx, vy) * Math.exp(-t / TAU);
      if (left > 0.02 && this.overshoot() < 60) this.stepNow(now);
      else { cancelAnimationFrame(this.settling); this.settling = 0; if (!this.settle()) this.draw(); }
    };
    this.settling = requestAnimationFrame(go);
    return true;
  }
  /**
   * A picture of the map round a box (pack metres), for a postcard: the camera goes there (north up),
   * the map is drawn and read, the camera comes back. lines: [[x, y, ...]] laid out on the picture.
   * -> {url, W, H, dpr, lines: [[px, py, ...]]} (CSS px) or null.
   */
  async snapshot([x0, y0, x1, y1], lines = [], pad = 0.14) {
    const map = this.map;
    if (!map) return null;
    const keep = { s: this.s, ox: this.ox, oy: this.oy, rot: this.rot };
    try {
      this.rot = 0;
      const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
      this.s = Math.min((this.W * (1 - 2 * pad)) / Math.max(200, x1 - x0), (this.H * (1 - 2 * pad)) / Math.max(200, y1 - y0));
      this.s = Math.min(this.s, 2 ** 14.5 / 1000);
      this.anchor(cx, cy, this.W / 2, this.H / 2); this.draw();
      await new Promise((r) => { const t = setTimeout(r, 9000); map.once("idle", () => { clearTimeout(t); r(); }); map.triggerRepaint(); });
      const url = await new Promise((r) => { map.once("render", () => { try { r(map.getCanvas().toDataURL("image/png")); } catch { r(null); } }); map.triggerRepaint(); });
      const out = lines.map((ln) => { const o = []; for (let i = 0; i < ln.length; i += 2) { const [X, Y] = this.toScreen(ln[i], ln[i + 1]); o.push(X, Y); } return o; });
      return url ? { url, W: this.W, H: this.H, dpr: map.getCanvas().width / this.W, lines: out } : null;
    } finally {
      Object.assign(this, keep); this.draw();
    }
  }
  blit() { this.draw(); }
  schedule() { this.draw(); }

  /** A smooth flight to a view {s, ox, oy, rot} (as before: out, across, in). */
  flyTo(to) {
    this.stopFlight();
    const W = this.W, H = this.H, cx = W / 2, cy = H / 2, r0 = this.rot, r1 = to.rot ?? this.rot, dr = Math.atan2(Math.sin(r1 - r0), Math.cos(r1 - r0));
    const c0 = this.centre(), w0 = W / this.s, c1 = this.centre(to), w1 = W / to.s;
    const dx = c1[0] - c0[0], dy = c1[1] - c0[1], u1 = Math.hypot(dx, dy);
    const land = () => { this.s = to.s; this.rot = r1; this.anchor(c1[0], c1[1], cx, cy); this.flight = null; this.draw(); };
    if (matchMedia?.("(prefers-reduced-motion: reduce)").matches || (u1 < w0 * 0.003 && Math.abs(Math.log(w1 / w0)) < 0.02 && Math.abs(dr) < 0.01)) { land(); return Promise.resolve(); }
    const rho = 1.42, r2 = rho * rho;
    let S, U, Wd;
    if (u1 < w0 * 1e-4) { const k = w1 < w0 ? -1 : 1; S = Math.abs(Math.log(w1 / w0)) / rho; U = () => 0; Wd = (s) => w0 * Math.exp(k * rho * s); } else {
      const b = (wi, sg) => (w1 * w1 - w0 * w0 + sg * r2 * r2 * u1 * u1) / (2 * wi * r2 * u1), r = (bi) => Math.log(-bi + Math.sqrt(bi * bi + 1));
      const ra = r(b(w0, 1)), rb = r(b(w1, -1));
      S = (rb - ra) / rho;
      U = (s) => (w0 / r2) * (Math.cosh(ra) * Math.tanh(rho * s + ra) - Math.sinh(ra));
      Wd = (s) => (w0 * Math.cosh(ra)) / Math.cosh(rho * s + ra);
    }
    if (!Number.isFinite(S) || S <= 0) { if (Math.abs(dr) < 0.01) { land(); return Promise.resolve(); } S = 0; U = () => 0; Wd = () => w0; }
    const dur = Math.min(900, Math.max(450, 300 + 170 * S, Math.abs(dr) * 300));
    return new Promise((resolve) => {
      const t0 = performance.now(), ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
      const step = (now) => {
        const t = Math.min(1, (now - t0) / dur);
        if (t >= 1) { land(); resolve(); return; }
        const e = ease(t), sp = e * S, u = U(sp);
        this.s = W / Wd(sp); this.rot = r0 + dr * e;
        this.anchor(c0[0] + (u1 ? (dx / u1) * u : 0), c0[1] + (u1 ? (dy / u1) * u : 0), cx, cy);
        this.step();
        if (this.flight) this.flight.raf = requestAnimationFrame(step);
      };
      this.flight = { raf: requestAnimationFrame(step), resolve };
    });
  }
  stopFlight() {
    if (this.settling) { cancelAnimationFrame(this.settling); this.settling = 0; }
    const f = this.flight; if (!f) return; cancelAnimationFrame(f.raf); this.flight = null; f.resolve();
  }
  get flying() { return !!this.flight; }
  /** Resolves (true) once the map on screen is drawn (MapLibre idle); false after ms. */
  settled({ ms = 5000 } = {}) {
    return new Promise((res) => {
      if (this.map?.loaded() && this.map.areTilesLoaded() && !this.map.isMoving()) { requestAnimationFrame(() => res(true)); return; }
      const w = { res };
      (this.settleWaiters ||= []).push(w);
      setTimeout(() => { if (this.settleWaiters.includes(w)) { this.settleWaiters = this.settleWaiters.filter((x) => x !== w); res(false); } }, ms);
    });
  }

  // ---- what the page draws over the map (overlay.js)
  setPlan(plan) { this.ov.setPlan(plan); this.planLayer(); }
  /** The lifts' stations (lifts.js): [{lid, x, y, end: "lo" | "hi", n}] */
  setLiftStations(list) {
    this.liftSt = list;
    const map = this.map;
    if (!map || !this.ready) return; // (ready: the map's start adds them)
    if (!map.getSource("liftst")) {
      map.addSource("liftst", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
      // a station on a named summit (Śnieżka) only close in, where the peak's name steps aside for it; further
      // out the summit keeps its sign and name (the station's sign lay on them)
      const lay = (pk) => ({ "icon-image": ["concat", "lift-", ["get", "end"]], "icon-size": PLATE, "icon-anchor": "center", "icon-allow-overlap": true, "icon-ignore-placement": !pk,
        "text-field": ["step", ["zoom"], "", 14, ["get", "n"]], "text-font": ["Noto Sans Bold"], "text-size": 11, "text-anchor": "left", "text-offset": [1.2, 0], "text-optional": true, "text-max-width": 9 });
      const paint = { "text-color": "#1f2328", ...HALO }; // (as the stations' names)
      map.addLayer({ id: "liftst:0", type: "symbol", source: "liftst", minzoom: 13, filter: ["!=", ["get", "pk"], 1], layout: lay(false), paint });
      map.addLayer({ id: "liftst:1", type: "symbol", source: "liftst", minzoom: 14, filter: ["==", ["get", "pk"], 1], layout: lay(true), paint });
      this.labelOrder();
    }
    const peaks = (this.data?.names?.pois || []).filter((p) => p[2] === "peak" && p[1]);
    const onPeak = (q) => (peaks.some((p) => Math.abs(p[3] - q.x) < 150 && Math.abs(p[4] - q.y) < 150 && Math.hypot(p[3] - q.x, p[4] - q.y) < 150) ? 1 : 0);
    map.getSource("liftst").setData({ type: "FeatureCollection", features: list.map((q) => ({ type: "Feature", properties: { lid: q.lid, end: q.end, at: (q.at || []).join(","), n: q.n || "", pk: onPeak(q) }, geometry: { type: "Point", coordinates: this.ll(q.x, q.y) } })) });
  }
  /**
   * The plan as a highlighter on a paper map: one even band of pale amber (opaque: no darker spots where
   * its pieces meet or bend) under the trails, so their colours show which trails it follows; the part
   * already walked of the active route in grey; off the trails a thin line of its own over the band.
   * Saved plans: a narrower, paler band. All under the map's names and signs; no leg times on the map.
   */
  /** The route being planned or walked over what you walked (it is what you look at now), still under
   * the trails' colours; saved plans stay under your traces. */
  stackPlan() {
    const map = this.map, top = this.styleLayers(map).find((l) => l.id.startsWith("trail-0"))?.id;
    if (!top || !map.getLayer("plan-band")) return;
    for (const id of ["plan-band", "plan-done", "plan-closed"]) if (map.getLayer(id)) map.moveLayer(id, top);
  }
  /** A GeoJSON source's features, its layers shown only while it has any: an empty source asks for no tiles (its
   * tiles were made at every move for nothing). */
  geo(map, id, features) {
    map.getSource(id)?.setData({ type: "FeatureCollection", features });
    const vis = features.length ? "visible" : "none";
    for (const lid of map.style._order) { const l = map.getLayer(lid); if (l?.source === id && l.visibility !== vis) map.setLayoutProperty(lid, "visibility", vis); }
  }
  planLayer() {
    const map = this.map;
    // (not isStyleLoaded: that waits for every source's tiles too, and a plan set then stayed drawn by hand on
    // the canvas over everything, your traces and the trails, until it changed: seen after a restart mid-route)
    if (!map) return;
    if (!this.styleIn && !map.getSource("plan")) { if (!this.planWait) { this.planWait = true; map.once("style.load", () => { this.planWait = false; this.planLayer(); }); } return; }
    if (!map.getSource("plan")) {
      const layers = this.styleLayers(map), sym = layers.find((l) => l.type === "symbol")?.id;
      const under = layers.find((l) => l.id === "mine-band")?.id || layers.find((l) => l.id.startsWith("trail-"))?.id || sym;
      const Z = (st) => ["interpolate", ["linear"], ["zoom"], ...st.flat()], W = Z([[10, 6], [12, 12], [14, 18], [16, 26]]);
      for (const id of ["plan", "plandone", "planclosed", "saved"]) map.addSource(id, { type: "geojson", data: { type: "FeatureCollection", features: [] }, tolerance: 0.3 });
      const lay = { "line-cap": "round", "line-join": "round" };
      // far out narrower and stronger (the trails are thin there), close in wide and pale
      map.addLayer({ id: "saved-band", type: "line", source: "saved", layout: lay, paint: { "line-color": "#f3dca8", "line-width": Z([[10, 4], [12, 7], [14, 10], [16, 14]]) } }, under);
      // (the atlas: solid trails in full colour, the yellow one among them: the highlighter in a colour no trail has)
      const [far, band] = [PLAN_FAR, PLAN_BAND];
      map.addLayer({ id: "plan-band", type: "line", source: "plan", layout: lay, paint: { "line-color": Z([[11, far], [12.6, band]]), "line-width": W } }, under);
      map.addLayer({ id: "plan-done", type: "line", source: "plandone", layout: lay, paint: { "line-color": "#dcd9d2", "line-width": W } }, under);
      // closed on the day you go: a red highlighter over the route and your traces, under the trails' colours
      map.addLayer({ id: "plan-closed", type: "line", source: "planclosed", layout: lay, paint: { "line-color": "#ef6a5f", "line-width": W } }, under);
      // off the trails (a path, a road): round dots in a deep amber, nothing like a trail's dashes; no way in the map: red dots
      map.addLayer({ id: "plan-off", type: "line", source: "plan", layout: lay, filter: ["all", ["!", ["get", "cols"]], ["!=", ["get", "cat"], -1]], paint: { "line-color": "#a85f0c", "line-width": Z([[11, 2.4], [14, 3.4], [16, 4.4]]), "line-dasharray": [0.01, 1.9] } }, sym);
      map.addLayer({ id: "plan-none", type: "line", source: "plan", layout: lay, filter: ["==", ["get", "cat"], -1], paint: { "line-color": "#b3261e", "line-width": 2, "line-dasharray": [1, 2.5] } }, sym);
      this.stackPlan();
    }
    const P = this.ov.plan, live = !!P?.live, line = (f) => Array.from({ length: f.length / 2 }, (_, i) => this.ll(f[2 * i], f[2 * i + 1]));
    this.geo(map, "plan", (P?.runs || []).map((r) => ({ type: "Feature", properties: { cols: r.cols.length > 0, cat: r.cat }, geometry: { type: "LineString", coordinates: line(r.line) } })));
    this.geo(map, "plandone", P?.done?.length >= 4 ? [{ type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: line(P.done) } }] : []);
    this.geo(map, "planclosed", (P?.closed || []).map((f) => ({ type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: line(f) } })));
    this.geo(map, "saved", (this.ov.saved || []).filter((f) => f?.length >= 4).map((f) => ({ type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: line(f) } })));
    map.setPaintProperty("plan-band", "line-opacity", live ? 0.7 : 1);
    this.ov.glPlan = true;
  }
  setSaved(list) { this.ov.setSaved(list); this.planLayer(); }
  /** Candidates to pick on the map (car parks for a loop): [{x, y, t: label, line: [x, y, ...] the way to the loop}]
   * or null. A white P with its label; the way to the loop dotted. */
  setCands(list) {
    const map = this.map;
    if (!map || !this.styleIn) return;
    if (!map.getSource("cands")) {
      map.addSource("cands", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
      map.addLayer({ id: "cands-way", type: "line", source: "cands", filter: ["==", ["geometry-type"], "LineString"], layout: { "line-cap": "round" }, paint: { "line-color": "#1a5fb4", "line-width": 3, "line-dasharray": [0.1, 1.8] } });
      map.addLayer({ id: "cands-dot", type: "circle", source: "cands", filter: ["==", ["geometry-type"], "Point"], paint: { "circle-radius": 11, "circle-color": "#1a5fb4", "circle-stroke-color": "#fff", "circle-stroke-width": 2.5 } });
      map.addLayer({ id: "cands-p", type: "symbol", source: "cands", filter: ["==", ["geometry-type"], "Point"],
        layout: { "text-field": ["format", "P", { "text-font": ["literal", ["Noto Sans Bold"]] }], "text-size": 13, "text-allow-overlap": true, "text-ignore-placement": true }, paint: { "text-color": "#fff" } });
      map.addLayer({ id: "cands-t", type: "symbol", source: "cands", filter: ["==", ["geometry-type"], "Point"],
        layout: { "text-field": ["get", "t"], "text-font": ["literal", ["Noto Sans Bold"]], "text-size": 13, "text-offset": [0, 1.5], "text-anchor": "top", "text-allow-overlap": true },
        paint: { "text-color": "#1a5fb4", "text-halo-color": "#fff", "text-halo-width": 2 } });
    }
    const f = [];
    for (const c of list || []) {
      if (c.line?.length >= 4) f.push({ type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: Array.from({ length: c.line.length / 2 }, (_, i) => this.ll(c.line[2 * i], c.line[2 * i + 1])) } });
      f.push({ type: "Feature", properties: { t: c.t }, geometry: { type: "Point", coordinates: this.ll(c.x, c.y) } });
    }
    map.getSource("cands").setData({ type: "FeatureCollection", features: f });
  }
  /** The "Nachylenie" layer: how steep the ways are, a coloured band under them (core/slope.js runs:
   * [{b: 1..4, line}] in pack metres), or null: off. Under your traces, the plan and the trails. */
  setSlope(runs) {
    const map = this.map;
    this.slopeRuns = runs;
    if (!map) return;
    if (!this.styleIn && !map.getSource("slope")) { if (!this.slopeWait) { this.slopeWait = true; map.once("style.load", () => { this.slopeWait = false; this.setSlope(this.slopeRuns); }); } return; }
    if (!map.getSource("slope")) {
      if (!runs) return;
      map.addSource("slope", { type: "geojson", data: { type: "FeatureCollection", features: [] }, tolerance: 0.4 });
      const under = this.styleLayers(map).find((l) => /^(saved-band|plan-band|mine-band|track|path|hard|trail-|edu)/.test(l.id))?.id;
      const Z = (st) => ["interpolate", ["linear"], ["zoom"], ...st.flat()];
      // the paths and tracks only from z 14, as the map draws them (no bands floating over nothing)
      map.addLayer({ id: "slope", type: "line", source: "slope", minzoom: 11.6, filter: ["step", ["zoom"], ["!=", ["get", "c"], 1], 14, true], layout: { "line-cap": "round", "line-join": "round" },
        paint: { "line-color": ["match", ["get", "b"], 1, "#f3d34a", 2, "#f08a24", 3, "#d42a1e", "#6b1a6e"], "line-opacity": Z([[11.6, 0], [12, 0.85]]), "line-width": Z([[12, 4], [14, 9], [16, 15]]) } }, under);
    }
    map.setLayoutProperty("slope", "visibility", runs ? "visible" : "none");
    if (runs) map.getSource("slope").setData({ type: "FeatureCollection", features: runs.map((r) => ({ type: "Feature", properties: { b: r.b, c: r.c }, geometry: { type: "LineString", coordinates: Array.from({ length: r.line.length / 2 }, (_, i) => this.ll(r.line[2 * i], r.line[2 * i + 1])) } })) });
  }
  movePlanPoint(i, x, y) { this.ov.movePlanPoint(i, x, y); }
  planPointAt(sx, sy, r) { return this.ov.planPointAt(sx, sy, r); }
  planLineAt(sx, sy, r) { return this.ov.planLineAt(sx, sy, r); }
  get plan() { return this.ov.plan; }
  setHighlight(parts) { this.ov.setHighlight(parts); }
  /**
   * A long trail (GSB, GSS...) split into what you walked (violet) and what is left (grey dashes), on the
   * map; parts: [x, y, ...] in pack metres. -> the gaps, longest first: [{km, a: [x, y], b: [x, y], pts}].
   * null clears it.
   */
  /** The gaps of a route (what you have not walked of it, over 300 m), nothing drawn. */
  splitGaps(parts) {
    const cells = this.walkedCells, CS = 40, gaps = [];
    if (!parts || !cells) return gaps;
    const near = (x, y) => { const cx = Math.floor(x / CS), cy = Math.floor(y / CS); for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) if (cells.has(cellKey(cx + i, cy + j))) return true; return false; };
    for (const pt of parts) {
      let run = null;
      const flush = () => { if (run && !run.w && run.m > 300 && run.pts.length >= 2) gaps.push({ km: run.m / 1000, a: run.pts[0], b: run.pts.at(-1), pts: run.pts }); };
      for (let i = 0; i < pt.length; i += 2) {
        const x = pt[i], y = pt[i + 1], px = i ? pt[i - 2] : x, py = i ? pt[i - 1] : y, L = Math.hypot(x - px, y - py), k = i ? Math.max(1, Math.ceil(L / 20)) : 1;
        for (let j = 1; j <= k; j++) {
          const sx = i ? px + ((x - px) * j) / k : x, sy = i ? py + ((y - py) * j) / k : y, w = near(sx, sy) ? 1 : 0;
          if (!run || run.w !== w) { const last = run?.pts.at(-1); flush(); run = { w, pts: last ? [last] : [], m: 0 }; }
          const prev = run.pts.at(-1); if (prev) run.m += Math.hypot(sx - prev[0], sy - prev[1]);
          run.pts.push([sx, sy]);
        }
      }
      flush();
    }
    return gaps;
  }
  routeSplit(parts, { color = null, draw = true } = {}) {
    const map = this.map;
    if (!map) return [];
    if (!draw) return this.splitGaps(parts);
    if (!map.getSource("rsplit")) {
      map.addSource("rsplit", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
      const at = this.styleLayers(map).find((l) => l.type === "symbol")?.id;
      map.addLayer({ id: "rsplit-miss-case", type: "line", source: "rsplit", filter: ["==", ["get", "w"], 0], layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": "#fff", "line-opacity": 0.9, "line-width": ["interpolate", ["linear"], ["zoom"], 6, 3, 12, 7] } }, at);
      map.addLayer({ id: "rsplit-miss", type: "line", source: "rsplit", filter: ["==", ["get", "w"], 0], paint: { "line-color": "#6d6a75", "line-width": ["interpolate", ["linear"], ["zoom"], 6, 1.6, 12, 3.4], "line-dasharray": [2, 1.6] } }, at);
      map.addLayer({ id: "rsplit-done", type: "line", source: "rsplit", filter: ["==", ["get", "w"], 1], layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": "#5b2bd1", "line-width": ["interpolate", ["linear"], ["zoom"], 6, 2.6, 12, 5] } }, at);
    }
    const src = map.getSource("rsplit");
    // a long route: the rest in its marking colour, solid and wide; a gap to go for (no colour): grey dashes
    map.setPaintProperty("rsplit-miss", "line-color", color || "#6d6a75");
    map.setPaintProperty("rsplit-miss", "line-dasharray", color ? [1, 0] : [2, 1.6]);
    map.setPaintProperty("rsplit-miss", "line-width", color ? ["interpolate", ["linear"], ["zoom"], 6, 2.4, 12, 4.6] : ["interpolate", ["linear"], ["zoom"], 6, 1.6, 12, 3.4]);
    if (!parts) { src.setData({ type: "FeatureCollection", features: [] }); return []; }
    const cells = this.walkedCells, C = 40;
    const near = (x, y) => { const cx = Math.floor(x / C), cy = Math.floor(y / C); for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) if (cells.has(cellKey(cx + i, cy + j))) return true; return false; };
    const feats = [], gaps = [];
    for (const pt of parts) {
      let run = null;
      const flush = () => { if (run && run.pts.length >= 2) { feats.push({ type: "Feature", properties: { w: run.w }, geometry: { type: "LineString", coordinates: run.pts.map(([x, y]) => this.ll(x, y)) } }); if (!run.w && run.m > 300) gaps.push({ km: run.m / 1000, a: run.pts[0], b: run.pts.at(-1), pts: run.pts }); } };
      for (let i = 0; i < pt.length; i += 2) {
        const x = pt[i], y = pt[i + 1];
        // samples every ~20 m along the edge to here
        const px = i ? pt[i - 2] : x, py = i ? pt[i - 1] : y, L = Math.hypot(x - px, y - py), k = i ? Math.max(1, Math.ceil(L / 20)) : 1;
        for (let j = 1; j <= k; j++) {
          const sx = i ? px + ((x - px) * j) / k : x, sy = i ? py + ((y - py) * j) / k : y, w = near(sx, sy) ? 1 : 0;
          if (!run || run.w !== w) { const last = run?.pts.at(-1); flush(); run = { w, pts: last ? [last] : [], m: 0 }; }
          const prev = run.pts.at(-1); if (prev) run.m += Math.hypot(sx - prev[0], sy - prev[1]);
          run.pts.push([sx, sy]);
        }
      }
      flush();
    }
    src.setData({ type: "FeatureCollection", features: feats });
    return gaps.sort((a, b) => b.km - a.km);
  }
  setGps(g) { this.ov.gps = g; this.ov.draw(); }
  setAccent(sel, ui) { this.ov.sel = sel || "#5b2bd1"; this.ov.ui = ui || "#5b2bd1"; this.ov.draw(); }
  setArea(rings) { this.ov.setArea(rings); }
  setPin(p) { this.ov.setPin(p); }
  setCursor(p) { this.ov.setCursor(p); }

  // ---- questions about the map
  /** The point under a screen position: a sign or a place name (as the old pick: {id, c, n, e, x, y, d, ...}). */
  async pick(x, y, r, named) { return this.data?.pick(x, y, r, named) ?? null; }
  trailCols(x, y, r) { return this.data?.trailCols(x, y, r) ?? ""; }
  search(q) { return Promise.resolve(this.data?.search(q) ?? []); }
  elevAt(x, y) { return this.data?.elevAt(x, y) ?? Promise.resolve(null); }
  async rangeAt(sx, sy) { const [x, y] = this.toWorld(sx, sy); return this.rangeOf(x, y); }
  rangeOf(x, y) { return this.ranges?.find((r) => x >= r.bbox[0] && x <= r.bbox[2] && y >= r.bbox[1] && y <= r.bbox[3] && r.rings.some((ring) => pip(x, y, ring))) || null; }
  onMap(x, y, m = 1500) {
    if (x == null || !this.ranges) return false;
    const at = [[x, y], [x - m, y], [x + m, y], [x, y - m], [x, y + m]];
    return this.ranges.some((r) => x >= r.bbox[0] - m && x <= r.bbox[2] + m && y >= r.bbox[1] - m && y <= r.bbox[3] + m && at.some(([a, b]) => r.rings.some((ring) => pip(a, b, ring))));
  }
  profile() { return Promise.resolve(null); }
  stats() {
    const m = this.map;
    let gpu = null, tiles = 0;
    try { const gl = m?.painter?.context?.gl, ext = gl?.getExtension("WEBGL_debug_renderer_info"); gpu = ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl?.getParameter(gl.RENDERER); } catch { /* hidden */ }
    try { for (const id of Object.keys(m?.style?.tileManagers || m?.style?.sourceCaches || {})) { const tm = m.style.tileManagers?.[id] || m.style.sourceCaches?.[id]; tiles += tm?.getIds?.().length ?? Object.keys(tm?._tiles || tm?._inViewTiles?._tiles || {}).length; } } catch { /* internals */ }
    // what is drawn on the screen now, by kind (an empty kind: its tiles did not come)
    const drawn = {};
    try { for (const f of m.queryRenderedFeatures({ layers: this.styleLayers(m).filter((l) => l.source && l.type !== "raster").map((l) => l.id) })) { const k = f.sourceLayer || f.source; drawn[k] = (drawn[k] || 0) + 1; } } catch { /* no map */ }
    let cached = 0; try { for (const tm of Object.values(m?.style?.tileManagers || {})) cached += tm?._outOfViewCache?.order?.length || 0; } catch { /* */ }
    return Promise.resolve({ gpu, zoom: m ? +m.getZoom().toFixed(2) : null, tiles, cached, prefetch: this.pre?.stats() || null, parts: this.parts?.length ?? 0, discs: this.revealN || 0, fogDiscs: this.fog?.n ?? null, fogMasks: this.fog?.drawn ?? null, mine: this.mineN ?? null, errs: this.errs || 0, drawn });
  }

}

export { PAPER };
