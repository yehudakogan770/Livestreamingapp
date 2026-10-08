//! Video modes, pixel formats and connections as the DeckLink API numbers
//! them (four-letter codes), and what Lumora makes of them: the picture
//! size, the frame rate, interlaced or not, and which pixel format to
//! capture a detected signal in.

use serde::Serialize;

/// A four-letter code as the DeckLink API writes it (`'Hi59'`).
#[must_use]
pub const fn fourcc(s: &[u8; 4]) -> u32 {
    u32::from_be_bytes(*s)
}

/// A video mode: what the signal is.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Mode {
    /// The DeckLink code (`BMDDisplayMode`).
    pub code: u32,
    pub width: u32,
    pub height: u32,
    /// Frames a second as a fraction (60000/1001 for 59.94).
    pub rate_num: u32,
    pub rate_den: u32,
    pub interlaced: bool,
}

impl Mode {
    #[must_use]
    pub fn fps(&self) -> f64 {
        f64::from(self.rate_num) / f64::from(self.rate_den.max(1))
    }

    /// As people say it: "1080i59.94", "2160p25", "720p50".
    #[must_use]
    pub fn name(&self) -> String {
        let fps = self.fps();
        // Interlaced is named by fields a second.
        let shown = if self.interlaced { fps * 2.0 } else { fps };
        let rate = if (shown - shown.round()).abs() < 0.005 {
            format!("{}", shown.round() as u32)
        } else {
            let s = format!("{shown:.2}");
            s.trim_end_matches('0').to_owned()
        };
        let lines = match (self.width, self.height) {
            (720, 486 | 480) => "NTSC ".to_owned(),
            (720, 576) => "PAL ".to_owned(),
            (_, h) => format!("{h}{}", if self.interlaced { 'i' } else { 'p' }),
        };
        if lines.ends_with(' ') {
            format!(
                "{}{}",
                lines.trim_end(),
                if self.interlaced { "" } else { " p" }
            )
        } else {
            format!("{lines}{rate}")
        }
    }
}

const NTSC: (u32, u32) = (30000, 1001);
const R2398: (u32, u32) = (24000, 1001);
const R2997: (u32, u32) = (30000, 1001);
const R4795: (u32, u32) = (48000, 1001);
const R5994: (u32, u32) = (60000, 1001);

/// A row of the table: code, width, height, rate, interlaced.
type ModeRow = (&'static [u8; 4], u32, u32, (u32, u32), bool);

/// Every mode Lumora knows.
#[rustfmt::skip]
const MODES: &[ModeRow] = &[
    (b"ntsc", 720, 486, NTSC, true),
    (b"nt23", 720, 486, R2398, true),
    (b"pal ", 720, 576, (25, 1), true),
    (b"ntsp", 720, 486, R5994, false),
    (b"palp", 720, 576, (50, 1), false),
    (b"23ps", 1920, 1080, R2398, false),
    (b"24ps", 1920, 1080, (24, 1), false),
    (b"Hp25", 1920, 1080, (25, 1), false),
    (b"Hp29", 1920, 1080, R2997, false),
    (b"Hp30", 1920, 1080, (30, 1), false),
    (b"Hp47", 1920, 1080, R4795, false),
    (b"Hp48", 1920, 1080, (48, 1), false),
    (b"Hp50", 1920, 1080, (50, 1), false),
    (b"Hp59", 1920, 1080, R5994, false),
    (b"Hp60", 1920, 1080, (60, 1), false),
    (b"Hi50", 1920, 1080, (25, 1), true),
    (b"Hi59", 1920, 1080, R2997, true),
    (b"Hi60", 1920, 1080, (30, 1), true),
    (b"hp50", 1280, 720, (50, 1), false),
    (b"hp59", 1280, 720, R5994, false),
    (b"hp60", 1280, 720, (60, 1), false),
    (b"2k23", 2048, 1556, R2398, false),
    (b"2k24", 2048, 1556, (24, 1), false),
    (b"2k25", 2048, 1556, (25, 1), false),
    (b"2d23", 2048, 1080, R2398, false),
    (b"2d24", 2048, 1080, (24, 1), false),
    (b"2d25", 2048, 1080, (25, 1), false),
    (b"2d29", 2048, 1080, R2997, false),
    (b"2d30", 2048, 1080, (30, 1), false),
    (b"2d50", 2048, 1080, (50, 1), false),
    (b"2d59", 2048, 1080, R5994, false),
    (b"2d60", 2048, 1080, (60, 1), false),
    (b"4k23", 3840, 2160, R2398, false),
    (b"4k24", 3840, 2160, (24, 1), false),
    (b"4k25", 3840, 2160, (25, 1), false),
    (b"4k29", 3840, 2160, R2997, false),
    (b"4k30", 3840, 2160, (30, 1), false),
    (b"4k47", 3840, 2160, R4795, false),
    (b"4k48", 3840, 2160, (48, 1), false),
    (b"4k50", 3840, 2160, (50, 1), false),
    (b"4k59", 3840, 2160, R5994, false),
    (b"4k60", 3840, 2160, (60, 1), false),
    (b"4d23", 4096, 2160, R2398, false),
    (b"4d24", 4096, 2160, (24, 1), false),
    (b"4d25", 4096, 2160, (25, 1), false),
    (b"4d29", 4096, 2160, R2997, false),
    (b"4d30", 4096, 2160, (30, 1), false),
    (b"4d50", 4096, 2160, (50, 1), false),
    (b"4d59", 4096, 2160, R5994, false),
    (b"4d60", 4096, 2160, (60, 1), false),
    (b"vga6", 640, 480, (60, 1), false),
    (b"svg6", 800, 600, (60, 1), false),
    (b"wxg5", 1440, 900, (50, 1), false),
    (b"wxg6", 1440, 900, (60, 1), false),
    (b"sxg5", 1440, 1080, (50, 1), false),
    (b"sxg6", 1440, 1080, (60, 1), false),
    (b"uxg5", 1600, 1200, (50, 1), false),
    (b"uxg6", 1600, 1200, (60, 1), false),
    (b"wux5", 1920, 1200, (50, 1), false),
    (b"wux6", 1920, 1200, (60, 1), false),
    (b"wqh5", 2560, 1440, (50, 1), false),
    (b"wqh6", 2560, 1440, (60, 1), false),
];

/// The mode with DeckLink code `code` (None: one Lumora doesn't know; the
/// driver's own width, height and rate are used then).
#[must_use]
pub fn mode(code: u32) -> Option<Mode> {
    MODES.iter().find(|m| fourcc(m.0) == code).map(
        |&(c, width, height, (rate_num, rate_den), interlaced)| Mode {
            code: fourcc(c),
            width,
            height,
            rate_num,
            rate_den,
            interlaced,
        },
    )
}

/// The mode a card is opened in before it has detected the signal (1080i59.94,
/// the most common in North American broadcast; detection switches it at once).
pub const START_MODE: u32 = fourcc(b"Hi59");

/// The DeckLink "mode unknown" code.
pub const MODE_UNKNOWN: u32 = fourcc(b"iunk");

/// Pixel formats (`BMDPixelFormat`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum PixelFormat {
    /// 8-bit 4:2:2 YUV, `2vuy`: U Y V Y, 2 pixels in 4 bytes.
    Uyvy,
    /// 10-bit 4:2:2 YUV, `v210`: 6 pixels in 16 bytes, rows padded to 128 bytes.
    V210,
    /// 8-bit B, G, R, A.
    Bgra,
}

impl PixelFormat {
    #[must_use]
    pub const fn code(self) -> u32 {
        match self {
            PixelFormat::Uyvy => fourcc(b"2vuy"),
            PixelFormat::V210 => fourcc(b"v210"),
            PixelFormat::Bgra => fourcc(b"BGRA"),
        }
    }

    #[must_use]
    pub fn from_code(c: u32) -> Option<Self> {
        [PixelFormat::Uyvy, PixelFormat::V210, PixelFormat::Bgra]
            .into_iter()
            .find(|p| p.code() == c)
    }

    /// Bytes in one row of `width` pixels, as the card lays them out.
    #[must_use]
    pub const fn row_bytes(self, width: u32) -> usize {
        let w = width as usize;
        match self {
            PixelFormat::Uyvy => w.div_ceil(2) * 4,
            PixelFormat::V210 => w.div_ceil(48) * 128,
            PixelFormat::Bgra => w * 4,
        }
    }
}

/// `BMDDetectedVideoInputFormatFlags`.
pub const DETECTED_YCBCR422: u32 = 1 << 0;
pub const DETECTED_RGB444: u32 = 1 << 1;
pub const DETECTED_12BIT: u32 = 1 << 3;
pub const DETECTED_10BIT: u32 = 1 << 4;

/// The pixel format to capture a detected signal in: RGB signals (a
/// computer's HDMI) as BGRA; YUV signals as 8-bit YUV, or 10-bit when
/// asked for and the signal is deeper than 8 bits.
#[must_use]
pub fn capture_format(detected: u32, prefer_10bit: bool) -> PixelFormat {
    if detected & DETECTED_RGB444 != 0 {
        PixelFormat::Bgra
    } else if prefer_10bit && detected & (DETECTED_10BIT | DETECTED_12BIT) != 0 {
        PixelFormat::V210
    } else {
        PixelFormat::Uyvy
    }
}

/// A video connection (`BMDVideoConnection` bits).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Connection {
    Sdi,
    Hdmi,
    OpticalSdi,
    Component,
    Composite,
    SVideo,
}

impl Connection {
    pub const ALL: [Connection; 6] = [
        Connection::Sdi,
        Connection::Hdmi,
        Connection::OpticalSdi,
        Connection::Component,
        Connection::Composite,
        Connection::SVideo,
    ];

    #[must_use]
    pub const fn bit(self) -> i64 {
        match self {
            Connection::Sdi => 1,
            Connection::Hdmi => 1 << 1,
            Connection::OpticalSdi => 1 << 2,
            Connection::Component => 1 << 3,
            Connection::Composite => 1 << 4,
            Connection::SVideo => 1 << 5,
        }
    }

    /// The connections in a bit field.
    #[must_use]
    pub fn from_bits(bits: i64) -> Vec<Connection> {
        Connection::ALL
            .into_iter()
            .filter(|c| bits & c.bit() != 0)
            .collect()
    }

    /// As written in a `decklink://` address (`sdi`, `hdmi`…).
    #[must_use]
    pub const fn key(self) -> &'static str {
        match self {
            Connection::Sdi => "sdi",
            Connection::Hdmi => "hdmi",
            Connection::OpticalSdi => "optical",
            Connection::Component => "component",
            Connection::Composite => "composite",
            Connection::SVideo => "svideo",
        }
    }

    #[must_use]
    pub fn from_key(k: &str) -> Option<Connection> {
        Connection::ALL
            .into_iter()
            .find(|c| c.key().eq_ignore_ascii_case(k))
    }

    /// For people: "SDI", "HDMI"…
    #[must_use]
    pub const fn label(self) -> &'static str {
        match self {
            Connection::Sdi => "SDI",
            Connection::Hdmi => "HDMI",
            Connection::OpticalSdi => "Optical SDI",
            Connection::Component => "Component",
            Connection::Composite => "Composite",
            Connection::SVideo => "S-Video",
        }
    }
}

/// How many embedded audio channels to capture (the API takes 2, 8 or 16;
/// 16 is SDI's most): as many as the card takes, up to 16.
#[must_use]
pub fn audio_channels(max: i64) -> u32 {
    match max {
        m if m >= 16 => 16,
        m if m >= 8 => 8,
        _ => 2,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detected_modes_map_to_size_rate_and_scan() {
        let m = mode(0x4869_3539).unwrap(); // 'Hi59'
        assert_eq!((m.width, m.height, m.interlaced), (1920, 1080, true));
        assert!((m.fps() - 29.97).abs() < 0.01);
        assert_eq!(m.name(), "1080i59.94");
        let m = mode(fourcc(b"Hp50")).unwrap();
        assert_eq!(m.name(), "1080p50");
        assert_eq!(mode(fourcc(b"hp59")).unwrap().name(), "720p59.94");
        assert_eq!(mode(fourcc(b"4k25")).unwrap().name(), "2160p25");
        assert_eq!(mode(fourcc(b"23ps")).unwrap().name(), "1080p23.98");
        assert_eq!(mode(fourcc(b"Hi50")).unwrap().name(), "1080i50");
        assert_eq!(mode(fourcc(b"ntsc")).unwrap().name(), "NTSC");
        assert_eq!(mode(fourcc(b"pal ")).unwrap().name(), "PAL");
        assert_eq!(mode(fourcc(b"palp")).unwrap().name(), "PAL p");
        assert_eq!(mode(fourcc(b"wux6")).unwrap().width, 1920);
        assert!(mode(MODE_UNKNOWN).is_none());
        assert!(mode(0).is_none());
        // Every code in the table is unique.
        let mut codes: Vec<u32> = MODES.iter().map(|m| fourcc(m.0)).collect();
        codes.sort_unstable();
        codes.dedup();
        assert_eq!(codes.len(), MODES.len());
    }

    #[test]
    fn the_capture_format_follows_the_detected_signal() {
        assert_eq!(
            capture_format(DETECTED_YCBCR422 | DETECTED_10BIT, false),
            PixelFormat::Uyvy
        );
        assert_eq!(
            capture_format(DETECTED_YCBCR422 | DETECTED_10BIT, true),
            PixelFormat::V210
        );
        assert_eq!(
            capture_format(DETECTED_YCBCR422 | (1 << 5), true),
            PixelFormat::Uyvy
        );
        assert_eq!(
            capture_format(DETECTED_RGB444 | DETECTED_10BIT, true),
            PixelFormat::Bgra
        );
        assert_eq!(PixelFormat::from_code(0x7632_3130), Some(PixelFormat::V210));
        assert_eq!(PixelFormat::Uyvy.code(), 0x3276_7579);
        assert_eq!(PixelFormat::Bgra.code(), 0x4247_5241);
    }

    #[test]
    fn row_sizes_match_the_cards() {
        assert_eq!(PixelFormat::Uyvy.row_bytes(1920), 3840);
        assert_eq!(PixelFormat::V210.row_bytes(1920), 5120);
        assert_eq!(PixelFormat::V210.row_bytes(1280), 3456);
        assert_eq!(PixelFormat::V210.row_bytes(720), 1920);
        assert_eq!(PixelFormat::Bgra.row_bytes(1280), 5120);
    }

    #[test]
    fn connections_and_audio_channels() {
        assert_eq!(
            Connection::from_bits(0b11),
            vec![Connection::Sdi, Connection::Hdmi]
        );
        assert_eq!(Connection::from_key("HDMI"), Some(Connection::Hdmi));
        assert_eq!(Connection::from_key("dvi"), None);
        assert_eq!(audio_channels(64), 16);
        assert_eq!(audio_channels(8), 8);
        assert_eq!(audio_channels(2), 2);
        assert_eq!(audio_channels(0), 2);
    }
}
