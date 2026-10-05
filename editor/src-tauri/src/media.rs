//! Getting an event's recordings ready to edit: what is in each file, making
//! browser recordings seekable (they are written without an index), and the
//! sound pictures (waveforms) on the timeline.

use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

use serde::Serialize;

/// A command that never opens a console window on Windows.
pub fn quiet(program: &Path) -> Command {
    #[allow(unused_mut)]
    let mut cmd = Command::new(program);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000);
    }
    cmd.stdin(Stdio::null());
    cmd
}

/// FFmpeg next to Lumora Edit, or on the computer.
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
        let ok = quiet(Path::new(exe))
            .arg("-version")
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()
            .is_ok_and(|s| s.success());
        ok.then(|| PathBuf::from(exe))
    })
}

/// What is in a recording.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct Probe {
    pub duration_ms: Option<f64>,
    pub video: Option<String>,
    pub audio: bool,
    pub audio_codec: Option<String>,
    pub width: u32,
    pub height: u32,
    pub fps: f64,
    /** A still picture (one frame, an image format). */
    pub still: bool,
}

/// Read what FFmpeg says about a file (`ffmpeg -i file`).
#[must_use]
pub fn parse_probe(said: &str) -> Probe {
    let mut p = Probe::default();
    for line in said.lines() {
        let line = line.trim();
        if let Some(rest) = line.strip_prefix("Duration:") {
            let t = rest.split(',').next().unwrap_or("").trim();
            let parts: Vec<f64> = t.split(':').filter_map(|x| x.parse().ok()).collect();
            if let [h, m, s] = parts[..] {
                p.duration_ms = Some(((h * 60.0 + m) * 60.0 + s) * 1000.0);
            }
        } else if line.starts_with("Stream #") {
            if let Some(i) = line.find("Video: ") {
                if p.video.is_none() {
                    let rest = &line[i + 7..];
                    let codec = rest.split([' ', ',']).next().unwrap_or("").to_owned();
                    // The picture size is the first "123x456" after the codec.
                    if let Some((w, h)) = rest
                        .split([' ', ','])
                        .filter_map(|x| {
                            let (w, h) = x.split_once('x')?;
                            Some((w.parse::<u32>().ok()?, h.parse::<u32>().ok()?))
                        })
                        .find(|&(w, h)| w > 0 && h > 0)
                    {
                        p.width = w;
                        p.height = h;
                    }
                    if let Some(f) = rest.split(',').find_map(|x| {
                        x.trim()
                            .strip_suffix(" fps")
                            .and_then(|n| n.trim().parse::<f64>().ok())
                    }) {
                        p.fps = f;
                    }
                    p.still = matches!(
                        codec.as_str(),
                        "png" | "mjpeg" | "webp" | "bmp" | "tiff" | "gif" | "hevc_image"
                    ) && p.fps <= 0.0;
                    p.video = Some(codec);
                }
            } else if let Some(i) = line.find("Audio: ") {
                p.audio = true;
                if p.audio_codec.is_none() {
                    p.audio_codec = line[i + 7..].split([' ', ',']).next().map(str::to_owned);
                }
            }
        }
    }
    p
}

/// # Errors
/// FFmpeg can't run.
pub fn probe(ffmpeg: &Path, file: &Path) -> Result<Probe, String> {
    let out = quiet(ffmpeg)
        .args(["-hide_banner", "-i"])
        .arg(file)
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .output()
        .map_err(|e| format!("FFmpeg could not start: {e}"))?;
    Ok(parse_probe(&String::from_utf8_lossy(&out.stderr)))
}

/// A recording, ready to edit.
#[derive(Serialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Prepared {
    pub path: String,
    /// What plays while editing, when the file itself can't (made by Lumora Edit).
    pub proxy: Option<String>,
    pub fps: f64,
    pub duration_ms: f64,
    pub has_video: bool,
    pub has_audio: bool,
    pub width: u32,
    pub height: u32,
}

fn ext_of(p: &Path) -> String {
    p.extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_ascii_lowercase()
}

/// What a recording should become so it plays and seeks well while editing
/// (None: it is fine as it is). Only the container changes, never the picture.
#[must_use]
pub fn remux_target(file: &Path, p: &Probe) -> Option<PathBuf> {
    let ext = ext_of(file);
    let h264 = p.video.as_deref() == Some("h264");
    match ext.as_str() {
        "mkv" if h264 => Some(file.with_extension("mp4")),
        "mkv" => Some(file.with_extension("webm")),
        "webm" if p.duration_ms.is_none() => Some(file.with_extension("webm")),
        _ => None,
    }
}

/// Make a recording ready to edit. Browser recordings get an index (a quick
/// copy, no quality lost) and the copy takes the original's place.
///
/// # Errors
/// The file is missing, or can't be read.
pub fn prepare(ffmpeg: &Path, file: &Path) -> Result<Prepared, String> {
    if !file.is_file() {
        return Err(format!(
            "{} is missing. Keep the event file in the same place as its recordings.",
            file.file_name()
                .and_then(|n| n.to_str())
                .unwrap_or("A recording")
        ));
    }
    let mut info = probe(ffmpeg, file)?;
    let mut path = file.to_path_buf();
    if let Some(target) = remux_target(file, &info) {
        let temp = target.with_extension(format!("editing.{}", ext_of(&target)));
        let mut cmd = quiet(ffmpeg);
        cmd.args([
            "-hide_banner",
            "-loglevel",
            "error",
            "-y",
            "-fflags",
            "+genpts",
            "-i",
        ])
        .arg(file)
        .args(["-map", "0", "-c", "copy"]);
        if ext_of(&target) == "mp4" {
            cmd.args(["-movflags", "+faststart"]);
        }
        let out = cmd
            .arg(&temp)
            .stdout(Stdio::null())
            .stderr(Stdio::piped())
            .output()
            .map_err(|e| format!("FFmpeg could not start: {e}"))?;
        let before = fs::metadata(file).map(|m| m.len()).unwrap_or(0);
        let after = fs::metadata(&temp).map(|m| m.len()).unwrap_or(0);
        // A good copy is about as big as the original (only the index is new).
        if out.status.success() && after > 0 && after * 10 >= before * 9 {
            if target == file {
                fs::rename(&temp, &target).map_err(|e| e.to_string())?;
            } else {
                fs::rename(&temp, &target).map_err(|e| e.to_string())?;
                let _ = fs::remove_file(file);
            }
            path = target;
            info = probe(ffmpeg, &path)?;
        } else {
            let _ = fs::remove_file(&temp);
        }
    }
    let duration_ms = match info.duration_ms {
        Some(d) => d,
        None => measure(ffmpeg, &path).unwrap_or(0.0),
    };
    Ok(Prepared {
        path: path.to_string_lossy().into_owned(),
        proxy: None,
        fps: if info.fps > 0.0 { info.fps } else { 30.0 },
        duration_ms,
        has_video: info.video.is_some(),
        has_audio: info.audio,
        width: info.width,
        height: info.height,
    })
}

/// How long a file is, by reading it all (for files that don't say).
fn measure(ffmpeg: &Path, file: &Path) -> Option<f64> {
    let out = quiet(ffmpeg)
        .args(["-hide_banner", "-i"])
        .arg(file)
        .args(["-f", "null", "-"])
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .output()
        .ok()?;
    let said = String::from_utf8_lossy(&out.stderr);
    let t = said.rsplit("time=").next()?.split_whitespace().next()?;
    let parts: Vec<f64> = t.split(':').filter_map(|x| x.parse().ok()).collect();
    match parts[..] {
        [h, m, s] => Some(((h * 60.0 + m) * 60.0 + s) * 1000.0),
        _ => None,
    }
}

/// Sound levels per hundredth of a second (0–255), for drawing waveforms.
pub const PEAKS_PER_SECOND: u32 = 100;

/// Loudest point of each step of 16-bit samples, scaled so quiet speech still shows.
#[must_use]
pub fn peaks_of(samples: &[i16], per_peak: usize) -> Vec<u8> {
    samples
        .chunks(per_peak.max(1))
        .map(|c| {
            let most = c.iter().map(|s| s.unsigned_abs()).max().unwrap_or(0);
            let level = f64::from(most) / 32768.0;
            (level.sqrt() * 255.0).round().min(255.0) as u8
        })
        .collect()
}

/// The waveform of a file's sound, kept in `cache` so it is made only once.
///
/// # Errors
/// FFmpeg can't read the file.
pub fn peaks(ffmpeg: &Path, file: &Path, cache: &Path) -> Result<Vec<u8>, String> {
    let meta = fs::metadata(file).map_err(|e| e.to_string())?;
    let stamp = meta
        .modified()
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map_or(0, |d| d.as_secs());
    let key = {
        use std::hash::{Hash, Hasher};
        let mut h = std::collections::hash_map::DefaultHasher::new();
        (file.to_string_lossy(), meta.len(), stamp).hash(&mut h);
        format!("{:016x}.peaks", h.finish())
    };
    let cached = cache.join(&key);
    if let Ok(bytes) = fs::read(&cached) {
        return Ok(bytes);
    }
    const RATE: u32 = 8000;
    let mut child = quiet(ffmpeg)
        .args(["-hide_banner", "-loglevel", "error", "-i"])
        .arg(file)
        .args([
            "-vn",
            "-ac",
            "1",
            "-ar",
            &RATE.to_string(),
            "-f",
            "s16le",
            "-",
        ])
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|e| format!("FFmpeg could not start: {e}"))?;
    let mut raw = Vec::new();
    if let Some(mut out) = child.stdout.take() {
        out.read_to_end(&mut raw).map_err(|e| e.to_string())?;
    }
    let _ = child.wait();
    let samples: Vec<i16> = raw
        .as_chunks::<2>()
        .0
        .iter()
        .map(|b| i16::from_le_bytes(*b))
        .collect();
    let peaks = peaks_of(&samples, (RATE / PEAKS_PER_SECOND) as usize);
    let _ = fs::create_dir_all(cache);
    let _ = fs::write(&cached, &peaks);
    Ok(peaks)
}

/// What a file needs before it can be edited smoothly.
#[derive(Debug, PartialEq, Eq)]
pub enum Needs {
    /// It plays as it is.
    Nothing,
    /// The same pictures in a container the editor reads (a quick copy).
    Rewrap,
    /// A new copy the editor can play (takes a while for long files).
    Optimize,
    /// A still picture in a format the editor can't show.
    Picture,
    /// Sound in a format the editor can't play.
    Sound,
}

const PLAYS: [&str; 4] = ["h264", "vp8", "vp9", "av1"];
const SOUNDS: [&str; 9] = [
    "aac",
    "mp3",
    "opus",
    "vorbis",
    "flac",
    "pcm_s16le",
    "pcm_s24le",
    "pcm_f32le",
    "pcm_s32le",
];

#[must_use]
pub fn needs(file: &Path, p: &Probe) -> Needs {
    let ext = ext_of(file);
    let picture_ext = matches!(
        ext.as_str(),
        "png" | "jpg" | "jpeg" | "webp" | "gif" | "bmp" | "avif"
    );
    if picture_ext {
        return Needs::Nothing;
    }
    if matches!(
        ext.as_str(),
        "tif" | "tiff" | "heic" | "heif" | "psd" | "tga" | "exr" | "dpx"
    ) {
        return Needs::Picture;
    }
    match &p.video {
        Some(v) if !p.still => {
            let audio_ok = p.audio_codec.as_deref().is_none_or(|a| SOUNDS.contains(&a));
            if !PLAYS.contains(&v.as_str()) || !audio_ok {
                Needs::Optimize
            } else if matches!(ext.as_str(), "mp4" | "webm") {
                Needs::Nothing
            } else {
                Needs::Rewrap
            }
        }
        Some(_) => Needs::Picture,
        None => {
            let ok_ext = matches!(
                ext.as_str(),
                "mp3" | "wav" | "m4a" | "aac" | "ogg" | "oga" | "opus" | "flac" | "webm"
            );
            if ok_ext && p.audio_codec.as_deref().is_none_or(|a| SOUNDS.contains(&a)) {
                Needs::Nothing
            } else {
                Needs::Sound
            }
        }
    }
}

/// A name for a made copy that changes when the original does.
fn cache_name(file: &Path, ext: &str) -> String {
    use std::hash::{Hash, Hasher};
    let meta = fs::metadata(file).ok();
    let stamp = meta
        .as_ref()
        .and_then(|m| m.modified().ok())
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map_or(0, |d| d.as_secs());
    let mut h = std::collections::hash_map::DefaultHasher::new();
    (file.to_string_lossy(), meta.map_or(0, |m| m.len()), stamp).hash(&mut h);
    let stem = file
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("media")
        .chars()
        .filter(|c| c.is_ascii_alphanumeric() || *c == '-' || *c == '_')
        .take(40)
        .collect::<String>();
    format!("{stem}-{:012x}.{ext}", h.finish() & 0xffff_ffff_ffff)
}

/// Run FFmpeg, saying how far along it is (0–1).
fn run_with_progress(
    ffmpeg: &Path,
    args: &[std::ffi::OsString],
    seconds: f64,
    progress: &dyn Fn(f64),
) -> Result<(), String> {
    use std::io::{BufRead, BufReader};
    let mut child = quiet(ffmpeg)
        .args([
            "-hide_banner",
            "-nostdin",
            "-y",
            "-loglevel",
            "error",
            "-progress",
            "pipe:1",
        ])
        .args(args)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("FFmpeg could not start: {e}"))?;
    let stderr = child.stderr.take();
    let said = std::thread::spawn(move || {
        let mut s = String::new();
        if let Some(mut e) = stderr {
            let _ = e.read_to_string(&mut s);
        }
        s
    });
    if let Some(out) = child.stdout.take() {
        for line in BufReader::new(out).lines().map_while(Result::ok) {
            if let Some(us) = line
                .strip_prefix("out_time_us=")
                .and_then(|v| v.trim().parse::<f64>().ok())
            {
                if seconds > 0.0 {
                    progress((us / 1_000_000.0 / seconds).clamp(0.0, 1.0));
                }
            }
        }
    }
    let ok = child.wait().map(|s| s.success()).unwrap_or(false);
    let said = said.join().unwrap_or_default();
    if ok {
        Ok(())
    } else {
        Err(format!(
            "This file could not be read: {}",
            said.lines()
                .rfind(|l| !l.trim().is_empty())
                .unwrap_or("unknown problem")
        ))
    }
}

/// Get any file ready to edit. The original is never changed: when it can't
/// be played as it is, a copy that can is made in `cache` (and used while editing).
///
/// # Errors
/// The file is missing or can't be read.
pub fn import(
    ffmpeg: &Path,
    file: &Path,
    cache: &Path,
    progress: &dyn Fn(f64),
) -> Result<Prepared, String> {
    if !file.is_file() {
        return Err(format!("{} was not found.", file.display()));
    }
    let info = probe(ffmpeg, file)?;
    if info.video.is_none() && !info.audio {
        return Err(format!(
            "{} has no picture or sound Lumora Edit can use.",
            file.file_name()
                .and_then(|n| n.to_str())
                .unwrap_or("This file")
        ));
    }
    let need = needs(file, &info);
    let seconds = info.duration_ms.unwrap_or(0.0) / 1000.0;
    let _ = fs::create_dir_all(cache);
    let proxy: Option<PathBuf> = match need {
        Needs::Nothing => None,
        Needs::Rewrap => {
            let out = cache.join(cache_name(file, "mp4"));
            if !out.is_file() {
                let temp = out.with_extension("making.mp4");
                let args: Vec<std::ffi::OsString> = vec![
                    "-i".into(),
                    file.into(),
                    "-map".into(),
                    "0:v:0".into(),
                    "-map".into(),
                    "0:a?".into(),
                    "-c".into(),
                    "copy".into(),
                    "-movflags".into(),
                    "+faststart".into(),
                    temp.clone().into(),
                ];
                if run_with_progress(ffmpeg, &args, seconds, progress).is_err() {
                    // Some files can't simply be rewrapped: make a new copy.
                    let _ = fs::remove_file(&temp);
                    optimize(ffmpeg, file, &temp, seconds, progress)?;
                }
                fs::rename(&temp, &out).map_err(|e| e.to_string())?;
            }
            Some(out)
        }
        Needs::Optimize => {
            let out = cache.join(cache_name(file, "mp4"));
            if !out.is_file() {
                let temp = out.with_extension("making.mp4");
                optimize(ffmpeg, file, &temp, seconds, progress)?;
                fs::rename(&temp, &out).map_err(|e| e.to_string())?;
            }
            Some(out)
        }
        Needs::Picture => {
            let out = cache.join(cache_name(file, "png"));
            if !out.is_file() {
                let args: Vec<std::ffi::OsString> = vec![
                    "-i".into(),
                    file.into(),
                    "-frames:v".into(),
                    "1".into(),
                    out.clone().into(),
                ];
                run_with_progress(ffmpeg, &args, 0.0, progress)?;
            }
            Some(out)
        }
        Needs::Sound => {
            let out = cache.join(cache_name(file, "m4a"));
            if !out.is_file() {
                let temp = out.with_extension("making.m4a");
                let args: Vec<std::ffi::OsString> = vec![
                    "-i".into(),
                    file.into(),
                    "-vn".into(),
                    "-c:a".into(),
                    "aac".into(),
                    "-b:a".into(),
                    "256k".into(),
                    temp.clone().into(),
                ];
                run_with_progress(ffmpeg, &args, seconds, progress)?;
                fs::rename(&temp, &out).map_err(|e| e.to_string())?;
            }
            Some(out)
        }
    };
    let still = matches!(need, Needs::Picture) || info.still;
    let duration_ms = if still {
        0.0
    } else {
        match info.duration_ms {
            Some(d) => d,
            None => measure(ffmpeg, proxy.as_deref().unwrap_or(file)).unwrap_or(0.0),
        }
    };
    Ok(Prepared {
        path: file.to_string_lossy().into_owned(),
        proxy: proxy.map(|p| p.to_string_lossy().into_owned()),
        fps: if info.fps > 0.0 { info.fps } else { 30.0 },
        duration_ms,
        has_video: info.video.is_some(),
        has_audio: info.audio && !still,
        width: info.width,
        height: info.height,
    })
}

/// A copy that plays smoothly while editing (H.264, a keyframe every half second for quick jumps).
fn optimize(
    ffmpeg: &Path,
    file: &Path,
    out: &Path,
    seconds: f64,
    progress: &dyn Fn(f64),
) -> Result<(), String> {
    let args: Vec<std::ffi::OsString> = vec![
        "-i".into(),
        file.into(),
        "-map".into(),
        "0:v:0".into(),
        "-map".into(),
        "0:a?".into(),
        "-c:v".into(),
        "libx264".into(),
        "-preset".into(),
        "veryfast".into(),
        "-crf".into(),
        "17".into(),
        "-pix_fmt".into(),
        "yuv420p".into(),
        "-g".into(),
        "15".into(),
        "-c:a".into(),
        "aac".into(),
        "-b:a".into(),
        "256k".into(),
        "-ac".into(),
        "2".into(),
        "-movflags".into(),
        "+faststart".into(),
        out.into(),
    ];
    run_with_progress(ffmpeg, &args, seconds, progress)
}

/// Small pictures of a video along its length, in one image (for the timeline and bins).
#[derive(Serialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Strip {
    pub path: String,
    /// Seconds between pictures.
    pub every: f64,
    pub count: u32,
    pub cols: u32,
    pub w: u32,
    pub h: u32,
}

/// # Errors
/// FFmpeg can't read the file.
pub fn strip(ffmpeg: &Path, file: &Path, seconds: f64, cache: &Path) -> Result<Strip, String> {
    const W: u32 = 160;
    const H: u32 = 90;
    const COLS: u32 = 20;
    let every = (seconds / 600.0).max(1.0).ceil();
    let count = ((seconds / every).ceil() as u32).max(1);
    let rows = count.div_ceil(COLS);
    let out = cache.join(cache_name(file, "strip.jpg"));
    let _ = fs::create_dir_all(cache);
    if !out.is_file() {
        let vf = format!(
            "fps=1/{every},scale={W}:{H}:force_original_aspect_ratio=decrease,pad={W}:{H}:(ow-iw)/2:(oh-ih)/2,tile={COLS}x{rows}"
        );
        let ok = quiet(ffmpeg)
            .args([
                "-hide_banner",
                "-loglevel",
                "error",
                "-y",
                "-skip_frame",
                "nokey",
                "-i",
            ])
            .arg(file)
            .args(["-an", "-vf", &vf, "-frames:v", "1", "-q:v", "5"])
            .arg(&out)
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()
            .map_err(|e| format!("FFmpeg could not start: {e}"))?
            .success();
        if !ok || !out.is_file() {
            return Err("No pictures could be made for this file.".into());
        }
    }
    Ok(Strip {
        path: out.to_string_lossy().into_owned(),
        every,
        count,
        cols: COLS,
        w: W,
        h: H,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    const SAID: &str = "Input #0, matroska,webm, from 'Wide.mkv':
  Metadata:
    ENCODER         : Chrome
  Duration: N/A, start: 0.000000, bitrate: N/A
  Stream #0:0(eng): Video: h264 (Constrained Baseline), yuv420p(tv, bt709, progressive), 1920x1080, SAR 1:1 DAR 16:9, 30.30 fps, 30 tbr, 1k tbn (default)
  Stream #0:1(eng): Audio: opus, 48000 Hz, stereo, fltp (default)";

    #[test]
    fn reads_what_ffmpeg_says() {
        let p = parse_probe(SAID);
        assert_eq!(p.duration_ms, None);
        assert_eq!(p.video.as_deref(), Some("h264"));
        assert_eq!((p.width, p.height), (1920, 1080));
        assert!(p.audio);
        let q = parse_probe(
            "  Duration: 01:02:03.50, start: 0.0\n  Stream #0:0: Audio: opus, 48000 Hz",
        );
        assert_eq!(q.duration_ms, Some(3_723_500.0));
        assert!(q.video.is_none());
    }

    #[test]
    fn browser_recordings_get_an_index() {
        let p = parse_probe(SAID);
        assert_eq!(
            remux_target(Path::new("C:/ev/Wide.mkv"), &p),
            Some(PathBuf::from("C:/ev/Wide.mp4"))
        );
        let webm = Probe {
            duration_ms: None,
            ..Probe::default()
        };
        assert_eq!(
            remux_target(Path::new("a/Mic.webm"), &webm),
            Some(PathBuf::from("a/Mic.webm"))
        );
        let done = Probe {
            duration_ms: Some(1000.0),
            ..Probe::default()
        };
        assert_eq!(remux_target(Path::new("a/Mic.webm"), &done), None);
        assert_eq!(remux_target(Path::new("a/Live.mp4"), &p), None);
    }

    #[test]
    fn what_files_need() {
        let mut p = parse_probe(SAID);
        assert_eq!(needs(Path::new("a.mp4"), &p), Needs::Nothing);
        p.audio_codec = Some("pcm_s16be".into());
        assert_eq!(needs(Path::new("a.mp4"), &p), Needs::Optimize);
        p.audio_codec = Some("aac".into());
        assert_eq!(needs(Path::new("a.mov"), &p), Needs::Rewrap);
        p.video = Some("prores".into());
        assert_eq!(needs(Path::new("a.mov"), &p), Needs::Optimize);
        assert_eq!(needs(Path::new("a.heic"), &p), Needs::Picture);
        assert_eq!(needs(Path::new("a.png"), &p), Needs::Nothing);
        let wma = Probe {
            audio: true,
            audio_codec: Some("wmav2".into()),
            ..Probe::default()
        };
        assert_eq!(needs(Path::new("a.wma"), &wma), Needs::Sound);
        let mp3 = Probe {
            audio: true,
            audio_codec: Some("mp3".into()),
            ..Probe::default()
        };
        assert_eq!(needs(Path::new("a.mp3"), &mp3), Needs::Nothing);
        assert!((parse_probe(SAID).fps - 30.30).abs() < 0.01);
    }

    #[test]
    fn waveform_levels() {
        let samples = [0i16, 100, -32768, 5, 0, 0, 0, 0];
        assert_eq!(peaks_of(&samples, 4), vec![255, 0]);
    }

    /// Needs FFmpeg: `cargo test -p lumora-edit -- --ignored`.
    #[test]
    #[ignore = "needs FFmpeg"]
    fn prepares_a_browser_recording() {
        let Some(ffmpeg) = find_ffmpeg() else { return };
        let dir = std::env::temp_dir().join(format!("lumora-edit-media-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        let src = dir.join("Cam.mkv");
        // Written like a browser does: as it goes, so no index or length.
        let ok = quiet(&ffmpeg)
            .args([
                "-loglevel",
                "error",
                "-f",
                "lavfi",
                "-i",
                "testsrc=s=320x240:r=30:d=3",
            ])
            .args([
                "-f", "lavfi", "-i", "sine=d=3", "-c:v", "libx264", "-c:a", "libopus",
            ])
            .args(["-f", "matroska", "-live", "1", "pipe:1"])
            .stdout(fs::File::create(&src).unwrap())
            .status()
            .unwrap();
        assert!(ok.success());
        let p = prepare(&ffmpeg, &src).unwrap();
        assert!(p.path.ends_with("Cam.mp4"), "{}", p.path);
        assert!(!src.exists());
        assert!((p.duration_ms - 3000.0).abs() < 200.0, "{}", p.duration_ms);
        assert!(p.has_video && p.has_audio);
        assert_eq!((p.width, p.height), (320, 240));
        let w = peaks(&ffmpeg, Path::new(&p.path), &dir.join("cache")).unwrap();
        assert!((295..=305).contains(&w.len()), "{}", w.len());
        let _ = fs::remove_dir_all(dir);
    }
}
