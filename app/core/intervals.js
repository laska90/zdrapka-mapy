// intervals.icu sync: Garmin Connect -> intervals.icu -> here. Pure logic; the
// HTTP transport is injected (browser fetch, or the native one in the Android
// app, which is not subject to CORS). Only the user's own API key is used:
// Basic auth, user "API_KEY", athlete id 0 = the key's owner.

export const ICU = "https://intervals.icu/api/v1";
const DAY = 86_400_000;

export const authHeader = (key) => "Basic " + b64(`API_KEY:${key.trim()}`);

function b64(s) {
  const bytes = new TextEncoder().encode(s), A = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const n = (bytes[i] << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0);
    out += A[(n >> 18) & 63] + A[(n >> 12) & 63] + (i + 1 < bytes.length ? A[(n >> 6) & 63] : "=") + (i + 2 < bytes.length ? A[n & 63] : "=");
  }
  return out;
}

const ymd = (ms) => new Date(ms).toISOString().slice(0, 10);
export const listUrl = (oldestMs, newestMs) => `${ICU}/athlete/0/activities?oldest=${ymd(oldestMs)}&newest=${ymd(newestMs)}`;
export const fileUrl = (id) => `${ICU}/activity/${encodeURIComponent(id)}/file`;

// Clearly not walking in the mountains: don't even download these. (Not
// "Workout": Garmin's mountaineering / generic outdoor activities can land there.)
const NOT_ON_FOOT = /ride|cycl|bike|swim|row|kayak|canoe|paddl|sail|surf|weight|yoga|pilates|elliptical|stair|crossfit|golf|tennis|squash|badminton|velomobile|handcycle|wheelchair|virtual|kitesurf|windsurf|skate|inline/i;

export const isStrava = (a) => a.source === "STRAVA" || /strava/i.test(a._note || "");

/** Activities worth downloading: new, on foot, outdoors, not proxied from Strava. */
export function selectNew(list, seen = new Set()) {
  return list
    .filter((a) => a && a.id != null && !seen.has(String(a.id)))
    .filter((a) => !isStrava(a))
    .filter((a) => !NOT_ON_FOOT.test(a.type || ""))
    .filter((a) => !(a.trainer || a.indoor) && (a.distance == null || a.distance > 300))
    .sort((a, b) => String(a.start_date_local || "").localeCompare(String(b.start_date_local || "")));
}

/** Gunzip if needed and tell the format: {ext: "fit"|"gpx"|null, bytes} */
export async function unpackFile(bytes) {
  if (bytes[0] === 0x1f && bytes[1] === 0x8b) {
    const s = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"));
    bytes = new Uint8Array(await new Response(s).arrayBuffer());
  }
  if (bytes.length > 12 && String.fromCharCode(bytes[8], bytes[9], bytes[10], bytes[11]) === ".FIT") return { ext: "fit", bytes };
  const head = new TextDecoder().decode(bytes.subarray(0, 600));
  if (/<gpx[\s>]/.test(head)) return { ext: "gpx", bytes };
  return { ext: null, bytes }; // tcx and friends: Garmin originals are FIT anyway
}

/**
 * One sync round. http(url, {headers, as: "json"|"bytes"}) -> parsed JSON / Uint8Array,
 * throws {status} on HTTP errors.
 * state: {since (ms), seen: string[]}; returns {files: [{name, id, bytes}], seen, since, checked, skipped}
 */
export async function fetchNew({ key, http, state = {}, now = Date.now(), onProgress = () => {} }) {
  const headers = { Authorization: authHeader(key) };
  const since = state.since ?? now - 365 * DAY; // intervals.icu only gets a year from Garmin anyway
  const list = await http(listUrl(since - 2 * DAY, now + DAY), { headers, as: "json" });
  if (!Array.isArray(list)) throw new Error("unexpected answer from intervals.icu");
  const seen = new Set((state.seen || []).map(String));
  const todo = selectNew(list, seen), files = [], skipped = [];
  for (const a of list) if (!todo.includes(a)) seen.add(String(a.id));
  let i = 0;
  for (const a of todo) {
    onProgress({ n: ++i, of: todo.length, name: a.name });
    let raw;
    try { raw = await http(fileUrl(a.id), { headers, as: "bytes" }); } catch (e) {
      if (e.status === 404) { skipped.push({ id: a.id, reason: "no file yet" }); continue; } // try again next time
      throw e;
    }
    const { ext, bytes } = await unpackFile(raw);
    seen.add(String(a.id));
    if (!ext) { skipped.push({ id: a.id, reason: "unsupported file" }); continue; }
    files.push({ name: `icu-${a.id}.${ext}`, id: `icu-${a.id}`, bytes });
  }
  const latest = list.reduce((m, a) => Math.max(m, Date.parse(a.start_date || a.start_date_local) || 0), 0);
  const info = { listed: list.length, strava: list.filter(isStrava).length, candidates: todo.length, newest: latest || null };
  return { files, skipped, checked: list.length, info, seen: [...seen].slice(-3000), since: Math.max(since, latest || 0) };
}

/** Browser transport (works only if intervals.icu allows this origin). */
export async function fetchHttp(url, { headers, as }) {
  const r = await fetch(url, { headers });
  if (!r.ok) throw Object.assign(new Error(`HTTP ${r.status}`), { status: r.status });
  return as === "json" ? r.json() : new Uint8Array(await r.arrayBuffer());
}
