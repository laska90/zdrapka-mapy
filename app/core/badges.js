// Peak badges ("odznaki"): Korona Gór Polski (its Sudetes part), Korona
// Sudetów and Sudecki Włóczykij. A badge peak counts as reached when a track
// passes within the summit radius of its coordinates (also outside the map
// pack); on the map, OSM peaks are matched to the lists by name nearby, and
// list peaks without an OSM peak in the pack get a marker of their own.

import { KS, SW } from "./badge-lists.js";
import { KBP, KBS, KBW, KGP_KARPATY, KGS, TKT } from "./badge-lists-karpaty.js";

// Korona Gór Polski: the Sudetes peaks (highest point of each Polish range,
// incl. Ślęża on the Sudetes foreland). Wałbrzyskie: the list has Chełmiec
// (Borowa is 2 m higher). Coordinates: the OSM summit.

export const KGP = [
  { n: "Śnieżka", range: "Karkonosze", ele: 1603, lat: 50.7360, lon: 15.7396 },
  { n: "Śnieżnik", range: "Masyw Śnieżnika", ele: 1425, lat: 50.2074, lon: 16.8474 },
  // the summit lies in a reserve with no path: the list's sign is on the red trail (GSS) to the NE
  { n: "Wysoka Kopa", range: "Góry Izerskie", ele: 1126, lat: 50.8500, lon: 15.4203, access: { lat: 50.8525, lon: 15.42442, note: "tabliczce przy czerwonym szlaku" } },
  { n: "Rudawiec", range: "Góry Bialskie", ele: 1106, lat: 50.2448, lon: 16.9769 },
  { n: "Orlica", range: "Góry Orlickie", ele: 1084, lat: 50.3532, lon: 16.3606 },
  { n: "Wielka Sowa", range: "Góry Sowie", ele: 1015, lat: 50.6803, lon: 16.4856 },
  { n: "Kowadło", range: "Góry Złote", ele: 989, lat: 50.2644, lon: 17.0132 },
  { n: "Jagodna", range: "Góry Bystrzyckie", ele: 977, lat: 50.2525, lon: 16.5644 },
  { n: "Skalnik", range: "Rudawy Janowickie", ele: 945, lat: 50.8085, lon: 15.9001 },
  { n: "Waligóra", range: "Góry Kamienne", ele: 936, lat: 50.6808, lon: 16.2781 },
  { n: "Szczeliniec Wielki", range: "Góry Stołowe", ele: 919, lat: 50.4848, lon: 16.3410 },
  { n: "Biskupia Kopa", alt: ["Biskupská kupa"], range: "Góry Opawskie", ele: 889, lat: 50.2567, lon: 17.4286 },
  { n: "Chełmiec", range: "Góry Wałbrzyskie", ele: 851, lat: 50.7795, lon: 16.2110 },
  { n: "Kłodzka Góra", range: "Góry Bardzkie", ele: 765, lat: 50.4517, lon: 16.7532 },
  { n: "Skopiec", range: "Góry Kaczawskie", ele: 724, lat: 50.9439, lon: 15.8847 },
  { n: "Ślęża", range: "Masyw Ślęży", ele: 718, lat: 50.8641, lon: 16.7075 },
  ...KGP_KARPATY,
];

export { KS, SW };

// tier: how a list's peaks look on the map (k: the crown, y: a yellow sash for the crowns of
// mountains, r: a red sash for the wanderers' lists); grades: peaks needed for each grade
export const BADGES = [
  { id: "kgp", name: "Korona Gór Polski", list: KGP, tier: "k" },
  { id: "ks", name: "Korona Sudetów", list: KS, tier: "y" },
  { id: "sw", name: "Sudecki Włóczykij", list: SW, tier: "r" },
  { id: "kbp", name: "Korona Beskidów Polskich", list: KBP, tier: "y" },
  { id: "tkt", name: "Turystyczna Korona Tatr", list: TKT, tier: "y", grades: [20, 40, 60] },
  { id: "kgs", name: "Korona Gór Słowacji", list: KGS, tier: "y" },
  { id: "kbs", name: "Korona Beskidu Śląskiego", list: KBS, tier: "r", grades: [1, 10, 20, 30] },
  { id: "kbw", name: "Korona Beskidu Wyspowego", list: KBW, tier: "r" },
];
export const BADGE_IDS = BADGES.map((b) => b.id);
const TIER = Object.fromEntries(BADGES.map((b) => [b.id, b.tier]));
/** A point's badge fields ({kgp, ks, sw, kbp, ...}: names or null) from any object holding them. */
export const badgeFields = (o) => Object.fromEntries(BADGE_IDS.map((id) => [id, o?.[id] || null]));
/** Which tiers a point is on: {k, y, r} (the crown, a yellow sash, a red sash). */
export function tiersOf(p) {
  const t = { k: false, y: false, r: false };
  for (const id of BADGE_IDS) if (p?.[id]) t[TIER[id]] = true;
  return t;
}
export const onList = (p) => BADGE_IDS.some((id) => p?.[id]);
/** The badges a point is on: [{id, name, n}]. */
export const listsOf = (p) => BADGES.filter((B) => p?.[B.id]).map((B) => ({ id: B.id, name: B.name, n: p[B.id] }));
export const BADGE_NAME = Object.fromEntries(BADGES.map((b) => [b.id, b.name]));

const norm = (s) => (s || "").toLocaleLowerCase("pl").normalize("NFC").trim();
const MATCH_M = 2500, SAME_M = 200, NEAR_M = 400, ELE_M = 25;

/** All list peaks with coordinates, projected: {id: "ks:Śnieżka", b: "ks", n, alt, ele, range, x, y}. */
export function badgePoints(project) {
  const out = [];
  for (const B of BADGES) for (const k of B.list) {
    if (k.lat == null) continue;
    const [x, y] = project(k.lon, k.lat), [ax, ay] = k.access ? project(k.access.lon, k.access.lat) : [null, null];
    out.push({ ...k, id: `${B.id}:${k.n}`, b: B.id, x, y, ...(ax != null ? { ax, ay, ar: 60 } : {}), names: [k.n, ...(k.alt || [])].map(norm) });
  }
  // a summit's own access point holds on every list it is on (Wysoka Kopa: KGP and Korona Sudetów)
  for (const k of out) if (k.ax == null) {
    const o = out.find((q) => q.ax != null && Math.hypot(q.x - k.x, q.y - k.y) < MATCH_M && q.names.some((n) => k.names.includes(n)));
    if (o) Object.assign(k, { ax: o.ax, ay: o.ay, ar: o.ar, access: o.access });
  }
  return out;
}

/** The list peaks an OSM point is: one of its name parts ("Śnieżka / Sněžka",
 * "Kowadło/Kovadlina") is a list name, within 2.5 km. -> {kgp, ks, sw, kbp, ...} (names) or null. */
export function badgesOf(p, points) {
  if (p.c !== "peak" || !p.n) return null;
  const parts = p.n.split(/\s*[/|]\s*/).map(norm), pw = parts.map(words);
  let out = null;
  for (const k of points) {
    if (Math.abs(k.x - p.x) > MATCH_M || Math.abs(k.y - p.y) > MATCH_M) continue;
    const d = Math.hypot(k.x - p.x, k.y - p.y);
    if (d > MATCH_M) continue;
    // (a top of the same name but another height is another top: Rysy 2503 / 2499 / 2472 m)
    if (d > 50 && p.e != null && k.ele != null && Math.abs(p.e - k.ele) > ELE_M) continue;
    if (k.names.some((n) => parts.includes(n)) || namedLike(k, pw, d)) (out ||= {})[k.b] ??= k;
  }
  return out && { ...Object.fromEntries(BADGE_IDS.map((id) => [id, out[id]?.n || null])), ids: BADGE_IDS.map((id) => out[id]).filter(Boolean).map((k) => k.id) };
}
/** A name's words, sorted ("Czantoria Mała" = "Mała Czantoria"). */
const words = (s) => norm(s).replace(/[()",.]/g, " ").split(/\s+/).filter(Boolean).sort();
/** Words OSM adds to a list's name of the same summit (not "Północna", "Mała": another top). */
const GENERIC = new Set(["wielki", "wielka", "wielkie", "velký", "velká", "veľký", "veľká", "góra", "szczyt", "vrch", "vrchol", "hora", "kopa"]);
/** The same words in another order (anywhere within 2.5 km), or the list's name with a generic word
 * more (OSM's "Wielki Giewont" for the list's "Giewont") only right there (400 m). */
function namedLike(k, pw, d) {
  k.words ||= k.names.map(words);
  for (const a of k.words) for (const b of pw) {
    if (a.join(" ") === b.join(" ")) return true;
    if (d < NEAR_M && a.length && a.length < b.length && a.every((w) => b.includes(w)) && b.every((w) => a.includes(w) || GENERIC.has(w))) return true;
  }
  return false;
}

/** List peaks grouped by place (one summit on several lists): [{id, n, ele, x, y, kgp, ks, sw, kbp..., ids}]. */
export function badgeSummits(points) {
  const out = [];
  for (const k of points) {
    const d = (q) => Math.hypot(q.x - k.x, q.y - k.y);
    let s = out.find((q) => d(q) < SAME_M || (d(q) < MATCH_M && q.names.some((n) => k.names.includes(n))));
    if (!s) out.push((s = { id: k.id, c: "peak", n: k.n, e: k.ele, x: k.x, y: k.y, ...badgeFields(null), ids: [], names: [] }));
    s.names.push(...k.names);
    s[k.b] = k.n; s.ids.push(k.id);
  }
  return out;
}

/** Back compat for the crown only. */
export const kgpPoints = (project) => badgePoints(project).filter((k) => k.b === "kgp");
export const kgpOf = (p, points) => { const b = badgesOf(p, points); return b?.kgp ? KGP.find((k) => k.n === b.kgp) : null; };
