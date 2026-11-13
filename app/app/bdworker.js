// The backdrop's two pictures made off the page (the same work glmap.js setBackdrop did on it: seconds
// on a phone, the map stuck meanwhile): land (forests and water, blurred and cut again: smooth shapes)
// and relief (shadows warm dark, sunlit slopes light, flat ground clear), both with soft edges.
// In: {land, relief} (absolute URLs or null). Out: {land, relief} (PNG blobs or null) | {error}.

const W = 2048, ss = (a, b, t) => { const k = Math.max(0, Math.min(1, (t - a) / (b - a))); return k * k * (3 - 2 * k); };
const cv = (w, h) => { const c = new OffscreenCanvas(w, h); return [c, c.getContext("2d", { willReadFrequently: true })]; };
const load = async (u) => createImageBitmap(await (await fetch(u)).blob());
const png = (c) => c.convertToBlob({ type: "image/png" });

async function land(url) {
  const lc = await load(url), H = Math.round((lc.height * W) / lc.width);
  const edge = (x, y) => Math.max(0, Math.min(1, Math.min(x, y, W - 1 - x, H - 1 - y) / (W * 0.06)));
  const [c0, g0] = cv(lc.width, lc.height); g0.drawImage(lc, 0, 0);
  const src = g0.getImageData(0, 0, lc.width, lc.height).data, mk = g0.createImageData(lc.width, lc.height);
  for (let i = 0; i < src.length; i += 4) {
    const f = src[i + 3] > 0 && Math.abs(src[i] - 198) < 14 && Math.abs(src[i + 1] - 224) < 14 && Math.abs(src[i + 2] - 164) < 14;
    const w = src[i + 3] > 0 && src[i + 2] > 228 && src[i] < 190;
    mk.data[i] = w ? 255 : 0; mk.data[i + 1] = f ? 255 : 0; mk.data[i + 3] = 255;
  }
  g0.putImageData(mk, 0, 0);
  const [, gb] = cv(W, H); gb.filter = "blur(2.2px)"; gb.drawImage(c0, 0, 0, W, H);
  const bl = gb.getImageData(0, 0, W, H).data, [cf, gf] = cv(W, H), out = gf.createImageData(W, H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = (y * W + x) * 4, e = edge(x, y), wa = ss(0.4, 0.6, bl[i] / 255);
    if (wa > 0.01) { out.data[i] = 170; out.data[i + 1] = 208; out.data[i + 2] = 236; out.data[i + 3] = 255 * wa * e; }
    else { const f = ss(0.42, 0.58, bl[i + 1] / 255); out.data[i] = 212; out.data[i + 1] = 226; out.data[i + 2] = 200; out.data[i + 3] = 255 * f * 0.92 * e; }
  }
  gf.putImageData(out, 0, 0);
  return png(cf);
}

async function relief(url) {
  const rl = await load(url), H = Math.round((rl.height * W) / rl.width);
  const edge = (x, y) => Math.max(0, Math.min(1, Math.min(x, y, W - 1 - x, H - 1 - y) / (W * 0.06)));
  const [cr, gr] = cv(W, H); gr.drawImage(rl, 0, 0, W, H);
  const rd = gr.getImageData(0, 0, W, H), hist = new Array(256).fill(0);
  for (let i = 0; i < rd.data.length; i += 4) hist[rd.data[i]]++;
  let acc = 0, flat = 128;
  for (let k = 0; k < 256; k++) { acc += hist[k]; if (acc > rd.data.length / 8) { flat = k; break; } }
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = (y * W + x) * 4, val = rd.data[i], e = edge(x, y);
    if (val < flat) { rd.data[i] = 58; rd.data[i + 1] = 48; rd.data[i + 2] = 40; rd.data[i + 3] = Math.min(255, ((flat - val) / flat) * 255 * 0.95) * e; }
    else { rd.data[i] = 255; rd.data[i + 1] = 253; rd.data[i + 2] = 244; rd.data[i + 3] = Math.min(255, ((val - flat) / Math.max(1, 255 - flat)) * 255 * 0.7) * e; }
  }
  gr.putImageData(rd, 0, 0);
  return png(cr);
}

self.onmessage = async ({ data }) => {
  try {
    const [l, r] = await Promise.all([data.land ? land(data.land) : null, data.relief ? relief(data.relief) : null]);
    self.postMessage({ land: l, relief: r });
  } catch (e) { self.postMessage({ error: String(e?.message || e) }); }
};
