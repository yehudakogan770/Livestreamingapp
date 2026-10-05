//! Live captions for the stream: the words spoken, written as they are said.
//! They go only to the stream (never the screens in the room): to `YouTube` as
//! closed captions viewers turn on and off, and, if wanted, in the stream
//! picture for sites without that. The speech is recognized on the
//! operator's computer, offline; this is only how captions are set up.

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::model::{Source, SourceId};

/// Where the captions sit.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub enum CaptionPlace {
    #[default]
    Bottom,
    Top,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", default)]
#[ts(export)]
pub struct Captions {
    pub on: bool,
    /// The microphone listened to (None: everything in the Stream mix).
    #[ts(optional = nullable)]
    pub listen: Option<SourceId>,
    /// Also written in the stream picture (for sites without closed
    /// captions). The recording stays clean.
    pub in_picture: bool,
    pub place: CaptionPlace,
    /// Text size, 0.6 – 1.6 (1: the usual).
    pub size: f32,
    /// Lines of text at once, 1 – 3.
    pub lines: u8,
    /// The language spoken: a code like "en" or "he", or "auto" (worked out).
    pub language: String,
    /// The most accurate (bigger, slower) model for languages other than
    /// English.
    pub best: bool,
}

impl Default for Captions {
    fn default() -> Self {
        Captions {
            on: false,
            listen: None,
            in_picture: false,
            place: CaptionPlace::Bottom,
            size: 1.0,
            lines: 2,
            language: "en".to_owned(),
            best: false,
        }
    }
}

impl Captions {
    pub fn repair(&mut self, sources: &[Source]) {
        self.size = if self.size.is_finite() {
            self.size.clamp(0.6, 1.6)
        } else {
            1.0
        };
        self.lines = self.lines.clamp(1, 3);
        let code = self.language.trim().to_ascii_lowercase();
        self.language = if code == "auto"
            || ((2..=3).contains(&code.len()) && code.chars().all(|c| c.is_ascii_lowercase()))
        {
            code
        } else {
            "en".to_owned()
        };
        if let Some(id) = &self.listen {
            if !sources.iter().any(|s| &s.id == id) {
                self.listen = None;
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn settings_are_kept_sensible() {
        let mut c = Captions {
            size: 9.0,
            lines: 0,
            listen: Some(SourceId::new("gone")),
            language: "Hebrew!".into(),
            ..Captions::default()
        };
        c.repair(&[]);
        assert_eq!(c.language, "en");
        assert!((c.size - 1.6).abs() < f32::EPSILON);
        assert_eq!(c.lines, 1);
        assert!(c.listen.is_none());
    }
}
