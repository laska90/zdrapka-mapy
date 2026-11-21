// Garmin Connect Personal API: the user's own key (made on Garmin Connect web), traded for a 24 h
// bearer token, then read-only calls. Pure logic; the HTTP transport is injected like in
// core/intervals.js: http(url, {method, headers, as: "json"|"bytes"|"text"}), throwing {status}.
// Endpoints as in Garmin's own client (github.com/garmin/connect-personal-api-python).

import { activityFilesInZip, source } from "./zip.js";

export const GC = "https://personal.connectapi.garmin.com";
export const TOKEN_URL = `${GC}/personalapitoken-service/personal-api/personal-api-key/token`;
export const KEY_PAGE = "https://connect.garmin.com/app/settings/personalApiToken";
const DAY = 86_400_000, HOUR = 3_600_000;
const WINDOW = 28 * DAY; // a search spans at most about a month
const PAGE = 100;
const DUP_START_MS = 90_000; // as in core/pipeline.js

const ymd = (ms) => new Date(ms).toISOString().slice(0, 10);
export const listUrl = (fromMs, toMs, start = 0) =>
  `${GC}/activitylist-service/activities/search/activities?startDate=${ymd(fromMs)}&endDate=${ymd(toMs)}&start=${start}&limit=${PAGE}`;
export const fileUrl = (id) => `${GC}/download-service/files/activity/${encodeURIComponent(id)}`;

/** The token's expiry (ms) from its JWT "exp"; unknown: 23 h from now. */
export function tokenExpiry(jwt, now = Date.now()) {
  try {
    const p = jwt.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    const exp = JSON.parse(atob(p + "=".repeat((4 - (p.length % 4)) % 4))).exp;
    if (exp > 0) return exp * 1000;
  } catch { /* not a JWT */ }
  return now + 23 * HOUR;
}

/** A bearer token: the cached one while it has more than an hour left, else a new one from the key. */
export async function bearer({ key, http, cache = {}, now = Date.now() }) {
  if (cache.token && cache.tokenExp - now > HOUR) return cache;
  let t = await http(TOKEN_URL, { method: "POST", headers: { Accept: "*/*", Authorization: `ApiKey ${key.trim()}` }, as: "text" });
  t = String(t || "").trim();
  if (t.startsWith("{")) { try { const j = JSON.parse(t); t = j.access_token || j.accessToken || j.token || ""; } catch { t = ""; } }
  if (!t) throw Object.assign(new Error("no token"), { status: 401 });
  return { token: t, tokenExp: tokenExpiry(t, now) };
}

/** Start of an activity (ms): startTimeGMT "2026-10-12 07:00:00" (UTC), else startTimeLocal as given. */
export function startOf(a) {
  const g = a.startTimeGMT || a.beginTimestamp;
  if (typeof g === "number") return g;
  if (g) { const t = Date.parse(String(g).replace(" ", "T") + (/[zZ]|[+-]\d\d:?\d\d$/.test(g) ? "" : "Z")); if (t) return t; }
  const l = a.startTimeLocal;
  return l ? Date.parse(String(l).replace(" ", "T")) || null : null;
}

const typeOf = (a) => String(a.activityType?.typeKey || a.activityType || a.activityTypeDTO?.typeKey || "");
const NOT_ON_FOOT = /ride|cycl|bike|biking|swim|row|kayak|canoe|paddl|sail|surf|weight|strength|yoga|pilates|elliptical|stair|crossfit|golf|tennis|squash|badminton|velomobile|handcycle|wheelchair|virtual|indoor|treadmill|kitesurf|windsurf|skat|inline|breath|meditation/i;

/** Activities worth downloading: on foot, outdoors, not seen, not already here under another source. */
export function selectNew(list, seen = new Set(), knownStarts = []) {
  const near = (t) => t != null && knownStarts.some((s) => Math.abs(s - t) < DUP_START_MS);
  return list
    .filter((a) => a && a.activityId != null && !seen.has(String(a.activityId)))
    .filter((a) => !NOT_ON_FOOT.test(typeOf(a)))
    .filter((a) => a.distance == null || a.distance > 300)
    .filter((a) => !near(startOf(a)))
    .sort((a, b) => (startOf(a) || 0) - (startOf(b) || 0));
}

/** The answer of a search: a list, or {activities: [...]} / {activityList: [...]}. */
const listOf = (r) => (Array.isArray(r) ? r : Array.isArray(r?.activities) ? r.activities : Array.isArray(r?.activityList) ? r.activityList : null);

/** Every activity from..to: month by month, page by page. */
export async function listActivities({ http, headers, from, to }) {
  const all = [];
  for (let a = from; a < to; a += WINDOW) {
    const b = Math.min(a + WINDOW - DAY, to);
    for (let start = 0; ; start += PAGE) {
      const page = listOf(await http(listUrl(a, b, start), { headers, as: "json" }));
      if (!page) throw new Error("unexpected answer from Garmin");
      all.push(...page);
      if (page.length < PAGE) break;
    }
  }
  const byId = new Map(all.map((x) => [String(x.activityId), x])); // windows share their edge days
  return [...byId.values()];
}

/** The original file: Garmin sends a zip with the .fit inside (a bare FIT or GPX taken as it is). */
export async function unpackOriginal(bytes) {
  if (bytes[0] === 0x50 && bytes[1] === 0x4b) {
    for await (const f of activityFilesInZip(source(bytes))) {
      const ext = /\.gpx$/i.test(f.name) ? "gpx" : /\.fit$/i.test(f.name) ? "fit" : null;
      if (ext) return { ext, bytes: f.bytes };
    }
    return { ext: null, bytes };
  }
  if (bytes.length > 12 && String.fromCharCode(bytes[8], bytes[9], bytes[10], bytes[11]) === ".FIT") return { ext: "fit", bytes };
  if (/<gpx[\s>]/.test(new TextDecoder().decode(bytes.subarray(0, 600)))) return { ext: "gpx", bytes };
  return { ext: null, bytes };
}

/**
 * One sync round. state: {since, seen, token, tokenExp}; knownStarts: starts (ms) of the outings already here,
 * so what came before from intervals.icu or an export isn't downloaded again.
 * at: only the activity that started then (an outing downloaded again). Returns {files: [{name, id, bytes}],
 * skipped, info, seen, since, token, tokenExp}.
 */
export async function fetchNew({ key, http, state = {}, knownStarts = [], now = Date.now(), at = null, onProgress = () => {} }) {
  const auth = await bearer({ key, http, cache: state, now });
  const headers = { Authorization: `Bearer ${auth.token}` };
  // at (ms): just the one activity that started then (downloaded again even if seen), from the days around it
  const since = at != null ? at - DAY : state.since ?? now - 365 * DAY, to = at != null ? at + DAY : now;
  const list = await listActivities({ http, headers, from: since - 2 * DAY, to: to + DAY });
  const seen = new Set((state.seen || []).map(String));
  const todo = at != null ? selectNew(list).filter((a) => Math.abs((startOf(a) ?? Infinity) - at) < DUP_START_MS).slice(0, 1) : selectNew(list, seen, knownStarts), files = [], skipped = [];
  for (const a of list) if (!todo.includes(a)) seen.add(String(a.activityId));
  let i = 0;
  for (const a of todo) {
    const id = String(a.activityId);
    onProgress({ n: ++i, of: todo.length, name: a.activityName });
    let raw;
    try { raw = await http(fileUrl(id), { headers, as: "bytes" }); } catch (e) {
      if (e.status === 404) { skipped.push({ id, reason: "no file yet" }); continue; } // next time
      throw e;
    }
    const { ext, bytes } = await unpackOriginal(raw);
    seen.add(id);
    if (!ext) { skipped.push({ id, reason: "unsupported file" }); continue; }
    files.push({ name: `gc-${id}.${ext}`, id: `gc-${id}`, bytes });
  }
  const latest = list.reduce((m, a) => Math.max(m, startOf(a) || 0), 0);
  const info = { listed: list.length, candidates: todo.length, newest: latest || null };
  const next = at != null ? state.since : Math.max(since, latest || 0);
  return { files, skipped, info, seen: [...seen].slice(-3000), since: next, token: auth.token, tokenExp: auth.tokenExp };
}
