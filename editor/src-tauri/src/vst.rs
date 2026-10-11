//! VST3 effects on sound clips. Every plug-in is opened in a helper process
//! (Lumora Studio started again with `--lumora-vst-helper`), so one that
//! crashes or hangs can't take the editor down: the helper reads a request
//! on its standard input and writes the reply on its standard output.
//!
//! - Finding plug-ins: each file is described once (cached by its date).
//! - Settings: a plug-in's parameters, set and read back with its state.
//! - Sound: a clip's stretch of a file decoded by FFmpeg, run through the
//!   clip's plug-ins in the helper, and kept as a WAV file (made once for
//!   each set of settings) that playback and the film use.

use std::collections::HashMap;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use vst3::{ClassInfo, Link, Param, Reply, Request};

use crate::media::quiet;

/// The argument that starts the helper.
pub const HELPER_ARG: &str = "--lumora-vst-helper";

/// Run as the helper (the process exits with what this returns).
#[must_use]
pub fn helper_main() -> i32 {
    vst3::serve()
}

/// Ask a helper process, giving up after `limit`.
fn ask(req: &Request, limit: Duration) -> Result<Reply, String> {
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    ask_with(&exe, req, limit)
}

fn ask_with(exe: &Path, req: &Request, limit: Duration) -> Result<Reply, String> {
    let mut child = quiet(exe)
        .arg(HELPER_ARG)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|e| format!("The plug-in helper could not start: {e}"))?;
    let text = serde_json::to_vec(req).map_err(|e| e.to_string())?;
    if let Some(mut stdin) = child.stdin.take() {
        let _ = stdin.write_all(&text);
    }
    let mut stdout = child
        .stdout
        .take()
        .ok_or("The plug-in helper gave nothing back.")?;
    let reader = std::thread::spawn(move || {
        let mut s = String::new();
        let _ = stdout.read_to_string(&mut s);
        s
    });
    let start = Instant::now();
    let status = loop {
        if let Some(s) = child.try_wait().map_err(|e| e.to_string())? {
            break s;
        }
        if start.elapsed() > limit {
            let _ = child.kill();
            let _ = child.wait();
            return Err("The plug-in stopped answering, so it was closed.".into());
        }
        std::thread::sleep(Duration::from_millis(15));
    };
    let out = reader.join().unwrap_or_default();
    match serde_json::from_str::<Reply>(&out) {
        Ok(r) => match r.error {
            Some(e) => Err(e),
            None => Ok(r),
        },
        // Nothing sensible came back: the plug-in crashed the helper.
        Err(_) if !status.success() => {
            Err("The plug-in crashed while it was being used (Lumora Studio is fine).".into())
        }
        Err(e) => Err(format!("The plug-in helper gave a bad reply: {e}")),
    }
}

/// One effect found on the computer.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Found {
    pub path: String,
    #[serde(flatten)]
    pub class: ClassInfo,
}

/// A plug-in file that couldn't be read (shown so people know why it's missing).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Broken {
    pub path: String,
    pub problem: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct Scan {
    pub effects: Vec<Found>,
    pub broken: Vec<Broken>,
    /// The folders looked in.
    pub folders: Vec<String>,
}

#[derive(Serialize, Deserialize, Default)]
struct ScanCache {
    /// By plug-in path: its date when described, and what it offered (or why not).
    files: HashMap<String, (u64, Result<Vec<ClassInfo>, String>)>,
}

fn stamp(path: &Path) -> u64 {
    std::fs::metadata(path)
        .and_then(|m| m.modified())
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map_or(0, |d| d.as_secs())
}

/// Every VST3 effect on the computer (each file described once, kept in `cache`).
#[must_use]
pub fn scan(
    cache: &Path,
    again: bool,
    describe: &dyn Fn(&Path) -> Result<Vec<ClassInfo>, String>,
) -> Scan {
    let folders = vst3::plugin_folders();
    scan_in(&folders, cache, again, describe)
}

fn scan_in(
    folders: &[PathBuf],
    cache: &Path,
    again: bool,
    describe: &dyn Fn(&Path) -> Result<Vec<ClassInfo>, String>,
) -> Scan {
    let file = cache.join("vst3-scan.json");
    let mut known: ScanCache = if again {
        ScanCache::default()
    } else {
        std::fs::read(&file)
            .ok()
            .and_then(|b| serde_json::from_slice(&b).ok())
            .unwrap_or_default()
    };
    let mut out = Scan {
        folders: folders
            .iter()
            .map(|f| f.to_string_lossy().into_owned())
            .collect(),
        ..Scan::default()
    };
    let mut seen = HashMap::new();
    for path in vst3::find_plugins(folders) {
        let key = path.to_string_lossy().into_owned();
        let when = stamp(&path);
        let got = match known.files.get(&key) {
            Some((t, r)) if *t == when => r.clone(),
            _ => describe(&path),
        };
        match &got {
            Ok(classes) => out.effects.extend(classes.iter().map(|c| Found {
                path: key.clone(),
                class: c.clone(),
            })),
            Err(e) => out.broken.push(Broken {
                path: key.clone(),
                problem: e.clone(),
            }),
        }
        seen.insert(key, (when, got));
    }
    known.files = seen;
    let _ = std::fs::create_dir_all(cache);
    if let Ok(b) = serde_json::to_vec(&known) {
        let _ = std::fs::write(&file, b);
    }
    out.effects.sort_by(|a, b| {
        a.class
            .name
            .to_lowercase()
            .cmp(&b.class.name.to_lowercase())
    });
    out
}

/// What a plug-in file offers (in a helper).
///
/// # Errors
/// It couldn't be read.
pub fn describe(path: &Path) -> Result<Vec<ClassInfo>, String> {
    ask(
        &Request::Describe {
            path: path.to_path_buf(),
        },
        Duration::from_secs(30),
    )
    .map(|r| r.classes)
}

/// A plug-in's parameters after restoring `state` and setting values, and its state then.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Settings {
    pub params: Vec<Param>,
    pub state: String,
}

/// # Errors
/// The plug-in couldn't be opened or set.
pub fn settings(
    path: &str,
    cid: &str,
    state: Option<String>,
    set: Vec<(u32, f64)>,
) -> Result<Settings, String> {
    let r = ask(
        &Request::Params {
            path: PathBuf::from(path),
            cid: cid.to_owned(),
            state,
            set,
        },
        Duration::from_secs(30),
    )?;
    Ok(Settings {
        params: r.params,
        state: r.state.unwrap_or_default(),
    })
}

/// The plug-in's own window (in a helper, until it is closed); then its parameters and state.
///
/// # Errors
/// It has no window, or it couldn't be opened.
pub fn edit(path: &str, cid: &str, state: Option<String>, title: &str) -> Result<Settings, String> {
    // Open as long as the person works in it.
    let r = ask(
        &Request::Edit {
            path: PathBuf::from(path),
            cid: cid.to_owned(),
            state,
            title: title.to_owned(),
        },
        Duration::from_secs(12 * 3600),
    )?;
    Ok(Settings {
        params: r.params,
        state: r.state.unwrap_or_default(),
    })
}

/// A stretch of a file's sound through a chain of plug-ins, as a WAV file
/// (made once for each file, stretch and set of settings, kept in `cache`).
///
/// # Errors
/// FFmpeg or a plug-in failed.
pub fn render(
    ffmpeg: &Path,
    file: &Path,
    from: f64,
    seconds: f64,
    chain: &[Link],
    cache: &Path,
    progress: &dyn Fn(f64),
) -> Result<PathBuf, String> {
    const RATE: u32 = 48_000;
    let key = {
        use std::hash::{Hash, Hasher};
        let mut h = std::collections::hash_map::DefaultHasher::new();
        (
            file.to_string_lossy(),
            stamp(file),
            from.to_bits(),
            seconds.to_bits(),
            serde_json::to_string(chain).unwrap_or_default(),
        )
            .hash(&mut h);
        format!("{:016x}", h.finish())
    };
    let out = cache.join(format!("{key}.wav"));
    if out.is_file() {
        return Ok(out);
    }
    std::fs::create_dir_all(cache).map_err(|e| e.to_string())?;
    let raw_in = cache.join(format!("{key}.in.raw"));
    let raw_out = cache.join(format!("{key}.out.raw"));
    let tidy = || {
        let _ = std::fs::remove_file(&raw_in);
        let _ = std::fs::remove_file(&raw_out);
    };
    // The stretch, decoded to 32-bit float stereo.
    let ok = quiet(ffmpeg)
        .args([
            "-hide_banner",
            "-loglevel",
            "error",
            "-y",
            "-ss",
            &format!("{:.6}", from.max(0.0)),
            "-t",
            &format!("{:.6}", seconds.max(0.01)),
        ])
        .arg("-i")
        .arg(file)
        .args(["-vn", "-ac", "2", "-ar", &RATE.to_string(), "-f", "f32le"])
        .arg(&raw_in)
        .status()
        .map_err(|e| format!("FFmpeg could not start: {e}"))?;
    if !ok.success() {
        tidy();
        return Err("The sound could not be read for the plug-in.".into());
    }
    progress(0.2);
    let limit = Duration::from_secs_f64(60.0 + seconds * 4.0);
    let r = ask(
        &Request::Render {
            chain: chain.to_vec(),
            input: raw_in.clone(),
            output: raw_out.clone(),
            channels: 2,
            rate: f64::from(RATE),
        },
        limit,
    );
    if let Err(e) = r {
        tidy();
        return Err(e);
    }
    progress(0.85);
    let temp = cache.join(format!("{key}.making.wav"));
    let ok = quiet(ffmpeg)
        .args([
            "-hide_banner",
            "-loglevel",
            "error",
            "-y",
            "-f",
            "f32le",
            "-ar",
            &RATE.to_string(),
            "-ac",
            "2",
            "-i",
        ])
        .arg(&raw_out)
        .args(["-c:a", "pcm_s24le"])
        .arg(&temp)
        .status()
        .map_err(|e| format!("FFmpeg could not start: {e}"))?;
    tidy();
    if !ok.success() {
        return Err("The plug-in's sound could not be saved.".into());
    }
    std::fs::rename(&temp, &out).map_err(|e| e.to_string())?;
    progress(1.0);
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn scanning_describes_each_file_once_and_remembers_problems() {
        let dir = std::env::temp_dir().join(format!("lumora-vst-scan-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        let plugs = dir.join("plugs");
        std::fs::create_dir_all(plugs.join("Good.vst3")).unwrap();
        std::fs::create_dir_all(plugs.join("Bad.vst3")).unwrap();
        let calls = std::cell::Cell::new(0);
        let describe = |p: &Path| -> Result<Vec<ClassInfo>, String> {
            calls.set(calls.get() + 1);
            if p.ends_with("Bad.vst3") {
                Err("The plug-in crashed".into())
            } else {
                Ok(vec![ClassInfo {
                    cid: "00".repeat(16),
                    name: "Good Verb".into(),
                    vendor: "Us".into(),
                    version: "1".into(),
                    sub_categories: "Fx".into(),
                }])
            }
        };
        let cache = dir.join("cache");
        let s = scan_in(std::slice::from_ref(&plugs), &cache, false, &describe);
        assert_eq!(s.effects.len(), 1);
        assert_eq!(s.effects[0].class.name, "Good Verb");
        assert_eq!(s.broken.len(), 1);
        assert_eq!(calls.get(), 2);
        // Again: nothing is described again (the dates are the same).
        let s2 = scan_in(std::slice::from_ref(&plugs), &cache, false, &describe);
        assert_eq!(calls.get(), 2);
        assert_eq!(s2.effects, s.effects);
        // Asked to look again: everything is described again.
        scan_in(&[plugs], &cache, true, &describe);
        assert_eq!(calls.get(), 4);
        let _ = std::fs::remove_dir_all(dir);
    }

    #[cfg(unix)]
    #[test]
    fn a_helper_that_crashes_or_hangs_is_reported_not_fatal() {
        use std::os::unix::fs::PermissionsExt;
        let dir = std::env::temp_dir().join(format!("lumora-vst-helper-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let script = |name: &str, body: &str| {
            let p = dir.join(name);
            std::fs::write(&p, format!("#!/bin/sh\n{body}\n")).unwrap();
            std::fs::set_permissions(&p, std::fs::Permissions::from_mode(0o755)).unwrap();
            p
        };
        let req = Request::Describe {
            path: PathBuf::from("x.vst3"),
        };
        // A helper that dies without answering (as when a plug-in crashes it).
        let crashed = ask_with(
            &script("crash", "kill -SEGV $$"),
            &req,
            Duration::from_secs(5),
        );
        assert!(crashed.unwrap_err().contains("crashed"));
        // One that never answers is closed after the limit.
        let started = Instant::now();
        let slow = ask_with(
            &script("hang", "sleep 30"),
            &req,
            Duration::from_millis(300),
        );
        assert!(slow.unwrap_err().contains("stopped answering"));
        assert!(started.elapsed() < Duration::from_secs(5));
        // A proper reply comes through.
        let ok = ask_with(
            &script("ok", "cat > /dev/null; echo '{\"vendor\":\"Us\"}'"),
            &req,
            Duration::from_secs(5),
        )
        .unwrap();
        assert_eq!(ok.vendor.as_deref(), Some("Us"));
        let _ = std::fs::remove_dir_all(dir);
    }
}
