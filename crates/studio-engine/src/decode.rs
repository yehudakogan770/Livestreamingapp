//! Reading video frames: one long-lived FFmpeg per clip, decoding on the
//! graphics card where it can (`-hwaccel auto`: D3D11VA/DXVA2 on Windows,
//! VAAPI/VDPAU elsewhere), writing NV12 frames down a pipe into a small ring
//! that stays a few frames ahead of the playhead. A jump (a cut, scrubbing,
//! playing backwards) starts FFmpeg again at the new moment; it seeks to the
//! keyframe before it and decodes up to the exact frame.
//!
//! FFmpeg as a program (the one Lumora Studio already ships) rather than as
//! linked libraries: nothing to build on the Windows runner, any format FFmpeg
//! reads plays, and a file that crashes the decoder can't take the app down.

use std::collections::{HashMap, VecDeque};
use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Condvar, Mutex};
use std::time::{Duration, Instant};

use crate::yuv::nv12_len;

/// Frames decoded ahead of the one wanted.
pub const AHEAD: u64 = 6;
/// Frames kept behind it (stepping back a frame or two needs no new FFmpeg).
pub const BEHIND: u64 = 3;
/// How far ahead (in frames) is still worth decoding up to rather than starting again.
pub const REACH: u64 = 45;

/// One decoded frame: NV12 bytes.
pub type Data = Arc<Vec<u8>>;

/// What a ring can do for a moment in the file.
#[derive(Debug, Clone, PartialEq)]
pub enum Look {
    /// Here it is (its number in this run of FFmpeg).
    Ready(u64, Data),
    /// FFmpeg will get to it soon.
    Wait,
    /// It is behind, or far ahead: start FFmpeg again there.
    Restart,
}

/// The frames of one run of FFmpeg, from `start` seconds on, `fps` a second.
#[derive(Debug)]
pub struct Ring {
    pub start: f64,
    pub fps: f64,
    /// The number the next frame FFmpeg writes will have.
    pub next: u64,
    frames: VecDeque<(u64, Data)>,
    /// The frame last asked for (FFmpeg keeps `AHEAD` past it).
    pub want: u64,
    pub ended: bool,
    pub error: Option<String>,
    /// Buffers to reuse (no new memory every frame).
    spare: Vec<Vec<u8>>,
}

impl Ring {
    pub fn new(start: f64, fps: f64) -> Self {
        Self {
            start,
            fps,
            next: 0,
            frames: VecDeque::new(),
            want: 0,
            ended: false,
            error: None,
            spare: Vec::new(),
        }
    }

    /// The number of the frame showing at `time` (negative: before this run starts).
    pub fn index_of(&self, time: f64) -> i64 {
        ((time - self.start) * self.fps + 0.5).floor() as i64
    }

    pub fn buffered(&self) -> usize {
        self.frames.len()
    }

    /// Whether FFmpeg may write another frame now.
    pub fn has_room(&self) -> bool {
        self.next <= self.want + AHEAD
    }

    /// FFmpeg wrote a frame.
    pub fn push(&mut self, data: Vec<u8>) {
        let n = self.next;
        self.next += 1;
        self.frames.push_back((n, Arc::new(data)));
        self.trim();
    }

    /// A buffer to read the next frame into.
    pub fn buffer(&mut self, len: usize) -> Vec<u8> {
        match self.spare.pop() {
            Some(mut b) if b.capacity() >= len => {
                b.resize(len, 0);
                b
            }
            _ => vec![0; len],
        }
    }

    fn trim(&mut self) {
        let keep_from = self.want.saturating_sub(BEHIND);
        while self.frames.front().is_some_and(|f| f.0 < keep_from) {
            if let Some((_, d)) = self.frames.pop_front() {
                if let Ok(v) = Arc::try_unwrap(d) {
                    if self.spare.len() < 4 {
                        self.spare.push(v);
                    }
                }
            }
        }
    }

    /// The frame at `time`, and FFmpeg told to keep going from there.
    pub fn look(&mut self, time: f64) -> Look {
        let k = self.index_of(time);
        if k < 0 {
            return Look::Restart;
        }
        let k = k as u64;
        if let Some((_, d)) = self.frames.iter().find(|f| f.0 == k) {
            let d = d.clone();
            self.want = k;
            self.trim();
            return Look::Ready(k, d);
        }
        let first = self.frames.front().map_or(self.next, |f| f.0);
        if k < first {
            return Look::Restart;
        }
        if self.ended || self.error.is_some() {
            // Past the end of the file: its last frame stays.
            return match self.frames.back() {
                Some((n, d)) if self.error.is_none() => Look::Ready(*n, d.clone()),
                _ => Look::Restart,
            };
        }
        if k >= self.next && k - self.next > REACH {
            return Look::Restart;
        }
        self.want = k;
        self.trim();
        Look::Wait
    }

    /// The newest frame at or before `time` already here (shown when the exact one is late).
    pub fn nearest(&self, time: f64) -> Option<(u64, Data)> {
        let k = self.index_of(time).max(0) as u64;
        self.frames
            .iter()
            .rev()
            .find(|f| f.0 <= k)
            .or(self.frames.front())
            .cloned()
    }
}

/// How FFmpeg is asked to decode.
#[derive(Debug, Clone, PartialEq)]
pub struct Source {
    pub path: String,
    pub fps: f64,
    /// The size frames come out at (even numbers).
    pub w: u32,
    pub h: u32,
}

/// The arguments for one run of FFmpeg.
pub fn ffmpeg_args(src: &Source, from: f64, hardware: bool) -> Vec<String> {
    let mut a: Vec<String> = ["-hide_banner", "-loglevel", "error", "-nostdin"]
        .iter()
        .map(|s| (*s).to_owned())
        .collect();
    if hardware {
        a.extend(["-hwaccel".into(), "auto".into()]);
    }
    a.extend([
        "-ss".into(),
        format!("{:.6}", from.max(0.0)),
        "-i".into(),
        src.path.clone(),
    ]);
    a.extend(
        [
            "-map",
            "0:v:0",
            "-an",
            "-sn",
            "-dn",
            "-fps_mode",
            "cfr",
            "-r",
        ]
        .iter()
        .map(|s| (*s).to_owned()),
    );
    a.push(format!("{}", src.fps));
    a.extend([
        "-vf".into(),
        format!("scale={}:{}:flags=fast_bilinear,format=nv12", src.w, src.h),
        "-f".into(),
        "rawvideo".into(),
        "-pix_fmt".into(),
        "nv12".into(),
        "pipe:1".into(),
    ]);
    a
}

fn quiet(ffmpeg: &Path) -> Command {
    #[allow(unused_mut)]
    let mut c = Command::new(ffmpeg);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        // No console window for each FFmpeg.
        c.creation_flags(0x0800_0000);
    }
    c
}

type Shared = Arc<(Mutex<Ring>, Condvar)>;

/// One run of FFmpeg feeding a ring.
pub struct Stream {
    pub source: Source,
    shared: Shared,
    child: Arc<Mutex<Option<Child>>>,
    pub used: Instant,
}

impl Stream {
    /// Start FFmpeg at `from` seconds.
    ///
    /// # Errors
    /// FFmpeg could not start.
    pub fn open(ffmpeg: &Path, source: Source, from: f64, hardware: bool) -> Result<Self, String> {
        let mut child = quiet(ffmpeg)
            .args(ffmpeg_args(&source, from, hardware))
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|e| format!("FFmpeg could not start: {e}"))?;
        let mut out = child.stdout.take().ok_or("FFmpeg gave no frames.")?;
        let mut err = child.stderr.take();
        let shared: Shared = Arc::new((Mutex::new(Ring::new(from, source.fps)), Condvar::new()));
        let len = nv12_len(source.w, source.h);
        let s = shared.clone();
        std::thread::Builder::new()
            .name("lumora-decode".into())
            .spawn(move || {
                let (lock, cv) = &*s;
                loop {
                    let mut buf = {
                        let mut r = lock
                            .lock()
                            .unwrap_or_else(std::sync::PoisonError::into_inner);
                        while !r.has_room() && Arc::strong_count(&s) > 1 {
                            r = cv
                                .wait_timeout(r, Duration::from_millis(200))
                                .map(|x| x.0)
                                .unwrap_or_else(|e| e.into_inner().0);
                        }
                        if Arc::strong_count(&s) <= 1 {
                            return;
                        }
                        r.buffer(len)
                    };
                    match out.read_exact(&mut buf) {
                        Ok(()) => {
                            let mut r = lock
                                .lock()
                                .unwrap_or_else(std::sync::PoisonError::into_inner);
                            r.push(buf);
                            cv.notify_all();
                        }
                        Err(_) => {
                            let mut msg = String::new();
                            if let Some(e) = err.as_mut() {
                                let _ = e.read_to_string(&mut msg);
                            }
                            let mut r = lock
                                .lock()
                                .unwrap_or_else(std::sync::PoisonError::into_inner);
                            r.ended = true;
                            let msg = msg.trim();
                            if r.next == 0 {
                                r.error = Some(if msg.is_empty() {
                                    "FFmpeg read no frames.".into()
                                } else {
                                    msg.lines().last().unwrap_or(msg).to_owned()
                                });
                            }
                            cv.notify_all();
                            return;
                        }
                    }
                }
            })
            .map_err(|e| e.to_string())?;
        Ok(Self {
            source,
            shared,
            child: Arc::new(Mutex::new(Some(child))),
            used: Instant::now(),
        })
    }

    /// Look for a frame, waiting for FFmpeg until `deadline`.
    pub fn get(&mut self, time: f64, deadline: Instant) -> Look {
        self.used = Instant::now();
        let (lock, cv) = &*self.shared;
        let mut r = lock
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        loop {
            let look = r.look(time);
            cv.notify_all();
            match look {
                Look::Wait => {
                    let now = Instant::now();
                    if now >= deadline {
                        return Look::Wait;
                    }
                    r = cv
                        .wait_timeout(r, deadline - now)
                        .map(|x| x.0)
                        .unwrap_or_else(|e| e.into_inner().0);
                }
                other => return other,
            }
        }
    }

    pub fn nearest(&self, time: f64) -> Option<(u64, Data)> {
        let r = self
            .shared
            .0
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        r.nearest(time)
    }

    pub fn error(&self) -> Option<String> {
        self.shared.0.lock().ok().and_then(|r| r.error.clone())
    }

    /// Which run of FFmpeg this is (frames are numbered within one run).
    pub fn start(&self) -> f64 {
        self.shared.0.lock().map(|r| r.start).unwrap_or(0.0)
    }
}

impl Drop for Stream {
    fn drop(&mut self) {
        if let Ok(mut c) = self.child.lock() {
            if let Some(mut c) = c.take() {
                let _ = c.kill();
                // Reaped in the background, so letting go never waits.
                std::thread::spawn(move || {
                    let _ = c.wait();
                });
            }
        }
        self.shared.1.notify_all();
    }
}

/// A frame for drawing: which run and frame it is (to upload only new ones), and its bytes.
#[derive(Debug, Clone)]
pub struct Got {
    pub id: (u64, u64),
    pub data: Data,
    pub w: u32,
    pub h: u32,
    /// Not the exact frame (it wasn't decoded in time).
    pub late: bool,
}

/// Every clip's decoder.
pub struct Decoders {
    ffmpeg: PathBuf,
    pub hardware: bool,
    streams: HashMap<String, (Stream, u64)>,
    runs: u64,
    /// Files that failed with hardware decoding and are read in software.
    software: HashMap<String, bool>,
    pub last_error: Option<String>,
}

/// Let go of a clip's decoder after this long unused.
const IDLE: Duration = Duration::from_secs(4);

impl Decoders {
    pub fn new(ffmpeg: PathBuf, hardware: bool) -> Self {
        Self {
            ffmpeg,
            hardware,
            streams: HashMap::new(),
            runs: 0,
            software: HashMap::new(),
            last_error: None,
        }
    }

    pub fn count(&self) -> usize {
        self.streams.len()
    }

    fn restart(&mut self, key: &str, source: Source, from: f64) -> Result<(), String> {
        self.streams.remove(key);
        let hw = self.hardware && !self.software.contains_key(&source.path);
        let s = Stream::open(&self.ffmpeg, source, from, hw)?;
        self.runs += 1;
        self.streams.insert(key.to_owned(), (s, self.runs));
        Ok(())
    }

    fn ensure(&mut self, key: &str, source: &Source, time: f64) -> Result<(), String> {
        let same = self
            .streams
            .get(key)
            .is_some_and(|(s, _)| s.source == *source);
        if !same {
            self.restart(key, source.clone(), time)?;
        }
        Ok(())
    }

    /// A clip coming up (a frame sent ahead): its decoder starts now, at its first frame, so a cut
    /// never waits for FFmpeg. A clip already decoding is left alone (the frames on screen come first).
    pub fn hint(&mut self, key: &str, source: &Source, time: f64) {
        let _ = self.ensure(key, source, time);
    }

    /// The frame at `time`, waiting until `deadline`; a late frame is the nearest one already decoded.
    pub fn get(&mut self, key: &str, source: &Source, time: f64, deadline: Instant) -> Option<Got> {
        if let Err(e) = self.ensure(key, source, time) {
            self.last_error = Some(e);
            return None;
        }
        for attempt in 0..3 {
            let (s, run) = self.streams.get_mut(key)?;
            let run = *run;
            match s.get(time, deadline) {
                Look::Ready(n, data) => {
                    return Some(Got {
                        id: (run, n),
                        data,
                        w: source.w,
                        h: source.h,
                        late: false,
                    })
                }
                Look::Wait => {
                    return s.nearest(time).map(|(n, data)| Got {
                        id: (run, n),
                        data,
                        w: source.w,
                        h: source.h,
                        late: true,
                    });
                }
                Look::Restart => {
                    if let Some(e) = s.error() {
                        // Hardware decoding failed for this file: read it in software from now on.
                        self.last_error = Some(e);
                        if attempt > 0 || !self.hardware {
                            return None;
                        }
                        self.software.insert(source.path.clone(), true);
                    }
                    if self.restart(key, source.clone(), time).is_err() {
                        return None;
                    }
                }
            }
        }
        None
    }

    /// Let go of decoders nobody has asked for in a while.
    pub fn sweep(&mut self) {
        self.streams.retain(|_, (s, _)| s.used.elapsed() < IDLE);
    }

    pub fn clear(&mut self) {
        self.streams.clear();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn frame(v: u8) -> Vec<u8> {
        vec![v; 4]
    }

    #[test]
    fn numbers_frames_from_where_the_run_starts() {
        let r = Ring::new(2.0, 25.0);
        assert_eq!(r.index_of(2.0), 0);
        assert_eq!(r.index_of(2.04), 1);
        assert_eq!(r.index_of(2.039), 1);
        assert_eq!(r.index_of(3.0), 25);
        assert!(r.index_of(1.9) < 0);
    }

    #[test]
    fn waits_for_frames_coming_and_hands_them_over() {
        let mut r = Ring::new(0.0, 10.0);
        assert_eq!(r.look(0.0), Look::Wait);
        assert!(r.has_room());
        for i in 0..=AHEAD as u8 {
            r.push(frame(i));
        }
        // Room for no more until the playhead moves on.
        assert!(!r.has_room());
        match r.look(0.3) {
            Look::Ready(3, d) => assert_eq!(d[0], 3),
            other => panic!("{other:?}"),
        }
        assert!(r.has_room());
        // Coming up soon: wait. Far ahead: start again.
        assert_eq!(r.look(1.0), Look::Wait);
        assert_eq!(r.look(100.0), Look::Restart);
    }

    #[test]
    fn keeps_a_few_frames_behind_and_lets_older_ones_go() {
        let mut r = Ring::new(0.0, 10.0);
        for i in 0..7 {
            r.push(frame(i));
        }
        assert!(matches!(r.look(0.5), Look::Ready(5, _)));
        // Stepping back a frame or two needs no new run.
        assert!(matches!(r.look(0.3), Look::Ready(3, _)));
        assert!(matches!(r.look(0.2), Look::Ready(2, _)));
        // Further back than was kept: start again.
        assert_eq!(r.look(0.0), Look::Restart);
        assert!(r.buffered() <= (BEHIND + AHEAD + 1) as usize);
    }

    #[test]
    fn the_end_of_the_file_holds_its_last_frame() {
        let mut r = Ring::new(0.0, 10.0);
        r.push(frame(0));
        r.push(frame(1));
        r.ended = true;
        assert!(matches!(r.look(0.5), Look::Ready(1, _)));
        let mut bad = Ring::new(0.0, 10.0);
        bad.ended = true;
        bad.error = Some("no".into());
        assert_eq!(bad.look(0.0), Look::Restart);
    }

    #[test]
    fn a_late_frame_is_the_nearest_one_before() {
        let mut r = Ring::new(0.0, 10.0);
        for i in 0..3 {
            r.push(frame(i));
        }
        assert_eq!(r.nearest(0.15).map(|x| x.0), Some(2));
        assert_eq!(r.nearest(0.1).map(|x| x.0), Some(1));
    }

    #[test]
    fn asks_ffmpeg_for_exact_nv12_frames() {
        let a = ffmpeg_args(
            &Source {
                path: "/v.mov".into(),
                fps: 23.976,
                w: 1920,
                h: 1080,
            },
            12.5,
            true,
        );
        let s = a.join(" ");
        assert!(s.contains("-hwaccel auto -ss 12.500000 -i /v.mov"));
        assert!(s.contains("-fps_mode cfr -r 23.976"));
        assert!(s.contains("scale=1920:1080:flags=fast_bilinear,format=nv12"));
        assert!(s.ends_with("-f rawvideo -pix_fmt nv12 pipe:1"));
        assert!(!ffmpeg_args(
            &Source {
                path: "x".into(),
                fps: 30.0,
                w: 2,
                h: 2
            },
            -1.0,
            false
        )
        .join(" ")
        .contains("hwaccel"));
    }

    /// FFmpeg itself (when the computer has it): a lossless clip whose frame N
    /// has brightness 5·N comes back frame-exact from any starting point.
    #[test]
    fn decodes_exact_frames_with_ffmpeg() {
        let ffmpeg =
            PathBuf::from(std::env::var("LUMORA_FFMPEG").unwrap_or_else(|_| "ffmpeg".into()));
        if Command::new(&ffmpeg).arg("-version").output().is_err() {
            eprintln!("no FFmpeg here; skipped");
            return;
        }
        let dir = std::env::temp_dir().join(format!("lumora-decode-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let file = dir.join("ramp.mkv");
        let made = Command::new(&ffmpeg)
            .args(["-y", "-loglevel", "error", "-f", "lavfi", "-i"])
            .arg("color=c=black:s=64x48:r=25:d=2,format=yuv420p,geq=lum='N*5':cb=128:cr=128")
            .args(["-c:v", "ffv1"])
            .arg(&file)
            .status()
            .unwrap();
        assert!(made.success());
        let src = Source {
            path: file.to_string_lossy().into_owned(),
            fps: 25.0,
            w: 64,
            h: 48,
        };
        let mut d = Decoders::new(ffmpeg, false);
        let deadline = || Instant::now() + Duration::from_secs(20);
        for (t, n) in [(1.0, 25u8), (1.04, 26), (1.08, 27), (0.2, 5), (1.6, 40)] {
            let g = d.get("clip", &src, t, deadline()).expect("a frame");
            assert!(!g.late);
            assert_eq!(g.data.len(), nv12_len(64, 48));
            assert_eq!(g.data[64 * 20 + 10], n * 5, "frame at {t}s");
            assert_eq!(g.data[64 * 48], 128);
        }
        d.clear();
        let _ = std::fs::remove_dir_all(&dir);
    }
}
