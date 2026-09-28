//! Overlays: up to four inputs drawn on top of what is on air (a logo in the
//! corner, a lower third, picture-in-picture, confetti). Each channel has
//! its input, its box on the screen, how it comes in and goes out, and the
//! screens it goes on.

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::model::{Millis, ScreenId, SourceId};

/// Overlay channels (buttons 1 – 4).
pub const CHANNELS: usize = 4;
/// Longest in/out animation.
pub const MAX_OVERLAY_ANIM_MS: u32 = 5000;
/// Longest auto-hide.
pub const MAX_AUTO_HIDE_MS: u32 = 10 * 60 * 1000;

/// Where the overlay sits, in % of the frame (0 – 100).
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", default)]
#[ts(export)]
pub struct Frame {
    pub x: f32,
    pub y: f32,
    pub w: f32,
    pub h: f32,
}

impl Default for Frame {
    /// The whole screen.
    fn default() -> Self {
        Frame {
            x: 0.0,
            y: 0.0,
            w: 100.0,
            h: 100.0,
        }
    }
}

impl Frame {
    /// Inside the screen, at least 1% big.
    #[must_use]
    pub fn clamped(self) -> Frame {
        let fix = |v: f32, d: f32| if v.is_finite() { v } else { d };
        let w = fix(self.w, 100.0).clamp(1.0, 100.0);
        let h = fix(self.h, 100.0).clamp(1.0, 100.0);
        Frame {
            x: fix(self.x, 0.0).clamp(0.0, 100.0 - w),
            y: fix(self.y, 0.0).clamp(0.0, 100.0 - h),
            w,
            h,
        }
    }
}

/// How an overlay comes in or goes out.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub enum OverlayAnim {
    Cut,
    #[default]
    Fade,
    SlideLeft,
    SlideRight,
    SlideUp,
    Zoom,
    Wipe,
}

/// One overlay channel.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", default)]
#[ts(export)]
pub struct Overlay {
    pub source_id: Option<SourceId>,
    pub frame: Frame,
    /// 0.0 – 1.0
    pub opacity: f32,
    pub anim_in: OverlayAnim,
    pub anim_out: OverlayAnim,
    pub anim_ms: u32,
    /// Goes off by itself this long after coming on (None: stays).
    #[ts(type = "number | null")]
    pub auto_hide_ms: Option<u32>,
    /// The screens it goes on (Live and/or Back; never the Monitor).
    pub screens: Vec<ScreenId>,
    /// On air now.
    pub on: bool,
    /// Shown on the Next monitors, to set it up before it goes on air.
    pub in_next: bool,
    /// When it last came on or went off (for its animation and auto-hide).
    #[ts(type = "number")]
    pub changed_at: Millis,
}

impl Default for Overlay {
    fn default() -> Self {
        Overlay {
            source_id: None,
            frame: Frame::default(),
            opacity: 1.0,
            anim_in: OverlayAnim::Fade,
            anim_out: OverlayAnim::Fade,
            anim_ms: 500,
            auto_hide_ms: None,
            screens: vec![ScreenId::Live],
            on: false,
            in_next: false,
            changed_at: 0,
        }
    }
}

impl Overlay {
    /// Put it on or take it off (once).
    pub fn set_on(&mut self, on: bool, now: Millis) {
        if self.on != on {
            self.on = on;
            self.changed_at = now;
        }
    }

    /// Time for it to go off by itself.
    pub fn due(&self, now: Millis) -> bool {
        self.on
            && self
                .auto_hide_ms
                .is_some_and(|ms| now >= self.changed_at.saturating_add(u64::from(ms)))
    }

    /// Keep settings in range.
    pub fn repair(&mut self) {
        self.frame = self.frame.clamped();
        self.opacity = if self.opacity.is_finite() {
            self.opacity.clamp(0.0, 1.0)
        } else {
            1.0
        };
        self.anim_ms = self.anim_ms.min(MAX_OVERLAY_ANIM_MS);
        self.auto_hide_ms = self.auto_hide_ms.map(|ms| ms.clamp(500, MAX_AUTO_HIDE_MS));
        self.screens.retain(|s| *s != ScreenId::Monitor);
        self.screens.dedup();
        if self.source_id.is_none() {
            self.on = false;
            self.in_next = false;
        }
    }
}

/// Changes to an overlay channel's settings. Fields left out stay as they are.
/// (Its input is chosen with `SetOverlaySource`.)
#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct OverlayPatch {
    #[serde(default)]
    #[ts(optional)]
    pub frame: Option<Frame>,
    #[serde(default)]
    #[ts(optional)]
    pub opacity: Option<f32>,
    #[serde(default)]
    #[ts(optional)]
    pub anim_in: Option<OverlayAnim>,
    #[serde(default)]
    #[ts(optional)]
    pub anim_out: Option<OverlayAnim>,
    #[serde(default)]
    #[ts(optional)]
    pub anim_ms: Option<u32>,
    /// `0` turns auto-hide off.
    #[serde(default)]
    #[ts(optional)]
    pub auto_hide_ms: Option<u32>,
    #[serde(default)]
    #[ts(optional)]
    pub screens: Option<Vec<ScreenId>>,
}

/// Four empty channels.
pub fn channels() -> Vec<Overlay> {
    vec![Overlay::default(); CHANNELS]
}
