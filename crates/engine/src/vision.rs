//! Picture smarts that run on the operator's computer, offline: taking away
//! the background without a green screen, and auto-framing (a wide camera
//! that zooms in on and follows the people in it).

use serde::{Deserialize, Serialize};
use ts_rs::TS;

fn fit(v: f32, lo: f32, hi: f32, d: f32) -> f32 {
    if v.is_finite() {
        v.clamp(lo, hi)
    } else {
        d
    }
}

/// What happens to the background behind the people (no green screen needed).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub enum BackgroundMode {
    /// Left as it is.
    #[default]
    Keep,
    /// Softly blurred, like a portrait photo.
    Blur,
    /// Taken away, so what is behind the input shows (like a green screen).
    Remove,
    /// Swapped for a picture.
    Picture,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", default)]
#[ts(export)]
pub struct Background {
    pub mode: BackgroundMode,
    /// How strong the blur is, 0 – 1.
    pub blur: f32,
    /// The picture behind the people (mode Picture).
    #[ts(optional = nullable)]
    pub picture: Option<String>,
    /// How soft the edge around people is, 0 – 1.
    pub edge: f32,
}

impl Default for Background {
    fn default() -> Self {
        Background {
            mode: BackgroundMode::Keep,
            blur: 0.6,
            picture: None,
            edge: 0.4,
        }
    }
}

impl Background {
    pub fn repair(&mut self) {
        let d = Background::default();
        self.blur = fit(self.blur, 0.0, 1.0, d.blur);
        self.edge = fit(self.edge, 0.0, 1.0, d.edge);
        self.picture = self.picture.take().filter(|p| !p.trim().is_empty());
        if self.mode == BackgroundMode::Picture && self.picture.is_none() {
            self.mode = BackgroundMode::Remove;
        }
    }

    pub fn on(&self) -> bool {
        self.mode != BackgroundMode::Keep
    }
}

/// Who auto-framing keeps in the shot.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub enum FrameWho {
    /// Everyone in the picture.
    #[default]
    Everyone,
    /// The main person (the biggest, nearest one).
    Main,
}

/// A wide camera that zooms in on and follows the people in it.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", default)]
#[ts(export)]
pub struct AutoFrame {
    pub enabled: bool,
    pub who: FrameWho,
    /// How close the shot is, 0 (loose, lots of room) – 1 (tight).
    pub tightness: f32,
    /// How quickly it moves to follow, 0 (slow and calm) – 1 (quick).
    pub speed: f32,
    /// Never zoom in further than the camera stays sharp.
    pub keep_sharp: bool,
}

impl Default for AutoFrame {
    fn default() -> Self {
        AutoFrame {
            enabled: false,
            who: FrameWho::Everyone,
            tightness: 0.5,
            speed: 0.4,
            keep_sharp: true,
        }
    }
}

impl AutoFrame {
    pub fn repair(&mut self) {
        let d = AutoFrame::default();
        self.tightness = fit(self.tightness, 0.0, 1.0, d.tightness);
        self.speed = fit(self.speed, 0.0, 1.0, d.speed);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_picture_background_needs_a_picture() {
        let mut b = Background {
            mode: BackgroundMode::Picture,
            picture: Some("  ".into()),
            blur: f32::NAN,
            ..Background::default()
        };
        b.repair();
        assert_eq!(b.mode, BackgroundMode::Remove);
        assert!((b.blur - 0.6).abs() < f32::EPSILON);
    }

    #[test]
    fn settings_stay_in_range() {
        let mut f = AutoFrame {
            tightness: 4.0,
            speed: -1.0,
            ..AutoFrame::default()
        };
        f.repair();
        assert!((f.tightness - 1.0).abs() < f32::EPSILON);
        assert!(f.speed.abs() < f32::EPSILON);
    }
}
