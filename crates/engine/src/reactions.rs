//! Reactions from the audience's phones: a tap on Love, Haha, Wow or Yes
//! floats up over the live picture for a few seconds (an overlay graphic),
//! and is counted. The app's server gathers the taps of many phones and
//! hands them in a few times a second ([`Reactions::react`]), so a crowd
//! tapping at once never floods the show.

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::model::Millis;

/// Love, Haha, Wow, Yes.
pub const KINDS: usize = 4;
/// How long a reaction floats on screen, ms.
pub const FLOAT_MS: u64 = 4000;
/// Most reactions floating at once (the rest are counted, not drawn).
pub const MAX_FLOATING: usize = 48;
/// Most new ones drawn from one batch of taps.
pub const PER_BATCH: u32 = 12;

/// One reaction floating up.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct ReactionFloat {
    /// 0 Love, 1 Haha, 2 Wow, 3 Yes.
    pub kind: u8,
    #[ts(type = "number")]
    pub at: Millis,
    /// Where it rises and how it sways (the same on every screen).
    pub seed: u32,
}

/// The side of the picture reactions rise on.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub enum ReactionSide {
    #[default]
    Right,
    Left,
}

#[allow(clippy::struct_excessive_bools)]
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", default)]
#[ts(export)]
pub struct Reactions {
    /// Phones may react now.
    pub open: bool,
    /// Every reaction since the last reset, by kind.
    pub counts: Vec<u32>,
    /// Those floating now (oldest first).
    pub floating: Vec<ReactionFloat>,
    pub side: ReactionSide,
    /// Show the totals under the rising reactions.
    pub show_counts: bool,
    pub next_seed: u32,
    /// The audience page and its QR code (SVG), shown small while open.
    pub join_url: String,
    pub join_qr: String,
    pub show_join: bool,
}

impl Default for Reactions {
    fn default() -> Self {
        Reactions {
            open: false,
            counts: vec![0; KINDS],
            floating: Vec::new(),
            side: ReactionSide::Right,
            show_counts: false,
            next_seed: 0,
            join_url: String::new(),
            join_qr: String::new(),
            show_join: true,
        }
    }
}

impl Reactions {
    pub fn repair(&mut self) {
        self.counts.resize(KINDS, 0);
        self.floating.retain(|f| usize::from(f.kind) < KINDS);
        if self.floating.len() > MAX_FLOATING {
            let extra = self.floating.len() - MAX_FLOATING;
            self.floating.drain(..extra);
        }
        self.join_url = self.join_url.chars().take(200).collect();
        if self.join_qr.len() > 200_000 || !self.join_qr.trim_start().starts_with("<svg") {
            self.join_qr.clear();
        }
    }

    /// A batch of taps (`taps[k]` of kind `k`). Every one is counted; up to
    /// `PER_BATCH` float up, shared between the kinds as tapped. False if closed.
    pub fn react(&mut self, taps: &[u32], now: Millis) -> bool {
        if !self.open {
            return false;
        }
        self.counts.resize(KINDS, 0);
        self.floating
            .retain(|f| now.saturating_sub(f.at) < FLOAT_MS);
        let taps: Vec<u32> = (0..KINDS)
            .map(|k| taps.get(k).copied().unwrap_or(0).min(100_000))
            .collect();
        let total: u64 = taps.iter().map(|&t| u64::from(t)).sum();
        if total == 0 {
            return true;
        }
        for (c, t) in self.counts.iter_mut().zip(&taps) {
            *c = c.saturating_add(*t);
        }
        // Each kind's share of the reactions drawn, at least one for any kind tapped.
        let room = u64::from(PER_BATCH.min(u32::try_from(total).unwrap_or(u32::MAX)));
        let mut drawn: Vec<u64> = taps
            .iter()
            .map(|&t| {
                if t == 0 {
                    0
                } else {
                    (u64::from(t) * room / total).max(1)
                }
            })
            .collect();
        while drawn.iter().sum::<u64>() > room {
            if let Some(m) = drawn.iter_mut().max() {
                *m -= 1;
            }
        }
        // Spread over the next moment, so a batch rises as a stream, not a block.
        let mut i = 0u64;
        for (kind, n) in drawn.iter().enumerate() {
            for _ in 0..*n {
                self.next_seed = self
                    .next_seed
                    .wrapping_mul(1_103_515_245)
                    .wrapping_add(12_345);
                self.floating.push(ReactionFloat {
                    kind: u8::try_from(kind).unwrap_or(0),
                    at: now + i * 60,
                    seed: self.next_seed,
                });
                i += 1;
            }
        }
        if self.floating.len() > MAX_FLOATING {
            let extra = self.floating.len() - MAX_FLOATING;
            self.floating.drain(..extra);
        }
        true
    }

    /// Start counting again.
    pub fn reset(&mut self) {
        self.counts = vec![0; KINDS];
        self.floating.clear();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn taps_are_counted_and_some_float_up() {
        let mut r = Reactions::default();
        assert!(!r.react(&[1, 0, 0, 0], 0), "closed");
        r.open = true;
        assert!(r.react(&[1, 0, 2, 0], 1000));
        assert_eq!(r.counts, vec![1, 0, 2, 0]);
        assert_eq!(r.floating.len(), 3);
        assert_eq!(r.floating.iter().filter(|f| f.kind == 2).count(), 2);
        // A crowd: everyone counted, a dozen drawn, every kind tapped among them.
        let before = r.floating.len();
        assert!(r.react(&[500, 3, 0, 40], 1100));
        assert_eq!(r.counts, vec![501, 3, 2, 40]);
        let batch = &r.floating[before..];
        assert_eq!(batch.len(), PER_BATCH as usize);
        assert!(batch.iter().any(|f| f.kind == 1) && batch.iter().any(|f| f.kind == 3));
        // Old ones leave once they have floated away.
        r.react(&[0, 0, 0, 1], 1000 + FLOAT_MS + 2000);
        assert!(r.floating.iter().all(|f| f.at >= 1000 + FLOAT_MS));
    }

    #[test]
    fn only_so_many_float_at_once() {
        let mut r = Reactions {
            open: true,
            ..Reactions::default()
        };
        for t in 0..20 {
            r.react(&[50, 50, 50, 50], t * 10);
        }
        assert_eq!(r.floating.len(), MAX_FLOATING);
        assert_eq!(r.counts, vec![1000; 4]);
        r.reset();
        assert!(r.floating.is_empty() && r.counts == vec![0; 4]);
    }
}
