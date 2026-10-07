//! Recording and streaming.
//!
//! The control window draws the Live Screen (with its sound) and encodes it
//! with the WebView's own video encoder (MediaRecorder: the graphics card
//! through Windows Media Foundation where it can, else the processor). Only
//! compressed video crosses from the WebView to here: a 4K picture at 40
//! Mbit/s is 5 MB a second, while raw 4K60 pictures would be 2 GB a second,
//! far more than a WebView can hand over. The encoded stream arrives in
//! chunks, one session per recording or stream:
//!
//! - **Recording**: chunks go straight into a file as they arrive, so a crash
//!   or power cut loses at most a second. When the recording stops, it is
//!   turned into an `.mp4` if FFmpeg is available (no re-encoding). With
//!   "Encode recordings" on, FFmpeg encodes it again at constant quality with
//!   the chosen encoder (see `encode.rs`) into an `.mkv` instead.
//! - **Streaming**: chunks are piped into FFmpeg, which sends them to every
//!   chosen destination (YouTube, Facebook, any RTMP server) at once. One
//!   destination failing never stops the others. Destinations with their own
//!   bitrate get their own FFmpeg (fed the same chunks), so one of those
//!   failing never stops the rest either. FFmpeg encodes again (NVENC, Quick
//!   Sync, AMF or x264) when the stream is smaller than the picture, has its
//!   own bitrate, or a hardware encoder is there for a steady bitrate.
//!
//! If a session fails (the network drops, the disk fills up, the graphics
//! card's encoder stops), the status says so and the control window starts a
//! new one; a hardware encoder that failed is replaced by the processor's.

use std::collections::{HashMap, HashSet};
use std::fs::{self, File};
use std::io::{BufRead, BufReader, Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::atomic::{AtomicBool, AtomicU64, AtomicUsize, Ordering};
use std::sync::mpsc::{self, Sender};
use std::sync::{Arc, Mutex, MutexGuard, PoisonError};
use std::thread;
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};

use crate::encode::{self, Codec, EncoderChoice, Family, Preset, Rate, StreamNeed, VideoEncode};
use crate::store::write_file_atomic;

const FILE: &str = "capture.json";
/// More than this waiting to be written means the disk or network can't keep up.
const MAX_QUEUED: u64 = 64 * 1024 * 1024;
/// FFmpeg reports its progress every second; this long without a report means
/// it is stuck (the network went silent): it is ended so the stream can reconnect.
const STALL: Duration = Duration::from_secs(20);
/// After stop, how long FFmpeg gets to take the last chunks before it is ended.
const STOP_GRACE: Duration = Duration::from_secs(10);
/// The same for a recording FFmpeg encodes (it may be a few seconds behind).
const ENCODE_GRACE: Duration = Duration::from_secs(30);
/// How many recent failures the status keeps (several can happen at once).
const FAILURES_KEPT: usize = 8;

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
    /// Where live captions are sent (YouTube: Studio → stream settings →
    /// closed captions → "Post captions to URL"). Viewers turn them on and off.
    pub captions_url: String,
    /// Its own video bitrate in kbit/s (`None`: the stream's).
    pub video_kbps: Option<u32>,
    /// A second server for the same stream (YouTube's backup ingest, a
    /// second SRT listener…). When the stream to one server fails, the next
    /// try goes to the other.
    pub backup_url: String,
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
            captions_url: String::new(),
            video_kbps: None,
            backup_url: String::new(),
        }
    }
}

impl Destination {
    /// The full address FFmpeg sends to.
    #[cfg(test)]
    fn target(&self) -> String {
        self.target_at(false)
    }

    /// The full address on the main server, or on the backup one (when it has one).
    fn target_at(&self, backup: bool) -> String {
        let url = if backup && self.has_backup() {
            &self.backup_url
        } else {
            &self.url
        };
        let url = url.trim().trim_end_matches('/');
        let key = self.key.trim();
        if key.is_empty() {
            url.to_owned()
        } else if url.starts_with("srt://") {
            // SRT has no path: the key is its stream id (unless the address has one).
            if url.contains("streamid=") {
                url.to_owned()
            } else {
                let join = if url.contains('?') { '&' } else { '?' };
                format!("{url}{join}streamid={key}")
            }
        } else {
            format!("{url}/{key}")
        }
    }

    fn has_backup(&self) -> bool {
        !self.backup_url.trim().is_empty()
    }
}

/// The muxer a stream address needs: MPEG-TS for SRT and UDP, FLV for RTMP and RTMPS.
fn container_for(target: &str) -> &'static str {
    let scheme = target.split_once("://").map_or("", |(s, _)| s);
    match scheme.to_ascii_lowercase().as_str() {
        "srt" | "udp" | "rtp" => "mpegts",
        _ => "flv",
    }
}

/// Which server each destination uses: the ids on their backup server now.
/// A destination that fails goes to its other server on the next try.
#[derive(Debug, Default)]
struct Failover(Mutex<HashSet<String>>);

impl Failover {
    fn on_backup(&self, id: &str) -> bool {
        lock(&self.0).contains(id)
    }

    /// These destinations failed: the ones with a backup switch servers.
    fn switch(&self, ids: &[(String, bool)]) {
        let mut on = lock(&self.0);
        for (id, has_backup) in ids {
            if !*has_backup {
                continue;
            }
            if !on.remove(id) {
                on.insert(id.clone());
            }
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
    #[serde(rename = "2160p60")]
    P2160x60,
    /// 1080 × 1920, for Shorts, Reels and TikTok.
    #[serde(rename = "vertical")]
    Vertical,
}

impl Quality {
    /// Width, height and frames a second (mirrors QUALITIES in app/src/broadcast/recorder.ts).
    #[must_use]
    pub fn size(self) -> (u32, u32, u32) {
        match self {
            Quality::P720 => (1280, 720, 30),
            Quality::P720x60 => (1280, 720, 60),
            Quality::P1080 => (1920, 1080, 30),
            Quality::P1080x60 => (1920, 1080, 60),
            Quality::P1440 => (2560, 1440, 30),
            Quality::P1440x60 => (2560, 1440, 60),
            Quality::P2160 => (3840, 2160, 30),
            Quality::P2160x60 => (3840, 2160, 60),
            Quality::Vertical => (1080, 1920, 30),
        }
    }

    /// The bitrate that suits it, kbit/s.
    #[must_use]
    pub fn kbps(self) -> u32 {
        match self {
            Quality::P720 => 3000,
            Quality::P720x60 => 4500,
            Quality::P1080 | Quality::Vertical => 6000,
            Quality::P1080x60 => 9000,
            Quality::P1440 => 12000,
            Quality::P1440x60 => 18000,
            Quality::P2160 => 25000,
            Quality::P2160x60 => 40000,
        }
    }
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
    /// Inputs (source ids) left out of the own-file recording.
    pub iso_skip: Vec<String>,
    /// Bitrate of each camera's own file, kbit/s.
    pub iso_kbps: u32,
    /// Save a chapter list (what was on air when) with each recording.
    pub chapters: bool,
    pub destinations: Vec<Destination>,
    /// Offer the Live Screen on the network as an NDI source.
    pub ndi: bool,
    /// The NDI source's name (shown as "COMPUTER (name)").
    pub ndi_name: String,
    /// Which encoder FFmpeg uses when it encodes.
    pub encoder: EncoderChoice,
    /// Speed against quality.
    pub preset: Preset,
    /// The stream's picture when it differs from the recording's (e.g. a 4K
    /// recording streamed at 1080p). `None`: the same.
    pub stream_quality: Option<Quality>,
    /// The stream's bitrate when it differs from the recording's, kbit/s.
    pub stream_kbps: Option<u32>,
    /// FFmpeg encodes recordings again with the encoder above, at constant
    /// quality (off: the WebView's encode is saved as it is, which is safest).
    pub record_encode: bool,
    /// The format of recordings FFmpeg encodes.
    pub record_codec: Codec,
}

impl Default for CaptureSettings {
    fn default() -> Self {
        CaptureSettings {
            folder: None,
            quality: Quality::P1080,
            video_kbps: 6000,
            audio_kbps: 160,
            record_mix: RecordMix::Stream,
            // Every camera and microphone in its own file, for editing.
            iso: true,
            iso_skip: Vec::new(),
            iso_kbps: 8000,
            chapters: true,
            destinations: Vec::new(),
            ndi: false,
            ndi_name: "Lumora".to_owned(),
            encoder: EncoderChoice::Auto,
            preset: Preset::Balanced,
            stream_quality: None,
            stream_kbps: None,
            record_encode: false,
            record_codec: Codec::H264,
        }
    }
}

impl CaptureSettings {
    fn cleaned(mut self) -> Self {
        self.video_kbps = self.video_kbps.clamp(500, 80_000);
        self.audio_kbps = self.audio_kbps.clamp(64, 320);
        self.iso_kbps = self.iso_kbps.clamp(1000, 50_000);
        self.stream_kbps = self.stream_kbps.map(|k| k.clamp(500, 80_000));
        // Only ever smaller than the picture (scaling up adds nothing), never vertical.
        let picture = self.quality;
        self.stream_quality = self.stream_quality.filter(|q| {
            *q != Quality::Vertical
                && picture != Quality::Vertical
                && *q != picture
                && q.size().1 <= picture.size().1
        });
        self.folder = self.folder.filter(|f| !f.trim().is_empty());
        self.ndi_name = self.ndi_name.trim().chars().take(60).collect();
        if self.ndi_name.is_empty() {
            "Lumora".clone_into(&mut self.ndi_name);
        }
        for (i, d) in self.destinations.iter_mut().enumerate() {
            if d.id.is_empty() {
                d.id = format!("dest-{}", i + 1);
            }
            d.name = d.name.trim().chars().take(40).collect();
            d.video_kbps = d
                .video_kbps
                .filter(|k| *k > 0)
                .map(|k| k.clamp(500, 80_000));
            d.backup_url = d.backup_url.trim().to_owned();
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
    /// The Live Screen offered on the network as an NDI source.
    Ndi,
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
    /// The video encoder doing the work, for the operator ("NVIDIA NVENC (h264_nvenc)").
    pub encoder: String,
    /// The bitrate the WebView should encode at, kbit/s (`None`: the settings').
    pub source_kbps: Option<u32>,
    /// Destinations that dropped out while the rest carry on.
    pub dropped: Vec<String>,
    /// Destinations sending to their backup server.
    pub on_backup: Vec<String>,
}

impl CaptureStatus {
    /// The running session `session`, whichever kind it is.
    pub fn running_session(&self, session: u64) -> Option<Running> {
        [&self.recording, &self.streaming, &self.vertical, &self.ndi]
            .into_iter()
            .flatten()
            .find(|r| r.session == session)
            .cloned()
    }
}

impl Running {
    fn new(session: u64, path: Option<String>, destinations: Vec<String>, encoder: String) -> Self {
        Running {
            session,
            started_at: now_ms(),
            path,
            destinations,
            bytes: 0,
            speed: None,
            encoder,
            source_kbps: None,
            dropped: Vec::new(),
            on_backup: Vec::new(),
        }
    }
}

/// What the WebView's own encoder is called (it is used as it is).
const WEBVIEW_ENCODER: &str = "The app’s own encoder (WebView2), saved as it is";

/// Why a recording or stream stopped by itself.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Failure {
    pub kind: Kind,
    pub session: u64,
    pub message: String,
    /// It never got going (the server was never reached): not worth retrying by itself.
    pub never_started: bool,
    /// The graphics card's encoder failed; the next start uses the processor
    /// (worth starting again straight away, even for a recording).
    pub fallback: bool,
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
    /// The NDI output, while it runs.
    pub ndi: Option<Running>,
    /// The last recording that finished, ready to use.
    pub last_recording: Option<String>,
    /// Still turning the last recording into an .mp4.
    pub finishing: bool,
    pub failure: Option<Failure>,
    /// The last few failures, oldest first (`failure` is the newest).
    pub failures: Vec<Failure>,
    /// Hardware encoders that worked in the start-up check (h264_nvenc, …).
    pub hw_encoders: Vec<String>,
    /// The start-up check of the hardware encoders has finished.
    pub hw_checked: bool,
    /// Hardware encoders that failed since Lumora started (not used again).
    pub hw_failed: Vec<Family>,
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
            Kind::Ndi => &mut s.ndi,
        }
    }

    /// A session stopped by itself.
    fn fail(&self, kind: Kind, session: u64, message: String) {
        self.fail_how(kind, session, message, false);
    }

    fn fail_how(&self, kind: Kind, session: u64, message: String, never_started: bool) {
        self.fail_with(kind, session, message, never_started, false);
    }

    fn fail_with(
        &self,
        kind: Kind,
        session: u64,
        message: String,
        never_started: bool,
        fallback: bool,
    ) {
        eprintln!("lumora: {kind:?} {session} stopped: {message}");
        self.update(|s| {
            let slot = Shared::slot(s, kind);
            if slot.as_ref().is_some_and(|r| r.session == session) {
                *slot = None;
                let f = Failure {
                    kind,
                    session,
                    message,
                    never_started,
                    fallback,
                };
                // Kept in a list too: the stream and its vertical version often
                // fail together, and each must be seen to be retried.
                s.failures.push(f.clone());
                let extra = s.failures.len().saturating_sub(FAILURES_KEPT);
                s.failures.drain(..extra);
                s.failure = Some(f);
            }
        });
    }

    /// A graphics card's encoder failed: say so, and never use it again this time.
    fn hw_failed(&self, family: Family) {
        self.update(|s| {
            if !s.hw_failed.contains(&family) {
                s.hw_failed.push(family);
            }
        });
    }

    /// Change the running session (if it is still this one).
    fn running(&self, kind: Kind, session: u64, f: impl FnOnce(&mut Running)) {
        self.update(|s| {
            if let Some(r) = Shared::slot(s, kind)
                .as_mut()
                .filter(|r| r.session == session)
            {
                f(r);
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
    /// The FFmpegs it feeds (ended if they are stuck after stop).
    pids: Vec<u32>,
    /// How long they get after stop.
    grace: Duration,
    /// Set once everything has finished.
    done: Arc<AtomicBool>,
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
    max_queued: u64,
    stall: Duration,
    failover: Arc<Failover>,
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
            max_queued: MAX_QUEUED,
            stall: STALL,
            failover: Arc::new(Failover::default()),
        }
    }

    pub fn status(&self) -> CaptureStatus {
        lock(&self.shared.status).clone()
    }

    /// The hardware encoders that work here (from the start-up check).
    pub fn set_hw_encoders(&self, working: Vec<String>) {
        eprintln!("lumora: hardware encoders {working:?}");
        self.shared.update(|s| {
            s.hw_encoders = working;
            s.hw_checked = true;
        });
    }

    /// The encoder FFmpeg would use now for this codec.
    fn family(&self, settings: &CaptureSettings, codec: Codec) -> Family {
        let s = lock(&self.shared.status);
        encode::pick(settings.encoder, codec, &s.hw_encoders, &s.hw_failed)
    }

    /// The encoder the unified engine's own feed uses now (as FFmpeg's would be chosen).
    pub fn engine_family(&self) -> Family {
        self.family(&self.settings(), Codec::H264)
    }

    /// The unified engine's feed found a graphics card's encoder failing:
    /// it is not chosen again this time (as when FFmpeg's here fails).
    pub fn engine_hw_failed(&self, family: Family) {
        self.shared.hw_failed(family);
    }

    /// The picture of this session is encoded by the unified engine (not
    /// the WebView): say so where the operator sees the encoder.
    pub fn engine_source(&self, kind: Kind, session: u64, label: &str) {
        self.shared.running(kind, session, |r| {
            r.encoder = r
                .encoder
                .replace("the app’s own encoder (WebView2)", label)
                .replace("The app’s own encoder (WebView2)", label);
        });
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
    #[cfg(test)]
    pub fn start(&self, kind: Kind, mime: &str, name: &str) -> Result<Running, String> {
        self.start_with(kind, mime, name, false)
    }

    /// Start a recording or stream; a rehearsed stream is made exactly as a
    /// real one (so the computer is tested) but sent nowhere.
    ///
    /// # Errors
    /// Why it could not start, in words for the operator.
    pub fn start_with(
        &self,
        kind: Kind,
        mime: &str,
        name: &str,
        rehearse: bool,
    ) -> Result<Running, String> {
        if Shared::slot(&mut lock(&self.shared.status), kind).is_some() {
            return Err(match kind {
                Kind::Record => "Already recording.".to_owned(),
                Kind::Stream => "Already streaming.".to_owned(),
                Kind::Vertical => "Already streaming the vertical version.".to_owned(),
                Kind::Ndi => "Already sending NDI.".to_owned(),
            });
        }
        let session = self.next.fetch_add(1, Ordering::SeqCst);
        let stopping = Arc::new(AtomicBool::new(false));
        let (out, running, finish): (Box<dyn Write + Send>, Running, Finish) = match kind {
            Kind::Record => self.open_recording(session, mime, name, &stopping)?,
            Kind::Stream | Kind::Vertical => {
                self.open_stream(kind, session, mime, &stopping, rehearse)?
            }
            Kind::Ndi => self.open_ndi(session, &stopping)?,
        };
        let (tx, rx) = mpsc::channel::<Vec<u8>>();
        let queued = Arc::new(AtomicU64::new(0));
        let pids = finish.pids();
        let grace = if matches!(finish, Finish::Encoded { .. }) {
            ENCODE_GRACE
        } else {
            STOP_GRACE
        };
        // Writing into a file: a failure is the disk's. Into FFmpeg: FFmpeg's
        // own reader says why it stopped.
        let report_write = matches!(finish, Finish::Recording(_));
        // Where FFmpeg encodes again, its progress reports say how much went out.
        let count = !matches!(finish, Finish::Encoded { .. } | Finish::Stream(_, false));
        let done = Arc::new(AtomicBool::new(false));
        {
            let shared = Arc::clone(&self.shared);
            let queued = Arc::clone(&queued);
            let ffmpeg = self.ffmpeg.clone();
            let mime = mime.to_owned();
            let done = Arc::clone(&done);
            thread::Builder::new()
                .name(format!("lumora-{kind:?}-{session}").to_lowercase())
                .spawn(move || {
                    write_loop(
                        &shared,
                        kind,
                        session,
                        out,
                        &rx,
                        &queued,
                        report_write,
                        count,
                    );
                    finish.run(&shared, ffmpeg.as_deref(), &mime, &done);
                    done.store(true, Ordering::SeqCst);
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
                pids,
                grace,
                done,
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
        if s.queued.fetch_add(len, Ordering::SeqCst) + len > self.max_queued {
            let kind = s.kind;
            drop(sessions);
            // Say why first: once stopped, the session is no longer there to fail.
            self.shared.fail(
                kind,
                session,
                match kind {
                    Kind::Record => "The disk can't keep up with the recording.".to_owned(),
                    Kind::Stream | Kind::Vertical => {
                        "The internet connection is too slow for the stream.".to_owned()
                    }
                    Kind::Ndi => "The computer can't keep up with the NDI output.".to_owned(),
                },
            );
            self.stop(session);
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
        // An FFmpeg stuck on a dead connection never takes the last chunks:
        // end it, so neither it nor the write loop is left behind.
        if !s.pids.is_empty() {
            let (pids, done, grace) = (s.pids, s.done, s.grace);
            thread::spawn(move || {
                let deadline = Instant::now() + grace;
                while Instant::now() < deadline && !done.load(Ordering::SeqCst) {
                    thread::sleep(Duration::from_millis(100));
                }
                if !done.load(Ordering::SeqCst) {
                    pids.into_iter().for_each(kill_pid);
                }
            });
        }
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
        stopping: &Arc<AtomicBool>,
    ) -> Result<(Box<dyn Write + Send>, Running, Finish), String> {
        let folder = self.folder();
        fs::create_dir_all(&folder).map_err(|e| {
            format!(
                "The recordings folder {} can't be used: {e}",
                folder.display()
            )
        })?;
        let settings = self.settings();
        if let (Some(ffmpeg), true) = (self.ffmpeg.as_ref(), settings.record_encode) {
            let e = plan_record(&settings, self.family(&settings, settings.record_codec));
            return self
                .open_encoded_recording(ffmpeg, session, name, &folder, &settings, e, stopping);
        }
        let ext = if mime.contains("matroska") {
            "mkv"
        } else {
            "webm"
        };
        let path = unique_path(&folder, &file_name(name), ext);
        let file = File::create(&path)
            .map_err(|e| format!("Can't create the recording file {}: {e}", path.display()))?;
        let running = Running::new(
            session,
            Some(path.to_string_lossy().into_owned()),
            Vec::new(),
            WEBVIEW_ENCODER.to_owned(),
        );
        Ok((Box::new(file), running, Finish::Recording(path)))
    }

    /// A recording FFmpeg encodes again at constant quality (into an .mkv,
    /// which stays playable whatever happens).
    #[allow(clippy::too_many_arguments)]
    fn open_encoded_recording(
        &self,
        ffmpeg: &Path,
        session: u64,
        name: &str,
        folder: &Path,
        settings: &CaptureSettings,
        e: VideoEncode,
        stopping: &Arc<AtomicBool>,
    ) -> Result<(Box<dyn Write + Send>, Running, Finish), String> {
        let path = unique_path(folder, &file_name(name), "mkv");
        let speed_to = Arc::clone(&self.shared);
        let end_to = Arc::clone(&self.shared);
        let family = e.family;
        let (child, stdin) = spawn_watched(
            ffmpeg,
            &record_args(&e, &path),
            self.stall,
            stopping,
            move |p: Progress| {
                speed_to.running(Kind::Record, session, |r| {
                    r.speed = p.speed;
                    // The file's own size (not what the WebView hands over).
                    r.bytes = p.bytes.unwrap_or(r.bytes);
                });
            },
            |_| {},
            move |_sent, said| {
                let detail = ffmpeg_detail(&said);
                if family.hardware() && encode::encoder_failed(&said) {
                    end_to.hw_failed(family);
                    end_to.fail_with(
                        Kind::Record,
                        session,
                        format!(
                            "The {} encoder stopped ({detail}). The recording so far is kept; \
                             Lumora goes on recording with the processor (x264) in a new file.",
                            family.label()
                        ),
                        false,
                        true,
                    );
                } else {
                    end_to.fail(
                        Kind::Record,
                        session,
                        format!("The recording encoder stopped ({detail}). The recording so far is kept."),
                    );
                }
            },
        )?;
        let mut running = Running::new(
            session,
            Some(path.to_string_lossy().into_owned()),
            Vec::new(),
            format!(
                "{} ({}), constant quality",
                family.label(),
                family.encoder(e.codec)
            ),
        );
        running.source_kbps = Some(encode::source_kbps(
            settings.video_kbps,
            settings.quality.kbps(),
        ));
        let hevc = family.encoder(e.codec).starts_with("hevc");
        Ok((
            Box::new(StdinWriter(stdin)),
            running,
            Finish::Encoded { child, path, hevc },
        ))
    }

    fn open_stream(
        &self,
        kind: Kind,
        session: u64,
        mime: &str,
        stopping: &Arc<AtomicBool>,
        rehearse: bool,
    ) -> Result<(Box<dyn Write + Send>, Running, Finish), String> {
        let ffmpeg = self.ffmpeg.as_ref().ok_or(
            "Streaming needs FFmpeg, which was not found on this computer. \
             Put ffmpeg.exe next to Lumora (or install FFmpeg) and start Lumora again.",
        )?;
        let settings = self.settings();
        let dests = destinations_for(&settings, kind);
        if rehearse {
            // Nothing leaves the computer.
        } else if dests.is_empty() && kind == Kind::Vertical {
            return Err("No destination gets the vertical version.".to_owned());
        } else if dests.is_empty() && !destinations_for(&settings, Kind::Vertical).is_empty() {
            return Err(
                "Every destination gets the vertical version. Add a wide one too, or set \
                 the picture to Vertical in Settings → Recording and streaming to stream \
                 only vertical."
                    .to_owned(),
            );
        } else if dests.is_empty() {
            return Err(
                "There is nowhere to stream to yet. Add YouTube, Facebook or another \
                        destination in Settings → Recording and streaming."
                    .to_owned(),
            );
        }
        if !rehearse {
            self.preflight_or_backup(&dests)?;
        }
        let targets: Vec<(String, String, Option<u32>)> = if rehearse {
            Vec::new()
        } else {
            dests
                .iter()
                .map(|d| {
                    let backup = self.failover.on_backup(&d.id);
                    (d.name.clone(), d.target_at(backup), d.video_kbps)
                })
                .collect()
        };
        // Each name's destination (id, has a backup), to switch servers when it fails.
        let ids: Arc<Vec<(String, String, bool)>> = Arc::new(
            dests
                .iter()
                .map(|d| (d.name.clone(), d.id.clone(), d.has_backup()))
                .collect(),
        );
        let ids_of = |names: &[String]| -> Vec<(String, bool)> {
            ids.iter()
                .filter(|(n, _, _)| names.contains(n))
                .map(|(_, id, b)| (id.clone(), *b))
                .collect()
        };
        let family = self.family(&settings, Codec::H264);
        let plan = plan_stream(&settings, kind, mime, family, &targets);
        let n = plan.groups.len();
        let remaining = Arc::new(AtomicUsize::new(n));
        let any_sent = Arc::new(AtomicBool::new(false));
        let reports = Arc::new(Mutex::new(vec![Progress::default(); n]));
        // What goes out, kbit/s per FFmpeg (constant when encoded; the stream's own when sent as it is).
        let rates: Arc<Vec<u32>> = Arc::new(plan.groups.iter().map(|(g, _)| g.kbps).collect());
        // Bytes out are counted from the time sent at that bitrate when FFmpeg encodes
        // (what the WebView hands over is more than goes out then).
        let estimate = plan.groups.iter().any(|(_, e)| e.is_some());
        let pids = Arc::new(Mutex::new(Vec::<u32>::new()));
        let mut children = Vec::new();
        let mut inputs = Vec::new();
        for (i, (group, enc)) in plan.groups.iter().enumerate() {
            let args = stream_args(group, enc.as_ref(), settings.audio_kbps);
            let on_progress = {
                let (shared, reports, rates) = (
                    Arc::clone(&self.shared),
                    Arc::clone(&reports),
                    Arc::clone(&rates),
                );
                move |p: Progress| {
                    let (slowest, out) = {
                        let mut all = lock(&reports);
                        all[i] = p;
                        let slowest = all.iter().filter_map(|x| x.speed).reduce(f32::min);
                        let out: f64 = all
                            .iter()
                            .zip(rates.iter())
                            .map(|(x, k)| x.secs * f64::from(*k) * 125.0)
                            .sum();
                        (slowest, out)
                    };
                    shared.running(kind, session, |r| {
                        r.speed = slowest;
                        if estimate {
                            #[allow(clippy::cast_possible_truncation, clippy::cast_sign_loss)]
                            let bytes = out as u64;
                            r.bytes = bytes;
                        }
                    });
                }
            };
            let on_line = {
                let (shared, names) = (Arc::clone(&self.shared), group.names.clone());
                let (failover, ids) = (Arc::clone(&self.failover), Arc::clone(&ids));
                move |line: &str| {
                    if let Some(name) = encode::dropped_output(line).and_then(|k| names.get(k)) {
                        eprintln!("lumora: {kind:?} {session}: {name} dropped out");
                        let which: Vec<_> = ids
                            .iter()
                            .filter(|(n, _, _)| n == name)
                            .map(|(_, id, b)| (id.clone(), *b))
                            .collect();
                        failover.switch(&which);
                        let name = name.clone();
                        shared.running(kind, session, |r| {
                            if !r.dropped.contains(&name) {
                                r.dropped.push(name);
                            }
                        });
                    }
                }
            };
            let on_end = {
                let shared = Arc::clone(&self.shared);
                let (remaining, any_sent, pids) = (
                    Arc::clone(&remaining),
                    Arc::clone(&any_sent),
                    Arc::clone(&pids),
                );
                let names = group.names.clone();
                let failover = Arc::clone(&self.failover);
                let these = ids_of(&group.names);
                let hw = enc.is_some_and(|e| e.family.hardware());
                move |sent: bool, said: String| {
                    if sent {
                        any_sent.store(true, Ordering::SeqCst);
                    }
                    if hw && encode::encoder_failed(&said) {
                        // Everything starts again with the processor's encoder.
                        shared.hw_failed(family);
                        shared.fail_with(
                            kind,
                            session,
                            format!(
                                "The {} encoder stopped ({}). Lumora switched to the processor \
                                 (x264) and is starting the stream again.",
                                family.label(),
                                ffmpeg_detail(&said)
                            ),
                            false,
                            true,
                        );
                        lock(&pids).iter().copied().for_each(kill_pid);
                    } else if remaining.fetch_sub(1, Ordering::SeqCst) == 1 {
                        // The next try goes to the other server (where there is one).
                        failover.switch(&these);
                        shared.fail_how(
                            kind,
                            session,
                            explain_stream_error(&said),
                            !any_sent.load(Ordering::SeqCst),
                        );
                    } else {
                        // The other destinations carry on.
                        failover.switch(&these);
                        eprintln!("lumora: {kind:?} {session}: {names:?} stopped: {said}");
                        shared.running(kind, session, |r| {
                            for name in &names {
                                if !r.dropped.contains(name) {
                                    r.dropped.push(name.clone());
                                }
                            }
                        });
                    }
                }
            };
            match spawn_watched(
                ffmpeg,
                &args,
                self.stall,
                stopping,
                on_progress,
                on_line,
                on_end,
            ) {
                Ok((child, stdin)) => {
                    lock(&pids).push(child.id());
                    children.push(child);
                    inputs.push(Some(stdin));
                }
                Err(e) => {
                    stopping.store(true, Ordering::SeqCst);
                    for mut c in children {
                        let _ = c.kill();
                        let _ = c.wait();
                    }
                    return Err(e);
                }
            }
        }
        let mut running = Running::new(
            session,
            None,
            if rehearse {
                vec!["Rehearsal (nothing sent)".to_owned()]
            } else {
                dests.iter().map(|d| d.name.clone()).collect()
            },
            plan.label(),
        );
        running.source_kbps = Some(plan.source_kbps);
        if !rehearse {
            running.on_backup = dests
                .iter()
                .filter(|d| d.has_backup() && self.failover.on_backup(&d.id))
                .map(|d| d.name.clone())
                .collect();
        }
        Ok((
            Box::new(FanOut(inputs)),
            running,
            Finish::Stream(children, !estimate),
        ))
    }
}

impl Capture {
    /// The destinations as they are sent to now: each on its main server or its backup.
    fn on_servers(&self, dests: &[&Destination]) -> Vec<Destination> {
        dests
            .iter()
            .map(|d| {
                let mut d = (*d).clone();
                if d.has_backup() && self.failover.on_backup(&d.id) {
                    d.url.clone_from(&d.backup_url);
                }
                d
            })
            .collect()
    }

    /// The pre-flight check; when a server can't be reached and there is a
    /// backup server, the backups are tried before giving up.
    fn preflight_or_backup(&self, dests: &[&Destination]) -> Result<(), String> {
        let now = self.on_servers(dests);
        let Err(first) = preflight(&now.iter().collect::<Vec<_>>()) else {
            return Ok(());
        };
        let switch: Vec<(String, bool)> = dests
            .iter()
            .filter(|d| d.has_backup())
            .map(|d| (d.id.clone(), true))
            .collect();
        if switch.is_empty() {
            return Err(first);
        }
        self.failover.switch(&switch);
        let other = self.on_servers(dests);
        if preflight(&other.iter().collect::<Vec<_>>()).is_ok() {
            return Ok(());
        }
        // Neither answers: back as they were, and say why the first failed.
        self.failover.switch(&switch);
        Err(first)
    }

    fn open_ndi(
        &self,
        session: u64,
        stopping: &Arc<AtomicBool>,
    ) -> Result<(Box<dyn Write + Send>, Running, Finish), String> {
        crate::ndi::available()?;
        let ffmpeg = self
            .ffmpeg
            .as_ref()
            .ok_or("NDI output needs FFmpeg, which was not found on this computer.")?;
        let settings = self.settings();
        let (w, h, fps) = ndi_size(settings.quality);
        let sender = Arc::new(Mutex::new(crate::ndi::Sender::new(&settings.ndi_name)?));
        let mut video = quiet(ffmpeg)
            .args(ndi_video_args(w, h))
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .spawn()
            .map_err(|e| format!("FFmpeg could not start: {e}"))?;
        let video_in = video.stdin.take().ok_or("FFmpeg could not start")?;
        let mut video_out = video.stdout.take().ok_or("FFmpeg could not start")?;
        {
            let sender = Arc::clone(&sender);
            let shared = Arc::clone(&self.shared);
            let stopping = Arc::clone(stopping);
            thread::spawn(move || {
                let mut frame = vec![0u8; (w * h * 4) as usize];
                while video_out.read_exact(&mut frame).is_ok() {
                    lock(&sender).video(w, h, fps, &mut frame);
                }
                if !stopping.load(Ordering::SeqCst) {
                    shared.fail(Kind::Ndi, session, "The NDI output stopped.".to_owned());
                }
            });
        }
        let mut children = vec![video];
        // The sound, if there is any (a picture-only NDI source is fine).
        let mut audio_in = None;
        if let Ok(mut audio) = quiet(ffmpeg)
            .args(ndi_audio_args())
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .spawn()
        {
            audio_in = audio.stdin.take();
            if let Some(mut out) = audio.stdout.take() {
                let sender = Arc::clone(&sender);
                thread::spawn(move || {
                    // 20 ms pieces: 960 samples × 2 channels × 4 bytes.
                    let mut buf = vec![0u8; 960 * 2 * 4];
                    while out.read_exact(&mut buf).is_ok() {
                        let floats: Vec<f32> = buf
                            .as_chunks::<4>()
                            .0
                            .iter()
                            .map(|b| f32::from_le_bytes(*b))
                            .collect();
                        let mut planar = crate::ndi::deinterleave(&floats, 2);
                        lock(&sender).audio(48_000, 2, 960, &mut planar);
                    }
                });
            }
            children.push(audio);
        }
        let running = Running::new(
            session,
            None,
            vec![format!("NDI: {}", settings.ndi_name)],
            "Unpacked by FFmpeg (no encoding)".to_owned(),
        );
        let out = TeeWriter {
            video: video_in,
            audio: audio_in,
        };
        Ok((Box::new(out), running, Finish::Ndi(children)))
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
#[allow(clippy::too_many_arguments)]
fn write_loop(
    shared: &Shared,
    kind: Kind,
    session: u64,
    mut out: Box<dyn Write + Send>,
    rx: &mpsc::Receiver<Vec<u8>>,
    queued: &AtomicU64,
    report_write: bool,
    count: bool,
) {
    let mut last_report = Instant::now();
    let mut written = 0u64;
    while let Ok(chunk) = rx.recv() {
        queued.fetch_sub(chunk.len() as u64, Ordering::SeqCst);
        if let Err(e) = out.write_all(&chunk).and_then(|()| out.flush()) {
            // Into FFmpeg, its reader explains why; into a file, it's the disk.
            if report_write {
                shared.fail(
                    kind,
                    session,
                    format!("The recording could not be written ({e}). Is the disk full?"),
                );
            }
            return;
        }
        written += chunk.len() as u64;
        if count && last_report.elapsed() > Duration::from_secs(1) {
            last_report = Instant::now();
            shared.running(kind, session, |r| r.bytes = written);
        }
    }
}

/// What happens after the last chunk.
enum Finish {
    Recording(PathBuf),
    /// A recording FFmpeg encodes (it gets time to write the end of the file).
    Encoded {
        child: Child,
        path: PathBuf,
        hevc: bool,
    },
    /// The FFmpegs of a stream, one per bitrate (a failure is reported by
    /// their progress readers). `true`: what is handed over is what goes out
    /// (nothing encoded again), so the writer counts the bytes.
    Stream(Vec<Child>, bool),
    /// The FFmpegs that unpack the picture and sound for NDI.
    Ndi(Vec<Child>),
}

impl Finish {
    /// The FFmpegs being fed.
    fn pids(&self) -> Vec<u32> {
        match self {
            Finish::Recording(_) => Vec::new(),
            Finish::Encoded { child, .. } => vec![child.id()],
            Finish::Stream(children, _) | Finish::Ndi(children) => {
                children.iter().map(Child::id).collect()
            }
        }
    }

    /// `ended` is set once no FFmpeg is being fed any more (the .mp4 may still be made).
    fn run(self, shared: &Shared, ffmpeg: Option<&Path>, mime: &str, ended: &AtomicBool) {
        match self {
            Finish::Recording(path) => {
                let can_mp4 = mime.contains("avc1") || mime.contains("h264");
                finish_recording(shared, ffmpeg.filter(|_| can_mp4), path, false);
            }
            Finish::Encoded { child, path, hevc } => {
                finish_child(child, ENCODE_GRACE);
                ended.store(true, Ordering::SeqCst);
                // A hardware encoder that never started leaves nothing worth keeping.
                if fs::metadata(&path).map_or(0, |m| m.len()) < 1024 {
                    let _ = fs::remove_file(&path);
                    return;
                }
                finish_recording(shared, ffmpeg, path, hevc);
            }
            Finish::Stream(children, _) | Finish::Ndi(children) => {
                for c in children {
                    finish_child(c, Duration::from_secs(5));
                }
            }
        }
    }
}

/// Turn a finished recording into an .mp4 (when it can be) and say it is ready.
fn finish_recording(shared: &Shared, ffmpeg: Option<&Path>, path: PathBuf, hevc: bool) {
    match ffmpeg {
        Some(ffmpeg) => {
            shared.update(|s| s.finishing = true);
            let done = to_mp4(ffmpeg, &path, hevc).unwrap_or(path);
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

/// Stdin is closed: give FFmpeg a moment to finish, then make sure it's gone.
fn finish_child(mut child: Child, within: Duration) {
    let deadline = Instant::now() + within;
    loop {
        match child.try_wait() {
            Ok(Some(_)) => break,
            Ok(None) if Instant::now() < deadline => thread::sleep(Duration::from_millis(50)),
            _ => {
                let _ = child.kill();
                let _ = child.wait();
                break;
            }
        }
    }
}

/// Feeds every FFmpeg of a stream the same chunks; one that has stopped is
/// left out, and only when all have stopped does writing fail.
struct FanOut(Vec<Option<ChildStdin>>);

impl Write for FanOut {
    fn write(&mut self, buf: &[u8]) -> std::io::Result<usize> {
        for slot in &mut self.0 {
            if slot.as_mut().is_some_and(|w| w.write_all(buf).is_err()) {
                *slot = None;
            }
        }
        if self.0.iter().all(Option::is_none) {
            return Err(std::io::ErrorKind::BrokenPipe.into());
        }
        Ok(buf.len())
    }
    fn flush(&mut self) -> std::io::Result<()> {
        for slot in &mut self.0 {
            if slot.as_mut().is_some_and(|w| w.flush().is_err()) {
                *slot = None;
            }
        }
        Ok(())
    }
}

/// Start an FFmpeg that is fed on stdin and watched: its progress (`on_progress`),
/// each line it says (`on_line`), and, if it ends without being stopped,
/// whether it sent anything and its last words (`on_end`). An FFmpeg that
/// stops reporting progress (stuck on a dead connection) is ended.
fn spawn_watched(
    ffmpeg: &Path,
    args: &[String],
    stall: Duration,
    stopping: &Arc<AtomicBool>,
    on_progress: impl Fn(Progress) + Send + 'static,
    on_line: impl Fn(&str) + Send + 'static,
    on_end: impl FnOnce(bool, String) + Send + 'static,
) -> Result<(Child, ChildStdin), String> {
    let mut child = quiet(ffmpeg)
        .args(args)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("FFmpeg could not start: {e}"))?;
    let stdin = child.stdin.take().ok_or("FFmpeg could not start")?;
    let errors = Arc::new(Mutex::new(String::new()));
    let pid = child.id();
    if let Some(err) = child.stderr.take() {
        let errors = Arc::clone(&errors);
        thread::spawn(move || {
            for line in BufReader::new(err).lines().map_while(Result::ok) {
                // After a failed start FFmpeg can hang (busy, never exiting):
                // end it, so the failure is reported and nothing is left running.
                if gave_up(&line) {
                    thread::spawn(move || {
                        thread::sleep(Duration::from_secs(2));
                        kill_pid(pid);
                    });
                }
                on_line(&line);
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
        let stopping = Arc::clone(stopping);
        let heard = Arc::new(AtomicU64::new(now_ms()));
        let ended = Arc::new(AtomicBool::new(false));
        watch_for_stall(pid, stall, &heard, &ended, &stopping);
        thread::spawn(move || {
            let sent = read_progress(out, &heard, on_progress);
            ended.store(true, Ordering::SeqCst);
            // FFmpeg has ended. Unless the operator stopped it, say why.
            thread::sleep(Duration::from_millis(200));
            if !stopping.load(Ordering::SeqCst) {
                let said = lock(&errors).clone();
                on_end(sent, said);
            }
        });
    }
    Ok((child, stdin))
}

/// The NDI picture size and frame rate for a quality (at most 1080p: NDI's usual).
fn ndi_size(q: Quality) -> (u32, u32, u32) {
    match q {
        Quality::P720 => (1280, 720, 30),
        Quality::P720x60 => (1280, 720, 60),
        Quality::P1080x60 | Quality::P1440x60 | Quality::P2160x60 => (1920, 1080, 60),
        Quality::Vertical => (1080, 1920, 30),
        Quality::P1080 | Quality::P1440 | Quality::P2160 => (1920, 1080, 30),
    }
}

/// FFmpeg's arguments to unpack the encoded picture into raw BGRA frames.
fn ndi_video_args(w: u32, h: u32) -> Vec<String> {
    let mut a: Vec<String> = [
        "-hide_banner",
        "-loglevel",
        "error",
        "-fflags",
        "+genpts",
        "-analyzeduration",
        "1000000",
        "-i",
        "pipe:0",
        "-map",
        "0:v:0",
        "-pix_fmt",
        "bgra",
        "-f",
        "rawvideo",
    ]
    .iter()
    .map(|s| (*s).to_owned())
    .collect();
    a.splice(11..11, ["-vf".to_owned(), format!("scale={w}:{h}")]);
    a.push("pipe:1".to_owned());
    a
}

/// FFmpeg's arguments to unpack the sound into raw 48 kHz stereo floats.
fn ndi_audio_args() -> Vec<String> {
    [
        "-hide_banner",
        "-loglevel",
        "error",
        "-analyzeduration",
        "1000000",
        "-i",
        "pipe:0",
        "-map",
        "0:a:0",
        "-ac",
        "2",
        "-ar",
        "48000",
        "-f",
        "f32le",
        "pipe:1",
    ]
    .iter()
    .map(|s| (*s).to_owned())
    .collect()
}

/// Hands the encoded picture and sound to both unpacking FFmpegs (a sound
/// problem never stops the picture).
struct TeeWriter {
    video: ChildStdin,
    audio: Option<ChildStdin>,
}

impl Write for TeeWriter {
    fn write(&mut self, buf: &[u8]) -> std::io::Result<usize> {
        self.video.write_all(buf)?;
        if let Some(a) = self.audio.as_mut() {
            if a.write_all(buf).is_err() {
                self.audio = None;
            }
        }
        Ok(buf.len())
    }
    fn flush(&mut self) -> std::io::Result<()> {
        self.video.flush()
    }
}

/// Turn a finished recording into an .mp4 without re-encoding. Returns the new file.
fn to_mp4(ffmpeg: &Path, path: &Path, hevc: bool) -> Option<PathBuf> {
    let out = path.with_extension("mp4");
    let out = if out.exists() {
        unique_path(path.parent()?, &path.file_stem()?.to_string_lossy(), "mp4")
    } else {
        out
    };
    let ok = quiet(ffmpeg)
        .args(["-hide_banner", "-loglevel", "error", "-y", "-i"])
        .arg(path)
        .args(["-map", "0", "-c", "copy", "-movflags", "+faststart"])
        // HEVC tagged so Windows and Apple players open it too.
        .args(if hevc { &["-tag:v", "hvc1"][..] } else { &[] })
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

fn is_h264(mime: &str) -> bool {
    mime.contains("avc1") || mime.contains("h264")
}

/// How a stream session is made: one FFmpeg per bitrate.
#[derive(Debug, Clone, PartialEq)]
struct StreamPlan {
    family: Family,
    /// Each FFmpeg's destinations and its encode (`None`: sent as the WebView encoded it).
    groups: Vec<(encode::Group, Option<VideoEncode>)>,
    /// What the WebView encodes at, kbit/s.
    source_kbps: u32,
}

impl StreamPlan {
    /// The encoder in use, for the operator.
    fn label(&self) -> String {
        let encodes = self.groups.iter().filter(|(_, e)| e.is_some()).count();
        let mut parts = Vec::new();
        if encodes > 0 {
            let more = if encodes > 1 {
                format!(", {encodes} bitrates")
            } else {
                String::new()
            };
            parts.push(format!(
                "{} ({}){more}",
                self.family.label(),
                self.family.encoder(Codec::H264)
            ));
        }
        if encodes < self.groups.len() {
            parts.push("the app’s own encoder (WebView2), sent as it is".to_owned());
        }
        let text = parts.join(" + ");
        let mut chars = text.chars();
        chars
            .next()
            .map(|c| c.to_uppercase().chain(chars).collect())
            .unwrap_or_default()
    }
}

/// Plan a stream (`Kind::Stream` or `Kind::Vertical`) to these destinations
/// (name, address, own bitrate); none: a rehearsal.
fn plan_stream(
    settings: &CaptureSettings,
    kind: Kind,
    mime: &str,
    family: Family,
    targets: &[(String, String, Option<u32>)],
) -> StreamPlan {
    let picture = if kind == Kind::Vertical {
        Quality::Vertical
    } else {
        settings.quality
    };
    let (pw, ph, pfps) = picture.size();
    let out = match kind {
        Kind::Stream => settings.stream_quality.unwrap_or(picture),
        _ => picture,
    };
    let (ow, oh, ofps) = out.size();
    let fps = ofps.min(pfps);
    let smaller = (ow, oh) != (pw, ph);
    let mut base = settings.stream_kbps.unwrap_or(settings.video_kbps);
    if kind == Kind::Vertical {
        base = base.min(Quality::Vertical.kbps());
    }
    let groups = if targets.is_empty() {
        vec![encode::Group {
            kbps: base,
            names: Vec::new(),
            targets: Vec::new(),
        }]
    } else {
        encode::group_by_bitrate(targets, base)
    };
    let need = StreamNeed {
        input_h264: is_h264(mime),
        resized: smaller || fps != pfps,
        own_bitrate: false,
    };
    let groups: Vec<_> = groups
        .into_iter()
        .map(|g| {
            let need = StreamNeed {
                own_bitrate: g.kbps != base,
                ..need
            };
            let enc = encode::must_encode(need, family, settings.encoder).then_some(VideoEncode {
                family,
                codec: Codec::H264,
                rate: Rate::Cbr { kbps: g.kbps },
                preset: settings.preset,
                fps,
                size: smaller.then_some((ow, oh)),
            });
            (g, enc)
        })
        .collect();
    // Sent as it is somewhere: the WebView encodes at the stream's bitrate.
    // Otherwise well above it, so the second encode loses next to nothing.
    let source_kbps = if groups.iter().any(|(_, e)| e.is_none()) {
        base
    } else {
        let top = groups.iter().map(|(g, _)| g.kbps).max().unwrap_or(base);
        encode::source_kbps(top, picture.kbps())
    };
    StreamPlan {
        family,
        groups,
        source_kbps,
    }
}

/// The encode of a recording FFmpeg encodes again: constant quality, at
/// most the recording bitrate.
fn plan_record(settings: &CaptureSettings, family: Family) -> VideoEncode {
    VideoEncode {
        family,
        codec: settings.record_codec,
        rate: Rate::Quality {
            level: encode::quality_level(settings.preset),
            max_kbps: settings.video_kbps,
        },
        preset: settings.preset,
        fps: settings.quality.size().2,
        size: None,
    }
}

/// The start of every FFmpeg fed the WebView's encode on stdin.
fn input_args(decode: Vec<String>) -> Vec<String> {
    let mut a: Vec<String> = ["-hide_banner", "-loglevel", "error", "-fflags", "+genpts"]
        .map(str::to_owned)
        .to_vec();
    // The encoder says what the stream holds, so start after a second.
    a.extend(["-analyzeduration", "1000000"].map(str::to_owned));
    a.extend(decode);
    a.extend(["-i", "pipe:0", "-map", "0:v:0", "-map", "0:a:0?"].map(str::to_owned));
    a
}

/// FFmpeg's progress report, every second, on stdout.
fn progress_args() -> [String; 4] {
    ["-progress", "pipe:1", "-stats_period", "1"].map(str::to_owned)
}

/// FFmpeg's arguments for a recording it encodes again (into Matroska, which
/// stays playable if anything stops; it becomes an .mp4 at the end).
fn record_args(e: &VideoEncode, path: &Path) -> Vec<String> {
    let mut a = input_args(encode::decode_args(e.family));
    a.extend(encode::video_args(e));
    a.extend(["-c:a", "copy"].map(str::to_owned));
    a.extend(progress_args());
    a.extend(["-f", "matroska", "-y"].map(str::to_owned));
    a.push(path.to_string_lossy().into_owned());
    a
}

/// FFmpeg's arguments for streaming what arrives on stdin to one bitrate
/// group of destinations (`video`: its encode; `None`: sent as it is).
fn stream_args(group: &encode::Group, video: Option<&VideoEncode>, audio_kbps: u32) -> Vec<String> {
    let mut a = input_args(
        video
            .map(|e| encode::decode_args(e.family))
            .unwrap_or_default(),
    );
    match video {
        Some(e) => a.extend(encode::video_args(e)),
        // Already H.264 from the WebView's encoder: sent as it is.
        None => a.extend(["-c:v", "copy"].map(str::to_owned)),
    }
    a.extend([
        "-c:a".to_owned(),
        "aac".to_owned(),
        "-b:a".to_owned(),
        format!("{audio_kbps}k"),
    ]);
    a.extend(["-ar", "48000", "-ac", "2", "-flags:a", "+global_header"].map(str::to_owned));
    a.extend(progress_args());
    if group.targets.is_empty() {
        // A rehearsal: made in full, sent nowhere.
        a.extend(["-f", "null", "-"].map(str::to_owned));
        return a;
    }
    a.extend(["-f", "tee"].map(str::to_owned));
    // One failing destination never stops the others.
    let tee = group
        .targets
        .iter()
        .map(|t| format!("[f={}:onfail=ignore]{}", container_for(t), tee_escape(t)))
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

/// End FFmpeg when it stops reporting progress (stuck on a connection that
/// went silent), so the failure is reported and the stream can reconnect.
fn watch_for_stall(
    pid: u32,
    stall: Duration,
    heard: &Arc<AtomicU64>,
    ended: &Arc<AtomicBool>,
    stopping: &Arc<AtomicBool>,
) {
    let (heard, ended, stopping) = (Arc::clone(heard), Arc::clone(ended), Arc::clone(stopping));
    let limit = u64::try_from(stall.as_millis()).unwrap_or(u64::MAX);
    thread::spawn(move || loop {
        thread::sleep(Duration::from_millis(250).min(stall));
        if ended.load(Ordering::SeqCst) || stopping.load(Ordering::SeqCst) {
            return;
        }
        if now_ms().saturating_sub(heard.load(Ordering::SeqCst)) > limit {
            eprintln!("lumora: FFmpeg {pid} stopped reporting progress: ending it");
            kill_pid(pid);
            return;
        }
    });
}

/// One of FFmpeg's progress reports (every second).
#[derive(Debug, Clone, Copy, Default, PartialEq)]
struct Progress {
    /// How fast it keeps up (1.0 = real time).
    speed: Option<f32>,
    /// Seconds of picture and sound out so far.
    secs: f64,
    /// Bytes in the output file (not known for a stream: the tee muxer has no file).
    bytes: Option<u64>,
}

/// FFmpeg's progress reports, handed on as each one ends. Says whether
/// anything went out (a stream's tee muxer reports no size, so the time out counts).
fn read_progress(out: impl Read, heard: &AtomicU64, on_progress: impl Fn(Progress)) -> bool {
    let mut sent = false;
    let mut p = Progress::default();
    for line in BufReader::new(out).lines().map_while(Result::ok) {
        heard.store(now_ms(), Ordering::SeqCst);
        let (key, value) = line.split_once('=').unwrap_or((&line, ""));
        let value = value.trim();
        match key {
            "total_size" => {
                p.bytes = value.parse::<u64>().ok().filter(|n| *n > 0);
                sent |= p.bytes.is_some();
            }
            "out_time_us" => {
                if let Some(us) = value.parse::<i64>().ok().filter(|us| *us > 0) {
                    #[allow(clippy::cast_precision_loss)]
                    let secs = us as f64 / 1e6;
                    p.secs = secs;
                    sent = true;
                }
            }
            "speed" => p.speed = value.trim_end_matches('x').parse::<f32>().ok(),
            "progress" => on_progress(p),
            _ => {}
        }
    }
    sent
}

/// Where a stream address points: host and port (RTMP 1935, RTMPS 443).
fn host_port(url: &str) -> Option<(String, u16)> {
    let (scheme, rest) = url.split_once("://")?;
    let default = match scheme.to_ascii_lowercase().as_str() {
        "rtmp" => 1935,
        "rtmps" | "https" => 443,
        "http" => 80,
        "srt" | "udp" | "rtp" => return None,
        _ => return None,
    };
    let authority = rest.split('/').next()?.rsplit('@').next()?;
    if authority.is_empty() {
        return None;
    }
    match authority.rsplit_once(':') {
        Some((h, p)) if !h.contains(']') || h.ends_with(']') => {
            Some((h.trim_matches(['[', ']']).to_owned(), p.parse().ok()?))
        }
        _ => Some((authority.trim_matches(['[', ']']).to_owned(), default)),
    }
}

/// Before going live: every destination has a key and its server answers,
/// so a problem is said in seconds, not after a long wait.
fn preflight(dests: &[&Destination]) -> Result<(), String> {
    for d in dests {
        let url = d.url.trim().trim_end_matches('/');
        // YouTube, Facebook and most services need a stream key after the server address.
        let path = url
            .split_once("://")
            .map_or("", |(_, r)| r)
            .split_once('/')
            .map_or("", |(_, p)| p);
        if d.key.trim().is_empty()
            && path.matches('/').count() < 1
            && (url.contains("youtube")
                || url.contains("facebook")
                || url.contains("twitch")
                || url.contains("vimeo"))
        {
            return Err(format!(
                "{} has no stream key. Paste it in Settings → Recording and streaming.",
                d.name
            ));
        }
    }
    let checks: Vec<_> = dests
        .iter()
        .filter_map(|d| host_port(&d.url).map(|hp| (d.name.clone(), hp)))
        .map(|(name, (host, port))| {
            thread::spawn(move || {
                use std::net::{TcpStream, ToSocketAddrs};
                let addrs: Vec<_> = match (host.as_str(), port).to_socket_addrs() {
                    Ok(a) => a.collect(),
                    Err(_) => return Err(format!("{name}: the server address “{host}” could not be found (is the internet connected?)")),
                };
                for a in &addrs {
                    if TcpStream::connect_timeout(a, Duration::from_secs(4)).is_ok() {
                        return Ok(());
                    }
                }
                Err(format!("{name}: the server ({host}) did not answer. Check the internet connection, or a firewall that blocks streaming."))
            })
        })
        .collect();
    let problems: Vec<String> = checks
        .into_iter()
        .filter_map(|h| h.join().unwrap_or(Ok(())).err())
        .collect();
    // Going live only stops here when no destination can be reached.
    if !problems.is_empty()
        && problems.len() == dests.iter().filter(|d| host_port(&d.url).is_some()).count()
    {
        return Err(problems.join(" "));
    }
    Ok(())
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
    let detail = ffmpeg_detail(ffmpeg_said);
    if detail.is_empty() {
        what.to_owned()
    } else {
        format!("{what} ({detail})")
    }
}

/// The line that says what went wrong, without FFmpeg's "[tcp @ 0x…]" prefix.
fn ffmpeg_detail(ffmpeg_said: &str) -> &str {
    ffmpeg_said
        .lines()
        .map(|l| l.split_once("] ").map_or(l, |(_, rest)| rest).trim())
        .find(|l| {
            let l = l.to_lowercase();
            l.contains("fail") || l.contains("error") || l.contains("refused")
        })
        .or_else(|| ffmpeg_said.lines().last())
        .unwrap_or("")
        .trim()
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

/// A command that never flashes a console window on Windows (FFmpeg is a
/// console program; Lumora is not).
pub fn quiet(program: impl AsRef<std::ffi::OsStr>) -> Command {
    #[allow(unused_mut)]
    let mut cmd = Command::new(program);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000);
    }
    cmd
}

/// FFmpeg's words for "the stream can't go on".
fn gave_up(line: &str) -> bool {
    [
        "Could not write header",
        "All tee outputs failed",
        "Error opening output",
        "Conversion failed",
    ]
    .iter()
    .any(|w| line.contains(w))
}

/// End a process that has stopped answering (it may already be gone).
fn kill_pid(pid: u32) {
    #[cfg(windows)]
    let mut cmd = {
        let mut c = quiet("taskkill");
        c.args(["/PID", &pid.to_string(), "/T", "/F"]);
        c
    };
    #[cfg(not(windows))]
    let mut cmd = {
        let mut c = quiet("kill");
        c.args(["-9", &pid.to_string()]);
        c
    };
    let _ = cmd.stdout(Stdio::null()).stderr(Stdio::null()).status();
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
        let ok = quiet(exe)
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
        for _ in 0..600 {
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
        let ok = quiet(ffmpeg)
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
        let s = CaptureSettings::default();
        let args = &plan_args(&s, H264, Family::Software, &[t("A", "rtmp://x/a|b", None)])[0];
        assert!(has(args, ["-c:v", "copy"]));
        assert_eq!(args.last().unwrap(), "[f=flv:onfail=ignore]rtmp://x/a\\|b");
        let s = CaptureSettings {
            video_kbps: 4000,
            audio_kbps: 128,
            ..CaptureSettings::default()
        };
        let vp8 = &plan_args(
            &s,
            "video/webm;codecs=vp8,opus",
            Family::Software,
            &[t("A", "rtmp://x/y", None)],
        )[0];
        assert!(has(vp8, ["-c:v", "libx264"]) && has(vp8, ["-b:v", "4000k"]));
        assert!(has(vp8, ["-b:a", "128k"]));
    }

    const H264: &str = "video/x-matroska;codecs=avc1,opus";

    fn has(a: &[String], pair: [&str; 2]) -> bool {
        a.windows(2).any(|w| w[0] == pair[0] && w[1] == pair[1])
    }

    fn t(name: &str, url: &str, kbps: Option<u32>) -> (String, String, Option<u32>) {
        (name.to_owned(), url.to_owned(), kbps)
    }

    /// Each FFmpeg's arguments for a wide stream.
    fn plan_args(
        s: &CaptureSettings,
        mime: &str,
        family: Family,
        targets: &[(String, String, Option<u32>)],
    ) -> Vec<Vec<String>> {
        let s = s.clone().cleaned();
        plan_stream(&s, Kind::Stream, mime, family, targets)
            .groups
            .iter()
            .map(|(g, e)| stream_args(g, e.as_ref(), s.audio_kbps))
            .collect()
    }

    #[test]
    fn a_4k_recording_streams_at_1080p_from_the_same_picture() {
        let s = CaptureSettings {
            quality: Quality::P2160x60,
            video_kbps: 40_000,
            stream_quality: Some(Quality::P1080),
            stream_kbps: Some(6000),
            ..CaptureSettings::default()
        }
        .cleaned();
        let plan = plan_stream(
            &s,
            Kind::Stream,
            H264,
            Family::Nvenc,
            &[t("YouTube", "rtmp://y", None)],
        );
        let (g, e) = &plan.groups[0];
        let e = e.expect("scaled, so encoded");
        assert_eq!((g.kbps, e.size, e.fps), (6000, Some((1920, 1080)), 30));
        assert_eq!(e.rate, Rate::Cbr { kbps: 6000 });
        // The WebView sends well above the stream, so the second encode loses nothing.
        assert_eq!(plan.source_kbps, 60_000);
        let a = stream_args(g, Some(&e), 160);
        assert!(has(&a, ["-hwaccel", "auto"]), "decoded on the card: {a:?}");
        assert!(has(
            &a,
            ["-vf", "scale=1920:1080:flags=bicubic,format=nv12"]
        ));
        assert!(has(&a, ["-c:v", "h264_nvenc"]) && has(&a, ["-g", "60"]) && has(&a, ["-r", "30"]));
        assert!(
            plan.label().starts_with("NVIDIA NVENC (h264_nvenc)"),
            "{}",
            plan.label()
        );
        // A stream never bigger than the picture, nor vertical.
        let odd = CaptureSettings {
            quality: Quality::P1080,
            stream_quality: Some(Quality::P2160),
            ..CaptureSettings::default()
        }
        .cleaned();
        assert_eq!(odd.stream_quality, None);
    }

    #[test]
    fn the_webview_encode_goes_out_as_it_is_unless_ffmpeg_is_needed() {
        let s = CaptureSettings::default();
        let plan = plan_stream(
            &s,
            Kind::Stream,
            H264,
            Family::Software,
            &[t("A", "rtmp://a", None)],
        );
        assert!(
            plan.groups[0].1.is_none(),
            "no card, nothing to change: no encode"
        );
        assert_eq!(plan.source_kbps, 6000);
        assert!(
            plan.label().starts_with("The app’s own encoder"),
            "{}",
            plan.label()
        );
        // A graphics card: a steady bitrate and keyframes, from a richer source.
        let plan = plan_stream(
            &s,
            Kind::Stream,
            H264,
            Family::Qsv,
            &[t("A", "rtmp://a", None)],
        );
        assert_eq!(plan.groups[0].1.map(|e| e.family), Some(Family::Qsv));
        assert_eq!(plan.source_kbps, 12_000);
        // Software chosen on purpose: x264 does it.
        let sw = CaptureSettings {
            encoder: EncoderChoice::Software,
            ..CaptureSettings::default()
        };
        let plan = plan_stream(
            &sw,
            Kind::Stream,
            H264,
            Family::Software,
            &[t("A", "rtmp://a", None)],
        );
        assert_eq!(plan.groups[0].1.map(|e| e.family), Some(Family::Software));
    }

    #[test]
    fn each_bitrate_gets_its_own_ffmpeg() {
        let s = CaptureSettings {
            video_kbps: 6000,
            ..CaptureSettings::default()
        };
        let targets = [
            t("YouTube", "rtmp://y", None),
            t("Facebook", "rtmps://f", Some(4000)),
            t("Vimeo", "rtmps://v", None),
        ];
        let plan = plan_stream(&s, Kind::Stream, H264, Family::Software, &targets);
        assert_eq!(plan.groups.len(), 2);
        let (wide, own) = (&plan.groups[0], &plan.groups[1]);
        assert_eq!(wide.0.names, ["YouTube", "Vimeo"]);
        assert!(
            wide.1.is_none(),
            "the stream's own bitrate goes out as it is"
        );
        assert_eq!(own.0.names, ["Facebook"]);
        assert_eq!(own.1.map(|e| e.rate), Some(Rate::Cbr { kbps: 4000 }));
        // Something goes out as it is, so the WebView encodes at the stream's bitrate.
        assert_eq!(plan.source_kbps, 6000);
        let a = stream_args(&wide.0, None, 160);
        assert_eq!(
            a.last().unwrap(),
            "[f=flv:onfail=ignore]rtmp://y|[f=flv:onfail=ignore]rtmps://v"
        );
        assert!(
            plan.label().contains("+ the app’s own encoder"),
            "{}",
            plan.label()
        );
    }

    #[test]
    fn srt_goes_out_as_mpeg_ts_and_rtmps_as_flv() {
        let s = CaptureSettings::default();
        let args = &plan_args(
            &s,
            H264,
            Family::Software,
            &[
                t("SRT", "srt://ingest.example:9000?streamid=abc", None),
                t("FB", "rtmps://live-api-s.facebook.com:443/rtmp/KEY", None),
            ],
        )[0];
        assert_eq!(
            args.last().unwrap(),
            "[f=mpegts:onfail=ignore]srt://ingest.example:9000?streamid=abc|\
             [f=flv:onfail=ignore]rtmps://live-api-s.facebook.com:443/rtmp/KEY"
        );
        // An SRT address carries its key as the stream id.
        let d = Destination {
            url: "srt://host:9000?streamid=x".into(),
            key: "ignored".into(),
            ..Destination::default()
        };
        assert_eq!(d.target(), "srt://host:9000?streamid=x");
        let d = Destination {
            url: "srt://host:9000?latency=2000000".into(),
            key: "KEY".into(),
            ..Destination::default()
        };
        assert_eq!(d.target(), "srt://host:9000?latency=2000000&streamid=KEY");
    }

    #[test]
    fn a_main_server_that_does_not_answer_is_tried_on_its_backup() {
        let closed = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let dead = closed.local_addr().unwrap().port();
        drop(closed);
        let alive = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let port = alive.local_addr().unwrap().port();
        let d = Destination {
            id: "x".into(),
            name: "Ingest".into(),
            url: format!("rtmp://127.0.0.1:{dead}/live"),
            backup_url: format!("rtmp://127.0.0.1:{port}/live"),
            key: "k".into(),
            ..Destination::default()
        };
        let dir = temp_dir("preflight-backup");
        let (c, _) = capture(&dir, None);
        assert!(c.preflight_or_backup(&[&d]).is_ok());
        assert!(c.failover.on_backup("x"));
        // Neither answers: the error is the main server's, and nothing switched.
        drop(alive);
        let c2 = capture(&dir, None).0;
        let none = Destination {
            backup_url: format!("rtmp://127.0.0.1:{dead}/b"),
            ..d
        };
        assert!(c2.preflight_or_backup(&[&none]).is_err());
        assert!(!c2.failover.on_backup("x"));
    }

    #[test]
    fn a_failed_destination_switches_to_its_backup_and_back() {
        let d = Destination {
            id: "yt".into(),
            url: "rtmp://a.rtmp.youtube.com/live2".into(),
            backup_url: "rtmp://b.rtmp.youtube.com/live2?backup=1".into(),
            key: "KEY".into(),
            ..Destination::default()
        };
        assert_eq!(d.target_at(false), "rtmp://a.rtmp.youtube.com/live2/KEY");
        // YouTube's backup server takes the key after its options, as OBS sends it.
        assert_eq!(
            d.target_at(true),
            "rtmp://b.rtmp.youtube.com/live2?backup=1/KEY"
        );
        let none = Destination {
            id: "fb".into(),
            url: "rtmps://f/rtmp".into(),
            key: "K".into(),
            ..Destination::default()
        };
        assert_eq!(
            none.target_at(true),
            "rtmps://f/rtmp/K",
            "no backup: always the main server"
        );
        let f = Failover::default();
        assert!(!f.on_backup("yt"));
        f.switch(&[("yt".into(), true), ("fb".into(), false)]);
        assert!(f.on_backup("yt"));
        assert!(!f.on_backup("fb"), "nothing to switch to");
        f.switch(&[("yt".into(), true)]);
        assert!(
            !f.on_backup("yt"),
            "the backup failing goes back to the main server"
        );
    }

    #[test]
    fn a_recording_encoded_again_is_constant_quality() {
        let s = CaptureSettings {
            record_encode: true,
            record_codec: Codec::Hevc,
            preset: Preset::Quality,
            quality: Quality::P2160,
            video_kbps: 40_000,
            ..CaptureSettings::default()
        };
        let e = plan_record(&s, Family::Nvenc);
        let a = record_args(&e, Path::new("show.mkv"));
        assert!(has(&a, ["-c:v", "hevc_nvenc"]) && has(&a, ["-cq", "20"]));
        assert!(has(&a, ["-maxrate", "40000k"]) && has(&a, ["-g", "60"]));
        assert!(has(&a, ["-c:a", "copy"]) && has(&a, ["-f", "matroska"]));
        assert_eq!(a.last().unwrap(), "show.mkv");
        let x = record_args(&plan_record(&s, Family::Software), Path::new("x.mkv"));
        assert!(has(&x, ["-c:v", "libx264"]) && has(&x, ["-crf", "20"]));
        assert!(!x.contains(&"-hwaccel".to_owned()));
    }

    /// Every option given to an encoder is one this FFmpeg knows (for the
    /// encoders this FFmpeg has; the bundled Windows FFmpeg has them all).
    #[test]
    fn every_encoder_option_is_known_to_ffmpeg() {
        let Some(ffmpeg) = find_ffmpeg() else {
            eprintln!("FFmpeg not installed: skipped");
            return;
        };
        let generic = [
            "-vf",
            "-r",
            "-c:v",
            "-b:v",
            "-maxrate",
            "-bufsize",
            "-g",
            "-keyint_min",
            "-flags:v",
            "-profile:v",
            "-sc_threshold",
            "-global_quality",
            "-x264-params",
            "-crf",
            "-preset",
        ];
        let mut checked = 0;
        for family in [Family::Nvenc, Family::Qsv, Family::Amf, Family::Software] {
            let name = family.encoder(Codec::H264);
            let out = quiet(&ffmpeg)
                .args(["-hide_banner", "-h", &format!("encoder={name}")])
                .output()
                .unwrap();
            let help = String::from_utf8_lossy(&out.stdout).into_owned();
            if !help.contains("AVOptions") {
                eprintln!("{name}: not in this FFmpeg, skipped");
                continue;
            }
            for rate in [
                Rate::Cbr { kbps: 6000 },
                Rate::Quality {
                    level: 23,
                    max_kbps: 20_000,
                },
            ] {
                for preset in [Preset::Speed, Preset::Balanced, Preset::Quality] {
                    let a = encode::video_args(&VideoEncode {
                        family,
                        codec: Codec::H264,
                        rate,
                        preset,
                        fps: 30,
                        size: Some((1280, 720)),
                    });
                    for (i, opt) in a.iter().enumerate().filter(|(_, o)| o.starts_with('-')) {
                        if generic.contains(&opt.as_str()) && opt != "-preset" {
                            continue;
                        }
                        let line = help
                            .lines()
                            .find(|l| l.starts_with(&format!("  {opt} ")))
                            .unwrap_or_else(|| panic!("{name} has no option {opt}"));
                        // A named value must be one of its choices.
                        let v = &a[i + 1];
                        if v.chars().all(|c| c.is_ascii_lowercase()) && !line.contains("<string>") {
                            assert!(
                                help.contains(&format!("\n     {v} ")),
                                "{name} {opt} has no value {v}"
                            );
                        }
                    }
                    checked += 1;
                }
            }
        }
        assert!(checked > 0);
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

    /// Needs FFmpeg and the NDI runtime (NDI_LIB_PATH): `cargo test -- --ignored ndi`.
    #[test]
    #[ignore = "needs the NDI runtime"]
    fn the_live_screen_goes_out_over_ndi() {
        let Some(ffmpeg) = find_ffmpeg() else {
            return;
        };
        let d = temp_dir("ndi-out");
        let Some(video) = sample(&ffmpeg, &d) else {
            return;
        };
        let (c, _) = capture(&d, Some(ffmpeg));
        c.set_settings(CaptureSettings {
            ndi_name: "Lumora Out Test".into(),
            quality: Quality::P720,
            ..CaptureSettings::default()
        });
        let r = c
            .start(Kind::Ndi, "video/x-matroska;codecs=avc1,opus", "")
            .unwrap();
        assert_eq!(r.destinations, ["NDI: Lumora Out Test"]);
        let feed = {
            let video = video.clone();
            let session = r.session;
            let c = std::sync::Arc::new(c);
            let c2 = std::sync::Arc::clone(&c);
            (
                thread::spawn(move || {
                    for part in video.chunks(4096) {
                        if c2.chunk(session, part.to_vec()).is_err() {
                            break;
                        }
                        thread::sleep(Duration::from_millis(3));
                    }
                }),
                c,
            )
        };
        let names = crate::ndi::sources(3000, "127.0.0.1").unwrap();
        let name = names
            .iter()
            .find(|n| n.contains("Lumora Out Test"))
            .expect("found on the network")
            .clone();
        let mut recv = crate::ndi::Receiver::new(&name).unwrap();
        let mut size = None;
        for _ in 0..100 {
            if let crate::ndi::Received::Video { width, height, .. } = recv.capture(200) {
                size = Some((width, height));
                break;
            }
        }
        let _ = feed.0.join();
        feed.1.stop(r.session);
        assert_eq!(
            size,
            Some((1280, 720)),
            "the picture arrived at the NDI size"
        );
    }

    #[test]
    fn a_rehearsal_is_made_in_full_but_sent_nowhere() {
        let a = &plan_args(&CaptureSettings::default(), H264, Family::Software, &[])[0];
        assert!(a.ends_with(&["-f".to_owned(), "null".to_owned(), "-".to_owned()]));
        assert!(!a.iter().any(|x| x == "tee"));
        // Rehearsed with the real encoder, so the computer is tested.
        let a = &plan_args(&CaptureSettings::default(), H264, Family::Amf, &[])[0];
        assert!(has(a, ["-c:v", "h264_amf"]));
    }

    /// The bytes a file holds once it stops growing.
    fn settled(path: &Path) -> bool {
        fs::metadata(path).is_ok_and(|m| m.len() > 1000)
    }

    /// The picture size FFmpeg finds in a file.
    fn size_of(ffmpeg: &Path, path: &Path) -> String {
        let out = quiet(ffmpeg)
            .args(["-hide_banner", "-i"])
            .arg(path)
            .output()
            .unwrap();
        String::from_utf8_lossy(&out.stderr).into_owned()
    }

    #[test]
    fn each_bitrate_and_size_goes_out_through_its_own_ffmpeg() {
        let Some(ffmpeg) = find_ffmpeg() else {
            eprintln!("FFmpeg not installed: skipped");
            return;
        };
        let d = temp_dir("groups");
        let Some(video) = sample(&ffmpeg, &d) else {
            return;
        };
        let (c, _) = capture(&d, Some(ffmpeg.clone()));
        let (a, b) = (d.join("a.flv"), d.join("b.flv"));
        c.set_settings(CaptureSettings {
            quality: Quality::P1080,
            stream_quality: Some(Quality::P720),
            encoder: EncoderChoice::Software,
            destinations: vec![
                Destination {
                    name: "A".into(),
                    url: a.to_string_lossy().into(),
                    ..Destination::default()
                },
                Destination {
                    name: "B".into(),
                    url: b.to_string_lossy().into(),
                    video_kbps: Some(1500),
                    ..Destination::default()
                },
            ],
            ..CaptureSettings::default()
        });
        let r = c.start(Kind::Stream, H264, "").unwrap();
        assert!(
            r.encoder.contains("x264") && r.encoder.contains("2 bitrates"),
            "{}",
            r.encoder
        );
        for part in video.chunks(4096) {
            c.chunk(r.session, part.to_vec()).unwrap();
        }
        c.stop(r.session);
        assert!(wait_for(|| settled(&a) && settled(&b)));
        thread::sleep(Duration::from_millis(500));
        for f in [&a, &b] {
            assert!(
                size_of(&ffmpeg, f).contains("1280x720"),
                "scaled to the stream's size"
            );
        }
        assert!(c.status().failure.is_none());
    }

    #[test]
    fn one_destination_failing_never_stops_the_others() {
        let Some(ffmpeg) = find_ffmpeg() else {
            eprintln!("FFmpeg not installed: skipped");
            return;
        };
        let d = temp_dir("onfail");
        let Some(video) = sample(&ffmpeg, &d) else {
            return;
        };
        // Answers, then hangs up.
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        thread::spawn(move || {
            for s in listener.incoming().flatten() {
                drop(s);
            }
        });
        let good = d.join("good.flv");
        let (c, _) = capture(&d, Some(ffmpeg));
        let dest = |name: &str, url: String, kbps| Destination {
            name: name.into(),
            url,
            key: "k".into(),
            video_kbps: kbps,
            ..Destination::default()
        };
        // A bad destination beside a good one (same FFmpeg), and one with its own (failing) FFmpeg.
        c.set_settings(CaptureSettings {
            destinations: vec![
                Destination {
                    name: "Good".into(),
                    url: good.to_string_lossy().into(),
                    ..Destination::default()
                },
                dest("Bad", format!("rtmp://127.0.0.1:{port}/live"), None),
                dest("Own", format!("rtmp://127.0.0.1:{port}/own"), Some(2000)),
            ],
            ..CaptureSettings::default()
        });
        let r = c.start(Kind::Stream, H264, "").unwrap();
        for part in video.chunks(4096) {
            if c.chunk(r.session, part.to_vec()).is_err() {
                break;
            }
            thread::sleep(Duration::from_millis(5));
        }
        assert!(
            wait_for(|| c.status().streaming.is_some_and(|s| s.dropped.len() == 2)),
            "both bad ones are reported: {:?}",
            c.status().streaming
        );
        let st = c.status();
        assert!(
            st.failure.is_none(),
            "the stream carries on: {:?}",
            st.failure
        );
        let mut dropped = st.streaming.unwrap().dropped;
        dropped.sort();
        assert_eq!(dropped, ["Bad", "Own"]);
        c.stop(r.session);
        assert!(wait_for(|| settled(&good)));
    }

    /// A graphics-card encoder that can't start (this test computer has no
    /// NVIDIA card) is replaced by the processor's on the next start.
    #[test]
    fn a_failed_hardware_encoder_falls_back_to_the_processor() {
        let Some(ffmpeg) = find_ffmpeg() else {
            eprintln!("FFmpeg not installed: skipped");
            return;
        };
        let works = lumora_syscheck::working_hw_encoders(&ffmpeg);
        if works.iter().any(|e| e == "h264_nvenc") {
            eprintln!("NVENC works here: skipped");
            return;
        }
        let d = temp_dir("fallback");
        let Some(video) = sample(&ffmpeg, &d) else {
            return;
        };
        let (c, _) = capture(&d, Some(ffmpeg.clone()));
        // Pretend the start-up check found NVENC working.
        c.set_hw_encoders(vec!["h264_nvenc".into()]);
        let out = d.join("out.flv");
        c.set_settings(CaptureSettings {
            destinations: vec![Destination {
                name: "File".into(),
                url: out.to_string_lossy().into(),
                ..Destination::default()
            }],
            ..CaptureSettings::default()
        });
        let feed = |c: &Capture, session| {
            for part in video.chunks(4096) {
                if c.chunk(session, part.to_vec()).is_err() {
                    break;
                }
                thread::sleep(Duration::from_millis(2));
            }
        };
        let r = c.start(Kind::Stream, H264, "").unwrap();
        assert!(r.encoder.contains("NVENC"), "{}", r.encoder);
        feed(&c, r.session);
        assert!(wait_for(|| c.status().failure.is_some()));
        let st = c.status();
        let f = st.failure.unwrap();
        assert!(f.fallback && !f.never_started, "{f:?}");
        assert!(f.message.contains("NVIDIA NVENC"), "{}", f.message);
        assert_eq!(st.hw_failed, [Family::Nvenc]);
        // Started again: the processor, and it works.
        c.stop(r.session);
        let r = c.start(Kind::Stream, H264, "").unwrap();
        assert!(!r.encoder.contains("NVENC"), "{}", r.encoder);
        feed(&c, r.session);
        c.stop(r.session);
        assert!(wait_for(|| settled(&out)));

        // A recording the same way: the new file is made with the processor.
        let (c, _) = capture(&d, Some(ffmpeg.clone()));
        c.set_hw_encoders(vec!["h264_nvenc".into()]);
        c.set_settings(CaptureSettings {
            record_encode: true,
            ..CaptureSettings::default()
        });
        let r = c.start(Kind::Record, H264, "Encoded").unwrap();
        assert!(r.encoder.contains("NVENC"), "{}", r.encoder);
        feed(&c, r.session);
        assert!(wait_for(|| c.status().failure.is_some()));
        assert!(c.status().failure.unwrap().fallback);
        c.stop(r.session);
        let r = c.start(Kind::Record, H264, "Encoded").unwrap();
        assert!(r.encoder.contains("x264"), "{}", r.encoder);
        assert_eq!(r.source_kbps, Some(12_000));
        feed(&c, r.session);
        c.stop(r.session);
        assert!(wait_for(|| c
            .status()
            .last_recording
            .is_some_and(|p| p.ends_with(".mp4"))));
        let done = PathBuf::from(c.status().last_recording.unwrap());
        assert!(size_of(&ffmpeg, &done).contains("h264"));
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
        // Nothing listens there: said straight away, before FFmpeg starts.
        let d = temp_dir("fail");
        let (c, _) = capture(&d, Some(PathBuf::from("ffmpeg")));
        c.set_settings(CaptureSettings {
            destinations: vec![Destination {
                name: "Bad".into(),
                url: "rtmp://127.0.0.1:9/live".into(),
                ..Destination::default()
            }],
            ..CaptureSettings::default()
        });
        let started = Instant::now();
        let e = c
            .start(Kind::Stream, "video/x-matroska;codecs=avc1,opus", "")
            .unwrap_err();
        assert!(e.contains("did not answer"), "{e}");
        assert!(started.elapsed() < Duration::from_secs(6));
        // A known service without a key is caught too.
        c.set_settings(CaptureSettings {
            destinations: vec![Destination {
                name: "YouTube".into(),
                url: "rtmp://a.rtmp.youtube.com/live2".into(),
                ..Destination::default()
            }],
            ..CaptureSettings::default()
        });
        let e = c
            .start(Kind::Stream, "video/x-matroska;codecs=avc1,opus", "")
            .unwrap_err();
        assert!(e.contains("no stream key"), "{e}");
    }

    #[test]
    fn a_server_that_answers_but_refuses_the_stream_says_why() {
        let Some(ffmpeg) = find_ffmpeg() else {
            eprintln!("FFmpeg not installed: skipped");
            return;
        };
        let d = temp_dir("refuse");
        let Some(video) = sample(&ffmpeg, &d) else {
            return;
        };
        // Answers, then hangs up (like a server that doesn't take the stream).
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        thread::spawn(move || {
            for s in listener.incoming().flatten() {
                drop(s);
            }
        });
        let (c, _) = capture(&d, Some(ffmpeg));
        c.set_settings(CaptureSettings {
            destinations: vec![Destination {
                name: "Hangs up".into(),
                url: format!("rtmp://127.0.0.1:{port}/live"),
                key: "k".into(),
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
            "the failure is reported: {:?}",
            c.status()
        );
        let f = c.status().failure.unwrap();
        assert_eq!(f.kind, Kind::Stream);
        assert!(f.never_started, "nothing was ever sent");
        assert!(c.status().streaming.is_none());
        eprintln!("failure message: {}", f.message);
    }

    #[test]
    fn a_session_that_cannot_keep_up_says_why() {
        let d = temp_dir("slow");
        let (mut c, _) = capture(&d, None);
        c.max_queued = 4;
        let r = c.start(Kind::Record, "video/webm", "Slow").unwrap();
        assert!(c.chunk(r.session, b"too much at once".to_vec()).is_err());
        let st = c.status();
        assert!(st.recording.is_none());
        let f = st.failure.expect("the reason is kept, so it is retried");
        assert_eq!((f.kind, f.session), (Kind::Record, r.session));
        assert!(f.message.contains("can't keep up"), "{}", f.message);
        assert_eq!(st.failures.len(), 1);
    }

    #[test]
    fn failures_at_the_same_time_are_all_kept() {
        let d = temp_dir("both");
        let (mut c, _) = capture(&d, None);
        c.max_queued = 4;
        let a = c.start(Kind::Record, "video/webm", "A").unwrap();
        // Pretend a stream is running beside it, then both fail.
        c.shared.update(|s| s.streaming = Some(a.clone()));
        c.shared.fail(Kind::Stream, a.session, "dropped".into());
        let _ = c.chunk(a.session, b"too much at once".to_vec());
        let kinds: Vec<Kind> = c.status().failures.iter().map(|f| f.kind).collect();
        assert_eq!(kinds, [Kind::Stream, Kind::Record]);
        for i in 0..20 {
            c.shared.update(|s| {
                s.streaming = Some(Running {
                    session: 100 + i,
                    ..a.clone()
                })
            });
            c.shared.fail(Kind::Stream, 100 + i, "again".into());
        }
        assert_eq!(c.status().failures.len(), FAILURES_KEPT);
    }

    #[test]
    fn a_stream_stuck_on_a_silent_server_is_ended() {
        let Some(ffmpeg) = find_ffmpeg() else {
            eprintln!("FFmpeg not installed: skipped");
            return;
        };
        let d = temp_dir("silent");
        let Some(video) = sample(&ffmpeg, &d) else {
            return;
        };
        // Takes the connection, then never answers (a network that went quiet).
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        thread::spawn(move || {
            let mut held = Vec::new();
            for s in listener.incoming().flatten() {
                held.push(s);
            }
        });
        let (mut c, _) = capture(&d, Some(ffmpeg));
        c.stall = Duration::from_secs(2);
        c.set_settings(CaptureSettings {
            destinations: vec![Destination {
                name: "Silent".into(),
                url: format!("rtmp://127.0.0.1:{port}/live"),
                key: "k".into(),
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
        }
        assert!(
            wait_for(|| c.status().failure.is_some()),
            "a stuck FFmpeg is ended and reported: {:?}",
            c.status()
        );
        assert!(c.status().streaming.is_none());
    }

    #[test]
    fn progress_counts_a_stream_as_sent_by_its_time_out() {
        let heard = AtomicU64::new(0);
        let seen = Mutex::new(Vec::new());
        // A stream through the tee muxer: no size, but time out.
        let tee = "frame=30\ntotal_size=0\nout_time_us=1000000\nspeed=1.01x\nprogress=continue\n\
                   total_size=N/A\nout_time_us=2000000\nspeed=0.98x\nprogress=end\n";
        assert!(read_progress(tee.as_bytes(), &heard, |p| lock(&seen).push(p)));
        let seen = lock(&seen).clone();
        assert_eq!(seen.len(), 2);
        assert_eq!(
            (seen[1].secs, seen[1].speed, seen[1].bytes),
            (2.0, Some(0.98), None)
        );
        // Nothing ever went out.
        let none = "total_size=0\nout_time_us=0\nspeed=N/A\nprogress=end\n";
        assert!(!read_progress(none.as_bytes(), &heard, |_| {}));
        // A file: its size.
        let file = "total_size=4096\nout_time_us=N/A\nprogress=end\n";
        assert!(read_progress(file.as_bytes(), &heard, |p| assert_eq!(
            p.bytes,
            Some(4096)
        )));
    }

    #[test]
    fn stream_addresses_point_somewhere() {
        assert_eq!(
            host_port("rtmp://a.rtmp.youtube.com/live2"),
            Some(("a.rtmp.youtube.com".into(), 1935))
        );
        assert_eq!(
            host_port("rtmps://live-api-s.facebook.com:443/rtmp/"),
            Some(("live-api-s.facebook.com".into(), 443))
        );
        assert_eq!(
            host_port("rtmp://user:pw@host:1940/app"),
            Some(("host".into(), 1940))
        );
        assert_eq!(host_port("srt://host:9000"), None);
        assert_eq!(host_port("C:/videos/a.flv"), None);
    }
}
