//! Web page inputs: a web page shown like a camera. The app keeps the page
//! open in its own window (where it can be clicked on and typed into) and
//! captures that window for every screen and the recording.

use serde::{Deserialize, Serialize};
use ts_rs::TS;

/// Longest web address.
pub const MAX_URL_LEN: usize = 2000;

/// A web page input.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", default)]
#[ts(export)]
pub struct BrowserInput {
    pub url: String,
    /// The page's size in pixels (what is captured).
    pub width: u32,
    pub height: u32,
    /// Page zoom, 25 – 400 %.
    pub zoom: u32,
    /// Let the page's own transparent parts show what is behind.
    pub transparent: bool,
    /// Reload by itself every this many minutes (0: never).
    pub refresh_min: u32,
    /// Clicks on the page window are blocked (nobody can change it by accident).
    pub view_only: bool,
    /// Bumped to reload the page now.
    pub reload: u32,
}

impl Default for BrowserInput {
    fn default() -> Self {
        BrowserInput {
            url: "https://".to_owned(),
            width: 1280,
            height: 720,
            zoom: 100,
            transparent: false,
            refresh_min: 0,
            view_only: false,
            reload: 0,
        }
    }
}

/// A web address as typed: `example.com` becomes `https://example.com`.
/// Only http and https pages (and local files) can be shown.
pub fn clean_url(url: &str) -> Option<String> {
    let t = url.trim();
    if t.is_empty() || t.len() > MAX_URL_LEN || t.chars().any(char::is_whitespace) {
        return None;
    }
    let lower = t.to_ascii_lowercase();
    if lower.starts_with("https://")
        || lower.starts_with("http://")
        || lower.starts_with("file:///")
    {
        let rest = &t[t.find("://").map_or(0, |i| i + 3)..];
        return (!rest.is_empty()).then(|| t.to_owned());
    }
    if lower.contains("://") || lower.starts_with("javascript:") || lower.starts_with("data:") {
        return None;
    }
    Some(format!("https://{t}"))
}

impl BrowserInput {
    pub fn repair(&mut self) {
        let d = BrowserInput::default();
        if clean_url(&self.url).is_none() && self.url != d.url {
            self.url.clone_from(&d.url);
        }
        self.width = self.width.clamp(320, 3840);
        self.height = self.height.clamp(240, 2160);
        self.zoom = self.zoom.clamp(25, 400);
        self.refresh_min = self.refresh_min.min(24 * 60);
    }
}

/// A guest who joins from their phone or computer by a link. They send
/// their camera and microphone through VDO.Ninja (free, in the browser, no
/// account); Lumora shows them like a web page input, sound included.
#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", default)]
#[ts(export)]
pub struct Guest {
    /// The private room name in both links (letters and digits only).
    pub room: String,
    /// Bumped to reload the guest's picture now.
    pub reload: u32,
}

impl Guest {
    /// Keep only letters and digits, 6 – 40 of them.
    pub fn repair(&mut self) {
        self.room = self
            .room
            .chars()
            .filter(char::is_ascii_alphanumeric)
            .take(40)
            .collect();
    }

    #[must_use]
    pub fn valid(&self) -> bool {
        self.room.len() >= 6
    }

    /// The link the guest opens.
    #[must_use]
    pub fn invite_url(&self, name: &str) -> String {
        let label: String = name
            .chars()
            .filter(char::is_ascii_alphanumeric)
            .take(30)
            .collect();
        format!(
            "https://vdo.ninja/?push={}&webcam&label={label}&quality=0",
            self.room
        )
    }

    /// The page Lumora opens to receive the guest.
    #[must_use]
    pub fn page(&self) -> BrowserInput {
        BrowserInput {
            url: format!(
                "https://vdo.ninja/?view={}&cleanoutput&scale=100&noaudioprocessing",
                self.room
            ),
            width: 1280,
            height: 720,
            view_only: true,
            reload: self.reload,
            ..BrowserInput::default()
        }
    }
}
