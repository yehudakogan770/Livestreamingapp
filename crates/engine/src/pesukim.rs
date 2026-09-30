//! The 12 Pesukim: a child says one word at a time and the crowd repeats it.
//! A Pesukim input holds the twelve pesukim (with each child's name), how
//! they look, and where the operator is — which pasuk, which word.

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::model::{Millis, SourceId};

/// Always twelve.
pub const PESUKIM: usize = 12;
/// Longest pasuk text and child's name.
pub const MAX_PASUK_LEN: usize = 1000;
pub const MAX_CHILD_LEN: usize = 60;

/// One pasuk and the child who says it.
#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", default)]
#[ts(export)]
pub struct Pasuk {
    pub child: String,
    /// The words, separated by spaces. A hyphen (-) joins two words shown together.
    pub text: String,
    /// How each word sounds, word for word (the same spaces and hyphens).
    pub translit: String,
    /// What each word means, word for word; "_" for a word with none.
    pub english: String,
    /// What the whole pasuk means (shown with the whole pasuk).
    pub translation: String,
}

impl Pasuk {
    /// The words as shown, one step each.
    pub fn words(&self) -> Vec<String> {
        words_of(&self.text)
    }
}

/// Split a pasuk into the words shown one at a time. A plain hyphen joins
/// words that go on screen together (the Hebrew maqaf ־ is kept as it is).
pub fn words_of(text: &str) -> Vec<String> {
    text.split_whitespace()
        .map(|w| w.replace('-', " "))
        .collect()
}

/// What the screen shows.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub enum PesukimMode {
    /// A bar along the bottom, over the picture: the words in Hebrew, how
    /// they sound and what they mean, the word being said lit.
    #[default]
    Bar,
    /// Just the word being said, big.
    Word,
    /// The word big, with the whole pasuk in a bar at the bottom.
    Strip,
    /// The whole pasuk at once.
    Pasuk,
}

/// What the bar shows.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub enum BarWords {
    /// Only the word being said.
    #[default]
    One,
    /// A line of the pasuk, the word being said lit.
    Line,
}

/// How the next word appears.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub enum WordChange {
    #[default]
    Fade,
    Pop,
    Cut,
}

/// How the pesukim look.
#[allow(clippy::struct_excessive_bools)]
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", default)]
#[ts(export)]
pub struct PesukimLook {
    pub mode: PesukimMode,
    /// Words already said stay on screen (the pasuk builds up).
    pub keep_said: bool,
    /// The child's name comes up before their pasuk.
    pub show_name: bool,
    /// How the words sound, under the Hebrew.
    pub show_translit: bool,
    /// What the words mean, under that.
    pub show_english: bool,
    /// The bar's design (one of the built-in ones), when no picture is chosen.
    pub design: String,
    /// A picture of your own for the bar (a file on this computer), or empty.
    pub bar_image: String,
    /// One word at a time, or a line with the word lit.
    pub bar_words: BarWords,
    /// The outline around the words with no bar background (the second colour).
    pub outline_color: String,
    /// Background colour.
    pub background: String,
    /// An input shown behind the words (a camera, usually).
    pub behind: Option<SourceId>,
    pub text_color: String,
    /// Size of a single word, in % of the screen height.
    pub size: u32,
    pub font: String,
    pub word_change: WordChange,
    /// Move to the next word by itself every this many ms while on air (None: off).
    #[ts(type = "number | null")]
    pub auto_ms: Option<u32>,
}

impl Default for PesukimLook {
    fn default() -> Self {
        PesukimLook {
            mode: PesukimMode::Bar,
            keep_said: false,
            show_name: true,
            show_translit: true,
            show_english: true,
            design: "gold".to_owned(),
            bar_image: String::new(),
            bar_words: BarWords::One,
            outline_color: "#000000".to_owned(),
            background: "#15213a".to_owned(),
            behind: None,
            text_color: "#ffe39e".to_owned(),
            size: 22,
            font: "Frank Ruhl Libre".to_owned(),
            word_change: WordChange::Fade,
            auto_ms: None,
        }
    }
}

/// Where the operator is.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", default)]
#[ts(export)]
pub struct PesukimPlace {
    /// 0 – 11.
    pub pasuk: usize,
    pub word: usize,
    /// Showing the whole pasuk (until the next word).
    pub whole: bool,
    /// Words hidden; the background stays.
    pub blank: bool,
    /// The child's name, before the first word of their pasuk.
    pub intro: bool,
    /// When the word last changed (for the word animation and auto-advance).
    #[ts(type = "number")]
    pub changed_at: Millis,
}

/// Everything a Pesukim input holds.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", default)]
#[ts(export)]
pub struct Pesukim {
    /// Always [`PESUKIM`] entries.
    pub pesukim: Vec<Pasuk>,
    pub look: PesukimLook,
    pub place: PesukimPlace,
}

impl Default for Pesukim {
    fn default() -> Self {
        Pesukim {
            pesukim: vec![Pasuk::default(); PESUKIM],
            look: PesukimLook::default(),
            place: PesukimPlace::default(),
        }
    }
}

impl Pesukim {
    /// This pasuk starts with the child's name.
    fn intro_for(&self, pasuk: usize) -> bool {
        self.look.show_name
            && self
                .pesukim
                .get(pasuk)
                .is_some_and(|p| !p.child.trim().is_empty())
    }

    fn word_count(&self, pasuk: usize) -> usize {
        self.pesukim.get(pasuk).map_or(0, |p| p.words().len())
    }

    /// Next word; after the last word, the first word of the next pasuk.
    /// Returns false at the very end.
    pub fn next(&mut self, now: Millis) -> bool {
        if self.place.intro {
            self.place.intro = false;
            self.place.whole = false;
            self.place.blank = false;
            self.place.changed_at = now;
            return true;
        }
        let intro = self.intro_for(self.place.pasuk + 1);
        let p = &mut self.place;
        let len = self.pesukim.get(p.pasuk).map_or(0, |x| x.words().len());
        let moved = if p.word + 1 < len {
            p.word += 1;
            true
        } else if p.pasuk + 1 < PESUKIM {
            p.pasuk += 1;
            p.word = 0;
            p.intro = intro;
            true
        } else {
            false
        };
        if moved || p.whole || p.blank {
            p.whole = false;
            p.blank = false;
            p.changed_at = now;
        }
        moved
    }

    /// Back a word; before the first word, the last word of the pasuk before.
    pub fn back(&mut self, now: Millis) {
        if self.place.intro {
            self.place.intro = false;
            if self.place.pasuk == 0 {
                self.place.changed_at = now;
                return;
            }
            self.place.pasuk -= 1;
            self.place.word = self.word_count(self.place.pasuk).saturating_sub(1);
        } else if self.place.word == 0 && self.intro_for(self.place.pasuk) {
            self.place.intro = true;
        } else if self.place.word > 0 {
            self.place.word -= 1;
        } else if self.place.pasuk > 0 {
            self.place.pasuk -= 1;
            self.place.word = self.word_count(self.place.pasuk).saturating_sub(1);
        } else if !self.place.whole && !self.place.blank {
            return;
        }
        self.place.whole = false;
        self.place.blank = false;
        self.place.changed_at = now;
    }

    /// Jump to a word (0-based; clamped to what exists).
    pub fn go(&mut self, pasuk: usize, word: usize, now: Millis) {
        let pasuk = pasuk.min(PESUKIM - 1);
        let last = self.word_count(pasuk).saturating_sub(1);
        let word = word.min(last);
        self.place = PesukimPlace {
            pasuk,
            word,
            whole: false,
            blank: false,
            // A new pasuk starts with the child's name (not a jump within one).
            intro: word == 0 && pasuk != self.place.pasuk && self.intro_for(pasuk),
            changed_at: now,
        };
    }

    /// Time to move on by itself (auto-advance, while on air).
    pub fn due(&self, now: Millis) -> bool {
        match self.look.auto_ms {
            Some(ms) if !self.place.whole && !self.place.blank => {
                now >= self.place.changed_at.saturating_add(u64::from(ms))
                    && !(self.place.pasuk + 1 >= PESUKIM
                        && self.place.word + 1 >= self.word_count(self.place.pasuk))
            }
            _ => false,
        }
    }

    /// Keep everything in range after editing.
    pub(crate) fn repair(&mut self) {
        self.pesukim.resize_with(PESUKIM, Pasuk::default);
        for p in &mut self.pesukim {
            p.child = crate::engine::short_text(&p.child, MAX_CHILD_LEN);
            p.text = p.text.trim().chars().take(MAX_PASUK_LEN).collect();
            p.translit = p.translit.trim().chars().take(MAX_PASUK_LEN).collect();
            p.english = p.english.trim().chars().take(MAX_PASUK_LEN).collect();
            p.translation = p.translation.trim().chars().take(MAX_PASUK_LEN).collect();
        }
        let l = &mut self.look;
        l.size = l.size.clamp(4, 60);
        l.auto_ms = l.auto_ms.map(|ms| ms.clamp(500, 60_000));
        l.design = crate::engine::short_text(&l.design, 20);
        if l.design.is_empty() {
            l.design = PesukimLook::default().design;
        }
        if l.font.trim().is_empty() {
            l.font = PesukimLook::default().font;
        }
        self.place.pasuk = self.place.pasuk.min(PESUKIM - 1);
        let last = self.word_count(self.place.pasuk).saturating_sub(1);
        self.place.word = self.place.word.min(last);
    }
}
