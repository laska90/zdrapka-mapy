// The backup on the server (Konto: only if you want it; only you can read it). Small documents, sent only when
// they change: users/<uid>/acts/<id> one outing each (written once: an outing does not change), users/<uid>/data/<key>
// the plans, the settings, the friends, the titles, users/<uid> a head {acts, t}. The phone remembers what it sent
// (a short sum per document) and sends only the difference, a while after a change, never on every tap.
import { cloud } from "./cloud.js";
import { fmtDate } from "./labels.js";
import { state } from "./state.js";

const SENT = "zdrapka.cloudSent";
/** A short sum of a text (cyrb53): what was sent, without keeping it. */
export function sum(s) {
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  for (let i = 0; i < s.length; i++) { const c = s.charCodeAt(i); h1 = Math.imul(h1 ^ c, 2654435761); h2 = Math.imul(h2 ^ c, 1597334677); }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}
const actDoc = (uid, id) => `users/${uid}/acts/${encodeURIComponent(id)}`;
const dataDoc = (uid, k) => `users/${uid}/data/${k.replace(/[^\w.-]/g, "_")}`;

export function createCloudSync(C) {
  const cfg = () => state.settings.cloudBk || {}; // {on: true | false} (no "on": not asked yet)
  const loadSent = (uid) => { try { const s = JSON.parse(localStorage.getItem(SENT) || "null"); if (s?.uid === uid) return s; } catch { /* none */ } return { uid, acts: {}, data: {}, last: 0 }; };
  const saveSent = (s) => { try { localStorage.setItem(SENT, JSON.stringify(s)); } catch { /* full */ } };
  let running = null, timer = null, status = "";
  const uid = () => C.account?.()?.uid || null;
  const paint = () => C.renderAccountIfOpen?.();

  /** The friends' list for the server: the ones from the server without their files (they come again from it). */
  const peopleText = (v) => { try { return JSON.stringify(JSON.parse(v).map((p) => (p.uid ? { ...p, file: undefined, ver: undefined } : p))); } catch { return v; } };

  async function syncUp() {
    const u = uid();
    if (!u || cfg().on !== true) return;
    if (running) return running;
    running = (async () => {
      const S = await import("./store.js"), sent = loadSent(u), ops = [], after = { acts: { ...sent.acts }, data: { ...sent.data } };
      const local = C.backupLocal();
      delete local["zdrapka.pace"]; // (worked out again from the outings: ~50 kB, changes with every new one)
      local["zdrapka.titles"] = JSON.stringify(await S.allTitles());
      for (const [k, v0] of Object.entries(local)) {
        const v = k === "zdrapka.people" ? peopleText(v0) : v0, h = sum(v);
        if (sent.data[k] !== h) { ops.push({ op: "set", path: dataDoc(u, k), data: { k, j: v } }); after.data[k] = h; }
      }
      const meta = await S.allMeta(), here = new Set();
      for (const m of meta) {
        here.add(m.id);
        const h = sum(JSON.stringify(m));
        if (sent.acts[m.id] === h) continue;
        const j = await C.backupAct(m.id);
        if (j) { ops.push({ op: "set", path: actDoc(u, m.id), data: { j, s: h } }); after.acts[m.id] = h; }
      }
      for (const id of Object.keys(sent.acts)) if (!here.has(id)) { ops.push({ op: "del", path: actDoc(u, id) }); delete after.acts[id]; }
      if (!ops.length) return;
      status = "wysyłam…"; paint();
      const c = await cloud();
      ops.push({ op: "set", path: `users/${u}`, data: { acts: meta.length, t: c.at(Date.now()), v: 1 } });
      await c.batch(ops);
      saveSent({ uid: u, ...after, last: Date.now() });
    })().catch((e) => { console.warn("backup to the server", e); status = "nie udało się wysłać, spróbuję później"; })
      .finally(() => { running = null; if (status === "wysyłam…") status = ""; paint(); });
    return running;
  }
  /** Again in a while (a change: not at once, several changes go together). */
  function soon(ms = 90_000) { clearTimeout(timer); timer = setTimeout(syncUp, ms); }

  /** On the server already (another phone, before a new install): what is not here comes in. */
  async function restoreIfAny(u, asked = false) {
    const c = await cloud(), head = await c.get(`users/${u}`);
    if (!head?.acts) return false;
    const sent = loadSent(u);
    if (sent.last) return false; // (this phone sent it)
    const when = head.t?.toMillis ? fmtDate(head.t.toMillis()) : "";
    if (!asked && !confirm(`Na serwerze jest Twoja kopia${when ? ` z ${when}` : ""}: ${head.acts} wyjść. Wczytać to, czego nie ma na tym telefonie?`)) return false;
    C.busy("Pobieram kopię…");
    try {
      const [acts, data] = await Promise.all([c.list(`users/${u}/acts`), c.list(`users/${u}/data`)]);
      const local = {}; let titles = [];
      for (const d of data) { if (d.k === "zdrapka.titles") { try { titles = JSON.parse(d.j); } catch { /* none */ } } else if (d.k) local[d.k] = d.j; }
      const list = acts.map((d) => { try { return JSON.parse(d.j); } catch { return null; } }).filter(Boolean);
      // what came from the server counts as sent: not sent back
      saveSent({ uid: u, acts: Object.fromEntries(acts.map((d) => { try { return [JSON.parse(d.j).id, d.s]; } catch { return null; } }).filter(Boolean)), data: {}, last: Date.now() });
      C.idle();
      return await C.backupMerge({ app: "zdrapka-gorska", v: 2, t: new Date(head.t?.toMillis?.() || Date.now()).toISOString(), local, acts: list, titles }, { ask: false, label: "Wczytano kopię z serwera" });
    } catch (e) { C.idle(); C.toast("Nie udało się pobrać kopii: " + (e?.message || e), 6000); return false; }
  }

  async function setOn(on) {
    const u = uid(); if (!u) return;
    state.settings.cloudBk = { ...cfg(), on }; C.saveSettings(); paint();
    if (on) { if (!(await restoreIfAny(u))) await syncUp(); }
    else if (confirm("Usunąć też kopię, która już jest na serwerze?")) await wipe();
  }
  /** The backup off the server (the account stays). */
  async function wipe() {
    const u = uid(); if (!u) return;
    C.busy("Usuwam kopię z serwera…");
    try {
      const c = await cloud(), [acts, data] = await Promise.all([c.list(`users/${u}/acts`), c.list(`users/${u}/data`)]);
      await c.batch([...acts.map((d) => ({ op: "del", path: `users/${u}/acts/${d.id}` })), ...data.map((d) => ({ op: "del", path: `users/${u}/data/${d.id}` })), { op: "del", path: `users/${u}` }]);
      localStorage.removeItem(SENT);
      C.toast("Kopia usunięta z serwera", 3000);
    } catch (e) { C.toast("Nie udało się usunąć kopii: " + (e?.message || e), 6000); }
    C.idle(); paint();
  }
  /** Signed in (fresh: just now, by a tap): the question once, then what is on the server, then the difference. */
  function onAccount(u, fresh) {
    if (!u) { clearTimeout(timer); return; }
    if (cfg().on === undefined && fresh) { ask(); return; }
    if (cfg().on === true) soon(fresh ? 1000 : 15_000);
  }
  async function ask() {
    C.drawer(false);
    // a copy already there (another phone, a new install): one question, to bring it here (and keep it going)
    const u = uid(); let head = null;
    try { head = u && !loadSent(u).last ? await (await cloud()).get(`users/${u}`) : null; } catch { /* offline: the plain question */ }
    if (head?.acts) {
      const when = head.t?.toMillis ? fmtDate(head.t.toMillis()) : "";
      C.openTip(`<h4>Wczytać kopię z serwera?</h4><p class="tipp">${head.acts} wyjść${when ? `, zapisana ${when}` : ""}. Dojdzie to, czego nie ma na tym telefonie; kopia będzie dalej aktualna.</p><div class="actrow"><button class="act toplan" data-yes><span>Wczytaj</span></button><button class="act" data-no><span>Nie teraz</span></button></div>`, null, "cloudask", { label: "Kopia na serwerze" });
      const tip = C.$("tip");
      tip.querySelector("[data-yes]").onclick = async () => { C.hideTip(); state.settings.cloudBk = { ...cfg(), on: true }; C.saveSettings(); paint(); if (!(await restoreIfAny(u, true))) await syncUp(); };
      tip.querySelector("[data-no]").onclick = () => C.hideTip(); // (asked again at the next sign-in; Konto has the switch)
      return;
    }
    C.openTip(`<h4>Trzymać kopię na serwerze?</h4><p class="tipp">Wyjścia, plany i ustawienia wrócą same na nowym telefonie. Widzisz je tylko Ty.</p><div class="actrow"><button class="act toplan" data-yes><span>Tak</span></button><button class="act" data-no><span>Nie</span></button></div>`, null, "cloudask", { label: "Kopia na serwerze" });
    const tip = C.$("tip");
    tip.querySelector("[data-yes]").onclick = () => { C.hideTip(); setOn(true); };
    tip.querySelector("[data-no]").onclick = () => { C.hideTip(); state.settings.cloudBk = { on: false }; C.saveSettings(); };
  }
  /** For Konto: {on, line, has} (has: a copy of this phone's is on the server). */
  function info() {
    const on = cfg().on === true, s = uid() ? loadSent(uid()) : null;
    const ago = s?.last ? (Date.now() - s.last < 90_000 ? "przed chwilą" : fmtDate(s.last)) : "";
    return { on, has: !!s?.last, line: status || (on ? (ago ? `aktualna · ${ago}` : "jeszcze nie wysłana") : "wyłączona") };
  }

  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden" && cfg().on === true && uid()) syncUp(); });
  setInterval(() => { if (document.visibilityState === "visible" && cfg().on === true && uid()) syncUp(); }, 5 * 60_000);
  const cloudBackup = Object.freeze({ info, setOn, wipe, syncUp, soon });
  return { cloudOnAccount: onAccount, cloudBackup };
}
