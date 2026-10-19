// HDR sequences (Rec. 2100): the film is made in the color space it is
// delivered in, PQ (HDR10) or HLG, with Rec. 2020 colors. Every picture is
// brought into that space as it is drawn: SDR pictures (Rec. 709 video,
// titles, graphics, colors) with their white at 203 nits (ITU-R BT.2408),
// HDR files as they are (PQ and HLG converted to each other when they
// differ). Effects and grades work on the HDR signal itself, as in an HDR
// timeline in a finishing suite. The viewer, the scopes and SDR exports see it
// tone-mapped to Rec. 709 (the exact signal goes to HDR exports).
import type { Sequence } from '../model/types';

/** A sequence's color space: Rec. 709 (SDR), or Rec. 2100 with PQ or HLG. */
export type ColorSpace = 'rec709' | 'pq' | 'hlg';
/** How a picture's brightness is coded. */
export type Transfer = 'sdr' | 'pq' | 'hlg';

export const isHdr = (s: Pick<Sequence, 'color'> | null | undefined): boolean => s?.color === 'pq' || s?.color === 'hlg';
export const spaceOf = (s: Pick<Sequence, 'color'> | null | undefined): ColorSpace => (s?.color === 'pq' || s?.color === 'hlg' ? s.color : 'rec709');
export const transferOf = (space: ColorSpace): Transfer => (space === 'rec709' ? 'sdr' : space);
export const TRANSFER_CODE: Record<Transfer, number> = { sdr: 0, pq: 1, hlg: 2 };

export const SPACE_NAMES: Record<ColorSpace, string> = {
  rec709: 'Rec. 709 (SDR)',
  pq: 'Rec. 2100 PQ (HDR10)',
  hlg: 'Rec. 2100 HLG',
};

/** SDR white in an HDR picture (nits). */
export const REF_WHITE = 203;
/** The HLG display the signal is made for (nits). */
export const HLG_PEAK = 1000;

// ---- PQ (SMPTE ST 2084) ----
const M1 = 2610 / 16384;
const M2 = (2523 / 4096) * 128;
const C1 = 3424 / 4096;
const C2 = (2413 / 4096) * 32;
const C3 = (2392 / 4096) * 32;

/** Nits → PQ code value (0–1). */
export function pqEncode(nits: number): number {
  const y = Math.max(0, nits) / 10000;
  const p = y ** M1;
  return ((C1 + C2 * p) / (1 + C3 * p)) ** M2;
}
/** PQ code value → nits. */
export function pqDecode(v: number): number {
  const p = Math.max(0, v) ** (1 / M2);
  return 10000 * (Math.max(0, p - C1) / (C2 - C3 * p)) ** (1 / M1);
}

// ---- HLG (ARIB STD-B67), for a 1000-nit display ----
const HA = 0.17883277;
const HB = 1 - 4 * HA;
const HC = 0.5 - HA * Math.log(4 * HA);
/** Scene light (0–1) → HLG code value. */
export const hlgOetf = (e: number): number => (e <= 1 / 12 ? Math.sqrt(3 * Math.max(0, e)) : HA * Math.log(12 * e - HB) + HC);
/** HLG code value → scene light (0–1). */
export const hlgInverseOetf = (v: number): number => (v <= 0.5 ? (Math.max(0, v) * Math.max(0, v)) / 3 : (Math.exp((v - HC) / HA) + HB) / 12);
const HLG_GAMMA = 1.2;
const LUMA_2020 = [0.2627, 0.678, 0.0593] as const;

/** HLG code values (Rec. 2020) → display light (nits) on the reference display. */
export function hlgToNits(rgb: [number, number, number]): [number, number, number] {
  const e = rgb.map(hlgInverseOetf) as [number, number, number];
  const ys = LUMA_2020[0] * e[0] + LUMA_2020[1] * e[1] + LUMA_2020[2] * e[2];
  const k = HLG_PEAK * Math.max(ys, 1e-9) ** (HLG_GAMMA - 1);
  return [e[0] * k, e[1] * k, e[2] * k];
}
/** Display light (nits, Rec. 2020) → HLG code values. */
export function nitsToHlg(nits: [number, number, number]): [number, number, number] {
  const yd = LUMA_2020[0] * nits[0] + LUMA_2020[1] * nits[1] + LUMA_2020[2] * nits[2];
  const ys = (Math.max(yd, 1e-9) / HLG_PEAK) ** (1 / HLG_GAMMA);
  const k = HLG_PEAK * ys ** (HLG_GAMMA - 1);
  return nits.map((n) => hlgOetf(n / k)) as [number, number, number];
}

// ---- Rec. 709 and Rec. 2020 colors (linear light) ----
export const M709_TO_2020 = [0.627404, 0.329283, 0.043313, 0.069097, 0.91954, 0.011362, 0.016391, 0.088013, 0.895595];
export const M2020_TO_709 = [1.660491, -0.587641, -0.07285, -0.124551, 1.1329, -0.008349, -0.018151, -0.100579, 1.11873];
const mul = (m: number[], v: [number, number, number]): [number, number, number] => [
  (m[0] as number) * v[0] + (m[1] as number) * v[1] + (m[2] as number) * v[2],
  (m[3] as number) * v[0] + (m[4] as number) * v[1] + (m[5] as number) * v[2],
  (m[6] as number) * v[0] + (m[7] as number) * v[1] + (m[8] as number) * v[2],
];

/** An SDR color (0–1, Rec. 709 coded) as the HDR space's code values. */
export function sdrToSpace(rgb: [number, number, number], space: ColorSpace): [number, number, number] {
  if (space === 'rec709') return rgb;
  const lin = rgb.map((v) => Math.max(0, v) ** 2.4) as [number, number, number];
  const nits = mul(M709_TO_2020, lin).map((v) => Math.max(0, v) * REF_WHITE) as [number, number, number];
  return space === 'pq' ? (nits.map(pqEncode) as [number, number, number]) : nitsToHlg(nits);
}

/** How much of the SDR range is kept as it is before highlights roll off. */
export const KNEE = 0.9;
/** Brightness above SDR white rolled off smoothly toward 1 (SDR white itself stays just under 1). */
export const rollOff = (l: number): number => (l <= KNEE ? l : KNEE + (1 - KNEE) * Math.tanh((l - KNEE) / (1 - KNEE)));

/** An HDR space's code values as an SDR (Rec. 709) color: what the viewer and SDR films show. */
export function spaceToSdr(rgb: [number, number, number], space: ColorSpace): [number, number, number] {
  if (space === 'rec709') return rgb;
  const nits = space === 'pq' ? (rgb.map(pqDecode) as [number, number, number]) : hlgToNits(rgb);
  const rel = mul(M2020_TO_709, nits.map((n) => n / REF_WHITE) as [number, number, number]).map((v) => Math.max(0, v)) as [number, number, number];
  const peak = Math.max(...rel, 1e-9);
  const k = rollOff(peak) / peak;
  return rel.map((v) => Math.min(1, v * k) ** (1 / 2.4)) as [number, number, number];
}

/** The same in GLSL (for the compositor's passes). */
export const HDR_GLSL = `
const float PQ_M1 = 0.1593017578125;
const float PQ_M2 = 78.84375;
const float PQ_C1 = 0.8359375;
const float PQ_C2 = 18.8515625;
const float PQ_C3 = 18.6875;
vec3 pqEncode(vec3 nits) {
  vec3 p = pow(max(nits, 0.0) / 10000.0, vec3(PQ_M1));
  return pow((PQ_C1 + PQ_C2 * p) / (1.0 + PQ_C3 * p), vec3(PQ_M2));
}
vec3 pqDecode(vec3 v) {
  vec3 p = pow(max(v, 0.0), vec3(1.0 / PQ_M2));
  return 10000.0 * pow(max(p - PQ_C1, 0.0) / (PQ_C2 - PQ_C3 * p), vec3(1.0 / PQ_M1));
}
const float HLG_A = 0.17883277;
const float HLG_B = 0.28466892;
const float HLG_C = 0.55991073;
float hlgOetf1(float e) { return e <= 1.0 / 12.0 ? sqrt(3.0 * max(e, 0.0)) : HLG_A * log(12.0 * e - HLG_B) + HLG_C; }
float hlgInv1(float v) { return v <= 0.5 ? max(v, 0.0) * max(v, 0.0) / 3.0 : (exp((v - HLG_C) / HLG_A) + HLG_B) / 12.0; }
const vec3 LUMA2020 = vec3(0.2627, 0.678, 0.0593);
vec3 hlgToNits(vec3 v) {
  vec3 e = vec3(hlgInv1(v.r), hlgInv1(v.g), hlgInv1(v.b));
  float ys = max(dot(LUMA2020, e), 1e-9);
  return e * ${HLG_PEAK.toFixed(1)} * pow(ys, ${(HLG_GAMMA - 1).toFixed(3)});
}
vec3 nitsToHlg(vec3 n) {
  float ys = pow(max(dot(LUMA2020, n), 1e-9) / ${HLG_PEAK.toFixed(1)}, ${(1 / HLG_GAMMA).toFixed(6)});
  vec3 e = n / (${HLG_PEAK.toFixed(1)} * pow(ys, ${(HLG_GAMMA - 1).toFixed(3)}));
  return vec3(hlgOetf1(e.r), hlgOetf1(e.g), hlgOetf1(e.b));
}
const mat3 M709_2020 = mat3(${M709_TO_2020.filter((_, i) => i % 3 === 0).join(', ')}, ${M709_TO_2020.filter((_, i) => i % 3 === 1).join(', ')}, ${M709_TO_2020.filter((_, i) => i % 3 === 2).join(', ')});
const mat3 M2020_709 = mat3(${M2020_TO_709.filter((_, i) => i % 3 === 0).join(', ')}, ${M2020_TO_709.filter((_, i) => i % 3 === 1).join(', ')}, ${M2020_TO_709.filter((_, i) => i % 3 === 2).join(', ')});
// Code values (0 SDR Rec. 709, 1 PQ, 2 HLG) to display light in nits, Rec. 2020.
vec3 toNits(vec3 c, int tf) {
  if (tf == 1) return pqDecode(c);
  if (tf == 2) return hlgToNits(c);
  return M709_2020 * pow(max(c, 0.0), vec3(2.4)) * ${REF_WHITE.toFixed(1)};
}
vec3 fromNits(vec3 n, int tf) {
  if (tf == 1) return pqEncode(n);
  if (tf == 2) return nitsToHlg(n);
  return pow(max(M2020_709 * (n / ${REF_WHITE.toFixed(1)}), 0.0), vec3(1.0 / 2.4));
}
float rollOff(float l) { return l <= ${KNEE.toFixed(3)} ? l : ${KNEE.toFixed(3)} + ${(1 - KNEE).toFixed(3)} * tanh((l - ${KNEE.toFixed(3)}) / ${(1 - KNEE).toFixed(3)}); }
// HDR code values to what an SDR screen shows (Rec. 709 coded).
vec3 toSdrScreen(vec3 c, int tf) {
  if (tf == 0) return c;
  vec3 rel = max(M2020_709 * (toNits(c, tf) / ${REF_WHITE.toFixed(1)}), 0.0);
  float peak = max(max(rel.r, rel.g), max(rel.b, 1e-9));
  return pow(min(rel * (rollOff(peak) / peak), 1.0), vec3(1.0 / 2.4));
}
`;

/** A layer's picture brought from its own coding into the sequence's (premultiplied in, premultiplied out). */
export const TO_SPACE_FS = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outColor;
uniform sampler2D uTex;
uniform int uFrom;
uniform int uTo;
${HDR_GLSL}
void main() {
  vec4 c = texture(uTex, vUv);
  if (c.a < 0.0001) { outColor = vec4(0.0); return; }
  vec3 s = c.rgb / c.a;
  vec3 o = uTo == 0 ? toSdrScreen(s, uFrom) : fromNits(toNits(s, uFrom), uTo);
  outColor = vec4(o * c.a, c.a);
}`;

/** The finished frame on the screen: over the background, then (HDR) tone-mapped for an SDR screen. */
export const SCREEN_FS = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outColor;
uniform sampler2D uTex;
uniform vec3 uBack;
uniform float uFlip;
uniform int uTf;
${HDR_GLSL}
void main() {
  vec2 uv = uFlip > 0.5 ? vec2(vUv.x, 1.0 - vUv.y) : vUv;
  vec4 c = texture(uTex, uv);
  outColor = vec4(toSdrScreen(c.rgb + uBack * (1.0 - c.a), uTf), 1.0);
}`;

/** A frame for reading back (flipped), in the sequence's space (uTf −1) or tone-mapped to SDR; straight color with \`uAlpha\`. */
export const READ_FS = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outColor;
uniform sampler2D uTex;
uniform vec3 uBack;
uniform float uAlpha;
uniform int uTf;
${HDR_GLSL}
void main() {
  vec4 c = texture(uTex, vec2(vUv.x, 1.0 - vUv.y));
  vec3 rgb = uAlpha > 0.5 ? (c.a > 0.0001 ? c.rgb / c.a : vec3(0.0)) : c.rgb + uBack * (1.0 - c.a);
  if (uTf >= 0) rgb = toSdrScreen(rgb, uTf);
  outColor = vec4(clamp(rgb, 0.0, 1.0), uAlpha > 0.5 ? c.a : 1.0);
}`;

/** The waveform's guide lines for a space: [code value, label]. */
export function scopeGuides(space: ColorSpace): [number, string][] {
  if (space === 'pq') return [0, 100, 203, 1000, 4000, 10000].map((n) => [n === 0 ? 0 : pqEncode(n), n === 0 ? '0' : n >= 1000 ? `${n / 1000}k` : String(n)]);
  if (space === 'hlg')
    return [0, 100, 203, 1000].map((n) => [n === 0 ? 0 : (nitsToHlg([n, n, n])[0] as number), n === 0 ? '0' : n >= 1000 ? `${n / 1000}k` : String(n)]);
  return [0, 25, 50, 75, 100].map((v) => [v / 100, String(v)]);
}

/** Luma weights for a space's scopes. */
export const lumaWeights = (space: ColorSpace): [number, number, number] => (space === 'rec709' ? [0.2126, 0.7152, 0.0722] : [0.2627, 0.678, 0.0593]);

/** The arguments FFmpeg needs to tag (and, for HEVC, carry the HDR10 details of) an HDR film. */
export function hdrTags(space: Exclude<ColorSpace, 'rec709'>, enc: string): string[] {
  const trc = space === 'pq' ? 'smpte2084' : 'arib-std-b67';
  const tags = ['-colorspace', 'bt2020nc', '-color_primaries', 'bt2020', '-color_trc', trc, '-color_range', 'tv'];
  if (enc === 'libx265') {
    const common = `colorprim=bt2020:transfer=${trc}:colormatrix=bt2020nc:range=limited:repeat-headers=1:log-level=error`;
    // HDR10: the mastering display (P3 primaries, 1000 nits) and light levels as most HDR10 films carry.
    const hdr10 =
      space === 'pq' ? ':hdr10=1:hdr10-opt=1:master-display=G(13250,34500)B(7500,3000)R(34000,16000)WP(15635,16450)L(10000000,50):max-cll=1000,400' : '';
    return [...tags, '-x265-params', common + hdr10];
  }
  return tags;
}
