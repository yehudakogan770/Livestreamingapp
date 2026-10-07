//! Green screen and light and color on the GPU: a port of the picture
//! processor's settings (`app/src/engine/chroma.ts`: `balanceGains`, the
//! uniforms its `draw` sets) for the engine's shader (`compose.wgsl`), which
//! applies them in the same order as the processor's fragment program —
//! blur or sharpness, the green screen on the colors as the camera saw them,
//! white balance, exposure, brightness, shadows and highlights, contrast,
//! gamma, saturation, black and white, then vignette and grain.
//!
//! Background removal and auto-framing need the person-finding model of the
//! web processor and stay out (the engine shows the picture without them).

use lumora_engine::adjust::{Adjust, Effect};
use lumora_engine::ChromaKey;

/// What the shader does to one picture (all off: [`Look::plain`]).
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Look {
    /// The green screen: color taken out, similarity, smoothness, spill (None: off).
    pub key: Option<([f32; 3], f32, f32, f32)>,
    pub exposure: f32,
    /// -1 – 1 (the settings' -100 – 100).
    pub brightness: f32,
    pub contrast: f32,
    pub highlights: f32,
    pub shadows: f32,
    pub gamma: f32,
    /// White balance gains.
    pub balance: [f32; 3],
    pub saturation: f32,
    /// 0 – 1.
    pub sharpness: f32,
    /// Effects, 0 – 1 (0: off).
    pub blur: f32,
    pub vignette: f32,
    pub black_white: f32,
    pub grain: f32,
}

/// White balance gains for a temperature (K) and tint (-100 – 100), as `balanceGains`.
pub fn balance_gains(temperature: f32, tint: f32) -> [f32; 3] {
    let k = ((temperature - 5600.0) / 3400.0).clamp(-1.0, 1.0);
    [1.0 + 0.2 * k, 1.0 - 0.15 * tint / 100.0, 1.0 - 0.2 * k]
}

/// `#rrggbb` as 0 – 1 (the processor's `hexToRgb`); green screen green when it isn't one.
fn rgb(hex: &str) -> [f32; 3] {
    let ok = hex.len() == 7
        && hex.starts_with('#')
        && hex.bytes().skip(1).all(|b| b.is_ascii_hexdigit());
    if !ok {
        return [0.0, 177.0 / 255.0, 64.0 / 255.0];
    }
    let byte = |i: usize| f32::from(u8::from_str_radix(&hex[i..i + 2], 16).unwrap_or(0)) / 255.0;
    [byte(1), byte(3), byte(5)]
}

fn finite(v: f32, d: f32) -> f32 {
    if v.is_finite() {
        v
    } else {
        d
    }
}

impl Look {
    /// Nothing changed.
    pub fn plain() -> Look {
        Look {
            key: None,
            exposure: 0.0,
            brightness: 0.0,
            contrast: 0.0,
            highlights: 0.0,
            shadows: 0.0,
            gamma: 1.0,
            balance: [1.0, 1.0, 1.0],
            saturation: 0.0,
            sharpness: 0.0,
            blur: 0.0,
            vignette: 0.0,
            black_white: 0.0,
            grain: 0.0,
        }
    }

    /// An input's green screen and light and color (None: the plain picture, nothing to do).
    pub fn of(key: &ChromaKey, a: &Adjust) -> Option<Look> {
        let effect = |e: &Effect| {
            if e.on {
                (finite(e.amount, 0.0) / 100.0).clamp(0.0, 1.0)
            } else {
                0.0
            }
        };
        let look = Look {
            key: key.enabled.then(|| {
                (
                    rgb(&key.color),
                    finite(key.similarity, 0.4).clamp(0.0, 1.0),
                    finite(key.smoothness, 0.08).clamp(0.0, 1.0),
                    finite(key.spill, 0.3).clamp(0.0, 1.0),
                )
            }),
            exposure: finite(a.exposure, 0.0).clamp(-3.0, 3.0),
            brightness: finite(a.brightness, 0.0) / 100.0,
            contrast: finite(a.contrast, 0.0) / 100.0,
            highlights: finite(a.highlights, 0.0) / 100.0,
            shadows: finite(a.shadows, 0.0) / 100.0,
            gamma: finite(a.gamma, 1.0).clamp(0.5, 2.0),
            balance: balance_gains(finite(a.temperature, 5600.0), finite(a.tint, 0.0)),
            saturation: finite(a.saturation, 0.0) / 100.0,
            sharpness: (finite(a.sharpness, 0.0) / 100.0).clamp(0.0, 1.0),
            blur: effect(&a.blur),
            vignette: effect(&a.vignette),
            black_white: effect(&a.black_white),
            grain: effect(&a.grain),
        };
        (look != Look::plain()).then_some(look)
    }

    /// The shader's six vec4s for it (see `compose.wgsl`, `Draw.look*`).
    pub fn uniforms(&self, time: f32) -> [[f32; 4]; 6] {
        let (kc, sim, smooth, spill) = self.key.unwrap_or(([0.0; 3], 0.0, 0.0, 0.0));
        [
            [
                1.0,
                f32::from(u8::from(self.key.is_some())),
                self.blur,
                self.sharpness,
            ],
            [kc[0], kc[1], kc[2], sim],
            [smooth, spill, self.exposure, self.brightness],
            [self.contrast, self.highlights, self.shadows, self.gamma],
            [
                self.balance[0],
                self.balance[1],
                self.balance[2],
                self.saturation,
            ],
            [self.vignette, self.black_white, self.grain, time],
        ]
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_plain_input_needs_no_processing() {
        assert_eq!(Look::of(&ChromaKey::default(), &Adjust::default()), None);
        // An effect switched off doesn't count, whatever its amount.
        let mut a = Adjust::default();
        a.vignette.amount = 80.0;
        assert_eq!(Look::of(&ChromaKey::default(), &a), None);
        a.vignette.on = true;
        assert_eq!(
            Look::of(&ChromaKey::default(), &a).map(|l| l.vignette),
            Some(0.8)
        );
    }

    #[test]
    fn settings_become_the_processors_values() {
        let key = ChromaKey {
            enabled: true,
            ..ChromaKey::default()
        };
        let a = Adjust {
            brightness: 50.0,
            contrast: -20.0,
            saturation: 100.0,
            temperature: 9000.0,
            tint: 100.0,
            ..Adjust::default()
        };
        let l = Look::of(&key, &a).unwrap();
        let (kc, sim, smooth, spill) = l.key.unwrap();
        assert!((kc[1] - 177.0 / 255.0).abs() < 1e-6 && kc[0] == 0.0);
        assert_eq!((sim, smooth, spill), (0.4, 0.08, 0.3));
        assert_eq!((l.brightness, l.contrast, l.saturation), (0.5, -0.2, 1.0));
        // balanceGains(9000, 100) = [1.2, 0.85, 0.8], as in chroma.ts.
        let b = l.balance;
        assert!(
            (b[0] - 1.2).abs() < 1e-6 && (b[1] - 0.85).abs() < 1e-6 && (b[2] - 0.8).abs() < 1e-6
        );
        assert_eq!(balance_gains(5600.0, 0.0), [1.0, 1.0, 1.0]);
        let u = l.uniforms(3.0);
        assert_eq!(u[0][..2], [1.0, 1.0]);
        assert_eq!(u[5][3], 3.0);
    }
}
