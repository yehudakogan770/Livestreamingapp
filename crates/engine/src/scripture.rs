//! Tanach and Tehillim on screen: a passage (book, chapter, verses) shown a
//! verse at a time or whole, in Hebrew, English or both. The text itself is
//! kept with the app (public domain) and read by the screens.

use serde::{Deserialize, Serialize};
use ts_rs::TS;

/// Books in the library (Bereishis … Divrei Hayamim II).
pub const BOOKS: u8 = 39;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub enum ScriptureLang {
    He,
    En,
    #[default]
    Both,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub enum ScriptureLook {
    /// Big, filling the screen.
    #[default]
    Full,
    /// Along the bottom, over the picture.
    Lower,
}

#[allow(clippy::struct_excessive_bools)]
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", default)]
#[ts(export)]
pub struct Scripture {
    /// Which book (0 = Bereishis … 26 = Tehillim … 38).
    pub book: u8,
    /// Chapter, from 1.
    pub chapter: u16,
    /// The passage's first and last verse, from 1.
    pub from: u16,
    pub to: u16,
    /// The verse on screen now (one at a time).
    pub current: u16,
    /// Show the whole passage at once instead of a verse at a time.
    pub whole: bool,
    pub lang: ScriptureLang,
    pub look: ScriptureLook,
    /// Show "Tehillim 23:1" under the text.
    pub show_ref: bool,
    /// Nothing on screen for now.
    pub blank: bool,
}

impl Default for Scripture {
    fn default() -> Self {
        Scripture {
            book: 26,
            chapter: 23,
            from: 1,
            to: 6,
            current: 1,
            whole: false,
            lang: ScriptureLang::Both,
            look: ScriptureLook::Full,
            show_ref: true,
            blank: false,
        }
    }
}

impl Scripture {
    pub fn repair(&mut self) {
        self.book = self.book.min(BOOKS - 1);
        self.chapter = self.chapter.clamp(1, 150);
        self.from = self.from.clamp(1, 200);
        self.to = self.to.clamp(self.from, 200);
        self.current = self.current.clamp(self.from, self.to);
    }

    /// Move a verse forward or back within the passage. False at either end.
    pub fn step(&mut self, delta: i32) -> bool {
        let next = i32::from(self.current) + delta;
        if next < i32::from(self.from) || next > i32::from(self.to) {
            return false;
        }
        self.current = u16::try_from(next).unwrap_or(self.from);
        self.blank = false;
        true
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn steps_stay_inside_the_passage() {
        let mut s = Scripture {
            from: 3,
            to: 5,
            current: 3,
            ..Scripture::default()
        };
        assert!(!s.step(-1));
        assert!(s.step(1) && s.step(1));
        assert_eq!(s.current, 5);
        assert!(!s.step(1));
        s.to = 1;
        s.repair();
        assert_eq!((s.from, s.to, s.current), (3, 3, 3));
    }
}
