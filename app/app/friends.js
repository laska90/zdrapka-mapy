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

const GICON = `<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="#4285F4" d="M22.5 12.3c0-.8-.1-1.5-.2-2.3H12v4.3h5.9a5 5 0 0 1-2.2 3.3v2.7h3.5c2.1-1.9 3.3-4.7 3.3-8z"/><path fill="#34A853" d="M12 23c3 0 5.4-1 7.2-2.7l-3.5-2.7c-1 .7-2.2 1-3.7 1-2.9 0-5.3-1.9-6.2-4.5H2.2v2.8A11 11 0 0 0 12 23z"/><path fill="#FBBC05" d="M5.8 14.1a6.6 6.6 0 0 1 0-4.2V7.1H2.2a11 11 0 0 0 0 9.8z"/><path fill="#EA4335" d="M12 5.4c1.6 0 3.1.6 4.2 1.7l3.1-3.1A11 11 0 0 0 2.2 7.1l3.6 2.8C6.7 7.3 9.1 5.4 12 5.4z"/></svg>`;
const MAILICON = `<svg viewBox="0 0 24 24" aria-hidden="true" style="fill:none;stroke:currentColor;stroke-width:1.8"><rect x="3" y="5.5" width="18" height="13" rx="2"/><path d="M3.5 7l8.5 6 8.5-6"/></svg>`;
const KEY = "zdrapka.people", MAX = 4; // friends compared at once (you and four: five colours); kept: any number
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

  // ---- Menu → Znajomi
  function renderPage() {
    const el = C.$("friendsp"); if (!el) return;
    const list = load(), me = C.account?.();
    let h = me
      ? `<div class="actrow"><button class="act toplan" data-invite><svg><use href="#i-share"/></svg><span>Zaproś znajomego</span></button><button class="act" data-add><svg><use href="#i-plus"/></svg><span>Dodaj z pliku</span></button></div>`
      : `<div class="acbtns"><button class="act acg" data-g>${GICON}<span>Zaloguj przez Google</span></button><button class="act" data-e>${MAILICON}<span>Zaloguj e-mailem</span></button></div>` +
        `<p class="for">albo bez konta</p><div class="actrow"><button class="act" data-share><svg><use href="#i-share"/></svg><span>Wyślij plik ze śladami</span></button><button class="act" data-add><svg><use href="#i-plus"/></svg><span>Dodaj z pliku</span></button></div>`;
    for (const p of list) {
      const sub = p.uid ? `${Math.round(p.km || 0)} km${paceNote(p)} · aktualne z ${fmtDate(p.sent)}` : `${Math.round(p.km || 0)} km${paceNote(p)} · ${me ? "z pliku, " : ""}${fmtDate(p.sent)}`;
      h += `<div class="frow" data-id="${esc(p.id)}"><span class="fname"><b>${esc(p.name)}</b><small>${sub}</small></span><button class="act amore" data-more aria-label="Więcej" aria-expanded="false"><svg><use href="#i-dots"/></svg></button></div>`;
      h += `<div class="fmore" data-for="${esc(p.id)}" hidden><button class="act" data-rename><span>Zmień imię</span></button><button class="act fdel" data-del><span>Usuń razem ze śladami</span></button></div>`;
    }
    for (const v of me ? waiting : []) {
      h += `<div class="frow finv"><span class="fname"><b>Zaproszenie<span class="ftag">czeka</span></b><small>wysłane ${fmtDate(v.created)}, ważne do ${fmtDate(v.expires)}</small></span><button class="act amore" data-cancel="${esc(v.id)}" aria-label="Anuluj zaproszenie"><svg><use href="#i-x"/></svg></button></div>`;
    }
    if (list.length > 1) h += `<button class="act fdel fall" data-delall><span>Usuń wszystkich znajomych</span></button>`;
    el.innerHTML = h;
    el.querySelector("[data-share]")?.addEventListener("click", shareMine);
    el.querySelector("[data-invite]")?.addEventListener("click", invite);
    el.querySelector("[data-g]")?.addEventListener("click", () => C.signInGoogle());
    el.querySelector("[data-e]")?.addEventListener("click", () => C.signInEmail());
    el.querySelectorAll("[data-cancel]").forEach((b) => (b.onclick = () => cancelInvite(b.dataset.cancel)));
    el.querySelector("[data-add]").onclick = () => C.$("friendfile").click();
    el.querySelectorAll(".frow[data-id]").forEach((r) => {
      const id = r.dataset.id, more = el.querySelector(`.fmore[data-for="${CSS.escape(id)}"]`);
      r.querySelector("[data-more]").onclick = (e) => { more.hidden = !more.hidden; e.currentTarget.setAttribute("aria-expanded", String(!more.hidden)); e.currentTarget.classList.toggle("on", !more.hidden); };
      more.querySelector("[data-rename]").onclick = () => { const p = load().find((q) => q.id === id), nm = (prompt("Imię", p?.name || "") || "").trim().slice(0, 30); if (nm) { save(load().map((q) => (q.id === id ? { ...q, name: nm } : q))); renderPage(); refresh(); } };
      more.querySelector("[data-del]").onclick = () => { const p = load().find((q) => q.id === id); if (!p || !confirm(p.uid ? `${p.name}: usunąć ze znajomych? Przestaniecie widzieć swoje ślady.` : `${p.name}: usunąć z telefonu razem ze śladami?`)) return; remove([id]); };
    });
    const all = el.querySelector("[data-delall]");
    if (all) all.onclick = () => { if (confirm(`Usunąć wszystkich znajomych (${list.length}) i ich ślady z telefonu?`)) remove(list.map((p) => p.id)); };
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
  // the map keeps its look (Zdrapka, Ślady, Mapa), only for all of you; nothing kept after the app closes
  let cmp = null; // ids on ("me" first unless taken off), in the order picked: the colours go by it; null when no friend is on
  const onMap = new Map(), loading = new Set(); // id -> {agg, found} (their lines matched on these maps; again after the app restarts)
  let meOn = true, picked = [], openList = false;
  // in the layers, under Nachylenie: "Znajomi" (only once there are some), a tap unfolds them, one under another, each with a switch
  function chips() {
    const box = C.$("lyPeople"), list = load();
    box.hidden = !list.length;
    if (!list.length) return;
    const btn = C.$("lyPplBtn"), el = box.querySelector(".lyplist");
    btn.setAttribute("aria-expanded", openList); el.hidden = !openList;
    box.querySelector(".lydots").innerHTML = picked.map((id, i) => `<i style="background:${FRIEND_COLORS[i]}"></i>`).join("");
    el.innerHTML = `<label class="lyprow">${dot(meOn ? ME_COLOR : "#b9b9b9", meOn)}<span>Ty</span><input class="sw" type="checkbox" data-id="me" ${meOn ? "checked" : ""}></label>` + list.map((p) => { const k = picked.indexOf(p.id); return `<label class="lyprow">${dot(k >= 0 ? FRIEND_COLORS[k] : "#b9b9b9", k >= 0)}<span>${esc(p.name)}</span><input class="sw" type="checkbox" data-id="${esc(p.id)}" ${k >= 0 ? "checked" : ""}></label>`; }).join("");
    el.querySelectorAll("input[data-id]").forEach((i) => (i.onchange = () => toggle(i.dataset.id)));
    btn.onclick = (e) => { e.stopPropagation(); openList = !openList; chips(); };
  }
  async function toggle(id) {
    if (id === "me") meOn = !meOn;
    else if (picked.includes(id)) picked = picked.filter((q) => q !== id);
    else if (picked.length >= MAX) { C.toast(`Naraz najwyżej ${MAX} znajomych`); chips(); return; }
    else { picked = [...picked, id]; if (C.view.mode === "map") C.setMode?.("trace"); } // (Mapa shows no one's traces: a friend switched on is to be seen)
    chips();
    const todo = picked.filter((q) => !onMap.has(q) && !loading.has(q));
    todo.forEach((q) => loading.add(q));
    if (todo.length) {
      // in the small pill (the map stays usable): each friend shows as soon as theirs are matched
      try {
        for (const q of todo) {
          const p = load().find((r) => r.id === q); if (!p) continue;
          C.work("friends", `Wczytuję ślady: ${p.name}`);
          const f = await decodeFriend(p.file);
          onMap.set(q, await C.call("friendOnMap", { lines: f.lines, settings: state.settings }, (pr) => C.work("friends", `Wczytuję ślady: ${p.name} ${Math.round((100 * pr.n) / (pr.of || 1))}%`)));
          if (picked.includes(q)) { cmp = [...(meOn ? ["me"] : []), ...picked.filter((r) => onMap.has(r))]; refresh(); }
        }
      } catch (e) { C.toast("Nie udało się: " + (e?.message || e), 5000); picked = picked.filter((q) => onMap.has(q) || !todo.includes(q)); chips(); }
      finally { todo.forEach((q) => loading.delete(q)); }
      if (!loading.size) C.work("friends");
    }
    cmp = picked.length || !meOn ? [...(meOn ? ["me"] : []), ...picked] : null;
    refresh();
  }
  function endCompare() { picked = []; meOn = true; cmp = null; kpiGroup.cs = null; C.view.setGroup(null); bar(); chips(); C.repaintPlan?.(); }
  function members() {
    if (!cmp) return [];
    const list = load(), res = state.result;
    return cmp.map((id) => {
      if (id === "me") return { id, me: true, name: "Ty", color: ME_COLOR, agg: (res?.agg || []).map(([k, , iv, , g]) => [k, iv, g]), found: Object.entries(res?.found || {}).filter(([, f]) => f.c === "peak").map(([fid, f]) => [fid, f.n, f.e, f.x, f.y]) };
      const p = list.find((q) => q.id === id), m = onMap.get(id);
      return p && m ? { id, name: p.name, color: FRIEND_COLORS[picked.indexOf(id)], agg: m.agg, found: m.found } : null;
    }).filter(Boolean);
  }
  function refresh() {
    if (!cmp) { endCompare(); return; }
    const ms = members();
    kpiGroup.cs = ms.length ? ms.map((m) => m.color) : null;
    C.view.setGroup(ms);
    bar(ms);
    C.repaintPlan?.();
  }
  /** The paces of those on the map (null when no friend is): each a curve and/or a norm. */
  function groupPaces() {
    if (!cmp?.length) return null;
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
  /** Who is on the map: their colours in a row under the top (a legend; a tap opens the layers, where they are picked). */
  function bar(ms = members()) {
    let el = C.$("fbar");
    if (!cmp || !ms.length || C.view.mode === "map") { el?.remove(); return; }
    if (!el) { el = document.createElement("div"); el.id = "fbar"; document.body.append(el); }
    el.innerHTML = ms.map((m) => `<button class="fchip" data-id="${esc(m.id)}">${dot(m.color)}${esc(m.name)}</button>`).join("");
    el.onclick = (e) => { e.stopPropagation(); C.$("layersbtn").click(); };
  }
  /** A card's lines on who of those compared has been here (a point, a trail: walked within ~16 px; a summit: on top). */
  function whoHere({ x, y, id = null }) {
    if (!cmp) return "";
    const ms = members();
    if (ms.length < 2) return "";
    const [lon, lat] = unprojector(C.view.meta)(x, y), near = C.view.groupAt(lon, lat);
    const rows = ms.map((m, i) => ({ m, here: (id && m.found.some((f) => f[0] === id)) || near.has(i) }));
    return `<div class="fwho">${rows.map(({ m, here }) => `<div class="${here ? "" : "no"}">${dot(m.color, here)}<b>${esc(m.name)}</b><span>${here ? "zdrapane" : "jeszcze nie"}</span></div>`).join("")}</div>`;
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
    setTimeout(() => syncFriends(fresh), fresh ? 500 : 20_000);
  }
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") syncFriends(); });
  invites();

  return { friendsOnAccount: onAccount, friendsSync: syncFriends, friendsOpenInvite: openInvite, renderFriendsPage: renderPage, friendsWhoHere: whoHere, friendsComparing: () => !!cmp, endCompare, friendsBar: () => bar(), groupPaces, groupCurve, takeFriendText: takeText };
}
