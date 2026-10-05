//! Raffles and fundraisers: the audience joins from their phones (the same
//! page as polls and questions); the draw and the total are shown on screen.
//! Lumora never takes payments: pledges are promises, paid the usual way.

use std::hash::{BuildHasher, Hasher};

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::model::Millis;

/// Most entries in one raffle.
pub const MAX_ENTRIES: usize = 20_000;
/// How long the draw spins before the winner shows, ms.
pub const DRAW_MS: u32 = 6000;

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
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct Entry {
    pub id: u32,
    pub name: String,
}

/// A draw in progress (or just finished): the winner is chosen when it starts.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct Draw {
    #[ts(type = "number")]
    pub started_at: Millis,
    pub winner: u32,
    pub duration_ms: u32,
}

#[allow(clippy::struct_excessive_bools)]
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", default)]
#[ts(export)]
pub struct Raffle {
    pub title: String,
    /// The prize (shown under the title).
    pub prize: String,
    pub entries: Vec<Entry>,
    /// Phones may enter now.
    pub open: bool,
    /// Everyone drawn so far, in order.
    pub winners: Vec<u32>,
    pub draw: Option<Draw>,
    /// Someone already drawn can win again.
    pub repeat_winners: bool,
    pub next_id: u32,
    /// The audience page, and its QR code (SVG), shown while entering.
    pub join_url: String,
    pub join_qr: String,
    pub show_join: bool,
}

impl Default for Raffle {
    fn default() -> Self {
        Raffle {
            title: "Raffle".to_owned(),
            prize: String::new(),
            entries: Vec::new(),
            open: false,
            winners: Vec::new(),
            draw: None,
            repeat_winners: false,
            next_id: 0,
            join_url: String::new(),
            join_qr: String::new(),
            show_join: true,
        }
    }
}

impl Raffle {
    pub fn repair(&mut self) {
        self.title = clean(&self.title, 80);
        self.prize = clean(&self.prize, 120);
        self.entries.truncate(MAX_ENTRIES);
        for e in &mut self.entries {
            e.name = clean(&e.name, 40);
        }
        self.entries.retain(|e| !e.name.is_empty());
        if !is_svg(&self.join_qr) {
            self.join_qr.clear();
        }
        self.join_url = clean(&self.join_url, 200);
    }

    /// Add a name. None if the raffle is full or the name is empty.
    pub fn enter(&mut self, name: &str) -> Option<u32> {
        let name = clean(name, 40);
        if name.is_empty() || self.entries.len() >= MAX_ENTRIES {
            return None;
        }
        self.next_id = self.next_id.wrapping_add(1);
        self.entries.push(Entry {
            id: self.next_id,
            name,
        });
        Some(self.next_id)
    }

    /// Who can still win.
    #[must_use]
    pub fn eligible(&self) -> Vec<u32> {
        self.entries
            .iter()
            .map(|e| e.id)
            .filter(|id| self.repeat_winners || !self.winners.contains(id))
            .collect()
    }

    /// Start a draw: the winner is picked now, fairly, and shown when the spin ends.
    pub fn start_draw(&mut self, now: Millis) -> bool {
        let pool = self.eligible();
        if pool.is_empty() {
            return false;
        }
        let mut h = std::collections::hash_map::RandomState::new().build_hasher();
        h.write_u64(now);
        h.write_usize(pool.len());
        #[allow(clippy::cast_possible_truncation)]
        let pick = pool[(h.finish() % pool.len() as u64) as usize];
        self.winners.push(pick);
        self.draw = Some(Draw {
            started_at: now,
            winner: pick,
            duration_ms: DRAW_MS,
        });
        true
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct Pledge {
    pub id: u32,
    pub name: String,
    /// Whole units of the currency.
    #[ts(type = "number")]
    pub amount: u64,
    pub message: String,
    #[ts(type = "number")]
    pub at: Millis,
    /// Counted in the total (pledges from phones wait for the operator unless auto-approve is on).
    pub approved: bool,
}

#[allow(clippy::struct_excessive_bools)]
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", default)]
#[ts(export)]
pub struct Fundraiser {
    pub title: String,
    /// "$", "₪", "€", "£"…
    pub currency: String,
    #[ts(type = "number")]
    pub goal: u64,
    /// Given before Lumora (cash, checks, online): added to the total.
    #[ts(type = "number")]
    pub starting: u64,
    pub pledges: Vec<Pledge>,
    /// Phones may pledge now.
    pub open: bool,
    /// Pledges from phones count straight away (else the operator approves each).
    pub auto_approve: bool,
    pub show_donors: bool,
    pub next_id: u32,
    /// When the total last passed a quarter of the goal (for the celebration).
    #[ts(type = "number")]
    pub celebrated_at: Millis,
    pub join_url: String,
    pub join_qr: String,
    pub show_join: bool,
}

impl Default for Fundraiser {
    fn default() -> Self {
        Fundraiser {
            title: "Help us reach our goal".to_owned(),
            currency: "$".to_owned(),
            goal: 10_000,
            starting: 0,
            pledges: Vec::new(),
            open: false,
            auto_approve: false,
            show_donors: true,
            next_id: 0,
            celebrated_at: 0,
            join_url: String::new(),
            join_qr: String::new(),
            show_join: true,
        }
    }
}

/// Largest single pledge.
pub const MAX_PLEDGE: u64 = 100_000_000;

impl Fundraiser {
    pub fn repair(&mut self) {
        self.title = clean(&self.title, 80);
        self.currency = clean(&self.currency, 4);
        self.goal = self.goal.clamp(1, 10_000_000_000);
        self.starting = self.starting.min(10_000_000_000);
        self.pledges.truncate(MAX_ENTRIES);
        if !is_svg(&self.join_qr) {
            self.join_qr.clear();
        }
        self.join_url = clean(&self.join_url, 200);
    }

    /// Everything counted so far.
    #[must_use]
    pub fn raised(&self) -> u64 {
        self.starting
            + self
                .pledges
                .iter()
                .filter(|p| p.approved)
                .map(|p| p.amount)
                .sum::<u64>()
    }

    /// Quarters of the goal reached.
    fn quarters(&self) -> u64 {
        (self.raised().saturating_mul(4) / self.goal.max(1)).min(4)
    }

    /// Run `change`, and celebrate if a quarter of the goal was passed.
    pub fn with_celebration(&mut self, now: Millis, change: impl FnOnce(&mut Self)) {
        let before = self.quarters();
        change(self);
        if self.quarters() > before {
            self.celebrated_at = now;
        }
    }

    /// A new pledge. None if empty or too big.
    pub fn pledge(
        &mut self,
        name: &str,
        amount: u64,
        message: &str,
        approved: bool,
        now: Millis,
    ) -> Option<u32> {
        if amount == 0 || amount > MAX_PLEDGE || self.pledges.len() >= MAX_ENTRIES {
            return None;
        }
        self.next_id = self.next_id.wrapping_add(1);
        let p = Pledge {
            id: self.next_id,
            name: clean(name, 40),
            amount,
            message: clean(message, 140),
            at: now,
            approved,
        };
        self.with_celebration(now, |f| f.pledges.push(p));
        Some(self.next_id)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn raffles_draw_fairly_and_never_the_same_winner_twice() {
        let mut r = Raffle::default();
        assert!(!r.start_draw(1), "nobody entered");
        for n in ["Ana", "Ben", "  ", "Chaya"] {
            r.enter(n);
        }
        assert_eq!(r.entries.len(), 3);
        let mut seen = std::collections::HashSet::new();
        for t in 0..3 {
            assert!(r.start_draw(t));
            assert!(seen.insert(r.draw.as_ref().unwrap().winner));
        }
        assert!(!r.start_draw(9), "everyone has won");
        r.repeat_winners = true;
        assert!(r.start_draw(10));
    }

    #[test]
    fn fundraisers_count_approved_pledges_and_celebrate_quarters() {
        let mut f = Fundraiser {
            goal: 1000,
            starting: 100,
            ..Fundraiser::default()
        };
        f.pledge("Ana", 100, "", true, 5).unwrap();
        assert_eq!((f.raised(), f.celebrated_at), (200, 0));
        f.pledge("Ben", 500, "", false, 6).unwrap();
        assert_eq!(f.raised(), 200, "waiting for approval");
        f.pledge("Chaya", 100, "Mazel tov", true, 7).unwrap();
        assert_eq!((f.raised(), f.celebrated_at), (300, 7), "passed a quarter");
        assert!(f.pledge("x", 0, "", true, 8).is_none());
        assert!(f.pledge("x", MAX_PLEDGE + 1, "", true, 8).is_none());
    }
}
