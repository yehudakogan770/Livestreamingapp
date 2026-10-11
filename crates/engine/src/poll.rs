//! Audience polls: a question with up to eight answers, a word cloud, or a
//! rating from one to five stars. People answer from their phones (the
//! phone remote's server, on the venue network, without the operator's
//! PIN); the results show on screen as bars, a cloud or stars.

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::model::Millis;

pub const MAX_OPTIONS: usize = 8;
/// Most different words a word cloud keeps.
pub const MAX_WORDS: usize = 400;
/// Longest word (or short phrase) a phone may send to a word cloud.
pub const MAX_WORD_CHARS: usize = 32;
/// Most comments a rating keeps (the oldest go first).
pub const MAX_COMMENTS: usize = 500;
/// Stars in a rating.
pub const STARS: usize = 5;

/// What a poll asks for.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub enum PollKind {
    /// Pick one of the answers.
    #[default]
    Choice,
    /// Type a word or two; the most sent are drawn biggest.
    Words,
    /// One to five stars, with an optional comment.
    Rating,
}

/// A word sent to a word cloud and how many phones sent it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct WordCount {
    pub text: String,
    pub count: u32,
}

/// A comment sent with a rating (seen by the operator, and in the export).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct RatingComment {
    /// 1 – 5.
    pub stars: u8,
    pub text: String,
    #[ts(type = "number")]
    pub at: Millis,
}

/// A word as it is counted: spaces made single, at most three words and
/// `MAX_WORD_CHARS` characters. None when nothing is left.
#[must_use]
pub fn clean_word(text: &str) -> Option<String> {
    let words: Vec<&str> = text
        .split(|c: char| c.is_whitespace() || c.is_control())
        .filter(|w| !w.is_empty())
        .take(3)
        .collect();
    let joined: String = words.join(" ").chars().take(MAX_WORD_CHARS).collect();
    let joined = joined.trim().to_owned();
    (!joined.is_empty()).then_some(joined)
}

#[allow(clippy::struct_excessive_bools)]
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", default)]
#[ts(export)]
pub struct Poll {
    pub question: String,
    pub options: Vec<String>,
    /// Votes for each answer.
    pub votes: Vec<u32>,
    /// Taking votes now.
    pub open: bool,
    /// The bars show on screen (else only the question and answers).
    pub show_results: bool,
    /// Goes up whenever the votes start again, so old votes don't count.
    pub round: u32,
    /// Where phones vote, and its QR code (SVG), when shown on screen.
    pub join_url: String,
    pub join_qr: String,
    pub show_join: bool,
    pub kind: PollKind,
    /// Word cloud: every word sent this round, counted (letter case aside).
    pub words: Vec<WordCount>,
    /// Rating: the comments sent this round.
    pub comments: Vec<RatingComment>,
}

impl Default for Poll {
    fn default() -> Self {
        Poll {
            question: "What should we play next?".to_owned(),
            options: vec![
                "Song A".to_owned(),
                "Song B".to_owned(),
                "Song C".to_owned(),
            ],
            votes: vec![0; 3],
            open: false,
            show_results: true,
            round: 1,
            join_url: String::new(),
            join_qr: String::new(),
            show_join: true,
            kind: PollKind::Choice,
            words: Vec::new(),
            comments: Vec::new(),
        }
    }
}

impl Poll {
    pub fn repair(&mut self) {
        self.question = self.question.chars().take(200).collect();
        match self.kind {
            PollKind::Choice => {
                self.options.retain(|o| !o.trim().is_empty());
                self.options.truncate(MAX_OPTIONS);
                for o in &mut self.options {
                    *o = o.trim().chars().take(80).collect();
                }
            }
            // The stars are the answers.
            PollKind::Rating => self.options = (1..=STARS).map(|n| n.to_string()).collect(),
            PollKind::Words => self.options.clear(),
        }
        self.votes.resize(self.options.len(), 0);
        self.words.retain(|w| clean_word(&w.text).is_some());
        self.words.truncate(MAX_WORDS);
        if self.comments.len() > MAX_COMMENTS {
            let extra = self.comments.len() - MAX_COMMENTS;
            self.comments.drain(..extra);
        }
        self.join_url = self.join_url.chars().take(200).collect();
        if self.join_qr.len() > 200_000 || !self.join_qr.trim_start().starts_with("<svg") {
            self.join_qr.clear();
        }
    }

    /// Start counting again from nothing.
    pub fn reset(&mut self) {
        self.votes = vec![0; self.options.len()];
        self.words.clear();
        self.comments.clear();
        self.round = self.round.wrapping_add(1).max(1);
    }

    /// A word for the cloud. False if the poll is closed, not a word cloud,
    /// the word is for an older round, empty, or one too many.
    pub fn word(&mut self, round: u32, text: &str) -> bool {
        if !self.open || round != self.round || self.kind != PollKind::Words {
            return false;
        }
        let Some(text) = clean_word(text) else {
            return false;
        };
        let key = text.to_lowercase();
        if let Some(w) = self.words.iter_mut().find(|w| w.text.to_lowercase() == key) {
            w.count = w.count.saturating_add(1);
            return true;
        }
        if self.words.len() >= MAX_WORDS {
            return false;
        }
        self.words.push(WordCount { text, count: 1 });
        true
    }

    /// Take a word out of the cloud (the operator's choice).
    pub fn remove_word(&mut self, text: &str) {
        let key = text.to_lowercase();
        self.words.retain(|w| w.text.to_lowercase() != key);
    }

    /// A comment with a rating. False if closed, not a rating, for an older
    /// round, or empty.
    pub fn comment(&mut self, round: u32, stars: u8, text: &str, now: Millis) -> bool {
        if !self.open || round != self.round || self.kind != PollKind::Rating {
            return false;
        }
        let text: String = text
            .trim()
            .chars()
            .filter(|c| !c.is_control())
            .take(280)
            .collect();
        if text.is_empty() || !(1..=5).contains(&stars) {
            return false;
        }
        self.comments.push(RatingComment {
            stars,
            text,
            at: now,
        });
        if self.comments.len() > MAX_COMMENTS {
            let extra = self.comments.len() - MAX_COMMENTS;
            self.comments.drain(..extra);
        }
        true
    }

    /// The average number of stars (None before any rating).
    #[must_use]
    pub fn average(&self) -> Option<f64> {
        let total: u64 = self.votes.iter().map(|&v| u64::from(v)).sum();
        if total == 0 {
            return None;
        }
        let sum: u64 = self
            .votes
            .iter()
            .enumerate()
            .map(|(i, &v)| (i as u64 + 1) * u64::from(v))
            .sum();
        Some(sum as f64 / total as f64)
    }

    /// One vote (moving it from `previous` if the phone changed its mind).
    /// False if the poll is closed or the vote is for an older round.
    pub fn vote(&mut self, round: u32, option: usize, previous: Option<usize>) -> bool {
        if !self.open || round != self.round || option >= self.votes.len() {
            return false;
        }
        if let Some(p) = previous.filter(|&p| p < self.votes.len()) {
            self.votes[p] = self.votes[p].saturating_sub(1);
        }
        self.votes[option] = self.votes[option].saturating_add(1);
        true
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn votes_count_only_while_open_and_in_this_round() {
        let mut p = Poll::default();
        assert!(!p.vote(1, 0, None), "closed");
        p.open = true;
        assert!(p.vote(1, 0, None));
        assert!(p.vote(1, 2, Some(0)), "changed their mind");
        assert_eq!(p.votes, vec![0, 0, 1]);
        assert!(!p.vote(0, 1, None), "old round");
        assert!(!p.vote(1, 7, None), "no such answer");
        p.reset();
        assert_eq!((p.votes.clone(), p.round), (vec![0, 0, 0], 2));
        p.options.push("  ".into());
        p.options.push("D".into());
        p.repair();
        assert_eq!(p.options.len(), 4);
        assert_eq!(p.votes.len(), 4);
    }

    #[test]
    fn word_clouds_count_words_whatever_their_case() {
        let mut p = Poll {
            kind: PollKind::Words,
            open: true,
            ..Poll::default()
        };
        p.repair();
        assert!(p.options.is_empty());
        assert!(p.word(1, "  Joy "));
        assert!(p.word(1, "joy"));
        assert!(p.word(1, "great   music\tand more words"));
        assert!(!p.word(1, "   "), "nothing to count");
        assert!(!p.word(0, "old"), "older round");
        assert_eq!(p.words.len(), 2);
        assert_eq!(
            p.words[0],
            WordCount {
                text: "Joy".into(),
                count: 2
            }
        );
        assert_eq!(p.words[1].text, "great music and");
        p.remove_word("JOY");
        assert_eq!(p.words.len(), 1);
        p.reset();
        assert!(p.words.is_empty());
        assert!(!p.word(1, "late"), "the round moved on");
        let mut choice = Poll {
            open: true,
            ..Poll::default()
        };
        assert!(!choice.word(1, "no"), "not a word cloud");
        assert_eq!(
            clean_word(&"x".repeat(80)).unwrap().chars().count(),
            MAX_WORD_CHARS
        );
    }

    #[test]
    fn word_clouds_have_room_for_a_limited_number_of_words() {
        let mut p = Poll {
            kind: PollKind::Words,
            open: true,
            ..Poll::default()
        };
        for i in 0..MAX_WORDS {
            assert!(p.word(1, &format!("w{i}")));
        }
        assert!(!p.word(1, "one more"));
        assert!(p.word(1, "w1"), "known words still count");
    }

    #[test]
    fn ratings_have_five_stars_an_average_and_comments() {
        let mut p = Poll {
            kind: PollKind::Rating,
            ..Poll::default()
        };
        p.repair();
        assert_eq!(p.options, ["1", "2", "3", "4", "5"]);
        assert_eq!(p.votes, vec![0; 5]);
        assert_eq!(p.average(), None);
        p.open = true;
        assert!(p.vote(1, 4, None));
        assert!(p.vote(1, 2, None));
        assert!((p.average().unwrap() - 4.0).abs() < 1e-9);
        assert!(p.comment(1, 5, "  Loved it ", 9));
        assert!(!p.comment(1, 6, "too many stars", 9));
        assert!(!p.comment(1, 4, "  ", 9));
        assert_eq!(p.comments[0].text, "Loved it");
        p.reset();
        assert!(p.comments.is_empty());
    }

    #[test]
    fn older_saved_polls_are_choices() {
        let p: Poll =
            serde_json::from_str(r#"{"question":"Q","options":["a"],"votes":[2]}"#).unwrap();
        assert_eq!(p.kind, PollKind::Choice);
        assert!(p.words.is_empty());
    }
}
