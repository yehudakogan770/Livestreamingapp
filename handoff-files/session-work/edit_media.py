import sys
p = sys.argv[1]
s = open(p).read()


def rep(a, b, count=1):
    global s
    assert s.count(a) >= 1, a[:80]
    s = s.replace(a, b, count)


rep("use crate::formats::{copy_args, CopyKind};", "use crate::formats::{copy_args_with, CopyEncoding, CopyKind};")

# run_with_progress -> run_ffmpeg returning the full stderr
rep('''/// Run FFmpeg, saying how far along it is (0–1).
fn run_with_progress(
    ffmpeg: &Path,
    args: &[std::ffi::OsString],
    seconds: f64,
    progress: &dyn Fn(f64),
) -> Result<(), String> {''', '''/// Run FFmpeg, saying how far along it is (0–1).
fn run_with_progress(
    ffmpeg: &Path,
    args: &[std::ffi::OsString],
    seconds: f64,
    progress: &dyn Fn(f64),
) -> Result<(), String> {
    run_ffmpeg(ffmpeg, args, seconds, progress).map_err(|(message, _)| message)
}

/// Run FFmpeg with progress; on failure, the message to show and everything FFmpeg said.
fn run_ffmpeg(
    ffmpeg: &Path,
    args: &[std::ffi::OsString],
    seconds: f64,
    progress: &dyn Fn(f64),
) -> Result<(), (String, String)> {''')
rep('''        .spawn()
        .map_err(|e| format!("FFmpeg could not start: {e}"))?;
    let stderr = child.stderr.take();
    let said = std::thread::spawn(move || {''', '''        .spawn()
        .map_err(|e| (format!("FFmpeg could not start: {e}"), String::new()))?;
    let stderr = child.stderr.take();
    let said = std::thread::spawn(move || {''')
rep('''    if ok {
        Ok(())
    } else {
        Err(format!(
            "This file could not be read: {}",
            said.lines()
                .rfind(|l| !l.trim().is_empty())
                .unwrap_or("unknown problem")
        ))
    }
}''', '''    if ok {
        Ok(())
    } else {
        Err((
            format!(
                "This file could not be read: {}",
                said.lines()
                    .rfind(|l| !l.trim().is_empty())
                    .unwrap_or("unknown problem")
            ),
            said,
        ))
    }
}''')

# optimize callers in import: add encoding arg
rep('''                    optimize(
                        ffmpeg,
                        file,
                        &temp,
                        seconds,
                        progress,
                        &mut plan,
                        CopyKind::Intermediate,
                    )?;''', '''                    optimize(
                        ffmpeg,
                        file,
                        &temp,
                        seconds,
                        progress,
                        &mut plan,
                        CopyKind::Intermediate,
                        &CopyEncoding::default(),
                    )?;''')
rep('''                optimize(
                    ffmpeg,
                    file,
                    &temp,
                    seconds,
                    progress,
                    &mut plan,
                    CopyKind::Intermediate,
                )?;''', '''                optimize(
                    ffmpeg,
                    file,
                    &temp,
                    seconds,
                    progress,
                    &mut plan,
                    CopyKind::Intermediate,
                    &CopyEncoding::default(),
                )?;''')

a = s.index("/// A copy made with FFmpeg: an edit-friendly intermediate, or a lighter playback proxy.")
b = s.index("/// Small pictures of a video along its length")
s = s[:a] + '''/// A copy made with FFmpeg: an edit-friendly intermediate, or a lighter playback proxy.
/// The hardware decoder (and a hardware encoder, when `how` names one) is tried
/// first; when that fails the copy is made again in software.
#[allow(clippy::too_many_arguments)]
fn optimize(
    ffmpeg: &Path,
    file: &Path,
    out: &Path,
    seconds: f64,
    progress: &dyn Fn(f64),
    plan: &mut crate::formats::Plan,
    kind: CopyKind,
    how: &CopyEncoding,
) -> Result<(), String> {
    let hw = crate::hwaccel::global();
    let first = CopyEncoding {
        decode: hw.args(ffmpeg),
        ..how.clone()
    };
    let hardware = !first.decode.is_empty() || first.encoder.is_some();
    match optimize_once(ffmpeg, file, out, seconds, progress, plan, kind, &first) {
        Ok(()) => Ok(()),
        Err((message, said)) => {
            if !hardware {
                return Err(message);
            }
            if !first.decode.is_empty() {
                hw.failed(&said);
            }
            let _ = fs::remove_file(out);
            let soft = CopyEncoding {
                encoder: None,
                threads: how.threads,
                decode: Vec::new(),
            };
            optimize_once(ffmpeg, file, out, seconds, progress, plan, kind, &soft)
                .map_err(|(m, _)| m)
        }
    }
}

/// One go at a copy. HDR that can't be tone-mapped on this computer is copied
/// as it is (and the note says so).
#[allow(clippy::too_many_arguments)]
fn optimize_once(
    ffmpeg: &Path,
    file: &Path,
    out: &Path,
    seconds: f64,
    progress: &dyn Fn(f64),
    plan: &mut crate::formats::Plan,
    kind: CopyKind,
    how: &CopyEncoding,
) -> Result<(), (String, String)> {
    let args = copy_args_with(file, out, plan, kind, true, how);
    match run_ffmpeg(ffmpeg, &args, seconds, progress) {
        Err(_) if plan.tone_map => {
            let _ = fs::remove_file(out);
            run_ffmpeg(
                ffmpeg,
                &copy_args_with(file, out, plan, kind, false, how),
                seconds,
                progress,
            )?;
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
pub fn playback_proxy(
    ffmpeg: &Path,
    file: &Path,
    cache: &Path,
    progress: &dyn Fn(f64),
) -> Result<String, String> {
    playback_proxy_with(ffmpeg, file, cache, progress, &CopyEncoding::default())
}

/// [`playback_proxy`], encoded as `how` says (a hardware encoder, a share of the processor).
///
/// # Errors
/// FFmpeg can't read the file.
pub fn playback_proxy_with(
    ffmpeg: &Path,
    file: &Path,
    cache: &Path,
    progress: &dyn Fn(f64),
    how: &CopyEncoding,
) -> Result<String, String> {
    let info = probe(ffmpeg, file)?;
    let mut plan = crate::formats::plan(file, &info);
    let out = cache.join(cache_name(file, "proxy.mp4"));
    if !out.is_file() {
        let _ = fs::create_dir_all(cache);
        // Each proxy made side by side has its own work file.
        let temp = out.with_extension(format!("making-{}.mp4", std::process::id()));
        let seconds = info.duration_ms.unwrap_or(0.0) / 1000.0;
        optimize(
            ffmpeg,
            file,
            &temp,
            seconds,
            progress,
            &mut plan,
            CopyKind::Proxy,
            how,
        )?;
        fs::rename(&temp, &out).map_err(|e| e.to_string())?;
    }
    Ok(out.to_string_lossy().into_owned())
}

''' + s[b:]
open(p, 'w').write(s)
