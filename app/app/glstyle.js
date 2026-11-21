// The map's style for MapLibre GL (the modern look of the old canvas map): one vector source and one
// relief source per downloaded part of a pack (g/<part>.pmtiles, g/<part>-relief.pmtiles), their
// layers interleaved by kind (all parts' forests, then all relief, then all roads, ...) so parts meet
// without seams. What is mine (walked, found) comes by feature state:
//   poi {d: reached}
// Zooms: MapLibre z ~ the old map's zl + 5.65 (at 50° N).

export const TC = { red: "#d0202a", blue: "#2160c8", green: "#16903c", yellow: "#e0b800", black: "#1a1a1a" };
/** The map's one look (no themes laid over it): every colour of the land, lines and names in one place.
 * Calm and plain: the shape of the ground (relief from afar, contours close in), the trails in their colours, the names
 * by weight (towns bold, villages and peaks regular, the booklets' summits and huts bold), neutral roads and borders
 * (violet is yours, amber the plan's: neither is used by the map itself). */
export const INK = {
  paper: "#f5f3ed", paperFar: "#f2f1eb", halo: "rgba(245,243,237,.92)",
  text: "#2f2a24", soft: "#57504a", ele: "#62594f", place: "#1f1d1a", village: "#45413b", nature: "#86705a", lake: "#3c76a8",
  contour: "#a58c70", contourIdx: "#937759", water: "#5d98c9", waterFar: "#9ec2df",
  roadCase: "#cbc3b6", motorwayCase: "#968e82", rail: "#4a474e", border: "#6c6670", boundary: "#8d8592",
  lift: "#4a4a50", path: "#5b544b", track: "#8c7558", cliff: "#5e5045",
};
/** The marked trails' colours on the map (full, as the signs on the trees). */
export const TRAIL = { red: "#d7191f", blue: "#1660d0", green: "#11903f", yellow: "#f0c000", black: "#1b1b1b" };
export const PAPER = INK.paper;
/** Educational paths: their own colour on the map (and in the legend). */
export const EDU = "#0e9fb3";
// (above the forest: dwarf pine and other scrub, bare rock, scree and boulder fields; water last)
export const FILL = { meadow: "#eff1e2", forest: "#d1e2bc", residential: "#ebe5dc", scrub: "#dbe6ca", bare: "#e8e4dc", scree: "#edeae3", water: "#b7d4ea" };
export const FONTS = { r: ["Noto Sans Regular"], b: ["Noto Sans Bold"], i: ["Noto Sans Italic"] };

/** zoom stops [[z, v], ...] as an interpolate expression */
export const Z = (stops) => ["interpolate", ["linear"], ["zoom"], ...stops.flat()];
/** A trail's i-th colour (its cols: "red,blue") from a palette (pal: {red, blue, green, yellow, black}; the map's own
 * by default), black and anything else as given: one expression for the 2D map, its themes and the 3D views. */
export const trailColor = (i = 0, { pal = TC, black = pal.black, other = "#777", key = "cols" } = {}) => ["match", ["at", i, ["split", ["get", key], ","]], "red", pal.red, "blue", pal.blue, "green", pal.green, "yellow", pal.yellow, "black", black, other];
/** One layer for several kinds (fewer layers: each part's tiles are laid out once per layer): per kind its own
 * zoom stops, as one zoom interpolation with a match at each stop. key: an expression giving the kind (a string);
 * table: {kind: [[z, v], ...] or a constant}; numbers interpolate between stops, colours too. */
export function zMatch(key, table, fallback) {
  const at = (st, z) => {
    if (!Array.isArray(st)) return st;
    if (z <= st[0][0]) return st[0][1];
    for (let i = 1; i < st.length; i++) if (z <= st[i][0]) { const [z0, a] = st[i - 1], [z1, b] = st[i]; return typeof a === "number" ? a + ((b - a) * (z - z0)) / (z1 - z0) : z - z0 < z1 - z ? a : b; }
    return st.at(-1)[1];
  };
  const zs = [...new Set(Object.values(table).flatMap((st) => (Array.isArray(st) ? st.map((q) => q[0]) : [])))].sort((a, b) => a - b);
  const m = (z) => ["match", key, ...Object.entries(table).flatMap(([k, st]) => [k, at(st, z)]), fallback ?? at(Object.values(table)[0], z)];
  if (!zs.length) return m(0);
  return zs.length === 1 ? m(zs[0]) : ["interpolate", ["linear"], ["zoom"], ...zs.flatMap((z) => [z, m(z)])];
}
const C_ = ["get", "c"], CLS = ["to-string", ["get", "cls"]], MAJOR = ["to-string", ["coalesce", ["get", "major"], false]];

/** Sources for the parts: [{id, url, relief}] (url: pmtiles://...). */
export function sources(parts) {
  const out = {};
  for (const p of parts) {
    const promoteId = { trail: "k", path: "k", road: "k", poi: "id" };
    // (a pack as one map: its tiles from the parts on the phone, glmap.js PackRouter)
    out[`v:${p.id}`] = p.tiles ? { type: "vector", tiles: p.tiles, minzoom: p.minzoom, maxzoom: p.maxzoom, bounds: p.bounds, promoteId } : { type: "vector", url: p.url, promoteId };
    if (p.reliefTiles) out[`r:${p.id}`] = { type: "raster", tiles: p.reliefTiles, minzoom: p.reliefMin, maxzoom: p.reliefMax, bounds: p.reliefBounds, tileSize: 256 };
    else if (p.relief) out[`r:${p.id}`] = { type: "raster", url: p.relief, tileSize: 256 };
  }
  return out;
}

/** The layers, every kind for every part (ids "<kind>:<part>"). opts: {accent: "r,g,b"} */
export function layers(parts, opts = {}) {
  // far out a paler, cooler paper (Poświata: the land quiet, the walked trails carry the colour)
  const L = [{ id: "paper", type: "background", paint: { "background-color": Z([[8.4, INK.paperFar], [10.2, INK.paper]]) } }];
  const each = (kind, make) => { for (const p of parts) { const l = make(p); if (l) L.push({ ...l, id: `${kind}:${p.id}` }); } };
  const v = (p, layer, extra) => ({ source: `v:${p.id}`, "source-layer": layer, ...extra });

  // ---- ground
  // the packs' areas from the neighbourhood on (far out the backdrop's smooth forests are the land; water always)
  // (one layer, the kinds in FILL's order by fill-sort-key: water over the forest round it; far out water only)
  const KINDS = Object.keys(FILL);
  each("area", (p) => v(p, "area", { type: "fill", filter: ["step", ["zoom"], ["==", C_, "water"], 8.8, ["in", C_, ["literal", KINDS]]],
    layout: { "fill-sort-key": ["match", C_, ...KINDS.flatMap((c, i) => [c, i]), 0] },
    paint: { "fill-color": Z([[9.4, ["match", C_, "forest", FILL.forest, ...KINDS.filter((c) => c !== "forest").flatMap((c) => [c, FILL[c]]), "#000"]], [10.6, ["match", C_, ...KINDS.flatMap((c) => [c, FILL[c]]), "#000"]]]), "fill-antialias": true, "fill-opacity": zMatch(C_, Object.fromEntries(KINDS.map((c) => [c, c === "water" ? 1 : [[8.8, 0], [9.8, 1]]])), 1) } }));
  // their texture close in, as on paper atlases: dwarf pine as little rings, scree as stones, rock hatched
  each("area-pat", (p) => v(p, "area", { type: "fill", minzoom: 12.4, filter: ["step", ["zoom"], ["==", C_, "scrub"], 12.8, ["in", C_, ["literal", ["scrub", "scree", "bare"]]]],
    paint: { "fill-pattern": ["match", C_, "scrub", "pat-scrub", "scree", "pat-scree", "pat-bare"], "fill-opacity": zMatch(C_, { scrub: [[12.4, 0], [13.2, 1]], scree: [[12.8, 0], [13.6, 1]], bare: [[12.8, 0], [13.6, 1]] }) } }));
  // the relief: the ranges and valleys from afar, soft (shadows lifted, little colour); it gives way to the contours
  // close in, gone by z 14.5 (its z 11 tiles blown up looked like plastic bumps; the canopy in the model, like bubbles)
  // (a pack whose relief has z 12 tiles is made from the LiDAR terrain model, the ground under the trees: sharp
  // and smooth, it stays close in, lighter)
  const sharp = (p) => (p.reliefMax ?? 11) >= 12;
  each("relief", (p) => (p.relief ? { type: "raster", source: `r:${p.id}`, minzoom: 8.3, maxzoom: sharp(p) ? 16.6 : 14.5,
    paint: { "raster-opacity": sharp(p) ? Z([[8.3, 0], [9.4, 0.42], [11.6, 0.42], [13.5, 0.34], [16.5, 0.22]]) : Z([[8.3, 0], [9.4, 0.42], [11.6, 0.42], [13, 0.22], [14.5, 0]]), "raster-brightness-min": 0.3, "raster-saturation": -0.2, "raster-resampling": "linear", "raster-fade-duration": 0 } } : null));
  // contours: brown-grey as on tourist maps, light enough that steep ground (the Tatras) stays readable;
  // every 100 m from the middle zooms, 50 m closer, 10 m only right close in
  // (one layer: every 100 m from z 10.6, 50 m from 12, 10 m from 13)
  each("contour", (p) => v(p, "contour", { type: "line", minzoom: 10.6, filter: ["step", ["zoom"], ["==", ["get", "cls"], 100], 12, ["in", ["get", "cls"], ["literal", [50, 100]]], 13, true],
    paint: { "line-color": ["match", CLS, "100", INK.contourIdx, INK.contour],
      "line-opacity": zMatch(CLS, { 10: [[13, 0], [13.6, 0.36], [15.4, 0.5]], 50: [[12, 0.34], [13.5, 0.56]], 100: [[10.6, 0.32], [12, 0.55], [14, 0.85]] }),
      "line-width": zMatch(CLS, { 10: [[13, 0.4], [16.6, 0.75]], 50: [[12, 0.45], [13, 0.55], [16.6, 0.85]], 100: [[10.6, 0.5], [12.6, 0.8], [14.6, 1.2], [16.6, 1.6]] }) } }));
  // waters
  // (one layer: rivers always, streams from z 12)
  each("waterline", (p) => v(p, "water", { type: "line", filter: ["step", ["zoom"], ["==", C_, "river"], 12, ["in", C_, ["literal", ["river", "stream"]]]],
    paint: { "line-color": Z([[8, ["match", C_, "stream", INK.water, INK.waterFar]], [10.6, INK.water]]),
      "line-width": zMatch(C_, { stream: [[12, 0.6], [14.6, 1.2], [16.6, 1.9]], river: [[7.6, 0.6], [10.6, 1], [13.6, 2.2], [16.6, 3.6]] }) } }));
  // borders: a soft grey band (never violet: that is yours) with a dark dash-dot line between countries (as on tourist maps), a dashed line between regions
  // (far out stronger: the border is what tells the countries apart there)
  each("border-band", (p) => v(p, "water", { type: "line", filter: ["==", ["get", "c"], "border"], paint: { "line-color": "rgba(108,102,112,.15)", "line-width": Z([[5, 9], [8, 12], [10.6, 8], [13.6, 9], [16.6, 12]]) } })); // (grey: a violet-grey band read as your traces)
  each("border", (p) => v(p, "water", { type: "line", filter: ["==", ["get", "c"], "border"], paint: { "line-color": INK.border, "line-opacity": 0.9, "line-width": Z([[5, 1.4], [9, 2], [10.6, 1.6], [13.6, 1.8], [16.6, 2.4]]), "line-dasharray": [3.5, 1.6, 1, 1.6] } }));
  each("boundary", (p) => v(p, "water", { type: "line", minzoom: 8.6, filter: ["==", ["get", "c"], "boundary"], paint: { "line-color": INK.boundary, "line-opacity": Z([[8.6, 0.35], [10.6, 0.7]]), "line-width": Z([[8.6, 1], [13.6, 1.6]]), "line-dasharray": [4, 3] } }));

  // ---- roads, rails, paths
  // (two layers: all the casings, then all the roads; the main roads over the local ones: line-sort-key)
  const RL = { "line-cap": "round", "line-join": "round", "line-sort-key": ["case", ["coalesce", ["get", "major"], false], 1, 0] };
  each("road-case", (p) => v(p, "road", { type: "line", minzoom: 8.8, filter: ["step", ["zoom"], ["coalesce", ["get", "major"], false], 11.6, true], layout: RL,
    paint: { "line-color": zMatch(MAJOR, { true: [[8.8, "#ddd6ca"], [10.6, "#c2b9aa"], [12, "#aaa091"]], false: INK.roadCase }), "line-width": zMatch(MAJOR, { true: [[8.8, 0.7], [10.6, 1.9], [13.6, 4.6], [16.6, 8.2]], false: [[11.6, 2.2], [13.6, 3.8], [16.6, 6.2]] }) } }));
  each("road", (p) => v(p, "road", { type: "line", minzoom: 9.5, filter: ["step", ["zoom"], ["coalesce", ["get", "major"], false], 11.6, true], layout: RL,
    paint: { "line-color": "#ffffff", "line-width": zMatch(MAJOR, { true: [[9.5, 0.8], [10.6, 1.4], [13.6, 3.4], [16.6, 7]], false: [[11.6, 1], [13.6, 2.6], [16.6, 5]] }) } }));
  // expressways (not walked: drawn only): a heavy warm line with a white edge, under the railways
  each("motorway-case", (p) => v(p, "water", { type: "line", minzoom: 9.5, filter: ["==", ["get", "c"], "motorway"], layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": INK.motorwayCase, "line-width": Z([[9.5, 4.2], [13.6, 7.2], [16.6, 10.6]]) } }));
  each("motorway", (p) => v(p, "water", { type: "line", minzoom: 9.5, filter: ["==", ["get", "c"], "motorway"], layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": "#ffffff", "line-width": Z([[9.5, 2.4], [13.6, 4.6], [16.6, 7.8]]) } }));
  // railways from the neighbourhood's scale (a few km to the inch): stations are where trips start
  each("rail-case", (p) => v(p, "water", { type: "line", minzoom: 9, filter: ["==", ["get", "c"], "rail"], paint: { "line-color": ["interpolate", ["linear"], ["zoom"], 10.2, "#9a97a0", 11.6, INK.rail], "line-width": Z([[9, 0.9], [10.6, 1.8], [13.6, 4.2], [16.6, 5.8]]) } })); // (far out a light grey thread: not heavier than the roads)
  each("rail", (p) => v(p, "water", { type: "line", minzoom: 10.2, filter: ["==", ["get", "c"], "rail"], paint: { "line-color": INK.paper, "line-width": Z([[10.2, 0.8], [13.6, 2.6], [16.6, 4.2]]), "line-dasharray": [4, 4] } }));
  // aerial lifts, as on paper maps: a thin graphite line with short cross ticks; cable cars and gondolas
  // from the middle zooms, chair lifts closer, ski tows only close in and paler
  const LIFT = { lift_main: [11, 1.5, 5.5, 1], lift_chair: [12, 1.1, 4.4, 0.9], lift_drag: [14, 0.9, 3.4, 0.6] }, LK = Object.keys(LIFT);
  // (two layers: the ropes, the ticks; each kind from its own zoom)
  const liftsFrom = (dz) => ["step", ["zoom"], ["==", C_, "lift_main"], 12 + dz, ["in", C_, ["literal", ["lift_main", "lift_chair"]]], 14 + dz, ["in", C_, ["literal", LK]]];
  each("lift", (p) => v(p, "water", { type: "line", minzoom: 11, filter: liftsFrom(0),
    paint: { "line-color": INK.lift, "line-opacity": ["match", C_, ...LK.flatMap((c) => [c, LIFT[c][3]]), 1], "line-width": zMatch(C_, Object.fromEntries(LK.map((c) => [c, [[LIFT[c][0], LIFT[c][1] * 0.8], [15, LIFT[c][1] * 1.3]]]))) } }));
  each("lift-tick", (p) => v(p, "water", { type: "line", minzoom: 11.6, filter: liftsFrom(0.6),
    paint: { "line-color": INK.lift, "line-opacity": ["match", C_, ...LK.flatMap((c) => [c, LIFT[c][3]]), 1], "line-width": ["match", C_, ...LK.flatMap((c) => [c, LIFT[c][2]]), 4], "line-dasharray": [0.22, 7] } }));
  // rock walls (OSM: the top on the left): a dark line, its teeth hanging down the right side, close in
  each("cliff", (p) => v(p, "water", { type: "line", minzoom: 12, filter: ["==", ["get", "c"], "cliff"], layout: { "line-join": "round" }, paint: { "line-color": INK.cliff, "line-opacity": Z([[12, 0.5], [13, 0.9]]), "line-width": Z([[12, 0.7], [16.6, 1.6]]) } }));
  each("cliff-teeth", (p) => v(p, "water", { type: "line", minzoom: 13, filter: ["==", ["get", "c"], "cliff"], paint: { "line-color": INK.cliff, "line-opacity": Z([[13, 0], [13.6, 0.8]]), "line-width": Z([[13, 2.6], [16.6, 5]]), "line-offset": Z([[13, 1.4], [16.6, 2.6]]), "line-dasharray": [0.2, 1.7] } }));
  // tracks and paths: from the middle zooms (the trails and the relief first)
  // (from z 13.2, faint and thin at first: what else goes there is seen a little earlier when planning)
  each("track", (p) => v(p, "path", { type: "line", minzoom: 13.2, filter: ["==", ["get", "hw"], "track"], paint: { "line-color": INK.track, "line-opacity": Z([[13.2, 0.25], [14, 0.45], [15.2, 0.9]]), "line-width": Z([[13.2, 0.7], [14, 0.9], [16.6, 2.1]]), "line-dasharray": [3, 2] } }));
  each("path", (p) => v(p, "path", { type: "line", minzoom: 13.2, filter: ["!=", ["get", "hw"], "track"], paint: { "line-color": INK.path, "line-opacity": Z([[13.2, 0.25], [14, 0.45], [15.2, 0.9]]), "line-width": Z([[13.2, 0.6], [14, 0.8], [16.6, 1.6]]), "line-dasharray": [2.5, 2] } }));

  // the hard stretches (chains, ladders, a via ferrata, alpine scrambling): short dark ticks across
  // the way, under its colours, as on tourist maps
  const HARD = { "line-color": "#5a2a14", "line-opacity": 0.85, "line-width": Z([[12, 6], [15, 10]]), "line-dasharray": [0.16, 1.3] };
  each("hard-path", (p) => v(p, "path", { type: "line", minzoom: 14, filter: ["has", "df"], paint: HARD }));
  each("hard", (p) => v(p, "trail", { type: "line", minzoom: 12, filter: ["has", "df"], paint: HARD }));
  // ---- marked trails: their colours side by side (as on tourist maps), dashed
  // close: each colour its own thin dashed line with a gap to the next (as on mapy.cz), not one striped band
  // (each colour a dashed line, 1.6 px apart from the next: no white edge)
  const TW = [[10.6, 1.9], [12.6, 2.28], [14.6, 3.04], [16.6, 3.8]], SEP = 1.6, TO = 1;
  const cols = ["split", ["get", "cols"], ","];
  const n = ["min", ["length", cols], 4];
  // far (the whole neighbourhood): one thin unbroken line per way, in its first colour
  each("trail-0-far", (p) => v(p, "trail", { type: "line", minzoom: 9.8, maxzoom: 10.6,
    layout: { "line-join": "round", "line-cap": "round" },
    paint: {
      "line-color": trailColor(0, { pal: TRAIL }),
      "line-opacity": Z([[9.8, 0], [10.4, 0.75]]),
      "line-width": Z([[9.8, 0.95], [10.6, 1.5]]),
    } }));
  // close (planning): as on tourist maps, the colours side by side, dashed
  for (let i = 0; i < 4; i++) {
    each(`trail-${i}`, (p) => v(p, "trail", { type: "line", minzoom: 10.6,
      filter: [">", ["length", cols], i],
      layout: { "line-join": "round" },
      paint: {
        "line-color": trailColor(i, { pal: TRAIL, other: "#888" }),
        "line-opacity": TO,
        "line-width": Z(TW),
        // side by side: the i-th of n colours, centred on the way
        "line-offset": Z(TW.map(([z, w]) => [z, ["*", w + SEP, ["-", i, ["/", ["-", n, 1], 2]]]])),
        "line-dasharray": [2.2, 1.1],
      } }));
  }
  // educational paths (naučná stezka, ścieżka dydaktyczna) off the marked trails: drawn as a trail, from
  // as far out as the trails (the tiles carry them from z 12; packs built later from z 10), in a colour
  // of their own (sea green: not one of the trail colours) and with short dashes
  each("edu", (p) => v(p, "edu", { type: "line", minzoom: 10.6, layout: { "line-join": "round" },
    paint: { "line-color": EDU, "line-opacity": TO, "line-width": Z(TW), "line-dasharray": [2, 1.4] } }));
  return L;
}

/** The junction dots' image: named ones a little bigger; planning: ringed in the accent (glmap.js draws them). */
export const DOT = (plan) => ["case", ["has", "n"], plan ? "pdot-n" : "dot-n", plan ? "pdot" : "dot"];
/** Stations and (planning) car parks: one size of plate, growing a little closer in. */
export const PLATE = ["interpolate", ["linear"], ["zoom"], 11, 0.7, 13, 0.8, 15, 0.95];
export const ICON = ["case", ["==", ["get", "c"], "peak"], ["concat", "peak", ["case", ["all", ["has", "m"], ["!=", ["get", "m"], ""]], ["concat", "-", ["get", "m"]], ""]], ["get", "c"]];
export const ICON_SIZE = ["interpolate", ["linear"], ["zoom"], 9, 0.66, 12, 0.84, 15, 0.95];
export const SORT = ["*", -1, ["+", ["coalesce", ["get", "e"], 0], ["case", ["has", "m"], 5000, 0], ["case", ["==", ["coalesce", ["get", "n"], ""], ""], -20000, 0]]];
export const HALO = { "text-halo-color": INK.halo, "text-halo-width": 1.4 };
export const POI_TEXT = {
  "text-field": ["case", ["all", ["==", ["get", "c"], "peak"], ["has", "e"]], ["format", ["get", "n"], {}, "\n", {}, ["to-string", ["round", ["get", "e"]]], { "font-scale": 0.85, "text-color": INK.ele, "text-font": ["literal", FONTS.r] }], ["get", "n"]],
  "text-font": FONTS.b, "text-size": ["interpolate", ["linear"], ["zoom"], 10, 10.5, 14, 12.5], "text-anchor": "top", "text-offset": [0, 0.75], "text-optional": true, "text-max-width": 8,
};

/** Names over everything (symbols): places, peaks with heights, huts... and the signs. */
export function labels(parts) {
  const L = [];
  const each = (kind, make) => { for (const p of parts) L.push({ ...make(p), id: `${kind}:${p.id}` }); };
  const v = (p, layer, extra) => ({ source: `v:${p.id}`, "source-layer": layer, ...extra });
  const halo = HALO;
  each("contour-label", (p) => v(p, "contour", { type: "symbol", minzoom: 12.6, filter: ["==", ["get", "cls"], 100],
    layout: { "symbol-placement": "line", "text-field": ["to-string", ["get", "e"]], "text-font": FONTS.r, "text-size": 10, "symbol-spacing": 420 },
    paint: { "text-color": INK.contourIdx, ...halo } }));
  // MapLibre places the upper layers' symbols first: the order below is the priority, least first
  // (junction dots, passes, car parks, castles and towers, places, peaks, stations, huts)
  // the junctions of marked trails: white dots to tap when planning (two that would touch show as one,
  // the named one wins); their names close in. glmap.js setPlanning: bigger, ringed in the accent
  each("junction", (p) => v(p, "junction", { type: "symbol", minzoom: 12,
    layout: { "icon-image": DOT(false), "icon-padding": 6, "symbol-sort-key": ["case", ["has", "n"], 0, 1],
      "text-field": ["step", ["zoom"], "", 14, ["coalesce", ["get", "n"], ""]], "text-font": FONTS.i, "text-size": 11, "text-anchor": "left", "text-offset": [0.9, 0], "text-optional": true },
    paint: { "text-color": INK.soft, ...halo } }));
  // passes: a small saddle sign, the name beside it in italics
  each("pass", (p) => v(p, "anchor", { type: "symbol", minzoom: 12, filter: ["==", ["get", "k"], "pass"],
    layout: { "icon-image": "pass", "icon-size": 0.8, "icon-optional": true, "text-field": ["get", "n"], "text-font": FONTS.i, "text-size": 11, "text-max-width": 7, "text-anchor": "left", "text-offset": [0.95, 0], "text-optional": true },
    paint: { "text-color": INK.nature, ...halo } }));
  each("parking", (p) => v(p, "anchor", { type: "symbol", minzoom: 15, filter: ["==", ["get", "k"], "parking"],
    layout: { "icon-image": "parking-hi", "icon-size": PLATE } })); // (a blue plate, as the stations' black one; planning: from z 13)
  // bus stops: close in, the name closer still
  each("bus", (p) => v(p, "anchor", { type: "symbol", minzoom: 15, filter: ["==", ["get", "k"], "bus"],
    layout: { "icon-image": "bus-plate", "icon-size": PLATE, "text-field": ["step", ["zoom"], "", 15, ["get", "n"]], "text-font": FONTS.b, "text-size": 11, "text-anchor": "left", "text-offset": [0.9, 0], "text-optional": true, "text-max-width": 8 },
    paint: { "text-color": INK.place, ...halo } }));
  // the lifts' names along them, close in
  each("lift-label", (p) => v(p, "water", { type: "symbol", minzoom: 14, filter: ["all", ["in", ["get", "c"], ["literal", ["lift_main", "lift_chair", "lift_drag"]]], ["has", "n"]],
    layout: { "symbol-placement": "line", "text-field": ["get", "n"], "text-font": FONTS.i, "text-size": 10.5, "text-offset": [0, -0.8], "symbol-spacing": 400, "text-max-angle": 25 },
    paint: { "text-color": INK.soft, ...halo } }));
  // valleys: their names along them in brown italics (as on tourist maps), or at a point
  each("valley-line", (p) => v(p, "water", { type: "symbol", minzoom: 12, filter: ["==", ["get", "c"], "valley"],
    layout: { "symbol-placement": "line", "text-field": ["get", "n"], "text-font": FONTS.i, "text-size": Z([[12, 11], [15, 13]]), "text-letter-spacing": 0.08, "symbol-spacing": 500, "text-max-angle": 30 },
    paint: { "text-color": INK.nature, ...halo } }));
  each("valley", (p) => v(p, "valley", { type: "symbol", minzoom: 12,
    layout: { "text-field": ["get", "n"], "text-font": FONTS.i, "text-size": Z([[12, 11], [15, 13]]), "text-letter-spacing": 0.08, "text-max-width": 8 },
    paint: { "text-color": INK.nature, ...halo } }));
  const poiPaint = { "icon-opacity": ["case", ["boolean", ["feature-state", "d"], false], 0, 1], "text-opacity": ["case", ["boolean", ["feature-state", "d"], false], 0, 1], "text-color": INK.text, ...halo };
  const poi = (kinds, extra = {}, paint = {}) => ({ type: "symbol", filter: ["in", ["get", "c"], ["literal", kinds]],
    layout: { "icon-image": ["concat", ICON, "@n"], "icon-size": ICON_SIZE, "symbol-sort-key": SORT, ...POI_TEXT, ...extra }, paint: { ...poiPaint, ...paint } });
  const SMALL = { "text-color": INK.soft };
  // castles, towers, viewpoints: close in (they matter less than huts); springs and waterfalls on the spot
  each("poi-water", (p) => v(p, "poi", { ...poi(["waterfall", "spring"], { "text-font": FONTS.r }, SMALL), minzoom: 14 }));
  each("poi-minor", (p) => v(p, "poi", { ...poi(["tower", "ruins", "viewpoint", "rock", "cave"], { "text-font": FONTS.r }, SMALL), minzoom: 13 }));
  // the named towers, castles and viewpoints already when planning where to go (z ~11-13): what to walk to
  each("poi-minor-far", (p) => { const l = v(p, "poi", { ...poi(["tower", "ruins", "viewpoint"], { "icon-padding": 6, "text-font": FONTS.r }, SMALL), minzoom: 11.3, maxzoom: 13 }); l.filter = ["all", l.filter, ["!=", ["coalesce", ["get", "n"], ""], ""]]; return l; });
  // the saddles' heights (no name): a dot and the number, right close in (a paper map's spot heights)
  each("spot", (p) => v(p, "poi", { type: "symbol", minzoom: 13.6, filter: ["all", ["==", ["get", "c"], "saddle"], ["has", "e"]],
    layout: { "icon-image": "spot", "text-field": ["to-string", ["round", ["get", "e"]]], "text-font": FONTS.r, "text-size": Z([[13.6, 9.5], [16, 11]]), "text-anchor": "left", "text-offset": [0.45, 0], "text-padding": 6, "symbol-sort-key": 50 },
    paint: { "text-color": INK.nature, "icon-opacity": Z([[13.6, 0], [14, 1]]), "text-opacity": Z([[13.6, 0], [14, 1]]), ...halo } }));
  each("poi-shelter", (p) => v(p, "poi", { ...poi(["shelter"], { "text-font": FONTS.r }, SMALL), minzoom: 14 }));
  // lakes and ponds: their names in blue italics (bigger lakes from farther out: the data says when)
  each("lake", (p) => v(p, "lake", { type: "symbol",
    layout: { "text-field": ["get", "n"], "text-font": FONTS.i, "text-size": Z([[11, 11], [14, 12.5], [16, 14]]), "text-max-width": 8, "text-padding": 4 },
    paint: { "text-color": INK.lake, "text-halo-color": "rgba(240,247,252,.9)", "text-halo-width": 1.4 } }));
  // towns and villages: plain to read (where am I?), never tiny, bigger the bigger the place
  const PK = ["match", ["get", "p"], "city", 1.3, "town", 1.15, 1];
  each("place-far", (p) => v(p, "place", { type: "symbol", minzoom: 8.6, maxzoom: 10, filter: ["in", ["get", "p"], ["literal", ["city", "town"]]],
    layout: { "text-field": ["get", "n"], "text-font": FONTS.b, "text-size": Z([[8, 12], [10, 13]]), "symbol-sort-key": ["match", ["get", "p"], "city", 0, 1], "text-padding": 30 }, // the same town twice in the data: one shows
    paint: { "text-color": INK.place, ...HALO } }));
  // towns from z 10, villages from z 11 (all at z 10 was the busiest jump of the map)
  each("place-big", (p) => v(p, "place", { type: "symbol", minzoom: 10, filter: ["in", ["get", "p"], ["literal", ["city", "town"]]],
    layout: { "text-field": ["get", "n"], "text-font": FONTS.b, "text-size": ["interpolate", ["linear"], ["zoom"], 10, ["*", 12.5, PK], 12, ["*", 14.5, PK], 14, ["*", 16.5, PK], 16, ["*", 19, PK]], "symbol-sort-key": ["match", ["get", "p"], "city", 0, "town", 1, 2], "text-padding": ["interpolate", ["linear"], ["zoom"], 10, 18, 13, 4] },
    paint: { "text-color": INK.place, "text-halo-color": "rgba(245,243,237,.95)", "text-halo-width": 2 } }));
  each("place", (p) => v(p, "place", { type: "symbol", minzoom: 11, filter: ["!", ["in", ["get", "p"], ["literal", ["city", "town"]]]],
    layout: { "text-field": ["get", "n"], "text-font": FONTS.b, "text-size": ["interpolate", ["linear"], ["zoom"], 10, 11.5, 12, 12.5, 14, 14.5, 16, 17], "symbol-sort-key": ["match", ["get", "p"], "city", 0, "town", 1, 2], "text-padding": ["interpolate", ["linear"], ["zoom"], 10, 18, 13, 4] },
    paint: { "text-color": INK.village, "text-halo-color": "rgba(245,243,237,.95)", "text-halo-width": 2 } }));
  // the peaks: the neighbourhood, spaced out (the higher and the booklets' first); planning: all
  // peaks without a name (a bare height) only right close in: the dense ranges stay readable
  // the booklets' summits (m: their medals) a layer of their own: placed before the towns' and stations' names
  each("poi-list", (p) => { const l = v(p, "poi", { ...poi(["peak"], { "text-optional": false, "text-font": FONTS.b }), minzoom: 10 }); l.filter = ["all", l.filter, ["has", "m"], ["!=", ["get", "m"], ""]];
    delete l.layout["text-anchor"]; delete l.layout["text-offset"]; l.layout["text-variable-anchor"] = ["top", "right", "left"]; l.layout["text-radial-offset"] = 0.75; return l; });
  each("poi", (p) => { const l = v(p, "poi", { ...poi(["peak"], { "text-optional": false }), minzoom: 12 }); l.filter = ["all", l.filter, ["!", ["all", ["has", "m"], ["!=", ["get", "m"], ""]]], ["any", ["!=", ["coalesce", ["get", "n"], ""], ""], [">=", ["zoom"], 14.2]]];
    // the name under the peak, or beside it when something sits there (a lift's station on Śnieżka)
    delete l.layout["text-anchor"]; delete l.layout["text-offset"]; l.layout["text-variable-anchor"] = ["top", "right", "left"]; l.layout["text-radial-offset"] = 0.75; return l; });
  // stations: a train on a black plate and the name, from z 11 (where trips start and end), in every view
  each("station", (p) => v(p, "anchor", { type: "symbol", minzoom: 11, filter: ["==", ["get", "k"], "station"],
    layout: { "icon-image": "station-plate", "icon-size": PLATE, "text-field": ["get", "n"], "text-font": FONTS.b, "text-size": Z([[11, 11.5], [14, 12.5]]), "text-anchor": "left", "text-offset": [0.9, 0], "text-optional": true, "text-max-width": 9, "icon-padding": 4 },
    paint: { "text-color": INK.place, ...halo } })); // (from z 11: a small black plate, the name bold beside it; placed before the peaks you reached)
  // one way for walkers: small arrows along the way (along the line, or against it)
  const OW = { type: "symbol", minzoom: 13, filter: ["has", "ow"],
    layout: { "symbol-placement": "line", "symbol-spacing": 70, "text-field": ["case", [">", ["get", "ow"], 0], "›", "‹"], "text-font": FONTS.b, "text-size": 19, "text-keep-upright": false, "text-allow-overlap": true, "text-ignore-placement": true },
    paint: { "text-color": "#2b2b2b", "text-halo-color": "rgba(255,255,255,.9)", "text-halo-width": 1.5 } };
  each("oneway", (p) => v(p, "trail", OW));
  each("oneway-path", (p) => v(p, "path", { ...OW, minzoom: 14 }));
  // via ferratas: a ladder sign at the start, its name and grade
  each("ferrata", (p) => v(p, "poi", { type: "symbol", minzoom: 11, filter: ["==", ["get", "c"], "ferrata"],
    layout: { "icon-image": "ferrata@n", "icon-size": ICON_SIZE, "text-field": ["format", ["coalesce", ["get", "n"], "via ferrata"], {}, ["case", ["has", "s"], ["concat", "\n", ["upcase", ["to-string", ["get", "s"]]]], ""], { "font-scale": 0.85 }],
      "text-font": ["Noto Sans Bold"], "text-size": ["interpolate", ["linear"], ["zoom"], 11, 10.5, 14, 12.5], "text-anchor": "top", "text-offset": [0, 0.9], "text-optional": true, "text-max-width": 9 },
    paint: { "text-color": "#8a3d12", ...halo } }));
  // huts last: they stay (a roof for the night, water, the way down), from the neighbourhood on
  each("poi-hut", (p) => v(p, "poi", { ...poi(["hut"], { "icon-padding": 2, "text-font": FONTS.b, "icon-size": ["interpolate", ["linear"], ["zoom"], 10, 0.6, 12, 0.78, 15, 0.92] }), minzoom: 10 }));
  // far out (z 10-12) the summits over even the huts: a hut next to Śnieżka hid the range's highest peak
  // (not 18 px apart as before: at z 10-11 only a few peaks were left, the map said nothing of where to go)
  // the other peaks: from 800 m at z 10-12
  // (a peak only with its name: a bare triangle said nothing; all the named ones from z 12, the poi layer)
  each("poi-far", (p) => { const l = v(p, "poi", { ...poi(["peak"], { "icon-padding": 5, "text-optional": false }), minzoom: 10, maxzoom: 12 });
    l.filter = ["all", l.filter, ["!", ["all", ["has", "m"], ["!=", ["get", "m"], ""]]], [">=", ["coalesce", ["get", "e"], 0], 800]]; return l; });
  return L;
}
