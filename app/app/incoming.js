// new outings: read from files (Dodaj) or fetched from Garmin, shown on the map, then a summary card
// (moved out of app.js: what it needs of the app comes in C, see createX in app.js)
import { BADGES, badgesOf } from "../core/badges.js";
import { plural, shortName } from "./labels.js";
import { state } from "./state.js";

export function createIncoming(C) {
  /** Apply new results after an import or a sync. Returns true when a summary card was shown. */
  async function renderNew(res, { fit = false } = {}) {
    const old = state.result, known = new Set((old?.activities || []).map((a) => a.id));
    const fresh = (res.activities || []).filter((a) => !a.outside && !known.has(a.id));
    if (!old?.activities?.length || !fresh.length) { C.render(res, { fit }); return false; } // the very first import: just the map, fitted
    C.render(res);
    if (fresh.length <= 3) {
      const tracks = (await Promise.all(fresh.map((a) => C.call("track", { activity: a.id }).catch(() => null)))).map((r) => r?.track).filter((t) => t?.box);
      if (tracks.length) {
        C.hideTip(); C.sheet("peek");
        const box = tracks.reduce((b, t) => [Math.min(b[0], t.box[0]), Math.min(b[1], t.box[1]), Math.max(b[2], t.box[2]), Math.max(b[3], t.box[3])], [Infinity, Infinity, -Infinity, -Infinity]);
        await C.flyView(() => C.fitAbove(...box)).catch(() => {});
        C.haptic.reward();
      }
    }
    newCard(old, res, fresh);
    return true;
  }
  function newCard(old, res, fresh) {
    const km = fresh.reduce((s, a) => s + (a.km || 0), 0), dTrail = Math.max(0, (res.coverage?.trails.walkedKm || 0) - (old?.coverage?.trails.walkedKm || 0));
    const seen = new Set(Object.keys(old?.found || {}));
    const places = Object.entries(res.found || {}).filter(([id, f]) => f.n && !seen.has(id)).map(([pid, f]) => ({ pid, f }))
      .sort((a, b) => (b.f.c === "peak") - (a.f.c === "peak") || (b.f.e || 0) - (a.f.e || 0));
    const lists = BADGES.map((B) => { const n = (r) => B.list.filter((k) => r?.badges?.[`${B.id}:${k.n}`]).length, a = n(old), b = n(res); return b > a ? `${B.name} ${b}/${B.list.length}` : null; }).filter(Boolean);
    const title = fresh.length === 1 ? fresh[0].name || "Nowe wyjście" : plural(fresh.length, "nowe wyjście", "nowe wyjścia", "nowych wyjść");
    let html = `<div class="newcard"><div class="tk">${fresh.length === 1 ? "Nowe wyjście" : "Zdrapane"}</div><h4>${title}</h4>`;
    html += `<div class="ostats"><span><b>+${C.nf(dTrail)}</b> km nowych szlaków</span><span><b>${C.nf(km)}</b> km</span></div>`;
    if (places.length) html += `<div class="tl">${plural(places.length, "nowe miejsce", "nowe miejsca", "nowych miejsc")}</div><div class="tags oscroll">${places.slice(0, 14).map((q) => `<button data-p="${q.pid}">${shortName(q.f.n)}</button>`).join("")}</div>`;
    if (lists.length) html += `<div class="tags">${lists.map((t) => `<span>${t}</span>`).join("")}</div>`;
    html += C.visitRows(fresh.map((a) => [a.id, a.start])) + `</div>`;
    C.openTip(html, null, `new:${fresh.map((a) => a.id).join(",")}`, { label: fresh.length === 1 ? "Nowe wyjście" : "Zdrapane", reopen: () => newCard(old, res, fresh) });
    C.$("tip").querySelectorAll("[data-p]").forEach((b) => (b.onclick = () => {
      const f = state.result.found[b.dataset.p];
      if (!f) return;
      C.showTip({ id: b.dataset.p, c: f.c, n: f.n, e: f.e, x: f.x, y: f.y, d: true, f: f.first, v: f.visits, ...(badgesOf(f, C.bpts() || []) || {}) });
      C.flyView(() => C.centerFree(f.x, f.y, Math.max(C.view.zl, 8.5)));
    }));
  }

  // ---- import
  const progressMsg = (p) => { C.$("loadmsg").textContent = p.stage === "match" ? `Dopasowuję do szlaków… ${p.n}/${p.of}` : p.stage === "names" ? `Nazywam trasy… ${p.n}/${p.of}` : `Czytam pliki… ${p.n}`; };
  const reasonPl = (r) => r === "already imported" ? "już wczytane" : r === "same start" ? "to samo wyjście już jest" : r.startsWith("sport") ? "inny sport" : r === "no GPS" ? "pusty lub uszkodzony plik" : r.startsWith("unreadable") ? "nieczytelne" : r.startsWith("nothing left") ? "bez śladu po czyszczeniu" : r;
  C.$("files").onchange = async (e) => {
    C.drawer(false);
    const files = [...e.target.files];
    e.target.value = "";
    if (!files.length) return;
    C.busy("Czytam pliki…");
    try {
      const r = await C.call("import", { files, settings: state.settings }, progressMsg);
      const firstTime = !state.result?.activities?.length;
      C.idle();
      await renderNew(r.result, { fit: firstTime });
      const why = {};
      for (const s of r.skipped) { const k = reasonPl(s.reason); why[k] = (why[k] || 0) + 1; }
      // files that are no track at all (a photo…): the reader never sees them
      const notTrack = files.filter((f) => !/\.(gpx|fit|tcx|zip)$/i.test(f.name)).length;
      if (notTrack) why["to nie ślad (GPX, FIT, TCX, ZIP)"] = notTrack;
      const skipped = Object.entries(why).map(([k, n]) => `${k} ${n}`).join(", ");
      const outside = r.added.filter((a) => a.outside).length;
      const ref = r.refreshed ? ` · uzupełnione wysokości: ${r.refreshed}` : "";
      const head = r.added.length ? `Dodano ${plural(r.added.length, "wyjście", "wyjścia", "wyjść")}${ref}` : r.refreshed ? `Uzupełnione wysokości: ${plural(r.refreshed, "wyjście", "wyjścia", "wyjść")}` : skipped ? "Nic nie dodano" : "Dodano 0 wyjść";
      C.toast(`${head}${outside ? ` (${outside === r.added.length ? "" : `${outside} `}poza mapami: nic nie zdrapie)` : ""}${skipped ? ` · pominięte: ${skipped}` : ""}`, 8000);
    } catch (err) {
      console.error(err); C.toast("Nie udało się wczytać plików: " + err.message, 8000);
    } finally { C.idle(); }
  };

  return { progressMsg, renderNew };
}
