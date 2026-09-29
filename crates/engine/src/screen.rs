//! Screen capture: one of this computer's displays, or one window (slides
//! in a slide program, a browser, a game). The app captures it and serves the
//! pictures like a stream input.

use serde::{Deserialize, Serialize};
use ts_rs::TS;

/// What is captured.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(
    tag = "type",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
#[ts(export)]
pub enum CaptureTarget {
    /// A whole display (0 = the first).
    Display { index: u32, name: String },
    /// The window whose title contains this text.
    Window { title: String },
}

impl Default for CaptureTarget {
    fn default() -> Self {
        CaptureTarget::Display {
            index: 0,
            name: String::new(),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", default)]
#[ts(export)]
pub struct ScreenCapture {
    pub target: CaptureTarget,
    /// Show the mouse pointer.
    pub cursor: bool,
}

impl ScreenCapture {
    pub fn repair(&mut self) {
        match &mut self.target {
            CaptureTarget::Display { index, name } => {
                *index = (*index).min(15);
                *name = name.chars().take(80).collect();
            }
            CaptureTarget::Window { title } => *title = title.chars().take(200).collect(),
        }
    }
}
