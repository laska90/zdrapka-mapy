// Test cases from the field (Szczyty w aparacie): what the camera sees, saved with all the app knew at that
// moment (where you stood and how sure the GPS was, the sensors' raw readings, the pitch from gravity, the
// lens's field of view, your corrections and the sky model's), kept on the phone until sent (no signal
// needed up there), then shared all at once as one zip: the photo and its JSON per case. On the computer,
// tools/caseimport.mjs puts them into the test sets (test/near/cases.json, test/.dem).

const DB = "zdrapka-cases", STORE = "cases";

function db() {
  return new Promise((ok, no) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE, { autoIncrement: true });
    r.onsuccess = () => ok(r.result);
    r.onerror = () => no(r.error);
  });
}
async function tx(mode, fn) {
  const d = await db();
  try {
    return await new Promise((ok, no) => {
      const t = d.transaction(STORE, mode), s = t.objectStore(STORE), r = fn(s);
      t.oncomplete = () => ok(r?.result);
      t.onerror = () => no(t.error);
    });
  } finally { d.close(); }
}

/** Save one case: the photo (a JPEG Blob) and what was known (an object). */
export const saveCase = (jpg, meta) => tx("readwrite", (s) => s.add({ jpg, meta }));
export const countCases = () => tx("readonly", (s) => s.count());
export const allCases = () => tx("readonly", (s) => s.getAll());
export const clearCases = () => tx("readwrite", (s) => s.clear());

/** All the cases as one zip (stored, not deflated: the photos are JPEGs already): case-N.jpg + case-N.json. */
export async function casesZip() {
  const list = await allCases(), files = [];
  for (const { jpg, meta } of list) {
    const base = meta.img.replace(/\.jpg$/, "");
    files.push([`${base}.jpg`, new Uint8Array(await jpg.arrayBuffer())]);
    files.push([`${base}.json`, new TextEncoder().encode(JSON.stringify(meta, null, 1))]);
  }
  return { blob: zip(files), n: list.length };
}

// ---- a zip (STORE), enough for a few dozen photos
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc32(b) { let c = 0xffffffff; for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
export function zip(files) {
  const parts = [], central = [];
  let off = 0;
  for (const [name, data] of files) {
    const nb = new TextEncoder().encode(name), crc = crc32(data);
    const h = new DataView(new ArrayBuffer(30));
    h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(6, 0x0800, true); // (UTF-8 names)
    h.setUint32(14, crc, true); h.setUint32(18, data.length, true); h.setUint32(22, data.length, true); h.setUint16(26, nb.length, true);
    parts.push(new Uint8Array(h.buffer), nb, data);
    const c = new DataView(new ArrayBuffer(46));
    c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(8, 0x0800, true);
    c.setUint32(16, crc, true); c.setUint32(20, data.length, true); c.setUint32(24, data.length, true); c.setUint16(28, nb.length, true); c.setUint32(42, off, true);
    central.push(new Uint8Array(c.buffer), nb);
    off += 30 + nb.length + data.length;
  }
  const size = central.reduce((s, b) => s + b.length, 0), e = new DataView(new ArrayBuffer(22));
  e.setUint32(0, 0x06054b50, true); e.setUint16(8, files.length, true); e.setUint16(10, files.length, true); e.setUint32(12, size, true); e.setUint32(16, off, true);
  return new Blob([...parts, ...central, new Uint8Array(e.buffer)], { type: "application/zip" });
}
