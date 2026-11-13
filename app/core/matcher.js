// Matching v1 (port of src/scratchcard/match/matcher.py - see its docstring for
// the full description). Works on pack metres: track points {t (ms), x, y}.

import { GridIndex } from "./geometry.js";

export const MATCH_DEFAULTS = {
  innerM: 15, outerM: 40, ambiguityM: 8, exitM: 50, exitS: 60, coverFrac: 0.8, endTolM: 15,
  reversalFrac: 0.3, reversalMinM: 20, reversalMaxM: 100, extremeTolM: 10,
  stationaryWindowS: 60, stationaryMinM: 20, dwellRadiusM: 35, dwellMinS: 120,
  parallelM: 25, overlapFrac: 0.6, shortM: 30, shortChainM: 120, shortChainHops: 6,
  shortGapS: 600, minPartialM: 25,
};

const sweepStart = (s, t) => ({ lo: s, hi: s, loFirst: t, loLast: t, hiFirst: t, hiLast: t, dir: 0, firstS: s, loFirstS: s, hiFirstS: s });
const sweepWindow = (sw) => {
  const [t0, t1] = sw.dir > 0 ? [sw.loLast, sw.hiFirst] : [sw.hiLast, sw.loFirst];
  return t0 <= t1 ? [t0, t1] : [t1, t0];
};

export class Matcher {
  /**
   * @param net decoded network: {lines: Polyline[], sn, en}
   * @param params overrides of MATCH_DEFAULTS
   * @param filter optional (k) => bool, index only these segments (e.g. near the tracks)
   */
  constructor(net, params = {}, filter = null) {
    this.p = { ...MATCH_DEFAULTS, ...params };
    this.net = net;
    this.lines = net.lines;
    this.index = new GridIndex(this.lines, this.p.outerM, 64, filter);
    this.short = this.lines.map((l) => l.length < this.p.shortM);
    this.shortAtNode = new Map();
    this.lines.forEach((l, k) => {
      if (!this.short[k] || (filter && !filter(k))) return;
      for (const n of [net.sn[k], net.en[k]]) {
        if (!this.shortAtNode.has(n)) this.shortAtNode.set(n, []);
        this.shortAtNode.get(n).push(k);
      }
    });
  }

  assign(px, py) {
    const near = this.index.nearestPerLine(px, py, this.p.outerM);
    if (!near.size) return [near, -1];
    let winner = -1, dmin = Infinity;
    for (const [k, [d]] of near) if (d < dmin) { dmin = d; winner = k; }
    for (const [k, [d]] of near) if (d > dmin + this.p.ambiguityM) near.delete(k);
    return [near, winner];
  }

  h(k) {
    const p = this.p;
    return Math.min(Math.max(p.reversalFrac * this.lines[k].length, p.reversalMinM), p.reversalMaxM);
  }

  static extend(sw, s, t, tol) {
    if (sw.dir >= 0 && s > sw.hi) { sw.hi = s; if (sw.hiFirstS < s - tol) { sw.hiFirst = t; sw.hiFirstS = s; } }
    if (sw.dir <= 0 && s < sw.lo) { sw.lo = s; if (sw.loFirstS > s + tol) { sw.loFirst = t; sw.loFirstS = s; } }
  }

  static advance(sw, s, t, h, tol) {
    if (s < sw.lo) { sw.lo = s; if (sw.loFirstS > s + tol) { sw.loFirst = t; sw.loFirstS = s; } }
    if (s > sw.hi) { sw.hi = s; if (sw.hiFirstS < s - tol) { sw.hiFirst = t; sw.hiFirstS = s; } }
    if (s <= sw.lo + tol) sw.loLast = t;
    if (s >= sw.hi - tol) sw.hiLast = t;
    if (sw.dir === 0) {
      if (sw.hi - sw.lo >= h) sw.dir = s - sw.firstS > 0 ? 1 : -1;
      return null;
    }
    if (sw.dir > 0 && sw.hi - s > h) {
      const done = { ...sw };
      Object.assign(sw, { dir: -1, lo: s, loFirst: t, loLast: t, loFirstS: s });
      return done;
    }
    if (sw.dir < 0 && s - sw.lo > h) {
      const done = { ...sw };
      Object.assign(sw, { dir: 1, hi: s, hiFirst: t, hiLast: t, hiFirstS: s });
      return done;
    }
    return null;
  }

  covers(k, sw) {
    const L = this.lines[k].length;
    if (L <= 0) return null;
    const frac = (sw.hi - sw.lo) / L, tol = Math.min(this.p.endTolM, 0.2 * L);
    const ends = sw.lo <= tol && sw.hi >= L - tol;
    return frac >= this.p.coverFrac || (ends && frac >= 0.5) ? Math.min(frac, 1) : null;
  }

  moving(pts) {
    const p = this.p, n = pts.length, out = new Array(n).fill(true), half = (p.stationaryWindowS / 2) * 1000;
    let lo = 0, hi = 0;
    for (let i = 0; i < n; i++) {
      while (pts[i].t - pts[lo].t > half) lo++;
      while (hi + 1 < n && pts[hi + 1].t - pts[i].t <= half) hi++;
      if (hi > lo) out[i] = Math.hypot(pts[hi].x - pts[lo].x, pts[hi].y - pts[lo].y) >= p.stationaryMinM;
    }
    const r2 = p.dwellRadiusM ** 2, core2 = (p.dwellRadiusM / 2) ** 2;
    let i = 0;
    while (i < n) {
      let j = i;
      while (j + 1 < n && (pts[j + 1].x - pts[i].x) ** 2 + (pts[j + 1].y - pts[i].y) ** 2 <= r2) j++;
      if ((pts[j].t - pts[i].t) / 1000 >= p.dwellMinS) {
        let cx = 0, cy = 0;
        for (let k = i; k <= j; k++) { cx += pts[k].x; cy += pts[k].y; }
        cx /= j - i + 1; cy /= j - i + 1;
        let first = -1, last = -1;
        for (let k = i; k <= j; k++) if ((pts[k].x - cx) ** 2 + (pts[k].y - cy) ** 2 <= core2) { if (first < 0) first = k; last = k; }
        if (first >= 0) for (let k = first; k <= last; k++) out[k] = false;
        i = j + 1;
      } else i++;
    }
    return out;
  }

  static stopCentres(pts, moving) {
    const out = pts.map((q) => [q.x, q.y]);
    let i = 0;
    while (i < pts.length) {
      if (moving[i]) { i++; continue; }
      let j = i;
      while (j + 1 < pts.length && !moving[j + 1]) j++;
      let cx = 0, cy = 0;
      for (let k = i; k <= j; k++) { cx += pts[k].x; cy += pts[k].y; }
      cx /= j - i + 1; cy /= j - i + 1;
      for (let k = i; k <= j; k++) out[k] = [cx, cy];
      i = j + 1;
    }
    return out;
  }

  /** Traversals for one continuous part: [{k, activity, part, t0, t1, dir, coverage, full, lo, hi, inferred}] */
  matchPart(pts, activity, part) {
    const p = this.p, visits = new Map(), raw = [];
    const close = (k, v) => {
      const sw = v.sweep;
      if (sw.dir === 0) sw.dir = sw.hiFirst >= sw.loFirst ? 1 : -1;
      const L = this.lines[k].length;
      for (const s of [...v.sweeps, sw]) {
        let cov = this.covers(k, s);
        const full = cov !== null;
        let lo = 0, hi = 1;
        if (!full) {
          if (L <= 0 || s.hi - s.lo < p.minPartialM) continue;
          const tol = Math.min(p.endTolM, 0.2 * L);
          lo = s.lo <= tol ? 0 : s.lo / L;
          hi = s.hi >= L - tol ? 1 : s.hi / L;
          cov = hi - lo;
        }
        const [t0, t1] = sweepWindow(s);
        raw.push({ k, activity, part, t0, t1, dir: s.dir, coverage: cov, full, lo, hi, inferred: false, wins: v.wins.filter((w) => w >= t0 && w <= t1) });
      }
    };

    const mov = this.moving(pts), anchor = Matcher.stopCentres(pts, mov);
    let prev = null;
    for (let idx = 0; idx < pts.length; idx++) {
      const pt = pts[idx];
      const step = prev ? Math.hypot(pt.x - prev.x, pt.y - prev.y) : 0;
      prev = pt;
      const [obs, winner] = this.assign(pt.x, pt.y);
      if (!mov[idx]) {
        const at = this.index.nearestPerLine(anchor[idx][0], anchor[idx][1], p.outerM);
        for (const k of obs.keys()) {
          const v = visits.get(k);
          if (!v) continue;
          v.lastIn = pt.t; v.away = 0;
          if (at.has(k)) Matcher.extend(v.sweep, at.get(k)[1], pt.t, p.extremeTolM);
        }
        continue;
      }
      for (const [k, v] of [...visits]) {
        if (obs.has(k)) continue;
        v.away += step;
        if (v.away > p.exitM || (pt.t - v.lastIn) / 1000 > p.exitS) { close(k, v); visits.delete(k); }
      }
      for (const [k, [d, s]] of obs) {
        if (this.short[k]) continue;
        let v = visits.get(k);
        if (!v) {
          if (d > p.innerM) continue;
          v = { sweep: sweepStart(s, pt.t), lastIn: pt.t, away: 0, sweeps: [], wins: [] };
          visits.set(k, v);
        }
        v.lastIn = pt.t; v.away = 0;
        if (k === winner) v.wins.push(pt.t);
        const done = Matcher.advance(v.sweep, s, pt.t, this.h(k), p.extremeTolM);
        if (done) v.sweeps.push(done);
      }
    }
    for (const [k, v] of visits) close(k, v);
    const kept = this.dropParallel(raw);
    kept.push(...this.inferShort(kept.filter((t) => t.full)));
    kept.sort((a, b) => a.t0 - b.t0 || a.k - b.k);
    for (const t of kept) delete t.wins;
    return kept;
  }

  sideBySide(ka, kb) {
    const la = this.lines[ka], lb = this.lines[kb];
    const [sh, lg] = la.length <= lb.length ? [la, lb] : [lb, la];
    const [mx, my] = sh.pointAt(sh.length / 2);
    return lg.distanceTo(mx, my) <= this.p.parallelM;
  }

  dropParallel(trs) {
    const frac = this.p.overlapFrac;
    trs = [...trs].sort((a, b) => a.t0 - b.t0);
    const dropped = new Set();
    const winsIn = (t, o0, o1) => t.wins.reduce((n, w) => n + (w >= o0 && w <= o1 ? 1 : 0), 0);
    for (let i = 0; i < trs.length; i++) {
      if (dropped.has(i)) continue;
      const a = trs[i];
      for (let j = i + 1; j < trs.length; j++) {
        const b = trs[j];
        if (b.t0 >= a.t1) break;
        if (dropped.has(j)) continue;
        const o0 = Math.max(a.t0, b.t0), o1 = Math.min(a.t1, b.t1), overlap = o1 - o0;
        const da = a.t1 - a.t0, db = b.t1 - b.t0;
        if (Math.min(da, db) <= 0 || overlap < frac * Math.min(da, db)) continue;
        if (!this.sideBySide(a.k, b.k)) continue;
        const ra = overlap / da, rb = overlap / db;
        let loserIsA;
        if (ra >= frac && rb >= frac) {
          const sa = [a.full ? 1 : 0, winsIn(a, o0, o1)], sb = [b.full ? 1 : 0, winsIn(b, o0, o1)];
          loserIsA = sb[0] > sa[0] || (sb[0] === sa[0] && sb[1] > sa[1]);
        } else loserIsA = ra > rb;
        if (loserIsA) { dropped.add(i); break; }
        dropped.add(j);
      }
    }
    return trs.filter((_, i) => !dropped.has(i));
  }

  exitNode(t) { return t.dir > 0 ? this.net.en[t.k] : this.net.sn[t.k]; }
  entryNode(t) { return t.dir > 0 ? this.net.sn[t.k] : this.net.en[t.k]; }

  shortPath(a, b) {
    const p = this.p, best = new Map([[a, 0]]), prev = new Map(), queue = [[a, 0]];
    for (let qi = 0; qi < queue.length; qi++) {
      const [node, hops] = queue[qi];
      if (hops >= p.shortChainHops) continue;
      for (const k of this.shortAtNode.get(node) || []) {
        const fwd = this.net.sn[k] === node, nxt = fwd ? this.net.en[k] : this.net.sn[k];
        const dist = best.get(node) + this.lines[k].length;
        if (dist > p.shortChainM || dist >= (best.has(nxt) ? best.get(nxt) : Infinity)) continue;
        best.set(nxt, dist); prev.set(nxt, [node, k, fwd ? 1 : -1]);
        queue.push([nxt, hops + 1]);
      }
    }
    if (!prev.has(b)) return null;
    const chain = [];
    let node = b;
    while (node !== a) { const [pn, k, d] = prev.get(node); chain.push([k, d]); node = pn; }
    return chain.reverse();
  }

  inferShort(trs) {
    if (!this.shortAtNode.size) return [];
    const out = [];
    trs = [...trs].sort((a, b) => a.t0 - b.t0);
    for (let i = 0; i + 1 < trs.length; i++) {
      const t1 = trs[i], t2 = trs[i + 1], a = this.exitNode(t1), b = this.entryNode(t2);
      if (a === b || (t2.t0 - t1.t1) / 1000 > this.p.shortGapS) continue;
      const chain = this.shortPath(a, b);
      if (!chain) continue;
      const s0 = Math.min(t1.t1, t2.t0), s1 = Math.max(t1.t1, t2.t0);
      for (const [k, d] of chain) out.push({ k, activity: t1.activity, part: t1.part, t0: s0, t1: s1, dir: d, coverage: 1, full: true, lo: 0, hi: 1, inferred: true });
    }
    return out;
  }

  matchActivity(activity, parts) {
    const out = [];
    parts.forEach((pts, i) => out.push(...this.matchPart(pts, activity, i)));
    return out;
  }
}
