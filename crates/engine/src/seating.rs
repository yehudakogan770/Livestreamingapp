//! A table finder: the seating list, guests finding their table from their
//! phone (the same audience page), and the list on screen, a page at a time.

use serde::{Deserialize, Serialize};
use ts_rs::TS;

pub const MAX_GUESTS: usize = 5000;

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
pub struct Seat {
    pub name: String,
    /// The table (a number or a name).
    pub table: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub enum SeatingLook {
    /// "Find your seat" with the code to scan.
    #[default]
    Scan,
    /// The whole list, a page at a time.
    List,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", default)]
#[ts(export)]
pub struct Seating {
    pub title: String,
    pub guests: Vec<Seat>,
    pub look: SeatingLook,
    /// Seconds each page of the list stays.
    pub seconds: u32,
    /// Phones may look up their table.
    pub open: bool,
    pub join_url: String,
    pub join_qr: String,
    pub show_join: bool,
}

impl Default for Seating {
    fn default() -> Self {
        Seating {
            title: "Find your seat".to_owned(),
            guests: Vec::new(),
            look: SeatingLook::Scan,
            seconds: 8,
            open: true,
            join_url: String::new(),
            join_qr: String::new(),
            show_join: true,
        }
    }
}

/// Lower case, without accents or Hebrew vowels, for matching names.
fn fold(s: &str) -> String {
    s.chars()
        .filter(|c| !('\u{0591}'..='\u{05C7}').contains(c))
        .flat_map(char::to_lowercase)
        .collect()
}

impl Seating {
    pub fn repair(&mut self) {
        self.title = clean(&self.title, 80);
        self.guests.truncate(MAX_GUESTS);
        for g in &mut self.guests {
            g.name = clean(&g.name, 60);
            g.table = clean(&g.table, 30);
        }
        self.guests.retain(|g| !g.name.is_empty());
        self.guests.sort_by_cached_key(|g| fold(&g.name));
        self.seconds = self.seconds.clamp(3, 60);
        if !is_svg(&self.join_qr) {
            self.join_qr.clear();
        }
        self.join_url = clean(&self.join_url, 200);
    }

    /// Guests whose name has every word of `query` (at most `max`).
    #[must_use]
    pub fn find(&self, query: &str, max: usize) -> Vec<&Seat> {
        let words: Vec<String> = fold(query).split_whitespace().map(str::to_owned).collect();
        if words.is_empty() || words.iter().map(|w| w.chars().count()).sum::<usize>() < 2 {
            return Vec::new();
        }
        self.guests
            .iter()
            .filter(|g| {
                let name = fold(&g.name);
                words.iter().all(|w| name.contains(w.as_str()))
            })
            .take(max)
            .collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn guests_find_their_table() {
        let mut s = Seating::default();
        for (n, t) in [
            ("Levi, Sarah", "4"),
            ("Cohen, David", "12"),
            ("  ", "1"),
            ("Cohen, Miriam", "12"),
        ] {
            s.guests.push(Seat {
                name: n.into(),
                table: t.into(),
            });
        }
        s.repair();
        assert_eq!(s.guests.len(), 3);
        assert_eq!(s.guests[0].name, "Cohen, David", "sorted");
        assert_eq!(s.find("cohen", 10).len(), 2);
        assert_eq!(s.find("sarah levi", 10)[0].table, "4");
        assert_eq!(s.find("c", 10).len(), 0, "too short");
    }
}
