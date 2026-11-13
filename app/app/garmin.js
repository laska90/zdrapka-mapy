// Garmin through intervals.icu: connecting, fetching new outings every 10 min, the heights pass-back
// (moved out of app.js: what it needs of the app comes in C, see createX in app.js)
import { fmtDate, plural, shortName } from "./labels.js";
import { configureBackground, isNative, nativeHttp } from "./native.js";
import { authHeader, fetchHttp, fetchNew, fileUrl, unpackFile } from "../core/intervals.js";
import { state } from "./state.js";

export function createGarmin(C) {
  let syncing = false;
  const SYNC_EVERY = 10 * 60_000;

  function icuStatus() {
    const icu = state.settings.icu;
    C.$("syncbtn").hidden = !icu?.key;
    if (!icu?.key) return "Nie połączono.";
    if (icu.error) return `Problem: ${icu.error}`;
    if (!icu.last) return "Połączono.";
    let t = `Połączono. Ostatnio sprawdzone ${new Date(icu.last).toLocaleString("pl-PL", { dateStyle: "short", timeStyle: "short" })}.`;
    const i = icu.info;
    if (i) {
      if (!i.listed) t += " intervals.icu nie ma jeszcze żadnych aktywności z ostatniego roku — sprawdź tam, czy Garmin jest połączony, i w ustawieniach Garmina użyj „Download old data”.";
      else {
        t += ` intervals.icu: ${plural(i.listed, "aktywność", "aktywności", "aktywności")} z ostatniego roku`;
        if (i.newest) t += `, najnowsza z ${fmtDate(i.newest)}`;
        t += ".";
        if (i.strava) t += ` ${i.strava} pochodzi ze Stravy — tych API intervals.icu nie udostępnia (połącz w intervals.icu Garmina bezpośrednio).`;
      }
    }
    return t;
  }

  function syncError(e) {
    if (e.status === 401 || e.status === 403) return "intervals.icu nie przyjął klucza — sprawdź, czy jest skopiowany w całości.";
    if (e.status === 429) return "intervals.icu prosi o chwilę przerwy, spróbuję później.";
    if (e.status) return `intervals.icu odpowiedział błędem ${e.status}.`;
    if (!isNative() && e instanceof TypeError) return "przeglądarka nie może połączyć się z intervals.icu — automatyczne pobieranie działa w aplikacji na Androida.";
    return "brak połączenia z intervals.icu.";
  }

  async function sync({ quiet = false } = {}) {
    const icu = state.settings.icu;
    if (!icu?.key || syncing) return;
    syncing = true;
    C.$("syncbtn").classList.add("spin"); C.$("menubtn").classList.add("busy"); if (quiet) C.work("sync", "Sprawdzam Garmina…");
    try {
      const r = await fetchNew({
        key: icu.key, http: isNative() ? nativeHttp : fetchHttp, state: { since: icu.since, seen: icu.seen },
        onProgress: (p) => { if (!quiet) C.toast(`Pobieram z Garmina… ${p.n}/${p.of}`, 60000); },
      });
      let msg = null;
      if (r.files.length) {
        const before = new Set(Object.keys(state.result?.found || {}));
        const res = await C.call("import", { files: r.files, settings: state.settings });
        const shown = await C.renderNew(res.result);
        if (res.added.length && !shown) {
          const names = Object.entries(res.result.found || {}).filter(([id, f]) => f.n && !before.has(id)).map(([, f]) => shortName(f.n));
          const km = res.added.reduce((s, a) => s + a.km, 0);
          msg = `${res.added.length === 1 ? `Nowe wyjście: ${res.added[0].name || "z Garmina"}` : `Nowe wyjścia: ${res.added.length}`} · ${C.nf(km)} km` + (names.length ? ` · odkryto: ${names.slice(0, 4).join(", ")}${names.length > 4 ? "…" : ""}` : "");
        }
      }
      state.settings.icu = { ...icu, since: r.since, seen: r.seen, last: Date.now(), error: null, info: r.info };
      C.saveSettings();
      configureBackground(state.settings.icu);
      if (msg) C.toast(msg, 9000);
      else if (!quiet) C.toast(r.info.listed ? "Nic nowego z Garmina." : "intervals.icu nie ma jeszcze aktywności — szczegóły w ustawieniach.", 6000);
    } catch (e) {
      console.warn("sync", e);
      state.settings.icu = { ...icu, error: syncError(e) };
      C.saveSettings();
      if (!quiet) C.toast("Nie udało się pobrać: " + state.settings.icu.error, 8000);
    } finally {
      syncing = false; C.work("sync");
      C.$("syncbtn").classList.remove("spin"); C.$("menubtn").classList.remove("busy");
      C.$("icustatus").textContent = icuStatus();
    }
  }
  C.$("syncbtn").onclick = () => { C.drawer(false); sync(); };

  /** Outings stored before elevations were kept: the ones from intervals.icu are downloaded
   * again (quietly, once per start); the rest come back with the next Garmin export import. */
  async function refillElevations({ quiet = true } = {}) {
    const icu = state.settings.icu, todo = (state.result?.activities || []).filter((a) => !a.ele && String(a.id).startsWith("icu-"));
    if (!icu?.key || !todo.length || syncing) return 0;
    syncing = true;
    const http = isNative() ? nativeHttp : fetchHttp, headers = { Authorization: authHeader(icu.key) }, files = [];
    try {
      let n = 0;
      for (const a of todo) {
        if (!quiet) C.toast(`Uzupełniam przewyższenia… ${++n}/${todo.length}`, 60000);
        try {
          const { ext, bytes } = await unpackFile(await http(fileUrl(a.id.slice(4)), { headers, as: "bytes" }));
          if (ext) files.push({ name: `${a.id}.${ext}`, id: a.id, bytes });
        } catch (e) { if (e.status !== 404) throw e; }
      }
      if (files.length) { const r = await C.call("import", { files, settings: state.settings }); C.render(r.result); C.toast(`Uzupełnione przewyższenia: ${plural(r.refreshed, "wyjście", "wyjścia", "wyjść")}`, 5000); }
      return files.length;
    } catch (e) { console.warn("elevations", e); if (!quiet) C.toast("Nie udało się pobrać: " + syncError(e), 7000); return 0; }
    finally { syncing = false; C.renderSettings(); }
  }
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && state.result && Date.now() - (state.settings.icu?.last || 0) > SYNC_EVERY) sync({ quiet: true });
  });

  return { icuStatus, refillElevations, sync };
}
