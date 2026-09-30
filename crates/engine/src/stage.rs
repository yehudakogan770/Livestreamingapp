//! The stage monitor (text for the people on stage) and the countdown
//! (shown on the monitor, and as a big "hype" countdown on the Live and Back
//! screens).

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::model::{Millis, SourceId};

/// Longest monitor message, in characters.
pub const MAX_MESSAGE_LEN: usize = 200;
/// Longest quick message, countdown label or end text.
pub const MAX_SHORT_TEXT_LEN: usize = 60;
/// Number of quick messages.
pub const QUICK_MESSAGES: usize = 8;
/// How long the countdown holds on 0 before its at-zero action and fade.
pub const ZERO_HOLD_MS: u64 = 1_500;
/// Longest countdown: 24 hours.
pub const MAX_COUNTDOWN_MS: u64 = 24 * 60 * 60 * 1000;

/// How the monitor arranges the message, clock and countdown.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize, TS)]
#[serde(rename_all = "lowercase")]
#[ts(export)]
pub enum MonitorLayout {
    /// The message fills the screen (or the time, when there is no message).
    #[default]
    Full,
    /// Message on top, clock and countdown underneath.
    Stack,
    /// Message on the left, clock and countdown on the right.
    Split,
}

/// Size of the monitor message.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize, TS)]
#[serde(rename_all = "lowercase")]
#[ts(export)]
pub enum TextSize {
    S,
    M,
    #[default]
    L,
    Xl,
}

/// Everything the stage monitor shows.
// Each flag is an independent on/off setting the operator toggles; an enum would not fit.
#[allow(clippy::struct_excessive_bools)]
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", default)]
#[ts(export)]
pub struct Monitor {
    /// The message typed by the operator.
    pub message: String,
    /// Whether the message is on the monitor right now.
    pub message_on: bool,
    pub layout: MonitorLayout,
    pub show_clock: bool,
    pub show_timer: bool,
    /// A song on air on the Live Screen shows its words here too (the crew
    /// can turn this off).
    pub show_lyrics: bool,
    pub text_size: TextSize,
    /// 24-hour clock (19:42) instead of 12-hour (7:42 PM).
    pub clock_24h: bool,
    /// Messages one click away. Always exactly [`QUICK_MESSAGES`] entries.
    pub quick: Vec<String>,
    /// The teleprompter.
    pub prompter: crate::prompter::Prompter,
}

impl Default for Monitor {
    fn default() -> Self {
        Monitor {
            message: String::new(),
            message_on: false,
            layout: MonitorLayout::Full,
            show_clock: true,
            show_timer: true,
            show_lyrics: true,
            text_size: TextSize::L,
            clock_24h: false,
            quick: default_quick(),
            prompter: crate::prompter::Prompter::default(),
        }
    }
}

pub fn default_quick() -> Vec<String> {
    [
        "Please wrap up",
        "5 minutes left",
        "2 minutes left",
        "Speak louder",
        "Look at camera 2",
        "Next: video",
        "Stand by",
        "Thank you!",
    ]
    .map(str::to_owned)
    .to_vec()
}

/// How the countdown's time is written.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub enum TimerFormat {
    /// h:mm:ss over an hour, m:ss under, seconds only in the last minute.
    #[default]
    Auto,
    /// Always m:ss (minutes can go past 60).
    MinSec,
    /// Always h:mm:ss.
    HourMinSec,
}

/// What happens when the countdown reaches zero.
#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize, TS)]
#[serde(
    tag = "type",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
#[ts(export)]
pub enum AtZero {
    /// Stay on 0:00.
    Hold,
    /// Replace the numbers with the end text.
    ShowText,
    /// Take the numbers off; the countdown's background stays and its event
    /// logo (if it has one) fades in.
    Hide,
    /// Go to what is lined up in Next, with the chosen transition (with
    /// nothing in Next, the numbers just go, like Hide).
    #[default]
    TakeNext,
    /// Blank the screens the countdown is on.
    Blank,
    /// Cut the Live Screen to a source (e.g. the opening video).
    CutTo { source_id: SourceId },
}

/// The countdown. It goes on a screen as a Countdown input (lined up in
/// Next and taken to air like any other input); the stage monitor can show
/// it too. Its time is stored as "ends at" while running and "time
/// left" while paused, so every window can work out the time on its own.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", default)]
#[ts(export)]
pub struct Countdown {
    /// Length it starts from (and returns to on reset).
    #[ts(type = "number")]
    pub length_ms: u64,
    /// While running: the moment it reaches zero.
    #[ts(type = "number | null")]
    pub ends_at: Option<Millis>,
    /// While paused: time left.
    #[ts(type = "number")]
    pub remaining_ms: u64,
    /// Shown above the numbers, e.g. "Starting soon".
    pub label: String,
    /// Shown at zero when [`AtZero::ShowText`] is chosen.
    pub end_text: String,
    pub format: TimerFormat,
    pub at_zero: AtZero,
    /// True once the at-zero action has run, so it runs only once.
    pub fired: bool,
}

impl Default for Countdown {
    fn default() -> Self {
        Countdown {
            length_ms: 5 * 60 * 1000,
            ends_at: None,
            remaining_ms: 5 * 60 * 1000,
            label: "Starting soon".to_owned(),
            end_text: "Welcome!".to_owned(),
            format: TimerFormat::Auto,
            at_zero: AtZero::TakeNext,
            fired: false,
        }
    }
}

impl Countdown {
    /// Time left at `now`, in ms.
    pub fn remaining(&self, now: Millis) -> u64 {
        match self.ends_at {
            Some(end) => end.saturating_sub(now),
            None => self.remaining_ms,
        }
    }

    pub fn running(&self) -> bool {
        self.ends_at.is_some()
    }

    /// Running and reached zero.
    pub fn finished(&self, now: Millis) -> bool {
        self.running() && self.remaining(now) == 0
    }

    /// Reached zero and has held on 0 long enough: time for the at-zero action.
    pub fn due(&self, now: Millis) -> bool {
        self.ends_at
            .is_some_and(|end| now >= end.saturating_add(ZERO_HOLD_MS))
    }

    pub fn start(&mut self, now: Millis) {
        if self.running() {
            return;
        }
        if self.remaining_ms == 0 {
            self.remaining_ms = self.length_ms;
        }
        self.ends_at = Some(now + self.remaining_ms);
        self.fired = false;
    }

    pub fn pause(&mut self, now: Millis) {
        self.remaining_ms = self.remaining(now);
        self.ends_at = None;
    }

    pub fn reset(&mut self) {
        self.ends_at = None;
        self.remaining_ms = self.length_ms;
        self.fired = false;
    }

    /// Add (or with a negative amount, take away) time. Works at any moment,
    /// including the last seconds and after zero: the countdown carries on
    /// from the new time.
    pub fn add(&mut self, ms: i64, now: Millis) {
        let left = i64::try_from(self.remaining(now)).unwrap_or(i64::MAX);
        let max = i64::try_from(MAX_COUNTDOWN_MS).unwrap_or(i64::MAX);
        let next = u64::try_from(left.saturating_add(ms).clamp(0, max)).unwrap_or(0);
        self.set_remaining(next, now);
    }

    /// Jump to a time left (e.g. the last 10 seconds), keeping play state.
    pub fn set_remaining(&mut self, ms: u64, now: Millis) {
        let ms = ms.min(MAX_COUNTDOWN_MS);
        if self.running() {
            self.ends_at = Some(now + ms);
        } else {
            self.remaining_ms = ms;
        }
        if ms > 0 {
            self.fired = false;
        }
    }
}
