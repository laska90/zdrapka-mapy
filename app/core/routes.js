// Automatic route names: where an outing started and ended (the best named
// place nearby: a hut, a pass, a station, a car park, a village...) and the one
// to three most important places reached on the way, in the order walked.
//   "Karpacz – Śnieżka – Przełęcz Okraj", "Pętla: Międzygórze – Śnieżnik"
// (Names stay in the nominative: Polish and Czech place names do not decline
// reliably by rule, so no "Pętla z Międzygórza".)
import { tiersOf } from "./badges.js";

/** How good a name is as a start / end, and how far away it may be (m). */
const ANCHOR = {
  hut: [1.6, 400], pass: [1.5, 500], station: [1.3, 700], parking: [1.0, 500],
  locality: [1.2, 800], hamlet: [1.1, 1000], isolated_dwelling: [0.8, 400],
  village: [1.2, 1500], town: [1.5, 2500], city: [1.6, 3000],
};
const GENERIC_PARKING = /^(parking|parkoviště|parkovisko|p\+r|p)\b/i;
const GENERIC_ACTIVITY = /^(wspinaczka|hiking|walking|trail running|running|chodzenie|wędrówka|spacer|bieg|pieszo|turistika|chůze|mountaineering)$|\b(hiking|walking|wędrówka|chodzenie)$/i;
const MAX_LEN = 46;

const clean = (n) => (n ? n.split(" / ")[0].replace(/\s+/g, " ").trim() : "");
const key = (n) => clean(n).toLocaleLowerCase("pl");
/** Short forms that read well in a title. */
export function shortPlace(n) {
  return clean(n)
    .replace(/^Schronisko( PTTK)?\s+/u, "schr. ")
    .replace(/^(Wieża|Wieza) [Ww]idokowa\s+(na\s+)?/u, "wieża ")
    .replace(/^Rozhledna\s+(na\s+)?/u, "rozhl. ")
    .replace(/^Chata\s+/u, "chata ");
}

/** Best start / end name among candidates [{n, k, d}] (k: anchor kind, place type or "hut"). */
export function pickAnchor(cands) {
  let best = null, bc = Infinity;
  for (const c of cands) {
    const [w, r] = ANCHOR[c.k] || [1, 600];
    if (!c.n || c.d > r || (c.k === "parking" && GENERIC_PARKING.test(c.n))) continue;
    const cost = c.d / (w * r);
    if (cost < bc) { bc = cost; best = c; }
  }
  if (best) return shortPlace(best.n);
  // nothing close: the nearest village or town within 5 km
  const far = cands.filter((c) => ["village", "town", "city"].includes(c.k) && c.d <= 5000).sort((a, b) => a.d - b.d)[0];
  return far ? shortPlace(far.n) : null;
}

/** Importance of a place reached on the way. */
export function score(v) {
  let s = { peak: 20 + (v.e || 0) / 25, hut: 45, tower: 30, ruins: 25, waterfall: 22, viewpoint: 8 }[v.c] ?? 0;
  const t = tiersOf(v);
  if (t.k) s += 80;
  if (t.y) s += 60;
  if (t.r) s += 40;
  return s;
}

/**
 * @param o {start, end: names or null, loop: bool, km, visited: [{n, c, e, t, kgp, ks, sw, ...the badge fields}], fallback: Garmin's name}
 */
export function routeName({ start, end, loop, km = 0, visited = [], fallback = "" }) {
  const ends = new Set([start, end].filter(Boolean).map(key));
  const seen = new Set();
  const cand = visited
    .filter((v) => v.n && !(v.c === "viewpoint" && /^punkt widokowy$/i.test(clean(v.n))))
    .map((v) => ({ ...v, name: shortPlace(v.n), s: score(v) }))
    .filter((v) => v.s > 0 && !ends.has(key(v.name)) && !seen.has(key(v.name)) && seen.add(key(v.name)))
    .sort((a, b) => b.s - a.s);
  let mid = cand.slice(0, km < 5 ? 1 : km > 18 ? 3 : 2);
  const isLoop = loop || (start && end && key(start) === key(end));
  const make = () => {
    const m = [...mid].sort((a, b) => a.t - b.t).map((v) => v.name);
    if (isLoop) return start ? `Pętla: ${[start, ...m].join(" – ")}` : m.length ? `Pętla: ${m.join(" – ")}` : "";
    return [start, ...m, end].filter(Boolean).join(" – ");
  };
  let t = make();
  while (t.length > MAX_LEN && mid.length) { mid = mid.slice(0, -1); t = make(); }
  if ((!start && !end && !mid.length) || !t) return fallback && !GENERIC_ACTIVITY.test(fallback.trim()) ? fallback : t || fallback || "Wyjście";
  return t;
}
