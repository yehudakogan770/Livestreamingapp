//! Blackmagic capture cards (DeckLink, UltraStudio, Intensity) in the app.
//!
//! - **Inputs** are stream inputs with a `decklink://` address
//!   (`streams.rs` hands them here). For the Standard engine the card's
//!   frames become JPEG pictures in the app's frame store (as NDI and
//!   stream inputs' do), at most 30 a second, made on a thread of their own
//!   so the card's thread never waits; the chosen pair of embedded audio
//!   channels goes to the mixer as the input's sound. The unified engine
//!   takes the same capture's frames directly (`live_engine::decklink`).
//! - **Program out**: the unified engine's Live Screen played on a card's
//!   SDI or HDMI output (to a projector, a recorder or a switcher), through
//!   an engine feed that FFmpeg turns into UYVY frames.
//! - Commands for the control window: the cards in this computer, how each
//!   capture is doing, program out on and off.

use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Condvar, Mutex};
use std::thread;
use std::time::{Duration, Instant};

use lumora_decklink::capture::{Event, SignalState};
use lumora_decklink::{convert, Address, PixelFormat};
use serde::Serialize;

use crate::browser::{Frames, Sounds};
use crate::streams::StreamStatus;

fn lock<T>(m: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    m.lock().unwrap_or_else(std::sync::PoisonError::into_inner)
}

/// Pictures for the Standard engine: at most this many a second.
const PICTURE_EVERY: Duration = Duration::from_millis(33);
/// Wider pictures are halved for the frame store (a 4K card input shows at 1080p).
const MAX_PICTURE_W: u32 = 1920;

/// A raw frame waiting to be made a JPEG.
struct Raw {
    width: u32,
    height: u32,
    format: PixelFormat,
    row_bytes: usize,
    data: Vec<u8>,
}

#[derive(Default)]
struct Slot {
    frame: Mutex<Option<Raw>>,
    ready: Condvar,
}

/// The card's frame as RGBA, halved when wider than the frame store needs.
fn to_rgba(r: &Raw) -> (u32, u32, Vec<u8>) {
    let (w, h) = (r.width, r.height);
    let mut rgba = vec![0u8; w as usize * h as usize * 4];
    match r.format {
        PixelFormat::Uyvy => convert::uyvy_to_rgba(&r.data, r.row_bytes, w, h, &mut rgba),
        PixelFormat::V210 => {
            let uyvy = convert::v210_to_uyvy(&r.data, r.row_bytes, w, h);
            convert::uyvy_to_rgba(&uyvy, w as usize * 2, w, h, &mut rgba);
        }
        PixelFormat::Bgra => convert::bgra_to_rgba(&r.data, r.row_bytes, w, h, &mut rgba),
    }
    if w <= MAX_PICTURE_W {
        return (w, h, rgba);
    }
    halve(w, h, &rgba)
}

/// Every other pixel of every other row (2 × 2 averaged).
fn halve(w: u32, h: u32, rgba: &[u8]) -> (u32, u32, Vec<u8>) {
    let (nw, nh) = (w / 2, h / 2);
    let mut out = vec![0u8; nw as usize * nh as usize * 4];
    let at =
        |x: u32, y: u32, k: usize| u16::from(rgba[(y as usize * w as usize + x as usize) * 4 + k]);
    for y in 0..nh {
        for x in 0..nw {
            let o = (y as usize * nw as usize + x as usize) * 4;
            for k in 0..4 {
                let s = at(2 * x, 2 * y, k)
                    + at(2 * x + 1, 2 * y, k)
                    + at(2 * x, 2 * y + 1, k)
                    + at(2 * x + 1, 2 * y + 1, k);
                out[o + k] = ((s + 2) / 4) as u8;
            }
        }
    }
    (nw, nh, out)
}

/// What the status says when a card's input isn't working.
fn problem(state: &SignalState, device: &str) -> Option<String> {
    match state {
        SignalState::Live => None,
        SignalState::Opening => Some(format!("Opening “{device}”…")),
        SignalState::NoInput => Some(format!(
            "No signal on “{device}”: check the cable and that the camera or computer is on (and sending a format the card takes)."
        )),
        SignalState::Failed(why) => Some(why.clone()),
    }
}

/// Read a card input until told to stop: its pictures into the frame
/// store, its chosen audio pair to the mixer.
pub fn run(
    id: &str,
    url: &str,
    frames: &Arc<Frames>,
    sounds: &Arc<Sounds>,
    status: &Mutex<HashMap<String, StreamStatus>>,
    stop: &AtomicBool,
) {
    let say = |live: bool, problem: Option<String>| {
        lock(status).insert(id.to_owned(), StreamStatus { live, problem });
    };
    let Some(address) = Address::parse(url) else {
        say(
            false,
            Some("Choose the capture card again (its address is incomplete).".to_owned()),
        );
        return;
    };
    let slot = Arc::new(Slot::default());
    let last = Mutex::new(Instant::now() - PICTURE_EVERY);
    let (slot2, snd, key, pair) = (
        Arc::clone(&slot),
        Arc::clone(sounds),
        id.to_owned(),
        address.audio_pair,
    );
    let sub = lumora_decklink::subscribe(
        &address,
        Arc::new(move |e: Event<'_>| match e {
            Event::Video(v) => {
                {
                    let mut l = lock(&last);
                    if l.elapsed() < PICTURE_EVERY {
                        return;
                    }
                    *l = Instant::now();
                }
                *lock(&slot2.frame) = Some(Raw {
                    width: v.width,
                    height: v.height,
                    format: v.format,
                    row_bytes: v.row_bytes,
                    data: v.data.to_vec(),
                });
                slot2.ready.notify_one();
            }
            Event::Audio(a) => {
                snd.put(
                    &key,
                    lumora_decklink::address::stereo_s16(a.samples, a.channels, pair),
                );
            }
        }),
    );
    let mut said: Option<(bool, Option<String>)> = None;
    while !stop.load(Ordering::Relaxed) {
        let raw = {
            let mut f = lock(&slot.frame);
            if f.is_none() {
                f = slot
                    .ready
                    .wait_timeout(f, Duration::from_millis(250))
                    .unwrap_or_else(std::sync::PoisonError::into_inner)
                    .0;
            }
            f.take()
        };
        if let Some(raw) = raw {
            let (w, h, rgba) = to_rgba(&raw);
            if let (Ok(w), Ok(h)) = (u16::try_from(w), u16::try_from(h)) {
                let mut jpeg = Vec::with_capacity(rgba.len() / 10);
                if jpeg_encoder::Encoder::new(&mut jpeg, 85)
                    .encode(&rgba, w, h, jpeg_encoder::ColorType::Rgba)
                    .is_ok()
                {
                    frames.put(id, jpeg, "image/jpeg");
                }
            }
        }
        let signal = sub.signal();
        let now = (
            signal.state == SignalState::Live,
            problem(&signal.state, &address.device),
        );
        if said.as_ref() != Some(&now) {
            say(now.0, now.1.clone());
            said = Some(now);
        }
    }
    drop(sub);
    frames.remove(id);
    sounds.remove(id);
    lock(status).remove(id);
}

/// The cards in this computer (or why none can be listed).
#[tauri::command]
pub async fn decklink_devices() -> Result<Vec<lumora_decklink::Device>, String> {
    tauri::async_runtime::spawn_blocking(lumora_decklink::devices)
        .await
        .map_err(|e| e.to_string())?
}

/// One open capture's status, for the input's card.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CardSignal {
    /// The address without the audio pair (`decklink://DeckLink Duo (1)?input=sdi`).
    pub url: String,
    pub device: String,
    #[serde(flatten)]
    pub signal: lumora_decklink::Signal,
}

/// How every open capture is doing: the detected format, timecode, audio channels.
#[tauri::command]
pub fn decklink_signals() -> Vec<CardSignal> {
    lumora_decklink::capture::signals()
        .into_iter()
        .map(|(a, signal)| CardSignal {
            url: Address {
                audio_pair: 0,
                ..a.clone()
            }
            .url(),
            device: a.device,
            signal,
        })
        .collect()
}

// ---------------------------------------------------------------------------
// Program out

/// The engine feed id of program out (well away from recordings and ISO files).
const OUT_FEED: u64 = 0xDEC0_0000_0000;

#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OutputStatus {
    /// The card playing program out (None: off).
    pub device: Option<String>,
    /// "1080p59.94".
    pub mode: Option<String>,
}

#[derive(Default)]
pub struct Output {
    status: Mutex<OutputStatus>,
}

/// UYVY frames out of FFmpeg's byte stream, one card frame at a time.
pub struct FrameSplitter {
    len: usize,
    buf: Vec<u8>,
}

impl FrameSplitter {
    #[must_use]
    pub fn new(len: usize) -> Self {
        FrameSplitter {
            len: len.max(1),
            buf: Vec::with_capacity(len),
        }
    }

    /// Add bytes; `each` gets every whole frame now complete.
    pub fn push(&mut self, bytes: &[u8], mut each: impl FnMut(&[u8])) {
        let mut rest = bytes;
        while !rest.is_empty() {
            let take = (self.len - self.buf.len()).min(rest.len());
            self.buf.extend_from_slice(&rest[..take]);
            rest = &rest[take..];
            if self.buf.len() == self.len {
                each(&self.buf);
                self.buf.clear();
            }
        }
    }
}

/// Play the unified engine's Live Screen on card `device`'s output.
#[tauri::command]
pub async fn decklink_output_start(
    device: String,
    width: u32,
    height: u32,
    fps: f64,
    live: tauri::State<'_, crate::live::Live>,
    out: tauri::State<'_, Output>,
) -> Result<OutputStatus, String> {
    let (runner, ffmpeg) = live.feed_parts().ok_or(
        "Program out to a Blackmagic card comes from the Unified engine: turn it on first (Settings → Engine).",
    )?;
    let _ = runner.stop_feed(OUT_FEED);
    let dev = device.clone();
    let playout = tauri::async_runtime::spawn_blocking(move || {
        lumora_decklink::Playout::open(&dev, width, height, fps)
    })
    .await
    .map_err(|e| e.to_string())??;
    let mode = playout.mode_name();
    let mut split = FrameSplitter::new(width as usize * height as usize * 2);
    let on_chunk = Box::new(move |chunk: Vec<u8>| {
        split.push(&chunk, |frame| {
            let _ = playout.show_uyvy(frame);
        });
    });
    let make: live_engine::feeds::MakeFeed = Box::new(move |shape| {
        live_engine::encoder::EncoderFeed::start(
            &ffmpeg,
            live_engine::encoder::FeedArgs {
                width: shape.width,
                height: shape.height,
                fps: shape.fps,
                pix_fmt: shape.pix_fmt,
                encode: ["-c:v", "rawvideo", "-pix_fmt", "uyvy422"]
                    .map(str::to_owned)
                    .to_vec(),
                container: ["-f", "rawvideo", "-"].map(str::to_owned).to_vec(),
                audio: None,
            },
            on_chunk,
            None,
        )
    });
    let spec = live_engine::feeds::FeedSpec {
        source: live_engine::feeds::FeedSource::Screen {
            screen: lumora_engine::ScreenId::Live,
            vertical: false,
        },
        width,
        height,
        fps: fps.round().clamp(1.0, 120.0) as u32,
    };
    tauri::async_runtime::spawn_blocking(move || runner.start_feed(OUT_FEED, spec, make))
        .await
        .map_err(|e| e.to_string())??;
    let status = OutputStatus {
        device: Some(device),
        mode: Some(mode),
    };
    lock(&out.status).clone_from(&status);
    Ok(status)
}

#[tauri::command]
pub async fn decklink_output_stop(
    live: tauri::State<'_, crate::live::Live>,
    out: tauri::State<'_, Output>,
) -> Result<(), String> {
    if let Some((runner, _)) = live.feed_parts() {
        tauri::async_runtime::spawn_blocking(move || runner.stop_feed(OUT_FEED))
            .await
            .map_err(|e| e.to_string())?;
    }
    *lock(&out.status) = OutputStatus::default();
    Ok(())
}

#[tauri::command]
pub fn decklink_output_status(out: tauri::State<'_, Output>) -> OutputStatus {
    lock(&out.status).clone()
}

/// Is `url` a capture card input (for `streams.rs`)?
pub fn is_card(url: &str) -> bool {
    lumora_decklink::is_decklink(url)
}

/// Start reading card input `id` on a thread of its own.
pub fn spawn(
    id: String,
    url: String,
    frames: Arc<Frames>,
    sounds: Arc<Sounds>,
    status: Arc<Mutex<HashMap<String, StreamStatus>>>,
    stop: Arc<AtomicBool>,
) {
    let _ = thread::Builder::new()
        .name("lumora-card-input".into())
        .spawn(move || run(&id, &url, &frames, &sounds, &status, &stop));
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ffmpeg_bytes_become_whole_card_frames() {
        let mut s = FrameSplitter::new(4);
        let mut got = Vec::new();
        for chunk in [&[1u8, 2, 3][..], &[4, 5], &[6, 7, 8, 9, 10, 11, 12, 13]] {
            s.push(chunk, |f| got.push(f.to_vec()));
        }
        assert_eq!(
            got,
            vec![vec![1, 2, 3, 4], vec![5, 6, 7, 8], vec![9, 10, 11, 12]]
        );
    }

    #[test]
    fn wide_pictures_are_halved_for_the_frame_store() {
        let raw = Raw {
            width: 3840,
            height: 4,
            format: PixelFormat::Uyvy,
            row_bytes: 3840 * 2,
            data: [128u8, 235].repeat(3840 * 4),
        };
        let (w, h, px) = to_rgba(&raw);
        assert_eq!((w, h, px.len()), (1920, 2, 1920 * 2 * 4));
        assert_eq!(&px[..4], &[255, 255, 255, 255]);
        let raw = Raw {
            width: 2,
            height: 2,
            format: PixelFormat::Bgra,
            row_bytes: 8,
            data: vec![
                0, 0, 255, 255, 0, 0, 255, 255, 0, 0, 255, 255, 0, 0, 255, 255,
            ],
        };
        assert_eq!(&to_rgba(&raw).2[..4], &[255, 0, 0, 255]);
    }

    #[test]
    fn card_problems_are_said_plainly() {
        assert!(problem(&SignalState::NoInput, "DeckLink Mini Recorder")
            .unwrap()
            .contains("No signal"));
        assert_eq!(problem(&SignalState::Live, "x"), None);
        assert_eq!(
            problem(&SignalState::Failed("Install it".into()), "x").as_deref(),
            Some("Install it")
        );
    }

    #[cfg(not(windows))]
    #[test]
    fn a_card_input_reports_why_it_cannot_capture_here() {
        let frames = Arc::new(Frames::default());
        let sounds = Arc::new(Sounds::default());
        let status = Arc::new(Mutex::new(HashMap::new()));
        let stop = Arc::new(AtomicBool::new(false));
        spawn(
            "cam".into(),
            "decklink://DeckLink Duo (1)?input=sdi".into(),
            Arc::clone(&frames),
            Arc::clone(&sounds),
            Arc::clone(&status),
            Arc::clone(&stop),
        );
        let until = Instant::now() + Duration::from_secs(5);
        loop {
            let st = lock(&status).get("cam").cloned();
            if let Some(StreamStatus {
                problem: Some(p), ..
            }) = st
            {
                if p.contains("Windows") {
                    break;
                }
            }
            assert!(Instant::now() < until, "no problem reported");
            thread::sleep(Duration::from_millis(20));
        }
        stop.store(true, Ordering::Relaxed);
    }
}
