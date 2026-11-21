// Small pure helpers for the map's extras: the scale bar, "where is it" arrows with
// distances, the nearest peaks still to climb, progress thresholds (medals).

const nf = (v, d = 1) => v.toLocaleString("pl-PL", { minimumFractionDigits: d, maximumFractionDigits: d });

const SCALE_STEPS = [10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000, 50000, 100000];

/** Scale bar for s px per metre: the longest round length that fits maxPx. -> {m, px, label} */
export function scaleBar(s, maxPx = 110) {
  let m = SCALE_STEPS[0];
  for (const q of SCALE_STEPS) if (q * s <= maxPx) m = q;
  return { m, px: m * s, label: m >= 1000 ? `${m / 1000} km` : `${m} m` };
}

/** 850 m, 3,2 km, 52 km. */
export function distText(m) {
  if (m < 950) return `${Math.max(10, Math.round(m / 10) * 10)} m`;
  return m < 9950 ? `${nf(m / 1000)} km` : `${Math.round(m / 1000)} km`;
}

const WIND = ["północ", "północny wschód", "wschód", "południowy wschód", "południe", "południowy zachód", "zachód", "północny zachód"];
const WIND_SHORT = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];

/** Compass bearing in degrees (0 = north, 90 = east) from a to b; pack coordinates (y grows to the south). */
export function bearing(ax, ay, bx, by) {
  return ((Math.atan2(bx - ax, ay - by) * 180) / Math.PI + 360) % 360;
}
/** "na północny wschód" */
export const windPl = (deg) => `na ${WIND[Math.round(deg / 45) % 8]}`;
export const windShort = (deg) => WIND_SHORT[Math.round(deg / 45) % 8];

/** Where the ray from the middle of the box to the target leaves the box [l, t, r, b]: {x, y, a} (a: angle, radians, 0 = right). */
export function edgeHit(tx, ty, [l, t, r, b]) {
  const cx = (l + r) / 2, cy = (t + b) / 2, dx = tx - cx, dy = ty - cy;
  if (!dx && !dy) return null;
  const k = Math.min(dx > 0 ? (r - cx) / dx : dx < 0 ? (l - cx) / dx : Infinity, dy > 0 ? (b - cy) / dy : dy < 0 ? (t - cy) / dy : Infinity);
  return { x: cx + dx * k, y: cy + dy * k, a: Math.atan2(dy, dx) };
}

/** A point outside the sheet [x0, y0, x1, y1]: how far and in which direction from its nearest edge (null when inside). */
export function outside(x, y, [x0, y0, x1, y1]) {
  const nx = Math.min(Math.max(x, x0), x1), ny = Math.min(Math.max(y, y0), y1);
  const d = Math.hypot(x - nx, y - ny);
  return d < 1 ? null : { d, deg: bearing(nx, ny, x, y), nx, ny };
}

/** The n closest of the points not yet reached, to (x, y): [{...point, d (m), deg}]. */
export function nearest(points, x, y, n = 3) {
  return points.map((p) => ({ ...p, d: Math.hypot(p.x - x, p.y - y), deg: bearing(x, y, p.x, p.y) })).sort((a, b) => a.d - b.d).slice(0, n);
}

export const THRESHOLDS = [25, 50, 75, 100];
export const MEDALS = ["", "brąz", "srebro", "złoto", "komplet"];
/** How many thresholds a percentage has passed (0-4). */
export const levelOf = (pct) => THRESHOLDS.filter((t) => pct >= t - 1e-9).length;

/** The next threshold and what is missing (km) to it: {t, km} or null when complete. */
export function nextThreshold(pct, totalKm, walkedKm) {
  const t = THRESHOLDS.find((q) => pct < q - 1e-9);
  return t ? { t, km: Math.max(0, (totalKm * t) / 100 - walkedKm) } : null;
}
