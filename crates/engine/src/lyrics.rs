//! Song lyrics: the words of a song, split into slides at blank lines, shown
//! one slide at a time over the picture or on their own. The operator (or a
//! phone, Stream Deck or MIDI) steps through them; the stage monitor shows
//! what comes next.

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::model::Millis;
use crate::text::TextStyle;

/// Longest song text.
pub const MAX_LYRICS_LEN: usize = 20_000;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub enum LyricsPlace {
    /// In the middle of the screen.
    #[default]
    Middle,
    /// Low, like subtitles (over a camera).
    Low,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", default)]
#[ts(export)]
pub struct Lyrics {
    pub title: String,
    /// The whole song; a blank line starts a new slide.
    pub text: String,
    /// The slide showing (0-based).
    pub current: usize,
    /// Words hidden (between songs, during an instrumental).
    pub blank: bool,
    /// When the slide last changed (for the fade).
    #[ts(type = "number")]
    pub changed_at: Millis,
    pub place: LyricsPlace,
    pub style: TextStyle,
}

impl Default for Lyrics {
    fn default() -> Self {
        Lyrics {
            title: String::new(),
            text: String::new(),
            current: 0,
            blank: false,
            changed_at: 0,
            place: LyricsPlace::Middle,
            style: TextStyle {
                size: 64,
                weight: 700,
                align: crate::text::TextAlign::Center,
                box_on: false,
                shadow: true,
                line_height: 1.3,
                ..TextStyle::default()
            },
        }
    }
}

/// The slides of a song: blocks of lines separated by blank lines.
#[must_use]
pub fn sections(text: &str) -> Vec<String> {
    let mut out = Vec::new();
    let mut cur: Vec<&str> = Vec::new();
    for line in text.lines() {
        if line.trim().is_empty() {
            if !cur.is_empty() {
                out.push(cur.join("\n"));
                cur.clear();
            }
        } else {
            cur.push(line.trim_end());
        }
    }
    if !cur.is_empty() {
        out.push(cur.join("\n"));
    }
    out
}

impl Lyrics {
    pub fn repair(&mut self) {
        self.title = self.title.chars().take(120).collect();
        self.text = self.text.chars().take(MAX_LYRICS_LEN).collect();
        self.current = self
            .current
            .min(sections(&self.text).len().saturating_sub(1));
        let mut t = crate::text::TextInput {
            style: self.style.clone(),
            ..Default::default()
        };
        t.repair();
        self.style = t.style;
    }

    /// Go to slide `index` (kept in range).
    pub fn go(&mut self, index: usize, now: Millis) {
        let last = sections(&self.text).len().saturating_sub(1);
        let i = index.min(last);
        if i != self.current || self.blank {
            self.current = i;
            self.blank = false;
            self.changed_at = now;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn blank_lines_make_slides() {
        let s = sections("Line one\nLine two\n\n\n  \nChorus a\nChorus b  \n");
        assert_eq!(s, vec!["Line one\nLine two", "Chorus a\nChorus b"]);
        assert!(sections("").is_empty());
        let mut l = Lyrics {
            text: "a\n\nb\n\nc".into(),
            ..Lyrics::default()
        };
        l.go(9, 5);
        assert_eq!((l.current, l.changed_at), (2, 5));
        l.go(2, 9);
        assert_eq!(l.changed_at, 5, "same slide: nothing changes");
    }
}
