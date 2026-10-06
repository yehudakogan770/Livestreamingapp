//! The render cache: stretches of the timeline too heavy to play live (many
//! layers, color nodes, AI masks, optical flow…) are drawn once by the editor
//! and kept as all-intra H.264 files (every frame a key frame, so any frame
//! opens at once), named by a hash of everything that makes their pictures.
//! An edit changes the hash, so a stale file is simply never asked for again;
//! the oldest files go first when the cache grows past its size limit.

use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::UNIX_EPOCH;

use serde::Serialize;
use tauri::State;

use crate::formats::copy_encoder_args;
use crate::AppState;

/// A cache file's name is its key: 16–64 lowercase hex digits.
#[must_use]
pub fn valid_key(key: &str) -> bool {
    (16..=64).contains(&key.len())
        && key
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}

/// The finished file for a key.
#[must_use]
pub fn file_for(folder: &Path, key: &str) -> PathBuf {
    folder.join(format!("{key}.mp4"))
}

/// The file being written for a key (renamed when finished, so a half-made one is never played).
#[must_use]
pub fn temp_for(folder: &Path, key: &str) -> PathBuf {
    folder.join(format!("{key}.making.mp4"))
}

/// The key of a finished cache file's name.
#[must_use]
pub fn key_of(name: &str) -> Option<&str> {
    let k = name.strip_suffix(".mp4")?;
    valid_key(k).then_some(k)
}

/// A frame rate as FFmpeg reads it ("30000/1001", "25").
fn valid_rate(r: &str) -> bool {
    !r.is_empty()
        && r.len() < 16
        && r.bytes()
            .all(|b| b.is_ascii_digit() || b == b'/' || b == b'.')
}

/// FFmpeg's arguments to turn the editor's raw frames into a cache file: all
/// intra H.264 (a graphics card's encoder when `encoder` names one), Rec. 709.
#[must_use]
pub fn encode_args(
    encoder: Option<&str>,
    width: u32,
    height: u32,
    rate: &str,
    high: bool,
    out: &Path,
) -> Vec<String> {
    let crf = if high { "12" } else { "18" };
    let pix = crate::formats::copy_pixel_format(encoder);
    let mut a: Vec<String> = [
        "-f",
        "rawvideo",
        "-pix_fmt",
        "rgba",
        "-s",
        &format!("{width}x{height}"),
        "-framerate",
        rate,
        "-i",
        "pipe:0",
        "-an",
        "-vf",
        &format!("scale=out_color_matrix=bt709:out_range=tv,format={pix}"),
    ]
    .iter()
    .map(|s| (*s).to_owned())
    .collect();
    a.extend(copy_encoder_args(encoder, crf, "veryfast", "1"));
    a.extend(
        [
            "-colorspace",
            "bt709",
            "-color_primaries",
            "bt709",
            "-color_trc",
            "bt709",
            "-movflags",
            "+faststart",
            "-f",
            "mp4",
        ]
        .map(str::to_owned),
    );
    a.push(out.to_string_lossy().into_owned());
    a
}

/// The hardware H.264 encoder to use for cache files, if one works here.
#[must_use]
pub fn hardware_h264(available: &[String]) -> Option<String> {
    ["h264_nvenc", "h264_qsv", "h264_videotoolbox", "h264_amf"]
        .iter()
        .find(|n| available.iter().any(|a| a == *n))
        .map(|n| (*n).to_owned())
}

/// A file in the cache.
#[derive(Serialize, Debug, Clone, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Entry {
    pub key: String,
    pub bytes: u64,
    /// When it was last written (ms since 1970).
    pub at: u64,
}

/// The finished files in a cache folder.
#[must_use]
pub fn list(folder: &Path) -> Vec<Entry> {
    let Ok(dir) = fs::read_dir(folder) else {
        return Vec::new();
    };
    dir.flatten()
        .filter_map(|e| {
            let name = e.file_name().to_string_lossy().into_owned();
            let key = key_of(&name)?.to_owned();
            let meta = e.metadata().ok()?;
            let at = meta
                .modified()
                .ok()
                .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
                .map_or(0, |d| u64::try_from(d.as_millis()).unwrap_or(u64::MAX));
            Some(Entry {
                key,
                bytes: meta.len(),
                at,
            })
        })
        .collect()
}

/// Which files to remove so the cache fits in `limit` bytes: the oldest first,
/// never one in `keep` (the open sequence's).
#[must_use]
pub fn to_remove(entries: &[Entry], limit: u64, keep: &[String]) -> Vec<String> {
    let mut total: u64 = entries.iter().map(|e| e.bytes).sum();
    let mut old: Vec<&Entry> = entries.iter().filter(|e| !keep.contains(&e.key)).collect();
    old.sort_by_key(|e| (e.at, e.key.clone()));
    let mut out = Vec::new();
    for e in old {
        if total <= limit {
            break;
        }
        total = total.saturating_sub(e.bytes);
        out.push(e.key.clone());
    }
    out
}

/// Remove every cache file (and any half-made one); how many bytes were freed.
pub fn clear(folder: &Path) -> u64 {
    let Ok(dir) = fs::read_dir(folder) else {
        return 0;
    };
    let mut freed = 0;
    for e in dir.flatten() {
        let name = e.file_name().to_string_lossy().into_owned();
        let ours =
            key_of(&name).is_some() || name.strip_suffix(".making.mp4").is_some_and(valid_key);
        if ours {
            let bytes = e.metadata().map(|m| m.len()).unwrap_or(0);
            if fs::remove_file(e.path()).is_ok() {
                freed += bytes;
            }
        }
    }
    freed
}

fn folder_of(state: &AppState, folder: &str) -> PathBuf {
    if folder.trim().is_empty() {
        state.cache.join("render")
    } else {
        PathBuf::from(folder)
    }
}

fn checked(key: &str) -> Result<(), String> {
    if valid_key(key) {
        Ok(())
    } else {
        Err("That is not a cache key.".into())
    }
}

/// The cache folder in use (the default one when none is chosen).
#[tauri::command]
pub fn rcache_folder(state: State<'_, AppState>, folder: String) -> String {
    folder_of(&state, &folder).to_string_lossy().into_owned()
}

/// The finished cache files.
#[tauri::command]
pub async fn rcache_list(state: State<'_, AppState>, folder: String) -> Result<Vec<Entry>, String> {
    let dir = folder_of(&state, &folder);
    tauri::async_runtime::spawn_blocking(move || list(&dir))
        .await
        .map_err(|e| e.to_string())
}

/// Start a cache file: FFmpeg reads raw RGBA frames (`encode_frame`) and writes all-intra H.264.
/// `software`: skip the graphics card's encoder (it failed before).
#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn rcache_open(
    state: State<'_, AppState>,
    folder: String,
    key: String,
    width: u32,
    height: u32,
    rate: String,
    high: bool,
    software: bool,
) -> Result<u32, String> {
    checked(&key)?;
    if width < 2 || height < 2 || width > 8192 || height > 8192 || !valid_rate(&rate) {
        return Err("That frame size can't be cached.".into());
    }
    let ffmpeg = state.ffmpeg()?;
    let dir = folder_of(&state, &folder);
    fs::create_dir_all(&dir).map_err(|e| format!("The cache folder can't be made: {e}"))?;
    let enc = Arc::clone(&state.encoders);
    tauri::async_runtime::spawn_blocking(move || {
        let encoder = if software {
            None
        } else {
            hardware_h264(&enc.available(&ffmpeg))
        };
        let temp = temp_for(&dir, &key);
        let args = encode_args(encoder.as_deref(), width, height, &rate, high, &temp);
        enc.open(
            &ffmpeg,
            &args,
            &dir,
            &temp,
            crate::frames::frame_bytes(width, height),
        )
    })
    .await
    .map_err(|e| e.to_string())?
}

/// The last frame was sent: finish the file and put it in place (its path).
#[tauri::command]
pub async fn rcache_finish(
    state: State<'_, AppState>,
    folder: String,
    key: String,
    id: u32,
) -> Result<String, String> {
    checked(&key)?;
    let dir = folder_of(&state, &folder);
    let enc = Arc::clone(&state.encoders);
    tauri::async_runtime::spawn_blocking(move || {
        let temp = temp_for(&dir, &key);
        if let Err(e) = enc.close(id) {
            let _ = fs::remove_file(&temp);
            return Err(e);
        }
        let out = file_for(&dir, &key);
        fs::rename(&temp, &out).map_err(|e| e.to_string())?;
        Ok(out.to_string_lossy().into_owned())
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Stop a cache file part way (an edit changed it, or playback started).
#[tauri::command]
pub fn rcache_abort(state: State<'_, AppState>, folder: String, key: String, id: u32) {
    state.encoders.abort(id);
    if valid_key(&key) {
        let _ = fs::remove_file(temp_for(&folder_of(&state, &folder), &key));
    }
}

/// Keep the cache within `limit` bytes (oldest first, never the ones in `keep`); the keys removed.
#[tauri::command]
pub async fn rcache_trim(
    state: State<'_, AppState>,
    folder: String,
    limit: u64,
    keep: Vec<String>,
) -> Result<Vec<String>, String> {
    let dir = folder_of(&state, &folder);
    tauri::async_runtime::spawn_blocking(move || {
        let gone = to_remove(&list(&dir), limit, &keep);
        for k in &gone {
            let _ = fs::remove_file(file_for(&dir, k));
        }
        gone
    })
    .await
    .map_err(|e| e.to_string())
}

/// Remove every cache file; the bytes freed.
#[tauri::command]
pub async fn rcache_clear(state: State<'_, AppState>, folder: String) -> Result<u64, String> {
    let dir = folder_of(&state, &folder);
    tauri::async_runtime::spawn_blocking(move || clear(&dir))
        .await
        .map_err(|e| e.to_string())
}

/// Hardware decoding: what is used, and what this computer offers.
#[tauri::command]
pub async fn hwaccel_status(state: State<'_, AppState>) -> Result<crate::hwaccel::Status, String> {
    let ffmpeg = state.ffmpeg()?;
    tauri::async_runtime::spawn_blocking(move || crate::hwaccel::global().status(&ffmpeg))
        .await
        .map_err(|e| e.to_string())
}

/// Turn hardware decoding on (`auto`) or off.
#[tauri::command]
pub fn hwaccel_set(auto: bool) {
    crate::hwaccel::global().set_mode(auto);
}

#[cfg(test)]
mod tests {
    use super::*;

    const K1: &str = "0123456789abcdef";
    const K2: &str = "fedcba9876543210";
    const K3: &str = "00000000000000aa";

    #[test]
    fn keys_are_hex_names() {
        assert!(valid_key(K1));
        assert!(!valid_key("short"));
        assert!(!valid_key("../../etc/passwd0000"));
        assert!(!valid_key("0123456789ABCDEF"));
        assert_eq!(key_of(&format!("{K1}.mp4")), Some(K1));
        assert_eq!(key_of(&format!("{K1}.making.mp4")), None);
        assert_eq!(key_of("holiday.mp4"), None);
        assert!(
            valid_rate("30000/1001") && valid_rate("25") && !valid_rate("25;rm") && !valid_rate("")
        );
    }

    #[test]
    fn all_intra_h264() {
        let out = Path::new("/c/k.making.mp4");
        let a = encode_args(None, 1920, 1080, "30000/1001", false, out);
        assert!(a.windows(2).any(|w| w[0] == "-s" && w[1] == "1920x1080"));
        assert!(a
            .windows(2)
            .any(|w| w[0] == "-framerate" && w[1] == "30000/1001"));
        assert!(a.windows(2).any(|w| w[0] == "-c:v" && w[1] == "libx264"));
        assert!(
            a.windows(2).any(|w| w[0] == "-g" && w[1] == "1"),
            "every frame a key frame"
        );
        assert!(a.windows(2).any(|w| w[0] == "-crf" && w[1] == "18"));
        assert_eq!(a.last().map(String::as_str), Some("/c/k.making.mp4"));
        let hq = encode_args(Some("h264_nvenc"), 3840, 2160, "25", true, out);
        assert!(hq
            .windows(2)
            .any(|w| w[0] == "-c:v" && w[1] == "h264_nvenc"));
        assert!(hq.windows(2).any(|w| w[0] == "-cq" && w[1] == "12"));
        assert!(hq.windows(2).any(|w| w[0] == "-g" && w[1] == "1"));
        let qsv = encode_args(Some("h264_qsv"), 640, 360, "25", false, out);
        assert!(qsv.iter().any(|x| x.ends_with("format=nv12")));
    }

    #[test]
    fn picks_a_hardware_encoder() {
        let have = |v: &[&str]| v.iter().map(|s| (*s).to_owned()).collect::<Vec<_>>();
        assert_eq!(
            hardware_h264(&have(&["libx264", "h264_qsv", "h264_nvenc"])).as_deref(),
            Some("h264_nvenc")
        );
        assert_eq!(hardware_h264(&have(&["libx264", "hevc_nvenc"])), None);
        assert_eq!(
            hardware_h264(&have(&["h264_amf"])).as_deref(),
            Some("h264_amf")
        );
    }

    #[test]
    fn trims_the_oldest_first_but_keeps_what_is_in_use() {
        let e = |key: &str, bytes: u64, at: u64| Entry {
            key: key.into(),
            bytes,
            at,
        };
        let all = vec![e(K1, 100, 3), e(K2, 100, 1), e(K3, 100, 2)];
        assert!(to_remove(&all, 300, &[]).is_empty());
        assert_eq!(to_remove(&all, 250, &[]), vec![K2]);
        assert_eq!(to_remove(&all, 100, &[]), vec![K2, K3]);
        // The oldest is in use: the next oldest goes instead.
        assert_eq!(to_remove(&all, 250, &[K2.into()]), vec![K3]);
        // Everything in use: nothing can go.
        assert!(to_remove(&all, 0, &[K1.into(), K2.into(), K3.into()]).is_empty());
    }

    #[test]
    fn lists_and_clears_only_cache_files() {
        let dir = std::env::temp_dir().join(format!("lumora-rcache-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        fs::write(file_for(&dir, K1), [0u8; 10]).unwrap();
        fs::write(temp_for(&dir, K2), [0u8; 5]).unwrap();
        fs::write(dir.join("notes.mp4"), [0u8; 3]).unwrap();
        let l = list(&dir);
        assert_eq!(l.len(), 1);
        assert_eq!(l[0].key, K1);
        assert_eq!(l[0].bytes, 10);
        assert_eq!(clear(&dir), 15);
        assert!(
            dir.join("notes.mp4").is_file(),
            "only the cache's own files are removed"
        );
        assert!(list(&dir).is_empty());
        let _ = fs::remove_dir_all(dir);
    }

    /// Needs FFmpeg: `cargo test -p lumora-edit -- --ignored`.
    #[test]
    #[ignore = "needs FFmpeg"]
    fn makes_a_cache_file() {
        let Some(ffmpeg) = crate::media::find_ffmpeg() else {
            return;
        };
        let dir = std::env::temp_dir().join(format!("lumora-rcache-enc-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        let enc = crate::encode::Encoders::default();
        let temp = temp_for(&dir, K1);
        let args = encode_args(None, 64, 36, "25", false, &temp);
        let id = enc.open(&ffmpeg, &args, &dir, &temp, 64 * 36 * 4).unwrap();
        for i in 0..10u8 {
            enc.frame(id, &vec![i * 20; 64 * 36 * 4]).unwrap();
        }
        enc.close(id).unwrap();
        let info = crate::media::probe(&ffmpeg, &temp).unwrap();
        assert_eq!(info.video.as_deref(), Some("h264"));
        assert_eq!((info.width, info.height), (64, 36));
        let ms = info.duration_ms.unwrap_or(0.0);
        assert!((350.0..=450.0).contains(&ms), "{ms}");
        let _ = fs::remove_dir_all(dir);
    }
}
