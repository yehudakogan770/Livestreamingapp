//! Decoded video arrives as NV12 (a full-size brightness plane and a
//! half-size interleaved color plane): the GPU turns it into RGB, so the CPU
//! never converts a pixel.

/// Which YUV→RGB matrix a file uses.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Matrix {
    Bt601,
    Bt709,
    Bt2020,
}

impl Matrix {
    /// The matrix to assume when the file doesn't say (as players do): SD is 601, HD and up 709.
    pub fn guess(height: u32) -> Self {
        if height >= 720 {
            Self::Bt709
        } else {
            Self::Bt601
        }
    }
    /// The red and blue weights (Kr, Kb).
    fn weights(self) -> (f32, f32) {
        match self {
            Self::Bt601 => (0.299, 0.114),
            Self::Bt709 => (0.2126, 0.0722),
            Self::Bt2020 => (0.2627, 0.0593),
        }
    }
}

/// Three rows of `[y, u, v, offset]`: rgb = M · (Y, Cb, Cr, 1), Y, Cb and Cr as stored (0–1).
pub fn yuv_to_rgb(matrix: Matrix, full_range: bool) -> [[f32; 4]; 3] {
    let (kr, kb) = matrix.weights();
    let kg = 1.0 - kr - kb;
    // Limited ("TV") range: Y from 16 to 235, colors from 16 to 240 (of 255).
    let (ys, yo, cs) = if full_range {
        (1.0, 0.0, 1.0)
    } else {
        (255.0 / 219.0, 16.0 / 255.0, 255.0 / 224.0)
    };
    let rv = 2.0 * (1.0 - kr) * cs;
    let bu = 2.0 * (1.0 - kb) * cs;
    let gu = -bu * kb / kg;
    let gv = -rv * kr / kg;
    // Each row: ys·Y + a·Cb + b·Cr + (−ys·yo − c·(a + b)); colors are centered on 128 of 255.
    let center = 128.0 / 255.0;
    let row = |a: f32, b: f32| [ys, a, b, -ys * yo - center * (a + b)];
    [row(0.0, rv), row(gu, gv), row(bu, 0.0)]
}

/// One pixel on the CPU (for tests), clamped as the GPU target clamps.
pub fn convert(m: &[[f32; 4]; 3], y: u8, u: u8, v: u8) -> [f32; 3] {
    let (y, u, v) = (
        f32::from(y) / 255.0,
        f32::from(u) / 255.0,
        f32::from(v) / 255.0,
    );
    m.map(|r| (r[0] * y + r[1] * u + r[2] * v + r[3]).clamp(0.0, 1.0))
}

/// The conversion program: reads the two planes and writes opaque RGBA. Row 0
/// of the result is the picture's top row, as WebGL's video textures are.
pub const NV12_WGSL: &str = r"
struct Conv { r: vec4<f32>, g: vec4<f32>, b: vec4<f32>, size: vec4<f32> };
@group(0) @binding(0) var<uniform> conv: Conv;
@group(0) @binding(1) var smp: sampler;
@group(0) @binding(2) var luma: texture_2d<f32>;
@group(0) @binding(3) var chroma: texture_2d<f32>;

@vertex
fn vs(@builtin(vertex_index) i: u32) -> @builtin(position) vec4<f32> {
  // One triangle over the whole target.
  let p = vec2<f32>(f32((i << 1u) & 2u), f32(i & 2u));
  return vec4<f32>(p * 2.0 - 1.0, 0.0, 1.0);
}

@fragment
fn fs(@builtin(position) pos: vec4<f32>) -> @location(0) vec4<f32> {
  let uv = pos.xy / conv.size.xy;
  let y = textureSampleLevel(luma, smp, uv, 0.0).r;
  let c = textureSampleLevel(chroma, smp, uv, 0.0).rg;
  let p = vec4<f32>(y, c.x, c.y, 1.0);
  return vec4<f32>(clamp(vec3<f32>(dot(conv.r, p), dot(conv.g, p), dot(conv.b, p)), vec3<f32>(0.0), vec3<f32>(1.0)), 1.0);
}
";

/// The bytes of an NV12 frame of this size (the editor's sizes are even).
pub fn nv12_len(w: u32, h: u32) -> usize {
    let (w, h) = (w as usize, h as usize);
    w * h + w.div_ceil(2) * 2 * h.div_ceil(2)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bt709_limited_matches_the_published_numbers() {
        let m = yuv_to_rgb(Matrix::Bt709, false);
        let near = |a: f32, b: f32| (a - b).abs() < 2e-4;
        assert!(near(m[0][0], 1.164_383));
        assert!(near(m[0][2], 1.792_741));
        assert!(near(m[1][1], -0.213_249));
        assert!(near(m[1][2], -0.532_909));
        assert!(near(m[2][1], 2.112_402));
        assert!(near(m[0][1], 0.0) && near(m[2][2], 0.0));
    }

    #[test]
    fn bt601_limited_matches_the_published_numbers() {
        let m = yuv_to_rgb(Matrix::Bt601, false);
        let near = |a: f32, b: f32| (a - b).abs() < 2e-4;
        assert!(near(m[0][2], 1.596_027));
        assert!(near(m[1][1], -0.391_762));
        assert!(near(m[1][2], -0.812_968));
        assert!(near(m[2][1], 2.017_232));
    }

    #[test]
    fn black_white_and_gray_stay_neutral() {
        for (mat, full) in [
            (Matrix::Bt601, false),
            (Matrix::Bt709, false),
            (Matrix::Bt709, true),
            (Matrix::Bt2020, false),
        ] {
            let m = yuv_to_rgb(mat, full);
            let (lo, hi) = if full { (0, 255) } else { (16, 235) };
            let black = convert(&m, lo, 128, 128);
            let white = convert(&m, hi, 128, 128);
            assert!(
                black.iter().all(|v| v.abs() < 0.003),
                "{mat:?} black {black:?}"
            );
            assert!(
                white.iter().all(|v| (v - 1.0).abs() < 0.003),
                "{mat:?} white {white:?}"
            );
            let gray = convert(&m, 126, 128, 128);
            assert!((gray[0] - gray[1]).abs() < 0.003 && (gray[1] - gray[2]).abs() < 0.003);
        }
    }

    #[test]
    fn primaries_come_out_right() {
        // 709 limited-range pure red is Y 63, Cb 102, Cr 240.
        let m = yuv_to_rgb(Matrix::Bt709, false);
        let red = convert(&m, 63, 102, 240);
        assert!(red[0] > 0.98 && red[1] < 0.02 && red[2] < 0.02, "{red:?}");
        // 601 limited-range pure blue is Y 41, Cb 240, Cr 110.
        let m = yuv_to_rgb(Matrix::Bt601, false);
        let blue = convert(&m, 41, 240, 110);
        assert!(
            blue[2] > 0.98 && blue[0] < 0.03 && blue[1] < 0.03,
            "{blue:?}"
        );
    }

    #[test]
    fn guesses_by_size_and_counts_bytes() {
        assert_eq!(Matrix::guess(480), Matrix::Bt601);
        assert_eq!(Matrix::guess(1080), Matrix::Bt709);
        assert_eq!(nv12_len(1920, 1080), 1920 * 1080 * 3 / 2);
        assert_eq!(nv12_len(4, 2), 8 + 4);
    }

    #[test]
    fn the_conversion_program_is_valid() {
        let m = naga::front::wgsl::parse_str(NV12_WGSL).unwrap();
        naga::valid::Validator::new(
            naga::valid::ValidationFlags::all(),
            naga::valid::Capabilities::empty(),
        )
        .validate(&m)
        .unwrap();
    }
}
