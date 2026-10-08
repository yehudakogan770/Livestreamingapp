//! Turning the card's pixels into what Lumora draws.
//!
//! Capture cards deliver 4:2:2 YUV: 8-bit UYVY (`2vuy`: U Y0 V Y1, two
//! pixels in four bytes) or 10-bit v210 (six pixels in four little-endian
//! 32-bit words, each holding three 10-bit values; rows padded to 128
//! bytes). Lumora's unified engine takes NV12 (4:2:0: the Y plane, then U
//! and V side by side for each 2 × 2 block) and makes it RGB on the GPU;
//! the Standard engine takes RGBA pictures. Both are made here on the
//! processor, one pass over the frame.
//!
//! Colors are limited range ("video levels", Y 16 – 235); RGB uses BT.709
//! for HD and up and BT.601 for standard definition, as broadcast does.

/// v210 → UYVY, one row: 10-bit values cut to 8 bits (rounded).
fn v210_row_to_uyvy(src: &[u8], width: usize, out: &mut [u8]) {
    let ten_to_eight = |v: u32| ((v + 2) >> 2).min(255) as u8;
    let mut vals = Vec::with_capacity(width * 2 + 6);
    for word in src.as_chunks::<4>().0 {
        if vals.len() >= width * 2 {
            break;
        }
        let w = u32::from_le_bytes([word[0], word[1], word[2], word[3]]);
        vals.push(w & 0x3FF);
        vals.push((w >> 10) & 0x3FF);
        vals.push((w >> 20) & 0x3FF);
    }
    // The values run Cb Y Cr Y Cb Y Cr Y…, which is UYVY's order already.
    for (o, v) in out.iter_mut().zip(vals.iter()) {
        *o = ten_to_eight(*v);
    }
}

/// A v210 frame as UYVY (`width` × `height`, rows `row_bytes` apart in `src`).
#[must_use]
pub fn v210_to_uyvy(src: &[u8], row_bytes: usize, width: u32, height: u32) -> Vec<u8> {
    let (w, h) = (width as usize, height as usize);
    let out_row = w.div_ceil(2) * 4;
    let mut out = vec![0u8; out_row * h];
    for y in 0..h {
        let Some(row) = src.get(y * row_bytes..(y + 1) * row_bytes) else {
            break;
        };
        v210_row_to_uyvy(
            row,
            w.div_ceil(2) * 2,
            &mut out[y * out_row..(y + 1) * out_row],
        );
    }
    out
}

/// Bytes of an NV12 frame (even sizes).
#[must_use]
pub const fn nv12_len(width: u32, height: u32) -> usize {
    let px = width as usize * height as usize;
    px + px / 2
}

/// UYVY → NV12 into `dst` (`nv12_len` bytes). Width and height must be
/// even. Each 2 × 2 block's color is the average of its two rows.
pub fn uyvy_to_nv12(src: &[u8], row_bytes: usize, width: u32, height: u32, dst: &mut [u8]) {
    let (w, h) = (width as usize, height as usize);
    if dst.len() < nv12_len(width, height) || w % 2 != 0 || h % 2 != 0 {
        return;
    }
    let (ys, uvs) = dst.split_at_mut(w * h);
    for y in (0..h).step_by(2) {
        let (Some(r0), Some(r1)) = (
            src.get(y * row_bytes..y * row_bytes + w * 2),
            src.get((y + 1) * row_bytes..(y + 1) * row_bytes + w * 2),
        ) else {
            return;
        };
        let uv = &mut uvs[(y / 2) * w..(y / 2) * w + w];
        for (i, ((a, b), c)) in r0
            .as_chunks::<4>()
            .0
            .iter()
            .zip(r1.as_chunks::<4>().0)
            .zip(uv.as_chunks_mut::<2>().0)
            .enumerate()
        {
            ys[y * w + i * 2] = a[1];
            ys[y * w + i * 2 + 1] = a[3];
            ys[(y + 1) * w + i * 2] = b[1];
            ys[(y + 1) * w + i * 2 + 1] = b[3];
            c[0] = (u16::from(a[0]) + u16::from(b[0])).div_ceil(2) as u8;
            c[1] = (u16::from(a[2]) + u16::from(b[2])).div_ceil(2) as u8;
        }
    }
}

/// The color matrix for a picture this tall (BT.709 for HD and up).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Matrix {
    Bt601,
    Bt709,
}

impl Matrix {
    #[must_use]
    pub fn for_height(h: u32) -> Matrix {
        if h >= 720 {
            Matrix::Bt709
        } else {
            Matrix::Bt601
        }
    }
}

/// One limited-range YUV pixel as RGB (8.8 fixed point, rounded).
#[must_use]
pub fn yuv_to_rgb(y: u8, u: u8, v: u8, m: Matrix) -> [u8; 3] {
    // 255/219 and the matrix's coefficients scaled by 255/224, ×256.
    let (rv, gu, gv, bu) = match m {
        Matrix::Bt709 => (459, 55, 136, 541),
        Matrix::Bt601 => (409, 100, 208, 516),
    };
    let c = (i32::from(y) - 16) * 298;
    let d = i32::from(u) - 128;
    let e = i32::from(v) - 128;
    let clamp = |x: i32| ((x + 128) >> 8).clamp(0, 255) as u8;
    [
        clamp(c + rv * e),
        clamp(c - gu * d - gv * e),
        clamp(c + bu * d),
    ]
}

/// UYVY → RGBA (opaque) into `dst` (`width × height × 4` bytes).
pub fn uyvy_to_rgba(src: &[u8], row_bytes: usize, width: u32, height: u32, dst: &mut [u8]) {
    let (w, h) = (width as usize, height as usize);
    if dst.len() < w * h * 4 {
        return;
    }
    let m = Matrix::for_height(height);
    for y in 0..h {
        let Some(row) = src.get(y * row_bytes..y * row_bytes + w.div_ceil(2) * 4) else {
            return;
        };
        let out = &mut dst[y * w * 4..(y + 1) * w * 4];
        for (x, q) in row.as_chunks::<4>().0.iter().enumerate() {
            let (u, y0, v, y1) = (q[0], q[1], q[2], q[3]);
            let p0 = yuv_to_rgb(y0, u, v, m);
            out[x * 8..x * 8 + 4].copy_from_slice(&[p0[0], p0[1], p0[2], 255]);
            if x * 2 + 1 < w {
                let p1 = yuv_to_rgb(y1, u, v, m);
                out[x * 8 + 4..x * 8 + 8].copy_from_slice(&[p1[0], p1[1], p1[2], 255]);
            }
        }
    }
}

/// BGRA (the card's RGB capture) → NV12, BT.709 or BT.601 by height, limited range.
pub fn bgra_to_nv12(src: &[u8], row_bytes: usize, width: u32, height: u32, dst: &mut [u8]) {
    let (w, h) = (width as usize, height as usize);
    if dst.len() < nv12_len(width, height) || w % 2 != 0 || h % 2 != 0 {
        return;
    }
    // Y = 16 + 219·(kr R + kg G + kb B)/255, U and V likewise (×256).
    let (yr, yg, yb, ur, ug, ub, vr, vg, vb) = match Matrix::for_height(height) {
        Matrix::Bt709 => (47, 157, 16, -26, -87, 112, 112, -102, -10),
        Matrix::Bt601 => (66, 129, 25, -38, -74, 112, 112, -94, -18),
    };
    let (ys, uvs) = dst.split_at_mut(w * h);
    let px = |x: usize, y: usize| -> [i32; 3] {
        let i = y * row_bytes + x * 4;
        src.get(i..i + 3).map_or([0; 3], |p| {
            [i32::from(p[2]), i32::from(p[1]), i32::from(p[0])]
        })
    };
    for y in 0..h {
        for x in 0..w {
            let [r, g, b] = px(x, y);
            ys[y * w + x] = (((yr * r + yg * g + yb * b + 128) >> 8) + 16).clamp(0, 255) as u8;
        }
    }
    for y in (0..h).step_by(2) {
        for x in (0..w).step_by(2) {
            let mut s = [0i32; 3];
            for (dx, dy) in [(0, 0), (1, 0), (0, 1), (1, 1)] {
                let p = px(x + dx, y + dy);
                for k in 0..3 {
                    s[k] += p[k];
                }
            }
            let [r, g, b] = s.map(|v| (v + 2) / 4);
            let i = (y / 2) * w + x;
            uvs[i] = (((ur * r + ug * g + ub * b + 128) >> 8) + 128).clamp(0, 255) as u8;
            uvs[i + 1] = (((vr * r + vg * g + vb * b + 128) >> 8) + 128).clamp(0, 255) as u8;
        }
    }
}

/// BGRA → RGBA (opaque: the card's alpha byte isn't a key).
pub fn bgra_to_rgba(src: &[u8], row_bytes: usize, width: u32, height: u32, dst: &mut [u8]) {
    let (w, h) = (width as usize, height as usize);
    if dst.len() < w * h * 4 {
        return;
    }
    for y in 0..h {
        let Some(row) = src.get(y * row_bytes..y * row_bytes + w * 4) else {
            return;
        };
        for (o, p) in dst[y * w * 4..(y + 1) * w * 4]
            .as_chunks_mut::<4>()
            .0
            .iter_mut()
            .zip(row.as_chunks::<4>().0)
        {
            o.copy_from_slice(&[p[2], p[1], p[0], 255]);
        }
    }
}

/// RGBA (or BGRA with `bgra`) → UYVY for playout, BT.709 or BT.601 by height.
pub fn rgba_to_uyvy(src: &[u8], width: u32, height: u32, bgra: bool, dst: &mut [u8]) {
    let (w, h) = (width as usize, height as usize);
    let row = w.div_ceil(2) * 4;
    if dst.len() < row * h || src.len() < w * h * 4 {
        return;
    }
    let (yr, yg, yb, ur, ug, ub, vr, vg, vb) = match Matrix::for_height(height) {
        Matrix::Bt709 => (47, 157, 16, -26, -87, 112, 112, -102, -10),
        Matrix::Bt601 => (66, 129, 25, -38, -74, 112, 112, -94, -18),
    };
    let rgb = |i: usize| -> [i32; 3] {
        let p = &src[i * 4..i * 4 + 3];
        if bgra {
            [i32::from(p[2]), i32::from(p[1]), i32::from(p[0])]
        } else {
            [i32::from(p[0]), i32::from(p[1]), i32::from(p[2])]
        }
    };
    let luma =
        |[r, g, b]: [i32; 3]| (((yr * r + yg * g + yb * b + 128) >> 8) + 16).clamp(0, 255) as u8;
    for y in 0..h {
        for x in (0..w).step_by(2) {
            let a = rgb(y * w + x);
            let b = if x + 1 < w { rgb(y * w + x + 1) } else { a };
            let [r, g, bl] = [
                (a[0] + b[0] + 1) / 2,
                (a[1] + b[1] + 1) / 2,
                (a[2] + b[2] + 1) / 2,
            ];
            let u = (((ur * r + ug * g + ub * bl + 128) >> 8) + 128).clamp(0, 255) as u8;
            let v = (((vr * r + vg * g + vb * bl + 128) >> 8) + 128).clamp(0, 255) as u8;
            let o = y * row + x * 2;
            dst[o..o + 4].copy_from_slice(&[u, luma(a), v, luma(b)]);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// One v210 group of six pixels from twelve 10-bit values (Cb Y Cr Y…).
    fn v210_group(v: [u32; 12]) -> Vec<u8> {
        let mut out = Vec::new();
        for t in v.chunks(3) {
            let w = t[0] | (t[1] << 10) | (t[2] << 20);
            out.extend_from_slice(&w.to_le_bytes());
        }
        out
    }

    /// Limited-range YUV (BT.709) of colors a test signal generator makes.
    const BARS_709: [(u8, u8, u8, [u8; 3]); 5] = [
        // Y, U, V, and the RGB they mean.
        (180, 128, 128, [191, 191, 191]), // 75% white
        (51, 109, 212, [191, 0, 0]),      // 75% red
        (63, 102, 240, [255, 0, 0]),      // 100% red
        (173, 42, 26, [0, 255, 0]),       // 100% green
        (32, 240, 118, [0, 0, 255]),      // 100% blue
    ];

    #[test]
    fn yuv_golden_values_become_the_right_rgb() {
        for (y, u, v, rgb) in BARS_709 {
            let got = yuv_to_rgb(y, u, v, Matrix::Bt709);
            for k in 0..3 {
                assert!(
                    got[k].abs_diff(rgb[k]) <= 2,
                    "{y},{u},{v} → {got:?}, want {rgb:?}"
                );
            }
        }
        assert_eq!(yuv_to_rgb(16, 128, 128, Matrix::Bt709), [0, 0, 0]);
        assert_eq!(yuv_to_rgb(235, 128, 128, Matrix::Bt709), [255, 255, 255]);
        // BT.601 red (SD).
        let r = yuv_to_rgb(65, 100, 212, Matrix::Bt601);
        assert!(r[0] > 185 && r[1] < 5 && r[2] < 5, "{r:?}");
        assert_eq!(Matrix::for_height(1080), Matrix::Bt709);
        assert_eq!(Matrix::for_height(486), Matrix::Bt601);
    }

    #[test]
    fn uyvy_becomes_nv12() {
        // 4 × 2: two rows of two UYVY pairs.
        let src = [
            10, 100, 20, 101, 30, 102, 40, 103, // row 0
            12, 110, 22, 111, 34, 112, 44, 113, // row 1
        ];
        let mut out = vec![0u8; nv12_len(4, 2)];
        uyvy_to_nv12(&src, 8, 4, 2, &mut out);
        assert_eq!(
            &out[..8],
            &[100, 101, 102, 103, 110, 111, 112, 113],
            "Y plane"
        );
        assert_eq!(
            &out[8..],
            &[11, 21, 32, 42],
            "U V of each block, rows averaged"
        );
    }

    #[test]
    fn uyvy_with_padded_rows_is_read_by_row_bytes() {
        let mut src = vec![0u8; 2 * 12];
        src[..4].copy_from_slice(&[128, 50, 128, 60]);
        src[12..16].copy_from_slice(&[128, 70, 128, 80]);
        let mut out = vec![0u8; nv12_len(2, 2)];
        uyvy_to_nv12(&src, 12, 2, 2, &mut out);
        assert_eq!(out, [50, 60, 70, 80, 128, 128]);
    }

    #[test]
    fn v210_becomes_uyvy_then_nv12_and_rgba() {
        // Six pixels: 10-bit white (940) and a 10-bit full red (Y 252, Cb 408, Cr 960).
        let g = v210_group([512, 940, 512, 940, 408, 252, 960, 252, 512, 940, 512, 940]);
        let mut row = g.clone();
        row.resize(128, 0);
        let src = [row.clone(), row].concat();
        let uyvy = v210_to_uyvy(&src, 128, 6, 2);
        assert_eq!(
            &uyvy[..12],
            &[128, 235, 128, 235, 102, 63, 240, 63, 128, 235, 128, 235]
        );
        let mut nv12 = vec![0u8; nv12_len(6, 2)];
        uyvy_to_nv12(&uyvy, 12, 6, 2, &mut nv12);
        assert_eq!(&nv12[..6], &[235, 235, 63, 63, 235, 235]);
        assert_eq!(&nv12[12..], &[128, 128, 102, 240, 128, 128]);
        let mut rgba = vec![0u8; 6 * 2 * 4];
        uyvy_to_rgba(&uyvy, 12, 6, 2, &mut rgba);
        assert_eq!(&rgba[..4], &[255, 255, 255, 255]);
        // HD bars use BT.709 only from 720 lines: this 2-line picture is SD,
        // so check the red with BT.601's numbers instead.
        let red = &rgba[8..12];
        assert!(red[0] > 170 && red[1] < 40 && red[3] == 255, "{red:?}");
    }

    #[test]
    fn hd_uyvy_becomes_rgba_with_bt709() {
        // A 2 × 720 picture of full green.
        let h = 720u32;
        let src: Vec<u8> = (0..h).flat_map(|_| [42u8, 173, 26, 173]).collect();
        let mut rgba = vec![0u8; 2 * h as usize * 4];
        uyvy_to_rgba(&src, 4, 2, h, &mut rgba);
        let p = &rgba[..4];
        assert!(
            p[0] <= 2 && p[1] >= 253 && p[2] <= 2 && p[3] == 255,
            "{p:?}"
        );
    }

    #[test]
    fn bgra_round_trips_through_nv12_and_uyvy() {
        // 2 × 2 of 75% red, as the card's BGRA (720 lines tall for BT.709).
        let (w, h) = (2u32, 720u32);
        let src: Vec<u8> = (0..w * h).flat_map(|_| [0u8, 0, 191, 255]).collect();
        let mut nv12 = vec![0u8; nv12_len(w, h)];
        bgra_to_nv12(&src, 8, w, h, &mut nv12);
        assert!(nv12[0].abs_diff(51) <= 1, "Y {}", nv12[0]);
        let uv = &nv12[(w * h) as usize..(w * h) as usize + 2];
        assert!(
            uv[0].abs_diff(109) <= 1 && uv[1].abs_diff(212) <= 1,
            "{uv:?}"
        );
        let mut rgba = vec![0u8; (w * h * 4) as usize];
        bgra_to_rgba(&src, 8, w, h, &mut rgba);
        assert_eq!(&rgba[..4], &[191, 0, 0, 255]);
        let mut uyvy = vec![0u8; (w * 2 * h) as usize];
        rgba_to_uyvy(&rgba, w, h, false, &mut uyvy);
        assert!(
            uyvy[1].abs_diff(51) <= 1 && uyvy[0].abs_diff(109) <= 1 && uyvy[2].abs_diff(212) <= 1
        );
        let mut back = vec![0u8; (w * h * 4) as usize];
        uyvy_to_rgba(&uyvy, 4, w, h, &mut back);
        assert!(
            back[0].abs_diff(191) <= 3 && back[1] <= 3 && back[2] <= 3,
            "{:?}",
            &back[..4]
        );
    }

    #[test]
    fn short_buffers_never_panic() {
        let mut out = vec![0u8; 3];
        uyvy_to_nv12(&[1, 2], 4, 4, 2, &mut out);
        uyvy_to_rgba(&[1, 2], 4, 4, 2, &mut out);
        bgra_to_nv12(&[1], 8, 2, 2, &mut out);
        let mut big = vec![0u8; nv12_len(4, 2)];
        uyvy_to_nv12(&[1, 2, 3], 8, 4, 2, &mut big);
        assert!(v210_to_uyvy(&[1, 2, 3], 128, 6, 2).len() == 24);
    }
}
