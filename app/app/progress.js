// progress: the figures on the sheet, the progress page, a badge's peaks, ranges, the places reached, a place's card
// (moved out of app.js: what it needs of the app comes in C, see createX in app.js)
import { state } from "./state.js";
import { GOT_LEVELS, gotOf } from "../core/notices.js";
import { BADGES, KGP, badgeFields, badgePoints, badgeSummits, badgesOf, listsOf } from "../core/badges.js";
import { VIGNETTES, peakIcon, vignetteURL } from "./vignettes.js";
import { patchURL } from "./patches.js";
import { yearsOf } from "../core/year.js";
import { NAMES, PLURAL, fmtDate, mapLabel, shortName } from "./labels.js";
import { bearing as bearingOf, distText, nearest, outside, windShort } from "../core/hud.js";
import { projector } from "../core/pack.js";
import { stampPNG, stampTilt } from "./stamps.js";
import { MEDAL_OF, glyphKey, glyphURL, medalLetters, medalURL } from "./glyphs.js";
import { TC as TRAIL_CSS } from "./glstyle.js";
import { accessOf } from "../core/access.js";
import { mergeSide, packList, packUrl } from "../core/packs.js";
import { absSpec } from "./glmap.js";

export function createProgress(C) {
  let badgePts = null;
  let jcat = "all";
  let accessData = null;
  function renderCard() {
    const peek = C.$("peek");
    if (!state.result || !state.result.activities.length) {
      C.$("chipsub").innerHTML = `<b>0%</b><small>szlaków</small>`;
      C.$("ringv").setAttribute("stroke-dasharray", "0 100"); C.$("ringv").style.opacity = 0;
      // the first run: one line (the map stays free for those who only plan), a tap opens the two ways in; ✕ puts it away
      // for good (Wyjścia in the menu stay)
      peek.innerHTML = state.settings.onbHidden ? "" : `<div class="onbl"><button class="onbt" data-onb="open" aria-expanded="${!!onbOpen}"><svg><use href="#i-plus"/></svg><span>Dodaj swoje wyjścia, a mapa się zdrapie</span></button><button class="onbx" data-onb="hide" aria-label="Nie teraz"><svg><use href="#i-x"/></svg></button></div>` +
        (onbOpen ? `<div class="onb onbch"><button class="btn primary" data-onb="files"><svg><use href="#i-plus"/></svg><span>Z plików<small>GPX, FIT, TCX, eksport z Garmina albo Stravy</small></span></button><button class="btn" data-onb="icu"><svg><use href="#i-sync"/></svg><span>Połącz z Garminem<small>nowe wyjścia przyjdą same</small></span></button></div>` : "");
      C.$("sheet").classList.toggle("bare", !!state.settings.onbHidden);
      // Progress before the first outing: where you stand (0%) and the two ways in, not an empty page
      const onb = `<div class="onb"><button class="btn primary" data-onb="files"><svg><use href="#i-plus"/></svg> Dodaj wyjścia</button><button class="btn" data-onb="icu"><svg><use href="#i-sync"/></svg> Połącz z Garminem</button></div>`;
      C.$("progress").innerHTML = `<div class="hero"><div class="hrow"><b class="hbig">0%</b><span class="hlab">szlaków ${C.AREA.gen()}</span></div><div class="bar th"><i style="width:0%"></i></div></div>${onb}`;
      C.$("progress").onclick = (e) => { const o = e.target.closest("[data-onb]")?.dataset.onb; if (o) onbGo(o); };
      C.$("dsum").innerHTML = `<span class="dsr" style="--p:0"><b>0%</b></span><span><b>szlaków ${C.AREA.gen()}</b></span>`; C.$("dranges").innerHTML = "";
      renderRanges(); C.placeToast();
      return;
    }
    C.$("sheet").classList.remove("bare");
    const c = state.result.coverage;
    C.$("chipsub").innerHTML = `<b>${c.trails.pct >= 10 ? Math.round(c.trails.pct) : C.nf(c.trails.pct, c.trails.pct < 1 ? 1 : 0)}%</b><small>szlaków</small>`;
    C.$("chip").setAttribute("aria-label", `Postęp: ${C.pct(c.trails.pct)}% szlaków ${C.AREA.gen()}`);
    C.$("ringv").setAttribute("stroke-dasharray", `${Math.max(0.6, Math.min(100, c.trails.pct)).toFixed(2)} 100`); C.$("ringv").style.opacity = 1;
    C.$("dsum").innerHTML = `<span class="dsr" style="--p:${Math.min(100, c.trails.pct).toFixed(1)}"><b>${C.pct(c.trails.pct)}%</b></span><span><b>szlaków ${C.AREA.gen()}</b><small>${C.nf(c.trails.walkedKm)} z ${C.nf(c.trails.totalKm, 0)} km</small></span>`;
    // the ranges you walked most of, under it (all of them: Pasma)
    const rs = (state.result.ranges || []).filter((r) => r.coverage?.trails.walkedKm > 0.05).sort((a, b) => b.coverage.trails.pct - a.coverage.trails.pct).slice(0, 3);
    C.$("dranges").innerHTML = rs.map((r) => `<button class="drr" data-pp="ranges"><span class="drn">${C.esc(r.short || r.label)}</span><span class="bar th"><i style="width:${Math.max(2, Math.min(100, r.coverage.trails.pct))}%"></i></span><b>${C.pct(r.coverage.trails.pct)}%</b></button>`).join("") +
      (rs.length ? `<button class="drr all" data-pp="ranges"><span class="drn">Wszystkie pasma</span><svg class="chev"><use href="#i-chev"/></svg></button>` : "");
    C.$("dranges").onclick = (e) => { if (e.target.closest("[data-pp=ranges]")) { C.drawer("ranges", { push: true }); } };
    // the strip: the nearest peak of the lists still to climb; pulled up, the next few (a tap: its card, with the routes)
    peek.innerHTML = `<div class="pqa"><div class="ghd"></div><div class="glist"></div></div>`;
    fillQuickGoal();
    const got = state.result.badges || {};
    // Progress: the headline (with what is missing to the next threshold), the goals, the lists, the year, the places; the details last
    let html = `<div class="hero"><div class="hrow">${C.medal(c.trails.pct)}<b class="hbig">${C.pct(c.trails.pct)}%</b><span class="hlab">szlaków ${C.AREA.gen()}<small>${C.nf(c.trails.walkedKm)} z ${C.nf(c.trails.totalKm, 0)} km</small></span></div>` +
      `<div class="bar th"><i style="width:${Math.min(100, c.trails.pct)}%"></i></div></div>`;
    html += `<div id="goals" class="goals"></div>`;
    html += `<h5 class="sec">Odznaki</h5>`;
    // the lists begun first; the others folded under one line
    const begun = (B) => B.list.some((k) => got[`${B.id}:${k.n}`]), order = [...BADGES.filter(begun), ...BADGES.filter((B) => !begun(B))];
    const nBegun = BADGES.filter(begun).length;
    for (const [bi, B] of order.entries()) {
      const n = B.list.filter((k) => got[`${B.id}:${k.n}`]).length, all = B.list.length;
      if (bi === nBegun && bi < order.length) html += `<details class="more"><summary>Inne odznaki</summary>`;
      html += `<button class="badge" data-b="${B.id}"><img src="${vignetteURL(C.badgeIcon(B), n > 0)}" alt=""><span class="bn">${B.name}</span><span class="bc">${n} <small>/ ${all}</small> <svg class="chev"><use href="#i-chev"/></svg></span><span class="bar"><i style="width:${(100 * n) / all}%"></i></span></button>`;
    }
    if (nBegun < BADGES.length) html += `</details>`;
    // long routes: the % walked (not peaks: kilometres)
    for (const L of state.result.routes || []) {
      html += `<button class="badge route" data-route="${L.id}"><img class="patch${L.walkedKm > 0 ? "" : " off"}" src="${patchURL(L.id)}" alt=""><span class="bn">${L.name}${C.medal(L.pct)}</span><span class="bc">${C.pctTxt(L.pct)}% <small>· ${C.nf(L.walkedKm, 0)} / ${C.nf(L.km, 0)} km</small> <svg class="chev"><use href="#i-chev"/></svg></span><span class="bar"><i style="width:${Math.min(100, L.pct)}%"></i></span></button>`;
    }
    // PROTOTYPE F: GOT this year (a point a km and for 100 m up, as for stretches the PTTK tables do not list)
    {
      const y = new Date().getFullYear(), pts = state.result.activities.filter((a) => !a.outside && a.start && new Date(a.start).getFullYear() === y).reduce((g, a) => g + gotOf(a.km || 0, a.asc || 0), 0);
      const next = GOT_LEVELS.find(([p]) => p > pts), done = [...GOT_LEVELS].reverse().find(([p]) => p <= pts);
      html += `<div class="badge got"><span class="gotic">GOT</span><span class="bn">GOT ${y}${done ? ` · ${done[1]}` : ""}</span><span class="bc">${pts} <small>${next ? `/ ${next[0]} pkt` : "pkt"}</small></span><span class="bar"><i style="width:${Math.min(100, (100 * pts) / (next?.[0] || pts || 1))}%"></i></span></div>`;
    }
    const yrs = yearsOf(state.result.activities);
    if (yrs.length) html += `<button class="yearbtn" data-year="${yrs[0]}"><span>Twój ${yrs[0]} ${C.AREA.loc()}</span><svg class="chev"><use href="#i-chev"/></svg></button>`;
    const t = state.result.tally;
    html += `<h5 class="sec">Odkryte miejsca</h5><div class="tally">` + Object.keys(PLURAL).filter((k) => t[k]?.[1]).map((k) =>
      `<div data-cat="${k}"${t[k][0] ? ' role="button"' : ""}><img src="${vignetteURL(k, t[k][0] > 0)}" alt=""><b>${t[k][0]}</b><span>${PLURAL[k]}</span></div>`).join("") + `</div>`;
    html += `<button class="dl inpage" data-pp="ranges"><svg><use href="#i-peaks"/></svg><span>Pasma</span><svg class="chev"><use href="#i-chev"/></svg></button>`;
    C.$("progress").innerHTML = html;
    C.$("progress").onclick = (e) => {
      const b = e.target.closest("[data-b]")?.dataset.b;
      if (b) renderBadge(b);
      const rt = e.target.closest("[data-route]")?.dataset.route;
      if (rt) C.routeCard(rt);
      const yb = e.target.closest("[data-year]")?.dataset.year;
      if (yb) C.openYear(+yb);
      if (e.target.closest("[data-pp=ranges]")) C.drawer("ranges", { push: true });
      const g = C.goalById(e.target.closest("[data-goal]")?.dataset.goal);
      if (g) C.showGoal(g);
      const cat = e.target.closest(".tally [data-cat]")?.dataset.cat;
      if (cat && t[cat]?.[0]) { jcat = cat; renderJournal(); C.drawer("journal", { push: true }); }
    };
    C.fillGoals();
    if (state.openBadge) renderBadge(state.openBadge);
    renderRanges(); C.placeToast();
  }
  C.$("peek").addEventListener("click", (e) => {
    const q = e.target.closest("[data-qa]")?.dataset.qa;
    if (q) {
      e.stopPropagation();
      if (q === "plan") { const me = C.gps.on ? C.gpsXY() : null; C.planner.open(me && !outside(me[0], me[1], C.view.SH) ? { x: me[0], y: me[1], n: "Moja pozycja" } : null); }
      else { const g = C.goalById(e.target.closest("[data-goal]")?.dataset.goal); if (g) C.showGoal(g); }
      return;
    }
    const o = e.target.closest("[data-onb]")?.dataset.onb;
    if (!o) return;
    e.stopPropagation();
    onbGo(o);
  }, true);
  /** The first run's two ways in: files, or the Garmin link (in the settings). */
  let onbOpen = false;
  function onbGo(o) {
    if (o === "open") { onbOpen = !onbOpen; renderCard(); return; }
    if (o === "hide") { state.settings.onbHidden = true; C.saveSettings(); onbOpen = false; renderCard(); return; }
    if (o === "files") C.$("files").click();
    else C.openSettings("icurow", true);
  }

  /** The strip's goals: the nearest peaks of the lists still to climb, from my position or the middle of the map
   * (folded: the first one; pulled up: up to five). */
  function fillQuickGoal() {
    const box = C.$("peek").querySelector(".glist");
    if (!box || !C.view.meta) return;
    const me = C.gps.on ? C.gpsXY() : null, inMap = me && !outside(me[0], me[1], C.view.SH);
    const [x, y] = inMap ? me : C.view.toWorld(C.view.W / 2, C.view.H / 2);
    const G = nearest(C.goals(), x, y, 5), hd = C.$("peek").querySelector(".ghd");
    const what = "Cele w okolicy";
    if (hd.textContent !== what) hd.textContent = what;
    C.$("peek").querySelector(".pqa").classList.toggle("none", !G.length);
    // the same peaks can stay the nearest while the map moves: their distance and side change (only those touch the page)
    const ids = G.map((g) => g.id).join("|"), sub = (g) => `${distText(g.d)} ${windShort(g.deg)}`;
    if (box.dataset.ids !== ids) {
      box.dataset.ids = ids;
      box.innerHTML = G.map((g, i) => `<button class="qa goal" data-qa="goal" data-goal="${g.id}"><img src="${vignetteURL(peakIcon(C.goalProps(g)), false)}" alt=""><span><b>${String(g.n).replace(/[&<>]/g, "")} <em>${g.e} m</em></b><small><u>${sub(g)}</u></small></span><svg class="chev"><use href="#i-chev"/></svg></button>`).join("");
    } else box.querySelectorAll("u").forEach((u, i) => { const t = sub(G[i]); if (u.textContent !== t) u.textContent = t; });
  }

  /** One list (KGP, Korona Sudetów, Sudecki Włóczykij): every peak, reached or not; tap flies there. */
  function renderBadge(id) {
    const B = BADGES.find((b) => b.id === id);
    if (!B || !C.view.meta) return;
    state.openBadge = id;
    const got = state.result?.badges || {}, project = projector(C.view.meta), groups = badgeSummits(bpts() || []);
    const items = B.list.map((k) => {
      const hit = got[`${B.id}:${k.n}`], [x, y] = k.lat != null ? project(k.lon, k.lat) : [null, null];
      const grp = groups.find((g) => g.ids.includes(`${B.id}:${k.n}`)) || {};
      const inMap = C.view.onMap(x, y);
      // (the summit's lists from its group of list peaks; at least this list, also for a peak without coordinates)
      return { k, hit, x, y, inMap, p: { c: "peak", n: k.n, e: k.ele, x, y, d: !!hit, f: hit?.first ?? null, v: hit?.visits ?? 0, outs: hit?.outs || [], ...badgeFields(grp), [B.id]: k.n } };
    });
    const n = items.filter((i) => i.hit).length;
    const order = [...items].sort((a, b) => (b.hit ? 1 : 0) - (a.hit ? 1 : 0) || (b.hit && a.hit ? b.hit.first - a.hit.first : b.k.ele - a.k.ele));
    const stamps = state.settings.badgeView === "stamps";
    if (stamps && !state.stampData) { C.loadStamps().then(() => { if (state.openBadge === id) renderBadge(id); }); }
    const body = stamps
      ? `<div class="stamps2" data-b="${B.id}">` + items.map((it, i) => { // the booklet's order; pale where still to climb
        // still to climb: an empty place with the summit's name printed small, as in a paper booklet
        return it.hit ? `<button class="stampi got" data-bk="${i}" aria-label="${it.k.n}" style="--rot:${stampTilt(C.hashOf(it.k.n)).toFixed(1)}deg"><img alt=""></button>`
          : `<button class="stampi" data-bk="${i}" aria-label="${it.k.n}: jeszcze przed Tobą"><span class="slot">${it.k.n}<small>${it.k.ele} m</small></span></button>`;
      }).join("") + `</div>`
      : order.map((it, i) => `<div class="pk${it.hit ? " got" : ""}" data-i="${items.indexOf(it)}"><img src="${vignetteURL(peakIcon(it.p, B.id), !!it.hit)}" alt=""><span class="pn">${it.k.n}</span><span class="pe">${it.k.ele} m</span><span class="ps">${it.hit ? `zdobyty ${fmtDate(it.hit.first)}${it.hit.visits > 1 ? `, ${it.hit.visits}×` : ""}` : "jeszcze nie"}${it.inMap ? "" : " · poza mapą"}</span></div>`).join("");
    C.$("progress").innerHTML = `<div class="bhead"><button class="iconbtn" id="bback" aria-label="Wróć"><svg><use href="#i-back"/></svg></button><div><h4>${B.name}</h4><div class="tk">zdobyte ${n} z ${B.list.length}</div></div><div class="seg" id="bview"><button data-v="list" class="${stamps ? "" : "on"}">Lista</button><button data-v="stamps" class="${stamps ? "on" : ""}">Pieczątki</button></div></div>` +
      `<button class="bkopen" data-bk="-1"><img src="${vignetteURL(C.badgeIcon(B), true)}" alt=""><span>Książeczka ${B.name}<small>strona na każdy szczyt, pieczątka z każdego wejścia</small></span><svg class="chev"><use href="#i-chev"/></svg></button>` + body;
    if (stamps && state.stampData) { // the prints, one by one as each is drawn (the ones reached first)
      const btns = [...C.$("progress").querySelectorAll(".stampi")];
      const order = items.map((it, i) => i).filter((i) => items[i].hit);
      (async () => { for (const i of order) { const im = btns[i]?.querySelector("img"); if (state.openBadge !== id || !im?.isConnected) return; const it = items[i]; im.src = await stampPNG(C.stampRec(it.k), { name: it.k.n, ele: it.k.ele, list: B.id, date: fmtDate(it.hit.first), seed: C.hashOf(it.k.n) }, 220); } })();
    }
    C.$("bview").onclick = (e) => { const v = e.target.closest("[data-v]")?.dataset.v; if (v) { state.settings.badgeView = v; C.saveSettings(); renderBadge(id); } };
    C.$("bback").onclick = (e) => { e.stopPropagation(); state.openBadge = null; renderCard(); };
    C.$("progress").onclick = (e) => {
      const bk = e.target.closest("[data-bk]");
      if (bk) { C.openBooklet(B.id, +bk.dataset.bk + 1); return; }
      const r = e.target.closest(".pk, .stamp");
      if (!r) return;
      const it = items[+r.dataset.i];
      if (it.x == null) return;
      C.fromList("progress", B.name);
      C.sheet("peek");
      showTip(it.p); C.flyView(() => C.centerFree(it.x, it.y, 8));
    };
  }

  /** Per-range stats (pasma), best first; tap flies there. */
  function renderRanges() {
    const box = C.$("ranges");
    const list = (state.result?.ranges || C.view.ranges?.map((r) => ({ id: r.id, label: r.label, short: r.short })) || []).map((r) => ({ ...r, pct: r.coverage?.trails.pct || 0 }));
    list.sort((a, b) => b.pct - a.pct || a.short.localeCompare(b.short, "pl"));
    // the ranges walked in (best first), then the ones not yet: folded, one line each
    const been = (r) => r.coverage && (r.coverage.trails.walkedKm > 0 || Object.values(r.tally || {}).some((v) => v[0] > 0));
    const row = (r) => {
      const c = r.coverage, t = r.tally || {};
      const peaks = t.peak ? `, szczyty ${t.peak[0]} z ${t.peak[1]}` : "";
      return `<div class="rr" data-id="${r.id}"><span class="rn">${c ? C.medal(c.trails.pct) : ""}${r.label}</span><span class="rp">${c ? C.pct(c.trails.pct) + "%" : ""}</span>` +
        (c ? `<span class="bar th"><i style="width:${Math.min(100, c.trails.pct)}%"></i></span><div class="rs">szlaki ${C.nf(c.trails.walkedKm)} z ${C.nf(c.trails.totalKm, 0)} km${peaks}</div><div class="rs nx">${C.missing(c)}</div>` : "") + `</div>`;
    };
    const rest = list.filter((r) => !been(r));
    box.innerHTML = list.filter(been).map(row).join("") + (rest.length ? `<details class="rnot"${list.some(been) ? "" : " open"}><summary>Jeszcze nie byłeś <small>${rest.length}</small></summary>` +
      rest.sort((a, b) => a.label.localeCompare(b.label, "pl")).map((r) => `<div class="rr lite" data-id="${r.id}"><span class="rn">${r.label}</span><span class="rs">${r.coverage ? `${C.nf(r.coverage.trails.totalKm, 0)} km szlaków${r.tally?.peak ? ` · ${r.tally.peak[1]} szczytów` : ""}` : ""}</span></div>`).join("") + `</details>` : "");
    box.onclick = (e) => {
      const r = C.view.ranges.find((q) => q.id === e.target.closest(".rr")?.dataset.id);
      if (!r) return;
      C.fromList("ranges", "Pasma");
      C.sheet("peek");
      C.flyView(() => C.view.fitBox(...r.bbox, 30));
      showRange(r);
    };
  }

  function showRange(r) {
    const s = state.result?.ranges?.find((q) => q.id === r.id);
    let html = `<h4>${r.label}</h4>`;
    if (s) {
      const c = s.coverage;
      html += `<div class="tk">szlaki ${C.nf(c.trails.walkedKm)} z ${C.nf(c.trails.totalKm, 0)} km (${C.pct(c.trails.pct)}%), odkryto ${C.pct(s.discoveredPct)}% terenu</div>`;
      const row = Object.keys(PLURAL).filter((k) => s.tally[k]?.[1]).map((k) => `<span>${PLURAL[k]} ${s.tally[k][0]}/${s.tally[k][1]}</span>`).join("");
      if (row) html += `<div class="tags">${row}</div>`;
    }
    C.openTip(html, null, `r:${r.id}`, { label: r.label, reopen: () => showRange(r) });
  }

  function bpts() { return badgePts ||= C.view.meta ? badgePoints(projector(C.view.meta)) : null; }
  /** The badge lists' peak at (x, y) (within R m): {k: "kyr" letters of its lists, d: reached, n}, or null. */
  function medalsAt(x, y, R = 160) {
    const S = (state.summits ||= bpts() ? badgeSummits(bpts()) : null);
    if (!S) return null;
    let best = null, bd = R;
    for (const s of S) { const d = Math.hypot(s.x - x, s.y - y); if (d < bd) { bd = d; best = s; } }
    if (!best) return null;
    const got = state.result?.badges || {};
    return { k: medalLetters(best), d: best.ids.some((id) => got[id]), n: best.n };
  }

  /** Everything reached: discovered points + list peaks reached that have no OSM
   * peak in the map (outside it, or not mapped as a peak). */
  function discoveredList() {
    const pts = bpts() || [], covered = new Set(), got = state.result?.badges || {};
    const list = Object.entries(state.result?.found || {}).map(([id, f]) => {
      const b = badgesOf(f, pts);
      for (const i of b?.ids || []) covered.add(i);
      return { id, c: f.c, n: f.n, e: f.e, x: f.x, y: f.y, s: mapLabel(f.n), d: true, f: f.first, v: f.visits, ...badgeFields(b) };
    });
    for (const k of badgeSummits(pts)) {
      const hits = k.ids.map((i) => got[i]).filter(Boolean);
      if (!hits.length || k.ids.some((i) => covered.has(i))) continue;
      list.push({ id: k.id, c: "peak", n: k.n, e: k.e, x: k.x, y: k.y, s: mapLabel(k.n), d: true, f: Math.min(...hits.map((h) => h.first)), v: Math.max(...hits.map((h) => h.visits)), ...badgeFields(k), syn: true });
    }
    return list.sort((a, b) => b.f - a.f || (a.n || "").localeCompare(b.n || ""));
  }

  function renderJournal() {
    const all = discoveredList(), box = C.$("journal");
    const kinds = Object.keys(PLURAL).filter((k) => all.some((p) => p.c === k));
    if (jcat !== "all" && !kinds.includes(jcat)) jcat = "all";
    // the order: by date (newest first) or by height (highest first); the same again turns it round
    const js = state.settings.placeSort === "e" ? "e" : "f", jasc = !!state.settings.placeAsc, kv = (p) => (js === "e" ? p.e ?? null : p.f ?? null);
    const found = (jcat === "all" ? all : all.filter((p) => p.c === jcat)).slice();
    found.sort((a, b) => { const x = kv(a), y = kv(b); if (x == null || y == null) return x == null ? (y == null ? 0 : 1) : -1; return jasc ? x - y : y - x; });
    const sortRow = all.length > 1 ? `<div class="seg osort jsort">${[["f", "Data"], ["e", "Wysokość"]].map(([k, l]) => `<button data-js="${k}" class="${k === js ? "on" : ""}">${l}${k === js ? ` <span class="dir">${jasc ? "↑" : "↓"}</span>` : ""}</button>`).join("")}</div>` : "";
    const chips = all.length && kinds.length > 1 ? `<div class="jcats">${[["all", "Wszystko", all.length], ...kinds.map((k) => [k, PLURAL[k][0].toUpperCase() + PLURAL[k].slice(1), all.filter((p) => p.c === k).length])].map(([k, l, n]) => `<button data-cat="${k}" class="${k === jcat ? "on" : ""}">${l} <small>${n}</small></button>`).join("")}</div>` : "";
    C.$("jcnt").textContent = all.length || "";
    box.innerHTML = chips + sortRow + (found.length
      ? found.map((p, i) => `<div class="jr" data-i="${i}"><img src="${VIGNETTES[peakIcon(p)] ? vignetteURL(peakIcon(p), true) : glyphURL(p.c)}" class="${VIGNETTES[peakIcon(p)] ? "" : "gl"}" alt=""><span class="jn">${shortName(p.n || NAMES[p.c])}</span><span class="je">${p.e ? Math.round(p.e) + " m" : ""}</span><span class="jd">${p.n ? `${NAMES[p.c]}, ` : ""}${fmtDate(p.f)}</span></div>`).join("")
      : `<p class="empty">Jeszcze nic. Szczyty, schroniska i wieże pojawią się tu, gdy do nich dotrzesz.</p>`);
    box.onclick = (e) => {
      const cat = e.target.closest("[data-cat]")?.dataset.cat;
      if (cat) { jcat = cat; renderJournal(); return; }
      const so = e.target.closest("[data-js]")?.dataset.js;
      if (so) { if (so === js) state.settings.placeAsc = !jasc; else { state.settings.placeSort = so; state.settings.placeAsc = false; } C.saveSettings(); renderJournal(); return; }
      const r = e.target.closest(".jr");
      if (!r) return;
      const p = found[+r.dataset.i];
      C.fromList("journal", "Miejsca");
      C.sheet("peek");
      showTip(p); C.flyView(() => C.centerFree(p.x, p.y));
    };
  }

  function showTip(p) {
    if (p.on) p = p.on.e == null && p.e != null ? { ...p.on, e: p.e } : p.on; // (the height known for the place, not a guess from the terrain)
    const nm = p.n ? shortName(p.n) : p.c === "junction" ? "Rozdroże szlaków" : NAMES[p.c];
    const cols = p.c === "junction" && p.cols ? `<span class="jcols">${p.cols.split(",").map((c) => `<i style="background:${TRAIL_CSS[c] || "#777"}"></i>`).join("")}</span>` : "";
    const kind = p.c === "ferrata" ? `via ferrata${p.s ? ` ${C.esc(String(p.s).toUpperCase())}` : ""}` : p.n ? "" : null; // (unnamed: the kind is the name)
    let html = `<h4>${nm}<span class="el hel">${p.e ? ` ${Math.round(p.e)} m` : ""}</span></h4>${kind || cols ? `<div class="tk">${kind || ""}${cols}</div>` : ""}`;
    const outs = p.outs || state.result?.found?.[p.id]?.outs || (p.syn ? state.result?.badges?.[p.id]?.outs : null) || [];
    if (p.d && outs.length) html += C.visitRows(outs);
    else if (p.d) html += `<div class="tl">Odkryte ${fmtDate(p.f)}${p.v > 1 ? `, byłeś tu ${p.v}×` : ""}</div>`;
    else if (p.c === "parking") html += p.fee != null ? `<div class="tl">${p.fee ? "Płatny" : "Bezpłatny"}</div>` : "";
    for (const q of p.a || []) html += `<div class="tl">+ ${q.s || NAMES[q.c]}: ${q.d ? "odkryte " + fmtDate(q.f) : "nieodkryte"}</div>`;
    // the badge lists of this summit: a tap opens the list (its booklet's page in Postęp)
    const tags = [];
    for (const L of listsOf(p)) {
      const name = L.id === "kgp" ? (() => { const k = KGP.find((q) => q.n === p.kgp); return `Korona Gór Polski${k ? `, ${k.range}` : ""}`; })() : L.name;
      tags.push(`<button class="btag" data-list="${L.id}">${MEDAL_OF[L.id] ? `<img src="${medalURL(MEDAL_OF[L.id], !!p.d)}" alt="">` : ""}<span>${name}</span><svg class="chev"><use href="#i-chev"/></svg></button>`);
    }
    if (tags.length) html += `<div class="tags">${tags.join("")}</div>`;
    // a summit with no way to it: where it is ticked from
    const acc = p.c === "peak" && p.x != null ? accessOf(p, accessData, (bpts() || []).filter((k) => k.ax != null && Math.hypot(k.x - p.x, k.y - p.y) < 400)) : null;
    if (acc) {
      const dir = windShort(bearingOf(p.x, p.y, acc.x, acc.y));
      html += `<div class="tl acc">Na wierzchołek nie prowadzi ścieżka: zaliczasz go ${acc.own ? `przy ${acc.note || "punkcie na szlaku"}` : "ze szlaku obok"}, ${distText(acc.d)} na ${dir}${acc.drop != null ? `, ok. ${acc.drop} m niżej` : ""}.</div>`;
    }
    if (p.c === "place") html += `<div class="pvis"><div class="tk">Szukam wyjść przez ${shortName(p.n)}…</div></div>`;
    const key = `p:${p.id ?? p.n}`;
    const flat = p.c === "place" || p.c === "station" || p.c === "parking" || p.c === "junction";
    const pin = p.x != null ? [p.x, p.y, flat ? "place" : "poi", glyphKey(p), !!p.d, p.e ? `${Math.round(p.e)} m` : null] : null;
    C.openTip(html, null, key, { label: nm, pin, reopen: () => showTip(p) });
    C.$("tip").querySelectorAll("[data-list]").forEach((b) => (b.onclick = () => { C.drawer("progress"); renderBadge(b.dataset.list); }));
    if (!p.e && p.x != null) C.fillElev(key, p.x, p.y, (r) => { if (pin && state.cur?.key === key) { pin[5] = `${r.h} m`; C.view.setPin([...pin]); } return ` ~${r.h} m`; });
    if (p.c === "place" && p.x != null) C.placeVisits(p, key);
    // planning only where the maps have paths (a town far from the mountains: just the way there)
    if (p.x == null || !String(p.id || "").startsWith("bd:") || C.view.onMap(p.x, p.y, 4000)) C.addPlanFrom(p.x != null ? { x: p.x, y: p.y, n: p.n || null, id: p.id } : null);
    if (p.x != null && p.c !== "junction" && !(C.planner.isActive() && !C.planner.drafting())) C.addActs([{ icon: "map", label: "Dojazd", more: true, fn: () => C.directions(p.x, p.y, p.n) }]); // (walking a route: no driving there)
    if (acc) C.addActs([{ icon: "nav", label: "Pokaż dojście", fn: () => { C.view.setPin([acc.x, acc.y, "poi"]); C.flyView(() => C.fitAbove(Math.min(p.x, acc.x), Math.min(p.y, acc.y), Math.max(p.x, acc.x), Math.max(p.y, acc.y))); } }]);
  }
  // access points of summits with no way to them (tools/access.mjs; optional)
  function accessReady() { return Promise.all(packList(absSpec(state.regionBase)).map((p) => fetch(packUrl(p.base, "access.json")).then((r) => (r.ok ? r.json() : null)).catch(() => null))).then((l) => (accessData = mergeSide(l))); }

  return { accessReady, bpts, fillQuickGoal, medalsAt, renderCard, renderJournal, showRange, showTip };
}
