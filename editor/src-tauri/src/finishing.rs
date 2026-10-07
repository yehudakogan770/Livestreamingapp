//! Finishing checks and conversions: measuring a finished file's loudness
//! (EBU R128 / ITU-R BS.1770: integrated loudness, true peak, loudness range)
//! and turning a numbered image sequence (DPX, TIFF, PNG, JPEG frames) into
//! one video file to edit.

use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::Stdio;

use serde::Serialize;

use crate::media::quiet;

/// How loud a file is, as FFmpeg's `ebur128` filter measures it.
#[derive(Serialize, Debug, Clone, Copy, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Loudness {
    /// Integrated loudness (LUFS).
    pub integrated: f64,
    /// The highest true peak (dBTP).
    pub true_peak: f64,
    /// Loudness range (LU).
    pub range: f64,
}

/// The number after `key` on a line of FFmpeg's summary ("I:  -14.0 LUFS").
fn value_after(line: &str, key: &str) -> Option<f64> {
    let at = line.find(key)? + key.len();
    let rest = line[at..].trim_start();
    let end = rest
        .find(|c: char| !(c.is_ascii_digit() || c == '.' || c == '-' || c == '+'))
        .unwrap_or(rest.len());
    rest[..end].parse::<f64>().ok()
}

/// Read the summary FFmpeg's `ebur128` filter prints at the end.
#[must_use]
pub fn parse_ebur128(said: &str) -> Option<Loudness> {
    let start = said.rfind("Summary:")?;
    let summary = &said[start..];
    let mut integrated = None;
    let mut true_peak = None;
    let mut range = None;
    let mut section = "";
    for line in summary.lines() {
        let l = line.trim();
        if l.starts_with("Integrated loudness") {
            section = "i";
        } else if l.starts_with("Loudness range") {
            section = "lra";
        } else if l.starts_with("True peak") {
            section = "tp";
        } else if l.starts_with("Sample peak") {
            section = "sp";
        } else if section == "i" && l.starts_with("I:") {
            integrated = value_after(l, "I:");
        } else if section == "lra" && l.starts_with("LRA:") {
            range = value_after(l, "LRA:");
        } else if section == "tp" && l.starts_with("Peak:") {
            true_peak = value_after(l, "Peak:");
        }
    }
    Some(Loudness {
        integrated: integrated?,
        // Silence measures as -inf: treat it as very quiet.
        true_peak: true_peak.unwrap_or(-144.0),
        range: range.unwrap_or(0.0),
    })
}

/// FFmpeg's arguments to measure a file's first sound track.
#[must_use]
pub fn loudness_args(file: &Path) -> Vec<String> {
    vec![
        "-hide_banner".into(),
        "-nostats".into(),
        "-i".into(),
        file.to_string_lossy().into_owned(),
        "-map".into(),
        "0:a:0".into(),
        "-af".into(),
        "ebur128=peak=true".into(),
        "-f".into(),
        "null".into(),
        "-".into(),
    ]
}

/// Measure a file's loudness (it is read once, faster than it plays).
pub fn measure_loudness(ffmpeg: &Path, file: &Path) -> Result<Loudness, String> {
    let mut child = quiet(ffmpeg)
        .args(loudness_args(file))
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("FFmpeg could not start: {e}"))?;
    let mut said = String::new();
    if let Some(mut e) = child.stderr.take() {
        let _ = e.read_to_string(&mut said);
    }
    let _ = child.wait();
    parse_ebur128(&said).ok_or_else(|| {
        if said.contains("matches no streams") {
            "The file has no sound to measure.".to_owned()
        } else {
            "The loudness could not be measured.".to_owned()
        }
    })
}

/// A numbered image sequence: how its file names are made and where it starts.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ImageSequence {
    /// FFmpeg's pattern ("C:/Shots/plate_%04d.dpx").
    pub pattern: String,
    pub start: u64,
    pub frames: u64,
    /// The name before the number ("plate_").
    pub stem: String,
}

/// Split a file name into the part before its last run of digits, the digits and the rest.
fn split_number(name: &str) -> Option<(&str, &str, &str)> {
    let dot = name.rfind('.').unwrap_or(name.len());
    let base = &name[..dot];
    let end = base.rfind(|c: char| c.is_ascii_digit())? + 1;
    let start = base[..end]
        .rfind(|c: char| !c.is_ascii_digit())
        .map_or(0, |i| i + 1);
    Some((&name[..start], &name[start..end], &name[end..]))
}

/// The image sequence a numbered frame belongs to, from the names in its folder.
#[must_use]
pub fn find_sequence(first: &Path, names: &[String]) -> Option<ImageSequence> {
    let name = first.file_name()?.to_string_lossy().into_owned();
    let (stem, digits, rest) = split_number(&name)?;
    let width = digits.len();
    let mut numbers: Vec<u64> = names
        .iter()
        .filter_map(|n| {
            let (s, d, r) = split_number(n)?;
            (s == stem && r.eq_ignore_ascii_case(rest) && d.len() == width)
                .then(|| d.parse().ok())
                .flatten()
        })
        .collect();
    numbers.sort_unstable();
    numbers.dedup();
    let me: u64 = digits.parse().ok()?;
    // The run of frames that follow on from the earliest one with no gap (and includes this one).
    let mut start = me;
    while start > 0 && numbers.binary_search(&(start - 1)).is_ok() {
        start -= 1;
    }
    let mut frames = 0;
    while numbers.binary_search(&(start + frames)).is_ok() {
        frames += 1;
    }
    if frames < 2 {
        return None;
    }
    let folder = first.parent().unwrap_or_else(|| Path::new(""));
    let pattern = folder
        .join(format!("{stem}%0{width}d{rest}"))
        .to_string_lossy()
        .into_owned();
    Some(ImageSequence {
        pattern,
        start,
        frames,
        stem: stem.trim_end_matches(['_', '-', '.', ' ']).to_owned(),
    })
}

/// FFmpeg's arguments to make an image sequence into a high-quality H.264 file at `fps`.
#[must_use]
pub fn sequence_args(seq: &ImageSequence, fps: f64, out: &Path) -> Vec<String> {
    vec![
        "-hide_banner".into(),
        "-y".into(),
        "-framerate".into(),
        format!("{fps}"),
        "-start_number".into(),
        seq.start.to_string(),
        "-i".into(),
        seq.pattern.clone(),
        "-frames:v".into(),
        seq.frames.to_string(),
        "-vf".into(),
        // ProRes 422 HQ (10-bit 4:2:2), so DPX and EXR plates keep room to grade.
        "pad=ceil(iw/2)*2:ceil(ih/2)*2,format=yuv422p10le".into(),
        "-c:v".into(),
        "prores_ks".into(),
        "-profile:v".into(),
        "3".into(),
        "-vendor".into(),
        "apl0".into(),
        out.to_string_lossy().into_owned(),
    ]
}

/// Make the image sequence `first` belongs to into a video next to it. Returns its path.
pub fn make_sequence_video(ffmpeg: &Path, first: &Path, fps: f64) -> Result<PathBuf, String> {
    if !(1.0..=240.0).contains(&fps) {
        return Err("The frame rate must be between 1 and 240.".into());
    }
    let folder = first.parent().ok_or("That file has no folder.")?;
    let names: Vec<String> = fs::read_dir(folder)
        .map_err(|e| format!("The folder could not be read: {e}"))?
        .filter_map(|e| e.ok().map(|e| e.file_name().to_string_lossy().into_owned()))
        .collect();
    let seq = find_sequence(first, &names).ok_or(
        "This picture is not part of a numbered sequence (name_0001.png, name_0002.png…).",
    )?;
    let stem = if seq.stem.is_empty() {
        "Image sequence"
    } else {
        &seq.stem
    };
    let out = folder.join(format!("{stem} ({} frames).mov", seq.frames));
    let status = quiet(ffmpeg)
        .args(sequence_args(&seq, fps, &out))
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .map_err(|e| format!("FFmpeg could not start: {e}"))?;
    if !status.success() || !out.exists() {
        return Err("The image sequence could not be made into a video.".into());
    }
    Ok(out)
}

/// FFmpeg's arguments for one frame of a finished film as a JPEG (`width` wide, the height following).
#[must_use]
pub fn thumbnail_args(film: &Path, seconds: f64, width: u32, out: &Path) -> Vec<String> {
    vec![
        "-hide_banner".into(),
        "-y".into(),
        "-ss".into(),
        format!("{:.3}", seconds.max(0.0)),
        "-i".into(),
        film.to_string_lossy().into_owned(),
        "-frames:v".into(),
        "1".into(),
        "-vf".into(),
        format!("scale={width}:-2:flags=lanczos"),
        "-q:v".into(),
        "2".into(),
        out.to_string_lossy().into_owned(),
    ]
}

/// Save one frame of a finished film as a JPEG thumbnail.
pub fn make_thumbnail(
    ffmpeg: &Path,
    film: &Path,
    seconds: f64,
    width: u32,
    out: &Path,
) -> Result<(), String> {
    let status = quiet(ffmpeg)
        .args(thumbnail_args(film, seconds, width.clamp(160, 3840), out))
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .map_err(|e| format!("FFmpeg could not start: {e}"))?;
    if status.success() && out.exists() {
        Ok(())
    } else {
        Err("The thumbnail could not be made.".into())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const SUMMARY: &str = "[Parsed_ebur128_0 @ 0x55d] t: 9.9  TARGET:-23 LUFS    M: -14.2 S: -14.0     I: -14.1 LUFS       LRA:   5.0 LU  FTPK: -1.3 dBFS  TPK: -1.2 dBFS
[Parsed_ebur128_0 @ 0x55d] Summary:

  Integrated loudness:
    I:         -14.1 LUFS
    Threshold: -24.4 LUFS

  Loudness range:
    LRA:         5.2 LU
    Threshold:  -34.3 LUFS
    LRA low:    -18.1 LUFS
    LRA high:   -12.9 LUFS

  True peak:
    Peak:        -1.2 dBFS
";

    #[test]
    fn reads_the_summary() {
        let l = parse_ebur128(SUMMARY).expect("summary");
        assert!((l.integrated - -14.1).abs() < 1e-9);
        assert!((l.true_peak - -1.2).abs() < 1e-9);
        assert!((l.range - 5.2).abs() < 1e-9);
    }

    #[test]
    fn silence_and_nothing() {
        let silent = "Summary:\n  Integrated loudness:\n    I:  -70.0 LUFS\n  True peak:\n    Peak:  -inf dBFS\n";
        let l = parse_ebur128(silent).expect("summary");
        assert!((l.integrated - -70.0).abs() < 1e-9);
        assert!((l.true_peak - -144.0).abs() < 1e-9);
        assert_eq!(parse_ebur128("Stream #0:0: Video: h264"), None);
    }

    #[test]
    fn measures_the_first_sound_track() {
        let a = loudness_args(Path::new("film.mp4"));
        assert!(a.windows(2).any(|w| w[0] == "-map" && w[1] == "0:a:0"));
        assert!(a.contains(&"ebur128=peak=true".to_owned()));
    }

    fn names(list: &[&str]) -> Vec<String> {
        list.iter().map(|s| (*s).to_owned()).collect()
    }

    #[test]
    fn finds_numbered_sequences() {
        let all = names(&[
            "plate_0998.dpx",
            "plate_0999.dpx",
            "plate_1000.dpx",
            "plate_1001.dpx",
            "plate_1003.dpx",
            "other_0999.dpx",
            "plate_0999.png",
            "notes.txt",
        ]);
        let s = find_sequence(Path::new("/shots/plate_1000.dpx"), &all).expect("sequence");
        assert_eq!(s.start, 998);
        assert_eq!(s.frames, 4);
        assert_eq!(s.stem, "plate");
        assert!(s.pattern.ends_with("plate_%04d.dpx"));
        assert_eq!(
            find_sequence(Path::new("/shots/notes.txt"), &all),
            None,
            "no number"
        );
        assert_eq!(
            find_sequence(Path::new("/shots/plate_1003.dpx"), &all),
            None,
            "a single frame"
        );
        let from_one = names(&["1.png", "2.png", "3.png"]);
        let s = find_sequence(Path::new("1.png"), &from_one).expect("sequence");
        assert_eq!((s.start, s.frames, s.stem.as_str()), (1, 3, ""));
    }

    #[test]
    fn thumbnail_arguments() {
        let a = thumbnail_args(Path::new("film.mp4"), 12.5, 1280, Path::new("film.jpg"));
        assert!(a.windows(2).any(|w| w[0] == "-ss" && w[1] == "12.500"));
        assert!(a.contains(&"scale=1280:-2:flags=lanczos".to_owned()));
        assert_eq!(a.last().map(String::as_str), Some("film.jpg"));
    }

    #[test]
    fn sequence_video_arguments() {
        let s = ImageSequence {
            pattern: "/shots/plate_%04d.dpx".into(),
            start: 998,
            frames: 4,
            stem: "plate".into(),
        };
        let a = sequence_args(&s, 23.976, Path::new("/shots/plate.mov"));
        assert!(a
            .windows(2)
            .any(|w| w[0] == "-start_number" && w[1] == "998"));
        assert!(a
            .windows(2)
            .any(|w| w[0] == "-framerate" && w[1] == "23.976"));
        assert!(a.windows(2).any(|w| w[0] == "-frames:v" && w[1] == "4"));
        assert!(a.windows(2).any(|w| w[0] == "-c:v" && w[1] == "prores_ks"));
        assert!(a.windows(2).any(|w| w[0] == "-profile:v" && w[1] == "3"));
        assert_eq!(a.last().map(String::as_str), Some("/shots/plate.mov"));
    }
}
