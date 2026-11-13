// Hand-drawn vignettes for points to discover (64x64, base of the drawing at y~58).
// {ink} = line colour; other {placeholders} = fills from a palette. Engraving
// style: outline + hatching; discovered versions get watercolour fills.
import { tiersOf } from "../core/badges.js";
export const VIGNETTES = {
peak: `
<path d="M4 58 L22 24 L28 31 L38 12 L60 58 Z" fill="{rock}"/>
<path d="M38 12 L33.5 22 L36.5 21 L38.5 25.5 L41 20.5 L44 23.5 Z" fill="{snow}"/>
<path d="M22 24 L19.5 29 L22 28 L24 30.5 L26 28.6 Z" fill="{snow}"/>
<path d="M4 58 L22 24 L28 31 L38 12 L60 58" fill="none"/>
<path d="M33.5 22 L36.5 21 L38.5 25.5 L41 20.5 L44 23.5 M19.5 29 L22 28 L24 30.5 L26 28.6" fill="none" stroke-width=".8"/>
<path d="M41 22 L37 33 M44 27 L39 41 M48 34 L42 49 M52 42 L47 56 M56 50 L53 57 M26 29 L23.5 37 M28.5 33 L26 43 M31 36 L29 47" fill="none" stroke-width=".8"/>
<path d="M2 58.5 Q32 55.5 62 58.5" fill="none"/>`,
hut: `
<path d="M13 32 L13 56 L51 56 L51 32" fill="{wall}"/>
<path d="M42 25 L42 13 L47.5 13 L47.5 29" fill="{wall}"/>
<path d="M7 35 L32 13 L57 35 Z" fill="{roof}"/>
<path d="M28 56 L28 45 Q32 40.5 36 45 L36 56" fill="{door}"/>
<rect x="17" y="39" width="7" height="7" fill="{win}"/><rect x="40" y="39" width="7" height="7" fill="{win}"/>
<path d="M20.5 39 L20.5 46 M17 42.5 L24 42.5 M43.5 39 L43.5 46 M40 42.5 L47 42.5" fill="none" stroke-width=".7"/>
<circle cx="32" cy="27" r="2.6" fill="{win}"/>
<path d="M17 31 L32 18 M22 33 L34 22.5 M27 34 L36 26.5 M44 33 L52 33.5" fill="none" stroke-width=".7"/>
<path d="M45 10 Q41.5 6.5 45.5 4.5 Q49.5 2.5 46.5 -0.5" fill="none" stroke-width=".9"/>
<path d="M3 57.5 Q32 55 61 57.5" fill="none"/>`,
tower: `
<path d="M19 58 L27.5 15 L36.5 15 L45 58 Z" fill="{wall}"/>
<path d="M19 58 L27.5 15 M45 58 L36.5 15" fill="none" stroke-width="1.5"/>
<path d="M21.2 47 L41.5 40 M42.8 47 L23 40 M23 40 L39.4 31 M41 40 L24.8 31 M24.8 31 L37.7 23 M39.4 31 L26.3 23 M26.3 23 L36.6 17 M37.7 23 L27.3 17" fill="none" stroke-width=".8"/>
<path d="M22 50 L42 50 M23.6 40 L40.4 40 M25.3 31 L38.7 31 M26.8 23 L37.2 23" fill="none" stroke-width=".9"/>
<rect x="21" y="9" width="22" height="6" fill="{roof}"/>
<path d="M21 9 L21 4 M43 9 L43 4 M21 4 L43 4 M26.5 9 L26.5 4 M32 9 L32 4 M37.5 9 L37.5 4" fill="none" stroke-width=".8"/>
<path d="M6 58.5 Q32 56 58 58.5" fill="none"/>`,
ruins: `
<path d="M7 58 L7 22 L11 22 L11 18 L15 18 L15 22 L19 22 L19 18 L24 18 L24 31 L29 31 L31 37 L35 34 L39 39 L43 36 L43 26 L47 26 L47 22 L51 22 L51 26 L56 26 L56 58 Z" fill="{stone}"/>
<path d="M12.5 41 L12.5 33.5 Q15.5 29 18.5 33.5 L18.5 41 Z" fill="{dark}"/>
<path d="M45.5 58 L45.5 48 Q49.5 42.5 53.5 48 L53.5 58" fill="{dark}"/>
<path d="M9 48 L15 48 M17 52 L23 52 M10 27 L17 27 M27 45 L34 45 M32 51 L39 51 M26 55 L31 55 M46 31 L53 31 M48 37 L54 37 M8 54 L13 54" fill="none" stroke-width=".7"/>
<path d="M30 40 Q33 38 36 40 M34 43 Q37 41 40 43" fill="none" stroke-width=".7"/>
<circle cx="27" cy="57" r="1.4" fill="{stone}"/><circle cx="31" cy="57.3" r="1" fill="{stone}"/><circle cx="60" cy="57" r="1.3" fill="{stone}"/>
<path d="M2 58.5 Q32 56.5 62 58.5" fill="none"/>`,
waterfall: `
<path d="M3 58 L6 31 L13 23 L24 20 L25 58 Z" fill="{rock}"/>
<path d="M39 58 L40 20 L50 22 L58 31 L61 58 Z" fill="{rock}"/>
<path d="M24 20 L40 20 L40 55 L24 55 Z" fill="{water}"/>
<path d="M14 13 Q25 15 31 20 M50 13 Q40 15 34 20" fill="none" stroke-width=".9"/>
<path d="M27 22 L27 51 M30.5 21 L30.5 53 M34 21 L34.5 52 M37.5 22 L38 50" fill="none" stroke-width=".7"/>
<path d="M15 56 Q32 63 49 56 Z" fill="{water}"/>
<path d="M21 54 Q23.5 49.5 26 54 M38 54 Q40.5 49.5 43 54 M29 57.5 Q32 55.5 35 57.5" fill="none" stroke-width=".8"/>
<path d="M8 41 L12 34 M9 50 L15 42 M53 39 L57 46 M47 49 L53 56 M14 28 L18 25" fill="none" stroke-width=".8"/>`,
viewpoint: `
<path d="M3 58 L9 43 L19 37 L33 38 L40 46 L44 58 Z" fill="{rock}"/>
<path d="M13 47 L9 55 M19 42 L15 52 M33 43 L37 53 M26 41 L24 47" fill="none" stroke-width=".8"/>
<circle cx="26" cy="25.5" r="2.4" fill="{figure}"/>
<path d="M26 28 L26 34 M26 34 L23.8 37.5 M26 34 L28.2 37.5 M26 29.5 L31.5 26.8" fill="none" stroke-width="1.2"/>
<path d="M35 23 L57 12 M36 27 L60 23 M36 31.5 L58 34" fill="none" stroke-width=".9" stroke-dasharray="2.5 2"/>
<path d="M1 58.5 Q30 56.5 50 58.5" fill="none"/>`,
trail: `
<path d="M2 58 L2 43 Q12 37.5 22 40 Q30 42 38 38.5 Q50 33.5 62 38 L62 58 Z" fill="{meadow}"/>
<path d="M17 58 Q31 52 27.5 47.5 Q24 43.5 33.5 40.5 L36.5 40.5 Q29.5 43.5 33 47.5 Q37 52.5 45 58 Z" fill="{path}"/>
<path d="M17 58 Q31 52 27.5 47.5 Q24 43.5 33.5 40.5 M45 58 Q37 52.5 33 47.5 Q29.5 43.5 36.5 40.5" fill="none" stroke-width="1"/>
<path d="M31 57 Q34 52 30.5 47.5 Q27.5 44 35 40.5" fill="none" stroke="{sw}" stroke-width="1.7" stroke-dasharray="3.2 2.4"/>
<path d="M12 40.5 L12 31" fill="none" stroke-width="1.4"/>
<path d="M12 33 Q4.5 31 7 24.5 Q6.5 17.5 12.5 16.5 Q18.5 17 18 24 Q20.5 31 12 33 Z" fill="{tree}"/>
<path d="M9.5 21.5 L12 24 M14.5 20 L12.5 23 M9 27 L12 29 M15.5 26 L12.5 28.5" fill="none" stroke-width=".7"/>
<rect x="48.6" y="17" width="4.8" height="40" rx=".8" fill="{wood}"/>
<path d="M49.8 30 L49.8 54 M52.2 22 L52.2 44" fill="none" stroke-width=".6"/>
<rect x="45.5" y="19" width="11" height="10.5" rx=".6" fill="{white}"/>
<rect x="45.5" y="22.5" width="11" height="3.5" fill="{sw}" stroke="none"/>
<rect x="45.5" y="19" width="11" height="10.5" rx=".6" fill="none"/>
<path d="M41 44 Q43 43.4 45 44 M55 50 Q57.5 49.3 60 50 M6 50 Q8 49.4 10 50" fill="none" stroke-width=".7"/>
<path d="M1 58.5 Q32 56.5 63 58.5" fill="none"/>`,
};
export const VIGNETTE_COLORS = {
  trail: {meadow: "#cdd6a4", path: "#e6d3a6", sw: "#c9302c", tree: "#7f9670", wood: "#9a6a3c", white: "#fbf8f0"},
  peak: {rock: "#b4ada0", snow: "#fbf8f0"},
  hut: {roof: "#b8513a", wall: "#ead6ad", door: "#7a4e2d", win: "#a9cbe0"},
  tower: {roof: "#7f9670", wall: "rgba(196,178,138,.55)"},
  ruins: {stone: "#cdbb95", dark: "#5c4a36"},
  waterfall: {rock: "#a39b8e", water: "#86bde3"},
  viewpoint: {rock: "#bdb093", figure: "#3a2a1c"},
};

// Badge peaks: the peak drawing + a golden crown (Korona Gór Polski), a yellow
// sash (Korona Sudetów - the yellow booklet) and a red one (Sudecki Włóczykij -
// the red booklet), in any combination: keys "peak-k", "peak-ys", "peak-kyr"...
const CROWN = `
<path d="M29 9.5 L28 1 L33.5 5.5 L38 -1 L42.5 5.5 L48 1 L47 9.5 Z" fill="{gold}"/>
<path d="M29 9.5 L47 9.5" fill="none" stroke-width="1.6"/>
<circle cx="38" cy="5.5" r="1.3" fill="{gem}" stroke-width=".7"/>`;
const SASH_Y = `
<path d="M50.5 34.5 L57.5 47.5 L54.3 45.6 L53 50.3 L47.6 37.4 Z" fill="{ks}" stroke-width=".9"/>
<path d="M12.5 37 Q31 45.5 52.5 32.5 L54.5 37.8 Q31 51.5 10.5 42.2 Z" fill="{ks}"/>
<path d="M13 39.6 Q31 48 53.4 35.2" fill="none" stroke-width=".55" stroke-dasharray="1.6 1.4"/>`;
const SASH_R = `
<path d="M12.6 48.5 L6.2 60 L9.4 58.3 L11.2 61.6 L16 50.8 Z" fill="{sw}" stroke-width=".9"/>
<path d="M9.5 47 Q31 55 55.5 42.6 L57.6 47.8 Q31 61 7.4 52.2 Z" fill="{sw}"/>
<path d="M8.5 49.6 Q31 57.8 56.5 45.2" fill="none" stroke-width=".55" stroke-dasharray="1.6 1.4"/>`;
const BADGE_COLORS = { gold: "#e8b72a", gem: "#c0262d", ks: "#f2c12e", sw: "#c9302c" };
for (const k of [1, 2, 3, 4, 5, 6, 7]) {
  const kgp = k & 1, ks = k & 2, sw = k & 4;
  const key = "peak-" + (kgp ? "k" : "") + (ks ? "y" : "") + (sw ? "r" : "");
  VIGNETTES[key] = VIGNETTES.peak + (ks ? SASH_Y : "") + (sw ? SASH_R : "") + (kgp ? CROWN : "");
  VIGNETTE_COLORS[key] = { ...VIGNETTE_COLORS.peak, ...BADGE_COLORS };
}

// The badges' own icons (the lists in Progress, the booklets' covers): each its mountains, its colour and
// one accent. Keys "bdg-<badge id>".
const ROCK = `<path d="M2 58.5 Q32 55.5 62 58.5" fill="none"/>`;
const PEAK_BODY = VIGNETTES.peak;
/** A ribbon round the mountain in a flag's colours (stripes top to bottom), dy lower than the sash. */
function flagSash(cols, dy = 0) {
  const w = 6.6 / cols.length, top = (k) => `M11.5 ${37 + dy + k} Q31 ${45.5 + dy + k} 53.5 ${32.5 + dy + k}`;
  return cols.map((c, i) => `<path d="${top(w * i + w / 2)}" fill="none" stroke="${c}" stroke-width="${(w + 0.25).toFixed(2)}" stroke-linecap="butt"/>`).join("") +
    `<path d="${top(0)}" fill="none" stroke-width=".9"/><path d="${top(6.6)}" fill="none" stroke-width=".9"/>` +
    `<path d="M11.5 ${37 + dy} L11.5 ${43.6 + dy} M53.5 ${32.5 + dy} L53.5 ${39.1 + dy}" fill="none" stroke-width=".9"/>`;
}
const BADGE_ICONS = {
  // Korona Gór Polski: the crown worn askew on the summit (its tip inside), a white-and-red ribbon
  kgp: [PEAK_BODY + flagSash(["{fw}", "{fr}"]) + `
<g transform="rotate(-12 38 24)"><path d="M29.5 27.5 L28 18.5 L33 22 L38 16.5 L43 22 L48 18.5 L46.5 27.5 Z" fill="#f6f1e6" fill-opacity="1" stroke="none"/>
<path d="M29.5 27.5 L28 18.5 L33 22 L38 16.5 L43 22 L48 18.5 L46.5 27.5 Z" fill="{gold}"/>
<circle cx="28" cy="18.5" r=".95" fill="{gold}" stroke-width=".6"/><circle cx="38" cy="16.5" r=".95" fill="{gold}" stroke-width=".6"/><circle cx="48" cy="18.5" r=".95" fill="{gold}" stroke-width=".6"/></g>
<clipPath id="kgptip"><path d="M30 0 L48 0 L48 22.6 L30 26.4 Z"/></clipPath><g clip-path="url(#kgptip)">${PEAK_BODY}</g>
<g transform="rotate(-12 38 24)"><path d="M29.5 27.5 L46.5 27.5 L46.6 24.3 L29.4 24.3 Z" fill="{gold}"/><circle cx="33.5" cy="25.9" r="1" fill="{gem}" stroke-width=".55"/><circle cx="38" cy="25.9" r="1.1" fill="{gem2}" stroke-width=".55"/><circle cx="42.5" cy="25.9" r="1" fill="{gem}" stroke-width=".55"/></g>`,
  { rock: "#b4ada0", snow: "#fbf8f0", gold: "#e8b72a", gem: "#c0262d", gem2: "#2f6fb4", fw: "#fbf8f0", fr: "#d4213d" }],
  // Korona Sudetów: the yellow sash of its booklet
  ks: [PEAK_BODY + SASH_Y, { rock: "#b4ada0", snow: "#fbf8f0", ks: "#f2c12e" }],
  // Sudecki Włóczykij: the red sash, a wanderer's stick with a bundle on the slope
  sw: [PEAK_BODY + SASH_R + `
<path d="M50 57 L58.5 30" fill="none" stroke-width="1.7"/><path d="M57.5 33 Q63 31 62 36.5 Q60 40 56.4 37 Z" fill="{bag}" stroke-width=".9"/>`,
  { rock: "#b4ada0", snow: "#fbf8f0", sw: "#c9302c", bag: "#c9a46a" }],
  // Korona Beskidów Polskich: rounded wooded Beskids, a small green crown, spruces
  kbp: [`
<path d="M2 58 Q12 40 22 42 Q30 22 40 22 Q52 24 62 58 Z" fill="{hill}"/>
<path d="M2 58 Q12 40 22 42 Q30 22 40 22 Q52 24 62 58" fill="none"/>
<path d="M10 52 L12.5 45 L15 52 Z M15 54 L17.8 46 L20.6 54 Z M46 50 L48.6 43 L51.2 50 Z M51 54 L53.6 47 L56.2 54 Z" fill="{spruce}" stroke-width=".8"/>
<path d="M27 36 Q34 33 44 35 M24 45 Q34 41 50 44 M28 52 Q38 49 56 52" fill="none" stroke-width=".7"/>
<path d="M32 21 L31.2 14 L35.5 17.5 L39.5 12 L43.5 17.5 L47.8 14 L47 21 Z" fill="{crown}"/><path d="M32 21 L47 21" fill="none" stroke-width="1.3"/>` + ROCK,
  { hill: "#a7c18a", spruce: "#3f6b3a", crown: "#5f9a3c" }],
  // Turystyczna Korona Tatr: sharp granite and a highlander's hat on the highest top, shells round its band
  tkt: [`
<path d="M2 58 L14 34 L19 40 L27 22 L33 30 L38 14 L45 28 L50 24 L62 58 Z" fill="{granite}"/>
<path d="M2 58 L14 34 L19 40 L27 22 L33 30 L38 14 L45 28 L50 24 L62 58" fill="none"/>
<path d="M27 22 L24.5 28 L27 27 L29 30 Z M50 24 L48 29.5 L50.5 28.6 L52.5 31 Z" fill="{snow}" stroke-width=".8"/>
<path d="M40 22 L36 36 M43 30 L38.5 44 M47 38 L43 51 M30 31 L27 42 M20 41 L17.5 50" fill="none" stroke-width=".8"/>
<g transform="rotate(-8 38 19)"><path d="M33 20.5 Q32.6 11.5 38 10.8 Q43.4 11.5 43 20.5 Z" fill="#f6f1e6" fill-opacity="1" stroke="none"/><ellipse cx="38" cy="21" rx="10.5" ry="2.4" fill="#f6f1e6" fill-opacity="1" stroke="none"/><path d="M33 20.5 Q32.6 11.5 38 10.8 Q43.4 11.5 43 20.5 Z" fill="{hat}"/><ellipse cx="38" cy="21" rx="10.5" ry="2.4" fill="{hat}"/>
<path d="M33 20.5 Q38 19.8 43 20.5" fill="none" stroke="{shell}" stroke-width="1.9" stroke-dasharray="1.2 1"/>
<path d="M42.6 17 Q48.5 11 47.6 7.5" fill="none" stroke-width="1"/><path d="M46.3 8.5 Q48.3 11 47 13.5" fill="none" stroke-width=".7"/></g>` + ROCK,
  { granite: "#9aa3ad", snow: "#fbf8f0", hat: "#2b2a2e", shell: "#f4efe0" }],
  // Korona Gór Słowacji: Kriváň's hooked top (the Slovaks' mountain), a plum ribbon
  kgs: [`
<path d="M2 58 L18 36 L26 30 L33 18 Q35.5 10 40 9.5 Q39 13 41.5 20 L50 34 L62 58 Z" fill="{rock}"/>
<path d="M2 58 L18 36 L26 30 L33 18 Q35.5 10 40 9.5 Q39 13 41.5 20 L50 34 L62 58" fill="none"/>
<path d="M33 18 Q35.5 10 40 9.5 Q39 13 41.5 20 L38 18 L36 21 Z" fill="{snow}" stroke-width=".8"/>
<path d="M42 24 L38 36 M46 32 L41 46 M50 40 L46 53 M28 32 L25 42 M22 38 L19.5 48" fill="none" stroke-width=".8"/>
` + flagSash(["{fw}", "{fb}", "{fr}"], 7) + `` + ROCK,
  { rock: "#b0a99c", snow: "#fbf8f0", fw: "#fbf8f0", fb: "#1f4e9c", fr: "#d4213d" }],
  // Korona Beskidu Śląskiego: Barania Góra, where the Vistula starts: a blue stream down its slope
  kbs: [`
<path d="M2 58 Q14 40 24 36 Q32 24 40 24 Q50 26 62 58 Z" fill="{hill}"/>
<path d="M2 58 Q14 40 24 36 Q32 24 40 24 Q50 26 62 58" fill="none"/>
<path d="M38 27 Q35 33 39 37 Q44 41 38 46 Q32 51 37 57" fill="none" stroke="{water}" stroke-width="2.6"/>
<path d="M38 27 Q35 33 39 37 Q44 41 38 46 Q32 51 37 57" fill="none" stroke-width=".6"/>
<path d="M12 50 L14.5 43 L17 50 Z M50 50 L52.6 43 L55.2 50 Z M18 54 L20.8 47 L23.6 54 Z" fill="{spruce}" stroke-width=".8"/>
<circle cx="38" cy="25.6" r="2.2" fill="{water}" stroke-width=".8"/>` + ROCK,
  { hill: "#c9b98a", spruce: "#4d6f3e", water: "#3f8fd0" }],
  // Korona Beskidu Wyspowego: hills standing alone, islands in a sea of mist
  kbw: [`
<path d="M6 46 Q12 30 19 30 Q25 31 30 46 Z" fill="{hill}"/><path d="M24 46 Q32 18 40 18 Q48 19 54 46 Z" fill="{hill2}"/>
<path d="M44 48 Q49 37 54 37 Q59 38 62 48 Z" fill="{hill}"/>
<path d="M6 46 Q12 30 19 30 Q25 31 30 46 M24 46 Q32 18 40 18 Q48 19 54 46 M44 48 Q49 37 54 37 Q59 38 62 48" fill="none"/>
<path d="M2 47 Q16 43 30 47 T62 47 L62 53 Q46 49 32 53 T2 53 Z" fill="{mist}" stroke-width=".8"/>
<path d="M4 56 Q18 52 32 56 T62 56" fill="none" stroke="{mist2}" stroke-width="2.2"/>
<path d="M34 26 Q38 24 44 26 M30 36 Q38 33 48 36" fill="none" stroke-width=".7"/>`,
  { hill: "#9fb88f", hill2: "#86a776", mist: "#e6f1f2", mist2: "#9fd0cf" }],
};
for (const [id, [svg, cols]] of Object.entries(BADGE_ICONS)) { VIGNETTES[`bdg-${id}`] = svg; VIGNETTE_COLORS[`bdg-${id}`] = cols; }

/** The booklets in order of weight: a summit on several of them shows the first one's icon. */
const ICON_ORDER = ["kgp", "tkt", "kgs", "kbp", "ks", "kbs", "kbw", "sw"];
/** Icon for a point in the lists (books, journal, goals, postcards): a list summit its booklet's own icon
 * (in a booklet: that booklet's; elsewhere the weightiest of its booklets), anything else as vignetteKey. */
export const peakIcon = (p, book = null) => {
  if (p?.c !== "peak") return vignetteKey(p);
  const id = book || ICON_ORDER.find((b) => p[b]);
  return id && VIGNETTES[`bdg-${id}`] ? `bdg-${id}` : vignetteKey(p);
};

/** Vignette for a point: its category, or the badge-peak variant. */
export const vignetteKey = (p) => {
  if (p.c !== "peak") return p.c;
  const t = tiersOf(p);
  return t.k || t.y || t.r ? "peak-" + (t.k ? "k" : "") + (t.y ? "y" : "") + (t.r ? "r" : "") : p.c;
};

// the badge colours stay on the parchment (paler)
const KEEP = { gold: "rgba(214,160,40,.75)", gem: "rgba(170,50,40,.6)", ks: "rgba(226,182,40,.72)", sw: "rgba(190,48,42,.62)",
  fw: "rgba(251,248,240,.9)", fr: "rgba(212,33,61,.55)", fb: "rgba(31,78,156,.5)", crown: "rgba(95,154,60,.6)", hat: "rgba(43,42,46,.7)", shell: "rgba(244,239,224,.9)", plum: "rgba(138,74,126,.6)", water: "rgba(63,143,208,.6)", mist2: "rgba(120,190,190,.55)" };

export function vignetteSVG(cat, discovered) {
  const fills = VIGNETTE_COLORS[cat] || {};
  const ink = discovered ? "#3a2a1c" : "#5a3b1e";
  let body = VIGNETTES[cat] || "";
  for (const k of Object.keys(fills)) {
    const dark = k === "dark" || k === "door" || k === "figure";
    const v = discovered ? fills[k] : KEEP[k] || (dark ? "rgba(90,59,30,.45)" : "rgba(150,110,60,.13)");
    body = body.split("{" + k + "}").join(v);
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 -2 64 64" width="128" height="128">` +
    `<g stroke="${ink}" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round" ${discovered ? 'fill-opacity="0.92"' : ""}>${body}</g></svg>`;
}

/** A picture as an image address (the lists, the booklets). */
export const vignetteURL = (c, d) => "data:image/svg+xml;charset=utf-8," + encodeURIComponent(vignetteSVG(c, d));
