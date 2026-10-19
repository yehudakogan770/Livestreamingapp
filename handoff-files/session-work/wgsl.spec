@@@
  // the picture behind's shape (width / height), a desk in front, -, -
  bg1: vec4<f32>,
};
===
  // the picture behind's shape (width / height), a desk in front, -, -
  bg1: vec4<f32>,
  // An HDR window (present.rs): encoding (0 SDR as it is, 1 scRGB linear,
  // 2 HDR10 PQ), SDR white in nits, -, -
  hdr: vec4<f32>,
};

// The picture is SDR: sRGB-encoded BT.709 values (as the web canvases).
fn srgb_to_linear(c: vec3<f32>) -> vec3<f32> {
  let lo = c / 12.92;
  let hi = pow((c + 0.055) / 1.055, vec3<f32>(2.4));
  return select(hi, lo, c <= vec3<f32>(0.04045));
}

// SMPTE ST 2084 (PQ): absolute light (1.0 = 10 000 nits) to the signal.
fn pq_encode(l: vec3<f32>) -> vec3<f32> {
  let m1 = 0.1593017578125;
  let m2 = 78.84375;
  let c1 = 0.8359375;
  let c2 = 18.8515625;
  let c3 = 18.6875;
  let y = pow(clamp(l, vec3<f32>(0.0), vec3<f32>(1.0)), vec3<f32>(m1));
  return pow((c1 + c2 * y) / (1.0 + c3 * y), vec3<f32>(m2));
}

// SDR into an HDR window: SDR white at `white` nits (BT.2408's 203 by
// default), the colors kept (BT.709 inside BT.2020 for HDR10).
fn to_hdr(c: vec4<f32>, mode: f32, white: f32) -> vec4<f32> {
  let a = max(c.a, 1e-5);
  let lin = srgb_to_linear(clamp(c.rgb / a, vec3<f32>(0.0), vec3<f32>(1.0)));
  if (mode < 1.5) {
    // scRGB: 1.0 is 80 nits.
    return vec4<f32>(lin * (white / 80.0) * c.a, c.a);
  }
  let to2020 = mat3x3<f32>(
    vec3<f32>(0.6274, 0.0691, 0.0164),
    vec3<f32>(0.3293, 0.9195, 0.0880),
    vec3<f32>(0.0433, 0.0114, 0.8956),
  );
  let pq = pq_encode(to2020 * lin * (white / 10000.0));
  return vec4<f32>(pq * c.a, c.a);
}
@@@
  return c * (d.fx.x * a);
}
===
  let o = c * (d.fx.x * a);
  if (d.hdr.x > 0.5) {
    return to_hdr(o, d.hdr.x, d.hdr.y);
  }
  return o;
}
