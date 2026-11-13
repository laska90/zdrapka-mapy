// Konto (Menu): sign in with Google or an e-mail, who you are, sign out, delete the account.
// (The backup on the server and the friends through it come on top of this.)
import { authError, cloud } from "./cloud.js";
import { state } from "./state.js";

const G = `<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="#4285F4" d="M22.5 12.3c0-.8-.1-1.5-.2-2.3H12v4.3h5.9a5 5 0 0 1-2.2 3.3v2.7h3.5c2.1-1.9 3.3-4.7 3.3-8z"/><path fill="#34A853" d="M12 23c3 0 5.4-1 7.2-2.7l-3.5-2.7c-1 .7-2.2 1-3.7 1-2.9 0-5.3-1.9-6.2-4.5H2.2v2.8A11 11 0 0 0 12 23z"/><path fill="#FBBC05" d="M5.8 14.1a6.6 6.6 0 0 1 0-4.2V7.1H2.2a11 11 0 0 0 0 9.8z"/><path fill="#EA4335" d="M12 5.4c1.6 0 3.1.6 4.2 1.7l3.1-3.1A11 11 0 0 0 2.2 7.1l3.6 2.8C6.7 7.3 9.1 5.4 12 5.4z"/></svg>`;
const MAIL = `<svg viewBox="0 0 24 24" aria-hidden="true" style="fill:none;stroke:currentColor;stroke-width:1.8"><rect x="3" y="5.5" width="18" height="13" rx="2"/><path d="M3.5 7l8.5 6 8.5-6"/></svg>`;
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

export function createAccount(C) {
  let me = null, form = null, busy = false, signingIn = false; // form: null | "in" | "up"; signingIn: a tap's sign-in on its way
  const hint = () => state.settings.account || null; // {name, email}: the menu knows without loading the SDK
  const initial = (u) => (u?.name || u?.email || "?").trim().charAt(0).toUpperCase();

  function row() {
    const el = C.$("acctrow"); if (!el) return;
    const h = me || hint();
    el.querySelector(".acav").hidden = !h; el.querySelector(".acic").hidden = !!h;
    el.querySelector(".acav").textContent = initial(h);
    el.querySelector("span.acn").textContent = h ? h.name || h.email : "Zaloguj";
  }
  function setMe(u, fresh = false) {
    const was = me?.uid || null;
    me = u;
    const h = u ? { name: u.name, email: u.email } : null;
    if (JSON.stringify(h) !== JSON.stringify(hint())) { state.settings.account = h; C.saveSettings(); }
    row();
    if (!C.$("kontop").hidden) render();
    if ((u?.uid || null) !== was) { C.cloudOnAccount?.(u, fresh); C.friendsOnAccount?.(u, fresh); }
    if (u && !watching) watch(); // (signed in from Znajomi: Konto not opened yet; from now on it follows the account)
  }
  let watching = false;
  async function watch() {
    if (watching) return; watching = true;
    try { const c = await cloud(); await new Promise((res) => c.onUser((u) => { setMe(u, signingIn && !!u); res(); })); } catch (e) { watching = false; console.warn("cloud", e); }
  }

  function render() {
    const el = C.$("kontop"); if (!el) return;
    if (!watching) { el.innerHTML = `<p class="acwait">…</p>`; watch().then(render); return; }
    if (me) {
      el.innerHTML = `<div class="acct"><span class="av">${esc(initial(me))}</span><span><b>${esc(me.name || me.email)}</b><small>${esc(me.email)}</small></span></div>` +
        (!me.google && !me.verified ? `<div class="acnote">E-mail niepotwierdzony <button class="lnk" data-verify>Wyślij link jeszcze raz</button></div>` : "") +
        (() => { const b = C.cloudBackup.info(); return `<label class="swrow acbk"><span class="fname"><b>Kopia na serwerze</b><small>${esc(b.line)}</small></span><input class="sw" type="checkbox" data-bk ${b.on ? "checked" : ""}></label>` +
          `<div class="acfoot"><button class="lnk" data-out>Wyloguj</button>${b.has ? `<button class="lnk" data-wipe>Usuń kopię z serwera</button>` : ""}</div><div class="acfoot acfoot2"><button class="lnk acdel" data-del>Usuń konto</button></div>`; })();
      el.querySelector("[data-bk]").onchange = (e) => C.cloudBackup.setOn(e.target.checked);
      const w = el.querySelector("[data-wipe]");
      if (w) w.onclick = () => { if (confirm("Usunąć kopię z serwera? Konto i dane na telefonie zostaną. Kopia wyłączy się.")) { state.settings.cloudBk = { on: false }; C.saveSettings(); C.cloudBackup.wipe(); } };
      el.querySelector("[data-out]").onclick = signOut;
      el.querySelector("[data-del]").onclick = removeAccount;
      const v = el.querySelector("[data-verify]");
      if (v) v.onclick = async () => { try { await (await cloud()).verify(); C.toast("Wysłane: sprawdź skrzynkę", 4000); } catch (e) { C.toast(authError(e) || "", 4000); } };
      return;
    }
    if (!form) {
      el.innerHTML = `<div class="acbtns"><button class="act acg" data-g>${G}<span>Zaloguj przez Google</span></button><button class="act" data-e>${MAIL}<span>Zaloguj e-mailem</span></button></div>`;
      el.querySelector("[data-g]").onclick = google;
      el.querySelector("[data-e]").onclick = () => { form = "in"; render(); };
      return;
    }
    const up = form === "up";
    el.innerHTML = `<form class="acform" novalidate>${up ? `<input name="name" autocomplete="nickname" placeholder="Imię" maxlength="30">` : ""}` +
      `<input name="email" type="email" autocomplete="email" inputmode="email" placeholder="E-mail"><input name="pass" type="password" autocomplete="${up ? "new-password" : "current-password"}" placeholder="Hasło${up ? " (min. 6 znaków)" : ""}">` +
      `<button class="act toplan" type="submit"><span>${up ? "Załóż konto" : "Zaloguj"}</span></button>` +
      `<div class="aclinks"><button class="lnk" type="button" data-sw>${up ? "Mam już konto" : "Załóż konto"}</button>${up ? "" : `<button class="lnk mute" type="button" data-reset>Nie pamiętam hasła</button>`}</div>` +
      `<button class="lnk mute acback" type="button" data-back>Inny sposób logowania</button></form>`;
    const f = el.querySelector("form");
    f.onsubmit = (e) => { e.preventDefault(); emailGo(f, up); };
    f.querySelector("[data-sw]").onclick = () => { const em = f.email.value; form = up ? "in" : "up"; render(); C.$("kontop").querySelector("[name=email]").value = em; };
    f.querySelector("[data-back]").onclick = () => { form = null; render(); };
    const r = f.querySelector("[data-reset]");
    if (r) r.onclick = async () => {
      const em = f.email.value.trim();
      if (!em) { C.toast("Wpisz e-mail, wyślę na niego link", 4000); f.email.focus(); return; }
      try { await (await cloud()).reset(em); C.toast("Link do zmiany hasła wysłany", 4000); } catch (e) { C.toast(authError(e) || "", 4000); }
    };
  }
  async function run(fn) {
    if (busy) return; busy = true;
    try { await fn(); } catch (e) { const m = authError(e); if (m) C.toast(m, 5000); } finally { busy = false; }
  }
  const google = () => run(async () => { signingIn = true; try { const u = await (await cloud()).google(); form = null; setMe(u, true); } finally { signingIn = false; } });
  function emailGo(f, up) {
    const email = f.email.value.trim(), pass = f.pass.value, name = up ? f.name.value.trim() : "";
    return run(async () => {
      const c = await cloud();
      signingIn = true;
      try {
        const u = up ? await c.emailUp(email, pass, name) : await c.emailIn(email, pass);
        form = null; setMe(u, true);
      } finally { signingIn = false; }
      if (up) C.toast("Konto założone. Wysłałem link potwierdzający na e-mail", 5000);
    });
  }
  const signOut = () => run(async () => { await (await cloud()).out(); setMe(null); C.toast("Wylogowano. Dane na telefonie zostały", 4000); });
  const removeAccount = () => {
    if (!confirm("Usunąć konto i wszystko, co jest na serwerze? Dane na telefonie zostaną.")) return;
    return run(async () => {
      const c = await cloud(), uid = me?.uid;
      if (uid) {
        C.busy("Usuwam konto…");
        try {
          // the backup, your file for friends, the friendships, your invites; then the account
          const [acts, data, fr, inv] = await Promise.all([c.list(`users/${uid}/acts`), c.list(`users/${uid}/data`), c.where("friendships", "members", "array-contains", uid), c.where("invites", "owner", "==", uid)]);
          await c.batch([...acts.map((d) => ({ op: "del", path: `users/${uid}/acts/${d.id}` })), ...data.map((d) => ({ op: "del", path: `users/${uid}/data/${d.id}` })),
            ...fr.map((d) => ({ op: "del", path: `friendships/${d.id}` })), ...inv.map((d) => ({ op: "del", path: `invites/${d.id}` })),
            { op: "del", path: `users/${uid}` }, { op: "del", path: `shares/${uid}` }, { op: "del", path: `profiles/${uid}` }]);
          await c.remove();
        } finally { C.idle(); }
      } else await c.remove();
      localStorage.removeItem("zdrapka.cloudSent"); state.settings.cloudBk = undefined; C.saveSettings();
      setMe(null); C.toast("Konto usunięte", 4000);
    });
  };

  row();
  if (hint()) setTimeout(watch, 2500); // signed in before: who you are, once the map is up
  const account = () => me, renderAccountIfOpen = () => (C.$("kontop").hidden ? null : render());
  const signInEmail = () => { form = "in"; C.drawer("kontop", { push: true }); };
  return { renderAccount: render, account, renderAccountIfOpen, signInGoogle: google, signInEmail };
}
