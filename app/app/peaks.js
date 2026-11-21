// The named summits the app knows (Szczyty w aparacie names them, Replay 3D looks towards them): every named
// peak with a height in the loaded map packs, with the badge lists' ones.

import { KS, SW } from "../core/badge-lists.js";
import { unprojector } from "../core/pack.js";

const KS_NAMES = new Set(KS.map((p) => p.n));
const BADGE_PEAKS = (() => {
  const seen = new Map();
  for (const p of [...KS, ...SW]) if (p.ele != null && !seen.has(p.n)) seen.set(p.n, { name: p.n, lat: p.lat, lon: p.lon, ele: p.ele, ks: KS_NAMES.has(p.n) });
  return [...seen.values()];
})();

/**
 * The summits to name: every named peak with a height in the loaded map packs (data.names.pois:
 * [id, name, class, x, y, height]), with the badge lists' ones (their checked positions win, and they
 * keep `ks`); the same summit twice (a badge one within 300 m of a pack one): once.
 */
export function peakList(C) {
  const pois = C?.view?.data?.names?.pois, meta = C?.view?.meta, out = [...BADGE_PEAKS];
  if (!pois?.length || !meta) return out;
  const U = unprojector(meta), cosLat = Math.cos((50.5 * Math.PI) / 180);
  const near = (a, b) => Math.abs(a.lat - b.lat) * 111195 < 300 && Math.abs(a.lon - b.lon) * 111195 * cosLat < 300;
  for (const p of pois) {
    if (p[2] !== "peak" || !p[1] || !Number.isFinite(p[5])) continue;
    const [lon, lat] = U(p[3], p[4]), q = { name: p[1], lat, lon, ele: Math.round(p[5]) };
    if (!BADGE_PEAKS.some((b) => near(b, q))) out.push(q);
  }
  return out;
}
