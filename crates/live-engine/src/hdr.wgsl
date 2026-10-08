// An HDR input's frame (PQ or HLG, BT.2020) made into the SDR picture the
// compositor draws from, once per new frame on the GPU — the same maths as
// `hdr.rs` (which the tests hold this to): decode the signal to light, take
// it into BT.709, place SDR white at 203 nits and roll the highlights off
// into it, then sRGB-encode.
//
// Files arrive as 10-bit RGB (FFmpeg's x2bgr10le, read as Rgb10a2Unorm);
// cameras as P010 (10-bit Y, then interleaved U and V, in 16-bit words).

@group(0) @binding(0) var rgb_tex: texture_2d<f32>;
@group(0) @binding(1) var y_tex: texture_2d<u32>;
@group(0) @binding(2) var uv_tex: texture_2d<u32>;

@vertex
fn vs(@builtin(vertex_index) i: u32) -> @builtin(position) vec4<f32> {
  let t = vec2<f32>(f32(i & 1u), f32((i >> 1u) & 1u));
  return vec4<f32>(t.x * 2.0 - 1.0, 1.0 - t.y * 2.0, 0.0, 1.0);
}

const SDR_WHITE: f32 = 203.0;
const PEAK: f32 = 1000.0;
const KNEE: f32 = 0.75;

fn pq_to_nits(e: vec3<f32>) -> vec3<f32> {
  let m1 = 0.1593017578125;
  let m2 = 78.84375;
  let c1 = 0.8359375;
  let c2 = 18.8515625;
  let c3 = 18.6875;
  let p = pow(clamp(e, vec3<f32>(0.0), vec3<f32>(1.0)), vec3<f32>(1.0 / m2));
  return 10000.0 * pow(max(p - c1, vec3<f32>(0.0)) / (c2 - c3 * p), vec3<f32>(1.0 / m1));
}

fn hlg_to_nits(e: vec3<f32>) -> vec3<f32> {
  let a = 0.17883277;
  let b = 0.28466892;
  let c = 0.55991073;
  let x = clamp(e, vec3<f32>(0.0), vec3<f32>(1.0));
  let lo = x * x / 3.0;
  let hi = (exp((x - c) / a) + b) / 12.0;
  let s = select(hi, lo, x <= vec3<f32>(0.5));
  // The reference OOTF for a 1000-nit display (system gamma 1.2).
  let ys = dot(s, vec3<f32>(0.2627, 0.6780, 0.0593));
  return PEAK * pow(max(ys, 1e-6), 0.2) * s;
}

fn to_sdr(nits2020: vec3<f32>) -> vec4<f32> {
  let to709 = mat3x3<f32>(
    vec3<f32>(1.6605, -0.1246, -0.0182),
    vec3<f32>(-0.5876, 1.1329, -0.1006),
    vec3<f32>(-0.0728, -0.0083, 1.1187),
  );
  var x = max(to709 * nits2020 / SDR_WHITE, vec3<f32>(0.0));
  let l = dot(x, vec3<f32>(0.2126, 0.7152, 0.0722));
  if (l > KNEE) {
    let t = KNEE + (1.0 - KNEE) * (1.0 - exp(-(l - KNEE) / (1.0 - KNEE)));
    x *= t / l;
  }
  x = min(x, vec3<f32>(1.0));
  let lo = x * 12.92;
  let hi = 1.055 * pow(x, vec3<f32>(1.0 / 2.4)) - 0.055;
  return vec4<f32>(select(hi, lo, x <= vec3<f32>(0.0031308)), 1.0);
}

fn rgb10(p: vec4<f32>) -> vec3<f32> {
  return textureLoad(rgb_tex, vec2<i32>(p.xy), 0).rgb;
}

// BT.2020 (non-constant luminance), limited range, 10 bits in the top of 16.
fn p010(p: vec4<f32>) -> vec3<f32> {
  let c = vec2<i32>(p.xy);
  let y = (f32(textureLoad(y_tex, c, 0).r >> 6u) - 64.0) / 876.0;
  let uv = (vec2<f32>(textureLoad(uv_tex, c / 2, 0).rg >> vec2<u32>(6u)) - 512.0) / 896.0;
  return vec3<f32>(y + 1.4746 * uv.y, y - 0.16455 * uv.x - 0.57135 * uv.y, y + 1.8814 * uv.x);
}

@fragment
fn fs_rgb10_pq(@builtin(position) p: vec4<f32>) -> @location(0) vec4<f32> {
  return to_sdr(pq_to_nits(rgb10(p)));
}

@fragment
fn fs_rgb10_hlg(@builtin(position) p: vec4<f32>) -> @location(0) vec4<f32> {
  return to_sdr(hlg_to_nits(rgb10(p)));
}

@fragment
fn fs_p010_pq(@builtin(position) p: vec4<f32>) -> @location(0) vec4<f32> {
  return to_sdr(pq_to_nits(p010(p)));
}

@fragment
fn fs_p010_hlg(@builtin(position) p: vec4<f32>) -> @location(0) vec4<f32> {
  return to_sdr(hlg_to_nits(p010(p)));
}
