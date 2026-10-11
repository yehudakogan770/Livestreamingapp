// GLSL for the compositor (WebGL2). The blend math mirrors core/blend.ts and
// the adjustment tables come from core/adjust.ts, so the screen and the CPU
// reference agree. Every pass draws one full-screen triangle into a target
// region; `p` is the pixel in the target, `doc = uOrigin + p` the document
// pixel.

import type { Depth } from '../core/types';

export const VS = `#version 300 es
void main() {
  vec2 P[3] = vec2[3](vec2(-1.0, -1.0), vec2(3.0, -1.0), vec2(-1.0, 3.0));
  gl_Position = vec4(P[gl_VertexID], 0.0, 1.0);
}`;

const HEAD = `#version 300 es
precision highp float;
precision highp int;
precision highp sampler2D;
precision highp usampler2D;
precision highp sampler3D;
`;

/** Fetch functions for a raster texture at a document depth. Outside the texture: `empty`. */
export function fetchDecl(name: string, depth: Depth, channels: 1 | 4): string {
  const sampler = depth === 16 ? 'usampler2D' : 'sampler2D';
  const conv = depth === 16 ? 'vec4(t) / 65535.0' : 't';
  const read = channels === 1 ? `float` : `vec4`;
  const pick = channels === 1 ? '.r' : '';
  return `
uniform ${sampler} ${name};
uniform ivec2 ${name}Origin;
uniform ivec2 ${name}Size;
${read} ${name}Fetch(ivec2 doc, ${read} empty) {
  ivec2 q = doc - ${name}Origin;
  if (q.x < 0 || q.y < 0 || q.x >= ${name}Size.x || q.y >= ${name}Size.y) return empty;
  ${depth === 16 ? 'uvec4' : 'vec4'} t = texelFetch(${name}, q, 0);
  return (${conv})${pick};
}`;
}

/** Blend modes, as core/blend.ts (indices follow BLEND_MODES). */
const BLEND = `
float colorBurn1(float b, float s) { if (b >= 1.0) return 1.0; if (s <= 0.0) return 0.0; return 1.0 - min(1.0, (1.0 - b) / s); }
float colorDodge1(float b, float s) { if (b <= 0.0) return 0.0; if (s >= 1.0) return 1.0; return min(1.0, b / (1.0 - s)); }
float screen1(float b, float s) { return b + s - b * s; }
float hardLight1(float b, float s) { return s <= 0.5 ? b * 2.0 * s : screen1(b, 2.0 * s - 1.0); }
float softLight1(float b, float s) { return s <= 0.5 ? 2.0 * b * s + b * b * (1.0 - 2.0 * s) : 2.0 * b * (1.0 - s) + sqrt(b) * (2.0 * s - 1.0); }
float vividLight1(float b, float s) { return s <= 0.5 ? colorBurn1(b, 2.0 * s) : colorDodge1(b, 2.0 * (s - 0.5)); }
float pinLight1(float b, float s) { return s <= 0.5 ? min(b, 2.0 * s) : max(b, 2.0 * s - 1.0); }
float divide1(float b, float s) { return s <= 0.0 ? (b <= 0.0 ? 0.0 : 1.0) : min(1.0, b / s); }
float blend1(int m, float b, float s) {
  switch (m) {
    case 2: return min(b, s);
    case 3: return b * s;
    case 4: return colorBurn1(b, s);
    case 5: return clamp(b + s - 1.0, 0.0, 1.0);
    case 7: return max(b, s);
    case 8: return screen1(b, s);
    case 9: return colorDodge1(b, s);
    case 10: return min(1.0, b + s);
    case 12: return hardLight1(s, b);
    case 13: return softLight1(b, s);
    case 14: return hardLight1(b, s);
    case 15: return vividLight1(b, s);
    case 16: return clamp(b + 2.0 * s - 1.0, 0.0, 1.0);
    case 17: return pinLight1(b, s);
    case 18: return b + s >= 1.0 ? 1.0 : 0.0;
    case 19: return abs(b - s);
    case 20: return b + s - 2.0 * b * s;
    case 21: return max(0.0, b - s);
    case 22: return divide1(b, s);
  }
  return s;
}
float L601(vec3 c) { return dot(c, vec3(0.3, 0.59, 0.11)); }
vec3 clipColor(vec3 c) {
  float l = L601(c);
  float n = min(c.r, min(c.g, c.b));
  float x = max(c.r, max(c.g, c.b));
  if (n < 0.0) c = l + (c - l) * l / max(l - n, 1e-9);
  if (x > 1.0) c = l + (c - l) * (1.0 - l) / max(x - l, 1e-9);
  return c;
}
vec3 setLum(vec3 c, float l) { return clipColor(c + (l - L601(c))); }
float sat3(vec3 c) { return max(c.r, max(c.g, c.b)) - min(c.r, min(c.g, c.b)); }
vec3 setSat(vec3 c, float s) {
  float mx = max(c.r, max(c.g, c.b));
  float mn = min(c.r, min(c.g, c.b));
  if (mx <= mn) return vec3(0.0);
  return (c - mn) * s / (mx - mn);
}
vec3 blendRGB(int m, vec3 cb, vec3 cs) {
  if (m == 23) return setLum(setSat(cs, sat3(cb)), L601(cb));
  if (m == 24) return setLum(setSat(cb, sat3(cs)), L601(cb));
  if (m == 25) return setLum(cs, L601(cb));
  if (m == 26) return setLum(cb, L601(cs));
  if (m == 6) return L601(cs) < L601(cb) ? cs : cb;
  if (m == 11) return L601(cs) > L601(cb) ? cs : cb;
  return vec3(blend1(m, cb.r, cs.r), blend1(m, cb.g, cs.g), blend1(m, cb.b, cs.b));
}
float dissolveNoise(ivec2 p) {
  uint h = uint(p.x) * 374761393u + uint(p.y) * 668265263u;
  h = (h ^ (h >> 13u)) * 1274126177u;
  h ^= h >> 16u;
  return float(h) / 4294967296.0;
}
/** Lay (cs, as) over dst (straight alpha) with a mode. */
vec4 over(vec4 dst, vec3 cs, float as, int m, ivec2 doc) {
  if (m == 1) as = dissolveNoise(doc) < as ? 1.0 : 0.0;
  if (as <= 0.0) return dst;
  vec3 cr = cs;
  if (m > 1 && dst.a > 0.0) cr = (1.0 - dst.a) * cs + dst.a * blendRGB(m, clamp(dst.rgb, 0.0, 1.0), clamp(cs, 0.0, 1.0));
  float ao = as + dst.a * (1.0 - as);
  vec3 co = (cr * as + dst.rgb * dst.a * (1.0 - as)) / max(ao, 1e-7);
  return vec4(co, ao);
}
`;

const GRADIENT = `
uniform sampler2D uRamp;
uniform int uGradStyle;
uniform vec2 uG0;
uniform vec2 uG1;
float gradT(vec2 p) {
  vec2 d = uG1 - uG0;
  float len2 = max(dot(d, d), 1e-6);
  float len = sqrt(len2);
  vec2 q = p - uG0;
  if (uGradStyle == 1) return min(1.0, length(q) / len);
  if (uGradStyle == 2) {
    float a = atan(q.y, q.x) - atan(d.y, d.x);
    a = mod(a, 6.28318530718);
    return 1.0 - a / 6.28318530718;
  }
  if (uGradStyle == 3) return min(1.0, abs(dot(q, d) / len2));
  if (uGradStyle == 4) {
    vec2 u = d / len;
    return min(1.0, (abs(dot(q, u)) + abs(q.x * -u.y + q.y * u.x)) / len);
  }
  return clamp(dot(q, d) / len2, 0.0, 1.0);
}
vec4 ramp(float t) {
  float x = clamp(t, 0.0, 1.0) * 255.0;
  int i = int(min(254.0, floor(x)));
  float f = x - float(i);
  return mix(texelFetch(uRamp, ivec2(i, 0), 0), texelFetch(uRamp, ivec2(i + 1, 0), 0), f);
}
uniform sampler2D uPattern;
uniform ivec2 uPatSize;
uniform float uPatScale;
uniform vec2 uPatOffset;
vec4 pattern(vec2 doc) {
  vec2 q = floor((doc - uPatOffset) / max(uPatScale, 0.01));
  ivec2 t = ivec2(mod(q, vec2(uPatSize)));
  return texelFetch(uPattern, t, 0);
}
`;

/** Draw a layer (raster, fill or a float texture) over the backdrop. */
export function layerFS(depth: Depth): string {
  return `${HEAD}
${BLEND}
${GRADIENT}
${fetchDecl('uSrc', depth, 4)}
${fetchDecl('uMask', 8, 1)}
uniform sampler2D uBack;
uniform ivec2 uOrigin;
uniform int uSrcKind;
uniform vec4 uColor;
uniform sampler2D uFloat;
uniform ivec2 uFloatOrigin;
uniform ivec2 uFloatSize;
uniform int uHasMask;
uniform float uMaskBg;
uniform float uMaskDensity;
uniform int uHasVMask;
uniform sampler2D uVMask;
uniform float uAlpha;
uniform int uMode;
uniform int uPreserve;
uniform int uDither;
uniform int uBackEmpty;
uniform int uHasXform;
uniform mat3 uXform;
out vec4 o;
vec4 pm(vec4 c) { return vec4(c.rgb * c.a, c.a); }
/** The source at a fractional position (its own pixel coordinates), bilinear and premultiplied. */
vec4 srcBilinear(vec2 q) {
  q -= 0.5;
  ivec2 i = ivec2(floor(q));
  vec2 f = q - floor(q);
  vec4 a = pm(uSrcFetch(i, vec4(0.0))), b = pm(uSrcFetch(i + ivec2(1, 0), vec4(0.0)));
  vec4 c = pm(uSrcFetch(i + ivec2(0, 1), vec4(0.0))), d = pm(uSrcFetch(i + ivec2(1, 1), vec4(0.0)));
  vec4 r = mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
  return r.a > 1e-6 ? vec4(r.rgb / r.a, r.a) : vec4(0.0);
}
void main() {
  ivec2 p = ivec2(gl_FragCoord.xy);
  ivec2 doc = uOrigin + p;
  vec4 back = uBackEmpty == 1 ? vec4(0.0) : texelFetch(uBack, p, 0);
  vec4 s;
  if (uSrcKind == 0 && uHasXform == 1) {
    vec3 q = uXform * vec3(vec2(doc) + 0.5, 1.0);
    s = q.z > 0.0 ? srcBilinear(q.xy / q.z) : vec4(0.0);
  }
  else if (uSrcKind == 0) s = uSrcFetch(doc, vec4(0.0));
  else if (uSrcKind == 1) s = uColor;
  else if (uSrcKind == 2) {
    s = ramp(gradT(vec2(doc) + 0.5));
    if (uDither == 1) s.rgb += (dissolveNoise(doc) - 0.5) / 255.0;
  }
  else if (uSrcKind == 3) s = pattern(vec2(doc));
  else {
    ivec2 q = doc - uFloatOrigin;
    s = (q.x < 0 || q.y < 0 || q.x >= uFloatSize.x || q.y >= uFloatSize.y) ? vec4(0.0) : texelFetch(uFloat, q, 0);
  }
  float a = s.a * uAlpha;
  if (uHasMask == 1) {
    float m = uMaskFetch(doc, uMaskBg);
    a *= 1.0 - uMaskDensity * (1.0 - m);
  }
  if (uHasVMask == 1) a *= texelFetch(uVMask, doc, 0).r;
  vec4 r = over(back, s.rgb, a, uMode, doc);
  if (uPreserve == 1) r = back.a > 0.0 ? vec4(r.rgb, back.a) : back;
  o = r;
}`;
}

/** An adjustment layer: the backdrop through a lookup table, mixed back by mode, opacity and mask. */
export function adjustFS(depth: Depth): string {
  return `${HEAD}
${BLEND}
${fetchDecl('uMask', 8, 1)}
uniform sampler2D uBack;
uniform ivec2 uOrigin;
uniform int uKind;
uniform sampler2D uLut1;
uniform int uLut1N;
uniform sampler2D uLut3;
uniform int uLut3N;
uniform float uThreshold;
uniform int uLinear;
uniform int uHasMask;
uniform float uMaskBg;
uniform float uMaskDensity;
uniform int uHasVMask;
uniform sampler2D uVMask;
uniform float uAlpha;
uniform int uMode;
out vec4 o;
vec4 L1(int i) { return texelFetch(uLut1, ivec2(i, 0), 0); }
float lut1(float v, int k) {
  float x = clamp(v, 0.0, 1.0) * float(uLut1N - 1);
  int i = int(min(float(uLut1N - 2), floor(x)));
  float f = x - float(i);
  return mix(L1(i)[k], L1(i + 1)[k], f);
}
vec3 L3(int r, int g, int b) {
  // The 3D table is laid out as an (n*n) x n 2D texture: x = r + n*b, y = g.
  return texelFetch(uLut3, ivec2(r + uLut3N * b, g), 0).rgb;
}
vec3 lut3(vec3 c) {
  float n1 = float(uLut3N - 1);
  vec3 x = clamp(c, 0.0, 1.0) * n1;
  ivec3 i = ivec3(min(vec3(n1 - 1.0), floor(x)));
  vec3 f = x - vec3(i);
  vec3 c00 = mix(L3(i.x, i.y, i.z), L3(i.x + 1, i.y, i.z), f.x);
  vec3 c10 = mix(L3(i.x, i.y + 1, i.z), L3(i.x + 1, i.y + 1, i.z), f.x);
  vec3 c01 = mix(L3(i.x, i.y, i.z + 1), L3(i.x + 1, i.y, i.z + 1), f.x);
  vec3 c11 = mix(L3(i.x, i.y + 1, i.z + 1), L3(i.x + 1, i.y + 1, i.z + 1), f.x);
  return mix(mix(c00, c10, f.y), mix(c01, c11, f.y), f.z);
}
void main() {
  ivec2 p = ivec2(gl_FragCoord.xy);
  ivec2 doc = uOrigin + p;
  vec4 back = texelFetch(uBack, p, 0);
  float k = uAlpha;
  if (uHasMask == 1) k *= 1.0 - uMaskDensity * (1.0 - uMaskFetch(doc, uMaskBg));
  if (uHasVMask == 1) k *= texelFetch(uVMask, doc, 0).r;
  if (k <= 0.0 || back.a <= 0.0) { o = back; return; }
  vec3 c = back.rgb;
  if (uLinear == 1) c = pow(clamp(c, 0.0, 1.0), vec3(1.0 / 2.2));
  vec3 a;
  if (uKind == 1) a = vec3(lut1(c.r, 0), lut1(c.g, 1), lut1(c.b, 2));
  else if (uKind == 2) a = lut3(c);
  else a = vec3(dot(c, vec3(0.299, 0.587, 0.114)) >= uThreshold ? 1.0 : 0.0);
  if (uLinear == 1) a = pow(a, vec3(2.2));
  if (uMode != 0) a = blendRGB(uMode, clamp(back.rgb, 0.0, 1.0), a);
  o = vec4(mix(back.rgb, a, k), back.a);
}`;
}

/** Pass-through groups with opacity or a mask: mix the backdrop before and after. */
export function mixFS(depth: Depth): string {
  return `${HEAD}
${fetchDecl('uMask', 8, 1)}
uniform sampler2D uBefore;
uniform sampler2D uAfter;
uniform ivec2 uOrigin;
uniform int uHasMask;
uniform float uMaskBg;
uniform float uMaskDensity;
uniform int uHasVMask;
uniform sampler2D uVMask;
uniform float uAlpha;
out vec4 o;
void main() {
  ivec2 p = ivec2(gl_FragCoord.xy);
  ivec2 doc = uOrigin + p;
  float k = uAlpha;
  if (uHasMask == 1) k *= 1.0 - uMaskDensity * (1.0 - uMaskFetch(doc, uMaskBg));
  if (uHasVMask == 1) k *= texelFetch(uVMask, doc, 0).r;
  o = mix(texelFetch(uBefore, p, 0), texelFetch(uAfter, p, 0), k);
}`;
}

/** Copy a region (optionally premultiplying) between textures, placed by uOffset. */
export const COPY_FS = `${HEAD}
uniform sampler2D uSrc;
uniform ivec2 uOffset;
uniform int uPremul;
out vec4 o;
void main() {
  vec4 c = texelFetch(uSrc, ivec2(gl_FragCoord.xy) - uOffset, 0);
  o = uPremul == 1 ? vec4(c.rgb * c.a, c.a) : c;
}`;

// ---- layer styles ----

/** Resample a texture (bilinear) at `uRatio` source pixels per output pixel; channel 0 = alpha, 1 = 1 − alpha, 2 = all. */
export const RESAMPLE_FS = `${HEAD}
uniform sampler2D uSrc;
uniform vec2 uSrcSize;
uniform float uRatio;
uniform int uChan;
out vec4 o;
void main() {
  vec2 q = gl_FragCoord.xy * uRatio / uSrcSize;
  vec4 c = texture(uSrc, q);
  if (uChan == 2) { o = c; return; }
  o = vec4(uChan == 1 ? 1.0 - c.a : c.a);
}`;

/** One direction of a Gaussian (sigma ≤ 4 at this level). */
export const BLUR_FS = `${HEAD}
uniform sampler2D uSrc;
uniform ivec2 uDir;
uniform float uSigma;
uniform ivec2 uSize;
out vec4 o;
void main() {
  ivec2 p = ivec2(gl_FragCoord.xy);
  int r = int(ceil(uSigma * 3.0));
  vec4 acc = vec4(0.0);
  float wsum = 0.0;
  for (int i = -12; i <= 12; i++) {
    if (i < -r || i > r) continue;
    float w = exp(-float(i * i) / (2.0 * uSigma * uSigma));
    ivec2 q = clamp(p + uDir * i, ivec2(0), uSize - 1);
    acc += texelFetch(uSrc, q, 0) * w;
    wsum += w;
  }
  o = acc / wsum;
}`;

/** Jump flooding: seeds where the source's alpha is on the chosen side of 0.5. */
export const JFA_INIT_FS = `${HEAD}
uniform sampler2D uSrc;
uniform int uInside;
out vec4 o;
void main() {
  ivec2 p = ivec2(gl_FragCoord.xy);
  float a = texelFetch(uSrc, p, 0).a;
  bool seed = uInside == 1 ? a < 0.5 : a >= 0.5;
  o = seed ? vec4(vec2(p), 0.0, 1.0) : vec4(-1.0);
}`;

export const JFA_STEP_FS = `${HEAD}
uniform sampler2D uSrc;
uniform int uStep;
uniform ivec2 uSize;
out vec4 o;
void main() {
  ivec2 p = ivec2(gl_FragCoord.xy);
  vec4 best = texelFetch(uSrc, p, 0);
  float bd = best.w < 0.0 ? 1e20 : distance(best.xy, vec2(p));
  for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
    ivec2 q = p + ivec2(x, y) * uStep;
    if (q.x < 0 || q.y < 0 || q.x >= uSize.x || q.y >= uSize.y) continue;
    vec4 s = texelFetch(uSrc, q, 0);
    if (s.w < 0.0) continue;
    float d = distance(s.xy, vec2(p));
    if (d < bd) { bd = d; best = s; }
  }
  o = best;
}`;

/** One layer effect over the backdrop. */
export const FX_FS = `${HEAD}
${BLEND}
${GRADIENT}
uniform sampler2D uBack;
uniform ivec2 uOrigin;
uniform sampler2D uS;
uniform ivec2 uE;
uniform sampler2D uB;
uniform vec2 uBSize;
uniform float uBScale;
uniform vec2 uShift;
uniform vec2 uShift2;
uniform sampler2D uJ;
uniform sampler2D uJ2;
uniform int uFx;
uniform vec3 uColor;
uniform vec3 uColor2;
uniform float uOpacity;
uniform float uOpacity2;
uniform int uMode;
uniform int uMode2;
uniform float uSpread;
uniform float uSize;
uniform int uFlag;
uniform vec3 uLight;
uniform float uDepth;
uniform int uBevelStyle;
out vec4 o;
float S(ivec2 doc) { return texelFetch(uS, doc - uE, 0).a; }
vec4 Sc(ivec2 doc) { return texelFetch(uS, doc - uE, 0); }
float B(vec2 doc) { return texture(uB, (doc - vec2(uE)) / uBScale / uBSize).r; }
float choke(float a, float spread) { return clamp(a / max(1.0 - spread, 0.02), 0.0, 1.0); }
void main() {
  ivec2 p = ivec2(gl_FragCoord.xy);
  ivec2 doc = uOrigin + p;
  vec2 c = vec2(doc) + 0.5;
  vec4 back = texelFetch(uBack, p, 0);
  float sa = S(doc);
  vec3 col = uColor;
  float a = 0.0;
  if (uFx == 1) { // drop shadow
    a = choke(B(c - uShift), uSpread);
    if (uFlag == 1) a *= 1.0 - sa;
  } else if (uFx == 2) { // outer glow
    a = choke(B(c), uSpread) * (1.0 - sa);
  } else if (uFx == 3) { // inner shadow
    a = choke(B(c - uShift), uSpread) * sa;
  } else if (uFx == 4) { // inner glow
    float v = choke(B(c), uSpread);
    a = (uFlag == 1 ? 1.0 - v : v) * sa;
  } else if (uFx == 5) { // satin
    float v = abs(B(c - uShift) - B(c - uShift2));
    if (uFlag == 1) v = 1.0 - v;
    a = v * sa;
  } else if (uFx == 6) { // color overlay
    a = sa;
  } else if (uFx == 7) { // gradient overlay
    vec4 g = ramp(gradT(c));
    col = g.rgb;
    a = sa * g.a;
  } else if (uFx == 8) { // pattern overlay
    vec4 t = pattern(vec2(doc));
    col = t.rgb;
    a = sa * t.a;
  } else if (uFx == 9) { // stroke: distances from the jump-flooded seeds
    vec4 so = texelFetch(uJ, doc - uE, 0);
    vec4 si = texelFetch(uJ2, doc - uE, 0);
    float dOut = so.w < 0.0 ? 1e6 : distance(so.xy + 0.5, vec2(doc - uE) + 0.5);
    float dIn = si.w < 0.0 ? 1e6 : distance(si.xy + 0.5, vec2(doc - uE) + 0.5);
    float outside = 0.0, inside = 0.0;
    if (uFlag == 0) outside = uSize;
    else if (uFlag == 1) inside = uSize;
    else { outside = uSize * 0.5; inside = uSize * 0.5; }
    float ao = outside > 0.0 ? clamp(outside + 0.5 - dOut, 0.0, 1.0) * (1.0 - sa) : 0.0;
    float ai = inside > 0.0 ? clamp(inside + 0.5 - dIn, 0.0, 1.0) * sa : 0.0;
    // Pixels on the edge itself belong to the stroke on the side it covers.
    if (outside > 0.0 && sa > 0.0 && sa < 1.0) ao = max(ao, 1.0 - sa);
    if (inside > 0.0 && sa > 0.0 && sa < 1.0) ai = max(ai, sa);
    a = max(ao, ai);
  } else if (uFx == 10) { // bevel and emboss: highlight and shadow from the blurred alpha's slope
    float e = uBScale;
    float dx = (B(c + vec2(e, 0.0)) - B(c - vec2(e, 0.0))) / (2.0 * e);
    float dy = (B(c + vec2(0.0, e)) - B(c - vec2(0.0, e))) / (2.0 * e);
    float k = uDepth * uSize;
    vec3 n = normalize(vec3(-dx * k, -dy * k, 1.0));
    float shade = dot(n, uLight) - uLight.z;
    if (uFlag == 1) shade = -shade;
    float region = 1.0;
    if (uBevelStyle == 0) region = sa;
    else if (uBevelStyle == 1) region = 1.0 - sa;
    else if (uBevelStyle == 3) { if (sa < 0.5) shade = -shade; }
    float hi = clamp(shade * 2.0, 0.0, 1.0) * region;
    float sh = clamp(-shade * 2.0, 0.0, 1.0) * region;
    vec4 r = over(back, uColor, hi * uOpacity, uMode, doc);
    o = over(r, uColor2, sh * uOpacity2, uMode2, doc);
    return;
  }
  o = over(back, col, a * uOpacity, uMode, doc);
}`;

// ---- the screen ----

/**
 * The document on screen: the composite (premultiplied) drawn through the view
 * transform over the transparency checkerboard, converted from the document's
 * color space to the display's, with the selection's marching ants, the quick
 * mask, and a mask or channel shown on its own when asked.
 */
export const VIEW_FS = `${HEAD}
uniform sampler2D uComp;
uniform vec2 uDocSize;
uniform mat3 uScreenToDoc;
uniform float uZoom;
uniform vec3 uPasteboard;
uniform int uDecode;
uniform sampler2D uTrc;
uniform mat3 uToDisplay;
uniform int uEncode;
uniform int uLinearDoc;
uniform float uExposure;
uniform sampler2D uSel;
uniform int uHasSel;
uniform float uTime;
uniform int uQuickMask;
uniform vec4 uQuickColor;
uniform int uShowMask;
uniform sampler2D uMaskTex;
uniform vec2 uMaskOrigin;
uniform vec2 uMaskSize;
uniform int uChecker;
uniform vec3 uCheck1;
uniform vec3 uCheck2;
uniform int uPixelGrid;
uniform vec2 uViewport;
out vec4 o;
float decodeTrc(float v) {
  float x = clamp(v, 0.0, 1.0) * 4095.0;
  int i = int(min(4094.0, floor(x)));
  return mix(texelFetch(uTrc, ivec2(i, 0), 0).r, texelFetch(uTrc, ivec2(i + 1, 0), 0).r, x - float(i));
}
float encodeSrgb(float v) { return v <= 0.0031308 ? v * 12.92 : 1.055 * pow(v, 1.0 / 2.4) - 0.055; }
float selAt(vec2 d) {
  if (d.x < 0.0 || d.y < 0.0 || d.x >= uDocSize.x || d.y >= uDocSize.y) return 0.0;
  return texelFetch(uSel, ivec2(d), 0).r;
}
void main() {
  vec2 sp = vec2(gl_FragCoord.x, uViewport.y - gl_FragCoord.y);
  vec2 d = (uScreenToDoc * vec3(sp, 1.0)).xy;
  if (d.x < 0.0 || d.y < 0.0 || d.x >= uDocSize.x || d.y >= uDocSize.y) { o = vec4(uPasteboard, 1.0); return; }
  vec4 c;
  // Exactly 100 % and close-ups show the pixels; other zooms are filtered (mipmaps when smaller).
  if (abs(uZoom - 1.0) < 1e-4 || uZoom >= 3.0) c = texelFetch(uComp, ivec2(d), 0);
  else c = texture(uComp, d / uDocSize);
  vec3 rgb = c.a > 0.0 ? c.rgb / c.a : vec3(0.0);
  if (uShowMask == 1) {
    vec2 q = d - uMaskOrigin;
    float m = (q.x < 0.0 || q.y < 0.0 || q.x >= uMaskSize.x || q.y >= uMaskSize.y) ? 0.0 : texelFetch(uMaskTex, ivec2(q), 0).r;
    o = vec4(vec3(m), 1.0);
    return;
  }
  // Color management: document → linear → display.
  if (uLinearDoc == 1) rgb = rgb * uExposure;
  else if (uDecode == 1) rgb = vec3(decodeTrc(rgb.r), decodeTrc(rgb.g), decodeTrc(rgb.b));
  if (uDecode == 1 || uLinearDoc == 1) {
    rgb = uToDisplay * rgb;
    rgb = clamp(rgb, 0.0, 1.0);
    rgb = vec3(encodeSrgb(rgb.r), encodeSrgb(rgb.g), encodeSrgb(rgb.b));
  }
  vec3 bg = uPasteboard;
  if (uChecker == 1) {
    vec2 cell = floor(sp / 8.0);
    bg = mod(cell.x + cell.y, 2.0) < 1.0 ? uCheck1 : uCheck2;
  }
  vec3 outc = rgb * c.a + bg * (1.0 - c.a);
  if (uQuickMask == 1) {
    float s = selAt(d);
    outc = mix(outc, uQuickColor.rgb, (1.0 - s) * uQuickColor.a);
  }
  if (uPixelGrid == 1 && uZoom >= 8.0) {
    vec2 f = fract(d);
    float e = 1.0 / uZoom;
    if (f.x < e || f.y < e) outc = mix(outc, vec3(0.55), 0.35);
  }
  if (uHasSel == 1 && uQuickMask == 0) {
    // Marching ants where the selection crosses 50 % between this screen pixel and its neighbors.
    vec2 dx = (uScreenToDoc * vec3(sp + vec2(1.0, 0.0), 1.0)).xy;
    vec2 dy = (uScreenToDoc * vec3(sp + vec2(0.0, 1.0), 1.0)).xy;
    bool a0 = selAt(d) >= 0.5;
    bool edge = (selAt(dx) >= 0.5) != a0 || (selAt(dy) >= 0.5) != a0;
    vec2 dl = (uScreenToDoc * vec3(sp - vec2(1.0, 0.0), 1.0)).xy;
    vec2 du = (uScreenToDoc * vec3(sp - vec2(0.0, 1.0), 1.0)).xy;
    edge = edge || (selAt(dl) >= 0.5) != a0 || (selAt(du) >= 0.5) != a0;
    if (edge) {
      float t = mod(sp.x + sp.y + uTime * 16.0, 8.0);
      outc = t < 4.0 ? vec3(0.0) : vec3(1.0);
    }
  }
  o = vec4(outc, 1.0);
}`;
