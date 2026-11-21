// An outing's points, small: for the backup file (and, later, a friend's traces). Per part: the points as
// differences from the one before (time in seconds, lat/lon in 1e-6 deg ~ 0.1 m, height in dm), zigzag varints,
// then deflate, then base64. About 5 bytes a point before deflate, ~20x less than the points as JSON.

// zigzag varints in plain arithmetic (the first time is ~1.7e9 s: past 32 bits once zigzagged)
function put(out, n) {
  let u = n >= 0 ? n * 2 : -n * 2 - 1;
  while (u >= 128) { out.push((u % 128) | 128); u = Math.floor(u / 128); }
  out.push(u);
}
function reader(b) {
  let i = 0;
  return {
    get() { let u = 0, m = 1, x; do { x = b[i++]; u += (x & 127) * m; m *= 128; } while (x & 128); return u % 2 ? -(u + 1) / 2 : u / 2; },
    done: () => i >= b.length,
  };
}

/** parts [[{t, lat, lon, ele}]] -> bytes (not deflated). Version 1. */
export function packTrack(parts) {
  const out = [1];
  put(out, parts.length);
  for (const p of parts) {
    const hasEle = p.some((q) => q.ele != null && Number.isFinite(q.ele));
    put(out, p.length); put(out, hasEle ? 1 : 0);
    let t = 0, la = 0, lo = 0, e = 0;
    for (const q of p) {
      const T = Math.round(q.t / 1000), LA = Math.round(q.lat * 1e6), LO = Math.round(q.lon * 1e6);
      put(out, T - t); put(out, LA - la); put(out, LO - lo); t = T; la = LA; lo = LO;
      if (hasEle) { const E = q.ele != null && Number.isFinite(q.ele) ? Math.round(q.ele * 10) : e; put(out, E - e); e = E; } // (a missing height: the one before)
    }
  }
  return Uint8Array.from(out);
}

/** bytes -> parts [[{t, lat, lon, ele}]] */
export function unpackTrack(bytes) {
  if (bytes[0] !== 1) throw new Error("unknown track code");
  const r = reader(bytes.subarray(1)), parts = [];
  for (let n = r.get(); n > 0; n--) {
    const len = r.get(), hasEle = r.get() === 1, p = [];
    let t = 0, la = 0, lo = 0, e = 0;
    for (let k = 0; k < len; k++) {
      t += r.get(); la += r.get(); lo += r.get();
      if (hasEle) e += r.get();
      p.push({ t: t * 1000, lat: la / 1e6, lon: lo / 1e6, ele: hasEle ? e / 10 : null });
    }
    parts.push(p);
  }
  return parts;
}

async function through(bytes, stream) {
  return new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(stream)).arrayBuffer());
}
const toB64 = (b) => { let s = ""; for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode.apply(null, b.subarray(i, i + 0x8000)); return btoa(s); };
const fromB64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

/** parts -> text (deflated, base64) */
export async function encodeTrack(parts) { return toB64(await through(packTrack(parts), new CompressionStream("deflate-raw"))); }
/** text -> parts */
export async function decodeTrack(text) { return unpackTrack(await through(fromB64(text), new DecompressionStream("deflate-raw"))); }
