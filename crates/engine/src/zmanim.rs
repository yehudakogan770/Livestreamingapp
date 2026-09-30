//! Where the event is, for the Hebrew date, the day's zmanim and candle
//! lighting (all worked out on the computer, offline), and the zmanim input
//! that shows them.

use serde::{Deserialize, Serialize};
use ts_rs::TS;

/// Where the event is and what to do before Shabbos and Yom Tov.
#[allow(clippy::struct_excessive_bools)]
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", default)]
#[ts(export)]
pub struct Place {
    /// The city's name (shown on screen).
    pub name: String,
    /// Latitude and longitude, in millionths of a degree.
    pub lat_micro: i32,
    pub lon_micro: i32,
    /// Candles are lit this many minutes before sunset (18; 40 in Jerusalem).
    pub candle_minutes: u32,
    /// One day of Yom Tov (in Israel) instead of two.
    pub israel: bool,
    /// End the live stream and recording before candle lighting.
    pub stop_before: bool,
    /// ... this many minutes before it.
    pub stop_minutes: u32,
    /// Tell the stage monitor as candle lighting comes close.
    pub warn_monitor: bool,
}

impl Default for Place {
    fn default() -> Self {
        Place {
            name: String::new(),
            lat_micro: 0,
            lon_micro: 0,
            candle_minutes: 18,
            israel: false,
            stop_before: false,
            stop_minutes: 10,
            warn_monitor: true,
        }
    }
}

impl Place {
    #[must_use]
    pub fn cleaned(mut self) -> Self {
        self.name = self
            .name
            .chars()
            .filter(|c| !c.is_control())
            .take(60)
            .collect();
        self.lat_micro = self.lat_micro.clamp(-90_000_000, 90_000_000);
        self.lon_micro = self.lon_micro.clamp(-180_000_000, 180_000_000);
        self.candle_minutes = self.candle_minutes.min(90);
        self.stop_minutes = self.stop_minutes.min(120);
        self
    }
}

/// How the zmanim input looks.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub enum ZmanimStyle {
    /// The Hebrew date and the day's zmanim.
    #[default]
    Card,
    /// One line along the bottom (over the picture).
    Bar,
    /// A big countdown to candle lighting.
    Countdown,
}

#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", default)]
#[ts(export)]
pub struct ZmanimCard {
    pub style: ZmanimStyle,
}
