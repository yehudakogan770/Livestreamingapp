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

/// The design of the text's background.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub enum TextDesign {
    /// One box behind both lines.
    #[default]
    Box,
    /// A box with an accent-colored bar at its side.
    Bar,
    /// The name on the accent color, the title on the box color under it.
    Split,
    /// No box: an accent line between the two lines.
    Underline,
    /// A box fading from the accent color.
    Gradient,
    /// Frosted glass.
    Glass,
}

/// How a title comes on (when it builds on).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub enum TextEntrance {
    /// The box opens, then the words rise in.
    #[default]
    Build,
    Fade,
    /// Slides in from its side.
    Slide,
    /// Rises up from below.
    Rise,
    /// Grows in.
    Pop,
    /// Drops in from above.
    Drop,
    /// Shrinks in from big.
    Zoom,
    /// Flips up into place.
    Flip,
    /// Comes into focus.
    Blur,
    /// Revealed from its side.
    Wipe,
    /// Letter by letter.
    Typewriter,
    /// Rises with a bounce.
    Bounce,
    /// Spins in.
    Spin,
    /// Fades in, then a light sweeps across it.
    Shine,
}

/// How the text looks. Sizes are in pixels of a 1920 × 1080 frame (they scale).
#[allow(clippy::struct_excessive_bools)]
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
    pub design: TextDesign,
    /// The accent color (bar, line, name box).
    pub accent: String,
    /// Builds on with an animation when it comes on.
    pub animate: bool,
    /// How it comes on (when it animates).
    pub entrance: TextEntrance,
    pub italic: bool,
    /// ALL CAPITALS.
    pub uppercase: bool,
    /// The second line's color ("" for the same as the first).
    pub sub_color: String,
    /// The second line's size, in % of the first.
    pub sub_size: u32,
    /// The second line's font ("" for the same as the first).
    pub sub_font: String,
    /// A line around the box, px (0: none).
    pub border: u32,
    pub border_color: String,
    /// A lower third's distance from the side of the screen, % of the width.
    pub x: u32,
    /// A lower third's distance from the bottom of the screen, % of the height.
    pub y: u32,
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
            design: TextDesign::Box,
            accent: "#2f80ed".to_owned(),
            animate: true,
            entrance: TextEntrance::Build,
            italic: false,
            uppercase: false,
            sub_color: String::new(),
            sub_size: 60,
            sub_font: String::new(),
            border: 0,
            border_color: "#ffffff".to_owned(),
            x: 5,
            y: 10,
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
    /// Keep everything in range (and colors valid).
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
        s.sub_size = s.sub_size.clamp(20, 150);
        s.border = s.border.min(20);
        s.x = s.x.min(45);
        s.y = s.y.min(90);
        s.sub_font = s.sub_font.trim().chars().take(60).collect();
        if !s.sub_color.is_empty() && !is_color(&s.sub_color) {
            s.sub_color.clear();
        }
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
            (&mut s.accent, d.accent),
            (&mut s.border_color, d.border_color),
        ] {
            if !is_color(c) {
                *c = fallback;
            }
        }
    }
}
