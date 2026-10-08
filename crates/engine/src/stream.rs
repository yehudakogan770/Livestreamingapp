//! Stream inputs: a live video link (SRT, RTMP, RTSP from IP cameras, HLS
//! `.m3u8`, or any video address) shown like a camera. The app reads it
//! with `FFmpeg` and hands the pictures to every screen and the recording.

use serde::{Deserialize, Serialize};
use ts_rs::TS;

/// Longest address.
pub const MAX_STREAM_URL: usize = 2000;

/// A stream input.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", default)]
#[ts(export)]
pub struct StreamInput {
    pub url: String,
    /// Extra waiting (ms) to ride out a shaky connection (0 – 10 000).
    pub buffer_ms: u32,
}

impl Default for StreamInput {
    fn default() -> Self {
        StreamInput {
            url: String::new(),
            buffer_ms: 500,
        }
    }
}

/// The kinds of address a stream input takes.
const SCHEMES: &[&str] = &[
    "srt://",
    "rtmp://",
    "rtmps://",
    "rtsp://",
    "rtsps://",
    "http://",
    "https://",
    "udp://",
    "rtp://", // An NDI source on the network, by its name ("PC (Camera 1)").
    "ndi://",
    // A Blackmagic capture card (DeckLink, UltraStudio, Intensity), by its
    // name: "decklink://DeckLink Duo (1)?input=sdi&audio=3-4".
    "decklink://",
];

/// A cleaned-up stream address, or None if it isn't one.
pub fn clean_stream_url(url: &str) -> Option<String> {
    let t = url.trim();
    let lower = t.to_ascii_lowercase();
    // NDI and capture card names have spaces; other addresses never do.
    let spaces_ok = lower.starts_with("ndi://") || lower.starts_with("decklink://");
    if t.is_empty()
        || t.len() > MAX_STREAM_URL
        || t.chars().any(char::is_control)
        || (!spaces_ok && t.chars().any(char::is_whitespace))
    {
        return None;
    }
    let scheme = SCHEMES.iter().find(|s| lower.starts_with(**s))?;
    (t.len() > scheme.len()).then(|| t.to_owned())
}

impl StreamInput {
    pub fn repair(&mut self) {
        self.buffer_ms = self.buffer_ms.min(10_000);
    }
}
