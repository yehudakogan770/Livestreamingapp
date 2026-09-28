//! The event itself: its name, its logo, and what the screens show in an
//! emergency. Asked for when an event is set up.

use serde::{Deserialize, Serialize};
use ts_rs::TS;

/// Longest event name.
pub const MAX_EVENT_NAME_LEN: usize = 80;

/// What a screen shows when it has to show "nothing".
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize, TS)]
#[serde(rename_all = "lowercase")]
#[ts(export)]
pub enum SafeScreen {
    #[default]
    Black,
    /// The event logo on black (black if there is no logo).
    Logo,
}

/// The event and its emergency plan.
#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", default)]
#[ts(export)]
pub struct EventInfo {
    pub name: String,
    /// Picture file of the event logo.
    pub logo: Option<String>,
    /// What a screen shows when a camera or video on it stops working.
    pub on_failure: SafeScreen,
    /// What the Live and Back screens show while PANIC is on.
    pub panic_shows: SafeScreen,
    /// The setup questions have been answered (or skipped).
    pub set_up: bool,
}

/// Changes to the event. Fields left out stay as they are.
#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct EventPatch {
    #[serde(default)]
    #[ts(optional)]
    pub name: Option<String>,
    /// A picture path, or "" to remove the logo.
    #[serde(default)]
    #[ts(optional)]
    pub logo: Option<String>,
    #[serde(default)]
    #[ts(optional)]
    pub on_failure: Option<SafeScreen>,
    #[serde(default)]
    #[ts(optional)]
    pub panic_shows: Option<SafeScreen>,
    #[serde(default)]
    #[ts(optional)]
    pub set_up: Option<bool>,
}
