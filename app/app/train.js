// Home by train: from the stations round you (walking there on the trails at your pace), the Polish trains home, a ticket in Koleo.
// C: the app as these parts see it (ctx in app.js: every name read when used).
import { fastestHome, koleoUrl, loadTrains, stationsNear } from "./trip.js";
import { site as mapsSite } from "./maps.js";
import { askNotifications } from "./native.js";
import { projector, unprojector } from "../core/pack.js";
import { state } from "./state.js";

export function createTrain(C) {
  // railways' timetable (on the phone once fetched): the way that gets you home first
  const HOME_SPARE = 5 * 60000; // at the station a little before the train
  async function homeStatus() {
    const el = C.$("homestatus");
    try {
      const T = await loadTrains(mapsSite());
      const bad = [state.settings.home?.a, state.settings.home?.b].filter((n) => n && !T.byName.has(n.toLowerCase()));
      el.textContent = bad.length ? `Nie znam stacji: ${bad.join(", ")}. Wybierz z listy.` : `Rozkład PKP PLK od ${T.from}, ${T.st.length} stacji.`;
    } catch (e) { el.textContent = e.message; }
  }
  // the station fields: a few matches under the field as you type (the whole list would be 3000 rows)
  C.$("tripnote").onchange = () => { state.settings.trip = { ...(state.settings.trip || {}), note: C.$("tripnote").checked }; C.saveSettings(); C.renderSettings(); if (C.$("tripnote").checked) askNotifications(); C.tripReminder(); };
  C.$("triptime").onchange = () => { state.settings.trip = { ...(state.settings.trip || {}), at: C.$("triptime").value || "17:00" }; C.saveSettings(); C.tripReminder(); };
  const saveHome = () => { state.settings.home = { a: C.$("home1").value.trim(), b: C.$("home2").value.trim() }; C.saveSettings(); homeStatus(); };
  for (const id of ["home1", "home2"]) {
    const inp = C.$(id), sug = C.$(id + "s");
    inp.oninput = async () => {
      const q = C.fold(inp.value.trim());
      if (q.length < 2) { sug.hidden = true; return; }
      let T; try { T = await loadTrains(mapsSite()); } catch { return; }
      const hits = T.st.map((s) => s[0]).filter((n) => C.fold(n).includes(q)).sort((a, b) => C.fold(a).indexOf(q) - C.fold(b).indexOf(q) || a.length - b.length).slice(0, 6);
      sug.innerHTML = hits.map((n) => `<button type="button" data-st="${C.esc(n)}">${C.esc(n)}</button>`).join("");
      sug.hidden = !hits.length;
    };
    sug.addEventListener("pointerdown", (e) => { const n = e.target.closest("[data-st]")?.dataset.st; if (!n) return; e.preventDefault(); inp.value = n; sug.hidden = true; inp.blur(); saveHome(); });
    inp.onchange = saveHome;
    inp.onblur = () => setTimeout(() => (sug.hidden = true), 150);
  }
  /** From you (the GPS) now, or from a point of the map ({x, y, n}) at a time (ms; the default: now). */
  async function homeByTrain(arg = null) {
    const from = arg && arg.x != null ? arg : null;
    let at = arg?.at || Date.now();
    C.drawer(false);
    if (!state.settings.home?.a) { C.toast("Najpierw podaj stację domową", 3000); C.openSettings("homerow"); return; }
    let f, p;
    if (from) { const [lon, lat] = unprojector(C.view.meta)(from.x, from.y); f = { lat, lon }; p = [from.x, from.y]; }
    else {
      f = C.gps.fix; p = C.gpsXY();
      if (!f || C.gps.stale || !p) { state.homeWait = true; if (!C.gps.on) { state.follow = false; C.gps.start(); C.gpsUi(); } C.toast("Szukam Twojej pozycji…", 3000); return; }
    }
    const again = (t) => homeByTrain({ ...(from || {}), at: t });
    C.openTip(`<h4>Pociągiem do domu</h4><p class="muted">Liczę dojścia do stacji i pociągi…</p>`, null, "home", { label: "Pociągiem do domu" });
    let T;
    try { T = await loadTrains(mapsSite()); } catch (e) { C.openTip(`<h4>Pociągiem do domu</h4><p>${C.esc(e.message)}</p>`, null, "home", { label: "Pociągiem do domu" }); return; }
    const idx = (n) => (n ? T.byName.get(n.toLowerCase()) ?? null : null), A = idx(state.settings.home.a), B = idx(state.settings.home.b);
    const proj = projector(C.view.meta), now = at, opts = [];
    // the stations near (on the map), the ways there in one go (one router for them all), then the trains
    const cands = stationsNear(T, f.lat, f.lon, 25, 8).map((s) => ({ s, xy: proj(s.lon, s.lat) })).filter((c) => C.view.onMap(c.xy[0], c.xy[1]));
    const ways = await C.call("routesTo", { from: p, to: cands.map((c) => c.xy), opts: state.settings.plan || {} }).then((r) => r.routes).catch(() => []);
    cands.forEach(({ s, xy: [sx, sy] }, k) => {
      const r = s.km < 0.15 ? { km: 0, up: 0, down: 0, std: 0 } : ways[k];
      if (!r) return;
      const walk = r.std ? C.routeTime(r).ms : 0, ready = now + walk + HOME_SPARE, res = fastestHome(T, s.i, ready, [A, B], state.settings.homeChange || 3);
      const ja = A != null ? res[A] : null, jb = B != null ? res[B] : null;
      // the first station unless the second gets you there a good half hour sooner
      const pick = ja && (!jb || ja.arr <= jb.arr + 30 * 60000) ? { to: state.settings.home.a, j: ja } : jb ? { to: state.settings.home.b, j: jb } : null;
      if (pick && pick.j.legs.length) opts.push({ s, sx, sy, walk, km: r.km, up: r.up, ...pick });
    });
    opts.sort((a, b) => a.j.arr - b.j.arr || a.walk - b.walk);
    const dd = new Date(now), p2 = (v) => String(v).padStart(2, "0");
    let html = `<h4>Pociągiem do domu</h4><div class="hfrom"><span>${from ? `z: <b>${C.esc(from.n || "punktu na mapie")}</b>` : "z Twojej pozycji"}</span><label>wyjście <input id="hat" type="time" value="${p2(dd.getHours())}:${p2(dd.getMinutes())}"></label><input id="hday" type="date" value="${dd.getFullYear()}-${p2(dd.getMonth() + 1)}-${p2(dd.getDate())}"></div>`;
    if (!opts.length) html += `<p>Z żadnej stacji w promieniu 25 km nie dojedziesz dziś do ${C.esc(state.settings.home.a)}${state.settings.home.b ? ` ani ${C.esc(state.settings.home.b)}` : ""} (albo stacje są poza mapą).</p>`;
    html += opts.slice(0, 3).map((o, k) => {
      const L0 = o.j.legs[0], ch = o.j.legs.length - 1, wait = Math.round((L0.dep - now - o.walk) / 60000);
      return `<div class="hopt${k ? "" : " best"}"><div class="hst"><b>${C.esc(o.s.name)}</b><span>${o.walk ? `dojście ${C.hm(o.walk).replace(" h", "")}` : "jesteś na miejscu"}${o.km ? ` · ${C.nf(o.km)} km` : ""}${wait > 0 ? ` · ${wait} min zapasu` : " · na styk"}</span></div>` +
        `<div class="htr"><b>${C.hhmm(L0.dep)}</b> ${C.esc(L0.label)} → ${C.esc(o.to)} <b>${C.hhmm(o.j.arr)}</b>${ch ? ` · przesiadka: ${o.j.legs.slice(1).map((l) => C.esc(l.from)).join(", ")}` : ""}</div>` +
        `<div class="hbtn"><button class="pill go" data-go="${k}">Prowadź</button><button class="pill" data-koleo="${k}">Bilet w Koleo</button></div></div>`;
    }).join("");
    html += `<p class="muted small">Rozkład PKP PLK (GTFS: mkuran.pl) z ${T.from}. Sprawdź zmiany i opóźnienia przed wyjściem. Dojście liczone Twoim tempem + ${HOME_SPARE / 60000} min zapasu.</p>`;
    C.openTip(html, null, "home", { label: "Pociągiem do domu", reopen: () => again(now) });
    C.sheet("open"); C.$("tip").scrollTop = 0;
    const re = () => { const t = new Date(`${C.$("hday").value}T${C.$("hat").value || "12:00"}`).getTime(); if (Number.isFinite(t)) again(t); };
    C.$("hat").onchange = re; C.$("hday").onchange = re;
    C.$("tip").querySelectorAll("[data-go]").forEach((b) => (b.onclick = () => {
      const o = opts[+b.dataset.go];
      if (from?.extend && C.planner.active()) { // from a plan's finish: the plan goes on to the station (its card back, a new last point)
        if (state.navStack.length) C.goBack();
        C.planner.add({ x: o.sx, y: o.sy, n: o.s.name });
        C.toast(`Do stacji ${o.s.name}`, 3000);
        return;
      }
      C.hideTip(); C.planner.openTo({ x: o.sx, y: o.sy, n: o.s.name }, { x: p[0], y: p[1], n: from ? from.n || null : "Moja pozycja" }); }));
    C.$("tip").querySelectorAll("[data-koleo]").forEach((b) => (b.onclick = () => { const o = opts[+b.dataset.koleo]; C.openExternal(koleoUrl(o.j.legs[0].from, o.to, o.j.legs[0].dep - 60000)); }));
  }

  /** The timetable onto the phone while there is signal (a week old at most), so "home by train" works in the mountains. */
  const prefetchTrains = () => { if (navigator.onLine !== false) loadTrains(mapsSite()).catch(() => {}); };
  setTimeout(prefetchTrains, 20000); // (after the start: the map first)
  return { homeByTrain, homeStatus, prefetchTrains };
}
