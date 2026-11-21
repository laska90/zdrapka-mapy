// the settings page: a list in groups (Konto i dane, Wyjścia, Wycieczki, Mapa, Pomoc), each row its name and its state
// in a word; the details on pages of their own (Garmin, Kopia zapasowa, Pociąg do domu, Test płynności, Raport,
// O aplikacji); removing all outings at the bottom of Kopia zapasowa
// (moved out of app.js: what it needs of the app comes in C, see createX in app.js)
import { state } from "./state.js";
import { askNotifications, configureBackground } from "./native.js";
import { fmtDate } from "./labels.js";

const DAYS = ["niedziela", "poniedziałek", "wtorek", "środa", "czwartek", "piątek", "sobota"];
/** "2 h temu", "3 dni temu" (a moment back from now). */
export function ago(t, now = Date.now()) {
  const m = Math.max(0, Math.round((now - t) / 60000));
  if (m < 2) return "przed chwilą";
  if (m < 60) return `${m} min temu`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h temu`;
  const d = Math.round(h / 24);
  return d === 1 ? "wczoraj" : `${d} dni temu`;
}

export function createSettings(C) {
  let version = null, gcRenew = false, gcDays = 365;
  fetch("version.json", { cache: "no-store" }).then((r) => r.json()).then((j) => { version = j.version; }).catch(() => { version = "web"; });
  const set = (id, t, cls = null) => { const el = C.$(id); if (!el) return; el.textContent = t; if (cls !== null) el.className = cls; };
  function renderSettings() {
    const S = state.settings, me = C.account?.();
    // Konto i dane
    set("srAcct", me ? me.name || me.email : "Konto"); set("srAcctS", me ? me.email : "nie zalogowano");
    const a = S.bkpAuto, cloud = me && S.cloudBk?.on;
    set("srBkp", [a ? `co tydzień${a.last ? ` · ostatnia ${fmtDate(a.last)}` : ""}` : "", cloud ? "na serwerze" : ""].filter(Boolean).join(" · ") || "ręcznie");
    set("srCloud", !me ? "wymaga konta" : cloud ? "włączona" : "wyłączona");
    // Garmin: a word in the row, the whole state on its page; Garmin Connect first, intervals.icu only while it is set
    const gc = S.gc, icu = S.icu, src = gc?.key ? gc : icu;
    set("srGar", !src?.key ? "nie połączono" : src.error ? "problem z połączeniem" : src.last ? `połączono · ${ago(src.last)}` : "połączono", !src?.key ? "" : src.error ? "bad" : "ok");
    const gcOpen = !gc?.key || gcRenew;
    set("gcstatus", gc?.key ? C.gcStatus() : "Nie połączono.");
    C.$("gcform").hidden = !gcOpen; C.$("gcsave").hidden = !gcOpen; C.$("gchelp").hidden = !gcOpen;
    C.$("gcsync").hidden = !gc?.key || gcRenew; C.$("gcnew").hidden = !gc?.key || gcRenew; C.$("gcoff").hidden = !gc?.key || gcRenew;
    if (gcOpen && !gcRenew) C.$("gckey").value = "";
    C.$("icugrp").hidden = !icu?.key;
    set("icuhead", "intervals.icu");
    C.$("icustatus").textContent = C.icuStatus();
    C.$("icuform").hidden = !!icu?.key && !icu.error;
    C.$("icusave").hidden = !!icu?.key && !icu.error; C.$("icuhelp").hidden = !!icu?.key && !icu.error;
    C.$("icusync").hidden = !icu?.key; C.$("icuoff").hidden = !icu?.key;
    C.$("icukey").value = icu?.key || "";
    // Wycieczki: the reminder (a day and an hour), the train home
    const trip = S.trip || {}, on = trip.note !== false, day = trip.day ?? 5, at = trip.at || "17:00";
    C.$("tripnote").checked = on; C.$("tripwhen").hidden = !on;
    set("srTrip", on ? `${DAYS[day]} ${at}` : "wyłączone");
    C.$("triptime").value = at;
    C.$("tripday").querySelectorAll("[data-day]").forEach((b) => b.classList.toggle("on", +b.dataset.day === day));
    C.$("home1").value = S.home?.a || ""; C.$("home2").value = S.home?.b || ""; C.homeStatus();
    set("srTrain", S.home?.a ? S.home.a + (S.home.b ? ` · ${S.home.b}` : "") : "nie ustawiono");
    // Mapa: the maps on the phone (where the app keeps them)
    const mr = C.$("maprow");
    C.$("srMapsH").hidden = C.$("srMapsG").hidden = !!mr?.hidden;
    set("srMaps", C.$("mcnt")?.textContent ? `${C.$("mcnt").textContent} w telefonie` : "");
    // Pomoc
    const h = C.benchHistory?.() || [], last = h.at(-1);
    set("srBench", last ? `${last.at.slice(8, 10)}.${last.at.slice(5, 7)} · ${last.version}` : "jeszcze nie");
    const snap = String(C.view.meta?.snapshot || ""), date = (/(\d{4})-(\d\d)-(\d\d)/.exec(snap) || []).slice(1).reverse().join(".");
    set("srAbout", [version, date ? `mapy ${date}` : ""].filter(Boolean).join(" · "));
    set("aboutver", version || "-"); set("aboutmap", snap || "-");
    C.$("about").innerHTML = (C.view.meta?.attribution || []).join("<br>");
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
  // Garmin Connect: the key made on Garmin Connect web (shown once there), its validity picked with it
  C.$("gcvalid").onclick = (e) => {
    const b = e.target.closest("[data-d]");
    if (!b) return;
    gcDays = +b.dataset.d;
    C.$("gcvalid").querySelectorAll("[data-d]").forEach((x) => x.classList.toggle("on", x === b));
  };
  C.$("gcsave").onclick = async () => {
    const key = C.$("gckey").value.trim();
    if (!key) return;
    const old = state.settings.gc || {};
    state.settings.gc = { since: old.since, seen: old.seen, key, until: Date.now() + gcDays * 86_400_000, error: null };
    gcRenew = false;
    C.saveSettings();
    askNotifications();
    C.drawer(false);
    await C.sync();
  };
  C.$("gcsync").onclick = async () => { C.$("gcstatus").textContent = "Sprawdzam…"; await C.sync(); renderSettings(); };
  C.$("gcnew").onclick = () => { gcRenew = true; C.$("gckey").value = ""; renderSettings(); C.$("gckey").focus(); };
  C.$("gcoff").onclick = () => {
    if (!confirm("Odłączyć Garmina? Wyjścia, które już są, zostaną.")) return;
    state.settings.gc = null; C.saveSettings(); configureBackground(state.settings); renderSettings();
  };
  // back from Garmin's page with the key copied: it goes into the field by itself (when the phone lets the app read it)
  document.addEventListener("visibilitychange", async () => {
    if (document.visibilityState !== "visible" || C.$("setgar")?.hidden || C.$("gcform").hidden || C.$("gckey").value) return;
    try {
      const t = (await navigator.clipboard?.readText?.())?.trim();
      if (t && t.length >= 20 && t.length <= 400 && !/\s/.test(t)) C.$("gckey").value = t;
    } catch { /* not allowed: pasted by hand */ }
  });
  C.$("icusync").onclick = async () => { C.$("icustatus").textContent = "Sprawdzam…"; await C.sync(); renderSettings(); };
  C.$("icuoff").onclick = () => {
    if (!confirm("Odłączyć Garmina? Wyjścia, które już są, zostaną.")) return;
    state.settings.icu = null; C.saveSettings(); configureBackground(state.settings); renderSettings();
  };
  C.$("tripday").onclick = (e) => {
    const b = e.target.closest("[data-day]");
    if (!b) return;
    state.settings.trip = { ...(state.settings.trip || {}), day: +b.dataset.day }; C.saveSettings(); renderSettings(); C.tripReminder();
  };
  C.$("clearall").onclick = async () => {
    if (!confirm("Usunąć wszystkie wyjścia z tego urządzenia?")) return;
    C.busy("Czyszczę…");
    try { C.render((await C.call("clear", { settings: state.settings })).result); renderSettings(); C.view.fitRegion(); C.view.draw(); } finally { C.idle(); }
  };
  // a row with its own page (or another page of the menu: Konto, Mapy)
  C.$("drawer").addEventListener("click", (e) => { const p = e.target.closest("[data-sp]")?.dataset.sp; if (p) C.drawer(p, { push: true }); });
  // the pages of the settings refresh their rows when Back brings the list again
  const SUB = { icurow: "setgar", homerow: "settrain", triprow: "setp", benchres: "setbench", diag: "setdiag" };
  /** Settings, or one of its pages for a row asked for by its old place (icurow: Garmin...); focus: its first field. */
  function openSettings(row = null, focus = false) {
    const page = SUB[row] || "setp";
    if (page !== "setp") { C.drawer("setp"); C.drawer(page, { push: true }); renderSettings(); } else C.drawer("setp");
    if (row) requestAnimationFrame(() => { const el = C.$(row); if (page === "setp") el?.scrollIntoView({ block: "start" }); if (focus) C.$(page)?.querySelector("input")?.focus(); });
  }
  return { openSettings, renderSettings };
}
