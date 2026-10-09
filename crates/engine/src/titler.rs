//! Graphics made in Lumora Titler: the template (a `.lumtitle` project, kept
//! as its JSON text and drawn by the Titler renderer in the windows) and the
//! values of its fields, which the operator changes while it is on air.

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::model::SourceId;

/// The largest template kept (pictures and fonts travel inside it).
pub const MAX_TEMPLATE: usize = 24 * 1024 * 1024;
/// The most fields a graphic has.
pub const MAX_VALUES: usize = 200;
/// The longest value (a picture field holds a data URL).
pub const MAX_VALUE: usize = 4 * 1024 * 1024;

/// One field's value: `{{key}}` in the template becomes `value`.
#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", default)]
#[ts(export)]
pub struct TitlerValue {
    pub key: String,
    pub value: String,
}

/// The most tables a graphic keeps (one per data source of its template).
pub const MAX_TABLES: usize = 8;
/// The most rows, columns and characters a cell of a table keeps.
pub const MAX_ROWS: usize = 1000;
pub const MAX_COLUMNS: usize = 40;
pub const MAX_CELL: usize = 2000;

/// What one of the template's own data sources (a CSV file, a Google Sheet,
/// a JSON address) held when the control window last read it.
#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", default)]
#[ts(export)]
pub struct TitlerTable {
    /// The data source's id in the template.
    pub source: String,
    pub headers: Vec<String>,
    pub rows: Vec<Vec<String>>,
    /// Why it could not be read (empty when it was).
    pub error: String,
}

impl TitlerTable {
    fn repair(&mut self) {
        clip(&mut self.source, 80);
        self.headers.truncate(MAX_COLUMNS);
        self.rows.truncate(MAX_ROWS);
        for h in &mut self.headers {
            clip(h, 200);
        }
        for r in &mut self.rows {
            r.truncate(MAX_COLUMNS);
            for c in r {
                clip(c, MAX_CELL);
            }
        }
        clip(&mut self.error, 300);
    }
}

/// A Titler graphic input.
#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", default)]
#[ts(export)]
pub struct TitlerGraphic {
    /// The `.lumtitle` project, as JSON text.
    pub template: String,
    /// The fields as the operator set them (fields left out show their sample).
    pub values: Vec<TitlerValue>,
    /// The scoreboard input whose teams, scores and clock fill score fields
    /// (None: the first scoreboard of the event).
    pub scoreboard: Option<SourceId>,
    /// The template's own data sources as last read (by the control window).
    pub data: Vec<TitlerTable>,
    /// The row the operator chose for them (from 0; None: each source's own row).
    pub data_row: Option<u32>,
}

fn clip(s: &mut String, max: usize) {
    if s.len() > max {
        let mut end = max;
        while !s.is_char_boundary(end) {
            end -= 1;
        }
        s.truncate(end);
    }
}

impl TitlerGraphic {
    /// Keep it within limits: no huge template, no endless or duplicate fields.
    pub fn repair(&mut self) {
        if self.template.len() > MAX_TEMPLATE {
            self.template.clear();
        }
        let mut seen = std::collections::HashSet::new();
        self.values
            .retain(|v| !v.key.is_empty() && v.key.len() <= 60 && seen.insert(v.key.clone()));
        self.values.truncate(MAX_VALUES);
        for v in &mut self.values {
            clip(&mut v.value, MAX_VALUE);
        }
        self.data.truncate(MAX_TABLES);
        for t in &mut self.data {
            t.repair();
        }
        if let Some(r) = self.data_row {
            self.data_row = Some(r.min(self.last_row()));
        }
    }

    /// The last row of the longest table (0 with none).
    pub fn last_row(&self) -> u32 {
        let most = self.data.iter().map(|t| t.rows.len()).max().unwrap_or(0);
        u32::try_from(most.saturating_sub(1)).unwrap_or(u32::MAX)
    }

    /// Does it have rows to step through?
    pub fn has_rows(&self) -> bool {
        self.data.iter().any(|t| !t.rows.is_empty())
    }

    /// The next (positive) or previous row, from the chosen one (or the first).
    pub fn step_row(&mut self, delta: i32) {
        if !self.has_rows() {
            return;
        }
        let now = self.data_row.unwrap_or(0);
        let next = if delta < 0 {
            now.saturating_sub(delta.unsigned_abs())
        } else {
            now.saturating_add(delta.unsigned_abs()).min(self.last_row())
        };
        self.data_row = Some(next);
    }

    /// Change some fields (others stay as they are).
    pub fn set_values(&mut self, values: Vec<TitlerValue>) {
        for v in values {
            match self.values.iter_mut().find(|x| x.key == v.key) {
                Some(x) => x.value = v.value,
                None => self.values.push(v),
            }
        }
        self.repair();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn values_change_one_at_a_time_and_stay_within_limits() {
        let mut g = TitlerGraphic {
            template: "{}".into(),
            values: vec![
                TitlerValue {
                    key: "name".into(),
                    value: "A".into(),
                },
                TitlerValue {
                    key: "name".into(),
                    value: "B".into(),
                },
                TitlerValue {
                    key: String::new(),
                    value: "x".into(),
                },
            ],
            scoreboard: None,
            ..Default::default()
        };
        g.repair();
        assert_eq!(g.values.len(), 1, "duplicates and empty keys go");
        g.set_values(vec![
            TitlerValue {
                key: "name".into(),
                value: "Jordan".into(),
            },
            TitlerValue {
                key: "role".into(),
                value: "Host".into(),
            },
        ]);
        assert_eq!(g.values[0].value, "Jordan");
        assert_eq!(g.values[1].key, "role");
        // Its own data: rows stepped through within the table, kept within limits.
        g.data = vec![TitlerTable {
            source: "d1".into(),
            headers: vec!["name".into()],
            rows: (0..3).map(|i| vec![format!("Speaker {i}")]).collect(),
            error: String::new(),
        }];
        g.step_row(1);
        assert_eq!(g.data_row, Some(1));
        g.step_row(5);
        assert_eq!(g.data_row, Some(2), "stops at the last row");
        g.step_row(-9);
        assert_eq!(g.data_row, Some(0));
        g.data[0].rows = (0..MAX_ROWS + 10).map(|_| vec!["x".repeat(MAX_CELL + 5)]).collect();
        g.data_row = Some(5000);
        g.repair();
        assert_eq!(g.data[0].rows.len(), MAX_ROWS);
        assert_eq!(g.data[0].rows[0][0].len(), MAX_CELL);
        assert_eq!(g.data_row, Some(MAX_ROWS as u32 - 1));
        g.template = "x".repeat(MAX_TEMPLATE + 1);
        g.repair();
        assert!(g.template.is_empty());
    }
}
