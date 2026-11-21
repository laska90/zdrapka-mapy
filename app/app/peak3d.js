/* global maplibregl */
// Szczyty w aparacie, etap 3: the map engine's 3D terrain set to the camera's pose, drawing the chosen route
// on the ground behind the picture's overlays. The engine gives what the hand drawing could only guess: the
// route lies on the slopes in true perspective (wide near, a hair far), and every ridge hides what lies behind
// it. The terrain comes from the app's own height grids (core/demtiles.js: tiles made on the spot, offline).
//
// The ground is drawn opaque in a key colour and cut out afterwards on the GPU (an invisible ground would show
// the tiles' skirts); what is left, the route (its colours and white edge, faint under the forest from the map),
// goes over the photo. Close to you (under the line NEAR m away, given by peakcam) the terrain is cut: there the
// grid knows no trees or houses and its skirts show; peakcam's thin line takes over.

import { demSource } from "./demsource.js";
import { observerHeight } from "../core/horizon.js";

const KEY = "#ff00ff", WAY_M = 5;

/**
 * host: the element to lay the picture in (under the overlay canvas). Returns
 * { setRoute(geojson, parts), setCamera({ground, obs, cam, cut}), ready, frames, destroy }; onReady(live) when
 * it starts or stops drawing (the caller redraws its own part).
 * geojson: LineStrings with properties.col (the colour) and .edge (white edge or not).
 */
export function createTerrain3d(host, before, onReady = () => {}) {
  const box = document.createElement("div"), out = document.createElement("canvas");
  box.style.cssText = "position:absolute;inset:0;visibility:hidden;pointer-events:none";
  out.id = "pc3d";
  out.style.cssText = "position:absolute;inset:0;width:100%;height:100%;pointer-events:none;filter:drop-shadow(0 0 1px rgba(255,255,255,.9)) drop-shadow(0 1px 2px rgba(0,0,0,.55))";
  host.insertBefore(box, before); host.insertBefore(out, before);
  let lastGround = null, map = null, styleKey = "", pending = null, frames = 0, live = false, cutY = null, lastCam = "";
  const gl = out.getContext("webgl", { premultipliedAlpha: true, alpha: true, preserveDrawingBuffer: true });
  const prog = gl && keyProgram(gl);

  function ensureMap(ground, parts) {
    // (a finer ground than the tiles were made from, the 30 m one near you once it is there: new tiles)
    if (map && ground !== lastGround) map.getSource("dem")?.setTiles(demSource(ground).tiles);
    lastGround = ground;
    const sk = (parts || []).map((p) => p.id).join(",");
    if (map && sk === styleKey) return;
    styleKey = sk;
    const forest = (parts || []).map((p) => ({ src: `v:${p.id}`, id: p.id, spec: p }));
    const sources = { dem: demSource(ground), way: { type: "geojson", data: pending?.geo || empty() } };
    for (const f of forest) sources[f.src] = f.spec.tiles ? { type: "vector", tiles: f.spec.tiles, minzoom: f.spec.minzoom, maxzoom: f.spec.maxzoom, bounds: f.spec.bounds } : { type: "vector", url: f.spec.url };
    const area = (id, op) => forest.map((f) => ({ id: `${id}:${f.id}`, type: "fill", source: f.src, "source-layer": "area", filter: ["==", ["get", "c"], "forest"], paint: { "fill-color": KEY, "fill-opacity": op, "fill-antialias": false } }));
    const style = {
      version: 8, sources,
      layers: [
        { id: "bg", type: "background", paint: { "background-color": KEY } },
        // (one colour, no white edge: where two colours blend at an edge the key cut cannot tell them apart;
        // the shadow under the whole layer, a CSS filter, keeps it readable on the photo)
        { id: "way", type: "line", source: "way", layout: { "line-join": "round", "line-cap": "round" }, paint: { "line-color": ["get", "col"], "line-width": 4 } },
        // (in the forest the colour half there: under the trees, but you know where)
        ...area("forest", 0.55),
      ],
      terrain: { source: "dem", exaggeration: 1 },
    };
    if (map) { map.setStyle(style); return; }
    map = new maplibregl.Map({ container: box, style, attributionControl: false, interactive: false, maxPitch: 180, centerClampedToGround: false, fadeDuration: 0, pixelRatio: Math.min(2, devicePixelRatio || 1), canvasContextAttributes: { preserveDrawingBuffer: true, antialias: true } });
    map.on("render", keyOut);
  }

  // the key colour out (on the GPU): each pixel read as one of the route's colours mixed with the key
  function keyOut() {
    if (!map || !gl || !prog) return;
    const src = map.getCanvas();
    if (out.width !== src.width || out.height !== src.height) { out.width = src.width; out.height = src.height; }
    gl.viewport(0, 0, out.width, out.height);
    gl.useProgram(prog.p);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, prog.tex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, prog.cut);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    if (cutY) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, cutY.length / 4, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, cutY);
    gl.uniform1i(prog.uT, 0); gl.uniform1i(prog.uC, 1); gl.uniform1f(prog.uHasCut, cutY ? 1 : 0);
    gl.uniform3fv(prog.uPal, prog.pal);
    gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    frames++;
    const was = live;
    live = !!pending?.geo?.features?.length && map.areTilesLoaded();
    if (live !== was) onReady(live); // (the hand drawing steps back, or in again)
  }

  return {
    get ready() { return live; },
    get frames() { return frames; },
    /** The route (GeoJSON) and the map's parts (for the forest); null: nothing to draw. */
    setRoute(geo, parts, ground) {
      pending = { geo };
      out.hidden = !geo;
      if (!geo) { live = false; return; }
      ensureMap(ground, parts);
      setColours(geo);
      const s = map.getSource("way");
      if (s) s.setData(geo); else map.once("styledata", () => map.getSource("way")?.setData(geo));
    },
    /** The camera: where you stand (obs on ground), its pose and field (cam, as peakcam's), the near cut
     * (cut: per screen column, the y under which the terrain is not drawn; null: none). */
    setCamera({ ground, obs, cam, cut }) {
      if (!map || out.hidden) return;
      const W = cam.width, H = cam.height;
      if (box.clientWidth !== W || box.clientHeight !== H) map.resize();
      const vfov = (2 * Math.atan(Math.tan((cam.hfov * Math.PI) / 360) * (H / W)) * 180) / Math.PI;
      const sig = [obs.lat, obs.lon, cam.heading, cam.pitch, cam.roll, vfov, W, H].map((v) => (+v).toFixed(3)).join();
      cutY = cut ? encodeCut(cut, H) : null;
      if (sig === lastCam) { map.triggerRepaint(); return; }
      lastCam = sig;
      map.setVerticalFieldOfView(vfov);
      // (on the map's own ground mesh, coarser than the grid: a camera under it sees the tiles from below)
      const mesh = map.queryTerrainElevation?.([obs.lon, obs.lat]);
      const alt = Math.max(observerHeight(ground, obs), mesh != null ? mesh + (obs.eye ?? 1.7) : -1e9);
      map.jumpTo(map.calculateCameraOptionsFromCameraLngLatAltRotation([obs.lon, obs.lat], alt, cam.heading, 90 + cam.pitch, -(cam.roll || 0)));
      // the line as wide as a path seen from afar, in metres on the ground (the engine's widths are pixels
      // at its own reference distance): perspective then comes by itself, ~6 px a kilometre away
      const mpp = (40075016.686 * Math.cos((obs.lat * Math.PI) / 180)) / (512 * 2 ** map.getZoom());
      map.setPaintProperty("way", "line-width", WAY_M / mpp);

    },
    destroy() { map?.remove(); map = null; box.remove(); out.remove(); live = false; },
  };

  function setColours(geo) {
    // the colours the key test knows: the route's own and white
    const cols = new Set(geo.features.map((f) => f.properties.col));
    const pal = [...cols].slice(0, 8);
    while (pal.length < 8) pal.push(pal[0]);
    prog && (prog.pal = new Float32Array(pal.flatMap((h) => [1, 3, 5].map((k) => parseInt(h.slice(k, k + 2), 16)))));
  }
}

const empty = () => ({ type: "FeatureCollection", features: [] });

/** The cut line as a 1-row texture: per column (left to right) the y (0..1 of the height, 16 bits in R, G). */
function encodeCut(cut, H) {
  const n = cut.length, a = new Uint8Array(n * 4);
  for (let i = 0; i < n; i++) {
    const v = Math.round(Math.max(0, Math.min(1, cut[i] / H)) * 65535);
    a[i * 4] = v >> 8; a[i * 4 + 1] = v & 255; a[i * 4 + 3] = 255;
  }
  return a;
}

function keyProgram(gl) {
  const vs = `attribute vec2 p; varying vec2 v; void main(){ v = (p + 1.0) * 0.5; gl_Position = vec4(p, 0.0, 1.0); }`;
  const fs = `precision mediump float; varying vec2 v; uniform sampler2D t; uniform sampler2D c; uniform float hasCut; uniform vec3 pal[8];
  void main(){
    vec2 uv = vec2(v.x, 1.0 - v.y); // (from the top)
    if (hasCut > 0.5) { vec4 q = texture2D(c, vec2(uv.x, 0.5)); float y = (q.r * 255.0 * 256.0 + q.g * 255.0) / 65535.0; if (uv.y > y) { gl_FragColor = vec4(0.0); return; } }
    vec4 tx = texture2D(t, vec2(uv.x, 1.0 - uv.y));
    if (tx.a < 0.04) { gl_FragColor = vec4(0.0); return; } // (above the terrain: nothing drawn)
    vec3 p = tx.rgb / tx.a * 255.0;
    if (p.r > 235.0 && p.b > 235.0 && p.g < 25.0) { gl_FragColor = vec4(0.0); return; }
    vec3 K = vec3(255.0, 0.0, 255.0); float best = 1e9; vec3 bt = vec3(0.0); float bk = 0.0;
    for (int i = 0; i < 8; i++) { vec3 tt = pal[i]; vec3 vv = K - tt; float k = clamp(dot(p - tt, vv) / max(dot(vv, vv), 1.0), 0.0, 1.0); vec3 e = p - (tt + k * vv); float ee = dot(e, e); if (ee < best) { best = ee; bt = tt; bk = k; } }
    if (bk > 0.97) { gl_FragColor = vec4(0.0); return; }
    float a = (1.0 - bk) * tx.a; gl_FragColor = vec4(bt / 255.0 * a, a);
  }`;
  const sh = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)); return s; };
  const p = gl.createProgram();
  gl.attachShader(p, sh(gl.VERTEX_SHADER, vs)); gl.attachShader(p, sh(gl.FRAGMENT_SHADER, fs)); gl.linkProgram(p);
  const buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  const loc = gl.getAttribLocation(p, "p"); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
  const tex = () => { const t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t); for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, gl.NEAREST], [gl.TEXTURE_MAG_FILTER, gl.NEAREST], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, k, v); return t; };
  return { p, tex: tex(), cut: tex(), uT: gl.getUniformLocation(p, "t"), uC: gl.getUniformLocation(p, "c"), uHasCut: gl.getUniformLocation(p, "hasCut"), uPal: gl.getUniformLocation(p, "pal"), pal: new Float32Array(24) };
}
