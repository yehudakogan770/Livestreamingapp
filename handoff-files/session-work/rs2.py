def edit(p, pairs):
    s=open(p).read()
    for a,b in pairs:
        assert s.count(a)==1, (p, a, s.count(a))
        s=s.replace(a,b)
    open(p,'w').write(s)

edit('editor/src-tauri/src/media.rs', [
("""    pub width: u32,
    pub height: u32,
}

fn ext_of""","""    pub width: u32,
    pub height: u32,
    /// What the file is and how it is handled (files imported by hand).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source: Option<crate::formats::Plan>,
    /// An edit-friendly copy is still to be made (only from `look`).
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    pub pending: bool,
}

fn ext_of"""),
("""        width: info.width,
        height: info.height,
    })
}

/// How long a file is, by reading it all""","""        width: info.width,
        height: info.height,
        source: None,
        pending: false,
    })
}

/// How long a file is, by reading it all"""),
("""    let need = needs(file, &info);
    let seconds = info.duration_ms.unwrap_or(0.0) / 1000.0;
    let _ = fs::create_dir_all(cache);""","""    let mut plan = crate::formats::plan(file, &info);
    let need = plan.need;
    let seconds = info.duration_ms.unwrap_or(0.0) / 1000.0;
    let _ = fs::create_dir_all(cache);"""),
("""                if run_with_progress(ffmpeg, &args, seconds, progress).is_err() {
                    // Some files can't simply be rewrapped: make a new copy.
                    let _ = fs::remove_file(&temp);
                    optimize(ffmpeg, file, &temp, seconds, progress)?;
                }""","""                if run_with_progress(ffmpeg, &args, seconds, progress).is_err() {
                    // Some files can't simply be rewrapped: make a new copy.
                    let _ = fs::remove_file(&temp);
                    optimize(ffmpeg, file, &temp, seconds, progress, &mut plan, CopyKind::Intermediate)?;
                }"""),
("""        Needs::Optimize => {
            let out = cache.join(cache_name(file, "mp4"));
            if !out.is_file() {
                let temp = out.with_extension("making.mp4");
                optimize(ffmpeg, file, &temp, seconds, progress)?;
                fs::rename(&temp, &out).map_err(|e| e.to_string())?;
            }
            Some(out)
        }""","""        Needs::Optimize => {
            let out = cache.join(cache_name(file, "edit.mp4"));
            if !out.is_file() {
                let temp = out.with_extension("making.mp4");
                optimize(ffmpeg, file, &temp, seconds, progress, &mut plan, CopyKind::Intermediate)?;
                fs::rename(&temp, &out).map_err(|e| e.to_string())?;
            }
            Some(out)
        }"""),
("""    Ok(Prepared {
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
}""","""    Ok(prepared(file, &info, proxy, duration_ms, still, plan))
}

/// What the editor is told about a file.
fn prepared(file: &Path, info: &Probe, proxy: Option<PathBuf>, duration_ms: f64, still: bool, plan: crate::formats::Plan) -> Prepared {
    // A turned picture is shown upright: its size is the other way round.
    let turned = matches!(info.rotation, 90 | 270);
    let fps = match plan.cfr {
        Some(r) if proxy.is_some() => r,
        _ if info.fps > 0.0 => info.fps,
        _ => 30.0,
    };
    Prepared {
        path: file.to_string_lossy().into_owned(),
        proxy: proxy.map(|p| p.to_string_lossy().into_owned()),
        fps,
        duration_ms,
        has_video: info.video.is_some(),
        has_audio: info.audio && !still,
        width: if turned { info.height } else { info.width },
        height: if turned { info.width } else { info.height },
        source: Some(plan),
        pending: false,
    }
}

/// Look at a file without making anything (quick): what it is, and whether a copy will be made.
///
/// # Errors
/// The file is missing or FFmpeg can't run.
pub fn look(ffmpeg: &Path, file: &Path) -> Result<Prepared, String> {
    if !file.is_file() {
        return Err(format!("{} was not found.", file.display()));
    }
    let info = probe(ffmpeg, file)?;
    if info.video.is_none() && !info.audio {
        return Err(format!(
            "{} has no picture or sound Lumora Studio can use.",
            file.file_name().and_then(|n| n.to_str()).unwrap_or("This file")
        ));
    }
    let plan = crate::formats::plan(file, &info);
    let pending = plan.need != Needs::Nothing;
    let still = matches!(plan.need, Needs::Picture) || info.still;
    let duration_ms = if still { 0.0 } else { info.duration_ms.unwrap_or(0.0) };
    let mut p = prepared(file, &info, None, duration_ms, still, plan);
    p.pending = pending;
    Ok(p)
}

/// A copy made with FFmpeg: an edit-friendly intermediate, or a lighter playback proxy.
/// HDR that can't be tone-mapped on this computer is copied as it is (and the note says so).
fn optimize(
    ffmpeg: &Path,
    file: &Path,
    out: &Path,
    seconds: f64,
    progress: &dyn Fn(f64),
    plan: &mut crate::formats::Plan,
    kind: CopyKind,
) -> Result<(), String> {
    let args = copy_args(file, out, plan, kind, true);
    match run_with_progress(ffmpeg, &args, seconds, progress) {
        Err(_) if plan.tone_map => {
            let _ = fs::remove_file(out);
            run_with_progress(ffmpeg, &copy_args(file, out, plan, kind, false), seconds, progress)?;
            plan.note = Some("HDR: its colors could not be converted to SDR on this computer, so they may look flat.".into());
            Ok(())
        }
        r => r,
    }
}

/// A lighter copy of a heavy file for smooth playback (kept in `cache`, made once).
///
/// # Errors
/// FFmpeg can't read the file.
pub fn playback_proxy(ffmpeg: &Path, file: &Path, cache: &Path, progress: &dyn Fn(f64)) -> Result<String, String> {
    let info = probe(ffmpeg, file)?;
    let mut plan = crate::formats::plan(file, &info);
    let out = cache.join(cache_name(file, "proxy.mp4"));
    if !out.is_file() {
        let _ = fs::create_dir_all(cache);
        let temp = out.with_extension("making.mp4");
        let seconds = info.duration_ms.unwrap_or(0.0) / 1000.0;
        optimize(ffmpeg, file, &temp, seconds, progress, &mut plan, CopyKind::Proxy)?;
        fs::rename(&temp, &out).map_err(|e| e.to_string())?;
    }
    Ok(out.to_string_lossy().into_owned())
}"""),
("""            "{} has no picture or sound Lumora Edit can use.",""","""            "{} has no picture or sound Lumora Studio can use.","""),
("""use serde::Serialize;
""","""use serde::Serialize;

use crate::formats::{copy_args, CopyKind};
"""),
])
print('ok')
