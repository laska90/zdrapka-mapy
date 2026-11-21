// progress: the figures on the sheet, the progress page, a badge's peaks, ranges, the places reached, a place's card
// (moved out of app.js: what it needs of the app comes in C, see createX in app.js)
import { state } from "./state.js";
import { GOT_LEVELS, gotOf } from "../core/notices.js";
import { BADGES, badgeFields, badgePoints, badgeSummits, badgesOf, listsOf } from "../core/badges.js";
import { yearsOf } from "../core/year.js";
import { NAMES, PLURAL, fmtDate, mapLabel, shortName } from "./labels.js";
import { bearing as bearingOf, distText, nearest, outside, windShort } from "../core/hud.js";
import { projector } from "../core/pack.js";
import { glyphKey, glyphURL, medalLetters } from "./glyphs.js";
import { TC as TRAIL_CSS } from "./glstyle.js";
import { accessOf } from "../core/access.js";
import { mergeSide, packList, packUrl } from "../core/packs.js";
import { absSpec } from "./glmap.js";
import { badgeSVG, ringHTML, ringSVG, seasonsOf, thresholdBar, trailSVG, visitsTag } from "./marks.js";

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
        (onbOpen ? `<div class="onb onbch"><button class="btn primary" data-onb="files"><svg><use href="#i-plus"/></svg><span>Z plików<small>GPX, FIT, TCX, eksport z Garmina albo Stravy</small></span></button><button class="btn" data-onb="draw"><svg><use href="#i-route"/></svg><span>Narysuj na mapie<small>bez zegarka: zaznacz trasę, którą przeszedłeś</small></span></button><button class="btn" data-onb="icu"><svg><use href="#i-sync"/></svg><span>Połącz z Garminem<small>nowe wyjścia przyjdą same</small></span></button></div>` : "");
      C.$("sheet").classList.toggle("bare", !!state.settings.onbHidden);
      // Progress before the first outing: where you stand (0%) and the two ways in, not an empty page
      const onb = `<div class="onb"><button class="btn primary" data-onb="files"><svg><use href="#i-plus"/></svg> Dodaj wyjścia</button><button class="btn" data-onb="draw"><svg><use href="#i-route"/></svg> Narysuj na mapie</button><button class="btn" data-onb="icu"><svg><use href="#i-sync"/></svg> Połącz z Garminem</button></div>`;
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
    let html = `<div class="hero"><div class="hrow"><b class="hbig">${C.pct(c.trails.pct)}%</b><span class="hlab">szlaków ${C.AREA.gen()}<small>${C.nf(c.trails.walkedKm)} z ${C.nf(c.trails.totalKm, 0)} km</small></span></div>` +
      `<div class="thwrap">${thresholdBar(c.trails.pct)}</div></div>`; // (the thresholds: the bar's four parts)
    html += `<div id="goals" class="goals"></div>`;
    html += `<h5 class="sec">Odznaki</h5>`;
    // the lists begun first; the others folded under one line; each its landscape, "23 / 28" once, a thin bar
    const begun = (B) => B.list.some((k) => got[`${B.id}:${k.n}`]), order = [...BADGES.filter(begun), ...BADGES.filter((B) => !begun(B))];
    const nBegun = BADGES.filter(begun).length;
    for (const [bi, B] of order.entries()) {
      const n = B.list.filter((k) => got[`${B.id}:${k.n}`]).length, all = B.list.length;
      if (bi === nBegun && bi < order.length) html += `<details class="more"><summary>Inne odznaki</summary>`;
      html += `<button class="badge" data-b="${B.id}">${badgeSVG(B.id, 40, n > 0)}<span class="bn">${B.name}</span><span class="bc">${n} <small>/ ${all}</small> <svg class="chev"><use href="#i-chev"/></svg></span><span class="bar"><i style="width:${(100 * n) / all}%"></i></span></button>`;
    }
    if (nBegun < BADGES.length) html += `</details>`;
    // long routes: the % walked (not peaks: kilometres)
    for (const L of state.result.routes || []) {
      html += `<button class="badge route" data-route="${L.id}">${trailSVG(40, "#d0202a", L.walkedKm > 0)}<span class="bn">${L.name}</span><span class="bc">${C.pctTxt(L.pct)}% <small>· ${C.nf(L.walkedKm, 0)} / ${C.nf(L.km, 0)} km</small> <svg class="chev"><use href="#i-chev"/></svg></span><span class="thb-row">${thresholdBar(L.pct)}</span></button>`;
    }
    // GOT this year (a point a km and for 100 m up, as for stretches the PTTK tables do not list)
    {
      const y = new Date().getFullYear(), pts = state.result.activities.filter((a) => !a.outside && a.start && new Date(a.start).getFullYear() === y).reduce((g, a) => g + gotOf(a.km || 0, a.asc || 0), 0);
      const next = GOT_LEVELS.find(([p]) => p > pts), done = [...GOT_LEVELS].reverse().find(([p]) => p <= pts);
      html += `<div class="badge got"><span class="gotic">GOT</span><span class="bn">GOT ${y}${done ? ` · ${done[1]}` : ""}</span><span class="bc">${pts} <small>${next ? `/ ${next[0]} pkt` : "pkt"}</small></span><span class="bar"><i style="width:${Math.min(100, (100 * pts) / (next?.[0] || pts || 1))}%"></i></span></div>`;
    }
    // more: everything together, the year, the places reached, the ranges
    const yrs = yearsOf(state.result.activities), t = state.result.tally || {}, nFound = Object.values(t).reduce((q, v) => q + (v?.[0] || 0), 0);
    const row = (data, icon, label, cnt = "") => `<button class="dl inpage" ${data}><svg><use href="#${icon}"/></svg><span>${label}</span>${cnt ? `<em class="cnt">${cnt}</em>` : ""}<svg class="chev"><use href="#i-chev"/></svg></button>`;
    html += `<h5 class="sec">Więcej</h5>`;
    if (yrs.length > 1) html += row(`data-all="1"`, "i-medal", "Wszystko razem", `od ${yrs[yrs.length - 1]}`);
    if (yrs.length) html += row(`data-year="${yrs[0]}"`, "i-steps", `Twój ${yrs[0]}`);
    html += row(`data-pp="journal"`, "i-pin", "Odkryte miejsca", nFound || "");
    html += row(`data-pp="ranges"`, "i-peaks", "Pasma");
    C.$("progress").innerHTML = html;
    C.$("progress").onclick = (e) => {
      const b = e.target.closest("[data-b]")?.dataset.b;
      if (b) renderBadge(b);
      const rt = e.target.closest("[data-route]")?.dataset.route;
      if (rt) C.routeCard(rt);
      const yb = e.target.closest("[data-year]")?.dataset.year;
      if (yb) C.openYear(+yb);
      if (e.target.closest("[data-pp=ranges]")) C.drawer("ranges", { push: true });
      if (e.target.closest("[data-pp=journal]")) { jcat = "kinds"; renderJournal(); C.drawer("journal", { push: true }); }
      if (e.target.closest("[data-all]")) C.openAll();
      const g = C.goalById(e.target.closest("[data-goal]")?.dataset.goal);
      if (g) C.showGoal(g);
    };
    C.fillGoals();
    if (state.openBadge) renderBadge(state.openBadge);
    else if (state.openRoute) C.routeCard(state.openRoute);
    renderRanges(); C.placeToast();
  }
  C.$("peek").addEventListener("click", (e) => {
    const q = e.target.closest("[data-qa]")?.dataset.qa;
    if (q) {
      e.stopPropagation();
      if (q === "plan") { const me = C.gps.on ? C.gpsXY() : null; C.planner.open(me && !outside(me[0], me[1], C.view.SH) ? { x: me[0], y: me[1], n: "Moja pozycja" } : null); }
      else { const id = e.target.closest("[data-goal]")?.dataset.goal, g = nearNow.find((q) => q.id === id) || C.goalById(id); if (g) C.showGoal(g); }
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
    else if (o === "draw") C.drawOuting();
    else C.openSettings("icurow", true);
  }

  let nearNow = [];
  /** The strip's goals: the nearest peaks of the lists still to climb, from my position or the middle of the map
   * (folded: the first one; pulled up: up to five). */
  function fillQuickGoal() {
    const box = C.$("peek").querySelector(".glist");
    if (!box || !C.view.meta) return;
    const me = C.gps.on ? C.gpsXY() : null, inMap = me && !outside(me[0], me[1], C.view.SH);
    const [x, y] = inMap ? me : C.view.toWorld(C.view.W / 2, C.view.H / 2);
    const G = (nearNow = nearest(C.goals(), x, y, 5)), hd = C.$("peek").querySelector(".ghd");
    const what = "Najbliżej do zdobycia";
    if (hd.textContent !== what) hd.textContent = what;
    C.$("peek").querySelector(".pqa").classList.toggle("none", !G.length);
    // the same peaks can stay the nearest while the map moves: their distance and side change (only those touch the page)
    const ids = G.map((g) => g.id).join("|"), sub = (g) => `${distText(g.d)} ${windShort(g.deg)}`;
    if (box.dataset.ids !== ids) {
      box.dataset.ids = ids;
      // a grey ring (not been there), the name and height, how far; on the right the badge it is missing for
      box.innerHTML = G.map((g) => { const L = listsOf(g)[0]; return `<button class="qa goal" data-qa="goal" data-goal="${g.id}">${ringSVG([], 44)}<span><b>${String(g.n).replace(/[&<>]/g, "")} <em>${g.e} m</em></b><small><u>${sub(g)}</u></small></span>${L ? badgeSVG(L.id, 30) : ""}<svg class="chev"><use href="#i-chev"/></svg></button>`; }).join("");
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
    // how far a peak still to climb is: from you (out there) or from the middle of the map
    const me = C.gps.on && C.gps.fix ? C.gpsXY() : null, [cx, cy] = me && !outside(me[0], me[1], C.view.SH) ? me : C.view.toWorld(C.view.W / 2, C.view.H / 2);
    const fact = (it) => (it.hit ? fmtDate(it.hit.first) + visitsTag(it.hit.outs) : it.x != null ? `${distText(Math.hypot(it.x - cx, it.y - cy))} ${windShort(bearingOf(cx, cy, it.x, it.y))}` : "");
    const row = (it) => `<button class="pk${it.hit ? " got" : ""}" data-i="${items.indexOf(it)}">${ringHTML(it.hit?.outs || [], 40, !!it.hit)}<span class="pn">${C.esc(it.k.n)}</span><span class="pe">${it.k.ele} m</span><span class="ps">${fact(it)}</span></button>`;
    const done = order.filter((it) => it.hit), todo = items.filter((it) => !it.hit).sort((a, b) => (a.x == null) - (b.x == null) || Math.hypot(a.x - cx, a.y - cy) - Math.hypot(b.x - cx, b.y - cy));
    const list = (done.length ? `<h5 class="sec">Zdobyte · ${done.length}</h5>${done.map(row).join("")}` : "") + (todo.length ? `<h5 class="sec">Do zdobycia · ${todo.length}</h5>${todo.map(row).join("")}` : "");
    C.$("progress").innerHTML = `<div class="bhead"><button class="iconbtn" id="bback" aria-label="Wróć"><svg><use href="#i-back"/></svg></button>${badgeSVG(B.id, 44, n > 0)}<div><h4>${B.name}</h4><div class="tk">${n} z ${B.list.length}</div></div></div>` +
      `<div class="bacts"><button class="btn" data-bshow><svg><use href="#i-map"/></svg><span>Pokaż na mapie</span></button></div>` + list;
    C.$("progress").closest(".dbody")?.scrollTo?.(0, 0); // (its page from the top)
    C.$("bback").onclick = (e) => { e.stopPropagation(); state.openBadge = null; renderCard(); };
    C.$("progress").onclick = (e) => {
      if (e.target.closest("[data-bshow]")) {
        // its summits on the real map (they are drawn there with the sign A, dark or violet), a chip back to the page
        const pts = items.filter((it) => it.x != null && C.view.onMap(it.x, it.y));
        if (!pts.length) return;
        C.drawer(false);
        const xs = pts.map((it) => it.x), ys = pts.map((it) => it.y);
        C.flyView(() => C.fitAbove(Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)));
        C.view.setMarks?.(pts.map((it) => ({ x: it.x, y: it.y, n: shortName(it.k.n), e: it.k.ele, d: !!it.hit, key: glyphKey(it.p) })));
        mapChip({ icon: badgeSVG(B.id, 28, n > 0), label: `${B.name} · ${n} z ${B.list.length}`, open: () => { C.drawer("progress"); renderBadge(id); }, off: () => C.view.setMarks?.(null) });
        return;
      }
      const r = e.target.closest("[data-i]");
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
      return `<div class="rr" data-id="${r.id}"><span class="rn">${r.label}</span><span class="rp">${c ? C.pct(c.trails.pct) + "%" : ""}</span>` +
        (c ? `<span class="thb-row">${thresholdBar(c.trails.pct)}</span><div class="rs">szlaki ${C.nf(c.trails.walkedKm)} z ${C.nf(c.trails.totalKm, 0)} km${peaks}</div><div class="rs nx">${C.missing(c)}</div>` : "") + `</div>`;
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

  /** Odkryte miejsca: by kind (how many of each, the latest reached) or by range; a kind opens its list; "Pokaż na
   * mapie" leaves only the places reached on the map. */
  function renderJournal() {
    const all = discoveredList(), box = C.$("journal"), t = state.result?.tally || {};
    C.$("jcnt").textContent = all.length || "";
    if (!all.length) { box.innerHTML = `<p class="empty">Jeszcze nic. Szczyty, schroniska i wieże pojawią się tu, gdy do nich dotrzesz.</p>`; box.onclick = null; return; }
    if (jcat === "all") jcat = "kinds";
    const cap = (k) => PLURAL[k][0].toUpperCase() + PLURAL[k].slice(1);
    const icon = (p) => (p.c === "peak" ? ringHTML(state.result?.found?.[p.id]?.outs || state.result?.badges?.[p.id]?.outs || [], 34, true) : `<span class="jgl"><img src="${glyphURL(glyphKey(p), true)}" alt=""></span>`);
    const row = (p, i) => `<div class="jr" data-i="${i}">${icon(p)}<span class="jn">${shortName(p.n || NAMES[p.c])}</span><span class="je">${p.e ? Math.round(p.e) + " m" : ""}</span><span class="jd">${p.n && p.c !== "peak" ? `${NAMES[p.c]} · ` : ""}${fmtDate(p.f)}${p.c === "peak" ? visitsTag(state.result?.found?.[p.id]?.outs || state.result?.badges?.[p.id]?.outs) : ""}</span></div>`;
    const seg = `<div class="seg jseg">${[["kinds", "Rodzaje"], ["ranges", "Pasma"]].map(([k, l]) => `<button data-jm="${k}" class="${jcat === k || (k === "kinds" && PLURAL[jcat]) ? "on" : ""}">${l}</button>`).join("")}</div>`;
    const showBtn = `<button class="btn jshow" data-show><svg style="margin-right:6px"><use href="#i-map"/></svg><span>Pokaż na mapie</span></button>`;
    let h = seg, shown = [];
    if (jcat === "kinds") {
      const kinds = Object.keys(PLURAL).filter((k) => t[k]?.[1]);
      h += kinds.map((k) => `<button class="jk" data-cat="${k}"><span class="jgl"><img src="${glyphURL(k, (t[k][0] || 0) > 0)}" alt=""></span><span class="jkn">${cap(k)}</span><span class="jkc"><b>${t[k][0]}</b> z ${C.nf(t[k][1], 0)}</span><span class="bar"><i style="width:${Math.max(t[k][0] ? 1.5 : 0, (100 * t[k][0]) / t[k][1])}%"></i></span></button>`).join("");
      shown = all.slice(0, 8);
      h += showBtn + `<h5 class="sec">Ostatnio odkryte</h5>` + shown.map(row).join("");
    } else if (jcat === "ranges") {
      const rs = (state.result?.ranges || []).map((r) => { const tt = r.tally || {}, f = Object.values(tt).reduce((q, v) => q + (v?.[0] || 0), 0), n = Object.values(tt).reduce((q, v) => q + (v?.[1] || 0), 0); return { r, tt, f, n }; }).filter((q) => q.n);
      rs.sort((a, b) => b.f - a.f || a.r.label.localeCompare(b.r.label, "pl"));
      h += rs.map(({ r, tt, f, n }) => `<button class="jk rng" data-rid="${r.id}"><span class="jkn">${r.label}</span><span class="jkc"><b>${f}</b> z ${n}</span><span class="bar"><i style="width:${Math.max(f ? 1.5 : 0, (100 * f) / n)}%"></i></span>${f ? `<span class="jkd">${Object.keys(PLURAL).filter((k) => tt[k]?.[0]).map((k) => `${PLURAL[k]} ${tt[k][0]}/${tt[k][1]}`).join(" · ")}</span>` : ""}</button>`).join("") + showBtn;
    } else {
      // one kind: its places, by date or by height (the same again turns it round)
      const js = state.settings.placeSort === "e" ? "e" : "f", jasc = !!state.settings.placeAsc, kv = (p) => (js === "e" ? p.e ?? null : p.f ?? null);
      shown = all.filter((p) => p.c === jcat);
      shown.sort((a, b) => { const x = kv(a), y = kv(b); if (x == null || y == null) return x == null ? (y == null ? 0 : 1) : -1; return jasc ? x - y : y - x; });
      h = `<div class="jhd"><button class="iconbtn" data-jm="kinds" aria-label="Wróć"><svg><use href="#i-back"/></svg></button><b>${cap(jcat)}</b><small>${shown.length} z ${C.nf(t[jcat]?.[1] || shown.length, 0)}</small></div>` +
        (shown.length > 1 ? `<div class="seg osort jsort">${[["f", "Data"], ["e", "Wysokość"]].map(([k, l]) => `<button data-js="${k}" class="${k === js ? "on" : ""}">${l}${k === js ? ` <span class="dir">${jasc ? "↑" : "↓"}</span>` : ""}</button>`).join("")}</div>` : "") + shown.map(row).join("");
    }
    box.innerHTML = h;
    box.onclick = (e) => {
      const m = e.target.closest("[data-jm]")?.dataset.jm;
      if (m) { jcat = m; renderJournal(); box.scrollIntoView?.({ block: "start" }); return; }
      const cat = e.target.closest("[data-cat]")?.dataset.cat;
      if (cat) { jcat = cat; renderJournal(); return; }
      if (e.target.closest("[data-show]")) { showFound(true); C.drawer(false); return; }
      const rid = e.target.closest("[data-rid]")?.dataset.rid, rr = rid && C.view.ranges.find((q) => q.id === rid);
      if (rr) { C.fromList("journal", "Odkryte miejsca"); C.sheet("peek"); C.flyView(() => C.view.fitBox(...rr.bbox, 30)); showRange(rr); return; }
      const so = e.target.closest("[data-js]")?.dataset.js;
      if (so) { if (so === (state.settings.placeSort === "e" ? "e" : "f")) state.settings.placeAsc = !state.settings.placeAsc; else { state.settings.placeSort = so; state.settings.placeAsc = false; } C.saveSettings(); renderJournal(); return; }
      const r = e.target.closest(".jr");
      if (!r) return;
      const p = shown[+r.dataset.i];
      C.fromList("journal", "Odkryte miejsca");
      C.sheet("peek");
      showTip(p); C.flyView(() => C.centerFree(p.x, p.y));
    };
  }
  /** Only the places reached on the map (the others' signs and names hidden), with a chip to end it. */
  function showFound(on) {
    C.view.onlyFound?.(on);
    if (on) mapChip({ icon: `<span class="jgl sm"><img src="${glyphURL("peak", true)}" alt=""></span>`, label: `Odkryte miejsca · ${discoveredList().length}`, open: () => C.drawer("journal"), off: () => C.view.onlyFound?.(false) });
  }
  /** One chip under the top of the map for what a page put there (a badge's summits, a route, the places reached):
   * a tap back to the page, ✕ ends it. null: none. */
  let chipOff = null;
  function mapChip(o) {
    let el = C.$("mapchip");
    const off = chipOff; chipOff = null; off?.();
    if (!o) { el?.remove(); return; }
    if (!el) { el = document.createElement("div"); el.id = "mapchip"; document.body.append(el); }
    chipOff = o.off || null;
    el.innerHTML = `<div class="crewchip"><button class="cmain" data-open>${o.icon || ""}<b>${C.esc(o.label)}</b></button><button class="cx" data-off aria-label="Zakończ"><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg></button></div>`;
    el.querySelector("[data-open]").onclick = () => o.open?.();
    el.querySelector("[data-off]").onclick = () => mapChip(null);
  }

  /** The bottom card of a peak or a place: folded, its ring (a peak; a place: its sign), the name and height, under
   * it only facts (how far, what kind); the last walk there (its card: Replay 3D), the badges as chips with their
   * progress; Trasa and ⋯. Pulled up: the big ring, every walk there with ▶ (Replay of that walk), the badges. */
  function showTip(p) {
    if (p.on) p = p.on.e == null && p.e != null ? { ...p.on, e: p.e } : p.on; // (the height known for the place, not a guess from the terrain)
    const nm = p.n ? shortName(p.n) : p.c === "junction" ? "Rozdroże szlaków" : NAMES[p.c];
    const cols = p.c === "junction" && p.cols ? `<span class="jcols">${p.cols.split(",").map((c) => `<i style="background:${TRAIL_CSS[c] || "#777"}"></i>`).join("")}</span>` : "";
    const kind = p.c === "ferrata" ? `via ferrata${p.s ? ` ${C.esc(String(p.s).toUpperCase())}` : ""}` : p.n && p.c !== "peak" ? NAMES[p.c] || "" : ""; // (unnamed: the kind is the name)
    const outs = p.outs || state.result?.found?.[p.id]?.outs || (p.syn ? state.result?.badges?.[p.id]?.outs : null) || [];
    const byDate = [...outs].sort((a, b) => b[1] - a[1]), peak = p.c === "peak";
    // how far, from you (out there) or from where the goal was reckoned
    const me = C.gps.on && C.gps.fix ? C.gpsXY() : null;
    const far = p.x == null ? null : me && Math.hypot(me[0] - p.x, me[1] - p.y) > 150 ? [Math.hypot(me[0] - p.x, me[1] - p.y), bearingOf(me[0], me[1], p.x, p.y)] : p.dist != null ? [p.dist, p.deg] : null;
    const farTxt = far ? `${distText(far[0])} ${windShort(far[1])}` : "";
    const range = p.x != null && (peak || p.c === "pass") ? C.view.rangeOf?.(p.x, p.y)?.label || "" : "";
    const mark = peak ? ringHTML(outs, 52, !!p.d) : `<span class="pcsign"><img src="${glyphURL(glyphKey(p), false)}" alt=""></span>`;
    const sub1 = [kind, peak && !p.d ? farTxt : ""].filter(Boolean).join(" · ");
    const sub2 = [kind, range, farTxt].filter(Boolean).join(" · ");
    let html = `<div class="pc"><div class="pchd">${p.c === "junction" && !p.n ? "" : mark}<div class="pct"><h4>${nm}<span class="el hel">${p.e ? ` ${Math.round(p.e)} m` : ""}</span>${peak ? visitsTag(outs) : ""}</h4>` +
      `${sub1 || cols ? `<div class="tk pmin">${sub1}${cols}</div>` : ""}${sub2 || cols ? `<div class="tk pmax">${sub2}${cols}</div>` : ""}</div></div>`;
    const walk = ([id, t], play) => `<button class="vrow pcw" data-o="${id}"><span>${fmtDate(t)}</span><span>${C.esc(C.outingById(id)?.name || "Wyjście")}</span>${play ? `<i class="pplay" data-rp="${id}" role="button" aria-label="Replay"><svg><use href="#i-play"/></svg></i>` : `<svg class="chev"><use href="#i-chev"/></svg>`}</button>`;
    if (byDate.length) {
      html += `<div class="pmin pclast">${walk(byDate[0], false)}</div>`;
      html += `<div class="pmax">${peak ? `<div class="pcbig">${ringSVG(seasonsOf(outs), 112, !!p.d)}</div>` : ""}<h5 class="sec">${peak ? "Wejścia" : "Wizyty"} · ${byDate.length}</h5><div class="visits">${byDate.map((o) => walk(o, true)).join("")}</div></div>`;
    } else if (p.d) html += `<div class="tl">Odkryte ${fmtDate(p.f)}</div>`;
    else if (peak) html += `<div class="pmax pcbig">${ringSVG([], 112)}</div>`;
    if (p.c === "parking" && p.fee != null) html += `<div class="tl">${p.fee ? "Płatny" : "Bezpłatny"}</div>`;
    for (const q of p.a || []) html += `<div class="tl">+ ${q.s || NAMES[q.c]}: ${q.d ? "odkryte " + fmtDate(q.f) : "nieodkryte"}</div>`;
    // the badge lists of this summit: chips with the landscape and how far you are with it (a tap: the list)
    const got = state.result?.badges || {}, lists = listsOf(p).map((L) => { const B = BADGES.find((q) => q.id === L.id); const n = B ? B.list.filter((k) => got[`${B.id}:${k.n}`]).length : 0; return { ...L, n, all: B?.list.length || 0 }; });
    if (lists.length) {
      html += `<div class="pmin pcchips">${lists.map((L) => `<button class="pchip" data-list="${L.id}">${badgeSVG(L.id, 28, L.n > 0)}<span>${L.name}</span><small>${L.n} z ${L.all}</small><svg class="chev"><use href="#i-chev"/></svg></button>`).join("")}</div>`;
      html += `<div class="pmax"><h5 class="sec">Odznaki</h5>${lists.map((L) => `<button class="pcbadge" data-list="${L.id}">${badgeSVG(L.id, 30, L.n > 0)}<b>${L.name}</b><small>${L.n} z ${L.all}</small><svg class="chev"><use href="#i-chev"/></svg></button>`).join("")}</div>`;
    }
    // a summit with no way to it: where it is ticked from
    const acc = p.c === "peak" && p.x != null ? accessOf(p, accessData, (bpts() || []).filter((k) => k.ax != null && Math.hypot(k.x - p.x, k.y - p.y) < 400)) : null;
    if (acc) {
      const dir = windShort(bearingOf(p.x, p.y, acc.x, acc.y));
      html += `<div class="tl acc">Na wierzchołek nie prowadzi ścieżka: zaliczasz go ${acc.own ? `przy ${acc.note || "punkcie na szlaku"}` : "ze szlaku obok"}, ${distText(acc.d)} na ${dir}${acc.drop != null ? `, ok. ${acc.drop} m niżej` : ""}.</div>`;
    }
    html += `</div>`;
    if (p.c === "place") html += `<div class="pvis"><div class="tk">Szukam wyjść przez ${shortName(p.n)}…</div></div>`;
    const key = `p:${p.id ?? p.n}`;
    const flat = p.c === "place" || p.c === "station" || p.c === "parking" || p.c === "junction";
    const pin = p.x != null ? [p.x, p.y, flat ? "place" : "poi", glyphKey(p), !!p.d, p.e ? `${Math.round(p.e)} m` : null] : null;
    C.openTip(html, null, key, { label: nm, pin, reopen: () => showTip(p) });
    C.$("tip").querySelectorAll("[data-list]").forEach((b) => (b.onclick = () => { C.drawer("progress"); renderBadge(b.dataset.list); }));
    C.$("tip").querySelectorAll("[data-rp]").forEach((b) => (b.onclick = (e) => { e.stopPropagation(); const a = C.outingById(b.dataset.rp); if (a) C.replay3d(a); })); // (▶: that walk again, in 3D)
    if (!p.e && p.x != null) C.fillElev(key, p.x, p.y, (r) => { if (pin && state.cur?.key === key) { pin[5] = `${r.h} m`; C.view.setPin([...pin]); } return ` ~${r.h} m`; });
    if (p.c === "place" && p.x != null) C.placeVisits(p, key);
    // planning only where the maps have paths (a town far from the mountains: just the way there)
    if (p.x == null || !String(p.id || "").startsWith("bd:") || C.view.onMap(p.x, p.y, 4000)) C.addPlanFrom(p.x != null ? { x: p.x, y: p.y, n: p.n || null, id: p.id } : null);
    if (p.x != null && p.c !== "junction" && !(C.planner.isActive() && !C.planner.drafting())) C.addActs([{ icon: "map", label: "Dojazd", more: true, fn: () => C.directions(p.x, p.y, p.n) }]); // (walking a route: no driving there)
    if (acc) C.addActs([{ icon: "nav", label: "Pokaż dojście", fn: () => { C.view.setPin([acc.x, acc.y, "poi"]); C.flyView(() => C.fitAbove(Math.min(p.x, acc.x), Math.min(p.y, acc.y), Math.max(p.x, acc.x), Math.max(p.y, acc.y))); } }]);
  }
  // access points of summits with no way to them (tools/access.mjs; optional)
  function accessReady() { return Promise.all(packList(absSpec(state.regionBase)).map((p) => fetch(packUrl(p.base, "access.json")).then((r) => (r.ok ? r.json() : null)).catch(() => null))).then((l) => (accessData = mergeSide(l))); }

  return { accessReady, bpts, fillQuickGoal, mapChip, medalsAt, renderCard, renderJournal, showRange, showTip };
}
