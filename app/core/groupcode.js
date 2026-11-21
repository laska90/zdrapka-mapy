// A friend's file (.zdrapka): where they have walked, each trail once (their matched, scratched stretches,
// glued into lines, simplified to ~10 m), and their pace by gradient (for the time of a trip together).
// No times, no dates of outings, nothing off the trails. The lines in lon/lat (any pack reads them), as
// differences on a 1e-5° grid (~1 m), zigzag varints, deflated, base64. The rest plain JSON.

export const FRIEND_APP = "zdrapka-znajomy";

function put(out, n) { let u = n >= 0 ? n * 2 : -n * 2 - 1; while (u >= 128) { out.push((u % 128) | 128); u = Math.floor(u / 128); } out.push(u); }
function reader(b) { let i = 0; return () => { let u = 0, m = 1, x; do { x = b[i++]; u += (x & 127) * m; m *= 128; } while (x & 128); return u % 2 ? -(u + 1) / 2 : u / 2; }; }

/** [[[lon, lat]]] -> bytes */
export function packLines(lines) {
  const out = [1]; put(out, lines.length);
  let px = 0, py = 0;
  for (const l of lines) { put(out, l.length); for (const [lon, lat] of l) { const X = Math.round(lon * 1e5), Y = Math.round(lat * 1e5); put(out, X - px); put(out, Y - py); px = X; py = Y; } }
  return Uint8Array.from(out);
}
/** bytes -> [[[lon, lat]]] */
export function unpackLines(bytes) {
  if (bytes[0] !== 1) throw new Error("unknown lines code");
  const get = reader(bytes.subarray(1)), lines = [];
  let px = 0, py = 0;
  for (let n = get(); n > 0; n--) { const l = []; for (let k = get(); k > 0; k--) { px += get(); py += get(); l.push([px / 1e5, py / 1e5]); } lines.push(l); }
  return lines;
}

async function through(bytes, stream) { return new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(stream)).arrayBuffer()); }
const toB64 = (b) => { let s = ""; for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode.apply(null, b.subarray(i, i + 0x8000)); return btoa(s); };
const fromB64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

/** {id, name, pace, lines, km} -> the file's text */
export async function encodeFriend({ id, name, pace = null, lines, km }) {
  const z = toB64(await through(packLines(lines), new CompressionStream("deflate-raw")));
  return JSON.stringify({ app: FRIEND_APP, v: 1, id, name, sent: Date.now(), km: Math.round(km), pace, lines: z });
}
/** the file's text -> {id, name, sent, km, pace, lines} (throws: not a friend's file) */
export async function decodeFriend(text) {
  const d = JSON.parse(text);
  if (d?.app !== FRIEND_APP || !d.id || !d.lines) throw new Error("not a friend's file");
  return { id: String(d.id), name: String(d.name || "Znajomy").slice(0, 30), sent: d.sent || null, km: d.km || 0, pace: d.pace || null, lines: unpackLines(await through(fromB64(d.lines), new DecompressionStream("deflate-raw"))) };
}

/** Line simplification (Douglas-Peucker) in metres: [[x, y]] -> [[x, y]] */
export function simplifyXY(line, eps = 10) {
  if (line.length < 3) return line;
  const keep = new Uint8Array(line.length); keep[0] = keep[line.length - 1] = 1;
  const st = [[0, line.length - 1]];
  while (st.length) {
    const [a, b] = st.pop(), [ax, ay] = line[a], [bx, by] = line[b], dx = bx - ax, dy = by - ay, L = Math.hypot(dx, dy) || 1e-9;
    let bi = -1, bd = 0;
    for (let i = a + 1; i < b; i++) { const d = Math.abs(dy * (line[i][0] - ax) - dx * (line[i][1] - ay)) / L; if (d > bd) { bd = d; bi = i; } }
    if (bd > eps) { keep[bi] = 1; st.push([a, bi], [bi, b]); }
  }
  return line.filter((_, i) => keep[i]);
}

/** Walked stretches -> lines: whole ones glued end to end where exactly two meet (a junction of more
 * splits them), part ones as they are. whole, parts: [[[x, y]]] -> [[[x, y]]] */
export function glueLines(whole, parts = []) {
  const key = ([x, y]) => `${Math.round(x)},${Math.round(y)}`, at = new Map();
  whole.forEach((l, i) => { for (const e of [0, 1]) { const k = key(e ? l[l.length - 1] : l[0]); if (!at.has(k)) at.set(k, []); at.get(k).push(i); } });
  const used = new Uint8Array(whole.length), out = [];
  const chain = (k0, i0) => {
    const pts = []; let k = k0, i = i0;
    while (i != null && !used[i]) {
      used[i] = 1;
      let l = whole[i]; if (key(l[0]) !== k) l = [...l].reverse();
      pts.push(...(pts.length ? l.slice(1) : l));
      k = key(l[l.length - 1]);
      const next = (at.get(k) || []).filter((j) => !used[j]);
      i = at.get(k).length === 2 && next.length === 1 ? next[0] : null;
    }
    return pts;
  };
  for (const [k, is] of at) if (is.length !== 2) for (const i of is) if (!used[i]) out.push(chain(k, i));
  whole.forEach((l, i) => { if (!used[i]) out.push(chain(key(l[0]), i)); }); // (loops)
  return [...out, ...parts].filter((l) => l.length >= 2);
}
