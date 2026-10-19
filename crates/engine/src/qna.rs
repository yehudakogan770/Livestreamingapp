//! Audience questions (Q&A): people send questions from their phones (the
//! same page they vote on) and vote up the ones they want answered; the
//! operator sees them, approves them first when asked to, and puts one on
//! screen through a chat comments input.

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::model::Millis;

/// Most questions kept (the oldest go first).
pub const MAX_QUESTIONS: usize = 300;

fn yes() -> bool {
    true
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct Question {
    pub id: u32,
    /// The name they gave (may be empty).
    pub author: String,
    pub text: String,
    #[ts(type = "number")]
    pub at: Millis,
    /// Already put on screen (answered).
    pub shown: bool,
    /// Phones that voted it up.
    #[serde(default)]
    pub votes: u32,
    /// Others see it on their phones (questions wait for this while held for approval).
    #[serde(default = "yes")]
    pub approved: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", default)]
#[ts(export)]
pub struct Qna {
    /// Taking questions now.
    pub open: bool,
    pub questions: Vec<Question>,
    pub next_id: u32,
    /// New questions wait for the operator before anyone else sees them.
    pub moderate: bool,
}

impl Qna {
    /// A new question (if taking questions). False if closed or empty.
    pub fn ask(&mut self, author: &str, text: &str, now: Millis) -> bool {
        let text: String = text
            .trim()
            .chars()
            .filter(|c| !c.is_control())
            .take(300)
            .collect();
        if !self.open || text.is_empty() {
            return false;
        }
        self.next_id = self.next_id.wrapping_add(1);
        self.questions.push(Question {
            id: self.next_id,
            author: author
                .trim()
                .chars()
                .filter(|c| !c.is_control())
                .take(40)
                .collect(),
            text,
            at: now,
            shown: false,
            votes: 0,
            approved: !self.moderate,
        });
        if self.questions.len() > MAX_QUESTIONS {
            let extra = self.questions.len() - MAX_QUESTIONS;
            self.questions.drain(..extra);
        }
        true
    }

    /// A phone's vote for a question (`up`), or that vote taken back. Only
    /// questions others can see take votes. False if there is no such question.
    pub fn vote(&mut self, id: u32, up: bool) -> bool {
        let Some(q) = self.questions.iter_mut().find(|q| q.id == id && q.approved) else {
            return false;
        };
        q.votes = if up {
            q.votes.saturating_add(1)
        } else {
            q.votes.saturating_sub(1)
        };
        true
    }

    /// What the audience sees: approved questions, most votes first (then the
    /// oldest), answered ones last.
    #[must_use]
    pub fn public(&self) -> Vec<&Question> {
        let mut list: Vec<&Question> = self.questions.iter().filter(|q| q.approved).collect();
        list.sort_by(|a, b| {
            a.shown
                .cmp(&b.shown)
                .then(b.votes.cmp(&a.votes))
                .then(a.at.cmp(&b.at))
        });
        list
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn questions_come_in_only_while_open() {
        let mut q = Qna::default();
        assert!(!q.ask("Ana", "Hello?", 1));
        q.open = true;
        assert!(q.ask("  Ana ", "  When does it end? ", 2));
        assert!(!q.ask("Ben", "   ", 3));
        assert_eq!(q.questions[0].text, "When does it end?");
        assert_eq!(q.questions[0].author, "Ana");
        assert!(q.questions[0].approved, "no approval asked for");
        for i in 0..400 {
            q.ask("x", "y", i);
        }
        assert_eq!(q.questions.len(), MAX_QUESTIONS);
    }

    #[test]
    fn held_questions_wait_and_take_no_votes_until_approved() {
        let mut q = Qna {
            open: true,
            moderate: true,
            ..Qna::default()
        };
        q.ask("Ana", "First?", 1);
        let id = q.questions[0].id;
        assert!(!q.questions[0].approved);
        assert!(q.public().is_empty(), "nobody else sees it yet");
        assert!(!q.vote(id, true), "no votes while held");
        q.questions[0].approved = true;
        assert!(q.vote(id, true));
        assert!(q.vote(id, true));
        assert!(q.vote(id, false));
        assert_eq!(q.questions[0].votes, 1);
        assert!(!q.vote(999, true));
    }

    #[test]
    fn the_audience_sees_the_most_wanted_first_and_answered_last() {
        let mut q = Qna {
            open: true,
            ..Qna::default()
        };
        for (i, t) in ["a", "b", "c", "d"].iter().enumerate() {
            q.ask("", t, i as u64);
        }
        q.vote(2, true);
        q.vote(3, true);
        q.vote(3, true);
        q.questions[2].shown = true; // "c" was answered
        let order: Vec<&str> = q.public().iter().map(|x| x.text.as_str()).collect();
        assert_eq!(order, ["b", "a", "d", "c"]);
    }

    #[test]
    fn older_saved_questions_count_as_approved() {
        let q: Question =
            serde_json::from_str(r#"{"id":1,"author":"","text":"Hi","at":0,"shown":false}"#)
                .unwrap();
        assert!(q.approved);
        assert_eq!(q.votes, 0);
    }
}
