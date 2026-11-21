// Minimal ZIP reader: central directory, stored + deflate entries, nested zips.
// Random access over a Blob/File, so a multi-GB Garmin export is never loaded
// into memory as a whole: only the central directory and one entry at a time.
// Inflate via the platform DecompressionStream("deflate-raw") (browsers, Node 18+).

const u32 = (v, o) => v.getUint32(o, true);
const u16 = (v, o) => v.getUint16(o, true);
const u64 = (v, o) => Number(v.getBigUint64(o, true));
const dv = (b) => new DataView(b.buffer, b.byteOffset, b.byteLength);

/** Random-access byte source over a Uint8Array or a Blob/File. */
export function source(x) {
  if (x instanceof Uint8Array) {
    return { size: x.byteLength, read: async (o, n) => x.subarray(o, o + n), stream: (o, n) => new Blob([x.subarray(o, o + n)]).stream() };
  }
  return {
    size: x.size,
    read: async (o, n) => new Uint8Array(await x.slice(o, o + n).arrayBuffer()),
    stream: (o, n) => x.slice(o, o + n).stream(),
  };
}

/** List entries: [{name, method, compSize, size, offset}] */
export async function listZip(src) {
  if (!src.read) src = source(src);
  const tailLen = Math.min(src.size, 65557 + 20);
  const tailAt = src.size - tailLen, tail = await src.read(tailAt, tailLen), tv = dv(tail);
  let eocd = -1;
  for (let i = tail.length - 22; i >= 0; i--) if (u32(tv, i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error("not a zip file");
  let n = u16(tv, eocd + 10), cdSize = u32(tv, eocd + 12), cd = u32(tv, eocd + 16);
  if (n === 0xffff || cd === 0xffffffff || cdSize === 0xffffffff) {
    const loc = eocd - 20; // ZIP64 locator just before EOCD
    if (loc < 0 || u32(tv, loc) !== 0x07064b50) throw new Error("zip64 locator missing");
    const rec = dv(await src.read(u64(tv, loc + 8), 56));
    n = u64(rec, 32); cdSize = u64(rec, 40); cd = u64(rec, 48);
  }
  const dir = await src.read(cd, cdSize), v = dv(dir), dec = new TextDecoder(), out = [];
  let p = 0;
  for (let i = 0; i < n; i++) {
    if (u32(v, p) !== 0x02014b50) throw new Error("bad central directory");
    const method = u16(v, p + 10);
    let compSize = u32(v, p + 20), size = u32(v, p + 24), offset = u32(v, p + 42);
    const nameLen = u16(v, p + 28), extraLen = u16(v, p + 30), commentLen = u16(v, p + 32);
    const name = dec.decode(dir.subarray(p + 46, p + 46 + nameLen));
    for (let e = p + 46 + nameLen, end = e + extraLen; e + 4 <= end; e += 4 + u16(v, e + 2)) {
      if (u16(v, e) !== 0x0001) continue; // ZIP64 extra field
      let q = e + 4;
      if (size === 0xffffffff) { size = u64(v, q); q += 8; }
      if (compSize === 0xffffffff) { compSize = u64(v, q); q += 8; }
      if (offset === 0xffffffff) offset = u64(v, q);
    }
    out.push({ name, method, compSize, size, offset });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

async function dataStart(src, entry) {
  const h = dv(await src.read(entry.offset, 30));
  if (u32(h, 0) !== 0x04034b50) throw new Error("bad local header");
  return entry.offset + 30 + u16(h, 26) + u16(h, 28);
}

/** Entry contents as bytes. */
export async function readEntry(src, entry) {
  if (!src.read) src = source(src);
  const start = await dataStart(src, entry);
  if (entry.method === 0) return src.read(start, entry.compSize);
  if (entry.method !== 8) throw new Error(`unsupported zip method ${entry.method}`);
  const s = src.stream(start, entry.compSize).pipeThrough(new DecompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(s).arrayBuffer());
}

/** A nested zip as its own source without holding it in memory: stored entries
 * are a window into the parent, deflated ones inflate into a (disk-backed) Blob. */
async function entrySource(src, entry) {
  const start = await dataStart(src, entry);
  if (entry.method === 0) {
    return { size: entry.compSize, read: (o, n) => src.read(start + o, Math.min(n, entry.compSize - o)), stream: (o, n) => src.stream(start + o, n) };
  }
  if (entry.method !== 8) throw new Error(`unsupported zip method ${entry.method}`);
  const s = src.stream(start, entry.compSize).pipeThrough(new DecompressionStream("deflate-raw"));
  return source(await new Response(s).blob());
}

const ACTIVITY = /\.(fit|gpx|tcx)(\.gz)?$/i;

/** A .gz file's bytes, unpacked (Strava's archive: activities/123.fit.gz). */
export async function gunzip(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}
/** {name, bytes}: a .gz one unpacked, its name without .gz. */
async function unpacked(name, bytes) {
  return /\.gz$/i.test(name) ? { name: name.replace(/\.gz$/i, ""), bytes: await gunzip(bytes) } : { name, bytes };
}

/**
 * Strava's archive: activities.csv says each file's type and name ("Hike", "Walk"...): file base name ->
 * {sport, name}. Columns found by their header (English or not: the file column by its values).
 */
export function stravaIndex(csv) {
  const rows = []; let row = [], f = "", q = false;
  for (let i = 0; i < csv.length; i++) {
    const ch = csv[i];
    if (q) { if (ch === '"') { if (csv[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += ch; continue; }
    if (ch === '"') q = true;
    else if (ch === ",") { row.push(f); f = ""; }
    else if (ch === "\n" || ch === "\r") { if (ch === "\r" && csv[i + 1] === "\n") i++; row.push(f); rows.push(row); row = []; f = ""; }
    else f += ch;
  }
  if (f || row.length) { row.push(f); rows.push(row); }
  const head = (rows[0] || []).map((h) => h.trim().toLowerCase());
  let fi = head.findIndex((h) => h === "filename"), ti = head.findIndex((h) => /activity type|typ aktywności|^type$/.test(h)), ni = head.findIndex((h) => /activity name|nazwa aktywności|^name$/.test(h));
  if (fi < 0) fi = (rows[1] || []).findIndex((v) => /^activities\//.test(v));
  const out = new Map();
  if (fi < 0) return out;
  for (const r of rows.slice(1)) {
    const file = r[fi]; if (!file) continue;
    out.set(file.split("/").pop().replace(/\.gz$/i, ""), { sport: ti >= 0 ? stravaSport(r[ti]) : null, name: ni >= 0 ? r[ni] || null : null });
  }
  return out;
}
const STRAVA = { hike: "hiking", walk: "walking", run: "running", trailrun: "trail_running", snowshoe: "snowshoeing", ride: "cycling", mountainbikeride: "cycling", backcountryski: "backcountry_skiing", rockclimbing: "rock_climbing" };
export const stravaSport = (t) => { const k = String(t || "").toLowerCase().replace(/[^a-z]/g, ""); return k ? STRAVA[k] || k : null; };

/**
 * Activity files inside a zip (nested zips too: Garmin's export has zips in a zip): {name, bytes, meta?}.
 * name: "outer.zip!inner/path.fit" (.gz unpacked); meta: from Strava's activities.csv when the zip has one.
 */
export async function* activityFilesInZip(src, origin = "", depth = 0) {
  if (!src.read) src = source(src);
  const entries = await listZip(src);
  let index = null;
  const csv = entries.find((e) => /(^|\/)activities\.csv$/i.test(e.name));
  if (csv) { try { index = stravaIndex(new TextDecoder().decode(await readEntry(src, csv))); } catch { index = null; } }
  for (const entry of entries) {
    if (entry.name.endsWith("/")) continue;
    if (ACTIVITY.test(entry.name)) {
      let f;
      try { f = await unpacked(entry.name, await readEntry(src, entry)); } catch { continue; }
      const meta = index?.get(f.name.split("/").pop()) || null;
      yield { name: `${origin}!${f.name}`, bytes: f.bytes, ...(meta ? { meta } : {}) };
    } else if (/\.zip$/i.test(entry.name) && depth < 3) {
      yield* activityFilesInZip(await entrySource(src, entry), `${origin}!${entry.name}`, depth + 1);
    }
  }
}

/** Files (from <input type=file>, or {name, bytes}) -> {name, bytes} of activities. */
export async function* activityFiles(files) {
  for (const f of files) {
    const name = f.name, blob = typeof Blob !== "undefined" && f instanceof Blob; // Blob.bytes is a method, not our field
    if (/\.zip$/i.test(name)) yield* activityFilesInZip(source(blob ? f : f.bytes), name);
    else if (ACTIVITY.test(name)) { const u = await unpacked(name, blob ? new Uint8Array(await f.arrayBuffer()) : f.bytes); yield { name: u.name, id: f.id, bytes: u.bytes }; }
  }
}

/** Garmin activity id from a file name: "…/24724843168_ACTIVITY.fit" and the
 * full export's "name@mail.com_24724843168.fit" -> "24724843168"; else the stem. */
export function activityIdFromName(name) {
  const base = name.split("!").pop().split("/").pop();
  const stem = base.replace(/\.[^.]+$/, "");
  const m = stem.match(/^(\d+)(?=_|$)|_(\d{6,})(?=_|$)/);
  return m ? m[1] || m[2] : stem;
}
