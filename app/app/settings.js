// the settings page: Garmin (connect, disconnect), the heights, removing all outings
// (moved out of app.js: what it needs of the app comes in C, see createX in app.js)
import { state } from "./state.js";
import { askNotifications, configureBackground } from "./native.js";

export function createSettings(C) {
  function renderSettings() {
    C.$("home1").value = state.settings.home?.a || ""; C.$("home2").value = state.settings.home?.b || ""; C.homeStatus();
    C.$("tripnote").checked = state.settings.trip?.note !== false; C.$("triptime").value = state.settings.trip?.at || "17:00"; C.$("triptime").disabled = state.settings.trip?.note === false;
    C.$("icukey").value = state.settings.icu?.key || "";
    C.$("icustatus").textContent = C.icuStatus();
    C.$("about").innerHTML = (C.view.meta?.attribution || []).join("<br>") + `<br>Dane mapy: ${C.view.meta?.snapshot || ""}`;
  }
  C.$("elefill").onclick = () => C.refillElevations({ quiet: false });
  C.$("icusave").onclick = async () => {
    const key = C.$("icukey").value.trim();
    if (!key) return;
    state.settings.icu = { ...(state.settings.icu || {}), key, error: null };
    C.saveSettings();
    askNotifications();
    C.drawer(false);
    await C.sync();
  };
  C.$("icuoff").onclick = () => {
    state.settings.icu = null; C.saveSettings(); configureBackground(null); renderSettings();
  };
  C.$("clearall").onclick = async () => {
    if (!confirm("Usunąć wszystkie wyjścia z tego urządzenia?")) return;
    C.busy("Czyszczę…");
    try { C.render((await C.call("clear", { settings: state.settings })).result); renderSettings(); C.view.fitRegion(); C.view.draw(); } finally { C.idle(); }
  };
  /** Settings (a page of the menu, as the others), scrolled to a row; focus: its first field. */
  function openSettings(row = null, focus = false) {
    C.drawer("setp");
    if (row) requestAnimationFrame(() => { C.$(row)?.scrollIntoView({ block: "start" }); if (focus) C.$(row)?.querySelector("input")?.focus(); });
  }
  return { openSettings, renderSettings };
}
