//! Transcribing: the Whisper speech models (the same ones Lumora uses for
//! live captions) are downloaded once and kept; if Lumora already has one,
//! it is used from there. The sound is handed to the speech model as 16 kHz
//! mono samples, a stretch of a file at a time.

use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::Duration;

use crate::media::quiet;

/// A speech model: its folder name, where it comes from, and its files
/// (name, path at the original home, smallest size that is complete).
struct Model {
    name: &'static str,
    home: &'static str,
    files: &'static [(&'static str, &'static str, u64)],
}

const MODELS: &[Model] = &[
    Model {
        name: "whisper-base",
        home: "https://huggingface.co/onnx-community/whisper-base/resolve/main",
        files: &[
            (
                "encoder_model_quantized.onnx",
                "onnx/encoder_model_quantized.onnx",
                20_000_000,
            ),
            (
                "decoder_model_merged_quantized.onnx",
                "onnx/decoder_model_merged_quantized.onnx",
                45_000_000,
            ),
            ("tokenizer.json", "tokenizer.json", 1_000_000),
            ("generation_config.json", "generation_config.json", 1_000),
        ],
    },
    Model {
        name: "whisper-small",
        home: "https://huggingface.co/onnx-community/whisper-small/resolve/main",
        files: &[
            (
                "encoder_model_quantized.onnx",
                "onnx/encoder_model_quantized.onnx",
                80_000_000,
            ),
            (
                "decoder_model_merged_quantized.onnx",
                "onnx/decoder_model_merged_quantized.onnx",
                140_000_000,
            ),
            ("tokenizer.json", "tokenizer.json", 1_000_000),
            ("generation_config.json", "generation_config.json", 1_000),
        ],
    },
];

/// Lumora's website keeps a copy of every model (tried first).
const SITE: &str = "https://yehudakogan770.github.io/Livestreamingapp/models";

fn complete(p: &Path, min: u64) -> bool {
    std::fs::metadata(p).is_ok_and(|m| m.len() >= min)
}

fn has_all(folder: &Path, m: &Model) -> bool {
    m.files
        .iter()
        .all(|&(file, _, min)| complete(&folder.join(file), min))
}

/// Download `url` to `to`, telling how many bytes have come so far.
fn download(url: &str, to: &Path, got: &dyn Fn(u64)) -> bool {
    let mut cmd = Command::new("curl");
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000);
    }
    let Ok(mut child) = cmd
        .args(["-fsSL", "--retry", "2", "-o"])
        .arg(to)
        .arg(url)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
    else {
        return false;
    };
    loop {
        match child.try_wait() {
            Ok(Some(status)) => return status.success(),
            Ok(None) => {
                got(std::fs::metadata(to).map_or(0, |m| m.len()));
                std::thread::sleep(Duration::from_millis(250));
            }
            Err(_) => return false,
        }
    }
}

/// The folder holding a speech model: Lumora's copy when it has one,
/// otherwise ours (downloaded the first time, with `progress` from 0 to 1).
///
/// # Errors
/// When it isn't here and can't be downloaded, in words for the editor.
pub fn model(
    ours: &Path,
    lumora: Option<&Path>,
    name: &str,
    progress: &dyn Fn(f64),
) -> Result<PathBuf, String> {
    let m = MODELS
        .iter()
        .find(|m| m.name == name)
        .ok_or_else(|| format!("Lumora Edit doesn't know the speech model “{name}”."))?;
    if let Some(dir) = lumora {
        let theirs = dir.join("models").join(m.name);
        if has_all(&theirs, m) {
            return Ok(theirs);
        }
    }
    let folder = ours.join("models").join(m.name);
    std::fs::create_dir_all(&folder).map_err(|e| e.to_string())?;
    // About how much there is to download (each file is a bit over its smallest size).
    let total: u64 = m.files.iter().map(|f| f.2).sum::<u64>().max(1);
    let mut before = 0u64;
    for &(file, path, min) in m.files {
        let target = folder.join(file);
        if complete(&target, min) {
            before += min;
            continue;
        }
        let part = folder.join(format!("{file}.part"));
        let urls = [
            format!("{SITE}/{}/{file}", m.name),
            format!("{}/{path}", m.home),
        ];
        let report = |n: u64| progress(fraction(before + n.min(min), total));
        let ok = urls
            .iter()
            .any(|u| download(u, &part, &report) && complete(&part, min));
        if !ok {
            let _ = std::fs::remove_file(&part);
            return Err(
                "The speech model needs a one-time download, which didn't work. \
                 Connect to the internet and try again."
                    .to_owned(),
            );
        }
        std::fs::rename(&part, &target).map_err(|e| e.to_string())?;
        before += min;
        progress(fraction(before, total));
    }
    progress(1.0);
    Ok(folder)
}

/// `done` of `total`, from 0 to 1.
#[allow(clippy::cast_precision_loss)]
fn fraction(done: u64, total: u64) -> f64 {
    (done as f64 / total as f64).min(1.0)
}

/// `seconds` of a file's sound from `from`, as 16 kHz mono 32-bit float samples (little-endian bytes).
///
/// # Errors
/// FFmpeg can't read the file.
pub fn audio(ffmpeg: &Path, file: &Path, from: f64, seconds: f64) -> Result<Vec<u8>, String> {
    let mut child = quiet(ffmpeg)
        .args(["-hide_banner", "-loglevel", "error", "-ss"])
        .arg(format!("{:.3}", from.max(0.0)))
        .arg("-t")
        .arg(format!("{:.3}", seconds.max(0.0)))
        .arg("-i")
        .arg(file)
        .args(["-vn", "-ac", "1", "-ar", "16000", "-f", "f32le", "-"])
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|e| format!("FFmpeg could not start: {e}"))?;
    let mut raw = Vec::new();
    if let Some(mut out) = child.stdout.take() {
        out.read_to_end(&mut raw).map_err(|e| e.to_string())?;
    }
    let status = child.wait().map_err(|e| e.to_string())?;
    if !status.success() && raw.is_empty() {
        return Err(format!("Could not read the sound of {}.", file.display()));
    }
    Ok(raw)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_model_lumora_already_has_is_used_from_there() {
        let dir = std::env::temp_dir().join(format!("lumora-edit-speech-{}", std::process::id()));
        let theirs = dir.join("lumora");
        let folder = theirs.join("models").join("whisper-base");
        std::fs::create_dir_all(&folder).unwrap();
        for &(file, _, min) in MODELS[0].files {
            std::fs::File::create(folder.join(file))
                .unwrap()
                .set_len(min)
                .unwrap();
        }
        let ours = dir.join("ours");
        assert_eq!(
            model(&ours, Some(&theirs), "whisper-base", &|_| {}).unwrap(),
            folder
        );
        assert!(model(&ours, None, "nope", &|_| {}).is_err());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn progress_is_a_fraction() {
        assert!((fraction(5, 10) - 0.5).abs() < 1e-9);
        assert!((fraction(20, 10) - 1.0).abs() < 1e-9);
    }

    #[test]
    fn reads_sound_as_16k_samples() {
        let Some(ffmpeg) = crate::media::find_ffmpeg() else {
            return;
        };
        let dir = std::env::temp_dir().join(format!("lumora-edit-pcm-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let tone = dir.join("tone.wav");
        let ok = quiet(&ffmpeg)
            .args([
                "-hide_banner",
                "-loglevel",
                "error",
                "-y",
                "-f",
                "lavfi",
                "-i",
                "sine=f=440:d=3",
            ])
            .arg(&tone)
            .status()
            .is_ok_and(|s| s.success());
        if ok {
            let bytes = audio(&ffmpeg, &tone, 1.0, 1.0).unwrap();
            // One second: 16000 samples of 4 bytes (give or take a frame).
            assert!((63_000..=65_000).contains(&bytes.len()), "{}", bytes.len());
        }
        let _ = std::fs::remove_dir_all(&dir);
    }
}
