//! Credits / thank-you list at the end of an event: rolling up the screen,
//! page by page, or all the names at once on a wall. It starts rolling when
//! it goes on air, and can be paused, sped up or restarted live.

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::model::Millis;

/// Most names.
pub const MAX_NAMES: usize = 2000;
pub const MAX_NAME_LEN: usize = 120;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub enum CreditsMode {
    /// Names rolling up the screen.
    #[default]
    Roll,
    /// A page of names at a time.
    Pages,
    /// Every name at once, in columns.
    Wall,
}

/// Credits and where they are.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", default)]
#[ts(export)]
pub struct Credits {
    /// Shown first, big (e.g. "Thank you").
    pub title: String,
    /// One per line; "Name — role" shows the role smaller.
    pub names: Vec<String>,
    pub mode: CreditsMode,
    /// Roll speed in px (of a 1080 frame) per second.
    pub speed: u32,
    /// Pages: how long each page shows.
    pub page_ms: u32,
    pub background: String,
    pub color: String,
    pub font: String,
    /// Size of a name, px of a 1080 frame.
    pub size: u32,
    /// Playing (rolling or turning pages).
    pub playing: bool,
    /// Position in ms of playing time at `at` (like a video).
    #[ts(type = "number")]
    pub pos_ms: u64,
    #[ts(type = "number")]
    pub at: Millis,
}

impl Default for Credits {
    fn default() -> Self {
        Credits {
            title: "Thank you".to_owned(),
            names: Vec::new(),
            mode: CreditsMode::Roll,
            speed: 60,
            page_ms: 6000,
            background: "#0b1020".to_owned(),
            color: "#ffffff".to_owned(),
            font: "Segoe UI".to_owned(),
            size: 48,
            playing: false,
            pos_ms: 0,
            at: 0,
        }
    }
}

fn is_color(c: &str) -> bool {
    c.len() == 7 && c.starts_with('#') && c[1..].chars().all(|c| c.is_ascii_hexdigit())
}

impl Credits {
    /// Playing time at `now`, in ms.
    pub fn position(&self, now: Millis) -> u64 {
        if self.playing {
            self.pos_ms + now.saturating_sub(self.at)
        } else {
            self.pos_ms
        }
    }

    pub fn play(&mut self, playing: bool, now: Millis) {
        if self.playing == playing {
            return;
        }
        self.pos_ms = self.position(now);
        self.at = now;
        self.playing = playing;
    }

    /// Back to the start (keeps playing if it was).
    pub fn restart(&mut self, now: Millis) {
        self.pos_ms = 0;
        self.at = now;
    }

    /// Change speed without a jump in where it is.
    pub fn set_speed(&mut self, speed: u32, now: Millis) {
        self.pos_ms = self.position(now);
        self.at = now;
        self.speed = speed.clamp(5, 600);
    }

    pub fn repair(&mut self) {
        self.title = crate::engine::short_text(&self.title, MAX_NAME_LEN);
        self.names.truncate(MAX_NAMES);
        for n in &mut self.names {
            let short: String = n.chars().take(MAX_NAME_LEN).collect();
            short.trim().clone_into(n);
        }
        self.names.retain(|n| !n.is_empty());
        self.speed = self.speed.clamp(5, 600);
        self.page_ms = self.page_ms.clamp(1000, 120_000);
        self.size = self.size.clamp(16, 200);
        let d = Credits::default();
        if !is_color(&self.background) {
            self.background = d.background;
        }
        if !is_color(&self.color) {
            self.color = d.color;
        }
        if self.font.trim().is_empty() {
            self.font = d.font;
        }
    }
}
