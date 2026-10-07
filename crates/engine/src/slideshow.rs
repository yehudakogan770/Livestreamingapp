//! Slideshows: pictures (and PDF pages, turned into pictures when added),
//! with any input as a slide in between — a video between two slides plays
//! when its slide comes up. The slides can fill the screen or sit on part
//! of it, with another input (a camera) behind.

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::model::{Fit, Millis, SourceId};
use crate::overlays::Frame;

/// Most slides.
pub const MAX_SLIDES: usize = 500;
/// Longest speaker notes on one slide (characters).
pub const MAX_NOTES: usize = 4000;

/// One slide.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(
    tag = "type",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
#[ts(export)]
pub enum Slide {
    /// A picture file (PDF pages are stored as pictures).
    Image {
        path: String,
        /// Speaker notes (shown only on the speaker's remote).
        #[serde(default)]
        #[ts(optional = nullable)]
        notes: Option<String>,
    },
    /// Another input shown as this slide (a video plays when it comes up).
    Input {
        source_id: SourceId,
        /// Speaker notes (shown only on the speaker's remote).
        #[serde(default)]
        #[ts(optional = nullable)]
        notes: Option<String>,
    },
}

impl Slide {
    /// The speaker notes, if there are any.
    pub fn notes(&self) -> Option<&str> {
        match self {
            Slide::Image { notes, .. } | Slide::Input { notes, .. } => {
                notes.as_deref().filter(|n| !n.trim().is_empty())
            }
        }
    }

    fn notes_mut(&mut self) -> &mut Option<String> {
        match self {
            Slide::Image { notes, .. } | Slide::Input { notes, .. } => notes,
        }
    }
}

/// A slideshow input.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", default)]
#[ts(export)]
pub struct Slideshow {
    pub slides: Vec<Slide>,
    /// The slide showing (0-based).
    pub current: usize,
    /// When the slide last changed (for the fade and auto-advance).
    #[ts(type = "number")]
    pub changed_at: Millis,
    /// Next slide by itself every this many ms while on air (None: by hand).
    #[ts(type = "number | null")]
    pub auto_ms: Option<u32>,
    /// After the last slide, go back to the first (with auto-advance).
    pub looping: bool,
    /// Where the slides sit, in % of the frame (the whole screen by default).
    pub area: Frame,
    pub fit: Fit,
    pub background: String,
    /// An input shown behind (around) the slides — usually a camera.
    pub behind: Option<SourceId>,
    /// Fade between slides.
    pub fade: bool,
    /// Blacked out: the slides' area shows black (what is behind stays).
    /// Going to a slide brings the slides back.
    pub black: bool,
}

impl Default for Slideshow {
    fn default() -> Self {
        Slideshow {
            slides: Vec::new(),
            current: 0,
            changed_at: 0,
            auto_ms: None,
            looping: true,
            area: Frame::default(),
            fit: Fit::Contain,
            background: "#000000".to_owned(),
            behind: None,
            fade: true,
            black: false,
        }
    }
}

fn is_color(c: &str) -> bool {
    c.len() == 7 && c.starts_with('#') && c[1..].chars().all(|c| c.is_ascii_hexdigit())
}

impl Slideshow {
    /// Go to a slide (clamped), out of black. Returns the input on the new
    /// slide, if any.
    pub fn go(&mut self, index: usize, now: Millis) -> Option<SourceId> {
        self.black = false;
        let index = index.min(self.slides.len().saturating_sub(1));
        if index != self.current {
            self.current = index;
            self.changed_at = now;
        }
        match self.slides.get(self.current) {
            Some(Slide::Input { source_id, .. }) => Some(source_id.clone()),
            _ => None,
        }
    }

    /// The next slide (wrapping round when looping). None at the end.
    pub fn next_index(&self) -> Option<usize> {
        if self.current + 1 < self.slides.len() {
            Some(self.current + 1)
        } else if self.looping && self.slides.len() > 1 {
            Some(0)
        } else {
            None
        }
    }

    /// Time to move on by itself (never while blacked out).
    pub fn due(&self, now: Millis) -> bool {
        !self.black
            && self
                .auto_ms
                .is_some_and(|ms| now >= self.changed_at.saturating_add(u64::from(ms)))
            && self.next_index().is_some()
    }

    pub fn repair(&mut self) {
        self.slides.truncate(MAX_SLIDES);
        for slide in &mut self.slides {
            let notes = slide.notes_mut();
            if notes.as_deref().is_some_and(|n| n.trim().is_empty()) {
                *notes = None;
            } else if let Some(n) = notes {
                if n.chars().count() > MAX_NOTES {
                    *n = n.chars().take(MAX_NOTES).collect();
                }
            }
        }
        self.current = self.current.min(self.slides.len().saturating_sub(1));
        self.auto_ms = self.auto_ms.map(|ms| ms.clamp(1000, 600_000));
        self.area = self.area.clamped();
        if !is_color(&self.background) {
            "#000000".clone_into(&mut self.background);
        }
    }
}
