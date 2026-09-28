//! Run of show: the event as a list of cues, grouped in sections. Each cue
//! runs its steps (the same steps as preset buttons) when its time comes:
//! on the clock, after the previous cue's length, or when the operator
//! presses NEXT CUE.

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::model::Millis;
use crate::presets::Step;

/// Most cues.
pub const MAX_CUES: usize = 300;

/// How a cue starts.
#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize, TS)]
#[serde(
    tag = "type",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
#[ts(export)]
pub enum CueTrigger {
    /// When the operator presses NEXT CUE (or the phone).
    #[default]
    Manual,
    /// At a time of day, "19:30" or "19:30:15" (local time).
    Clock { time: String },
    /// When the cue before has run for its length.
    AfterPrevious,
}

/// One cue.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", default)]
#[ts(export)]
pub struct Cue {
    pub id: String,
    /// The section it belongs to, e.g. "Opening".
    pub section: String,
    pub name: String,
    pub trigger: CueTrigger,
    /// How long it runs (for the timeline, and for a next cue set to
    /// "after the previous").
    pub length_ms: Option<u32>,
    pub steps: Vec<Step>,
}

impl Default for Cue {
    fn default() -> Self {
        Cue {
            id: String::new(),
            section: String::new(),
            name: "Cue".to_owned(),
            trigger: CueTrigger::Manual,
            length_ms: None,
            steps: Vec::new(),
        }
    }
}

/// The run of show and where it is.
#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", default)]
#[ts(export)]
pub struct RunOfShow {
    pub cues: Vec<Cue>,
    /// Started (cues on the clock and "after the previous" fire by themselves).
    pub running: bool,
    /// Held: nothing fires by itself until it carries on.
    pub paused: bool,
    /// The last cue that ran.
    pub current: Option<usize>,
    /// When it ran.
    #[ts(type = "number")]
    pub cue_started_at: Millis,
    /// When the show was started.
    #[ts(type = "number")]
    pub started_at: Millis,
    /// The computer's local time offset from UTC, in minutes (for clock cues).
    pub utc_offset_min: i32,
}

/// "19:30" / "19:30:15" as seconds after midnight.
pub fn clock_seconds(time: &str) -> Option<u32> {
    let mut parts = time.trim().split(':').map(str::parse::<u32>);
    let h = parts.next()?.ok()?;
    let m = parts.next()?.ok()?;
    let s = parts.next().transpose().ok()?.unwrap_or(0);
    (h < 24 && m < 60 && s < 60 && parts.next().is_none()).then_some(h * 3600 + m * 60 + s)
}

impl RunOfShow {
    /// The cue that comes next.
    pub fn next_index(&self) -> Option<usize> {
        let i = self.current.map_or(0, |c| c + 1);
        (i < self.cues.len()).then_some(i)
    }

    /// Seconds after local midnight at `now`.
    pub fn local_seconds(&self, now: Millis) -> u32 {
        let secs = i64::try_from(now / 1000).unwrap_or(0) + i64::from(self.utc_offset_min) * 60;
        u32::try_from(secs.rem_euclid(86_400)).unwrap_or(0)
    }

    /// The next cue, if it is time for it to run by itself.
    pub fn due(&self, now: Millis) -> Option<usize> {
        if !self.running || self.paused {
            return None;
        }
        let i = self.next_index()?;
        let ready = match &self.cues[i].trigger {
            CueTrigger::Manual => false,
            CueTrigger::Clock { time } => clock_seconds(time).is_some_and(|at| {
                let t = self.local_seconds(now);
                // Due from its time for the next 12 hours (so a late start
                // still runs it, but an evening cue never fires next morning).
                t >= at && t - at < 12 * 3600
            }),
            CueTrigger::AfterPrevious => match self.current.and_then(|c| self.cues[c].length_ms) {
                Some(len) => now >= self.cue_started_at.saturating_add(u64::from(len)),
                None => false,
            },
        };
        ready.then_some(i)
    }

    pub fn repair(&mut self) {
        self.cues.truncate(MAX_CUES);
        for (n, c) in self.cues.iter_mut().enumerate() {
            if c.id.trim().is_empty() {
                c.id = format!("cue-{}", n + 1);
            }
            c.name = crate::engine::short_text(&c.name, 80);
            c.section = crate::engine::short_text(&c.section, 60);
            c.length_ms = c.length_ms.map(|l| l.clamp(1000, 24 * 3600 * 1000));
            if let CueTrigger::Clock { time } = &c.trigger {
                if clock_seconds(time).is_none() {
                    c.trigger = CueTrigger::Manual;
                }
            }
        }
        if self.current.is_some_and(|c| c >= self.cues.len()) {
            self.current = None;
        }
        self.utc_offset_min = self.utc_offset_min.clamp(-14 * 60, 14 * 60);
    }
}
