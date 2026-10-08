//! Blackmagic capture cards (DeckLink, UltraStudio, Intensity) as engine
//! sources: a stream input whose address is `decklink://<card>?input=sdi`.
//!
//! The card's frames come straight from the driver (`lumora-decklink`): the
//! card's 4:2:2 YUV is made NV12 on the card's thread (one pass, into this
//! source's pooled buffers) and turned into RGB on the GPU like a camera's;
//! an RGB signal (a computer's HDMI) is passed on as BGRA. The capture is
//! shared with the rest of the app (the mixer hears the same input's sound),
//! so the card is opened once.

use std::sync::Arc;

use lumora_decklink::capture::{Event, SignalState, Subscription};
use lumora_decklink::convert;
use lumora_decklink::{Address, PixelFormat as CardPixels};

use crate::frame::{FramePool, PixelFormat, VideoFrame};
use crate::source::{Mailbox, SourceHealth, SourceState, Unavailable, VideoSource};

pub use lumora_decklink::is_decklink;

/// What identifies the capture (the card and connector; the audio pair is the mixer's business).
pub fn key(url: &str) -> String {
    Address::parse(url).map_or_else(
        || format!("decklink:{url}"),
        |a| format!("decklink:{}", a.capture_key()),
    )
}

/// The source for a `decklink://` address.
pub fn open(url: &str) -> Box<dyn VideoSource> {
    match Address::parse(url) {
        Some(a) => Box::new(DeckLinkSource::start(&a)),
        None => Box::new(Unavailable::new(
            "Choose the capture card again (its address is incomplete).",
        )),
    }
}

/// One card input's frames, as NV12 (or BGRA for RGB signals).
pub struct DeckLinkSource {
    mailbox: Arc<Mailbox>,
    sub: Subscription,
    name: String,
}

/// The card's frame as an engine frame (None: a size the conversion can't take).
pub fn to_frame(
    v: &lumora_decklink::VideoRef<'_>,
    pool: &FramePool,
    seq: u64,
) -> Option<VideoFrame> {
    let (w, h) = (v.width, v.height);
    match v.format {
        CardPixels::Bgra => {
            let row = w as usize * 4;
            Some(VideoFrame::build(
                pool,
                w,
                h,
                PixelFormat::Bgra8,
                seq,
                |out| {
                    for (y, dst) in out.chunks_exact_mut(row).enumerate() {
                        if let Some(src) = v.data.get(y * v.row_bytes..y * v.row_bytes + row) {
                            dst.copy_from_slice(src);
                        }
                    }
                },
            ))
        }
        CardPixels::Uyvy | CardPixels::V210 => {
            if w % 2 != 0 || h % 2 != 0 || w == 0 || h == 0 {
                return None;
            }
            let unpacked;
            let (src, row_bytes) = if v.format == CardPixels::V210 {
                unpacked = convert::v210_to_uyvy(v.data, v.row_bytes, w, h);
                (&unpacked[..], w as usize * 2)
            } else {
                (v.data, v.row_bytes)
            };
            Some(VideoFrame::build(
                pool,
                w,
                h,
                PixelFormat::Nv12,
                seq,
                |out| {
                    convert::uyvy_to_nv12(src, row_bytes, w, h, out);
                },
            ))
        }
    }
}

impl DeckLinkSource {
    pub fn start(address: &Address) -> Self {
        let mailbox = Mailbox::new();
        let mb = Arc::clone(&mailbox);
        let pool = FramePool::new(4);
        let sub = lumora_decklink::subscribe(
            address,
            Arc::new(move |e: Event<'_>| {
                if let Event::Video(v) = e {
                    if let Some(f) = to_frame(&v, &pool, v.seq) {
                        mb.put(f);
                    }
                }
            }),
        );
        DeckLinkSource {
            mailbox,
            sub,
            name: address.device.clone(),
        }
    }
}

impl VideoSource for DeckLinkSource {
    fn latest(&self) -> Option<VideoFrame> {
        self.mailbox.latest()
    }

    fn health(&self) -> SourceHealth {
        let mut h = self.mailbox.health();
        match self.sub.signal().state {
            SignalState::Failed(why) => h.state = SourceState::Failed(why),
            SignalState::NoInput if h.state != SourceState::Starting => {
                h.state = SourceState::NoSignal;
            }
            _ => {}
        }
        h
    }

    fn describe(&self) -> String {
        format!("Blackmagic capture: {}", self.name)
    }
}

impl Drop for DeckLinkSource {
    fn drop(&mut self) {
        self.mailbox.stop();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn frame(
        format: CardPixels,
        w: u32,
        h: u32,
        row_bytes: usize,
        data: &[u8],
    ) -> Option<VideoFrame> {
        let v = lumora_decklink::VideoRef {
            width: w,
            height: h,
            format,
            row_bytes,
            data,
            seq: 0,
        };
        to_frame(&v, &FramePool::new(1), 5)
    }

    #[test]
    fn card_frames_become_engine_frames() {
        // UYVY 2 × 2 → NV12.
        let f = frame(
            CardPixels::Uyvy,
            2,
            2,
            4,
            &[100, 50, 200, 60, 102, 70, 202, 80],
        )
        .unwrap();
        assert_eq!((f.format, f.seq), (PixelFormat::Nv12, 5));
        assert_eq!(f.data.as_slice(), &[50, 60, 70, 80, 101, 201]);
        // BGRA rows with padding → tight BGRA.
        let f = frame(
            CardPixels::Bgra,
            1,
            2,
            8,
            &[1, 2, 3, 4, 0, 0, 0, 0, 5, 6, 7, 8, 0, 0, 0, 0],
        )
        .unwrap();
        assert_eq!(f.format, PixelFormat::Bgra8);
        assert_eq!(f.data.as_slice(), &[1, 2, 3, 4, 5, 6, 7, 8]);
        // v210 → NV12 (six pixels of 10-bit black, two rows).
        let mut row = Vec::new();
        for t in [
            [512u32, 64, 512],
            [64, 512, 64],
            [512, 64, 512],
            [64, 512, 64],
        ] {
            row.extend((t[0] | (t[1] << 10) | (t[2] << 20)).to_le_bytes());
        }
        row.resize(128, 0);
        let f = frame(CardPixels::V210, 6, 2, 128, &[row.clone(), row].concat()).unwrap();
        assert_eq!(&f.data.as_slice()[..12], &[16; 12]);
        assert_eq!(&f.data.as_slice()[12..], &[128; 6]);
        // Odd sizes can't be NV12.
        assert!(frame(CardPixels::Uyvy, 3, 2, 8, &[0; 16]).is_none());
    }

    #[test]
    fn an_unknown_address_explains_itself() {
        let s = open("decklink://");
        assert!(matches!(s.health().state, SourceState::Failed(_)));
        assert!(is_decklink("DeckLink://Intensity Pro 4K"));
    }

    #[cfg(not(windows))]
    #[test]
    fn elsewhere_a_card_input_says_windows_is_needed() {
        let s = open("decklink://DeckLink Mini Recorder 4K?input=hdmi");
        let until = std::time::Instant::now() + std::time::Duration::from_secs(5);
        while !matches!(s.health().state, SourceState::Failed(_))
            && std::time::Instant::now() < until
        {
            std::thread::sleep(std::time::Duration::from_millis(10));
        }
        assert!(matches!(s.health().state, SourceState::Failed(w) if w.contains("Windows")));
    }
}
