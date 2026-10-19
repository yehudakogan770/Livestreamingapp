//! Voice isolation with a neural network: FFmpeg's `arnndn` filter (RNNoise)
//! and a speech model that ships inside Lumora Studio ("somnolent-hogwash",
//! trained for speech in recording noise, from the rnnoise-nu model set; the
//! model files are not subject to copyright). The model is written next to
//! the cache the first time it is needed, so FFmpeg can read it.
//!
//! The film uses the filter directly; while editing, a cleaned copy of a
//! file's sound is made once per strength and played instead of the original.

use std::fs;
use std::path::{Path, PathBuf};

/// The speech model.
const MODEL: &[u8] = include_bytes!("../models/voice.rnnn");
const MODEL_NAME: &str = "voice-speech-1.rnnn";

/// Where the model is on disk (written there the first time).
///
/// # Errors
/// The folder can't be written.
pub fn model_path(cache: &Path) -> Result<PathBuf, String> {
    let dir = cache.join("models");
    let path = dir.join(MODEL_NAME);
    let current = fs::metadata(&path).is_ok_and(|m| m.len() == MODEL.len() as u64);
    if !current {
        fs::create_dir_all(&dir)
            .map_err(|e| format!("Could not get voice isolation ready: {e}"))?;
        let temp = dir.join(format!("{MODEL_NAME}.writing"));
        fs::write(&temp, MODEL).map_err(|e| format!("Could not get voice isolation ready: {e}"))?;
        fs::rename(&temp, &path)
            .map_err(|e| format!("Could not get voice isolation ready: {e}"))?;
    }
    Ok(path)
}

/// A path as a value inside an FFmpeg filter graph (passed as one argument,
/// not through a shell): escaped for the option, then quoted for the graph.
#[must_use]
pub fn filter_path(path: &Path) -> String {
    let forward = path.to_string_lossy().replace('\\', "/");
    let mut opt = String::with_capacity(forward.len() + 8);
    for c in forward.chars() {
        if matches!(c, '\\' | '\'' | ':') {
            opt.push('\\');
        }
        opt.push(c);
    }
    format!("'{}'", opt.replace('\'', "'\\''"))
}

/// The strength as kept in file names and given to FFmpeg (steps of 5%).
#[must_use]
pub fn step(mix: f64) -> f64 {
    ((mix.clamp(0.0, 1.0) * 20.0).round()) / 20.0
}

/// The arnndn filter for a strength (0–1: how much of the cleaned sound is heard).
#[must_use]
pub fn filter(model: &Path, mix: f64) -> String {
    format!("arnndn=m={}:mix={}", filter_path(model), step(mix))
}

/// A cleaned copy of a file's sound for playing while editing, made once
/// (kept in `cache`, named by the file, its size, date and the strength).
///
/// # Errors
/// FFmpeg can't read the file or write the copy.
pub fn clean(
    ffmpeg: &Path,
    file: &Path,
    seconds: f64,
    mix: f64,
    cache: &Path,
    progress: &dyn Fn(f64),
) -> Result<PathBuf, String> {
    let meta = fs::metadata(file).map_err(|e| format!("{} was not found: {e}", file.display()))?;
    let stamp = meta
        .modified()
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map_or(0, |d| d.as_secs());
    let mix = step(mix);
    let key = {
        use std::hash::{Hash, Hasher};
        let mut h = std::collections::hash_map::DefaultHasher::new();
        (file.to_string_lossy(), meta.len(), stamp, MODEL_NAME).hash(&mut h);
        format!(
            "{:016x}-{:03}.m4a",
            h.finish(),
            (mix * 100.0).round() as u32
        )
    };
    let dir = cache.join("voice");
    let out = dir.join(&key);
    if out.is_file() {
        return Ok(out);
    }
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let model = model_path(cache)?;
    let temp = dir.join(format!("{key}.making.m4a"));
    let args: Vec<std::ffi::OsString> = vec![
        "-i".into(),
        file.as_os_str().to_owned(),
        "-vn".into(),
        "-af".into(),
        format!("aresample=48000,{}", filter(&model, mix)).into(),
        "-c:a".into(),
        "aac".into(),
        "-b:a".into(),
        "192k".into(),
        temp.as_os_str().to_owned(),
    ];
    crate::media::run_with_progress(ffmpeg, &args, seconds, progress)?;
    fs::rename(&temp, &out).map_err(|e| e.to_string())?;
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn paths_in_filters_survive_colons_quotes_and_backslashes() {
        assert_eq!(
            filter_path(Path::new(r"C:\Users\Dana\voice.rnnn")),
            r"'C\:/Users/Dana/voice.rnnn'"
        );
        assert_eq!(
            filter_path(Path::new("/tmp/it's/a.rnnn")),
            r"'/tmp/it\'\''s/a.rnnn'"
        );
    }

    #[test]
    fn strength_in_steps() {
        assert!((step(0.73) - 0.75).abs() < 1e-9);
        assert!((step(2.0) - 1.0).abs() < 1e-9);
        assert!(filter(Path::new("/m.rnnn"), 0.5).ends_with(":mix=0.5"));
    }

    #[test]
    fn model_is_written_once() {
        let dir = std::env::temp_dir().join(format!("lumora-voice-{}", std::process::id()));
        let p = model_path(&dir).unwrap();
        assert_eq!(fs::read(&p).unwrap().len(), MODEL.len());
        assert!(fs::read_to_string(&p)
            .unwrap()
            .starts_with("rnnoise-nu model file"));
        assert_eq!(model_path(&dir).unwrap(), p);
        let _ = fs::remove_dir_all(&dir);
    }

    /// With FFmpeg on this computer: the model loads and cleans a noisy tone.
    #[test]
    fn ffmpeg_runs_the_model() {
        let Some(ffmpeg) = crate::media::find_ffmpeg() else {
            return;
        };
        let dir = std::env::temp_dir().join(format!("lumora-voice-run-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        let src = dir.join("noisy.wav");
        let made = crate::media::quiet(&ffmpeg)
            .args([
                "-hide_banner",
                "-loglevel",
                "error",
                "-y",
                "-f",
                "lavfi",
                "-i",
            ])
            .arg("anoisesrc=d=1:a=0.2,aformat=sample_rates=48000")
            .arg(&src)
            .status()
            .unwrap();
        assert!(made.success());
        let out = clean(&ffmpeg, &src, 1.0, 1.0, &dir, &|_| {}).unwrap();
        assert!(out.is_file());
        // Made once: asked again, the same file comes back without running FFmpeg.
        assert_eq!(clean(&ffmpeg, &src, 1.0, 1.0, &dir, &|_| {}).unwrap(), out);
        let _ = fs::remove_dir_all(&dir);
    }
}
