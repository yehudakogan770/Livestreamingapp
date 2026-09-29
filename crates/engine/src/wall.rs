//! The messages wall: messages, dedications and photos sent from phones (the
//! same audience page as polls and raffles). The operator lets them through,
//! and they show on screen one at a time, several at once, or as a ticker
//! along the bottom.

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::model::Millis;

/// Most messages kept (the oldest go first).
pub const MAX_MESSAGES: usize = 2000;
/// Longest message, in characters.
pub const MAX_TEXT: usize = 280;

fn clean(s: &str, max: usize) -> String {
    s.trim()
        .chars()
        .filter(|c| !c.is_control() || *c == '\n')
        .take(max)
        .collect()
}

fn is_svg(s: &str) -> bool {
    s.len() <= 200_000 && s.trim_start().starts_with("<svg")
}

/// How the wall looks on screen.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub enum WallStyle {
    /// One big message at a time, changing every few seconds.
    #[default]
    Cards,
    /// The newest six together.
    Grid,
    /// Running along the bottom (over whatever is behind, as an overlay).
    Ticker,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct WallMessage {
    pub id: u32,
    /// Who sent it (may be empty).
    pub name: String,
    pub text: String,
    /// A photo sent with it (a file on this computer), or empty.
    pub photo: String,
    #[ts(type = "number")]
    pub at: Millis,
    /// Let through to the screen.
    pub approved: bool,
}

#[allow(clippy::struct_excessive_bools)]
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", default)]
#[ts(export)]
pub struct Wall {
    pub title: String,
    /// What the phones are asked ("Write a blessing for the couple").
    pub prompt: String,
    pub messages: Vec<WallMessage>,
    /// Phones may send now.
    pub open: bool,
    /// Phones may send a photo too.
    pub photos: bool,
    /// Messages from phones show straight away (else the operator lets each through).
    pub auto_approve: bool,
    pub style: WallStyle,
    /// Seconds each message stays (one at a time).
    pub seconds: u32,
    /// Keep this message on screen (instead of taking turns).
    pub pinned: Option<u32>,
    pub next_id: u32,
    pub join_url: String,
    pub join_qr: String,
    pub show_join: bool,
}

impl Default for Wall {
    fn default() -> Self {
        Wall {
            title: "Messages".to_owned(),
            prompt: "Send a message".to_owned(),
            messages: Vec::new(),
            open: false,
            photos: true,
            auto_approve: false,
            style: WallStyle::Cards,
            seconds: 8,
            pinned: None,
            next_id: 0,
            join_url: String::new(),
            join_qr: String::new(),
            show_join: true,
        }
    }
}

impl Wall {
    pub fn repair(&mut self) {
        self.title = clean(&self.title, 80);
        self.prompt = clean(&self.prompt, 120);
        self.seconds = self.seconds.clamp(3, 60);
        if self.messages.len() > MAX_MESSAGES {
            let extra = self.messages.len() - MAX_MESSAGES;
            self.messages.drain(..extra);
        }
        for m in &mut self.messages {
            m.name = clean(&m.name, 40);
            m.text = clean(&m.text, MAX_TEXT);
        }
        self.messages
            .retain(|m| !m.text.is_empty() || !m.photo.is_empty());
        if self
            .pinned
            .is_some_and(|p| !self.messages.iter().any(|m| m.id == p))
        {
            self.pinned = None;
        }
        if !is_svg(&self.join_qr) {
            self.join_qr.clear();
        }
        self.join_url = clean(&self.join_url, 200);
    }

    /// A new message. None if it has neither words nor a photo.
    pub fn post(
        &mut self,
        name: &str,
        text: &str,
        photo: &str,
        approved: bool,
        now: Millis,
    ) -> Option<u32> {
        let text = clean(text, MAX_TEXT);
        let photo = photo.trim().to_owned();
        if text.is_empty() && photo.is_empty() {
            return None;
        }
        self.next_id = self.next_id.wrapping_add(1);
        self.messages.push(WallMessage {
            id: self.next_id,
            name: clean(name, 40),
            text,
            photo,
            at: now,
            approved,
        });
        if self.messages.len() > MAX_MESSAGES {
            let extra = self.messages.len() - MAX_MESSAGES;
            self.messages.drain(..extra);
        }
        Some(self.next_id)
    }

    /// Take one message out, or (with none) all of them.
    pub fn remove(&mut self, message: Option<u32>) {
        match message {
            Some(id) => self.messages.retain(|m| m.id != id),
            None => self.messages.clear(),
        }
        if self
            .pinned
            .is_some_and(|p| !self.messages.iter().any(|m| m.id == p))
        {
            self.pinned = None;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn messages_need_words_or_a_photo_and_are_kept_tidy() {
        let mut w = Wall::default();
        assert!(w.post("Ana", "   ", "", true, 1).is_none());
        let a = w.post("  Ana ", " Mazel tov! ", "", false, 2).unwrap();
        let b = w.post("", "", "C:/photos/1.jpg", true, 3).unwrap();
        assert_eq!(w.messages[0].name, "Ana");
        assert_eq!(w.messages[0].text, "Mazel tov!");
        assert!(!w.messages[0].approved);
        w.pinned = Some(b);
        w.remove(Some(b));
        assert_eq!(w.pinned, None, "a pinned message that goes is unpinned");
        assert_eq!(w.messages.len(), 1);
        assert_eq!(w.messages[0].id, a);
        for i in 0..2100 {
            w.post("x", "y", "", true, i);
        }
        assert_eq!(w.messages.len(), MAX_MESSAGES);
        w.seconds = 0;
        w.repair();
        assert_eq!(w.seconds, 3);
    }
}
