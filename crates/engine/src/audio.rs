//! Sound: how each source is heard, the three mixes (Stream, Hall,
//! Recording), headphone solo, and which speaker each mix goes to.

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::model::SourceId;

/// Longest sound delay per input, in ms.
pub const MAX_AUDIO_DELAY_MS: u32 = 5_000;
/// Longest mix name.
pub const MAX_BUS_NAME_LEN: usize = 24;

/// How one source is heard.
// Each flag is an independent switch on the channel strip.
#[allow(clippy::struct_excessive_bools)]
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", default)]
#[ts(export)]
pub struct SourceAudio {
    /// Audio follows video: heard only while on air on the Live Screen,
    /// fading with the transition. Off for microphones and music beds.
    pub follow: bool,
    /// Sent to the Stream mix (master).
    pub to_master: bool,
    /// Sent to mix A (the hall speakers).
    pub to_a: bool,
    /// Sent to mix B (the recording).
    pub to_b: bool,
    /// Sound delay, to line up with the picture.
    pub delay_ms: u32,
}

impl Default for SourceAudio {
    fn default() -> Self {
        SourceAudio {
            follow: true,
            to_master: true,
            to_a: true,
            to_b: true,
            delay_ms: 0,
        }
    }
}

impl SourceAudio {
    /// A live sound source (microphone): always heard, not tied to the picture.
    pub fn live() -> Self {
        SourceAudio {
            follow: false,
            ..SourceAudio::default()
        }
    }
}

/// Changes to a source's sound. Fields left out stay as they are.
#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct SourceAudioPatch {
    #[serde(default)]
    #[ts(optional)]
    pub follow: Option<bool>,
    #[serde(default)]
    #[ts(optional)]
    pub to_master: Option<bool>,
    #[serde(default)]
    #[ts(optional)]
    pub to_a: Option<bool>,
    #[serde(default)]
    #[ts(optional)]
    pub to_b: Option<bool>,
    #[serde(default)]
    #[ts(optional)]
    pub delay_ms: Option<u32>,
}

impl SourceAudio {
    pub fn apply(&mut self, p: &SourceAudioPatch) {
        if let Some(v) = p.follow {
            self.follow = v;
        }
        if let Some(v) = p.to_master {
            self.to_master = v;
        }
        if let Some(v) = p.to_a {
            self.to_a = v;
        }
        if let Some(v) = p.to_b {
            self.to_b = v;
        }
        if let Some(v) = p.delay_ms {
            self.delay_ms = v.min(MAX_AUDIO_DELAY_MS);
        }
    }
}

/// One of the extra mixes.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "lowercase")]
#[ts(export)]
pub enum BusId {
    A,
    B,
}

/// An extra mix (A: hall speakers, B: recording).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", default)]
#[ts(export)]
pub struct Bus {
    pub name: String,
    /// 0.0 – 1.0
    pub volume: f32,
    pub muted: bool,
}

impl Default for Bus {
    fn default() -> Self {
        Bus {
            name: String::new(),
            volume: 1.0,
            muted: false,
        }
    }
}

/// Changes to a mix. Fields left out stay as they are.
#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct BusPatch {
    #[serde(default)]
    #[ts(optional)]
    pub name: Option<String>,
    #[serde(default)]
    #[ts(optional)]
    pub volume: Option<f32>,
    #[serde(default)]
    #[ts(optional)]
    pub muted: Option<bool>,
}

/// The mixes and the headphone solo. The Stream mix's level is
/// `Show::master_volume`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", default)]
#[ts(export)]
pub struct AudioMix {
    pub master_muted: bool,
    pub a: Bus,
    pub b: Bus,
    /// The source heard in the headphones on its own (none: headphones hear the Stream mix).
    pub solo: Option<SourceId>,
}

impl Default for AudioMix {
    fn default() -> Self {
        AudioMix {
            master_muted: false,
            a: Bus {
                name: "Hall".to_owned(),
                ..Bus::default()
            },
            b: Bus {
                name: "Recording".to_owned(),
                ..Bus::default()
            },
            solo: None,
        }
    }
}

/// Where each mix is played.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "lowercase")]
#[ts(export)]
pub enum AudioOutputId {
    Master,
    A,
    B,
    Headphones,
}

/// The sound device (speakers, headphones, audio interface output) each mix
/// goes to. For the Stream mix `None` means the computer's default speakers;
/// for Hall, Recording and Headphones `None` means not played anywhere, so a
/// mix is never doubled on the same speakers by accident.
#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", default)]
#[ts(export)]
pub struct AudioOutputs {
    pub master: Option<String>,
    pub a: Option<String>,
    pub b: Option<String>,
    pub headphones: Option<String>,
}

impl AudioOutputs {
    pub fn get_mut(&mut self, id: AudioOutputId) -> &mut Option<String> {
        match id {
            AudioOutputId::Master => &mut self.master,
            AudioOutputId::A => &mut self.a,
            AudioOutputId::B => &mut self.b,
            AudioOutputId::Headphones => &mut self.headphones,
        }
    }
}
