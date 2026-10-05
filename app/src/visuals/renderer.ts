// Draws one frame of the stage visuals with WebGL: scenes → color, glitch
// and trails → the screen with text and the master controls. A port of
// Stage Visuals Live's makeRenderer; the shaders are unchanged.

import { COMP_FS, FINAL_FS, SCENE_FS, VS } from './shaders';
import { FONTS } from './data';

/** Every uniform for one frame (built by the player). */
export interface Frame {
  beat: number;
  b0: number;
  b1: number;
  b2: number;
  pulse: number;
  mix: number;
  m0: number;
  m1: number;
  m2: number;
  p0: number[];
  p1: number[];
  p2: number[];
  s0: number;
  s1: number;
  s2: number;
  f0: number;
  f1: number;
  f2: number;
  k0: number;
  k1: number;
  k2: number;
  ov: number;
  ovMode: number;
  zoom: number;
  rot: number;
  panX: number;
  panY: number;
  kal: number;
  mirror: number;
  trail: number;
  echo: number;
  echoRot: number;
  rgb: number;
  pix: number;
  hue: number;
  sat: number;
  con: number;
  glow: number;
  post: number;
  bright: number;
  white: number;
  black: number;
  inv: number;
  scan: number;
  vig: number;
  q: number;
  text: { on: number; str: string; font: string; col: [number, number, number]; scale: number; y: number };
}

export interface Renderer {
  /** Draw at this size in pixels. */
  draw(u: Frame, width: number, height: number): void;
  /** The graphics card dropped the drawing context (make a new renderer). */
  lost(): boolean;
  /** Fonts arrived: redraw the words. */
  refreshText(): void;
  dispose(): void;
}

type Target = { t: WebGLTexture; f: WebGLFramebuffer };

// The scene shader has every scene in one long if/else chain, and each frame
// ran it up to three times (scene, next scene, overlay). On Windows WebGL
// goes through Direct3D, whose shader compiler chokes on that: it takes so
// long, or makes every pixel work out every scene, that the graphics card
// stops and the app crashes. So each program is built with only the scenes
// on now (the same code, cut out of the chain).
const SIG = 'vec3 scene(int m, vec2 uv, float tb, float spd, float pu, mat3 P){';
const CHAIN_END = '\n  }\n\n  if(m<=5){ col*=';
const MAIN = '\nvoid main(){';
const parts = (() => {
  const src = SCENE_FS;
  const sig = src.indexOf(SIG);
  const start = src.indexOf('\n  if(m==0){');
  const end = src.indexOf(CHAIN_END);
  const main = src.indexOf(MAIN);
  if (sig < 0 || start < sig || end < start || main < end) throw new Error('stage visuals: the scene shader has changed shape');
  const chain = src.slice(start, end);
  // One block per scene: "if(m==3){", "} else if(m==32||m==33){" … "} else {".
  const re = /\n {2}(?:\} else )?if\(((?:m==\d+)(?:\|\|m==\d+)*)\)\{|\n {2}\} else \{/g;
  const heads = [...chain.matchAll(re)];
  const blocks = heads.map((h, i) => ({
    modes: h[1] ? h[1].split('||').map((x) => Number(x.slice(3))) : null,
    body: chain.slice(h.index + h[0].length, i + 1 < heads.length ? heads[i + 1]!.index : chain.length),
  }));
  return {
    common: src.slice(0, sig),
    prelude: src.slice(sig + SIG.length, start),
    after: src.slice(end + 4, main),
    main: src.slice(main),
    blocks,
  };
})();

/** The scene modes the shader knows (the rest draw the last, "else" scene). */
export const SCENE_MODES: readonly number[] = parts.blocks.flatMap((b) => b.modes ?? []);

/** One layer's scene function, holding only scene `m` (-1: a layer not shown). */
function sceneFn(n: number, m: number): string {
  const sig = `vec3 scene${n}(vec2 uv, float tb, float spd, float pu, mat3 P){`;
  if (m < 0) return `${sig}return vec3(0.);}\n`;
  const b = parts.blocks.find((x) => x.modes?.includes(m)) ?? parts.blocks.find((x) => !x.modes)!;
  return `${sig}\n  const int m=${Math.round(m)};${parts.prelude}\n  {${b.body}\n  }${parts.after}\n`;
}

/** The scene shader for these three layers' scenes (-1: that layer is off). */
export function sceneShader(m0: number, m1: number, m2: number): string {
  const main = parts.main.replace('scene(uM0,', 'scene0(').replace('scene(uM1,', 'scene1(').replace('scene(uM2,', 'scene2(');
  return parts.common + sceneFn(0, m0) + sceneFn(1, m1) + sceneFn(2, m2) + main;
}

/** Most scene programs kept ready on one drawing context. */
const KEEP = 12;

export function makeRenderer(canvas: HTMLCanvasElement | OffscreenCanvas): Renderer | null {
  const gl = canvas.getContext('webgl', { antialias: false, alpha: false, preserveDrawingBuffer: false }) as WebGLRenderingContext | null;
  if (!gl || gl.isContextLost()) return null;
  const compile = (type: number, src: string) => {
    const o = gl.createShader(type)!;
    gl.shaderSource(o, src);
    gl.compileShader(o);
    if (!gl.getShaderParameter(o, gl.COMPILE_STATUS)) console.error(gl.getShaderInfoLog(o));
    return o;
  };
  const vs = compile(gl.VERTEX_SHADER, VS);
  const mk = <N extends string>(fs: string, names: readonly N[]) => {
    const pr = gl.createProgram()!;
    const f = compile(gl.FRAGMENT_SHADER, fs);
    gl.attachShader(pr, vs);
    gl.attachShader(pr, f);
    gl.bindAttribLocation(pr, 0, 'p');
    gl.linkProgram(pr);
    gl.deleteShader(f);
    if (!gl.getProgramParameter(pr, gl.LINK_STATUS)) console.error(gl.getProgramInfoLog(pr));
    const U = {} as Record<N, WebGLUniformLocation | null>;
    for (const n of names) U[n] = gl.getUniformLocation(pr, n);
    return { pr, U };
  };
  const SCENE_U = [
    'uRes',
    'uBeat',
    'uB0',
    'uB1',
    'uB2',
    'uPulse',
    'uMix',
    'uM0',
    'uM1',
    'uM2',
    'uP0',
    'uP1',
    'uP2',
    'uS0',
    'uS1',
    'uS2',
    'uF0',
    'uF1',
    'uF2',
    'uK0',
    'uK1',
    'uK2',
    'uOv',
    'uOvMode',
    'uZoom',
    'uRot',
    'uPan',
    'uKal',
    'uMirror',
  ] as const;
  // Scene programs by the scenes they hold, least recently used first.
  const scenes = new Map<string, ReturnType<typeof mk<(typeof SCENE_U)[number]>>>();
  const sceneProg = (m0: number, m1: number, m2: number) => {
    const key = `${m0},${m1},${m2}`;
    let p = scenes.get(key);
    if (p) scenes.delete(key);
    else p = mk(sceneShader(m0, m1, m2), SCENE_U);
    scenes.set(key, p);
    if (scenes.size > KEEP) {
      const [old, o] = scenes.entries().next().value!;
      gl.deleteProgram(o.pr);
      scenes.delete(old);
    }
    return p;
  };
  const B = mk(COMP_FS, ['uScene', 'uPrev', 'uRes', 'uTrail', 'uEcho', 'uEchoRot', 'uRGB', 'uPix', 'uHue', 'uSat', 'uCon', 'uGlow', 'uPost'] as const);
  const C = mk(FINAL_FS, [
    'uComp',
    'uText',
    'uRes',
    'uBright',
    'uWhite',
    'uBlack',
    'uInv',
    'uScan',
    'uVig',
    'uTextOn',
    'uTextScale',
    'uTextY',
    'uTextCol',
  ] as const);
  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  const texParams = () => {
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  };
  const target = (w: number, h: number): Target => {
    const t = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    texParams();
    const f = gl.createFramebuffer()!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, f);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    return { t, f };
  };
  const free = (o: Target | null) => {
    if (o) {
      gl.deleteTexture(o.t);
      gl.deleteFramebuffer(o.f);
    }
  };
  let tw = 0;
  let th = 0;
  let Sc: Target | null = null;
  let Cm: [Target | null, Target | null] = [null, null];
  let ci = 0;

  // Words are drawn once on a 2D canvas and used as a texture.
  const tc = document.createElement('canvas');
  tc.width = 2048;
  tc.height = 512;
  const tx = tc.getContext('2d')!;
  const textTex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, textTex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4));
  texParams();
  let textKey: string | null = null;
  const updateText = (str: string, font: string) => {
    const key = `${str}|${font}`;
    if (key === textKey) return;
    textKey = key;
    tx.clearRect(0, 0, 2048, 512);
    if (str) {
      const [wt, fam] = FONTS[font] ?? FONTS.clean!;
      let size = 300;
      tx.font = `${wt} ${size}px ${fam}`;
      const m = tx.measureText(str).width;
      if (m > 1800) size = (size * 1800) / m;
      tx.font = `${wt} ${size}px ${fam}`;
      tx.textAlign = 'center';
      tx.textBaseline = 'middle';
      tx.fillStyle = '#fff';
      tx.shadowColor = 'rgba(255,255,255,.9)';
      tx.shadowBlur = 40;
      tx.fillText(str, 1024, 262);
      tx.shadowBlur = 0;
      tx.fillText(str, 1024, 262);
    }
    gl.bindTexture(gl.TEXTURE_2D, textTex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, tc);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  };

  const draw = (u: Frame, width: number, height: number) => {
    if (gl.isContextLost()) return;
    const W = Math.max(2, Math.floor(width));
    const H = Math.max(2, Math.floor(height));
    if (canvas.width !== W || canvas.height !== H) {
      canvas.width = W;
      canvas.height = H;
    }
    const q = u.q || 1;
    const w = Math.max(2, Math.floor(W * q));
    const h = Math.max(2, Math.floor(H * q));
    if (w !== tw || h !== th || !Sc) {
      free(Sc);
      free(Cm[0]);
      free(Cm[1]);
      Sc = target(w, h);
      Cm = [target(w, h), target(w, h)];
      tw = w;
      th = h;
    }
    updateText(u.text.str, u.text.font);
    // pass 1: scenes (only the layers being shown)
    const A = sceneProg(u.mix < 1 ? u.m0 : -1, u.mix > 0 ? u.m1 : -1, u.ov > 0 ? u.m2 : -1);
    gl.bindFramebuffer(gl.FRAMEBUFFER, Sc.f);
    gl.viewport(0, 0, w, h);
    gl.useProgram(A.pr);
    const a = A.U;
    gl.uniform2f(a.uRes, w, h);
    gl.uniform1f(a.uBeat, u.beat);
    gl.uniform1f(a.uB0, u.b0);
    gl.uniform1f(a.uB1, u.b1);
    gl.uniform1f(a.uB2, u.b2);
    gl.uniform1f(a.uPulse, u.pulse);
    gl.uniform1f(a.uMix, u.mix);
    gl.uniform1i(a.uM0, u.m0);
    gl.uniform1i(a.uM1, u.m1);
    gl.uniform1i(a.uM2, u.m2);
    gl.uniformMatrix3fv(a.uP0, false, new Float32Array(u.p0));
    gl.uniformMatrix3fv(a.uP1, false, new Float32Array(u.p1));
    gl.uniformMatrix3fv(a.uP2, false, new Float32Array(u.p2));
    gl.uniform1f(a.uS0, u.s0);
    gl.uniform1f(a.uS1, u.s1);
    gl.uniform1f(a.uS2, u.s2);
    gl.uniform1f(a.uF0, u.f0);
    gl.uniform1f(a.uF1, u.f1);
    gl.uniform1f(a.uF2, u.f2);
    gl.uniform1f(a.uK0, u.k0);
    gl.uniform1f(a.uK1, u.k1);
    gl.uniform1f(a.uK2, u.k2);
    gl.uniform1f(a.uOv, u.ov);
    gl.uniform1f(a.uOvMode, u.ovMode);
    gl.uniform1f(a.uZoom, u.zoom);
    gl.uniform1f(a.uRot, u.rot);
    gl.uniform2f(a.uPan, u.panX, u.panY);
    gl.uniform1f(a.uKal, u.kal);
    gl.uniform1f(a.uMirror, u.mirror);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    // pass 2: color, glitch, trails
    const nx = Cm[ci]!;
    const pv = Cm[1 - ci]!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, nx.f);
    gl.useProgram(B.pr);
    const b = B.U;
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, Sc.t);
    gl.uniform1i(b.uScene, 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, pv.t);
    gl.uniform1i(b.uPrev, 1);
    gl.uniform2f(b.uRes, w, h);
    gl.uniform1f(b.uTrail, u.trail);
    gl.uniform1f(b.uEcho, u.echo);
    gl.uniform1f(b.uEchoRot, u.echoRot);
    gl.uniform1f(b.uRGB, u.rgb);
    gl.uniform1f(b.uPix, u.pix);
    gl.uniform1f(b.uHue, u.hue);
    gl.uniform1f(b.uSat, u.sat);
    gl.uniform1f(b.uCon, u.con);
    gl.uniform1f(b.uGlow, u.glow);
    gl.uniform1f(b.uPost, u.post);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    // pass 3: to the screen with text and the master controls
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, W, H);
    gl.useProgram(C.pr);
    const c = C.U;
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, nx.t);
    gl.uniform1i(c.uComp, 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, textTex);
    gl.uniform1i(c.uText, 1);
    gl.uniform2f(c.uRes, W, H);
    gl.uniform1f(c.uBright, u.bright);
    gl.uniform1f(c.uWhite, u.white);
    gl.uniform1f(c.uBlack, u.black);
    gl.uniform1f(c.uInv, u.inv);
    gl.uniform1f(c.uScan, u.scan);
    gl.uniform1f(c.uVig, u.vig);
    gl.uniform1f(c.uTextOn, u.text.str ? u.text.on : 0);
    gl.uniform1f(c.uTextScale, u.text.scale);
    gl.uniform1f(c.uTextY, u.text.y);
    gl.uniform3f(c.uTextCol, u.text.col[0], u.text.col[1], u.text.col[2]);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.activeTexture(gl.TEXTURE0);
    ci = 1 - ci;
  };
  return {
    draw,
    lost: () => gl.isContextLost(),
    refreshText: () => {
      textKey = null;
    },
    dispose: () => {
      for (const p of scenes.values()) gl.deleteProgram(p.pr);
      scenes.clear();
      free(Sc);
      free(Cm[0]);
      free(Cm[1]);
      gl.getExtension('WEBGL_lose_context')?.loseContext();
    },
  };
}
