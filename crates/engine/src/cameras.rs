//! Cameras: switching between them by itself (auto-switch), and each
//! camera's own settings — zoom, focus, exposure, white balance, pan and
//! tilt — with saved shots to go back to.

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::model::{Millis, ScreenId, Show, SourceId, SourceKind, Transition, TransitionKind};

/// Shortest and longest time on one camera, seconds.
pub const MIN_SHOT_S: u32 = 2;
pub const MAX_SHOT_S: u32 = 600;
/// Most saved shots per camera, and settings per shot.
pub const MAX_SHOTS: usize = 24;
pub const MAX_VALUES: usize = 24;

/// Going through the cameras by itself on the Live Screen.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", default)]
#[ts(export)]
pub struct AutoSwitch {
    pub on: bool,
    /// The cameras (or any inputs) it goes between, in order.
    pub cameras: Vec<SourceId>,
    /// Each shot lasts between these, seconds (the same for a steady beat).
    pub min_s: u32,
    pub max_s: u32,
    /// Mixed up (never the same twice in a row) instead of in order.
    pub random: bool,
    /// A quick mix between cameras instead of a cut.
    pub mix: bool,
    /// When the next switch is due.
    #[ts(type = "number")]
    pub next_at: Millis,
    /// Changes every switch, for the mixed-up order and shot lengths.
    pub seed: u32,
}

impl Default for AutoSwitch {
    fn default() -> Self {
        AutoSwitch {
            on: false,
            cameras: Vec::new(),
            min_s: 6,
            max_s: 10,
            random: false,
            mix: false,
            next_at: 0,
            seed: 1,
        }
    }
}

impl AutoSwitch {
    pub fn repair(&mut self, s: &[crate::model::Source]) {
        self.cameras.retain(|id| s.iter().any(|x| &x.id == id));
        self.cameras.dedup();
        self.cameras.truncate(32);
        self.min_s = self.min_s.clamp(MIN_SHOT_S, MAX_SHOT_S);
        self.max_s = self.max_s.clamp(self.min_s, MAX_SHOT_S);
        if self.cameras.len() < 2 {
            self.on = false;
        }
    }

    fn roll(&mut self) -> u32 {
        // A small, steady mix-up (xorshift), so the same show replays the same.
        let mut x = self.seed.max(1);
        x ^= x << 13;
        x ^= x >> 17;
        x ^= x << 5;
        self.seed = x;
        x
    }

    /// When the next switch is due, from `now`.
    pub fn schedule(&mut self, now: Millis) {
        let spread = self.max_s.saturating_sub(self.min_s);
        let extra = if spread == 0 {
            0
        } else {
            self.roll() % (spread + 1)
        };
        self.next_at = now + u64::from(self.min_s + extra) * 1000;
    }

    /// The camera after `current`.
    pub fn pick(&mut self, current: Option<&SourceId>) -> Option<SourceId> {
        let n = self.cameras.len();
        if n == 0 {
            return None;
        }
        let at = current.and_then(|c| self.cameras.iter().position(|x| x == c));
        let i = match (self.random, at) {
            (true, Some(a)) if n > 1 => {
                let step = 1 + (self.roll() as usize) % (n - 1);
                (a + step) % n
            }
            (true, None) => (self.roll() as usize) % n,
            (_, Some(a)) => (a + 1) % n,
            (false, None) => 0,
        };
        self.cameras.get(i).cloned()
    }
}

/// Time for the auto-switch to move on: it is on, due, and one of its
/// cameras is on air (anything else on air — a video, a title — holds it).
pub fn switch_due(s: &Show, now: Millis) -> bool {
    let a = &s.auto_switch;
    a.on && a.cameras.len() >= 2
        && now >= a.next_at
        && s.screens
            .live
            .program
            .as_ref()
            .is_some_and(|p| a.cameras.contains(p))
}

/// The switch to make now (the auto-switch is moved on), if one is due.
pub fn switch_action(s: &mut Show, now: Millis) -> Option<crate::action::Action> {
    if !switch_due(s, now) {
        return None;
    }
    let current = s.screens.live.program.clone();
    let a = &mut s.auto_switch;
    let next = a.pick(current.as_ref())?;
    a.schedule(now);
    Some(if a.mix {
        crate::action::Action::PlayNow {
            screen: ScreenId::Live,
            source_id: next,
            transition: Transition {
                kind: TransitionKind::Fade,
                duration_ms: 600,
            },
        }
    } else {
        crate::action::Action::CutTo {
            screen: ScreenId::Live,
            source_id: next,
        }
    })
}

/// One camera setting ("zoom", "focusDistance", "exposureMode"…) and its value.
/// Modes are numbers too: 0 manual, 1 automatic.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct CameraValue {
    pub name: String,
    pub value: f64,
}

/// A saved shot: the settings to go back to.
#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", default)]
#[ts(export)]
pub struct CameraShot {
    pub name: String,
    pub values: Vec<CameraValue>,
}

/// A camera's own settings, kept with the event.
#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", default)]
#[ts(export)]
pub struct CameraControls {
    /// The settings now (only those changed from the camera's own).
    pub values: Vec<CameraValue>,
    pub shots: Vec<CameraShot>,
}

fn clean_values(v: &mut Vec<CameraValue>) {
    v.retain(|x| x.value.is_finite() && !x.name.trim().is_empty());
    for x in v.iter_mut() {
        x.name = x
            .name
            .chars()
            .filter(char::is_ascii_alphanumeric)
            .take(40)
            .collect();
    }
    v.dedup_by(|a, b| a.name == b.name);
    v.truncate(MAX_VALUES);
}

impl CameraControls {
    pub fn repair(&mut self) {
        clean_values(&mut self.values);
        self.shots.truncate(MAX_SHOTS);
        for s in &mut self.shots {
            s.name = crate::engine::short_text(&s.name, 40);
            clean_values(&mut s.values);
        }
    }
}

/// A camera input (the only kind with these settings).
pub fn is_camera(kind: &SourceKind) -> bool {
    matches!(kind, SourceKind::Camera { .. })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ids(n: usize) -> Vec<SourceId> {
        (0..n).map(|i| SourceId::new(format!("cam{i}"))).collect()
    }

    #[test]
    fn in_order_goes_round_and_random_never_repeats() {
        let mut a = AutoSwitch {
            cameras: ids(3),
            ..AutoSwitch::default()
        };
        let c = ids(3);
        assert_eq!(a.pick(Some(&c[0])), Some(c[1].clone()));
        assert_eq!(a.pick(Some(&c[2])), Some(c[0].clone()));
        a.random = true;
        let mut at = c[0].clone();
        for _ in 0..50 {
            let next = a.pick(Some(&at)).unwrap();
            assert_ne!(next, at);
            at = next;
        }
    }

    #[test]
    fn shots_last_between_the_times_chosen() {
        let mut a = AutoSwitch {
            min_s: 3,
            max_s: 5,
            ..AutoSwitch::default()
        };
        for _ in 0..50 {
            a.schedule(1000);
            assert!((4000..=6000).contains(&a.next_at));
        }
    }
}
