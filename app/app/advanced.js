// Zaawansowane: the diagnostics report and the smoothness test (app/bench.js): quick or full, its results as cards
// under the buttons (and in the report), a JSON file to send
// (moved out of app.js: what it needs of the app comes in C, see createX in app.js)
import { D, realStart, report } from "./diag.js";
import { abHTML, abText, benchHTML, benchText, layersHTML, layersText } from "./benchreport.js";
import { state } from "./state.js";

export function createAdvanced(C) {
  D.benchText = benchText;
  fetch("version.json", { cache: "no-store" }).then((r) => r.json()).then((j) => realStart(j.version)).catch(() => realStart("web"));
  async function showDiag() {
    const el = C.$("diag");
    el.hidden = false; el.textContent = "Zbieram…";
    el.textContent = await report(C.view, { result: state.result, settings: state.settings });
  }
  C.$("diagrun").onclick = showDiag;
  /** The test: the settings out of the way, a bar on top (what runs, Przerwij), then the results' cards. */
  async function runBench(kind) {
    let bar = C.$("benchbar");
    if (!bar) { bar = document.createElement("div"); bar.id = "benchbar"; document.body.append(bar); }
    bar.hidden = false;
    bar.innerHTML = `<div><b>Test płynności</b><small>nie dotykaj ekranu</small><span id="benchstep">przygotowuję…</span></div><button class="btn" id="benchstop">Przerwij</button>`;
    C.$("benchstop").onclick = () => { C.benchStop(); C.$("benchstep").textContent = "kończę…"; };
    let R = null;
    try { R = await C.benchRun(kind, (t) => { const el = C.$("benchstep"); if (el) el.textContent = t; }); }
    catch (e) { C.toast("Test się nie udał: " + (e?.message || e), 5000); }
    bar.hidden = true;
    showBench(R);
    const det = C.$("benchres").closest("details"); if (det) det.open = true;
    C.openSettings("benchres");
  }
  function showBench(R = D.bench2) {
    const el = C.$("benchres");
    if (!R) { el.hidden = true; return; }
    el.hidden = false;
    el.innerHTML = benchHTML(R, C.benchHistory()) + `<div class="bacts"><button class="btn" data-bcopy>Kopiuj wyniki</button><button class="btn" data-bjson>Zapisz plik JSON</button></div>`;
    el.querySelector("[data-bcopy]").onclick = async () => { try { await navigator.clipboard.writeText(benchText(R)); C.toast("Wyniki skopiowane — wklej je w rozmowie", 3000); } catch { C.toast("Nie udało się skopiować", 3000); } };
    el.querySelector("[data-bjson]").onclick = () => C.shareBlob(new Blob([JSON.stringify(R, null, 1)], { type: "application/json" }), `zdrapka-test-${R.device.at.replace(/[:T]/g, "-")}.json`, "Test płynności Zdrapki");
  }
  /** The tiles' tuning, off then on (the quick test each time; the threads are set as the map starts, so the app
   * restarts between the halves: the first half's results wait in localStorage, the second runs by itself). */
  const AB = "zdrapka.abRun";
  function abStart() {
    if ((navigator.hardwareConcurrency || 0) < 8) { C.toast("Ten telefon ma mniej niż 8 rdzeni: nie ma czego porównać", 4000); return; }
    localStorage.setItem(AB, JSON.stringify({ step: "A", was: localStorage.getItem("zdrapka.tune") }));
    localStorage.setItem("zdrapka.tune", "0");
    location.reload();
  }
  function abEnd(ab) {
    localStorage.removeItem(AB);
    if (ab.was == null) localStorage.removeItem("zdrapka.tune"); else localStorage.setItem("zdrapka.tune", ab.was);
  }
  const slim = (R) => ({ hz: R.hz, device: R.device, scenarios: R.scenarios.map((q) => ({ id: q.id, name: q.name, s: q.s })) });
  async function abResume() {
    let ab; try { ab = JSON.parse(localStorage.getItem(AB) || "null"); } catch { ab = null; }
    if (!ab) return;
    for (let k = 0; k < 600 && !(C.view?.ready && state.result && C.$("loading")?.hidden); k++) await new Promise((r) => setTimeout(r, 200));
    await new Promise((r) => setTimeout(r, 3000)); // (the map settled after the start)
    let bar = C.$("benchbar");
    if (!bar) { bar = document.createElement("div"); bar.id = "benchbar"; document.body.append(bar); }
    bar.hidden = false;
    bar.innerHTML = `<div><b>Test: wątki kafli</b><small>nie dotykaj ekranu</small><span id="benchstep">przygotowuję…</span></div><button class="btn" id="benchstop">Przerwij</button>`;
    C.$("benchstop").onclick = () => { C.benchStop(); C.$("benchstep").textContent = "kończę…"; };
    let R = null;
    try { R = await C.benchRun("quick", (t) => { const el = C.$("benchstep"); if (el) el.textContent = `${ab.step === "A" ? "1/2" : "2/2"}: ${t}`; }); }
    catch (e) { C.toast("Test się nie udał: " + (e?.message || e), 5000); }
    bar.hidden = true;
    if (!R || R.stopped) { abEnd(ab); return; }
    if (ab.step === "A") {
      localStorage.setItem(AB, JSON.stringify({ ...ab, step: "B", a: slim(R) }));
      localStorage.setItem("zdrapka.tune", "1");
      location.reload();
      return;
    }
    abEnd(ab);
    const out = [ab.a, slim(R)];
    D.benchAB = out;
    const el = C.$("benchres");
    el.hidden = false;
    el.innerHTML = abHTML(out[0], out[1]) + `<div class="bacts"><button class="btn" data-bcopy>Kopiuj wyniki</button></div>`;
    el.querySelector("[data-bcopy]").onclick = async () => { try { await navigator.clipboard.writeText(abText(out[0], out[1])); C.toast("Wyniki skopiowane — wklej je w rozmowie", 3000); } catch { C.toast("Nie udało się skopiować", 3000); } };
    C.openSettings("benchres");
  }
  abResume();
  /** What weighs on the map: the layers' test (bench.js layerCost), its cards and the text to paste. */
  async function runLayers() {
    let bar = C.$("benchbar");
    if (!bar) { bar = document.createElement("div"); bar.id = "benchbar"; document.body.append(bar); }
    bar.hidden = false;
    bar.innerHTML = `<div><b>Test: co obciąża mapę</b><small>nie dotykaj ekranu</small><span id="benchstep">przygotowuję…</span></div><button class="btn" id="benchstop">Przerwij</button>`;
    C.$("benchstop").onclick = () => { C.benchStop(); C.$("benchstep").textContent = "kończę…"; };
    let R = null;
    try { R = await C.layerCost((t) => { const el = C.$("benchstep"); if (el) el.textContent = t; }); }
    catch (e) { C.toast("Test się nie udał: " + (e?.message || e), 5000); }
    bar.hidden = true;
    const el = C.$("benchres");
    if (R) {
      el.hidden = false;
      el.innerHTML = layersHTML(R) + `<div class="bacts"><button class="btn" data-bcopy>Kopiuj wyniki</button></div>`;
      el.querySelector("[data-bcopy]").onclick = async () => { try { await navigator.clipboard.writeText(layersText(R)); C.toast("Wyniki skopiowane — wklej je w rozmowie", 3000); } catch { C.toast("Nie udało się skopiować", 3000); } };
    }
    C.openSettings("benchres");
  }
  C.$("benchlayers").onclick = runLayers;
  C.$("benchab").onclick = abStart;
  C.$("benchquick").onclick = () => runBench("quick");
  C.$("benchfull").onclick = () => runBench("full");
  C.$("diagcopy").onclick = async () => {
    const t = C.$("diag").hidden ? await report(C.view, { result: state.result, settings: state.settings }) : C.$("diag").textContent;
    try { await navigator.clipboard.writeText(t); C.toast("Raport skopiowany — wklej go w rozmowie", 3000); }
    catch { C.$("diag").hidden = false; C.$("diag").textContent = t; getSelection().selectAllChildren(C.$("diag")); C.toast("Zaznaczyłem raport — skopiuj go", 3000); }
  };
}
