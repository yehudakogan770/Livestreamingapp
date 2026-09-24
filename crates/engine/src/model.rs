//! The data that describes a whole show.
//!
//! Everything here is plain data: it can be cloned, compared, serialised to the
//! UI and saved to disk. All changes go through [`crate::Engine::apply`].

use serde::{Deserialize, Serialize};
use ts_rs::TS;

/// Milliseconds on the engine clock. The engine never reads the clock itself;
/// callers pass `now` in, which keeps every result reproducible in tests.
pub type Millis = u64;

/// Shortest and longest allowed transition, in milliseconds.
pub const MIN_TRANSITION_MS: u32 = 100;
pub const MAX_TRANSITION_MS: u32 = 10_000;

/// How long a blank fades in or out, in milliseconds.
pub const BLANK_FADE_MS: u32 = 300;
/// How long the monitor flash lasts, in milliseconds.
pub const FLASH_MS: u32 = 2_400;

/// The three outputs Lumora drives.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize, TS)]
#[serde(rename_all = "lowercase")]
#[ts(export)]
pub enum ScreenId {
    /// The live stream.
    Live,
    /// The projector behind the stage.
    Back,
    /// The text-only monitor for the people on stage.
    Monitor,
}

impl ScreenId {
    pub const ALL: [ScreenId; 3] = [ScreenId::Live, ScreenId::Back, ScreenId::Monitor];

    /// The name shown to the user.
    pub fn label(self) -> &'static str {
        match self {
            ScreenId::Live => "Live Screen",
            ScreenId::Back => "Back Screen",
            ScreenId::Monitor => "Monitor",
        }
    }
}

/// A unique id for a source (camera, video, image…).
#[derive(Debug, Clone, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct SourceId(pub String);

impl SourceId {
    pub fn new(id: impl Into<String>) -> Self {
        SourceId(id.into())
    }
    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl std::fmt::Display for SourceId {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.0)
    }
}

/// The kinds of transition between two sources.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize, TS)]
#[serde(rename_all = "lowercase")]
#[ts(export)]
pub enum TransitionKind {
    /// Instant switch.
    Cut,
    /// Cross-fade.
    #[default]
    Fade,
    /// Slower, softer cross-fade.
    Merge,
    /// Fade to black, then up into the new source.
    Dip,
    /// The new source sweeps across.
    Wipe,
    /// The new source slides in.
    Slide,
}

/// A transition type together with its length.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct Transition {
    pub kind: TransitionKind,
    pub duration_ms: u32,
}

impl Default for Transition {
    fn default() -> Self {
        Transition {
            kind: TransitionKind::Fade,
            duration_ms: 800,
        }
    }
}

impl Transition {
    /// The same transition with its duration forced into the allowed range.
    pub fn clamped(self) -> Self {
        Transition {
            kind: self.kind,
            duration_ms: self.duration_ms.clamp(MIN_TRANSITION_MS, MAX_TRANSITION_MS),
        }
    }
}

/// A transition that is currently running (or has just finished) on a screen.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct ActiveTransition {
    pub kind: TransitionKind,
    pub duration_ms: u32,
    #[ts(type = "number")]
    pub started_at: Millis,
}

/// How a picture fits into the output frame.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize, TS)]
#[serde(rename_all = "lowercase")]
#[ts(export)]
pub enum Fit {
    /// Show the whole picture, with bars if needed.
    #[default]
    Contain,
    /// Fill the frame, cropping if needed.
    Cover,
}

/// Play state of a video. The position is stored as "position `pos_s` at time
/// `at`", so every window can work out the current position on its own.
#[derive(Debug, Clone, Copy, PartialEq, Default, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct Playback {
    pub playing: bool,
    pub pos_s: f64,
    #[ts(type = "number")]
    pub at: Millis,
}

/// What a source is, with the data that kind needs.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(
    tag = "type",
    rename_all = "lowercase",
    rename_all_fields = "camelCase"
)]
#[ts(export)]
pub enum SourceKind {
    Camera {
        device_id: String,
        label: String,
    },
    Video {
        path: String,
        duration_s: f64,
        playback: Playback,
    },
    Image {
        path: String,
    },
    Color {
        color: String,
    },
    Pattern,
}

impl SourceKind {
    pub fn is_video(&self) -> bool {
        matches!(self, SourceKind::Video { .. })
    }
}

/// One input: a camera, a video, a picture, a colour…
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct Source {
    pub id: SourceId,
    pub name: String,
    pub kind: SourceKind,
    /// 0.0 – 1.0
    pub volume: f32,
    pub muted: bool,
    pub looping: bool,
    pub fit: Fit,
}

/// Everything about one output screen.
#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", default)]
#[ts(export)]
pub struct ScreenState {
    /// What is lined up next.
    pub preview: Option<SourceId>,
    /// What is on air.
    pub program: Option<SourceId>,
    /// What was on air before the last take (used while a transition runs).
    pub previous: Option<SourceId>,
    pub transition: Option<ActiveTransition>,
    /// Manual fader position, 0.0 – 1.0.
    pub tbar: f32,
    pub blank: bool,
    #[ts(type = "number")]
    pub blank_changed_at: Millis,
    #[ts(type = "number")]
    pub flash_at: Millis,
}

/// Per-screen map with exactly one entry for each screen.
#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize, TS)]
#[serde(default)]
#[ts(export)]
pub struct PerScreen<T> {
    pub live: T,
    pub back: T,
    pub monitor: T,
}

impl<T> PerScreen<T> {
    pub fn get(&self, id: ScreenId) -> &T {
        match id {
            ScreenId::Live => &self.live,
            ScreenId::Back => &self.back,
            ScreenId::Monitor => &self.monitor,
        }
    }
    pub fn get_mut(&mut self, id: ScreenId) -> &mut T {
        match id {
            ScreenId::Live => &mut self.live,
            ScreenId::Back => &mut self.back,
            ScreenId::Monitor => &mut self.monitor,
        }
    }
    pub fn iter(&self) -> impl Iterator<Item = (ScreenId, &T)> {
        ScreenId::ALL.into_iter().map(move |id| (id, self.get(id)))
    }
}

/// Settings that belong to the machine, remembered between events.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", default)]
#[ts(export)]
pub struct Settings {
    /// Which physical display each screen goes to (set once, remembered).
    pub displays: PerScreen<Option<String>>,
    /// Start videos automatically when they are taken to air.
    pub auto_play_on_take: bool,
}

impl Default for Settings {
    fn default() -> Self {
        Settings {
            displays: PerScreen::default(),
            auto_play_on_take: true,
        }
    }
}

/// The whole show. This is the single source of truth.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", default)]
#[ts(export)]
pub struct Show {
    pub version: u32,
    /// Sources in the order they appear on screen.
    pub sources: Vec<Source>,
    pub screens: PerScreen<ScreenState>,
    /// The transition TAKE uses.
    pub transition: Transition,
    pub panic: bool,
    #[ts(type = "number")]
    pub panic_changed_at: Millis,
    /// Master volume, 0.0 – 1.0.
    pub master_volume: f32,
    pub settings: Settings,
}

/// Current save-file format version.
pub const SHOW_VERSION: u32 = 1;

impl Default for Show {
    fn default() -> Self {
        Show {
            version: SHOW_VERSION,
            sources: Vec::new(),
            screens: PerScreen::default(),
            transition: Transition::default(),
            panic: false,
            panic_changed_at: 0,
            master_volume: 1.0,
            settings: Settings::default(),
        }
    }
}

impl Show {
    pub fn source(&self, id: &SourceId) -> Option<&Source> {
        self.sources.iter().find(|s| &s.id == id)
    }
    pub fn source_mut(&mut self, id: &SourceId) -> Option<&mut Source> {
        self.sources.iter_mut().find(|s| &s.id == id)
    }
    pub fn has_source(&self, id: &SourceId) -> bool {
        self.source(id).is_some()
    }
}
