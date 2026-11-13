// The fog over the map (MapLibre custom layer, WebGL2): where you have not been the map turns pale
// (less colour, a light wash); where you have, it stays clear, with a thin green shade along the
// edge. The clear places are tens of thousands of ragged discs along the tracks (worker.js
// revealFor), drawn as instanced quads into a mask; one pass over the screen then mixes the map as
// drawn so far with its fogged self by the mask.
// The mask is tied to the map, not the screen: drawn for a box of mercator round the view (with a
// margin), it is used again while the map moves within it and the zoom stays near; it is drawn
// anew only past the box, after a real zoom change (at once at about 30%, after a still moment
// for less) or new tracks. (Drawn every frame it was most of the frame: a disc's quad covers
// ~11 of its neighbours along a track, more on trails walked often.)
// Coordinates go to the GPU from an origin near the discs (float32 is too coarse for mercator
// 0..1 close in).

const VS_DISC = `#version 300 es
in vec2 a_c;
in vec4 a_d; // mercator x, y (from the origin), radius (mercator units), seed
uniform vec4 u_b; // the mask's box: x, y (from the origin), w, h
uniform float u_minr, u_pxpm;
out vec2 v_p;
out float v_seed, v_soft;
void main() {
  float r = max(a_d.z, u_minr);
  v_p = a_c * 1.3;
  v_seed = a_d.w;
  v_soft = clamp(1.2 / (r * u_pxpm), 0.02, 0.6);
  gl_Position = vec4((a_d.xy + v_p * r - u_b.xy) / u_b.zw * 2.0 - 1.0, 0.0, 1.0);
}`;
const FS_DISC = `#version 300 es
precision mediump float;
in vec2 v_p;
in float v_seed, v_soft;
out vec4 o;
void main() {
  float a = atan(v_p.y, v_p.x);
  float rr = 1.0 + 0.1 * sin(3.0 * a + v_seed) + 0.07 * sin(7.0 * a + v_seed * 1.7);
  float m = 1.0 - smoothstep(1.0 - v_soft, 1.0, length(v_p) / rr);
  o = vec4(m, 0.0, 0.0, m);
}`;
const VS_FULL = `#version 300 es
in vec2 a_c;
uniform vec2 u_corner[4]; // the screen's corners in mercator (from the origin), in the quad's order
uniform vec4 u_b;
out vec2 v_uv, v_m;
void main() {
  v_uv = a_c * 0.5 + 0.5;
  v_m = (u_corner[gl_VertexID] - u_b.xy) / u_b.zw;
  gl_Position = vec4(a_c, 0.0, 1.0);
}`;
// once per mask: its edge, for the green shade inside the holes (r: the mask, g: the shade)
const VS_EDGE = `#version 300 es
in vec2 a_c;
out vec2 v_uv;
void main() { v_uv = a_c * 0.5 + 0.5; gl_Position = vec4(a_c, 0.0, 1.0); }`;
const FS_EDGE = `#version 300 es
precision mediump float;
in vec2 v_uv;
uniform sampler2D u_mask;
uniform vec2 u_px; // one mask pixel in uv
uniform float u_edge;
out vec4 o;
void main() {
  float m = texture(u_mask, v_uv).r, n = 0.0;
  for (int i = 0; i < 8; i++) {
    float t = float(i) * 0.785398;
    n += texture(u_mask, v_uv + u_px * u_edge * vec2(cos(t), sin(t))).r;
  }
  o = vec4(m, clamp(1.0 - n / 8.0, 0.0, 1.0) * m, 0.0, 1.0);
}`;
const FS_FOG = `#version 300 es
precision mediump float;
in vec2 v_uv, v_m;
uniform sampler2D u_scene, u_mask; // the mask: r the holes, g the shade along their edge
uniform float u_wash, u_holes, u_k;
out vec4 o;
void main() {
  vec3 c = texture(u_scene, v_uv).rgb;
  vec2 mk = texture(u_mask, v_m).rg * u_holes;
  float m = mk.r;
  // pale: a third of the colour, a little lighter, under a light wash
  float l = dot(c, vec3(0.299, 0.587, 0.114));
  vec3 f = mix(vec3(l), c, 0.3) * 1.05;
  f = mix(f, vec3(0.957, 0.957, 0.941), u_wash);
  // the fog's shade falls into the holes: green along the inside of their edge
  vec3 clear = mix(c, vec3(0.184, 0.42, 0.31), mk.g * 0.85);
  o = vec4(mix(c, mix(f, clear, m), u_k), 1.0);
}`;

function program(gl, vs, fs) {
  const p = gl.createProgram();
  for (const [type, src] of [[gl.VERTEX_SHADER, vs], [gl.FRAGMENT_SHADER, fs]]) {
    const s = gl.createShader(type);
    gl.shaderSource(s, src); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error("fog shader: " + gl.getShaderInfoLog(s));
    gl.attachShader(p, s);
  }
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error("fog program: " + gl.getProgramInfoLog(p));
  return p;
}

export class FogLayer {
  constructor() {
    this.id = "fog"; this.type = "custom"; this.renderingMode = "2d";
    this.discs = new Float32Array(0); this.n = 0; this.dirty = true; this.org = [0.5, 0.5];
    this.on = true; this.wash = 0.5;
    this.box = null; // the mask's box [x, y, w, h] (mercator from the origin) and zoom: {b, z}
    this.drawn = 0; // masks drawn (Diagnostyka)
  }
  /** discs: Float32Array [mx, my, r, seed, ...] in mercator units (0..1). Discs in the same spot (a
   * trail walked again) are one: the bigger stays. */
  setDiscs(discs) {
    const N = discs.length / 4;
    let ox = 0, oy = 0;
    for (let i = 0; i < N; i++) { ox += discs[i * 4]; oy += discs[i * 4 + 1]; }
    this.org = N ? [ox / N, oy / N] : [0.5, 0.5];
    const cell = N ? discs[2] * 0.18 : 1, at = new Map(), keep = [];
    for (let i = 0; i < N; i++) {
      const k = `${Math.floor(discs[i * 4] / cell)},${Math.floor(discs[i * 4 + 1] / cell)}`, j = at.get(k);
      if (j == null) { at.set(k, keep.length); keep.push(i); } else if (discs[i * 4 + 2] > discs[keep[j] * 4 + 2]) keep[j] = i;
    }
    const d = new Float32Array(keep.length * 4);
    keep.forEach((i, o) => { d[o * 4] = discs[i * 4] - this.org[0]; d[o * 4 + 1] = discs[i * 4 + 1] - this.org[1]; d[o * 4 + 2] = discs[i * 4 + 2]; d[o * 4 + 3] = discs[i * 4 + 3]; });
    this.discs = d; this.n = keep.length; this.nIn = N; this.dirty = true; this.box = null;
    this.map?.triggerRepaint();
  }

  onAdd(map, gl) {
    this.map = map; this.gl = gl;
    this.pd = program(gl, VS_DISC, FS_DISC);
    this.pf = program(gl, VS_FULL, FS_FOG);
    this.pe = program(gl, VS_EDGE, FS_EDGE);
    const U = (p, names) => Object.fromEntries(names.map((k) => [k, gl.getUniformLocation(p, k)]));
    this.ud = U(this.pd, ["u_b", "u_minr", "u_pxpm"]);
    this.uf = U(this.pf, ["u_corner", "u_b", "u_scene", "u_mask", "u_wash", "u_holes", "u_k"]);
    this.ue = U(this.pe, ["u_mask", "u_px", "u_edge"]);
    this.quad = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quad);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    this.inst = gl.createBuffer();
    this.vaoD = gl.createVertexArray(); this.vaoF = gl.createVertexArray(); this.vaoE = gl.createVertexArray();
    gl.bindVertexArray(this.vaoD);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quad);
    let a = gl.getAttribLocation(this.pd, "a_c"); gl.enableVertexAttribArray(a); gl.vertexAttribPointer(a, 2, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.inst);
    a = gl.getAttribLocation(this.pd, "a_d"); gl.enableVertexAttribArray(a); gl.vertexAttribPointer(a, 4, gl.FLOAT, false, 0, 0); gl.vertexAttribDivisor(a, 1);
    gl.bindVertexArray(this.vaoF);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quad);
    a = gl.getAttribLocation(this.pf, "a_c"); gl.enableVertexAttribArray(a); gl.vertexAttribPointer(a, 2, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(this.vaoE);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quad);
    a = gl.getAttribLocation(this.pe, "a_c"); gl.enableVertexAttribArray(a); gl.vertexAttribPointer(a, 2, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);
    this.fbo = gl.createFramebuffer();
    this.disc = this.tex(gl); this.mask = this.tex(gl); this.scene = this.tex(gl); // discs drawn, the mask with its edge, the map
    this.size = [0, 0]; this.msize = [0, 0];
    this.maxTex = Math.min(4096, gl.getParameter(gl.MAX_TEXTURE_SIZE) || 4096);
  }
  tex(gl) {
    const t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, gl.LINEAR], [gl.TEXTURE_MAG_FILTER, gl.LINEAR], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, k, v);
    return t;
  }
  resize(gl) {
    const W = gl.drawingBufferWidth, H = gl.drawingBufferHeight;
    if (this.size[0] === W && this.size[1] === H) return;
    this.size = [W, H]; this.box = null;
    gl.bindTexture(gl.TEXTURE_2D, this.scene);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, W, H, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  }

  /** How strong the fog is at this zoom: none far out (the glow shows what you walked there), full close in. */
  strength() { const z = this.map.getZoom(), t = Math.max(0, Math.min(1, (z - 9.8) / 1.4)); return t * t * (3 - 2 * t); }
  /** The screen's corners in mercator from the origin, in the quad's order (bottom left, bottom right, top left, top right). */
  corners() {
    const c = this.map.getCanvas(), W = c.clientWidth, H = c.clientHeight, out = new Float32Array(8);
    [[0, H], [W, H], [0, 0], [W, 0]].forEach(([x, y], i) => {
      const ll = this.map.unproject([x, y]), mx = (ll.lng + 180) / 360, s = Math.sin((ll.lat * Math.PI) / 180);
      out[i * 2] = mx - this.org[0]; out[i * 2 + 1] = 0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI) - this.org[1];
    });
    return out;
  }
  prerender(gl) {
    if (!this.on || this.strength() <= 0) return;
    this.resize(gl);
    if (this.dirty) {
      gl.bindBuffer(gl.ARRAY_BUFFER, this.inst);
      gl.bufferData(gl.ARRAY_BUFFER, this.discs, gl.STATIC_DRAW);
      this.dirty = false; this.box = null;
    }
    const cs = (this.cs = this.corners()), z = this.map.getZoom(), now = performance.now();
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (let i = 0; i < 8; i += 2) { x0 = Math.min(x0, cs[i]); x1 = Math.max(x1, cs[i]); y0 = Math.min(y0, cs[i + 1]); y1 = Math.max(y1, cs[i + 1]); }
    // the camera still: a mask drawn at another zoom is drawn anew, sharp (once the fingers are off)
    if (this.lastZ !== z) { this.lastZ = z; this.zAt = now; }
    const B = this.box, dz = B ? Math.abs(z - B.z) : Infinity;
    const inside = B && x0 >= B.b[0] && y0 >= B.b[1] && x1 <= B.b[0] + B.b[2] && y1 <= B.b[1] + B.b[3];
    let need = !B || !inside || dz > 0.4;
    if (!need && dz > 0.01) {
      if (now - this.zAt > 220) need = true;
      else { clearTimeout(this.later); this.later = setTimeout(() => this.map?.triggerRepaint(), 240); }
    }
    if (need) this.drawMask(gl, [x0, y0, x1, y1], z);
  }
  drawMask(gl, [x0, y0, x1, y1], z) {
    const M = 0.4, cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, hw = ((x1 - x0) / 2) * (1 + M), hh = ((y1 - y0) / 2) * (1 + M);
    const b = [cx - hw, cy - hh, 2 * hw, 2 * hh];
    const ws = 512 * 2 ** z, dpr = this.size[0] / Math.max(1, this.map.getCanvas().clientWidth); // CSS px per mercator unit
    let ppm = ws * dpr * 0.5; // mask px per mercator unit: half the screen's resolution
    const big = Math.max(b[2], b[3]) * ppm;
    if (big > this.maxTex) ppm *= this.maxTex / big;
    const mw = Math.max(1, Math.ceil(b[2] * ppm)), mh = Math.max(1, Math.ceil(b[3] * ppm));
    if (this.msize[0] !== mw || this.msize[1] !== mh) {
      this.msize = [mw, mh];
      for (const t of [this.disc, this.mask]) { gl.bindTexture(gl.TEXTURE_2D, t); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, mw, mh, 0, gl.RGBA, gl.UNSIGNED_BYTE, null); }
    }
    this.box = { b, z }; this.drawn++;
    const prevFb = gl.getParameter(gl.FRAMEBUFFER_BINDING), vp = gl.getParameter(gl.VIEWPORT);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.disc, 0);
    gl.viewport(0, 0, mw, mh);
    gl.disable(gl.DEPTH_TEST); gl.disable(gl.STENCIL_TEST); gl.disable(gl.CULL_FACE);
    gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
    if (this.n) {
      gl.useProgram(this.pd);
      gl.uniform4f(this.ud.u_b, b[0], b[1], b[2], b[3]);
      gl.uniform1f(this.ud.u_minr, 1.6 / ws); // far out at least a thin line
      gl.uniform1f(this.ud.u_pxpm, ppm);
      gl.enable(gl.BLEND); gl.blendEquation(gl.MAX); gl.blendFunc(gl.ONE, gl.ONE);
      gl.bindVertexArray(this.vaoD);
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, this.n);
      gl.bindVertexArray(null);
      gl.blendEquation(gl.FUNC_ADD);
    }
    // the edge's shade, once, into the mask
    gl.disable(gl.BLEND);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.mask, 0);
    gl.useProgram(this.pe);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.disc);
    gl.uniform1i(this.ue.u_mask, 0);
    gl.uniform2f(this.ue.u_px, 1 / mw, 1 / mh);
    gl.uniform1f(this.ue.u_edge, 1.6);
    gl.bindVertexArray(this.vaoE);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.bindVertexArray(null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, prevFb);
    gl.viewport(vp[0], vp[1], vp[2], vp[3]);
  }

  render(gl) {
    const k = this.on ? this.strength() : 0;
    if (k <= 0 || !this.box || !this.cs) return;
    this.resize(gl);
    const [W, H] = this.size, U = this.uf, b = this.box.b;
    gl.bindTexture(gl.TEXTURE_2D, this.scene);
    gl.copyTexSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 0, 0, W, H);
    gl.useProgram(this.pf);
    gl.disable(gl.BLEND); gl.disable(gl.DEPTH_TEST); gl.disable(gl.STENCIL_TEST);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.scene);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, this.mask);
    gl.uniform2fv(U.u_corner, this.cs);
    gl.uniform4f(U.u_b, b[0], b[1], b[2], b[3]);
    gl.uniform1i(U.u_scene, 0); gl.uniform1i(U.u_mask, 1);
    gl.uniform1f(U.u_wash, this.wash);
    gl.uniform1f(U.u_holes, this.n ? 1 : 0);
    gl.uniform1f(U.u_k, k);
    gl.bindVertexArray(this.vaoF);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.bindVertexArray(null);
    gl.activeTexture(gl.TEXTURE0);
  }

  onRemove(map, gl) {
    clearTimeout(this.later);
    for (const t of [this.disc, this.mask, this.scene]) gl.deleteTexture(t);
    gl.deleteFramebuffer(this.fbo); gl.deleteBuffer(this.quad); gl.deleteBuffer(this.inst);
    gl.deleteProgram(this.pd); gl.deleteProgram(this.pf); gl.deleteProgram(this.pe);
  }
}
