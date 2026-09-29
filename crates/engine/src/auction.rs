//! A live auction: items one after another, bids from phones (the same
//! audience page) or taken in the room, the highest bid on screen, an optional
//! countdown, then "Sold!". Lumora never takes payments: a winning bid is a
//! promise, paid the usual way.

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::model::Millis;

/// Most items in one auction.
pub const MAX_ITEMS: usize = 200;
/// Most bids kept on one item.
pub const MAX_BIDS: usize = 5000;
/// Largest bid.
pub const MAX_BID: u64 = 100_000_000;
/// A bid in the last moments adds time, so nobody wins by bidding at the buzzer.
pub const EXTEND_MS: Millis = 15_000;

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
pub struct Bid {
    pub id: u32,
    pub name: String,
    #[ts(type = "number")]
    pub amount: u64,
    #[ts(type = "number")]
    pub at: Millis,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", default)]
#[ts(export)]
pub struct AuctionItem {
    /// 0 for a new item (it gets one when added).
    pub id: u32,
    pub name: String,
    /// A line about it ("Donated by the Levi family").
    pub detail: String,
    /// A picture of it (a file on this computer), or empty.
    pub photo: String,
    /// The lowest first bid.
    #[ts(type = "number")]
    pub start: u64,
    /// Each bid is at least this much more than the last.
    #[ts(type = "number")]
    pub step: u64,
    pub bids: Vec<Bid>,
    /// Sold to the highest bid.
    pub sold: bool,
}

impl Default for AuctionItem {
    fn default() -> Self {
        AuctionItem {
            id: 0,
            name: String::new(),
            detail: String::new(),
            photo: String::new(),
            start: 100,
            step: 10,
            bids: Vec::new(),
            sold: false,
        }
    }
}

impl AuctionItem {
    fn repair(&mut self) {
        self.name = clean(&self.name, 80);
        self.detail = clean(&self.detail, 140);
        self.start = self.start.clamp(1, MAX_BID);
        self.step = self.step.clamp(1, MAX_BID);
        self.bids.truncate(MAX_BIDS);
    }

    /// The highest bid so far.
    #[must_use]
    pub fn top(&self) -> Option<&Bid> {
        self.bids
            .iter()
            .max_by_key(|b| (b.amount, std::cmp::Reverse(b.at)))
    }

    /// The least the next bid may be.
    #[must_use]
    pub fn minimum(&self) -> u64 {
        self.top()
            .map_or(self.start, |b| b.amount.saturating_add(self.step))
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", default)]
#[ts(export)]
pub struct Auction {
    pub title: String,
    /// "$", "₪", "€", "£"…
    pub currency: String,
    pub items: Vec<AuctionItem>,
    /// The item being sold now.
    pub current: usize,
    /// Phones may bid now.
    pub open: bool,
    /// Bidding on the current item ends at this time (none: until the operator says "Sold").
    #[ts(type = "number | null")]
    pub ends_at: Option<Millis>,
    /// When the last bid came in (the screen flashes).
    #[ts(type = "number")]
    pub last_bid_at: Millis,
    /// When the current item was sold (the celebration).
    #[ts(type = "number")]
    pub sold_at: Millis,
    pub next_id: u32,
    pub join_url: String,
    pub join_qr: String,
    pub show_join: bool,
}

impl Default for Auction {
    fn default() -> Self {
        Auction {
            title: "Live auction".to_owned(),
            currency: "$".to_owned(),
            items: Vec::new(),
            current: 0,
            open: false,
            ends_at: None,
            last_bid_at: 0,
            sold_at: 0,
            next_id: 0,
            join_url: String::new(),
            join_qr: String::new(),
            show_join: true,
        }
    }
}

/// Why a bid was refused (said to the bidder).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum BidRefused {
    Closed,
    NotThisItem,
    TooLow(u64),
    Over,
}

impl BidRefused {
    #[must_use]
    pub fn reason(self) -> String {
        match self {
            BidRefused::Closed => "bidding is closed".to_owned(),
            BidRefused::NotThisItem => "that item is not being sold now".to_owned(),
            BidRefused::TooLow(min) => format!("the bid must be at least {min}"),
            BidRefused::Over => "time is up for this item".to_owned(),
        }
    }
}

impl Auction {
    pub fn repair(&mut self) {
        self.title = clean(&self.title, 80);
        self.currency = clean(&self.currency, 4);
        self.items.truncate(MAX_ITEMS);
        for it in &mut self.items {
            it.repair();
        }
        if self.current >= self.items.len() {
            self.current = 0;
        }
        if !is_svg(&self.join_qr) {
            self.join_qr.clear();
        }
        self.join_url = clean(&self.join_url, 200);
    }

    fn fresh_id(&mut self) -> u32 {
        self.next_id = self.next_id.wrapping_add(1);
        self.next_id
    }

    /// Add an item (id 0) or change one (its bids and "sold" stay).
    pub fn set_item(&mut self, mut item: AuctionItem) -> bool {
        item.repair();
        if item.id == 0 {
            if self.items.len() >= MAX_ITEMS {
                return false;
            }
            item.id = self.fresh_id();
            item.bids.clear();
            item.sold = false;
            self.items.push(item);
            return true;
        }
        match self.items.iter_mut().find(|x| x.id == item.id) {
            Some(it) => {
                it.name = item.name;
                it.detail = item.detail;
                it.photo = item.photo;
                it.start = item.start;
                it.step = item.step;
                true
            }
            None => false,
        }
    }

    pub fn remove_item(&mut self, id: u32) {
        let at = self.items.iter().position(|x| x.id == id);
        self.items.retain(|x| x.id != id);
        if let Some(i) = at {
            if i < self.current {
                self.current -= 1;
            } else if i == self.current {
                self.ends_at = None;
            }
        }
        if self.current >= self.items.len() {
            self.current = self.items.len().saturating_sub(1);
        }
    }

    /// Bidding on the current item has run out of time.
    #[must_use]
    pub fn over(&self, now: Millis) -> bool {
        self.ends_at.is_some_and(|t| now >= t)
    }

    /// A bid on `item` (it must be the one being sold). `phone`: from a phone
    /// (needs bidding to be open); bids taken in the room are always allowed.
    ///
    /// # Errors
    /// Why the bid was refused (closed, another item, too low, time up).
    pub fn bid(
        &mut self,
        item: u32,
        name: &str,
        amount: u64,
        phone: bool,
        now: Millis,
    ) -> Result<u32, BidRefused> {
        if phone && !self.open {
            return Err(BidRefused::Closed);
        }
        let over = self.over(now);
        let current = self.current;
        let it = self
            .items
            .get(current)
            .filter(|it| it.id == item)
            .ok_or(BidRefused::NotThisItem)?;
        if it.sold {
            return Err(BidRefused::Closed);
        }
        if over {
            return Err(BidRefused::Over);
        }
        let min = it.minimum();
        if amount < min || amount > MAX_BID || it.bids.len() >= MAX_BIDS {
            return Err(BidRefused::TooLow(min));
        }
        let id = self.fresh_id();
        self.items[current].bids.push(Bid {
            id,
            name: clean(name, 40),
            amount,
            at: now,
        });
        self.last_bid_at = now;
        if let Some(end) = self.ends_at {
            if end.saturating_sub(now) < EXTEND_MS {
                self.ends_at = Some(now + EXTEND_MS);
            }
        }
        Ok(id)
    }

    /// Go to another item (bidding time is cleared).
    pub fn go(&mut self, index: usize) -> bool {
        if index >= self.items.len() {
            return false;
        }
        self.current = index;
        self.ends_at = None;
        self.sold_at = 0;
        true
    }

    /// Sell the current item to its highest bid (or take that back).
    pub fn sell(&mut self, value: bool, now: Millis) -> bool {
        let Some(it) = self.items.get_mut(self.current) else {
            return false;
        };
        if value && it.bids.is_empty() {
            return false;
        }
        it.sold = value;
        self.sold_at = if value { now } else { 0 };
        self.ends_at = None;
        true
    }

    /// Everything sold so far.
    #[must_use]
    pub fn raised(&self) -> u64 {
        self.items
            .iter()
            .filter(|it| it.sold)
            .filter_map(|it| it.top().map(|b| b.amount))
            .sum()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn auction() -> Auction {
        let mut a = Auction::default();
        a.set_item(AuctionItem {
            name: "Kiddush cup".into(),
            start: 100,
            step: 20,
            ..AuctionItem::default()
        });
        a.set_item(AuctionItem {
            name: "Seforim set".into(),
            ..AuctionItem::default()
        });
        a
    }

    #[test]
    fn bids_must_beat_the_last_by_the_step() {
        let mut a = auction();
        let cup = a.items[0].id;
        assert_eq!(a.bid(cup, "Ana", 100, true, 1), Err(BidRefused::Closed));
        a.open = true;
        assert_eq!(a.bid(cup, "Ana", 90, true, 1), Err(BidRefused::TooLow(100)));
        a.bid(cup, "Ana", 100, true, 2).unwrap();
        assert_eq!(
            a.bid(cup, "Ben", 110, true, 3),
            Err(BidRefused::TooLow(120))
        );
        a.bid(cup, "Ben", 150, true, 4).unwrap();
        assert_eq!(a.items[0].top().unwrap().name, "Ben");
        assert_eq!(a.items[0].minimum(), 170);
        let other = a.items[1].id;
        assert_eq!(
            a.bid(other, "Ana", 500, true, 5),
            Err(BidRefused::NotThisItem)
        );
        assert!(a.sell(true, 6));
        assert_eq!(a.raised(), 150);
        assert_eq!(a.bid(cup, "Ana", 500, false, 7), Err(BidRefused::Closed));
        assert!(a.go(1));
        assert!(!a.sell(true, 8), "nothing to sell without a bid");
    }

    #[test]
    fn late_bids_add_time_and_time_up_stops_bids() {
        let mut a = auction();
        a.open = true;
        let cup = a.items[0].id;
        a.ends_at = Some(100_000);
        a.bid(cup, "Ana", 100, true, 50_000).unwrap();
        assert_eq!(a.ends_at, Some(100_000));
        a.bid(cup, "Ben", 120, true, 95_000).unwrap();
        assert_eq!(a.ends_at, Some(95_000 + EXTEND_MS));
        assert_eq!(a.bid(cup, "Ana", 500, true, 200_000), Err(BidRefused::Over));
    }

    #[test]
    fn removing_items_keeps_the_current_one() {
        let mut a = auction();
        a.set_item(AuctionItem {
            name: "Painting".into(),
            ..AuctionItem::default()
        });
        a.go(2);
        let first = a.items[0].id;
        a.remove_item(first);
        assert_eq!(a.items[a.current].name, "Painting");
        let last = a.items[1].id;
        a.remove_item(last);
        assert_eq!(a.current, 0);
    }
}
