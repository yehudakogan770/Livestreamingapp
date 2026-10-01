//! Picture adjustments for cameras, videos and pictures: light and color,
//! crop and position, and effects. Drawn on the graphics card, together with
//! the green screen, wherever the input is shown (and in the recording).

use serde::{Deserialize, Serialize};
use ts_rs::TS;

/// An effect that can be switched on, with how strong it is (0 – 100).
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", default)]
#[ts(export)]
pub struct Effect {
    pub on: bool,
    pub amount: f32,
}

impl Default for Effect {
    fn default() -> Self {
        Effect {
            on: false,
            amount: 30.0,
        }
    }
}

/// Everything that can be adjusted on a picture. The defaults change nothing.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", default)]
#[ts(export)]
#[allow(clippy::struct_excessive_bools)] // independent switches
pub struct Adjust {
    // Light
    /// -3 – 3 stops.
    pub exposure: f32,
    /// -100 – 100 (also contrast, highlights, shadows, tint, saturation).
    pub brightness: f32,
    pub contrast: f32,
    pub highlights: f32,
    pub shadows: f32,
    /// 0.5 – 2.
    pub gamma: f32,
    // Color
    /// White balance, 2500 – 9000 K; 5600 changes nothing, higher is warmer.
    pub temperature: f32,
    pub tint: f32,
    pub saturation: f32,
    /// 0 – 100.
    pub sharpness: f32,
    // Crop and position (crop in % of each side, 0 – 45)
    pub crop_left: f32,
    pub crop_right: f32,
    pub crop_top: f32,
    pub crop_bottom: f32,
    /// 100 – 400 %.
    pub zoom: f32,
    /// -100 – 100.
    pub pan_x: f32,
    pub pan_y: f32,
    /// -180 – 180 degrees.
    pub rotate: f32,
    pub flip_h: bool,
    pub flip_v: bool,
    // Effects
    pub blur: Effect,
    pub vignette: Effect,
    pub black_white: Effect,
    pub grain: Effect,
}

impl Default for Adjust {
    fn default() -> Self {
        Adjust {
            exposure: 0.0,
            brightness: 0.0,
            contrast: 0.0,
            highlights: 0.0,
            shadows: 0.0,
            gamma: 1.0,
            temperature: 5600.0,
            tint: 0.0,
            saturation: 0.0,
            sharpness: 0.0,
            crop_left: 0.0,
            crop_right: 0.0,
            crop_top: 0.0,
            crop_bottom: 0.0,
            zoom: 100.0,
            pan_x: 0.0,
            pan_y: 0.0,
            rotate: 0.0,
            flip_h: false,
            flip_v: false,
            blur: Effect::default(),
            vignette: Effect::default(),
            black_white: Effect {
                on: false,
                amount: 100.0,
            },
            grain: Effect::default(),
        }
    }
}

fn fit(v: f32, lo: f32, hi: f32, d: f32) -> f32 {
    if v.is_finite() {
        v.clamp(lo, hi)
    } else {
        d
    }
}

impl Effect {
    fn repair(&mut self, d: f32) {
        self.amount = fit(self.amount, 0.0, 100.0, d);
    }
}

impl Adjust {
    pub fn repair(&mut self) {
        let d = Adjust::default();
        self.exposure = fit(self.exposure, -3.0, 3.0, 0.0);
        for v in [
            &mut self.brightness,
            &mut self.contrast,
            &mut self.highlights,
            &mut self.shadows,
            &mut self.tint,
            &mut self.saturation,
            &mut self.pan_x,
            &mut self.pan_y,
        ] {
            *v = fit(*v, -100.0, 100.0, 0.0);
        }
        self.gamma = fit(self.gamma, 0.5, 2.0, 1.0);
        self.temperature = fit(self.temperature, 2500.0, 9000.0, d.temperature);
        self.sharpness = fit(self.sharpness, 0.0, 100.0, 0.0);
        for v in [
            &mut self.crop_left,
            &mut self.crop_right,
            &mut self.crop_top,
            &mut self.crop_bottom,
        ] {
            *v = fit(*v, 0.0, 45.0, 0.0);
        }
        self.zoom = fit(self.zoom, 100.0, 400.0, 100.0);
        self.rotate = fit(self.rotate, -180.0, 180.0, 0.0);
        self.blur.repair(30.0);
        self.vignette.repair(30.0);
        self.black_white.repair(100.0);
        self.grain.repair(30.0);
    }
}
