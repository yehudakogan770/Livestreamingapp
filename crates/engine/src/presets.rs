//! Presets (the segments of an event, like "Opening" or "Speaker") and the
//! steps their buttons run, one after another, with waits in between.

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::model::{Millis, ScreenId, SourceId, Transition, TransitionKind};

/// Longest preset, category or button name.
pub const MAX_PRESET_NAME_LEN: usize = 40;
/// Most steps in one button.
pub const MAX_STEPS: usize = 50;
/// Longest wait in one step.
pub const MAX_WAIT_MS: u32 = 10 * 60 * 1000;

/// One thing a preset button (or a cue) does.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(
    tag = "type",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
#[ts(export)]
pub enum Step {
    /// Line an input up in Next (or clear Next).
    Preview {
        screen: ScreenId,
        source_id: Option<SourceId>,
    },
    /// TAKE what is in Next, with a transition (the show's if left out).
    Take {
        screen: ScreenId,
        #[serde(default)]
        #[ts(optional)]
        transition: Option<TransitionKind>,
    },
    /// Put an input straight on air.
    CutTo {
        screen: ScreenId,
        source_id: SourceId,
    },
    Blank {
        screens: Vec<ScreenId>,
        value: bool,
    },
    /// Show a message on the stage monitor.
    MonitorMessage {
        text: String,
    },
    ClearMonitorMessage,
    // Countdown steps name a countdown input, or none for the main one
    // (the one on air, or else the first).
    StartCountdown {
        #[serde(default)]
        #[ts(optional)]
        source_id: Option<SourceId>,
    },
    PauseCountdown {
        #[serde(default)]
        #[ts(optional)]
        source_id: Option<SourceId>,
    },
    ResetCountdown {
        #[serde(default)]
        #[ts(optional)]
        source_id: Option<SourceId>,
    },
    SetCountdownLength {
        #[serde(default)]
        #[ts(optional)]
        source_id: Option<SourceId>,
        #[ts(type = "number")]
        length_ms: u64,
    },
    Play {
        source_id: SourceId,
    },
    Pause {
        source_id: SourceId,
    },
    BackFollowsLive {
        value: bool,
    },
    /// Pick another preset.
    Preset {
        preset_id: String,
    },
    /// Put an overlay on or take it off (channel 0 – 3).
    Overlay {
        channel: usize,
        value: bool,
    },
    /// Wait before the next step.
    Wait {
        ms: u32,
    },
    /// Start (`on`) or stop the recording (done by the control window).
    Record {
        on: bool,
    },
    /// Go live (`on`) or end the stream (done by the control window).
    Stream {
        on: bool,
    },
    /// Replay the last seconds into Next (done by the control window).
    Replay {
        seconds: u32,
        #[serde(default)]
        slow: bool,
    },
    /// Run a macro (it runs beside these steps).
    Macro {
        macro_id: String,
    },
    /// Show the next (`delta` 1) or previous (-1) row of the data file.
    DataStep {
        delta: i32,
    },
}

/// A named button: its steps run in order when pressed.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", default)]
#[ts(export)]
pub struct PresetButton {
    pub name: String,
    pub steps: Vec<Step>,
}

impl Default for PresetButton {
    fn default() -> Self {
        PresetButton {
            name: "Button".to_owned(),
            steps: Vec::new(),
        }
    }
}

/// A segment of the event.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", default)]
#[ts(export)]
pub struct Preset {
    pub id: String,
    pub name: String,
    /// Grouping in the list, e.g. "Speeches".
    pub category: String,
    /// The screen it works on (Live or Back).
    pub screen: ScreenId,
    /// The inputs this segment uses. While it is picked, only these show on
    /// the main screen. Empty: all inputs.
    pub sources: Vec<SourceId>,
    /// Transition to use while it is picked (the show's stays if none).
    pub transition: Option<Transition>,
    /// When picked, line its first input up in Next.
    pub load_first: bool,
    pub buttons: Vec<PresetButton>,
}

impl Default for Preset {
    fn default() -> Self {
        Preset {
            id: String::new(),
            name: "Preset".to_owned(),
            category: String::new(),
            screen: ScreenId::Live,
            sources: Vec::new(),
            transition: None,
            load_first: true,
            buttons: Vec::new(),
        }
    }
}

/// Steps being run, resumed by the engine's heartbeat after a wait.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct RunningSteps {
    /// What started it (a button name), for the operator.
    pub name: String,
    pub steps: Vec<Step>,
    pub next: usize,
    #[ts(type = "number")]
    pub resume_at: Millis,
}
