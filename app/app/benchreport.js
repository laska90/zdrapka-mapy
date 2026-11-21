// The smoothness test's results (app/bench.js): as text for the report and the chat, and as cards on the page.
import { realHitchLines, realUse } from "./diag.js";
const r1 = (x) => (x == null ? null : Math.round(x * 10) / 10);
// ---- the report: text (to paste in the chat) and the cards on the page
const G = { green: "●", yellow: "●", red: "●", grey: "○" };
const delta = (now, was, unit = "", lower = true) => {
  if (now == null || was == null) return "";
  const d = r1(now - was);
  if (!d) return " (=)";
  const worse = lower ? d > 0 : d < 0;
  return ` (${d > 0 ? "+" : ""}${d}${unit}${worse ? " ↘" : " ↗"})`;
};
export function benchText(R) {
  if (!R) return "";
  const d = R.device, P = R.prev?.sc || {};
  const L = [`TEST PŁYNNOŚCI ${R.kind === "full" ? "PEŁNY" : "SZYBKI"} · ${d.version} · ${d.at} · ${Math.round(R.ms / 1000)} s${R.stopped ? " · PRZERWANY" : ""}`,
    `  ekran ${R.hz ?? "?"} Hz (budżet klatki ${R.hz ? r1(1000 / R.hz) : "?"} ms), GPU ${d.gpu}, WebView ${d.webview}, ${d.screen} css px × ${d.dpr} (mapa ${d.mapDpr}×)`,
    `  pamięć urządzenia ${d.mem ?? "?"} GB, rdzenie ${d.cores ?? "?"}, JS ${d.heap ?? "?"} MB, bateria ${d.battery ? `${d.battery.level}%${d.battery.charging ? " ładowanie" : ""}` : "?"}`,
    `  dane: wyjścia ${d.outings}, krążki mgły ${d.discs}, warstwy ${d.layers}, tryb ${d.mode}, miejsce ${d.at2}`,
    `  kafle z wyprzedzeniem: ${d.prefetch ? `${d.prefetch.on ? "tak" : "wyłączone"}, pamięć ${d.prefetch.budget} na źródło` : "brak"} · wątki kafli ${d.threads ?? "?"}${d.dropZooms ? ", pośrednie przybliżenia porzucane" : ""}`,
    ...(R.prev ? [`  porównanie z ${R.prev.version} (${R.prev.at})`] : []),
    ...R.warn.map((w) => `  ! ${w}`),
    "  scenariusz: spóźnione klatki % · klatka p50/p95/p99/max ms · serie · mapa CPU/GPU ms · palec→klatka p50/p95 · czekanie na mapę w ruchu / po ruchu ms · kafle n p50/p95 · długie: kafle/rysowanie/aplikacja/reszta ms"];
  for (const q of R.scenarios) {
    const s = q.s;
    if (!s) continue;
    if (s.skip) { L.push(`  ○ ${q.name}: pominięty (${s.skip})`); continue; }
    if (s.open != null) { L.push(`  ${G[s.grade]} ${q.name}: otwarcie ${s.open} ms (95%: ${s.open95}), najdłuższa klatka ${s.max} ms${delta(s.open, P[q.id]?.open, " ms")}`); continue; }
    L.push(`  ${G[s.grade]} ${q.name} [${s.grade}]: ${s.late}%${delta(s.late, P[q.id]?.late, " pp")} · ${s.p50}/${s.p95}/${s.p99 ?? "-"}/${s.max}${delta(s.p95, P[q.id]?.p95, " ms")} · ${s.bursts ?? 0} · ${s.cpu ?? "-"}/${s.gpuOk ? s.gpu ?? "-" : "brak"}` +
      (s.lat != null ? ` · ${s.lat}/${s.lat95}` : "") + (s.wait != null ? ` · czekanie ${s.wait}/${s.after}${delta(s.after, P[q.id]?.after, " ms")}` : "") + (s.tiles ? ` · ${s.tiles} ${s.tile50}/${s.tile95}` : "") + (s.long ? ` · ${s.long.tiles}/${s.long.draw}/${s.long.app}/${s.long.rest}` : "") + (s.spread > 8 ? ` · rozrzut ${s.spread} pp` : ""));
    if (s.gpuMax != null) L.push(`      karta graficzna (przez finish): klatka średnio ${s.gpu ?? "-"} / p95 ${s.gpu95 ?? "-"} / max ${s.gpuMax} ms${s.gpuSlow?.length ? ` · najdłuższe: ${s.gpuSlow.map((g) => `${g.g} ms w ${String(g.t).replace(".", ",")} s, z ${String(g.z).replace(".", ",")}${g.ev ? ` {${g.ev}}` : ""}`).join("; ")}` : ""}`);
    if (s.hitchList?.length || s.even) L.push(`      szarpnięcia ≥50 ms na przebieg: ${s.hitch ?? 0}${s.hitchList?.length ? ` (najdłuższe: ${s.hitchList.map((h) => `${h.d} ms w ${String(h.t).replace(".", ",")} s, z ${String(h.z).replace(".", ",")}, ${h.why}${h.top ? ` ${h.top}` : ""}${h.ms ? ` [skrypty ${h.ms.skrypty}, układ ${h.ms.układ}]` : ""}${h.ev ? ` {${h.ev}}` : ""}`).join("; ")})` : ""}${s.even ? ` · nierówność ruchu p95 ${s.even.p95}%, skoki ${s.even.jumps}` : ""}`);
    if (s.bySrc) L.push(`      kafle wg źródła (n p50/p95 ms): ${Object.entries(s.bySrc).map(([g, t]) => `${g} ${t.n} ${t.p50}/${t.p95}`).join(" · ")} · naraz max ${s.inflight}`);
  }
  const RU = realUse();
  if (RU?.hitches.length) L.push(...realHitchLines(RU).map((x) => `  ${x}`));
  if (R.drift) L.push(`  wzorzec na końcu: ${R.drift.late1}% spóźnionych (na początku ${R.drift.late0}%), CPU ${R.drift.cpu1} ms (${R.drift.cpu0})`);
  for (const w of R.why) {
    L.push(`  DLACZEGO „${w.name}” (${w.base.late}% spóźnionych, CPU ${w.base.cpu} ms): bez…`);
    for (const r of [...w.rows].sort((a, b) => a.late - b.late)) L.push(`    ${r.name}: ${r.late}%${delta(r.late, w.base.late, " pp")}, p95 ${r.p95} ms${delta(r.p95, w.base.p95, " ms")}, CPU ${r.cpu ?? "-"} GPU ${r.gpu ?? "-"}`);
  }
  return L.join("\n");
}
export function benchHTML(R, hist = []) {
  if (!R) return "";
  const esc = (t) => String(t ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
  const d = R.device, P = R.prev?.sc || {};
  const chip = (now, was, unit, lower = true) => { if (now == null || was == null) return ""; const dd = r1(now - was); if (Math.abs(dd) < (unit === " pp" ? 2 : 1)) return `<i class="bd eq">=</i>`; const worse = lower ? dd > 0 : dd < 0; return `<i class="bd ${worse ? "worse" : "better"}">${dd > 0 ? "+" : ""}${dd}${unit}</i>`; };
  let h = `<div class="bhd"><b>${R.kind === "full" ? "Pełny test" : "Szybki test"}</b><small>${esc(d.version)} · ${R.hz ?? "?"} Hz · ${Math.round(R.ms / 1000)} s${R.prev ? ` · względem ${esc(R.prev.version)}` : ""}</small></div>`;
  for (const w of R.warn) h += `<div class="bwarn">${esc(w)}</div>`;
  h += `<div class="bcards">`;
  for (const q of R.scenarios) {
    const s = q.s;
    if (!s) continue;
    if (s.skip) { h += `<div class="bcard grey"><i class="bdot"></i><b>${esc(q.name)}</b><small>pominięty: ${esc(s.skip)}</small></div>`; continue; }
    const main = s.open != null ? `${s.open} ms do pierwszej klatki${chip(s.open, P[q.id]?.open, " ms")}` : `${s.late}% spóźnionych${chip(s.late, P[q.id]?.late, " pp")} · p95 ${s.p95} ms`;
    const sub = s.open != null ? `najdłuższa klatka ${s.max} ms` : [s.cpu != null ? `mapa ${s.cpu} ms CPU${s.gpuOk && s.gpu != null ? ` · ${s.gpu} GPU` : ""}` : "", s.lat != null ? `palec→klatka ${s.lat} ms` : "", s.bursts ? `zacięcia ${s.bursts}` : "", s.wait != null && (s.wait || s.after) ? `czekanie na mapę ${s.wait + s.after} ms` : ""].filter(Boolean).join(" · ");
    const src = s.bySrc && s.tile95 >= 300 ? `<small class="bsrc">kafle p95: ${Object.entries(s.bySrc).slice(0, 3).map(([g, t]) => `${g} ${Math.round(t.p95)} ms`).join(" · ")}</small>` : "";
    const hit = s.hitchList?.some((x) => x.d >= 50) ? `<small class="bsrc">szarpnięcia: ${s.hitch} na przebieg · najdłuższe ${s.hitchList.filter((x) => x.d >= 50).map((x) => `${x.d} ms (${esc(x.why)})`).join(", ")}</small>` : "";
    const ev = s.even && s.even.p95 >= 25 ? `<small class="bsrc">nierówny ruch: p95 ${s.even.p95}%, skoki ${s.even.jumps}</small>` : "";
    h += `<div class="bcard ${s.grade}"><i class="bdot"></i><b>${esc(q.name)}</b><span>${main}</span><small>${sub}</small>${src}${hit}${ev}</div>`;
  }
  h += `</div>`;
  for (const w of R.why) {
    const rows = [...w.rows].sort((a, b) => a.late - b.late), mx = Math.max(w.base.late, ...rows.map((r) => r.late), 1);
    h += `<h5 class="sec">Co kosztuje: ${esc(w.name)}</h5><div class="bwhy"><div><span>wszystko</span><i style="width:${(100 * w.base.late) / mx}%"></i><b>${w.base.late}%</b></div>` +
      rows.map((r) => `<div><span>bez: ${esc(r.name)}</span><i class="${r.late < w.base.late * 0.6 ? "hot" : ""}" style="width:${Math.max(1, (100 * r.late) / mx)}%"></i><b>${r.late}%</b></div>`).join("") + `</div>`;
  }
  h += `<h5 class="sec">Urządzenie</h5><div class="bdev">${esc(d.gpu)} · WebView ${esc(d.webview)} · mapa ${d.mapDpr}× · ${d.mem ?? "?"} GB · ${d.outings} wyjść · ${d.layers} warstw${d.battery ? ` · bateria ${d.battery.level}%` : ""}</div>`;
  if (hist.length > 1) {
    const ids = ["overview", "trails", "plan"];
    h += `<h5 class="sec">Historia (spóźnione klatki %)</h5><table class="bhist"><tr><th></th>${ids.map((k) => `<th>${{ overview: "Przegląd", trails: "Szlaki", plan: "Plan" }[k]}</th>`).join("")}</tr>` +
      [...hist].reverse().slice(0, 8).map((q) => `<tr><td>${esc(q.version)}<small>${esc(q.at.slice(5, 10))} ${q.kind === "full" ? "P" : "S"}</small></td>${ids.map((k) => `<td class="${q.sc[k]?.grade || ""}">${q.sc[k]?.late ?? "-"}</td>`).join("")}</tr>`).join("") + `</table>`;
  }
  return h;
}

// ---- A / B: the same quick test without and with the tiles ahead
/** An A/B half in a few words: its threads, and whether a pinch's in-between zooms are dropped. */
const threads = (n) => (n == null ? "? wątki" : `${n} ${n === 1 ? "wątek" : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20) ? "wątki" : "wątków"}`);
const tuneName = (R) => `${threads(R.device.threads)}${R.device.dropZooms ? " + porzucanie" : ""}`;
const rowsAB = (A, B) => A.scenarios.filter((q) => q.s && !q.s.skip && q.s.open == null).map((q) => ({ name: q.name, a: q.s, b: B.scenarios.find((x) => x.id === q.id)?.s })).filter((r) => r.b && !r.b.skip);
export function abText(A, B) {
  const L = [`WĄTKI KAFLI: ${tuneName(A)} → ${tuneName(B)} · ${A.device.version} · ${A.device.at} · ${A.hz} Hz · pamięć ${B.device.prefetch?.budget ?? "?"} kafli`,
    "  scenariusz: czekanie na mapę w ruchu + po ruchu ms · spóźnione klatki % · kafle p50/p95 ms"];
  for (const r of rowsAB(A, B)) L.push(`  ${r.name}: ${(r.a.wait || 0) + (r.a.after || 0)} → ${(r.b.wait || 0) + (r.b.after || 0)} ms · ${r.a.late}% → ${r.b.late}% · ${r.a.tile50 ?? "-"}/${r.a.tile95 ?? "-"} → ${r.b.tile50 ?? "-"}/${r.b.tile95 ?? "-"}`);
  return L.join("\n");
}
export function abHTML(A, B) {
  const esc = (t) => String(t ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
  let h = `<div class="bhd"><b>Wątki kafli</b><small>${tuneName(A)} → ${tuneName(B)} · ${A.hz} Hz · czekanie na mapę (w ruchu i po ruchu)</small></div><div class="bcards">`;
  for (const r of rowsAB(A, B)) {
    const wa = (r.a.wait || 0) + (r.a.after || 0), wb = (r.b.wait || 0) + (r.b.after || 0), d = wb - wa;
    const cls = Math.abs(d) < 50 ? "eq" : d < 0 ? "better" : "worse";
    h += `<div class="bcard ${d <= 0 ? "green" : d < 150 ? "yellow" : "red"}"><i class="bdot"></i><b>${esc(r.name)}</b><span>${wa} → ${wb} ms<i class="bd ${cls}">${d > 0 ? "+" : ""}${d} ms</i></span><small>spóźnione ${r.a.late}% → ${r.b.late}%</small></div>`;
  }
  return h + `</div>`;
}

// ---- what weighs on the map (bench.js layerCost): the text to paste and the cards
const zName = (z) => `z ${String(z).replace(".", ",")}`;
/** The layers' test as text: the view from nothing per zoom, then each group: what it costs per zoom, its share. */
export function layersText(R) {
  const d = R.device;
  const L = [`CO OBCIĄŻA MAPĘ · ${d.version} · ${d.at} · ${Math.round(R.ms / 1000)} s${R.stopped ? " · PRZERWANY" : ""} · wątki kafli ${d.threads ?? "?"} · tryb ${d.mode} · ${d.at2}`,
    `  widok od zera, wszystko: ${R.zooms.map((z, i) => `${zName(z)} ${R.base[i] ?? "-"} ms`).join(" · ")}`,
    `  grupa: o ile szybciej bez niej ${R.zooms.map(zName).join(" / ")} ms · udział · do upieczenia (obrazek z góry)`,
    ...R.groups.map((g) => `  ${g.name} (${g.layers}): ${g.ms.map((x) => x ?? "-").join(" / ")} · ${g.share}%${g.all ? "" : ` · ${g.bake ? "tak" : "nie"}`}`),
    "  (udziały się nie sumują: grupy liczą się równolegle; ostatni wiersz zmierzony razem)",
    ...(R.warn || []).map((w) => `  ! ${w}`)];
  return L.join("\n");
}
export function layersHTML(R) {
  const esc = (t) => String(t ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
  const top = Math.max(1, ...R.groups.map((g) => g.share));
  let h = `<div class="bhd"><b>Co obciąża mapę</b><small>widok od zera: ${R.zooms.map((z, i) => `${zName(z)} ${R.base[i] ?? "-"} ms`).join(" · ")}</small></div><div class="bcards">`;
  for (const g of R.groups) {
    h += `<div class="bcard ${g.share >= 15 ? "red" : g.share >= 5 ? "yellow" : "green"}"><i class="bdot"></i><b>${esc(g.name)}</b><span>${g.share}%${g.bake && !g.all ? '<i class="bd better">do upieczenia</i>' : ""}</span><small>${g.ms.map((x, i) => `${zName(R.zooms[i])} ${x ?? "-"} ms`).join(" · ")}</small><i class="bbar" style="--w:${Math.round((100 * Math.max(0, g.share)) / top)}%"></i></div>`;
  }
  return h + "</div>";
}
