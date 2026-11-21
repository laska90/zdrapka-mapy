// The map packs: public data only (OpenStreetMap, Copernicus DEM), published on the maps site
// (a public repository's GitHub Pages, apart from the app). A pack (Sudety, Karpaty, ...) is
// downloaded in parts (its groups: Tatry, Beskidy Zachodnie, ...) into the app's own storage and
// read from there (offline in the mountains); newer versions are offered when the site has them.
// All packs share one projection, so the parts on the phone make one map (core/packs.js).
// In a browser the packs are read straight from the site (or data/ next to the page: development).
//   <site>/maps.json         {v, regions: [{id (group), pack, label, version, bytes, count, ranges, manifest}]}
//   <site>/<pack>/files.json {version, core: [[path, bytes]], groups: {grp: [[path, bytes]]}, files}
//   phone: maps/<pack>/ the pack's files, version.json {version, groups}, files.json (its manifest)

// GitHub Pages of the maps repository (a CDN, compressed); the same files straight from the repository
// when Pages is not there (yet)
export const MAPS_SITES = ["https://laska90.github.io/zdrapka-mapy/", "https://raw.githubusercontent.com/laska90/zdrapka-mapy/main/"];
export const REGION = "sudety";
/** The backdrop (relief and land cover round and between the packs): not a part, it comes along. */
export const BACKDROP = "tlo";
const DIR = "DATA", PAR = 6;

let siteOverride = null;
try { siteOverride = new URL(location.href).searchParams.get("maps") || localStorage.getItem("zdrapka.maps") || null; } catch { /* no storage */ }
let siteOk = null; // the first of the sites that answered
export const site = () => (siteOverride ? siteOverride.replace(/\/?$/, "/") : siteOk || MAPS_SITES[0]);

/** The site's list of parts (fresh, not from a cache): from the first site that answers. */
export async function catalog() {
  let last = null;
  for (const s of siteOverride ? [site()] : MAPS_SITES) {
    try {
      const r = await fetch(s + "maps.json", { cache: "no-store" });
      if (!r.ok) throw new Error(`maps.json: HTTP ${r.status}`);
      const cat = await r.json();
      for (const reg of cat.regions || []) reg.pack ||= reg.id; // (the first site: one part per pack)
      if (!siteOverride) siteOk = s;
      return cat;
    } catch (e) { last = e; }
  }
  throw last;
}
export const regionOf = (cat, id = REGION) => cat?.regions?.find((r) => r.id === id) || null;

const fileUrl = (uri) => (globalThis.Capacitor?.convertFileSrc ? globalThis.Capacitor.convertFileSrc(uri) : uri);
const readJson = async (FS, path) => JSON.parse((await FS.readFile({ path, directory: DIR, encoding: "utf8" })).data);
const writeJson = (FS, path, v) => FS.writeFile({ path, data: JSON.stringify(v), directory: DIR, encoding: "utf8", recursive: true });

/** One pack on the phone: {id, base, version, groups} or null. (The first app versions kept
 * {version} only: their one part was the pack itself.) */
export async function localPack(FS, id = REGION) {
  try {
    const v = await readJson(FS, `maps/${id}/version.json`);
    const { uri } = await FS.getUri({ path: `maps/${id}`, directory: DIR });
    return { id, base: fileUrl(uri).replace(/\/?$/, "/"), version: v.version, groups: v.groups || [id] };
  } catch { return null; }
}

/** All packs on the phone. */
export async function localPacks(FS) {
  let names = [];
  try { names = (await FS.readdir({ path: "maps", directory: DIR })).files.map((f) => (typeof f === "string" ? f : f.name)); } catch { /* none yet */ }
  const out = [];
  const order = (n) => { const i = ["sudety", "karpaty", "swietokrzyskie"].indexOf(n); return i < 0 ? 99 : i; };
  for (const n of names.filter((n) => !n.endsWith(".part") && n !== BACKDROP).sort((a, b) => order(a) - order(b) || a.localeCompare(b))) { const p = await localPack(FS, n); if (p) out.push(p); }
  return out;
}

/** A manifest in the current shape (the first one: all files, one part named after the pack). */
const shape = (man, pack) => (man.core ? man : { version: man.version, core: man.files, groups: { [pack]: [] } });

/** The other sites, after the one in use (a file that fails on one is tried on the next). */
const sites = () => (siteOverride ? [site()] : [site(), ...MAPS_SITES.filter((s) => s !== site())]);

/** Make the folders of the files first, one by one (the downloads then only write files: several
 * of them creating one new folder at once can fail). */
async function makeDirs(FS, dir, list) {
  const dirs = [...new Set(list.map(([p]) => p.split("/").slice(0, -1).join("/")).filter(Boolean))].sort();
  for (const d of dirs) {
    try { await FS.mkdir({ path: `${dir}/${d}`, directory: DIR, recursive: true }); }
    catch (e) { if (!/exist/i.test(e?.message || "")) { try { await FS.stat({ path: `${dir}/${d}`, directory: DIR }); } catch { throw e; } } }
  }
}

/** A short reason for a failed download (shown to the user). */
export const why = (e) => String(e?.message || e || "?").replace(/^Error:\s*/, "").slice(0, 160);

/** Fetch files into dir (resumes: files already there with the right size are kept). */
const NATIVE = () => globalThis.Capacitor?.Plugins?.ZdrapkaDownload;

/** The files fetched by the app's foreground service (a notification with the progress): it goes on
 * with the screen off and the app in the background, where the WebView's own fetching stops. */
function nativeFiles(pack, dir, todo, version, onBytes) {
  const D = NATIVE();
  return new Promise((resolve, reject) => {
    let seen = 0, end = false, sub = null, poll = 0;
    const on = (s) => {
      if (end || !s) return;
      if (s.done > seen) { onBytes(s.done - seen); seen = s.done; }
      if (s.state === "run") return;
      end = true; clearInterval(poll); sub?.remove?.();
      s.state === "done" ? resolve() : reject(new Error(s.error || "pobieranie przerwane"));
    };
    Promise.resolve(D.addListener("progress", on)).then((h) => { sub = h; if (end) h?.remove?.(); });
    const files = todo.map(([p, b]) => ({ url: `${site()}${pack}/${p}?v=${encodeURIComponent(version)}`, path: `${dir}/${p}`, bytes: b }));
    D.start({ files, title: "Pobieram mapy" }).then(() => {
      // events kept while the WebView sleeps come on its waking; the poll covers any missed
      poll = setInterval(() => D.status().then(on, () => {}), 3000);
    }, (e) => { end = true; sub?.remove?.(); reject(e); });
  });
}

async function fetchFiles(FS, pack, dir, list, version, onBytes) {
  const todo = [];
  for (const [p, b] of list) {
    try { const st = await FS.stat({ path: `${dir}/${p}`, directory: DIR }); if (st.size === b) { onBytes(b); continue; } } catch { /* not yet */ }
    todo.push([p, b]);
  }
  try { await FS.mkdir({ path: dir, directory: DIR, recursive: true }); } catch { /* there */ }
  if (todo.length && NATIVE()) {
    try { return await nativeFiles(pack, dir, todo, version, onBytes); }
    catch (e) { if (String(e?.message || e) === "busy") throw new Error("pobieranie już trwa"); /* else the WebView's own way, below */ }
  }
  await makeDirs(FS, dir, todo);
  let err = null;
  const worker = async () => {
    while (todo.length && !err) {
      const [p, b] = todo.shift();
      for (let k = 0; ; k++) {
        const src = sites()[k % sites().length] + pack + "/";
        try { await FS.downloadFile({ url: `${src}${p}?v=${encodeURIComponent(version)}`, path: `${dir}/${p}`, directory: DIR, recursive: true }); break; }
        catch (e) { if (k >= 3) { err = new Error(`${p}: ${why(e)}`); return; } await new Promise((res) => setTimeout(res, 1000 * (k + 1))); }
      }
      onBytes(b);
    }
  };
  await Promise.all(Array.from({ length: PAR }, worker));
  if (err) throw err;
}

/** Put parts of a pack on the phone: want = the groups to have (those there already stay).
 * Same version on the phone: only the new parts' tiles come. A newer version: the pack anew
 * (with all its parts) beside the old one, which it replaces only when complete.
 * onProgress(doneBytes, totalBytes). Returns the pack as localPack does. */
export async function downloadParts(FS, pack, want, onProgress = () => {}) {
  const src = site() + pack + "/", dir = `maps/${pack}`;
  const r = await fetch(src + "files.json", { cache: "no-store" });
  if (!r.ok) throw new Error(`files.json: HTTP ${r.status}`);
  const man = shape(await r.json(), pack), have = await localPack(FS, pack);
  // a pack once whole (its one part named after it) and now in parts: all its parts
  const had = (have?.groups || []).flatMap((g) => (!man.groups[g] && g === pack ? Object.keys(man.groups) : [g]));
  const groups = [...new Set([...had, ...want])].filter((g) => man.groups[g]);
  const fresh = !have || have.version !== man.version;
  const list = [...(fresh ? man.core : []), ...groups.filter((g) => fresh || !have.groups.includes(g)).flatMap((g) => man.groups[g])];
  const total = list.reduce((s, [, b]) => s + b, 0);
  let done = 0;
  onProgress(0, total);
  const add = (b) => { done += b; onProgress(done, total); };
  if (!fresh) {
    await fetchFiles(FS, pack, dir, list, man.version, add);
    await writeJson(FS, `${dir}/version.json`, { version: man.version, groups });
    return localPack(FS, pack);
  }
  const tmp = `${dir}.part`;
  // a part left by an earlier attempt of another version: start over
  try { if ((await readJson(FS, `${tmp}/.version`)) !== man.version) await FS.rmdir({ path: tmp, directory: DIR, recursive: true }); } catch { /* none */ }
  await writeJson(FS, `${tmp}/.version`, man.version);
  await fetchFiles(FS, pack, tmp, list, man.version, add);
  await writeJson(FS, `${tmp}/files.json`, man);
  await writeJson(FS, `${tmp}/version.json`, { version: man.version, groups });
  try { await FS.rmdir({ path: dir, directory: DIR, recursive: true }); } catch { /* first time */ }
  await FS.rename({ from: tmp, to: dir, directory: DIR });
  return localPack(FS, pack);
}

/** (The first app versions' call: a whole one-part pack.) */
export const downloadPack = (FS, reg, onProgress) => downloadParts(FS, reg.pack || reg.id, [reg.id], onProgress);

/** Take a part off the phone (its tiles; the pack goes when it was the last part). */
export async function removePart(FS, pack, group) {
  const have = await localPack(FS, pack);
  if (!have) return;
  const groups = have.groups.filter((g) => g !== group);
  if (!groups.length) { await FS.rmdir({ path: `maps/${pack}`, directory: DIR, recursive: true }); return; }
  let man = null;
  try { man = shape(await readJson(FS, `maps/${pack}/files.json`), pack); } catch { /* no list: keep the files */ }
  for (const [p] of man?.groups[group] || []) { try { await FS.deleteFile({ path: `maps/${pack}/${p}`, directory: DIR }); } catch { /* gone */ } }
  await writeJson(FS, `maps/${pack}/version.json`, { version: have.version, groups });
}

/** The backdrop on the phone ({base, version}) or null. */
export const localBackdrop = (FS) => localPack(FS, BACKDROP);
/** The backdrop up to date on the phone (the site's newer one fetched; a few MB). Returns it or null. */
export async function getBackdrop(FS, cat, onProgress = () => {}) {
  const have = await localBackdrop(FS);
  if (!cat?.backdrop || (have && have.version >= cat.backdrop.version)) return have;
  return downloadParts(FS, BACKDROP, [], onProgress);
}
/** In a browser: the site's backdrop (none with a development pack). */
export async function webBackdrop() {
  try { return (await catalog()).backdrop ? site() + BACKDROP + "/" : null; } catch { return null; }
}

/** The spec the map is opened with (core/packs.js) from the packs on the phone. */
export const specOf = (packs) => packs.map((p) => ({ id: p.id, base: p.base, groups: p.groups }));

/** In a browser: data/ next to the page when it is there (development), else every pack on the site. */
export async function webBase() {
  if (!siteOverride) { try { const r = await fetch("data/index.json", { method: "HEAD", cache: "no-store" }); if (r.ok) return "data/"; } catch { /* not here */ } }
  let packs = [REGION];
  try { packs = [...new Set((await catalog()).regions.map((r) => r.pack))].filter((p) => p !== BACKDROP); } catch { /* the default */ }
  return packs.map((p) => ({ id: p, base: site() + p + "/", groups: null }));
}

export const mb = (b) => `${Math.max(1, Math.round(b / 1e6))} MB`;
