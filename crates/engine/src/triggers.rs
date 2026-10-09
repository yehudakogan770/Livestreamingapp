//! Triggers: "when this happens, do that". When a video ends (or is about
//! to), an input goes on or off air, an input loses its picture or gets it
//! back, a countdown reaches zero, or at a clock time, a list of steps runs by
//! itself (the same steps preset buttons and cues use).
//!
//! Two kinds are watched by the control window, which runs them with
//! `FireTrigger`: a sound level held for a while (someone starts talking, the
//! room goes quiet), and the recording or the stream starting or stopping.
//! The engine never sets those off itself.

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::model::{Millis, ScreenId, Show, SourceId, SourceKind};
use crate::presets::Step;
use crate::timing::{source_ended, source_position};

/// Most triggers in a show.
pub const MAX_TRIGGERS: usize = 100;

/// What sets a trigger off.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(
    tag = "type",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
#[ts(export)]
pub enum When {
    /// A video reaches its end (looping videos never do).
    VideoEnds { source_id: SourceId },
    /// An input goes on air (on one screen, or either if left out).
    OnAir {
        source_id: SourceId,
        #[serde(default)]
        screen: Option<ScreenId>,
    },
    /// An input leaves the air.
    OffAir {
        source_id: SourceId,
        #[serde(default)]
        screen: Option<ScreenId>,
    },
    /// A countdown reaches zero.
    CountdownZero { source_id: SourceId },
    /// Every day at this clock time (minutes after midnight, this computer's
    /// time zone given as its offset from UTC).
    AtTime { minute: u32, utc_offset_min: i32 },
    /// A playing video has this many seconds left (once per play).
    VideoTimeLeft { source_id: SourceId, seconds: u32 },
    /// An input stops sending a picture (a camera unplugged, a stream down).
    InputLost { source_id: SourceId },
    /// An input that had lost its picture has it again.
    InputBack { source_id: SourceId },
    /// An input's sound stays above (or below) a level for a while
    /// (watched by the control window).
    Sound {
        source_id: SourceId,
        /// Above the level (someone talks) or below it (quiet).
        above: bool,
        /// The level, in dB below full scale (-60 – 0).
        db: i32,
        /// How long it has to stay that way first.
        hold_ms: u32,
    },
    /// The recording or the stream starts (`on`) or stops (watched by the
    /// control window).
    Broadcast { what: BroadcastWhat, on: bool },
    /// Over and over, this many minutes apart (a sponsor logo every 10
    /// minutes). Counted from when it was made, or last went off.
    Every { minutes: u32 },
}

/// What a [`When::Broadcast`] trigger watches.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub enum BroadcastWhat {
    Record,
    Stream,
}

/// One trigger.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct Trigger {
    pub id: String,
    pub name: String,
    pub enabled: bool,
    pub when: When,
    pub steps: Vec<Step>,
    /// When it last went off.
    #[serde(default)]
    #[ts(type = "number")]
    pub last_fired: Millis,
}

fn on_air(show: &Show, id: &SourceId, screen: Option<ScreenId>) -> bool {
    let screens: &[ScreenId] = match screen {
        Some(ScreenId::Live) => &[ScreenId::Live],
        Some(ScreenId::Back) => &[ScreenId::Back],
        _ => &[ScreenId::Live, ScreenId::Back],
    };
    screens
        .iter()
        .any(|sc| show.screens.get(*sc).program.as_ref() == Some(id))
}

fn lost(show: &Show, id: &SourceId) -> bool {
    show.no_signal.contains(id)
}

/// Seconds left of a playing video (None: not a video, not playing, or its
/// length isn't known yet).
fn seconds_left(show: &Show, id: &SourceId, now: Millis) -> Option<f64> {
    let src = show.source(id)?;
    match &src.kind {
        SourceKind::Video {
            duration_s,
            playback,
            ..
        } if playback.playing && *duration_s > 0.0 => Some(duration_s - source_position(src, now)),
        _ => None,
    }
}

fn countdown_fired(show: &Show, id: &SourceId) -> bool {
    matches!(show.source(id).map(|s| &s.kind), Some(SourceKind::Countdown { timer, .. }) if timer.fired)
}

/// Local minute of the day at `now`.
fn minute_of_day(now: Millis, utc_offset_min: i32) -> i64 {
    (i64::try_from(now / 60_000).unwrap_or(0) + i64::from(utc_offset_min)).rem_euclid(24 * 60)
}

/// The triggers that go off between `before` and `after` (a change to the
/// show at `now`), and those due by the clock.
pub fn due(before: &Show, after: &Show, now: Millis) -> Vec<usize> {
    after
        .triggers
        .iter()
        .enumerate()
        .filter(|(_, t)| t.enabled)
        .filter(|(_, t)| match &t.when {
            When::OnAir { source_id, screen } => {
                !on_air(before, source_id, *screen) && on_air(after, source_id, *screen)
            }
            When::OffAir { source_id, screen } => {
                on_air(before, source_id, *screen) && !on_air(after, source_id, *screen)
            }
            When::CountdownZero { source_id } => {
                !countdown_fired(before, source_id) && countdown_fired(after, source_id)
            }
            When::VideoEnds { source_id } => after.source(source_id).is_some_and(|src| {
                let started = match &src.kind {
                    SourceKind::Video { playback, .. } => playback.at,
                    _ => return false,
                };
                // Once per play: ended since it last started, not yet fired for it.
                t.last_fired < started.max(1) && source_ended(src, now)
            }),
            When::AtTime {
                minute,
                utc_offset_min,
            } => {
                minute_of_day(now, *utc_offset_min) == i64::from(*minute)
                    && now.saturating_sub(t.last_fired) > 90_000
            }
            When::VideoTimeLeft { source_id, seconds } => {
                let Some(left) = seconds_left(after, source_id, now) else {
                    return false;
                };
                let started = match after.source(source_id).map(|s| &s.kind) {
                    Some(SourceKind::Video { playback, .. }) => playback.at,
                    _ => return false,
                };
                // Once per play, and only while it is still playing.
                t.last_fired < started.max(1) && left > 0.05 && left <= f64::from(*seconds)
            }
            When::InputLost { source_id } => !lost(before, source_id) && lost(after, source_id),
            When::InputBack { source_id } => lost(before, source_id) && !lost(after, source_id),
            When::Every { minutes } => {
                t.last_fired > 0
                    && now.saturating_sub(t.last_fired) >= u64::from(*minutes).max(1) * 60_000
            }
            When::Sound { .. } | When::Broadcast { .. } => false,
        })
        .map(|(i, _)| i)
        .collect()
}

/// Any trigger due by the clock alone (video ends, clock times)?
pub fn clock_due(show: &Show, now: Millis) -> bool {
    show.triggers.iter().any(|t| {
        t.enabled
            && matches!(
                t.when,
                When::VideoEnds { .. }
                    | When::AtTime { .. }
                    | When::VideoTimeLeft { .. }
                    | When::Every { .. }
            )
    }) && !due(show, show, now).is_empty()
}

impl Trigger {
    pub fn repair(&mut self) {
        self.name = self.name.chars().take(80).collect();
        if let When::AtTime {
            minute,
            utc_offset_min,
        } = &mut self.when
        {
            *minute = (*minute).min(24 * 60 - 1);
            *utc_offset_min = (*utc_offset_min).clamp(-14 * 60, 14 * 60);
        }
        match &mut self.when {
            When::VideoTimeLeft { seconds, .. } => *seconds = (*seconds).clamp(1, 600),
            When::Every { minutes } => *minutes = (*minutes).clamp(1, 24 * 60),
            When::Sound { db, hold_ms, .. } => {
                *db = (*db).clamp(-60, 0);
                *hold_ms = (*hold_ms).min(10 * 60_000);
            }
            _ => {}
        }
    }
}
