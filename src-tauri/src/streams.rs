//! Stream inputs: FFmpeg reads each live link (SRT, RTMP, RTSP, HLS…) and
//! turns it into JPEG pictures, which are served like web pages (see
//! `browser.rs`). A link that drops is tried again by itself.

use std::collections::HashMap;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::{Child, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{self, Receiver, Sender};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;

use lumora_engine::stream::StreamInput;
use lumora_engine::{Show, SourceKind};
use serde::Serialize;

use crate::browser::{Frames, Sounds};

fn lock<T>(m: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    m.lock().unwrap_or_else(std::sync::PoisonError::into_inner)
}

/// How a stream input is doing, for the control window.
#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StreamStatus {
    /// Pictures are arriving.
    pub live: bool,
    /// Why not, in plain words.
    pub problem: Option<String>,
}

/// Split concatenated JPEGs (FFmpeg's `mjpeg` output) as they arrive.
#[derive(Default)]
pub struct JpegSplitter {
    buf: Vec<u8>,
}

impl JpegSplitter {
    /// Add bytes; returns every whole picture now complete.
    pub fn push(&mut self, bytes: &[u8]) -> Vec<Vec<u8>> {
        self.buf.extend_from_slice(bytes);
        let mut out = Vec::new();
        loop {
            let Some(start) = self.buf.windows(2).position(|w| w == [0xFF, 0xD8]) else {
                // Keep a last 0xFF: it may be the start of a picture split across reads.
                let keep = usize::from(self.buf.last() == Some(&0xFF));
                let cut = self.buf.len() - keep;
                self.buf.drain(..cut);
                break;
            };
            let Some(end) = self.buf[start + 2..]
                .windows(2)
                .position(|w| w == [0xFF, 0xD9])
            else {
                if start > 0 {
                    self.buf.drain(..start);
                }
                break;
            };
            let end = start + 2 + end + 2;
            out.push(self.buf[start..end].to_vec());
            self.buf.drain(..end);
        }
        // Never grow without end on garbage.
        if self.buf.len() > 16 * 1024 * 1024 {
            self.buf.clear();
        }
        out
    }
}

/// FFmpeg's arguments for reading a stream into JPEG pictures.
pub fn reader_args(input: &[String], buffer_ms: u32) -> Vec<String> {
    let mut a: Vec<String> = ["-hide_banner", "-loglevel", "error", "-nostdin"]
        .iter()
        .map(|s| (*s).to_owned())
        .collect();
    let url = input.last().map(String::as_str).unwrap_or_default();
    if url.starts_with("rtsp") {
        a.extend(["-rtsp_transport", "tcp"].map(str::to_owned));
    }
    if buffer_ms < 200 {
        a.extend(["-fflags", "nobuffer", "-flags", "low_delay"].map(str::to_owned));
    }
    a.extend(input.iter().cloned());
    a.extend(
        [
            "-an",
            "-vf",
            "fps=30,scale='min(1920,iw)':-2",
            "-q:v",
            "5",
            "-f",
            "mjpeg",
            "pipe:1",
        ]
        .map(str::to_owned),
    );
    a
}

/// FFmpeg's arguments for reading a stream's sound as raw 48 kHz stereo.
pub fn sound_args(input: &[String], buffer_ms: u32) -> Vec<String> {
    let mut a: Vec<String> = ["-hide_banner", "-loglevel", "error", "-nostdin"]
        .iter()
        .map(|s| (*s).to_owned())
        .collect();
    let url = input.last().map(String::as_str).unwrap_or_default();
    if url.starts_with("rtsp") {
        a.extend(["-rtsp_transport", "tcp"].map(str::to_owned));
    }
    if buffer_ms < 200 {
        a.extend(["-fflags", "nobuffer", "-flags", "low_delay"].map(str::to_owned));
    }
    a.extend(input.iter().cloned());
    a.extend(["-vn", "-ac", "2", "-ar", "48000", "-f", "s16le", "pipe:1"].map(str::to_owned));
    a
}

/// Read a stream's sound until told to stop. A stream without sound is
/// tried again now and then (it may start sending sound later).
#[allow(clippy::needless_pass_by_value)] // owned by its thread
fn run_sound(
    ffmpeg: PathBuf,
    id: String,
    input: Vec<String>,
    buffer_ms: u32,
    sounds: Arc<Sounds>,
    stop: Arc<AtomicBool>,
    slot: Arc<Mutex<Option<Child>>>,
) {
    let mut wait = Duration::from_secs(1);
    while !stop.load(Ordering::Relaxed) {
        let Ok(mut child) = crate::capture::quiet(&ffmpeg)
            .args(sound_args(&input, buffer_ms))
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .spawn()
        else {
            return;
        };
        let mut out = child.stdout.take().expect("piped");
        *lock(&slot) = Some(child);
        // 20 ms pieces (48000 × 2 channels × 2 bytes × 0.02 s), whole samples only.
        let mut buf = vec![0u8; 3840];
        let mut carry: Vec<u8> = Vec::new();
        loop {
            match out.read(&mut buf) {
                Ok(0) | Err(_) => break,
                Ok(n) => {
                    wait = Duration::from_secs(1);
                    carry.extend_from_slice(&buf[..n]);
                    let whole = carry.len() - carry.len() % 4;
                    if whole > 0 {
                        let rest = carry.split_off(whole);
                        sounds.put(&id, std::mem::replace(&mut carry, rest));
                    }
                }
            }
        }
        if let Some(mut c) = lock(&slot).take() {
            let _ = c.kill();
            let _ = c.wait();
        }
        if stop.load(Ordering::Relaxed) {
            break;
        }
        // Sleep in small steps so stopping is quick.
        let until = std::time::Instant::now() + wait;
        while std::time::Instant::now() < until && !stop.load(Ordering::Relaxed) {
            thread::sleep(Duration::from_millis(200));
        }
        wait = (wait * 2).min(Duration::from_secs(30));
    }
    sounds.remove(&id);
}

fn explain(ffmpeg_said: &str, url: &str) -> String {
    let s = ffmpeg_said.to_ascii_lowercase();
    if s.contains("connection refused")
        || s.contains("connection timed out")
        || s.contains("timed out")
    {
        "Can't reach it: check the address and that the stream is running.".to_owned()
    } else if s.contains("404") || s.contains("not found") {
        "The address was found, but there is no stream there.".to_owned()
    } else if s.contains("401") || s.contains("403") || s.contains("unauthorized") {
        "It needs a password (put it in the address, like rtsp://name:password@…).".to_owned()
    } else if s.contains("invalid data") {
        "Something answered, but it isn't a video stream.".to_owned()
    } else if ffmpeg_said.trim().is_empty() {
        format!("The stream stopped ({url}). Trying again…")
    } else {
        format!(
            "The stream stopped: {}",
            ffmpeg_said.lines().last().unwrap_or("").trim()
        )
    }
}

struct Reader {
    url: String,
    buffer_ms: u32,
    stop: Arc<AtomicBool>,
    child: Arc<Mutex<Option<Child>>>,
    sound: Arc<Mutex<Option<Child>>>,
}

impl Reader {
    fn stop(&self) {
        self.stop.store(true, Ordering::Relaxed);
        for slot in [&self.child, &self.sound] {
            if let Some(c) = lock(slot).as_mut() {
                let _ = c.kill();
            }
        }
    }
}

/// One stream to read, with where its pictures and news go.
struct Job {
    ffmpeg: PathBuf,
    id: String,
    input: Vec<String>,
    buffer_ms: u32,
    frames: Arc<Frames>,
    status: Arc<Mutex<HashMap<String, StreamStatus>>>,
    stop: Arc<AtomicBool>,
    slot: Arc<Mutex<Option<Child>>>,
}

/// Read one stream until told to stop, reconnecting when it drops.
#[allow(clippy::needless_pass_by_value)] // owned by its thread
fn run(job: Job) {
    let Job {
        ffmpeg,
        id,
        input,
        buffer_ms,
        frames,
        status,
        stop,
        slot,
    } = job;
    let mut wait = Duration::from_secs(1);
    while !stop.load(Ordering::Relaxed) {
        let spawned = crate::capture::quiet(&ffmpeg)
            .args(reader_args(&input, buffer_ms))
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn();
        let mut child = match spawned {
            Ok(c) => c,
            Err(e) => {
                lock(&status).insert(
                    id.clone(),
                    StreamStatus {
                        live: false,
                        problem: Some(format!("FFmpeg would not start: {e}")),
                    },
                );
                return;
            }
        };
        let mut out = child.stdout.take().expect("piped");
        let mut err = child.stderr.take().expect("piped");
        *lock(&slot) = Some(child);
        let said = Arc::new(Mutex::new(String::new()));
        let s2 = Arc::clone(&said);
        let err_thread = thread::spawn(move || {
            let mut text = String::new();
            let _ = err.read_to_string(&mut text);
            *lock(&s2) = text;
        });
        let mut split = JpegSplitter::default();
        let mut buf = vec![0u8; 256 * 1024];
        let mut got_any = false;
        loop {
            match out.read(&mut buf) {
                Ok(0) | Err(_) => break,
                Ok(n) => {
                    for jpeg in split.push(&buf[..n]) {
                        if !got_any {
                            got_any = true;
                            wait = Duration::from_secs(1);
                            lock(&status).insert(
                                id.clone(),
                                StreamStatus {
                                    live: true,
                                    problem: None,
                                },
                            );
                        }
                        frames.put(&id, jpeg, "image/jpeg");
                    }
                }
            }
        }
        if let Some(mut c) = lock(&slot).take() {
            let _ = c.kill();
            let _ = c.wait();
        }
        let _ = err_thread.join();
        if stop.load(Ordering::Relaxed) {
            break;
        }
        let url = input.last().cloned().unwrap_or_default();
        lock(&status).insert(
            id.clone(),
            StreamStatus {
                live: false,
                problem: Some(explain(&lock(&said), &url)),
            },
        );
        thread::sleep(wait);
        wait = (wait * 2).min(Duration::from_secs(10));
    }
    frames.remove(&id);
    lock(&status).remove(&id);
}

/// Read an NDI source until told to stop: its pictures as JPEGs (at most
/// 30 a second), its sound as the stream sound. Reconnects by itself.
fn run_ndi(
    id: &str,
    name: &str,
    frames: &Frames,
    sounds: &Sounds,
    status: &Mutex<HashMap<String, StreamStatus>>,
    stop: &AtomicBool,
) {
    let say = |live: bool, problem: Option<String>| {
        lock(status).insert(id.to_owned(), StreamStatus { live, problem });
    };
    while !stop.load(Ordering::Relaxed) {
        let mut recv = match crate::ndi::Receiver::new(name) {
            Ok(r) => r,
            Err(e) => {
                say(false, Some(e));
                // Not installed, or not there yet: look again in a while.
                for _ in 0..25 {
                    if stop.load(Ordering::Relaxed) {
                        break;
                    }
                    thread::sleep(Duration::from_millis(200));
                }
                continue;
            }
        };
        let mut last_picture = std::time::Instant::now();
        let mut last_jpeg = std::time::Instant::now() - Duration::from_secs(1);
        let mut live = false;
        while !stop.load(Ordering::Relaxed) {
            match recv.capture(200) {
                crate::ndi::Received::Video {
                    width,
                    height,
                    bgra,
                } => {
                    last_picture = std::time::Instant::now();
                    if !live {
                        live = true;
                        say(true, None);
                    }
                    if last_jpeg.elapsed() < Duration::from_millis(30) {
                        continue;
                    }
                    last_jpeg = std::time::Instant::now();
                    let (Ok(w), Ok(h)) = (u16::try_from(width), u16::try_from(height)) else {
                        continue;
                    };
                    let mut jpeg = Vec::with_capacity(bgra.len() / 8);
                    let enc = jpeg_encoder::Encoder::new(&mut jpeg, 85);
                    if enc
                        .encode(&bgra, w, h, jpeg_encoder::ColorType::Bgra)
                        .is_ok()
                    {
                        frames.put(id, jpeg, "image/jpeg");
                    }
                }
                crate::ndi::Received::Audio {
                    rate,
                    channels,
                    samples,
                    planar,
                } => sounds.put(
                    id,
                    crate::ndi::to_stereo_s16(rate, channels, samples, &planar),
                ),
                crate::ndi::Received::Nothing => {
                    if live && last_picture.elapsed() > Duration::from_secs(3) {
                        live = false;
                        say(
                            false,
                            Some(format!(
                                "The NDI source “{name}” stopped sending. Waiting for it…"
                            )),
                        );
                    } else if !live && last_picture.elapsed() > Duration::from_secs(5) {
                        say(false, Some(format!("Waiting for the NDI source “{name}”…")));
                    }
                }
            }
        }
    }
    frames.remove(id);
    sounds.remove(id);
    lock(status).remove(id);
}

pub struct Streams {
    tx: Mutex<Sender<Show>>,
    pub status: Arc<Mutex<HashMap<String, StreamStatus>>>,
}

impl Streams {
    pub fn new(ffmpeg: Option<PathBuf>, frames: Arc<Frames>, sounds: Arc<Sounds>) -> Streams {
        let (tx, rx) = mpsc::channel();
        let status = Arc::new(Mutex::new(HashMap::new()));
        let s2 = Arc::clone(&status);
        thread::spawn(move || manage(ffmpeg.as_deref(), &rx, &frames, &sounds, &s2));
        Streams {
            tx: Mutex::new(tx),
            status,
        }
    }

    /// The show changed: start, restart or stop readers to match.
    pub fn sync(&self, show: &Show) {
        let _ = lock(&self.tx).send(show.clone());
    }
}

fn manage(
    ffmpeg: Option<&Path>,
    rx: &Receiver<Show>,
    frames: &Arc<Frames>,
    sounds: &Arc<Sounds>,
    status: &Arc<Mutex<HashMap<String, StreamStatus>>>,
) {
    let mut readers: HashMap<String, Reader> = HashMap::new();
    while let Ok(mut show) = rx.recv() {
        while let Ok(newer) = rx.try_recv() {
            show = newer;
        }
        let wanted: HashMap<String, StreamInput> = show
            .sources
            .iter()
            .filter_map(|s| match &s.kind {
                SourceKind::Stream(st) => Some((s.id.as_str().to_owned(), (**st).clone())),
                _ => None,
            })
            .collect();
        readers.retain(|id, r| {
            let keep = wanted
                .get(id)
                .is_some_and(|w| w.url == r.url && w.buffer_ms == r.buffer_ms);
            if !keep {
                r.stop();
            }
            keep
        });
        for (id, st) in wanted {
            if readers.contains_key(&id) {
                continue;
            }
            // A Blackmagic capture card: read with the DeckLink API (`decklink.rs`).
            if crate::decklink::is_card(&st.url) {
                let stop = Arc::new(AtomicBool::new(false));
                crate::decklink::spawn(
                    id.clone(),
                    st.url.clone(),
                    Arc::clone(frames),
                    Arc::clone(sounds),
                    Arc::clone(status),
                    Arc::clone(&stop),
                );
                readers.insert(
                    id,
                    Reader {
                        url: st.url,
                        buffer_ms: st.buffer_ms,
                        stop,
                        child: Arc::new(Mutex::new(None)),
                        sound: Arc::new(Mutex::new(None)),
                    },
                );
                continue;
            }
            // An NDI source: read with the NDI runtime, not FFmpeg.
            if let Some(name) = st.url.strip_prefix("ndi://").map(str::to_owned) {
                let stop = Arc::new(AtomicBool::new(false));
                let (f, snd, s, st2, id2) = (
                    Arc::clone(frames),
                    Arc::clone(sounds),
                    Arc::clone(status),
                    Arc::clone(&stop),
                    id.clone(),
                );
                thread::spawn(move || run_ndi(&id2, &name, &f, &snd, &s, &st2));
                readers.insert(
                    id,
                    Reader {
                        url: st.url,
                        buffer_ms: st.buffer_ms,
                        stop,
                        child: Arc::new(Mutex::new(None)),
                        sound: Arc::new(Mutex::new(None)),
                    },
                );
                continue;
            }
            let Some(ffmpeg) = ffmpeg else {
                lock(status).insert(
                    id,
                    StreamStatus {
                        live: false,
                        problem: Some(
                            "Stream inputs need FFmpeg, which isn't installed on this computer."
                                .to_owned(),
                        ),
                    },
                );
                continue;
            };
            let stop = Arc::new(AtomicBool::new(false));
            let child = Arc::new(Mutex::new(None));
            let args = vec!["-i".to_owned(), st.url.clone()];
            let (f, s, st2, ch, ff, id2) = (
                Arc::clone(frames),
                Arc::clone(status),
                Arc::clone(&stop),
                Arc::clone(&child),
                ffmpeg.to_path_buf(),
                id.clone(),
            );
            let buffer = st.buffer_ms;
            thread::spawn(move || {
                run(Job {
                    ffmpeg: ff,
                    id: id2,
                    input: args,
                    buffer_ms: buffer,
                    frames: f,
                    status: s,
                    stop: st2,
                    slot: ch,
                });
            });
            let sound = Arc::new(Mutex::new(None));
            let (ff, id2, input, snd, st2, sl) = (
                ffmpeg.to_path_buf(),
                id.clone(),
                vec!["-i".to_owned(), st.url.clone()],
                Arc::clone(sounds),
                Arc::clone(&stop),
                Arc::clone(&sound),
            );
            thread::spawn(move || run_sound(ff, id2, input, buffer, snd, st2, sl));
            readers.insert(
                id,
                Reader {
                    url: st.url,
                    buffer_ms: st.buffer_ms,
                    stop,
                    child,
                    sound,
                },
            );
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn jpegs_are_split_however_the_bytes_arrive() {
        let a = [0xFF, 0xD8, 1, 2, 3, 0xFF, 0xD9];
        let b = [0xFF, 0xD8, 9, 0xFF, 0x00, 8, 0xFF, 0xD9];
        let all: Vec<u8> = [&[7u8, 7][..], &a, &b].concat();
        let mut s = JpegSplitter::default();
        let mut got = Vec::new();
        for chunk in all.chunks(3) {
            got.extend(s.push(chunk));
        }
        assert_eq!(got, vec![a.to_vec(), b.to_vec()]);
    }

    #[test]
    fn rtsp_uses_tcp_and_small_buffers_ask_for_low_delay() {
        let a = reader_args(&["-i".into(), "rtsp://cam/1".into()], 0);
        assert!(a.windows(2).any(|w| w == ["-rtsp_transport", "tcp"]));
        assert!(a.contains(&"nobuffer".to_owned()));
        let b = reader_args(&["-i".into(), "srt://x:9000".into()], 1000);
        assert!(!b.contains(&"-rtsp_transport".to_owned()) && !b.contains(&"nobuffer".to_owned()));
    }

    #[test]
    fn a_live_source_becomes_sound() {
        let Some(ffmpeg) = crate::capture::find_ffmpeg() else {
            return;
        };
        let sounds = Arc::new(Sounds::default());
        let rx = sounds.listen("cam");
        let stop = Arc::new(AtomicBool::new(false));
        let slot = Arc::new(Mutex::new(None));
        let input = [
            "-re",
            "-f",
            "lavfi",
            "-i",
            "sine=frequency=440:sample_rate=44100",
        ]
        .map(str::to_owned)
        .to_vec();
        let (s2, st, sl) = (Arc::clone(&sounds), Arc::clone(&stop), Arc::clone(&slot));
        let t = thread::spawn(move || run_sound(ffmpeg, "cam".into(), input, 500, s2, st, sl));
        let mut got = 0;
        while got < 48_000 {
            let chunk = rx.recv_timeout(Duration::from_secs(10)).expect("sound");
            assert_eq!(chunk.len() % 4, 0, "whole stereo samples");
            got += chunk.len();
        }
        stop.store(true, Ordering::Relaxed);
        if let Some(c) = lock(&slot).as_mut() {
            let _ = c.kill();
        }
        t.join().unwrap();
        let a = sound_args(&["-i".to_owned(), "rtsp://cam/1".to_owned()], 100);
        assert!(
            a.contains(&"s16le".to_owned())
                && a.contains(&"tcp".to_owned())
                && a.contains(&"-vn".to_owned())
        );
    }

    #[test]
    fn a_live_source_becomes_pictures() {
        let Some(ffmpeg) = crate::capture::find_ffmpeg() else {
            return;
        };
        let frames = Arc::new(Frames::default());
        let status = Arc::new(Mutex::new(HashMap::new()));
        let stop = Arc::new(AtomicBool::new(false));
        let slot = Arc::new(Mutex::new(None));
        let input = ["-re", "-f", "lavfi", "-i", "testsrc=size=320x240:rate=10"]
            .map(str::to_owned)
            .to_vec();
        let (f, s, st, sl) = (
            Arc::clone(&frames),
            Arc::clone(&status),
            Arc::clone(&stop),
            Arc::clone(&slot),
        );
        let t = thread::spawn(move || {
            run(Job {
                ffmpeg,
                id: "cam".into(),
                input,
                buffer_ms: 500,
                frames: f,
                status: s,
                stop: st,
                slot: sl,
            });
        });
        let first = frames
            .next("cam", 0, Duration::from_secs(10))
            .expect("a picture");
        assert_eq!(&first.bytes[..2], &[0xFF, 0xD8]);
        let later = frames
            .next("cam", first.n, Duration::from_secs(5))
            .expect("more pictures");
        assert!(later.n > first.n);
        assert!(lock(&status).get("cam").is_some_and(|s| s.live));
        stop.store(true, Ordering::Relaxed);
        if let Some(c) = lock(&slot).as_mut() {
            let _ = c.kill();
        }
        t.join().unwrap();
        assert!(
            frames.next("cam", 0, Duration::from_millis(10)).is_none(),
            "gone when stopped"
        );
    }

    #[test]
    fn problems_are_explained_plainly() {
        assert!(explain("Connection refused", "srt://x").contains("Can't reach"));
        assert!(explain("Server returned 401 Unauthorized", "rtsp://x").contains("password"));
    }
}
