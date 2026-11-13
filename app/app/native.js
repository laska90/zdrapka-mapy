import { note } from "./diag.js";
// Bridge to the Android app (Capacitor). In a normal browser everything here is
// a no-op and the app stays a plain web page.

export const RUNNER = "pl.zdrapka.sync";

export const isNative = () => !!(globalThis.Capacitor?.isNativePlatform?.() || globalThis.androidBridge);

const script = (src) => new Promise((resolve, reject) => {
  const s = document.createElement("script");
  s.src = src; s.onload = resolve; s.onerror = () => reject(new Error(`cannot load ${src}`));
  document.head.append(s);
});

let plugins = null;
/** {Http, Runner, App} from the Capacitor runtime bundled in the app (vendor/). */
export function native() {
  if (!isNative()) return Promise.resolve(null);
  plugins ??= (async () => {
    await script("vendor/capacitor.js");
    await script("vendor/background-runner.js");
    await script("vendor/app.js").catch(() => {}); // @capacitor/app: the back button
    await script("vendor/filesystem.js").catch(() => {}); // the postcard: written to the cache,
    await script("vendor/share.js").catch(() => {}); // handed to the share sheet
    const App = globalThis.capacitorApp?.App || globalThis.Capacitor?.Plugins?.App || null;
    const P = globalThis.Capacitor?.Plugins || {};
    return {
      Http: globalThis.capacitorExports.CapacitorHttp, Runner: globalThis.capacitorBackgroundRunner?.BackgroundRunner, App,
      Filesystem: globalThis.capacitorFilesystem?.Filesystem || P.Filesystem || null, Share: globalThis.capacitorShare?.Share || P.Share || null,
    };
  })();
  return plugins;
}

function b64decode(s) {
  const bin = atob(s), out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Native HTTP (no CORS): same contract as core/intervals.js fetchHttp. */
export async function nativeHttp(url, { headers, as }) {
  const { Http } = await native();
  const r = await Http.request({ url, method: "GET", headers, responseType: as === "json" ? "json" : "arraybuffer" });
  if (r.status >= 400) throw Object.assign(new Error(`HTTP ${r.status}`), { status: r.status });
  if (as === "json") return typeof r.data === "string" ? JSON.parse(r.data) : r.data;
  if (typeof r.data === "string") return b64decode(r.data);
  return new Uint8Array(r.data);
}

/** Hand the background check what it needs (key + what was already imported). */
export async function configureBackground(icu) {
  const n = await native();
  if (!n?.Runner) return;
  // not awaited: dispatchEvent may never resolve while the app is in the foreground
  n.Runner.dispatchEvent({ label: RUNNER, event: "config", details: { key: icu?.key || "", since: icu?.since || 0, seen: (icu?.seen || []).slice(-400) } }).catch(() => {});
}

export async function askNotifications() {
  const n = await native();
  if (!n?.Runner) return;
  try {
    const st = await n.Runner.checkPermissions();
    if (st.notifications !== "granted") await n.Runner.requestPermissions({ apis: ["notifications"] });
  } catch { /* older Android: nothing to ask */ }
}

/** The Friday reminder of a proposal: {at (ms, 0: none), tz (minutes, as getTimezoneOffset), title, body}. */
export async function configureTrip(details) {
  const n = await native();
  if (!n?.Runner) return;
  n.Runner.dispatchEvent({ label: RUNNER, event: "trip", details }).catch(() => {});
}

/** The screen stays on (true) or may go off again (false): the app's own plugin on the phone
 * (ZdrapkaScreen), the Wake Lock API in a browser. Never throws. */
let wake = null;
export async function keepScreenOn(on) {
  try {
    if (isNative()) {
      await native();
      const C = globalThis.Capacitor, reg = C?.registerPlugin || globalThis.capacitorExports?.registerPlugin;
      const P = C?.Plugins?.ZdrapkaScreen || (reg ? (keepScreenOn.p ||= reg("ZdrapkaScreen")) : null);
      if (P) { await P.keepOn({ on }); return true; }
    }
    if (on) { wake = await navigator.wakeLock?.request("screen"); return !!wake; }
    await wake?.release(); wake = null; return true;
  } catch { return false; }
}

/** The active route's notification (ZdrapkaRoute, a foreground service: Android keeps the app alive with it in
 * the pocket): {title, text} shows or updates it, null hides it. Only in the app; never throws. */
let routeNote = "";
export async function routeKeep(q) {
  try {
    if (!isNative()) return false;
    const key = q ? `${q.title}|${q.text}` : "";
    if (key === routeNote) return true;
    await native();
    const C = globalThis.Capacitor, reg = C?.registerPlugin || globalThis.capacitorExports?.registerPlugin;
    const P = C?.Plugins?.ZdrapkaRoute || (reg ? (routeKeep.p ||= reg("ZdrapkaRoute")) : null);
    if (!P) { note("powiadomienie trasy: brak wtyczki"); return false; }
    if (q) await P.show(q); else await P.hide();
    if (!routeNote !== !key) note(`powiadomienie trasy: ${key ? "włączone" : "wyłączone"}`);
    routeNote = key;
    return true;
  } catch (e) { note(`powiadomienie trasy: ${e?.message || e}`); return false; }
}

/** The automatic backup's folder (ZdrapkaBackup, the Storage Access Framework): op "pickDir" | "status" |
 * "write" with its args. Only in the app: null in a browser or without the plugin; rejects as the plugin does. */
export async function backupDir(op, args = {}) {
  if (!isNative()) return null;
  await native();
  const C = globalThis.Capacitor, reg = C?.registerPlugin || globalThis.capacitorExports?.registerPlugin;
  const P = C?.Plugins?.ZdrapkaBackup || (reg ? (backupDir.p ||= reg("ZdrapkaBackup")) : null);
  if (!P?.[op]) return null;
  return P[op](args);
}

/** A GPX opened in Garmin Connect as a course (ZdrapkaOpen: written to the app's cache, then VIEW): {app} or
 * null (a browser, or no plugin: the caller shares it instead). Rejects as the plugin does. */
export async function openGpx(name, xml) {
  if (!isNative()) return null;
  const n = await native();
  const C = globalThis.Capacitor, reg = C?.registerPlugin || globalThis.capacitorExports?.registerPlugin;
  const P = C?.Plugins?.ZdrapkaOpen || (reg ? (openGpx.p ||= reg("ZdrapkaOpen")) : null);
  if (!P?.gpx || !n?.Filesystem) return null;
  await n.Filesystem.writeFile({ path: name, data: xml, directory: "CACHE", encoding: "utf8" });
  return P.gpx({ name });
}
