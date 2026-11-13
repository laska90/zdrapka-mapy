// The weather at a place: the next hours and days (open-meteo).
// C: the app as these parts see it (ctx in app.js: every name read when used).
import { unprojector } from "../core/pack.js";
import { shortName } from "./labels.js";
import { placeForecast, wxIcon, wxWord } from "./trip.js";

export function createWeather(C) {
  async function placeWeather(q) {
    const [lon, lat] = unprojector(C.view.meta)(q.x, q.y), name = q.n ? shortName(q.n) : "tu";
    const head = `<h4>Pogoda: ${C.esc(name)}</h4>`;
    C.openTip(head + `<p class="muted">Pobieram prognozę…</p>`, null, "wx", { label: "Pogoda" });
    let W;
    try { W = await placeForecast(lat, lon); } catch { C.openTip(head + `<p>${navigator.onLine === false ? "Brak internetu: prognozę pobierzesz, gdy złapiesz zasięg." : "Nie udało się pobrać prognozy."}</p>`, null, "wx", { label: "Pogoda", reopen: () => placeWeather(q) }); return; }
    const H = W.hourly, Dd = W.daily, now = Date.now() / 1000;
    const k0 = Math.max(0, H.time.findIndex((t) => t + 3600 > now)), hrs = [];
    for (let k = k0; k < H.time.length && hrs.length < 8; k += 2) hrs.push(k);
    const t = (s) => new Date(s * 1000).toLocaleTimeString("pl-PL", { hour: "2-digit", minute: "2-digit" });
    const dayName = (s, i) => (i === 0 ? "dziś" : i === 1 ? "jutro" : new Date(s * 1000).toLocaleDateString("pl-PL", { weekday: "long" }));
    let html = head + `<div class="wxnow">${wxIcon(H.weather_code[k0], H.is_day?.[k0] !== 0, 46)}<div><b>${Math.round(H.temperature_2m[k0])}°</b><span>${wxWord(H.weather_code[k0])[1]} · porywy ${Math.round(H.wind_gusts_10m[k0])} km/h${H.precipitation_probability?.[k0] >= 20 ? ` · opad ${H.precipitation_probability[k0]}%` : ""}</span><small>prognoza dla ${Math.round(W.elevation)} m n.p.m.${q.e && Math.abs(q.e - W.elevation) > 150 ? ` (szczyt: ${Math.round(q.e)} m, bywa chłodniej i wietrzniej)` : ""}</small></div></div>`;
    html += `<div class="wxrow">${hrs.map((k) => { const c = H.weather_code[k], wet = c >= 95 ? " s" : (H.precipitation_probability?.[k] >= 50 && H.precipitation[k] >= 0.3) ? " r" : ""; return `<div class="wxc${wet}"><small>${t(H.time[k])}</small>${wxIcon(c, H.is_day?.[k] !== 0)}<b>${Math.round(H.temperature_2m[k])}°</b><small>${Math.round(H.wind_gusts_10m[k])} km/h${H.precipitation_probability?.[k] >= 30 ? ` · ${H.precipitation_probability[k]}%` : ""}</small></div>`; }).join("")}</div>`;
    html += `<div class="wxdays">${Dd.time.map((s, i) => `<div class="wxd">${wxIcon(Dd.weather_code[i], true, 30)}<span class="dn">${dayName(s, i)}</span><span><b>${Math.round(Dd.temperature_2m_max[i])}°</b> / ${Math.round(Dd.temperature_2m_min[i])}°</span><span class="muted">${Dd.precipitation_sum[i] >= 0.2 ? `${C.nf(Dd.precipitation_sum[i])} mm` : "bez opadu"} · ${Math.round(Dd.wind_gusts_10m_max[i])} km/h</span><small class="muted">☀ ${t(Dd.sunrise[i])}–${t(Dd.sunset[i])}</small></div>`).join("")}</div>`;
    html += `<p class="muted small">Prognoza open-meteo.com · z ${t(now)}</p>`;
    C.openTip(html, null, "wx", { label: "Pogoda", reopen: () => placeWeather(q) });
  }

  return { placeWeather };
}
