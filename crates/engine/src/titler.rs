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
        g.template = "x".repeat(MAX_TEMPLATE + 1);
        g.repair();
        assert!(g.template.is_empty());
    }
}
