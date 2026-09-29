// Draws a logo picture in 3D with WebGL.
//
// The picture's outline is turned into a distance field (how far each pixel
// is inside the edge). The logo is then drawn as a stack of slices through
// its thickness; each slice keeps only what is inside the outline, pulled in
// near the front and back to make a rounded bevel. The distance field also
// gives every edge its direction, so the sides and bevel catch the light.

import type { Logo3d } from '../engine/types/Logo3d';

/** A logo ready to draw: its colours, and its distance field (16-bit, in R and G). */
export interface PreparedLogo {
  pixels: ImageData;
  field: ImageData;
  /** width / height of the whole texture (the logo plus a margin). */
  aspect: number;
}

const LONG_SIDE = 512;
const MARGIN = 28;
/** Distance field: ±64 texture pixels, in steps of 1/512. */
const SDF_RANGE = 64;
const SDF_STEPS = 512;

/** 1-D squared distance transform (Felzenszwalb & Huttenlocher). */
function edt1d(f: Float64Array, n: number, d: Float64Array, v: Int32Array, z: Float64Array) {
  let k = 0;
  v[0] = 0;
  z[0] = -Infinity;
  z[1] = Infinity;
  for (let q = 1; q < n; q++) {
    let s = (f[q]! + q * q - (f[v[k]!]! + v[k]! * v[k]!)) / (2 * q - 2 * v[k]!);
    while (s <= z[k]!) {
      k--;
      s = (f[q]! + q * q - (f[v[k]!]! + v[k]! * v[k]!)) / (2 * q - 2 * v[k]!);
    }
    k++;
    v[k] = q;
    z[k] = s;
    z[k + 1] = Infinity;
  }
  k = 0;
  for (let q = 0; q < n; q++) {
    while (z[k + 1]! < q) k++;
    const dq = q - v[k]!;
    d[q] = dq * dq + f[v[k]!]!;
  }
}

/** Distance from each pixel to the nearest pixel where `seed` is true. */
function distance(seed: Uint8Array, w: number, h: number): Float64Array {
  const INF = 1e20;
  const grid = new Float64Array(w * h);
  for (let i = 0; i < w * h; i++) grid[i] = seed[i] ? 0 : INF;
  const n = Math.max(w, h);
  const f = new Float64Array(n);
  const d = new Float64Array(n);
  const v = new Int32Array(n);
  const z = new Float64Array(n + 1);
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) f[y] = grid[y * w + x]!;
    edt1d(f, h, d, v, z);
    for (let y = 0; y < h; y++) grid[y * w + x] = d[y]!;
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) f[x] = grid[y * w + x]!;
    edt1d(f, w, d, v, z);
    for (let x = 0; x < w; x++) grid[y * w + x] = Math.sqrt(d[x]!);
  }
  return grid;
}

/** Turn a picture into a logo ready to draw. */
export function prepareLogo(src: CanvasImageSource, srcW: number, srcH: number): PreparedLogo {
  const sw = srcW || LONG_SIDE;
  const sh = srcH || LONG_SIDE;
  const scale = (LONG_SIDE - 2 * MARGIN) / Math.max(sw, sh);
  const lw = Math.max(1, Math.round(sw * scale));
  const lh = Math.max(1, Math.round(sh * scale));
  const w = lw + 2 * MARGIN;
  const h = lh + 2 * MARGIN;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d', { willReadFrequently: true })!;
  g.drawImage(src, MARGIN, MARGIN, lw, lh);
  const img = g.getImageData(0, 0, w, h);
  const px = img.data;
  const inside = new Uint8Array(w * h);
  const outside = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) {
    const a = px[i * 4 + 3]! > 127;
    inside[i] = a ? 1 : 0;
    outside[i] = a ? 0 : 1;
  }
  const toOutside = distance(outside, w, h);
  const toInside = distance(inside, w, h);
  const field = new ImageData(w, h);
  const fd = field.data;
  for (let i = 0; i < w * h; i++) {
    const s = inside[i] ? toOutside[i]! - 0.5 : -(toInside[i]! - 0.5);
    const v = Math.max(0, Math.min(65535, Math.round((s + SDF_RANGE) * SDF_STEPS)));
    fd[i * 4] = v >> 8;
    fd[i * 4 + 1] = v & 255;
    fd[i * 4 + 3] = 255;
  }
  return { pixels: img, field, aspect: w / h };
}

/** A stand-in when there is no logo yet: the words "YOUR LOGO". */
export function placeholderLogo(): PreparedLogo {
  const c = document.createElement('canvas');
  c.width = 900;
  c.height = 300;
  const g = c.getContext('2d')!;
  g.fillStyle = '#fff';
  g.font = '800 170px "Segoe UI", system-ui, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText('YOUR LOGO', 450, 160);
  return prepareLogo(c, 900, 300);
}

const cache = new Map<string, Promise<PreparedLogo>>();
/** Load and prepare a logo picture (once per file, shared by every view). */
export function loadLogo(url: string): Promise<PreparedLogo> {
  let p = cache.get(url);
  if (!p) {
    p = new Promise<PreparedLogo>((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        try {
          resolve(prepareLogo(img, img.naturalWidth, img.naturalHeight));
        } catch (e) {
          reject(e instanceof Error ? e : new Error(String(e)));
        }
      };
      img.onerror = () => reject(new Error('The logo picture could not be opened.'));
      img.src = url;
    });
    cache.set(url, p);
    p.catch(() => cache.delete(url));
  }
  return p;
}

// ---- motion ----

/** Where the logo is at time `t` (ms): its turn in degrees and how far it bobs. */
export function logoPose(l: Logo3d, t: number): { angle: number; bob: number } {
  if (!l.playing) return { angle: l.angle, bob: 0 };
  const ph = (((t / 1000 / l.seconds) % 1) + 1) % 1;
  const s = Math.sin(2 * Math.PI * ph);
  if (l.motion === 'spin') return { angle: ((((l.angle + ph * 360 + 180) % 360) + 360) % 360) - 180, bob: 0 };
  if (l.motion === 'float') return { angle: l.angle + 10 * s, bob: 0.035 * Math.sin(4 * Math.PI * ph) };
  let wave = s;
  if (l.ends === 'pause') wave = Math.max(-1, Math.min(1, 1.35 * s));
  else if (l.ends === 'bounce') wave = ph < 0.25 ? ph * 4 : ph < 0.75 ? 2 - ph * 4 : ph * 4 - 4;
  return { angle: l.angle + l.swing * wave, bob: 0 };
}

// ---- drawing ----

const VS = `
attribute vec2 p;
uniform mat4 uMVP;
uniform mat4 uModel;
uniform vec2 uHalf;
uniform float uZ;
varying vec2 vUv;
varying vec3 vWorld;
void main() {
  vUv = vec2(p.x * 0.5 + 0.5, 0.5 - p.y * 0.5);
  vec3 pos = vec3(p * uHalf, uZ);
  vWorld = (uModel * vec4(pos, 1.0)).xyz;
  gl_Position = uMVP * vec4(pos, 1.0);
}`;

const FS = `
precision highp float;
varying vec2 vUv;
varying vec3 vWorld;
uniform sampler2D uTex;
uniform sampler2D uField;
uniform vec2 uTexel;
uniform float uU;       // depth of this slice from the front, texture px
uniform float uDepth;   // whole thickness, texture px
uniform float uBevel;   // bevel, texture px
uniform float uEdge;    // how wide a slice's edge ring is, texture px
uniform mat3 uRot;      // the logo's turn (for normals)
uniform vec3 uLight;    // towards the light
uniform vec3 uEye;      // where the camera is
uniform float uStrength;
uniform int uMaterial;  // 0 metal, 1 glass, 2 gloss, 3 matte
uniform int uOwn;       // 1: the logo's own colours
uniform vec3 uColor;
uniform float uAlpha;
// (Linear filtering of the two bytes is still exact: the value is linear in both.)
float sd(vec2 uv) { vec4 t = texture2D(uField, uv); return (t.r * 65280.0 + t.g * 255.0) / 512.0 - 64.0; }
void main() {
  float s = sd(vUv);
  float b = uBevel;
  float fromFront = uU;
  float fromBack = uDepth - uU;
  float inset = 0.0;
  if (b > 0.0) {
    float uf = min(fromFront, b);
    float ub = min(fromBack, b);
    inset = max(b - sqrt(max(0.0, b * b - (b - uf) * (b - uf))), b - sqrt(max(0.0, b * b - (b - ub) * (b - ub))));
  }
  if (s < inset) discard;
  // Outward direction of the edge here.
  vec2 dx = vec2(uTexel.x * 1.5, 0.0);
  vec2 dy = vec2(0.0, uTexel.y * 1.5);
  float gx = sd(vUv + dx) - sd(vUv - dx) + 0.5 * (sd(vUv + dx + dy) - sd(vUv - dx + dy) + sd(vUv + dx - dy) - sd(vUv - dx - dy));
  float gy = sd(vUv + dy) - sd(vUv - dy) + 0.5 * (sd(vUv + dy + dx) - sd(vUv - dy + dx) + sd(vUv + dy - dx) - sd(vUv - dy - dx));
  vec2 out2 = length(vec2(gx, gy)) > 0.0001 ? normalize(vec2(-gx, gy)) : vec2(0.0);
  vec3 n;
  bool edge = s < inset + uEdge;
  if (fromFront < 0.5 && !edge) n = vec3(0.0, 0.0, 1.0);
  else if (fromBack < 0.5 && !edge) n = vec3(0.0, 0.0, -1.0);
  else if (b > 0.0 && fromFront < b) { float c = (b - fromFront) / b; n = vec3(out2 * sqrt(max(0.0, 1.0 - c * c)), c); }
  else if (b > 0.0 && fromBack < b) { float c = (b - fromBack) / b; n = vec3(out2 * sqrt(max(0.0, 1.0 - c * c)), -c); }
  else n = vec3(out2, 0.0);
  n = normalize(uRot * n);
  vec3 base = uOwn == 1 ? texture2D(uTex, vUv).rgb : uColor;
  vec3 L = normalize(uLight);
  vec3 V = normalize(uEye - vWorld);
  vec3 H = normalize(L + V);
  float diff = max(dot(n, L), 0.0);
  float amb = 0.32;
  vec3 col;
  float alpha = uAlpha;
  if (uMaterial == 0) {
    // Metal: a studio reflection (bright above, darker below, a soft band) tinted by the colour.
    vec3 r = reflect(-V, n);
    float env = mix(0.18, 1.0, smoothstep(-0.35, 0.65, r.y)) + 0.35 * exp(-pow((r.y - 0.15) * 7.0, 2.0));
    float spec = pow(max(dot(n, H), 0.0), 40.0);
    col = base * (amb * 0.6 + env * (0.45 + 0.55 * uStrength)) + mix(base, vec3(1.0), 0.5) * spec * uStrength * 1.2;
  } else if (uMaterial == 1) {
    // Glass: see-through, bright edges and highlights.
    float fres = pow(1.0 - max(dot(n, V), 0.0), 3.0);
    float spec = pow(max(dot(n, H), 0.0), 90.0);
    col = base * (0.35 + 0.4 * diff * uStrength) + vec3(1.0) * (spec * 1.4 * uStrength + fres * 0.6);
    alpha = clamp(0.42 + fres * 0.5 + spec, 0.0, 1.0);
  } else if (uMaterial == 2) {
    float spec = pow(max(dot(n, H), 0.0), 70.0);
    col = base * (amb + diff * 0.85 * uStrength + (1.0 - uStrength) * 0.5) + vec3(1.0) * spec * 0.9 * uStrength;
  } else {
    col = base * (amb + diff * 0.8 * uStrength + (1.0 - uStrength) * 0.45);
  }
  col = 1.0 - exp(-col * 1.6); // soft highlights, never harsh clipping
  gl_FragColor = vec4(col * alpha, alpha);
}`;

type Mat4 = Float32Array;
function mul(a: Mat4, b: Mat4): Mat4 {
  const o = new Float32Array(16);
  for (let i = 0; i < 4; i++)
    for (let j = 0; j < 4; j++) o[j * 4 + i] = a[i]! * b[j * 4]! + a[4 + i]! * b[j * 4 + 1]! + a[8 + i]! * b[j * 4 + 2]! + a[12 + i]! * b[j * 4 + 3]!;
  return o;
}
function perspective(fovY: number, aspect: number, near: number, far: number): Mat4 {
  const f = 1 / Math.tan(fovY / 2);
  const nf = 1 / (near - far);
  return new Float32Array([f / aspect, 0, 0, 0, 0, f, 0, 0, 0, 0, (far + near) * nf, -1, 0, 0, 2 * far * near * nf, 0]);
}
function translate(x: number, y: number, z: number): Mat4 {
  return new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, z, 1]);
}
function rotY(a: number): Mat4 {
  const c = Math.cos(a);
  const s = Math.sin(a);
  return new Float32Array([c, 0, -s, 0, 0, 1, 0, 0, s, 0, c, 0, 0, 0, 0, 1]);
}
function rotX(a: number): Mat4 {
  const c = Math.cos(a);
  const s = Math.sin(a);
  return new Float32Array([1, 0, 0, 0, 0, c, s, 0, 0, -s, c, 0, 0, 0, 0, 1]);
}
const rad = (d: number) => (d * Math.PI) / 180;

export class Logo3dRenderer {
  private gl: WebGLRenderingContext;
  private prog: WebGLProgram;
  private u: Record<string, WebGLUniformLocation | null> = {};
  private tex: WebGLTexture;
  private field: WebGLTexture;
  private logo: PreparedLogo | null = null;

  /** Null when this computer can't draw 3D (no WebGL). */
  static create(canvas: HTMLCanvasElement): Logo3dRenderer | null {
    const gl = canvas.getContext('webgl', { alpha: true, premultipliedAlpha: true, antialias: true, depth: true, preserveDrawingBuffer: false });
    return gl ? new Logo3dRenderer(canvas, gl) : null;
  }

  private constructor(
    private canvas: HTMLCanvasElement,
    gl: WebGLRenderingContext,
  ) {
    this.gl = gl;
    const sh = (type: number, src: string) => {
      const o = gl.createShader(type)!;
      gl.shaderSource(o, src);
      gl.compileShader(o);
      if (!gl.getShaderParameter(o, gl.COMPILE_STATUS)) console.error(gl.getShaderInfoLog(o));
      return o;
    };
    const pr = gl.createProgram()!;
    gl.attachShader(pr, sh(gl.VERTEX_SHADER, VS));
    gl.attachShader(pr, sh(gl.FRAGMENT_SHADER, FS));
    gl.bindAttribLocation(pr, 0, 'p');
    gl.linkProgram(pr);
    if (!gl.getProgramParameter(pr, gl.LINK_STATUS)) console.error(gl.getProgramInfoLog(pr));
    this.prog = pr;
    for (const n of [
      'uMVP',
      'uModel',
      'uHalf',
      'uZ',
      'uTex',
      'uField',
      'uTexel',
      'uU',
      'uDepth',
      'uBevel',
      'uEdge',
      'uRot',
      'uLight',
      'uEye',
      'uStrength',
      'uMaterial',
      'uOwn',
      'uColor',
      'uAlpha',
    ])
      this.u[n] = gl.getUniformLocation(pr, n);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    this.tex = gl.createTexture()!;
    this.field = gl.createTexture()!;
  }

  setLogo(logo: PreparedLogo) {
    const gl = this.gl;
    this.logo = logo;
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    for (const [t, data] of [
      [this.tex, logo.pixels],
      [this.field, logo.field],
    ] as const) {
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, data);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    }
  }

  /** Draw the logo at time `t` (ms) into a width × height picture. `clear`: a background colour, or null to stay see-through. */
  draw(l: Logo3d, t: number, width: number, height: number, clear: [number, number, number] | null = null) {
    const { gl, canvas, u } = this;
    const W = Math.max(2, Math.round(width));
    const H = Math.max(2, Math.round(height));
    if (canvas.width !== W || canvas.height !== H) {
      canvas.width = W;
      canvas.height = H;
    }
    gl.viewport(0, 0, W, H);
    if (clear) gl.clearColor(clear[0], clear[1], clear[2], 1);
    else gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    const logo = this.logo;
    if (!logo) return;

    const texW = logo.pixels.width;
    const texH = logo.pixels.height;
    const half: [number, number] = [logo.aspect * 0.5, 0.5];
    // Thickness: depth 0 – 60 → up to 0.6 of the logo's height.
    const depthModel = (l.depth / 100) * 0.6 * ((texH - 2 * MARGIN) / texH) * 1.4;
    const depthPx = depthModel * texH;
    const bevelPx = Math.min((l.bevel / 20) * 14 * (texH / LONG_SIDE) * 1.2, depthPx / 2);

    const { angle, bob } = logoPose(l, t);
    const tilt = l.motion === 'float' ? -6 : 8;
    const model = mul(translate(0, bob, 0), mul(rotX(rad(tilt)), rotY(rad(angle))));
    const fov = rad(30);
    const vpAspect = W / H;
    // Far enough that the logo fits whichever way it turns.
    const inner = (texH - 2 * MARGIN) / texH;
    const reach = Math.hypot(half[0] * inner, depthModel / 2);
    const fitH = (0.5 * inner) / Math.tan(fov / 2);
    const fitW = reach / (Math.tan(fov / 2) * vpAspect);
    const dist = Math.max(fitH, fitW) * (1.1 + l.camera * 1.5) + depthModel / 2;
    const mvp = mul(perspective(fov, vpAspect, 0.05, 100), mul(translate(0, 0, -dist), model));

    // The logo's turn, for its normals.
    const rot = new Float32Array([model[0]!, model[1]!, model[2]!, model[4]!, model[5]!, model[6]!, model[8]!, model[9]!, model[10]!]);
    const la = rad(l.lightAngle);
    const light = [Math.sin(la), 0.55, Math.cos(la)];

    gl.useProgram(this.prog);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    gl.uniform1i(u.uTex!, 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.field);
    gl.uniform1i(u.uField!, 1);
    gl.activeTexture(gl.TEXTURE0);
    gl.uniform2f(u.uTexel!, 1 / texW, 1 / texH);
    gl.uniformMatrix4fv(u.uMVP!, false, mvp);
    gl.uniform2f(u.uHalf!, half[0], half[1]);
    gl.uniform1f(u.uDepth!, depthPx);
    gl.uniform1f(u.uBevel!, bevelPx);
    gl.uniformMatrix3fv(u.uRot!, false, rot);
    gl.uniform3f(u.uLight!, light[0]!, light[1]!, light[2]!);
    gl.uniform3f(u.uEye!, 0, 0, dist);
    gl.uniformMatrix4fv(u.uModel!, false, model);
    gl.uniform1f(u.uStrength!, l.lightStrength);
    gl.uniform1i(u.uMaterial!, ['metal', 'glass', 'gloss', 'matte'].indexOf(l.material));
    gl.uniform1i(u.uOwn!, l.color === null ? 1 : 0);
    const c = l.color ?? '#ffffff';
    gl.uniform3f(u.uColor!, parseInt(c.slice(1, 3), 16) / 255, parseInt(c.slice(3, 5), 16) / 255, parseInt(c.slice(5, 7), 16) / 255);

    // As many slices as there are screen pixels through the thickness, so the sides look solid.
    const screenPx = (depthModel * H) / (2 * dist * Math.tan(fov / 2));
    const n = depthPx < 0.5 ? 1 : Math.min(320, Math.max(2, Math.ceil(screenPx * 2.5) + 1));
    gl.uniform1f(u.uEdge!, n > 1 ? Math.max(1.2, (depthPx / (n - 1)) * 1.5) : 1.2);

    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    const drawSlices = () => {
      for (let i = 0; i < n; i++) {
        const f = n === 1 ? 0 : i / (n - 1);
        gl.uniform1f(u.uU!, f * depthPx);
        gl.uniform1f(u.uZ!, depthModel / 2 - f * depthModel);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      }
    };
    if (l.material === 'glass') {
      // Glass: find the nearest surface first, then colour only that, see-through.
      gl.colorMask(false, false, false, false);
      gl.uniform1f(u.uAlpha!, 1);
      drawSlices();
      gl.colorMask(true, true, true, true);
      gl.depthMask(false);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      gl.depthFunc(gl.EQUAL);
      drawSlices();
      gl.depthFunc(gl.LEQUAL);
      gl.depthMask(true);
      gl.disable(gl.BLEND);
    } else {
      gl.disable(gl.BLEND);
      gl.uniform1f(u.uAlpha!, 1);
      drawSlices();
    }
  }

  dispose() {
    this.gl.deleteTexture(this.tex);
    this.gl.deleteTexture(this.field);
    this.gl.getExtension('WEBGL_lose_context')?.loseContext();
  }
}
