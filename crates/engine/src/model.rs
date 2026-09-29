//! The data that describes a whole show.
//!
//! Everything here is plain data: it can be cloned, compared, serialised to the
//! UI and saved to disk. All changes go through [`crate::Engine::apply`].

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::audio::{AudioMix, AudioOutputs, SourceAudio};
use crate::event::EventInfo;
use crate::presets::{Preset, RunningSteps};
use crate::stage::{Countdown, Monitor};

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
    #[must_use]
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
    /// The show's countdown, big, over a background colour. At zero the
    /// numbers can give way to the event logo.
    Countdown {
        background: String,
        /// Picture shown when the countdown finishes (the event logo).
        #[serde(default)]
        #[ts(optional)]
        logo: Option<String>,
        /// This input's own timer: each countdown input counts on its own,
        /// so the next one can be prepared while another is on air.
        #[serde(default)]
        timer: Countdown,
    },
    /// The 12 Pesukim, one word at a time.
    Pesukim(Box<crate::pesukim::Pesukim>),
    /// A lower third, title, ticker or full-screen message.
    Text(Box<crate::text::TextInput>),
    /// Credits / thank-you list: rolling, pages or a wall of names.
    Credits(Box<crate::credits::Credits>),
    /// Split screen: two to four inputs at once.
    Split(Box<crate::split::Split>),
    /// A slideshow: pictures, PDF pages and other inputs as slides.
    Slideshow(Box<crate::slideshow::Slideshow>),
    /// The stage visuals (one shared state in `Show.visuals`).
    Visuals,
    /// A logo in 3D, turning.
    Logo3d(Box<crate::logo3d::Logo3d>),
    /// A web page.
    Browser(Box<crate::browser::BrowserInput>),
    /// A sound-only input: microphone, line in, audio interface channel.
    Microphone {
        device_id: String,
        label: String,
    },
}

impl SourceKind {
    pub fn is_video(&self) -> bool {
        matches!(self, SourceKind::Video { .. })
    }

    /// Sound only: it can be heard but never put on a screen.
    pub fn is_sound_only(&self) -> bool {
        matches!(self, SourceKind::Microphone { .. })
    }

    /// Makes sound (and so gets a channel on the mixer).
    pub fn has_sound(&self) -> bool {
        matches!(
            self,
            SourceKind::Video { .. } | SourceKind::Microphone { .. }
        )
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
    /// How it is heard: audio follows video, which mixes, delay.
    #[serde(default)]
    pub audio: SourceAudio,
    /// Green / blue screen: the key colour taken out (cameras, videos, pictures).
    #[serde(default)]
    pub key: ChromaKey,
    /// Light, colour, crop and effects (cameras, videos, pictures).
    #[serde(default)]
    pub adjust: crate::adjust::Adjust,
}

/// Green screen: a colour taken out of the picture so what is behind shows.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", default)]
#[ts(export)]
pub struct ChromaKey {
    pub enabled: bool,
    /// The colour taken out (usually the green of the screen).
    pub color: String,
    /// How close to the colour is taken out, 0 – 1.
    pub similarity: f32,
    /// How soft the edge is, 0 – 1.
    pub smoothness: f32,
    /// How much green reflected on people is taken away, 0 – 1.
    pub spill: f32,
}

impl Default for ChromaKey {
    fn default() -> Self {
        ChromaKey {
            enabled: false,
            color: "#00b140".to_owned(),
            similarity: 0.4,
            smoothness: 0.08,
            spill: 0.3,
        }
    }
}

impl ChromaKey {
    pub fn repair(&mut self) {
        let fix = |v: f32, d: f32| if v.is_finite() { v.clamp(0.0, 1.0) } else { d };
        let d = ChromaKey::default();
        self.similarity = fix(self.similarity, d.similarity);
        self.smoothness = fix(self.smoothness, d.smoothness);
        self.spill = fix(self.spill, d.spill);
        let ok = self.color.len() == 7
            && self.color.starts_with('#')
            && self.color[1..].chars().all(|c| c.is_ascii_hexdigit());
        if !ok {
            self.color = d.color;
        }
    }
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
    /// How long the last blank fades, ms (0: the usual quick fade).
    pub blank_fade_ms: u32,
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
    /// Which sound device each mix plays on.
    pub audio_outputs: AudioOutputs,
    /// How long "Fade to black" takes, ms.
    #[serde(default = "default_ftb")]
    pub fade_to_black_ms: u32,
    /// The four favourite transition buttons.
    #[serde(default = "default_favourites")]
    pub favourite_transitions: Vec<Transition>,
}

fn default_ftb() -> u32 {
    2000
}

/// The favourite transition buttons to start with.
pub fn default_favourites() -> Vec<Transition> {
    [
        (TransitionKind::Fade, 800),
        (TransitionKind::Dip, 1500),
        (TransitionKind::Wipe, 1000),
        (TransitionKind::Slide, 600),
    ]
    .into_iter()
    .map(|(kind, duration_ms)| Transition { kind, duration_ms })
    .collect()
}

impl Default for Settings {
    fn default() -> Self {
        Settings {
            displays: PerScreen::default(),
            auto_play_on_take: true,
            audio_outputs: AudioOutputs::default(),
            fade_to_black_ms: default_ftb(),
            favourite_transitions: default_favourites(),
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
    /// When on, the Back Screen shows whatever is on the Live Screen,
    /// including its transitions. Taking something on the Back Screen
    /// directly turns this off.
    pub back_follows_live: bool,
    /// The event: name, logo and emergency plan.
    pub event: EventInfo,
    /// The event's segments, in running order.
    pub presets: Vec<Preset>,
    /// The preset picked now.
    pub active_preset: Option<String>,
    /// Preset-button steps still running (waiting to resume). Not saved.
    pub running: Vec<RunningSteps>,
    /// The Stream / Hall / Recording mixes and the headphone solo.
    pub audio: AudioMix,
    /// What the stage monitor shows.
    pub monitor: Monitor,
    /// The run of show: cues and where it is.
    pub run: crate::cues::RunOfShow,
    /// Overlay channels 1 – 4 (always four).
    #[serde(default = "crate::overlays::channels")]
    pub overlays: Vec<crate::overlays::Overlay>,
    /// The stage visuals: tempo, scene and effects, drawn by every
    /// Stage visuals input.
    #[serde(default)]
    pub visuals: crate::visuals::Visuals,
    pub settings: Settings,
}

/// Current save-file format version.
/// 2: the countdown's at-zero default became "take the numbers off".
/// 3: each countdown input has its own timer (was one shared countdown).
pub const SHOW_VERSION: u32 = 3;

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
            back_follows_live: false,
            event: EventInfo::default(),
            presets: Vec::new(),
            active_preset: None,
            running: Vec::new(),
            audio: AudioMix::default(),
            monitor: Monitor::default(),
            run: crate::cues::RunOfShow::default(),
            overlays: crate::overlays::channels(),
            visuals: crate::visuals::Visuals::default(),
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

    /// A countdown input's timer.
    pub fn countdown(&self, id: &SourceId) -> Option<&Countdown> {
        match self.source(id).map(|s| &s.kind) {
            Some(SourceKind::Countdown { timer, .. }) => Some(timer),
            _ => None,
        }
    }

    /// A Pesukim input's words and place.
    pub fn pesukim(&self, id: &SourceId) -> Option<&crate::pesukim::Pesukim> {
        match self.source(id).map(|s| &s.kind) {
            Some(SourceKind::Pesukim(p)) => Some(p),
            _ => None,
        }
    }

    /// The countdown that matters most right now, for the stage monitor and
    /// for steps that don't name one: on air on the Live Screen, then the
    /// Back Screen, then any that is running, then the first one.
    pub fn main_countdown(&self) -> Option<&SourceId> {
        let on = |sc: ScreenId| {
            self.screens
                .get(sc)
                .program
                .as_ref()
                .filter(|id| self.countdown(id).is_some())
        };
        on(ScreenId::Live)
            .or_else(|| on(ScreenId::Back))
            .or_else(|| {
                self.sources
                    .iter()
                    .map(|s| &s.id)
                    .find(|id| self.countdown(id).is_some_and(Countdown::running))
            })
            .or_else(|| {
                self.sources
                    .iter()
                    .map(|s| &s.id)
                    .find(|id| self.countdown(id).is_some())
            })
    }
}
