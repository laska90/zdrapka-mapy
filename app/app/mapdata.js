// What the page asks the map (the old drawing worker answered it): the point under a finger, names
// for the search, the ground height at a spot, is a spot scratched off. The GL map knows what is
// drawn (queryRenderedFeatures); the rest comes from the packs' side files (names.json,
// t/<tile>/terrain.json), loaded when first needed.

import { mergeSide, packUrl } from "../core/packs.js";
import { decodeLine } from "../core/geometry.js";
import { contourLines, heightAt } from "../core/contour-elev.js";
import { badgeFields, badgePoints, badgesOf } from "../core/badges.js";
import { glyphKey } from "./glyphs.js";

const GRID = 1000; // m, the scratched-off discs by cell
const fold = (t) => (t || "").toLocaleLowerCase("pl").normalize("NFD").replace(/\p{M}/gu, "").replace(/ł/g, "l");
/** Every word of q (folded) begins like a word of the name, Polish endings aside ("stare wierchy" finds
 * "Schronisko na Starych Wierchach"): a common start of 4 letters or more (the whole word when shorter). */
export function stemMatch(q, n) {
  const ws = fold(n).split(/[^\p{L}\p{N}]+/u).filter(Boolean), qs = q.split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  const pre = (a, b) => { let i = 0; while (i < a.length && i < b.length && a[i] === b[i]) i++; return i; };
  return qs.length > 0 && qs.every((w) => ws.some((v) => pre(w, v) >= Math.min(w.length, Math.max(4, w.length - 3))));
}
const meets = (a, b) => a[0] <= b[2] && b[0] <= a[2] && a[1] <= b[3] && b[1] <= a[3];

export class MapData {
  constructor(view, packs) {
    this.v = view; this.packs = packs; this.index = view.index;
    this.badgePts = badgePoints((lon, lat) => view.xy(lon, lat));
    this.found = {}; this.badgeHits = {}; this.grid = new Map();
    this.names = null; this.elev = new Map();
  }
  get namesReady() {
    return (this._names ||= Promise.all(this.packs.map((p) => fetch(packUrl(p.base, "names.json")).then((r) => (r.ok ? r.json() : null)).catch(() => null))).then((l) => (this.names = mergeSide(l))));
  }

  setFound(found, badges) { this.found = found || {}; this.badgeHits = badges || {}; }
  setReveal(discs) {
    const g = new Map();
    for (const [x, y, r] of discs) {
      for (let i = Math.floor((x - r) / GRID); i <= Math.floor((x + r) / GRID); i++) for (let j = Math.floor((y - r) / GRID); j <= Math.floor((y + r) / GRID); j++) {
        const k = i * 100003 + j; let a = g.get(k); if (!a) g.set(k, (a = [])); a.push(x, y, r);
      }
    }
    this.grid = g;
  }
  inHole(x, y) {
    const a = this.grid.get(Math.floor(x / GRID) * 100003 + Math.floor(y / GRID));
    if (a) for (let i = 0; i < a.length; i += 3) if ((x - a[i]) ** 2 + (y - a[i + 1]) ** 2 <= a[i + 2] ** 2) return true;
    return false;
  }
  /** A point as the page knows it: reached (d, f first, v visits), in a hole (h), the lists it is on. */
  mark(p) {
    if (p.c === "peak") { const b = badgesOf(p, this.badgePts); Object.assign(p, badgeFields(b), { bids: b?.ids }); }
    const f = this.found[p.id] || (p.bids?.length ? p.bids.map((id) => this.badgeHits[id]).filter(Boolean).sort((a, b) => a.first - b.first)[0] : null);
    p.d = !!f; p.f = f?.first ?? null; p.v = f?.visits ?? 0;
    p.h = this.inHole(p.x, p.y);
    p.key = glyphKey(p);
    return p;
  }

  /** The sign or name under a screen point (within ~38 px), or null. */
  /** The sign, name or junction dot under a screen point, within R px (no need to hit it exactly; a
   * sign counts as a little nearer than a dot beside it). */
  pick(sx, sy, R = 26, named = false) {
    const map = this.v.map;
    if (!map) return null;
    const ids = this.v.styleLayers(map).filter((l) => (named ? /^(found|poi[-:]|place[-:]|pass:|station:|parking:|junction:)/ : /^(found|poi[-:]|place[-:]|pass:|station:|parking:|junction:|liftst:)/).test(l.id)).map((l) => l.id); // (a name for a spot: not a lift's, they are odd)
    const fs = map.queryRenderedFeatures([[sx - R, sy - R], [sx + R, sy + R]], { layers: ids });
    let best = null, bd = Infinity;
    for (const f of fs) {
      if (f.geometry.type !== "Point" || (named && !f.properties.n)) continue;
      const [lon, lat] = f.geometry.coordinates, q = map.project([lon, lat]), dd = Math.hypot(q.x - sx, q.y - sy) * (/^(poi|found)/.test(f.layer.id) ? 0.8 : /^liftst/.test(f.layer.id) ? 1.15 : 1);
      if (dd > R) continue;
      if (dd < bd) { bd = dd; best = f; }
    }
    if (!best) return null;
    const pr = best.properties, [x, y] = this.v.xy(...best.geometry.coordinates);
    const layer = best.layer.id.split(":")[0].replace(/-(far|water)$/, "");
    if (layer === "liftst") return { c: "lift", lid: pr.lid, end: pr.end, at: pr.at, n: pr.n || null, x, y };
    const p = layer === "junction" ? { c: "junction", n: pr.n || null, e: pr.e ?? null, cols: pr.cols || "", x, y } : layer === "place" ? { c: "place", n: pr.n, p: pr.p, x, y } : ["pass", "station", "parking"].includes(layer) ? { c: pr.k, n: pr.n, e: pr.e, x, y } : { id: pr.id, c: pr.c, n: pr.n, e: pr.e, rg: pr.rg, x, y };
    return this.mark(p);
  }

  /** The colours of the marked trail drawn under a screen point (within R px), e.g. "red,blue", or "". */
  trailCols(sx, sy, R = 10) {
    const map = this.v.map;
    if (!map) return "";
    const ids = this.v.styleLayers(map).filter((l) => /^trail-0(:|$)/.test(l.id)).map((l) => l.id);
    if (!ids.length) return "";
    const fs = map.queryRenderedFeatures([[sx - R, sy - R], [sx + R, sy + R]], { layers: ids });
    return fs.map((f) => f.properties.cols || "").find(Boolean) || "";
  }

  /** Named points whose folded name contains q (at most 60, those starting with it first). */
  async search(q) {
    const N = this.names || (await this.namesReady);
    if (!N) return [];
    const out = [], seen = new Set();
    for (const [id, n, c, x, y, e] of N.pois || []) { if ((fold(n).includes(q) || (q.length >= 4 && stemMatch(q, n))) && !seen.has(id)) { seen.add(id); out.push({ id, c, n, e, x, y }); } if (out.length >= 400) break; }
    for (const [n, kind, x, y] of N.places || []) {
      const k = `${n}:${Math.round(x / 3000)}:${Math.round(y / 3000)}`;
      if (fold(n).includes(q) && !seen.has(k)) { seen.add(k); out.push({ c: "place", n, p: kind, x, y }); }
      if (out.length >= 400) break;
    }
    return out.map((p) => [fold(p.n).startsWith(q) ? 0 : 1, p]).sort((a, b) => a[0] - b[0]).slice(0, 60)
      .map(([, p]) => ({ ...this.mark(p), rl: this.v.rangeOf(p.x, p.y)?.short || null }));
  }

  /** Ground height (m) at a pack point from the contours of its tile(s), or null. */
  async elevAt(x, y) {
    if (!this.index.terrain) return null;
    const R = 700, near = this.index.tiles.filter((t) => meets(t.cell, [x - R, y - R, x + R, y + R]));
    if (!near.some((t) => t.cell[0] <= x && x <= t.cell[2] && t.cell[1] <= y && y <= t.cell[3])) return null;
    const sets = await Promise.all(near.map((t) => {
      let c = this.elev.get(t.no);
      if (!c) {
        c = fetch(`${t.base}t/${t.id}/terrain.json`).then((r) => r.json()).then((tr) => contourLines(tr, decodeLine, this.index.scale || 10)).catch(() => []);
        this.elev.set(t.no, c);
        if (this.elev.size > 6) this.elev.delete(this.elev.keys().next().value);
      }
      return c;
    }));
    const r = heightAt(sets, x, y, { R });
    return r ? { h: Math.round(r.h), kind: r.kind } : null;
  }
}
