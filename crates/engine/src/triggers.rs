//! Triggers: "when this happens, do that". When a video ends, an input goes
//! on or off air, a countdown reaches zero, or at a clock time, a list of
//! steps runs by itself (the same steps preset buttons and cues use).

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::model::{Millis, ScreenId, Show, SourceId, SourceKind};
use crate::presets::Step;
use crate::timing::source_ended;

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
        })
        .map(|(i, _)| i)
        .collect()
}

/// Any trigger due by the clock alone (video ends, clock times)?
pub fn clock_due(show: &Show, now: Millis) -> bool {
    show.triggers
        .iter()
        .any(|t| t.enabled && matches!(t.when, When::VideoEnds { .. } | When::AtTime { .. }))
        && !due(show, show, now).is_empty()
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
    }
}
