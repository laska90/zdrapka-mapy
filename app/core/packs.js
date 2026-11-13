// Several map packs on one projection make one map (packs: Sudety, Karpaty, ...; each may be on
// the phone only in parts, its download groups). Their indexes are merged into one: every tile
// keeps the address of its pack (base) and the offset of its pack's ranges (rgOff: the tiles
// number ranges within their pack). Tile numbers and segment keys are global already (from the
// grid, src/scratchcard/web/tiles.py), so they never clash.
//   spec: a base URL (one pack, all of it), or [{id, base, groups: [grp...] | null}]

/** The packs of a spec, normalised: [{id, base, groups}]. */
export function packList(spec) {
  if (typeof spec === "string") return [{ id: "", base: spec, groups: null }];
  return spec.map((p) => ({ id: p.id || "", base: p.base, groups: p.groups || null }));
}

/** Address of a file of a pack (path relative to the pack, or already absolute). */
export const packUrl = (base, path) => (/^[a-z]+:/i.test(path) ? path : base + path);

/** Load and merge the packs' indexes. load(url) -> parsed JSON. Returns {index, packs}. */
export async function openPacks(spec, load) {
  const list = packList(spec);
  const indexes = await Promise.all(list.map((p) => load(packUrl(p.base, "index.json"))));
  const packs = list.map((p, i) => ({ ...p, index: indexes[i] }));
  return { index: mergeIndexes(packs), packs };
}

/** One index from several ({id, base, groups, index}); a single pack keeps its own (plus bases). */
export function mergeIndexes(packs) {
  const first = packs[0].index, P = first.proj;
  for (const p of packs) if (p.index.proj.lon0 !== P.lon0 || p.index.proj.lat0 !== P.lat0) throw new Error(`pack ${p.id}: another projection`);
  const out = {
    ...first,
    region: packs.map((p) => p.index.region).join("+"),
    label: packs.map((p) => p.index.label).join(" · "),
    snapshot: packs.map((p) => `${p.index.region}:${p.index.snapshot}${p.groups ? `[${p.groups.join(",")}]` : ""}`).join("|"),
    terrain: packs.some((p) => p.index.terrain),
    tiles: [], ranges: [], routes: [], outline: [], sheets: [],
    attribution: [...new Set(packs.flatMap((p) => p.index.attribution || []))],
  };
  let b = [Infinity, Infinity, -Infinity, -Infinity];
  for (const p of packs) {
    const ix = p.index, rgOff = out.ranges.length, has = (g) => !p.groups || p.groups.includes(g || ix.region);
    for (const t of ix.tiles) if (has(t.grp)) out.tiles.push({ ...t, base: p.base, rgOff, pack: ix.region });
    // the ranges of parts not on the phone stay (their numbers are in the tiles), marked as missing
    for (const r of ix.ranges) out.ranges.push({ ...r, pack: ix.region, ...(has(r.grp) ? {} : { na: true }) });
    out.routes.push(...(ix.routes || []).map((r) => ({ ...r, pack: ix.region })));
    out.outline.push(...(ix.outline || []));
    out.sheets.push(ix.bounds);
    const [x0, y0, x1, y1] = ix.bounds;
    b = [Math.min(b[0], x0), Math.min(b[1], y0), Math.max(b[2], x1), Math.max(b[3], y1)];
  }
  out.bounds = b;
  return out;
}

/** A tile's own range numbers in the merged list. */
export const rgOf = (t, rg) => (rg >= 0 && t.rgOff ? rg + t.rgOff : rg);

/** Merge per-pack JSON side files (names.json, access.json) that hold lists or keyed objects. */
export function mergeSide(parts) {
  const ok = parts.filter(Boolean);
  if (ok.length <= 1) return ok[0] || null;
  const out = Array.isArray(ok[0]) ? [] : {};
  for (const part of ok) {
    if (Array.isArray(part)) { out.push(...part); continue; }
    for (const [k, v] of Object.entries(part)) {
      if (Array.isArray(v) && Array.isArray(out[k])) out[k] = out[k].concat(v);
      else if (v && typeof v === "object" && !Array.isArray(v) && out[k] && typeof out[k] === "object") out[k] = { ...out[k], ...v };
      else if (!(k in out)) out[k] = v;
    }
  }
  return out;
}
