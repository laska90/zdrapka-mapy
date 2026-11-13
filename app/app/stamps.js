// Stamps for the badge peaks, like a rubber stamp in a hiking booklet: the summit's real silhouette
// (a terrain profile through it, tools/art/stamps-data.mjs), the one thing standing on its top, at most
// one known place below it (a hut, a waterfall, a castle), name and height round the rim, the date in a
// band; one ink per badge, printed imperfectly (a ragged edge, specks, uneven pressure, a faint double).
// The data per summit (app/stamps-data.json): {h: heights 50 m apart, sp: half the frame in steps,
// ex: exaggeration, tp: the picture's top, o: [[kind, dx, scale]], b: bare top, w: {k, n, al} below}.

const I = "var(--ink)", Pp = "var(--paper)";
export const STAMP_INK = { kgp: "#8a6410", ks: "#1f5f8b", sw: "#a8322d", kbp: "#2f6b3a", tkt: "#3a4e8c", kgs: "#7a3b6e", kbs: "#9a5a1c", kbw: "#2e6e70" };
const PAPER = "#f6f1e4", BLANK = "#b9b4a8";

// ---------- terrain from the profile: smoothed, gently exaggerated, the summit near the middle
function terrain(rec) {
  const span = rec.sp, top = rec.tp ?? 78, ex = rec.ex ?? 4.4;
  let hs = rec.h.slice();
  for (let pass = 0; pass < 3; pass++) hs = hs.map((_, i) => { let s = 0, n = 0; for (let k = -2; k <= 2; k++) if (hs[i + k] != null) { s += hs[i + k]; n++; } return s / n; });
  const mid = hs.length >> 1, cMax = Math.max(...hs.slice(mid - 4, mid + 5)), lo = Math.min(...hs);
  const X0 = 24, X1 = 176, base = 140, hscale = (X1 - X0) / (span * 2 * 50);
  const amp = Math.min(base - top, Math.max(34, (cMax - lo) * hscale * ex)), k = amp / Math.max(1, cMax - lo);
  const pts = hs.map((h, i) => [X0 + (i * (X1 - X0)) / (hs.length - 1), base - Math.min(amp + 6, (h - lo) * k)]);
  let ti = mid - 4; for (let i = mid - 4; i <= mid + 4; i++) if (pts[i][1] < pts[ti][1]) ti = i;
  const surf = (x) => { const t = ((x - X0) / (X1 - X0)) * (pts.length - 1), i = Math.max(0, Math.min(pts.length - 2, Math.floor(t))), f = t - i; return pts[i][1] * (1 - f) + pts[i + 1][1] * f; };
  const shape = `M${X0 - 6} 170 L${X0 - 6} ${pts[0][1].toFixed(1)} ${pts.map(([x, y]) => `L${x.toFixed(1)} ${y.toFixed(1)}`).join(" ")} L${X1 + 6} ${pts.at(-1)[1].toFixed(1)} L${X1 + 6} 170 Z`;
  // a place off the summit: where it lies along the section (al: metres from the summit)
  const at = (al) => ({ x: X0 + ((span + al / 50) * (X1 - X0)) / (2 * span) });
  return { pts, surf, shape, topX: pts[ti][0], topY: pts[ti][1], X0, X1, at, base };
}

/** The frame where the summit stands out best (tools: once per summit): four directions x four widths,
 * or the one given. prof: {deg: [121 heights]}. -> {dir, sp, h} */
export function frameOf(prof, { dir = null, span = null } = {}) {
  let best = null;
  for (const [d, hs0] of Object.entries(prof)) {
    if (dir != null && d !== String(dir)) continue;
    const full = hs0.map((h, i, a) => h ?? a[i - 1] ?? a[i + 1] ?? 0);
    for (const sp of span != null ? [span] : [30, 40, 50, 60]) {
      const w = full.slice(60 - sp, 60 + sp + 1), mid = sp;
      const cMax = Math.max(...w.slice(mid - 4, mid + 5)), lo = Math.min(...w);
      const others = Math.max(...w.filter((_, i) => Math.abs(i - mid) > sp * 0.35));
      const score = (cMax - others) / (cMax - lo + 1) + 0.12 * (sp / 60);
      if (!best || score > best.score) best = { score, dir: +d, sp, h: w };
    }
  }
  return best && { dir: best.dir, sp: best.sp, h: best.h };
}

// ---------- objects: drawn up from (0, 0) = the middle of the base; w = base width
const O = {
  sowa: { w: 16, h: 56, d: `<path d="M-7 0 L-6 -34 L6 -34 L7 0 Z M-8 -34 L8 -34 L8 -37 L-8 -37 Z M-7 -37 L7 -37 L7 -45 L-7 -45 Z M-8 -45 L8 -45 L8 -47 L-8 -47 Z M-8 -47 L-8 -49.5 L-5.5 -49.5 L-5.5 -47 Z M-1.2 -47 L-1.2 -49.5 L1.2 -49.5 L1.2 -47 Z M5.5 -47 L5.5 -49.5 L8 -49.5 L8 -47 Z M0 -56 L5 -54.5 L0 -53 Z" fill="${I}"/><path d="M0 -49.5 L0 -56" stroke="${I}" stroke-width="1"/><path d="M-6 -38.6 L-6 -41.8 A1.1 1.1 0 0 1 -3.8 -41.8 L-3.8 -38.6 Z M-2.6 -38.6 L-2.6 -41.8 A1.1 1.1 0 0 1 -0.4 -41.8 L-0.4 -38.6 Z M0.9 -38.6 L0.9 -41.8 A1.1 1.1 0 0 1 3.1 -41.8 L3.1 -38.6 Z M4.2 -38.6 L4.2 -41.8 A1.1 1.1 0 0 1 6.2 -41.8 L6.2 -38.6 Z M-1 -27 L1 -27 L1 -23.5 L-1 -23.5 Z M-1 -16 L1 -16 L1 -12.5 L-1 -12.5 Z M-2 0 L-2 -4.5 A2 2 0 0 1 2 -4.5 L2 0 Z" fill="${Pp}"/>` },
  franz: { w: 18, h: 46, d: `<path d="M-9 0 L-6.5 -32 L6.5 -32 L9 0 Z M-7.5 -32 L7.5 -32 L7.5 -34.5 L-7.5 -34.5 Z M-7 -34.5 L7 -34.5 L7 -44 L-7 -44 Z M-8 -44 L8 -44 L8 -46 L-8 -46 Z" fill="${I}"/><circle cx="-3.5" cy="-39.3" r="1.5" fill="${Pp}"/><circle cx="3.5" cy="-39.3" r="1.5" fill="${Pp}"/><path d="M-1 -25 L1 -25 L1 -20.5 L-1 -20.5 Z M-4.6 -14 L-3.2 -14 L-3.2 -10 L-4.6 -10 Z M3.2 -14 L4.6 -14 L4.6 -10 L3.2 -10 Z M-2.2 0 L-2.2 -5 L2.2 -5 L2.2 0 Z" fill="${Pp}"/><path d="M-6.4 -33.2 L6.4 -33.2" stroke="${Pp}" stroke-width=".8"/>` },
  klodzka: { w: 20, h: 50, d: `<path d="M-10 0 L-5 -38 M10 0 L5 -38" stroke="${I}" stroke-width="2.4"/><path d="M-9 -6 L8.2 -12 L-7.4 -18 L6.8 -24 L-6.2 -30 L5.6 -36 M9 -6 L-8.2 -12 L7.4 -18 L-6.8 -24 L6.2 -30 L-5.6 -36 M-8.2 -12 L8.2 -12 M-6.8 -24 L6.8 -24" stroke="${I}" stroke-width="1.1" fill="none"/><path d="M-6.5 -37 L6.5 -37 L6.5 -44 L-6.5 -44 Z M-8.5 -44 L8.5 -44 L3.5 -50 L-3.5 -50 Z" fill="${I}"/><path d="M-5 -42 L5 -42" stroke="${Pp}" stroke-width="1.6"/>` },
  jagodna: { w: 24, h: 46, d: `<path d="M-11 0 L-4 -36 M11 0 L4 -36" stroke="${I}" stroke-width="2.2"/><path d="M-6 0 L-1.5 -36 M6 0 L1.5 -36 M-9 -9 Q0 -17 9 -9 M-7.6 -16 L7.6 -16 M-6 -26 L6 -26" stroke="${I}" stroke-width="1.2" fill="none"/><path d="M-3 -18 Q0 -20 3 -18 Q0 -22 -3 -24 Q0 -26 3 -24" stroke="${I}" stroke-width=".9" fill="none"/><path d="M-13 -36 L13 -36 L11 -39 L-11 -39 Z" fill="${I}"/><path d="M-12 -39 L-12 -44.5 M-6 -39 L-6 -45 M0 -39 L0 -45 M6 -39 L6 -45 M12 -39 L12 -44.5 M-12.5 -44.5 L12.5 -44.5 M-12.5 -42 L12.5 -42" stroke="${I}" stroke-width="1.1"/>` },
  chelmiec: { w: 12, h: 50, d: `<path d="M-6 0 L-6 -24 L6 -24 L6 0 Z M-3.6 -24 L-1 -50 L1 -50 L3.6 -24 Z" fill="${I}"/><path d="M-6 -6 L6 -6 M-6 -12 L6 -12 M-6 -18 L6 -18 M-2 0 L-2 -6 M2.5 -6 L2.5 -12 M-2 -12 L-2 -18 M2.5 -18 L2.5 -24 M-3 -30 L3 -30 M-2.4 -36 L2.4 -36 M-1.8 -42 L1.8 -42" stroke="${Pp}" stroke-width="1"/><path d="M-1.5 -21 L1.5 -21 L1.5 -15.5 L-1.5 -15.5 Z" fill="${Pp}"/>` },
  sleza: { w: 34, h: 48, d: `<path d="M-15 0 L-15 -9 L5 -9 L5 0 Z M-17 -9 L-11 -16 L1 -16 L7 -9 Z M10 0 L13.2 -48 L14.8 -48 L18 0 Z" fill="${I}"/><path d="M-12.5 -6.5 L-10.5 -6.5 L-10.5 -3.5 L-12.5 -3.5 Z M-8 -6.5 L-6 -6.5 L-6 -3.5 L-8 -3.5 Z M-3.5 -6.5 L-1.5 -6.5 L-1.5 -3.5 L-3.5 -3.5 Z M1 -6.5 L3 -6.5 L3 -3.5 L1 -3.5 Z" fill="${Pp}"/><path d="M11 -10 L17 -10 M11.6 -19 L16.4 -19 M12.2 -28 L15.8 -28 M12.7 -37 L15.3 -37" stroke="${Pp}" stroke-width="2.2"/><path d="M14 -48 L14 -53" stroke="${I}" stroke-width="1.2"/>` },
  szczhut: { w: 30, h: 26, d: `<path d="M-11 0 L-11 -8 L11 -8 L11 0 Z M-13 -8 L13 -8 L13 -9.5 L-13 -9.5 Z M-11 -9.5 L-11 -17 L11 -17 L11 -9.5 Z M-15 -16.5 L-9 -22.5 L9 -22.5 L15 -16.5 Z M6 -22 L6 -25.5 L10 -25.5 L10 -22 Z" fill="${I}"/><path d="M-11 -4 L11 -4 M-6 0 L-6 -4 M3 0 L3 -4 M-2 -4 L-2 -8 M7 -4 L7 -8 M-8 -10 L-8 -17 M-5 -10 L-5 -17 M5 -10 L5 -17 M8 -10 L8 -17" stroke="${Pp}" stroke-width=".8"/><path d="M-3.5 -15 L-1.5 -15 L-1.5 -12 L-3.5 -12 Z M1.5 -15 L3.5 -15 L3.5 -12 L1.5 -12 Z M-9.5 0 L-9.5 -3 A1.5 1.5 0 0 1 -6.5 -3 L-6.5 0 Z" fill="${Pp}"/>` },
  lattice: { w: 18, h: 40, d: `<path d="M-9 0 L-4 -34 M9 0 L4 -34" stroke="${I}" stroke-width="2.6" fill="none"/><path d="M-8 -5 L7 -12 L-6 -19 L6 -25 L-5 -31 M8 -5 L-7 -12 L6 -19 L-6 -25 L5 -31" stroke="${I}" stroke-width="1.3" fill="none"/><path d="M-8 -34 L8 -34 L8 -39 L-8 -39 Z" fill="${I}"/><path d="M-6 -39 L-6 -44 M6 -39 L6 -44 M-6 -43 L6 -43" stroke="${I}" stroke-width="1.3"/>` },
  discs: { w: 14, h: 34, d: `<path d="M-6 0 L-6 -7 L6 -7 L6 0 Z" fill="${I}"/><rect x="-19" y="-14" width="38" height="7" rx="3.5" fill="${I}"/><path d="M-4 -14 L-4 -17 L4 -17 L4 -14 Z" fill="${I}"/><rect x="-23" y="-24" width="46" height="7" rx="3.5" fill="${I}"/><path d="M-4 -24 L-4 -26 L4 -26 L4 -24 Z" fill="${I}"/><rect x="-14" y="-32" width="28" height="6" rx="3" fill="${I}"/><path d="M-17 -10.5 L17 -10.5 M-21 -20.5 L21 -20.5 M-12 -29 L12 -29" stroke="${Pp}" stroke-width=".9"/>` },
  borderpost: { w: 7, h: 24, d: `<path d="M-3 0 L-3 -20 L3 -20 L3 0 Z" fill="${I}"/><path d="M-3 -16 L3 -13 M-3 -10 L3 -7 M-3 -4 L3 -1" stroke="${Pp}" stroke-width="2"/><path d="M-4.5 -20 L4.5 -20 L4.5 -24 L-4.5 -24 Z" fill="${I}"/>` },
  tor: { w: 20, h: 30, d: `<path d="M-10 0 Q-12 -6 -8 -9 L8 -9 Q12 -6 10 0 Z M-7 -9 Q-9 -14 -5 -17 L6 -17 Q9 -14 7 -9 Z M-5 -17 Q-6 -22 -3 -24 L4 -24 Q6 -21 5 -17 Z M-3 -24 Q-3 -28 0 -29 Q3 -28 3 -24 Z" fill="${I}"/><path d="M-9 -4.5 L9 -4.5 M-6 -13 L6 -13 M-4 -20.5 L4 -20.5 M1 0 L2 -9 M-1 -9 L-2 -17" stroke="${Pp}" stroke-width="1"/>` },
  boulders: { w: 26, h: 12, d: `<path d="M-13 0 Q-14 -7 -8 -8 Q-4 -12 1 -9 Q4 -13 8 -9 Q14 -8 13 0 Z" fill="${I}"/><path d="M-6 0 Q-6 -5 -2 -7 M5 0 Q4 -4 7 -7" stroke="${Pp}" stroke-width="1" fill="none"/>` },
  hut: { w: 26, h: 24, d: `<path d="M-12 0 L-12 -11 L12 -11 L12 0 Z M-15 -11 L0 -21 L15 -11 Z M7 -16 L7 -22 L10 -22 L10 -14 Z" fill="${I}"/><path d="M-9 -8 L-5 -8 L-5 -4 L-9 -4 Z M5 -8 L9 -8 L9 -4 L5 -4 Z M-2 0 L-2 -6 L2 -6 L2 0 Z" fill="${Pp}"/>` },
  castle: { w: 34, h: 30, d: `<path d="M-17 0 L-17 -14 L-14 -14 L-14 -17 L-11 -17 L-11 -14 L-8 -14 L-8 -17 L-5 -17 L-5 -14 L-3 -14 L-3 -26 L-1 -26 L-1 -29 L2 -29 L2 -26 L4 -26 L4 -29 L7 -29 L7 -24 L5 -21 L8 -18 L8 -12 L13 -12 L14 -8 L17 -9 L17 0 Z" fill="${I}"/><path d="M0 -20 L0 -23 Q1.5 -25 3 -23 L3 -20 Z M-12 -6 L-12 -9 Q-10.5 -11 -9 -9 L-9 -6 Z" fill="${Pp}"/>` },
  ruinring: { w: 24, h: 10, d: `<path d="M-12 0 L-12 -7 L-9 -7 L-9 -4 L-5 -4 L-5 -9 L-1 -9 L-1 -5 L3 -5 L3 -8 L7 -8 L7 -3 L10 -3 L10 -6 L12 -6 L12 0 Z" fill="${I}"/><path d="M-11 -2 L11 -2" stroke="${Pp}" stroke-width=".8"/>` },
  outlook: { w: 20, h: 14, d: `<path d="M-10 0 Q-11 -6 -6 -8 L6 -8 Q11 -6 10 0 Z" fill="${I}"/><path d="M-7 -8 L-7 -14 M0 -8 L0 -14 M7 -8 L7 -14 M-8 -13.5 L8 -13.5" stroke="${I}" stroke-width="1.3"/>` },
};
const spruce = (x, y, h) => `<path d="M${x} ${y + 2} L${x} ${y - 1} M${x - h * 0.33} ${y} L${x} ${y - h} L${x + h * 0.33} ${y} Z" fill="${I}" stroke="${I}" stroke-width="1"/>`;
const pine = (x, y, s) => `<path d="M${x - 5 * s} ${y + 1} Q${x - 5 * s} ${y - 4 * s} ${x - 1 * s} ${y - 4 * s} Q${x + 1 * s} ${y - 6 * s} ${x + 4 * s} ${y - 3.5 * s} Q${x + 6 * s} ${y - 2 * s} ${x + 5 * s} ${y + 1} Z" fill="${I}"/>`;

/** An object standing on the terrain: its base sits on the lower of the ground under its two edges
 * (the uphill side sinks into the slope), and a foot of ink fills down to the ground on the downhill side. */
function place(T, kind, dx, s = 1) {
  const o = O[kind], x = T.topX + dx, hw = (o.w * s) / 2;
  const y = Math.max(T.surf(x - hw), T.surf(x + hw), T.surf(x)) + 0.8;
  const foot = o.w ? `<path d="M${(x - hw).toFixed(1)} ${(y - 0.5).toFixed(1)} L${(x + hw).toFixed(1)} ${(y - 0.5).toFixed(1)} L${(x + hw).toFixed(1)} ${(y + 16).toFixed(1)} L${(x - hw).toFixed(1)} ${(y + 16).toFixed(1)} Z" fill="${I}"/>` : "";
  return { x, y, hw, svg: foot + `<g transform="translate(${x.toFixed(1)} ${y.toFixed(1)}) scale(${s})">${o.d}</g>` };
}

/** Trees along the surface (not under the objects, not on the steepest walls), seeded. */
function trees(T, busy, { every = 11, h = 11, from = 0.0, bare = false, seed = 1 } = {}) {
  let r = seed * 977; const rnd = () => ((r = (r * 9301 + 49297) % 233280) / 233280);
  let out = "";
  for (let x = T.X0 + 4 + rnd() * 4; x < T.X1 - 3; x += every * (0.75 + rnd() * 0.6)) {
    if (busy.some((b) => Math.abs(x - b.x) < b.hw + 5)) continue;
    const y = T.surf(x), slope = Math.abs(T.surf(x + 2) - T.surf(x - 2)) / 4;
    if (slope > 1.1 || y > 138) continue;
    if ((T.topY - y) / -1 > 0 && (y - T.topY) < from) continue; // keep the very top clear when asked
    if (bare && y - T.topY < 16) continue; // the bare top: rock and grass only
    out += bare ? pine(x, y + 1, 0.8 + rnd() * 0.4) : spruce(x, y + 1.5, h * (0.8 + rnd() * 0.5));
  }
  return out;
}
/** White lines following the terrain inside the mountain, and vertical hatching on steep walls. */
function relief(T, { cliffs = true } = {}) {
  const off = (d) => T.pts.filter((_, i) => i % 2 === 0).map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)} ${(y + d).toFixed(1)}`).join(" ");
  let s = `<path d="${off(9)}" stroke="${Pp}" stroke-width="1.2" fill="none" stroke-dasharray="14 5"/><path d="${off(19)}" stroke="${Pp}" stroke-width="1" fill="none" stroke-dasharray="6 7"/>`;
  if (cliffs) for (let i = 1; i < T.pts.length - 1; i += 1) {
    const [x, y] = T.pts[i], sl = Math.abs(T.pts[i + 1][1] - T.pts[i - 1][1]) / (T.pts[i + 1][0] - T.pts[i - 1][0]);
    if (sl > 1.6 && i % 1 === 0) s += `<path d="M${x.toFixed(1)} ${(y + 3).toFixed(1)} L${(x + 0.4).toFixed(1)} ${(y + 13).toFixed(1)}" stroke="${Pp}" stroke-width="1.1"/>`;
  }
  return s;
}

const swap = (d) => d.replaceAll(I, "@@").replaceAll(Pp, I).replaceAll("@@", Pp);
const LOW = {
  "Dom Śląski": { w: 40, h: 22, d: swap(`<path d="M-20 0 L-20 -10 L8 -10 L8 0 Z M-22 -10 L-19 -13 L7 -13 L10 -10 Z M-18 -13 L-18 -17 L6 -17 L6 -13 Z M-19 -17 L-15 -21 L3 -21 L7 -17 Z M8 0 L8 -6 L20 -6 L20 0 Z M7 -6 L10 -9 L19 -9 L22 -6 Z" fill="${I}"/><path d="M-17 -7 L-15.5 -7 L-15.5 -4 L-17 -4 Z M-13 -7 L-11.5 -7 L-11.5 -4 L-13 -4 Z M-9 -7 L-7.5 -7 L-7.5 -4 L-9 -4 Z M-5 -7 L-3.5 -7 L-3.5 -4 L-5 -4 Z M-1 -7 L0.5 -7 L0.5 -4 L-1 -4 Z M3 -7 L4.5 -7 L4.5 -4 L3 -4 Z M-14 -16 L-12.5 -16 L-12.5 -14 L-14 -14 Z M-9 -16 L-7.5 -16 L-7.5 -14 L-9 -14 Z M-4 -16 L-2.5 -16 L-2.5 -14 L-4 -14 Z M1 -16 L2.5 -16 L2.5 -14 L1 -14 Z M11 -4.5 L12.5 -4.5 L12.5 -2 L11 -2 Z M15 -4.5 L16.5 -4.5 L16.5 -2 L15 -2 Z" fill="${Pp}"/>`) },
  "Andrzejówka": { w: 32, h: 23, d: swap(`<path d="M-14 0 L-14 -8 L14 -8 L14 0 Z M-16.5 -8 L-6 -22 L6 -22 L16.5 -8 Z M-4 -14 L-4 -17.5 L-1 -17.5 L-1 -14 Z M2 -14 L2 -17.5 L5 -17.5 L5 -14 Z" fill="${I}"/><path d="M-11.5 -6 L-9.5 -6 L-9.5 -3 L-11.5 -3 Z M-7.5 -6 L-5.5 -6 L-5.5 -3 L-7.5 -3 Z M-3.5 -6 L-1.5 -6 L-1.5 -3 L-3.5 -3 Z M0.5 -6 L2.5 -6 L2.5 -3 L0.5 -3 Z M4.5 -6 L6.5 -6 L6.5 -3 L4.5 -3 Z M8.5 -6 L10.5 -6 L10.5 -3 L8.5 -3 Z M-3.4 -16.5 L-1.6 -16.5 L-1.6 -15 L-3.4 -15 Z M2.6 -16.5 L4.4 -16.5 L4.4 -15 L2.6 -15 Z" fill="${Pp}"/>`) },
  hut: { w: 26, h: 22, d: swap(O.hut.d) },
  castle: { w: 34, h: 30, d: swap(O.castle.d) },
  waterfall: { w: 18, h: 20, d: `<path d="M-9 -18 Q0 -21 9 -18" stroke="${Pp}" stroke-width="1.6" fill="none"/><path d="M-5 -18 L-5.5 -3 M-1.5 -19 L-1.5 -2 M2 -19 L2.5 -2 M5.5 -18 L5 -4" stroke="${Pp}" stroke-width="1.7"/><ellipse cx="0" cy="0" rx="10" ry="2.6" fill="${Pp}"/><path d="M-7 -4 Q-9 -6 -8 -8 M7 -4 Q9 -6 8 -8" stroke="${Pp}" stroke-width="1" fill="none"/>` },
};
/** Something near but lower (a hut on the pass, a waterfall, a castle below): where it lies along the
 * section, at its own height, inside the mountain (drawn in paper, in front); moved in until it fits. */
function placeLow(T, e, s0 = 0.95, busy = []) {
  if (e.k === "castle") s0 *= 0.72; // a castle below is wide: smaller, so its knoll stays small
  for (const s of [s0, s0 * 0.82, s0 * 0.68]) { const r = placeLow1(T, e, s, busy); if (r) return r; }
  return "";
}
function placeLow1(T, e, s, busy) {
  const o = LOW[e.n] || LOW[e.k]; if (!o) return ""; // the real shape of the known ones
  const p0 = T.at(e.al), y = 142.5, hw = (o.w * s) / 2, h = o.h * s; // standing just above the date's band
  // inside the stamp's circle at that height (the bottom of the picture is narrower)
  const half = Math.sqrt(69 ** 2 - (y - h - 100) ** 2) - 3, half2 = Math.sqrt(69 ** 2 - (y - 100) ** 2) - 2;
  const clear = (xx) => xx - hw >= 100 - Math.min(half, half2) && xx + hw <= 100 + Math.min(half, half2) && busy.every((b) => Math.abs(xx - b.x) >= b.hw + hw + 4) && Math.abs(xx - T.topX) >= hw + 8;
  // as near as possible to where it really lies along the section (on its side of the summit)
  const side = p0.x < T.topX ? -1 : 1;
  let x = null;
  for (let d = 0; d <= 90 && x == null; d += 2) for (const c of [p0.x + side * d, p0.x - side * d]) { const xx = c; if (clear(xx)) { x = xx; break; } }
  if (x == null) return "";
  // a knoll in front for it to stand on (it merges with the mountain), then the thing cut out in paper
  const top = Math.min(y - h - 5, Math.max(T.surf(x - hw), T.surf(x + hw)) + 2), L = x - hw - 13, R = x + hw + 13;
  const knoll = `<path d="M${L.toFixed(1)} 146 Q${(x - hw - 4).toFixed(1)} ${top.toFixed(1)} ${x.toFixed(1)} ${(top - 1).toFixed(1)} Q${(x + hw + 4).toFixed(1)} ${top.toFixed(1)} ${R.toFixed(1)} 146 Z" fill="${I}"/>`;
  return knoll + `<g transform="translate(${x.toFixed(1)} ${y}) scale(${s})">${o.d}</g>`;
}

// ---------- the picture and the stamp
function picture(rec, seed) {
  const T = terrain(rec), placed = [];
  for (const [k, dx, s] of rec.o || []) if (O[k]) placed.push(place(T, k, dx * 1.15, s * 1.18));
  let art = `<path d="${T.shape}" fill="${I}"/>` + relief(T);
  art += trees(T, placed, { bare: !!rec.b, seed, every: rec.dn ? 10 : 14 });
  art += placed.map((p) => p.svg).join("");
  if (rec.w) art += placeLow(T, rec.w, 0.95, placed);
  return art;
}
const hash = (t) => { let h = 7; for (const ch of t) h = (h * 31 + ch.charCodeAt(0)) | 0; return h >>> 0; };
const escX = (t) => String(t).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

/** One stamp as SVG (200 x 200). rec: the summit's data (null: a plain hill); date: the visit's
 * (none: an empty place in the album, pale and dashed); seed: varies the print (a visit's id). */
export function stampSVG(rec, { name, ele, list = "sw", date = null, seed = 1 } = {}) {
  const got = !!date, nm = escX(String(name).toUpperCase()), fs = nm.length > 16 ? 11.5 : nm.length > 13 ? 12.5 : 14;
  const s0 = (seed % 997) + 1;
  const art = picture(rec || { h: Array.from({ length: 81 }, (_, i) => 100 - Math.abs(i - 40) * 2.2), sp: 40 }, (hash(String(name)) % 97) + 1);
  const ring = `<circle cx="100" cy="100" r="93" fill="none" stroke="${I}" stroke-width="${got ? 4.6 : 2.2}"${got ? "" : ' stroke-dasharray="7 6"'}/><circle cx="100" cy="100" r="71" fill="none" stroke="${I}" stroke-width="1.6"/>` +
    `<path d="M24 100 l2.2 -6.5 l2.2 6.5 l-5.6 -4 h6.8 z M171.5 100 l2.2 -6.5 l2.2 6.5 l-5.6 -4 h6.8 z" fill="${I}"/>`;
  const band = `<rect x="52" y="144" width="96" height="19" fill="${Pp}"/><path d="M52 144 L148 144 M52 163 L148 163" stroke="${I}" stroke-width="1.6"/>`;
  const text = `<defs><path id="tp" d="M25 100 A75 75 0 0 1 175 100"/><path id="bp" d="M21 100 A79 79 0 0 0 179 100"/></defs>` +
    `<text font-family="sans-serif" font-weight="800" font-size="${fs}" letter-spacing="1.4" fill="${I}"><textPath href="#tp" startOffset="50%" text-anchor="middle">${nm}</textPath></text>` +
    `<text font-family="sans-serif" font-weight="700" font-size="11.5" letter-spacing="1.4" fill="${I}" dominant-baseline="hanging"><textPath href="#bp" startOffset="50%" text-anchor="middle">${ele ?? ""} M N.P.M.</textPath></text>` +
    `<text x="100" y="158.5" text-anchor="middle" font-family="monospace" font-weight="700" font-size="12.5" letter-spacing="1" fill="${I}">${got ? escX(date) : "· · ·"}</text>`;
  const pic = `<defs><clipPath id="cl"><circle cx="100" cy="100" r="69.5"/></clipPath></defs><g clip-path="url(#cl)">${art}</g>`;
  const filt = (id, disp, sp, s) => `<filter id="${id}" x="-5%" y="-5%" width="110%" height="110%">` +
    `<feTurbulence type="fractalNoise" baseFrequency=".06" numOctaves="2" seed="${s}" result="w"/>` +
    `<feDisplacementMap in="SourceGraphic" in2="w" scale="${disp}" xChannelSelector="R" yChannelSelector="G" result="d"/>` +
    `<feTurbulence type="fractalNoise" baseFrequency=".9" numOctaves="1" seed="${s + 3}" result="sp"/>` +
    `<feColorMatrix in="sp" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 -6 ${sp}" result="spa"/>` +
    `<feTurbulence type="fractalNoise" baseFrequency=".013" numOctaves="2" seed="${s + 9}" result="pr"/>` +
    `<feColorMatrix in="pr" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 0.8 0.42" result="pra"/>` +
    `<feComposite in="spa" in2="pra" operator="arithmetic" k1="1" result="mask"/><feComposite in="d" in2="mask" operator="in"/></filter>`;
  const all = `<g filter="url(#ink)">${ring}${pic}${band}</g><g filter="url(#txt)">${text}</g>`;
  const body = got ? `<g opacity=".93">${all}</g><g opacity=".14" transform="translate(${(1 + (s0 % 3)).toFixed(1)} ${(-1 - (s0 % 2)).toFixed(1)})">${all}</g>` : `<g opacity=".72">${all}</g>`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200" width="200" height="200"><defs>${filt("ink", 2.8, 4.4, s0)}${filt("txt", 1.2, 5.2, s0 + 50)}</defs>${body}</svg>`;
  return svg.replaceAll(I, got ? STAMP_INK[list] || STAMP_INK.sw : BLANK).replaceAll(Pp, PAPER);
}
const urls = new Map();
/** The same as an image URL (cached). */
export function stampURL(rec, o = {}) {
  const key = `${o.name}|${o.ele}|${o.list}|${o.date}|${o.seed}`;
  let u = urls.get(key);
  if (!u) { u = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(stampSVG(rec, o)); urls.set(key, u); if (urls.size > 600) urls.delete(urls.keys().next().value); }
  return u;
}
const pngs = new Map();
/** The stamp drawn once into a small PNG (the SVG's filters are slow to paint again and again while a
 * page turns or a grid scrolls): a promise of an object URL, cached; the SVG URL if that fails. */
export function stampPNG(rec, o = {}, px = 320) {
  const key = `${o.name}|${o.ele}|${o.list}|${o.date}|${o.seed}|${px}`;
  let p = pngs.get(key);
  if (!p) {
    const svg = stampURL(rec, o);
    p = (async () => {
      try {
        const img = new Image(); img.src = svg; await img.decode();
        const c = document.createElement("canvas"); c.width = c.height = px;
        c.getContext("2d").drawImage(img, 0, 0, px, px);
        const blob = await new Promise((res) => c.toBlob(res, "image/png"));
        return blob ? URL.createObjectURL(blob) : svg;
      } catch { return svg; }
    })();
    pngs.set(key, p);
  }
  return p;
}
/** A seeded tilt (degrees) for a print. */
export const stampTilt = (seed) => (((seed * 37) % 15) - 7) * 0.9;
