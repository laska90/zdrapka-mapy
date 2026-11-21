// Garmin: straight from Garmin Connect (the user's Personal API key, settings.gc) or, the older way and the
// fallback while it works, through intervals.icu (settings.icu); fetching new outings every 10 min, the heights pass-back
// (moved out of app.js: what it needs of the app comes in C, see createX in app.js)
import { fmtDate, plural, shortName } from "./labels.js";
import { configureBackground, isNative, nativeHttp } from "./native.js";
import { authHeader, fetchHttp, fetchNew, fileUrl, unpackFile } from "../core/intervals.js";
import { fetchNew as gcFetchNew } from "../core/gcpersonal.js";
import { state } from "./state.js";

export function createGarmin(C) {
  let syncing = false;
  const SYNC_EVERY = 10 * 60_000;

  const when = (t) => new Date(t).toLocaleString("pl-PL", { dateStyle: "short", timeStyle: "short" });
  const DAY = 86_400_000;

  /** Garmin Connect (own key): the state in a few facts. */
  function gcStatus() {
    const gc = state.settings.gc;
    if (!gc?.key) return "";
    const parts = [gc.error ? `Problem: ${gc.error}` : gc.last ? `Sprawdzone ${when(gc.last)}.` : "Połączono."];
    if (gc.until) parts.push(`Klucz ważny do ${fmtDate(gc.until)}.`);
    return parts.join(" ");
  }

  function icuStatus() {
    const icu = state.settings.icu;
    C.$("syncbtn").hidden = !icu?.key && !state.settings.gc?.key;
    if (!icu?.key) return "Nie połączono.";
    if (icu.error) return `Problem: ${icu.error}`;
    if (!icu.last) return "Połączono.";
    let t = `Połączono. Ostatnio sprawdzone ${when(icu.last)}.`;
    const i = icu.info;
    if (i) {
      if (!i.listed) t += " intervals.icu nie ma jeszcze żadnych aktywności z ostatniego roku — sprawdź tam, czy Garmin jest połączony, i w ustawieniach Garmina użyj „Download old data”.";
      else {
        if (i.newest) t += ` Najnowsza aktywność z ${fmtDate(i.newest)}.`;
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
  function gcError(e) {
    if (e.status === 401 || e.status === 403) return "Garmin nie przyjął klucza: wygasł albo nie jest skopiowany w całości.";
    if (e.status === 429) return "Garmin prosi o przerwę, spróbuję później.";
    if (e.status) return `Garmin odpowiedział błędem ${e.status}.`;
    if (!isNative() && e instanceof TypeError) return "przeglądarka nie łączy się z Garminem, pobieranie działa w aplikacji na Androida.";
    return "brak połączenia z Garminem.";
  }

  /** New files into the app: the message for the toast, or null. */
  async function take(files, from) {
    if (!files.length) return null;
    const before = new Set(Object.keys(state.result?.found || {}));
    const res = await C.call("import", { files, settings: state.settings });
    const shown = await C.renderNew(res.result);
    if (!res.added.length || shown) return null;
    const names = Object.entries(res.result.found || {}).filter(([id, f]) => f.n && !before.has(id)).map(([, f]) => shortName(f.n));
    const km = res.added.reduce((s, a) => s + a.km, 0);
    return `${res.added.length === 1 ? `Nowe wyjście: ${res.added[0].name || from}` : `Nowe wyjścia: ${res.added.length}`} · ${C.nf(km)} km` + (names.length ? ` · odkryto: ${names.slice(0, 4).join(", ")}${names.length > 4 ? "…" : ""}` : "");
  }

  async function syncGc(quiet) {
    const gc = state.settings.gc;
    const knownStarts = (state.result?.activities || []).map((a) => a.start).filter((t) => t != null);
    const r = await gcFetchNew({
      key: gc.key, http: isNative() ? nativeHttp : fetchHttp, knownStarts,
      state: { since: gc.since, seen: gc.seen, token: gc.token, tokenExp: gc.tokenExp },
      onProgress: (p) => { if (!quiet) C.toast(`Pobieram z Garmina… ${p.n}/${p.of}`, 60000); },
    });
    const msg = await take(r.files, "z Garmina");
    state.settings.gc = { ...state.settings.gc, since: r.since, seen: r.seen, token: r.token, tokenExp: r.tokenExp, last: Date.now(), error: null, info: r.info };
    return { msg, listed: r.info.listed };
  }

  async function syncIcu(quiet) {
    const icu = state.settings.icu;
    try {
      const r = await fetchNew({
        key: icu.key, http: isNative() ? nativeHttp : fetchHttp, state: { since: icu.since, seen: icu.seen },
        onProgress: (p) => { if (!quiet) C.toast(`Pobieram z Garmina… ${p.n}/${p.of}`, 60000); },
      });
      const msg = await take(r.files, "z Garmina");
      state.settings.icu = { ...icu, since: r.since, seen: r.seen, last: Date.now(), error: null, info: r.info };
      return { msg, listed: r.info.listed };
    } catch (e) {
      state.settings.icu = { ...icu, error: syncError(e) };
      throw Object.assign(e, { shown: state.settings.icu.error });
    }
  }

  /** An outing downloaded again from Garmin Connect (the one that started then): the old one out, the new one in.
   * Nothing found: the old one stays. */
  async function refetch(a) {
    const gc = state.settings.gc;
    if (!gc?.key || a.start == null || syncing) return;
    syncing = true;
    C.busy("Pobieram z Garmina…");
    try {
      const r = await gcFetchNew({ key: gc.key, http: isNative() ? nativeHttp : fetchHttp, at: a.start, state: { seen: gc.seen, since: gc.since, token: gc.token, tokenExp: gc.tokenExp } });
      state.settings.gc = { ...state.settings.gc, seen: r.seen, token: r.token, tokenExp: r.tokenExp };
      C.saveSettings();
      if (!r.files.length) { C.toast("Garmin nie ma tego wyjścia.", 6000); return; }
      state.selected = null; C.view.setHighlight(null); C.hideTip();
      await C.call("delete", { activity: a.id, settings: state.settings });
      const res = await C.call("import", { files: r.files, settings: state.settings });
      C.render(res.result);
      C.toast(res.added.length ? "Pobrane ponownie z Garmina." : "Garmin dał plik, ale bez śladu do zdrapania.", 6000);
    } catch (e) {
      console.warn("refetch", e);
      C.toast("Nie udało się pobrać: " + gcError(e), 8000);
    } finally { syncing = false; C.idle(); }
  }

  /** The key's end near (two weeks): once a day a word about it. */
  function keyReminder() {
    const gc = state.settings.gc;
    if (!gc?.key || !gc.until || gc.until - Date.now() > 14 * DAY || Date.now() - (gc.warned || 0) < DAY) return;
    state.settings.gc = { ...gc, warned: Date.now() };
    C.toast(`Klucz Garmina ważny do ${fmtDate(gc.until)}. Nowy: Ustawienia → Garmin.`, 9000);
  }

  async function sync({ quiet = false } = {}) {
    const S = state.settings;
    if ((!S.gc?.key && !S.icu?.key) || syncing) return;
    syncing = true;
    C.$("syncbtn").classList.add("spin"); C.$("menubtn").classList.add("busy"); if (quiet) C.work("sync", "Sprawdzam Garmina…");
    try {
      let r;
      if (S.gc?.key) {
        try { r = await syncGc(quiet); } catch (e) {
          console.warn("sync garmin", e);
          state.settings.gc = { ...state.settings.gc, error: gcError(e), ...(e.status === 401 || e.status === 403 ? { token: null } : {}) };
          if (!state.settings.icu?.key) throw Object.assign(e, { shown: state.settings.gc.error });
          r = await syncIcu(quiet); // the fallback while intervals.icu still gives Garmin's files
        }
      } else r = await syncIcu(quiet);
      C.saveSettings();
      configureBackground(state.settings);
      keyReminder();
      if (r.msg) C.toast(r.msg, 9000);
      else if (!quiet) C.toast(r.listed ? "Nic nowego z Garmina." : "Brak aktywności w Garminie.", 6000);
    } catch (e) {
      console.warn("sync", e);
      C.saveSettings();
      if (!quiet) C.toast("Nie udało się pobrać: " + (e.shown || gcError(e)), 8000);
    } finally {
      syncing = false; C.work("sync");
      C.$("syncbtn").classList.remove("spin"); C.$("menubtn").classList.remove("busy");
      C.renderSettings?.();
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
    const S = state.settings, last = S.gc?.key ? S.gc.last : S.icu?.last;
    if (document.visibilityState === "visible" && state.result && Date.now() - (last || 0) > SYNC_EVERY) C.whenCalm(() => sync({ quiet: true }), { after: 1500 }); // (back to the app: once the map is still)
  });

  return { gcStatus, icuStatus, refetch, refillElevations, sync };
}
