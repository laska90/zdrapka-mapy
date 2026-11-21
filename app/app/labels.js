// Map labels: cartographic short forms of place names.

const ABBREV = [
  [/^(?:Wieża|Wieza) [Ww]idokowa\b/u, "wieża"],
  [/^Schronisko\b/u, "schr."],
  [/^Chatka\b/u, "chatka"],
  [/^Punkt [Ww]idokowy\b/u, "pkt wid."],
  [/^Pierwsza\b/u, "I"],
  [/^Druga\b/u, "II"],
  [/^Trzecia\b/u, "III"],
  [/^Czwarta\b/u, "IV"],
  [/^Rozhledna\b/u, "rozhl."],
  [/^Vyhlídka\b/u, "vyhl."],
  [/^Zřícenina( hradu)?\b/u, "zříc."],
  [/^Ruiny( zamku)?\b/u, "ruiny"],
];

// a name in two languages ("Vráta Chałubińského / Wrota Chałubińskiego"): the Polish one
const PL = /[ąćęłńśźżó]/g, CSK = /[ěščřžýáíéúůďťňľĺôäŕ]/g, PLW = /\b(wierch|szczyt|przełęcz|góra|wielk[ia]|mał[ya]|turnia)\b/g, CSKW = /\b(vrch|štít|sedlo|veľk[ýá]|malý|hora|chata|vrchol)\b/g;
const plScore = (t) => { const l = t.toLowerCase(); return 2 * (l.match(PL)?.length || 0) - 3 * (l.match(CSK)?.length || 0) + 2 * (l.match(PLW)?.length || 0) - 2 * (l.match(CSKW)?.length || 0); };
export const shortName = (n) => {
  if (!n) return n;
  const parts = n.split(" / ").map((q) => q.trim());
  return parts.length < 2 ? parts[0] : parts.reduce((b, q) => (plScore(q) > plScore(b) ? q : b), parts[0]);
};

export function mapLabel(name) {
  if (!name) return null;
  let t = shortName(name).replace(/([a-ząćęłńóśźżěščřžýáíéůú])([A-ZĄĆĘŁŃÓŚŹŻĚŠČŘŽ])/gu, "$1 $2");
  for (const [re, rep] of ABBREV) t = t.replace(re, rep);
  return t;
}

export const NAMES = { peak: "szczyt", hut: "schronisko", tower: "wieża widokowa", ruins: "ruiny", waterfall: "wodospad", viewpoint: "punkt widokowy", place: "miejscowość", station: "stacja kolejowa", parking: "parking", pass: "przełęcz", shelter: "wiata", spring: "źródło", cave: "jaskinia", rock: "skałka", bus: "przystanek", junction: "rozdroże szlaków", ferrata: "via ferrata" };
export const PLURAL = { peak: "szczyty", hut: "schroniska", tower: "wieże", waterfall: "wodospady", ruins: "ruiny", viewpoint: "widoki" };
// an outing added by hand without a date: its clock starts at 0
export const fmtDate = (ms) => { if (ms == null) return ""; if (ms < 1e11) return "bez daty"; const d = new Date(ms); return `${String(d.getDate()).padStart(2, "0")}.${String(d.getMonth() + 1).padStart(2, "0")}.${d.getFullYear()}`; };

/** Polish plural: plural(4, "wyjście", "wyjścia", "wyjść") -> "4 wyjścia" */
export function plural(n, one, few, many) {
  const m10 = n % 10, m100 = n % 100;
  const w = n === 1 ? one : m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14) ? few : many;
  return `${n} ${w}`;
}
