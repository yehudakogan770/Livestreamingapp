//! Live chat comments on screen: the operator picks a comment from the live
//! chat and it shows as a card with the viewer's name.
//! The chat itself stays in the control window; only the chosen comment is
//! part of the show.

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::model::Millis;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub enum ChatPlatform {
    #[default]
    Youtube,
    Twitch,
    Facebook,
    Other,
}

#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", default)]
#[ts(export)]
pub struct ChatComment {
    pub author: String,
    pub text: String,
    pub platform: ChatPlatform,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub enum CommentPlace {
    /// Low on the left, like a lower third.
    #[default]
    Low,
    /// In the middle, big.
    Middle,
}

/// A comment input: the comment showing now (None: nothing).
#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", default)]
#[ts(export)]
pub struct CommentCard {
    pub comment: Option<ChatComment>,
    /// When it last changed (for its animation).
    #[ts(type = "number")]
    pub changed_at: Millis,
    pub place: CommentPlace,
    /// The card's color.
    pub accent: String,
}

impl CommentCard {
    pub fn repair(&mut self) {
        if let Some(c) = &mut self.comment {
            c.author = c.author.chars().take(60).collect();
            c.text = c.text.chars().take(400).collect();
        }
        let ok = self.accent.len() == 7
            && self.accent.starts_with('#')
            && self.accent[1..].chars().all(|c| c.is_ascii_hexdigit());
        if !ok {
            "#2f80ed".clone_into(&mut self.accent);
        }
    }
}
