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
    Black,
    /// The event logo on black (Lumora's logo until the event has its own).
    #[default]
    Logo,
}

/// The event and its emergency plan.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
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
    /// The event's look: colors and font for every title.
    pub brand: Brand,
    /// The guests' Wi-Fi, shown as a code to join it next to the audience page's code.
    pub wifi: GuestWifi,
    /// Where the event is (Hebrew date, zmanim, candle lighting).
    pub place: crate::zmanim::Place,
}

impl Default for EventInfo {
    /// Something broken shows the logo (Lumora's until the event has its own);
    /// PANIC shows nothing at all: black.
    fn default() -> Self {
        EventInfo {
            name: String::new(),
            logo: None,
            on_failure: SafeScreen::Logo,
            panic_shows: SafeScreen::Black,
            set_up: false,
            brand: Brand::default(),
            wifi: GuestWifi::default(),
            place: crate::zmanim::Place::default(),
        }
    }
}

/// A Wi-Fi network guests join by scanning a code (for halls where the
/// audience page is only on the local network).
#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", default)]
#[ts(export)]
pub struct GuestWifi {
    pub name: String,
    pub password: String,
    /// The code phones scan to join (SVG), made by the app.
    pub qr: String,
    /// Show it on screen before the audience page's code.
    pub show: bool,
}

impl GuestWifi {
    #[must_use]
    pub fn cleaned(mut self) -> Self {
        self.name = self
            .name
            .chars()
            .filter(|c| !c.is_control())
            .take(32)
            .collect();
        self.password = self
            .password
            .chars()
            .filter(|c| !c.is_control())
            .take(63)
            .collect();
        if self.name.trim().is_empty()
            || self.qr.len() > 200_000
            || !self.qr.trim_start().starts_with("<svg")
        {
            self.qr.clear();
        }
        self
    }
}

/// The event's look, applied to all titles, songs and scoreboards at once.
#[allow(clippy::struct_excessive_bools)]
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
    /// Name titles' (lower thirds') text size, px of a 1080 frame.
    pub size: u32,
    pub weight: u32,
    pub italic: bool,
    pub uppercase: bool,
    pub align: crate::text::TextAlign,
    pub outline: u32,
    pub outline_color: String,
    pub shadow: bool,
    /// A box behind the words (Box, Accent bar).
    pub box_on: bool,
    pub padding: u32,
    pub radius: u32,
    /// Line height, % of the size.
    pub line_height: u32,
    /// Letter spacing, px.
    pub letter_spacing: i32,
    /// The second line: color ("" same), size (% of the first), font ("" same).
    pub sub_color: String,
    pub sub_size: u32,
    pub sub_font: String,
    pub border: u32,
    pub border_color: String,
    /// Where name titles sit: % from the side and from the bottom.
    pub x: u32,
    pub y: u32,
    pub animate: bool,
    pub entrance: crate::text::TextEntrance,
    /// Font files added for this event.
    pub fonts: Vec<CustomFont>,
}

/// A font from a file (TTF, OTF, WOFF), usable by name like an installed one.
#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", default)]
#[ts(export)]
pub struct CustomFont {
    pub name: String,
    pub path: String,
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
            size: 54,
            weight: 600,
            italic: false,
            uppercase: false,
            align: crate::text::TextAlign::Left,
            outline: 0,
            outline_color: "#000000".to_owned(),
            shadow: true,
            box_on: true,
            padding: 24,
            radius: 6,
            line_height: 120,
            letter_spacing: 0,
            sub_color: String::new(),
            sub_size: 60,
            sub_font: String::new(),
            border: 0,
            border_color: "#ffffff".to_owned(),
            x: 5,
            y: 10,
            animate: true,
            entrance: crate::text::TextEntrance::Build,
            fonts: Vec::new(),
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
            (&mut self.outline_color, d.outline_color),
            (&mut self.border_color, d.border_color),
        ] {
            if !is_color(c) {
                *c = f;
            }
        }
        if !self.sub_color.is_empty() && !is_color(&self.sub_color) {
            self.sub_color.clear();
        }
        self.sub_font = self.sub_font.trim().chars().take(60).collect();
        self.box_opacity = self.box_opacity.min(100);
        self.size = self.size.clamp(12, 400);
        self.weight = (self.weight.clamp(300, 900) / 100) * 100;
        self.outline = self.outline.min(20);
        self.padding = self.padding.min(120);
        self.radius = self.radius.min(60);
        self.line_height = self.line_height.clamp(80, 300);
        self.letter_spacing = self.letter_spacing.clamp(-10, 40);
        self.sub_size = self.sub_size.clamp(20, 150);
        self.border = self.border.min(20);
        self.x = self.x.min(45);
        self.y = self.y.min(90);
        self.fonts.truncate(40);
        for f in &mut self.fonts {
            f.name = f
                .name
                .trim()
                .chars()
                .filter(|c| !c.is_control() && *c != '"')
                .take(60)
                .collect();
        }
        self.fonts
            .retain(|f| !f.name.is_empty() && !f.path.trim().is_empty());
        self
    }

    /// Put the look on a title's style. Size, alignment and place only go on
    /// name titles (lower thirds): big titles and tickers keep theirs.
    pub fn apply_to(&self, s: &mut crate::text::TextStyle, name_title: bool) {
        s.font.clone_from(&self.font);
        s.color.clone_from(&self.text_color);
        s.accent.clone_from(&self.accent);
        s.box_color.clone_from(&self.box_color);
        #[allow(clippy::cast_precision_loss)]
        {
            s.box_opacity = self.box_opacity as f32 / 100.0;
            s.line_height = self.line_height as f32 / 100.0;
            s.letter_spacing = self.letter_spacing as f32;
        }
        s.design = self.design;
        s.weight = self.weight;
        s.italic = self.italic;
        s.uppercase = self.uppercase;
        s.outline = self.outline;
        s.outline_color.clone_from(&self.outline_color);
        s.shadow = self.shadow;
        s.padding = self.padding;
        s.radius = self.radius;
        s.sub_color.clone_from(&self.sub_color);
        s.sub_size = self.sub_size;
        s.sub_font.clone_from(&self.sub_font);
        s.border = self.border;
        s.border_color.clone_from(&self.border_color);
        s.animate = self.animate;
        s.entrance = self.entrance;
        if name_title {
            s.box_on = self.box_on;
            s.size = self.size;
            s.align = self.align;
            s.x = self.x;
            s.y = self.y;
        }
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
    #[serde(default)]
    #[ts(optional)]
    pub wifi: Option<GuestWifi>,
    #[serde(default)]
    #[ts(optional)]
    pub place: Option<crate::zmanim::Place>,
}
