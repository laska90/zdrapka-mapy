// On the way: the sun (when it sets, when it gets dark), the weather where you will be, and who to
// call for help where you are. No keys, no accounts: the sun is worked out here, the weather comes
// from open-meteo.com (only when asked, or while a route is walked: once an hour).

const RAD = Math.PI / 180;

/** Sunset and the end of civil twilight (ms) for the day of `t` at lat/lon; null in polar day/night. */
export function sunTimes(t, lat, lon) {
  // NOAA's approximation (good to a minute or two here)
  const d = new Date(t), day = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  const n = (day - Date.UTC(2000, 0, 1, 12)) / 864e5 + 0.5;
  const J = n - lon / 360, M = (357.5291 + 0.98560028 * J) % 360;
  const C = 1.9148 * Math.sin(M * RAD) + 0.02 * Math.sin(2 * M * RAD) + 0.0003 * Math.sin(3 * M * RAD);
  const L = (M + C + 180 + 102.9372) % 360;
  const noon = 2451545 + J + 0.0053 * Math.sin(M * RAD) - 0.0069 * Math.sin(2 * L * RAD);
  const dec = Math.asin(Math.sin(L * RAD) * Math.sin(23.4397 * RAD));
  const at = (h) => {
    const c = (Math.sin(h * RAD) - Math.sin(lat * RAD) * Math.sin(dec)) / (Math.cos(lat * RAD) * Math.cos(dec));
    if (c < -1 || c > 1) return null;
    return (noon + Math.acos(c) / (2 * Math.PI) - 2440587.5) * 864e5; // Julian day -> ms
  };
  return { set: at(-0.833), dark: at(-6) };
}

/** A weather code (WMO) as a small picture and words. */
export function wxWord(code) {
  if (code >= 95) return ["⛈", "burza"];
  if (code >= 71 && code <= 86) return ["❄", "śnieg"];
  if (code >= 51 && code <= 67 || code >= 80 && code <= 82) return ["🌧", "deszcz"];
  if (code === 45 || code === 48) return ["🌫", "mgła"];
  if (code >= 2) return ["☁", "chmury"];
  return ["☀", "pogodnie"];
}

/** A small coloured picture of the weather (WMO code; night: a moon for a clear sky), as SVG. */
export function wxIcon(code, day = true, size = 26) {
  const cloud = (fill, x = 0, y = 0) => `<path transform="translate(${x} ${y})" d="M7.5 19h9.2a3.8 3.8 0 0 0 .4-7.6 5.3 5.3 0 0 0-10.2 1.3A3.2 3.2 0 0 0 7.5 19Z" fill="${fill}" stroke="#5f6b78" stroke-width=".9"/>`;
  const sun = (cx, cy, r) => `<g stroke="#f2a20c" stroke-width="1.7" stroke-linecap="round">${[0, 45, 90, 135, 180, 225, 270, 315].map((a) => { const c = Math.cos(a * Math.PI / 180), s = Math.sin(a * Math.PI / 180); return `<path d="M${(cx + c * (r + 1.8)).toFixed(1)} ${(cy + s * (r + 1.8)).toFixed(1)}L${(cx + c * (r + 3.6)).toFixed(1)} ${(cy + s * (r + 3.6)).toFixed(1)}"/>`; }).join("")}</g><circle cx="${cx}" cy="${cy}" r="${r}" fill="#ffc21a" stroke="#f2a20c" stroke-width=".9"/>`;
  const moon = (cx, cy) => `<path d="M${cx + 3.5} ${cy + 3.2}a5.6 5.6 0 1 1-1.6-9.4 4.4 4.4 0 0 0 1.6 9.4Z" fill="#c9cfe8" stroke="#7b84aa" stroke-width=".9"/>`;
  const drops = (n, col = "#2f6fd6") => [8.5, 12, 15.5].slice(0, n).map((x, i) => `<path d="M${x} ${20.6 + (i % 2)}l-1 2.4" stroke="${col}" stroke-width="1.8" stroke-linecap="round"/>`).join("");
  const flakes = () => [8.5, 12.3, 16].map((x, i) => `<circle cx="${x}" cy="${21.6 + (i % 2)}" r="1.15" fill="#4aa6dd"/>`).join("");
  let g;
  if (code >= 95) g = cloud("#9aa3ad", 0, -1) + `<path d="M12.6 15.6 10.4 19.6h2.6l-1.4 3.6 4-5.2h-2.6l1.3-2.4Z" fill="#ffc21a" stroke="#d48a00" stroke-width=".6"/>`;
  else if ((code >= 71 && code <= 77) || code === 85 || code === 86) g = cloud("#e3e8ee", 0, -2) + flakes();
  else if (code >= 61 && code <= 67 || (code >= 80 && code <= 82)) g = cloud("#c2cad3", 0, -2) + drops(3);
  else if (code >= 51 && code <= 57) g = cloud("#d4dae1", 0, -2) + drops(2, "#5b8fe0");
  else if (code === 45 || code === 48) g = `<g stroke="#9aa5b1" stroke-width="1.8" stroke-linecap="round"><path d="M4 9h16M3 13h18M5 17h14"/></g>`;
  else if (code === 3) g = cloud("#c9d0d8", 0, -1);
  else if (code === 2 || code === 1) g = (day ? sun(9, 9, 3.6) : moon(9, 9)) + cloud("#f2f4f7", 1.5, 1);
  else g = day ? sun(12, 12, 4.6) : moon(12, 12);
  return `<svg class="wxi" viewBox="0 0 24 24" style="width:${size}px;height:${size}px;fill:none;stroke:none" aria-hidden="true">${g}</svg>`;
}

/** The weather at one place: the next hours and the next days (open-meteo; throws without signal). */
export async function placeForecast(lat, lon) {
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat.toFixed(4)}&longitude=${lon.toFixed(4)}&hourly=temperature_2m,precipitation_probability,precipitation,weather_code,wind_gusts_10m,is_day&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum,precipitation_probability_max,wind_gusts_10m_max,sunrise,sunset&timeformat=unixtime&timezone=auto&forecast_days=4`;
  const r = await fetch(url, { cache: "no-store" });
  if (!r.ok) throw new Error(`pogoda: HTTP ${r.status}`);
  return r.json();
}

/** The forecast for points at the hours you will be there: [{lat, lon, at}] -> [{temp, wind, pp, pr, code}] (or throws). */
export async function forecast(pts) {
  const lat = pts.map((p) => p.lat.toFixed(4)).join(","), lon = pts.map((p) => p.lon.toFixed(4)).join(",");
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&hourly=temperature_2m,precipitation_probability,precipitation,weather_code,wind_speed_10m,wind_gusts_10m&timeformat=unixtime&forecast_days=3`;
  const r = await fetch(url, { cache: "no-store" });
  if (!r.ok) throw new Error(`pogoda: HTTP ${r.status}`);
  let js = await r.json();
  if (!Array.isArray(js)) js = [js];
  return pts.map((p, i) => {
    const H = js[i]?.hourly;
    if (!H) return null;
    let k = 0, best = Infinity;
    H.time.forEach((s, j) => { const dd = Math.abs(s * 1000 - p.at); if (dd < best) { best = dd; k = j; } });
    return { temp: H.temperature_2m[k], wind: H.wind_speed_10m[k], gust: H.wind_gusts_10m?.[k], pp: H.precipitation_probability?.[k] ?? 0, pr: H.precipitation[k] ?? 0, code: H.weather_code[k] };
  });
}

/** What to warn about: a storm, or rain likely, at a point ahead ({kind, i}), else null. */
export function wxAlert(rows) {
  let rain = null;
  for (let i = 0; i < rows.length; i++) {
    const w = rows[i];
    if (!w) continue;
    if (w.code >= 95) return { kind: "storm", i };
    if (!rain && ((w.pp >= 60 && w.pr >= 0.3) || (w.code >= 61 && w.code <= 67) || (w.code >= 80 && w.code <= 82))) rain = { kind: "rain", i };
  }
  return rain;
}

// ---- help: who to call where you are (by the GPS), coarsely: the border's line, with a margin both
// numbers show (the mountains are on the borders; both services and 112 work either side)
// Poland's southern border, west to east (lon, lat), a coarse line along the ridges.
const PL_S = [[14.82, 50.87], [15.05, 51.0], [15.27, 50.98], [15.35, 50.86], [15.55, 50.78], [15.74, 50.735], [15.98, 50.69], [16.1, 50.66], [16.22, 50.64], [16.4, 50.6], [16.46, 50.55], [16.3, 50.49], [16.21, 50.43], [16.33, 50.39], [16.45, 50.31], [16.55, 50.2], [16.66, 50.13], [16.85, 50.2], [17.02, 50.23], [16.93, 50.33], [16.95, 50.44], [17.2, 50.4], [17.38, 50.3], [17.62, 50.27], [17.75, 50.2], [17.95, 50.1], [18.05, 50.03], [18.32, 49.93], [18.57, 49.92], [18.63, 49.74], [18.81, 49.67], [18.85, 49.52], [18.97, 49.42], [19.17, 49.4], [19.32, 49.53], [19.53, 49.57], [19.67, 49.4], [19.8, 49.2], [19.95, 49.22], [20.09, 49.18], [20.14, 49.31], [20.37, 49.4], [20.58, 49.37], [20.83, 49.33], [21.08, 49.43], [21.43, 49.41], [21.85, 49.39], [22.18, 49.26], [22.57, 49.09]];
const near = (lon, lat) => { // km to the line
  let best = Infinity;
  for (let i = 1; i < PL_S.length; i++) {
    const [x0, y0] = PL_S[i - 1], [x1, y1] = PL_S[i], k = Math.cos(lat * RAD) * 111.3, ky = 111.2;
    const ax = (x1 - x0) * k, ay = (y1 - y0) * ky, px = (lon - x0) * k, py = (lat - y0) * ky;
    const s = Math.max(0, Math.min(1, (px * ax + py * ay) / (ax * ax + ay * ay || 1)));
    best = Math.min(best, Math.hypot(px - s * ax, py - s * ay));
  }
  return best;
};
const northOf = (lon, lat) => { // Poland is north of the line
  for (let i = 1; i < PL_S.length; i++) {
    const [x0, y0] = PL_S[i - 1], [x1, y1] = PL_S[i];
    if ((lon >= x0 && lon <= x1) || (lon >= x1 && lon <= x0)) { const y = y0 + ((y1 - y0) * (lon - x0)) / (x1 - x0 || 1); if (lat >= y) return true; }
  }
  return false;
};
const TATRY = (lon, lat) => lon > 19.65 && lon < 20.35 && lat > 49.1 && lat < 49.36;

/** The numbers to call: [{who, tel, main}] (main first), and in words where that is. */
export function rescue(lon, lat) {
  const pl = { who: TATRY(lon, lat) ? "TOPR" : "GOPR", tel: "+48601100300", show: "601 100 300" };
  const pl985 = { who: "Ratunek w górach", tel: "985", show: "985" };
  const sk = { who: "HZS (Słowacja)", tel: "18300", show: "18 300" };
  const cz = { who: "Horská služba (Czechy)", tel: "+4201210", show: "1210" };
  const eu = { who: "Numer alarmowy", tel: "112", show: "112" };
  const inPl = northOf(lon, lat), border = near(lon, lat) < 8, other = lon < 18.85 ? cz : sk;
  const list = inPl ? [pl, pl985, ...(border ? [other] : []), eu] : [other, ...(border ? [pl] : []), eu];
  const where = inPl ? (TATRY(lon, lat) ? "w polskich Tatrach" : "w Polsce") : lon < 18.85 ? "w Czechach" : "na Słowacji";
  return { list, where: border ? `${where}, blisko granicy` : where };
}

/** Coordinates written two ways: decimal and degrees-minutes-seconds. */
export function coords(lat, lon) {
  const dms = (v, p, m) => { const a = Math.abs(v), d = Math.floor(a), mm = Math.floor((a - d) * 60), s = Math.round(((a - d) * 60 - mm) * 60); return `${v >= 0 ? p : m} ${d}°${String(mm).padStart(2, "0")}′${String(s).padStart(2, "0")}″`; };
  return { dec: `${lat.toFixed(5)}° N, ${lon.toFixed(5)}° E`, dms: `${dms(lat, "N", "S")} · ${dms(lon, "E", "W")}` };
}

// ---- home by train: the Polish railways' timetable (pociagi/trains.json from the maps site, tools/trains.py),
// kept on the phone once fetched (it works without signal); the fastest way home from stations round you
const TRAINS_CACHE = "zdrapka-trains";
let trains = null;
/** The timetable: from the phone's cache, or fetched (fresh when online and the cached one is over a week old). */
export async function loadTrains(base) {
  if (trains) return trains;
  const url = `${base}pociagi/trains.json`;
  let cache = null, hit = null;
  try { cache = await caches.open(TRAINS_CACHE); hit = await cache.match(url); } catch { /* no Cache API here */ }
  const old = hit && Date.now() - Date.parse(hit.headers.get("date") || 0) > 7 * 864e5;
  if (!hit || old) {
    try {
      const r = await fetch(url, { cache: "no-store" });
      if (r.ok) { try { await cache?.put(url, r.clone()); } catch { /* full */ } hit = r; }
    } catch { /* offline: the cached one */ }
  }
  if (!hit) throw new Error("Brak rozkładu pociągów: połącz się z internetem, żeby go pobrać (raz, ok. 1 MB).");
  trains = await hit.json();
  trains.byName = new Map(trains.st.map((s, i) => [s[0].toLowerCase(), i]));
  return trains;
}
const dist = (lat1, lon1, lat2, lon2) => Math.hypot((lon2 - lon1) * Math.cos(lat1 * RAD) * 111.32, (lat2 - lat1) * 111.2);
/** Stations within km of a point, nearest first: [{i, name, lat, lon, km}]. */
export function stationsNear(T, lat, lon, km = 25, n = 8) {
  return T.st.map((s, i) => ({ i, name: s[0], lat: s[1], lon: s[2], km: dist(lat, lon, s[1], s[2]) })).filter((s) => s.km <= km).sort((a, b) => a.km - b.km).slice(0, n);
}
/** The earliest arrival at the targets leaving station `from` not before `t0` (ms): up to two changes
 * (3 min to change at least). -> {target: {arr (ms), legs: [{label, from, dep, to, arr}]}} */
let runCache = { T: null, base: null, runs: null };
export function fastestHome(T, from, t0, targets, change = 3) {
  const midnight = new Date(t0); midnight.setHours(0, 0, 0, 0);
  const base = midnight.getTime(), start = (t0 - base) / 60000, from0 = new Date(T.from + "T00:00:00").getTime();
  // the trips running round that day: yesterday's past midnight, the day's, the next day's (made once a day)
  if (runCache.T !== T || runCache.base !== base) {
    const runs = [];
    for (const off of [-1, 0, 1]) {
      const day = Math.round((base + off * 864e5 - from0) / 864e5);
      if (day < 0 || day >= T.days) continue;
      for (const t of T.tr) if (T.sv[t[0]][day] === "1" && t[t.length - 2] + off * 1440 >= 0) runs.push([t, off * 1440]);
    }
    runCache = { T, base, runs };
  }
  const horizon = start + 20 * 60, runs = runCache.runs.filter(([t, off]) => t[t.length - 2] + off >= start && t[3] + off <= horizon);
  const n = T.st.length, R = 3;
  let prev = new Float64Array(n).fill(Infinity);
  prev[from] = start;
  const best = Float64Array.from(prev), par = [];
  for (let k = 1; k <= R; k++) {
    const cur = Float64Array.from(best), p = new Map();
    let changed = false;
    for (const [t, off] of runs) {
      let b = -1;
      for (let j = 2; j < t.length; j += 3) {
        const s = t[j], a = t[j + 1] + off, d = t[j + 2] + off;
        if (b >= 0 && a < cur[s]) { cur[s] = a; p.set(s, { t, off, b, j }); changed = true; }
        if (b < 0 && prev[s] + (k > 1 ? change : 0) <= d) b = j;
      }
    }
    par.push(p);
    for (let s = 0; s < n; s++) if (cur[s] < best[s]) best[s] = cur[s];
    prev = cur;
    if (!changed) break;
  }
  const out = {};
  for (const g of targets) {
    if (g == null || !(best[g] < Infinity)) continue;
    // the round that reached it first, then back leg by leg
    let k = par.findIndex((p) => p.get(g) && p.get(g).t[p.get(g).j + 1] + p.get(g).off === best[g]);
    if (k < 0) continue;
    const legs = [];
    let s = g;
    while (k >= 0 && s !== from) {
      const L = par[k].get(s);
      if (!L) { k--; continue; }
      legs.unshift({ label: L.t[1], from: T.st[L.t[L.b]][0], dep: base + (L.t[L.b + 2] + L.off) * 60000, to: T.st[s][0], arr: base + (L.t[L.j + 1] + L.off) * 60000 });
      s = L.t[L.b]; k--;
    }
    if (s === from) out[g] = { arr: base + best[g] * 60000, legs };
  }
  return out;
}
/** Koleo's search for a connection (the app opens the link when installed). */
export function koleoUrl(from, to, t) {
  const slug = (s) => s.toLowerCase().replace(/ł/g, "l").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  const d = new Date(t), p = (v) => String(v).padStart(2, "0");
  return `https://koleo.pl/rozklad-pkp/${slug(from)}/${slug(to)}/${p(d.getDate())}-${p(d.getMonth() + 1)}-${d.getFullYear()}_${p(d.getHours())}:${p(d.getMinutes())}/all/all`;
}

/** The weather of one day at a place (open-meteo, up to 15 days ahead; cached an hour):
 * {code, rain (mm), pp (%), gust (km/h), tmax, bad: words or null} or null (no signal, too far ahead). */
const dayCache = new Map();
export async function dayWeather(lat, lon, t) {
  const d = new Date(t), p = (v) => String(v).padStart(2, "0"), day = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  if ((t - Date.now()) / 864e5 > 15) return null;
  const key = `${lat.toFixed(1)},${lon.toFixed(1)},${day}`, hit = dayCache.get(key);
  if (hit && Date.now() - hit.t < 3600e3) return hit.v;
  try {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat.toFixed(3)}&longitude=${lon.toFixed(3)}&daily=weather_code,precipitation_sum,precipitation_probability_max,wind_gusts_10m_max,temperature_2m_max&timezone=auto&start_date=${day}&end_date=${day}`;
    const r = await fetch(url, { cache: "no-store" });
    if (!r.ok) return null;
    const D = (await r.json()).daily, v = { code: D.weather_code[0], rain: D.precipitation_sum[0], pp: D.precipitation_probability_max[0], gust: D.wind_gusts_10m_max[0], tmax: D.temperature_2m_max[0] };
    v.bad = v.code >= 95 ? "burze" : v.rain >= 6 && v.pp >= 60 ? "deszcz" : v.gust >= 75 ? `wiatr do ${Math.round(v.gust)} km/h` : v.code >= 71 && v.code <= 86 && v.rain >= 3 ? "śnieg" : null;
    dayCache.set(key, { t: Date.now(), v });
    return v;
  } catch { return null; }
}
