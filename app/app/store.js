// IndexedDB: activities stay on this device. Usable from the page and workers.
//   activities  full tracks (packed)                 key: id
//   meta        {id, name, sport, start, km}         key: id   (cheap to list)
//   results     per-activity match result (cache)    key: id
//   titles      names given by hand {id, title}       key: id (survive re-imports)

const DB = "scratchcard", VERSION = 3, ACT = "activities", META = "meta", RES = "results", TIT = "titles";

const metaOf = (a) => ({ id: a.id, name: a.name, sport: a.sport, start: a.start, end: a.end, km: a.km, ele: !!a.ele, asc: a.asc ?? null, desc: a.desc ?? null, manual: !!a.manual });

function open() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, VERSION);
    req.onupgradeneeded = (ev) => {
      const db = req.result, tx = req.transaction;
      if (!db.objectStoreNames.contains(ACT)) db.createObjectStore(ACT, { keyPath: "id" });
      if (!db.objectStoreNames.contains(RES)) db.createObjectStore(RES, { keyPath: "id" });
      if (!db.objectStoreNames.contains(TIT)) db.createObjectStore(TIT, { keyPath: "id" });
      if (!db.objectStoreNames.contains(META)) {
        const meta = db.createObjectStore(META, { keyPath: "id" });
        if (ev.oldVersion >= 1) {
          tx.objectStore(ACT).openCursor().onsuccess = (e) => {
            const c = e.target.result;
            if (!c) return;
            meta.put(metaOf(c.value));
            c.continue();
          };
        }
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx(stores, mode, fn) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const t = db.transaction(stores, mode);
    let out;
    Promise.resolve(fn(...[].concat(stores).map((s) => t.objectStore(s)))).then((v) => (out = v));
    t.oncomplete = () => { db.close(); resolve(out); };
    t.onerror = () => { db.close(); reject(t.error); };
  });
}

const req2p = (r) => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });

/** Compact parts: [{t: Float64Array, lat: Float64Array, lon: Float64Array}] */
export const packParts = (parts) => parts.map((p) => ({ t: Float64Array.from(p, (q) => q.t), lat: Float64Array.from(p, (q) => q.lat), lon: Float64Array.from(p, (q) => q.lon), ele: Float32Array.from(p, (q) => (q.ele == null ? NaN : q.ele)) }));
export const unpackParts = (parts) => parts.map((p) => Array.from(p.t, (t, i) => ({ t, lat: p.lat[i], lon: p.lon[i], ele: p.ele && Number.isFinite(p.ele[i]) ? p.ele[i] : null })));

export const putActivities = (acts) => tx([ACT, META], "readwrite", (a, m) => { for (const x of acts) { a.put({ ...x, parts: packParts(x.parts) }); m.put(metaOf(x)); } });
export const getActivity = (id) => tx(ACT, "readonly", (s) => req2p(s.get(id))).then((a) => a && { ...a, parts: unpackParts(a.parts) });
export const allActivities = () => tx(ACT, "readonly", (s) => req2p(s.getAll())).then((rows) => rows.map((a) => ({ ...a, parts: unpackParts(a.parts) })));
export const allMeta = () => tx(META, "readonly", (s) => req2p(s.getAll()));
export const activityIds = () => tx(META, "readonly", (s) => req2p(s.getAllKeys()));
export const deleteActivity = (id) => tx([ACT, META, RES], "readwrite", (a, m, r) => { a.delete(id); m.delete(id); r.delete(id); });
export const clearActivities = () => tx([ACT, META, RES], "readwrite", (a, m, r) => { a.clear(); m.clear(); r.clear(); });

export const allResults = () => tx(RES, "readonly", (s) => req2p(s.getAll()));
export const putResult = (r) => tx(RES, "readwrite", (s) => { s.put(r); });

export const allTitles = () => tx(TIT, "readonly", (s) => req2p(s.getAll()));
export const setTitle = (id, title) => tx(TIT, "readwrite", (s) => { if (title) s.put({ id, title }); else s.delete(id); });
