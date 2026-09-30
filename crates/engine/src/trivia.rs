//! A trivia game: questions on screen, everyone answers from their phone (the
//! same audience page), points for a right answer (more for a quick one),
//! and a leaderboard.

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::model::Millis;

pub const MAX_QUESTIONS: usize = 200;
pub const MAX_PLAYERS: usize = 5000;
/// Points for a right answer: half for being right, half for being quick.
pub const POINTS: u32 = 1000;

fn clean(s: &str, max: usize) -> String {
    s.trim()
        .chars()
        .filter(|c| !c.is_control())
        .take(max)
        .collect()
}

fn is_svg(s: &str) -> bool {
    s.len() <= 200_000 && s.trim_start().starts_with("<svg")
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", default)]
#[ts(export)]
pub struct TriviaQuestion {
    pub text: String,
    /// Two to four answers.
    pub options: Vec<String>,
    /// Which answer is right.
    pub correct: usize,
    /// Seconds to answer.
    pub seconds: u32,
}

impl Default for TriviaQuestion {
    fn default() -> Self {
        TriviaQuestion {
            text: String::new(),
            options: vec![String::new(), String::new()],
            correct: 0,
            seconds: 20,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct Player {
    /// The phone's own random name for itself.
    pub key: String,
    pub name: String,
    pub score: u32,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct TriviaAnswer {
    pub key: String,
    pub option: usize,
    /// Milliseconds after the question was asked.
    pub after_ms: u32,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub enum TriviaPhase {
    /// Players join; the code to scan is on screen.
    #[default]
    Join,
    /// A question is on screen and phones answer.
    Asking,
    /// The right answer is shown.
    Reveal,
    /// Who is winning.
    Leaderboard,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", default)]
#[ts(export)]
pub struct Trivia {
    pub title: String,
    pub questions: Vec<TriviaQuestion>,
    /// The question asked (or last asked).
    pub current: usize,
    pub phase: TriviaPhase,
    #[ts(type = "number")]
    pub asked_at: Millis,
    pub players: Vec<Player>,
    /// Answers to the current question.
    pub answers: Vec<TriviaAnswer>,
    pub join_url: String,
    pub join_qr: String,
    pub show_join: bool,
}

impl Default for Trivia {
    fn default() -> Self {
        Trivia {
            title: "Trivia".to_owned(),
            questions: Vec::new(),
            current: 0,
            phase: TriviaPhase::Join,
            asked_at: 0,
            players: Vec::new(),
            answers: Vec::new(),
            join_url: String::new(),
            join_qr: String::new(),
            show_join: true,
        }
    }
}

impl Trivia {
    pub fn repair(&mut self) {
        self.title = clean(&self.title, 80);
        self.questions.truncate(MAX_QUESTIONS);
        for q in &mut self.questions {
            q.text = clean(&q.text, 200);
            q.options.truncate(4);
            for o in &mut q.options {
                *o = clean(o, 80);
            }
            while q.options.len() < 2 {
                q.options.push(String::new());
            }
            q.correct = q.correct.min(q.options.len() - 1);
            q.seconds = q.seconds.clamp(5, 120);
        }
        if self.current >= self.questions.len() {
            self.current = 0;
        }
        self.players.truncate(MAX_PLAYERS);
        if !is_svg(&self.join_qr) {
            self.join_qr.clear();
        }
        self.join_url = clean(&self.join_url, 200);
    }

    /// Answers are being taken right now.
    #[must_use]
    pub fn taking(&self, now: Millis) -> bool {
        self.phase == TriviaPhase::Asking
            && self
                .questions
                .get(self.current)
                .is_some_and(|q| now < self.asked_at + Millis::from(q.seconds) * 1000)
    }

    /// Put question `index` on screen.
    pub fn ask(&mut self, index: usize, now: Millis) -> bool {
        if index >= self.questions.len() {
            return false;
        }
        self.current = index;
        self.phase = TriviaPhase::Asking;
        self.asked_at = now;
        self.answers.clear();
        true
    }

    /// An answer from a phone (the first one counts). False if not taking answers.
    pub fn answer(
        &mut self,
        key: &str,
        name: &str,
        question: usize,
        option: usize,
        now: Millis,
    ) -> bool {
        let key = clean(key, 64);
        if key.is_empty() || question != self.current || !self.taking(now) {
            return false;
        }
        let Some(q) = self.questions.get(self.current) else {
            return false;
        };
        if option >= q.options.len() || self.answers.iter().any(|a| a.key == key) {
            return false;
        }
        let name = clean(name, 30);
        if let Some(p) = self.players.iter_mut().find(|p| p.key == key) {
            if !name.is_empty() {
                p.name = name;
            }
        } else if self.players.len() < MAX_PLAYERS {
            self.players.push(Player {
                key: key.clone(),
                name: if name.is_empty() {
                    "Player".to_owned()
                } else {
                    name
                },
                score: 0,
            });
        } else {
            return false;
        }
        self.answers.push(TriviaAnswer {
            key,
            option,
            after_ms: u32::try_from(now.saturating_sub(self.asked_at)).unwrap_or(u32::MAX),
        });
        true
    }

    /// Points for an answer to the current question.
    #[must_use]
    pub fn points(&self, a: &TriviaAnswer) -> u32 {
        let Some(q) = self.questions.get(self.current) else {
            return 0;
        };
        if a.option != q.correct {
            return 0;
        }
        let limit = q.seconds.max(1) * 1000;
        let quick = limit.saturating_sub(a.after_ms.min(limit));
        POINTS / 2 + (u64::from(POINTS / 2) * u64::from(quick) / u64::from(limit)) as u32
    }

    /// Show the right answer and give the points (once).
    pub fn reveal(&mut self) -> bool {
        if self.phase != TriviaPhase::Asking {
            return false;
        }
        let scores: Vec<(String, u32)> = self
            .answers
            .iter()
            .map(|a| (a.key.clone(), self.points(a)))
            .collect();
        for (key, pts) in scores {
            if let Some(p) = self.players.iter_mut().find(|p| p.key == key) {
                p.score += pts;
            }
        }
        self.phase = TriviaPhase::Reveal;
        true
    }

    /// Everyone back to nothing (players stay).
    pub fn reset(&mut self) {
        for p in &mut self.players {
            p.score = 0;
        }
        self.answers.clear();
        self.phase = TriviaPhase::Join;
        self.current = 0;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn game() -> Trivia {
        let mut t = Trivia::default();
        t.questions.push(TriviaQuestion {
            text: "How many days of Chanukah?".into(),
            options: vec!["7".into(), "8".into(), "9".into()],
            correct: 1,
            seconds: 10,
        });
        t
    }

    #[test]
    fn quick_right_answers_score_most_and_only_once() {
        let mut t = game();
        assert!(!t.answer("a", "Ana", 0, 1, 5), "not asked yet");
        assert!(t.ask(0, 1000));
        assert!(t.answer("a", "Ana", 0, 1, 1000));
        assert!(!t.answer("a", "Ana", 0, 0, 1500), "one answer each");
        assert!(t.answer("b", "Ben", 0, 1, 6000));
        assert!(t.answer("c", "Chaya", 0, 2, 2000));
        assert!(!t.answer("d", "Dov", 0, 1, 11_000), "too late");
        assert!(t.reveal());
        assert!(!t.reveal(), "points are given once");
        let score = |t: &Trivia, k: &str| t.players.iter().find(|p| p.key == k).unwrap().score;
        assert_eq!(score(&t, "a"), 1000);
        assert_eq!(score(&t, "b"), 750);
        assert_eq!(score(&t, "c"), 0);
        t.reset();
        assert_eq!(score(&t, "a"), 0);
    }
}
