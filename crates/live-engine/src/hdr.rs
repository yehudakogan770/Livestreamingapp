//! HDR inputs in an SDR show: a camera or video in HDR10 (PQ) or HLG,
//! BT.2020, is turned into the engine's SDR picture (BT.709, sRGB-encoded,
//! as the web canvases draw) — on the GPU (`hdr.wgsl`, once per new frame)
//! and here on the processor for the small frames the person-finding models
//! get. The two are the same maths (the GPU tests hold the shader to this).
//!
//! - The signal is decoded to light: PQ is absolute (SMPTE ST 2084); HLG is
//!   relative and shown as BT.2100's reference 1000-nit display (system gamma 1.2).
//! - BT.2020 colors into BT.709 (out-of-gamut colors clipped).
//! - SDR white is 203 nits (BT.2408): an HDR picture's diffuse white lands on
//!   the SDR picture's white, and what is brighter is rolled off smoothly
//!   into the top (a soft shoulder above 75 % instead of a hard clip:
//!   diffuse white lands at 96 % of the SDR signal).
//!
//! The other way (the SDR picture shown on an HDR display) is the output
//! window's job: [`crate::gpu::OutColor`].

use serde::Serialize;

/// An HDR picture's transfer function (BT.2100).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize)]
pub enum Hdr {
    /// Perceptual quantizer (HDR10).
    Pq,
    /// Hybrid log-gamma (broadcast HDR).
    Hlg,
}

impl Hdr {
    /// From FFmpeg's (or a file's) name for the transfer function.
    pub fn from_ffmpeg(trc: &str) -> Option<Hdr> {
        match trc.trim() {
            "smpte2084" => Some(Hdr::Pq),
            "arib-std-b67" => Some(Hdr::Hlg),
            _ => None,
        }
    }
}

/// Nits that are SDR white.
pub const SDR_WHITE: f32 = 203.0;
/// The display HLG is shown as (BT.2100's reference).
pub const HLG_PEAK: f32 = 1000.0;
/// Below this (of SDR white) the picture is as it is; above, highlights roll off.
pub const KNEE: f32 = 0.75;

/// PQ signal (0 – 1) to nits.
pub fn pq_to_nits(e: f32) -> f32 {
    let (m1, m2) = (0.159_301_76_f32, 78.843_75_f32);
    let (c1, c2, c3) = (0.835_937_5_f32, 18.851_562_f32, 18.687_5_f32);
    let p = e.clamp(0.0, 1.0).powf(1.0 / m2);
    10_000.0 * ((p - c1).max(0.0) / (c2 - c3 * p)).powf(1.0 / m1)
}

/// HLG signal (BT.2020 RGB, 0 – 1) to nits on the 1000-nit reference display.
pub fn hlg_to_nits(e: [f32; 3]) -> [f32; 3] {
    let (a, b, c) = (0.178_832_77_f32, 0.284_668_92_f32, 0.559_910_7_f32);
    let s = e.map(|x| {
        let x = x.clamp(0.0, 1.0);
        if x <= 0.5 {
            x * x / 3.0
        } else {
            (((x - c) / a).exp() + b) / 12.0
        }
    });
    let ys = 0.2627 * s[0] + 0.6780 * s[1] + 0.0593 * s[2];
    let k = HLG_PEAK * ys.max(1e-6).powf(0.2);
    s.map(|v| v * k)
}

/// Light in BT.2020 (nits) to the SDR picture's sRGB-encoded BT.709 (0 – 1).
pub fn to_sdr(nits2020: [f32; 3]) -> [f32; 3] {
    let [r, g, b] = nits2020;
    let mut x = [
        1.6605 * r - 0.5876 * g - 0.0728 * b,
        -0.1246 * r + 1.1329 * g - 0.0083 * b,
        -0.0182 * r - 0.1006 * g + 1.1187 * b,
    ]
    .map(|v| (v / SDR_WHITE).max(0.0));
    let l = 0.2126 * x[0] + 0.7152 * x[1] + 0.0722 * x[2];
    if l > KNEE {
        let t = KNEE + (1.0 - KNEE) * (1.0 - (-(l - KNEE) / (1.0 - KNEE)).exp());
        x = x.map(|v| v * t / l);
    }
    x.map(|v| {
        let v = v.min(1.0);
        if v <= 0.003_130_8 {
            v * 12.92
        } else {
            1.055 * v.powf(1.0 / 2.4) - 0.055
        }
    })
}

/// An HDR signal (BT.2020 RGB, 0 – 1) to the SDR picture (0 – 1).
pub fn signal_to_sdr(rgb: [f32; 3], hdr: Hdr) -> [f32; 3] {
    match hdr {
        Hdr::Pq => to_sdr(rgb.map(pq_to_nits)),
        Hdr::Hlg => to_sdr(hlg_to_nits(rgb)),
    }
}

/// P010's 16-bit words (10 bits at the top) to BT.2020 RGB signal (limited range).
pub fn p010_rgb(y: u16, u: u16, v: u16) -> [f32; 3] {
    let y = (f32::from(y >> 6) - 64.0) / 876.0;
    let (u, v) = (
        (f32::from(u >> 6) - 512.0) / 896.0,
        (f32::from(v >> 6) - 512.0) / 896.0,
    );
    [
        y + 1.4746 * v,
        y - 0.164_55 * u - 0.571_35 * v,
        y + 1.8814 * u,
    ]
}

/// An `x2bgr10le` word (R in the low 10 bits) to RGB signal (0 – 1).
pub fn rgb10(word: u32) -> [f32; 3] {
    [word & 0x3ff, (word >> 10) & 0x3ff, (word >> 20) & 0x3ff].map(|c| c as f32 / 1023.0)
}

/// 0 – 1 to a byte.
pub fn byte(v: f32) -> u8 {
    (v.clamp(0.0, 1.0) * 255.0).round() as u8
}

#[cfg(test)]
mod tests {
    use super::*;

    /// PQ's code for `nits`.
    fn pq(nits: f32) -> f32 {
        let (m1, m2) = (0.159_301_76_f32, 78.843_75_f32);
        let (c1, c2, c3) = (0.835_937_5_f32, 18.851_562_f32, 18.687_5_f32);
        let y = (nits / 10_000.0).powf(m1);
        ((c1 + c2 * y) / (1.0 + c3 * y)).powf(m2)
    }

    #[test]
    fn pq_decodes_to_the_nits_it_encodes() {
        for n in [0.1, 1.0, 100.0, 203.0, 1000.0, 4000.0] {
            let back = pq_to_nits(pq(n));
            assert!((back - n).abs() / n < 0.01, "{n} → {back}");
        }
        assert!((pq(203.0) - 0.58).abs() < 0.01, "203 nits is 58 % of PQ");
    }

    #[test]
    fn hdr_white_is_sdr_white_and_highlights_roll_off() {
        // Diffuse white (203 nits; gray in BT.2020 is gray in BT.709): nearly full white.
        let w = signal_to_sdr([pq(203.0); 3], Hdr::Pq);
        assert!(w.iter().all(|v| *v > 0.94), "{w:?}");
        // 1000-nit highlights: white, not beyond.
        let h = signal_to_sdr([pq(1000.0); 3], Hdr::Pq);
        assert!(h.iter().all(|v| *v <= 1.0 && *v > 0.99), "{h:?}");
        // Mid gray (about 20 % of white, 40 nits) stays where SDR keeps it.
        let g = signal_to_sdr([pq(40.6); 3], Hdr::Pq);
        assert!((g[0] - 0.48).abs() < 0.03, "{g:?}");
        // Brighter in, brighter out (no banding back down past the knee).
        let mut last = 0.0;
        for n in [50.0, 100.0, 150.0, 200.0, 400.0, 800.0, 4000.0] {
            let v = signal_to_sdr([pq(n); 3], Hdr::Pq)[0];
            assert!(
                v > last || (n > 800.0 && v >= last),
                "{n}: {v} after {last}"
            );
            last = v;
        }
        // Black is black.
        assert_eq!(signal_to_sdr([0.0; 3], Hdr::Pq), [0.0; 3]);
    }

    #[test]
    fn hlg_white_lands_near_sdr_white() {
        // HLG's 75 % signal is reference white (203 nits on a 1000-nit display).
        let w = hlg_to_nits([0.75; 3]);
        assert!((w[0] - 203.0).abs() < 10.0, "{w:?}");
        let s = signal_to_sdr([0.75; 3], Hdr::Hlg);
        assert!(s[0] > 0.93, "{s:?}");
    }

    #[test]
    fn bt2020_red_stays_red() {
        // Pure BT.2020 red is outside BT.709: clipped to red, not another hue.
        let r = signal_to_sdr([pq(100.0), 0.0, 0.0], Hdr::Pq);
        assert!(r[0] > 0.8 && r[1] < 0.05 && r[2] < 0.05, "{r:?}");
    }

    #[test]
    fn p010_and_rgb10_words() {
        // Limited-range white and black, gray chroma.
        let w = p010_rgb(940 << 6, 512 << 6, 512 << 6);
        assert!(w.iter().all(|v| (v - 1.0).abs() < 1e-3), "{w:?}");
        let b = p010_rgb(64 << 6, 512 << 6, 512 << 6);
        assert!(b.iter().all(|v| v.abs() < 1e-3), "{b:?}");
        assert_eq!(rgb10(1023 | (512 << 10)), [1.0, 512.0 / 1023.0, 0.0]);
        assert_eq!(Hdr::from_ffmpeg("smpte2084"), Some(Hdr::Pq));
        assert_eq!(Hdr::from_ffmpeg("arib-std-b67\n"), Some(Hdr::Hlg));
        assert_eq!(Hdr::from_ffmpeg("bt709"), None);
    }
}
