// Map symbols: small flat signs like on a tourist map, not pictures. A peak is a triangle; the rest
// is a white sign on a rounded square in its group's colour (five: a roof for the night, views,
// water, rocks and old walls, getting there). Always full colour; reached: a violet tick
// (violet is what is yours), a peak reached is violet. A peak of the badge lists: one gold star on
// its shoulder (the lists' medals, gold, in the cards and the booklets). The same shapes are drawn on the map (canvas, also in a worker) and in
// the lists (SVG).


/** 24 x 24 sign shapes (filled, even-odd). */
export const GLYPH = {
  hut: "M3.5 11.6 12 4.4l8.5 7.2H18.4v8.2H5.6v-8.2Zm7 8.2v-4.6h3v4.6Z",
  tower: "M8 7.2 12 3.6l4 3.6v1.6h-1.3l1.9 11h-2.4l-.5-3.4h-3.4l-.5 3.4H7.4l1.9-11H8Zm3.5 1.6-.7 5h2.4l-.7-5Z",
  ruins: "M3.8 19.8V9.6h2.6v2h2.1v-2h2.6v4.1l2.2-2.6 1.8 2.3.9-3.8h4.2v10.2Zm6.1 0v-3.4a2.1 2.1 0 0 1 4.2 0v3.4Z",
  waterfall: "M5 4h14v2.4h-2V14h-2.2V6.4h-1.7v9.2h-2.2V6.4H9.2V14H7V6.4H5ZM3.4 18.6c2.9-1.7 5.7-1.7 8.6 0s5.7 1.7 8.6 0v2.2c-2.9 1.7-5.7 1.7-8.6 0s-5.7-1.7-8.6 0Z", // falling water over a pool
  viewpoint: "M2.4 12S6 6.2 12 6.2 21.6 12 21.6 12 18 17.8 12 17.8 2.4 12 2.4 12Zm9.6-3.2a3.2 3.2 0 1 0 0 6.4 3.2 3.2 0 0 0 0-6.4Z",
  rock: "M3 19.6 6.2 11l2.6 2.3L11.4 5l3.5 6.4 1.9-1.6 4.2 9.8Z", // a crag: two pinnacles
  shelter: "M2.8 11.4 12 5l9.2 6.4v1.9H2.8ZM5.6 12.6h2.2V20H5.6ZM16.2 12.6h2.2V20h-2.2ZM8.6 16h6.8v1.8H8.6Z", // a roof on posts, a bench
  spring: "M12 3.6c2.8 3.8 4.4 6.2 4.4 8.4a4.4 4.4 0 0 1-8.8 0c0-2.2 1.6-4.6 4.4-8.4ZM3.4 18.6c2.9-1.7 5.7-1.7 8.6 0s5.7 1.7 8.6 0v2.2c-2.9 1.7-5.7 1.7-8.6 0s-5.7-1.7-8.6 0Z",
  cave: "M2.6 20c0-8.2 4.2-14.2 9.4-14.2S21.4 11.8 21.4 20Zm6.2 0c0-3.4 1.4-6 3.2-6s3.2 2.6 3.2 6Z",
  station: "M8.6 3.2h6.8a2.6 2.6 0 0 1 2.6 2.6v8.4a2.6 2.6 0 0 1-2.6 2.6H8.6A2.6 2.6 0 0 1 6 14.2V5.8a2.6 2.6 0 0 1 2.6-2.6ZM9 5.6h6a1 1 0 0 1 1 1v2.4a1 1 0 0 1-1 1H9a1 1 0 0 1-1-1V6.6a1 1 0 0 1 1-1Zm1.4 7.8a1.2 1.2 0 1 1-2.4 0 1.2 1.2 0 0 1 2.4 0Zm5.6 0a1.2 1.2 0 1 1-2.4 0 1.2 1.2 0 0 1 2.4 0ZM8.1 17.4H10l-1.9 3.4H6.2Zm5.9 0h1.9l1.9 3.4h-1.9Z",
  bus: "M8 3.6h8a2.6 2.6 0 0 1 2.6 2.6v8.2a2.6 2.6 0 0 1-2.6 2.6H8a2.6 2.6 0 0 1-2.6-2.6V6.2A2.6 2.6 0 0 1 8 3.6ZM8.4 6h7.2a1 1 0 0 1 1 1v3a1 1 0 0 1-1 1H8.4a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1Zm1.5 8.2a1.1 1.1 0 1 1-2.2 0 1.1 1.1 0 0 1 2.2 0Zm6.4 0a1.1 1.1 0 1 1-2.2 0 1.1 1.1 0 0 1 2.2 0ZM6.6 17.2h3v3h-3Zm7.8 0h3v3h-3Z",
  pass: "M5.6 3.6h2.6c2.4 3.6 3.4 6.4 3.4 8.4s-1 4.8-3.4 8.4H5.6c2.2-3.6 3.1-6.4 3.1-8.4S7.8 7.2 5.6 3.6Zm12.8 0h-2.6c-2.4 3.6-3.4 6.4-3.4 8.4s1 4.8 3.4 8.4h2.6c-2.2-3.6-3.1-6.4-3.1-8.4s.9-4.8 3.1-8.4Z", // a saddle between two tops
  parking: "M8 4h5.2a4.6 4.6 0 0 1 0 9.2H11V20H8Zm3 3v3.2h2.2a1.6 1.6 0 0 0 0-3.2Z",
  ferrata: "M6.6 3h2.3v18H6.6Zm8.5 0h2.3v18h-2.3ZM8.9 5.8h6.2v1.9H8.9Zm0 4.3h6.2V12H8.9Zm0 4.3h6.2v1.9H8.9Z", // a ladder: the steel of a via ferrata
};
/** Signs whose parts overlap (filled nonzero, not even-odd). */
const NONZERO = new Set(["shelter"]);
/** The five groups' colours (violet is kept for what is yours, amber for the plan). */
const G = { stay: "#c0262d", view: "#2f7a45", water: "#3f86ad", rock: "#8a6440", go: "#3f4852" };
export const SIGN_COL = { hut: G.stay, shelter: G.stay, tower: G.view, viewpoint: G.view, waterfall: G.water, spring: G.water, rock: G.rock, cave: G.rock, ruins: G.rock, station: G.go, bus: G.go, parking: G.go, pass: G.rock, ferrata: "#b4561c", peak: "#4e4943" };
const MINE = "#5b2bd1", GOLD = "#d4a020";
/** A five-pointed star (the badge lists' sign on a peak). */
const starPath = (cx, cy, R, r) => { let d = ""; for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + i * Math.PI / 5, q = i % 2 ? r : R; d += (i ? "L" : "M") + (cx + q * Math.cos(a)).toFixed(2) + " " + (cy + q * Math.sin(a)).toFixed(2); } return d + "Z"; };

// The badge lists' medals: a round plate in the list's colour with its sign, white. One letter each:
// Korona Gór Polski (k): a royal crown on gold; Korona Sudetów (y): a crown of peaks on blue; Sudecki
// Włóczykij (r): a hiking boot on red; Turystyczna Korona Tatr (t): a highlander's hat on graphite;
// Korona Gór Słowacji (s): the double cross on three hills on indigo; Korona Beskidów Polskich (b):
// rounded Beskid tops with a little crown on green; Korona Beskidu Śląskiego (l): a top over the young
// Vistula on teal; Korona Beskidu Wyspowego (w): hills like islands over the mist on plum.
export const BADGE_COL = { k: "#c8961e", y: "#2a68ad", r: "#b8322d", t: "#3b3a40", s: "#4b3fa0", b: "#3f8a3a", l: "#1a8fae", w: "#8a4a7e" };
export const BADGE_NAME = { k: "Korona Gór Polski", y: "Korona Sudetów", r: "Sudecki Włóczykij", t: "Turystyczna Korona Tatr", s: "Korona Gór Słowacji", b: "Korona Beskidów Polskich", l: "Korona Beskidu Śląskiego", w: "Korona Beskidu Wyspowego" };
/** The booklets' letters, in order of weight (a summit on several: its medals in this order). */
export const MEDAL_OF = { kgp: "k", tkt: "t", kgs: "s", kbp: "b", ks: "y", kbs: "l", kbw: "w", sw: "r" };
/** A point's medals ("kts": KGP, TKT, Korona Gór Słowacji). */
export const medalLetters = (p) => Object.entries(MEDAL_OF).filter(([id]) => p?.[id]).map(([, m]) => m).join("");
/** The map sign's key for a point: "peak-kts" for a summit of the lists, else its category. */
export const glyphKey = (p) => (p?.c === "peak" && medalLetters(p) ? "peak-" + medalLetters(p) : p?.c);
const MEDAL = {
  k: "M5.2 17.2 4 9.6l4.3 3.3L12 7.3l3.7 5.6L20 9.6l-1.2 7.6ZM5.4 18.6h13.2v2.1H5.4ZM4 6.4a1.6 1.6 0 1 1 0 3.2 1.6 1.6 0 0 1 0-3.2Zm8-2.6a1.6 1.6 0 1 1 0 3.2 1.6 1.6 0 0 1 0-3.2Zm8 2.6a1.6 1.6 0 1 1 0 3.2 1.6 1.6 0 0 1 0-3.2Z",
  y: "M4 17.4 5.3 7.4l3.5 4.4L12 3.6l3.2 8.2 3.5-4.4L20 17.4Zm8-6.2-1.6 3.2h3.2ZM4.6 18.8h14.8v2H4.6Z",
  r: "M7 3.2h5.9v6.3l4.5 1.7c2 .7 3.2 2.5 3.2 4.6V17H5.3l.8-6.7ZM9.6 5.2h2.6v1.4H9.6Zm0 2.6h2.6v1.4H9.6Zm3.9 2.6 2.4.9-.5 1.3-2.4-.9ZM5.2 18.1h15.6v.9c0 1.1-.9 2-2 2H5.2Z",
  t: "M7.3 13.4C7.2 8.3 9.1 5.6 12 5.6s4.8 2.7 4.7 7.8ZM8.3 10.6h7.4v1.5H8.3ZM16.2 6.4l2.4-2.8.9.8-2.2 2.9ZM2.4 16c0-1.8 4.3-3 9.6-3s9.6 1.2 9.6 3-4.3 3.1-9.6 3.1S2.4 17.8 2.4 16Z",
  s: "M10.9 2.8h2.2v2h2.9v1.9h-2.9v1.9h3.9v1.9h-3.9v3.2h-2.2v-3.2H7V8.6h3.9V6.7H8V4.8h2.9ZM2.8 20.6c.9-2.5 2.4-3.8 4.2-3.8 1.1 0 2 .5 2.7 1.3.6-1.6 1.8-2.5 3.3-2.5s2.7.9 3.3 2.5c.7-.8 1.6-1.3 2.7-1.3 1.8 0 3.3 1.3 4.2 3.8Z",
  b: "M2.4 19.8c1.4-4.9 3.6-7.4 6.4-7.4 1.5 0 2.7.7 3.7 1.9 1.3-3.8 3.3-5.8 5.6-5.8 2.5 0 3.3 3.6 3.5 11.3ZM14.2 6.4l.6-3.1 1.5 1.5 1.4-2.1 1.4 2.1 1.5-1.5.6 3.1Z",
  l: "M2.8 13.6 9 5.8l3.8 4.6 2.6-2.8 5.8 6ZM2.8 16.4c1.5-1.2 3.1-1.2 4.6 0s3.1 1.2 4.6 0 3.1-1.2 4.6 0 3.1 1.2 4.6 0v2.4c-1.5 1.2-3.1 1.2-4.6 0s-3.1-1.2-4.6 0-3.1 1.2-4.6 0-3.1-1.2-4.6 0Z",
  w: "M2.8 14.2c1.2-3.6 2.7-5.4 4.4-5.4s3.2 1.8 4.4 5.4ZM10.2 14.2c1.4-4.8 3.2-7.2 5.2-7.2s3.8 2.4 5.2 7.2ZM2.8 15.9h18.4v1.8H2.8ZM5.8 19.1h12.4v1.7H5.8Z",
};

/** "peak", "peak-kts", "hut"... (glyphKey) -> {c, badges: ["k", "t", "s"]} */
const parse = (key) => { const [c, b = ""] = String(key).split("-"); return { c, badges: [...b].filter((k) => MEDAL[k]) }; };

const paths = new Map();
const pathOf = (d) => { if (!paths.has(d)) paths.set(d, new Path2D(d)); return paths.get(d); };

/** One medal of a badge list (k, y, r), r px across, centred on (x, y); d: reached (filled) or not (outlined). */
export function drawMedal(g, b, x, y, sz, d) {
  if (!BADGE_COL[b]) return;
  const col = GOLD;
  const r = sz / 2;
  g.save();
  g.shadowColor = "rgba(0,0,0,.28)"; g.shadowBlur = Math.max(1.5, sz * 0.14); g.shadowOffsetY = sz * 0.04;
  g.beginPath(); g.arc(x, y, r, 0, 7); g.fillStyle = "#fff"; g.fill();
  g.shadowColor = "transparent";
  g.beginPath(); g.arc(x, y, r - Math.max(1.1, sz * 0.1), 0, 7);
  if (d) { g.fillStyle = col; g.fill(); }
  else { g.lineWidth = Math.max(1, sz * 0.08); g.strokeStyle = col; g.stroke(); }
  const k = (sz * 0.6) / 24;
  g.translate(x - 12 * k, y - 12.4 * k); g.scale(k, k);
  g.fillStyle = d ? "#3a2c10" : "#4a4238";
  g.fill(pathOf(MEDAL[b]), "evenodd");
  g.restore();
}

/** Draw the sign for key centred on (x, y), sz px across; d: reached. */
export function drawGlyph(g, key, x, y, sz, d) {
  const { c, badges } = parse(key), col = SIGN_COL[c] || "#555";
  g.save();
  g.lineJoin = "round";
  if (c === "peak") {
    const w = sz * 0.6, top = y - sz * 0.5, bot = y + sz * 0.38;
    g.beginPath(); g.moveTo(x, top); g.lineTo(x + w, bot); g.lineTo(x - w, bot); g.closePath();
    g.lineWidth = 3.2; g.strokeStyle = "rgba(255,255,255,.95)"; g.stroke();
    if (d) { g.fillStyle = MINE; g.fill(); }
    else { g.fillStyle = "#fff"; g.fill(); g.lineWidth = 1.5; g.strokeStyle = col; g.stroke(); }
    if (badges.length) { // one gold star on the right shoulder, however many lists
      const k = sz / 24;
      g.translate(x - 12 * k, y - 12 * k); g.scale(k, k);
      // big enough to see at a glance: a white halo, a dark brown edge, gold inside
      const st = new Path2D(starPath(19.4, 5.4, 6.6, 2.9));
      g.lineWidth = 3.2; g.strokeStyle = "#fff"; g.stroke(st);
      g.lineWidth = 1.1; g.strokeStyle = "#6b4a00"; g.stroke(st); g.fillStyle = "#f2b81e"; g.fill(st);
    }
  } else {
    const h = sz / 2, rr = sz * 0.26;
    g.beginPath(); g.roundRect(x - h, y - h, sz, sz, rr);
    g.lineWidth = 2.2; g.strokeStyle = "rgba(255,255,255,.95)"; g.stroke();
    g.fillStyle = col; g.fill();
    g.save();
    const k = (sz * 0.72) / 24;
    g.translate(x - 12 * k, y - 12 * k); g.scale(k, k);
    g.fillStyle = "#fff";
    g.fill(pathOf(GLYPH[c] || GLYPH.hut), NONZERO.has(c) ? "nonzero" : "evenodd");
    g.restore();
    if (d) { // the tick: you were there
      const tx = x + h - 0.5, ty = y + h - 0.5, r = Math.max(3.6, sz * 0.24);
      g.beginPath(); g.arc(tx, ty, r, 0, 7); g.fillStyle = MINE; g.fill(); g.lineWidth = 1.4; g.strokeStyle = "#fff"; g.stroke();
      g.beginPath(); g.moveTo(tx - r * 0.45, ty + r * 0.02); g.lineTo(tx - r * 0.12, ty + r * 0.36); g.lineTo(tx + r * 0.5, ty - r * 0.32); g.lineWidth = 1.4; g.stroke();
    }
  }
  g.restore();
}

/** A medal as an SVG fragment in a 24 box, centred (cx, cy), sz across. */
function medalSVG(b, cx, cy, sz, d) {
  const col = GOLD, r = sz / 2, k = (sz * 0.6) / 24, ring = Math.max(1.1, sz * 0.1);
  return `<circle cx="${cx}" cy="${cy}" r="${r}" fill="#fff"/>` +
    `<circle cx="${cx}" cy="${cy}" r="${r - ring}" fill="${d ? col : "#fff"}" stroke="${col}" stroke-width="${d ? 0 : sz * 0.08}"/>` +
    `<path transform="translate(${cx - 12 * k} ${cy - 12.4 * k}) scale(${k})" d="${MEDAL[b]}" fill="${d ? "#3a2c10" : "#4a4238"}" fill-rule="evenodd"/>`;
}
/** A medal alone (the lists' headers, the legend). */
export const medalURL = (b, d = true) => "data:image/svg+xml;charset=utf-8," + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="48" height="48">${medalSVG(b, 12, 12, 23, d)}</svg>`);

/** The same sign as an SVG (lists, the legend). */
export function glyphSVG(key, d) {
  const { c, badges } = parse(key), col = SIGN_COL[c] || "#555";
  let body;
  if (c === "peak") {
    body = `<path d="M12 3.5 21.5 19.5H2.5Z" fill="${d ? MINE : "#fff"}" stroke="${d ? "#fff" : col}" stroke-width="${d ? 1.8 : 1.7}" stroke-linejoin="round"/>`;
    if (badges.length) body += `<path d="${starPath(19.4, 5.4, 6.6, 2.9)}" fill="none" stroke="#fff" stroke-width="3.2" stroke-linejoin="round"/><path d="${starPath(19.4, 5.4, 6.6, 2.9)}" fill="#f2b81e" stroke="#6b4a00" stroke-width="1.1" stroke-linejoin="round"/>`;
  } else {
    body =
      `<rect x="2" y="2" width="20" height="20" rx="5.2" fill="${col}" stroke="#fff" stroke-width="1.2"/>` +
      `<g transform="translate(3.4 3.4) scale(.7167)"><path d="${GLYPH[c] || GLYPH.hut}" fill="#fff" fill-rule="${NONZERO.has(c) ? "nonzero" : "evenodd"}"/></g>` +
      (d ? `<circle cx="21.4" cy="21.4" r="5" fill="${MINE}" stroke="#fff" stroke-width="1.6"/><path d="M19.1 21.5l1.6 1.6 3-3.2" fill="none" stroke="#fff" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>` : "");
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-3 -3 30 30" width="48" height="48">${body}</svg>`;
}
export const glyphURL = (key, d) => "data:image/svg+xml;charset=utf-8," + encodeURIComponent(glyphSVG(key, d));

// ---- the map's own signs: quiet, as on a paper tourist map. The bare sign (no coloured plate) in a muted
// ink of its group, a thin white edge to stay readable on any ground; peaks a small dark triangle (the
// lists' gold star on its shoulder); huts alone keep their red plate: the one goal that has to stand out.
// Reached: violet (what is yours). The lists and the cards keep the plated signs above (glyphSVG).
const INK = { hut: "#b2302d", shelter: "#7d3d33", tower: "#45603f", viewpoint: "#45603f", waterfall: "#3a6f8f", spring: "#3a6f8f", rock: "#6b5844", cave: "#6b5844", ruins: "#6b5844", station: "#363c45", bus: "#3f4852", parking: "#3f4852", pass: "#6b5844", ferrata: "#8a4a1c" };
export const PEAK_INK = "#463f38";
/** The plates (where you get to the hills and stay: stations, car parks, bus stops, lifts, huts): one size, one
 * rounding, one white edge; centred on (x, y), s the side. */
export const PLATE_SIDE = 24;
export function drawPlate(g, x, y, s, fill) {
  g.beginPath(); g.roundRect(x - s / 2, y - s / 2, s, s, s * 0.21);
  g.fillStyle = fill; g.fill(); g.lineWidth = 2; g.strokeStyle = "#fff"; g.stroke();
}
/** A white sign (a 24-unit path) on a plate: the sign's share of the plate. */
export function drawPlateSign(g, x, y, s, fill, path, share = 0.7) {
  drawPlate(g, x, y, s, fill);
  const k = (s * share) / 24;
  g.save(); g.translate(x - 12 * k, y - 12 * k); g.scale(k, k); g.fillStyle = "#fff"; g.fill(typeof path === "string" ? new Path2D(path) : path, "evenodd"); g.restore();
}
/** One map sign centred on (x, y): sz its size (px, the sign's box), d reached. */
export function drawMapSign(g, key, x, y, sz, d) {
  const { c, badges } = parse(key);
  g.save(); g.lineJoin = "round";
  if (c === "peak") {
    const s = sz * 0.42;
    g.beginPath(); g.moveTo(x, y - s); g.lineTo(x + s * 1.08, y + s * 0.78); g.lineTo(x - s * 1.08, y + s * 0.78); g.closePath();
    g.lineWidth = 2.4; g.strokeStyle = "rgba(255,255,255,.9)"; g.stroke();
    g.fillStyle = d ? MINE : PEAK_INK; g.fill();
    if (badges.length) {
      const st = new Path2D(starPath(x + s * 1.15, y - s * 0.75, s * 0.78, s * 0.34));
      g.lineWidth = 2.2; g.strokeStyle = "#fff"; g.stroke(st);
      g.fillStyle = "#e9ad17"; g.fill(st); g.lineWidth = 0.7; g.strokeStyle = "#6b4a00"; g.stroke(st);
    }
  } else if (c === "hut") { // a plate as the stations' and car parks' (sz: the plate's side)
    drawPlateSign(g, x, y, sz, d ? MINE : INK.hut, pathOf(GLYPH.hut), 0.74);
  } else {
    const k = sz / 24, p = pathOf(GLYPH[c] || GLYPH.hut);
    g.translate(x - 12 * k, y - 12 * k); g.scale(k, k);
    g.lineWidth = 3.4; g.strokeStyle = "rgba(255,255,255,.88)"; g.stroke(p);
    g.fillStyle = d ? MINE : INK[c] || "#5a4f45"; g.fill(p, NONZERO.has(c) ? "nonzero" : "evenodd");
  }
  g.restore();
}
/** The map sign as an image (the legend of the map). */
export function mapSignURL(key, d) {
  if (typeof OffscreenCanvas === "undefined" && typeof document === "undefined") return glyphURL(key, d);
  const c = typeof document !== "undefined" ? Object.assign(document.createElement("canvas"), { width: 48, height: 48 }) : new OffscreenCanvas(48, 48);
  const g = c.getContext("2d"); g.scale(2, 2); drawMapSign(g, key, 12, 12, 17, d);
  return c.toDataURL ? c.toDataURL() : glyphURL(key, d);
}
