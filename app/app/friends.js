// Friends: their walked trails from a file they send (.zdrapka, core/groupcode.js), compared with yours on the
import { kpiGroup } from "./kpi.js";
// map when you ask for it (layers → Porównaj ze znajomymi) and only until you end it; nothing on by default.
// Menu → Znajomi: share your own file, add one, rename, recolour, delete (a friend and everything of theirs).
// Kept on this phone (localStorage "zdrapka.people", in the backup). Signed in (Konto): friends by an invite link,
// their files through the server (shares/<uid>, a small profiles/<uid> with its version: fetched only when newer),
// yours sent only when your trails changed (at most once a day) and only once you have a friend or an invite out.
import { decodeFriend, encodeFriend } from "../core/groupcode.js";
import { cloud } from "./cloud.js";
import { unprojector } from "../core/pack.js";
import { fmtDate, plural } from "./labels.js";
import { isNative, native } from "./native.js";
import { state } from "./state.js";
import { BADGES } from "../core/badges.js";
import { badgeSVG } from "./marks.js";

const KEY = "zdrapka.people", CREWS = "zdrapka.crews", MAX = 4; // up to four friends each in a colour; more: one crew layer
export const CROWD_COLOR = "#c2337a"; // a crew of more than four: all in one colour
export const ME_COLOR = "#6a3df0";
export const FRIEND_COLORS = ["#d63a8a", "#8a5a2b", "#6f8f1e", "#4a4f57"]; // (none of the trails' colours), given out by the group compared now

export function createFriends(C) {
  const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
  const load = () => { try { return JSON.parse(localStorage.getItem(KEY) || "[]"); } catch { return []; } };
  const save = (list) => { localStorage.setItem(KEY, JSON.stringify(list)); counts(); };
  const counts = () => { const n = load().length, el = C.$("fcnt"); if (el) el.textContent = n || ""; };
  const meId = () => { if (!state.settings.meId) { state.settings.meId = Math.random().toString(36).slice(2, 12); C.saveSettings(); } return state.settings.meId; };
  const paceNote = (p) => (p.paceN ? ` · tempo z ${plural(p.paceN, "wyjścia", "wyjść", "wyjść")}` : "");
  const dot = (c, on = true) => `<i class="fdot" style="${on ? `background:${c}` : `box-shadow:inset 0 0 0 2px ${c}`}"></i>`;

  // ---- your own file
  const myName = () => C.account?.()?.name || state.settings.meName || "";
  /** Your file (as text) and its km; null when nothing is walked yet. */
  async function myFile(name) {
    const { lines, km } = await C.call("shareLines");
    if (!lines.length) return null;
    const norm = C.paceNorm?.() || null, curve = C.paceCurve?.() || null;
    return { km, text: await encodeFriend({ id: meId(), name, km, lines, pace: norm || curve ? { norm, curve, n: norm?.n || 0 } : null }) };
  }
  async function shareMine() {
    let name = myName();
    if (!name) { name = (prompt("Jak masz na imię? (tak zobaczą Cię znajomi)") || "").trim().slice(0, 30); if (!name) return; state.settings.meName = name; C.saveSettings(); }
    C.busy("Przygotowuję Twoje ślady…");
    try {
      const f = await myFile(name);
      if (!f) { C.idle(); C.toast("Nie masz jeszcze zdrapanych szlaków", 4000); return; }
      const { text } = f;
      C.idle();
      await C.shareBlob(new Blob([text], { type: "application/octet-stream" }), `${name.replace(/[^\p{L}\p{N} _-]/gu, "") || "slady"}.zdrapka`, "Moje ślady w Zdrapce");
    } catch (e) { C.idle(); C.toast("Nie udało się przygotować śladów: " + (e?.message || e), 6000); }
  }

  // ---- a friend's file (or their own exports: a Strava zip, GPX)
  async function addFriend(f, { silent = false } = {}) {
    const list = load(), old = list.find((p) => p.id === f.id);
    if (f.id === meId()) { C.toast("To Twój własny plik", 4000); return false; }
    const km = Math.round(f.km || 0), ask = old
      ? `${f.name}: zaktualizować? ${km} km szlaków (było ${Math.round(old.km || 0)})${f.pace?.n ? `, tempo z ${f.pace.n} wyjść` : ""}.`
      : `${f.name}: dodać do znajomych? ${km} km szlaków${f.pace?.n ? `, tempo z ${f.pace.n} wyjść` : ""}.`; // (the name as it is: no declension to get wrong)
    if (!silent && !confirm(ask)) return false;
    const rec = { id: f.id, name: old?.name || f.name, sent: f.sent || Date.now(), km, paceN: f.pace?.n || 0, pace: f.pace || null, file: f.file };
    save(old ? list.map((p) => (p.id === f.id ? rec : p)) : [...list, rec]);
    onMap.delete(f.id);
    C.toast(old ? `Zaktualizowano: ${rec.name}` : `Dodano: ${rec.name}`, 3000);
    if (!C.$("friendsp").hidden) renderPage();
    if (!C.$("friendp")?.hidden && prof === f.id) renderProfile();
    return true;
  }
  async function takeText(text) {
    let f;
    try { f = await decodeFriend(text); } catch { C.toast("To nie jest plik ze śladami ze Zdrapki", 5000); return false; }
    return addFriend({ ...f, file: text });
  }
  async function takeFiles(files) {
    const own = files.filter((f) => /\.(zdrapka|json)$/i.test(f.name)), rest = files.filter((f) => !own.includes(f));
    for (const f of own) await takeText(await f.text());
    if (!rest.length) return;
    // someone without the app (an iPhone): their outings from a file, matched here; only what the file would hold is kept
    const name = (prompt("Czyje to wyjścia? (imię)") || "").trim().slice(0, 30);
    if (!name) return;
    C.busy("Czytam wyjścia…");
    try {
      const r = await C.call("friendFromFiles", { files: rest, settings: state.settings }, (p) => { C.$("loadmsg").textContent = p.stage === "match" ? `Dopasowuję do szlaków… ${p.n}/${p.of}` : `Czytam pliki… ${p.n || ""}`; });
      C.idle();
      if (!r.lines.length) { C.toast("W tych plikach nie ma śladów z tych map", 5000); return; }
      const id = `f-${Math.random().toString(36).slice(2, 10)}`, text = await encodeFriend({ id, name, km: r.km, lines: r.lines, pace: r.pace });
      await addFriend({ ...(await decodeFriend(text)), file: text });
    } catch (e) { C.idle(); C.toast("Nie udało się wczytać: " + (e?.message || e), 6000); }
  }
  C.$("friendfile").onchange = (e) => { const fs = [...(e.target.files || [])]; e.target.value = ""; if (fs.length) takeFiles(fs); };

  // opened with a file (a tap on the attachment: VIEW; or Udostępnij → Zdrapka: SEND): read it through the app
  async function incoming() {
    if (!isNative()) return;
    const n = await native().catch(() => null), reg = globalThis.Capacitor?.registerPlugin || globalThis.capacitorExports?.registerPlugin;
    const P = globalThis.Capacitor?.Plugins?.ZdrapkaOpen || (reg ? (incoming.p ||= reg("ZdrapkaOpen")) : null);
    if (!P?.readUri) return;
    const take = async (uri) => {
      if (!uri || !/^(content|file):/.test(uri) || take.last === uri) return;
      take.last = uri;
      try { const r = await P.readUri({ uri }); if (r?.text) await takeText(r.text); } catch (e) { C.toast("Nie udało się otworzyć pliku: " + (e?.message || e), 5000); }
    };
    const pending = async () => { try { const r = await P.pending?.(); if (r?.uri) await take(r.uri); } catch { /* none */ } };
    n?.App?.addListener("appUrlOpen", (e) => take(e?.url));
    n?.App?.getLaunchUrl?.().then((r) => take(r?.url)).catch(() => {});
    pending();
    document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") pending(); });
  }

  // ---- Menu → Znajomi: who (a tap: their profile, the switch: on the map), invite or swap files
  const pcolor = (id) => (picked.includes(id) ? colorOf(id) : FRIEND_COLORS[Math.max(0, load().findIndex((p) => p.id === id)) % FRIEND_COLORS.length]);
  const sw = (on, data) => `<input class="sw" type="checkbox" ${data} ${on ? "checked" : ""} aria-label="Na mapie">`;
  const facts = (p) => [`${Math.round(p.km || 0)} km`, p.st ? plural(p.st.peaks, "szczyt", "szczyty", "szczytów") : ""].filter(Boolean).join(" · ");
  function renderPage() {
    const el = C.$("friendsp"); if (!el) return;
    const list = load(), me = C.account?.();
    let h = `<div class="actrow"><button class="act toplan" data-invite><svg><use href="#i-share"/></svg><span>Zaproś</span></button><button class="act" data-share><svg><use href="#i-share"/></svg><span>Wyślij plik</span></button><button class="act" data-add><svg><use href="#i-plus"/></svg><span>Dodaj z pliku</span></button></div>`;
    if (list.length || waiting.length) h += `<h5 class="sec">Znajomi · ${list.length}</h5>`;
    for (const p of list) {
      h += `<div class="frow fp" data-id="${esc(p.id)}"><button class="fopen" data-open>${av(p, pcolor(p.id), " big")}<span class="fname"><b>${esc(p.name)}</b><small>${facts(p)}</small></span></button>${sw(picked.includes(p.id), `data-on="${esc(p.id)}"`)}<svg class="chev"><use href="#i-chev"/></svg></div>`;
    }
    for (const v of me ? waiting : []) {
      h += `<div class="frow fp finv"><i class="cav big more">?</i><span class="fname"><b>Zaproszenie</b><small>do ${fmtDate(v.expires)}</small></span><button class="act amore" data-cancel="${esc(v.id)}" aria-label="Anuluj zaproszenie"><svg><use href="#i-x"/></svg></button></div>`;
    }
    if (list.length > 1) h += `<button class="act fdel fall" data-delall><span>Usuń wszystkich znajomych</span></button>`;
    el.innerHTML = h;
    el.querySelector("[data-share]").onclick = shareMine;
    el.querySelector("[data-invite]").onclick = () => { if (C.account?.()) invite(); else { C.toast("Zaloguj się, żeby zaprosić", 3500); C.drawer("kontop", { push: true }); } };
    el.querySelector("[data-add]").onclick = () => C.$("friendfile").click();
    el.querySelectorAll("[data-cancel]").forEach((b) => (b.onclick = () => cancelInvite(b.dataset.cancel)));
    el.querySelectorAll(".frow[data-id]").forEach((r) => {
      const id = r.dataset.id;
      r.querySelector("[data-open]").onclick = () => openProfile(id);
      r.querySelector("[data-on]").onchange = async () => { await setCrew(picked.includes(id) ? picked.filter((x) => x !== id) : [...picked, id]); renderPage(); };
    });
    const all = el.querySelector("[data-delall]");
    if (all) all.onclick = () => { if (confirm(`Usunąć wszystkich znajomych (${list.length}) i ich ślady z telefonu?`)) remove(list.map((p) => p.id)); };
    // the peaks of those not yet counted (their lines matched once: kept with them)
    const todo = list.filter((p) => !p.st).map((p) => p.id);
    if (todo.length && !renderPage.busy) { renderPage.busy = true; (async () => { for (const id of todo) await ensure(id).catch(() => {}); })().finally(() => { renderPage.busy = false; if (!C.$("friendsp").hidden) renderPage(); }); }
  }
  /** A friend's lines matched on these maps (once a session; their facts kept with them). */
  const pending = new Map();
  function ensure(id) {
    if (onMap.has(id)) return Promise.resolve(onMap.get(id));
    if (pending.has(id)) return pending.get(id);
    const run = (async () => {
      const p = load().find((r) => r.id === id); if (!p) throw new Error("no friend");
      C.work("friends", `Wczytuję ślady: ${p.name}`);
      try {
        const f = await decodeFriend(p.file);
        const m = await C.call("friendOnMap", { lines: f.lines, settings: state.settings }, (pr) => C.work("friends", `Wczytuję ślady: ${p.name} ${Math.round((100 * pr.n) / (pr.of || 1))}%`));
        onMap.set(id, m);
        const st = { peaks: m.found.length, badges: m.badges || [], cmp: m.cmp || null };
        localStorage.setItem(KEY, JSON.stringify(load().map((q) => (q.id === id ? { ...q, st } : q))));
        return m;
      } finally { pending.delete(id); if (!pending.size) C.work("friends"); }
    })();
    pending.set(id, run);
    return run;
  }

  // ---- a friend's profile: on the map, their numbers, you and them, the badges side by side
  let prof = null;
  function openProfile(id) { prof = id; C.drawer("friendp", { push: true }); }
  function renderProfile() {
    const el = C.$("friendp"), p = load().find((q) => q.id === prof);
    if (!el) return;
    if (!p) { C.drawerBack?.(); return; }
    C.$("dtitle").textContent = p.name;
    const c = pcolor(p.id), st = p.st, on = picked.includes(p.id), mine = state.result?.badges || {}, theirs = new Set(st?.badges || []);
    const n = (v) => (v == null ? "…" : C.nf(v, 0));
    let h = `<div class="fhead">${av(p, c, " huge")}<span class="fname"><b>${esc(p.name)}</b><small>${fmtDate(p.sent)}${paceNote(p)}</small></span><button class="act amore" data-more aria-label="Więcej" aria-expanded="false"><svg><use href="#i-dots"/></svg></button></div>`;
    h += `<div class="fmore" hidden><button class="act" data-rename><span>Zmień imię</span></button><button class="act fdel" data-del><span>Usuń razem ze śladami</span></button></div>`;
    h += `<label class="act fon${on ? " on" : ""}"><span>Na mapie</span>${sw(on, "data-on")}</label>`;
    h += `<div class="tiles"><div class="tile"><b>${n(p.km)}</b><span>km szlaków</span></div><div class="tile"><b>${n(st?.peaks)}</b><span>szczytów</span></div><div class="tile"><b>${st ? BADGES.reduce((s, B) => s + B.list.filter((k) => theirs.has(`${B.id}:${k.n}`)).length, 0) : "…"}</b><span>z odznak</span></div></div>`;
    const k = st?.cmp;
    if (k && k.them + k.both + k.me >= 0.5) {
      const both = `linear-gradient(90deg,${c},${ME_COLOR})`, w = (v) => Math.max(0, v);
      h += `<h5 class="sec">Ty i ${esc(p.name)}</h5><div class="fsplit"><i style="flex:${w(k.them)};background:${c}"></i><i style="flex:${w(k.both)};background:${both}"></i><i style="flex:${w(k.me)};background:${ME_COLOR}"></i></div>`;
      const row = (bg, label, km) => `<div class="fkm"><i style="background:${bg}"></i><b>${label}</b><span>${C.nf(km, 0)} km</span></div>`;
      h += row(c, `Tylko ${esc(p.name)}`, k.them) + row(both, "Razem", k.both) + row(ME_COLOR, "Tylko Ty", k.me);
    }
    if (st) {
      const rows = BADGES.map((B) => ({ B, a: B.list.filter((q) => mine[`${B.id}:${q.n}`]).length, b: B.list.filter((q) => theirs.has(`${B.id}:${q.n}`)).length })).filter((r) => r.a || r.b);
      if (rows.length) h += `<h5 class="sec">Odznaki</h5>` + rows.map(({ B, a, b }) => `<div class="fbadge">${badgeSVG(B.id, 36, true)}<span class="bn">${B.name}</span><span class="fvs"><b style="color:${ME_COLOR}">${a}</b><b style="color:${c}">${b}</b><small>z ${B.list.length}</small></span><span class="fbars"><i style="width:${(100 * a) / B.list.length}%;background:${ME_COLOR}"></i><i style="width:${(100 * b) / B.list.length}%;background:${c}"></i></span></div>`).join("");
    }
    el.innerHTML = h;
    const more = el.querySelector(".fmore");
    el.querySelector("[data-more]").onclick = (e) => { more.hidden = !more.hidden; e.currentTarget.setAttribute("aria-expanded", String(!more.hidden)); e.currentTarget.classList.toggle("on", !more.hidden); };
    el.querySelector("[data-rename]").onclick = () => { const nm = (prompt("Imię", p.name) || "").trim().slice(0, 30); if (nm) { save(load().map((q) => (q.id === p.id ? { ...q, name: nm } : q))); renderProfile(); refresh(); } };
    el.querySelector("[data-del]").onclick = () => { if (!confirm(p.uid ? `${p.name}: usunąć ze znajomych? Przestaniecie widzieć swoje ślady.` : `${p.name}: usunąć z telefonu razem ze śladami?`)) return; remove([p.id]); C.drawerBack?.(); };
    el.querySelector("[data-on]").onchange = async () => { await setCrew(on ? picked.filter((x) => x !== p.id) : [...picked, p.id]); renderProfile(); };
    // their facts afresh once a session (your outings may have changed since)
    if (!onMap.has(p.id)) ensure(p.id).then(() => { if (prof === p.id && !C.$("friendp").hidden) renderProfile(); }).catch((e) => C.toast("Nie udało się: " + (e?.message || e), 5000));
  }
  function remove(ids) {
    const gone = load().filter((p) => ids.includes(p.id) && p.uid), u = C.account?.()?.uid;
    if (u && gone.length) cloud().then((c) => c.batch(gone.map((p) => ({ op: "del", path: `friendships/${pairId(u, p.uid)}` })))).catch((e) => C.toast("Nie udało się usunąć na serwerze: " + (e?.message || e), 5000));
    save(load().filter((p) => !ids.includes(p.id)));
    for (const id of ids) onMap.delete(id);
    picked = picked.filter((id) => !ids.includes(id)); ids.forEach((id) => onMap.delete(id));
    if (cmp) { cmp = picked.length || !meOn ? [...(meOn ? ["me"] : []), ...picked] : null; refresh(); }
    renderPage();
    C.toast(ids.length > 1 ? "Usunięto znajomych" : "Usunięto", 2500);
  }

  // ---- with friends on the map: picked by a tap on their chip in the layers (Ty and at most four more);
  // the map keeps its look (Zdrapka, Mapa), only for all of you; nothing kept after the app closes
  let cmp = null; // ids on ("me" first unless taken off), in the order picked: the colours go by it; null when no friend is on
  const onMap = new Map(); // id -> {agg, found} (their lines matched on these maps; again after the app restarts)
  let meOn = true, picked = [], openList = false;
  // in the layers, under Nachylenie: "Znajomi" (only once there are some), a tap unfolds them, one under another, each with a switch
  function chips() {
    const box = C.$("lyPeople"), list = load();
    box.hidden = !list.length;
    if (!list.length) return;
    const btn = C.$("lyPplBtn"), el = box.querySelector(".lyplist");
    btn.setAttribute("aria-expanded", openList); el.hidden = !openList;
    box.querySelector(".lydots").innerHTML = picked.slice(0, 5).map((id) => `<i style="background:${colorOf(id)}"></i>`).join("");
    el.innerHTML = `<label class="lyprow">${dot(meOn ? ME_COLOR : "#b9b9b9", meOn)}<span>Ty</span><input class="sw" type="checkbox" data-id="me" ${meOn ? "checked" : ""}></label>` + list.map((p) => { const k = picked.indexOf(p.id); return `<label class="lyprow">${dot(k >= 0 ? FRIEND_COLORS[k] : "#b9b9b9", k >= 0)}<span>${esc(p.name)}</span><input class="sw" type="checkbox" data-id="${esc(p.id)}" ${k >= 0 ? "checked" : ""}></label>`; }).join("");
    el.querySelectorAll("input[data-id]").forEach((i) => (i.onchange = () => toggle(i.dataset.id)));
    btn.onclick = (e) => { e.stopPropagation(); C.$("layersbtn").click(); sheet(); };
    el.hidden = true;
  }
  async function toggle(id) {
    if (id === "me") meOn = !meOn;
    else if (picked.includes(id)) picked = picked.filter((q) => q !== id);
    else { picked = [...picked, id]; if (C.view.mode === "map") C.setMode?.("fog"); } // (Mapa shows no one's traces: a friend switched on is to be seen)
    chips();
    const todo = picked.filter((q) => !onMap.has(q));
    // in the small pill (the map stays usable): each friend shows as soon as theirs are matched
    for (const q of todo) {
      try { await ensure(q); } catch (e) { C.toast("Nie udało się: " + (e?.message || e), 5000); picked = picked.filter((r) => r !== q); chips(); continue; }
      if (picked.includes(q)) { cmp = [...(meOn ? ["me"] : []), ...picked.filter((r) => onMap.has(r))]; refresh(); }
    }
    cmp = picked.length || !meOn ? [...(meOn ? ["me"] : []), ...picked] : null;
    refresh();
  }
  function endCompare() { picked = []; meOn = true; cmp = null; solo = false; kpiGroup.cs = null; C.view.setGroup(null); bar(); chips(); C.repaintPlan?.(); }
  function members() {
    if (!cmp) return [];
    const list = load(), res = state.result;
    return cmp.map((id) => {
      if (id === "me") return { id, me: true, name: "Ty", color: ME_COLOR, agg: (res?.agg || []).map(([k, , iv, , g]) => [k, iv, g]), found: Object.entries(res?.found || {}).filter(([, f]) => f.c === "peak").map(([fid, f]) => [fid, f.n, f.e, f.x, f.y]) };
      const p = list.find((q) => q.id === id), m = onMap.get(id);
      return p && m ? { id, name: p.name, color: colorOf(id), crowd: picked.length > MAX, agg: m.agg, found: m.found } : null;
    }).filter(Boolean);
  }
  function refresh() {
    if (!cmp) { endCompare(); return; }
    const ms = members();
    kpiGroup.cs = ms.length && !solo ? [...new Set(ms.map((m) => m.color))] : null;
    C.view.setGroup(ms);
    bar(ms);
    C.repaintPlan?.();
  }
  /** The paces of those on the map (null when no friend is): each a curve and/or a norm. */
  let solo = false; // the plan's time by your own pace though a crew is on (the plan's switch Ekipa / Ja)
  const paceSolo = () => solo;
  function setPaceSolo(v) { solo = !!v; refresh(); }
  /** f() reckoned with the pace switched to v (the other time, shown on the switch). */
  function withSolo(v, f) { const o = solo; solo = v; try { return f(); } finally { solo = o; } }
  function groupPaces() {
    if (!cmp?.length || solo || !picked.length) return null;
    const list = load();
    return cmp.map((id) => (id === "me" ? { curve: C.paceCurve(), norm: C.paceNorm() } : { curve: list.find((p) => p.id === id)?.pace?.curve || null, norm: list.find((p) => p.id === id)?.pace?.norm || null }));
  }
  /** The trip's one pace, for a plan sent to friends (core/planlink.js): per gradient class the slowest of you and
   * those on the map (no one on: you and all your friends), so everyone who opens it sees the same time. null: no
   * one's pace known. */
  function groupCurve() {
    const list = load(), ids = cmp?.length ? cmp : ["me", ...list.map((p) => p.id)];
    const all = ids.map((id) => (id === "me" ? C.paceCurve?.() : list.find((p) => p.id === id)?.pace?.curve)), cs = all.filter((c) => c?.r?.length);
    if (!cs.length) return null;
    const n = cs[0].r.length, ok = cs.filter((c) => c.r.length === n);
    // someone with no pace of their own (no outings yet) goes by the standard (1 on every gradient): never faster than that
    const none = all.length > ok.length;
    return ok[0].r.map((_, b) => Math.max(none ? 1 : 0, ...ok.map((c) => c.r[b])));
  }
  // ---- the crew: who of your friends is on the map, picked in one sheet (saved crews, all, or a few by hand)
  const colorOf = (id) => (picked.length > MAX ? CROWD_COLOR : FRIEND_COLORS[picked.indexOf(id)] || "#b9b9b9");
  const initial = (n) => esc(String(n || "?").trim().charAt(0).toUpperCase());
  const av = (p, c, cls = "") => `<i class="cav${cls}" style="background:${c}">${initial(p.name)}</i>`;
  const loadCrews = () => { try { return JSON.parse(localStorage.getItem(CREWS) || "[]"); } catch { return []; } };
  const saveCrews = (l) => localStorage.setItem(CREWS, JSON.stringify(l));
  const same = (a, b) => a.length === b.length && a.every((x) => b.includes(x));
  /** What is on now: a saved crew (its friends and whether you are in it), all, or the names picked by hand. */
  function current() {
    const list = load(), ids = picked.filter((id) => list.some((p) => p.id === id));
    if (!ids.length) return null;
    const crew = loadCrews().find((c) => same(c.ids.filter((id) => list.some((p) => p.id === id)), ids) && (c.me !== false) === meOn);
    if (crew) return { name: crew.name, crew };
    if (list.length > 1 && ids.length === list.length && meOn) return { name: "Wszyscy", all: true };
    const names = ids.map((id) => list.find((p) => p.id === id).name);
    return { name: names.length <= 2 ? names.join(", ") : `${names.slice(0, 2).join(", ")} +${names.length - 2}`, adhoc: true };
  }
  function stack(ids, n = 3) {
    const list = load(), ps = ids.map((id) => list.find((p) => p.id === id)).filter(Boolean);
    if (ps.length > MAX) return `<span class="cstk"><i class="cav" style="background:${CROWD_COLOR}">${ps.length}</i></span>`;
    return `<span class="cstk">${ps.map((p) => av(p, colorOf(p.id))).join("")}</span>`;
  }
  /** The crew's chip under the top: who, ▾ the sheet, ✕ off. */
  function bar() {
    let el = C.$("fbar");
    const cur = current();
    if (!cmp || !cur || C.view.mode === "map") { el?.remove(); return; }
    if (!el) { el = document.createElement("div"); el.id = "fbar"; document.body.append(el); }
    el.innerHTML = `<div class="crewchip"><button class="cmain" data-open>${stack(picked)}<b>${esc(cur.name)}</b><svg class="chev" viewBox="0 0 24 24"><path d="M6 9l6 6 6-6"/></svg></button><button class="cx" data-off aria-label="Bez znajomych"><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg></button></div>`;
    el.querySelector("[data-open]").onclick = (e) => { e.stopPropagation(); sheet(); };
    el.querySelector("[data-off]").onclick = (e) => { e.stopPropagation(); setCrew([]); };
  }
  /** Put exactly these friends on the map (me: you with them or not; left out: as you are). */
  async function setCrew(ids, me) {
    if (me !== undefined) meOn = me;
    const want = ids.filter((id) => load().some((p) => p.id === id));
    picked = picked.filter((id) => want.includes(id));
    for (const id of want) if (!picked.includes(id)) await toggle(id);
    if (!want.length) endCompare(); else { cmp = [...(meOn ? ["me"] : []), ...picked]; refresh(); }
    if (!C.$("crewsheet")?.hidden) sheet();
  }
  /** The sheet: everyone, you first, each on or off by a tap; the crews below (a tap puts one on, again takes it off;
   * held: rename, change who, delete); + Nowa ekipa. edit: a crew being made or changed ({id?, name, ids, me}). */
  function sheet(edit = null) {
    let el = C.$("crewsheet");
    if (!el) { el = document.createElement("div"); el.id = "crewsheet"; document.body.append(el); el.addEventListener("click", (e) => { if (e.target === el) el.hidden = true; }); }
    el.hidden = false;
    const list = load(), crews = loadCrews(), cur = current();
    const meLetter = myName() ? initial(myName()) : "Ty";
    const person = (key, name, color, on, letter) => `<button class="cppl${on ? " on" : ""}" data-p="${esc(key)}"><i class="cav big" style="background:${on ? color : "#c9c6cf"}">${letter}</i><span>${esc(name)}</span></button>`;
    if (edit) {
      // a crew: its name and who is in it (you too, or not)
      let h = `<div class="cpane"><i class="cgrab"></i><h3>${edit.id ? "Ekipa" : "Nowa ekipa"}</h3><input class="cname" maxlength="24" placeholder="Nazwa" value="${esc(edit.name || "")}"><div class="cgrid">`;
      h += person("me", "Ty", ME_COLOR, edit.me, meLetter);
      list.forEach((p, k) => { h += person(p.id, p.name, FRIEND_COLORS[k % FRIEND_COLORS.length], edit.ids.includes(p.id), initial(p.name)); });
      h += `</div><button class="cbtn" data-ok ${edit.ids.length ? "" : "disabled"}>Zapisz</button></div>`;
      el.innerHTML = h;
      const name = el.querySelector(".cname");
      el.querySelectorAll("[data-p]").forEach((b) => (b.onclick = () => {
        const id = b.dataset.p;
        if (id === "me") edit.me = !edit.me; else edit.ids = edit.ids.includes(id) ? edit.ids.filter((x) => x !== id) : [...edit.ids, id];
        sheet({ ...edit, name: name.value });
      }));
      el.querySelector("[data-ok]").onclick = async () => {
        const nm = name.value.trim().slice(0, 24);
        if (!nm) { name.focus(); return; }
        const c = { id: edit.id || Math.random().toString(36).slice(2, 9), name: nm, ids: edit.ids, me: edit.me };
        saveCrews(edit.id ? loadCrews().map((x) => (x.id === edit.id ? c : x)) : [...loadCrews(), c]);
        await setCrew(c.ids, c.me); sheet(); bar();
      };
      if (!edit.id && !edit.name) setTimeout(() => name.focus(), 50);
      return;
    }
    let h = `<div class="cpane"><i class="cgrab"></i><h3>Na mapie</h3><div class="cgrid">`;
    h += person("me", "Ty", ME_COLOR, meOn, meLetter);
    for (const p of list) h += person(p.id, p.name, colorOf(p.id), picked.includes(p.id), initial(p.name));
    h += `</div><p class="csep">Ekipy</p><div class="cchips">`;
    crews.forEach((c, k) => {
      const on = cur?.crew?.id === c.id, who = [...(c.me !== false ? ["me"] : []), ...c.ids.filter((id) => list.some((p) => p.id === id))].slice(0, 3);
      h += `<button class="cchip${on ? " on" : ""}" data-crew="${k}"><span class="cstk">${who.map((id) => `<i class="cav" style="background:${on ? (id === "me" ? ME_COLOR : colorOf(id)) : "#a7a3ae"}"></i>`).join("")}</span>${esc(c.name)}</button>`;
    });
    if (list.length > 1) h += `<button class="cchip${cur?.all ? " on" : ""}" data-all><span class="cstk"><i class="cav more">${list.length}</i></span>Wszyscy</button>`;
    h += `<button class="cchip add" data-new>+ Nowa ekipa</button></div>`;
    h += `<div class="cacts"><button class="act" data-friends><span>Znajomi</span><svg><use href="#i-chev"/></svg></button></div></div>`;
    el.innerHTML = h;
    const q = (s2) => el.querySelector(s2);
    el.querySelectorAll("[data-p]").forEach((b) => (b.onclick = async () => {
      const id = b.dataset.p;
      if (id === "me") {
        if (!picked.length) { b.classList.remove("nope"); void b.offsetWidth; b.classList.add("nope"); return; } // (you alone off: nothing to see)
        await toggle("me"); sheet(); bar(); return;
      }
      setCrew(picked.includes(id) ? picked.filter((x) => x !== id) : [...picked, id]);
    }));
    el.querySelectorAll("[data-crew]").forEach((b) => {
      const c = crews[+b.dataset.crew];
      let held = null, long = false;
      const menu = () => {
        long = true;
        const m = document.createElement("div"); m.className = "cmenu";
        m.innerHTML = `<b>${esc(c.name)}</b><button data-edit>Zmień nazwę i skład</button><button class="red" data-delcrew>Usuń ekipę</button>`;
        q(".cpane").append(m);
        m.querySelector("[data-edit]").onclick = () => sheet({ id: c.id, name: c.name, ids: [...c.ids], me: c.me !== false });
        m.querySelector("[data-delcrew]").onclick = () => { if (!confirm(`Usunąć ekipę ${c.name}?`)) return; saveCrews(loadCrews().filter((x) => x.id !== c.id)); sheet(); bar(); };
      };
      b.onpointerdown = () => { long = false; held = setTimeout(menu, 550); };
      b.onpointerup = b.onpointerleave = b.onpointercancel = () => clearTimeout(held);
      b.oncontextmenu = (e) => { e.preventDefault(); clearTimeout(held); if (!long) menu(); };
      b.onclick = () => { if (long) return; if (cur?.crew?.id === c.id) setCrew([], true); else setCrew(c.ids, c.me !== false); };
    });
    if (q("[data-all]")) q("[data-all]").onclick = () => (cur?.all ? setCrew([], true) : setCrew(list.map((p) => p.id), true));
    q("[data-new]").onclick = () => sheet({ name: "", ids: [...picked], me: meOn });
    q("[data-friends]").onclick = () => { el.hidden = true; C.drawer("friendsp"); };
  }
  /** A card's lines on who of those compared has been here (a point, a trail: walked within ~16 px; a summit: on top). */
  function whoHere({ x, y, id = null }) {
    if (!cmp) return "";
    const ms = members();
    if (ms.length < 2) return "";
    const [lon, lat] = unprojector(C.view.meta)(x, y), near = C.view.groupAt(lon, lat);
    const here = ms.filter((m, i) => (id && m.found.some((f) => f[0] === id)) || near.has(i));
    if (!here.length) return "";
    const vis = here.length > 6 ? here.slice(0, 5) : here;
    return `<div class="fwho2"><span class="cstk">${vis.map((m) => (m.me ? `<i class="cav" style="background:${ME_COLOR}">Ty</i>` : av(m, m.color))).join("")}${here.length > vis.length ? `<i class="cav more">+${here.length - vis.length}</i>` : ""}</span><b>${here.length <= 2 ? here.map((m) => esc(m.name)).join(" i ") : `Byli tu · ${here.length}`}</b></div>`;
  }
  C.$("layersbtn").addEventListener("click", () => setTimeout(chips));
  counts();
  incoming();
  // ---- through the server (signed in)
  const pairId = (a, b) => (a < b ? `${a}_${b}` : `${b}_${a}`);
  const LINK = "https://laska90.github.io/zdrapka-mapy/z/#";
  let waiting = [], lastSync = 0, pendingCode = null;
  const ms = (t) => (t?.toMillis ? t.toMillis() : +t || 0);
  /** Your file on the server: only when your trails (or your pace) changed, at most once a day (force: an invite). */
  async function sendMine(force = false) {
    const u = C.account?.(); if (!u) return;
    const res = state.result, sig = `${(res?.agg || []).length}|${Math.round((res?.coverage?.trails?.walkedKm || 0) * 10)}|${C.paceNorm?.()?.n || 0}`, last = state.settings.cloudShare || {};
    if (last.uid === u.uid && last.sig === sig) return;
    if (!force && last.uid === u.uid && Date.now() - (last.t || 0) < 20 * 3600_000) return;
    const name = myName() || u.email.split("@")[0], f = await myFile(name);
    if (!f) return;
    const c = await cloud(), ver = Date.now();
    await c.batch([{ op: "set", path: `shares/${u.uid}`, data: { j: f.text } }, { op: "set", path: `profiles/${u.uid}`, data: { name, km: Math.round(f.km), ver, sent: c.at(ver) } }]);
    state.settings.cloudShare = { uid: u.uid, sig, t: ver }; C.saveSettings();
  }
  /** Who your friends are now, their files when newer, your invites still out. At most every 6 h; force: every minute
   * (Znajomi opened), "now": at once (an invite just taken). */
  async function syncFriends(force = false) {
    const u = C.account?.(); if (!u) return;
    if (force !== "now" && Date.now() - lastSync < (force ? 60_000 : 6 * 3600_000)) return;
    if (syncFriends.run) return syncFriends.run;
    syncFriends.run = (async () => {
      const c = await cloud();
      const [fr, inv] = await Promise.all([c.where("friendships", "members", "array-contains", u.uid), c.where("invites", "owner", "==", u.uid)]);
      const now = Date.now(), others = fr.map((d) => d.members.find((m) => m !== u.uid)).filter(Boolean);
      waiting = inv.filter((v) => !v.usedBy && ms(v.expires) > now).map((v) => ({ id: v.id, created: ms(v.created), expires: ms(v.expires) }));
      const old = inv.filter((v) => v.usedBy || ms(v.expires) <= now);
      if (old.length) c.batch(old.map((v) => ({ op: "del", path: `invites/${v.id}` }))).catch(() => {});
      let list = load(), changed = false;
      for (const o of others) {
        const prof = await c.get(`profiles/${o}`).catch(() => null);
        if (!prof) continue;
        const here = list.find((p) => p.uid === o);
        if (here && here.ver === prof.ver && here.file) continue;
        const sh = await c.get(`shares/${o}`).catch(() => null);
        if (!sh?.j) continue;
        let f; try { f = await decodeFriend(sh.j); } catch { continue; }
        const rec = { id: `u-${o}`, uid: o, ver: prof.ver, name: here?.name || prof.name || f.name, sent: ms(prof.sent) || f.sent || now, km: Math.round(f.km || 0), paceN: f.pace?.n || 0, pace: f.pace || null, file: sh.j };
        list = here ? list.map((p) => (p.uid === o ? rec : p)) : [...list, rec];
        onMap.delete(rec.id); changed = true;
      }
      const gone = list.filter((p) => p.uid && !others.includes(p.uid));
      if (gone.length) { list = list.filter((p) => !gone.includes(p)); changed = true; }
      if (changed) save(list);
      lastSync = Date.now();
      if (others.length || waiting.length) sendMine().catch((e) => console.warn("share", e));
    })().catch((e) => console.warn("friends sync", e)).finally(() => { syncFriends.run = null; if (!C.$("friendsp").hidden) renderPage(); chips(); });
    return syncFriends.run;
  }
  async function invite() {
    const u = C.account?.(); if (!u) return;
    C.busy("Przygotowuję zaproszenie…");
    try {
      await sendMine(true);
      const c = await cloud(), b = crypto.getRandomValues(new Uint8Array(12)), A = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
      const code = [...b].map((x) => A[x % A.length]).join(""), now = Date.now();
      await c.set(`invites/${code}`, { owner: u.uid, name: myName() || u.email.split("@")[0], created: c.at(now), expires: c.at(now + 7 * 24 * 3600_000) });
      waiting = [...waiting, { id: code, created: now, expires: now + 7 * 24 * 3600_000 }];
      C.idle(); renderPage();
      await shareLink(`${LINK}${code}`);
    } catch (e) { C.idle(); C.toast("Nie udało się przygotować zaproszenia: " + (e?.message || e), 6000); }
  }
  async function shareLink(url) {
    const text = "Dołącz do moich znajomych w Zdrapce górskiej:";
    try {
      const n = isNative() ? await native() : null;
      if (n?.Share) { await n.Share.share({ title: "Zaproszenie do Zdrapki", text: `${text} ${url}`, dialogTitle: "Wyślij zaproszenie" }); return; }
      if (navigator.share) { await navigator.share({ title: "Zaproszenie do Zdrapki", text, url }); return; }
      await navigator.clipboard?.writeText(url); C.toast("Link skopiowany", 3000);
    } catch (e) { if (e?.name !== "AbortError" && !/cancel/i.test(String(e?.message))) C.toast("Nie udało się udostępnić: " + (e?.message || e), 5000); }
  }
  async function cancelInvite(code) {
    try { await (await cloud()).del(`invites/${code}`); waiting = waiting.filter((v) => v.id !== code); renderPage(); } catch (e) { C.toast("Nie udało się: " + (e?.message || e), 5000); }
  }
  /** An invite opened (zdrapka://invite?c=…, the web app's #invite=…): signed in, the card; else first Konto. */
  async function openInvite(code) {
    if (!code) return;
    const u = C.account?.();
    if (!u) { pendingCode = code; C.toast("Zaloguj się, żeby przyjąć zaproszenie", 4000); C.drawer("kontop"); return; }
    pendingCode = null;
    let v;
    try { v = await (await cloud()).get(`invites/${code}`); } catch (e) { C.toast("Nie udało się sprawdzić zaproszenia: " + (e?.message || e), 5000); return; }
    if (!v) { C.toast("Tego zaproszenia już nie ma", 4000); return; }
    if (v.owner === u.uid) { C.toast("To Twoje własne zaproszenie", 4000); return; }
    if (v.usedBy) { C.toast("To zaproszenie zostało już użyte", 4000); return; }
    if (ms(v.expires) < Date.now()) { C.toast("To zaproszenie wygasło: poproś o nowe", 4000); return; }
    if (load().some((p) => p.uid === v.owner)) { C.toast(`${v.name} już jest w Twoich znajomych`, 4000); return; }
    C.drawer(false);
    C.openTip(`<div class="acct"><span class="av" style="background:${FRIEND_COLORS[0]}">${esc((v.name || "?").charAt(0).toUpperCase())}</span><span><b>${esc(v.name)}</b><small>zaprasza Cię do znajomych</small></span></div>` +
      `<div class="actrow"><button class="act toplan" data-yes><span>Przyjmij</span></button><button class="act" data-no><span>Nie teraz</span></button></div>`, null, "invite", { label: "Zaproszenie" });
    const tip = C.$("tip");
    tip.querySelector("[data-no]").onclick = () => C.hideTip();
    tip.querySelector("[data-yes]").onclick = async () => {
      C.hideTip(); C.busy("Dodaję…");
      try {
        const c = await cloud(), [a, b] = [u.uid, v.owner].sort();
        await c.batch([{ op: "update", path: `invites/${code}`, data: { usedBy: u.uid } }, { op: "set", path: `friendships/${a}_${b}`, data: { members: [a, b], since: c.at(Date.now()), invite: code } }]);
        await sendMine(true).catch(() => {});
        await syncFriends("now");
        C.idle(); C.toast(`Dodano: ${v.name}`, 3000);
      } catch (e) { C.idle(); C.toast("Nie udało się przyjąć: " + (e?.message || e), 6000); }
    };
  }
  async function invites() {
    const code = (url) => { const m = /(?:zdrapka:\/\/invite\?c=|[#&]invite=)([A-Za-z0-9]{8,32})/.exec(url || ""); return m?.[1] || null; };
    if (/#invite=/.test(location.hash)) { const c = code(location.hash); history.replaceState(null, "", location.pathname + location.search); setTimeout(() => openInvite(c), 1500); }
    const n = await native().catch(() => null);
    if (!n?.App) return;
    let last = null;
    const take = (url) => { const c = code(url); if (c && c !== last) { last = c; setTimeout(() => openInvite(c), 600); } };
    n.App.addListener("appUrlOpen", (e) => take(e?.url));
    n.App.getLaunchUrl?.().then((r) => take(r?.url)).catch(() => {});
  }
  function onAccount(u, fresh) {
    if (!u) { waiting = []; if (!C.$("friendsp").hidden) renderPage(); return; }
    if (pendingCode) { openInvite(pendingCode); return; }
    if (fresh) setTimeout(() => syncFriends(fresh), 500); else C.whenCalm(() => syncFriends(fresh), { after: 20_000 }); // (a fresh sign-in at once; else when the map is still)
  }
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") C.whenCalm(() => syncFriends(), { after: 1500 }); });
  invites();

  return { renderFriendPage: renderProfile, friendsOnAccount: onAccount, friendsSync: syncFriends, friendsOpenInvite: openInvite, renderFriendsPage: renderPage, friendsWhoHere: whoHere, friendsComparing: () => !!cmp, endCompare, friendsBar: () => bar(), friendsSheet: () => sheet(), paceSolo, setPaceSolo, withSolo, groupPaces, groupCurve, takeFriendText: takeText };
}
