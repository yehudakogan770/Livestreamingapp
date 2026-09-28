//! Text and titles: a lower third, a big title, a scrolling ticker or a
//! full-screen message. A text input fills the frame with a transparent
//! background, so it works on its own (over black) and, most often, as an
//! overlay over what is on air.

use serde::{Deserialize, Serialize};
use ts_rs::TS;

/// Longest text (each line).
pub const MAX_TEXT_LEN: usize = 500;

/// Where the text sits and how it behaves.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub enum TextLayout {
    /// Name and title, low on the left.
    #[default]
    LowerThird,
    /// Big, in the middle.
    Title,
    /// One line scrolling along the bottom.
    Ticker,
    /// A message filling the screen.
    FullScreen,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub enum TextAlign {
    #[default]
    Left,
    Center,
    Right,
}

/// How the text looks. Sizes are in pixels of a 1920 × 1080 frame (they scale).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", default)]
#[ts(export)]
pub struct TextStyle {
    pub font: String,
    pub size: u32,
    /// 300 – 900.
    pub weight: u32,
    pub color: String,
    pub align: TextAlign,
    /// Outline width (0: none).
    pub outline: u32,
    pub outline_color: String,
    pub shadow: bool,
    /// A box behind the text.
    pub box_on: bool,
    pub box_color: String,
    /// 0.0 – 1.0
    pub box_opacity: f32,
    pub padding: u32,
    pub radius: u32,
    /// Line height, × the size.
    pub line_height: f32,
    /// Letter spacing in px.
    pub letter_spacing: f32,
    /// Ticker speed, px per second.
    pub speed: u32,
}

impl Default for TextStyle {
    fn default() -> Self {
        TextStyle {
            font: "Segoe UI".to_owned(),
            size: 54,
            weight: 600,
            color: "#ffffff".to_owned(),
            align: TextAlign::Left,
            outline: 0,
            outline_color: "#000000".to_owned(),
            shadow: true,
            box_on: true,
            box_color: "#101216".to_owned(),
            box_opacity: 0.8,
            padding: 24,
            radius: 6,
            line_height: 1.2,
            letter_spacing: 0.0,
            speed: 160,
        }
    }
}

/// A text input.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", default)]
#[ts(export)]
pub struct TextInput {
    pub layout: TextLayout,
    /// The main line (e.g. a name).
    pub text: String,
    /// The line under it (e.g. a title); empty for none.
    pub sub: String,
    pub style: TextStyle,
}

impl Default for TextInput {
    fn default() -> Self {
        TextInput {
            layout: TextLayout::LowerThird,
            text: "[Speaker name]".to_owned(),
            sub: "[Title]".to_owned(),
            style: TextStyle::default(),
        }
    }
}

fn is_color(c: &str) -> bool {
    c.len() == 7 && c.starts_with('#') && c[1..].chars().all(|c| c.is_ascii_hexdigit())
}

impl TextInput {
    /// Keep everything in range (and colours valid).
    pub fn repair(&mut self) {
        self.text = self.text.chars().take(MAX_TEXT_LEN).collect();
        self.sub = self.sub.chars().take(MAX_TEXT_LEN).collect();
        let d = TextStyle::default();
        let s = &mut self.style;
        if s.font.trim().is_empty() {
            s.font = d.font;
        }
        s.size = s.size.clamp(12, 400);
        s.weight = (s.weight.clamp(300, 900) / 100) * 100;
        s.outline = s.outline.min(20);
        s.padding = s.padding.min(120);
        s.radius = s.radius.min(60);
        s.speed = s.speed.clamp(20, 1000);
        s.box_opacity = if s.box_opacity.is_finite() {
            s.box_opacity.clamp(0.0, 1.0)
        } else {
            d.box_opacity
        };
        s.line_height = if s.line_height.is_finite() {
            s.line_height.clamp(0.8, 3.0)
        } else {
            d.line_height
        };
        s.letter_spacing = if s.letter_spacing.is_finite() {
            s.letter_spacing.clamp(-10.0, 40.0)
        } else {
            0.0
        };
        for (c, fallback) in [
            (&mut s.color, d.color),
            (&mut s.outline_color, d.outline_color),
            (&mut s.box_color, d.box_color),
        ] {
            if !is_color(c) {
                *c = fallback;
            }
        }
    }
}
