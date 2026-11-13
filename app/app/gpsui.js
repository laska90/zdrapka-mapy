// your position: the blue dot and following it, its card, the GPS button (tap: to you, hold: on/off), the compass, the scale bar, the arrow to you
// (moved out of app.js: what it needs of the app comes in C, see createX in app.js)
import { GEOID_SUDETY, Gps } from "./gps.js";
import { projector } from "../core/pack.js";
import { state } from "./state.js";
import { distText, edgeHit, nearest, outside, scaleBar, windPl, windShort } from "../core/hud.js";

export function createGpsUi(C) {
  let lastFixT = 0;
  let gpsResume = false;
  let gpsHold = null;
  let scaleS = 0;
  const gps = new Gps({ onFix: onGps, onError: (m) => { if (!(C.gps.fix && Date.now() - C.gps.fix.t < 60000 && !C.gps.denied)) C.toast(m); gpsUi(); if (!C.$("sos").hidden) C.renderSos(); } });
  function gpsXY() { return gps.fix && C.view.meta ? projector(C.view.meta)(gps.fix.lon, gps.fix.lat) : null; }
  function gpsUi() {
    const b = C.$("gpsbtn");
    b.classList.toggle("on", gps.on); b.classList.toggle("follow", gps.on && state.follow); b.classList.toggle("wait", gps.on && !gps.fix);
    b.setAttribute("aria-label", !gps.on ? "Pokaż moją pozycję" : "Wróć do mojej pozycji");
  }
  function centerGps([x, y], zoomIn, fly = false) {
    if (C.view.flying && !fly) return; // a flight there is under way
    const set = () => { if (zoomIn && C.view.zl < 8) C.view.s = 2 ** 8 / 1000; /* (the trails and names round you, not a green field) */ C.view.anchor(x, y, C.view.W / 2, C.view.H * 0.5); };
    if (fly) C.flyView(set); else { set(); C.view.draw(); }
  }
  function onGps(g) {
    const p = gpsXY();
    if (!C.$("sos").hidden) C.renderSos();
    if (state.homeWait && g.fix && !g.stale) { state.homeWait = false; C.homeByTrain(); }
    C.view.setGps(p ? { x: p[0], y: p[1], acc: g.fix.acc, heading: g.heading, stale: g.stale } : null);
    // my dot on the plan's profile (fresh fixes); the last fix (up to 15 min, standing still gives none) for a new way from me
    C.planner.gps(p && !g.stale ? { x: p[0], y: p[1], acc: g.fix.acc } : null, p && Date.now() - g.fix.t < 15 * 60000 ? { x: p[0], y: p[1], acc: g.fix.acc } : null);
    // a card open with the way from you: again from where you are now (after 25 m)
    if (p && !g.stale && state.fromNow && state.cur?.key === state.fromNow.key && Math.hypot(p[0] - state.fromNow.at[0], p[1] - state.fromNow.at[1]) > 25) C.fromMe(state.fromNow.key, { x: p[0], y: p[1] }, state.fromNow.q);
    if (p && g.fix.t !== lastFixT) {
      lastFixT = g.fix.t;
      const away = outside(p[0], p[1], C.view.SH); // not on the map at all: nothing to follow, the arrow tells where
      if (state.follow && !away) { centerGps(p, state.firstFix, state.firstFix); state.firstFix = false; }
      else if (away && state.firstFix) { state.firstFix = false; C.toast(`Jesteś ${distText(away.d)} ${windPl(away.deg)} od mapy.`, 5000); }
      if (state.cur?.key === "gps") posCard();
    }
    gpsUi();
  }
  // the position button: a tap takes you to your dot (the GPS switched on first if it was off), a long
  // press switches the GPS on or off (the active route's card: Back, or its pill)
  function gpsToggle() {
    if (gps.on) { state.follow = false; gps.stop(); if (state.cur?.key === "gps") C.hideTip(); C.toast("GPS wyłączony", 1800); }
    else { state.follow = true; state.firstFix = true; gps.start(); C.toast("GPS włączony", 1800); }
    gpsUi();
  }
  C.$("gpsbtn").addEventListener("pointerdown", () => { clearTimeout(gpsHold?.t); gpsHold = { fired: false, t: setTimeout(() => { gpsHold.fired = true; C.haptic.bump(); gpsToggle(); }, 550) }; });
  for (const ev of ["pointerup", "pointercancel", "pointerleave"]) C.$("gpsbtn").addEventListener(ev, () => clearTimeout(gpsHold?.t));
  C.$("gpsbtn").addEventListener("contextmenu", (e) => e.preventDefault());
  C.$("gpsbtn").onclick = () => {
    if (gpsHold?.fired) { gpsHold = null; return; } // the long press did it
    state.follow = true;
    if (!gps.on) { state.firstFix = true; gps.start(); }
    else {
      const p = gps.fix && gpsXY(), away = p && outside(p[0], p[1], C.view.SH);
      if (p && !away) centerGps(p, false, true);
      else if (away) C.toast(`Jesteś ${distText(away.d)} ${windPl(away.deg)} od mapy.`, 3500);
      else { state.firstFix = true; C.toast("Szukam Twojej pozycji…", 2500); }
    }
    gpsUi();
  };
  document.addEventListener("visibilitychange", () => { // no GPS in the background
    if (document.hidden && gps.on) { gpsResume = true; gps.stop({ keep: true }); }
    else if (!document.hidden && gpsResume) { gpsResume = false; state.firstFix = false; gps.start({ quick: true }); }
  });
  const DIRS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
  /** Tap on the blue dot: where I am and how high. Refreshes with each fix while open. */
  function posCard() {
    const f = gps.fix, p = gpsXY();
    if (!f || !p) return;
    if (!state.posElev || Math.hypot(state.posElev.x - p[0], state.posElev.y - p[1]) > 6) {
      const q = (state.posElev = { x: p[0], y: p[1], r: undefined });
      C.elevAt(p[0], p[1]).then((r) => { q.r = r; if (state.posElev === q && state.cur?.key === "gps") posCard(); });
    }
    const h = state.posElev.r?.h, galt = f.alt != null ? Math.round(f.alt - GEOID_SUDETY) : null;
    const main = h ?? galt, hd = gps.heading;
    const src = [h != null ? "z mapy terenu" : state.posElev.r === undefined ? "liczę z mapy…" : "", galt != null ? `GPS: ${galt} m${f.altAcc ? ` ±${Math.round(f.altAcc)}` : ""}` : ""].filter(Boolean).join(" · ");
    let html = `<h4>Tu jesteś</h4><div class="ostats"><span><b>${main ?? "…"}</b> m n.p.m.</span><span><b>±${Math.round(f.acc)}</b> m</span>${hd != null ? `<span><b>${DIRS[Math.round(hd / 45) % 8]}</b> ${Math.round(hd)}°</span>` : ""}</div>`;
    if (src) html += `<div class="tk">Wysokość ${src}</div>`;
    const out = outside(p[0], p[1], C.view.SH), near = out ? null : nearest(C.goals(), p[0], p[1], 1)[0];
    if (out) html += `<div class="tl">Jesteś ${distText(out.d)} ${windPl(out.deg)} od mapy.</div>`;
    else if (near) html += `<div class="tags"><button data-goal="${near.id}">Najbliższy niezdobyty: <b>${near.n}</b> · ${distText(near.d)} ${windShort(near.deg)}${main != null ? ` · ${near.e > main ? "↑" : "↓"}${Math.abs(Math.round(near.e - main))} m` : ""}</button></div>`;
    html += `<div class="tk">${C.coordTxt(f.lat, f.lon)}${gps.stale ? ` · odczyt z ${new Date(f.t).toLocaleTimeString("pl-PL", { hour: "2-digit", minute: "2-digit" })}` : ""}</div>`;
    // one row: the train home (the main one), a route from here, help (a train button once: it was there twice)
    html += `<div class="actrow"><button class="act toplan" data-home><svg><use href="#i-train"/></svg><span>Pociąg do domu</span></button>${out ? "" : `<button class="act" data-plan><svg><use href="#i-route"/></svg><span>Trasa stąd</span></button>`}<button class="act sosact" data-sos>Wezwij pomoc</button></div>`;
    C.openTip(html, null, "gps", { label: "Tu jesteś", reopen: posCard });
    const sb = C.$("tip").querySelector("[data-sos]"); if (sb) sb.onclick = C.openSos;
    const hb = C.$("tip").querySelector("[data-home]"); if (hb) hb.onclick = () => C.homeByTrain();
    const pb = C.$("tip").querySelector("[data-plan]"); if (pb) pb.onclick = () => C.planner.open({ x: p[0], y: p[1], n: "Moja pozycja" });
  }
  // ---- the compass: shows while the map is turned; a tap turns it back to north
  function updateCompass() {
    const b = C.$("compass"), on = Math.abs(C.view.rot) > 0.005;
    if (b.hidden === on) b.hidden = !on;
    if (on) b.firstElementChild.style.transform = `rotate(${C.view.rot}rad)`;
  }
  C.$("compass").onclick = () => { C.haptic.tick(); C.view.northUp(); };
  // ---- scale bar (for a moment when the zoom changes), the arrow to my position, goals nearby
  function updateScale() {
    const s = C.view.s, el = C.$("scale");
    if (!C.view.index || Math.abs(s - scaleS) < 0.004 * s) return;
    scaleS = s;
    const b = scaleBar(s);
    el.firstElementChild.textContent = b.label; el.lastElementChild.style.width = `${Math.round(b.px)}px`;
    el.hidden = false; el.classList.remove("fade");
    clearTimeout(updateScale.t); updateScale.t = setTimeout(() => el.classList.add("fade"), 2500);
  }
  /** The phone is off the screen: a pill with an arrow and the distance at the edge, in its direction. */
  function updateGpsPill() {
    const pill = C.$("gpspill"), p = C.view.index && gps.on ? gpsXY() : null;
    if (!p) { if (!pill.hidden) pill.hidden = true; return; }
    const [sx, sy] = C.view.toScreen(p[0], p[1]), top = 76;
    const box = [10, top, C.view.W - 10, Math.max(top + 60, C.$("sheet").getBoundingClientRect().top - 12)];
    if (sx >= box[0] && sx <= box[2] && sy >= box[1] && sy <= box[3]) { if (!pill.hidden) pill.hidden = true; return; }
    const hit = edgeHit(sx, sy, box);
    if (!hit) return;
    const out = outside(p[0], p[1], C.view.SH), dm = Math.hypot(sx - (box[0] + box[2]) / 2, sy - (box[1] + box[3]) / 2) / C.view.s;
    const txt = out ? `${distText(out.d)} ${windPl(out.deg)} od mapy` : distText(dm), lab = pill.lastElementChild;
    if (lab.textContent !== txt) lab.textContent = txt;
    pill.hidden = false;
    const hw = pill.offsetWidth / 2, hh = pill.offsetHeight / 2;
    let px = Math.min(Math.max(hit.x, box[0] + hw), box[2] - hw), py = Math.min(Math.max(hit.y, box[1] + hh), box[3] - hh);
    const lb = C.$("layersbtn").getBoundingClientRect(); // (not under the layers button in the top right corner)
    if (px + hw > lb.left - 6 && py - hh < lb.bottom + 6) py = Math.min(box[3] - hh, lb.bottom + 8 + hh);
    pill.style.left = `${px}px`; pill.style.top = `${py}px`;
    pill.firstElementChild.style.transform = `rotate(${hit.a}rad)`;
  }
  C.$("gpspill").onclick = () => {
    const p = gpsXY();
    if (!p) return;
    const out = outside(p[0], p[1], C.view.SH);
    if (out) { C.toast(`Jesteś ${distText(out.d)} ${windPl(out.deg)} od mapy.`, 5000); return; }
    state.follow = true; centerGps(p, false, true); gpsUi(); C.haptic.tick();
  };

  return { centerGps, gps, gpsUi, gpsXY, posCard, updateCompass, updateGpsPill, updateScale };
}
