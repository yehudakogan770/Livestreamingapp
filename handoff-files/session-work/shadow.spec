@@@
  var c: vec4<f32>;
  if (d.misc.w > 0.5 && d.misc.w < 1.5) {
    c = d.color;
  } else {
===
  var c: vec4<f32>;
  if (d.misc.w > 0.5 && d.misc.w < 1.5) {
    c = d.color;
  } else if (d.misc.w > 3.5) {
    // A soft shadow (canvas `shadowBlur`): the color, as much as a
    // Gaussian-blurred rectangle (`cut`: x0, y0, x1, y1; `bg1.xy`: sigma) covers here.
    c = d.color * soft_rect(o, d.cut, d.bg1.xy);
  } else {
@@@
// SDR into an HDR window: SDR white at `white` nits (BT.2408's 203 by
===
// The error function (Abramowitz and Stegun 7.1.26: within 1.5e-7).
fn erf_approx(x: f32) -> f32 {
  let a = abs(x);
  let t = 1.0 / (1.0 + 0.3275911 * a);
  let y = 1.0 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * exp(-a * a);
  return sign(x) * y;
}

// How much of rectangle `r` blurred by a Gaussian of `sg` (per axis) covers `o`.
fn soft_rect(o: vec2<f32>, r: vec4<f32>, sg: vec2<f32>) -> f32 {
  let k = 1.0 / (1.41421356 * max(sg, vec2<f32>(1e-6)));
  let ax = 0.5 * (erf_approx((o.x - r.x) * k.x) - erf_approx((o.x - r.z) * k.x));
  let ay = 0.5 * (erf_approx((o.y - r.y) * k.y) - erf_approx((o.y - r.w) * k.y));
  return ax * ay;
}

// SDR into an HDR window: SDR white at `white` nits (BT.2408's 203 by
