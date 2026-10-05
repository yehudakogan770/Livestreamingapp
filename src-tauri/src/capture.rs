//! Recording and streaming.
//!
//! The control window draws the Live Screen (with its sound) and encodes it
//! with the WebView's own video encoder (hardware where the computer has
//! one). The encoded stream arrives here in chunks, one session per
//! recording or stream:
//!
//! - **Recording**: chunks go straight into a file as they arrive, so a crash
//!   or power cut loses at most a second. When the recording stops, it is
//!   turned into an `.mp4` if FFmpeg is available (no re-encoding).
//! - **Streaming**: chunks are piped into FFmpeg, which sends them to every
//!   chosen destination (YouTube, Facebook, any RTMP server) at once. One
//!   destination failing never stops the others.
//!
//! If a session fails (the network drops, the disk fills up), the status
//! says so and the control window starts a new one.

use std::collections::HashMap;
use std::fs::{self, File};
use std::io::{BufRead, BufReader, Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::mpsc::{self, Sender};
use std::sync::{Arc, Mutex, MutexGuard, PoisonError};
use std::thread;
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};

use crate::store::write_file_atomic;

const FILE: &str = "capture.json";
/// More than this waiting to be written means the disk or network can't keep up.
const MAX_QUEUED: u64 = 64 * 1024 * 1024;

// ---------------------------------------------------------------------------
// Settings

/// Where the stream goes.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Destination {
    pub id: String,
    /// e.g. "YouTube".
    pub name: String,
    /// The server, e.g. `rtmp://a.rtmp.youtube.com/live2`.
    pub url: String,
    /// The stream key (kept on this computer only).
    pub key: String,
    pub enabled: bool,
    /// Gets the vertical (9:16) version, for TikTok, Reels and Shorts,
    /// streamed at the same time as the wide one.
    pub vertical: bool,
}

impl Default for Destination {
    fn default() -> Self {
        Destination {
            id: String::new(),
            name: "Stream".to_owned(),
            url: String::new(),
            key: String::new(),
            enabled: true,
            vertical: false,
        }
    }
}

impl Destination {
    /// The full address FFmpeg sends to.
    fn target(&self) -> String {
        let url = self.url.trim().trim_end_matches('/');
        let key = self.key.trim();
        if key.is_empty() {
            url.to_owned()
        } else {
            format!("{url}/{key}")
        }
    }
}

/// Picture size and frame rate of recordings and streams.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub enum Quality {
    #[serde(rename = "720p")]
    P720,
    #[default]
    #[serde(rename = "1080p")]
    P1080,
    #[serde(rename = "1080p60")]
    P1080x60,
    #[serde(rename = "720p60")]
    P720x60,
    #[serde(rename = "1440p")]
    P1440,
    #[serde(rename = "1440p60")]
    P1440x60,
    #[serde(rename = "2160p")]
    P2160,
    /// 1080 × 1920, for Shorts, Reels and TikTok.
    #[serde(rename = "vertical")]
    Vertical,
}

/// Which mix a recording hears.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub enum RecordMix {
    /// The same as the stream.
    #[default]
    Stream,
    /// Mix B ("Recording" in the mixer).
    Recording,
}

/// Remembered on this computer (not in event files: stream keys stay here).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct CaptureSettings {
    /// Where recordings go (`None`: the Videos folder).
    pub folder: Option<String>,
    pub quality: Quality,
    /// Video bitrate in kbit/s.
    pub video_kbps: u32,
    /// Sound bitrate in kbit/s.
    pub audio_kbps: u32,
    pub record_mix: RecordMix,
    /// Also record each camera to its own file.
    pub iso: bool,
    /// Save a chapter list (what was on air when) with each recording.
    pub chapters: bool,
    pub destinations: Vec<Destination>,
}

impl Default for CaptureSettings {
    fn default() -> Self {
        CaptureSettings {
            folder: None,
            quality: Quality::P1080,
            video_kbps: 6000,
            audio_kbps: 160,
            record_mix: RecordMix::Stream,
            iso: false,
            chapters: true,
            destinations: Vec::new(),
        }
    }
}

impl CaptureSettings {
    fn cleaned(mut self) -> Self {
        self.video_kbps = self.video_kbps.clamp(500, 80_000);
        self.audio_kbps = self.audio_kbps.clamp(64, 320);
        self.folder = self.folder.filter(|f| !f.trim().is_empty());
        for (i, d) in self.destinations.iter_mut().enumerate() {
            if d.id.is_empty() {
                d.id = format!("dest-{}", i + 1);
            }
            d.name = d.name.trim().chars().take(40).collect();
        }
        self
    }
}

// ---------------------------------------------------------------------------
// Status

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Kind {
    Record,
    Stream,
    /// The vertical (9:16) version, streamed beside the wide one.
    Vertical,
}

/// A recording or stream that is running.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Running {
    pub session: u64,
    /// When it started (ms since 1970).
    pub started_at: u64,
    /// The file being written (recordings).
    pub path: Option<String>,
    /// Names of the destinations (streams).
    pub destinations: Vec<String>,
    pub bytes: u64,
    /// How fast FFmpeg keeps up (1.0 = real time; below 0.95 the network is too slow).
    pub speed: Option<f32>,
}

/// Why a recording or stream stopped by itself.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Failure {
    pub kind: Kind,
    pub session: u64,
    pub message: String,
}

#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CaptureStatus {
    /// FFmpeg was found (needed for streaming and for .mp4 files).
    pub ffmpeg: bool,
    pub recording: Option<Running>,
    pub streaming: Option<Running>,
    /// The vertical version, when some destinations get it.
    pub vertical: Option<Running>,
    /// The last recording that finished, ready to use.
    pub last_recording: Option<String>,
    /// Still turning the last recording into an .mp4.
    pub finishing: bool,
    pub failure: Option<Failure>,
}

// ---------------------------------------------------------------------------

fn lock<T>(m: &Mutex<T>) -> MutexGuard<'_, T> {
    m.lock().unwrap_or_else(PoisonError::into_inner)
}

fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0, |d| u64::try_from(d.as_millis()).unwrap_or(u64::MAX))
}

type Notify = Box<dyn Fn(&CaptureStatus) + Send + Sync>;

struct Shared {
    status: Mutex<CaptureStatus>,
    notify: Notify,
}

impl Shared {
    fn update(&self, f: impl FnOnce(&mut CaptureStatus)) {
        let status = {
            let mut s = lock(&self.status);
            f(&mut s);
            s.clone()
        };
        (self.notify)(&status);
    }

    fn slot(s: &mut CaptureStatus, kind: Kind) -> &mut Option<Running> {
        match kind {
            Kind::Record => &mut s.recording,
            Kind::Stream => &mut s.streaming,
            Kind::Vertical => &mut s.vertical,
        }
    }

    /// A session stopped by itself.
    fn fail(&self, kind: Kind, session: u64, message: String) {
        eprintln!("lumora: {kind:?} {session} stopped: {message}");
        self.update(|s| {
            let slot = Shared::slot(s, kind);
            if slot.as_ref().is_some_and(|r| r.session == session) {
                *slot = None;
                s.failure = Some(Failure {
                    kind,
                    session,
                    message,
                });
            }
        });
    }
}

struct Session {
    kind: Kind,
    tx: Sender<Vec<u8>>,
    queued: Arc<AtomicU64>,
    /// Set when the operator stops it (so the end is not a failure).
    stopping: Arc<AtomicBool>,
}

/// Recordings and streams.
pub struct Capture {
    dir: Option<PathBuf>,
    default_folder: PathBuf,
    settings: Mutex<CaptureSettings>,
    sessions: Mutex<HashMap<u64, Session>>,
    shared: Arc<Shared>,
    next: AtomicU64,
    ffmpeg: Option<PathBuf>,
}

impl Capture {
    /// `dir`: where the settings are kept (`None`: not saved, for tests).
    /// `default_folder`: recordings go here unless another folder is chosen.
    pub fn new(
        dir: Option<&Path>,
        default_folder: PathBuf,
        ffmpeg: Option<PathBuf>,
        notify: impl Fn(&CaptureStatus) + Send + Sync + 'static,
    ) -> Capture {
        let settings = dir
            .and_then(|d| fs::read_to_string(d.join(FILE)).ok())
            .and_then(|t| serde_json::from_str::<CaptureSettings>(&t).ok())
            .unwrap_or_default()
            .cleaned();
        Capture {
            dir: dir.map(Path::to_path_buf),
            default_folder,
            settings: Mutex::new(settings),
            sessions: Mutex::new(HashMap::new()),
            shared: Arc::new(Shared {
                status: Mutex::new(CaptureStatus {
                    ffmpeg: ffmpeg.is_some(),
                    ..CaptureStatus::default()
                }),
                notify: Box::new(notify),
            }),
            next: AtomicU64::new(1),
            ffmpeg,
        }
    }

    pub fn status(&self) -> CaptureStatus {
        lock(&self.shared.status).clone()
    }

    pub fn settings(&self) -> CaptureSettings {
        lock(&self.settings).clone()
    }

    /// The folder recordings go to.
    pub fn folder(&self) -> PathBuf {
        lock(&self.settings)
            .folder
            .as_ref()
            .map_or_else(|| self.default_folder.clone(), PathBuf::from)
    }

    pub fn set_settings(&self, settings: CaptureSettings) -> CaptureSettings {
        let settings = settings.cleaned();
        *lock(&self.settings) = settings.clone();
        if let Some(dir) = &self.dir {
            if let Ok(text) = serde_json::to_string_pretty(&settings) {
                let _ = write_file_atomic(&dir.join(FILE), &text);
            }
        }
        settings
    }

    /// Start a recording or stream. `mime` is what the encoder makes (e.g.
    /// `video/x-matroska;codecs=avc1,opus`); `name` names the recording file.
    ///
    /// # Errors
    /// Why it could not start, in words for the operator.
    pub fn start(&self, kind: Kind, mime: &str, name: &str) -> Result<Running, String> {
        if Shared::slot(&mut lock(&self.shared.status), kind).is_some() {
            return Err(match kind {
                Kind::Record => "Already recording.".to_owned(),
                Kind::Stream => "Already streaming.".to_owned(),
                Kind::Vertical => "Already streaming the vertical version.".to_owned(),
            });
        }
        let session = self.next.fetch_add(1, Ordering::SeqCst);
        let stopping = Arc::new(AtomicBool::new(false));
        let (out, running, finish): (Box<dyn Write + Send>, Running, Finish) = match kind {
            Kind::Record => self.open_recording(session, mime, name)?,
            Kind::Stream | Kind::Vertical => self.open_stream(kind, session, mime, &stopping)?,
        };
        let (tx, rx) = mpsc::channel::<Vec<u8>>();
        let queued = Arc::new(AtomicU64::new(0));
        {
            let shared = Arc::clone(&self.shared);
            let queued = Arc::clone(&queued);
            let ffmpeg = self.ffmpeg.clone();
            let mime = mime.to_owned();
            thread::Builder::new()
                .name(format!("lumora-{kind:?}-{session}").to_lowercase())
                .spawn(move || {
                    write_loop(&shared, kind, session, out, &rx, &queued);
                    finish.run(&shared, ffmpeg.as_deref(), &mime);
                })
                .map_err(|e| e.to_string())?;
        }
        lock(&self.sessions).insert(
            session,
            Session {
                kind,
                tx,
                queued,
                stopping,
            },
        );
        self.shared.update(|s| {
            *Shared::slot(s, kind) = Some(running.clone());
            if s.failure.as_ref().is_some_and(|f| f.kind == kind) {
                s.failure = None;
            }
        });
        Ok(running)
    }

    /// More of the encoded picture and sound.
    ///
    /// # Errors
    /// When the session is no longer running (it stopped or failed).
    pub fn chunk(&self, session: u64, bytes: Vec<u8>) -> Result<(), String> {
        let sessions = lock(&self.sessions);
        let s = sessions.get(&session).ok_or("not running")?;
        let alive = Shared::slot(&mut lock(&self.shared.status), s.kind)
            .as_ref()
            .is_some_and(|r| r.session == session);
        if !alive {
            // It failed: forget it (the control window starts a new one).
            drop(sessions);
            self.stop(session);
            return Err("not running".to_owned());
        }
        let len = bytes.len() as u64;
        if s.queued.fetch_add(len, Ordering::SeqCst) + len > MAX_QUEUED {
            let kind = s.kind;
            drop(sessions);
            self.stop(session);
            self.shared.fail(
                kind,
                session,
                match kind {
                    Kind::Record => "The disk can't keep up with the recording.".to_owned(),
                    Kind::Stream | Kind::Vertical => {
                        "The internet connection is too slow for the stream.".to_owned()
                    }
                },
            );
            return Err("too slow".to_owned());
        }
        s.tx.send(bytes).map_err(|_| "not running".to_owned())
    }

    /// Stop a recording or stream (the operator pressed stop).
    pub fn stop(&self, session: u64) {
        let Some(s) = lock(&self.sessions).remove(&session) else {
            return;
        };
        s.stopping.store(true, Ordering::SeqCst);
        // Dropping the sender ends the write loop; the file is closed or
        // FFmpeg finishes sending.
        drop(s.tx);
        self.shared.update(|st| {
            let slot = Shared::slot(st, s.kind);
            if slot.as_ref().is_some_and(|r| r.session == session) {
                *slot = None;
            }
        });
    }

    /// Stop everything (Lumora is closing).
    pub fn stop_all(&self) {
        let ids: Vec<u64> = lock(&self.sessions).keys().copied().collect();
        for id in ids {
            self.stop(id);
        }
    }

    fn open_recording(
        &self,
        session: u64,
        mime: &str,
        name: &str,
    ) -> Result<(Box<dyn Write + Send>, Running, Finish), String> {
        let folder = self.folder();
        fs::create_dir_all(&folder).map_err(|e| {
            format!(
                "The recordings folder {} can't be used: {e}",
                folder.display()
            )
        })?;
        let ext = if mime.contains("matroska") {
            "mkv"
        } else {
            "webm"
        };
        let path = unique_path(&folder, &file_name(name), ext);
        let file = File::create(&path)
            .map_err(|e| format!("Can't create the recording file {}: {e}", path.display()))?;
        let running = Running {
            session,
            started_at: now_ms(),
            path: Some(path.to_string_lossy().into_owned()),
            destinations: Vec::new(),
            bytes: 0,
            speed: None,
        };
        Ok((Box::new(file), running, Finish::Recording(path)))
    }

    fn open_stream(
        &self,
        kind: Kind,
        session: u64,
        mime: &str,
        stopping: &Arc<AtomicBool>,
    ) -> Result<(Box<dyn Write + Send>, Running, Finish), String> {
        let ffmpeg = self.ffmpeg.as_ref().ok_or(
            "Streaming needs FFmpeg, which was not found on this computer. \
             Put ffmpeg.exe next to Lumora (or install FFmpeg) and start Lumora again.",
        )?;
        let settings = self.settings();
        let dests = destinations_for(&settings, kind);
        if dests.is_empty() && kind == Kind::Vertical {
            return Err("No destination gets the vertical version.".to_owned());
        }
        if dests.is_empty() && !destinations_for(&settings, Kind::Vertical).is_empty() {
            return Err(
                "Every destination gets the vertical version. Add a wide one too, or set \
                 the picture to Vertical in Settings → Recording and streaming to stream \
                 only vertical."
                    .to_owned(),
            );
        }
        if dests.is_empty() {
            return Err(
                "There is nowhere to stream to yet. Add YouTube, Facebook or another \
                        destination in Settings → Recording and streaming."
                    .to_owned(),
            );
        }
        let targets: Vec<String> = dests.iter().map(|d| d.target()).collect();
        let mut child = Command::new(ffmpeg)
            .args(stream_args(
                mime,
                settings.video_kbps,
                settings.audio_kbps,
                &targets,
            ))
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|e| format!("FFmpeg could not start: {e}"))?;
        let stdin = child.stdin.take().ok_or("FFmpeg could not start")?;
        let errors = Arc::new(Mutex::new(String::new()));
        if let Some(err) = child.stderr.take() {
            let errors = Arc::clone(&errors);
            thread::spawn(move || {
                for line in BufReader::new(err).lines().map_while(Result::ok) {
                    let mut e = lock(&errors);
                    // Keep the last few lines, to explain a failure.
                    e.push_str(&line);
                    e.push('\n');
                    if e.len() > 4000 {
                        let cut = e.len() - 2000;
                        let cut = (cut..e.len()).find(|&i| e.is_char_boundary(i)).unwrap_or(0);
                        e.drain(..cut);
                    }
                }
            });
        }
        if let Some(out) = child.stdout.take() {
            let shared = Arc::clone(&self.shared);
            let errors = Arc::clone(&errors);
            let stopping = Arc::clone(stopping);
            thread::spawn(move || {
                read_progress(out, &shared, session);
                // FFmpeg has ended. Unless the operator stopped it, say why.
                thread::sleep(Duration::from_millis(200));
                if !stopping.load(Ordering::SeqCst) {
                    let said = lock(&errors).clone();
                    shared.fail(kind, session, explain_stream_error(&said));
                }
            });
        }
        let running = Running {
            session,
            started_at: now_ms(),
            path: None,
            destinations: dests.iter().map(|d| d.name.clone()).collect(),
            bytes: 0,
            speed: None,
        };
        Ok((Box::new(StdinWriter(stdin)), running, Finish::Stream(child)))
    }
}

impl Drop for Capture {
    fn drop(&mut self) {
        self.stop_all();
    }
}

struct StdinWriter(ChildStdin);

impl Write for StdinWriter {
    fn write(&mut self, buf: &[u8]) -> std::io::Result<usize> {
        self.0.write(buf)
    }
    fn flush(&mut self) -> std::io::Result<()> {
        self.0.flush()
    }
}

/// Write chunks until the session is stopped (or writing fails).
fn write_loop(
    shared: &Shared,
    kind: Kind,
    session: u64,
    mut out: Box<dyn Write + Send>,
    rx: &mpsc::Receiver<Vec<u8>>,
    queued: &AtomicU64,
) {
    let mut last_report = Instant::now();
    let mut written = 0u64;
    while let Ok(chunk) = rx.recv() {
        queued.fetch_sub(chunk.len() as u64, Ordering::SeqCst);
        if let Err(e) = out.write_all(&chunk).and_then(|()| out.flush()) {
            let message = match kind {
                Kind::Record => {
                    format!("The recording could not be written ({e}). Is the disk full?")
                }
                Kind::Stream | Kind::Vertical => "The stream stopped.".to_owned(),
            };
            // For streams the FFmpeg reader explains why; this is the fallback.
            if kind == Kind::Record {
                shared.fail(kind, session, message);
            }
            return;
        }
        written += chunk.len() as u64;
        if last_report.elapsed() > Duration::from_secs(1) {
            last_report = Instant::now();
            shared.update(|s| {
                if let Some(r) = Shared::slot(s, kind)
                    .as_mut()
                    .filter(|r| r.session == session)
                {
                    r.bytes = written;
                }
            });
        }
    }
}

/// What happens after the last chunk.
enum Finish {
    Recording(PathBuf),
    /// FFmpeg (a failure is reported by its progress reader).
    Stream(Child),
}

impl Finish {
    fn run(self, shared: &Shared, ffmpeg: Option<&Path>, mime: &str) {
        match self {
            Finish::Recording(path) => {
                let can_mp4 = mime.contains("avc1") || mime.contains("h264");
                match ffmpeg.filter(|_| can_mp4) {
                    Some(ffmpeg) => {
                        shared.update(|s| s.finishing = true);
                        let done = to_mp4(ffmpeg, &path).unwrap_or(path);
                        shared.update(|s| {
                            s.finishing = false;
                            s.last_recording = Some(done.to_string_lossy().into_owned());
                        });
                    }
                    None => shared.update(|s| {
                        s.last_recording = Some(path.to_string_lossy().into_owned());
                    }),
                }
            }
            Finish::Stream(mut child) => {
                // Stdin is closed: give FFmpeg a moment to finish, then make sure it's gone.
                let deadline = Instant::now() + Duration::from_secs(5);
                loop {
                    match child.try_wait() {
                        Ok(Some(_)) => break,
                        Ok(None) if Instant::now() < deadline => {
                            thread::sleep(Duration::from_millis(50))
                        }
                        _ => {
                            let _ = child.kill();
                            let _ = child.wait();
                            break;
                        }
                    }
                }
            }
        }
    }
}

/// Turn a finished recording into an .mp4 without re-encoding. Returns the new file.
fn to_mp4(ffmpeg: &Path, path: &Path) -> Option<PathBuf> {
    let out = path.with_extension("mp4");
    let out = if out.exists() {
        unique_path(path.parent()?, &path.file_stem()?.to_string_lossy(), "mp4")
    } else {
        out
    };
    let ok = Command::new(ffmpeg)
        .args(["-hide_banner", "-loglevel", "error", "-y", "-i"])
        .arg(path)
        .args(["-map", "0", "-c", "copy", "-movflags", "+faststart"])
        .arg(&out)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .is_ok_and(|s| s.success());
    if ok && fs::metadata(&out).is_ok_and(|m| m.len() > 0) {
        let _ = fs::remove_file(path);
        Some(out)
    } else {
        let _ = fs::remove_file(&out);
        None
    }
}

/// FFmpeg's arguments for streaming what arrives on stdin to every target.
/// Where a stream session sends to: the wide stream goes to every enabled
/// destination except the vertical ones (unless the whole picture is
/// vertical), the vertical stream to the vertical ones.
fn destinations_for(settings: &CaptureSettings, kind: Kind) -> Vec<&Destination> {
    let all_vertical = settings.quality == Quality::Vertical;
    settings
        .destinations
        .iter()
        .filter(|d| d.enabled && !d.url.trim().is_empty())
        .filter(|d| match kind {
            Kind::Vertical => d.vertical && !all_vertical,
            _ => !d.vertical || all_vertical,
        })
        .collect()
}

fn stream_args(mime: &str, video_kbps: u32, audio_kbps: u32, targets: &[String]) -> Vec<String> {
    let h264 = mime.contains("avc1") || mime.contains("h264");
    let mut a: Vec<String> = [
        "-hide_banner",
        "-loglevel",
        "error",
        "-fflags",
        "+genpts",
        // The encoder says what the stream holds, so start sending after a second.
        "-analyzeduration",
        "1000000",
        "-i",
        "pipe:0",
        "-map",
        "0:v:0",
        "-map",
        "0:a:0?",
    ]
    .iter()
    .map(|s| (*s).to_owned())
    .collect();
    if h264 {
        // Already H.264 from the WebView's encoder: sent as it is.
        a.extend(["-c:v", "copy"].map(str::to_owned));
    } else {
        let k = video_kbps;
        a.extend([
            "-c:v".to_owned(),
            "libx264".to_owned(),
            "-preset".to_owned(),
            "veryfast".to_owned(),
            "-tune".to_owned(),
            "zerolatency".to_owned(),
            "-pix_fmt".to_owned(),
            "yuv420p".to_owned(),
            "-b:v".to_owned(),
            format!("{k}k"),
            "-maxrate".to_owned(),
            format!("{k}k"),
            "-bufsize".to_owned(),
            format!("{}k", k * 2),
            "-g".to_owned(),
            "60".to_owned(),
            "-flags:v".to_owned(),
            "+global_header".to_owned(),
        ]);
    }
    a.extend([
        "-c:a".to_owned(),
        "aac".to_owned(),
        "-b:a".to_owned(),
        format!("{audio_kbps}k"),
    ]);
    a.extend(
        [
            "-ar",
            "48000",
            "-ac",
            "2",
            "-flags:a",
            "+global_header",
            "-progress",
            "pipe:1",
            "-stats_period",
            "1",
            "-f",
            "tee",
        ]
        .map(str::to_owned),
    );
    // One failing destination never stops the others.
    let tee = targets
        .iter()
        .map(|t| format!("[f=flv:onfail=ignore]{}", tee_escape(t)))
        .collect::<Vec<_>>()
        .join("|");
    a.push(tee);
    a
}

/// Characters the tee muxer treats specially.
fn tee_escape(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for c in s.chars() {
        if matches!(c, '|' | '[' | ']' | '\\') {
            out.push('\\');
        }
        out.push(c);
    }
    out
}

/// FFmpeg's progress report: keep the speed up to date.
fn read_progress(out: impl Read, shared: &Shared, session: u64) {
    for line in BufReader::new(out).lines().map_while(Result::ok) {
        if let Some(v) = line.strip_prefix("speed=") {
            let speed = v.trim().trim_end_matches('x').parse::<f32>().ok();
            shared.update(|s| {
                if let Some(r) = s.streaming.as_mut().filter(|r| r.session == session) {
                    r.speed = speed;
                }
            });
        }
    }
}

fn explain_stream_error(ffmpeg_said: &str) -> String {
    let lower = ffmpeg_said.to_lowercase();
    let what = if lower.contains("connection refused")
        || lower.contains("network is unreachable")
        || lower.contains("name or service not known")
        || lower.contains("failed to resolve")
        || lower.contains("timed out")
    {
        "Lumora can't reach the streaming server. Check the internet connection and the server address."
    } else if ["401", "403", "unauthorized", "forbidden"]
        .iter()
        .any(|w| lower.contains(w))
    {
        "The streaming server refused the stream. Check the stream key."
    } else if ["broken pipe", "end of file", "connection reset"]
        .iter()
        .any(|w| lower.contains(w))
    {
        "The connection to the streaming server dropped."
    } else {
        "The stream stopped."
    };
    // The line that says what went wrong, without FFmpeg's "[tcp @ 0x…]" prefix.
    let detail = ffmpeg_said
        .lines()
        .map(|l| l.split_once("] ").map_or(l, |(_, rest)| rest).trim())
        .find(|l| {
            let l = l.to_lowercase();
            l.contains("fail") || l.contains("error") || l.contains("refused")
        })
        .or_else(|| ffmpeg_said.lines().last())
        .unwrap_or("")
        .trim();
    if detail.is_empty() {
        what.to_owned()
    } else {
        format!("{what} ({detail})")
    }
}

/// A file name without characters Windows refuses.
fn file_name(name: &str) -> String {
    let cleaned: String = name
        .chars()
        .map(|c| {
            if "\\/:*?\"<>|".contains(c) || c.is_control() {
                '-'
            } else {
                c
            }
        })
        .collect();
    let cleaned = cleaned
        .trim()
        .trim_matches('.')
        .chars()
        .take(100)
        .collect::<String>();
    if cleaned.is_empty() {
        "Lumora recording".to_owned()
    } else {
        cleaned
    }
}

/// `folder/name.ext`, or `name (2).ext` etc. if that exists.
fn unique_path(folder: &Path, name: &str, ext: &str) -> PathBuf {
    let first = folder.join(format!("{name}.{ext}"));
    if !first.exists() {
        return first;
    }
    (2..)
        .map(|n| folder.join(format!("{name} ({n}).{ext}")))
        .find(|p| !p.exists())
        .unwrap_or(first)
}

/// FFmpeg next to Lumora, or on the computer.
pub fn find_ffmpeg() -> Option<PathBuf> {
    let exe = if cfg!(windows) {
        "ffmpeg.exe"
    } else {
        "ffmpeg"
    };
    let beside = std::env::current_exe()
        .ok()
        .and_then(|p| p.parent().map(|d| d.join(exe)))
        .filter(|p| p.is_file());
    beside.or_else(|| {
        let ok = Command::new(exe)
            .arg("-version")
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()
            .is_ok_and(|s| s.success());
        ok.then(|| PathBuf::from(exe))
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(name: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("lumora-capture-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&d);
        fs::create_dir_all(&d).unwrap();
        d
    }

    fn capture(dir: &Path, ffmpeg: Option<PathBuf>) -> (Capture, Arc<Mutex<Vec<CaptureStatus>>>) {
        let seen = Arc::new(Mutex::new(Vec::new()));
        let s2 = Arc::clone(&seen);
        let c = Capture::new(None, dir.to_path_buf(), ffmpeg, move |s| {
            lock(&s2).push(s.clone())
        });
        (c, seen)
    }

    fn wait_for(what: impl Fn() -> bool) -> bool {
        for _ in 0..200 {
            if what() {
                return true;
            }
            thread::sleep(Duration::from_millis(50));
        }
        false
    }

    /// A short real video (H.264 + Opus in Matroska, like the WebView makes).
    fn sample(ffmpeg: &Path, dir: &Path) -> Option<Vec<u8>> {
        let out = dir.join("sample.mkv");
        let ok = Command::new(ffmpeg)
            .args([
                "-hide_banner",
                "-loglevel",
                "error",
                "-y",
                "-f",
                "lavfi",
                "-i",
                "testsrc=size=320x180:rate=30:duration=2",
                "-f",
                "lavfi",
                "-i",
                "sine=duration=2:sample_rate=48000",
                "-c:v",
                "libx264",
                "-g",
                "30",
                "-c:a",
                "libopus",
            ])
            .arg(&out)
            .status()
            .is_ok_and(|s| s.success());
        ok.then(|| fs::read(&out).ok()).flatten()
    }

    #[test]
    fn names_are_safe_and_never_overwrite() {
        assert_eq!(file_name("Concert: 7/12 \"live\""), "Concert- 7-12 -live-");
        assert_eq!(file_name("  "), "Lumora recording");
        let d = temp_dir("names");
        let a = unique_path(&d, "Show", "mkv");
        fs::write(&a, b"x").unwrap();
        assert_eq!(unique_path(&d, "Show", "mkv"), d.join("Show (2).mkv"));
    }

    #[test]
    fn stream_keys_join_the_server_address() {
        let d = Destination {
            url: "rtmp://a.rtmp.youtube.com/live2/".into(),
            key: " abcd-1234 ".into(),
            ..Destination::default()
        };
        assert_eq!(d.target(), "rtmp://a.rtmp.youtube.com/live2/abcd-1234");
        let args = stream_args(
            "video/x-matroska;codecs=avc1,opus",
            6000,
            160,
            &["rtmp://x/a|b".into()],
        );
        assert!(args.windows(2).any(|w| w == ["-c:v", "copy"]));
        assert_eq!(args.last().unwrap(), "[f=flv:onfail=ignore]rtmp://x/a\\|b");
        let vp8 = stream_args(
            "video/webm;codecs=vp8,opus",
            4000,
            128,
            &["rtmp://x/y".into()],
        );
        assert!(vp8.contains(&"libx264".to_owned()) && vp8.contains(&"4000k".to_owned()));
        assert!(vp8.contains(&"128k".to_owned()));
    }

    #[test]
    fn a_recording_is_written_as_it_arrives() {
        let d = temp_dir("rec");
        let (c, _) = capture(&d, None);
        let r = c
            .start(Kind::Record, "video/webm;codecs=vp8,opus", "Concert")
            .unwrap();
        let path = PathBuf::from(r.path.clone().unwrap());
        assert_eq!(path, d.join("Concert.webm"));
        assert!(
            c.start(Kind::Record, "video/webm", "Again").is_err(),
            "one recording at a time"
        );
        c.chunk(r.session, b"hello ".to_vec()).unwrap();
        c.chunk(r.session, b"world".to_vec()).unwrap();
        assert!(
            wait_for(|| fs::read(&path).is_ok_and(|b| b == b"hello world")),
            "written before stopping"
        );
        c.stop(r.session);
        assert!(c.status().recording.is_none());
        assert!(wait_for(
            || c.status().last_recording.as_deref() == Some(path.to_str().unwrap())
        ));
        assert!(c.chunk(r.session, b"late".to_vec()).is_err());
    }

    #[test]
    fn streaming_needs_ffmpeg_and_a_destination() {
        let d = temp_dir("needs");
        let (c, _) = capture(&d, None);
        assert!(c
            .start(Kind::Stream, "video/webm", "")
            .unwrap_err()
            .contains("FFmpeg"));
        let (c, _) = capture(&d, Some(PathBuf::from("ffmpeg")));
        assert!(c
            .start(Kind::Stream, "video/webm", "")
            .unwrap_err()
            .contains("nowhere"));
    }

    #[test]
    fn a_finished_h264_recording_becomes_an_mp4() {
        let Some(ffmpeg) = find_ffmpeg() else {
            eprintln!("FFmpeg not installed: skipped");
            return;
        };
        let d = temp_dir("mp4");
        let Some(video) = sample(&ffmpeg, &d) else {
            return;
        };
        let (c, _) = capture(&d, Some(ffmpeg));
        let r = c
            .start(Kind::Record, "video/x-matroska;codecs=avc1,opus", "Show")
            .unwrap();
        for part in video.chunks(4096) {
            c.chunk(r.session, part.to_vec()).unwrap();
        }
        c.stop(r.session);
        assert!(wait_for(|| c
            .status()
            .last_recording
            .is_some_and(|p| p.ends_with("Show.mp4"))));
        assert!(
            !d.join("Show.mkv").exists(),
            "the .mkv is replaced by the .mp4"
        );
        assert!(fs::metadata(d.join("Show.mp4")).unwrap().len() > 1000);
    }

    #[test]
    fn a_stream_goes_to_every_destination() {
        let Some(ffmpeg) = find_ffmpeg() else {
            eprintln!("FFmpeg not installed: skipped");
            return;
        };
        let d = temp_dir("stream");
        let Some(video) = sample(&ffmpeg, &d) else {
            return;
        };
        let (c, seen) = capture(&d, Some(ffmpeg));
        // Files stand in for the streaming servers.
        let a = d.join("a.flv");
        let b = d.join("b.flv");
        c.set_settings(CaptureSettings {
            destinations: vec![
                Destination {
                    name: "A".into(),
                    url: a.to_string_lossy().into(),
                    ..Destination::default()
                },
                Destination {
                    name: "B".into(),
                    url: b.to_string_lossy().into(),
                    ..Destination::default()
                },
                Destination {
                    name: "Off".into(),
                    url: "rtmp://nowhere".into(),
                    enabled: false,
                    ..Destination::default()
                },
            ],
            ..CaptureSettings::default()
        });
        let r = c
            .start(Kind::Stream, "video/x-matroska;codecs=avc1,opus", "")
            .unwrap();
        assert_eq!(r.destinations, ["A", "B"]);
        for part in video.chunks(4096) {
            c.chunk(r.session, part.to_vec()).unwrap();
        }
        c.stop(r.session);
        assert!(wait_for(|| fs::metadata(&a).is_ok_and(|m| m.len() > 1000)
            && fs::metadata(&b).is_ok_and(|m| m.len() > 1000)));
        thread::sleep(Duration::from_millis(300));
        assert!(
            lock(&seen).iter().all(|s| s.failure.is_none()),
            "stopping is not a failure"
        );
    }

    #[test]
    fn the_vertical_version_goes_only_where_it_is_wanted() {
        let dest = |name: &str, vertical: bool| Destination {
            name: name.into(),
            url: format!("rtmp://{name}"),
            vertical,
            ..Destination::default()
        };
        let mut s = CaptureSettings {
            destinations: vec![dest("YouTube", false), dest("TikTok", true)],
            ..CaptureSettings::default()
        };
        let names = |s: &CaptureSettings, k| {
            destinations_for(s, k)
                .iter()
                .map(|d| d.name.clone())
                .collect::<Vec<_>>()
        };
        assert_eq!(names(&s, Kind::Stream), ["YouTube"]);
        assert_eq!(names(&s, Kind::Vertical), ["TikTok"]);
        // A picture that is all vertical sends everything in the one stream.
        s.quality = Quality::Vertical;
        assert_eq!(names(&s, Kind::Stream), ["YouTube", "TikTok"]);
        assert!(names(&s, Kind::Vertical).is_empty());
    }

    #[test]
    fn a_stream_that_cannot_connect_says_why() {
        let Some(ffmpeg) = find_ffmpeg() else {
            eprintln!("FFmpeg not installed: skipped");
            return;
        };
        let d = temp_dir("fail");
        let Some(video) = sample(&ffmpeg, &d) else {
            return;
        };
        let (c, _) = capture(&d, Some(ffmpeg));
        c.set_settings(CaptureSettings {
            destinations: vec![Destination {
                name: "Bad".into(),
                url: "rtmp://127.0.0.1:9/live".into(),
                ..Destination::default()
            }],
            ..CaptureSettings::default()
        });
        let r = c
            .start(Kind::Stream, "video/x-matroska;codecs=avc1,opus", "")
            .unwrap();
        for part in video.chunks(4096) {
            if c.chunk(r.session, part.to_vec()).is_err() {
                break;
            }
            thread::sleep(Duration::from_millis(5));
        }
        assert!(
            wait_for(|| c.status().failure.is_some()),
            "the failure is reported"
        );
        let f = c.status().failure.unwrap();
        assert_eq!(f.kind, Kind::Stream);
        assert!(c.status().streaming.is_none());
        eprintln!("failure message: {}", f.message);
    }
}
