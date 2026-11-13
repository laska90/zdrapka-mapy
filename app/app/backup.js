// The backup: plans, every outing (from Garmin, from a file, added by hand: each marked so), their names, the pace
// and the settings in one file (never the intervals.icu key). The outings' points small (core/trackcode.js).
// C: the app as these parts see it (ctx in app.js: every name read when used).
import { fmtDate, plural } from "./labels.js";
import { backupDir, isNative, native } from "./native.js";
import { state } from "./state.js";

export function createBackup(C) {
  const BKP_KEYS = /^(zdrapka\.(plans|active|lastRoute|pace|people)|scratchcard\.settings)$/; // (people: your friends' files, app/friends.js)
  /** What of the phone's own storage goes into a backup: {key: text} (never the intervals.icu key). */
  function backupLocal() {
    const local = {};
    for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (BKP_KEYS.test(k)) local[k] = localStorage.getItem(k); }
    if (local[C.SETTINGS_KEY]) { try { const st = JSON.parse(local[C.SETTINGS_KEY]); if (st.icu) delete st.icu.key; local[C.SETTINGS_KEY] = JSON.stringify(st); } catch { /* as it is */ } }
    return local;
  }
  /** One outing as in the backup (its points small), as text; null if it is gone. */
  async function backupAct(id) {
    const S = await import("./store.js"), a = await S.getActivity(id);
    if (!a) return null;
    const { encodeTrack } = await import("../core/trackcode.js"), { parts, ...rest } = a;
    return JSON.stringify({ ...rest, src: srcOf(a), z: await encodeTrack(parts) });
  }
  /** The backup's file, as text. */
  async function backupData() {
    const S = await import("./store.js");
    const local = backupLocal();
    const { encodeTrack } = await import("../core/trackcode.js");
    const acts = [];
    for (const a of await S.allActivities()) { const { parts, ...rest } = a; acts.push({ ...rest, src: srcOf(a), z: await encodeTrack(parts) }); }
    return JSON.stringify({ app: "zdrapka-gorska", v: 2, t: new Date().toISOString(), local, acts, titles: await S.allTitles() });
  }
  /** Where an outing came from: "garmin" (intervals.icu), "ręczne" (added by hand), "plik" (a Garmin or Strava export, a GPX). */
  const srcOf = (a) => (a.manual ? "ręczne" : String(a.id).startsWith("icu-") ? "garmin" : "plik");
  const stampOf = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  async function backupSave() {
    await shareBlob(new Blob([await backupData()], { type: "application/json" }), `zdrapka-kopia-${stampOf()}.json`, "Kopia zapasowa Zdrapki");
  }

  // ---- the automatic backup (the app): once a week into a folder picked once (on the phone or on Google Drive);
  // the newest four copies kept there
  const WEEK = 7 * 24 * 3600_000;
  const auto = () => state.settings.bkpAuto || null; // {name, last}
  function autoLine() {
    const el = C.$("bkpauto"); if (!el) return;
    el.hidden = !isNative();
    const a = auto(), st = C.$("bkpautost");
    C.$("bkpdir").textContent = a ? "Zmień folder" : "Kopia co tydzień";
    st.textContent = a ? `Co tydzień do: ${a.name}${a.last ? ` · ostatnio ${fmtDate(a.last)}` : ""}${a.err ? ` · problem: ${a.err}` : ""}` : "";
  }
  async function autoWrite(force = false) {
    const a = auto();
    if (!a || (!force && a.last && Date.now() - a.last < WEEK)) return;
    try {
      const s = await backupDir("status");
      if (!s?.name) { a.err = "brak dostępu do folderu, wybierz go jeszcze raz"; C.saveSettings(); autoLine(); return; }
      const d = new Date(), name = `zdrapka-kopia-${stampOf(d)}-${String(d.getHours()).padStart(2, "0")}${String(d.getMinutes()).padStart(2, "0")}.json`;
      await backupDir("write", { name, text: await backupData(), keep: 4 });
      a.last = Date.now(); a.name = s.name; delete a.err; C.saveSettings();
    } catch (e) { a.err = String(e?.message || e).slice(0, 80); C.saveSettings(); }
    autoLine();
  }
  async function pickFolder() {
    try {
      const r = await backupDir("pickDir");
      if (!r?.name) return;
      state.settings.bkpAuto = { name: r.name, last: 0 }; C.saveSettings();
      await autoWrite(true);
      if (auto()?.last) C.toast(`Kopia zapisana do: ${r.name}`, 3000);
    } catch (e) { if (!/cancel/i.test(String(e?.message || e))) C.toast("Nie udało się wybrać folderu: " + (e?.message || e), 5000); }
  }
  if (C.$("bkpdir")) C.$("bkpdir").onclick = pickFolder;
  autoLine();
  setTimeout(() => autoWrite(), 8000); // (after the start: not in its way)
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") autoWrite(); });
  async function backupLoad(file) {
    let data;
    try { data = JSON.parse(await file.text()); } catch { C.toast("To nie jest plik kopii Zdrapki", 5000); return; }
    if (data?.app !== "zdrapka-gorska") { C.toast("To nie jest plik kopii Zdrapki", 5000); return; }
    return backupMerge(data);
  }
  /** A backup (as the file has it) into this phone: the outings not here yet, plans by id, the rest; then the app again.
   * ask: false when already asked (the one on the server). -> false when declined. */
  async function backupMerge(data, { ask = true, label = "Wczytano kopię" } = {}) {
    const plans = (() => { try { return JSON.parse(data.local?.["zdrapka.plans"] || "[]"); } catch { return []; } })();
    // the outings: v2 every one (points small), v1 only the ones added by hand; those already here (the same id,
    // or the same start: the same outing from another source) are left as they are, never twice
    const S = await import("./store.js");
    const meta = await S.allMeta(), ids = new Set(meta.map((m) => m.id)), starts = meta.map((m) => m.start).filter((t) => t != null);
    const fresh = (a) => !ids.has(a.id) && !(a.start != null && starts.some((t) => Math.abs(t - a.start) < 90_000));
    const list = (data.acts || (data.manual || []).map((a) => ({ ...a, src: "ręczne" }))).filter(fresh);
    const by = (k) => list.filter((a) => (a.src || "ręczne") === k).length, parts = [["garmin", "z Garmina"], ["plik", "z plików"], ["ręczne", "ręcznych"]].filter(([k]) => by(k)).map(([k, t]) => `${by(k)} ${t}`);
    if (ask && !confirm(`Wczytać kopię z ${fmtDate(Date.parse(data.t))}? ${plural(plans.length, "plan", "plany", "planów")}, ${list.length ? `nowe wyjścia: ${parts.join(", ")}` : "żadnych nowych wyjść"}. Plany o tych samych nazwach zastąpi, reszty nie rusza.`)) return;
    // plans: merged by id (the ones only on this phone stay)
    let mine = []; try { mine = JSON.parse(localStorage.getItem("zdrapka.plans") || "[]"); } catch { /* none */ }
    const byId = new Map(mine.map((p) => [p.id, p])); for (const p of plans) byId.set(p.id, p);
    localStorage.setItem("zdrapka.plans", JSON.stringify([...byId.values()]));
    for (const [k, v] of Object.entries(data.local || {})) {
      if (k === "zdrapka.plans" || !BKP_KEYS.test(k)) continue;
      if (k === "zdrapka.people") { // friends: merged by id (the ones only on this phone stay)
        let here = []; try { here = JSON.parse(localStorage.getItem(k) || "[]"); } catch { /* none */ }
        const m = new Map(here.map((p) => [p.id, p])); try { for (const p of JSON.parse(v)) if (!m.has(p.id)) m.set(p.id, p); } catch { /* skip */ }
        localStorage.setItem(k, JSON.stringify([...m.values()])); continue;
      }
      if (k === C.SETTINGS_KEY) { try { const st = JSON.parse(v); st.icu = { ...(st.icu || {}), key: state.settings.icu?.key || "" }; localStorage.setItem(k, JSON.stringify(st)); } catch { /* skip */ } continue; }
      localStorage.setItem(k, v);
    }
    if (list.length) {
      const { decodeTrack } = await import("../core/trackcode.js");
      const out = [];
      for (const a of list) { const { z, src, ...rest } = a; out.push({ ...rest, parts: z ? await decodeTrack(z) : a.parts }); }
      await S.putActivities(out);
    }
    for (const t of data.titles || []) await S.setTitle(t.id, t.title);
    C.toast(label, 3000);
    setTimeout(() => location.reload(), 1200);
    return true;
  }
  C.$("bkpsave").onclick = () => backupSave().catch((e) => C.toast("Nie udało się zapisać kopii: " + (e?.message || e), 6000));
  C.$("bkpfile").onchange = (e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) backupLoad(f).catch((er) => C.toast("Nie udało się wczytać kopii: " + (er?.message || er), 6000)); };

  async function shareBlob(blob, name, title) {
    try {
      const n = isNative() ? await native() : null;
      if (n?.Filesystem && n?.Share) {
        const b64 = await new Promise((res) => { const fr = new FileReader(); fr.onload = () => res(String(fr.result).split(",")[1]); fr.readAsDataURL(blob); });
        const { uri } = await n.Filesystem.writeFile({ path: name, data: b64, directory: "CACHE" });
        await n.Share.share({ title, files: [uri] });
        return;
      }
      const file = new File([blob], name, { type: blob.type });
      if (navigator.canShare?.({ files: [file] })) { await navigator.share({ files: [file], title }); return; }
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob); a.download = name; document.body.append(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 10000);
    } catch (e) { if (e?.name !== "AbortError" && !/cancel/i.test(String(e?.message))) C.toast("Nie udało się udostępnić: " + (e?.message || e), 6000); }
  }

  return { shareBlob, backupAutoLine: autoLine, backupLocal, backupAct, backupMerge };
}
