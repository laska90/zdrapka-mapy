// The start screen's picture, in the badges' style (ink outlines, flat washes): the season by the
// month, the light by the hour. A plain script run right after the #loading element, before the app,
// so the picture is there at once. ?splash=zima-noc (season-time) shows a chosen one.
(function () {
  const INK = "#3a2a1c";
  const SEASONS = ["zima", "zima", "wiosna", "wiosna", "wiosna", "lato", "lato", "lato", "jesien", "jesien", "jesien", "zima"];
  const timeOf = (h) => (h >= 5 && h < 10 ? "rano" : h < 17 && h >= 10 ? "dzien" : h >= 17 && h < 21 ? "wieczor" : "noc");

  const hex = (c) => { const n = parseInt(c.slice(1), 16); return [n >> 16, (n >> 8) & 255, n & 255]; };
  const mix = (a, b, k) => { const x = hex(a), y = hex(b); return "#" + x.map((v, i) => Math.round(v + (y[i] - v) * k).toString(16).padStart(2, "0")).join(""); };

  // the light: the sky, the sun (or the moon), a tint over the land, the title's colours
  const TIMES = {
    rano: { sky: ["#e6e0f8", "#fbd8bf"], sun: [74, 440, 20, "#f7b37a"], tint: ["#ffd6ae", 0.14], far: "#e2d3ea" },
    dzien: { sky: ["#e4dcfa", "#f2ecfb"], sun: [292, 330, 20, "#f6c98a"], tint: ["#ffffff", 0], far: "#d9d0ee" },
    wieczor: { sky: ["#a993e6", "#f7c0a0"], sun: [284, 418, 26, "#f2955f"], tint: ["#ff9a6a", 0.2], far: "#c7b3e3" },
    noc: { sky: ["#191540", "#3a2b72"], moon: [278, 330, 17], tint: ["#1d1846", 0.55], far: "#4a3f86", night: true },
  };
  // the land: meadows, trees, snow
  const SEASON = {
    wiosna: { near: "#cfe1a0", mid: "#b5cf8c", rock: "#b4ada0", snow: 2, tree: "#6f8f62", flowers: ["#fbf8f0", "#f5d34f", "#f0a3c0"] },
    lato: { near: "#dccf74", mid: "#8fb35a", rock: "#bba994", snow: 0, tree: "#4d7843", hot: true },
    jesien: { near: "#dcc98d", mid: "#c9a565", rock: "#b0a495", snow: 1, tree: "#5f7a52", leaf: ["#d9843a", "#c9562f", "#e6b13f"] },
    zima: { near: "#f3f5fa", mid: "#e1e7f1", rock: "#cfd3dc", snow: 3, tree: "#5f7f63", winter: true },
  };

  /** w: the picture's width (it is 720 high; 360 on a phone). A wider screen (a laptop): the same scene in the middle,
   * the hills going on to both sides with a few more trees, so nothing is cut off or blown up. */
  function paint(season, time, w = 360) {
    const T = TIMES[time], S = SEASON[season], t = (c) => mix(c, T.tint[0], T.tint[1]);
    const X0 = -Math.max(0, (w - 360) / 2), X1 = 360 - X0;
    const ext = (pts) => { // the ridge on past both edges, gently up and down
      if (X0 >= 0) return pts;
      const m = pts.reduce((a, q) => a + q[1], 0) / pts.length, L = [], R = [];
      for (let x = pts[0][0] - 64, k = 0; x > X0 - 90; x -= 64, k++) L.unshift([x, m + (k % 2 ? -11 : 9)]);
      for (let x = pts.at(-1)[0] + 64, k = 0; x < X1 + 90; x += 64, k++) R.push([x, m + (k % 2 ? 9 : -11)]);
      return [...L, ...pts, ...R];
    };
    const ridge = (raw) => { const pts = ext(raw); let d = `M${pts[0][0]} ${pts[0][1]}`; for (let i = 1; i < pts.length; i++) { const [a, b] = pts[i - 1], [c, e] = pts[i], m = (a + c) / 2; d += ` C${m} ${b} ${m} ${e} ${c} ${e}`; } return [d, `${d} L${pts.at(-1)[0]} 760 L${pts[0][0]} 760 Z`]; };
    const layer = (pts, fill) => { const [top, shape] = ridge(pts); return `<path d="${shape}" fill="${fill}" stroke="none"/><path d="${top}" fill="none" stroke-width="2.4"/>`; };
    const spruce = (x, y, s = 1) => `<g transform="translate(${x} ${y}) scale(${s})"><path d="M0 0 L0 6" fill="none" stroke-width="2"/><path d="M-11 2 L0 -12 L11 2 Z M-9 -7 L0 -20 L9 -7 Z M-7 -15 L0 -28 L7 -15 Z" fill="${t(S.tree)}"/>` +
      (S.winter ? `<path d="M-7 -15 L0 -28 L7 -15 Q0 -19 -7 -15 Z M-9 -7 L-3 -15.5 Q0 -12 3 -15.5 L9 -7 Q0 -11 -9 -7 Z M-11 2 L-4 -6.5 Q0 -3 4 -6.5 L11 2 Q0 -2 -11 2 Z" fill="${t("#fbfcff")}" stroke-width="1.2"/>` : "") + `</g>`;
    const leafy = (x, y, s, c) => `<g transform="translate(${x} ${y}) scale(${s})"><path d="M0 0 L0 -12" fill="none" stroke-width="2"/><path d="M0 -10 C-13 -10 -14 -24 -6 -27 C-5 -36 7 -36 8 -27 C16 -24 13 -10 0 -10 Z" fill="${t(c)}"/></g>`;
    const tuft = (x, y) => `<path d="M${x - 7} ${y} Q${x - 3.5} ${y - 2.5} ${x} ${y}" fill="none" stroke-width="1.6"/>`;
    // summer: a hot sky (warmer towards the horizon), not at night
    const hot = S.hot && !T.night, sk0 = hot ? mix(T.sky[0], "#ffe3b0", 0.25) : T.sky[0], sk1 = hot ? mix(T.sky[1], "#ffc977", 0.5) : T.sky[1];
    let sky = `<defs><linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${sk0}"/><stop offset="1" stop-color="${sk1}"/></linearGradient></defs><rect x="${X0}" width="${X1 - X0}" height="720" fill="url(#sky)"/>`;
    if (T.night) {
      let r = 7; const rnd = () => ((r = (r * 9301 + 49297) % 233280) / 233280);
      for (let i = 0; i < Math.round(46 * (X1 - X0) / 360); i++) { const x = X0 + rnd() * (X1 - X0), y = 20 + rnd() * 400, k = rnd(); sky += `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${(0.6 + k * 1.3).toFixed(2)}" fill="#fff8e6" opacity="${(0.4 + k * 0.6).toFixed(2)}"/>`; }
    }
    let g = "";
    if (T.moon) { const [x, y, rr] = T.moon; g += `<path d="M${x} ${y - rr} A${rr} ${rr} 0 1 0 ${x} ${y + rr} A${rr * 0.75} ${rr} 0 1 1 ${x} ${y - rr} Z" fill="#f4ecd0" stroke-width="2.2"/>`; }
    else {
      const [x, y, r0, c0] = T.sun, rr = hot ? r0 + 5 : r0, c = hot ? mix(c0, "#ffb02e", 0.5) : c0;
      if (hot) for (let i = 0; i < 12; i++) { const a = (i * Math.PI) / 6 + 0.26, q = (k) => [(x + Math.cos(a) * k).toFixed(1), (y + Math.sin(a) * k).toFixed(1)]; g += `<path d="M${q(rr + 6).join(" ")} L${q(rr + (i % 2 ? 13 : 17)).join(" ")}" fill="none" stroke-width="2.2"/>`; }
      g += `<circle cx="${x}" cy="${y}" r="${rr}" fill="${c}" stroke-width="2.4"/>`;
    }
    g += layer([[-20, 470], [40, 440], [95, 452], [150, 428], [215, 446], [270, 432], [330, 448], [390, 438]], T.far);
    // the peak: snow by the season (a cap, two caps, the whole top)
    g += `<path d="M120 520 L190 392 L216 426 L252 366 L330 520 Z" fill="${t(S.rock)}" stroke-width="2.4"/>`;
    const snowC = t("#fbf8f0");
    if (!S.snow) { /* summer: bare rock */ }
    else if (S.snow >= 3) g += `<path d="M252 366 L222 422 L234 416 L246 432 L258 414 L272 430 L284 418 L300 432 Z" fill="${snowC}" stroke-width="2.2"/><path d="M190 392 L170 428 L182 422 L192 434 L202 420 L216 426 Z" fill="${snowC}" stroke-width="2"/>`;
    else {
      g += `<path d="M252 366 L237 396 L248 393 L255 408 L263 392 L274 401 Z" fill="${snowC}" stroke-width="2.2"/>`;
      if (S.snow >= 2) g += `<path d="M190 392 L181 409 L190 406 L197 415 L204 408 Z" fill="${snowC}" stroke-width="2"/>`;
    }
    g += `<path d="M264 400 L252 430 M276 420 L262 455 M289 442 L276 476 M302 466 L292 494 M200 410 L192 432 M210 428 L203 452" fill="none" stroke-width="1.5"/>`;
    g += layer([[-20, 520], [50, 498], [120, 512], [170, 500], [240, 516], [300, 500], [380, 512]], t(S.mid));
    g += layer([[-20, 560], [60, 548], [140, 562], [220, 546], [300, 560], [380, 548]], t(S.near));
    // trees: spruces always, leafy ones in the autumn
    g += spruce(48, 548, 1.1) + spruce(70, 552, 0.85) + spruce(312, 556, 1) + spruce(330, 560, 0.8) + spruce(150, 518, 0.7);
    // a wide picture: more of them out to the sides (spruces, an autumn tree), and the meadow's tufts
    for (let x = -40, k = 0; x > X0 + 10; x -= 95, k++) g += spruce(x, 552 + (k % 2) * 6, 0.8 + (k % 3) * 0.12) + (S.leaf && k % 2 ? leafy(x - 34, 560, 0.8, S.leaf[k % 3]) : "") + (!S.winter ? tuft(x + 20, 620 + (k % 3) * 30) : "");
    for (let x = 400, k = 0; x < X1 - 10; x += 95, k++) g += spruce(x, 556 - (k % 2) * 6, 0.8 + ((k + 1) % 3) * 0.12) + (S.leaf && !(k % 2) ? leafy(x + 34, 562, 0.8, S.leaf[(k + 1) % 3]) : "") + (!S.winter ? tuft(x - 10, 640 + (k % 3) * 25) : "");
    if (S.leaf) g += leafy(96, 556, 0.95, S.leaf[0]) + leafy(286, 562, 0.85, S.leaf[1]) + leafy(26, 562, 0.75, S.leaf[2]) + leafy(176, 520, 0.6, S.leaf[0]);
    if (S.winter) g += `<path d="M30 620 Q60 614 90 620 M220 660 Q260 653 300 660 M120 700 Q150 694 180 700 M260 600 Q285 595 310 600" fill="none" stroke="#9fb2cf" stroke-width="1.8"/>`;
    else g += tuft(110, 610) + tuft(240, 640) + tuft(300, 600) + tuft(60, 660) + tuft(190, 690);
    if (S.flowers) { let r = 3; const rnd = () => ((r = (r * 9301 + 49297) % 233280) / 233280); for (let i = 0; i < 26; i++) { const x = 10 + rnd() * 340, y = 580 + rnd() * 130; if (Math.abs(x - 160 - (y - 600) * -0.3) < 30) continue; g += `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="2.6" fill="${t(S.flowers[i % 3])}" stroke-width="1"/>`; } }
    // summer: haystacks and poppies in the dry meadow
    if (S.hot) {
      const hay = (x, y, k) => `<g transform="translate(${x} ${y}) scale(${k})"><path d="M-14 0 C-14 -20 14 -20 14 0 Z" fill="${t("#e3b85a")}" stroke-width="2"/><path d="M-8 -4 Q-6 -10 -2 -13 M2 -4 Q4 -10 7 -12 M-11 -2 L11 -2" fill="none" stroke-width="1.2"/><path d="M0 -17 L0 -24" fill="none" stroke-width="1.8"/></g>`;
      g += hay(250, 612, 1.1) + hay(292, 628, 0.95) + hay(56, 640, 1);
      let r = 11; const rnd = () => ((r = (r * 9301 + 49297) % 233280) / 233280);
      for (let i = 0; i < 18; i++) { const x = 10 + rnd() * 340, y = 590 + rnd() * 120; if (Math.abs(x - 160 - (y - 600) * -0.3) < 34) continue; g += `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="2.8" fill="${t("#d8332a")}" stroke-width="1"/>`; }
    }
    if (season === "jesien") g += `<path d="M40 640 l4 2 M70 600 l3 -2 M250 620 l4 1 M320 680 l-3 2 M200 600 l3 2" fill="none" stroke="#c9562f" stroke-width="2.4"/>`;
    // the marked path up to the top
    g += `<path d="M120 740 Q150 700 132 672 Q114 645 160 620 Q198 600 176 572 Q160 550 196 536 Q228 522 212 500 Q200 480 222 460 Q240 440 236 420 Q236 404 248 394" fill="none" stroke="${t("#c9302c")}" stroke-width="5" stroke-dasharray="9 7"/>`;
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${X0} 0 ${X1 - X0} 720" preserveAspectRatio="xMidYMax slice">${sky}<g stroke="${INK}" stroke-linecap="round" stroke-linejoin="round">${g}</g></svg>`;
  }

  const want = /[?&]splash=(\w+)-(\w+)/.exec(location.search), now = new Date();
  const season = want?.[1] in SEASON ? want[1] : SEASONS[now.getMonth()], time = want?.[2] in TIMES ? want[2] : timeOf(now.getHours());
  try { const a = JSON.parse(localStorage.getItem("scratchcard.settings") || "{}").accent; if (a && a !== "fiolet") document.documentElement.dataset.accent = a; } catch { /* private mode */ }
  const el = document.getElementById("loading");
  if (el) {
    el.dataset.time = time; el.dataset.season = season;
    el.style.background = TIMES[time].sky[0];
    const img = el.querySelector(".splart");
    // as wide as the screen's shape asks (a phone: the 360 × 720 picture as it is)
    const fit = () => { const w = Math.max(360, Math.min(1600, Math.round((720 * innerWidth) / Math.max(1, innerHeight)))); if (img && fit.w !== w) { fit.w = w; img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(paint(season, time, w)); } };
    fit(); addEventListener("resize", fit);
  }
  window.__splash = paint; // for previews
})();
