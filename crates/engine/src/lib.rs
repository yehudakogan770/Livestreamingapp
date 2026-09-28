//! # Lumora engine
//!
//! The engine owns the show — every source, what is on each screen, the
//! transition, blank and panic state — and is the only thing allowed to change
//! it. Windows, remotes and cues all send [`Action`]s; the engine checks each
//! one, applies it, and everyone receives the new [`Show`].
//!
//! Design rules (see `docs/ARCHITECTURE.md`):
//! - One source of truth: nothing else keeps its own copy of show state.
//! - An invalid action is refused with a clear [`ActionError`] and changes nothing.
//! - Time is passed in, never read, so behaviour is reproducible and testable.

pub mod action;
pub mod audio;
pub mod credits;
pub mod engine;
pub mod event;
pub mod model;
pub mod overlays;
pub mod persist;
pub mod pesukim;
pub mod presets;
pub mod split;
pub mod stage;
pub mod text;
pub mod timing;

pub use action::{Action, ActionError, CountdownPatch, MonitorPatch, NewSource, SourcePatch};
pub use audio::{
    AudioMix, AudioOutputId, AudioOutputs, Bus, BusId, BusPatch, SourceAudio, SourceAudioPatch,
};
pub use credits::{Credits, CreditsMode};
pub use engine::{Engine, Outcome};
pub use event::{EventInfo, EventPatch, SafeScreen};
pub use model::*;
pub use overlays::{Frame, Overlay, OverlayAnim, OverlayPatch};
pub use pesukim::{Pasuk, Pesukim, PesukimLook, PesukimMode, PesukimPlace, WordChange};
pub use presets::{Preset, PresetButton, RunningSteps, Step};
pub use split::{Split, SplitBox, SplitLayout};
pub use stage::{AtZero, Countdown, Monitor, MonitorLayout, TextSize, TimerFormat};
pub use text::{TextAlign, TextInput, TextLayout, TextStyle};
pub use timing::{in_transition, source_ended, source_position, transition_progress};
