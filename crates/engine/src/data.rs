//! A data file (a spreadsheet saved as CSV, or a JSON file) that the app
//! reads again and again: titles take words from it with `{Column}`, and
//! scoreboards can follow its columns. The operator steps through its rows
//! (for example one speaker after another).

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::model::Millis;

pub const MAX_ROWS: usize = 1000;
pub const MAX_COLUMNS: usize = 40;
const MAX_CELL: usize = 200;

fn clean(s: &str, max: usize) -> String {
    s.chars().filter(|c| !c.is_control()).take(max).collect()
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", default)]
#[ts(export)]
pub struct DataFeed {
    /// The file (empty: none).
    pub path: String,
    /// How often it is read again, ms.
    pub every_ms: u32,
    /// The column names (the file's first row).
    pub headers: Vec<String>,
    pub rows: Vec<Vec<String>>,
    /// The row titles take their words from (from 0).
    pub row: usize,
    /// Why the file could not be read (empty: fine).
    pub error: String,
    #[ts(type = "number")]
    pub updated_at: Millis,
}

impl Default for DataFeed {
    fn default() -> Self {
        DataFeed {
            path: String::new(),
            every_ms: 1000,
            headers: Vec::new(),
            rows: Vec::new(),
            row: 0,
            error: String::new(),
            updated_at: 0,
        }
    }
}

impl DataFeed {
    pub fn repair(&mut self) {
        self.every_ms = self.every_ms.clamp(250, 60_000);
        self.headers.truncate(MAX_COLUMNS);
        for h in &mut self.headers {
            *h = clean(h.trim(), 60);
        }
        self.rows.truncate(MAX_ROWS);
        for r in &mut self.rows {
            r.truncate(MAX_COLUMNS);
            for c in r.iter_mut() {
                *c = clean(c, MAX_CELL);
            }
        }
        if self.row >= self.rows.len() {
            self.row = 0;
        }
        self.error = clean(&self.error, 200);
    }

    /// The chosen row's values by column name.
    #[must_use]
    pub fn values(&self) -> BTreeMap<&str, &str> {
        let row = self.rows.get(self.row);
        self.headers
            .iter()
            .enumerate()
            .map(|(i, h)| {
                (
                    h.as_str(),
                    row.and_then(|r| r.get(i)).map_or("", String::as_str),
                )
            })
            .collect()
    }
}

/// Which columns a scoreboard follows (empty: not linked).
#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", default)]
#[ts(export)]
pub struct ScoreLink {
    pub home_name: String,
    pub home_score: String,
    pub away_name: String,
    pub away_score: String,
    pub period: String,
}

impl ScoreLink {
    #[must_use]
    pub fn linked(&self) -> bool {
        [
            &self.home_name,
            &self.home_score,
            &self.away_name,
            &self.away_score,
            &self.period,
        ]
        .iter()
        .any(|c| !c.is_empty())
    }

    /// Bring the scoreboard in line with the data.
    pub fn apply(&self, sb: &mut crate::score::Scoreboard, values: &BTreeMap<&str, &str>) {
        let get = |c: &str| (!c.is_empty()).then(|| values.get(c).copied()).flatten();
        let score = |c: &str| get(c).and_then(|v| v.trim().parse::<i32>().ok());
        if let Some(v) = get(&self.home_name) {
            v.clone_into(&mut sb.home.name);
        }
        if let Some(v) = get(&self.away_name) {
            v.clone_into(&mut sb.away.name);
        }
        if let Some(v) = score(&self.home_score) {
            sb.home.score = v;
        }
        if let Some(v) = score(&self.away_score) {
            sb.away.score = v;
        }
        if let Some(v) = get(&self.period) {
            v.clone_into(&mut sb.period);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn values_come_from_the_chosen_row_and_scoreboards_follow() {
        let mut d = DataFeed {
            headers: vec!["Home".into(), "Home Score".into(), "Away Score".into()],
            rows: vec![
                vec!["Lions".into(), "3".into(), "x".into()],
                vec!["Tigers".into()],
            ],
            ..DataFeed::default()
        };
        assert_eq!(d.values()["Home"], "Lions");
        d.row = 1;
        assert_eq!(d.values()["Home Score"], "", "a short row");
        d.row = 0;
        let link = ScoreLink {
            home_name: "Home".into(),
            home_score: "Home Score".into(),
            away_score: "Away Score".into(),
            ..ScoreLink::default()
        };
        let mut sb = crate::score::Scoreboard::default();
        sb.away.score = 7;
        link.apply(&mut sb, &d.values());
        assert_eq!(
            (sb.home.name.as_str(), sb.home.score, sb.away.score),
            ("Lions", 3, 7)
        );
    }
}
