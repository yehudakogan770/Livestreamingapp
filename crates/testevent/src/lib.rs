//! Lumora's test event (Settings → Run a test event…).
//!
//! The person presses one button and Lumora runs a whole event by itself in a
//! separate, temporary show, measuring how this computer copes. This crate is
//! the part that touches the disk and `FFmpeg`, kept apart so it can be tested:
//!
//! - the **restore marker**: before the test show replaces the person's own,
//!   their show and recording settings are written here; they are put back
//!   when the test ends, and on the next start if Lumora closed mid-test;
//! - the **test folder** that holds everything the test makes (removed after);
//! - the **test media** (a video with sound, a picture, slides) made with `FFmpeg`;
//! - the **disk speed** check, the **recording check** and the saved **report**.

use serde::{Deserialize, Serialize};
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::{Instant, SystemTime, UNIX_EPOCH};

/// The marker file in the app's data folder.
pub const MARKER_FILE: &str = "test-event-restore.json";
/// Every folder the test makes starts with this; only such folders are ever removed.
pub const FOLDER_PREFIX: &str = "lumora-test-event-";
/// The test video's length, seconds.
pub const VIDEO_SECONDS: u32 = 30;

/// What the test event must put back.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Marker {
    pub version: u32,
    /// When the test started (ms since 1970).
    pub started_at: u64,
    /// The person's show, as saved by the engine (`persist::save_json`).
    pub show: String,
    /// The person's recording and streaming settings (as JSON).
    pub capture: serde_json::Value,
    /// The test's folder, removed when the marker is used.
    pub folder: Option<String>,
}

pub fn marker_path(dir: &Path) -> PathBuf {
    dir.join(MARKER_FILE)
}

fn write_atomic(path: &Path, text: &str) -> Result<(), String> {
    if let Some(parent) = path.parent().filter(|p| !p.as_os_str().is_empty()) {
        fs::create_dir_all(parent)
            .map_err(|e| format!("Could not make {}: {e}", parent.display()))?;
    }
    let tmp = path.with_extension("partial");
    let mut f =
        fs::File::create(&tmp).map_err(|e| format!("Could not write {}: {e}", tmp.display()))?;
    f.write_all(text.as_bytes())
        .and_then(|()| f.sync_all())
        .map_err(|e| format!("Could not write {}: {e}", tmp.display()))?;
    drop(f);
    fs::rename(&tmp, path).map_err(|e| format!("Could not write {}: {e}", path.display()))
}

/// Writes the marker (safely: a half-written marker is never read).
///
/// # Errors
/// A marker is already there (a test is running, or one is waiting to be put
/// back), or the file can't be written.
pub fn write_marker(dir: &Path, marker: &Marker) -> Result<(), String> {
    let path = marker_path(dir);
    if path.exists() {
        return Err(
            "A test event is already running (or the last one has not been put back yet)."
                .to_owned(),
        );
    }
    let text = serde_json::to_string(marker).map_err(|e| e.to_string())?;
    write_atomic(&path, &text)
}

/// The marker, if a test event is running or was cut short.
pub fn read_marker(dir: &Path) -> Option<Marker> {
    let text = fs::read_to_string(marker_path(dir)).ok()?;
    serde_json::from_str(&text).ok()
}

/// Removes the marker (after the person's show is back).
pub fn clear_marker(dir: &Path) {
    let _ = fs::remove_file(marker_path(dir));
}

fn millis() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |d| d.as_millis())
}

/// A new, empty test folder inside `base`.
///
/// # Errors
/// The folder can't be made (the drive is full or read-only).
pub fn new_folder(base: &Path) -> Result<PathBuf, String> {
    let dir = base.join(format!(
        "{FOLDER_PREFIX}{}-{}",
        std::process::id(),
        millis()
    ));
    fs::create_dir_all(&dir)
        .map_err(|e| format!("Could not make a test folder in {}: {e}", base.display()))?;
    Ok(dir)
}

/// The folder is one the test made (by its name).
pub fn is_test_folder(path: &Path) -> bool {
    path.file_name()
        .and_then(|n| n.to_str())
        .is_some_and(|n| n.starts_with(FOLDER_PREFIX) && n.len() > FOLDER_PREFIX.len())
}

/// Removes a test folder and everything in it. Refuses any other folder.
///
/// # Errors
/// It is not a test folder, or it could not be removed.
pub fn remove_folder(path: &Path) -> Result<(), String> {
    if !is_test_folder(path) {
        return Err(format!("Not a test folder: {}", path.display()));
    }
    match fs::remove_dir_all(path) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(format!("Could not remove {}: {e}", path.display())),
    }
}

/// Removes replay files the test made in the app's `replays` folder (only
/// files named `replay-…` directly inside that folder). Returns how many.
pub fn remove_replays(replays: &Path, files: &[String]) -> usize {
    let mut n = 0;
    for f in files {
        let p = Path::new(f);
        let in_folder = p.parent().is_some_and(|d| d == replays);
        let named = p
            .file_name()
            .and_then(|x| x.to_str())
            .is_some_and(|x| x.starts_with("replay-"));
        if in_folder && named && fs::remove_file(p).is_ok() {
            n += 1;
        }
    }
    n
}

// ----- test media -----

/// The video codecs tried, best first (not every `FFmpeg` has every one).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum VideoCodec {
    H264,
    Vp8,
    Mpeg4,
}

impl VideoCodec {
    pub const ALL: [VideoCodec; 3] = [VideoCodec::H264, VideoCodec::Vp8, VideoCodec::Mpeg4];

    pub fn extension(self) -> &'static str {
        match self {
            VideoCodec::H264 | VideoCodec::Mpeg4 => "mp4",
            VideoCodec::Vp8 => "webm",
        }
    }
}

fn s(v: &[&str]) -> Vec<String> {
    v.iter().map(|x| (*x).to_owned()).collect()
}

/// `FFmpeg` arguments for the test video: 1080p moving test picture with a tone.
pub fn video_args(out: &Path, seconds: u32, codec: VideoCodec) -> Vec<String> {
    let t = seconds.to_string();
    let mut a = s(&[
        "-hide_banner",
        "-nostdin",
        "-y",
        "-f",
        "lavfi",
        "-i",
        "testsrc2=size=1920x1080:rate=30",
        "-f",
        "lavfi",
        "-i",
        "sine=frequency=440:sample_rate=48000",
        "-t",
        &t,
    ]);
    a.extend(match codec {
        VideoCodec::H264 => s(&[
            "-c:v",
            "libx264",
            "-preset",
            "ultrafast",
            "-crf",
            "30",
            "-pix_fmt",
            "yuv420p",
            "-c:a",
            "aac",
            "-b:a",
            "128k",
        ]),
        VideoCodec::Vp8 => s(&[
            "-c:v",
            "libvpx",
            "-deadline",
            "realtime",
            "-b:v",
            "2M",
            "-c:a",
            "libopus",
        ]),
        VideoCodec::Mpeg4 => s(&[
            "-c:v", "mpeg4", "-q:v", "8", "-pix_fmt", "yuv420p", "-c:a", "aac",
        ]),
    });
    a.extend(s(&["-shortest"]));
    a.push(out.to_string_lossy().into_owned());
    a
}

/// The pictures `FFmpeg` can draw by itself, one per slide.
pub const PICTURES: [&str; 4] = [
    "smptehdbars=size=1920x1080",
    "testsrc=size=1920x1080",
    "rgbtestsrc=size=1920x1080",
    "mandelbrot=size=1920x1080",
];

/// `FFmpeg` arguments for one still picture (PNG) from a built-in source.
pub fn picture_args(out: &Path, source: &str) -> Vec<String> {
    let mut a = s(&[
        "-hide_banner",
        "-nostdin",
        "-y",
        "-f",
        "lavfi",
        "-i",
        source,
        "-frames:v",
        "1",
    ]);
    a.push(out.to_string_lossy().into_owned());
    a
}

/// What the test media came out as.
#[derive(Debug, Clone, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Media {
    /// The test video with sound (None: `FFmpeg` could not make one).
    pub video: Option<String>,
    pub video_seconds: u32,
    /// A still picture.
    pub image: Option<String>,
    /// Pictures for the slideshow.
    pub slides: Vec<String>,
    /// What went wrong, in short.
    pub errors: Vec<String>,
}

fn run(ffmpeg: &Path, args: &[String]) -> Result<(), String> {
    #[allow(unused_mut)]
    let mut cmd = Command::new(ffmpeg);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000);
    }
    let out = cmd
        .args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .output()
        .map_err(|e| format!("FFmpeg could not start: {e}"))?;
    if out.status.success() {
        Ok(())
    } else {
        Err(tail(&String::from_utf8_lossy(&out.stderr), 600))
    }
}

/// The last `max` characters of a text.
pub fn tail(text: &str, max: usize) -> String {
    let start = text
        .char_indices()
        .rev()
        .nth(max.saturating_sub(1))
        .map_or(0, |(i, _)| i);
    text[start..].trim().to_owned()
}

fn ok_file(p: &Path) -> bool {
    fs::metadata(p).is_ok_and(|m| m.len() > 0)
}

/// Makes the test media in `folder` with `FFmpeg`.
pub fn make_media(ffmpeg: &Path, folder: &Path) -> Media {
    let mut media = Media {
        video_seconds: VIDEO_SECONDS,
        ..Media::default()
    };
    for codec in VideoCodec::ALL {
        let out = folder.join(format!("Test video.{}", codec.extension()));
        match run(ffmpeg, &video_args(&out, VIDEO_SECONDS, codec)) {
            Ok(()) if ok_file(&out) => {
                media.video = Some(out.to_string_lossy().into_owned());
                break;
            }
            Ok(()) => media.errors.push(format!("{codec:?}: empty file")),
            Err(e) => media.errors.push(format!("{codec:?}: {e}")),
        }
    }
    for (i, source) in PICTURES.iter().enumerate() {
        let out = folder.join(format!("Test slide {}.png", i + 1));
        match run(ffmpeg, &picture_args(&out, source)) {
            Ok(()) if ok_file(&out) => media.slides.push(out.to_string_lossy().into_owned()),
            Ok(()) => media.errors.push(format!("{source}: empty picture")),
            Err(e) => media.errors.push(format!("{source}: {e}")),
        }
    }
    media.image = media.slides.first().cloned();
    media
}

// ----- disk speed -----

/// How fast this folder's drive takes a file, MB/s (writes `mb` megabytes,
/// forced to the disk, then removes it).
///
/// # Errors
/// The file could not be written (the drive is full or read-only).
pub fn disk_write_speed(folder: &Path, mb: usize) -> Result<f64, String> {
    let path = folder.join("disk-speed.tmp");
    let block: Vec<u8> = (0..1024 * 1024)
        .map(|i: usize| u8::try_from(i.wrapping_mul(31) % 251).unwrap_or(0))
        .collect();
    let started = Instant::now();
    let written = (|| -> std::io::Result<()> {
        let mut f = fs::File::create(&path)?;
        for _ in 0..mb.max(1) {
            f.write_all(&block)?;
        }
        f.sync_all()
    })();
    let secs = started.elapsed().as_secs_f64();
    let _ = fs::remove_file(&path);
    written.map_err(|e| format!("Could not write to {}: {e}", folder.display()))?;
    Ok(mb_per_s(mb.max(1) as u64 * 1024 * 1024, secs))
}

/// Bytes over seconds, in MB/s (0 for no time).
#[allow(clippy::cast_precision_loss)]
pub fn mb_per_s(bytes: u64, seconds: f64) -> f64 {
    if seconds <= 0.0 {
        return 0.0;
    }
    bytes as f64 / 1_000_000.0 / seconds
}

/// The `speed=` `FFmpeg` reports on a progress line (e.g. `speed=1.02x`).
pub fn parse_speed(line: &str) -> Option<f64> {
    let i = line.rfind("speed=")?;
    let rest = line[i + 6..].trim_start();
    let num: String = rest
        .chars()
        .take_while(|c| c.is_ascii_digit() || *c == '.')
        .collect();
    num.parse().ok()
}

// ----- the recording check -----

/// What `FFmpeg` found when it decoded a whole recording.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Probe {
    /// Video frames decoded.
    pub frames: u64,
    /// The length `FFmpeg` reports.
    pub seconds: Option<f64>,
    pub video: bool,
    /// Sound streams in the file.
    pub audio_streams: u32,
    /// `FFmpeg` finished without an error.
    pub ok: bool,
    /// The end of what `FFmpeg` said.
    pub text: String,
}

fn parse_duration(text: &str) -> Option<f64> {
    let i = text.find("Duration: ")?;
    let t = text[i + 10..].split([',', ' ']).next()?;
    let mut parts = t.split(':');
    let h: f64 = parts.next()?.parse().ok()?;
    let m: f64 = parts.next()?.parse().ok()?;
    let sec: f64 = parts.next()?.parse().ok()?;
    Some(h * 3600.0 + m * 60.0 + sec)
}

/// Reads `FFmpeg`'s words after decoding a file to nothing.
pub fn parse_probe(text: &str, ok: bool) -> Probe {
    let frames = text
        .split(['\r', '\n'])
        .filter_map(|line| {
            let i = line.find("frame=")?;
            line[i + 6..].split_whitespace().next()?.parse::<u64>().ok()
        })
        .next_back()
        .unwrap_or(0);
    // Only the input's streams (before "Output #0"), not what was written to nothing.
    let input = text.split("Output #").next().unwrap_or(text);
    let streams = |kind: &str| {
        input
            .lines()
            .filter(|l| l.contains("Stream #") && l.contains(kind))
            .count()
    };
    Probe {
        frames,
        seconds: parse_duration(text),
        video: streams("Video:") > 0,
        audio_streams: u32::try_from(streams("Audio:")).unwrap_or(u32::MAX),
        ok,
        text: tail(text, 1500),
    }
}

/// Decodes the whole file (picture and sound) with `FFmpeg`.
///
/// # Errors
/// `FFmpeg` can't start.
pub fn probe(ffmpeg: &Path, file: &Path) -> Result<Probe, String> {
    #[allow(unused_mut)]
    let mut cmd = Command::new(ffmpeg);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000);
    }
    let out = cmd
        .args(probe_args(file))
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .output()
        .map_err(|e| format!("FFmpeg could not start: {e}"))?;
    Ok(parse_probe(
        &String::from_utf8_lossy(&out.stderr),
        out.status.success(),
    ))
}

/// `FFmpeg` arguments that decode a whole file to nothing.
pub fn probe_args(file: &Path) -> Vec<String> {
    let mut a = s(&["-hide_banner", "-nostdin", "-i"]);
    a.push(file.to_string_lossy().into_owned());
    a.extend(s(&["-f", "null", "-"]));
    a
}

// ----- the stream test -----

/// A free TCP port on this computer (for the local stream receiver).
///
/// # Errors
/// No port could be had.
pub fn free_port() -> Result<u16, String> {
    let l =
        std::net::TcpListener::bind(("127.0.0.1", 0)).map_err(|e| format!("No free port: {e}"))?;
    l.local_addr().map(|a| a.port()).map_err(|e| e.to_string())
}

/// The address Lumora streams to for the receiver on `port` (server and key).
pub fn receiver_url(port: u16) -> (String, String) {
    (format!("rtmp://127.0.0.1:{port}/live"), "test".to_owned())
}

/// `FFmpeg` arguments for a local RTMP receiver that keeps what it gets in `out`.
pub fn receiver_args(port: u16, out: &Path) -> Vec<String> {
    let (url, key) = receiver_url(port);
    let mut a = s(&[
        "-hide_banner",
        "-nostdin",
        "-y",
        "-listen",
        "1",
        "-timeout",
        "120",
        "-i",
    ]);
    a.push(format!("{url}/{key}"));
    a.extend(s(&["-c", "copy", "-f", "flv"]));
    a.push(out.to_string_lossy().into_owned());
    a
}

/// A streaming server's host and port (the usual port when none is given).
pub fn host_port(url: &str) -> Option<(String, u16)> {
    let (scheme, rest) = url.trim().split_once("://")?;
    let default = match scheme.to_ascii_lowercase().as_str() {
        "rtmp" => 1935,
        "rtmps" | "https" => 443,
        "http" => 80,
        "rtsp" => 554,
        _ => return None,
    };
    let authority = rest.split(['/', '?']).next()?;
    let authority = authority.rsplit_once('@').map_or(authority, |(_, h)| h);
    if authority.is_empty() {
        return None;
    }
    match authority.rsplit_once(':') {
        Some((h, p)) if !h.is_empty() => Some((h.to_owned(), p.parse().ok()?)),
        _ => Some((authority.to_owned(), default)),
    }
}

/// How one of the person's destinations answered (nothing is sent to it).
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Reach {
    pub name: String,
    /// It has a stream key (or its address carries one).
    pub has_key: bool,
    /// The server answered a connection.
    pub reachable: bool,
    pub message: String,
}

/// Checks a destination: its key, and that its server answers (a plain
/// connection that is closed at once; nothing is streamed).
pub fn reach(name: &str, url: &str, key: &str) -> Reach {
    use std::net::{TcpStream, ToSocketAddrs};
    let path_has_key = url
        .split_once("://")
        .map_or("", |(_, r)| r)
        .split_once('/')
        .is_some_and(|(_, p)| p.trim_end_matches('/').contains('/'));
    let has_key = !key.trim().is_empty() || path_has_key;
    let Some((host, port)) = host_port(url) else {
        return Reach {
            name: name.to_owned(),
            has_key,
            reachable: false,
            message: "This kind of address can't be checked ahead of time.".to_owned(),
        };
    };
    let Ok(found) = (host.as_str(), port).to_socket_addrs() else {
        let message =
            format!("The server address “{host}” could not be found (is the internet connected?)");
        return Reach {
            name: name.to_owned(),
            has_key,
            reachable: false,
            message,
        };
    };
    let addrs: Vec<_> = found.collect();
    let reachable = addrs
        .iter()
        .any(|a| TcpStream::connect_timeout(a, std::time::Duration::from_secs(4)).is_ok());
    Reach {
        name: name.to_owned(),
        has_key,
        reachable,
        message: match (reachable, has_key) {
            (true, true) => "The server answered.".to_owned(),
            (true, false) => "The server answered, but there is no stream key.".to_owned(),
            (false, _) => format!(
                "The server ({host}) did not answer. Check the internet connection or a firewall."
            ),
        },
    }
}

// ----- the saved report -----

/// A report file name: only plain characters, never a path.
pub fn safe_name(name: &str) -> String {
    let clean: String = name
        .chars()
        .map(|c| {
            if c.is_alphanumeric() || matches!(c, ' ' | '-' | '_' | '.' | '(' | ')') {
                c
            } else {
                '-'
            }
        })
        .collect();
    let clean = clean.trim().trim_start_matches('.').trim();
    if clean.is_empty() {
        "Lumora test report".to_owned()
    } else {
        clean.chars().take(120).collect()
    }
}

/// Where the report went: the Markdown file and its JSON twin.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Saved {
    pub markdown: String,
    pub json: String,
}

/// Saves the report as `<name>.md` and `<name>.json` in `folder`.
///
/// # Errors
/// The folder or files can't be written.
pub fn save_report(folder: &Path, name: &str, markdown: &str, json: &str) -> Result<Saved, String> {
    let base = safe_name(name);
    let md = folder.join(format!("{base}.md"));
    let js = folder.join(format!("{base}.json"));
    write_atomic(&md, markdown)?;
    write_atomic(&js, json)?;
    Ok(Saved {
        markdown: md.to_string_lossy().into_owned(),
        json: js.to_string_lossy().into_owned(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp(name: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!(
            "lumora-testevent-test-{name}-{}",
            std::process::id()
        ));
        let _ = fs::remove_dir_all(&d);
        fs::create_dir_all(&d).unwrap();
        d
    }

    fn marker() -> Marker {
        Marker {
            version: 1,
            started_at: 5,
            show: r#"{"version":2}"#.to_owned(),
            capture: serde_json::json!({ "folder": null, "destinations": [{ "key": "k" }] }),
            folder: Some("x".into()),
        }
    }

    #[test]
    fn marker_round_trip_and_only_one_at_a_time() {
        let d = temp("marker");
        assert_eq!(read_marker(&d), None);
        write_marker(&d, &marker()).unwrap();
        assert_eq!(read_marker(&d), Some(marker()));
        // A second test can't start while one is waiting to be put back.
        assert!(write_marker(&d, &marker()).is_err());
        assert_eq!(read_marker(&d), Some(marker()));
        clear_marker(&d);
        assert_eq!(read_marker(&d), None);
        assert!(!d.join("test-event-restore.partial").exists());
        let _ = fs::remove_dir_all(d);
    }

    #[test]
    fn a_broken_marker_is_not_used() {
        let d = temp("broken");
        fs::write(marker_path(&d), "{ half").unwrap();
        assert_eq!(read_marker(&d), None);
        let _ = fs::remove_dir_all(d);
    }

    #[test]
    fn only_test_folders_are_removed() {
        let d = temp("folders");
        let f = new_folder(&d).unwrap();
        assert!(is_test_folder(&f));
        fs::write(f.join("a.mkv"), b"1").unwrap();
        let other = d.join("My recordings");
        fs::create_dir_all(&other).unwrap();
        assert!(remove_folder(&other).is_err());
        assert!(other.exists());
        assert!(!is_test_folder(&d.join(FOLDER_PREFIX)));
        remove_folder(&f).unwrap();
        assert!(!f.exists());
        // Already gone is fine.
        remove_folder(&f).unwrap();
        let _ = fs::remove_dir_all(d);
    }

    #[test]
    fn only_test_replays_are_removed() {
        let d = temp("replays");
        let replays = d.join("replays");
        fs::create_dir_all(&replays).unwrap();
        let mine = replays.join("replay-abc-1.webm");
        let theirs = replays.join("highlight-1.webm");
        let outside = d.join("replay-x.webm");
        for p in [&mine, &theirs, &outside] {
            fs::write(p, b"1").unwrap();
        }
        let list: Vec<String> = [&mine, &theirs, &outside]
            .iter()
            .map(|p| p.to_string_lossy().into_owned())
            .collect();
        assert_eq!(remove_replays(&replays, &list), 1);
        assert!(!mine.exists() && theirs.exists() && outside.exists());
        let _ = fs::remove_dir_all(d);
    }

    #[test]
    fn media_arguments() {
        let out = Path::new("dir/Test video.mp4");
        let a = video_args(out, 30, VideoCodec::H264);
        let joined = a.join(" ");
        assert!(joined.contains("testsrc2=size=1920x1080:rate=30"));
        assert!(joined.contains("sine=frequency=440"));
        assert!(joined.contains("-t 30"));
        assert!(joined.contains("libx264") && joined.contains("aac"));
        assert_eq!(a.last().unwrap(), "dir/Test video.mp4");
        assert!(video_args(out, 5, VideoCodec::Vp8)
            .join(" ")
            .contains("libvpx"));
        assert!(video_args(out, 5, VideoCodec::Mpeg4)
            .join(" ")
            .contains("mpeg4"));
        assert_eq!(VideoCodec::Vp8.extension(), "webm");
        let p = picture_args(Path::new("s.png"), PICTURES[0]);
        assert!(p.join(" ").contains("-frames:v 1"));
        assert_eq!(p.last().unwrap(), "s.png");
        let pr = probe_args(Path::new("r.mkv")).join(" ");
        assert!(pr.contains("-i r.mkv") && pr.ends_with("-f null -"));
    }

    #[test]
    fn missing_ffmpeg_is_reported_not_fatal() {
        let d = temp("noffmpeg");
        let m = make_media(Path::new("/no/such/ffmpeg"), &d);
        assert_eq!(m.video, None);
        assert!(m.slides.is_empty() && m.image.is_none());
        assert!(!m.errors.is_empty());
        assert!(probe(Path::new("/no/such/ffmpeg"), Path::new("x.mkv")).is_err());
        let _ = fs::remove_dir_all(d);
    }

    #[test]
    fn disk_speed_writes_and_cleans_up() {
        let d = temp("disk");
        let speed = disk_write_speed(&d, 2).unwrap();
        assert!(speed > 0.0);
        assert!(!d.join("disk-speed.tmp").exists());
        assert!(disk_write_speed(&d.join("missing"), 1).is_err());
        let _ = fs::remove_dir_all(d);
    }

    #[test]
    fn stats() {
        assert!((mb_per_s(10_000_000, 2.0) - 5.0).abs() < 1e-9);
        assert!(mb_per_s(1, 0.0).abs() < f64::EPSILON);
        assert_eq!(parse_speed("frame= 300 fps= 30 q=28.0 size= 1024kB time=00:00:10.00 bitrate= 838.9kbits/s speed=1.02x"), Some(1.02));
        assert_eq!(parse_speed("speed= 0.5x"), Some(0.5));
        assert_eq!(parse_speed("speed=N/A"), None);
        assert_eq!(parse_speed("nothing"), None);
    }

    #[test]
    fn reads_a_recording_check() {
        let text = "Input #0, matroska,webm, from 'r.mkv':\n  Duration: 00:01:02.50, start: 0.000000, bitrate: 1 kb/s\n  Stream #0:0: Video: h264, yuv420p, 1920x1080\n  Stream #0:1: Audio: opus, 48000 Hz, stereo\nOutput #0, null, to 'pipe:':\n  Stream #0:0: Video: wrapped_avframe\n  Stream #0:1: Audio: pcm_s16le\nframe= 100 fps=0.0\rframe= 1875 fps=0.0 q=-0.0 Lsize=N/A time=00:01:02.50\n";
        let p = parse_probe(text, true);
        assert_eq!(p.frames, 1875);
        assert!((p.seconds.unwrap() - 62.5).abs() < 1e-9);
        assert!(p.video);
        assert_eq!(p.audio_streams, 1);
        let bad = parse_probe("r.mkv: Invalid data found when processing input", false);
        assert_eq!(
            (bad.frames, bad.video, bad.audio_streams, bad.ok),
            (0, false, 0, false)
        );
        assert_eq!(bad.seconds, None);
    }

    #[test]
    fn stream_test_addresses() {
        assert_eq!(
            host_port("rtmp://a.rtmp.youtube.com/live2"),
            Some(("a.rtmp.youtube.com".into(), 1935))
        );
        assert_eq!(
            host_port("rtmps://live-api-s.facebook.com:443/rtmp/"),
            Some(("live-api-s.facebook.com".into(), 443))
        );
        assert_eq!(
            host_port("rtmp://127.0.0.1:5000/live"),
            Some(("127.0.0.1".into(), 5000))
        );
        assert_eq!(host_port("rtmp://u:p@host/x"), Some(("host".into(), 1935)));
        assert_eq!(host_port("srt://host:9000"), None);
        assert_eq!(host_port("nonsense"), None);
        assert_eq!(host_port("rtmp://"), None);
        let (url, key) = receiver_url(4242);
        assert_eq!(url, "rtmp://127.0.0.1:4242/live");
        assert_eq!(key, "test");
        let a = receiver_args(4242, Path::new("got.flv")).join(" ");
        assert!(
            a.contains("-listen 1")
                && a.contains("rtmp://127.0.0.1:4242/live/test")
                && a.ends_with("got.flv")
        );
        assert!(free_port().unwrap() > 0);
    }

    #[test]
    fn reach_checks_without_streaming() {
        let l = std::net::TcpListener::bind(("127.0.0.1", 0)).unwrap();
        let port = l.local_addr().unwrap().port();
        let ok = reach("Local", &format!("rtmp://127.0.0.1:{port}/live"), "abc");
        assert!(ok.reachable && ok.has_key);
        drop(l);
        let none = reach("Gone", &format!("rtmp://127.0.0.1:{port}/live"), "");
        assert!(!none.reachable && !none.has_key);
        let path_key = reach("Odd", "srt://x", "");
        assert!(!path_key.reachable);
        assert!(reach("K", "rtmp://127.0.0.1:1/app/key", "").has_key);
    }

    #[test]
    fn report_files() {
        assert_eq!(
            safe_name("Lumora test report 2026-10-06 14.05"),
            "Lumora test report 2026-10-06 14.05"
        );
        assert_eq!(safe_name("../../etc/passwd"), "-..-etc-passwd");
        assert_eq!(safe_name("..."), "Lumora test report");
        let d = temp("report");
        let saved = save_report(&d.join("Test reports"), "R 1", "# Hi", "{}").unwrap();
        assert!(saved.markdown.ends_with("R 1.md") && saved.json.ends_with("R 1.json"));
        assert_eq!(fs::read_to_string(&saved.markdown).unwrap(), "# Hi");
        assert_eq!(tail("abcdef", 3), "def");
        assert_eq!(tail("ab", 10), "ab");
        let _ = fs::remove_dir_all(d);
    }
}
