//! Capture, shared: each card's input is opened once, however many parts of
//! Lumora take its pictures (the Standard engine's frame store, the unified
//! engine's source, the sound mixer). Each part subscribes with a sink; the
//! card's frames go to every sink as they arrive, borrowed from the card's
//! own buffer (a sink copies or converts what it needs, quickly, and leaves
//! slow work such as JPEG to its own thread). The last subscription dropped
//! closes the input.

use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex, OnceLock, PoisonError};

use serde::Serialize;

use crate::address::Address;
use crate::modes::{Mode, PixelFormat};

/// One video frame, borrowed from the card for the length of the call.
#[derive(Debug, Clone, Copy)]
pub struct VideoRef<'a> {
    pub width: u32,
    pub height: u32,
    pub format: PixelFormat,
    pub row_bytes: usize,
    pub data: &'a [u8],
    /// Counts up for every frame of this capture.
    pub seq: u64,
}

/// Embedded audio: 48 kHz, 32-bit samples, `channels` interleaved.
#[derive(Debug, Clone, Copy)]
pub struct AudioRef<'a> {
    pub channels: u32,
    pub samples: &'a [i32],
}

#[derive(Debug, Clone, Copy)]
pub enum Event<'a> {
    Video(VideoRef<'a>),
    Audio(AudioRef<'a>),
}

/// What a subscriber is handed, on the card's thread.
pub type Sink = Arc<dyn Fn(Event<'_>) + Send + Sync>;

/// How the capture is doing.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase", tag = "state", content = "detail")]
pub enum SignalState {
    /// Opening the card.
    Opening,
    /// Pictures are arriving.
    Live,
    /// The card is open but nothing is plugged into it (or the source is off).
    NoInput,
    /// It can't capture, in words for the operator (tried again every few seconds).
    Failed(String),
}

/// The capture's status, for the input's card and the status panel.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Signal {
    /// Written as `"state": "live"` (and `"detail"` when it failed).
    #[serde(flatten)]
    pub state: SignalState,
    /// "1080i59.94" (the detected signal).
    pub mode: Option<String>,
    pub width: u32,
    pub height: u32,
    pub fps: f64,
    /// The pixels as captured: "8-bit YUV", "10-bit YUV", "RGB".
    pub pixels: Option<String>,
    /// Embedded audio channels captured.
    pub channels: u32,
    /// The signal's timecode ("10:00:03:12"), when it carries one.
    pub timecode: Option<String>,
    pub frames: u64,
}

impl Default for Signal {
    fn default() -> Self {
        Signal {
            state: SignalState::Opening,
            mode: None,
            width: 0,
            height: 0,
            fps: 0.0,
            pixels: None,
            channels: 0,
            timecode: None,
            frames: 0,
        }
    }
}

/// A timecode as people write it: "10:00:03:12".
#[must_use]
pub fn timecode_text(hours: u8, minutes: u8, seconds: u8, frames: u8) -> String {
    format!("{hours:02}:{minutes:02}:{seconds:02}:{frames:02}")
}

fn lock<T>(m: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    m.lock().unwrap_or_else(PoisonError::into_inner)
}

/// One open input, shared by its subscribers.
pub struct Capture {
    pub address: Address,
    sinks: Mutex<Vec<(u64, Sink)>>,
    signal: Mutex<Signal>,
    stop: AtomicBool,
    seq: AtomicU64,
}

impl Capture {
    fn new(address: Address) -> Self {
        Capture {
            address,
            sinks: Mutex::new(Vec::new()),
            signal: Mutex::new(Signal::default()),
            stop: AtomicBool::new(false),
            seq: AtomicU64::new(0),
        }
    }

    /// The input is no longer wanted.
    #[must_use]
    pub fn stopped(&self) -> bool {
        self.stop.load(Ordering::SeqCst)
    }

    #[must_use]
    pub fn signal(&self) -> Signal {
        lock(&self.signal).clone()
    }

    /// Change the status.
    pub fn update(&self, f: impl FnOnce(&mut Signal)) {
        f(&mut lock(&self.signal));
    }

    pub fn fail(&self, why: impl Into<String>) {
        let why = why.into();
        self.update(|s| s.state = SignalState::Failed(why));
    }

    /// The detected mode, written into the status.
    pub fn set_mode(
        &self,
        mode: Option<Mode>,
        width: u32,
        height: u32,
        fps: f64,
        pixels: PixelFormat,
    ) {
        self.update(|s| {
            s.mode = mode.map(|m| m.name());
            s.width = width;
            s.height = height;
            s.fps = fps;
            s.pixels = Some(
                match pixels {
                    PixelFormat::Uyvy => "8-bit YUV",
                    PixelFormat::V210 => "10-bit YUV",
                    PixelFormat::Bgra => "RGB",
                }
                .to_owned(),
            );
        });
    }

    /// A frame from the card: to every sink.
    pub fn video(&self, mut v: VideoRef<'_>, timecode: Option<String>) {
        v.seq = self.seq.fetch_add(1, Ordering::Relaxed);
        self.update(|s| {
            s.state = SignalState::Live;
            s.frames += 1;
            s.timecode = timecode;
            if s.width == 0 {
                s.width = v.width;
                s.height = v.height;
            }
        });
        for sink in self.sinks_now() {
            sink(Event::Video(v));
        }
    }

    pub fn no_input(&self) {
        self.update(|s| {
            if s.state != SignalState::NoInput {
                s.state = SignalState::NoInput;
                s.timecode = None;
            }
        });
    }

    pub fn audio(&self, a: AudioRef<'_>) {
        for sink in self.sinks_now() {
            sink(Event::Audio(a));
        }
    }

    fn sinks_now(&self) -> Vec<Sink> {
        lock(&self.sinks)
            .iter()
            .map(|(_, s)| Arc::clone(s))
            .collect()
    }
}

#[derive(Default)]
struct Hub {
    captures: HashMap<String, Arc<Capture>>,
    next: u64,
}

fn hub() -> &'static Mutex<Hub> {
    static HUB: OnceLock<Mutex<Hub>> = OnceLock::new();
    HUB.get_or_init(Mutex::default)
}

/// While held, `sink` gets the input's frames and sound.
pub struct Subscription {
    key: String,
    id: u64,
    capture: Arc<Capture>,
}

impl Subscription {
    #[must_use]
    pub fn signal(&self) -> Signal {
        self.capture.signal()
    }
}

impl Drop for Subscription {
    fn drop(&mut self) {
        let mut h = lock(hub());
        let empty = {
            let mut sinks = lock(&self.capture.sinks);
            sinks.retain(|(id, _)| *id != self.id);
            sinks.is_empty()
        };
        if empty {
            self.capture.stop.store(true, Ordering::SeqCst);
            h.captures.remove(&self.key);
        }
    }
}

/// Take the frames of the input at `address` (opened now if no one has it open).
#[must_use]
pub fn subscribe(address: &Address, sink: Sink) -> Subscription {
    subscribe_with(address, sink, crate::backend::run)
}

/// The same, with the function that runs a capture (tests use a fake card).
pub fn subscribe_with(address: &Address, sink: Sink, run: fn(Arc<Capture>)) -> Subscription {
    let key = address.capture_key();
    let mut h = lock(hub());
    h.next += 1;
    let id = h.next;
    let (capture, new) = match h.captures.get(&key) {
        Some(c) => (Arc::clone(c), false),
        None => {
            let c = Arc::new(Capture::new(address.clone()));
            h.captures.insert(key.clone(), Arc::clone(&c));
            (c, true)
        }
    };
    lock(&capture.sinks).push((id, sink));
    drop(h);
    if new {
        let c = Arc::clone(&capture);
        let name = format!("lumora-decklink-{}", address.device);
        if std::thread::Builder::new()
            .name(name)
            .spawn(move || run(c))
            .is_err()
        {
            capture.fail("Lumora could not start the capture.");
        }
    }
    Subscription { key, id, capture }
}

/// The status of the input at `address`, if it is open.
#[must_use]
pub fn signal(address: &Address) -> Option<Signal> {
    lock(hub())
        .captures
        .get(&address.capture_key())
        .map(|c| c.signal())
}

/// Every open input's address and status.
#[must_use]
pub fn signals() -> Vec<(Address, Signal)> {
    lock(hub())
        .captures
        .values()
        .map(|c| (c.address.clone(), c.signal()))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::AtomicUsize;
    use std::time::{Duration, Instant};

    /// A fake card: two frames and an audio packet, then waits to be stopped.
    fn fake(c: Arc<Capture>) {
        let px = vec![128u8, 16, 128, 16];
        for _ in 0..2 {
            c.video(
                VideoRef {
                    width: 2,
                    height: 1,
                    format: PixelFormat::Uyvy,
                    row_bytes: 4,
                    data: &px,
                    seq: 0,
                },
                Some("10:00:00:01".into()),
            );
        }
        c.audio(AudioRef {
            channels: 2,
            samples: &[1 << 16, 2 << 16],
        });
        while !c.stopped() {
            std::thread::sleep(Duration::from_millis(5));
        }
        RUNS_ENDED.fetch_add(1, Ordering::SeqCst);
    }

    #[test]
    fn the_status_reads_flat_in_json() {
        let s = Signal {
            state: SignalState::Failed("Install Desktop Video".into()),
            ..Signal::default()
        };
        let v = serde_json::to_value(&s).unwrap();
        assert_eq!(v["state"], "failed");
        assert_eq!(v["detail"], "Install Desktop Video");
        let v = serde_json::to_value(Signal {
            state: SignalState::NoInput,
            ..Signal::default()
        })
        .unwrap();
        assert_eq!(v["state"], "noInput");
        assert_eq!(v["frames"], 0);
    }

    #[test]
    fn timecodes_are_written_as_people_read_them() {
        assert_eq!(timecode_text(10, 0, 3, 12), "10:00:03:12");
        assert_eq!(timecode_text(1, 2, 3, 4), "01:02:03:04");
    }

    static RUNS_ENDED: AtomicUsize = AtomicUsize::new(0);

    #[test]
    fn subscribers_share_one_capture_which_closes_with_the_last() {
        let a = Address::parse("decklink://Fake Card (1)?input=sdi").unwrap();
        let got = Arc::new(AtomicUsize::new(0));
        let g = Arc::clone(&got);
        let s1 = subscribe_with(
            &a,
            Arc::new(move |e| {
                if let Event::Video(v) = e {
                    assert_eq!((v.width, v.height, v.data.len()), (2, 1, 4));
                }
                g.fetch_add(1, Ordering::SeqCst);
            }),
            fake,
        );
        let until = Instant::now() + Duration::from_secs(5);
        while got.load(Ordering::SeqCst) < 3 && Instant::now() < until {
            std::thread::sleep(Duration::from_millis(5));
        }
        assert_eq!(
            got.load(Ordering::SeqCst),
            3,
            "two frames and a sound packet"
        );
        let st = s1.signal();
        assert_eq!(st.state, SignalState::Live);
        assert_eq!(st.frames, 2);
        assert_eq!(st.timecode.as_deref(), Some("10:00:00:01"));
        // Another audio pair of the same card shares the capture.
        let b = Address::parse("decklink://Fake Card (1)?input=sdi&audio=3-4").unwrap();
        let s2 = subscribe_with(&b, Arc::new(|_| {}), fake);
        assert_eq!(
            signals()
                .iter()
                .filter(|(x, _)| x.device == "Fake Card (1)")
                .count(),
            1
        );
        let before = RUNS_ENDED.load(Ordering::SeqCst);
        drop(s1);
        assert!(signal(&a).is_some(), "still open for the second");
        drop(s2);
        assert!(signal(&a).is_none());
        let until = Instant::now() + Duration::from_secs(5);
        while RUNS_ENDED.load(Ordering::SeqCst) == before && Instant::now() < until {
            std::thread::sleep(Duration::from_millis(5));
        }
        assert_eq!(
            RUNS_ENDED.load(Ordering::SeqCst),
            before + 1,
            "the card was closed"
        );
    }
}
