// The sun over the mountains: where it stands (altitude and azimuth, from the date and the place: the usual
// astronomical almanac formulas, as SunCalc has them; good to a fraction of a degree), when it sets and when it
// gets dark (the planner's and a trip's warnings), and the light that makes:
// the 3D views' palette (app/navterrain.js) from night through the blue hour, sunrise and the golden hour to
// full day — the ground's colours (the map's own, tinted), the relief's shadow and light coming from the sun's
// side, the sky and the haze.

const RAD = Math.PI / 180, DAY = 86400000, J1970 = 2440588, J2000 = 2451545, E = RAD * 23.4397;

/** The sun's place on the sky d days after J2000: its mean anomaly M, ecliptic longitude L, declination and right
 * ascension (radians). */
function sunCoords(d) {
  const M = RAD * (357.5291 + 0.98560028 * d);
  const C = RAD * (1.9148 * Math.sin(M) + 0.02 * Math.sin(2 * M) + 0.0003 * Math.sin(3 * M));
  const L = M + C + RAD * 102.9372 + Math.PI;
  return { M, L, dec: Math.asin(Math.sin(L) * Math.sin(E)), ra: Math.atan2(Math.sin(L) * Math.cos(E), Math.cos(L)) };
}

/** The sun at time ms (UTC ms) seen from lat, lon: {alt, az} in degrees (az clockwise from north). */
export function sunPosition(ms, lat, lon) {
  const d = ms / DAY - 0.5 + J1970 - J2000;
  const { dec, ra } = sunCoords(d);
  const lw = -lon * RAD, phi = lat * RAD, H = RAD * (280.16 + 360.9856235 * d) - lw - ra;
  const alt = Math.asin(Math.sin(phi) * Math.sin(dec) + Math.cos(phi) * Math.cos(dec) * Math.cos(H));
  const az = Math.atan2(Math.sin(H), Math.cos(H) * Math.sin(phi) - Math.tan(dec) * Math.cos(phi)); // (from south, to the west)
  return { alt: alt / RAD, az: (az / RAD + 180 + 360) % 360 };
}

/** Sunset and the end of civil twilight (ms) for the (UTC) day of t at lat/lon; null in polar day/night. */
export function sunTimes(t, lat, lon) {
  const dt = new Date(t), day = Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth(), dt.getUTCDate());
  const J = (day - Date.UTC(2000, 0, 1, 12)) / DAY + 0.5 - lon / 360;
  const { M, L, dec } = sunCoords(J);
  const noon = J2000 + J + 0.0053 * Math.sin(M) - 0.0069 * Math.sin(2 * L);
  const at = (h) => {
    const c = (Math.sin(h * RAD) - Math.sin(lat * RAD) * Math.sin(dec)) / (Math.cos(lat * RAD) * Math.cos(dec));
    if (c < -1 || c > 1) return null;
    return (noon + Math.acos(c) / (2 * Math.PI) - 2440587.5) * DAY; // (Julian day -> ms)
  };
  return { set: at(-0.833), dark: at(-6) };
}

// ---- colours
const hex = (c) => [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16));
const toHex = (v) => `#${v.map((x) => Math.max(0, Math.min(255, Math.round(x))).toString(16).padStart(2, "0")).join("")}`;
const mix = (a, b, t) => toHex(hex(a).map((x, i) => x + (hex(b)[i] - x) * t));
const tint = (c, k) => toHex(hex(c).map((x, i) => x * k[i]));
const lerp = (a, b, t) => a + (b - a) * t;

// the map's own ground (app/glstyle.js), a little deeper (lit from one side, it reads lighter)
const GROUND = { bg: "#e9ecdf", meadow: "#dbe8bd", forest: "#acd08a", scrub: "#cbdfae", bare: "#dcd6cc", scree: "#e4e0d6", water: "#9ec8ec", residential: "#e2d5c2", road: "#ffffff", roadCase: "#a99f90", path: "#7a6a55", contour: "#8a7a62", lift: "#3f4347" };

// keyframes by the sun's altitude: the light's tint on the ground, the relief's shadow and light, the sky
const KEYS = [
  { alt: -12, tint: [0.16, 0.19, 0.27], shadow: "#000000", sa: 0.55, light: "#6f7fa8", la: 0.15, exag: 0.35, sky: "#070b16", horizon: "#141c33", fog: "#0e1424" },
  { alt: -4, tint: [0.36, 0.39, 0.56], shadow: "#0d1022", sa: 0.55, light: "#9aa6d8", la: 0.2, exag: 0.45, sky: "#1c2850", horizon: "#53608e", fog: "#36416a" },
  { alt: 1, tint: [0.84, 0.66, 0.6], shadow: "#2a1f3d", sa: 0.6, light: "#ffc4a0", la: 0.45, exag: 0.85, sky: "#56679b", horizon: "#f2a07a", fog: "#d9a593" },
  { alt: 8, tint: [1.0, 0.87, 0.72], shadow: "#3a2c48", sa: 0.55, light: "#ffd9a0", la: 0.5, exag: 0.8, sky: "#6f8cc0", horizon: "#f7c891", fog: "#eed3b2" },
  { alt: 25, tint: [1, 0.98, 0.95], shadow: "#2f3c4a", sa: 0.5, light: "#fff6e0", la: 0.35, exag: 0.6, sky: "#5f9bd6", horizon: "#cfe1f0", fog: "#dfe8ee" },
  { alt: 90, tint: [1, 1, 1], shadow: "#2f3c4a", sa: 0.42, light: "#ffffff", la: 0.25, exag: 0.5, sky: "#4a8fd4", horizon: "#c6dcef", fog: "#dbe6ef" },
];

/**
 * The 3D view's light for the sun at {alt, az}: {bg, area: {kind: colour}, road, roadCase, path, contour, lift,
 * shadow, light (rgba), exag, dir (where the light comes from, ° from north), sunAlt, sky: {...}, label, halo, dark}.
 */
export function lightFor({ alt, az }) {
  const a = Math.max(-12, Math.min(90, alt));
  let i = 1;
  while (i < KEYS.length - 1 && KEYS[i].alt < a) i++;
  const A = KEYS[i - 1], B = KEYS[i], t = Math.max(0, Math.min(1, (a - A.alt) / (B.alt - A.alt)));
  const k = [0, 1, 2].map((j) => lerp(A.tint[j], B.tint[j], t));
  const g = Object.fromEntries(Object.entries(GROUND).map(([key, c]) => [key, tint(c, k)]));
  const rgba = (c, al) => { const [r, gg, b] = hex(c); return `rgba(${r},${gg},${b},${al.toFixed(3)})`; };
  const lum = 0.3 * k[0] + 0.59 * k[1] + 0.11 * k[2], dark = lum < 0.5;
  return {
    bg: g.bg, area: { meadow: g.meadow, forest: g.forest, scrub: g.scrub, bare: g.bare, scree: g.scree, water: g.water, residential: g.residential },
    road: g.road, roadCase: g.roadCase, path: g.path, contour: g.contour, lift: g.lift,
    shadow: rgba(mix(A.shadow, B.shadow, t), lerp(A.sa, B.sa, t)), light: rgba(mix(A.light, B.light, t), lerp(A.la, B.la, t)), exag: lerp(A.exag, B.exag, t),
    dir: az, sunAlt: alt,
    sky: { "sky-color": mix(A.sky, B.sky, t), "horizon-color": mix(A.horizon, B.horizon, t), "fog-color": mix(A.fog, B.fog, t), "sky-horizon-blend": 0.5, "horizon-fog-blend": 0.6, "fog-ground-blend": 0.55, "atmosphere-blend": dark ? 0 : 0.6 },
    label: dark ? "#f2f0ea" : "#2e2b27", halo: dark ? "rgba(10,14,20,.85)" : "rgba(255,255,255,.9)", dark,
  };
}

/** The navigation radar's own night-dark light (the instrument: the route bright on a quiet ground). */
export const NAV_LIGHT = {
  bg: "#1d2220", area: { meadow: "#1f2622", forest: "#16231a", scrub: "#1c241f", bare: "#262624", scree: "#2a2a28", water: "#1d2a36", residential: "#262421" },
  road: "#5b625e", roadCase: "#1a1d1c", path: "#4c4a44", contour: "#8d958f", lift: "#8a8f8c",
  shadow: "rgba(5,6,6,.62)", light: "rgba(128,139,132,.32)", exag: 0.9, dir: 315, sunAlt: 45,
  sky: { "sky-color": "#26302f", "horizon-color": "#3a4644", "fog-color": "#151917", "sky-horizon-blend": 0.4, "horizon-fog-blend": 0.5, "fog-ground-blend": 0.6, "atmosphere-blend": 0 },
  label: "#e9ece8", halo: "rgba(10,12,11,.85)", dark: true,
};
