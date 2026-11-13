// A name for a spot on the map (a finger held there, a point of a plan): the named place when it is
// at one; on a marked trail, the trail with how far from the nearest name; else the nearest name with
// how far and which way. ("od: Łysica", not "od Łysicy": Polish names do not decline reliably.)
import { bearing, distText, windShort } from "../core/hud.js";

const COLOUR = { red: "czerwony", blue: "niebieski", green: "zielony", yellow: "żółty", black: "czarny" };
/** "Szlak czerwony", "Szlaki czerwony i niebieski" from "red,blue". */
export function trailWords(cols) {
  const set = new Set(String(cols || "").split(","));
  const c = Object.keys(COLOUR).filter((k) => set.has(k)).map((k) => COLOUR[k]); // (always in the same order)
  if (!c.length) return "";
  return c.length === 1 ? `Szlak ${c[0]}` : `Szlaki ${c.slice(0, -1).join(", ")} i ${c.at(-1)}`;
}

export function createSpotName(C) {
  /** {title, sub, near} for a pack point: sub is "400 m od: Łysica" (on a trail) or "" (the title says it). */
  async function spotName(x, y) {
    const [sx, sy] = C.view.toScreen(x, y), cols = C.view.trailCols?.(sx, sy) || "";
    // the nearest name: of the places around (towns, peaks, huts, passes) or a named sign drawn near it (a junction's name)
    let near = await C.call("nameAt", { x, y, R: 4000 }).then((r) => r.place).catch(() => null);
    const p = await C.view.pick(sx, sy, 220, true).catch(() => null);
    if (p?.n && p.x != null) { const d = Math.round(Math.hypot(p.x - x, p.y - y)); if (!near || d < near.d || (p.n === near.n && d <= near.d + 30)) near = { n: p.n, d, x: p.x, y: p.y, e: p.e }; }
    if (near && near.d <= 60) return { title: near.n, sub: "", near, e: near.e ?? null };
    const trail = trailWords(cols);
    if (trail) return { title: trail, sub: near ? `${distText(near.d)} od: ${near.n}` : "", near };
    if (near) return { title: `${near.n} · ${distText(near.d)} ${windShort(bearing(near.x, near.y, x, y))}`, sub: "", near };
    return { title: "Punkt na mapie", sub: "" };
  }
  /** One line (the planner's legs): the title, and on a trail where along it. */
  const spotLine = (s) => (s ? (s.sub ? `${s.title} · ${s.sub}` : s.title) : "");
  return { spotName, spotLine };
}
