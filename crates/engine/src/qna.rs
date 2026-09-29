//! Audience questions (Q&A): people send questions from their phones (the
//! same page they vote on); the operator sees them and puts one on screen
//! through a chat comments input.

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::model::Millis;

/// Most questions kept (the oldest go first).
pub const MAX_QUESTIONS: usize = 300;

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
    /// Already put on screen.
    pub shown: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", default)]
#[ts(export)]
pub struct Qna {
    /// Taking questions now.
    pub open: bool,
    pub questions: Vec<Question>,
    pub next_id: u32,
}

impl Qna {
    /// A new question (if taking questions). False if closed or empty.
    pub fn ask(&mut self, author: &str, text: &str, now: Millis) -> bool {
        let text: String = text.trim().chars().take(300).collect();
        if !self.open || text.is_empty() {
            return false;
        }
        self.next_id = self.next_id.wrapping_add(1);
        self.questions.push(Question {
            id: self.next_id,
            author: author.trim().chars().take(40).collect(),
            text,
            at: now,
            shown: false,
        });
        if self.questions.len() > MAX_QUESTIONS {
            let extra = self.questions.len() - MAX_QUESTIONS;
            self.questions.drain(..extra);
        }
        true
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
        for i in 0..400 {
            q.ask("x", "y", i);
        }
        assert_eq!(q.questions.len(), MAX_QUESTIONS);
    }
}
