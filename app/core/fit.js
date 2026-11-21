// Minimal FIT decoder (port of src/scratchcard/ingest/fit.py): just enough of
// the protocol to pull GPS tracks. Works in browsers, workers and Node.

const FIT_EPOCH_MS = Date.UTC(1989, 11, 31);
const SEMI = 180 / 2 ** 31;
const MESG_SPORT = 12, MESG_SESSION = 18, MESG_RECORD = 20, FIELD_TS = 253;

export const SPORTS = {
  0: "generic", 1: "running", 2: "cycling", 4: "fitness_equipment", 5: "swimming",
  10: "training", 11: "walking", 12: "cross_country_skiing", 13: "alpine_skiing",
  14: "snowboarding", 16: "mountaineering", 17: "hiking", 21: "e_biking",
  22: "motorcycling", 24: "driving", 31: "rock_climbing", 35: "snowshoeing",
};
export const SUB_SPORT_TRAIL = 3;

export class FitError extends Error {}

// base type -> [size, reader, invalid]
const BASE = {
  0x00: [1, (v, o) => v.getUint8(o), 0xff],
  0x01: [1, (v, o) => v.getInt8(o), 0x7f],
  0x02: [1, (v, o) => v.getUint8(o), 0xff],
  0x83: [2, (v, o, le) => v.getInt16(o, le), 0x7fff],
  0x84: [2, (v, o, le) => v.getUint16(o, le), 0xffff],
  0x85: [4, (v, o, le) => v.getInt32(o, le), 0x7fffffff],
  0x86: [4, (v, o, le) => v.getUint32(o, le), 0xffffffff],
  0x88: [4, (v, o, le) => v.getFloat32(o, le), null],
  0x89: [8, (v, o, le) => v.getFloat64(o, le), null],
  0x0a: [1, (v, o) => v.getUint8(o), 0],
  0x8b: [2, (v, o, le) => v.getUint16(o, le), 0],
  0x8c: [4, (v, o, le) => v.getUint32(o, le), 0],
};
const STRING = 0x07;

function decodeValue(view, bytes, pos, size, base, le) {
  if (base === STRING) {
    let end = pos;
    while (end < pos + size && bytes[end] !== 0) end++;
    return end > pos ? new TextDecoder().decode(bytes.subarray(pos, end)) : null;
  }
  const spec = BASE[base];
  if (!spec || spec[0] !== size) return undefined; // arrays / 64-bit / unknown: not needed
  const v = spec[1](view, pos, le);
  return spec[2] !== null && v === spec[2] ? null : v;
}

/** Yield {g: global message number, f: {fieldNum: value}} for every data message. */
export function* iterMessages(input) {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let pos = 0;
  while (pos < bytes.length) {
    if (bytes.length - pos < 12) break;
    const hsize = bytes[pos];
    if (hsize !== 12 && hsize !== 14) throw new FitError(`bad header size ${hsize} at ${pos}`);
    const dataSize = view.getUint32(pos + 4, true);
    if (String.fromCharCode(...bytes.subarray(pos + 8, pos + 12)) !== ".FIT") throw new FitError("missing .FIT signature");
    const start = pos + hsize, end = start + dataSize;
    if (end > bytes.length) throw new FitError("truncated file");
    yield* records(view, bytes, start, end);
    pos = end + 2;
  }
}

function* records(view, bytes, pos, end) {
  const defs = new Map();
  let lastTs = null;
  const read = (local) => {
    const d = defs.get(local);
    if (!d) throw new FitError(`data message for undefined local type ${local}`);
    const f = {};
    for (const [num, size, base] of d.fields) {
      const v = decodeValue(view, bytes, pos, size, base, d.le);
      if (v !== undefined) f[num] = v;
      pos += size;
    }
    pos += d.dev;
    return { g: d.g, f };
  };
  while (pos < end) {
    const h = bytes[pos++];
    if (h & 0x80) {
      const local = (h >> 5) & 0x03, off = h & 0x1f;
      if (lastTs === null) throw new FitError("compressed timestamp before any timestamp");
      let ts = (lastTs & ~0x1f) + off;
      if (off < (lastTs & 0x1f)) ts += 0x20;
      lastTs = ts >>> 0;
      const m = read(local);
      if (m.f[FIELD_TS] === undefined || m.f[FIELD_TS] === null) m.f[FIELD_TS] = lastTs;
      yield m;
      continue;
    }
    const local = h & 0x0f;
    if (h & 0x40) {
      const hasDev = !!(h & 0x20);
      const le = bytes[pos + 1] !== 1;
      const g = view.getUint16(pos + 2, le);
      const n = bytes[pos + 4];
      pos += 5;
      const fields = [];
      for (let i = 0; i < n; i++) fields.push([bytes[pos + 3 * i], bytes[pos + 3 * i + 1], bytes[pos + 3 * i + 2]]);
      pos += 3 * n;
      let dev = 0;
      if (hasDev) {
        const nd = bytes[pos++];
        for (let i = 0; i < nd; i++) dev += bytes[pos + 3 * i + 1];
        pos += 3 * nd;
      }
      defs.set(local, { g, le, fields, dev });
      continue;
    }
    const m = read(local);
    if (typeof m.f[FIELD_TS] === "number") lastTs = m.f[FIELD_TS];
    yield m;
  }
}

const isInt = (v) => typeof v === "number" && Number.isInteger(v);

/** Activity from FIT bytes: {id, sport, subSport, name, start (ms), points:[{t, lat, lon, ele}], asc, desc (the
 * watch's totals, m, or null)} */
export function readFit(input, id) {
  let sportId = null, subSport = null, name = null, start = null, asc = null, desc = null;
  const points = [];
  for (const { g, f } of iterMessages(input)) {
    if (g === MESG_RECORD) {
      const lat = f[0], lon = f[1], ts = f[FIELD_TS];
      if (!isInt(lat) || !isInt(lon) || !isInt(ts)) continue;
      const alt = isInt(f[78]) ? f[78] : f[2];
      points.push({ t: FIT_EPOCH_MS + ts * 1000, lat: lat * SEMI, lon: lon * SEMI, ele: isInt(alt) ? alt / 5 - 500 : null });
    } else if (g === MESG_SESSION) {
      if (sportId === null && isInt(f[5])) { sportId = f[5]; subSport = f[6] ?? null; }
      if (start === null && isInt(f[2])) start = FIT_EPOCH_MS + f[2] * 1000;
      // the watch's own total ascent / descent (22, 23: m; its barometer, its smoothing): what Garmin shows
      if (isInt(f[22])) asc = (asc || 0) + f[22];
      if (isInt(f[23])) desc = (desc || 0) + f[23];
    } else if (g === MESG_SPORT) {
      if (sportId === null && isInt(f[0])) { sportId = f[0]; subSport = f[1] ?? null; }
      if (typeof f[3] === "string") name = f[3];
    }
  }
  points.sort((a, b) => a.t - b.t);
  if (start === null && points.length) start = points[0].t;
  const sport = sportId === null ? "unknown" : SPORTS[sportId] || `sport_${sportId}`;
  return { id, sport, subSport: isInt(subSport) ? subSport : null, name, start, points, asc, desc };
}

export function effectiveSport(a) {
  return a.sport === "running" && a.subSport === SUB_SPORT_TRAIL ? "trail_running" : a.sport;
}
