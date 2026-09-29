//! The event itself: its name, its logo, and what the screens show in an
//! emergency. Asked for when an event is set up.

use serde::{Deserialize, Serialize};
use ts_rs::TS;

/// Longest event name.
pub const MAX_EVENT_NAME_LEN: usize = 80;

/// What a screen shows when it has to show "nothing".
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize, TS)]
#[serde(rename_all = "lowercase")]
#[ts(export)]
pub enum SafeScreen {
    #[default]
    Black,
    /// The event logo on black (black if there is no logo).
    Logo,
}

/// The event and its emergency plan.
#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", default)]
#[ts(export)]
pub struct EventInfo {
    pub name: String,
    /// Picture file of the event logo.
    pub logo: Option<String>,
    /// What a screen shows when a camera or video on it stops working.
    pub on_failure: SafeScreen,
    /// What the Live and Back screens show while PANIC is on.
    pub panic_shows: SafeScreen,
    /// The setup questions have been answered (or skipped).
    pub set_up: bool,
    /// The event's look: colours and font for every title.
    pub brand: Brand,
}

/// The event's look, applied to all titles, songs and scoreboards at once.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", default)]
#[ts(export)]
pub struct Brand {
    pub font: String,
    pub text_color: String,
    /// Bars, lines and name boxes.
    pub accent: String,
    pub box_color: String,
    /// 0 – 100.
    pub box_opacity: u32,
    pub design: crate::text::TextDesign,
}

impl Default for Brand {
    fn default() -> Self {
        Brand {
            font: "Segoe UI".to_owned(),
            text_color: "#ffffff".to_owned(),
            accent: "#2f80ed".to_owned(),
            box_color: "#101216".to_owned(),
            box_opacity: 80,
            design: crate::text::TextDesign::Box,
        }
    }
}

fn is_color(c: &str) -> bool {
    c.len() == 7 && c.starts_with('#') && c[1..].chars().all(|c| c.is_ascii_hexdigit())
}

impl Brand {
    #[must_use]
    pub fn cleaned(mut self) -> Self {
        let d = Brand::default();
        self.font = self.font.trim().chars().take(60).collect();
        if self.font.is_empty() {
            self.font = d.font;
        }
        for (c, f) in [
            (&mut self.text_color, d.text_color),
            (&mut self.accent, d.accent),
            (&mut self.box_color, d.box_color),
        ] {
            if !is_color(c) {
                *c = f;
            }
        }
        self.box_opacity = self.box_opacity.min(100);
        self
    }

    /// Put the look on a title's style.
    pub fn apply_to(&self, s: &mut crate::text::TextStyle) {
        s.font.clone_from(&self.font);
        s.color.clone_from(&self.text_color);
        s.accent.clone_from(&self.accent);
        s.box_color.clone_from(&self.box_color);
        #[allow(clippy::cast_precision_loss)]
        {
            s.box_opacity = self.box_opacity as f32 / 100.0;
        }
        s.design = self.design;
    }
}

/// Changes to the event. Fields left out stay as they are.
#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct EventPatch {
    #[serde(default)]
    #[ts(optional)]
    pub name: Option<String>,
    /// A picture path, or "" to remove the logo.
    #[serde(default)]
    #[ts(optional)]
    pub logo: Option<String>,
    #[serde(default)]
    #[ts(optional)]
    pub on_failure: Option<SafeScreen>,
    #[serde(default)]
    #[ts(optional)]
    pub panic_shows: Option<SafeScreen>,
    #[serde(default)]
    #[ts(optional)]
    pub set_up: Option<bool>,
}
