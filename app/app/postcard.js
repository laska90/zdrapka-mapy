// The postcard: an outing on the map, its figures and the places, as an image to share.
// C: the app as these parts see it (ctx in app.js: every name read when used).
import { shortName } from "./labels.js";
import { state } from "./state.js";
import { boxOf } from "../core/geometry.js";

export function createPostcard(C) {
  // reached; a picture to share (1080 x 1350)
  async function postcard(a) {
    C.busy("Robię pocztówkę…");
    try {
      const parts = (await C.call("track", { activity: a.id })).track?.parts || [];
      if (!parts.length) { C.toast("Brak śladu tego wyjścia", 3000); return; }
      const box = boxOf(parts), pad = Math.max(400, Math.max(box[2] - box[0], box[3] - box[1]) * 0.08);
      const snap = await C.view.snapshot([box[0] - pad, box[1] - pad, box[2] + pad, box[3] + pad], parts, 0.08);
      const W = 1080, H = 1350, MH = 1000, c = new OffscreenCanvas(W, H), g = c.getContext("2d");
      g.fillStyle = "#fbfaf6"; g.fillRect(0, 0, W, H);
      let k = 1, ox = 0, oy = 0;
      if (snap) { // the map, cut to the card's top (cover), the route laid out the same way
        const im = await createImageBitmap(await (await fetch(snap.url)).blob());
        k = Math.max(W / snap.W, MH / snap.H); ox = (W - snap.W * k) / 2; oy = (MH - snap.H * k) / 2;
        g.drawImage(im, ox, oy, snap.W * k, snap.H * k);
      }
      const pts = snap ? snap.lines : [];
      g.lineCap = "round"; g.lineJoin = "round";
      for (const [w, col] of [[16, "rgba(255,255,255,.95)"], [8, "#5b2bd1"]]) {
        g.strokeStyle = col; g.lineWidth = w;
        for (const p of pts) { g.beginPath(); for (let i = 0; i < p.length; i += 2) { const X = ox + p[i] * k, Y = oy + p[i + 1] * k; if (i) g.lineTo(X, Y); else g.moveTo(X, Y); } g.stroke(); }
      }
      const first = pts[0], last = pts[pts.length - 1];
      if (first?.length >= 2) { g.fillStyle = "#fff"; g.strokeStyle = "#5b2bd1"; g.lineWidth = 6; g.beginPath(); g.arc(ox + first[0] * k, oy + first[1] * k, 13, 0, 7); g.fill(); g.stroke(); }
      if (last?.length >= 2) { g.fillStyle = "#5b2bd1"; g.beginPath(); g.arc(ox + last.at(-2) * k, oy + last.at(-1) * k, 13, 0, 7); g.fill(); }
      // the card under the map
      g.fillStyle = "#fbfaf6"; g.fillRect(0, MH, W, H - MH);
      g.fillStyle = "#5b2bd1"; g.fillRect(0, MH, W, 8);
      g.fillStyle = "#1d1f1e"; g.font = "700 54px system-ui, sans-serif"; g.textBaseline = "top";
      const fit = (t, max) => { let s2 = t; while (g.measureText(s2).width > max && s2.length > 4) s2 = s2.slice(0, -2); return s2 === t ? t : s2 + "…"; };
      g.fillText(fit(a.name || "Wyjście", W - 120), 60, MH + 44);
      g.fillStyle = "#5c605d"; g.font = "500 32px system-ui, sans-serif";
      g.fillText(a.start != null ? new Date(a.start).toLocaleDateString("pl-PL", { day: "numeric", month: "long", year: "numeric" }) : "", 60, MH + 112);
      const figs = [[`${C.nf(a.km)}`, "km"], ...(a.ele ? [[`↑${C.nf(a.asc || 0, 0)}`, "m"], [`↓${C.nf(a.desc || 0, 0)}`, "m"]] : []), ...(C.dur(a) ? [[C.dur(a).replace(" h", ""), "h"]] : [])];
      let x = 60;
      for (const [v, u] of figs) { g.fillStyle = "#1d1f1e"; g.font = "800 58px system-ui, sans-serif"; g.fillText(v, x, MH + 166); const w = g.measureText(v).width; g.fillStyle = "#5c605d"; g.font = "500 30px system-ui, sans-serif"; g.fillText(u, x + w + 8, MH + 190); x += w + g.measureText(u).width + 54; }
      const peaks = Object.values(state.result?.found || {}).filter((f) => f.n && (f.c === "peak" || f.c === "hut") && f.outs?.some(([o]) => o === a.id)).sort((p, q) => (q.e || 0) - (p.e || 0)).slice(0, 4).map((f) => shortName(f.n));
      g.fillStyle = "#3a2c7a"; g.font = "600 30px system-ui, sans-serif";
      if (peaks.length) g.fillText(fit(peaks.join(" · "), W - 120), 60, MH + 258);
      g.fillStyle = "#9a9d9b"; g.font = "600 24px system-ui, sans-serif"; g.textAlign = "right";
      g.fillText("Zdrapka górska", W - 60, H - 50); g.textAlign = "left";
      g.font = "400 18px system-ui, sans-serif"; g.fillText("© OpenStreetMap · Copernicus DEM", 60, H - 46);
      const blob = await c.convertToBlob({ type: "image/png" });
      const file = (a.name || "wyjscie").replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-|-$/g, "").toLowerCase();
      await C.shareBlob(blob, `pocztowka-${file}.png`, a.name || "Wyjście");
    } catch (e) { C.toast("Nie udało się zrobić pocztówki: " + (e?.message || e), 5000); } finally { C.idle(); }
  }

  return { postcard };
}
