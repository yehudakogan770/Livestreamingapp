//! 3D logo: a logo picture given depth, a bevel, a material and light, turning
//! (full spin, back and forth, or a gentle float). Used as an input on any
//! screen, and exported as a video by the control window.

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::visuals::SceneRef;

/// What the logo is made of.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub enum LogoMaterial {
    #[default]
    Metal,
    Glass,
    Gloss,
    Matte,
}

/// How it moves.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub enum LogoMotion {
    #[default]
    Spin,
    /// Back and forth.
    Swing,
    /// A gentle bob.
    Float,
}

/// Back and forth: what happens at each end.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub enum SwingEnds {
    #[default]
    Ease,
    Pause,
    Bounce,
}

/// Behind the logo.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub enum LogoBackground {
    /// See-through: whatever is behind shows (and exports keep it clear).
    #[default]
    Transparent,
    Colour,
    /// A stage visuals scene.
    Loop,
}

/// A 3D logo input.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", default)]
#[ts(export)]
pub struct Logo3d {
    /// The logo picture (PNG or SVG); empty: the event logo.
    pub path: String,
    /// Thickness, 0 – 60 (% of the logo's height / 2).
    pub depth: f32,
    /// Rounded edge, 0 – 20.
    pub bevel: f32,
    pub material: LogoMaterial,
    /// One colour for the whole logo; None: the logo's own colours.
    pub color: Option<String>,
    /// Where the light comes from, -180 – 180 degrees.
    pub light_angle: f32,
    /// 0 – 1.
    pub light_strength: f32,
    pub motion: LogoMotion,
    /// Back and forth: how far each way, 10 – 90 degrees.
    pub swing: f32,
    pub ends: SwingEnds,
    /// Seconds for one turn (or one swing), 1.5 – 30.
    pub seconds: f32,
    /// The angle when still (and where a spin starts), -180 – 180.
    pub angle: f32,
    /// Moving; when off it stands at `angle`.
    pub playing: bool,
    /// Camera distance 0 (close, big) – 1 (far, small).
    pub camera: f32,
    pub background: LogoBackground,
    pub bg_color: String,
    pub bg_scene: SceneRef,
}

impl Default for Logo3d {
    fn default() -> Self {
        Logo3d {
            path: String::new(),
            depth: 24.0,
            bevel: 6.0,
            material: LogoMaterial::Metal,
            color: Some("#b8c0c8".to_owned()),
            light_angle: -40.0,
            light_strength: 0.7,
            motion: LogoMotion::Swing,
            swing: 35.0,
            ends: SwingEnds::Ease,
            seconds: 6.0,
            angle: 0.0,
            playing: true,
            camera: 0.4,
            background: LogoBackground::Transparent,
            bg_color: "#101216".to_owned(),
            bg_scene: SceneRef { bank: 0, scene: 0 },
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

fn is_color(c: &str) -> bool {
    c.len() == 7 && c.starts_with('#') && c[1..].chars().all(|c| c.is_ascii_hexdigit())
}

impl Logo3d {
    pub fn repair(&mut self) {
        let d = Logo3d::default();
        self.depth = fit(self.depth, 0.0, 60.0, d.depth);
        self.bevel = fit(self.bevel, 0.0, 20.0, d.bevel);
        if self.color.as_deref().is_some_and(|c| !is_color(c)) {
            self.color = d.color;
        }
        self.light_angle = fit(self.light_angle, -180.0, 180.0, d.light_angle);
        self.light_strength = fit(self.light_strength, 0.0, 1.0, d.light_strength);
        self.swing = fit(self.swing, 10.0, 90.0, d.swing);
        self.seconds = fit(self.seconds, 1.5, 30.0, d.seconds);
        self.angle = fit(self.angle, -180.0, 180.0, 0.0);
        self.camera = fit(self.camera, 0.0, 1.0, d.camera);
        if !is_color(&self.bg_color) {
            self.bg_color = d.bg_color;
        }
        if !self.bg_scene.exists() {
            self.bg_scene = d.bg_scene;
        }
    }
}
