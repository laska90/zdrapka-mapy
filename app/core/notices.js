// What a route should know before you go: parks (an entry fee, dogs), stretches of trail closed for a
// season or until further notice, and GOT points (PTTK's mountain badge). The places and dates are a
// small hand-kept list (PROTOTYPE: a few in the Sudetes, after the parks' own notices), checked
// against the route's line and its trail colours.

/** National parks: a rough outline (lon, lat), what to know at the gate. */
export const PARKS = [
  {
    id: "krnap", name: "Karkonoski Park Narodowy", fee: true, dogs: "psy tylko na wybranych szlakach",
    poly: [[15.47, 50.80], [15.58, 50.80], [15.66, 50.79], [15.74, 50.775], [15.80, 50.75], [15.80, 50.725], [15.72, 50.73], [15.62, 50.755], [15.52, 50.765], [15.47, 50.775]],
  },
  {
    id: "pngs", name: "Park Narodowy Gór Stołowych", fee: "Szczeliniec Wielki i Błędne Skały",
    poly: [[16.24, 50.50], [16.36, 50.51], [16.47, 50.47], [16.45, 50.42], [16.33, 50.40], [16.24, 50.44]],
  },
];

/** Stretches closed: on trails of this colour along this path (lon, lat through the trail, 250 m either
 * side); from/to as "MM-DD" every year (to before from: over the new year), none: until further notice.
 * (Built in, for when the maps site cannot be reached: the site's notices.json is newer.) */
export const CLOSURES = [
  { name: "Mokre Rozdroże – Śnieżne Kotły – Rozdroże pod Wielkim Szyszakiem", cols: "green", path: [[15.534, 50.7925], [15.548, 50.784], [15.558, 50.779], [15.570, 50.7785]], from: "03-15", to: "05-31", why: "ochrona przyrody" },
  { name: "Przełęcz Okraj – Czoło – Skalny Stół", cols: "blue", path: [[15.8245, 50.7471], [15.8129, 50.7552], [15.800, 50.7545], [15.7921, 50.7529]], from: "03-15", to: "05-31", why: "ochrona przyrody" },
  { name: "Polana – Kocioł Wielkiego Stawu", cols: "green", path: [[15.714, 50.770], [15.705, 50.765], [15.696, 50.760], [15.692, 50.756]], from: "03-15", to: "05-31", why: "ochrona przyrody" },
  { name: "Popradské pleso – rozdroże pod Rysami", cols: "blue", path: [[20.0758, 49.1572], [20.0735, 49.1600], [20.0710, 49.1632]], from: "11-01", to: "06-15", why: "zimowe zamknięcie TANAP (nad schroniskami)" },
  { name: "Domek Myśliwski – Kocioł Małego Stawu – Samotnia", cols: "blue", path: [[15.725, 50.766], [15.715, 50.757], [15.7027, 50.749]], from: "03-15", to: "05-31", why: "ochrona przyrody", around: "drogą transportową od Domku Myśliwskiego" },
];

/** Seasons a park keeps by its own rules, over the dates mapped in OSM: the ways inside poly tagged
 * with osm ("MM-DD|MM-DD") are closed from..to instead (TANAP closes above the huts 1.11–15.06; OSM
 * mostly still has the old 31.05). */
export const SEASONS = [
  { name: "TANAP", osm: "11-01|05-31", from: "11-01", to: "06-15", why: "zimowe zamknięcie TANAP (nad schroniskami)",
    poly: [[19.55, 49.20], [19.80, 49.20], [19.93, 49.23], [20.00, 49.20], [20.08, 49.18], [20.15, 49.22], [20.25, 49.26], [20.36, 49.24], [20.36, 49.15], [20.20, 49.10], [20.00, 49.10], [19.80, 49.14], [19.55, 49.15]] },
];

/** Within r metres of a path [[lon, lat]]. */
function nearPath(path, lon, lat, r) {
  const kx = Math.cos((lat * Math.PI) / 180) * 111320, ky = 110540;
  for (let i = 1; i < path.length; i++) {
    const [ax, ay] = path[i - 1], [bx, by] = path[i];
    const px = (lon - ax) * kx, py = (lat - ay) * ky, vx = (bx - ax) * kx, vy = (by - ay) * ky, L = vx * vx + vy * vy;
    const u = L ? Math.max(0, Math.min(1, (px * vx + py * vy) / L)) : 0;
    if (Math.hypot(px - u * vx, py - u * vy) <= r) return true;
  }
  return false;
}
const inPoly = (poly, lon, lat) => {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if ((yi > lat) !== (yj > lat) && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
};
const md = (t) => { const d = new Date(t); return `${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
/** Is the day t inside a yearly period from..to ("MM-DD"), none: always. */
export function closedOn(c, t) {
  if (!c.from) return true;
  const k = md(t);
  return c.from <= c.to ? k >= c.from && k <= c.to : k >= c.from || k <= c.to;
}
const dayPl = (s) => { const [m, d] = s.split("-").map(Number); return `${d}.${String(m).padStart(2, "0")}`; };
/** "15.03–31.05", "do odwołania" */
export const whenPl = (c) => (c.from ? `${dayPl(c.from)}–${dayPl(c.to)}` : "do odwołania");

/**
 * The notices for a route: line = [[lon, lat, d]] along it (d: metres from the start), steps = [{d0, d1,
 * cols}] (the trails it follows), t = the day you go (ms). -> {parks: [park], closed: [{c, d0, d1, now}]}
 * now: closed on that day; the rest are closed in another season (worth a word, not an alarm).
 * osm: the map pack's closures [{from, to, line: [[lon, lat]]}] (from/to none: closed now).
 */
export function noticesFor(line, steps, t, osm = [], list = { parks: PARKS, closures: CLOSURES }) {
  const seasons = list.seasons || SEASONS;
  const parks = list.parks.filter((p) => line.some(([lon, lat]) => inPoly(p.poly, lon, lat)));
  const closed = [];
  for (const c of list.closures) {
    let d0 = Infinity, d1 = -Infinity;
    for (const st of steps) {
      if (!(st.cols || "").split(",").includes(c.cols)) continue;
      for (const [lon, lat, d] of line) {
        if (d < st.d0 || d > st.d1) continue;
        const inside = c.path ? nearPath(c.path, lon, lat, 250) : lon >= c.box[0] && lon <= c.box[2] && lat >= c.box[1] && lat <= c.box[3];
        if (inside) { d0 = Math.min(d0, d); d1 = Math.max(d1, d); }
      }
    }
    if (d1 - d0 >= 100) closed.push({ c, d0, d1, now: closedOn(c, t) });
  }
  // the map pack's closures (OSM tags, network/closures.py): the trail ways the route goes along
  // (one stretch per run of closed ways: joined only across gaps under 150 m, never over an open part)
  const hits = [];
  for (const o of osm) {
    const hit = alongRoute(o.line, line);
    if (!hit) continue;
    const key = o.from ? `${o.from}|${o.to}` : "now", [lon, lat] = o.line[0];
    const s = seasons.find((s) => s.osm === key && inPoly(s.poly, lon, lat));
    const w = s ? { from: s.from, to: s.to, why: s.why } : { from: o.from, to: o.to, why: "wg OpenStreetMap" };
    hits.push({ key: w.from ? `${w.from}|${w.to}` : "now", w, d0: hit[0], d1: hit[1] });
  }
  hits.sort((a, b) => a.key.localeCompare(b.key) || a.d0 - b.d0);
  let run = null;
  for (const h of hits) {
    if (run && run.key === h.key && h.d0 - run.d1 <= 150) { run.d1 = Math.max(run.d1, h.d1); continue; }
    run = { key: h.key, c: { name: "Szlak zamknięty", ...h.w }, d0: h.d0, d1: h.d1, now: closedOn(h.w, t) };
    closed.push(run);
  }
  return { parks, closed };
}

/** A closed way the route goes along (not just across): two of its points within 25 m of the route.
 * -> [d0, d1] along the route, or null. line: the route [[lon, lat, d]]; way: [[lon, lat]]. */
function alongRoute(way, line) {
  const k = Math.cos((50 * Math.PI) / 180) * 111320, ky = 110540, R = 25;
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const [lon, lat] of way) { x0 = Math.min(x0, lon); x1 = Math.max(x1, lon); y0 = Math.min(y0, lat); y1 = Math.max(y1, lat); }
  const pad = 0.001;
  if (!line.some(([lon, lat]) => lon > x0 - pad && lon < x1 + pad && lat > y0 - pad && lat < y1 + pad)) return null;
  let n = 0, d0 = Infinity, d1 = -Infinity;
  for (const [lon, lat] of way) {
    let best = Infinity, bd = 0;
    for (let i = 1; i < line.length; i++) {
      const [ax, ay, ad] = line[i - 1], [bx, by, bdd] = line[i];
      const px = (lon - ax) * k, py = (lat - ay) * ky, vx = (bx - ax) * k, vy = (by - ay) * ky, L = vx * vx + vy * vy;
      const u = L ? Math.max(0, Math.min(1, (px * vx + py * vy) / L)) : 0, dd = Math.hypot(px - u * vx, py - u * vy);
      if (dd < best) { best = dd; bd = ad + u * (bdd - ad); }
    }
    if (best <= R) { n++; d0 = Math.min(d0, bd); d1 = Math.max(d1, bd); }
  }
  return n >= Math.min(2, way.length) && d1 - d0 >= 20 ? [d0, d1] : null;
}

/** GOT points for a stretch the PTTK tables do not list: a point for each km and for each 100 m up. */
export const gotOf = (km, up) => Math.round(km) + Math.round(up / 100);
/** GOT badges by points in a year (the small ones: popular, then bronze; more need the big mountains). */
export const GOT_LEVELS = [[60, "popularna", "popularnej"], [120, "mała brązowa", "małej brązowej"], [360, "mała srebrna", "małej srebrnej"]]; // [points, name, "do …"]
