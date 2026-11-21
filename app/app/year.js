// Twój rok (the year as light cards that move on by themselves) and Wszystko razem (every year side by side).
// C: the app as these parts see it (ctx in app.js: every name read when used).
import { PLURAL, fmtDate, plural, shortName } from "./labels.js";
import { BADGES } from "../core/badges.js";
import { yearSummary, yearsOf } from "../core/year.js";
import { badgeSVG, ringHTML, visitsTag } from "./marks.js";
import { state } from "./state.js";
import { boxOf } from "../core/geometry.js";
import { GOT_LEVELS, gotOf } from "../core/notices.js";

export function createYear(C) {
  const MONTHS = ["styczeń", "luty", "marzec", "kwiecień", "maj", "czerwiec", "lipiec", "sierpień", "wrzesień", "październik", "listopad", "grudzień"];
  const MON1 = ["S", "L", "M", "K", "M", "C", "L", "S", "W", "P", "L", "G"];
  const cap = (t) => t.charAt(0).toUpperCase() + t.slice(1);
  const slide = (kick, big, text, extra = "", cls = "") => `<section class="yslide ${cls}"><div class="yk">${kick}</div>${big ? `<div class="yn">${big}</div>` : ""}${text ? `<div class="yd">${text}</div>` : ""}${extra}</section>`;
  const vsPrev = (now, before, unit = "") => {
    if (!before) return "";
    const d = now - before, r = before ? d / before : 0;
    if (Math.abs(r) < 0.03) return `<div class="ycmp">tyle co rok wcześniej</div>`;
    return `<div class="ycmp ${d > 0 ? "up" : "down"}">${d > 0 ? "+" : "−"}${Math.abs(Math.round(r * 100))}% względem roku wcześniej (${C.nf(before, 0)}${unit})</div>`;
  };
  /** A route's shape as an SVG polyline (no map under it), fitted in a w x h box. */
  function silhouette(parts, w = 96, h = 72) {
    const [x0, y0, x1, y1] = boxOf(parts), k = Math.min((w - 8) / Math.max(1, x1 - x0), (h - 8) / Math.max(1, y1 - y0)), ox = (w - (x1 - x0) * k) / 2, oy = (h - (y1 - y0) * k) / 2;
    const pts = parts.filter((p) => p.length >= 4).map((p) => { const out = []; const step = Math.max(2, Math.floor(p.length / 2 / 120) * 2); for (let i = 0; i < p.length; i += step) out.push(`${(ox + (p[i] - x0) * k).toFixed(1)},${(oy + (p[i + 1] - y0) * k).toFixed(1)}`); return out.join(" "); });
    return `<svg class="ysil" viewBox="0 0 ${w} ${h}" aria-hidden="true">${pts.map((q) => `<polyline points="${q}"/>`).join("")}</svg>`;
  }
  function yearSlides(s, X) {
    const out = [], P = C.paces(), prev = X.prev;
    out.push(slide(`Twój ${s.year} ${C.AREA.loc()}`, s.outings, `${plural(s.outings, "wyjście", "wyjścia", "wyjść").replace(/^\d+\s/, "")} w ${plural(s.days, "dzień", "dni", "dni")}`, vsPrev(s.outings, prev?.outings, " wyjść"), "yintro"));
    out.push(slide("Twoje trasy", "", "", `<div class="ymap"><canvas role="img" aria-label="Mapa tras z roku"></canvas><div class="spinner"></div></div><div class="yd small">${plural(s.outings, "trasa", "trasy", "tras")} po kolei, od stycznia</div>`, "ymapslide"));
    out.push(slide("Przeszedłeś", `${C.nf(s.km, s.km < 100 ? 1 : 0)} <small>km</small>`, `średnio ${C.nf(s.km / Math.max(1, s.outings), 1)} km na wyjście${s.longest ? ` · najdłuższe ${C.nf(s.longest.km, 1)} km` : ""}`, vsPrev(s.km, prev?.km, " km")));
    if (s.asc) out.push(slide("Podejścia", `↑${C.nf(s.asc, 0)} <small>m</small>`, `średnio ↑${C.nf(s.asc / Math.max(1, s.outings), 0)} m na wyjście · ${C.nf(s.asc / Math.max(1, s.km), 0)} m w górę na każdy kilometr`, vsPrev(s.asc, prev?.asc, " m")));
    // in motion: the time on the move and your pace against the norm (your own figures, not trivia)
    const mine = X.acts.map((a) => P[a.id]).filter((q) => q?.moving > 0);
    if (mine.length >= 3) {
      const mov = mine.reduce((t, q) => t + q.moving, 0), kmM = mine.reduce((t, q) => t + (q.km || 0), 0), idx = mine.map((q) => q.idx).filter(Boolean).sort((a, b) => a - b), med = idx[Math.floor(idx.length / 2)];
      const prevIdx = (() => { const pa = (state.result?.activities || []).filter((a) => !a.outside && a.start != null && new Date(a.start).getFullYear() === s.year - 1).map((a) => P[a.id]?.idx).filter(Boolean).sort((a, b) => a - b); return pa.length >= 3 ? pa[Math.floor(pa.length / 2)] : null; })();
      out.push(slide("W ruchu", `${C.nf(mov / 3.6e6, 0)} <small>h</small>`, `${C.nf(kmM / (mov / 3.6e6), 1)} km/h w ruchu · tempo ${Math.round(med * 100)}% normy szlakowej${prevIdx ? ` (rok wcześniej ${Math.round(prevIdx * 100)}%)` : ""}`, ""));
    }
    // when you go: the days of the week, the usual start, weekends in a row
    if (s.outings >= 4) {
      const D7 = ["pn", "wt", "śr", "cz", "pt", "sb", "nd"], wm = Math.max(1, ...s.week), top = s.week.indexOf(Math.max(...s.week));
      const hm2 = (m) => `${Math.floor(m / 60)}:${String(m % 60).padStart(2, "0")}`;
      out.push(slide("Kiedy wychodzisz", "", `najczęściej ${["w poniedziałek", "we wtorek", "w środę", "w czwartek", "w piątek", "w sobotę", "w niedzielę"][top]}${s.startMed != null ? ` · zwykle startujesz o ${hm2(s.startMed)}` : ""}${s.weekendStreak >= 2 ? ` · ${plural(s.weekendStreak, "weekend", "weekendy", "weekendów")} z rzędu w górach` : ""}`,
        `<div class="ybars">${s.week.map((v, i) => `<span class="${i === top ? "best" : ""}" style="height:${Math.round((100 * v) / wm)}%"></span>`).join("")}</div><div class="ymon">${D7.map((q) => `<span>${q}</span>`).join("")}</div>`));
    }
    // the calendar: a row per month, a dot per day, warmer for more km
    const mx = Math.max(1, ...s.cal.flat());
    out.push(slide("Kalendarz", "", `${plural(s.days, "dzień", "dni", "dni")} w górach${s.bestMonth != null ? ` · najwięcej w miesiącu ${MONTHS[s.bestMonth]}: ${C.nf(s.months[s.bestMonth], 0)} km` : ""}`,
      `<div class="ycal">${s.cal.map((row, m) => `<div class="ycr"><span>${MON1[m]}</span>${row.map((km, d) => { const ok = d < new Date(s.year, m + 1, 0).getDate(); return `<i class="${!ok ? "x" : km ? "on" : ""}"${km ? ` style="--k:${(0.35 + 0.65 * Math.sqrt(km / mx)).toFixed(2)}"` : ""}></i>`; }).join("")}</div>`).join("")}</div>`, "ycalslide"));
    if (X.yr && X.yr.km > 0.05) {
      const rows = X.yr.ranges.slice(0, 4).map((r) => `<div class="yrr"><div class="yrn"><span>${r.short || r.label}</span><b>${C.pct(r.before)}% → ${C.pct(r.after)}%</b></div><div class="yrb"><i style="width:${Math.min(100, r.before)}%"></i><i class="new" style="width:${Math.max(0.8, Math.min(100, r.after) - Math.min(100, r.before))}%"></i></div></div>`).join("");
      out.push(slide("Nowe szlaki", `+${C.nf(X.yr.km, X.yr.km < 100 ? 1 : 0)} <small>km</small>`, `${C.AREA.nom()}: ${C.pct(X.yr.before)}% → <b>${C.pct(X.yr.after)}%</b> szlaków`, `<div class="yranges">${rows}</div>`));
    }
    if (s.newPeaks.length) {
      const rows = s.newPeaks.slice(0, 6).map((f) => `<div class="ypk">${ringHTML(f.outs || [], 34, true)}<b>${C.esc(shortName(f.n))}${visitsTag(f.outs)}</b><span>${f.e ? Math.round(f.e) + " m" : ""}</span></div>`).join("");
      out.push(slide("Nowe szczyty", s.newPeaks.length, s.newPeaks.length > 6 ? `i ${s.newPeaks.length - 6} więcej` : "", `<div class="ypks">${rows}</div>`));
    }
    if (s.newBadges.length) {
      const names = s.newBadges.map((id) => { const [b, n] = id.split(/:(.*)/s); return `${badgeSVG(b, 28)}<span>${n} <small>${BADGES.find((q) => q.id === b)?.name || b}</small></span>`; });
      out.push(slide("Odznaki", `+${s.newBadges.length}`, "", `<ul class="ylist">${names.slice(0, 6).map((t) => `<li>${t}</li>`).join("")}${names.length > 6 ? `<li>i ${names.length - 6} więcej</li>` : ""}</ul>`));
    }
    // GOT: the year's points (a point a km and for 100 m up), the badge reached, the best outing, against the year before
    {
      const got = (a) => gotOf(a.km || 0, a.asc || 0), pts = X.acts.reduce((g, a) => g + got(a), 0);
      const before = (state.result?.activities || []).filter((a) => !a.outside && a.start && new Date(a.start).getFullYear() === s.year - 1).reduce((g, a) => g + got(a), 0);
      const done = [...GOT_LEVELS].reverse().find(([p]) => p <= pts), next = GOT_LEVELS.find(([p]) => p > pts), best = [...X.acts].sort((a, b) => got(b) - got(a))[0];
      if (pts) out.push(slide("GOT", `${pts} <small>pkt</small>`, `${done ? `odznaka ${done[1]}` : `do odznaki popularnej brakuje ${next[0] - pts} pkt`}${done && next ? ` · do ${next[2]}: ${next[0] - pts} pkt` : ""}${before ? ` · rok wcześniej ${before} pkt` : ""}`,
        best ? `<div class="yd small">najwięcej na jednym wyjściu: ${got(best)} pkt · ${C.esc(shortName(best.name || "wyjście"))}</div>` : ""));
    }
    // records
    const acts = X.acts, fastest = acts.filter((a) => P[a.id]?.idx && P[a.id].km >= 4).sort((a, b) => P[b.id].idx - P[a.id].idx)[0]; // idx: the standard over your time (higher: faster)
    const rec = [];
    if (s.longest) rec.push(["Najdłuższe", `${C.nf(s.longest.km)} km`, s.longest.name]);
    if (s.climbiest) rec.push(["Największe podejście", `↑${C.nf(s.climbiest.asc, 0)} m`, s.climbiest.name]);
    if (s.highest) rec.push(["Najwyżej", `${Math.round(s.highest.e || 0)} m`, shortName(s.highest.n)]);
    if (fastest) rec.push(["Najszybciej", `${Math.round(P[fastest.id].idx * 100)}% normy`, fastest.name]);
    if (s.often) rec.push(["Najczęściej", `${s.often.count}×`, shortName(s.often.n)]);
    if (rec.length >= 2) out.push(slide("Rekordy roku", "", "", `<div class="yrec">${rec.map(([k, v, n]) => `<div><span>${k}</span><b>${v}</b><small>${C.esc(n || "")}</small></div>`).join("")}</div>`));
    // the three longest outings: their shapes
    const top = [...acts].sort((a, b) => (b.km || 0) - (a.km || 0)).slice(0, 3);
    if (top.length >= 2) out.push(slide("Najdłuższe wyjścia", "", "", `<div class="ytop">${top.map((a) => `<button class="ytrow" data-o="${a.id}">${silhouette(X.tracks.get(a.id) || [])}<span><b>${C.esc(a.name || "Wyjście")}</b><small>${fmtDate(a.start)} · ${C.nf(a.km)} km${a.ele ? ` · ↑${C.nf(a.asc, 0)} m` : ""}</small></span></button>`).join("")}</div>`));
    if (s.bestMonth != null) {
      const m = Math.max(...s.months, 1);
      out.push(slide("Najaktywniejszy miesiąc", cap(MONTHS[s.bestMonth]), `${C.nf(s.months[s.bestMonth], 0)} km`,
        `<div class="ybars">${s.months.map((v, i) => `<span class="${i === s.bestMonth ? "best" : ""}" style="height:${Math.round((100 * v) / m)}%" title="${MONTHS[i]}: ${C.nf(v, 0)} km"></span>`).join("")}</div><div class="ymon">${MON1.map((q) => `<span>${q}</span>`).join("")}</div>`));
    }
    return out;
  }
  const yr = { y: null, i: 0, n: 0, timer: 0, paused: false, X: null };
  const YEAR_MS = 6500;
  async function openYear(y) {
    const years = yearsOf(state.result?.activities || []);
    if (!years.length) return;
    if (!years.includes(y)) y = years[0];
    yr.y = y;
    C.$("yyears").innerHTML = years.map((v) => `<button data-y="${v}" class="${v === y ? "on" : ""}">${v}</button>`).join("");
    const acts = state.result.activities.filter((a) => !a.outside && a.start != null && new Date(a.start).getFullYear() === y);
    const s = yearSummary(state.result.activities, state.result.found, state.result.badges, y), prev = years.includes(y - 1) ? yearSummary(state.result.activities, state.result.found, state.result.badges, y - 1) : null;
    const X = (yr.X = { acts, prev, tracks: new Map(), yr: null });
    const render = () => {
      const keepI = yr.i, sl = yearSlides(s, X);
      C.$("yslides").innerHTML = sl.join(""); yr.n = sl.length;
      C.$("ydots").innerHTML = sl.map(() => `<i><b></b></i>`).join("");
      goSlide(Math.min(keepI, sl.length - 1), false);
    };
    yr.i = 0; render();
    C.$("year").hidden = false; C.haptic.tick();
    // what takes a moment: the tracks (the map, the shapes) and the ranges before and after
    const [tracks, rr] = await Promise.all([Promise.all(acts.map((a) => C.call("track", { activity: a.id }).then((r) => [a.id, r.track?.parts || []]).catch(() => [a.id, []]))), C.call("yearRanges", { year: y }).catch(() => null)]);
    if (yr.X !== X || C.$("year").hidden) return;
    X.tracks = new Map(tracks); X.yr = rr;
    render();
    yearMap(X, s);
  }
  /** The year's map slide: the region of its routes, the routes drawn one by one. */
  async function yearMap(X, s) {
    const box = C.$("yslides").querySelector(".ymap");
    if (!box) return;
    const W = Math.min(360, box.clientWidth || 320), H = Math.round(W * 1.15), all = [...X.tracks.values()].flat();
    if (!all.length) { box.remove(); return; }
    const [x0, y0, x1, y1] = boxOf(all), wv = Math.max(6000, x1 - x0), hv = Math.max(6000, y1 - y0), sc = Math.min((W - 24) / (wv * 1.1), (H - 24) / (hv * 1.1));
    const v = { W, H, s: sc, ox: W / 2 - ((x0 + x1) / 2) * sc, oy: H / 2 - ((y0 + y1) / 2) * sc };
    if (yr.X !== X || !box.isConnected) return;
    const cv = box.querySelector("canvas"), g = cv.getContext("2d");
    cv.width = W * 2; cv.height = H * 2; cv.style.aspectRatio = `${W} / ${H}`;
    box.querySelector(".spinner").remove();
    let order = [...X.acts].sort((a, b) => a.start - b.start).map((a) => X.tracks.get(a.id) || []);
    // the map itself under the routes (as in the app), the routes laid out on it
    let bg = null;
    try {
      const flat = order.flat(), sn = await C.view.snapshot([x0 - wv * 0.05, y0 - hv * 0.05, x1 + wv * 0.05, y1 + hv * 0.05], flat, 0.06);
      if (sn && yr.X === X && box.isConnected) {
        const im = await createImageBitmap(await (await fetch(sn.url)).blob()), kk = Math.max(W / sn.W, H / sn.H), bx = (W - sn.W * kk) / 2, by = (H - sn.H * kk) / 2;
        bg = { im, ox: bx, oy: by, w: sn.W * kk, h: sn.H * kk };
        let j = 0;
        order = order.map((parts) => parts.map((p) => { const q = sn.lines[j++]; return q.map((v2, i) => (i % 2 ? by + v2 * kk : bx + v2 * kk)); }));
        v.s = 1; v.ox = 0; v.oy = 0; // (the lines are in the picture's pixels now)
      }
    } catch { /* the plain paper then */ }
    const draw = (k) => { // k: how many routes (fractional: the last one partly)
      g.setTransform(2, 0, 0, 2, 0, 0); g.fillStyle = "#f4efe2"; g.fillRect(0, 0, W, H);
      if (bg) g.drawImage(bg.im, bg.ox, bg.oy, bg.w, bg.h);
      g.lineCap = "round"; g.lineJoin = "round";
      order.forEach((parts, i) => {
        if (i >= k) return;
        const frac = Math.min(1, k - i);
        g.strokeStyle = "rgba(255,255,255,.9)"; g.lineWidth = 3.6; path(parts, frac); g.stroke();
        g.strokeStyle = i >= k - 1 ? "#f2a900" : C.cssVar("--sel", "#5b2bd1"); g.lineWidth = 1.8; path(parts, frac); g.stroke();
      });
    };
    const path = (parts, frac) => {
      g.beginPath();
      const n = parts.reduce((t, p) => t + p.length / 2, 0), lim = Math.max(2, Math.round(n * frac));
      let c = 0;
      for (const p of parts) { for (let i = 0; i < p.length && c < lim; i += 2, c++) { const X1 = v.ox + p[i] * v.s, Y1 = v.oy + p[i + 1] * v.s; if (i) g.lineTo(X1, Y1); else g.moveTo(X1, Y1); } }
    };
    draw(0);
    box.dataset.ready = "1";
    box.play = () => {
      const t0 = performance.now(), dur = Math.min(6000, 1200 + 280 * order.length);
      const step = (now) => { if (!box.isConnected) return; const k = Math.min(order.length + 0.001, ((now - t0) / dur) * order.length); draw(k); if (k < order.length) requestAnimationFrame(step); };
      requestAnimationFrame(step);
    };
    if (yr.i === [...C.$("yslides").children].indexOf(box.closest(".yslide"))) { box.played = true; box.play(); }
  }
  function goSlide(i, smooth = true) {
    const el = C.$("yslides"), n = yr.n;
    yr.i = Math.max(0, Math.min(n - 1, i));
    el.scrollTo({ left: yr.i * el.clientWidth, behavior: smooth ? "smooth" : "auto" });
    storyBars();
    clearTimeout(yr.timer);
    if (!yr.paused && yr.i < n - 1) yr.timer = setTimeout(() => goSlide(yr.i + 1), YEAR_MS);
    const m = el.children[yr.i]?.querySelector(".ymap");
    if (m?.dataset.ready && m.play && !m.played) { m.played = true; m.play(); }
  }
  function storyBars() {
    [...C.$("ydots").children].forEach((d, k) => { d.className = k < yr.i ? "done" : k === yr.i ? (yr.paused ? "on paused" : "on") : ""; d.style.setProperty("--ms", `${YEAR_MS}ms`); });
    // restart the running bar's animation
    const cur = C.$("ydots").children[yr.i]?.firstElementChild;
    if (cur) { cur.style.animation = "none"; void cur.offsetWidth; cur.style.animation = ""; }
  }
  // ---- Wszystko razem: every year at once (the figures, year by year side by side, the records, the badges, the places)
  function openAll() {
    const R = state.result, el = C.$("allp");
    if (!R || !el) return;
    const years = yearsOf(R.activities), acts = R.activities.filter((a) => !a.outside && a.start != null);
    const S = years.map((y) => yearSummary(R.activities, R.found, R.badges, y));
    const km = S.reduce((t, q) => t + q.km, 0), asc = S.reduce((t, q) => t + (q.asc || 0), 0), days = S.reduce((t, q) => t + q.days, 0);
    const found = Object.values(R.found || {}), peaks = found.filter((f) => f.c === "peak").length;
    const big = (v, l) => `<div class="abig"><b>${v}</b><span>${l}</span></div>`;
    let h = `<div class="ahero"><div class="ak">od ${years[years.length - 1]}</div><div class="agrid">${big(C.nf(acts.length, 0), "wyjść")}${big(C.nf(days, 0), "dni")}${big(C.nf(km, 0), "km")}${big(`↑${C.nf(asc / 1000, 1)}`, "tys. m")}${big(C.nf(peaks, 0), "szczytów")}${big(C.nf(found.length, 0), "miejsc")}</div></div>`;
    // year by year: km as bars, the outings and the climb beside
    const mk = Math.max(1, ...S.map((q) => q.km));
    h += `<h5 class="sec">Rok po roku</h5><div class="ayears">${S.map((q) => `<button class="ayr" data-year="${q.year}"><b>${q.year}</b><span class="abar"><i style="width:${Math.max(1, (100 * q.km) / mk).toFixed(1)}%"></i></span><span class="akm">${C.nf(q.km, 0)} km</span><small>${q.outings} · ↑${C.nf(q.asc || 0, 0)} m</small></button>`).join("")}</div>`;
    // the records of all the years
    const best = (f) => S.map(f).filter(Boolean).reduce((b, x) => (!b || x.v > b.v ? x : b), null);
    const rec = [
      ["Najdłuższe", best((q) => q.longest && { v: q.longest.km || 0, t: `${C.nf(q.longest.km)} km`, n: q.longest.name, d: q.longest.start })],
      ["Największe podejście", best((q) => q.climbiest && { v: q.climbiest.asc, t: `↑${C.nf(q.climbiest.asc, 0)} m`, n: q.climbiest.name, d: q.climbiest.start })],
      ["Najwyżej", best((q) => q.highest && { v: q.highest.e || 0, t: `${Math.round(q.highest.e || 0)} m`, n: shortName(q.highest.n), d: q.highest.first })],
      ["Najczęściej", (() => { const f = found.filter((x) => x.c === "peak").sort((a, b) => (b.outs?.length || 0) - (a.outs?.length || 0))[0]; return f && f.outs?.length > 1 ? { t: `${f.outs.length}×`, n: shortName(f.n) } : null; })()],
    ].filter(([, v]) => v);
    if (rec.length) h += `<h5 class="sec">Rekordy</h5><div class="arec">${rec.map(([k, v]) => `<div><span>${k}</span><b>${v.t}</b><small>${C.esc(v.n || "")}${v.d ? ` · ${fmtDate(v.d)}` : ""}</small></div>`).join("")}</div>`;
    // the badges begun, the places by kind
    const got = R.badges || {}, bs = BADGES.map((B) => ({ B, n: B.list.filter((k) => got[`${B.id}:${k.n}`]).length })).filter((q) => q.n);
    if (bs.length) h += `<h5 class="sec">Odznaki</h5><div class="abadges">${bs.map(({ B, n }) => `<div>${badgeSVG(B.id, 36)}<b>${n}</b><small>z ${B.list.length}</small></div>`).join("")}</div>`;
    const t = R.tally || {}, ks = Object.keys(PLURAL).filter((k) => t[k]?.[0]);
    if (ks.length) h += `<h5 class="sec">Miejsca</h5><div class="aplaces">${ks.map((k) => `<div><b>${t[k][0]}</b><span>${PLURAL[k]}</span></div>`).join("")}</div>`;
    el.innerHTML = h;
    el.onclick = (e) => { const y = e.target.closest("[data-year]")?.dataset.year; if (y) openYear(+y); };
    C.drawer("allp", { push: true });
  }

  function closeYear() { C.$("year").hidden = true; clearTimeout(yr.timer); yr.X = null; }
  C.$("yyears").onclick = (e) => { const v = e.target.closest("[data-y]")?.dataset.y; if (v) openYear(+v); };
  C.$("yx").onclick = closeYear;
  {
    const el = C.$("yslides");
    let st = 0, down = null;
    // a swipe: the screen it lands on (and its timer)
    el.addEventListener("scroll", () => { clearTimeout(st); st = setTimeout(() => { const i = Math.round(el.scrollLeft / Math.max(1, el.clientWidth)); if (i !== yr.i) goSlide(i, false); }, 120); }, { passive: true });
    // holding a finger pauses; a tap moves on (the left quarter: back)
    el.addEventListener("pointerdown", (e) => { down = { x: e.clientX, y: e.clientY, t: performance.now() }; yr.paused = true; clearTimeout(yr.timer); storyBars(); });
    const up = (e) => {
      const d = down; down = null; yr.paused = false;
      if (!d) return;
      const tap = Math.hypot(e.clientX - d.x, e.clientY - d.y) < 10 && performance.now() - d.t < 450 && !e.target.closest("button");
      if (tap) { goSlide(e.clientX < el.clientWidth * 0.25 ? yr.i - 1 : yr.i + 1); return; }
      // a swipe or a hold: the scroll settles the screen; the timer runs again
      storyBars(); clearTimeout(yr.timer);
      if (yr.i < yr.n - 1) yr.timer = setTimeout(() => goSlide(yr.i + 1), YEAR_MS);
    };
    el.addEventListener("pointerup", up); el.addEventListener("pointercancel", up);
    el.addEventListener("click", (e) => {
      const o = e.target.closest("[data-o]")?.dataset.o;
      if (o) { closeYear(); C.selectOuting(o); }
    });
  }

  return { closeYear, openAll, openYear };
}
