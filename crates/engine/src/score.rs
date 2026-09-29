//! Scoreboards: two teams, their scores, the period and a game clock, as a
//! corner bug, a bar or a full screen. Scores and the clock have their own
//! actions so a phone, Stream Deck or the app can run them during play.

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::model::Millis;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", default)]
#[ts(export)]
pub struct Team {
    pub name: String,
    /// Short name shown on the bug (e.g. "HOM").
    pub short: String,
    pub color: String,
    pub score: i32,
}

impl Default for Team {
    fn default() -> Self {
        Team {
            name: "Home".to_owned(),
            short: "HOM".to_owned(),
            color: "#2f80ed".to_owned(),
            score: 0,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub enum ScoreStyle {
    /// Small, in the top-left corner, like TV sport.
    #[default]
    Bug,
    /// A bar low in the middle.
    Bar,
    /// The whole screen: big numbers.
    Full,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub enum Side {
    Home,
    Away,
}

/// The game clock.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", default)]
#[ts(export)]
pub struct GameClock {
    /// Counts down from `length_ms` (else up from 0).
    pub count_down: bool,
    #[ts(type = "number")]
    pub length_ms: u64,
    /// Time already run before `since`.
    #[ts(type = "number")]
    pub run_ms: u64,
    /// Running since then (None: stopped).
    #[ts(type = "number | null")]
    pub since: Option<Millis>,
}

impl Default for GameClock {
    fn default() -> Self {
        GameClock {
            count_down: false,
            length_ms: 45 * 60 * 1000,
            run_ms: 0,
            since: None,
        }
    }
}

impl GameClock {
    /// Time run at `now`.
    #[must_use]
    pub fn elapsed(&self, now: Millis) -> u64 {
        self.run_ms + self.since.map_or(0, |s| now.saturating_sub(s))
    }

    /// What the clock shows at `now`, ms.
    #[must_use]
    pub fn shown(&self, now: Millis) -> u64 {
        let e = self.elapsed(now);
        if self.count_down {
            self.length_ms.saturating_sub(e)
        } else {
            e
        }
    }

    pub fn run(&mut self, on: bool, now: Millis) {
        match (on, self.since) {
            (true, None) => self.since = Some(now),
            (false, Some(_)) => {
                self.run_ms = self.elapsed(now);
                self.since = None;
            }
            _ => {}
        }
    }

    /// Make it show `ms` (keeps running if it was).
    pub fn set(&mut self, ms: u64, now: Millis) {
        self.run_ms = if self.count_down {
            self.length_ms.saturating_sub(ms)
        } else {
            ms
        };
        if self.since.is_some() {
            self.since = Some(now);
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", default)]
#[ts(export)]
pub struct Scoreboard {
    pub home: Team,
    pub away: Team,
    /// "1st half", "Q3", "Set 2"… (empty: none).
    pub period: String,
    pub clock: GameClock,
    pub show_clock: bool,
    pub style: ScoreStyle,
    /// A line over the full-screen board (the match or event).
    pub title: String,
}

impl Default for Scoreboard {
    fn default() -> Self {
        Scoreboard {
            home: Team::default(),
            away: Team {
                name: "Away".to_owned(),
                short: "AWY".to_owned(),
                color: "#e0473b".to_owned(),
                score: 0,
            },
            period: "1st".to_owned(),
            clock: GameClock::default(),
            show_clock: true,
            style: ScoreStyle::Bug,
            title: String::new(),
        }
    }
}

fn is_color(c: &str) -> bool {
    c.len() == 7 && c.starts_with('#') && c[1..].chars().all(|c| c.is_ascii_hexdigit())
}

impl Scoreboard {
    pub fn repair(&mut self) {
        for (t, d) in [(&mut self.home, "#2f80ed"), (&mut self.away, "#e0473b")] {
            t.name = t.name.chars().take(40).collect();
            t.short = t.short.chars().take(4).collect();
            if !is_color(&t.color) {
                d.clone_into(&mut t.color);
            }
            t.score = t.score.clamp(-999, 9999);
        }
        self.period = self.period.chars().take(20).collect();
        self.title = self.title.chars().take(80).collect();
        self.clock.length_ms = self.clock.length_ms.min(24 * 3_600_000);
    }

    pub fn team_mut(&mut self, side: Side) -> &mut Team {
        match side {
            Side::Home => &mut self.home,
            Side::Away => &mut self.away,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_clock_runs_stops_and_counts_down() {
        let mut c = GameClock::default();
        c.run(true, 1000);
        assert_eq!(c.shown(61_000), 60_000);
        c.run(false, 61_000);
        assert_eq!(c.shown(99_000), 60_000);
        c.count_down = true;
        c.length_ms = 120_000;
        assert_eq!(c.shown(0), 60_000);
        c.set(90_000, 5);
        assert_eq!(c.shown(1_000_000), 90_000);
        c.run(true, 0);
        assert_eq!(c.shown(200_000), 0);
    }
}
