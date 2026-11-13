// The map's style for MapLibre GL (the modern look of the old canvas map): one vector source and one
// relief source per downloaded part of a pack (g/<part>.pmtiles, g/<part>-relief.pmtiles), their
// layers interleaved by kind (all parts' forests, then all relief, then all roads, ...) so parts meet
// without seams. What is mine (walked, found) comes by feature state:
//   poi {d: reached}
// Zooms: MapLibre z ~ the old map's zl + 5.65 (at 50° N).

export const TC = { red: "#d0202a", blue: "#2160c8", green: "#16903c", yellow: "#e0b800", black: "#1a1a1a" };
export const PAPER = "#f4efe2";
/** Educational paths: their own colour on the map (and in the legend). */
export const EDU = "#0e9fb3";
const FILL = { meadow: "#e3edc9", forest: "#c6e0a4", residential: "#e6dbcb", water: "#a9d0f0" };
export const FONTS = { r: ["Noto Sans Regular"], b: ["Noto Sans Bold"], i: ["Noto Sans Italic"] };

/** zoom stops [[z, v], ...] as an interpolate expression */
const Z = (stops) => ["interpolate", ["linear"], ["zoom"], ...stops.flat()];

/** Sources for the parts: [{id, url, relief}] (url: pmtiles://...). */
export function sources(parts) {
  const out = {};
  for (const p of parts) {
    out[`v:${p.id}`] = { type: "vector", url: p.url, promoteId: { trail: "k", path: "k", road: "k", poi: "id" } };
    if (p.relief) out[`r:${p.id}`] = { type: "raster", url: p.relief, tileSize: 256 };
  }
  return out;
}

/** The layers, every kind for every part (ids "<kind>:<part>"). opts: {accent: "r,g,b"} */
export function layers(parts, opts = {}) {
  // far out a paler, cooler paper (Poświata: the land quiet, the walked trails carry the colour)
  const L = [{ id: "paper", type: "background", paint: { "background-color": Z([[8.4, "#f6f3eb"], [10.2, PAPER]]) } }];
  const each = (kind, make) => { for (const p of parts) { const l = make(p); if (l) L.push({ ...l, id: `${kind}:${p.id}` }); } };
  const v = (p, layer, extra) => ({ source: `v:${p.id}`, "source-layer": layer, ...extra });

  // ---- ground
  // the packs' areas from the neighbourhood on (far out the backdrop's smooth forests are the land; water always)
  for (const [c, col] of Object.entries(FILL)) each(`area-${c}`, (p) => v(p, "area", { type: "fill", ...(c === "water" ? {} : { minzoom: 8.8 }), filter: ["==", ["get", "c"], c], paint: { "fill-color": col, "fill-antialias": true, ...(c === "water" ? {} : { "fill-opacity": Z([[8.8, 0], [9.8, 1]]) }) } }));
  each("relief", (p) => (p.relief ? { type: "raster", source: `r:${p.id}`, layout: { visibility: "none" }, paint: { "raster-opacity": 0.6, "raster-resampling": "linear", "raster-fade-duration": 0 } } : null));
  // contours: brown-grey as on tourist maps, light enough that steep ground (the Tatras) stays readable;
  // every 100 m from the middle zooms, 50 m closer, 10 m only right close in
  const cc = "#9a8f80";
  each("contour-10", (p) => v(p, "contour", { type: "line", minzoom: 13, filter: ["==", ["get", "cls"], 10], paint: { "line-color": cc, "line-opacity": Z([[13, 0], [13.6, 0.28], [15.4, 0.38]]), "line-width": Z([[13, 0.4], [16.6, 0.8]]) } }));
  each("contour-50", (p) => v(p, "contour", { type: "line", minzoom: 12, filter: ["==", ["get", "cls"], 50], paint: { "line-color": cc, "line-opacity": Z([[12, 0.4], [13.5, 0.6]]), "line-width": Z([[12, 0.45], [13, 0.55], [16.6, 0.9]]) } }));
  each("contour-100", (p) => v(p, "contour", { type: "line", minzoom: 10.6, maxzoom: 24, filter: ["==", ["get", "cls"], 100], paint: { "line-color": "#8a7c6a", "line-opacity": Z([[10.6, 0.45], [13, 0.7]]), "line-width": Z([[10.6, 0.5], [12.6, 0.85], [14.6, 1.1], [16.6, 1.4]]) } }));
  // waters
  each("stream", (p) => v(p, "water", { type: "line", minzoom: 12, filter: ["==", ["get", "c"], "stream"], paint: { "line-color": "#5c9fd6", "line-width": Z([[12, 0.6], [14.6, 1.3], [16.6, 2]]) } }));
  each("river", (p) => v(p, "water", { type: "line", filter: ["==", ["get", "c"], "river"], paint: { "line-color": Z([[8, "#8fb0c8"], [10.6, "#3f8bd0"]]), "line-width": Z([[7.6, 0.8], [10.6, 1.2], [13.6, 2.4], [16.6, 4]]) } }));
  // borders: a soft grey band (never violet: that is yours) with a dark dash-dot line between countries (as on tourist maps), a dashed line between regions
  // (far out stronger: the border is what tells the countries apart there)
  each("border-band", (p) => v(p, "water", { type: "line", filter: ["==", ["get", "c"], "border"], paint: { "line-color": "rgba(70,70,70,.22)", "line-width": Z([[5, 10], [8, 14], [10.6, 9], [13.6, 10], [16.6, 13]]) } })); // (grey: a violet-grey band read as your traces)
  each("border", (p) => v(p, "water", { type: "line", filter: ["==", ["get", "c"], "border"], paint: { "line-color": "#3f3549", "line-opacity": 0.95, "line-width": Z([[5, 2], [9, 3], [10.6, 1.8], [13.6, 2], [16.6, 2.6]]), "line-dasharray": [3.5, 1.6, 1, 1.6] } }));
  each("boundary", (p) => v(p, "water", { type: "line", minzoom: 8.6, filter: ["==", ["get", "c"], "boundary"], paint: { "line-color": "#5a4763", "line-opacity": Z([[8.6, 0.35], [10.6, 0.75]]), "line-width": Z([[8.6, 1], [13.6, 1.6]]), "line-dasharray": [4, 3] } }));

  // ---- roads, rails, paths
  each("road-minor-case", (p) => v(p, "road", { type: "line", minzoom: 11.6, filter: ["!", ["get", "major"]], layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": "#a59a89", "line-width": Z([[11.6, 2.2], [13.6, 3.8], [16.6, 6.2]]) } }));
  each("road-minor", (p) => v(p, "road", { type: "line", minzoom: 11.6, filter: ["!", ["get", "major"]], layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": "#ffffff", "line-width": Z([[11.6, 1], [13.6, 2.6], [16.6, 5]]) } }));
  each("road-major-case", (p) => v(p, "road", { type: "line", minzoom: 8.8, filter: ["get", "major"], layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": Z([[8.8, "#dccfb2"], [10.6, "#b8a586"], [12, "#8c7b62"]]), "line-width": Z([[8.8, 0.7], [10.6, 1.9], [13.6, 4.6], [16.6, 8.2]]) } }));
  each("road-major", (p) => v(p, "road", { type: "line", minzoom: 9.5, filter: ["get", "major"], layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": "#fde6a0", "line-width": Z([[9.5, 0.8], [10.6, 1.4], [13.6, 3.4], [16.6, 7]]) } }));
  // railways from the neighbourhood's scale (a few km to the inch): stations are where trips start
  each("rail-case", (p) => v(p, "water", { type: "line", minzoom: 9, filter: ["==", ["get", "c"], "rail"], paint: { "line-color": ["interpolate", ["linear"], ["zoom"], 10.2, "#8d8a92", 11.6, "#2b2f36"], "line-width": Z([[9, 0.9], [10.6, 1.8], [13.6, 4.2], [16.6, 5.8]]) } })); // (far out a light grey thread: not heavier than the roads)
  each("rail", (p) => v(p, "water", { type: "line", minzoom: 10.2, filter: ["==", ["get", "c"], "rail"], paint: { "line-color": "#f4f1ea", "line-width": Z([[10.2, 0.8], [13.6, 2.6], [16.6, 4.2]]), "line-dasharray": [4, 4] } }));
  // aerial lifts, as on paper maps: a thin graphite line with short cross ticks; cable cars and gondolas
  // from the middle zooms, chair lifts closer, ski tows only close in and paler
  const LIFT = { lift_main: [11, 1.5, 5.5, 1], lift_chair: [12, 1.1, 4.4, 0.9], lift_drag: [14, 0.9, 3.4, 0.6] };
  for (const [c, [z, w, tw, op]] of Object.entries(LIFT)) {
    each(`${c}`, (p) => v(p, "water", { type: "line", minzoom: z, filter: ["==", ["get", "c"], c], paint: { "line-color": "#3d3f45", "line-opacity": op, "line-width": Z([[z, w * 0.8], [15, w * 1.3]]) } }));
    each(`${c}-tick`, (p) => v(p, "water", { type: "line", minzoom: z + 0.6, filter: ["==", ["get", "c"], c], paint: { "line-color": "#3d3f45", "line-opacity": op, "line-width": tw, "line-dasharray": [0.22, 7] } }));
  }
  // tracks and paths: from the middle zooms (the trails and the relief first)
  each("track", (p) => v(p, "path", { type: "line", minzoom: 14, filter: ["==", ["get", "hw"], "track"], paint: { "line-color": "#7a5a2e", "line-opacity": Z([[14, 0.45], [15.2, 0.9]]), "line-width": Z([[14, 0.9], [16.6, 2.1]]), "line-dasharray": [3, 2] } }));
  each("path", (p) => v(p, "path", { type: "line", minzoom: 14, filter: ["!=", ["get", "hw"], "track"], paint: { "line-color": "#333", "line-opacity": Z([[14, 0.45], [15.2, 0.9]]), "line-width": Z([[14, 0.8], [16.6, 1.6]]), "line-dasharray": [2.5, 2] } }));

  // the hard stretches (chains, ladders, a via ferrata, alpine scrambling): short dark ticks across
  // the way, under its colours, as on tourist maps
  const HARD = { "line-color": "#5a2a14", "line-opacity": 0.85, "line-width": Z([[12, 6], [15, 10]]), "line-dasharray": [0.16, 1.3] };
  each("hard-path", (p) => v(p, "path", { type: "line", minzoom: 14, filter: ["has", "df"], paint: HARD }));
  each("hard", (p) => v(p, "trail", { type: "line", minzoom: 12, filter: ["has", "df"], paint: HARD }));
  // ---- marked trails: their colours side by side (as on tourist maps), dashed
  // close: each colour its own thin dashed line with a gap to the next (as on mapy.cz), not one striped band
  const TW = [[10.6, 2], [12.6, 2.4], [14.6, 3.2], [16.6, 4]], GAP = 1.9;
  // out to ~z 12 the trails a little quieter (the fog is under them: from afar they would cover the scratch-off); full
  // from z 13 (they were washed out in the field at 0.45: now nearly full)
  const TO = Z([[10.6, 0.72], [12, 0.82], [13, 1]]);
  const SOFT = { red: "#d81f26", blue: "#1f5fd0", green: "#138a3a", yellow: "#ecb800", black: "#262626" };
  const cols = ["split", ["get", "cols"], ","];
  const n = ["min", ["length", cols], 4];
  // far (the whole neighbourhood): one thin unbroken line per way, in its first colour
  each("trail-0-far", (p) => v(p, "trail", { type: "line", minzoom: 9.8, maxzoom: 10.6,
    layout: { "line-join": "round", "line-cap": "round" },
    paint: {
      "line-color": ["match", ["at", 0, cols], "red", TC.red, "blue", TC.blue, "green", TC.green, "yellow", TC.yellow, "black", TC.black, "#777"],
      "line-opacity": Z([[9.8, 0], [10.4, 0.75]]),
      "line-width": Z([[9.8, 1], [10.6, 1.6]]),
    } }));
  // close (planning): as on tourist maps, the colours side by side, dashed
  for (let i = 0; i < 4; i++) {
    each(`trail-${i}`, (p) => v(p, "trail", { type: "line", minzoom: 10.6,
      filter: [">", ["length", cols], i],
      layout: { "line-join": "round" },
      paint: {
        "line-color": ["match", ["at", i, cols], "red", SOFT.red, "blue", SOFT.blue, "green", SOFT.green, "yellow", SOFT.yellow, "black", SOFT.black, "#777"],
        "line-opacity": TO,
        "line-width": Z(TW),
        // side by side: the i-th of n colours, centred on the way
        "line-offset": Z(TW.map(([z, w]) => [z, ["*", w * GAP, ["-", i, ["/", ["-", n, 1], 2]]]])),
        "line-dasharray": [3, 1.6],
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
export const ICON_SIZE = ["interpolate", ["linear"], ["zoom"], 9, 0.72, 12, 0.9, 15, 1];
export const SORT = ["*", -1, ["+", ["coalesce", ["get", "e"], 0], ["case", ["has", "m"], 5000, 0], ["case", ["==", ["coalesce", ["get", "n"], ""], ""], -20000, 0]]];
export const HALO = { "text-halo-color": "rgba(250,247,238,.92)", "text-halo-width": 1.4 };
export const POI_TEXT = {
  "text-field": ["case", ["all", ["==", ["get", "c"], "peak"], ["has", "e"]], ["format", ["get", "n"], {}, "\n", {}, ["to-string", ["round", ["get", "e"]]], { "font-scale": 0.85 }], ["get", "n"]],
  "text-font": ["Noto Sans Bold"], "text-size": ["interpolate", ["linear"], ["zoom"], 10, 10, 14, 12], "text-anchor": "top", "text-offset": [0, 0.75], "text-optional": true, "text-max-width": 8,
};

/** Names over everything (symbols): places, peaks with heights, huts... and the signs. */
export function labels(parts) {
  const L = [];
  const each = (kind, make) => { for (const p of parts) L.push({ ...make(p), id: `${kind}:${p.id}` }); };
  const v = (p, layer, extra) => ({ source: `v:${p.id}`, "source-layer": layer, ...extra });
  const halo = HALO;
  each("contour-label", (p) => v(p, "contour", { type: "symbol", minzoom: 12.6, filter: ["==", ["get", "cls"], 100],
    layout: { "symbol-placement": "line", "text-field": ["to-string", ["get", "e"]], "text-font": FONTS.r, "text-size": 10, "symbol-spacing": 420 },
    paint: { "text-color": "#7d6f5e", ...halo } }));
  // MapLibre places the upper layers' symbols first: the order below is the priority, least first
  // (junction dots, passes, car parks, castles and towers, places, peaks, stations, huts)
  // the junctions of marked trails: white dots to tap when planning (two that would touch show as one,
  // the named one wins); their names close in. glmap.js setPlanning: bigger, ringed in the accent
  each("junction", (p) => v(p, "junction", { type: "symbol", minzoom: 12,
    layout: { "icon-image": DOT(false), "icon-padding": 6, "symbol-sort-key": ["case", ["has", "n"], 0, 1],
      "text-field": ["step", ["zoom"], "", 14, ["coalesce", ["get", "n"], ""]], "text-font": FONTS.i, "text-size": 11, "text-anchor": "left", "text-offset": [0.9, 0], "text-optional": true },
    paint: { "text-color": "#3b3f3c", ...halo } }));
  // passes: a small saddle sign, the name beside it in italics
  each("pass", (p) => v(p, "anchor", { type: "symbol", minzoom: 12, filter: ["==", ["get", "k"], "pass"],
    layout: { "icon-image": "pass", "icon-size": 0.8, "icon-optional": true, "text-field": ["get", "n"], "text-font": FONTS.i, "text-size": 11, "text-max-width": 7, "text-anchor": "left", "text-offset": [0.95, 0], "text-optional": true },
    paint: { "text-color": "#4a4f4c", ...halo } }));
  each("parking", (p) => v(p, "anchor", { type: "symbol", minzoom: 15, filter: ["==", ["get", "k"], "parking"],
    layout: { "icon-image": "parking-hi", "icon-size": PLATE } })); // (a blue plate, as the stations' black one; planning: from z 13)
  // bus stops: close in, the name closer still
  each("bus", (p) => v(p, "anchor", { type: "symbol", minzoom: 15, filter: ["==", ["get", "k"], "bus"],
    layout: { "icon-image": "bus-plate", "icon-size": PLATE, "text-field": ["step", ["zoom"], "", 15, ["get", "n"]], "text-font": FONTS.b, "text-size": 11, "text-anchor": "left", "text-offset": [0.9, 0], "text-optional": true, "text-max-width": 8 },
    paint: { "text-color": "#1f2328", ...halo } }));
  // the lifts' names along them, close in
  each("lift-label", (p) => v(p, "water", { type: "symbol", minzoom: 14, filter: ["all", ["in", ["get", "c"], ["literal", ["lift_main", "lift_chair", "lift_drag"]]], ["has", "n"]],
    layout: { "symbol-placement": "line", "text-field": ["get", "n"], "text-font": FONTS.i, "text-size": 10.5, "text-offset": [0, -0.8], "symbol-spacing": 400, "text-max-angle": 25 },
    paint: { "text-color": "#4a4d55", ...halo } }));
  // valleys: their names along them in brown italics (as on tourist maps), or at a point
  each("valley-line", (p) => v(p, "water", { type: "symbol", minzoom: 12, filter: ["==", ["get", "c"], "valley"],
    layout: { "symbol-placement": "line", "text-field": ["get", "n"], "text-font": FONTS.i, "text-size": Z([[12, 11], [15, 13]]), "text-letter-spacing": 0.08, "symbol-spacing": 500, "text-max-angle": 30 },
    paint: { "text-color": "#7a5a3a", ...halo } }));
  each("valley", (p) => v(p, "valley", { type: "symbol", minzoom: 12,
    layout: { "text-field": ["get", "n"], "text-font": FONTS.i, "text-size": Z([[12, 11], [15, 13]]), "text-letter-spacing": 0.08, "text-max-width": 8 },
    paint: { "text-color": "#7a5a3a", ...halo } }));
  const poiPaint = { "icon-opacity": ["case", ["boolean", ["feature-state", "d"], false], 0, 1], "text-opacity": ["case", ["boolean", ["feature-state", "d"], false], 0, 1], "text-color": "#5d5a55", ...halo };
  const poi = (kinds, extra = {}) => ({ type: "symbol", filter: ["in", ["get", "c"], ["literal", kinds]],
    layout: { "icon-image": ["concat", ICON, "@n"], "icon-size": ICON_SIZE, "symbol-sort-key": SORT, ...POI_TEXT, ...extra }, paint: poiPaint });
  // castles, towers, viewpoints: close in (they matter less than huts); springs and waterfalls on the spot
  each("poi-water", (p) => v(p, "poi", { ...poi(["waterfall", "spring"]), minzoom: 14 }));
  each("poi-minor", (p) => v(p, "poi", { ...poi(["tower", "ruins", "viewpoint", "rock", "cave"]), minzoom: 13 }));
  // the named towers, castles and viewpoints already when planning where to go (z ~11-13): what to walk to
  each("poi-minor-far", (p) => { const l = v(p, "poi", { ...poi(["tower", "ruins", "viewpoint"], { "icon-padding": 6 }), minzoom: 11.3, maxzoom: 13 }); l.filter = ["all", l.filter, ["!=", ["coalesce", ["get", "n"], ""], ""]]; return l; });
  each("poi-shelter", (p) => v(p, "poi", { ...poi(["shelter"]), minzoom: 14 }));
  // lakes and ponds: their names in blue italics (bigger lakes from farther out: the data says when)
  each("lake", (p) => v(p, "lake", { type: "symbol",
    layout: { "text-field": ["get", "n"], "text-font": FONTS.i, "text-size": Z([[11, 11], [14, 12.5], [16, 14]]), "text-max-width": 8, "text-padding": 4 },
    paint: { "text-color": "#2f6fa8", "text-halo-color": "rgba(240,247,252,.9)", "text-halo-width": 1.4 } }));
  // towns and villages: plain to read (where am I?), never tiny, bigger the bigger the place
  const PK = ["match", ["get", "p"], "city", 1.3, "town", 1.15, 1];
  each("place-far", (p) => v(p, "place", { type: "symbol", minzoom: 8.6, maxzoom: 10, filter: ["in", ["get", "p"], ["literal", ["city", "town"]]],
    layout: { "text-field": ["get", "n"], "text-font": FONTS.b, "text-size": Z([[8, 12], [10, 13]]), "symbol-sort-key": ["match", ["get", "p"], "city", 0, 1], "text-padding": 30 }, // the same town twice in the data: one shows
    paint: { "text-color": "#2b2a28", ...HALO } }));
  // towns from z 10, villages from z 11 (all at z 10 was the busiest jump of the map)
  each("place-big", (p) => v(p, "place", { type: "symbol", minzoom: 10, filter: ["in", ["get", "p"], ["literal", ["city", "town"]]],
    layout: { "text-field": ["get", "n"], "text-font": FONTS.b, "text-size": ["interpolate", ["linear"], ["zoom"], 10, ["*", 12.5, PK], 12, ["*", 14.5, PK], 14, ["*", 16.5, PK], 16, ["*", 19, PK]], "symbol-sort-key": ["match", ["get", "p"], "city", 0, "town", 1, 2], "text-padding": ["interpolate", ["linear"], ["zoom"], 10, 18, 13, 4] },
    paint: { "text-color": "#1f1e1c", "text-halo-color": "rgba(252,250,244,.95)", "text-halo-width": 2 } }));
  each("place", (p) => v(p, "place", { type: "symbol", minzoom: 11, filter: ["!", ["in", ["get", "p"], ["literal", ["city", "town"]]]],
    layout: { "text-field": ["get", "n"], "text-font": FONTS.b, "text-size": ["interpolate", ["linear"], ["zoom"], 10, ["*", 12.5, PK], 12, ["*", 14.5, PK], 14, ["*", 16.5, PK], 16, ["*", 19, PK]], "symbol-sort-key": ["match", ["get", "p"], "city", 0, "town", 1, 2], "text-padding": ["interpolate", ["linear"], ["zoom"], 10, 18, 13, 4] },
    paint: { "text-color": "#1f1e1c", "text-halo-color": "rgba(252,250,244,.95)", "text-halo-width": 2 } }));
  // the peaks: the neighbourhood, spaced out (the higher and the booklets' first); planning: all
  // peaks without a name (a bare height) only right close in: the dense ranges stay readable
  // the booklets' summits (m: their medals) a layer of their own: placed before the towns' and stations' names
  each("poi-list", (p) => { const l = v(p, "poi", { ...poi(["peak"]), minzoom: 10 }); l.filter = ["all", l.filter, ["has", "m"], ["!=", ["get", "m"], ""]];
    delete l.layout["text-anchor"]; delete l.layout["text-offset"]; l.layout["text-variable-anchor"] = ["top", "right", "left"]; l.layout["text-radial-offset"] = 0.75; return l; });
  each("poi", (p) => { const l = v(p, "poi", { ...poi(["peak"]), minzoom: 12 }); l.filter = ["all", l.filter, ["!", ["all", ["has", "m"], ["!=", ["get", "m"], ""]]], ["any", ["!=", ["coalesce", ["get", "n"], ""], ""], [">=", ["zoom"], 14.2]]];
    // the name under the peak, or beside it when something sits there (a lift's station on Śnieżka)
    delete l.layout["text-anchor"]; delete l.layout["text-offset"]; l.layout["text-variable-anchor"] = ["top", "right", "left"]; l.layout["text-radial-offset"] = 0.75; return l; });
  // stations: a train on a black plate and the name, from z 11 (where trips start and end), in every view
  each("station", (p) => v(p, "anchor", { type: "symbol", minzoom: 11, filter: ["==", ["get", "k"], "station"],
    layout: { "icon-image": "station-plate", "icon-size": PLATE, "text-field": ["get", "n"], "text-font": FONTS.b, "text-size": Z([[11, 11.5], [14, 12.5]]), "text-anchor": "left", "text-offset": [0.9, 0], "text-optional": true, "text-max-width": 9, "icon-padding": 4 },
    paint: { "text-color": "#1f2328", ...halo } })); // (from z 11: a small black plate, the name bold beside it; placed before the peaks you reached)
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
  each("poi-hut", (p) => v(p, "poi", { ...poi(["hut"], { "icon-padding": 2 }), minzoom: 10 }));
  // far out (z 10-12) the summits over even the huts: a hut next to Śnieżka hid the range's highest peak
  // (not 18 px apart as before: at z 10-11 only a few peaks were left, the map said nothing of where to go)
  // the other peaks: from 800 m at z 10, all the named ones from z 11
  each("poi-far", (p) => { const l = v(p, "poi", { ...poi(["peak"], { "icon-padding": 5 }), minzoom: 10, maxzoom: 12 });
    l.filter = ["all", l.filter, ["!", ["all", ["has", "m"], ["!=", ["get", "m"], ""]]], ["step", ["zoom"], [">=", ["coalesce", ["get", "e"], 0], 800], 11, true]]; return l; });
  return L;
}
