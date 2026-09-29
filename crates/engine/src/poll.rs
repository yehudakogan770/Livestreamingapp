//! Audience polls: a question with up to eight answers. People vote from
//! their phones (the phone remote's server, on the venue network, without
//! the operator's PIN); the results show on screen as bars.

use serde::{Deserialize, Serialize};
use ts_rs::TS;

pub const MAX_OPTIONS: usize = 8;

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
        }
    }
}

impl Poll {
    pub fn repair(&mut self) {
        self.question = self.question.chars().take(200).collect();
        self.options.retain(|o| !o.trim().is_empty());
        self.options.truncate(MAX_OPTIONS);
        for o in &mut self.options {
            *o = o.trim().chars().take(80).collect();
        }
        self.votes.resize(self.options.len(), 0);
        self.join_url = self.join_url.chars().take(200).collect();
        if self.join_qr.len() > 200_000 || !self.join_qr.trim_start().starts_with("<svg") {
            self.join_qr.clear();
        }
    }

    /// Start counting again from nothing.
    pub fn reset(&mut self) {
        self.votes = vec![0; self.options.len()];
        self.round = self.round.wrapping_add(1).max(1);
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
}
