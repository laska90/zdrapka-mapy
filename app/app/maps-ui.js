// The maps on the phone: the parts chosen, downloaded once (then offline), newer versions, the menu page.
// C: the app as these parts see it (ctx in app.js: every name read when used).
import { see, seen } from "./seen.js";
import { isNative, native } from "./native.js";
import { REGION, catalog, downloadParts, getBackdrop, localBackdrop, localPacks, mb, regionOf, removePart, specOf, webBackdrop, webBase, why } from "./maps.js";
import { state } from "./state.js";

export function createMapsUi(C) {
  let mapLocal = [];
  let mapCat = null;
  // and the other parts in the menu (Mapy); all of them make one map (core/packs.js)
  /** What the map is opened with; on the first start of the app, the download screen. */
  async function mapBase() {
    if (!isNative()) { const b = await webBase(); if (b !== "data/") state.backdropBase = await webBackdrop(); return b; }
    const n = await native(), FS = n?.Filesystem;
    if (!FS) return "data/";
    mapLocal = await localPacks(FS);
    state.backdropBase = (await localBackdrop(FS))?.base || null;
    if (mapLocal.length) { checkMapUpdate(); return specOf(mapLocal); }
    // (a pack inside the app: development builds)
    if (await fetch("data/index.json", { method: "HEAD" }).then((r) => r.ok).catch(() => false)) return "data/";
    return firstDownload(FS);
  }
  /** The parts as checkboxes (on the start screen and in the menu): [{reg, box}]. */
  function partList(el, cat, { checked = () => false, note = () => "" } = {}) {
    el.innerHTML = "";
    return cat.regions.map((reg) => {
      const row = document.createElement("label");
      row.className = "mpart";
      row.innerHTML = `<input type="checkbox"><span><b></b><small></small></span><em></em>`;
      row.querySelector("b").textContent = reg.label;
      const rg = reg.ranges || [];
      row.querySelector("small").textContent = note(reg) || (rg.length > 4 ? `${rg.slice(0, 3).join(", ")} i ${rg.length - 3} innych pasm` : rg.join(", "));
      row.querySelector("em").textContent = mb(reg.bytes);
      const box = row.querySelector("input");
      box.checked = checked(reg);
      el.append(row);
      return { reg, box };
    });
  }
  /** Parts of several packs, one pack after another. */
  async function getParts(FS, regs, onProgress) {
    const byPack = new Map();
    for (const r of regs) (byPack.get(r.pack) || byPack.set(r.pack, []).get(r.pack)).push(r.id);
    const total = regs.reduce((s, r) => s + r.bytes, 0);
    let before = 0;
    for (const [pack, ids] of byPack) {
      let last = 0;
      await downloadParts(FS, pack, ids, (d) => { last = d; onProgress(Math.min(total, before + d), total); });
      before += last;
    }
    mapLocal = await localPacks(FS);
    // the backdrop round and between the packs (a few MB; on the phone it never stops the map)
    try { state.backdropBase = (await getBackdrop(FS, mapCat || (await catalog())))?.base || state.backdropBase; } catch (e) { console.warn("backdrop", e); }
  }
  function firstDownload(FS) {
    return new Promise((resolve) => {
      const box = C.$("mapdl"), msg = C.$("mapdlmsg"), btn = C.$("mapdlbtn"), bar = C.$("mapdlbar"), list = C.$("mapdlparts");
      C.$("loading").querySelector(".spinner").hidden = true; C.$("loadmsg").hidden = true; box.hidden = false; C.$("loading").classList.add("pick");
      let rows = [];
      const sum = () => { const sel = rows.filter((r) => r.box.checked); btn.disabled = !sel.length; btn.textContent = sel.length ? `Pobierz · ${mb(sel.reduce((s, r) => s + r.reg.bytes, 0) + (mapCat?.backdrop?.bytes || 0))}` : "Wybierz góry"; };
      const ask = async () => {
        btn.disabled = true; msg.textContent = "Sprawdzam, co jest do pobrania…";
        try { mapCat = await catalog(); if (!mapCat.regions?.length) throw new Error("pusty katalog"); }
        catch { msg.textContent = "Nie mogę połączyć się z serwerem map. Włącz internet i spróbuj jeszcze raz."; btn.textContent = "Spróbuj ponownie"; btn.disabled = false; btn.onclick = ask; return; }
        msg.textContent = "Wybierz góry. Pobierasz raz, potem mapa działa bez internetu; resztę dobierzesz w menu.";
        rows = partList(list, mapCat, { checked: (r) => r.id === REGION });
        list.hidden = false;
        for (const r of rows) r.box.onchange = sum;
        sum(); btn.onclick = go;
      };
      const go = async () => {
        const regs = rows.filter((r) => r.box.checked).map((r) => r.reg);
        btn.disabled = true; btn.textContent = "Pobieram…"; bar.parentElement.hidden = false; list.hidden = true;
        try {
          await getParts(FS, regs, (d, t) => { bar.style.width = `${((100 * d) / t).toFixed(1)}%`; msg.textContent = `${mb(d)} z ${mb(t)}`; });
          box.hidden = true; C.$("loading").classList.remove("pick"); C.$("loading").querySelector(".spinner").hidden = false; C.$("loadmsg").hidden = false;
          mapRow(); resolve(specOf(mapLocal));
        } catch (e) {
          console.warn("maps download", e);
          msg.textContent = `Pobieranie przerwane (${why(e)}). To, co już jest, zostanie – dokończę od tego miejsca.`; btn.textContent = "Dokończ pobieranie"; btn.disabled = false;
        }
      };
      ask();
    });
  }
  /** Quietly: newer maps on the site? Then the menu says so (and a word once). */
  async function checkMapUpdate() {
    try {
      mapCat = await catalog();
      const newer = mapLocal.filter((p) => mapCat.regions.some((r) => r.pack === p.id && r.version > p.version));
      mapRow();
      // a newer backdrop (or the first one): quietly, it is small
      const FS = (await native())?.Filesystem;
      if (FS && mapCat.backdrop) getBackdrop(FS, mapCat).then((b) => { if (b?.base && b.base !== state.backdropBase) { state.backdropBase = b.base; if (!state.careful && state.result) C.view.setBackdrop(state.backdropBase); } }).catch((e) => console.warn("backdrop", e));
      const v = newer.map((p) => p.id).join(",") + mapCat.regions.map((r) => r.version).join("");
      if (newer.length && seen("mapSeen") !== v) { see("mapSeen", v); setTimeout(() => C.undoToast("Nowsze mapy", () => C.drawer("mapsp", { push: true }), 9000, "Aktualizuj"), 4000); }
    } catch { mapRow(); }
  }
  const newerParts = () => (mapCat ? mapLocal.filter((p) => mapCat.regions.some((r) => r.pack === p.id && r.version > p.version)) : []);
  function mapRow() {
    const row = C.$("maprow");
    if (!mapLocal.length) { row.hidden = true; return; }
    row.hidden = false;
    const parts = mapLocal.flatMap((p) => p.groups), names = parts.map((g) => regionOf(mapCat, g)?.label || g);
    C.$("mcnt").textContent = names.length; // (a newer version: a dot, .dl.new)
    if (job) paint();
    row.classList.toggle("new", newerParts().length > 0);
  }
  let job = null; // the menu's download: {d, t, done}
  /** The menu page: the parts on the phone, the others to add, newer versions. */
  async function renderMapsPage() {
    const el = C.$("mapsp"), FS = (await native())?.Filesystem;
    if (!mapCat) { el.innerHTML = `<p class="muted">Sprawdzam mapy…</p>`; try { mapCat = await catalog(); } catch { el.innerHTML = `<p class="muted">Nie mogę połączyć się z serwerem map. Włącz internet.</p>`; return; } }
    // (a pack once whole, its one part named after it, and now in parts: it has all of them)
    const have = new Set(mapLocal.flatMap((p) => p.groups.flatMap((g) => (g === p.id ? mapCat.regions.filter((r) => r.pack === p.id && r.id !== p.id).map((r) => r.id).concat(g) : [g])))), newer = newerParts();
    el.innerHTML = `<p class="muted small">Zaznacz góry, które mają być w telefonie (działają bez internetu). Odznaczone znikną z telefonu, Twoje wyjścia zostają.</p><div class="mparts"></div>
    <button class="btn primary mapgo" disabled>Zapisz</button><p class="muted small mapmsg"></p>`;
    const rows = partList(el.querySelector(".mparts"), mapCat, {
      checked: (r) => have.has(r.id),
      note: (r) => (have.has(r.id) ? (newer.some((p) => p.id === r.pack) ? "w telefonie · jest nowsza wersja" : "w telefonie") : ""),
    });
    const btn = el.querySelector(".mapgo");
    const diff = () => {
      const add = rows.filter((r) => r.box.checked && !have.has(r.reg.id)).map((r) => r.reg), del = rows.filter((r) => !r.box.checked && have.has(r.reg.id)).map((r) => r.reg);
      const upd = newer.length ? mapCat.regions.filter((r) => have.has(r.id) && newer.some((p) => p.id === r.pack) && !del.includes(r)) : [];
      return { add, del, upd };
    };
    const sum = () => {
      const { add, del, upd } = diff(), bytes = [...add, ...upd].reduce((s, r) => s + r.bytes, 0);
      btn.disabled = !add.length && !del.length && !upd.length;
      btn.textContent = add.length || upd.length ? `${upd.length && !add.length ? "Zaktualizuj" : "Pobierz"} · ${mb(bytes)}` : del.length ? "Usuń z telefonu" : "Zapisz";
    };
    for (const r of rows) r.box.onchange = sum;
    sum();
    if (job) { btn.disabled = true; paint(); }
    btn.onclick = () => {
      const { add, del, upd } = diff();
      if (!FS || job) return;
      job = { d: 0, t: [...add, ...upd].reduce((s, r) => s + r.bytes, 0), done: false };
      paint();
      // not awaited: the download goes on while the menu closes and the map is used (on the phone a
      // service with a notification takes it on, the screen off or the app left)
      (async () => {
        for (const r of del) await removePart(FS, r.pack, r.id);
        if (add.length || upd.length) await getParts(FS, [...add, ...upd], (d, t) => { job.d = d; job.t = t; paint(); });
      })().then(() => {
        job.done = true; paint();
        C.undoToast(add.length || upd.length ? "Mapy pobrane" : "Usunięte z telefonu", () => location.reload(), 30000, "Otwórz");
      }, (e) => {
        console.warn("maps download", e);
        const err = `Pobieranie przerwane (${why(e)}) – spróbuj jeszcze raz (dokończę od tego miejsca).`;
        job = null; paint(err); mapRow();
        C.undoToast("Pobieranie przerwane", () => C.drawer("mapsp", { push: true }), 9000, "Pokaż");
      });
    };
  }
  /** The download's state in the menu: the Mapy row's figure and the page's line. */
  function paint(err) {
    const pct = job && job.t ? Math.min(100, Math.round((100 * job.d) / job.t)) : 0;
    if (job && !job.done) C.$("mcnt").textContent = `${pct}%`;
    else if (job?.done) C.$("mcnt").textContent = "✓";
    const el = C.$("mapsp"), msg = el?.querySelector(".mapmsg"), btn = el?.querySelector(".mapgo");
    if (!msg) return;
    if (err) { msg.textContent = err; if (btn) btn.disabled = false; return; }
    if (!job) return;
    if (btn) btn.disabled = true;
    if (job.done) {
      msg.innerHTML = `Gotowe. <button class="linkbtn mapopen">Otwórz mapę na nowo</button>`;
      msg.querySelector(".mapopen").onclick = () => location.reload();
    } else msg.textContent = `Pobieram… ${mb(job.d)} z ${mb(job.t)} · możesz zamknąć menu`;
  }
  C.$("maprow").onclick = () => C.drawer("mapsp", { push: true });

  return { mapBase, renderMapsPage };
}
