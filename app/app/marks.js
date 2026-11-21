// The app's own marks, one place for all of them (no DOM: SVG as strings, so the worker, node and the tests can
// use them too). Three families that never mix: a circle with the seasons' ring = a peak; a rounded square with a
// post = a long trail; a circle with a landscape = a badge. Plus the peak sign itself (version A: the big top on the
// right, a shoulder on the left, one line), the violet medal, and the four-part bar of a range's thresholds.

/** The peak sign (24 units): the app's icon, the medals, the rings, the start, the badge peaks on the map. */
export const SIGN_A = "M2.5 19h19L14.5 6.5l-3.3 5.3-2.2-3z";
/** The seasons, spring at the top left, then clockwise: summer, autumn, winter. */
export const SEASONS = ["wiosna", "lato", "jesień", "zima"];
export const SEASON_COL = ["#2f9e7a", "#e0a11d", "#b23a48", "#4459b8"];
const OFF = "#e3e5e4";
export const MEDAL_GRAD = ["#7a52e6", "#4a1fb8"];

/** The season of a month (0 = January): III–V spring, VI–VIII summer, IX–XI autumn, XII–II winter. */
export const seasonOfMonth = (m) => (m >= 2 && m <= 4 ? 0 : m >= 5 && m <= 7 ? 1 : m >= 8 && m <= 10 ? 2 : 3);
/** The season of a moment (ms, local time); null without a real date (the app keeps undated ones under 1e11). */
export const seasonOf = (ms) => (ms == null || ms < 1e11 ? null : seasonOfMonth(new Date(ms).getMonth()));
/** The seasons of a place's visits (found[].outs: [[outing, ms], ...]): a sorted list of 0..3, each once. */
export function seasonsOf(outs) {
  const s = new Set();
  for (const o of outs || []) { const k = seasonOf(Array.isArray(o) ? o[1] : o); if (k != null) s.add(k); }
  return [...s].sort();
}

let uid = 0;
const id = (p) => `${p}${(uid = (uid + 1) % 1e9).toString(36)}`;
const f2 = (n) => n.toFixed(2);
const pt = (r, a) => [50 + r * Math.cos((a * Math.PI) / 180), 50 + r * Math.sin((a * Math.PI) / 180)];
const grad = (gid, [a, b], diag = true) => `<linearGradient id="${gid}" x1="0" y1="0" x2="${diag ? 1 : 0}" y2="1"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient>`;

/** One quarter of the ring (k: 0 spring .. 3 winter) as a filled sector in a 100 box: straight cuts of a constant
 * width (gap), corners rounded by cr. */
export function sectorPath(k, r = 43, w = 10, gap = 3, cr = 1.4) {
  const r0 = r - w / 2 + cr, r1 = r + w / 2 - cr, a0 = -180 + k * 90, a1 = a0 + 90;
  const d0 = ((gap / 2 + cr) / r0) * 57.3, d1 = ((gap / 2 + cr) / r1) * 57.3; // (a parallel cut, not a wedge)
  const [ax, ay] = pt(r1, a0 + d1), [bx, by] = pt(r1, a1 - d1), [cx, cy] = pt(r0, a1 - d0), [dx, dy] = pt(r0, a0 + d0);
  return `M${f2(ax)},${f2(ay)}A${r1},${r1} 0 0 1 ${f2(bx)},${f2(by)}L${f2(cx)},${f2(cy)}A${r0},${r0} 0 0 0 ${f2(dx)},${f2(dy)}Z`;
}
const sector = (k, col, cr = 1.4) => `<path d="${sectorPath(k)}" fill="${col}" stroke="${col}" stroke-width="${2 * cr}" stroke-linejoin="round"/>`;
/** The sign A centred in a 100 box, as a white line (on the medal) or grey (not reached). */
export const signA100 = (col = "#fff", sw = 1.9, scale = 1.75) => `<g transform="translate(50 50) scale(${scale}) translate(-12 -13)" fill="none" stroke="${col}" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round"><path d="${SIGN_A}"/></g>`;
/** The medal's disc and sign (no ring), in a 100 box: r its radius. */
export function medalBody(r = 32) {
  const g = id("md");
  return `<defs>${grad(g, MEDAL_GRAD)}</defs><circle cx="50" cy="50" r="${r}" fill="url(#${g})"/>${signA100("#fff", 1.9, (r / 32) * 1.75)}`;
}
/** The violet medal alone, size px. */
export const medalSVG = (size, r = 48) => `<svg class="mk" width="${size}" height="${size}" style="width:${size}px;height:${size}px" viewBox="0 0 100 100" aria-hidden="true">${medalBody(r)}</svg>`;
/** A peak's ring: the seasons you were there coloured, the rest grey; the medal inside (or white and grey, never
 * there). seasons: a list of 0..3; size px (56 / 40 / 28). */
export function ringSVG(seasons, size = 56, reached = null) {
  const got = new Set(seasons || []), on = reached ?? got.size > 0; // (reached with no dated visit: the medal, the ring grey)
  const arcs = [0, 1, 2, 3].map((k) => sector(k, got.has(k) ? SEASON_COL[k] : OFF)).join("");
  const core = on ? medalBody(32) : `<circle cx="50" cy="50" r="31" fill="#fff" stroke="#d3d6d4" stroke-width="2.5"/>${signA100("#b9bdbb", size < 30 ? 2.3 : 1.9)}`;
  return `<svg class="mk sring" width="${size}" height="${size}" style="width:${size}px;height:${size}px" viewBox="0 0 100 100" aria-hidden="true">${arcs}${core}</svg>`;
}
/** The ring, as HTML (its count of visits beside the date, visitsTag: in a corner it hid a season). */
export function ringHTML(outs, size = 56, reached = null) {
  return `<span class="mring" style="--s:${size}px">${ringSVG(seasonsOf(outs), size, reached)}</span>`;
}
/** The count of visits as a small tag (2× and more; nothing for one). */
export const visitsTag = (outs) => ((outs || []).length > 1 ? `<span class="vcnt">${outs.length}×</span>` : "");
/** The four quarters alone (the start's turning ring, the icon): today's season full, the others paler. */
export const ringArcs = (strong = null, dim = 0.62) => [0, 1, 2, 3].map((k) => `<path class="a${k}" d="${sectorPath(k)}" fill="${SEASON_COL[k]}" stroke="${SEASON_COL[k]}" stroke-width="2.8" stroke-linejoin="round"${strong == null || k === strong ? "" : ` opacity="${dim}"`}/>`).join("");

// ---- the badges: a flat landscape in three layers (far light, the badge's colour in the middle, dark in front),
// a sky, a small white sun from 40 px; each badge its own; its shape in the outline (nothing lies on anything)
const GREY = ["#eceeed", "#f7f8f7", "#d7dad8", "#bfc3c1", "#9aa09c"];
export const LANDSCAPES = {
  kgp: { c: ["#fde3e5", "#fff3f3", "#f2a0a8", "#e04150", "#a01b2c"], sun: [26, 30],
    far: "M0 62 16 50 26 56 38 44 48 52 60 40 74 50 86 44 100 54V100H0Z",
    mid: "M0 74 20 58 30 64 50 34 64 56 74 50 100 70V100H0Z",
    near: "M0 84C18 76 34 76 50 80S82 82 100 78V100H0Z",
    extra: '<path d="M43.4 44 50 34 56.6 44 53 41.6 50 44.6 47 41.6z" fill="#fff"/>' },
  ks: { c: ["#fdecc9", "#fff8ea", "#f3c983", "#e39a2f", "#a8670f"], sun: [76, 28],
    far: "M0 64C12 58 22 54 32 56S48 50 56 50 76 56 100 58V100H0Z",
    mid: "M0 76C12 70 24 64 34 64S46 60 52 52L56 46H58.6V43.6H60.4V41.8H62.2V43.6H64V46H66.6L74 56C80 64 90 68 100 70V100H0Z",
    near: "M0 86C22 80 42 80 60 84S86 86 100 82V100H0Z", extra: "" },
  sw: { c: ["#fbe0d4", "#fff4ee", "#eea889", "#d2643c", "#8f3518"], sun: [24, 28],
    far: "M0 60C10 54 18 50 26 52S40 46 50 46 64 54 74 52 90 46 100 50V100H0Z",
    mid: "M0 72C14 64 26 62 36 64S54 56 66 56 86 64 100 64V100H0Z",
    near: "M0 84C20 78 40 78 58 82S86 84 100 80V100H0Z",
    extra: '<path d="M30 100C36 92 42 86 50 82S62 72 66 64 72 58 76 56" fill="none" stroke="#fff" stroke-width="2.6" stroke-dasharray="1.4 5.4" stroke-linecap="round"/>' },
  kbp: { c: ["#dcf0dc", "#f3faf1", "#a9d6ad", "#5aa865", "#2e6b3a"], sun: [74, 26],
    far: "M0 58C12 50 22 46 32 46S50 40 60 36 76 34 84 40 96 48 100 50V100H0Z",
    mid: "M0 70C10 62 20 58 30 58S46 62 54 60 70 52 80 54 94 62 100 64V100H0Z",
    near: "M0 82C14 74 26 72 38 74S60 80 72 76 92 72 100 74V100H0Z", extra: "" },
  tkt: { c: ["#dfe6f0", "#f4f7fa", "#aebcd0", "#6a83a6", "#33465f"], sun: [22, 26],
    far: "M0 62 10 54 18 58 28 46 36 52 46 40 54 48 62 42 72 52 82 46 92 54 100 50V100H0Z",
    mid: "M0 76 12 64 20 68 32 48 40 58 50 30 56 40 62 34 70 50 78 44 88 60 100 56V100H0Z",
    near: "M0 86C20 80 40 82 60 78S86 82 100 80V100H0Z",
    extra: '<path d="M44.8 39.4 50 30 53.6 36.4 51.6 35.6 50 38 48 36.6zM60.4 37.2 62 34 64.8 39.4 63 38.6 62 40.2z" fill="#fff"/>' },
  kgs: { c: ["#dbe6f8", "#f3f7fd", "#a3bde6", "#4a7fd1", "#21468a"], sun: [24, 30],
    far: "M0 64 14 56 24 60 36 50 48 56 62 48 76 54 90 48 100 54V100H0Z",
    mid: "M0 78 16 64 28 68 42 52 52 32C54.5 28 58 27.6 60 30.4 61 32 60.4 33.8 58.6 34.4L57.4 34.8 66 52 76 48 88 60 100 58V100H0Z",
    near: "M0 86C22 80 44 82 64 80S88 82 100 80V100H0Z", extra: "" },
  kbs: { c: ["#f2e7d6", "#fbf7f0", "#dcc094", "#c79a55", "#7f5a28"], sun: [76, 28],
    far: "M0 62C14 54 26 52 36 54S56 50 66 52 88 56 100 58V100H0Z",
    mid: "M0 74C14 62 30 54 49 54V30.5H50.2V24H51.4V30.5H52.6V54C70 54 86 62 100 72V100H0Z",
    near: "M0 86C22 80 46 80 68 84S90 84 100 82V100H0Z",
    extra: '<path d="M48 38h5.8M48.6 45h4.6" stroke="#7f5a28" stroke-width="1.6" stroke-linecap="round"/>' },
  kbw: { c: ["#d8efee", "#f2faf9", "#a1d4d2", "#47a8a6", "#1f6766"], sun: [74, 26],
    far: "M4 62C8 52 12 46 18 46S28 52 32 62ZM62 60C66 50 70 46 74 46S82 50 86 60Z",
    mid: "M14 72C20 54 26 46 34 46S48 54 54 72ZM44 72C50 50 58 40 66 40S80 50 86 72Z",
    near: "M0 70H100V100H0Z",
    extra: '<path d="M2 64h96M8 76h84M20 86h60M34 94h32" stroke="#fff" stroke-opacity=".8" stroke-width="2.6" stroke-linecap="round"/>' },
};
/** A badge's mark (kgp, ks, sw...), size px; on: begun (its colours), else the same landscape in greys. */
export function badgeSVG(key, size = 40, on = true) {
  const o = LANDSCAPES[key];
  if (!o) return medalSVG(size);
  const g = id("bg"), cl = id("bc"), c = on ? o.c : GREY;
  return `<svg class="mk bmark" width="${size}" height="${size}" style="width:${size}px;height:${size}px" viewBox="0 0 100 100" aria-hidden="true"><defs>${grad(g, [c[0], c[1]], false)}<clipPath id="${cl}"><circle cx="50" cy="50" r="48"/></clipPath></defs><g clip-path="url(#${cl})"><rect width="100" height="100" fill="url(#${g})"/>${size >= 40 ? `<circle cx="${o.sun[0]}" cy="${o.sun[1]}" r="7" fill="#fff" opacity=".9"/>` : ""}<path d="${o.far}" fill="${c[2]}"/><path d="${o.mid}" fill="${c[3]}"/><path d="${o.near}" fill="${c[4]}"/>${on ? o.extra : o.extra.replace(/#7f5a28/g, GREY[4])}</g></svg>`;
}

// ---- a long trail: a violet rounded square, a white post with a board, on it the trail's real marking (white,
// colour, white); grey when not begun
const SQ = "M50 0C86 0 100 14 100 50S86 100 50 100 0 86 0 50 14 0 50 0Z";
export function trailSVG(size = 40, col = "#d0202a", on = true) {
  const g = id("tr"), base = on ? MEDAL_GRAD : ["#c9cccb", "#a9adab"];
  return `<svg class="mk tmark" width="${size}" height="${size}" style="width:${size}px;height:${size}px" viewBox="0 0 100 100" aria-hidden="true"><defs>${grad(g, base)}</defs><path d="${SQ}" fill="url(#${g})"/>` +
    `<rect x="46" y="20" width="8" height="64" rx="3" fill="#fff"/><path d="M28 26h40l8 9-8 9H28z" fill="#fff"/>` +
    `<g transform="translate(36 29)"><rect width="22" height="12" fill="#fff"/><rect y="4" width="22" height="4" fill="${on ? col : "#9aa09c"}"/></g>` +
    `<path d="M30 84h40" fill="none" stroke="#fff" stroke-width="4.5" stroke-linecap="round" stroke-opacity=".5"/></svg>`;
}

// ---- a range's thresholds (25 / 50 / 75 / 100 %): four parts with gaps; a full part = a threshold reached,
// the current one filling in a lighter violet
export const PARTS = [25, 50, 75, 100];
/** How full each of the four parts is (0..1). */
export const partsOf = (pct) => PARTS.map((t, i) => Math.max(0, Math.min(1, ((pct || 0) - i * 25) / 25)));
export function thresholdBar(pct) {
  return `<span class="thb">${partsOf(pct).map((q) => `<i${q >= 1 ? ' class="on"' : ""}><b style="width:${(q * 100).toFixed(1)}%"></b></i>`).join("")}</span>`;
}

/** Any of these as an image (data URL). */
export const svgURL = (svg) => "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg.replace("<svg ", '<svg xmlns="http://www.w3.org/2000/svg" '));
