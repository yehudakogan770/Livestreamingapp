//! The encoder feeds: drawn frames of a screen (or a camera's own frames,
//! for its ISO file), piped raw into FFmpeg with the WebView's sound mix as
//! a second input; FFmpeg encodes them (NVENC, Quick Sync, AMF or x264, with
//! the arguments the app's `encode.rs` chooses) and hands back the encoded
//! stream in chunks. The app passes those chunks to the same recording and
//! streaming code the WebView's MediaRecorder feeds in the Standard engine
//! (`capture.rs`), so files, destinations, reconnects, backups and failures
//! all work as they do there.
//!
//! **Timing.** Both inputs are timed by the wall clock from the feed's first
//! frame (`start`):
//!
//! - the picture is a constant frame rate counted from `start` ([`CfrClock`]):
//!   a frame the engine drew late is sent twice, frames between two of the
//!   feed's slots are skipped, and a frame FFmpeg could not take yet is sent
//!   again later ("owed") — so frame *n* is always the picture at
//!   `start + n / fps`, whatever happened;
//! - the sound arrives in chunks stamped with the wall-clock time of their
//!   first sample, and each is written at its own place in the sample stream
//!   ([`AudioClock`]): a gap becomes silence, a late chunk loses what was
//!   already written over; when no sound comes at all, silence keeps FFmpeg
//!   going.
//!
//! So sound and picture line up to the wall clock both were made on, however
//! late either arrives (up to [`AUDIO_LAG_MS`]).

use std::collections::VecDeque;
use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::path::Path;
use std::process::{Child, Stdio};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::mpsc::{sync_channel, Receiver, RecvTimeoutError, SyncSender, TrySendError};
use std::sync::{Arc, Mutex, PoisonError};
use std::thread::{self, JoinHandle};
use std::time::{Duration, Instant};

use serde::Serialize;

use crate::frame::VideoFrame;
use crate::source::quiet;

/// How many frames may wait for FFmpeg before new ones are owed instead.
const QUEUE: usize = 3;
/// A frame drawn this late is sent at most this many times over (the rest is lost time).
const MAX_REPEAT: u64 = 30;
/// Frames owed for longer than this (a camera gone for a while) are given up on.
const MAX_OWED: u64 = 600;
/// Sound is written this far behind the wall clock: chunks that take longer
/// than this to arrive lose their start; silence fills in when none arrive.
pub const AUDIO_LAG_MS: u64 = 300;
/// A chunk this close to where the sound stream already is goes on as it is (no click).
const AUDIO_SLACK_MS: f64 = 20.0;
/// "The picture ends here" (instead of a number of copies).
const END: u64 = u64::MAX;

/// How the feed is doing.
#[derive(Debug, Clone, Default, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct FeedStats {
    /// Frames sent to FFmpeg (copies included).
    pub frames_in: u64,
    /// Frames FFmpeg could not take at once (sent again later, so the
    /// picture keeps its time).
    pub frames_dropped: u64,
    pub bytes_out: u64,
    /// Sound: samples written (silence included) and silence filled in.
    pub audio_samples: u64,
    pub audio_silence: u64,
    /// FFmpeg's last words when it stopped by itself.
    pub error: Option<String>,
}

/// Pixels for a feed: drawn by the engine, or a camera's frame as it came.
pub enum Pixels {
    Owned(Vec<u8>),
    /// One read-back shared by several feeds of the same picture.
    Shared(Arc<Vec<u8>>),
    Frame(VideoFrame),
}

impl Pixels {
    pub fn as_slice(&self) -> &[u8] {
        match self {
            Pixels::Owned(v) => v,
            Pixels::Shared(v) => v,
            Pixels::Frame(f) => f.data.as_slice(),
        }
    }
}

/// The picture's constant frame rate, counted on the wall clock from the first frame.
#[derive(Debug, Clone)]
pub struct CfrClock {
    fps: u32,
    start: Option<u64>,
    due: u64,
}

impl CfrClock {
    pub fn new(fps: u32) -> Self {
        CfrClock {
            fps: fps.max(1),
            start: None,
            due: 0,
        }
    }

    /// When the first frame was (ms on the wall clock).
    pub fn start(&self) -> Option<u64> {
        self.start
    }

    /// Start counting with `sent` frames already sent, the first of them at `start_ms`.
    pub fn begin(&mut self, start_ms: u64, sent: u64) {
        self.start = Some(start_ms);
        self.due = sent;
    }

    /// How many frames of the feed fall due at `now_ms` (0: none since the last call).
    pub fn copies(&mut self, now_ms: u64) -> u64 {
        let start = *self.start.get_or_insert(now_ms);
        let elapsed = now_ms.saturating_sub(start);
        // Frame n belongs at start + n / fps (rounded to the nearest frame).
        let due = (elapsed * u64::from(self.fps) + 500) / 1000 + 1;
        let n = due.saturating_sub(self.due);
        self.due = self.due.max(due);
        n.min(MAX_REPEAT)
    }
}

/// Where each chunk of sound goes in the stream of samples.
#[derive(Debug, Clone)]
pub struct AudioClock {
    pub rate: u32,
    /// Samples (per channel) written so far.
    pub written: u64,
    pub silence: u64,
}

impl AudioClock {
    pub fn new(rate: u32) -> Self {
        AudioClock {
            rate: rate.max(1),
            written: 0,
            silence: 0,
        }
    }

    fn samples(&self, ms: f64) -> f64 {
        ms * f64::from(self.rate) / 1000.0
    }

    /// A chunk of `n` samples whose first was made at `at_ms` (wall clock),
    /// the stream having started at `start_ms`: how much silence goes
    /// before it, and how many of its first samples are left out (already
    /// written over, or from before the start).
    pub fn place(&mut self, start_ms: u64, at_ms: f64, n: u64) -> (u64, u64) {
        let pos = self.samples(at_ms - start_ms as f64);
        let slack = self.samples(AUDIO_SLACK_MS);
        let written = self.written as f64;
        let (silence, skip) = if pos > written + slack {
            ((pos - written).round() as u64, 0)
        } else if pos + slack < written {
            (0, ((written - pos).round() as u64).min(n))
        } else {
            (0, 0)
        };
        self.written += silence + (n - skip);
        self.silence += silence;
        (silence, skip)
    }

    /// Silence needed so the stream reaches `lag_ms` behind `now_ms`.
    pub fn keep_up(&mut self, start_ms: u64, now_ms: u64, lag_ms: u64) -> u64 {
        let target = now_ms.saturating_sub(start_ms).saturating_sub(lag_ms);
        let target = (target as f64 * f64::from(self.rate) / 1000.0) as u64;
        let n = target.saturating_sub(self.written);
        self.written += n;
        self.silence += n;
        n
    }
}

/// One piece of sound: 16-bit stereo samples (interleaved, little endian),
/// the first made at `at_ms` on the wall clock.
#[derive(Debug, Clone)]
pub struct PcmChunk {
    pub at_ms: f64,
    pub rate: u32,
    pub pcm: Arc<Vec<u8>>,
}

/// The sound input of a feed.
pub struct AudioIn {
    pub rate: u32,
    /// FFmpeg's audio encoder arguments (e.g. `-c:a libopus -b:a 160k`).
    pub encode: Vec<String>,
    pub chunks: Receiver<PcmChunk>,
}

/// The picture arrives already encoded (zero-copy: the graphics card's
/// encoder took the engine's texture, see [`crate::zerocopy`]) as an H.264
/// or HEVC elementary stream when `pix_fmt` is `h264` or `hevc`: FFmpeg's
/// demuxer for it.
pub fn encoded_input(pix_fmt: &str) -> Option<&'static str> {
    match pix_fmt {
        "h264" => Some("h264"),
        "hevc" => Some("hevc"),
        _ => None,
    }
}

/// What a feed encodes and how.
pub struct FeedArgs {
    pub width: u32,
    pub height: u32,
    pub fps: u32,
    /// FFmpeg's name for the pixels: `rgba` (drawn screens), `bgra` or `bgr0` (cameras).
    pub pix_fmt: &'static str,
    /// Video encoder arguments (codec, rate, size).
    pub encode: Vec<String>,
    /// Output, e.g. `-f matroska -`.
    pub container: Vec<String>,
    pub audio: Option<AudioIn>,
}

/// FFmpeg's arguments: raw frames on stdin at a constant rate, the sound
/// (when there is any) from `tcp://127.0.0.1:<audio_port>`, then the encodes and the container.
pub fn args(f: &FeedArgs, audio_port: Option<u16>) -> Vec<String> {
    let mut a: Vec<String> = [
        "-hide_banner",
        "-loglevel",
        "error",
        "-nostdin",
        "-thread_queue_size",
        "64",
        "-probesize",
        "32",
        "-analyzeduration",
        "0",
    ]
    .iter()
    .map(|s| (*s).to_owned())
    .collect();
    let encoded = encoded_input(f.pix_fmt);
    if let Some(demuxer) = encoded {
        // Already encoded on the graphics card (zero-copy): timestamps are
        // the frame count at the feed's rate (the encoder was given one
        // frame for every slot of the constant frame rate).
        a.extend([
            "-fflags".to_owned(),
            "+genpts".to_owned(),
            "-f".to_owned(),
            demuxer.to_owned(),
            "-framerate".to_owned(),
            f.fps.to_string(),
            "-i".to_owned(),
            "-".to_owned(),
        ]);
    } else {
        a.extend(["-f", "rawvideo", "-pix_fmt"].map(str::to_owned));
        a.push(f.pix_fmt.to_owned());
    }
    if encoded.is_some() {
        // The stream says its size and colors itself.
    } else if f.pix_fmt == "nv12" {
        // The engine's NV12 is BT.709, limited range: said so, so it is encoded and played so.
        a.extend(
            [
                "-color_range",
                "tv",
                "-colorspace",
                "bt709",
                "-color_primaries",
                "bt709",
                "-color_trc",
                "bt709",
            ]
            .map(str::to_owned),
        );
    }
    if encoded.is_none() {
        a.push("-s".to_owned());
        a.push(format!("{}x{}", f.width, f.height));
        a.extend([
            "-framerate".to_owned(),
            f.fps.to_string(),
            "-i".to_owned(),
            "-".to_owned(),
        ]);
    }
    if let (Some(port), Some(audio)) = (audio_port, &f.audio) {
        a.extend(
            [
                "-thread_queue_size",
                "1024",
                "-probesize",
                "32",
                "-analyzeduration",
                "0",
                "-f",
                "s16le",
                "-ar",
                &audio.rate.to_string(),
                "-ac",
                "2",
                "-i",
                &format!("tcp://127.0.0.1:{port}"),
                "-map",
                "0:v:0",
                "-map",
                "1:a:0",
            ]
            .iter()
            .map(|s| (*s).to_owned()),
        );
    } else {
        a.push("-an".to_owned());
    }
    if encoded.is_some() {
        // Encoded with the app's settings already (`zerocopy::Settings`): copied as it is.
        a.extend(["-c:v", "copy"].map(str::to_owned));
    } else {
        a.extend([
            "-fps_mode".to_owned(),
            "cfr".to_owned(),
            "-r".to_owned(),
            f.fps.to_string(),
        ]);
        a.extend(f.encode.iter().cloned());
    }
    if let (Some(_), Some(audio)) = (audio_port, &f.audio) {
        if audio.rate != 48_000 {
            a.extend(["-af".to_owned(), "aresample=48000".to_owned()]);
        }
        a.extend(audio.encode.iter().cloned());
    }
    a.extend(f.container.iter().cloned());
    a
}

/// Bytes of one frame of `w` × `h` in FFmpeg's pixel format `pix_fmt`.
pub fn frame_len(pix_fmt: &str, w: u32, h: u32) -> usize {
    let px = w as usize * h as usize;
    if encoded_input(pix_fmt).is_some() {
        // Pieces of an encoded stream have no fixed size.
        0
    } else if pix_fmt == "nv12" {
        px * 3 / 2
    } else {
        px * 4
    }
}

/// Where an encoder on the graphics card writes a feed's encoded picture
/// (zero-copy, [`crate::zerocopy`]); FFmpeg copies it into the container
/// with the sound.
#[derive(Clone)]
pub struct Bitstream {
    tx: SyncSender<(Arc<Pixels>, u64)>,
    frames: Arc<AtomicU64>,
    error: Arc<Mutex<Option<String>>>,
}

impl Bitstream {
    /// A piece of the encoded stream (waits while FFmpeg is busy: none may
    /// be lost). False once the feed has ended.
    pub fn write(&self, bytes: Vec<u8>) -> bool {
        bytes.is_empty() || self.tx.send((Arc::new(Pixels::Owned(bytes)), 1)).is_ok()
    }

    /// `n` more frames were encoded.
    pub fn count(&self, n: u64) {
        self.frames.fetch_add(n, Ordering::Relaxed);
    }

    /// The encoder stopped working: the picture ends here and `why` is the
    /// reason the feed reports (the app starts the session again, on the
    /// read-back path).
    pub fn fail(&self, why: &str) {
        lock(&self.error).get_or_insert_with(|| why.to_owned());
        let _ = self.tx.send((Arc::new(Pixels::Owned(Vec::new())), END));
    }
}

/// Called once when FFmpeg ends: whether it was asked to (the feed
/// finished), and its last words.
pub type OnEnd = Box<dyn FnOnce(bool, Option<String>) + Send>;

pub struct EncoderFeed {
    tx: Option<SyncSender<(Arc<Pixels>, u64)>>,
    child: Arc<Mutex<Child>>,
    clock: CfrClock,
    /// Frames owed (FFmpeg was busy): sent with the next frame.
    owed: u64,
    /// The newest picture (the owed frames are sent of it when the feed ends).
    last: Option<Arc<Pixels>>,
    /// The feed's first frame (wall-clock ms; 0: not yet), for the sound.
    start: Arc<AtomicU64>,
    /// FFmpeg has taken the first frame (it has started): the clock runs from then.
    ready: Arc<AtomicBool>,
    /// The first frame, to get FFmpeg going, has been sent.
    primed: bool,
    finishing: Arc<AtomicBool>,
    frames: Arc<AtomicU64>,
    dropped: Arc<AtomicU64>,
    bytes: Arc<AtomicU64>,
    audio_samples: Arc<AtomicU64>,
    audio_silence: Arc<AtomicU64>,
    error: Arc<Mutex<Option<String>>>,
    threads: Vec<JoinHandle<()>>,
    frame_len: usize,
}

fn lock<T>(m: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    m.lock().unwrap_or_else(PoisonError::into_inner)
}

impl EncoderFeed {
    /// Start FFmpeg. `on_chunk` gets the encoded stream as it comes out;
    /// `on_end` hears when FFmpeg stops.
    ///
    /// # Errors
    /// FFmpeg (or the sound's local connection) could not start.
    pub fn start(
        ffmpeg: &Path,
        mut f: FeedArgs,
        mut on_chunk: Box<dyn FnMut(Vec<u8>) + Send>,
        on_end: Option<OnEnd>,
    ) -> Result<Self, String> {
        // The sound comes in over a local connection FFmpeg makes to us.
        let listener = match &f.audio {
            Some(_) => Some(
                TcpListener::bind(("127.0.0.1", 0))
                    .map_err(|e| format!("The sound's local connection could not open: {e}"))?,
            ),
            None => None,
        };
        let port = listener
            .as_ref()
            .and_then(|l| l.local_addr().ok())
            .map(|a| a.port());
        let mut child = quiet(ffmpeg)
            .args(args(&f, port))
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|e| format!("FFmpeg could not start: {e}"))?;
        let mut stdin = child.stdin.take().ok_or("FFmpeg has no input.")?;
        let mut stdout = child.stdout.take().ok_or("FFmpeg has no output.")?;
        let mut stderr = child.stderr.take().ok_or("FFmpeg has no messages.")?;
        let (tx, rx) = sync_channel::<(Arc<Pixels>, u64)>(QUEUE);
        let bytes = Arc::new(AtomicU64::new(0));
        let frames = Arc::new(AtomicU64::new(0));
        let error = Arc::new(Mutex::new(None));
        let start = Arc::new(AtomicU64::new(0));
        let finishing = Arc::new(AtomicBool::new(false));
        let audio_samples = Arc::new(AtomicU64::new(0));
        let audio_silence = Arc::new(AtomicU64::new(0));
        let mut threads = Vec::new();
        let fr = Arc::clone(&frames);
        let encoded = encoded_input(f.pix_fmt).is_some();
        // An encoded picture starts at once: FFmpeg only copies it (the
        // graphics card's encoder has no start-up to wait for here).
        let ready = Arc::new(AtomicBool::new(encoded));
        let rd = Arc::clone(&ready);
        threads.push(
            thread::Builder::new()
                .name("lumora-live-encode-in".into())
                .spawn(move || {
                    'frames: for (px, copies) in rx {
                        if copies == END {
                            break;
                        }
                        if encoded {
                            // A piece of the encoded stream (its frames are counted by the encoder).
                            if stdin.write_all(px.as_slice()).is_err() {
                                break;
                            }
                            continue;
                        }
                        for _ in 0..copies {
                            if stdin.write_all(px.as_slice()).is_err() {
                                break 'frames;
                            }
                            fr.fetch_add(1, Ordering::Relaxed);
                            rd.store(true, Ordering::SeqCst);
                        }
                    }
                    // Dropping stdin tells FFmpeg the picture ended.
                })
                .map_err(|e| e.to_string())?,
        );
        if let (Some(listener), Some(audio)) = (listener, f.audio.take()) {
            let (start, finishing) = (Arc::clone(&start), Arc::clone(&finishing));
            let (samples, silence) = (Arc::clone(&audio_samples), Arc::clone(&audio_silence));
            threads.push(
                thread::Builder::new()
                    .name("lumora-live-encode-sound".into())
                    .spawn(move || {
                        if let Some(conn) = accept(&listener, &finishing) {
                            write_sound(conn, &audio, &start, &finishing, &samples, &silence);
                        }
                    })
                    .map_err(|e| e.to_string())?,
            );
        }
        let b = Arc::clone(&bytes);
        threads.push(
            thread::Builder::new()
                .name("lumora-live-encode-out".into())
                .spawn(move || {
                    let mut buf = vec![0u8; 256 * 1024];
                    while let Ok(n) = stdout.read(&mut buf) {
                        if n == 0 {
                            break;
                        }
                        b.fetch_add(n as u64, Ordering::Relaxed);
                        on_chunk(buf[..n].to_vec());
                    }
                })
                .map_err(|e| e.to_string())?,
        );
        let e = Arc::clone(&error);
        let fin = Arc::clone(&finishing);
        threads.push(
            thread::Builder::new()
                .name("lumora-live-encode-log".into())
                .spawn(move || {
                    let mut text = String::new();
                    let _ = stderr.read_to_string(&mut text);
                    let last = text
                        .lines()
                        .rev()
                        .find(|l| !l.trim().is_empty())
                        .map(str::to_owned);
                    // The graphics card's encoder said why it ended the picture (zero-copy):
                    // that is the reason, FFmpeg only finished the file.
                    let last = {
                        let mut err = lock(&e);
                        if err.is_none() {
                            err.clone_from(&last);
                        }
                        err.clone()
                    };
                    // Ended without being asked: it can't take more (the sound
                    // thread hears it too).
                    let asked = fin.swap(true, Ordering::SeqCst);
                    if let Some(cb) = on_end {
                        cb(asked, last);
                    }
                })
                .map_err(|e| e.to_string())?,
        );
        Ok(EncoderFeed {
            tx: Some(tx),
            child: Arc::new(Mutex::new(child)),
            clock: CfrClock::new(f.fps),
            owed: 0,
            last: None,
            start,
            ready,
            primed: encoded,
            finishing,
            frames,
            dropped: Arc::default(),
            bytes,
            audio_samples,
            audio_silence,
            error,
            threads,
            frame_len: frame_len(f.pix_fmt, f.width, f.height),
        })
    }

    /// How many frames fall due at `now_ms` (the feed's own frame rate);
    /// the first call starts the feed's clock (and its sound).
    pub fn due(&mut self, now_ms: u64) -> u64 {
        // Until FFmpeg has started (it takes a moment, more with a hardware
        // encoder), only one frame goes to get it going: frames counted
        // while it can't take them would land later in the picture than they belong.
        if !self.ready.load(Ordering::SeqCst) {
            return u64::from(!self.primed);
        }
        if self.clock.start().is_none() {
            // That first frame is the picture's first: its slot is one frame before now.
            let frame = 1000 / u64::from(self.clock.fps);
            self.clock.begin(now_ms.saturating_sub(frame), 1);
        }
        let n = self.clock.copies(now_ms);
        if let Some(s) = self.clock.start() {
            let _ = self
                .start
                .compare_exchange(0, s.max(1), Ordering::SeqCst, Ordering::SeqCst);
        }
        n
    }

    /// Frames that fell due with no picture to send yet: sent with the next one.
    pub fn owe(&mut self, n: u64) {
        // Before FFmpeg has started nothing is counted yet.
        if self.primed {
            self.owed = (self.owed + n).min(MAX_OWED);
        }
    }

    /// A picture to send `copies` times (plus any owed). Returns false when
    /// FFmpeg couldn't take it now (the frames are owed) or has stopped.
    pub fn push(&mut self, px: Pixels, copies: u64) -> bool {
        if px.as_slice().len() != self.frame_len {
            return false;
        }
        let n = copies + self.owed;
        if n == 0 {
            return true;
        }
        let Some(tx) = &self.tx else { return false };
        let px = Arc::new(px);
        self.last = Some(Arc::clone(&px));
        match tx.try_send((px, n)) {
            Ok(()) => {
                self.owed = 0;
                self.primed = true;
                true
            }
            Err(_) if !self.primed => false,
            Err(TrySendError::Full(_) | TrySendError::Disconnected(_)) => {
                self.dropped.fetch_add(copies, Ordering::Relaxed);
                self.owed = n.min(MAX_OWED);
                false
            }
        }
    }

    /// The size of the frames it takes.
    pub fn frame_len(&self) -> usize {
        self.frame_len
    }

    /// Frames due now for an encoder that takes the picture on the graphics
    /// card (zero-copy): `copies` plus those owed. They are owed until
    /// [`EncoderFeed::handed_over`] or [`EncoderFeed::missed`] says what happened.
    pub fn with_owed(&self, copies: u64) -> u64 {
        copies + self.owed
    }

    /// The graphics card's encoder took the picture for all frames due.
    pub fn handed_over(&mut self) {
        self.owed = 0;
    }

    /// The graphics card's encoder could not take the picture now: `copies`
    /// were late, `total` (with those owed before) go with the next picture.
    pub fn missed(&mut self, copies: u64, total: u64) {
        self.dropped.fetch_add(copies, Ordering::Relaxed);
        self.owed = total.min(MAX_OWED);
    }

    /// Where an encoder on the graphics card writes this feed's encoded
    /// picture (a feed started with an `h264` or `hevc` picture).
    pub fn bitstream(&self) -> Option<Bitstream> {
        Some(Bitstream {
            tx: self.tx.clone()?,
            frames: Arc::clone(&self.frames),
            error: Arc::clone(&self.error),
        })
    }

    pub fn stats(&self) -> FeedStats {
        FeedStats {
            frames_in: self.frames.load(Ordering::Relaxed),
            frames_dropped: self.dropped.load(Ordering::Relaxed),
            bytes_out: self.bytes.load(Ordering::Relaxed),
            audio_samples: self.audio_samples.load(Ordering::Relaxed),
            audio_silence: self.audio_silence.load(Ordering::Relaxed),
            error: lock(&self.error).clone(),
        }
    }

    /// Whether FFmpeg is still running.
    pub fn alive(&self) -> bool {
        !self.finishing.load(Ordering::SeqCst)
            && lock(&self.child).try_wait().is_ok_and(|s| s.is_none())
    }

    /// End the picture and the sound and wait for FFmpeg to write the last of them.
    pub fn finish(mut self) -> FeedStats {
        // Frames still owed: the picture keeps its full length.
        if let (Some(tx), Some(last)) = (&self.tx, self.last.take()) {
            if self.owed > 0 {
                let _ = tx.send((last, self.owed));
            }
        }
        self.finishing.store(true, Ordering::SeqCst);
        self.tx = None;
        for t in self.threads.drain(..) {
            let _ = t.join();
        }
        let _ = lock(&self.child).wait();
        self.stats()
    }
}

impl Drop for EncoderFeed {
    fn drop(&mut self) {
        if self.tx.take().is_some() {
            self.finishing.store(true, Ordering::SeqCst);
            let _ = lock(&self.child).kill();
        }
    }
}

/// Wait for FFmpeg to connect for the sound (it does once it has the first frames).
fn accept(listener: &TcpListener, stop: &AtomicBool) -> Option<TcpStream> {
    listener.set_nonblocking(true).ok()?;
    let deadline = Instant::now() + Duration::from_secs(30);
    while Instant::now() < deadline && !stop.load(Ordering::SeqCst) {
        match listener.accept() {
            Ok((s, _)) => {
                s.set_nonblocking(false).ok()?;
                let _ = s.set_nodelay(true);
                return Some(s);
            }
            Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                thread::sleep(Duration::from_millis(10));
            }
            Err(_) => return None,
        }
    }
    None
}

fn now_ms() -> u64 {
    crate::engine::now_ms()
}

/// Write the sound into FFmpeg, each chunk at its time (see [`AudioClock`]).
fn write_sound(
    mut out: TcpStream,
    audio: &AudioIn,
    start: &AtomicU64,
    stop: &AtomicBool,
    samples: &AtomicU64,
    silence: &AtomicU64,
) {
    let mut clock = AudioClock::new(audio.rate);
    // Sound that arrived before the first frame, kept until the clock starts.
    let mut early: VecDeque<PcmChunk> = VecDeque::new();
    let zeros = vec![0u8; 4800 * 4];
    let write_silence = |out: &mut TcpStream, mut n: u64| -> bool {
        while n > 0 {
            let k = n.min(4800);
            if out.write_all(&zeros[..(k * 4) as usize]).is_err() {
                return false;
            }
            n -= k;
        }
        true
    };
    loop {
        if stop.load(Ordering::SeqCst) {
            break;
        }
        let got = audio.chunks.recv_timeout(Duration::from_millis(20));
        let begun = start.load(Ordering::SeqCst);
        match got {
            Ok(c) if c.rate == audio.rate => early.push_back(c),
            Ok(_) => {} // Another rate: not this stream's (the sound engine was remade).
            Err(RecvTimeoutError::Timeout) => {}
            Err(RecvTimeoutError::Disconnected) => break,
        }
        if begun == 0 {
            // Keep at most a second of it.
            while early.len() > 50 {
                early.pop_front();
            }
            continue;
        }
        while let Some(c) = early.pop_front() {
            let n = (c.pcm.len() / 4) as u64;
            let (gap, skip) = clock.place(begun, c.at_ms, n);
            if !write_silence(&mut out, gap) {
                return;
            }
            if skip < n && out.write_all(&c.pcm[(skip * 4) as usize..]).is_err() {
                return;
            }
        }
        let gap = clock.keep_up(begun, now_ms(), AUDIO_LAG_MS);
        if !write_silence(&mut out, gap) {
            return;
        }
        samples.store(clock.written, Ordering::Relaxed);
        silence.store(clock.silence, Ordering::Relaxed);
    }
    // Closing the connection tells FFmpeg the sound ended.
}

#[cfg(test)]
mod tests {
    use super::*;

    fn feed_args(audio: Option<AudioIn>) -> FeedArgs {
        FeedArgs {
            width: 1280,
            height: 720,
            fps: 30,
            pix_fmt: "rgba",
            encode: vec!["-c:v".into(), "libx264".into()],
            container: vec!["-f".into(), "matroska".into(), "-".into()],
            audio,
        }
    }

    #[test]
    fn raw_frames_in_encoded_stream_out() {
        let s = args(&feed_args(None), None).join(" ");
        assert!(
            s.contains("-f rawvideo -pix_fmt rgba -s 1280x720 -framerate 30 -i -"),
            "{s}"
        );
        assert!(s.contains(" -an "), "{s}");
        assert!(s.ends_with("-c:v libx264 -f matroska -"), "{s}");
    }

    #[test]
    fn an_encoded_picture_is_copied_as_it_is() {
        let mut f = feed_args(None);
        f.pix_fmt = "h264";
        let s = args(&f, None).join(" ");
        assert!(
            s.contains("-fflags +genpts -f h264 -framerate 30 -i -"),
            "{s}"
        );
        assert!(!s.contains("rawvideo"), "{s}");
        assert!(!s.contains("libx264"), "the app's encode is not used: {s}");
        assert!(s.ends_with("-an -c:v copy -f matroska -"), "{s}");
        assert_eq!(frame_len("h264", 1920, 1080), 0);
        assert_eq!(encoded_input("hevc"), Some("hevc"));
        assert_eq!(encoded_input("nv12"), None);
    }

    /// The zero-copy path's FFmpeg side, when FFmpeg is installed: an H.264
    /// elementary stream written in odd-sized pieces (as a graphics card's
    /// encoder hands them out) comes out as a Matroska file with every
    /// frame; an encoder that fails ends the picture with its reason.
    #[test]
    fn an_encoded_stream_goes_into_the_file_when_ffmpeg_is_present() {
        let Some(ffmpeg) = ffmpeg() else { return };
        let h264 = quiet(&ffmpeg)
            .args([
                "-v",
                "error",
                "-f",
                "lavfi",
                "-i",
                "testsrc2=size=128x72:rate=30",
                "-frames:v",
                "45",
                "-c:v",
                "libx264",
                "-g",
                "60",
                "-bf",
                "0",
                "-f",
                "h264",
                "-",
            ])
            .output()
            .expect("FFmpeg runs");
        if !h264.status.success() || h264.stdout.is_empty() {
            eprintln!("no libx264 here; skipped");
            return;
        }
        let out = Arc::new(Mutex::new(Vec::<u8>::new()));
        let o = Arc::clone(&out);
        let ended = Arc::new(Mutex::new(None));
        let e2 = Arc::clone(&ended);
        let start = |on_end: Option<OnEnd>| {
            let o = Arc::clone(&o);
            EncoderFeed::start(
                &ffmpeg,
                FeedArgs {
                    pix_fmt: "h264",
                    ..feed_args(None)
                },
                Box::new(move |c| o.lock().unwrap().extend(c)),
                on_end,
            )
            .expect("starts")
        };
        let mut feed = start(None);
        assert!(feed.due(1000) > 0, "an encoded feed needs no priming");
        let bits = feed.bitstream().expect("a bitstream");
        for piece in h264.stdout.chunks(1777) {
            assert!(bits.write(piece.to_vec()));
        }
        bits.count(45);
        drop(bits);
        let stats = feed.finish();
        assert_eq!(stats.frames_in, 45, "{stats:?}");
        let mkv = out.lock().unwrap().clone();
        assert_eq!(&mkv[..4], &[0x1a, 0x45, 0xdf, 0xa3], "Matroska");
        let dir = std::env::temp_dir().join(format!("lumora-zc-{}", std::process::id()));
        let _ = std::fs::create_dir_all(&dir);
        let path = dir.join("copy.mkv");
        std::fs::write(&path, &mkv).unwrap();
        let probe = quiet(&ffmpeg)
            .args(["-v", "error", "-i"])
            .arg(&path)
            .args(["-f", "null", "-c:v", "rawvideo", "-"])
            .output()
            .unwrap();
        let count = quiet(&ffmpeg)
            .args(["-v", "error", "-i"])
            .arg(&path)
            .args(["-vf", "scale=1:1", "-f", "rawvideo", "-pix_fmt", "gray", "-"])
            .output()
            .unwrap()
            .stdout
            .len();
        let _ = std::fs::remove_dir_all(&dir);
        assert!(probe.status.success(), "{probe:?}");
        assert_eq!(count, 45, "every frame is in the file");

        // An encoder that stops: the feed ends by itself, with its reason.
        let feed = start(Some(Box::new(move |asked, said| {
            *e2.lock().unwrap() = Some((asked, said));
        })));
        let bits = feed.bitstream().expect("a bitstream");
        assert!(bits.write(h264.stdout[..4000.min(h264.stdout.len())].to_vec()));
        bits.fail("The graphics card's encoder stopped (test).");
        let deadline = Instant::now() + Duration::from_secs(10);
        while ended.lock().unwrap().is_none() && Instant::now() < deadline {
            thread::sleep(Duration::from_millis(20));
        }
        let got = ended.lock().unwrap().clone();
        assert_eq!(
            got,
            Some((
                false,
                Some("The graphics card's encoder stopped (test).".to_owned())
            ))
        );
        assert!(!bits.write(vec![0; 4]) || !feed.alive());
        drop(feed);
    }

    #[test]
    fn the_sound_is_a_second_input_from_a_local_connection() {
        let (_tx, rx) = sync_channel(1);
        let a = feed_args(Some(AudioIn {
            rate: 44_100,
            encode: vec!["-c:a".into(), "libopus".into()],
            chunks: rx,
        }));
        let s = args(&a, Some(5000)).join(" ");
        assert!(
            s.contains("-f s16le -ar 44100 -ac 2 -i tcp://127.0.0.1:5000"),
            "{s}"
        );
        assert!(s.contains("-map 0:v:0 -map 1:a:0"), "{s}");
        assert!(
            s.contains("-af aresample=48000 -c:a libopus -f matroska -"),
            "{s}"
        );
        assert!(!s.contains(" -an "));
    }

    #[test]
    fn the_picture_keeps_a_constant_rate_on_the_wall_clock() {
        // A 30 fps feed on a 60 fps engine: every other frame.
        let mut c = CfrClock::new(30);
        let sent: u64 = (0..60).map(|i| c.copies(1000 + i * 1000 / 60)).sum();
        assert!((29..=31).contains(&sent), "{sent}");
        // The engine stalls for 200 ms: the frame after it is sent for every slot it missed.
        let mut c = CfrClock::new(60);
        assert_eq!(c.copies(0), 1);
        assert_eq!(c.copies(17), 1);
        assert_eq!(c.copies(217), 12);
        assert_eq!(c.copies(217), 0, "nothing more at the same moment");
        // Never more than a second's worth at once.
        assert_eq!(c.copies(100_000), MAX_REPEAT);
    }

    #[test]
    fn sound_goes_where_its_time_says() {
        let mut a = AudioClock::new(48_000);
        // On time: as it is.
        assert_eq!(a.place(1000, 1000.0, 960), (0, 0));
        assert_eq!(a.place(1000, 1020.0, 960), (0, 0));
        // 100 ms missing (the web view was busy): silence first.
        assert_eq!(a.place(1000, 1140.0, 960), (4800, 0));
        assert_eq!(a.written, 960 * 3 + 4800);
        // Late, overlapping what was written: its first part is left out.
        let (gap, skip) = a.place(1000, 1100.0, 4800);
        assert_eq!(gap, 0);
        assert_eq!(skip, 960 * 3 + 4800 - 4800);
        // Before the start: left out.
        let mut b = AudioClock::new(48_000);
        assert_eq!(
            b.place(1000, 990.0, 960),
            (0, 0),
            "10 ms early is within the slack"
        );
        let mut b = AudioClock::new(48_000);
        assert_eq!(b.place(1000, 900.0, 9600), (0, 4800));
        assert_eq!(b.written, 4800);
    }

    #[test]
    fn silence_keeps_the_sound_going_when_none_comes() {
        let mut a = AudioClock::new(48_000);
        assert_eq!(a.keep_up(1000, 1200, 300), 0);
        assert_eq!(a.keep_up(1000, 2300, 300), 48_000);
        assert_eq!(a.keep_up(1000, 2300, 300), 0);
        assert_eq!(a.silence, 48_000);
        // Real sound after it carries on from there.
        assert_eq!(a.place(1000, 2000.0, 960), (0, 0));
    }

    fn ffmpeg() -> Option<std::path::PathBuf> {
        let ffmpeg = std::path::PathBuf::from(if cfg!(windows) {
            "ffmpeg.exe"
        } else {
            "ffmpeg"
        });
        if quiet(&ffmpeg).arg("-version").output().is_err() {
            eprintln!("no FFmpeg here; skipped");
            return None;
        }
        Some(ffmpeg)
    }

    /// A real encode when FFmpeg is installed (skipped otherwise).
    #[test]
    fn encodes_with_ffmpeg_when_present() {
        let Some(ffmpeg) = ffmpeg() else { return };
        let out = Arc::new(Mutex::new(Vec::<u8>::new()));
        let o = Arc::clone(&out);
        let mut feed = EncoderFeed::start(
            &ffmpeg,
            FeedArgs {
                width: 64,
                height: 36,
                fps: 30,
                pix_fmt: "rgba",
                encode: vec!["-c:v".into(), "mpeg4".into()],
                container: vec!["-f".into(), "matroska".into(), "-".into()],
                audio: None,
            },
            Box::new(move |c| o.lock().unwrap().extend(c)),
            None,
        )
        .expect("starts");
        for i in 0..10u8 {
            let n = feed.due(1000 + u64::from(i) * 34);
            feed.push(Pixels::Owned(vec![i * 20; 64 * 36 * 4]), n);
            std::thread::sleep(Duration::from_millis(5));
        }
        assert!(
            !feed.push(Pixels::Owned(vec![0; 3]), 1),
            "a frame of the wrong size is refused"
        );
        let stats = feed.finish();
        let bytes = out.lock().unwrap();
        assert!(bytes.len() > 100, "encoded output arrived ({stats:?})");
        assert_eq!(stats.frames_in, 10, "{stats:?}");
        // Matroska starts with the EBML magic number.
        assert_eq!(&bytes[..4], &[0x1a, 0x45, 0xdf, 0xa3]);
    }

    /// Picture and sound into one file, the sound lined up by its time
    /// although it arrives 80 ms late: a white flash and a tone start at the
    /// same moment, and FFmpeg's own decode of the file finds them together.
    #[test]
    fn picture_and_sound_together_when_ffmpeg_is_present() {
        let Some(ffmpeg) = ffmpeg() else { return };
        let dir = std::env::temp_dir().join(format!("lumora-feed-{}", std::process::id()));
        let _ = std::fs::create_dir_all(&dir);
        let path = dir.join("av.mkv");
        let (atx, arx) = sync_channel(64);
        let mut feed = EncoderFeed::start(
            &ffmpeg,
            FeedArgs {
                width: 64,
                height: 36,
                fps: 30,
                pix_fmt: "rgba",
                encode: vec!["-c:v".into(), "mpeg4".into(), "-q:v".into(), "2".into()],
                container: vec![
                    "-f".into(),
                    "matroska".into(),
                    "-y".into(),
                    path.to_string_lossy().into_owned(),
                ],
                audio: Some(AudioIn {
                    rate: 48_000,
                    encode: vec!["-c:a".into(), "pcm_s16le".into()],
                    chunks: arx,
                }),
            },
            Box::new(|_| {}),
            None,
        )
        .expect("starts");
        const FLASH_MS: u64 = 700;
        const LATE_MS: u64 = 80;
        let t0 = now_ms();
        let mut sent_audio = 0u64;
        while now_ms() < t0 + 1500 {
            let now = now_ms();
            let n = feed.due(now);
            if n > 0 {
                let v = if now >= t0 + FLASH_MS { 255 } else { 0 };
                feed.push(Pixels::Owned(vec![v; 64 * 36 * 4]), n);
            }
            // 20 ms of sound, sent 80 ms after its time (a busy web view):
            // silence, then a tone from the flash on.
            while t0 + sent_audio * 20 + 20 + LATE_MS <= now {
                let pcm: Vec<u8> = (0..960u64)
                    .flat_map(|i| {
                        let at = sent_audio * 960 + i;
                        let on = at * 1000 >= FLASH_MS * 48_000;
                        let t = at as f32 / 48_000.0;
                        let v = if on {
                            ((t * 440.0 * std::f32::consts::TAU).sin() * 12_000.0) as i16
                        } else {
                            0
                        };
                        let b = v.to_le_bytes();
                        [b[0], b[1], b[0], b[1]]
                    })
                    .collect();
                let _ = atx.try_send(PcmChunk {
                    at_ms: (t0 + sent_audio * 20) as f64,
                    rate: 48_000,
                    pcm: Arc::new(pcm),
                });
                sent_audio += 1;
            }
            std::thread::sleep(Duration::from_millis(4));
        }
        let stats = feed.finish();
        assert!(stats.frames_in >= 43, "{stats:?}");
        assert!(stats.audio_samples > 48_000, "{stats:?}");
        // Decode both back: the picture as one gray value a frame, the sound as samples.
        let video = quiet(&ffmpeg)
            .args(["-v", "error", "-i"])
            .arg(&path)
            .args([
                "-map",
                "0:v",
                "-vf",
                "scale=1:1",
                "-f",
                "rawvideo",
                "-pix_fmt",
                "gray",
                "-",
            ])
            .output()
            .expect("decodes");
        let audio = quiet(&ffmpeg)
            .args(["-v", "error", "-i"])
            .arg(&path)
            .args(["-map", "0:a", "-ac", "1", "-f", "s16le", "-"])
            .output()
            .expect("decodes");
        let _ = std::fs::remove_dir_all(&dir);
        let first_white = video.stdout.iter().position(|v| *v > 128).expect("a flash");
        let samples: Vec<i16> = audio
            .stdout
            .as_chunks::<2>()
            .0
            .iter()
            .map(|b| i16::from_le_bytes(*b))
            .collect();
        let first_tone = samples
            .iter()
            .position(|v| v.unsigned_abs() > 2000)
            .expect("a tone");
        let flash = first_white as f64 / 30.0;
        let tone = first_tone as f64 / 48_000.0;
        eprintln!("flash at {flash:.3} s, tone at {tone:.3} s ({stats:?})");
        assert!(
            (flash - tone).abs() <= 0.045,
            "flash at {flash:.3} s, tone at {tone:.3} s"
        );
    }
}
