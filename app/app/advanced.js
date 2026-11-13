// Zaawansowane: the diagnostics report and the smoothness test
// (moved out of app.js: what it needs of the app comes in C, see createX in app.js)
import { D, note, report } from "./diag.js";
import { keepScreenOn } from "./native.js";
import { state } from "./state.js";

export function createAdvanced(C) {
  async function showDiag() {
    const el = C.$("diag");
    el.hidden = false; el.textContent = "Zbieram…";
    el.textContent = await report(C.view, { result: state.result, settings: state.settings });
  }
  C.$("diagrun").onclick = showDiag;
  // the smoothness test: the settings out of the way, the map goes round where it is now, then the results
  // under the report (and in it: D.bench)
  C.$("diagbench").onclick = async () => {
    C.drawer(false); C.hideTip(); C.sheet("min");
    C.toast("Test płynności: nie dotykaj ekranu (ok. 3 min)", 60000);
    if (!(await keepScreenOn(true))) note("test: ekran może zgasnąć (brak blokady)");
    const res = await C.view.bench((s) => C.toast(`Test płynności: ${s}`, 60000)).catch((e) => { note(`test: ${e.message}`); return []; });
    await keepScreenOn(false);
    D.bench = res; D.benchAt = C.view.benchAt;
    C.toast(res.length ? "Test płynności: gotowe" : "Test płynności się nie udał", 2500);
    C.openSettings("diag"); await showDiag();
  };
  C.$("diagcopy").onclick = async () => {
    const t = C.$("diag").hidden ? await report(C.view, { result: state.result, settings: state.settings }) : C.$("diag").textContent;
    try { await navigator.clipboard.writeText(t); C.toast("Raport skopiowany — wklej go w rozmowie", 3000); }
    catch { C.$("diag").hidden = false; C.$("diag").textContent = t; getSelection().selectAllChildren(C.$("diag")); C.toast("Zaznaczyłem raport — skopiuj go", 3000); }
  };
}
