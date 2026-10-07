//! Where pictures come from: cameras, video files, test patterns.
//!
//! Every source runs on its own thread and leaves its newest frame in a
//! mailbox; the compositor takes whatever is newest when it draws (a frame
//! that arrives late is never waited for, an old one is never drawn twice to
//! the GPU). Each source is opened once, however many screens and previews
//! show it.

use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, PoisonError};
use std::thread;
use std::time::{Duration, Instant};

use serde::Serialize;

use crate::frame::{FramePool, PixelFormat, VideoFrame};

/// After this long without a new frame a live source counts as "no signal".
pub const NO_SIGNAL_AFTER: Duration = Duration::from_millis(1500);

/// What a source is doing.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase", tag = "state", content = "detail")]
pub enum SourceState {
    /// Opening (a camera can take a second or two).
    Starting,
    /// Pictures are arriving.
    Live,
    /// It was live but pictures stopped arriving.
    NoSignal,
    /// It could not open or it stopped for good, in words for the operator.
    Failed(String),
}

/// How a source is doing, for the backup lineup's watch and the status panel.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceHealth {
    pub state: SourceState,
    pub frames: u64,
    pub width: u32,
    pub height: u32,
    /// Frames a second over the last second or so.
    pub fps: f32,
}

/// A source of pictures. Implementations do their work on their own thread.
pub trait VideoSource: Send {
    /// The newest frame (shared, not copied), if one has arrived.
    fn latest(&self) -> Option<VideoFrame>;
    fn health(&self) -> SourceHealth;
    /// What it is, for logs ("Media Foundation: Logitech BRIO").
    fn describe(&self) -> String;
}

/// The mailbox a source thread writes into and the engine reads from.
#[derive(Default)]
pub struct Mailbox {
    frame: Mutex<Option<VideoFrame>>,
    status: Mutex<MailboxStatus>,
    stop: AtomicBool,
}

struct MailboxStatus {
    error: Option<String>,
    last: Option<Instant>,
    frames: u64,
    window_start: Instant,
    window_frames: u64,
    fps: f32,
    size: (u32, u32),
    /// Still pictures never go "no signal".
    still: bool,
}

impl Default for MailboxStatus {
    fn default() -> Self {
        MailboxStatus {
            error: None,
            last: None,
            frames: 0,
            window_start: Instant::now(),
            window_frames: 0,
            fps: 0.0,
            size: (0, 0),
            still: false,
        }
    }
}

fn lock<T>(m: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    m.lock().unwrap_or_else(PoisonError::into_inner)
}

impl Mailbox {
    pub fn new() -> Arc<Self> {
        Arc::default()
    }

    /// A new frame from the source's thread.
    pub fn put(&self, f: VideoFrame) {
        {
            let mut s = lock(&self.status);
            let now = Instant::now();
            s.last = Some(now);
            s.frames += 1;
            s.window_frames += 1;
            s.size = (f.width, f.height);
            let span = now.duration_since(s.window_start);
            if span >= Duration::from_secs(1) {
                s.fps = s.window_frames as f32 / span.as_secs_f32();
                s.window_frames = 0;
                s.window_start = now;
            }
        }
        *lock(&self.frame) = Some(f);
    }

    pub fn fail(&self, why: impl Into<String>) {
        lock(&self.status).error = Some(why.into());
    }

    pub fn set_still(&self) {
        lock(&self.status).still = true;
    }

    pub fn latest(&self) -> Option<VideoFrame> {
        lock(&self.frame).clone()
    }

    pub fn stop(&self) {
        self.stop.store(true, Ordering::SeqCst);
    }

    pub fn stopped(&self) -> bool {
        self.stop.load(Ordering::SeqCst)
    }

    pub fn health(&self) -> SourceHealth {
        let s = lock(&self.status);
        let state = match (&s.error, s.last) {
            (Some(e), _) => SourceState::Failed(e.clone()),
            (None, None) => SourceState::Starting,
            (None, Some(t)) if !s.still && t.elapsed() > NO_SIGNAL_AFTER => SourceState::NoSignal,
            (None, Some(_)) => SourceState::Live,
        };
        SourceHealth {
            state,
            frames: s.frames,
            width: s.size.0,
            height: s.size.1,
            fps: s.fps,
        }
    }
}

// ---------------------------------------------------------------------------
// Test pattern

/// Color bars with a box moving across them, made on its own thread at a
/// steady rate: the stand-in for a camera in tests, the benchmark and on
/// computers without one.
pub struct TestPattern {
    mailbox: Arc<Mailbox>,
    name: String,
}

/// The bars, top row first (75% bars like SMPTE's, plus a gray ramp at the bottom).
pub fn bars(width: u32, height: u32, hue_shift: usize, px: &mut [u8]) {
    const BARS: [[u8; 3]; 7] = [
        [191, 191, 191],
        [191, 191, 0],
        [0, 191, 191],
        [0, 191, 0],
        [191, 0, 191],
        [191, 0, 0],
        [0, 0, 191],
    ];
    let (w, h) = (width as usize, height as usize);
    for y in 0..h {
        let row = &mut px[y * w * 4..(y + 1) * w * 4];
        for (x, p) in row.as_chunks_mut::<4>().0.iter_mut().enumerate() {
            let c = if y < h * 3 / 4 {
                BARS[(x * 7 / w.max(1) + hue_shift) % 7]
            } else {
                let g = (x * 255 / w.max(1)) as u8;
                [g, g, g]
            };
            p.copy_from_slice(&[c[0], c[1], c[2], 255]);
        }
    }
}

impl TestPattern {
    /// Start one: `seed` changes the bars' order so several can be told apart.
    pub fn start(name: &str, width: u32, height: u32, fps: u32, seed: usize) -> Self {
        let mailbox = Mailbox::new();
        let mb = Arc::clone(&mailbox);
        let pool = FramePool::new(4);
        let mut base = vec![0u8; width as usize * height as usize * 4];
        bars(width, height, seed, &mut base);
        let _ = thread::Builder::new()
            .name(format!("lumora-live-pattern-{seed}"))
            .spawn(move || {
                let period = Duration::from_secs_f64(1.0 / f64::from(fps.max(1)));
                let mut next = Instant::now();
                let mut seq = 0u64;
                let (w, h) = (width as usize, height as usize);
                let side = (h / 6).max(2);
                while !mb.stopped() {
                    let x0 = (seq as usize * 8) % w.saturating_sub(side).max(1);
                    let y0 = h / 3;
                    let f =
                        VideoFrame::build(&pool, width, height, PixelFormat::Rgba8, seq, |px| {
                            px.copy_from_slice(&base);
                            for y in y0..(y0 + side).min(h) {
                                let row =
                                    &mut px[(y * w + x0) * 4..(y * w + (x0 + side).min(w)) * 4];
                                row.fill(255);
                            }
                        });
                    mb.put(f);
                    seq += 1;
                    next += period;
                    let now = Instant::now();
                    if next > now {
                        thread::sleep(next - now);
                    } else {
                        next = now;
                    }
                }
            });
        TestPattern {
            mailbox,
            name: name.to_owned(),
        }
    }
}

impl VideoSource for TestPattern {
    fn latest(&self) -> Option<VideoFrame> {
        self.mailbox.latest()
    }
    fn health(&self) -> SourceHealth {
        self.mailbox.health()
    }
    fn describe(&self) -> String {
        format!("Test pattern: {}", self.name)
    }
}

impl Drop for TestPattern {
    fn drop(&mut self) {
        self.mailbox.stop();
    }
}

// ---------------------------------------------------------------------------
// Files through FFmpeg

/// A video file (looped) or a picture, decoded by FFmpeg into RGBA frames
/// on a pipe. Paced to the file's own frame rate (`-re`).
pub struct FfmpegFile {
    mailbox: Arc<Mailbox>,
    child: Arc<Mutex<Option<Child>>>,
    path: PathBuf,
}

/// The picture size FFmpeg's `ffprobe` reports (None when it can't tell).
pub fn probe_size(ffmpeg: &Path, file: &Path) -> Option<(u32, u32)> {
    let probe = ffmpeg.with_file_name(if cfg!(windows) {
        "ffprobe.exe"
    } else {
        "ffprobe"
    });
    let out = quiet(&probe)
        .args([
            "-v",
            "error",
            "-select_streams",
            "v:0",
            "-show_entries",
            "stream=width,height",
            "-of",
            "csv=p=0",
        ])
        .arg(file)
        .output()
        .ok()?;
    let text = String::from_utf8_lossy(&out.stdout);
    let mut it = text.trim().split(',').map(|v| v.trim().parse::<u32>().ok());
    match (it.next().flatten(), it.next().flatten()) {
        (Some(w), Some(h)) if w > 0 && h > 0 => Some((w, h)),
        _ => None,
    }
}

/// A command that opens no console window on Windows.
pub fn quiet(program: impl AsRef<std::ffi::OsStr>) -> Command {
    #[allow(unused_mut)]
    let mut c = Command::new(program);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        c.creation_flags(CREATE_NO_WINDOW);
    }
    c
}

/// The largest picture a file source is decoded at (bigger files are scaled down by FFmpeg).
const MAX_W: u32 = 3840;
const MAX_H: u32 = 2160;

/// The size frames are delivered at: the file's own (even, at most 4K), or 1080p if unknown.
pub fn delivered_size(probed: Option<(u32, u32)>) -> (u32, u32) {
    let (w, h) = probed.unwrap_or((1920, 1080));
    let k = (f64::from(MAX_W) / f64::from(w))
        .min(f64::from(MAX_H) / f64::from(h))
        .min(1.0);
    let even = |v: f64| ((v.round() as u32) & !1).max(2);
    (even(f64::from(w) * k), even(f64::from(h) * k))
}

impl FfmpegFile {
    /// Start decoding `file`. A still picture (`still`) is decoded once and kept.
    pub fn start(ffmpeg: &Path, file: &Path, still: bool) -> Self {
        let mailbox = Mailbox::new();
        if still {
            mailbox.set_still();
        }
        let child: Arc<Mutex<Option<Child>>> = Arc::default();
        let (mb, ch) = (Arc::clone(&mailbox), Arc::clone(&child));
        let (ffmpeg, file_owned) = (ffmpeg.to_owned(), file.to_owned());
        let _ = thread::Builder::new()
            .name("lumora-live-file".into())
            .spawn(move || run_file(&ffmpeg, &file_owned, still, &mb, &ch));
        FfmpegFile {
            mailbox,
            child,
            path: file.to_owned(),
        }
    }
}

fn run_file(
    ffmpeg: &Path,
    file: &Path,
    still: bool,
    mb: &Mailbox,
    child_slot: &Mutex<Option<Child>>,
) {
    let (w, h) = delivered_size(probe_size(ffmpeg, file));
    let mut cmd = quiet(ffmpeg);
    cmd.args(["-hide_banner", "-loglevel", "error", "-nostdin"]);
    if !still {
        cmd.args(["-re", "-stream_loop", "-1"]);
    }
    cmd.arg("-i").arg(file);
    if still {
        cmd.args(["-frames:v", "1"]);
    }
    cmd.args([
        "-an",
        "-vf",
        &format!("scale={w}:{h}:flags=bilinear"),
        "-pix_fmt",
        "rgba",
        "-f",
        "rawvideo",
        "-",
    ]);
    cmd.stdout(Stdio::piped()).stderr(Stdio::piped());
    let mut child = match cmd.spawn() {
        Ok(c) => c,
        Err(e) => return mb.fail(format!("FFmpeg could not start: {e}")),
    };
    let Some(mut out) = child.stdout.take() else {
        return mb.fail("FFmpeg gave no output.");
    };
    let mut err = child.stderr.take();
    *lock(child_slot) = Some(child);
    let pool = FramePool::new(4);
    let len = w as usize * h as usize * 4;
    let mut seq = 0u64;
    while !mb.stopped() {
        let mut buf = pool.take(len);
        if out.read_exact(buf.as_mut_slice()).is_err() {
            break;
        }
        mb.put(VideoFrame {
            width: w,
            height: h,
            format: PixelFormat::Rgba8,
            data: Arc::new(buf),
            seq,
        });
        seq += 1;
    }
    if seq == 0 && !mb.stopped() {
        let mut why = String::new();
        if let Some(e) = err.as_mut() {
            let _ = e.read_to_string(&mut why);
        }
        let why = why.lines().last().unwrap_or("no pictures").to_owned();
        mb.fail(format!("The file could not be played: {why}"));
    }
}

impl VideoSource for FfmpegFile {
    fn latest(&self) -> Option<VideoFrame> {
        self.mailbox.latest()
    }
    fn health(&self) -> SourceHealth {
        self.mailbox.health()
    }
    fn describe(&self) -> String {
        format!("File: {}", self.path.display())
    }
}

impl Drop for FfmpegFile {
    fn drop(&mut self) {
        self.mailbox.stop();
        if let Some(mut c) = lock(&self.child).take() {
            let _ = c.kill();
            let _ = c.wait();
        }
    }
}

/// A camera's name as Windows knows it: the show keeps the browser's label,
/// which Chrome ends with " (vid:pid)" for USB cameras.
pub fn camera_name(label: &str) -> &str {
    let t = label.trim_end();
    if let Some(open) = t.rfind(" (") {
        let inner = &t[open + 2..];
        if inner.len() == 10
            && inner.ends_with(')')
            && inner.as_bytes()[4] == b':'
            && inner[..4].bytes().all(|b| b.is_ascii_hexdigit())
            && inner[5..9].bytes().all(|b| b.is_ascii_hexdigit())
        {
            return &t[..open];
        }
    }
    t
}

/// A source that never has a picture, with a reason (an input kind the
/// unified engine can't open yet, a camera on a computer with no camera API).
pub struct Unavailable {
    why: String,
}

impl Unavailable {
    pub fn new(why: impl Into<String>) -> Self {
        Unavailable { why: why.into() }
    }
}

impl VideoSource for Unavailable {
    fn latest(&self) -> Option<VideoFrame> {
        None
    }
    fn health(&self) -> SourceHealth {
        SourceHealth {
            state: SourceState::Failed(self.why.clone()),
            frames: 0,
            width: 0,
            height: 0,
            fps: 0.0,
        }
    }
    fn describe(&self) -> String {
        format!("Unavailable: {}", self.why)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_test_pattern_delivers_frames_and_reports_live() {
        let p = TestPattern::start("t", 64, 36, 120, 0);
        let deadline = Instant::now() + Duration::from_secs(5);
        while p.latest().is_none_or(|f| f.seq < 3) && Instant::now() < deadline {
            thread::sleep(Duration::from_millis(5));
        }
        let f = p.latest().expect("frames arrive");
        assert_eq!((f.width, f.height), (64, 36));
        assert_eq!(p.health().state, SourceState::Live);
    }

    #[test]
    fn a_source_that_stops_sending_reports_no_signal() {
        let mb = Mailbox::new();
        assert_eq!(mb.health().state, SourceState::Starting);
        let pool = FramePool::new(1);
        mb.put(VideoFrame::build(
            &pool,
            2,
            2,
            PixelFormat::Rgba8,
            0,
            |_| {},
        ));
        assert_eq!(mb.health().state, SourceState::Live);
        lock(&mb.status).last = Some(Instant::now() - NO_SIGNAL_AFTER - Duration::from_millis(10));
        assert_eq!(mb.health().state, SourceState::NoSignal);
        mb.set_still();
        assert_eq!(
            mb.health().state,
            SourceState::Live,
            "a still picture is never stale"
        );
        mb.fail("unplugged");
        assert_eq!(mb.health().state, SourceState::Failed("unplugged".into()));
    }

    #[test]
    fn files_are_delivered_at_their_own_size_up_to_4k() {
        assert_eq!(delivered_size(Some((1280, 720))), (1280, 720));
        assert_eq!(delivered_size(Some((7680, 4320))), (3840, 2160));
        assert_eq!(delivered_size(Some((1081, 1921))), (1080, 1920));
        assert_eq!(delivered_size(None), (1920, 1080));
    }

    #[test]
    fn chromes_usb_ids_are_left_off_camera_names() {
        assert_eq!(camera_name("Logitech BRIO (046d:085e)"), "Logitech BRIO");
        assert_eq!(camera_name("Integrated Camera"), "Integrated Camera");
        assert_eq!(camera_name("Cam (front)"), "Cam (front)");
        assert_eq!(camera_name("Cam (éé:ab)"), "Cam (éé:ab)");
    }

    #[test]
    fn bars_fill_every_pixel_opaque() {
        let mut px = vec![0u8; 16 * 8 * 4];
        bars(16, 8, 0, &mut px);
        assert!(px.as_chunks::<4>().0.iter().all(|p| p[3] == 255));
        assert_eq!(&px[..3], &[191, 191, 191]);
    }
}
