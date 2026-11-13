// the map's views: the layers menu (Zdrapka / Ślady / Mapa), the accent colour, the legend (in the menu)
// (moved out of app.js: what it needs of the app comes in C, see createX in app.js)
import { state } from "./state.js";
import { mapSignURL } from "./glyphs.js";
import { EDU as EDU_CSS } from "./glstyle.js";

export function createLayers(C) {
  // one choice of three: the scratch-off (fog over the ground, your traces), your traces on the plain map, the plain map
  const MODE_NAMES = { fog: "Zdrapka", trace: "Ślady", map: "Mapa" };
  /** The accent (style.css --sel, --accent: one violet): what is chosen on the map, the buttons, the progress. */
  function cssVar(k, dflt) { return getComputedStyle(document.documentElement).getPropertyValue(k).trim() || dflt; }
  function applyAccent() {
    // the plan and the route you walk: the second colour (amber); violet is what is yours
    C.view.setAccent(cssVar("--plan-line", "#e8930c"), cssVar("--plan-line", "#e8930c"));
    C.view.trace = cssVar("--trace", "123, 85, 230").replace(/\s/g, ""); C.view.draw();
  }
  function setMode(m) {
    if (!MODE_NAMES[m]) m = "fog";
    state.settings.mode = C.view.mode = m; C.saveSettings();
    applyLayers(); C.friendsBar?.();
  }
  function layers(open) {
    C.$("modes").hidden = !open; C.$("layersbtn").setAttribute("aria-expanded", open);
  }
  /** The view on the map and in the menu: the fog only in Zdrapka, your traces unless Mapa; the icons always. */
  function applyLayers(redraw = true) {
    const m = C.view.mode;
    C.view.setLayers({ glow: m !== "map", icons: true, relief: false });
    for (const b of C.$("lyView").querySelectorAll("button")) { b.classList.toggle("on", b.dataset.m === m); b.setAttribute("aria-checked", b.dataset.m === m); }
    if (redraw) C.view.draw();
  }
  /** What the markers on the map mean (in the layers menu). */
  function fillLegend() {
    const v = (k, d) => `<img src="${mapSignURL(k, d)}" alt="">`; // (as on the map: the quiet signs)
    const rows = [
      [v("peak", false), "szczyt"], [v("peak", true), "szczyt zdobyty"], [v("peak-k", false), "szczyt z odznaki (złota gwiazdka); medale list w karcie szczytu"],
      [v("hut", false), "schronisko"], [v("shelter", false), "wiata"], [v("tower", false), "wieża widokowa"], [v("viewpoint", false), "punkt widokowy"],
      [v("waterfall", false), "wodospad"], [v("spring", false), "źródło"], [v("rock", false), "skałka"], [v("cave", false), "jaskinia"], [v("ruins", false), "ruiny, zamek"],
      [v("station", false), "stacja kolejowa"], [v("bus", false), "przystanek (z bliska)"], [v("parking", false), "parking (z bliska)"],
      [`<i class="lg band"></i>`, "Twoje ślady (mocniej: częściej)"], [`<i class="lg dash"></i>`, "znakowany szlak, w jego kolorze"], [`<svg viewBox="0 0 24 10" width="24" height="10"><path d="M1 5h22" stroke="${EDU_CSS}" stroke-width="3" stroke-dasharray="3 3"/></svg>`, "ścieżka edukacyjna (krótsze kreski, morski kolor), to nie zielony szlak"], [`<svg viewBox="0 0 26 14" width="26" height="14"><path d="M2 7h22" stroke="#f6cf7c" stroke-width="12" stroke-linecap="round"/><path d="M2 7h22" stroke="#e2342b" stroke-width="2.4" stroke-dasharray="4 2"/></svg>`, "planowana trasa: bursztynowy pas pod szlakami, którymi prowadzi"], [`<svg viewBox="0 0 26 14" width="26" height="14"><path d="M2 7h22" stroke="#dcd9d2" stroke-width="12" stroke-linecap="round"/></svg>`, "przebyta część aktywnej trasy"], [`<svg viewBox="0 0 26 14" width="26" height="14"><path d="M3 7h20" stroke="#f3dca8" stroke-width="7" stroke-linecap="round"/></svg>`, "zapisany plan (Moje plany)"],
    ];
    C.$("poplegend").innerHTML = rows.map(([a, t]) => `<div class="lgr"><span class="lgi">${a}</span><span>${t}</span></div>`).join("");
  }
  // a tap on a picture: the map changes at once, the menu goes a moment later (you see the ring move)
  C.$("lyView").onclick = (e) => { const m = e.target.closest("button")?.dataset.m; if (!m) return; setMode(m); clearTimeout(layers.t); layers.t = setTimeout(() => layers(false), 260); };
  C.$("layersbtn").onclick = (e) => { e.stopPropagation(); layers(C.$("modes").hidden); };
  document.addEventListener("pointerdown", (e) => {
    if (!C.$("modes").hidden && !e.target.closest("#modes, #layersbtn")) layers(false);
    if (!C.$("results").hidden && !e.target.closest("#results, .search")) C.closeSearch(false);
  });

  return { MODE_NAMES, applyAccent, applyLayers, cssVar, fillLegend, layers, setMode };
}
