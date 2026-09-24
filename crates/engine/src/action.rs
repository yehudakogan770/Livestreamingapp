//! Everything the operator (or a remote, or a cue) can ask the engine to do.

use serde::{Deserialize, Serialize};
use thiserror::Error;
use ts_rs::TS;

use crate::model::{Fit, ScreenId, SourceId, SourceKind, TransitionKind};

/// A new source as requested by the UI. The engine fills in and cleans up the
/// rest (id, limits, play state).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct NewSource {
    /// Leave empty to let the engine choose an id.
    #[serde(default)]
    #[ts(optional)]
    pub id: Option<SourceId>,
    pub name: String,
    pub kind: SourceKind,
    #[serde(default)]
    #[ts(optional)]
    pub volume: Option<f32>,
    #[serde(default)]
    #[ts(optional)]
    pub muted: Option<bool>,
    #[serde(default)]
    #[ts(optional)]
    pub looping: Option<bool>,
    #[serde(default)]
    #[ts(optional)]
    pub fit: Option<Fit>,
}

/// Changes to an existing source. Fields left out stay as they are.
#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct SourcePatch {
    #[serde(default)]
    #[ts(optional)]
    pub name: Option<String>,
    #[serde(default)]
    #[ts(optional)]
    pub volume: Option<f32>,
    #[serde(default)]
    #[ts(optional)]
    pub muted: Option<bool>,
    #[serde(default)]
    #[ts(optional)]
    pub looping: Option<bool>,
    #[serde(default)]
    #[ts(optional)]
    pub fit: Option<Fit>,
    /// Only for colour sources.
    #[serde(default)]
    #[ts(optional)]
    pub color: Option<String>,
}

/// One request to change the show.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(
    tag = "type",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
#[ts(export)]
pub enum Action {
    // ----- sources -----
    AddSource {
        source: NewSource,
    },
    UpdateSource {
        id: SourceId,
        patch: SourcePatch,
    },
    RemoveSource {
        id: SourceId,
    },
    MoveSource {
        id: SourceId,
        index: usize,
    },

    // ----- switching -----
    /// Line a source up in a screen's preview (or clear it with `null`).
    SetPreview {
        screen: ScreenId,
        source_id: Option<SourceId>,
    },
    /// Send the preview to air with a transition (the show's default if omitted).
    Take {
        screen: ScreenId,
        #[serde(default)]
        #[ts(optional)]
        transition: Option<TransitionKind>,
        #[serde(default)]
        #[ts(optional)]
        duration_ms: Option<u32>,
    },
    /// Send a source straight to air with a cut, keeping the preview as it is.
    CutTo {
        screen: ScreenId,
        source_id: SourceId,
    },
    /// Move the manual fader (0.0 – 1.0). Reaching the end completes the take.
    SetTbar {
        screen: ScreenId,
        value: f32,
    },
    /// Choose the transition TAKE uses.
    SetTransition {
        #[serde(default)]
        #[ts(optional)]
        kind: Option<TransitionKind>,
        #[serde(default)]
        #[ts(optional)]
        duration_ms: Option<u32>,
    },

    // ----- safety -----
    SetBlank {
        screens: Vec<ScreenId>,
        value: bool,
    },
    /// Everything black except the monitor, which dims.
    Panic {
        value: bool,
    },
    /// Flash the stage monitor to get attention.
    MonitorFlash,

    // ----- video playback -----
    Play {
        id: SourceId,
    },
    Pause {
        id: SourceId,
    },
    Seek {
        id: SourceId,
        pos_s: f64,
    },
    /// Reported by the media layer once a file's length is known.
    SetDuration {
        id: SourceId,
        duration_s: f64,
    },

    // ----- audio -----
    SetMasterVolume {
        value: f32,
    },

    // ----- settings -----
    SetDisplay {
        screen: ScreenId,
        #[serde(default)]
        #[ts(optional)]
        display_id: Option<String>,
    },
    SetAutoPlayOnTake {
        value: bool,
    },
}

/// Why an action was refused. The show is never changed when this happens.
#[derive(Debug, Clone, PartialEq, Error, Serialize, Deserialize, TS)]
#[serde(
    tag = "code",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
#[ts(export)]
pub enum ActionError {
    #[error("there is no source with id {id}")]
    UnknownSource { id: SourceId },
    #[error("a source with id {id} already exists")]
    DuplicateSource { id: SourceId },
    #[error("{id} is not a video")]
    NotAVideo { id: SourceId },
    #[error("nothing is lined up in the preview of the {screen:?} screen")]
    NothingInPreview { screen: ScreenId },
    #[error("the Monitor shows text only; it cannot show sources")]
    MonitorIsTextOnly,
    #[error("{field} is not valid: {reason}")]
    InvalidValue { field: String, reason: String },
}

impl ActionError {
    pub(crate) fn invalid(field: &str, reason: &str) -> Self {
        ActionError::InvalidValue {
            field: field.to_owned(),
            reason: reason.to_owned(),
        }
    }
}
