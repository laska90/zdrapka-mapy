// Szczyty w aparacie: the camera's picture with the names of the summits you see.
// No image recognition: where you stand (GPS) and where the phone points (compass,
// tilt) on the height grid (core/horizon.js). The compass is off by a few degrees:
// a sideways drag shifts the names onto the hills (the shift is kept until you close). In the app the
// picture corrects it itself: a sky model (ZdrapkaCam.sky, native) finds the skyline, laid on the grid's
// horizon (core/skyline.js); the tilt is taken always, the heading only when the skyline has a shape.
//
// Every source can be swapped for tests and for trying it at home (localStorage
// "zdrapka.cam" as JSON, or the same keys in the page's URL as cam.<key>):
//   at:  "Śnieżka" | "50.736,15.739"   stand there instead of the GPS position (Teleport)
//   dir: "90,0,0"                       heading, pitch, roll instead of the phone's sensors
//   img: <url>                          this picture instead of the camera
//   dem: <url>                          the height grid (default: DEM_URL)
//   eye: 1.7                            eye height over the ground (m): a lookout tower's platform
//   fov: 66                             the camera's field of view along the picture's long side

import { skyFromMask, matchSky } from "../core/skyline.js";
import { decodeDem, panorama, visiblePeaks, horizonAt, project, unproject, cameraPose, cameraPoseFromMatrix, depthRows, wayView, smoothPose, nearGround, distance, destination, groundAt } from "../core/horizon.js";
import { createTerrain3d } from "./peak3d.js";
import { saveCase, countCases, casesZip, clearCases } from "./caserec.js";
import { peakList } from "./peaks.js";
import { kpiRow } from "./kpi.js";
import { isNative, native } from "./native.js";
import { projector, unprojector } from "../core/pack.js";
import { TC } from "./glstyle.js";
import { state } from "./state.js";

// the height grid: on its own branch of the maps repository (not on its Pages site: that is near its size
// limit), read once and kept in the app's cache (offline in the mountains)
export const DEM_URL = "https://raw.githubusercontent.com/laska90/zdrapka-mapy/horizon/sudety.hdem.gz";
const DEM_CACHE = "zdrapka-horizon-v1";
let PEAKS = [];
const km = (d) => (d < 10000 ? (d / 1000).toFixed(1).replace(".", ",") : String(Math.round(d / 1000)));
/** A label's size by its summit's distance: 1.2 up to 3 km, 1 at ~12 km, down to 0.78 at 60 km and beyond (log scale). */
export const labelScale = (d) => Math.max(0.78, Math.min(1.2, 1.2 - 0.32 * Math.log10(Math.max(1, d / 3000))));
const DIRS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];

/** The overrides: localStorage "zdrapka.cam" (JSON), then the page's cam.<key> parameters. */
export function camOverrides() {
  let o = {};
  try { o = JSON.parse(localStorage.getItem("zdrapka.cam") || "{}") || {}; } catch { /* none */ }
  try { for (const [k, v] of new URL(location.href).searchParams) if (k.startsWith("cam.")) o[k.slice(4)] = v; } catch { /* no URL */ }
  return o;
}

/** "Śnieżka" or "lat,lon" -> {name, lat, lon, ground?} (a summit: on its height), or null. */
export function teleport(at) {
  if (!at) return null;
  const p = PEAKS.find((q) => q.name === at);
  if (p) return { name: p.name, lat: p.lat, lon: p.lon, ground: p.ele };
  const [lat, lon] = String(at).split(",").map(Number);
  return Number.isFinite(lat) && Number.isFinite(lon) ? { name: `${lat.toFixed(4)}, ${lon.toFixed(4)}`, lat, lon } : null;
}

let demCache = null; // {url, dem}: one grid in memory (~35 MB), kept between openings

export async function loadDem(url, onStatus) {
  if (demCache?.url === url) return demCache.dem;
  let r = null, cache = null;
  try { cache = await caches.open(DEM_CACHE); r = await cache.match(url); } catch { /* no Cache API */ }
  if (!r) {
    onStatus?.("Pobieram mapę terenu (16 MB, raz)…");
    r = await fetch(url);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    if (cache) { await cache.put(url, r.clone()).catch(() => {}); }
  }
  let buf = await r.arrayBuffer();
  const h = new Uint8Array(buf, 0, 2);
  if (h[0] === 0x1f && h[1] === 0x8b) buf = await new Response(new Blob([buf]).stream().pipeThrough(new DecompressionStream("gzip"))).arrayBuffer();
  const dem = decodeDem(buf);
  demCache = { url, dem };
  return dem;
}

export function createPeakcam(C) {
  const $ = (id) => document.getElementById(id);
  const root = $("peakcam"), video = $("pcvideo"), photo = $("pcphoto"), cv = $("pccanvas"), ctx2 = cv.getContext("2d");
  let open = false, raf = 0, stream = null, o = {}, obs = null, dem = null, pano = null, peaks = [];
  let pose = null, fixedPose = null, offset = 0, pitchOff = 0, drag = null, gpsWatch = null, lastObsKey = "";
  let edge = null, clock = null, markMode = "time", markHits = [], hidCv = null, lastPlaces = [], frame = null, shown = new Map(), hits = [], sel = null, routeSeq = 0, lastRoute = null, way = null, lastMs = 0, activeWay = null;

  const status = (t) => { $("pcstatus").textContent = t || ""; $("pcstatus").hidden = !t; };

  // ---- where the picture looks. Two readings: the compass one (absolute: north, but it jumps by a few
  // degrees near metal) and the gyroscope one (relative: smooth, no jumps, drifts ~1° in minutes). Until
  // you correct it with a drag: the compass. After the drag the view is anchored: the gyroscope turns
  // it from where you put it, the compass no longer pulls it. A tap on the pill: back to the compass.
  let absRaw = null, relRaw = null, anchor = null, lastFix = null, lastCam = null; // anchor: the gyroscope's heading + delta = the compass's at the drag
  const angle = () => screen.orientation?.angle ?? 0;
  function onAbs(e) {
    if (e.alpha == null || !(e.absolute || e.type === "deviceorientationabsolute")) return;
    useAbs(cameraPose(e.alpha, e.beta ?? 0, e.gamma ?? 0, angle()));
  }
  function useAbs(p) { absRaw = p; if (anchor == null || !relRaw) step(absRaw); }
  function useRel(p) { relRaw = p; if (anchor != null) step({ ...relRaw, heading: (relRaw.heading + anchor + 360) % 360 }); }
  function onRel(e) {
    if (e.alpha == null || e.absolute) return;
    useRel(cameraPose(e.alpha, e.beta ?? 0, e.gamma ?? 0, angle()));
  }

  // In the app: the same two readings straight from Android (ZdrapkaCam: rotation matrices at ~50 Hz, the
  // compass's estimated error), and the camera's real field of view; in a browser: the page's events.
  let camPlugin = null, camSub = null, optics = null, headAcc = -1;
  async function nativeSensors() {
    if (!isNative()) return false;
    try {
      await native();
      const C = globalThis.Capacitor, reg = C?.registerPlugin || globalThis.capacitorExports?.registerPlugin;
      camPlugin ||= C?.Plugins?.ZdrapkaCam || (reg ? reg("ZdrapkaCam") : null);
      if (!camPlugin?.start) return false;
      optics ||= await camPlugin.optics().catch(() => null);
      camSub = await camPlugin.addListener("orient", (r) => {
        if (!open) return;
        if (r.abs) useAbs(cameraPoseFromMatrix(r.abs, angle()));
        if (r.rel) useRel(cameraPoseFromMatrix(r.rel, angle()));
        headAcc = r.acc ?? -1;
      });
      const got = await camPlugin.start();
      return !!got?.abs;
    } catch { return false; }
  }
  function step(raw) { pose = smoothPose(pose, raw); queue(); }
  /** Anchor where the picture looks now (the compass's heading, as smoothed), from the gyroscope on. */
  function anchorHere() {
    if (anchor != null || !relRaw || !pose) return;
    anchor = (((pose.heading - relRaw.heading) % 360) + 360) % 360;
  }
  const absEvent = () => ("ondeviceorientationabsolute" in globalThis ? "deviceorientationabsolute" : "deviceorientation");

  // ---- where you stand: Teleport, else the GPS
  function setObserver(p) {
    if (!p) return;
    const key = `${p.lat.toFixed(4)},${p.lon.toFixed(4)}`; // (a new panorama every ~10 m, not on each fix)
    if (key === lastObsKey) return;
    lastObsKey = key; obs = { eye: +o.eye || 1.7, ...p }; compute();
  }
  function startGps() {
    const f = C.gps?.fix;
    if (f && Date.now() - f.t < 120000) setObserver({ lat: f.lat, lon: f.lon, name: "" });
    if (!navigator.geolocation) { status("Ten telefon nie udostępnia lokalizacji."); return; }
    if (!obs) status("Szukam pozycji…");
    gpsWatch = navigator.geolocation.watchPosition((g) => { lastFix = { acc: g.coords.accuracy, alt: g.coords.altitude, altAcc: g.coords.altitudeAccuracy, t: g.timestamp }; setObserver({ lat: g.coords.latitude, lon: g.coords.longitude, name: "" }); },
      (e) => { if (!obs) status(e.code === 1 ? "Brak zgody na lokalizację." : "Lokalizacja niedostępna."); },
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 30000 });
  }

  // ---- the ground near you from the map's contour lines (finer than the grid: near hills keep their
  // height and shape), rebuilt when you are 500 m from where it was made; the panorama again when it comes
  let fine = null, nearAt = null, nearSeq = 0;
  async function nearFor(at) {
    const meta = C.view?.meta;
    if (!meta || !C.call || (nearAt && distance(nearAt.lat, nearAt.lon, at.lat, at.lon) < 500)) return;
    nearAt = { lat: at.lat, lon: at.lon };
    const my = ++nearSeq, P = projector(meta), U = unprojector(meta), [x, y] = P(at.lon, at.lat), R = 3200;
    const r = await C.call("contours", { x0: x - R, y0: y - R, x1: x + R, y1: y + R }).catch(() => null);
    if (my !== nearSeq || !open || !r?.lines?.length) return;
    const t0 = performance.now();
    const lines = r.lines.map((L) => { const pts = new Array(L.xs.length); for (let i = 0; i < L.xs.length; i++) pts[i] = U(L.xs[i], L.ys[i]); return { e: L.e, pts }; });
    fine = { ...dem, nearGrid: nearGround(dem, at, lines, { R: 3000, cell: 30 }) };
    nearMs = performance.now() - t0;
    compute();
  }
  let nearMs = 0;

  // ---- the panorama and the summits seen from obs
  function compute() {
    if (!dem || !obs) return;
    const ground = fine && nearAt && distance(nearAt.lat, nearAt.lon, obs.lat, obs.lon) < 1500 ? fine : dem;
    nearFor(obs);
    pano = panorama(ground, obs, { ridges: true });
    if (!pano) { peaks = []; status("Tu nie ma mapy terenu (na razie Sudety)."); queue(); return; }
    const t0 = performance.now();
    peaks = visiblePeaks(ground, obs, PEAKS.filter((p) => p.name !== obs.name && Math.abs(p.lat - obs.lat) + Math.abs(p.lon - obs.lon) > 0.003), { pano });
    lastMs = performance.now() - t0;
    // the active route (you walk it): on the picture too, from where you stand now
    const ar = C.planner?.activeRoute?.();
    activeWay = ar?.legs?.length && C.view?.meta ? wayOf(ar, C.view.meta, ground) : null;
    activeGeo = activeWay ? wayGeo(ar, C.view.meta) : null; show3d();
    status(""); queue();
  }

  // ---- the picture: the camera, a photo, or (neither) the terrain drawn from the grid
  async function startPicture() {
    video.hidden = photo.hidden = true; root.classList.remove("live");
    if (o.img) { photo.src = o.img; photo.hidden = false; root.classList.add("live"); return; }
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment", width: { ideal: 1920 } }, audio: false });
      if (!open) { stopPicture(); return; }
      video.srcObject = stream; video.hidden = false; root.classList.add("live");
      await video.play().catch(() => {});
    } catch { /* no camera (or no permission): the terrain drawn instead */ }
  }
  function stopPicture() { stream?.getTracks().forEach((t) => t.stop()); stream = null; video.srcObject = null; }

  /** The horizontal field of view on the screen: the picture fills it (cover), the camera's long side spans fov. */
  function screenFov(W, H) {
    const F = +o.fov || optics?.fovLong || 66;
    const src = !video.hidden && video.videoWidth ? [video.videoWidth, video.videoHeight] : !photo.hidden && photo.naturalWidth ? [photo.naturalWidth, photo.naturalHeight] : null;
    if (!src) return Math.min(70, 2 * Math.atan(Math.tan((F * Math.PI) / 360) * (W / Math.max(W, H))) * 180 / Math.PI) || 50;
    const [vw, vh] = src, s = Math.max(W / vw, H / vh), f = (Math.max(vw, vh) / 2) / Math.tan((F * Math.PI) / 360) * s;
    return (2 * Math.atan(W / 2 / f) * 180) / Math.PI;
  }

  // ---- a test case from the field (caserec.js): ● saves the picture as it is, with all the app knows now;
  // a long press shares all those saved (one zip) and offers to clear them
  async function recCount() { try { const n = await countCases(); $("pcrecn").textContent = n ? String(n) : ""; } catch { /* no storage */ } }
  async function recCase() {
    const src = !video.hidden && video.videoWidth ? video : !photo.hidden && photo.naturalWidth ? photo : null;
    if (!src || !obs || !lastCam) { C.toast("Nie ma jeszcze obrazu albo pozycji.", 2500); return; }
    const w = src.videoWidth || src.naturalWidth, h = src.videoHeight || src.naturalHeight, c = document.createElement("canvas");
    c.width = w; c.height = h; c.getContext("2d").drawImage(src, 0, 0, w, h);
    const jpg = await new Promise((ok) => c.toBlob(ok, "image/jpeg", 0.92));
    const t = new Date(), stamp = t.toISOString().replace(/[-:]/g, "").replace(/\..*/, "").replace("T", "-");
    const r6 = (v) => (v == null ? null : Math.round(v * 1e6) / 1e6), r2 = (v) => (v == null ? null : Math.round(v * 100) / 100);
    const P = (p) => (p ? { heading: r2(p.heading), pitch: r2(p.pitch), roll: r2(p.roll) } : null);
    const F = +o.fov || optics?.fovLong || 66;
    const meta = {
      kind: "zdrapka-case", v: 1, time: t.toISOString(), img: `case-${stamp}.jpg`,
      // what the test sets take (test/near/cases.json): where, how high the eye, where the picture looked, its field
      at: [r6(obs.lat), r6(obs.lon)], eye: obs.eye, dir: [r2(lastCam.heading), r2(lastCam.pitch), r2(lastCam.roll)], fov: r2(F),
      frame: [w, h], screen: { w: cv.clientWidth, h: cv.clientHeight, angle: angle() },
      // where that came from: the GPS (or Teleport), the sensors as they read, the corrections on top
      gps: lastFix ? { acc: r2(lastFix.acc), alt: r2(lastFix.alt), altAcc: r2(lastFix.altAcc), age: Date.now() - lastFix.t } : null,
      teleport: !!o.at, ground: pano?.h0 != null ? r2(pano.h0 - obs.eye) : null,
      sensors: { pose: P(fixedPose || pose), abs: P(absRaw), rel: P(relRaw), anchor: r2(anchor), compassErr: headAcc >= 0 ? r2(headAcc) : null, native: !!camSub },
      optics: optics || null, corrections: { heading: r2(offset), pitch: r2(pitchOff), sky: sky ? { ...sky } : null },
      peak: sel ? { name: sel.name, lat: r6(sel.lat), lon: r6(sel.lon), ele: sel.ele } : null,
      route: lastRoute ? { km: r2(lastRoute.km), up: Math.round(lastRoute.up ?? 0) } : null,
    };
    await saveCase(jpg, meta);
    const b = $("pcrec"); b.classList.add("flash"); setTimeout(() => b.classList.remove("flash"), 250);
    await recCount();
    C.toast(`Zapisano przypadek testowy (${$("pcrecn").textContent}). Przytrzymaj ●, żeby wysłać.`, 3500);
    return meta;
  }
  async function recShare() {
    const { blob, n } = await casesZip();
    if (!n) { C.toast("Nie ma zapisanych przypadków.", 2500); return; }
    const d = new Date().toISOString().slice(0, 10);
    await C.shareBlob(blob, `zdrapka-przypadki-${d}.zip`, "Przypadki testowe: Szczyty w aparacie");
    if (confirm(`Usunąć ${n} wysłanych przypadków z telefonu?`)) { await clearCases(); await recCount(); }
  }
  {
    const b = $("pcrec");
    let hold = 0, held = false;
    b.addEventListener("pointerdown", () => { held = false; hold = setTimeout(() => { held = true; recShare().catch((e) => C.toast("Nie udało się: " + (e?.message || e), 5000)); }, 650); });
    const up = () => clearTimeout(hold);
    b.addEventListener("pointerup", up); b.addEventListener("pointerleave", up); b.addEventListener("pointercancel", up);
    b.addEventListener("click", () => { if (!held) recCase().catch((e) => C.toast("Nie udało się zapisać: " + (e?.message || e), 5000)); });
  }

  // ---- the picture's own skyline (the sky model): every few seconds while the phone is still, the frame
  // goes to ZdrapkaCam.sky (native ncnn, ~0.2 s), its sky mask's lower edge is laid on the grid's horizon
  // at the pose the frame was taken with; the tilt is corrected always, the heading only when the fit is
  // sure (a skyline with a shape: one fit stands out). A drag of yours holds the heading; the pill: both
  // back to the sensors. (Tests and the browser: globalThis.__skyMask(canvas) -> {mask, size} instead.)
  let sky = null, skyTimer = 0, skyBusy = false, autoHold = false;
  const SKY_SIZE = 192, SKY_EVERY = 3000;
  function skyLoop() {
    clearTimeout(skyTimer);
    if (!open) return;
    skyTimer = setTimeout(async () => { await skyOnce().catch(() => null); skyLoop(); }, sky ? SKY_EVERY : 1200);
  }
  async function skyMaskOf(canvas) {
    if (globalThis.__skyMask) return globalThis.__skyMask(canvas);
    if (!isNative()) return null;
    await native();
    const Cap = globalThis.Capacitor, reg = Cap?.registerPlugin || globalThis.capacitorExports?.registerPlugin;
    camPlugin ||= Cap?.Plugins?.ZdrapkaCam || (reg ? reg("ZdrapkaCam") : null);
    if (!camPlugin?.sky) return null;
    const r = await camPlugin.sky({ jpeg: canvas.toDataURL("image/jpeg", 0.9).split(",")[1], size: SKY_SIZE });
    const bin = atob(r.mask), m = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) m[i] = bin.charCodeAt(i);
    return { mask: m, size: r.size, ms: r.ms };
  }
  async function skyOnce() {
    if (!open || skyBusy || !pano || drag || globalThis.__skyHold) return null;
    const src = !video.hidden && video.videoWidth ? video : !photo.hidden && photo.naturalWidth ? photo : null;
    if (!src) return null;
    const w0 = src.videoWidth || src.naturalWidth, h0 = src.videoHeight || src.naturalHeight, k = Math.min(1, 512 / Math.max(w0, h0));
    const c = document.createElement("canvas");
    c.width = Math.round(w0 * k); c.height = Math.round(h0 * k);
    c.getContext("2d").drawImage(src, 0, 0, c.width, c.height);
    const p0 = fixedPose || pose;
    if (!p0) return null;
    const at = { heading: p0.heading + offset, pitch: p0.pitch + pitchOff, roll: p0.roll }, t0 = performance.now();
    skyBusy = true;
    let m;
    try { m = await skyMaskOf(c); } finally { skyBusy = false; }
    if (!m || !open || drag) return null;
    // the phone turned while the model ran: the frame no longer matches the pose
    const p1 = fixedPose || pose;
    if (Math.abs(((p1.heading - p0.heading + 540) % 360) - 180) > 1.5 || Math.abs(p1.pitch - p0.pitch) > 1) return (sky = { ...sky, moved: true }), null;
    // the frame's own camera: the long side spans the camera's field of view
    const F = +o.fov || optics?.fovLong || 66, w = 200, h = Math.round((200 * c.height) / c.width);
    const hfov = c.width >= c.height ? F : (2 * Math.atan(Math.tan((F * Math.PI) / 360) * (c.width / c.height)) * 180) / Math.PI;
    const prob = Float32Array.from(m.mask, (v) => v / 255);
    const line = skyFromMask(prob, m.size, m.size, w, h);
    const r = matchSky(line, w, h, pano, { ...at, hfov });
    sky = { at: Date.now(), ms: Math.round(performance.now() - t0), model: m.ms, ...(r || { sure: false, pitchSure: false }), n: (sky?.n || 0) + 1 };
    if (!r) return sky;
    if (r.pitchSure) pitchOff += r.dp;
    if (r.sure && !autoHold) { offset += r.dh; if (!fixedPose) anchorHere(); }
    queue();
    return sky;
  }

  // ---- drawing
  function queue() { if (open && !raf) raf = requestAnimationFrame(draw); }
  function draw() {
    raf = 0;
    const dpr = devicePixelRatio || 1, W = cv.clientWidth, H = cv.clientHeight;
    if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(H * dpr)) { cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); }
    ctx2.setTransform(dpr, 0, 0, dpr, 0, 0); ctx2.clearRect(0, 0, W, H);
    const p = fixedPose || pose || { heading: 0, pitch: 0, roll: 0 };
    const cam = { heading: (p.heading + offset + 360) % 360, pitch: p.pitch + pitchOff, roll: p.roll, hfov: screenFov(W, H), width: W, height: H };
    const deg = Math.round(cam.heading) % 360;
    // (the compass's own estimate of its error, when it is poor and the view not anchored: a drag helps)
    const loose = headAcc >= 12 && anchor == null && !fixedPose ? ` · kompas ±${Math.round(headAcc)}°` : "";
    const fit = sky && sky.at > Date.now() - 15000 && sky.sure ? " · horyzont ✓" : "";
    $("pchead").textContent = `${deg}° ${DIRS[Math.round(deg / 45) % 8]}${fit || loose}`;
    $("pcoff").hidden = Math.abs(offset) < 0.5 && anchor == null;
    $("pcoff").classList.toggle("anch", anchor != null);
    $("pcofft").textContent = `${offset >= 0 ? "+" : "−"}${Math.abs(offset).toFixed(0)}°`;
    if (!pano) return;
    const live = root.classList.contains("live");
    $("pcrec").hidden = !live;
    // the skyline across the frame (and a little past its edges, for a turned phone)
    const line = [], span = cam.hfov / 2 + Math.abs(cam.roll) * 0.6 + 4;
    for (let a = cam.heading - span; a <= cam.heading + span; a += pano.step) {
      const q = project(a, horizonAt(pano, a), cam, { clip: false });
      if (q) line.push(q);
    }
    if (line.length > 1) {
      if (!live) { // no picture: the ground under the skyline, so you see the shapes
        ctx2.beginPath(); ctx2.moveTo(line[0].x, H + 400); for (const q of line) ctx2.lineTo(q.x, q.y); ctx2.lineTo(line.at(-1).x, H + 400); ctx2.closePath();
        const g = ctx2.createLinearGradient(0, 0, 0, H); g.addColorStop(0, "#3c4744"); g.addColorStop(1, "#1d2321"); ctx2.fillStyle = g; ctx2.fill();
      }
      if (!live) drawRidges(cam, span);
      ctx2.beginPath(); line.forEach((q, i) => (i ? ctx2.lineTo(q.x, q.y) : ctx2.moveTo(q.x, q.y)));
      // (on the picture the line is there to set the view by; once it is set, by the sky model or by your drag,
      // it steps back to a hint)
      const set = live && ((sky && sky.sure && sky.at > Date.now() - 30000) || anchor != null);
      ctx2.lineWidth = set ? 1 : 1.5; ctx2.strokeStyle = !live ? "rgba(255,255,255,.9)" : set ? "rgba(255,255,255,.28)" : "rgba(255,255,255,.75)";
      ctx2.shadowColor = "rgba(0,0,0,.45)"; ctx2.shadowBlur = live && !set ? 3 : 0; ctx2.stroke(); ctx2.shadowBlur = 0;
    }
    frame = { cam, way: [], labels: [], sky: line.map((q) => [Math.round(q.x), Math.round(q.y)]) };
    edge = null;
    lastCam = cam;
    if ((way || activeWay) && t3d) t3d.setCamera({ ground: fine || dem, obs, cam, cut: nearCut(cam, NEAR3D) });
    if (way || activeWay) drawWay(cam, way || activeWay);
    // the summits in the frame, named in rows by distance (planes of depth): near ones big and white in the
    // row just over the skyline, middle ones cream, far ones small and bluish at the top (the air between)
    const BANDS = [{ fs: 17, wt: 700, col: "#ffffff" }, { fs: 14.5, wt: 650, col: "#fff1d6" }, { fs: 12.5, wt: 600, col: "#d4e5ff" }];
    const band = (d) => (d < 8000 ? 0 : d < 16000 ? 1 : 2);
    const skyTop = line.length ? Math.min(...line.filter((q) => q.x >= 0 && q.x <= W).map((q) => q.y)) : H / 2;
    const rowH = 46, base = Math.max(108 + 2 * rowH, skyTop - 40), rowY = [base, base - rowH, base - 2 * rowH];
    const bottom = $("pccard").hidden ? H : $("pccard").getBoundingClientRect().top;
    const items = [];
    for (const pk of peaks) {
      // (a summit on the skyline sits on the drawn line: the grid rounds tops down, so its OSM height would float above it)
      const q = project(pk.az, pk.skyline ? Math.min(pk.angle, horizonAt(pano, pk.az)) : pk.angle, cam);
      if (!q || q.y > bottom - 8) continue;
      const bd = band(pk.dist), B = BANDS[bd];
      ctx2.font = `${B.wt} ${B.fs}px system-ui, sans-serif`;
      const tot = sel?.name === pk.name ? totalText() : "";
      const label = tot ? `${pk.name} · ${tot}` : pk.name;
      const sub = `${pk.ele} m · ${km(pk.dist)} km`, sfs = Math.round(B.fs * 0.68);
      const tw = ctx2.measureText(label).width + (sel?.name === pk.name ? 22 : 0);
      ctx2.font = `500 ${sfs}px system-ui, sans-serif`;
      const w = Math.max(tw, ctx2.measureText(sub).width);
      items.push({ pk, x: q.x, y: q.y, w, tw, sub, sfs, band: bd, name: pk.name, label, pri: (sel?.name === pk.name ? 100 : 0) + ((shown.get(pk.name) || 0) > 0 ? 3 : 0) + (pk.skyline ? 2 : 0) + (pk.ks ? 2.5 : 0) + pk.ele / 1000 + Math.min(1, pk.margin) - pk.dist / 100000 });
    }
    hits = [];
    const nowShown = new Map();
    for (const it of depthRows(items, { rowY, W })) {
      const on = sel && it.name === sel.name, B = BANDS[it.band];
      // (a label new on the screen fades in; one already there keeps its place: the +3 above)
      const a = Math.min(1, (shown.get(it.name) || 0) + 0.25);
      nowShown.set(it.name, a); ctx2.globalAlpha = a;
      ctx2.save(); ctx2.shadowColor = "rgba(0,0,0,.55)"; ctx2.shadowBlur = 3; ctx2.shadowOffsetY = 0.5;
      ctx2.strokeStyle = B.col; ctx2.globalAlpha = a * (it.band ? 0.7 : 0.85); ctx2.lineWidth = it.band ? 1 : 1.3;
      ctx2.beginPath(); ctx2.moveTo(it.x, it.ty + it.sfs + 7); ctx2.lineTo(it.x, it.y - 3); ctx2.stroke();
      ctx2.globalAlpha = a; ctx2.fillStyle = B.col; ctx2.beginPath(); ctx2.arc(it.x, it.y, 2.8 - it.band * 0.5, 0, Math.PI * 2); ctx2.fill();
      if (on) { ctx2.shadowBlur = 0; ctx2.fillStyle = "#5b2bd1"; roundRect(it.tx - it.tw / 2, it.ty - B.fs - 3, it.tw, B.fs + 11, (B.fs + 11) / 2); ctx2.fill(); ctx2.shadowBlur = 3; }
      ctx2.fillStyle = on ? "#fff" : B.col; ctx2.font = `${B.wt} ${B.fs}px system-ui, sans-serif`; ctx2.textAlign = "center"; ctx2.textBaseline = "alphabetic";
      ctx2.fillText(it.label, it.tx, it.ty);
      // its height and distance, small, under the name (the leader starts below them)
      ctx2.fillStyle = B.col; ctx2.globalAlpha = a * 0.78; ctx2.font = `500 ${it.sfs}px system-ui, sans-serif`;
      ctx2.fillText(it.sub, it.tx, it.ty + it.sfs + 3); ctx2.globalAlpha = a;
      ctx2.restore(); ctx2.globalAlpha = 1;
      hits.push({ name: it.name, x: it.x, y: it.y, tx: it.tx, ty: it.ty, w: it.w, fs: B.fs });
      if (on) frame.selLabel = it.label;
      frame.labels.push({ name: it.name, ele: it.pk.ele, dist: Math.round(it.pk.dist), x: Math.round(it.x), y: Math.round(it.y), sky: !!it.pk.skyline, ks: !!it.pk.ks });
    }
    shown = nowShown;
    if ([...nowShown.values()].some((a) => a < 1)) queue();
  }
  /** The nearer ridges' edges (no picture: they give the ground its shape), as fine dots that join into lines. */
  function drawRidges(cam, span) {
    const { ridgeAz: az, ridgeAngle: ang, step, n } = pano;
    if (!az?.length) return;
    const lower = (v) => { let lo = 0, hi = az.length; while (lo < hi) { const m = (lo + hi) >> 1; if (az[m] < v) lo = m + 1; else hi = m; } return lo; };
    ctx2.fillStyle = "rgba(255,255,255,.32)";
    const a0 = Math.floor((cam.heading - span) / step), a1 = Math.ceil((cam.heading + span) / step);
    for (let a = a0; a <= a1; a += 1) {
      const k = ((a % n) + n) % n;
      for (let i = lower(k); i < az.length && az[i] === k; i++) {
        const q = project(a * step, ang[i], cam);
        if (q) ctx2.fillRect(q.x - 0.6, q.y - 0.6, 1.2, 1.2);
      }
    }
  }
  function roundRect(x, y, w, h, r) { ctx2.beginPath(); ctx2.roundRect ? ctx2.roundRect(x, y, w, h, r) : ctx2.rect(x, y, w, h); }

  // ---- a sideways drag: the names move with the finger (the compass corrected)
  cv.addEventListener("pointerdown", (e) => { drag = { x: e.clientX, y: e.clientY, off: offset, moved: false }; cv.setPointerCapture(e.pointerId); });
  cv.addEventListener("pointermove", (e) => {
    if (!drag) return;
    if (!drag.moved && Math.hypot(e.clientX - drag.x, e.clientY - drag.y) < 8) return;
    drag.moved = true;
    const fov = screenFov(cv.clientWidth, cv.clientHeight);
    offset = drag.off - ((e.clientX - drag.x) * fov) / cv.clientWidth;
    if (!fixedPose && !pose) offset = ((offset + 540) % 360) - 180; // (no sensors: the drag turns you round)
    queue();
  });
  cv.addEventListener("pointerup", (e) => { const tap = drag && !drag.moved; if (drag?.moved) { anchorHere(); autoHold = true; } drag = null; if (tap) { const r0 = cv.getBoundingClientRect(), x = e.clientX - r0.left, y = e.clientY - r0.top; if (markHits.some((m) => Math.abs(x - m.x) <= m.w / 2 + 6 && Math.abs(y - m.y) <= m.h / 2 + 6)) { markMode = markMode === "time" ? "km" : "time"; queue(); } else { const h = hitAt(x, y); if (h && sel && h.name === sel.name && clock) { markMode = markMode === "time" ? "km" : "time"; queue(); } else pick(h); } } });
  cv.addEventListener("pointercancel", () => { drag = null; });
  $("pcoff").onclick = () => { offset = 0; pitchOff = 0; autoHold = false; anchor = null; if (absRaw) pose = { ...absRaw }; queue(); };
  $("pccx").onclick = () => pick(null);

  /** The whole way, by the chosen summit's name: its time, or its length (a tap on it or on a mark switches). */
  function totalText() {
    if (!clock) return "";
    return markMode === "time" ? `${Math.floor(clock.total / 60)}:${String(Math.round(clock.total % 60)).padStart(2, "0")} h` : `${clock.km.toFixed(1).replace(".", ",")} km`;
  }

  /** Time along the route (minutes at each profile point): Tobler's walking speed on each step of the
   * profile, scaled to the route's own time (your pace). {d: [], t: []} or null. */
  function routeClock(r, ms) {
    const P = r.P;
    if (!P?.d?.length || !ms) return null;
    const t = [0];
    for (let i = 1; i < P.d.length; i++) {
      const dx = Math.max(1, P.d[i] - P.d[i - 1]), h0 = P.h[i - 1], h1 = P.h[i];
      const dh = Number.isFinite(h0) && Number.isFinite(h1) ? h1 - h0 : 0;
      t.push(t[i - 1] + dx / 1000 / (6 * Math.exp(-3.5 * Math.abs(dh / dx + 0.05))));
    }
    const k = ms / 60000 / (t.at(-1) || 1);
    return { d: Array.from(P.d), t: t.map((v) => v * k), total: ms / 60000, km: r.km };
  }

  /** The route's runs (one kind of way each: its trail colours, "" off the trails), a point every ~25 m with
   * its height from the route's profile, seen from where you stand: [{cols, pts: [{az, angle, visible} | null]}]. */
  function wayOf(r, meta, ground = fine || dem) {
    const U = unprojector(meta), P = r.P, out = [];
    const hAt = (d) => {
      if (!P?.d?.length) return null;
      let lo = 0, hi = P.d.length - 1;
      while (hi - lo > 1) { const m = (lo + hi) >> 1; if (P.d[m] < d) lo = m; else hi = m; }
      const t = P.d[hi] > P.d[lo] ? (d - P.d[lo]) / (P.d[hi] - P.d[lo]) : 0;
      return Number.isFinite(P.h[lo]) && Number.isFinite(P.h[hi]) ? P.h[lo] + t * (P.h[hi] - P.h[lo]) : null;
    };
    let D = 0, px = null, py = null;
    for (const leg of r.legs || []) for (const run of leg.runs || []) {
      const L = run.line, pts = [];
      let next = D;
      for (let i = 0; i < L.length; i += 2) {
        const x = L[i], y = L[i + 1];
        if (px != null) D += Math.hypot(x - px, y - py);
        px = x; py = y;
        if (D >= next || i === 0 || i === L.length - 2) {
          const [lon, lat] = U(x, y);
          pts.push({ lat, lon, h: hAt(D), d: D }); next = D + 25;
        }
      }
      out.push({ cols: run.cols || "", pts: wayView(ground, obs, pts).map((v, i) => v && { ...v, d: pts[i].d, h: pts[i].h }) });
    }
    return out;
  }

  /** The route as GeoJSON for the 3D terrain (peak3d.js): one line per run, in its trail's (first) colour. */
  function wayGeo(r, meta) {
    const U = unprojector(meta), features = [];
    for (const leg of r.legs || []) for (const run of leg.runs || []) {
      const L = run.line, coords = [];
      for (let i = 0; i < L.length; i += 2) coords.push(U(L[i], L[i + 1]));
      if (coords.length > 1) features.push({ type: "Feature", properties: { col: TC[(run.cols || "").split(",")[0]] || AMBER }, geometry: { type: "LineString", coordinates: coords } });
    }
    return { type: "FeatureCollection", features };
  }

  // ---- etap 3: the route drawn by the map engine on its 3D terrain, set like the camera (peak3d.js); the
  // hand drawing below keeps what the engine cannot: the first kilometre, the hidden parts, marks, the flag.
  // (?cam.3d=0 / zdrapka.cam {"3d": 0}: off)
  // (the map engine from NEAR3D m: closer, its tiles' skirts show and the ground under you is the grid's guess)
  let t3d = null, selGeo = null, activeGeo = null;
  const NEAR3D = 250;
  function show3d() {
    const geo = way ? selGeo : activeWay ? activeGeo : null;
    if (o["3d"] === 0 || o["3d"] === "0" || typeof maplibregl === "undefined") return;
    if (!geo) { t3d?.setRoute(null); return; }
    try { t3d ||= createTerrain3d(root, cv, () => queue()); } catch { t3d = null; return; }
    t3d.setRoute(geo, C.view?.parts, fine || dem);
  }
  /** Per screen column (every 4 px) the y of the ground NEAR m away: the 3D terrain is cut under it. */
  function nearCut(cam, NEAR) {
    const ground = fine || dem, out = [], h0 = pano?.h0;
    if (h0 == null) return null;
    for (let x = 0; x < cam.width; x += 4) {
      const d = unproject(x + 2, cam.height / 2, cam);
      if (!d) { out.push(cam.height); continue; }
      const [la, lo] = destination(obs.lat, obs.lon, d.az, NEAR), gh = groundAt(ground, la, lo) ?? h0;
      const q = project(d.az, (Math.atan2(gh - h0, NEAR) * 180) / Math.PI, cam, { clip: false });
      out.push(q ? q.y : cam.height);
    }
    return out;
  }

  /**
   * The route on the picture, as a path on the ground seen in perspective: wide near you, a hair far
   * away (width by distance), smoothed on the screen (no 25 m jitter), drawn far parts first so near ones
   * lie over them. One amber band (as the plan on the map) with the trails' colours as a stripe inside
   * where it is wide enough to read; a soft dark shadow under it instead of a sticker-like white edge;
   * chevrons along the near part (which way); behind a ridge only a faint ghost of it; a pin at the end.
   */
  const AMBER = "#f2a33a";
  function drawWay(cam, ways) {
    edgeHint(cam, ways);
    // 1. the points in route order, projected; a break where a point leaves the picture
    const pieces = [];
    let cur = [];
    const cut = () => { if (cur.length > 1) pieces.push(cur); cur = []; };
    for (const w of ways) {
      const cols = w.cols ? w.cols.split(",").map((c) => TC[c] || AMBER) : null;
      for (const p of w.pts) {
        // (one unbroken line: every point, seen or not; a break only behind the camera)
        // (the first few hundred metres, beside or behind you, would sweep across the whole picture: only in the frame)
        const q = p && p.dist > 60 ? project(p.az, p.angle, cam, { clip: p.dist < 500 }) : null;
        if (!q || Math.abs(q.x - cam.width / 2) > cam.width * 4 || q.y > cam.height * 4) { cut(); continue; }
        cur.push({ x: q.x, y: q.y, v: p.visible, r: p.dist, cols, d: p.d });
        frame.way.push({ x: Math.round(q.x), y: Math.round(q.y), v: p.visible, c: w.cols, d: Math.round(p.d), h: p.h == null ? null : Math.round(p.h), az: +p.az.toFixed(2), r: Math.round(p.dist) });
      }
    }
    cut();
    // 2. smoothed on the screen (a short moving average, twice; the ends stay)
    for (const pc of pieces) for (let it = 0; it < 2; it++) {
      const xs = pc.map((q) => q.x), ys = pc.map((q) => q.y);
      for (let i = 1; i < pc.length - 1; i++) { pc[i].x = (xs[i - 1] + 2 * xs[i] + xs[i + 1]) / 4; pc[i].y = (ys[i - 1] + 2 * ys[i] + ys[i + 1]) / 4; }
    }
    const width = (r) => Math.max(1.5, Math.min(7, 8000 / r));
    const segs = [];
    for (const pc of pieces) for (let i = 1; i < pc.length; i++) segs.push({ a: pc[i - 1], b: pc[i], v: pc[i - 1].v && pc[i].v, r: (pc[i - 1].r + pc[i].r) / 2, cols: pc[i].cols || pc[i - 1].cols });
    ctx2.lineCap = ctx2.lineJoin = "round"; ctx2.setLineDash([]);
    // 3. behind a ridge: the same line, hollow (an outline, the picture shows through), so the route never
    // breaks and still reads as "there, behind"; close to you, behind the ground you stand on, it fades out
    // instead of sweeping across the foreground. Drawn on its own layer: outlines first, then their insides cut out.
    // (far away, behind the ridges, a long route only knots up along the skyline: there just a thin dotted
    // trace, the hollow band only for a hidden stretch near enough to read, within HOLLOW m)
    const HOLLOW = 4000;
    const hidFar = segs.filter((g) => !g.v && g.r >= HOLLOW);
    if (hidFar.length) {
      ctx2.save(); ctx2.setLineDash([1.5, 4]); ctx2.lineWidth = 1.4; ctx2.strokeStyle = AMBER; ctx2.globalAlpha = 0.7;
      ctx2.shadowColor = "rgba(0,0,0,.35)"; ctx2.shadowBlur = 1.5;
      ctx2.beginPath(); for (const g of hidFar) { ctx2.moveTo(g.a.x, g.a.y); ctx2.lineTo(g.b.x, g.b.y); } ctx2.stroke(); ctx2.restore();
    }
    const hid = segs.filter((g) => !g.v && g.r < HOLLOW);
    if (hid.length) {
      hidCv ||= document.createElement("canvas");
      if (hidCv.width !== cv.width || hidCv.height !== cv.height) { hidCv.width = cv.width; hidCv.height = cv.height; }
      const h2 = hidCv.getContext("2d"), dpr = cv.width / cam.width;
      h2.setTransform(1, 0, 0, 1, 0, 0); h2.clearRect(0, 0, hidCv.width, hidCv.height); h2.setTransform(dpr, 0, 0, dpr, 0, 0);
      h2.lineCap = h2.lineJoin = "round";
      const hw = (g) => Math.max(3.4, width(g.r) * 0.9), fade = (g) => Math.max(0, Math.min(1, (Math.min(g.a.r, g.b.r) - 500) / 1200));
      for (const pass of [0, 1]) {
        h2.globalCompositeOperation = pass ? "destination-out" : "source-over";
        for (const g of hid) {
          const a = fade(g);
          if (a <= 0) continue;
          h2.globalAlpha = pass ? 1 : 0.95 * a; h2.strokeStyle = AMBER; h2.lineWidth = pass ? hw(g) - 2.4 : hw(g);
          h2.beginPath(); h2.moveTo(g.a.x, g.a.y); h2.lineTo(g.b.x, g.b.y); h2.stroke();
        }
      }
      h2.globalCompositeOperation = "source-over"; h2.globalAlpha = 1;
      ctx2.save(); ctx2.setTransform(1, 0, 0, 1, 0, 0); ctx2.shadowColor = "rgba(0,0,0,.4)"; ctx2.shadowBlur = 2 * dpr; ctx2.drawImage(hidCv, 0, 0); ctx2.restore();
    }
    // 4. seen: one amber band (as the plan on the map), stroked in a few widths (far first) with a soft
    // shadow under it; farther parts a little paler (the air between, as on the photo)
    // (within ~1 km the grid knows no houses, fences or trees round you: the route there only as a thin,
    // light line, stronger as it goes away, so it hints the way without lying over the foreground)
    // (with the map engine drawing on its terrain, the thin line only to where it takes over)
    const NEAR = t3d?.ready ? NEAR3D : 1000;
    ctx2.save(); ctx2.shadowColor = "rgba(0,0,0,.35)"; ctx2.shadowBlur = 2; ctx2.strokeStyle = AMBER; ctx2.lineWidth = 2;
    for (const g of segs) {
      if (!g.v || g.r >= NEAR) continue;
      ctx2.globalAlpha = Math.max(0.25, Math.min(0.8, 0.25 + (0.55 * (g.r - 60)) / (NEAR - 60)));
      ctx2.beginPath(); ctx2.moveTo(g.a.x, g.a.y); ctx2.lineTo(g.b.x, g.b.y); ctx2.stroke();
    }
    ctx2.restore();
    // (the map engine draws the seen route on its terrain: peak3d.js; by hand only until it is there)
    // (past FAR3D its path is thinner than a pixel there: by hand again, as a hairline)
    const FAR3D = 5000, seen = segs.filter((g) => g.v && g.r >= (t3d?.ready ? FAR3D : NEAR));
    const buckets = new Map();
    for (const g of seen) { const k = Math.round(width(g.r) * 2) / 2; if (!buckets.has(k)) buckets.set(k, []); buckets.get(k).push(g); }
    const ks = [...buckets.keys()].sort((p, q) => p - q);
    for (const k of ks) {
      const list = buckets.get(k), far = list.reduce((m, g) => m + g.r, 0) / list.length;
      ctx2.beginPath(); for (const g of list) { ctx2.moveTo(g.a.x, g.a.y); ctx2.lineTo(g.b.x, g.b.y); }
      ctx2.save(); ctx2.shadowColor = "rgba(0,0,0,.45)"; ctx2.shadowBlur = 2 + k * 0.6; ctx2.shadowOffsetY = 1;
      ctx2.globalAlpha = Math.max(0.72, Math.min(0.96, 1.02 - far / 40000)); ctx2.strokeStyle = AMBER; ctx2.lineWidth = k; ctx2.stroke(); ctx2.restore();
      if (k >= 4) { ctx2.globalAlpha = 0.35; ctx2.strokeStyle = "#fff4dc"; ctx2.lineWidth = k * 0.3; ctx2.stroke(); ctx2.globalAlpha = 1; } // (a light crest: a band, not a flat stroke)
    }
    // 5. which way: small chevrons on the near, wide part
    ctx2.strokeStyle = "rgba(255,255,255,.95)"; ctx2.lineWidth = 1.8;
    let gap = 40;
    for (const g of segs) {
      const len = Math.hypot(g.b.x - g.a.x, g.b.y - g.a.y), w = width(g.r);
      gap -= len;
      if (gap > 0) continue;
      gap = 70;
      if (!g.v || w < 5 || g.r < NEAR || t3d?.ready) continue; // (on the engine's line they would sit beside it)
      const ux = (g.b.x - g.a.x) / (len || 1), uy = (g.b.y - g.a.y) / (len || 1), s = Math.min(5, w * 0.6), cx = g.b.x, cy = g.b.y;
      ctx2.beginPath(); ctx2.moveTo(cx - ux * s - uy * s, cy - uy * s + ux * s); ctx2.lineTo(cx, cy); ctx2.lineTo(cx - ux * s + uy * s, cy - uy * s - ux * s); ctx2.stroke();
    }
    // 6. marks along it: every hour (or half) of walking, or every few kilometres (a tap on one switches)
    markHits = [];
    if (clock) {
      const all = pieces.flat(), at = (d) => { let b = null; for (const q of all) if (!b || Math.abs(q.d - d) < Math.abs(b.d - d)) b = q; return b && Math.abs(b.d - d) < 120 ? b : null; };
      const marks = [];
      if (markMode === "time") {
        const step = clock.total <= 150 ? 30 : clock.total <= 480 ? 60 : 120;
        for (let m = step; m < clock.total - step / 3; m += step) { const i = clock.t.findIndex((v) => v >= m); if (i > 0) marks.push([clock.d[i], m < 60 ? `${m}'` : `${Math.floor(m / 60)}${m % 60 ? ":30" : ""} h`]); }
      } else {
        const tot = clock.km, step = tot <= 4 ? 0.5 : tot <= 12 ? 2 : tot <= 30 ? 5 : 10;
        for (let k = step; k < tot - step / 3; k += step) marks.push([k * 1000, `${String(k).replace(".", ",")} km`]);
      }
      ctx2.font = "700 11.5px system-ui, sans-serif"; ctx2.textAlign = "center"; ctx2.textBaseline = "middle";
      const taken = [];
      for (const [d, txt] of marks) {
        const q = at(d);
        // (only where the route is seen: a mark on a hidden stretch floats over the hills in front)
        if (!q || !q.v) continue;
        const w = ctx2.measureText(txt).width + 12, h = 19, x = q.x, y = q.y;
        if (taken.some((m) => Math.abs(m.x - x) < (m.w + w) / 2 + 4 && Math.abs(m.y - y) < (m.h + h) / 2 + 2)) continue; // (where the route doubles back far away: one mark, not a heap)
        taken.push({ x, y, w, h });
        ctx2.save(); ctx2.shadowColor = "rgba(0,0,0,.4)"; ctx2.shadowBlur = 3;
        ctx2.fillStyle = "#fff"; roundRect(x - w / 2, y - h / 2, w, h, h / 2); ctx2.fill(); ctx2.shadowBlur = 0;
        ctx2.strokeStyle = AMBER; ctx2.lineWidth = 1.5; roundRect(x - w / 2, y - h / 2, w, h, h / 2); ctx2.stroke();
        ctx2.fillStyle = "#1b1d1f"; ctx2.fillText(txt, x, y + 0.5); ctx2.restore();
        markHits.push({ x, y, w, h });
      }
    }
    // 7. the end: a pin
    const end = pieces.at(-1)?.at(-1);
    if (end && ways.at(-1)?.pts.at(-1) && end.d >= (ways.at(-1).pts.at(-1).d ?? 0) - 30) {
      ctx2.fillStyle = "rgba(0,0,0,.3)"; ctx2.beginPath(); ctx2.ellipse(end.x, end.y + 1, 5, 2, 0, 0, Math.PI * 2); ctx2.fill();
      ctx2.strokeStyle = "#fff"; ctx2.lineWidth = 1.5; ctx2.beginPath(); ctx2.moveTo(end.x, end.y); ctx2.lineTo(end.x, end.y - 16); ctx2.stroke();
      ctx2.fillStyle = AMBER; ctx2.beginPath(); ctx2.moveTo(end.x, end.y - 16); ctx2.lineTo(end.x + 11, end.y - 12.5); ctx2.lineTo(end.x, end.y - 9); ctx2.closePath(); ctx2.fill();

    }
  }

  /** Most of the route out of the picture: an arrow at that edge ("Trasa →"), to turn the phone that way. */
  function edgeHint(cam, ways) {
    let inF = 0, L = 0, R = 0;
    for (const w of ways) for (const p of w.pts) {
      if (!p || p.dist < 500) continue;
      const da = ((((p.az - cam.heading) % 360) + 540) % 360) - 180;
      if (Math.abs(da) < cam.hfov / 2) inF++; else if (da < 0) L++; else R++;
    }
    const n = inF + L + R;
    edge = n && inF / n < 0.35 ? (R >= L ? "right" : "left") : null;
    if (!edge) return;
    // (under the skyline and the names, over the card)
    const low = $("pccard").hidden ? cam.height - 40 : $("pccard").getBoundingClientRect().top - cv.getBoundingClientRect().top - 30;
    const txt = edge === "right" ? "Trasa  →" : "←  Trasa", y = Math.max(cam.height * 0.4, Math.min(cam.height * 0.7, low));
    ctx2.font = "700 14px system-ui, sans-serif";
    const w = ctx2.measureText(txt).width + 24, h = 32, x = edge === "right" ? cam.width - w - 10 : 10;
    ctx2.save(); ctx2.shadowColor = "rgba(0,0,0,.35)"; ctx2.shadowBlur = 6;
    ctx2.fillStyle = AMBER; roundRect(x, y - h / 2, w, h, h / 2); ctx2.fill(); ctx2.restore();
    ctx2.fillStyle = "#1b1d1f"; ctx2.textAlign = "center"; ctx2.textBaseline = "middle"; ctx2.fillText(txt, x + w / 2, y + 0.5);
  }

  /** The name (its text, its leader or its summit) under a tap. */
  function hitAt(x, y) {
    let best = null, bd = 22;
    for (const h of hits) {
      if (Math.abs(x - h.tx) <= h.w / 2 + 8 && y >= h.ty - h.fs - 8 && y <= h.ty + h.fs * 0.68 + 8) return h;
      const d = y >= h.ty && y <= h.y + 10 ? Math.abs(x - h.x) : Math.hypot(x - h.x, y - h.y);
      if (d < bd) { bd = d; best = h; }
    }
    return best || summitAt(x, y);
  }
  /** A summit seen but not named (its label gave way to a neighbour's): a tap on its spot picks it too. */
  function summitAt(x, y, R = 28) {
    if (!lastCam) return null;
    let best = null, bd = R;
    for (const pk of peaks) {
      const q = project(pk.az, pk.skyline ? Math.min(pk.angle, horizonAt(pano, pk.az)) : pk.angle, lastCam);
      if (!q) continue;
      const d = Math.hypot(x - q.x, y - q.y) + pk.dist / 2000; // (of two close, the nearer summit)
      if (d < bd) { bd = d; best = { name: pk.name }; }
    }
    return best;
  }

  // ---- a tapped summit: how far, how much up and down, how long on the trails from where you stand
  function pick(h) {
    const pk = h && peaks.find((p) => p.name === h.name);
    sel = pk || null; way = null; selGeo = null; clock = null; routeSeq++; show3d();
    $("pccard").hidden = !sel;
    if (!sel) { queue(); return; }
    $("pcname").textContent = sel.name;
    $("pcsub").textContent = `${sel.ele} m · ${km(sel.dist)} km w linii prostej`;
    $("pcway").innerHTML = kpiRow({ ms: null, km: null, up: null, down: null }, { label: "Dojście", prof: false });
    $("pcnote").textContent = "Liczę trasę…"; $("pcnote").hidden = false; $("pcplan").hidden = true;
    $("pccard").classList.remove("mini"); $("pcsum").textContent = "";
    queue(); route(sel);
  }
  async function route(pk) {
    const my = ++routeSeq, meta = C.view?.meta;
    const fail = (t) => { if (my === routeSeq) { $("pcnote").textContent = t; $("pcnote").hidden = false; } };
    if (!meta || !C.call) { fail("Trasa liczy się z pobranych map."); return; }
    const P = projector(meta), me = P(obs.lon, obs.lat), to = P(pk.lon, pk.lat);
    const r = await C.call("route", { pts: [me, to], opts: state.settings.plan || {} }).then((x) => x.route).catch(() => null);
    if (my !== routeSeq) return;
    if (!r || !r.km) { fail("Brak szlaków do tego szczytu w pobranych mapach."); return; }
    const ms = C.routeTime ? C.routeTime(r).ms : null;
    $("pcway").innerHTML = kpiRow({ ms, km: r.km, up: r.up, down: r.down }, { label: "Dojście", prof: !!r.P });
    const g = $("pcway").querySelector(".gprof");
    if (g && r.P) C.planner?.mountWay?.(g, r, () => {});
    $("pcnote").hidden = true; $("pcplan").hidden = false;
    // folded: the picture first, one line of numbers (a tap on the card unfolds it)
    $("pcsum").textContent = [ms ? hm(ms) : null, `${r.km.toFixed(1).replace(".", ",")} km`, r.up != null ? `↑ ${Math.round(r.up)} m` : null].filter(Boolean).join(" · ");
    $("pccard").classList.add("mini");
    $("pcplan").onclick = () => { close(); C.planner?.openTo?.({ x: to[0], y: to[1], n: pk.name }, { x: me[0], y: me[1], n: obs.name || "Twoja pozycja" }); };
    way = wayOf(r, meta);
    selGeo = wayGeo(r, meta); show3d();
    clock = routeClock(r, ms);
    lastPlaces = (r.places || []).filter((p) => p.n).map((p) => ({ n: p.n, c: p.c, d: Math.round(p.d) }));
    lastRoute = { name: pk.name, km: r.km, up: r.up, down: r.down, ms, seen: way.reduce((n, w) => n + w.pts.filter((q) => q?.visible).length, 0), pts: way.reduce((n, w) => n + w.pts.length, 0) };
    queue();
  }
  $("pcx").onclick = () => close();
  $("pccard").addEventListener("click", (e) => {
    if (e.target.closest("#pccx, #pcplan, .gprof")) return;
    if ($("pcsum").textContent) { $("pccard").classList.toggle("mini"); queue(); }
  });
  const hm = (ms) => { const m = Math.round(ms / 60000); return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, "0")} h`; };
  addEventListener("resize", () => queue());

  async function show() {
    if (open) return;
    open = true; root.hidden = false; document.documentElement.classList.add("pcopen");
    PEAKS = peakList(C); o = camOverrides(); offset = 0; pitchOff = 0; autoHold = false; sky = null; sel = null; lastRoute = null; $("pccard").hidden = true; pose = null; absRaw = relRaw = anchor = null; fine = nearAt = null; pano = null; peaks = []; obs = null; lastObsKey = "";
    fixedPose = o.dir ? (([h, p, r]) => ({ heading: +h || 0, pitch: +p || 0, roll: +r || 0 }))(String(o.dir).split(",")) : null;
    status("Wczytuję mapę terenu…");
    if (!fixedPose) nativeSensors().then((ok) => { if (!ok && open) { addEventListener(absEvent(), onAbs); if (absEvent() !== "deviceorientation") addEventListener("deviceorientation", onRel); } });
    startPicture();
    const tp = teleport(o.at);
    $("pcwhere").textContent = tp ? tp.name : "";
    try { dem = await loadDem(o.dem || DEM_URL, status); }
    catch { if (open) status("Nie mogę pobrać mapy terenu."); return; }
    if (!open) return;
    if (tp) setObserver(tp); else startGps();
    queue();
    skyLoop(); recCount();
  }
  function close() {
    if (!open) return;
    open = false; root.hidden = true; document.documentElement.classList.remove("pcopen");
    removeEventListener(absEvent(), onAbs); removeEventListener("deviceorientation", onRel);
    camSub?.remove?.(); camSub = null; camPlugin?.stop?.().catch(() => {}); headAcc = -1;
    if (gpsWatch != null) navigator.geolocation.clearWatch(gpsWatch);
    gpsWatch = null; stopPicture(); cancelAnimationFrame(raf); raf = 0; clearTimeout(skyTimer);
    t3d?.destroy(); t3d = null; selGeo = activeGeo = null;
  }

  $("peakcambtn").onclick = (e) => { e.stopPropagation(); C.layers?.(false); show(); };
  // (for tests: what is drawn)
  globalThis.__peakcam = { get all() { return PEAKS.length; }, get ms() { return lastMs; }, get peaks() { return peaks; }, get hits() { return hits; }, get route() { return lastRoute; }, get marks() { return markHits.length; }, get markMode() { return markMode; }, get sel() { return sel?.name || null; }, get edge() { return edge; }, get selLabel() { return frame?.selLabel || null; }, get active() { return activeWay ? activeWay.reduce((n, w) => n + w.pts.filter((q) => q?.visible).length, 0) : null; }, get obs() { return obs; }, get ready() { return !!pano; }, get fov() { return optics?.fovLong ?? null; }, get frame() { return frame; }, get places() { return lastPlaces; }, get fine() { return fine ? Math.round(nearMs) : null; }, get pose() { return pose; }, get anchored() { return anchor != null; }, get sky() { return sky; }, get pano() { return pano; }, get t3d() { return t3d ? { ready: t3d.ready, frames: t3d.frames } : null; }, get geo() { return selGeo; }, get ground() { return fine || dem; }, spot: (n) => { const pk = peaks.find((p) => p.name === n); return pk && lastCam ? project(pk.az, pk.skyline ? Math.min(pk.angle, horizonAt(pano, pk.az)) : pk.angle, lastCam) : null; }, rec: () => recCase(), recZip: () => casesZip(), recClear: () => clearCases(), get offset() { return offset; }, get pitchOff() { return pitchOff; }, skyNow: () => skyOnce(), show, close };
  /** Back: a chosen summit first (back to all of them), then the camera. */
  const back = () => { if (sel) pick(null); else close(); };
  return { peakcamOpen: () => open, closePeakcam: close, peakcamBack: back, openPeakcam: show };
}
