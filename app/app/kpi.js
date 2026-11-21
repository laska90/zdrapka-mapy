// The four figures of a way (time, distance, up, down) as one strip, with its profile under them:
// its profile drawn by growprof.js. Used by a point's card (from you) and by the planner (the whole route). Styles: style.css .kpi.

const nf1 = (v) => v.toLocaleString("pl-PL", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const hm = (ms) => { const m = Math.round(ms / 60000); return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, "0")}`; };
const I = {
  t: `<svg viewBox="0 0 24 24" class="ki"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>`,
  km: `<svg viewBox="0 0 24 24" class="ki"><path d="M3 12h18M7 8l-4 4 4 4M17 8l4 4-4 4"/></svg>`,
  up: `<svg viewBox="0 0 24 24" class="ki f"><path d="M12 4 21 19H3Z"/></svg>`,
  dn: `<svg viewBox="0 0 24 24" class="ki f"><path d="M12 20 3 5h18Z"/></svg>`,
};

/** The strip: {ms, km, up, down}; src: a dot's colour (where it is counted from: you, ...) or null;
 * grow: a box for the plan's profile that grows with the card (growprof.js), room for the card's X in the row;
 * fresh: km new to scratch (a small badge by the km). */
export function kpiHtml({ ms, km, up, down }, { src = null, label = "", grow = false, fresh = 0 } = {}) {
  return `<div class="kpi${src ? " src" : ""}${grow ? " gx" : ""}" role="group" aria-label="${label}">` +
    (src ? `<i class="kdot" style="background:${src}"></i>` : "") +
    `<div class="kv"><b>${hm(ms)}</b><span>${I.t}h</span></div><div class="kv"><b>${nf1(km)}</b><span>${I.km}km${fresh > 0.05 ? `<i class="knew" title="nowych km do zdrapania">+${nf1(fresh)}</i>` : ""}</span></div>` +
    `<div class="kv up"><b>${Math.round(up)}</b><span>${I.up}m</span></div><div class="kv dn"><b>${Math.round(down)}</b><span>${I.dn}m</span></div>` +
    (grow ? `<div class="gprof"></div>` : "") +
    `</div>`;
}

/** The figures of a way in one row, as on every card (the plan's, a place's way from you, an outing):
 * time · km · up · down, a box for its profile under them (growprof.js). v: {ms, km, up, down} (null: "–");
 * lead: before the figures (a dot: where they count from); corner: a button at the row's end. */
/** With friends on the map: their colours (a time then is the slowest one's), set by app/friends.js. */
export const kpiGroup = { cs: null };
export function kpiRow(v, { lead = "", corner = "", label = "", extra = "", cls = "", prof = true, key = "", grp = true } = {}) {
  const cs = Array.isArray(grp) ? grp : grp && kpiGroup.cs; // (grp a list: those colours, e.g. a plan's shared pace)
  const gd = cs ? `<i class="kgrp">${cs.map((c) => `<i style="background:${c}"></i>`).join("")}</i>` : "";
  const f = (x, g) => (x == null || !Number.isFinite(x) ? "–" : g(x));
  return `<div class="kpi gx cx${cls ? ` ${cls}` : ""}" role="group" aria-label="${label}"><div class="krow">${lead}` +
    `<span class="kc">${gd}<b>${f(v.ms, hm)}</b>h</span><span class="kc"><b>${f(v.km, nf1)}</b>km${extra}</span>` +
    `<span class="kc up"><b>${f(v.up, Math.round)}</b>↑</span><span class="kc dn"><b>${f(v.down, Math.round)}</b>↓</span>${corner}</div>` +
    (prof ? `<div class="gprof"></div>${key}` : "") + `</div>`;
}

/** A finger on a row's profile: its figures say the way to the finger (kind: "start", "me", "past" or "range",
 * a dot before them says which); the finger off (w null), they come back. -> (w, kind) => void */
export function kpiFingers(k) {
  let keep = null;
  return (w, kind) => {
    const row = k?.querySelectorAll(".krow .kc b");
    if (!row || row.length !== 4) return;
    if (!w) {
      if (keep) row.forEach((b, i) => (b.textContent = keep[i]));
      keep = null; k.classList.remove("fing", "f-me", "f-start", "f-past", "f-range"); k.querySelector(".korg")?.remove();
      return;
    }
    if (!keep) { keep = [...row].map((b) => b.textContent); k.querySelector(".krow").insertAdjacentHTML("afterbegin", `<i class="korg"></i>`); }
    k.classList.add("fing"); for (const c of ["me", "start", "past", "range"]) k.classList.toggle(`f-${c}`, kind === c);
    [w.ms == null || !Number.isFinite(w.ms) ? "–" : hm(w.ms), nf1(w.km), Math.round(w.up), Math.round(w.down)].forEach((x, i) => (row[i].textContent = x));
  };
}
