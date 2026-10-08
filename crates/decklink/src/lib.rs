//! # Blackmagic DeckLink, UltraStudio and Intensity
//!
//! SDI and HDMI capture (and playout) through the DeckLink API that
//! Blackmagic Desktop Video installs. Nothing of Blackmagic's ships with
//! Lumora: when Desktop Video isn't installed, listing the cards says how to
//! install it (FFmpeg's DeckLink support can't be shipped either: it is
//! "nonfree", so the API is used directly here).
//!
//! - [`modes`]: video modes, pixel formats and connectors as the API numbers
//!   them, and what the detected signal means (size, rate, interlaced).
//! - [`convert`]: the card's UYVY, v210 and BGRA into NV12 (the unified
//!   engine) or RGBA (the Standard engine's pictures), and RGBA into UYVY
//!   for playout.
//! - [`address`]: a capture input as written in the show
//!   (`decklink://DeckLink Duo (1)?input=sdi&audio=3-4`), and the audio pair.
//! - [`capture`]: each input opened once, its frames shared by every part
//!   of Lumora that shows or hears it.
//! - `com` / `win` (Windows): the COM interfaces and the capture and
//!   playout themselves.

pub mod address;
pub mod capture;
pub mod convert;
pub mod modes;

#[cfg(windows)]
pub mod com;
#[cfg(windows)]
mod win;

use serde::Serialize;

pub use address::{is_decklink, Address};
pub use capture::{subscribe, AudioRef, Event, Signal, SignalState, Subscription, VideoRef};
pub use modes::{Connection, Mode, PixelFormat};

/// What to do when Desktop Video isn't installed, in words for the operator.
pub const INSTALL_HELP: &str = "Blackmagic Desktop Video isn't installed. Download it free from blackmagicdesign.com/support (Capture and Playback → Desktop Video), install it, restart the computer, then open Lumora again.";

/// One card (or one of a card's sub-devices: a DeckLink Duo has several).
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Device {
    /// The name Desktop Video gives it ("DeckLink Duo (2)"), used in addresses.
    pub name: String,
    /// "DeckLink Duo 2", "UltraStudio Recorder 3G".
    pub model: String,
    pub can_capture: bool,
    pub can_playout: bool,
    /// Its input connectors (SDI, HDMI…).
    pub inputs: Vec<Connection>,
    pub outputs: Vec<Connection>,
    /// It finds the signal's format by itself.
    pub detects_format: bool,
    /// Embedded audio channels it can capture.
    pub audio_channels: u32,
}

/// The cards in this computer.
///
/// # Errors
/// Desktop Video isn't installed ([`INSTALL_HELP`]), or this isn't Windows.
pub fn devices() -> Result<Vec<Device>, String> {
    backend::devices()
}

#[cfg(windows)]
use win as backend;

#[cfg(not(windows))]
mod backend {
    use std::sync::Arc;

    use crate::capture::Capture;

    pub const NOT_HERE: &str =
        "Blackmagic capture cards work with Lumora on Windows (with Blackmagic Desktop Video).";

    pub fn devices() -> Result<Vec<crate::Device>, String> {
        Err(NOT_HERE.to_owned())
    }

    #[allow(clippy::needless_pass_by_value)] // the capture thread owns it
    pub fn run(c: Arc<Capture>) {
        c.fail(NOT_HERE);
    }

    pub struct Playout;

    impl Playout {
        pub fn open(_: &str, _: u32, _: u32, _: f64) -> Result<Playout, String> {
            Err(NOT_HERE.to_owned())
        }
        pub fn show_uyvy(&self, _: &[u8]) -> Result<(), String> {
            Err(NOT_HERE.to_owned())
        }
        pub fn mode_name(&self) -> String {
            String::new()
        }
    }
}

/// Program out over SDI or HDMI: frames shown on a card's output as they come.
pub struct Playout(backend::Playout);

impl Playout {
    /// Open card `name`'s output at the mode matching `width` × `height` at
    /// `fps` (progressive; 1080p59.94 for 1920 × 1080 at 59.94…).
    ///
    /// # Errors
    /// No such card, it can't play out, or it has no such mode.
    pub fn open(name: &str, width: u32, height: u32, fps: f64) -> Result<Playout, String> {
        backend::Playout::open(name, width, height, fps).map(Playout)
    }

    /// Show one frame (UYVY, `width × 2` bytes a row).
    ///
    /// # Errors
    /// The card refused it.
    pub fn show_uyvy(&self, uyvy: &[u8]) -> Result<(), String> {
        self.0.show_uyvy(uyvy)
    }

    /// The mode it plays in ("1080p59.94").
    #[must_use]
    pub fn mode_name(&self) -> String {
        self.0.mode_name()
    }
}

/// The DeckLink mode to play `width` × `height` at `fps` in (progressive).
#[must_use]
pub fn playout_mode(width: u32, height: u32, fps: f64) -> Option<Mode> {
    const CODES: [&[u8; 4]; 19] = [
        b"23ps", b"24ps", b"Hp25", b"Hp29", b"Hp30", b"Hp50", b"Hp59", b"Hp60", b"hp50", b"hp59",
        b"hp60", b"4k23", b"4k24", b"4k25", b"4k29", b"4k30", b"4k50", b"4k59", b"4k60",
    ];
    CODES
        .iter()
        .filter_map(|c| modes::mode(modes::fourcc(c)))
        .filter(|m| m.width == width && m.height == height)
        .min_by(|a, b| {
            (a.fps() - fps)
                .abs()
                .partial_cmp(&(b.fps() - fps).abs())
                .unwrap_or(std::cmp::Ordering::Equal)
        })
        .filter(|m| (m.fps() - fps).abs() < 0.6)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn playout_modes_are_picked_by_size_and_rate() {
        assert_eq!(
            playout_mode(1920, 1080, 59.94).unwrap().name(),
            "1080p59.94"
        );
        assert_eq!(playout_mode(1920, 1080, 60.0).unwrap().name(), "1080p60");
        assert_eq!(playout_mode(1920, 1080, 30.0).unwrap().name(), "1080p30");
        assert_eq!(playout_mode(1280, 720, 50.0).unwrap().name(), "720p50");
        assert_eq!(playout_mode(3840, 2160, 25.0).unwrap().name(), "2160p25");
        assert!(playout_mode(1920, 1080, 15.0).is_none());
        assert!(playout_mode(1000, 1000, 30.0).is_none());
    }

    #[cfg(not(windows))]
    #[test]
    fn elsewhere_it_says_windows_is_needed() {
        assert!(devices().unwrap_err().contains("Windows"));
        assert!(Playout::open("x", 1920, 1080, 30.0).is_err());
    }
}
