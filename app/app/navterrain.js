/* global maplibregl */
// The 3D views' map (Kompas trasy, Replay 3D): the map engine's terrain from the app's own height grid
// (core/demtiles.js, made on the spot, offline) under the map packs' own ground — meadows, forest, dwarf pine,
// scree, water, villages — the relief lit from where the light comes from, contours, roads, paths and tracks,
// rivers, lifts, the marked trails, and the names: peaks with their heights, huts, shelters, viewpoints,
// towers, passes, car parks, villages, each with the map's own sign. Its light: a palette (core/sun.js: the
// kompas's dark one, or the sun's at a replay's hour), changed on the fly. On top the route: for the kompas
// walked violet and ahead in its trails' colours in the plan's orange edge; for a replay the outing.

import { demBounds } from "../core/demtiles.js";
import { demSource } from "./demsource.js";
import { NAV_LIGHT } from "../core/sun.js";
import { sources, FONTS, Z, trailColor } from "./glstyle.js";
import { drawMapSign } from "./glyphs.js";

// (the trails in the map's colours, black a little lighter: on the 3D ground it would be a hole)
const colExpr = (key, i = 0) => trailColor(i, { black: "#3b3b3b", other: "#8a8f8c", key });
const AREAS = ["meadow", "scrub", "bare", "scree", "residential", "forest", "water"];
const MAJ = (a, b) => ["case", ["coalesce", ["get", "major"], false], a, b];

/** Is the route (lon/lat points) on the grid? */
export function onGrid(dem, pts) {
  const [w, s, e, n] = demBounds(dem);
  return pts.length > 0 && pts.every(([lon, lat]) => lon > w && lon < e && lat > s && lat < n);
}

/**
 * host: the element to lay the map in (under the overlay canvas). -> {setRoute(geo), setTrails(alpha),
 * setLight(palette), setCamera({center: [lon, lat], zoom, bearing, pitch, padding}), project([lon, lat]) -> [x, y],
 * ready, map, destroy}. onChange(): the map drew again (tiles came: the overlay's marks move with the ground).
 * kind: "nav" (the kompas) | "replay"; light: the palette to start with (core/sun.js).
 */
export function createNavTerrain(host, before, dem, parts, onChange = () => {}, { kind = "nav", light = NAV_LIGHT, exaggeration = 1.4, focus = null } = {}) {
  const box = document.createElement("div");
  box.id = "nrmap";
  box.style.cssText = "position:absolute;inset:0;pointer-events:none";
  host.insertBefore(box, before);
  const P = parts || [], src = sources(P), Lt = light, nav = kind === "nav";
  const v = (p, layer, x) => ({ source: `v:${p.id}`, "source-layer": layer, ...x });
  const each = (id, f) => P.map((p) => ({ id: `${id}:${p.id}`, ...f(p) }));
  const C_ = ["get", "c"];
  const L = [{ id: "bg", type: "background", paint: { "background-color": Lt.bg } }];
  // the ground: the packs' areas in the light's colours (the kompas: quieter, forest and water only stand out)
  L.push(...each("area", (p) => v(p, "area", { type: "fill", filter: ["in", C_, ["literal", AREAS]], paint: { "fill-color": ["match", C_, ...AREAS.flatMap((k) => [k, Lt.area[k]]), Lt.bg], "fill-opacity": nav ? ["match", C_, "forest", 0.75, "water", 0.8, 0.5] : 1, "fill-antialias": false } })));
  // the relief on the ground: shadow and light from where the light comes
  if (dem) L.push({ id: "shade", type: "hillshade", source: "demshade", paint: { "hillshade-exaggeration": Lt.exag, "hillshade-shadow-color": Lt.shadow, "hillshade-highlight-color": Lt.light, "hillshade-accent-color": "rgba(0,0,0,0)", "hillshade-illumination-anchor": "map", "hillshade-illumination-direction": Math.round(Lt.dir) % 360 } });
  L.push(
    ...each("contour", (p) => v(p, "contour", { type: "line", filter: ["in", ["get", "cls"], ["literal", [50, 100]]], paint: { "line-color": Lt.contour, "line-opacity": ["match", ["to-string", ["get", "cls"]], "100", nav ? 0.5 : 0.45, nav ? 0.3 : 0.25], "line-width": ["match", ["to-string", ["get", "cls"]], "100", 1.1, 0.7] } })),
    ...each("river", (p) => v(p, "water", { type: "line", filter: ["in", C_, ["literal", ["river", "stream"]]], paint: { "line-color": Lt.area.water, "line-width": ["match", C_, "river", 2.4, 1.2] } })),
    ...each("track", (p) => v(p, "path", { type: "line", minzoom: 13, filter: ["==", ["get", "hw"], "track"], paint: { "line-color": Lt.path, "line-opacity": 0.6, "line-width": Z([[13, 0.8], [16, 1.8]]), "line-dasharray": [3, 1.5] } })),
    ...each("path", (p) => v(p, "path", { type: "line", minzoom: 13, filter: ["!=", ["get", "hw"], "track"], paint: { "line-color": Lt.path, "line-opacity": 0.55, "line-width": Z([[13, 0.7], [16, 1.4]]), "line-dasharray": [2, 1.5] } })),
    ...each("road-case", (p) => v(p, "road", { type: "line", layout: { "line-join": "round", "line-cap": "round" }, paint: { "line-color": Lt.roadCase, "line-width": Z([[11, MAJ(2.6, 1.6)], [16, MAJ(7, 4.6)]]) } })),
    ...each("road", (p) => v(p, "road", { type: "line", layout: { "line-join": "round", "line-cap": "round" }, paint: { "line-color": Lt.road, "line-width": Z([[11, MAJ(1.4, 0.7)], [16, MAJ(5, 3)]]) } })),
    ...each("lift", (p) => v(p, "water", { type: "line", filter: ["in", C_, ["literal", ["lift_main", "lift_chair", "lift_drag"]]], paint: { "line-color": Lt.lift, "line-width": 1.6, "line-dasharray": [6, 1.5] } })),
    ...each("trail", (p) => v(p, "trail", { type: "line", filter: [">", ["length", ["get", "cols"]], 0], layout: { "line-join": "round", "line-cap": "round" }, paint: { "line-color": colExpr("cols"), "line-width": nav ? 3.5 : Z([[12, 2], [16, 4]]), "line-opacity": nav ? 0.35 : 0.8 } })),
  );
  const R = (id, filter, paint) => ({ id, type: "line", source: "route", ...(filter ? { filter } : {}), layout: { "line-join": "round", "line-cap": "round" }, paint });
  // a replay (replay.js): the whole outing faint and dashed ahead, what is behind the walker violet, white-edged
  if (kind === "replay") L.push(
    R("ahead-edge", ["==", ["get", "w"], 0], { "line-color": "#ffffff", "line-width": 8, "line-opacity": 0.9 }),
    R("ahead", ["==", ["get", "w"], 0], { "line-color": ["coalesce", ["get", "col"], "#9aa09c"], "line-width": 5 }),
    { ...R("walked-edge", null, { "line-color": "#ffffff", "line-width": 9, "line-opacity": 0.95 }), source: "walked" },
    { ...R("walked", null, { "line-color": "#6e48dc", "line-width": 6 }), source: "walked" },
  );
  else L.push(
    R("walked", ["==", ["get", "w"], 1], { "line-color": "#6e48dc", "line-width": 6 }),
    R("route-edge", ["==", ["get", "w"], 0], { "line-color": "#f0a01e", "line-width": 15 }),
    R("route-gap", ["==", ["get", "w"], 0], { "line-color": "#0d100e", "line-width": 10.5, "line-opacity": 0.6 }),
    R("route", ["==", ["get", "w"], 0], { "line-color": colExpr("cols"), "line-width": 7.5 }),
    R("route-2", ["all", ["==", ["get", "w"], 0], [">", ["length", ["split", ["get", "cols"], ","]], 1]], { "line-color": colExpr("cols", 1), "line-width": 2.6 }),
  );
  // the names, standing up on the slopes (the map's own signs; the names hidden behind ridges by the engine)
  const TXT = (size, font = FONTS.b) => ({ "text-font": font, "text-size": size, "text-optional": true, "text-max-width": 8, "text-pitch-alignment": "viewport", "text-rotation-alignment": "viewport" });
  const tp = { "text-color": Lt.label, "text-halo-color": Lt.halo, "text-halo-width": 1.6 };
  // (a tilted view takes coarser tiles further off: a minimum zoom keeps the names near; the kompas, an
  // instrument: only huts and peaks, nearer still)
  const MZ = nav ? 13.6 : 12.4;
  if (nav) L.push(...each("poi", (p) => v(p, "poi", { type: "symbol", minzoom: MZ, filter: ["any", ["==", C_, "hut"], ["all", ["==", C_, "peak"], ["has", "n"]]],
    layout: { "icon-image": ["concat", C_, "@n"], "icon-size": 0.8, "icon-pitch-alignment": "viewport", "symbol-sort-key": ["*", -1, ["coalesce", ["get", "e"], 0]], "text-field": ["coalesce", ["get", "n"], ""], ...TXT(11), "text-anchor": "top", "text-offset": [0, 0.8] },
    paint: { ...tp, "text-opacity": 0.8, "icon-opacity": 0.85 } })));
  else {
    // what is worth a name in a replay (focus: {near, ends}, MultiPolygons round the route and round its two ends):
    // - anywhere: towns and villages (where you are: "Karpacz is there"), the booklets' summits, the peaks reached,
    //   the summits over 1000 m (the ones the camera looks at; the highest win the room);
    // - along the route (near, ~800 m): huts, named peaks with heights, passes, shelters, viewpoints, towers;
    // - only where it starts and ends (ends, ~400 m): car parks.
    const near = focus?.near ? ["within", focus.near] : true, ends = focus?.ends ? ["within", focus.ends] : false, mine = focus?.peaks?.length ? ["in", ["get", "n"], ["literal", focus.peaks]] : false;
    const big = ["in", ["get", "p"], ["literal", ["city", "town"]]];
    L.push(
      ...each("place", (p) => v(p, "place", { type: "symbol", filter: ["any", big, ["==", ["get", "p"], "village"], ["all", near, ["!", big]]],
        layout: { "text-field": ["get", "n"], ...TXT(["case", big, 17, ["==", ["get", "p"], "village"], 13.5, 12], FONTS.b), "text-transform": "uppercase", "text-letter-spacing": 0.06, "symbol-sort-key": ["case", big, 0, 1], "text-padding": 24 }, paint: { ...tp, "text-halo-width": 2 } })),
      ...each("pass", (p) => v(p, "anchor", { type: "symbol", minzoom: MZ, filter: ["all", ["==", ["get", "k"], "pass"], near], layout: { "icon-image": "pass", "icon-size": 0.85, "text-field": ["get", "n"], ...TXT(11, FONTS.i), "text-anchor": "left", "text-offset": [0.95, 0] }, paint: tp })),
      ...each("parking", (p) => v(p, "anchor", { type: "symbol", filter: ["all", ["==", ["get", "k"], "parking"], ends], layout: { "icon-image": "parking-hi", "icon-size": 0.8, "icon-pitch-alignment": "viewport" }, paint: {} })),
      ...each("poi", (p) => v(p, "poi", { type: "symbol", minzoom: MZ - 1.2,
        filter: ["any", ["all", ["in", C_, ["literal", ["hut", "shelter", "viewpoint", "tower"]]], near], ["all", ["==", C_, "peak"], ["has", "n"], ["any", near, mine, [">=", ["coalesce", ["get", "e"], 0], 1000], ["all", ["has", "m"], ["!=", ["get", "m"], ""]]]]],
        layout: { "icon-image": ["concat", C_, "@n"], "icon-size": ["match", C_, "hut", 0.95, "peak", 0.85, 0.8], "icon-pitch-alignment": "viewport", "symbol-sort-key": ["*", -1, ["coalesce", ["get", "e"], 0]], "icon-padding": 6, "text-padding": 6,
          "text-field": ["case", ["all", ["==", C_, "peak"], ["has", "e"]], ["format", ["get", "n"], {}, "\n", {}, ["concat", ["to-string", ["round", ["get", "e"]]], " m"], { "font-scale": 0.82 }], ["coalesce", ["get", "n"], ""]],
          ...TXT(Z([[11, 11], [15, 13]])), "text-anchor": "top", "text-offset": [0, 0.8] }, paint: tp })),
    );
  }
  const style = {
    version: 8, glyphs: new URL("../vendor/fonts/", import.meta.url).href + "{fontstack}/{range}.pbf",
    sources: { ...(dem ? { dem: demSource(dem), demshade: demSource(dem, { shade: true }) } : {}), route: { type: "geojson", data: { type: "FeatureCollection", features: [] } }, walked: { type: "geojson", data: { type: "FeatureCollection", features: [] }, tolerance: 0.6 }, ...src },
    layers: L, ...(dem ? { terrain: { source: "dem", exaggeration } } : {}), sky: Lt.sky,
  };
  const map = new maplibregl.Map({ container: box, style, attributionControl: false, interactive: false, maxPitch: 80, fadeDuration: 0, pixelRatio: Math.min(nav ? 2 : 1.5, devicePixelRatio || 1), canvasContextAttributes: { antialias: nav }, maxTileCacheSize: 80 });
  // the signs, as the map draws them (glmap.js icon(): the same family)
  map.on("styleimagemissing", (e) => {
    const id = e.id;
    if (map.hasImage(id)) return;
    const k = 3, B = 32, c = new OffscreenCanvas(B * k, B * k), g = c.getContext("2d");
    g.scale(k, k);
    if (id === "parking-hi") drawMapSign(g, "parking", B / 2, B / 2, 16 * 1.2, false);
    else { const m = /^(.*)@([dn])$/.exec(id), key = m ? m[1] : id; drawMapSign(g, key, B / 2, B / 2, 16, false); }
    map.addImage(id, g.getImageData(0, 0, B * k, B * k), { pixelRatio: k });
  });
  let pendingWalked = null;
  let loaded = false, pendingGeo = null, alpha = nav ? 0.35 : 0.8, frames = 0, lightNow = Lt;
  map.on("load", () => { loaded = true; if (pendingGeo) map.getSource("route")?.setData(pendingGeo); if (pendingWalked) map.getSource("walked")?.setData(pendingWalked); onChange(); });
  map.on("idle", () => onChange());
  map.on("render", () => { frames++; });
  const paint = (id, prop, val) => { try { if (map.getLayer(id)) map.setPaintProperty(id, prop, val); } catch { /* (a property this engine does not know) */ } };
  return {
    get ready() { return loaded; },
    get frames() { return frames; },
    get map() { return map; },
    get light() { return lightNow; },
    setRoute(geo) { pendingGeo = geo; if (loaded) map.getSource("route")?.setData(geo); },
    /** A replay's walked part (its own source: the route ahead stays as it is). */
    setWalked(geo) { pendingWalked = geo; if (loaded) map.getSource("walked")?.setData(geo); },
    /** The other trails' opacity (faint between junctions, clear at one). */
    setTrails(a) {
      if (!loaded || Math.abs(a - alpha) < 0.03) return;
      alpha = a; for (const p of P) paint(`trail:${p.id}`, "line-opacity", a);
    },
    /** A new light (core/sun.js lightFor): the ground's colours, the relief's shadow and light and its side, the sky. */
    setLight(l) {
      if (!loaded) return;
      lightNow = l;
      paint("bg", "background-color", l.bg);
      paint("shade", "hillshade-exaggeration", l.exag); paint("shade", "hillshade-shadow-color", l.shadow); paint("shade", "hillshade-highlight-color", l.light);
      paint("shade", "hillshade-illumination-direction", Math.round(l.dir) % 360);
      for (const p of P) {
        paint(`area:${p.id}`, "fill-color", ["match", C_, ...AREAS.flatMap((k) => [k, l.area[k]]), l.bg]);
        paint(`contour:${p.id}`, "line-color", l.contour); paint(`river:${p.id}`, "line-color", l.area.water);
        paint(`track:${p.id}`, "line-color", l.path); paint(`path:${p.id}`, "line-color", l.path);
        paint(`road-case:${p.id}`, "line-color", l.roadCase); paint(`road:${p.id}`, "line-color", l.road); paint(`lift:${p.id}`, "line-color", l.lift);
        for (const s of ["place", "pass", "poi"]) { paint(`${s}:${p.id}`, "text-color", l.label); paint(`${s}:${p.id}`, "text-halo-color", l.halo); }
      }
      try { map.setSky(l.sky); } catch { /* (no sky in this engine) */ }
    },
    setCamera(cam) {
      if (box.clientWidth !== map.getContainer().clientWidth || box.clientHeight !== map.getCanvas().clientHeight) map.resize();
      map.jumpTo(cam);
    },
    project(ll) { const q = map.project(ll); return [q.x, q.y]; },
    destroy() { map.remove(); box.remove(); },
  };
}
