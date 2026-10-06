//! Macros: a named list of steps (with waits) the operator runs with one
//! button, a key, the Stream Deck, the control API, or at a clock time (a
//! trigger that runs it). "Start show": start recording, wait 2 s, go live,
//! take the countdown.
//!
//! Some steps — recording, streaming and instant replay — are done by the
//! control window, not the engine. The engine leaves them as [`AppRequest`]s
//! in the show; the control window carries out each new one once.

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::presets::{Step, MAX_PRESET_NAME_LEN};

/// Most macros in a show.
pub const MAX_MACROS: usize = 100;
/// Requests kept in the show (only new ones are carried out).
pub const MAX_REQUESTS: usize = 16;
/// Most step lists running at once (stops a macro that runs itself forever).
pub const MAX_RUNNING: usize = 16;
/// Longest key name ("Ctrl+Shift+F12").
const MAX_HOTKEY_LEN: usize = 40;

/// One macro.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", default)]
#[ts(export)]
pub struct Macro {
    pub id: String,
    pub name: String,
    pub steps: Vec<Step>,
    /// The key that runs it in the control window ("Ctrl+1", "F5"; empty: none).
    pub hotkey: String,
}

impl Default for Macro {
    fn default() -> Self {
        Macro {
            id: String::new(),
            name: "Macro".to_owned(),
            steps: Vec::new(),
            hotkey: String::new(),
        }
    }
}

impl Macro {
    pub fn repair(&mut self) {
        self.name = self
            .name
            .trim()
            .chars()
            .filter(|c| !c.is_control())
            .take(MAX_PRESET_NAME_LEN)
            .collect();
        if self.name.is_empty() {
            "Macro".clone_into(&mut self.name);
        }
        self.hotkey = self
            .hotkey
            .trim()
            .chars()
            .filter(|c| !c.is_control())
            .take(MAX_HOTKEY_LEN)
            .collect();
    }
}

/// Something only the control window can do.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(
    tag = "command",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
#[ts(export)]
pub enum AppStep {
    /// Start (`on`) or stop the recording.
    Record { on: bool },
    /// Go live (`on`) or end the stream.
    Stream { on: bool },
    /// Replay the last `seconds` into Next (slow: half speed).
    Replay { seconds: u32, slow: bool },
}

impl AppStep {
    /// The same request with its numbers in range.
    #[must_use]
    pub fn clamped(self) -> Self {
        match self {
            AppStep::Replay { seconds, slow } => AppStep::Replay {
                seconds: seconds.clamp(1, 60),
                slow,
            },
            other => other,
        }
    }
}

/// A request left for the control window, numbered so each runs once.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct AppRequest {
    #[ts(type = "number")]
    pub seq: u64,
    pub step: AppStep,
}

/// Add a request, keeping only the newest few.
pub fn push_request(list: &mut Vec<AppRequest>, step: AppStep) {
    let seq = list.iter().map(|r| r.seq).max().unwrap_or(0) + 1;
    list.push(AppRequest {
        seq,
        step: step.clamped(),
    });
    if list.len() > MAX_REQUESTS {
        let drop = list.len() - MAX_REQUESTS;
        list.drain(..drop);
    }
}

/// The macro a control surface names: by id, by name (any case), or by its
/// number in the list (1, 2…).
#[must_use]
pub fn find<'a>(macros: &'a [Macro], key: &str) -> Option<&'a Macro> {
    let key = key.trim();
    macros
        .iter()
        .find(|m| m.id == key)
        .or_else(|| macros.iter().find(|m| m.name.eq_ignore_ascii_case(key)))
        .or_else(|| {
            key.parse::<usize>()
                .ok()
                .and_then(|n| n.checked_sub(1))
                .and_then(|i| macros.get(i))
        })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn requests_are_numbered_and_only_the_newest_kept() {
        let mut list = Vec::new();
        for _ in 0..20 {
            push_request(&mut list, AppStep::Record { on: true });
        }
        assert_eq!(list.len(), MAX_REQUESTS);
        assert_eq!(list.last().unwrap().seq, 20);
        assert_eq!(list.first().unwrap().seq, 5);
        push_request(
            &mut list,
            AppStep::Replay {
                seconds: 500,
                slow: false,
            },
        );
        assert_eq!(
            list.last().unwrap().step,
            AppStep::Replay {
                seconds: 60,
                slow: false
            }
        );
    }

    #[test]
    fn macros_are_found_by_id_name_or_number() {
        let m = |id: &str, name: &str| Macro {
            id: id.into(),
            name: name.into(),
            ..Macro::default()
        };
        let list = vec![m("m1", "Start show"), m("m2", "End show")];
        assert_eq!(find(&list, "m2").unwrap().name, "End show");
        assert_eq!(find(&list, "start SHOW").unwrap().id, "m1");
        assert_eq!(find(&list, "2").unwrap().id, "m2");
        assert!(find(&list, "3").is_none());
        assert!(find(&list, "nothing").is_none());
    }

    #[test]
    fn repair_keeps_names_short_and_clean() {
        let mut m = Macro {
            name: format!("  {}\n", "x".repeat(99)),
            hotkey: " Ctrl+1 ".into(),
            ..Macro::default()
        };
        m.repair();
        assert_eq!(m.name.len(), MAX_PRESET_NAME_LEN);
        assert_eq!(m.hotkey, "Ctrl+1");
        let mut empty = Macro {
            name: "  ".into(),
            ..Macro::default()
        };
        empty.repair();
        assert_eq!(empty.name, "Macro");
    }
}
