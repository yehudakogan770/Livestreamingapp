// The GPU programs that draw the picture. Colors are kept "premultiplied"
// (color already multiplied by how see-through it is), so layers stack cleanly.

export const FULL_VS = `#version 300 es
in vec2 aPos;
out vec2 vUv;
void main() {
  vUv = aPos * 0.5 + 0.5;
  gl_Position = vec4(aPos, 0.0, 1.0);
}`;

export const LAYER_VS = `#version 300 es
in vec4 aPos;
in vec2 aUv;
out vec2 vUv;
void main() {
  vUv = aUv;
  gl_Position = aPos;
}`;

const HEAD = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outColor;
uniform sampler2D uTex;
uniform vec2 uSize;
vec3 unpre(vec4 c) { return c.a > 0.0001 ? c.rgb / c.a : vec3(0.0); }
float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
vec3 rgb2hsv(vec3 c) {
  vec4 K = vec4(0.0, -1.0 / 3.0, 2.0 / 3.0, -1.0);
  vec4 p = mix(vec4(c.bg, K.wz), vec4(c.gb, K.xy), step(c.b, c.g));
  vec4 q = mix(vec4(p.xyw, c.r), vec4(c.r, p.yzx), step(p.x, c.r));
  float d = q.x - min(q.w, q.y);
  float e = 1.0e-10;
  return vec3(abs(q.z + (q.w - q.y) / (6.0 * d + e)), d / (q.x + e), q.x);
}
vec3 hsv2rgb(vec3 c) {
  vec4 K = vec4(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);
  vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
  return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
}
`;

export const LAYER_FS = `${HEAD}
uniform vec4 uCrop; // left, top, right, bottom (0–1 of the picture kept)
void main() {
  if (vUv.x < uCrop.x || vUv.y < uCrop.y || vUv.x > uCrop.z || vUv.y > uCrop.w) discard;
  outColor = texture(uTex, vUv);
}`;

export const COPY_FS = `${HEAD}
uniform float uOpacity;
void main() { outColor = texture(uTex, vUv) * uOpacity; }`;

/** Over a flat color (the sequence background), flipped for reading back. */
export const FINAL_FS = `${HEAD}
uniform vec3 uBack;
uniform float uFlip;
void main() {
  vec2 uv = uFlip > 0.5 ? vec2(vUv.x, 1.0 - vUv.y) : vUv;
  vec4 c = texture(uTex, uv);
  outColor = vec4(c.rgb + uBack * (1.0 - c.a), 1.0);
}`;

export const BLEND_MODES = ['normal', 'multiply', 'screen', 'overlay', 'add', 'darken', 'lighten', 'difference', 'softlight'];

export const COMPOSITE_FS = `${HEAD}
uniform sampler2D uBase;
uniform float uOpacity;
uniform int uMode;
vec3 blendOne(vec3 b, vec3 s) {
  if (uMode == 1) return b * s;
  if (uMode == 2) return b + s - b * s;
  if (uMode == 3) return mix(2.0 * b * s, 1.0 - 2.0 * (1.0 - b) * (1.0 - s), step(0.5, b));
  if (uMode == 4) return min(vec3(1.0), b + s);
  if (uMode == 5) return min(b, s);
  if (uMode == 6) return max(b, s);
  if (uMode == 7) return abs(b - s);
  if (uMode == 8) {
    vec3 d = mix(((16.0 * b - 12.0) * b + 4.0) * b, sqrt(b), step(0.25, b));
    return mix(b - (1.0 - 2.0 * s) * b * (1.0 - b), b + (2.0 * s - 1.0) * (d - b), step(0.5, s));
  }
  return s;
}
void main() {
  vec4 B = texture(uBase, vUv);
  vec4 T = texture(uTex, vUv) * uOpacity;
  if (uMode == 0) { outColor = T + B * (1.0 - T.a); return; }
  vec3 cb = unpre(B);
  vec3 cs = unpre(T);
  vec3 f = blendOne(cb, cs);
  outColor = vec4((1.0 - B.a) * T.rgb + (1.0 - T.a) * B.rgb + T.a * B.a * f, T.a + B.a * (1.0 - T.a));
}`;

export const TRANSITION_TYPES = [
  'dissolve',
  'dipblack',
  'dipwhite',
  'filmdissolve',
  'wipeleft',
  'wiperight',
  'wipeup',
  'wipedown',
  'slideleft',
  'slideright',
  'pushleft',
  'pushright',
  'iris',
  'zoom',
  'blurdissolve',
];

export const TRANSITION_FS = `${HEAD}
uniform sampler2D uB;
uniform float uP;
uniform int uType;
uniform float uOpA;
uniform float uOpB;
vec4 A(vec2 uv) { return (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) ? vec4(0.0) : texture(uTex, uv) * uOpA; }
vec4 Bt(vec2 uv) { return (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) ? vec4(0.0) : texture(uB, uv) * uOpB; }
vec4 soft(vec4 a, vec4 b, float e) { return mix(a, b, smoothstep(-0.004, 0.004, e)); }
vec4 blurred(vec2 uv, float r, bool useB) {
  vec4 s = vec4(0.0);
  vec2 px = r / uSize;
  for (int i = -2; i <= 2; i++) for (int j = -2; j <= 2; j++) {
    vec2 o = vec2(float(i), float(j)) * px;
    s += useB ? Bt(uv + o) : A(uv + o);
  }
  return s / 25.0;
}
void main() {
  float p = clamp(uP, 0.0, 1.0);
  vec2 uv = vUv;
  vec4 black = vec4(0.0, 0.0, 0.0, 1.0);
  vec4 white = vec4(1.0);
  if (uType == 0) outColor = mix(A(uv), Bt(uv), p);
  else if (uType == 1) outColor = p < 0.5 ? mix(A(uv), black, p * 2.0) : mix(black, Bt(uv), p * 2.0 - 1.0);
  else if (uType == 2) outColor = p < 0.5 ? mix(A(uv), white, p * 2.0) : mix(white, Bt(uv), p * 2.0 - 1.0);
  else if (uType == 3) {
    vec4 a = A(uv); vec4 b = Bt(uv);
    vec3 c = pow(mix(pow(a.rgb, vec3(2.2)), pow(b.rgb, vec3(2.2)), p), vec3(1.0 / 2.2));
    outColor = vec4(c, mix(a.a, b.a, p));
  }
  else if (uType == 4) outColor = soft(A(uv), Bt(uv), uv.x - (1.0 - p));
  else if (uType == 5) outColor = soft(A(uv), Bt(uv), p - uv.x);
  else if (uType == 6) outColor = soft(A(uv), Bt(uv), p - uv.y);
  else if (uType == 7) outColor = soft(A(uv), Bt(uv), uv.y - (1.0 - p));
  else if (uType == 8) { vec4 b = Bt(uv - vec2(1.0 - p, 0.0)); outColor = b + A(uv) * (1.0 - b.a); }
  else if (uType == 9) { vec4 b = Bt(uv + vec2(1.0 - p, 0.0)); outColor = b + A(uv) * (1.0 - b.a); }
  else if (uType == 10) { vec4 b = Bt(uv - vec2(1.0 - p, 0.0)); vec4 a = A(uv + vec2(p, 0.0)); outColor = b + a * (1.0 - b.a); }
  else if (uType == 11) { vec4 b = Bt(uv + vec2(1.0 - p, 0.0)); vec4 a = A(uv - vec2(p, 0.0)); outColor = b + a * (1.0 - b.a); }
  else if (uType == 12) {
    vec2 d = (uv - 0.5) * vec2(uSize.x / uSize.y, 1.0);
    float r = p * length(vec2(uSize.x / uSize.y, 1.0)) * 0.5;
    outColor = soft(A(uv), Bt(uv), r - length(d));
  }
  else if (uType == 13) {
    vec4 a = A(0.5 + (uv - 0.5) / (1.0 + p * 1.5));
    vec4 b = Bt(0.5 + (uv - 0.5) * (1.0 + (1.0 - p) * 0.5));
    outColor = mix(a, b, smoothstep(0.2, 0.8, p));
  }
  else {
    float r = sin(p * 3.14159) * 6.0 + 0.001;
    outColor = mix(blurred(uv, r, false), blurred(uv, r, true), p);
  }
}`;

/** Pictures made here: gradient, noise, particles, light leak, color bars. */
export const GENERATOR_FS = `${HEAD}
uniform int uGen;
uniform float uTime, uA, uB, uC, uKind, uScale;
uniform vec3 uC1, uC2;
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p); vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
}
float fbm(vec2 p) { float v = 0.0; float a = 0.5; for (int i = 0; i < 6; i++) { v += a * noise(p); p *= 2.03; a *= 0.5; } return v; }
void main() {
  vec2 uv = vec2(vUv.x, 1.0 - vUv.y);
  vec2 asp = vec2(uSize.x / uSize.y, 1.0);
  if (uGen == 0) {
    // Gradient: A = angle, B = where the middle is; kind 1 = round.
    float t;
    if (uKind > 0.5) t = length((uv - 0.5) * asp) / 0.75;
    else { float an = uA * 6.2832; vec2 d = vec2(cos(an), sin(an)); t = dot(uv - 0.5, d) + 0.5; }
    t = clamp((t - uB) / max(0.02, uC * 2.0) + 0.5, 0.0, 1.0);
    outColor = vec4(mix(uC1, uC2, t), 1.0);
  } else if (uGen == 1) {
    // Noise / clouds: A = size, B = speed, C = contrast.
    float n = fbm(uv * asp * (1.0 + uA * 12.0) + vec2(uTime * uB * 0.6, uTime * uB * 0.25));
    n = clamp((n - 0.5) * (0.5 + uC * 3.0) + 0.5, 0.0, 1.0);
    outColor = vec4(mix(uC1, uC2, n), 1.0);
  } else if (uGen == 2) {
    // Particles: kind 0 snow, 1 sparks, 2 bokeh, 3 confetti, 4 dust. A = how many, B = size, C = speed.
    vec4 acc = vec4(0.0);
    float layers = 3.0;
    for (float L = 0.0; L < 3.0; L++) {
      float cells = mix(4.0, 26.0, uA) * (1.0 + L * 0.6);
      float speed = (0.05 + uC * 0.5) * (1.0 + L * 0.3);
      vec2 p = uv * asp * cells;
      float dir = uKind > 0.5 && uKind < 1.5 ? -1.0 : 1.0;
      p.y += uTime * speed * cells * dir;
      p.x += sin(uTime * 0.7 + L * 2.0 + floor(p.y) * 1.7) * 0.3;
      vec2 id = floor(p);
      vec2 f = fract(p) - 0.5;
      float r = hash(id + L * 13.0);
      if (r > 0.25 + (1.0 - uA) * 0.6) continue;
      vec2 off = vec2(hash(id + 1.3), hash(id + 7.1)) - 0.5;
      float size = (0.06 + uB * 0.3) * (0.5 + r) / (1.0 + L * 0.4);
      float d = length(f - off * 0.6);
      float a;
      vec3 c = uC1;
      if (uKind > 3.5) { a = smoothstep(size * 0.5, 0.0, d) * 0.5; c = mix(uC1, vec3(1.0), 0.5); }
      else if (uKind > 2.5) { vec2 q = abs(f - off * 0.6); a = step(q.x, size * 0.6) * step(q.y, size * 1.2); c = mix(uC1, uC2, hash(id + 3.0)); }
      else if (uKind > 1.5) { a = smoothstep(size * 2.2, size * 1.8, d) * 0.35 + smoothstep(size * 2.2, size * 2.0, d) * 0.1; c = mix(uC1, uC2, hash(id)); }
      else if (uKind > 0.5) { a = smoothstep(size * 0.5, 0.0, d) * (0.6 + 0.4 * sin(uTime * 20.0 + r * 50.0)); c = mix(uC1, uC2, r); }
      else { a = smoothstep(size, size * 0.4, d); c = uC1; }
      acc.rgb += c * a * (1.0 - acc.a);
      acc.a += a * (1.0 - acc.a);
    }
    outColor = acc;
  } else if (uGen == 3) {
    // Light leak: soft moving warm light (see-through, for over pictures).
    vec2 p = uv * asp;
    float a = 0.0;
    vec3 c = vec3(0.0);
    for (float i = 0.0; i < 3.0; i++) {
      vec2 ctr = vec2(0.2 + 0.6 * noise(vec2(uTime * 0.15 * (0.5 + uC) + i * 3.0, i)), 0.2 + 0.6 * noise(vec2(i * 5.0, uTime * 0.12 * (0.5 + uC) + i)));
      float d = length(p - ctr * asp);
      float k = smoothstep(0.35 + uB * 0.6, 0.0, d) * (0.4 + uA * 0.8);
      c += mix(uC1, uC2, i / 2.0) * k;
      a += k;
    }
    a = clamp(a, 0.0, 1.0);
    outColor = vec4(clamp(c, 0.0, 1.0), a);
  } else {
    // Color bars.
    float x = uv.x;
    vec3 bars[7] = vec3[7](vec3(0.75), vec3(0.75, 0.75, 0.0), vec3(0.0, 0.75, 0.75), vec3(0.0, 0.75, 0.0), vec3(0.75, 0.0, 0.75), vec3(0.75, 0.0, 0.0), vec3(0.0, 0.0, 0.75));
    int i = int(clamp(floor(x * 7.0), 0.0, 6.0));
    vec3 c = bars[i];
    if (uv.y > 0.75) c = vec3(uv.x);
    outColor = vec4(c, 1.0);
  }
}`;

/**
 * The color corrections, shared by the color effects and the grade's nodes so
 * the two always look the same. (The same math is in grade.ts for checking.)
 */
const COLOR_LIB = `
// a: exposure, contrast, pivot, highlights; b: shadows, whites, blacks, temperature; c: tint, saturation, vibrance.
vec3 gradeBasic(vec3 c, vec4 a, vec4 b, vec3 t) {
  c *= pow(2.0, a.x);
  c = c * vec3(1.0 + b.w * 0.25 + t.x * 0.1, 1.0 - t.x * 0.2, 1.0 - b.w * 0.25 + t.x * 0.1);
  float l = luma(c);
  float hw = smoothstep(0.35, 1.0, l);
  float sw = 1.0 - smoothstep(0.0, 0.65, l);
  c += c * a.w * 0.6 * hw;
  c += b.x * 0.35 * sw * (1.0 - c);
  // Whites and blacks move the ends of the range.
  float lo = -b.z * 0.15;
  float hi = 1.0 - b.y * 0.2;
  c = (c - lo) / max(0.05, hi - lo);
  c = (c - a.z) * (1.0 + a.y) + a.z;
  l = luma(c);
  float s = max(max(c.r, c.g), c.b) - min(min(c.r, c.g), c.b);
  float vib = 1.0 + t.z * (1.0 - s);
  c = mix(vec3(l), c, t.y * vib);
  return max(c, vec3(0.0));
}
vec3 gradeWheels(vec3 c, vec3 lift, vec3 gamma, vec3 gain) {
  c = c * gain + lift * (1.0 - c);
  return pow(max(c, vec3(0.0)), 1.0 / max(gamma, vec3(0.05)));
}
vec3 gradeCurves(vec3 c, sampler2D curve, float amount) {
  c = clamp(c, 0.0, 1.0);
  vec3 o = vec3(texture(curve, vec2(c.r * 255.0 / 256.0 + 0.5 / 256.0, 0.5)).r,
                texture(curve, vec2(c.g * 255.0 / 256.0 + 0.5 / 256.0, 0.5)).g,
                texture(curve, vec2(c.b * 255.0 / 256.0 + 0.5 / 256.0, 0.5)).b);
  return mix(c, o, amount);
}
// a: which hue, how wide, hue shift, saturation (hues as 0–1 turns).
vec3 gradeHsl(vec3 c, vec4 a, float light) {
  vec3 h = rgb2hsv(c);
  float d = abs(fract(h.x - a.x + 0.5) - 0.5);
  float w = (1.0 - smoothstep(a.y * 0.5, a.y, d)) * smoothstep(0.05, 0.2, h.y);
  h.x = fract(h.x + a.z * w);
  h.y = clamp(h.y * (1.0 + a.w * w), 0.0, 1.0);
  h.z = clamp(h.z * (1.0 + light * w), 0.0, 4.0);
  return hsv2rgb(h);
}
`;

/**
 * One node of a clip's grade: its corrections, limited by its qualifier and
 * window (the matte), mixed over uBase (its own input, or the nodes under it
 * in a layer mix). With uShowMatte it draws the matte in black and white.
 */
export const GRADE_FS = `${HEAD}${COLOR_LIB}
uniform sampler2D uBase, uCurve;
uniform float uUseBasic, uUseWheels, uUseCurves, uUseHsl, uUseHue, uUseQual, uUseWin, uShowMatte;
uniform vec4 uBasicA, uBasicB, uBasicC, uHslA, uQHue, uQBand, uWin;
uniform vec3 uLift, uGamma, uGain, uOffset, uWinOpt;
uniform float uCurveMix, uHslLight;
float band(float v, float lo, float hi, float s) { return smoothstep(lo - s, lo, v) * (1.0 - smoothstep(hi, hi + s, v)); }
// An HSL key on the node's input: hue (center, half width, softness, invert) and saturation and brightness ranges.
float qualify(vec3 c) {
  c = clamp(c, 0.0, 1.0);
  vec3 h = rgb2hsv(c);
  float s = max(uQHue.z, 1e-4);
  float d = abs(fract(h.x - uQHue.x + 0.5) - 0.5);
  float hk = uQHue.y >= 0.5 ? 1.0 : 1.0 - smoothstep(uQHue.y, uQHue.y + s, d);
  float q = hk * band(h.y, uQBand.x, uQBand.y, s) * band(luma(c), uQBand.z, uQBand.w, s);
  return uQHue.w > 0.5 ? 1.0 - q : q;
}
// A circle or rectangle (center and half size in frame heights), soft inside its edge.
float windowed(vec2 p) {
  vec2 d = vec2((p.x - uWin.x) * uSize.x / uSize.y, p.y - uWin.y) / uWin.zw;
  float e = uWinOpt.x > 0.5 ? max(abs(d.x), abs(d.y)) - 1.0 : length(d) - 1.0;
  float a = smoothstep(0.0, 1.0, -e / max(uWinOpt.y, 1e-4));
  return uWinOpt.z > 0.5 ? 1.0 - a : a;
}
void main() {
  vec4 src = texture(uTex, vUv);
  vec3 c = unpre(src);
  float m = 1.0;
  if (uUseQual > 0.5) m *= qualify(c);
  if (uUseWin > 0.5) m *= windowed(vec2(vUv.x, 1.0 - vUv.y));
  if (uShowMatte > 0.5) { outColor = vec4(vec3(m) * src.a, src.a); return; }
  if (uUseBasic > 0.5) c = gradeBasic(c, uBasicA, uBasicB, uBasicC.xyz);
  if (uUseWheels > 0.5) c = gradeWheels(c, uLift, uGamma, uGain) + uOffset;
  if (uUseCurves > 0.5) c = gradeCurves(c, uCurve, uCurveMix);
  if (uUseHsl > 0.5) c = gradeHsl(c, uHslA, uHslLight);
  if (uUseHue > 0.5) { vec3 h = rgb2hsv(max(c, vec3(0.0))); h.x = fract(h.x + uBasicC.w); c = hsv2rgb(h); }
  vec3 b = unpre(texture(uBase, vUv));
  outColor = vec4(mix(b, c, m) * src.a, src.a);
}`;

/** Parallel nodes: each node's change from the input (uBase) added to what is there so far. */
export const GRADE_ADD_FS = `${HEAD}
uniform sampler2D uOther, uBase;
void main() {
  vec4 a = texture(uTex, vUv);
  vec4 b = texture(uBase, vUv);
  outColor = vec4(max(a.rgb + texture(uOther, vUv).rgb - b.rgb, vec3(0.0)), b.a);
}`;

/** One program for each effect; each reads the layer and writes it changed. */
export const EFFECT_FS: Record<string, string> = {
  basic: `${HEAD}${COLOR_LIB}
uniform float uExposure, uContrast, uHighlights, uShadows, uWhites, uBlacks, uTemp, uTint, uSat, uVib;
void main() {
  vec4 src = texture(uTex, vUv);
  vec3 c = gradeBasic(unpre(src), vec4(uExposure, uContrast, 0.5, uHighlights), vec4(uShadows, uWhites, uBlacks, uTemp), vec3(uTint, uSat, uVib));
  outColor = vec4(c * src.a, src.a);
}`,
  wheels: `${HEAD}${COLOR_LIB}
uniform vec3 uLift, uGamma, uGain;
void main() {
  vec4 src = texture(uTex, vUv);
  outColor = vec4(gradeWheels(unpre(src), uLift, uGamma, uGain) * src.a, src.a);
}`,
  curves: `${HEAD}${COLOR_LIB}
uniform sampler2D uCurve;
uniform float uMix;
void main() {
  vec4 src = texture(uTex, vUv);
  outColor = vec4(gradeCurves(unpre(src), uCurve, uMix) * src.a, src.a);
}`,
  lut: `${HEAD}
uniform highp sampler3D uLut;
uniform float uMix, uLutSize;
void main() {
  vec4 src = texture(uTex, vUv);
  vec3 c = clamp(unpre(src), 0.0, 1.0);
  vec3 o = texture(uLut, c * (uLutSize - 1.0) / uLutSize + 0.5 / uLutSize).rgb;
  outColor = vec4(mix(c, o, uMix) * src.a, src.a);
}`,
  hsl: `${HEAD}${COLOR_LIB}
uniform float uHue, uRange, uShift, uSatS, uLight;
void main() {
  vec4 src = texture(uTex, vUv);
  outColor = vec4(gradeHsl(unpre(src), vec4(uHue, uRange, uShift, uSatS), uLight) * src.a, src.a);
}`,
  vignette: `${HEAD}
uniform float uAmount, uVSize, uFeather;
void main() {
  vec4 src = texture(uTex, vUv);
  vec2 d = (vUv - 0.5) * vec2(uSize.x / uSize.y, 1.0) * 1.2;
  float r = length(d);
  float v = smoothstep(uVSize, uVSize + max(0.01, uFeather), r);
  vec3 c = unpre(src);
  c = uAmount < 0.0 ? c * (1.0 + uAmount * v) : mix(c, vec3(1.0), uAmount * v);
  outColor = vec4(c * src.a, src.a);
}`,
  bw: `${HEAD}
uniform float uMix;
void main() { vec4 s = texture(uTex, vUv); vec3 c = unpre(s); outColor = vec4(mix(c, vec3(luma(c)), uMix) * s.a, s.a); }`,
  invert: `${HEAD}
uniform float uMix;
void main() { vec4 s = texture(uTex, vUv); vec3 c = unpre(s); outColor = vec4(mix(c, 1.0 - c, uMix) * s.a, s.a); }`,
  blur: `${HEAD}
uniform vec2 uDir;
uniform float uSigma;
void main() {
  if (uSigma < 0.3) { outColor = texture(uTex, vUv); return; }
  float stepPx = max(1.0, ceil(uSigma * 3.0 / 24.0));
  vec4 sum = vec4(0.0);
  float wsum = 0.0;
  for (int i = -24; i <= 24; i++) {
    float x = float(i) * stepPx;
    float w = exp(-0.5 * x * x / (uSigma * uSigma));
    sum += texture(uTex, vUv + uDir * x / uSize) * w;
    wsum += w;
  }
  outColor = sum / wsum;
}`,
  sharpen: `${HEAD}
uniform float uAmount;
void main() {
  vec2 px = 1.0 / uSize;
  vec4 c = texture(uTex, vUv);
  vec4 b = (texture(uTex, vUv + vec2(px.x, 0.0)) + texture(uTex, vUv - vec2(px.x, 0.0)) + texture(uTex, vUv + vec2(0.0, px.y)) + texture(uTex, vUv - vec2(0.0, px.y))) * 0.25;
  vec3 o = c.rgb + (c.rgb - b.rgb) * uAmount;
  outColor = vec4(clamp(o, vec3(0.0), vec3(c.a)), c.a);
}`,
  chromakey: `${HEAD}
uniform vec3 uKey;
uniform float uTol, uSoft, uSpill;
vec2 cbcr(vec3 c) { return vec2(-0.1146 * c.r - 0.3854 * c.g + 0.5 * c.b, 0.5 * c.r - 0.4542 * c.g - 0.0458 * c.b); }
void main() {
  vec4 src = texture(uTex, vUv);
  vec3 c = unpre(src);
  vec2 k = cbcr(uKey);
  float d = distance(cbcr(c), k);
  float a = smoothstep(uTol * 0.35, uTol * 0.35 + uSoft * 0.3 + 0.001, d);
  // Take the key color's tint off what is left (green edges on hair).
  vec2 dir = normalize(k + 1e-5);
  float spill = max(0.0, dot(cbcr(c), dir)) * uSpill;
  float l = luma(c);
  c = mix(c, vec3(l), clamp(spill * 3.0, 0.0, 1.0));
  float alpha = src.a * a;
  outColor = vec4(c * alpha, alpha);
}`,
  lumakey: `${HEAD}
uniform float uThreshold, uSoftness, uInvert;
void main() {
  vec4 src = texture(uTex, vUv);
  float l = luma(unpre(src));
  float a = smoothstep(uThreshold, uThreshold + uSoftness + 0.001, l);
  if (uInvert > 0.5) a = 1.0 - smoothstep(1.0 - uThreshold - uSoftness - 0.001, 1.0 - uThreshold, l);
  outColor = src * a;
}`,
  mask: `${HEAD}
uniform float uShape, uCx, uCy, uW, uH, uFeather, uInvert;
void main() {
  vec4 src = texture(uTex, vUv);
  vec2 p = vec2(vUv.x, 1.0 - vUv.y) - vec2(0.5 + uCx * 0.5, 0.5 + uCy * 0.5);
  vec2 half_ = max(vec2(0.001), vec2(uW, uH) * 0.5);
  float d;
  if (uShape < 0.5) d = length(p / half_) - 1.0;
  else { vec2 q = abs(p) / half_ - 1.0; d = max(q.x, q.y); }
  float a = 1.0 - smoothstep(-uFeather, 0.0001, d);
  if (uInvert > 0.5) a = 1.0 - a;
  outColor = src * a;
}`,
  mosaic: `${HEAD}
uniform float uBlock;
void main() {
  vec2 b = vec2(max(1.0, uBlock)) / uSize;
  outColor = texture(uTex, (floor(vUv / b) + 0.5) * b);
}`,
  grain: `${HEAD}
uniform float uAmount, uGrain, uSeed;
float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233)) + uSeed) * 43758.5453); }
void main() {
  vec4 src = texture(uTex, vUv);
  vec2 cell = floor(vUv * uSize / max(1.0, uGrain));
  float n = hash(cell) - 0.5;
  vec3 c = unpre(src) + n * uAmount * 0.35;
  outColor = vec4(clamp(c, 0.0, 1.0) * src.a, src.a);
}`,
  bright: `${HEAD}
uniform float uThreshold;
void main() {
  vec4 src = texture(uTex, vUv);
  vec3 c = unpre(src);
  float l = luma(c);
  outColor = vec4(c * smoothstep(uThreshold, uThreshold + 0.1, l) * src.a, src.a * smoothstep(uThreshold, uThreshold + 0.1, l));
}`,
  add: `${HEAD}
uniform sampler2D uOther;
uniform float uAmount;
void main() {
  vec4 a = texture(uTex, vUv);
  vec4 g = texture(uOther, vUv) * uAmount;
  outColor = vec4(min(a.rgb + g.rgb, vec3(1.0)), max(a.a, min(1.0, g.a)));
}`,
  flip: `${HEAD}
uniform float uH, uV;
void main() { outColor = texture(uTex, vec2(uH > 0.5 ? 1.0 - vUv.x : vUv.x, uV > 0.5 ? 1.0 - vUv.y : vUv.y)); }`,
  shadowmake: `${HEAD}
uniform vec2 uOffset;
uniform float uOpacity;
void main() { float a = texture(uTex, vUv - uOffset / uSize).a * uOpacity; outColor = vec4(0.0, 0.0, 0.0, a); }`,
  cornerpin: `${HEAD}
uniform mat3 uH;
void main() {
  vec2 px = vec2(vUv.x, 1.0 - vUv.y) * uSize;
  vec3 q = uH * vec3(px, 1.0);
  vec2 uv = q.xy / q.z;
  if (q.z <= 0.0 || uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) { outColor = vec4(0.0); return; }
  outColor = texture(uTex, vec2(uv.x, 1.0 - uv.y));
}`,
  chromatic: `${HEAD}
uniform float uAmount;
void main() {
  vec2 d = (vUv - 0.5) * uAmount / uSize * 2.0;
  vec4 c = texture(uTex, vUv);
  float r = texture(uTex, vUv + d).r;
  float b = texture(uTex, vUv - d).b;
  outColor = vec4(r, c.g, b, c.a);
}`,
  glitch: `${HEAD}
uniform float uAmount, uTime, uSeedRate;
float hash(float n) { return fract(sin(n) * 43758.5453); }
void main() {
  float t = floor(uTime * (2.0 + uSeedRate * 2.0));
  float band = floor(vUv.y * 24.0);
  float on = step(1.0 - uAmount * 0.5, hash(band * 7.13 + t));
  float shift = (hash(band + t * 3.1) - 0.5) * 0.12 * uAmount * on;
  vec2 uv = vUv + vec2(shift, 0.0);
  float split = 0.01 * uAmount * (0.5 + on);
  vec4 c = texture(uTex, uv);
  outColor = vec4(texture(uTex, uv + vec2(split, 0.0)).r, c.g, texture(uTex, uv - vec2(split, 0.0)).b, c.a);
}`,
  zoomblur: `${HEAD}
uniform float uAmount;
uniform vec2 uCenter;
void main() {
  vec4 s = vec4(0.0);
  for (int i = 0; i < 24; i++) {
    float k = 1.0 - uAmount * 0.3 * float(i) / 23.0;
    s += texture(uTex, uCenter + (vUv - uCenter) * k);
  }
  outColor = s / 24.0;
}`,
  dirblur: `${HEAD}
uniform vec2 uDir;
void main() {
  vec4 s = vec4(0.0);
  for (int i = 0; i < 24; i++) s += texture(uTex, vUv + uDir / uSize * (float(i) / 23.0 - 0.5));
  outColor = s / 24.0;
}`,
  displace: `${HEAD}
uniform float uAmount, uFreq, uTime;
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p); vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
}
void main() {
  vec2 p = vUv * uFreq * vec2(uSize.x / uSize.y, 1.0);
  vec2 off = vec2(noise(p + uTime), noise(p + 17.0 - uTime)) - 0.5;
  outColor = texture(uTex, vUv + off * uAmount / uSize * 2.0);
}`,
  posterize: `${HEAD}
uniform float uLevels;
void main() { vec4 s = texture(uTex, vUv); vec3 c = unpre(s); c = floor(c * uLevels) / (uLevels - 1.0); outColor = vec4(clamp(c, 0.0, 1.0) * s.a, s.a); }`,
  edges: `${HEAD}
uniform float uAmount, uInvert;
void main() {
  vec2 px = 1.0 / uSize;
  float tl = luma(texture(uTex, vUv + vec2(-px.x, px.y)).rgb), t = luma(texture(uTex, vUv + vec2(0, px.y)).rgb), tr = luma(texture(uTex, vUv + px).rgb);
  float l = luma(texture(uTex, vUv - vec2(px.x, 0)).rgb), r = luma(texture(uTex, vUv + vec2(px.x, 0)).rgb);
  float bl = luma(texture(uTex, vUv - px).rgb), b = luma(texture(uTex, vUv - vec2(0, px.y)).rgb), br = luma(texture(uTex, vUv + vec2(px.x, -px.y)).rgb);
  float gx = -tl - 2.0 * l - bl + tr + 2.0 * r + br;
  float gy = -tl - 2.0 * t - tr + bl + 2.0 * b + br;
  float e = clamp(length(vec2(gx, gy)), 0.0, 1.0);
  if (uInvert > 0.5) e = 1.0 - e;
  vec4 s = texture(uTex, vUv);
  outColor = vec4(mix(s.rgb, vec3(e) * s.a, uAmount), s.a);
}`,
  wave: `${HEAD}
uniform float uAmount, uFreq, uTime;
void main() {
  vec2 off = vec2(sin(vUv.y * uFreq * 6.2832 + uTime * 6.2832), 0.0) * uAmount / uSize.x;
  outColor = texture(uTex, vUv + off);
}`,
  vhs: `${HEAD}
uniform float uAmount, uTime;
float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
void main() {
  float line = floor(vUv.y * uSize.y);
  float jitter = (hash(vec2(line, floor(uTime * 30.0))) - 0.5) * 0.004 * uAmount;
  vec2 uv = vUv + vec2(jitter, 0.0);
  vec4 c = texture(uTex, uv);
  float r = texture(uTex, uv + vec2(0.003 * uAmount, 0.0)).r;
  float b = texture(uTex, uv - vec2(0.003 * uAmount, 0.0)).b;
  vec3 col = vec3(r, c.g, b);
  col *= 1.0 - 0.15 * uAmount * step(0.5, fract(line * 0.5));
  col += (hash(vUv * uSize + uTime) - 0.5) * 0.12 * uAmount;
  col = mix(vec3(luma(col)), col, 1.0 - 0.3 * uAmount);
  outColor = vec4(clamp(col, 0.0, c.a), c.a);
}`,
  over: `${HEAD}
uniform sampler2D uOther;
void main() { vec4 top = texture(uOther, vUv); outColor = top + texture(uTex, vUv) * (1.0 - top.a); }`,
};
