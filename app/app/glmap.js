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
import { sources, layers, labels, PAPER, ICON_SIZE, POI_TEXT, HALO, DOT, PLATE } from "./glstyle.js";
import { drawMapSign, drawPlate, drawPlateSign, GLYPH, PEAK_INK, PLATE_SIDE } from "./glyphs.js";
import { FogLayer } from "./glfog.js";
import { RANGE_LINES, FAR_PEAKS } from "./range-lines.js";
import { KGP } from "../core/badges.js";
import { Overlay } from "./overlay.js";
/** The plan's highlighter band: far out (narrow, stronger) and close in (wide, pale). */
const PLAN_FAR = "#eea127", PLAN_BAND = "#f6cf7c";
/** "r,g,b" at alpha a over the light green ground of the map, as an opaque colour. */
const GROUND = [222, 230, 200];
const mix = (rgb, a) => `rgb(${String(rgb).split(",").map((v, i) => Math.round(GROUND[i] * (1 - a) + +v * a)).join(",")})`;
import { MapData } from "./mapdata.js";
import { blitTook, mark, note } from "./diag.js";

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
function pmtilesProtocol() {
  if (protocol) return protocol;
  protocol = new pmtiles.Protocol();
  maplibregl.addProtocol("pmtiles", protocol.tile);
  return protocol;
}

/** The ranges' names: bands of zoom [from, to); a name is laid once for each, and grows with the map inside it. */
const RANGE_BANDS = [[5.6, 6.9], [6.9, 7.6], [7.6, 8.3], [8.3, 9.0], [9.0, 9.7], [9.7, 10.6]];
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
    // the parts on the phone: one vector and one relief source each
    this.parts = [];
    for (const p of packs) {
      const groups = p.groups || [...new Set(p.index.tiles.map((t) => t.grp || p.index.region))];
      if (!p.index.vector) { console.warn(`pack ${p.index.region}: no vector tiles (an older download)`); this.old = true; continue; }
      for (const g of groups) this.parts.push({ id: `${p.index.region}-${g}`.replace(/[^\w-]/g, "_"), url: "pmtiles://" + packUrl(p.base, `g/${g}.pmtiles`), raw: packUrl(p.base, `g/${g}.pmtiles`) });
    }
    const proto = pmtilesProtocol();
    for (const p of this.parts) for (const u of [p.raw]) proto.add(new pmtiles.PMTiles(new RangeOrWhole(u)));
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
    this.map = new maplibregl.Map({
      container: this.box, interactive: false, attributionControl: false,
      style: { version: 8, glyphs: root + "{fontstack}/{range}.pbf", sources: sources(this.parts), layers: [...layers(this.parts, { accent: this.trace }), ...labels(this.parts)] },
      center: [lon, lat], zoom: this.zoom(), bearing: this.bearing(),
      pixelRatio: this.dpr, fadeDuration: 150, maxZoom: 19, minZoom: 3, renderWorldCopies: false,
      maxTileCacheSize: 120, refreshExpiredTiles: false, cancelPendingTileRequestsWhileZooming: true,
      canvasContextAttributes: { antialias: false, preserveDrawingBuffer: false, powerPreference: "default" },
    });
    this.map.on("styleimagemissing", (e) => this.icon(e.id));
    this.map.on("render", () => {
      this.ov.frame();
      const now = performance.now();
      if (this.lastR && now - this.lastR < 250 && now - (this.camAt || 0) < 120) blitTook(now - this.lastR); // frame to frame while moving
      this.lastR = now;
    });
    this.map.once("idle", () => mark("mapa narysowana"));
    this.map.on("idle", () => { this.idleN = (this.idleN || 0) + 1; const ws = this.settleWaiters || []; this.settleWaiters = []; for (const w of ws) w.res(true); });
    // ready once the style is in (the tiles come as they come); a map that never gets there does not
    // hold the app up: after 20 s it goes on without it (what went wrong is in Diagnostyka)
    return new Promise((res) => {
      let done = false;
      const ready = () => { if (done) return; done = true; this.styleIn = true; try { this.addMine(); } catch (e) { note(`mapa: ${e.message}`); } try { if (this.ov.plan) this.planLayer(); } catch (e) { note(`plan: ${e.message}`); } try { if (this.liftSt) this.setLiftStations(this.liftSt); } catch (e) { note(`lifts: ${e.message}`); } this.ready = true; this.autoSharp(); if (this.bdWant) this.setBackdrop(this.bdWant); res(); };
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
    const DOTS = { dot: [3.6, "#5e5a55", 1.3], "dot-n": [4.3, "#4a4642", 1.5], pdot: [4.6, "#5e5a55", 1.6], "pdot-n": [5.2, "#4a4642", 1.8] }; // small, quiet (planning: a little bigger, never amber: amber is the plan's points)
    if (DOTS[id]) { // a junction: a white dot with a ring
      const [r, col, w] = DOTS[id], k = 2, B = Math.ceil((r + w) * 2 + 2), c = new OffscreenCanvas(B * k, B * k), g = c.getContext("2d");
      g.scale(k, k); g.beginPath(); g.arc(B / 2, B / 2, r, 0, 7); g.fillStyle = "#fff"; g.fill(); g.lineWidth = w; g.strokeStyle = col; g.stroke();
      this.map.addImage(id, g.getImageData(0, 0, B * k, B * k), { pixelRatio: k });
      return;
    }
    if (id === "station-plate") { // a railway station: a train's front in white on a black plate (drawn at 4x: sharp on any screen)
      // (the pictogram: Material Icons "train", Apache License 2.0)
      const k = 4, B = 30, c = new OffscreenCanvas(B * k, B * k), g = c.getContext("2d");
      g.scale(k, k); drawPlateSign(g, B / 2, B / 2, PLATE_SIDE, "#1f2328", "M12 2c-4 0-8 .5-8 4v9.5C4 17.43 5.57 19 7.5 19L6 20.5v.5h2.23l2-2H14l2 2h2v-.5L16.5 19c1.93 0 3.5-1.57 3.5-3.5V6c0-3.5-3.58-4-8-4zM7.5 17c-.83 0-1.5-.67-1.5-1.5S6.67 14 7.5 14s1.5.67 1.5 1.5S8.33 17 7.5 17zm3.5-7H6V6h5v4zm2 0V6h5v4h-5zm3.5 7c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5 1.5.67 1.5 1.5-.67 1.5-1.5 1.5z", 0.72);
      this.map.addImage(id, g.getImageData(0, 0, B * k, B * k), { pixelRatio: k });
      return;
    }
    if (id === "bus-plate") { // a bus stop: a white bus on a slate plate
      const k = 4, B = 30, c = new OffscreenCanvas(B * k, B * k), g = c.getContext("2d");
      g.scale(k, k); drawPlateSign(g, B / 2, B / 2, PLATE_SIDE, "#3d5266", GLYPH.bus, 0.78);
      this.map.addImage(id, g.getImageData(0, 0, B * k, B * k), { pixelRatio: k });
      return;
    }
    if (id === "parking-hi") { // a car park as on road signs, a bold white P on a blue plate (4x: sharp)
      const k = 4, B = 30, c = new OffscreenCanvas(B * k, B * k), g = c.getContext("2d");
      g.scale(k, k); drawPlate(g, B / 2, B / 2, PLATE_SIDE, "#0a58ca");
      g.fillStyle = "#fff"; g.font = "700 18px 'Noto Sans', 'Inter', system-ui, sans-serif"; g.textAlign = "center"; g.textBaseline = "middle"; g.fillText("P", B / 2, B / 2 + 1);
      this.map.addImage(id, g.getImageData(0, 0, B * k, B * k), { pixelRatio: k });
      return;
    }
    if (id === "parking" || id === "station" || id === "bus" || id === "pass") { // getting there: graphite signs of the same family
      const k = 2, B = 32, c = new OffscreenCanvas(B * k, B * k), g = c.getContext("2d");
      g.scale(k, k); drawMapSign(g, id, B / 2, B / 2, id === "station" ? 17 : 15, false);
      this.map.addImage(id, g.getImageData(0, 0, B * k, B * k), { pixelRatio: k });
      return;
    }
    if (id === "lift-lo" || id === "lift-hi" || id === "lift-mid") { // a lift's station: a cabin on its rope on a graphite plate; a small arrow: up from here (lower), down (upper)
      const k = 4, B = 34, c = new OffscreenCanvas(B * k, B * k), g = c.getContext("2d"), P = "#3f4347";
      g.scale(k, k); g.lineJoin = "round"; g.lineCap = "round";
      drawPlate(g, 15, 15, PLATE_SIDE, P);
      g.strokeStyle = "#fff"; g.lineWidth = 1.6; g.beginPath(); g.moveTo(6.5, 11); g.lineTo(23.5, 7.4); g.stroke(); g.beginPath(); g.moveTo(15, 9.2); g.lineTo(15, 13.2); g.stroke();
      g.fillStyle = "#fff"; g.beginPath(); g.roundRect(10.2, 13.2, 9.6, 9, 1.9); g.fill();
      g.fillStyle = P; g.fillRect(11.9, 14.9, 2.6, 2.9); g.fillRect(15.5, 14.9, 2.6, 2.9);
      const up = id === "lift-lo", cx = 27, cy = 26;
      g.beginPath(); g.arc(cx, cy, 5.4, 0, 7); g.fillStyle = "#fff"; g.fill(); g.lineWidth = 1; g.strokeStyle = P; g.stroke();
      g.fillStyle = P; g.beginPath();
      if (id === "lift-mid") { g.moveTo(cx, cy - 3.6); g.lineTo(cx + 2.4, cy - 0.6); g.lineTo(cx - 2.4, cy - 0.6); g.closePath(); g.moveTo(cx, cy + 3.6); g.lineTo(cx + 2.4, cy + 0.6); g.lineTo(cx - 2.4, cy + 0.6); }
      else if (up) { g.moveTo(cx, cy - 3); g.lineTo(cx + 2.8, cy + 1.8); g.lineTo(cx - 2.8, cy + 1.8); } else { g.moveTo(cx, cy + 3); g.lineTo(cx + 2.8, cy - 1.8); g.lineTo(cx - 2.8, cy - 1.8); }
      g.closePath(); g.fill();
      this.map.addImage(id, g.getImageData(0, 0, B * k, B * k), { pixelRatio: k });
      return;
    }
    const m = /^(.*)@([dn])$/.exec(id);
    if (!m || this.map.hasImage(id)) return;
    const k = 4, B = 32, c = new OffscreenCanvas(B * k, B * k), g = c.getContext("2d");
    g.scale(k, k);
    drawMapSign(g, m[1], B / 2, B / 2, m[1] === "hut" ? 22 : 16, m[2] === "d"); // (a hut: its plate a little under the stations', the POI layers' size being a little bigger)
    this.map.addImage(id, g.getImageData(0, 0, B * k, B * k), { pixelRatio: k });
  }

  /** The ranges' names: at a range's middle, turned along its main axis; top: its highest peak (m). */
  rangeLabels() {
    return this.ranges.map((r) => {
      const ring = r.rings.reduce((a, b) => (b.length > a.length ? b : a), []), n = ring.length || 1;
      let x = 0, y = 0; for (const q of ring) { x += q[0]; y += q[1]; }
      x /= n; y /= n;
      let sxx = 0, syy = 0, sxy = 0;
      for (const [a, b] of ring) { sxx += (a - x) ** 2; syy += (b - y) ** 2; sxy += (a - x) * (b - y); }
      let rot = (0.5 * Math.atan2(2 * sxy, sxx - syy) * 180) / Math.PI; // the main axis (pack y runs south: clockwise, as the screen)
      if (rot > 90) rot -= 180; if (rot < -90) rot += 180;
      rot = Math.max(-40, Math.min(40, rot));
      return { type: "Feature", properties: { n: (r.short || r.label).split(" / ")[0], rot: Math.round(rot), top: r.top || 0 }, geometry: { type: "Point", coordinates: this.ll(x, y) } };
    });
  }
  // The ranges' names along their ridges, fitted to what is on the screen
  /** Each range's axis (pack m): through its highest peaks, gently bent; its length: the range's own. */
  rangeAxes() {
    const pois = this.data.names?.pois || [];
    const inside = (ring, x, y) => { let c = false; for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) { const [xi, yi] = ring[i], [xj, yj] = ring[j]; if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c; } return c; };
    for (const r of this.ranges) {
      const ring = r.rings.reduce((a, b) => (b.length > a.length ? b : a), []);
      let pk = pois.filter((p) => p[2] === "peak" && p[5] && p[3] >= r.bbox[0] && p[3] <= r.bbox[2] && p[4] >= r.bbox[1] && p[4] <= r.bbox[3] && inside(ring, p[3], p[4])).map((p) => [p[3], p[4], p[5]]);
      pk.sort((a, b) => b[2] - a[2]); pk = pk.slice(0, Math.max(6, Math.ceil(pk.length * 0.3)));
      const base = pk.length ? pk[pk.length - 1][2] - 30 : 0, pts = pk.length >= 4 ? pk.map(([x, y, e]) => [x, y, e - base]) : ring.map(([x, y]) => [x, y, 1]);
      let W = 0, cx = 0, cy = 0; for (const [x, y, w] of pts) { W += w; cx += x * w; cy += y * w; } cx /= W; cy /= W;
      let sxx = 0, syy = 0, sxy = 0; for (const [x, y, w] of pts) { sxx += w * (x - cx) ** 2; syy += w * (y - cy) ** 2; sxy += w * (x - cx) * (y - cy); }
      let th = 0.5 * Math.atan2(2 * sxy, sxx - syy); if (th > Math.PI / 2) th -= Math.PI; if (th < -Math.PI / 2) th += Math.PI;
      const steep = Math.abs(th) > 0.85; if (steep) th = 0; // (a range running north-south: its name level across it, never on end)
      const u = [Math.cos(th), Math.sin(th)], v = [-u[1], u[0]];
      let t0 = Infinity, t1 = -Infinity; for (const [x, y] of ring) { const t = (x - cx) * u[0] + (y - cy) * u[1]; t0 = Math.min(t0, t); t1 = Math.max(t1, t); }
      if (steep) { const hit = []; for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) { const a1 = (ring[j][0] - cx) * v[0] + (ring[j][1] - cy) * v[1], b1 = (ring[i][0] - cx) * v[0] + (ring[i][1] - cy) * v[1]; if (a1 * b1 < 0) { const k = a1 / (a1 - b1), x = ring[j][0] + (ring[i][0] - ring[j][0]) * k, y = ring[j][1] + (ring[i][1] - ring[j][1]) * k; hit.push((x - cx) * u[0] + (y - cy) * u[1]); } } if (hit.length >= 2) { t0 = Math.min(...hit); t1 = Math.max(...hit); } }
      const cut = (t1 - t0) * (steep ? 0.04 : 0.1); t0 += cut; t1 -= cut;
      const K = 5, off = new Array(K).fill(null);
      for (let k = 0; k < K; k++) { const a = t0 + ((t1 - t0) * k) / K, b = t0 + ((t1 - t0) * (k + 1)) / K; let w = 0, o = 0; for (const [x, y, ww] of pts) { const t = (x - cx) * u[0] + (y - cy) * u[1]; if (t >= a && t < b) { w += ww; o += ww * ((x - cx) * v[0] + (y - cy) * v[1]); } } if (w) off[k] = o / w; }
      for (let k = 0; k < K; k++) if (off[k] == null) { const l = off.slice(0, k).reverse().find((q) => q != null), rr = off.slice(k + 1).find((q) => q != null); off[k] = l != null && rr != null ? (l + rr) / 2 : l ?? rr ?? 0; }
      const sm = off.map((o, k) => (off[Math.max(0, k - 1)] + 2 * o + off[Math.min(K - 1, k + 1)]) / 4), lim = steep ? 0 : (t1 - t0) * 0.16;
      let line = sm.map((o, k) => { const t = t0 + ((t1 - t0) * (k + 0.5)) / K, oo = Math.max(-lim, Math.min(lim, o)); return [cx + u[0] * t + v[0] * oo, cy + u[1] * t + v[1] * oo]; });
      line = [[2 * line[0][0] - line[1][0], 2 * line[0][1] - line[1][1]].map((q, i) => (q + line[0][i]) / 2), ...line, [2 * line[K - 1][0] - line[K - 2][0], 2 * line[K - 1][1] - line[K - 2][1]].map((q, i) => (q + line[K - 1][i]) / 2)];
      for (let it = 0; it < 3; it++) { const o = [line[0]]; for (let i = 0; i < line.length - 1; i++) { const [a, b] = [line[i], line[i + 1]]; o.push([0.75 * a[0] + 0.25 * b[0], 0.75 * a[1] + 0.25 * b[1]], [0.25 * a[0] + 0.75 * b[0], 0.25 * a[1] + 0.75 * b[1]]); } o.push(line[line.length - 1]); line = o; }
      r.axis = line;
      { let mx = 0, my = 0; for (const [x, y] of ring) { mx += x; my += y; } r.mid = [mx / ring.length, my / ring.length]; }
    }
    this.rangeLay();
  }
  /** The names' letters, laid once: printed on the map, never fitted to the screen (fitted, they jumped with
   * every pan and pinch). For each band of zoom a name has one place, size and spelling; inside a band the
   * letters grow with the map. Each letter is its own point turned along the ridge (MapLibre's line labels are
   * cut at its tiles' edges); beside the ridge (the border and the peaks' names run on it), off the far peaks'
   * names and the higher ranges' names; shortened as on paper maps when the range is too short for its name. */
  rangeLay() {
    const src = this.map?.getSource("rax");
    if (!src || !this.ranges?.[0]?.axis) return;
    const WF = 0.7, feats = [];
    const adv = (c) => (c === " " ? 0.36 : "IJ.".includes(c) ? 0.42 : "MW".includes(c) ? 0.95 : WF);
    const len = (l) => { let d = 0; for (let i = 1; i < l.length; i++) d += Math.hypot(l[i][0] - l[i - 1][0], l[i][1] - l[i - 1][1]); return d; };
    const at = (line, d) => { let seg = 0, run = 0; for (; seg < line.length - 2; seg++) { const l = Math.hypot(line[seg + 1][0] - line[seg][0], line[seg + 1][1] - line[seg][1]); if (run + l >= d) break; run += l; } const a = line[seg], b = line[seg + 1], l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1, k = (d - run) / l; return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k]; };
    const smooth = (l) => { for (let it = 0; it < 3; it++) { const o = [l[0]]; for (let i = 0; i < l.length - 1; i++) { const [p, q] = [l[i], l[i + 1]]; o.push([0.75 * p[0] + 0.25 * q[0], 0.75 * p[1] + 0.25 * q[1]], [0.25 * p[0] + 0.75 * q[0], 0.25 * p[1] + 0.75 * q[1]]); } o.push(l[l.length - 1]); l = o; } return l; };
    RANGE_BANDS.forEach(([z0, z1], bi) => {
      const m = 1000 / 2 ** (z0 - 5.65), obst = []; // metres to a pixel at the band's first zoom
      if (z0 >= 7.6) for (const q of this.rpeakPts || []) obst.push([q[0] - 38 * m, q[1] - 12 * m, q[0] + 38 * m, q[1] + 24 * m]);
      // (the towns shown far out: the bigger ones early, the rest from z ~9)
      for (const [n, lon, lat, kind, pop] of this.townsData || []) { if (kind === "station" || (pop || 0) < (z0 < 8.3 ? 60000 : z0 < 9 ? 15000 : 4000)) continue; const q = this.xy(lon, lat), w = (n.length * 3.9 + 12) * m; obst.push([q[0] - w, q[1] - 9 * m, q[0] + w, q[1] + 9 * m]); }
      const put = (line, name, S, mid, hand) => {
        let L = len(line); const abbr = name.replace(/^Góry /, "G. ").replace(/^Pogórze /, "Pog. ").replace(/^Masyw /, "M. ").replace(/^Grzbiet /, "Grzb. ").replace(/^Wysoki /, "Wys. ").replace(/^G\. Złote i Bialskie$/, "G. Złote");
        const a0 = line[0], b0 = line[line.length - 1], nx = -(b0[1] - a0[1]), ny = b0[0] - a0[0], nl = Math.hypot(nx, ny) || 1, side = mid ? Math.sign((mid[0] - a0[0]) * nx + (mid[1] - a0[1]) * ny) || 1 : 1;
        for (const t of [name, abbr]) {
          const txt = t.toUpperCase(), n = txt.length, Sm = S * m;
          // (no wider than a phone at the band's last zoom: a long range's name stays whole on the screen)
          let sp = Math.min(0.5, (0.92 * L - n * Sm * WF) / (Math.max(1, n - 1) * Sm), Math.max(0.06, ((350 / 2 ** (z1 - z0)) * m - n * Sm * WF) / (Math.max(1, n - 1) * Sm)));
          if (sp < 0.06) {
            // a range too short for its name: the full name is tried shortened first; a hand-drawn line is then
            // run on straight at both ends (as on paper maps, the name reaches a little past the range)
            if (!hand || t === name && abbr !== name) continue;
            sp = 0.06; const need = (n * Sm * WF + (n - 1) * sp * Sm) / 0.92, e = (need - L) / 2, ex = (p, q) => { const d = Math.hypot(p[0] - q[0], p[1] - q[1]) || 1; return [p[0] + ((p[0] - q[0]) / d) * e, p[1] + ((p[1] - q[1]) / d) * e]; };
            line = [ex(line[0], line[1]), ...line, ex(line[line.length - 1], line[line.length - 2])]; L = len(line);
          }
          let width = -sp * Sm; for (const c of txt) width += adv(c) * Sm + sp * Sm;
          // the place with the fewest letters on something else; a range of over 1000 m is never left out for it
          let pick = null;
          for (const k of hand ? [0, 1.1, -1.1, 2.1, -2.1] : mid ? [1.25, -1.25, 2.2, -2.2, 0.2, 3.2, -3.2] : [0]) {
            const off = line.map(([x, y]) => [x + (nx / nl) * k * side * Sm, y + (ny / nl) * k * side * Sm]), g = [];
            let d = (L - width) / 2, hit = 0;
            for (const c of txt) { const w = adv(c) * Sm; if (c !== " ") { const q = at(off, d + w / 2), q0 = at(off, Math.max(0, d + w / 2 - Sm)), q1 = at(off, Math.min(L, d + w / 2 + Sm)); g.push({ c, q, rot: (Math.atan2(q1[1] - q0[1], q1[0] - q0[0]) * 180) / Math.PI }); if (obst.some((b) => q[0] > b[0] - Sm * 0.5 && q[0] < b[2] + Sm * 0.5 && q[1] > b[1] - Sm * 0.55 && q[1] < b[3] + Sm * 0.55)) hit++; } d += w + sp * Sm; }
            if (!pick || hit < pick.hit) pick = { g, hit };
            if (!hit) break;
          }
          if (pick.hit > (S >= 13.5 ? 4 : 2)) { if (t === name && abbr !== name) continue; return; }
          for (const { c, q, rot } of pick.g) { obst.push([q[0] - Sm * 0.5, q[1] - Sm * 0.55, q[0] + Sm * 0.5, q[1] + Sm * 0.55]); feats.push({ type: "Feature", properties: { ch: c, rot: +rot.toFixed(1), size: S, b: bi }, geometry: { type: "Point", coordinates: this.ll(q[0], q[1]) } }); }
          return;
        }
      };
      if (z0 < 6.9) { if (this.ranges.some((r) => r.id === "karkonosze")) put([[14.75, 50.86], [15.6, 50.74], [16.3, 50.58], [16.9, 50.3], [17.35, 50.08]].map(([lo, la]) => this.xy(lo, la)), "Sudety", 12, null); return; }
      for (const r of [...this.ranges].sort((p, q) => (q.top || 0) - (p.top || 0))) {
        if (z0 < 7.6 && (r.top || 0) < 1000) continue;
        const hand = RANGE_LINES[r.id];
        if (hand === null) continue;
        put(hand ? smooth(hand.map(([lo, la]) => this.xy(lo, la))) : r.axis, (r.short || r.label).split(" / ")[0], r.top >= 1300 ? 15 : r.top >= 1000 ? 13.5 : 12.5, r.mid, !!hand);
      }
    });
    src.setData({ type: "FeatureCollection", features: feats });
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
      "cities", "towns-big", ...part(/^place-(big|far):.*~top$/), ...part(/^station:/),
      "found-far", "found-mid-peak", "found-peak", "rpeaks", "liftst:1", ...part(/^poi-list:/),
      "found-mid", "found", ...part(/^poi-hut:/),
      "towns", ...part(/^place-(big|far):[^~]*$/), ...part(/^place:/),
      ...part(/^pass:/), ...part(/^parking:/), ...part(/^bus:/), "liftst:0",
      ...part(/^poi-far:/), ...part(/^poi:/),
      ...part(/^poi-minor-far:/), ...part(/^poi-minor:/), "found-minor", ...part(/^poi-shelter:/), ...part(/^poi-water:/), "found-water",
    ].filter((id) => map.getLayer(id));
    // the first under all the others, each next under the one before: from the bottom one up
    let above = null;
    for (const id of order) { if (above) map.moveLayer(id, above); else map.moveLayer(id); above = id; }
    // (moved to the top: the GPS dot and the plan's points stay over the names)
    for (const id of ["me", "me-acc", "plan-pts", "plan-pt"]) if (map.getLayer(id)) map.moveLayer(id);
  }
  /** The names' source and layers (once the peaks are in), a layer for each band of zoom; the plain ones hidden. */
  rangeNames() {
    const map = this.map;
    if (!map.getSource("rax")) {
      for (const id of ["ranges", "ranges-near"]) if (map.getLayer(id)) map.setLayoutProperty(id, "visibility", "none");
      map.addSource("rax", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
      RANGE_BANDS.forEach(([z0, z1], bi) => map.addLayer({ id: `rax-${bi}`, type: "symbol", source: "rax", minzoom: bi ? z0 : 0, maxzoom: z1, filter: ["==", ["get", "b"], bi],
        layout: { "text-field": ["get", "ch"], "text-font": ["literal", ["Liberation Serif Bold Italic"]], "text-rotate": ["get", "rot"], "text-rotation-alignment": "map", "text-allow-overlap": true, "text-ignore-placement": true, "text-padding": 0,
          "text-size": ["interpolate", ["exponential", 2], ["zoom"], z0, ["get", "size"], z1, ["*", ["get", "size"], 2 ** (z1 - z0)]] },
        paint: { "text-color": "#43290f", "text-halo-color": "rgba(252,249,241,.55)", "text-halo-width": 1, ...(bi === RANGE_BANDS.length - 1 ? { "text-opacity": ["interpolate", ["linear"], ["zoom"], z1 - 0.5, 1, z1, 0] } : {}) } }, map.getLayer("rpeaks") ? "rpeaks" : undefined));
    }
    this.rangeAxes();
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
    map.addLayer({ id: "mine-band", type: "line", source: "mine", layout: { "line-cap": "round", "line-join": "round" },
      // opaque, the trace's colour already mixed with a light green ground (was see-through: where two
      // stretches met or a line bent, the band showed twice as dark); stronger the more often
      paint: { "line-color": ["interpolate", ["linear"], n, ...[[1, 0.35], [3, 0.55], [6, 0.72], [12, 0.88]].flatMap(([k, a]) => [k, mix(this.trace, a)])], "line-opacity": ["interpolate", ["linear"], ["zoom"], 10.4, 0, 11.4, 1],
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
    map.addLayer({ id: "walk-glow", type: "line", source: "mine", maxzoom: 10.8, layout: lay, paint: { "line-color": "#7b4dff",
      "line-opacity": ["interpolate", ["linear"], ["zoom"], 5, ["interpolate", ["linear"], n, 1, 0.45, 4, 0.55, 10, 0.65], 9.8, ["interpolate", ["linear"], n, 1, 0.45, 4, 0.55, 10, 0.65], 10.8, 0], "line-blur": ["interpolate", ["linear"], ["zoom"], 6, 4, 10, 6], "line-width": ["interpolate", ["linear"], ["zoom"], 6, 12, 8, 16, 10, 20] } }, first);
    map.addLayer({ id: "walk-line", type: "line", source: "mine", maxzoom: 11.8, layout: lay, paint: { "line-color": "#5a22e0", "line-opacity": far(1), "line-width": Zw([1.6, 2.4, 3.2]) } }, first);
    // far out the walked bands are too thin to see: the network as green lines over the fog
    map.addLayer({ id: "mine-far", type: "line", source: "mine", maxzoom: 13.6, layout: { "line-cap": "round", "line-join": "round" },
      paint: { "line-color": "#2f6b4f", "line-opacity": ["interpolate", ["linear"], ["zoom"], 10.4, 0, 11.4, 0.9, 12.6, 0.9, 13.6, 0], "line-width": ["interpolate", ["linear"], ["zoom"], 8, 1.4, 11, 2, 13, 2.6] } }, first);
    // far out: the ranges' names and their highest peaks (as on tourist maps): a name big, spaced out,
    // in a serif italic, turned along the range (its main axis); the names never cross each other or a
    // town's (if one does not fit, it moves aside or is left out). Far out only the ranges with high
    // peaks (Karkonosze, not a foothill), the rest as you come closer; the peak's sign and height from
    // the regions' scale. Placed in this order: the cities, the far names, the peaks, the near names, the towns.
    map.addSource("ranges", { type: "geojson", data: { type: "FeatureCollection", features: this.rangeLabels() } });
    map.addSource("rpeaks", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
    const RZ = ["interpolate", ["linear"], ["zoom"], 6, ["case", [">=", ["get", "top"], 1300], 15, 13], 8.5, ["case", [">=", ["get", "top"], 1300], 21, 17], 10, ["case", [">=", ["get", "top"], 1300], 25, 20]];
    const rname = { "text-field": ["upcase", ["get", "n"]], "text-font": ["literal", ["Liberation Serif Italic"]], "text-size": RZ, "text-letter-spacing": ["interpolate", ["linear"], ["zoom"], 6, 0.28, 9, 0.42],
      "text-rotate": ["get", "rot"], "text-rotation-alignment": "map", "text-pitch-alignment": "viewport", "text-max-width": 30, "text-padding": 4,
      "text-variable-anchor": ["center", "top", "bottom"], "text-radial-offset": 1.2, "symbol-sort-key": ["-", 0, ["get", "top"]] };
    const rpaint = { "text-color": "#4a3019", "text-halo-color": "rgba(250,247,238,.9)", "text-halo-width": 1.8, "text-opacity": ["interpolate", ["linear"], ["zoom"], 9.9, 1, 10.8, 0] };
    map.addLayer({ id: "ranges-near", type: "symbol", source: "ranges", minzoom: 8, maxzoom: 10.8, layout: rname, paint: rpaint });
    if (!map.hasImage("rpeak")) {
      const k = 2, B = 14, c = new OffscreenCanvas(B * k, B * k), g = c.getContext("2d");
      g.scale(k, k); g.beginPath(); g.moveTo(7, 2.5); g.lineTo(12, 11); g.lineTo(2, 11); g.closePath(); g.fillStyle = PEAK_INK; g.fill(); g.lineWidth = 1.2; g.strokeStyle = "#fff"; g.stroke();
      map.addImage("rpeak", g.getImageData(0, 0, B * k, B * k), { pixelRatio: k });
    }
    map.addLayer({ id: "rpeaks", type: "symbol", source: "rpeaks", minzoom: 7.9, maxzoom: 10.8, filter: [">=", ["get", "e"], 700],
      layout: { "icon-image": "rpeak", "icon-anchor": "bottom", "text-field": ["format", ["get", "n"], { "text-font": ["literal", ["Noto Sans Bold"]] }, " ", {}, ["to-string", ["get", "e"]], { "text-font": ["literal", ["Noto Sans Regular"]], "font-scale": 0.92 }],
        "text-font": ["literal", ["Noto Sans Bold"]], "text-size": 12, "text-anchor": "top", "text-offset": [0, 0.15], "text-padding": 2, "symbol-sort-key": ["-", 0, ["get", "e"]] },
      paint: { "text-color": "#4b2f19", "text-halo-color": "rgba(250,248,242,.95)", "text-halo-width": 1.8, "text-opacity": 1 } }); // (full to its last zoom: faded, it still kept the near layer's own name of the peak away)
    map.addLayer({ id: "ranges", type: "symbol", source: "ranges", maxzoom: 8, filter: ["step", ["zoom"], [">=", ["get", "top"], 1000], 7.4, [">=", ["get", "top"], 900]], layout: rname, paint: rpaint });
    this.data.namesReady.then(() => { try { this.rangeTops(); if (this.liftSt) this.setLiftStations(this.liftSt); this.rangeNames(); } catch (e) { note(`pasma: ${e.message}`); } });
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
      paint: { "text-color": "#5d5a55", ...HALO } }, before); // (a peak reached: its triangle violet; the other places as the others)
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
    const cells = (this.walkedCells = new Set()), C = 40;
    for (const [, n, intervals, , flat] of agg) {
      const [xs, ys] = decodeLine(flat, sc);
      if (xs.length < 2) continue;
      for (let i = 1; i < xs.length; i++) { const L = Math.hypot(xs[i] - xs[i - 1], ys[i] - ys[i - 1]), k = Math.max(1, Math.ceil(L / 20)); for (let j = 0; j <= k; j++) cells.add(`${Math.floor((xs[i - 1] + ((xs[i] - xs[i - 1]) * j) / k) / C)},${Math.floor((ys[i - 1] + ((ys[i] - ys[i - 1]) * j) / k) / C)}`); }
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
    this.map?.getSource("found")?.setData({ type: "FeatureCollection", features: pts });
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
    for (const l of this.styleLayers(map)) if (l.id.startsWith("relief")) map.setLayoutProperty(l.id, "visibility", this.relief ? "visible" : "none");
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
  setLayers({ glow = true, icons = true, relief = false } = {}) { this.glow = glow; this.icons = icons; this.relief = relief; this.applyMode(); }
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
    let ix;
    try { ix = await (await fetch(packUrl(base, "index.json"))).json(); } catch (e) { note(`tło: ${e.message}`); return; }
    const P = ix.proj, ll = (x, y) => [P.lon0 + x / P.kx, P.lat0 - y / P.ky];
    const corners = ([x0, y0, x1, y1]) => [ll(x0, y0), ll(x1, y0), ll(x1, y1), ll(x0, y1)];
    const before = this.styleLayers(map).find((l) => l.id.startsWith("area-"))?.id;
    // far out the land; closer in it stays under the packs' own map, fainter (no blank paper between the packs)
    const far = (a, near, z1 = 9.2) => ["interpolate", ["linear"], ["zoom"], 5, a, z1, a, z1 + 1.2, near, 12, near, 13.5, 0];
    const put = (id, url, rect, op, near) => {
      if (map.getLayer(id)) map.removeLayer(id);
      if (map.getSource(id)) map.removeSource(id);
      map.addSource(id, { type: "image", url, coordinates: corners(rect) });
      map.addLayer({ id, type: "raster", source: id, maxzoom: 13.5, paint: { "raster-opacity": far(op, near, id === "tlo-relief" ? 8 : 9.2), "raster-fade-duration": 0, "raster-resampling": "linear" } }, before);
    };
    try {
      // the land and the relief pictures, made in a worker (bdworker.js): the page stays free
      const abs = (f) => new URL(packUrl(base, f), location.href).href;
      const pics = await new Promise((res, rej) => {
        const w = new Worker(new URL("./bdworker.js", import.meta.url), { type: "module" });
        w.onmessage = ({ data }) => { w.terminate(); if (data.error) rej(new Error(data.error)); else res(data); };
        w.onerror = (e) => { w.terminate(); rej(new Error(e.message || "worker")); };
        w.postMessage({ land: ix.landcover?.file && !ix.vector?.file ? abs(ix.landcover.file) : null, relief: ix.relief?.file ? abs(ix.relief.file) : null });
      });
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
        const under = this.styleLayers(map).find((l) => l.id.startsWith("area-"))?.id;
        // under the packs' own areas (their woods from the neighbourhood on: the same green)
        map.addLayer({ id: "tlo-forest", type: "fill", source: "tlo-v", "source-layer": "forest", paint: { "fill-color": "#c9e2ad" } }, under);
        if (map.getLayer("tlo-relief")) map.moveLayer("tlo-relief", under);
        map.addLayer({ id: "tlo-water", type: "fill", source: "tlo-v", "source-layer": "water", paint: { "fill-color": "#9fcbee" } }, under);
        map.addLayer({ id: "tlo-river", type: "line", source: "tlo-v", "source-layer": "river", maxzoom: 11, layout: { "line-cap": "round", "line-join": "round" },
          paint: { "line-color": "#86b6de", "line-width": Z(6, 0.6, 10, 1.4), "line-opacity": Z(6, 0.8, 10, 0.8, 11, 0) } }, under);
        // the border as on tourist maps: a wide soft band, a dark dash-dot line (over the land, under the roads);
        // closer in the packs' own border (the same look) takes over
        const top = this.styleLayers(map).find((l) => l.id.startsWith("road-minor-case"))?.id;
        map.addLayer({ id: "tlo-border-band", type: "line", source: "tlo-v", "source-layer": "border", maxzoom: 10.6, layout: { "line-join": "round" },
          paint: { "line-color": "#c6c7c1", "line-blur": 1.5, "line-width": Z(5, 7, 8, 10, 10.6, 9) } }, top); // (opaque: no darker blots where the line folds; soft edges)
        map.addLayer({ id: "tlo-border", type: "line", source: "tlo-v", "source-layer": "border", maxzoom: 10.6, layout: { "line-join": "round" },
          paint: { "line-color": "#3f3549", "line-width": Z(5, 2, 9, 3, 10.6, 2.6), "line-dasharray": [3.5, 1.6, 1, 1.6] } }, top);
        for (const l of this.styleLayers(map)) if (/^(border|border-band):/.test(l.id)) map.setLayerZoomRange(l.id, 10.6, 24);
        this.vecBackdrop = true;
      } catch (e) { note(`tło, wektor: ${e.message}`); }
    }
    // ---- names far out: the cities (a dot, the name moving round it to make room), the towns by size, the
    // mountain resorts closer in (the packs' own names from the neighbourhood on)
    let places = [];
    if (ix.places?.file) { try { places = await (await fetch(packUrl(base, ix.places.file))).json(); } catch { /* an older backdrop */ } }
    const popOf = new Map();
    for (const [n, , , , pop] of places) if (pop) popOf.set(n, Math.max(pop, popOf.get(n) || 0));
    const seen = new Set(TOWNS.map((t) => t[0]));
    const feats = TOWNS.map(([n, lon, lat, r]) => ({ type: "Feature", properties: { n, r, p: popOf.get(n) || (r === 1 ? 60000 : 3000) }, geometry: { type: "Point", coordinates: [lon, lat] } }));
    this.townsData = places;
    this.labelOrder();
    try { this.rangeLay(); } catch { /* (the names not in yet) */ }
    if (ix.bounds) this.bdBounds = ix.bounds; // (the search: towns, villages and stations also between the packs)
    for (const [n, lon, lat, p, pop] of places) if (p !== "station" && p !== "village" && !seen.has(n)) { seen.add(n); feats.push({ type: "Feature", properties: { n, r: 3, p: pop || (p === "city" ? 50000 : 3000) }, geometry: { type: "Point", coordinates: [lon, lat] } }); }
    for (const id of ["towns", "cities"]) if (map.getLayer(id)) map.removeLayer(id);
    if (map.getSource("towns")) map.removeSource("towns");
    map.addSource("towns", { type: "geojson", data: { type: "FeatureCollection", features: feats } });
    if (!map.hasImage("town-dot")) {
      const k = 2, B = 12, c = new OffscreenCanvas(B * k, B * k), g = c.getContext("2d");
      g.scale(k, k); g.beginPath(); g.arc(B / 2, B / 2, 3.6, 0, 7); g.fillStyle = "#fff"; g.fill(); g.lineWidth = 1.8; g.strokeStyle = "#1b1a19"; g.stroke();
      map.addImage("town-dot", g.getImageData(0, 0, B * k, B * k), { pixelRatio: k });
    }
    const pop = ["coalesce", ["get", "p"], 0], halo = { "text-halo-color": "rgba(250,248,242,.96)", "text-halo-width": 2 };
    // the towns (under the ranges' names and the peaks): by size as you come closer, the resorts (green) from the regions' scale
    const lowest = this.styleLayers(map).find((l) => l.id === "ranges-near")?.id;
    map.addLayer({ id: "towns", type: "symbol", source: "towns", maxzoom: 11.5,
      filter: ["all", ["<", pop, 60000], ["step", ["zoom"], false, 7.6, ["any", [">=", pop, 15000], ["==", ["get", "r"], 2]], 8.5, [">=", pop, 4000], 9.3, true]],
      layout: { "text-field": ["get", "n"], "text-font": ["literal", ["Noto Sans Bold"]], "text-size": ["interpolate", ["linear"], ["zoom"], 7.6, 12, 10, 14], "text-padding": 3, "text-max-width": 8,
        "symbol-sort-key": ["-", 0, pop] },
      paint: { "text-color": ["match", ["get", "r"], 2, "#1f4a36", "#3a3632"], ...halo } }, lowest);
    // the cities over everything far out (what you find your way by)
    map.addLayer({ id: "cities", type: "symbol", source: "towns", maxzoom: 11.5, filter: [">=", pop, 60000],
      layout: { "icon-image": ["step", ["zoom"], "town-dot", 9.6, ""], "text-field": ["get", "n"], "text-font": ["literal", ["Noto Sans Bold"]], "text-size": ["interpolate", ["linear"], ["zoom"], 6, 13.5, 9, 15.5, 11, 17],
        "text-variable-anchor": ["left", "right", "top", "bottom"], "text-radial-offset": 0.75, "text-padding": 3, "symbol-sort-key": ["-", 0, pop] },
      paint: { "text-color": "#1b1a19", ...halo } });
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
        map.addLayer({ id: "bw-rail", type: "line", source: "bways", minzoom: 8.4, maxzoom: 11.2, filter: ["==", k, "rail"], paint: { "line-color": "#77737a", "line-opacity": Z(8.4, 0, 8.9, 0.8, 10.6, 0.8, 11.2, 0), "line-width": Z(8.4, 0.7, 11, 1.3) } }, at);
        map.addLayer({ id: "bw-road-p", type: "line", source: "bways", minzoom: 7.4, maxzoom: 11.2, filter: ["==", k, "primary"], layout: { "line-cap": "round", "line-join": "round" },
          paint: { "line-color": "#f2cf62", "line-opacity": Z(7.4, 0, 7.9, 1, 10.6, 1, 11.2, 0), "line-width": Z(7.4, 0.8, 9, 1.6, 11, 2.2) } }, at);
        map.addLayer({ id: "bw-road-case", type: "line", source: "bways", maxzoom: 11.2, filter: ["in", k, ["literal", ["motorway", "trunk"]]], layout: { "line-cap": "round", "line-join": "round" },
          paint: { "line-color": "#ffffff", "line-opacity": Z(6, 1, 10.6, 1, 11.2, 0), "line-width": Z(6, 3, 9, 5, 11, 6.4) } }, at);
        map.addLayer({ id: "bw-road", type: "line", source: "bways", maxzoom: 11.2, filter: ["in", k, ["literal", ["motorway", "trunk"]]], layout: { "line-cap": "round", "line-join": "round" },
          paint: { "line-color": ["match", k, "motorway", "#e57a33", "#ee9c47"], "line-opacity": Z(6, 1, 10.6, 1, 11.2, 0), "line-width": Z(6, 1.6, 9, 3, 11, 3.8) } }, at);
        // the border over the roads (as on tourist maps: a road never cuts it)
        for (const id of ["tlo-border-band", "tlo-border"]) if (map.getLayer(id)) map.moveLayer(id, at);
      } catch (e) { note(`tło, drogi: ${e.message}`); }
    }
    this.backdrop = base;
  }
  scheduleOverview() { this.applyMode(); }
  renderOverview() {}

  // ---- camera: pack metres <-> lon/lat <-> screen (exact web mercator, as the GL map)

  // ---- friends (app/friends.js): who walked where, side by side in their colours where they share a way
  /** list: [{color, agg: [[key, intervals, geom]], found: [[id, n, e, x, y]]}] (you first) or null (off). */
  setGroup(list) {
    this.group = list || null; // ([] : nobody shown, e.g. you switched off to look at no one's or only friends')
    const map = this.map;
    if (!map) return;
    const sc = this.index.scale || 10, feats = [], peaks = [], who = new Map();
    if (this.group) {
      this.group.forEach((p, i) => { for (const [k] of p.agg) { if (!who.has(k)) who.set(k, []); who.get(k).push(i); } });
      this.group.forEach((p, i) => {
        // near: an opaque band in their colour under the trails, as my own band is (colour mixed with the ground)
        const band = mix(String(p.color).replace("#", "").match(/../g).map((h) => parseInt(h, 16)).join(","), 0.62);
        for (const [k, intervals, flat] of p.agg) {
          const [xs, ys] = decodeLine(flat, sc);
          if (xs.length < 2) continue;
          const n = xs.length, cum = new Float64Array(n);
          for (let j = 1; j < n; j++) cum[j] = cum[j - 1] + Math.hypot(xs[j] - xs[j - 1], ys[j] - ys[j - 1]);
          const L = cum[n - 1] || 1, ws = who.get(k), off = ws.indexOf(i) - (ws.length - 1) / 2;
          for (const [lo, hi] of intervals) {
            const a = lo * L < 30 ? 0 : lo * L, b = L - hi * L < 30 ? L : hi * L, at = (s2) => { let j = 1; while (j < n - 1 && cum[j] < s2) j++; const t = (s2 - cum[j - 1]) / ((cum[j] - cum[j - 1]) || 1); return this.ll(xs[j - 1] + t * (xs[j] - xs[j - 1]), ys[j - 1] + t * (ys[j] - ys[j - 1])); };
            const c = [at(a)]; for (let j = 1; j < n - 1; j++) if (cum[j] > a && cum[j] < b) c.push(this.ll(xs[j], ys[j])); c.push(at(b));
            feats.push({ type: "Feature", properties: { c: p.color, b: band, off, p: i }, geometry: { type: "LineString", coordinates: c } });
          }
        }
      });
      const tops = new Map();
      this.group.forEach((p, i) => { for (const [id, , , x, y] of p.found || []) { if (!tops.has(id)) tops.set(id, { x, y, cs: [] }); tops.get(id).cs.push(p.color); } });
      for (const t of tops.values()) peaks.push({ type: "Feature", properties: { icon: `gdots:${t.cs.join(",")}` }, geometry: { type: "Point", coordinates: this.ll(t.x, t.y) } });
    }
    const fc = (f) => ({ type: "FeatureCollection", features: f });
    if (!map.getSource("group")) {
      map.addSource("group", { type: "geojson", data: fc(feats) });
      map.addSource("group-tops", { type: "geojson", data: fc(peaks) });
      const first = map.getStyle().layers.find((l) => l.type === "symbol")?.id, lay = { "line-cap": "round", "line-join": "round" };
      // far out: a wide soft band each (side by side), fading in closer; then the lines, side by side on a shared way
      map.addLayer({ id: "group-glow", type: "line", source: "group", maxzoom: 11.2, layout: lay, paint: { "line-color": ["get", "c"], "line-blur": 5,
        "line-width": ["interpolate", ["linear"], ["zoom"], 8, 10, 10, 14], "line-opacity": ["interpolate", ["linear"], ["zoom"], 8, 0.55, 10.4, 0.55, 11.2, 0],
        "line-offset": ["interpolate", ["linear"], ["zoom"], 8, ["*", ["get", "off"], 6], 11, ["*", ["get", "off"], 9]] } }, first);
      // near: bands side by side under the trails, like my own band (each a bit narrower, so 4 still fit)
      const trailTop = this.styleLayers(map).find((l) => l.id.startsWith("trail-0"))?.id, W = [11, 4, 13, 7, 15, 10, 17, 14];
      const wz = (k = 1) => ["interpolate", ["linear"], ["zoom"], ...W.flatMap((v, j) => (j % 2 ? [k === 1 ? v : ["*", ["get", "off"], v]] : [v]))];
      map.addLayer({ id: "group-line", type: "line", source: "group", minzoom: 10.2, layout: lay, paint: { "line-color": ["get", "b"],
        "line-opacity": ["interpolate", ["linear"], ["zoom"], 10.4, 0, 11.2, 1], "line-width": wz(), "line-offset": wz(0) } }, trailTop || first);
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
      if (this.group[f.properties.p]?.me) continue;
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
    return new Set(this.map.queryRenderedFeatures([[p.x - r, p.y - r], [p.x + r, p.y + r]], { layers: ["group-line"] }).map((f) => f.properties.p));
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
  /**
   * Smoothness test (Diagnostyka): at each zoom (GL zoom levels) the map goes round a small circle here,
   * a few seconds for each variant with a group of layers off; the frames' spacing for each. Everything
   * is put back. progress(text) while it runs. -> [{zoom, name, n, mean, p90, slow}] (ms; slow: share over 17 ms).
   */
  /** The smoothness test (Diagnostyka); the automatic sharpness waits meanwhile. */
  async bench(...a) { this.benching = true; try { return await this.benchRun(...a); } finally { this.benching = false; } }
  async benchRun(progress = () => {}, zooms = [9.5, 11, 12.5, 14]) {
    const m = this.map;
    if (!m || !this.ready) return [];
    const all = this.styleLayers(), vis0 = new Map(all.map((l) => [l.id, m.getLayoutProperty(l.id, "visibility") ?? "visible"]));
    const partOf = (id) => { const k = id.split(":").pop(); return this.parts.some((p) => p.id === k) ? k : null; };
    // the parts on the screen (with a margin): their tiles' boxes against the view's
    const boxes = new Map();
    for (const t of this.index.tiles) {
      const id = `${t.pack}-${t.grp || t.pack}`.replace(/[^\w-]/g, "_"), e = t.ext || t.cell, b = boxes.get(id);
      boxes.set(id, b ? [Math.min(b[0], e[0]), Math.min(b[1], e[1]), Math.max(b[2], e[2]), Math.max(b[3], e[3])] : [...e]);
    }
    const onScreenNow = () => {
      const c = [[0, 0], [this.W, 0], [0, this.H], [this.W, this.H]].map(([x, y]) => this.toWorld(x, y)), mg = 2000;
      const vb = [Math.min(...c.map((q) => q[0])) - mg, Math.min(...c.map((q) => q[1])) - mg, Math.max(...c.map((q) => q[0])) + mg, Math.max(...c.map((q) => q[1])) + mg];
      return new Set([...boxes].filter(([, b]) => !(b[2] < vb[0] || b[0] > vb[2] || b[3] < vb[1] || b[1] > vb[3])).map(([k]) => k));
    };
    let onScreen = new Set();
    const mine = /^(mine-|walk-|found)/, tlo = /^(tlo-|bw-|towns$|cities$)/;
    const V = [
      ["wszystko", () => false],
      ["bez podpisów i znaków", (l) => l.type === "symbol"],
      ["bez Twoich śladów", (l) => mine.test(l.id)],
      ["bez tła wokół map", (l) => tlo.test(l.id)],
      [() => `bez części spoza ekranu (zostaje ${onScreen.size} z ${this.parts.length})`, (l) => { const p = partOf(l.id); return p && !onScreen.has(p); }],
      ["bez linii mapy (drogi, szlaki, poziomice)", (l) => l.type === "line" && !!partOf(l.id)],
      ["bez wypełnień i rzeźby", (l) => l.type === "fill" || l.type === "raster"],
      ["rozdzielczość 1,75×", () => false, 1.75],
      ["rozdzielczość 1,5×", () => false, 1.5],
      ["rozdzielczość 1×", () => false, 1],
      ["pusta mapa (sam papier)", (l) => l.id !== "paper", "empty"],
      ["bez nakładki 2D", () => false, "ov"],
      ["bez mgły", () => false, "fog"],
    ];
    // always at the same spot (results compare from test to test): Andrzejówka (Góry Suche: the trails,
    // the walked ones, a hut, the relief); where it is not on the map, here
    const AT = [16.2778, 50.685], ax = (AT[0] - this.P.lon0) * this.P.kx, ay = (this.P.lat0 - AT[1]) * this.P.ky;
    const atHut = this.index.tiles.some((t) => { const e = t.ext || t.cell; return ax >= e[0] && ax <= e[2] && ay >= e[1] && ay <= e[3]; });
    const keep = { s: this.s, ox: this.ox, oy: this.oy, rot: this.rot }, [cx, cy] = atHut ? [ax, ay] : this.centre(), out = [];
    this.benchAt = atHut ? "Andrzejówka" : "bieżący widok";
    let s0 = keep.s;
    // the map's work per frame: the page's (its draw call, ms) and, where the phone tells, the GPU's
    // (EXT_disjoint_timer_query_webgl2): what the frame costs whatever the screen's rate
    const gl = m.painter?.context?.gl, tq = gl?.getExtension("EXT_disjoint_timer_query_webgl2");
    this.benchGpu = !!tq;
    const run = (ms) => new Promise((done) => {
      const dts = [], cpu = [], gpu = [], qs = [], t0 = performance.now(); let last = t0, on = false;
      const r0 = m._render;
      m._render = (...a) => {
        const st = performance.now(); let q = null;
        if (tq && on) { q = gl.createQuery(); gl.beginQuery(tq.TIME_ELAPSED_EXT, q); }
        try { return r0.apply(m, a); } finally {
          if (q) { gl.endQuery(tq.TIME_ELAPSED_EXT); qs.push(q); }
          if (on) cpu.push(performance.now() - st);
        }
      };
      const poll = () => {
        while (qs.length && gl.getQueryParameter(qs[0], gl.QUERY_RESULT_AVAILABLE)) {
          const q = qs.shift(), ns = gl.getQueryParameter(q, gl.QUERY_RESULT);
          if (!gl.getParameter(tq.GPU_DISJOINT_EXT)) gpu.push(ns / 1e6);
          gl.deleteQuery(q);
        }
      };
      const f = (now) => {
        const t = now - t0, a = (t / 2000) * 2 * Math.PI;
        this.s = s0; this.rot = keep.rot; this.anchor(cx, cy, this.W / 2 + 110 * Math.cos(a), this.H / 2 + 110 * Math.sin(a));
        if (!this.sync()) this.ov.draw();
        on = t > 500; // (the first moment: tiles and the like settle)
        if (on && now - last < 500) dts.push(now - last); // (a pause: the screen off, the app in the background)
        last = now;
        if (tq) poll();
        if (t < ms) requestAnimationFrame(f);
        else { m._render = r0; setTimeout(() => { if (tq) { poll(); for (const q of qs) gl.deleteQuery(q); } done({ dts, cpu, gpu }); }, 120); }
      };
      requestAnimationFrame(f);
    });
    try {
      const fogOn = this.fog?.on;
      let k = 0;
      for (const z of zooms) {
        // the zoom: s scaled to it, the middle kept
        this.s = keep.s; this.rot = keep.rot; this.anchor(cx, cy, this.W / 2, this.H / 2); this.sync();
        s0 = keep.s * 2 ** (z - this.map.getZoom()); this.s = s0; this.anchor(cx, cy, this.W / 2, this.H / 2); this.sync();
        onScreen = onScreenNow();
        for (const [nm, off, how] of V) {
        if (how === "fog" && !(fogOn && this.fog.strength() > 0)) continue;
        const name = typeof nm === "function" ? nm() : nm;
        progress(`${++k}: z ${z}, ${name}`);
        for (const l of all) m.setLayoutProperty(l.id, "visibility", off(l) ? "none" : vis0.get(l.id));
        if (typeof how === "number") m.setPixelRatio(Math.min(how, this.dpr));
        if (how === "empty") this.screen.style.visibility = "hidden";
        if (how === "ov") this.screen.style.visibility = "hidden";
        if (how === "fog" || how === "empty") this.fog.on = false;
        await this.settled({ ms: 4000 });
        const r = await run(2600), st = (a) => { a.sort((x, y) => x - y); return a.length ? { mean: +(a.reduce((t, x) => t + x, 0) / a.length).toFixed(1), p90: +a[Math.floor(a.length * 0.9)].toFixed(1) } : null; };
        const med = r.dts.length ? [...r.dts].sort((x, y) => x - y)[r.dts.length >> 1] : 16.7, hz = med < 12 ? 120 : 60, period = 1000 / hz;
        const fr = st(r.dts) || { mean: 0, p90: 0 };
        out.push({ zoom: z, name, n: r.dts.length, hz, mean: fr.mean, p90: Math.round(fr.p90), slow: Math.round((100 * r.dts.filter((x) => x > period * 1.5).length) / Math.max(1, r.dts.length)), cpu: st(r.cpu), gpu: st(r.gpu) });
        if (typeof how === "number") m.setPixelRatio(this.dpr);
        if (how === "empty") this.screen.style.visibility = "";
        if (how === "ov") this.screen.style.visibility = "";
        if (how === "fog" || how === "empty") this.fog.on = fogOn;
        }
      }
    } finally {
      for (const l of all) if (m.getLayer(l.id)) m.setLayoutProperty(l.id, "visibility", vis0.get(l.id));
      m.setPixelRatio(this.dpr); this.screen.style.visibility = "";
      Object.assign(this, keep); this.camKey = ""; this.draw();
    }
    return out;
  }

  /** The map glides on after a flick (vx, vy: px/ms) and slows down, as on other maps; false: too slow. */
  fling(vx, vy) {
    const v = Math.hypot(vx, vy), MAX = 5;
    if (v < 0.3) return false;
    if (v > MAX) { vx *= MAX / v; vy *= MAX / v; }
    cancelAnimationFrame(this.settling);
    const TAU = 330, t0 = performance.now();
    let done = 0;
    const go = (now) => {
      const t = now - t0, d = TAU * (1 - Math.exp(-t / TAU)), dd = d - done; // how far by now, of v·TAU in all
      done = d;
      this.pan(vx * dd, vy * dd);
      const left = Math.hypot(vx, vy) * Math.exp(-t / TAU);
      if (left > 0.02 && this.overshoot() < 60) { this.step(); this.settling = requestAnimationFrame(go); }
      else { this.settling = 0; if (!this.settle()) this.draw(); }
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
      const lay = (pk) => ({ "icon-image": ["concat", "lift-", ["get", "end"]], "icon-size": PLATE, "icon-anchor": "center", "icon-offset": [2, 2], "icon-allow-overlap": true, "icon-ignore-placement": !pk,
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
      map.addLayer({ id: "plan-band", type: "line", source: "plan", layout: lay, paint: { "line-color": Z([[11, PLAN_FAR], [12.6, PLAN_BAND]]), "line-width": W } }, under);
      map.addLayer({ id: "plan-done", type: "line", source: "plandone", layout: lay, paint: { "line-color": "#dcd9d2", "line-width": W } }, under);
      // closed on the day you go: a red highlighter over the route and your traces, under the trails' colours
      map.addLayer({ id: "plan-closed", type: "line", source: "planclosed", layout: lay, paint: { "line-color": "#ef6a5f", "line-width": W } }, under);
      // off the trails (a path, a road): round dots in a deep amber, nothing like a trail's dashes; no way in the map: red dots
      map.addLayer({ id: "plan-off", type: "line", source: "plan", layout: lay, filter: ["all", ["!", ["get", "cols"]], ["!=", ["get", "cat"], -1]], paint: { "line-color": "#a85f0c", "line-width": Z([[11, 2.4], [14, 3.4], [16, 4.4]]), "line-dasharray": [0.01, 1.9] } }, sym);
      map.addLayer({ id: "plan-none", type: "line", source: "plan", layout: lay, filter: ["==", ["get", "cat"], -1], paint: { "line-color": "#b3261e", "line-width": 2, "line-dasharray": [1, 2.5] } }, sym);
      this.stackPlan();
    }
    const P = this.ov.plan, live = !!P?.live, line = (f) => Array.from({ length: f.length / 2 }, (_, i) => this.ll(f[2 * i], f[2 * i + 1]));
    map.getSource("plan").setData({ type: "FeatureCollection", features: (P?.runs || []).map((r) => ({ type: "Feature", properties: { cols: r.cols.length > 0, cat: r.cat }, geometry: { type: "LineString", coordinates: line(r.line) } })) });
    map.getSource("plandone").setData({ type: "FeatureCollection", features: P?.done?.length >= 4 ? [{ type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: line(P.done) } }] : [] });
    map.getSource("planclosed").setData({ type: "FeatureCollection", features: (P?.closed || []).map((f) => ({ type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: line(f) } })) });
    map.getSource("saved").setData({ type: "FeatureCollection", features: (this.ov.saved || []).filter((f) => f?.length >= 4).map((f) => ({ type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: line(f) } })) });
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
  routeSplit(parts) {
    const map = this.map;
    if (!map) return [];
    if (!map.getSource("rsplit")) {
      map.addSource("rsplit", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
      const at = this.styleLayers(map).find((l) => l.type === "symbol")?.id;
      map.addLayer({ id: "rsplit-miss-case", type: "line", source: "rsplit", filter: ["==", ["get", "w"], 0], layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": "#fff", "line-opacity": 0.9, "line-width": ["interpolate", ["linear"], ["zoom"], 6, 3, 12, 7] } }, at);
      map.addLayer({ id: "rsplit-miss", type: "line", source: "rsplit", filter: ["==", ["get", "w"], 0], paint: { "line-color": "#6d6a75", "line-width": ["interpolate", ["linear"], ["zoom"], 6, 1.6, 12, 3.4], "line-dasharray": [2, 1.6] } }, at);
      map.addLayer({ id: "rsplit-done", type: "line", source: "rsplit", filter: ["==", ["get", "w"], 1], layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": "#5b2bd1", "line-width": ["interpolate", ["linear"], ["zoom"], 6, 2.6, 12, 5] } }, at);
    }
    const src = map.getSource("rsplit");
    if (!parts) { src.setData({ type: "FeatureCollection", features: [] }); return []; }
    const cells = this.walkedCells || new Set(), C = 40;
    const near = (x, y) => { const cx = Math.floor(x / C), cy = Math.floor(y / C); for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) if (cells.has(`${cx + i},${cy + j}`)) return true; return false; };
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
    return Promise.resolve({ gpu, zoom: m ? +m.getZoom().toFixed(2) : null, tiles, parts: this.parts?.length ?? 0, discs: this.revealN || 0, fogDiscs: this.fog?.n ?? null, fogMasks: this.fog?.drawn ?? null, mine: this.mineN ?? null, errs: this.errs || 0, drawn });
  }

}

export { PAPER };
