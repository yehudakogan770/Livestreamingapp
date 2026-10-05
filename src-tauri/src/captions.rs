//! Live captions: the speech models are downloaded once, the first time
//! captions are turned on (or a language is chosen), and kept with Lumora's
//! files. After that, captions work without internet.

use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

/// A speech model: its folder name, where it comes from, and its files
/// (name, path at the original home, smallest size that is complete).
struct Model {
    name: &'static str,
    home: &'static str,
    files: &'static [(&'static str, &'static str, u64)],
}

const MODELS: &[Model] = &[Model {
    name: "moonshine-tiny",
    home: "https://huggingface.co/onnx-community/moonshine-tiny-ONNX/resolve/main",
    files: &[
        (
            "encoder_model_quantized.onnx",
            "onnx/encoder_model_quantized.onnx",
            7_000_000,
        ),
        (
            "decoder_model_merged_quantized.onnx",
            "onnx/decoder_model_merged_quantized.onnx",
            18_000_000,
        ),
        ("tokenizer.json", "tokenizer.json", 1_000_000),
    ],
}];

/// Lumora's own website keeps a copy of every model (tried first).
const SITE: &str = "https://yehudakogan770.github.io/Livestreamingapp/models";

fn hidden(cmd: &mut Command) -> &mut Command {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        // No console window pops up.
        cmd.creation_flags(0x0800_0000);
    }
    cmd
}

fn complete(p: &Path, min: u64) -> bool {
    std::fs::metadata(p).is_ok_and(|m| m.len() >= min)
}

fn download(url: &str, to: &Path) -> bool {
    hidden(Command::new("curl").args(["-fsSL", "--retry", "2", "-o"]))
        .arg(to)
        .arg(url)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .is_ok_and(|s| s.success())
}

/// The folder holding a speech model on this computer, downloading it the
/// first time.
///
/// # Errors
/// When it isn't here and can't be downloaded, in words for the operator.
pub fn model(dir: &Path, name: &str) -> Result<PathBuf, String> {
    let m = MODELS
        .iter()
        .find(|m| m.name == name)
        .ok_or_else(|| format!("Lumora doesn't know the speech model “{name}”."))?;
    let folder = dir.join("models").join(m.name);
    std::fs::create_dir_all(&folder).map_err(|e| e.to_string())?;
    for &(file, path, min) in m.files {
        let target = folder.join(file);
        if complete(&target, min) {
            continue;
        }
        let part = folder.join(format!("{file}.part"));
        let urls = [
            format!("{SITE}/{}/{file}", m.name),
            format!("{}/{path}", m.home),
        ];
        let got = urls
            .iter()
            .any(|u| download(u, &part) && complete(&part, min));
        if !got {
            let _ = std::fs::remove_file(&part);
            return Err("The captions need a one-time download, which didn't work. \
                 Connect to the internet and turn captions on again."
                .to_owned());
        }
        std::fs::rename(&part, &target).map_err(|e| e.to_string())?;
    }
    Ok(folder)
}

/// One caption line for `YouTube`: the time it was said (UTC, to the
/// millisecond) and the words, as its caption address takes them.
#[must_use]
pub fn youtube_body(at_ms: u64, text: &str) -> String {
    let secs = at_ms / 1000;
    let (days, rest) = (secs / 86_400, secs % 86_400);
    let (y, mo, d) = civil(days);
    format!(
        "{y:04}-{mo:02}-{d:02}T{:02}:{:02}:{:02}.{:03}\n{}\n",
        rest / 3600,
        (rest % 3600) / 60,
        rest % 60,
        at_ms % 1000,
        text.replace(['\r', '\n'], " ").trim()
    )
}

/// The calendar date of a day counted from 1970-01-01.
fn civil(days: u64) -> (u64, u64, u64) {
    // Howard Hinnant's days-to-civil, for dates after 1970.
    let z = days + 719_468;
    let era = z / 146_097;
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    (yoe + era * 400 + u64::from(m <= 2), m, d)
}

/// Send one caption line to a `YouTube` caption address (`seq` counts up).
///
/// # Errors
/// When it couldn't be sent.
pub fn send_youtube(url: &str, seq: u64, at_ms: u64, text: &str) -> Result<(), String> {
    let url = url.trim();
    if !url.starts_with("https://") {
        return Err("The captions address should start with https://".to_owned());
    }
    let sep = if url.contains('?') { '&' } else { '?' };
    let full = format!("{url}{sep}seq={seq}");
    let ok = hidden(Command::new("curl").args([
        "-fsS",
        "--max-time",
        "8",
        "-H",
        "Content-Type: text/plain",
        "--data-binary",
        &youtube_body(at_ms, text),
    ]))
    .arg(&full)
    .stdin(Stdio::null())
    .stdout(Stdio::null())
    .stderr(Stdio::null())
    .status()
    .is_ok_and(|s| s.success());
    if ok {
        Ok(())
    } else {
        Err("YouTube didn't take the captions. Check the captions address in Settings → Recording and streaming.".to_owned())
    }
}

#[cfg(test)]
mod tests {
    #[test]
    fn a_youtube_caption_line_has_the_time_then_the_words() {
        // 2026-10-05 03:20:01.250 UTC
        let at = 1_791_170_401_250;
        assert_eq!(
            youtube_body(at, " Welcome,\neveryone "),
            "2026-10-05T03:20:01.250\nWelcome, everyone\n"
        );
    }

    #[test]
    fn a_captions_address_must_be_secure() {
        assert!(send_youtube("http://example.com", 1, 0, "x").is_err());
    }

    use super::*;

    #[test]
    fn a_model_already_here_is_used_without_downloading() {
        let dir = std::env::temp_dir().join(format!("lumora-captions-{}", std::process::id()));
        let folder = dir.join("models").join("moonshine-tiny");
        std::fs::create_dir_all(&folder).unwrap();
        for &(file, _, min) in MODELS[0].files {
            std::fs::File::create(folder.join(file))
                .unwrap()
                .set_len(min)
                .unwrap();
        }
        assert_eq!(model(&dir, "moonshine-tiny").unwrap(), folder);
        assert!(model(&dir, "nope").is_err());
        let _ = std::fs::remove_dir_all(&dir);
    }
}
