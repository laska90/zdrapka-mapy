// A plan in a link: its points (lon, lat to 1e-5 degree, ~1 m) as zigzag varints of the differences, base64url,
// its name and the trip's pace (per gradient class, % of the standard; optional). "1.<points>.<name>.<pace>" — short enough for a chat message; no server: the link carries it all.

const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
function b64(bytes) { let s = ""; for (let i = 0; i < bytes.length; i += 3) { const n = (bytes[i] << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0); s += B64[(n >> 18) & 63] + B64[(n >> 12) & 63]; if (i + 1 < bytes.length) s += B64[(n >> 6) & 63]; if (i + 2 < bytes.length) s += B64[n & 63]; } return s; }
function unb64(s) { const out = []; let n = 0, k = 0; for (const ch of s) { const v = B64.indexOf(ch); if (v < 0) throw new Error("bad link"); n = (n << 6) | v; k += 6; if (k >= 8) { k -= 8; out.push((n >> k) & 255); } } return new Uint8Array(out); }
const zig = (v) => (v < 0 ? -2 * v - 1 : 2 * v), unzig = (u) => (u & 1 ? -(u + 1) / 2 : u / 2);

/** {pts: [[lon, lat], ...], name} -> the token. */
export function encodePlan({ pts, name, pace = null }) {
  const bytes = [], put = (u) => { while (u >= 128) { bytes.push((u % 128) | 128); u = Math.floor(u / 128); } bytes.push(u); };
  let lx = 0, ly = 0;
  put(pts.length);
  for (const [lon, lat] of pts) { const x = Math.round(lon * 1e5), y = Math.round(lat * 1e5); put(zig(x - lx)); put(zig(y - ly)); lx = x; ly = y; }
  const nm = name ? b64(new TextEncoder().encode(name.slice(0, 60))) : "";
  if (!pace?.length) return `1.${b64(bytes)}${nm ? `.${nm}` : ""}`;
  return `1.${b64(bytes)}.${nm}.${b64(Uint8Array.from(pace, (r) => Math.max(1, Math.min(255, Math.round(r * 100)))))}`;
}
/** The token -> {pts: [[lon, lat]], name, pace}; throws on a broken one. */
export function decodePlan(token) {
  const [v, p, n, g] = String(token).split(".");
  if (v !== "1" || !p) throw new Error("bad link");
  const b = unb64(p); let i = 0;
  const get = () => { let u = 0, m = 1, c; do { if (i >= b.length) throw new Error("bad link"); c = b[i++]; u += (c & 127) * m; m *= 128; } while (c & 128); return u; };
  const k = get(), pts = []; let x = 0, y = 0;
  if (k < 1 || k > 200) throw new Error("bad link");
  for (let j = 0; j < k; j++) { x += unzig(get()); y += unzig(get()); pts.push([x / 1e5, y / 1e5]); }
  let pace = null;
  try { if (g) { pace = [...unb64(g)].map((u) => u / 100); if (pace.length < 2 || pace.some((r) => !r)) pace = null; } } catch { pace = null; }
  return { pts, name: n ? new TextDecoder().decode(unb64(n)) : null, pace };
}
/** The link to send: the maps site's page opens it in the app (or says where to get it). */
export const PLAN_PAGE = "https://laska90.github.io/zdrapka-mapy/p/";
export const planLink = (plan) => `${PLAN_PAGE}#${encodePlan(plan)}`;
/** A token from what the app was opened with (zdrapka://plan?d=…, the page's link #…, or the web app's #plan=…). */
export function tokenOf(url) {
  const s = String(url || "");
  const m = s.match(/[?&#]d=([0-9A-Za-z._-]+)/) || s.match(/#plan=([0-9A-Za-z._-]+)/) || s.match(/\/p\/#([0-9A-Za-z._-]+)/);
  return m ? m[1] : null;
}
