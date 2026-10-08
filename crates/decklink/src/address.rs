//! A capture input as Lumora writes it in the show: a stream input whose
//! address is `decklink://<card name>?input=sdi&audio=3-4`.
//!
//! - the card by the name Desktop Video gives it ("DeckLink Duo (2)",
//!   "UltraStudio Recorder 3G"), which stays the same between starts;
//! - `input`: which connector (SDI, HDMI…), when the card has more than one;
//! - `audio`: the pair of embedded audio channels heard (1-2 by default).

use crate::modes::Connection;

pub const SCHEME: &str = "decklink://";

/// Where to capture from.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct Address {
    pub device: String,
    pub connection: Option<Connection>,
    /// The audio pair, from 0 (channels 1 and 2) to 7 (channels 15 and 16).
    pub audio_pair: u8,
}

/// Is this a capture card address?
#[must_use]
pub fn is_decklink(url: &str) -> bool {
    url.len() >= SCHEME.len() && url[..SCHEME.len()].eq_ignore_ascii_case(SCHEME)
}

impl Address {
    /// Read an address (None: not a capture card address, or no card named).
    #[must_use]
    pub fn parse(url: &str) -> Option<Address> {
        if !is_decklink(url) {
            return None;
        }
        let rest = &url.trim()[SCHEME.len()..];
        let (name, query) = rest.rsplit_once('?').unwrap_or((rest, ""));
        let device = name.trim().to_owned();
        if device.is_empty() {
            return None;
        }
        let mut a = Address {
            device,
            connection: None,
            audio_pair: 0,
        };
        for kv in query.split('&') {
            let (k, v) = kv.split_once('=').unwrap_or((kv, ""));
            match k {
                "input" => a.connection = Connection::from_key(v),
                "audio" => {
                    // "3-4" (channels) or "2" (the pair's number).
                    let first = v.split(['-', '–']).next().unwrap_or("");
                    if let Ok(n) = first.trim().parse::<u8>() {
                        a.audio_pair = if v.contains(['-', '–']) {
                            n.saturating_sub(1) / 2
                        } else {
                            n.saturating_sub(1)
                        }
                        .min(7);
                    }
                }
                _ => {}
            }
        }
        Some(a)
    }

    /// As written in the show.
    #[must_use]
    pub fn url(&self) -> String {
        let mut q = Vec::new();
        if let Some(c) = self.connection {
            q.push(format!("input={}", c.key()));
        }
        if self.audio_pair > 0 {
            let first = u16::from(self.audio_pair) * 2 + 1;
            q.push(format!("audio={first}-{}", first + 1));
        }
        if q.is_empty() {
            format!("{SCHEME}{}", self.device)
        } else {
            format!("{SCHEME}{}?{}", self.device, q.join("&"))
        }
    }

    /// The capture this address shares with others (the same card and connector).
    #[must_use]
    pub fn capture_key(&self) -> String {
        format!(
            "{}|{}",
            self.device,
            self.connection.map_or("", Connection::key)
        )
    }
}

/// The audio pair `pair` of `channels` interleaved 32-bit samples, as 16-bit
/// stereo (little-endian bytes, what Lumora's mixer takes). A pair the
/// signal doesn't have is silence.
#[must_use]
pub fn stereo_s16(samples: &[i32], channels: u32, pair: u8) -> Vec<u8> {
    let ch = channels.max(1) as usize;
    let (l, r) = (usize::from(pair) * 2, usize::from(pair) * 2 + 1);
    let mut out = Vec::with_capacity(samples.len() / ch * 4);
    for frame in samples.chunks_exact(ch) {
        for i in [l, r] {
            let s = frame.get(i).map_or(0, |v| (v >> 16) as i16);
            out.extend_from_slice(&s.to_le_bytes());
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn addresses_round_trip() {
        let a = Address::parse("decklink://DeckLink Duo (2)?input=sdi&audio=3-4").unwrap();
        assert_eq!(a.device, "DeckLink Duo (2)");
        assert_eq!(a.connection, Some(Connection::Sdi));
        assert_eq!(a.audio_pair, 1);
        assert_eq!(a.url(), "decklink://DeckLink Duo (2)?input=sdi&audio=3-4");
        let b = Address::parse("DeckLink://Intensity Pro 4K").unwrap();
        assert_eq!((b.connection, b.audio_pair), (None, 0));
        assert_eq!(b.url(), "decklink://Intensity Pro 4K");
        assert_eq!(
            Address::parse("decklink://x?audio=16-17")
                .unwrap()
                .audio_pair,
            7
        );
        assert_eq!(
            Address::parse("decklink://x?audio=3").unwrap().audio_pair,
            2
        );
        assert!(Address::parse("decklink://").is_none());
        assert!(Address::parse("ndi://PC (Cam)").is_none());
        assert_ne!(
            Address::parse("decklink://x?input=sdi")
                .unwrap()
                .capture_key(),
            Address::parse("decklink://x?input=hdmi")
                .unwrap()
                .capture_key()
        );
        assert_eq!(
            Address::parse("decklink://x?audio=3-4")
                .unwrap()
                .capture_key(),
            Address::parse("decklink://x").unwrap().capture_key(),
            "audio pairs share one capture"
        );
    }

    #[test]
    fn an_audio_pair_is_taken_out_of_sixteen_channels() {
        // Two sample frames of 16 channels: channel n holds n << 16 (frame 2: negative).
        let mut s: Vec<i32> = (0..16).map(|c| c << 16).collect();
        s.extend((0..16).map(|c| -(c << 16)));
        let p = stereo_s16(&s, 16, 1);
        assert_eq!(p, [2, 0, 3, 0, 0xFE, 0xFF, 0xFD, 0xFF]);
        // A pair beyond the signal's channels is silence.
        assert_eq!(stereo_s16(&s[..4], 2, 3), [0; 8]);
        assert!(stereo_s16(&[], 16, 0).is_empty());
    }
}
