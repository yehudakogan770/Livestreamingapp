//! The teleprompter on the stage monitor: the speaker's script scrolling up
//! past a reading line, run by the operator (never from the stage).

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::model::Millis;

/// Longest script, in characters.
pub const MAX_SCRIPT: usize = 60_000;

#[allow(clippy::struct_excessive_bools)]
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", default)]
#[ts(export)]
pub struct Prompter {
    /// Shown on the stage monitor instead of the usual screen.
    pub on: bool,
    pub script: String,
    /// Scrolling speed, in % of the monitor's height a second.
    pub speed: f32,
    /// Text size, in % of the monitor's height.
    pub size: f32,
    /// Mirrored left to right (for a glass prompter over a camera).
    pub mirror: bool,
    /// How far the script has moved, in % of the monitor's height, at `since` (or now, when stopped).
    pub pos: f32,
    /// Moving since then (None: stopped).
    #[ts(type = "number | null")]
    pub since: Option<Millis>,
}

impl Default for Prompter {
    fn default() -> Self {
        Prompter {
            on: false,
            script: String::new(),
            speed: 4.0,
            size: 8.0,
            mirror: false,
            pos: 0.0,
            since: None,
        }
    }
}

fn finite(v: f32, lo: f32, hi: f32, fallback: f32) -> f32 {
    if v.is_finite() {
        v.clamp(lo, hi)
    } else {
        fallback
    }
}

impl Prompter {
    pub fn repair(&mut self) {
        self.script = self
            .script
            .chars()
            .filter(|c| !c.is_control() || *c == '\n')
            .take(MAX_SCRIPT)
            .collect();
        self.speed = finite(self.speed, 0.5, 30.0, 4.0);
        self.size = finite(self.size, 3.0, 20.0, 8.0);
        self.pos = finite(self.pos, -100.0, 100_000.0, 0.0);
    }

    /// Where the script is at `now`.
    #[must_use]
    pub fn at(&self, now: Millis) -> f32 {
        #[allow(clippy::cast_precision_loss)]
        let moved = self
            .since
            .map_or(0.0, |s| now.saturating_sub(s) as f32 / 1000.0 * self.speed);
        self.pos + moved
    }

    /// Start or stop scrolling (where it is stays).
    pub fn run(&mut self, run: bool, now: Millis) {
        self.pos = self.at(now);
        self.since = run.then_some(now);
    }

    /// Put the script at `pos` (keeps scrolling if it was).
    pub fn jump(&mut self, pos: f32, now: Millis) {
        self.pos = finite(pos, -100.0, 100_000.0, 0.0);
        if self.since.is_some() {
            self.since = Some(now);
        }
    }

    /// A new speed, carrying on smoothly from where it is.
    pub fn set_speed(&mut self, speed: f32, now: Millis) {
        let running = self.since.is_some();
        self.run(running, now);
        self.speed = finite(speed, 0.5, 30.0, self.speed);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn scrolls_while_running_and_carries_on_smoothly() {
        let mut p = Prompter::default();
        p.run(true, 1000);
        assert!((p.at(3000) - 8.0).abs() < 0.01, "4 a second for 2 s");
        p.set_speed(8.0, 3000);
        assert!((p.at(4000) - 16.0).abs() < 0.01);
        p.run(false, 4000);
        assert!((p.at(9000) - 16.0).abs() < 0.01, "stopped");
        p.jump(0.0, 9000);
        assert!(p.at(9500).abs() < 0.01);
    }
}
