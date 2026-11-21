// Help: who to call where you are (by the GPS), your position to read out or send.
// C: the app as these parts see it (ctx in app.js: every name read when used).
import { coords as coordWords, rescue } from "./trip.js";
import { GEOID_SUDETY } from "./gps.js";
import { distText } from "../core/hud.js";
import { isNative } from "./native.js";
import { unprojector } from "../core/pack.js";
import { state } from "./state.js";

export function createSos(C) {
  // and from the position card; no internet needed (the call and the text go through the phone's apps)
  let sosPlace = null;
  function openSos() {
    C.drawer(false); C.hideTip();
    if (!C.gps.on) { state.follow = false; C.gps.start(); C.gpsUi(); }
    C.$("sos").hidden = false; renderSos();
  }
  async function renderSos() {
    const f = C.gps.fix, body = C.$("sosbody");
    if (!f) {
      body.innerHTML = `<p class="muted">${C.gps.denied ? "Brak dostępu do lokalizacji: powiedz ratownikom, gdzie jesteś." : "Szukam Twojej pozycji (GPS)…"}</p>` + sosCalls(rescue(19.95, 49.6).list.filter((c) => c.tel === "112" || c.tel === "985" || c.tel === "+48601100300"), "");
      return;
    }
    const { list, where } = rescue(f.lon, f.lat), c = coordWords(f.lat, f.lon), p = C.gpsXY();
    const h = state.posElev?.r?.h ?? (f.alt != null ? Math.round(f.alt - GEOID_SUDETY) : null);
    if (p && C.view.meta && (!sosPlace || Math.hypot(sosPlace.x - p[0], sosPlace.y - p[1]) > 40)) {
      const q = (sosPlace = { x: p[0], y: p[1], t: null });
      C.call("nameAt", { x: p[0], y: p[1] }).then((r) => { if (sosPlace === q && r.place) { q.t = r.place.d < 60 ? `przy: ${r.place.n}` : `${distText(r.place.d)} od: ${r.place.n}`; if (!C.$("sos").hidden) renderSos(); } }).catch(() => {});
    }
    const txt = `Potrzebuję pomocy. Moja pozycja: ${c.dec} (${c.dms})${h != null ? `, ${h} m n.p.m.` : ""}${sosPlace?.t ? `, ${sosPlace.t}` : ""}. https://maps.google.com/?q=${f.lat.toFixed(6)},${f.lon.toFixed(6)}`;
    body.innerHTML = `<p class="muted small">Jesteś ${where} (wg GPS). Mów spokojnie: gdzie jesteś, co się stało, ile osób.</p>` + sosCalls(list, txt) +
      `<div class="sospos"><span class="muted small">Twoja pozycja · dokładność ${Math.round(f.acc)} m · ${new Date(f.t).toLocaleTimeString("pl-PL", { hour: "2-digit", minute: "2-digit" })}</span><b>${c.dec}</b><span>${c.dms}</span><span>${h != null ? `${h} m n.p.m.` : ""}${sosPlace?.t ? ` · ${C.esc(sosPlace.t)}` : ""}</span></div>` +
      `<div class="sosrow2"><button class="btn" data-sms>Wyślij SMS</button><button class="btn" data-copy>Kopiuj pozycję</button></div>`;
    body.querySelector("[data-sms]").onclick = () => openExternal(`sms:?body=${encodeURIComponent(txt)}`);
    body.querySelector("[data-copy]").onclick = async () => { try { await navigator.clipboard.writeText(txt); C.toast("Skopiowano pozycję", 2000); } catch { C.toast(txt, 8000); } };
  }
  const sosCalls = (list, txt) => `<div class="soscalls">${list.map((q, i) => `<button class="${i ? "sc2" : "sc1"}" data-tel="${q.tel}"><span>${q.who}</span><b>${q.show}</b></button>`).join("")}</div>`;
  C.$("sosbody").addEventListener("click", (e) => { const t = e.target.closest("[data-tel]")?.dataset.tel; if (t) openExternal(`tel:${t}`); });
  C.$("sosx").onclick = () => (C.$("sos").hidden = true);
  C.$("sosbtn").onclick = openSos;

  function openExternal(url) {
    if (isNative()) location.href = url; // (the app's web view hands other sites to the system, it does not leave the app)
    else window.open(url, "_blank", "noopener");
  }
  function directions(x, y) {
    const [lon, lat] = unprojector(C.view.meta)(x, y);
    openExternal(`https://www.google.com/maps/dir/?api=1&destination=${lat.toFixed(6)},${lon.toFixed(6)}&travelmode=driving`);
  }

  return { directions, openExternal, openSos, renderSos };
}
