//! The end-to-end self-test's Rust side, for Lumora and Lumora Studio.
//!
//! The CI test builds (made with `VITE_LUMORA_E2E=1`) carry a self-test in
//! their screens. When the program is started with `LUMORA_SELFTEST` set to a
//! file path, the screens run their scenario, hand the results here to be
//! written to exactly that path, and the program closes. The installers people
//! download have no self-test in their screens, so nothing calls this there;
//! and every call here refuses unless `LUMORA_SELFTEST` is set, so it does
//! nothing in a normal run either way.

use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

/// Where the results go (a file path). Unset: no self-test.
pub const RESULTS_ENV: &str = "LUMORA_SELFTEST";
/// Lumora Studio: the folder with the demo project's media (e2e/make-media.mjs).
pub const MEDIA_ENV: &str = "E2E_MEDIA";
/// How long the whole run may take, in seconds, before the program gives up and closes.
pub const TIMEOUT_ENV: &str = "LUMORA_SELFTEST_TIMEOUT";
/// `FFmpeg` to check files with (the program's own when unset).
pub const FFMPEG_ENV: &str = "FFMPEG";

const DEFAULT_TIMEOUT: Duration = Duration::from_mins(20);
const NOT_A_RUN: &str = "Not a self-test run (LUMORA_SELFTEST is not set)";

static FINISHED: AtomicBool = AtomicBool::new(false);

/// What the screens need to know to run the self-test.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Config {
    /// The results file.
    pub results: String,
    /// Lumora Studio's demo media folder.
    pub media: Option<String>,
}

fn non_empty(v: Option<String>) -> Option<String> {
    v.map(|s| s.trim().to_owned()).filter(|s| !s.is_empty())
}

/// The self-test settings, read with `get` (the environment, or a test's own).
pub fn config_from(get: impl Fn(&str) -> Option<String>) -> Option<Config> {
    let results = non_empty(get(RESULTS_ENV))?;
    Some(Config {
        results,
        media: non_empty(get(MEDIA_ENV)),
    })
}

/// The self-test settings (None in a normal run).
pub fn config() -> Option<Config> {
    config_from(|k| std::env::var(k).ok())
}

fn require() -> Result<Config, String> {
    config().ok_or_else(|| NOT_A_RUN.to_owned())
}

/// Writes the results (a JSON object) to `path`, through a temporary file so a
/// half-written file is never read.
///
/// # Errors
/// The results are not a JSON object, or the file can't be written.
pub fn write_results_to(path: &Path, json: &str) -> Result<(), String> {
    let value: serde_json::Value =
        serde_json::from_str(json).map_err(|e| format!("The results are not JSON: {e}"))?;
    if !value.is_object() {
        return Err("The results must be a JSON object".to_owned());
    }
    if let Some(dir) = path.parent().filter(|d| !d.as_os_str().is_empty()) {
        fs::create_dir_all(dir).map_err(|e| format!("Could not make {}: {e}", dir.display()))?;
    }
    let tmp = path.with_extension("partial");
    let text = serde_json::to_string_pretty(&value).map_err(|e| e.to_string())?;
    fs::write(&tmp, text).map_err(|e| format!("Could not write {}: {e}", tmp.display()))?;
    fs::rename(&tmp, path).map_err(|e| format!("Could not write {}: {e}", path.display()))
}

/// Writes the results to the `LUMORA_SELFTEST` file (that file only).
///
/// # Errors
/// Not a self-test run, or the file can't be written.
pub fn write_results(json: &str) -> Result<PathBuf, String> {
    let path = PathBuf::from(require()?.results);
    write_results_to(&path, json)?;
    FINISHED.store(true, Ordering::SeqCst);
    Ok(path)
}

fn millis() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |d| d.as_millis())
}

/// A new, empty folder in the temporary folder (for a test recording).
///
/// # Errors
/// Not a self-test run, or the folder can't be made.
pub fn temp_folder(name: &str) -> Result<String, String> {
    require()?;
    let clean: String = name
        .chars()
        .filter(char::is_ascii_alphanumeric)
        .take(24)
        .collect();
    let dir = std::env::temp_dir().join(format!(
        "lumora-selftest-{clean}-{}-{}",
        std::process::id(),
        millis()
    ));
    fs::create_dir_all(&dir).map_err(|e| format!("Could not make {}: {e}", dir.display()))?;
    Ok(dir.to_string_lossy().into_owned())
}

/// A video file a run made.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VideoFile {
    pub path: String,
    pub size: u64,
}

const VIDEO_EXTENSIONS: [&str; 4] = ["webm", "mp4", "mov", "mkv"];

fn collect_videos(dir: &Path, depth: u32, found: &mut Vec<VideoFile>) {
    let Ok(entries) = fs::read_dir(dir) else {
        return;
    };
    for e in entries.flatten() {
        let p = e.path();
        let Ok(meta) = e.metadata() else { continue };
        if meta.is_dir() {
            if depth < 4 {
                collect_videos(&p, depth + 1, found);
            }
            continue;
        }
        let ext = p
            .extension()
            .and_then(|x| x.to_str())
            .unwrap_or("")
            .to_ascii_lowercase();
        if VIDEO_EXTENSIONS.contains(&ext.as_str()) {
            found.push(VideoFile {
                path: p.to_string_lossy().into_owned(),
                size: meta.len(),
            });
        }
    }
}

/// The video files in a folder (and a few folders down), sorted by path.
pub fn videos_in(folder: &Path) -> Vec<VideoFile> {
    let mut found = Vec::new();
    collect_videos(folder, 0, &mut found);
    found.sort_by(|a, b| a.path.cmp(&b.path));
    found
}

/// The video files in a folder.
///
/// # Errors
/// Not a self-test run.
pub fn videos(folder: &str) -> Result<Vec<VideoFile>, String> {
    require()?;
    Ok(videos_in(Path::new(folder)))
}

/// What `FFmpeg` read in a file when it decoded all of it.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Decoded {
    /// Video frames decoded.
    pub frames: u64,
    /// The length `FFmpeg` reports (None: it reports none).
    pub seconds: Option<f64>,
    /// The file has a video stream.
    pub video: bool,
    /// `FFmpeg` finished without an error.
    pub ok: bool,
    /// The end of what `FFmpeg` said (for a failed check).
    pub text: String,
}

/// Reads `FFmpeg`'s words after `ffmpeg -i file -map 0:v:0 -f null -`.
pub fn parse_decode(text: &str, ok: bool) -> Decoded {
    let frames = text
        .split(['\r', '\n'])
        .filter_map(|line| {
            let i = line.find("frame=")?;
            line[i + 6..].split_whitespace().next()?.parse::<u64>().ok()
        })
        .next_back()
        .unwrap_or(0);
    let seconds = text.find("Duration: ").and_then(|i| {
        let t = text[i + 10..].split([',', ' ']).next()?;
        let mut parts = t.split(':');
        let h: f64 = parts.next()?.parse().ok()?;
        let m: f64 = parts.next()?.parse().ok()?;
        let s: f64 = parts.next()?.parse().ok()?;
        Some(h * 3600.0 + m * 60.0 + s)
    });
    let video = text
        .lines()
        .any(|l| l.contains("Stream #") && l.contains("Video:"));
    let start = text.char_indices().rev().nth(1499).map_or(0, |(i, _)| i);
    Decoded {
        frames,
        seconds,
        video,
        ok,
        text: text[start..].to_owned(),
    }
}

/// `FFmpeg` to check files with: `FFMPEG` when set, else the program's own.
pub fn ffmpeg_for(own: Option<PathBuf>) -> Option<PathBuf> {
    non_empty(std::env::var(FFMPEG_ENV).ok())
        .map(PathBuf::from)
        .or(own)
}

/// Decodes the whole of a file's first video stream with `FFmpeg` (a broken file fails here).
///
/// # Errors
/// Not a self-test run, no `FFmpeg`, or `FFmpeg` can't start.
pub fn decode(ffmpeg: Option<&Path>, file: &str) -> Result<Decoded, String> {
    require()?;
    let ffmpeg = ffmpeg.ok_or("FFmpeg was not found")?;
    #[allow(unused_mut)]
    let mut cmd = Command::new(ffmpeg);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000);
    }
    let out = cmd
        .args([
            "-hide_banner",
            "-nostdin",
            "-i",
            file,
            "-map",
            "0:v:0",
            "-f",
            "null",
            "-",
        ])
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .output()
        .map_err(|e| format!("FFmpeg could not start: {e}"))?;
    Ok(parse_decode(
        &String::from_utf8_lossy(&out.stderr),
        out.status.success(),
    ))
}

fn timeout_from(v: Option<String>) -> Duration {
    non_empty(v)
        .and_then(|s| s.parse::<u64>().ok())
        .filter(|s| *s > 0)
        .map_or(DEFAULT_TIMEOUT, Duration::from_secs)
}

/// In a self-test run: if the screens never hand in their results (they hung,
/// or never started), write a failed result and close the program (`exit`).
pub fn watchdog(exit: impl FnOnce() + Send + 'static) {
    let Some(cfg) = config() else { return };
    let limit = timeout_from(std::env::var(TIMEOUT_ENV).ok());
    let _ = std::thread::Builder::new()
        .name("selftest-watchdog".into())
        .spawn(move || {
            std::thread::sleep(limit);
            if FINISHED.load(Ordering::SeqCst) {
                return;
            }
            let failed = serde_json::json!({
                "ok": false,
                "error": format!("The self-test did not finish within {} s", limit.as_secs()),
                "steps": [],
            });
            let _ = write_results_to(Path::new(&cfg.results), &failed.to_string());
            exit();
        });
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp(name: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!(
            "lumora-selftest-test-{name}-{}",
            std::process::id()
        ));
        let _ = fs::remove_dir_all(&d);
        fs::create_dir_all(&d).unwrap();
        d
    }

    #[test]
    fn config_needs_the_results_path() {
        assert_eq!(config_from(|_| None), None);
        assert_eq!(
            config_from(|k| (k == RESULTS_ENV).then(|| "  ".to_owned())),
            None
        );
        let c = config_from(|k| match k {
            RESULTS_ENV => Some("C:/out/lumora.json".to_owned()),
            MEDIA_ENV => Some("C:/media".to_owned()),
            _ => None,
        })
        .unwrap();
        assert_eq!(c.results, "C:/out/lumora.json");
        assert_eq!(c.media.as_deref(), Some("C:/media"));
    }

    #[test]
    fn nothing_works_outside_a_run() {
        if std::env::var(RESULTS_ENV).is_ok() {
            return;
        }
        assert!(write_results("{}").is_err());
        assert!(temp_folder("x").is_err());
        assert!(videos(".").is_err());
        assert!(decode(Some(Path::new("ffmpeg")), "x.mp4").is_err());
    }

    #[test]
    fn writes_only_json_objects() {
        let d = temp("write");
        let f = d.join("sub").join("results.json");
        assert!(write_results_to(&f, "not json").is_err());
        assert!(write_results_to(&f, "[1,2]").is_err());
        write_results_to(&f, r#"{"ok":true,"steps":[]}"#).unwrap();
        let back: serde_json::Value =
            serde_json::from_str(&fs::read_to_string(&f).unwrap()).unwrap();
        assert_eq!(back["ok"], true);
        assert!(!f.with_extension("partial").exists());
        let _ = fs::remove_dir_all(d);
    }

    #[test]
    fn finds_videos() {
        let d = temp("videos");
        fs::create_dir_all(d.join("a")).unwrap();
        fs::write(d.join("a").join("one.MP4"), b"1234").unwrap();
        fs::write(d.join("two.webm"), b"12").unwrap();
        fs::write(d.join("notes.txt"), b"x").unwrap();
        let v = videos_in(&d);
        assert_eq!(v.len(), 2);
        assert!(v.iter().any(|f| f.path.ends_with("one.MP4") && f.size == 4));
        assert!(videos_in(&d.join("missing")).is_empty());
        let _ = fs::remove_dir_all(d);
    }

    #[test]
    fn reads_ffmpeg() {
        let text = "Input #0, matroska,webm, from 'x.webm':\n  Duration: 00:00:02.04, start: 0.000000, bitrate: 1 kb/s\n  Stream #0:0: Video: vp8, yuv420p, 320x180\nframe=   10 fps=0.0 q=-0.0 size=N/A\rframe=   31 fps=0.0 q=-0.0 Lsize=N/A time=00:00:02.00\n";
        let d = parse_decode(text, true);
        assert_eq!(d.frames, 31);
        assert!((d.seconds.unwrap() - 2.04).abs() < 1e-9);
        assert!(d.video && d.ok);
        let none = parse_decode("x.webm: Invalid data found", false);
        assert_eq!(none.frames, 0);
        assert_eq!(none.seconds, None);
        assert!(!none.video);
        let n = parse_decode("Duration: N/A, bitrate", true);
        assert_eq!(n.seconds, None);
    }

    #[test]
    fn timeout_setting() {
        assert_eq!(timeout_from(None), DEFAULT_TIMEOUT);
        assert_eq!(timeout_from(Some("0".into())), DEFAULT_TIMEOUT);
        assert_eq!(timeout_from(Some("x".into())), DEFAULT_TIMEOUT);
        assert_eq!(timeout_from(Some("90".into())), Duration::from_secs(90));
    }
}
