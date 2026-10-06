//! Hardware decoding for everything FFmpeg reads (proxies, edit-friendly
//! copies, frames for the film, the render cache): the graphics card's or the
//! processor's video decoder (NVDEC, Quick Sync, D3D11VA/DXVA2, VideoToolbox,
//! VA-API) when this computer has one that works, and the software decoder
//! otherwise. A hardware decoder that fails is dropped for the rest of the
//! session and the work is done again in software, so nothing ever fails
//! because of it.

use std::ffi::OsString;
use std::path::Path;
use std::process::Stdio;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};

use serde::Serialize;

use crate::media::quiet;

/// The decoders to try on this kind of computer, best first.
#[must_use]
pub fn preference() -> &'static [&'static str] {
    if cfg!(windows) {
        &["cuda", "qsv", "d3d11va", "dxva2"]
    } else if cfg!(target_os = "macos") {
        &["videotoolbox"]
    } else {
        &["cuda", "vaapi", "qsv"]
    }
}

/// The methods in `ffmpeg -hwaccels` output.
#[must_use]
pub fn parse_hwaccels(said: &str) -> Vec<String> {
    let mut out = Vec::new();
    let mut started = false;
    for line in said.lines() {
        let t = line.trim();
        if t.to_ascii_lowercase()
            .starts_with("hardware acceleration methods")
        {
            started = true;
            continue;
        }
        if !started || t.is_empty() || t.contains(' ') {
            continue;
        }
        if t.chars().all(|c| c.is_ascii_alphanumeric() || c == '_') && !out.iter().any(|n| n == t) {
            out.push(t.to_owned());
        }
    }
    out
}

/// The methods FFmpeg lists, in the order to try them (only ones this kind of computer uses).
#[must_use]
pub fn candidates(listed: &[String], order: &[&str]) -> Vec<String> {
    order
        .iter()
        .filter(|m| listed.iter().any(|l| l == *m))
        .map(|m| (*m).to_owned())
        .collect()
}

/// FFmpeg's input options to decode with `method` (none: software). Frames come
/// back to ordinary memory, so every filter (tone mapping, scaling) still works.
#[must_use]
pub fn decode_args(method: Option<&str>) -> Vec<OsString> {
    match method {
        Some(m) if !m.is_empty() => vec!["-hwaccel".into(), m.into()],
        _ => Vec::new(),
    }
}

/// FFmpeg's words when the hardware decoder itself is the problem (not the file).
#[must_use]
pub fn hardware_failed(said: &str) -> bool {
    let s = said.to_ascii_lowercase();
    [
        "device creation failed",
        "failed setup for format",
        "hwaccel initialisation returned error",
        "hwaccel initialization returned error",
        "no device available for decoder",
        "failed to create",
        "cannot load nvcuda",
        "cannot load libcuda",
        "cuda_error",
        "failed to initialise vaapi",
        "failed to initialize vaapi",
        "no va display found",
        "error creating a mfx session",
        "error initializing an mfx session",
        "videotoolbox",
        "d3d11va",
        "dxva2",
        "hardware device setup failed",
        "failed to get hw",
    ]
    .iter()
    .any(|w| s.contains(w))
}

/// Can FFmpeg open this kind of hardware device here (a moment's check)?
fn device_works(ffmpeg: &Path, method: &str) -> bool {
    let Ok(mut child) = quiet(ffmpeg)
        .args([
            "-hide_banner",
            "-nostdin",
            "-loglevel",
            "error",
            "-init_hw_device",
            method,
            "-f",
            "lavfi",
            "-i",
            "nullsrc=s=64x64:d=0.04",
            "-frames:v",
            "1",
            "-f",
            "null",
            "-",
        ])
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
    else {
        return false;
    };
    let until = Instant::now() + Duration::from_secs(8);
    loop {
        match child.try_wait() {
            Ok(Some(s)) => return s.success(),
            Ok(None) if Instant::now() < until => std::thread::sleep(Duration::from_millis(30)),
            _ => {
                let _ = child.kill();
                let _ = child.wait();
                return false;
            }
        }
    }
}

/// What the settings show about hardware decoding.
#[derive(Serialize, Debug, Clone, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    /// `auto` (use it when it works) or `off`.
    pub mode: String,
    /// The decoder in use (none: software).
    pub method: Option<String>,
    /// What FFmpeg offers on this computer.
    pub listed: Vec<String>,
    /// A hardware decoder failed this session and was turned off.
    pub fell_back: bool,
}

/// The session's hardware decoding: found once, turned off on the first failure.
pub struct HwAccel {
    off: AtomicBool,
    broken: AtomicBool,
    found: OnceLock<(Vec<String>, Option<String>)>,
    lock: Mutex<()>,
}

impl HwAccel {
    const fn new() -> Self {
        Self {
            off: AtomicBool::new(false),
            broken: AtomicBool::new(false),
            found: OnceLock::new(),
            lock: Mutex::new(()),
        }
    }

    fn detect(&self, ffmpeg: &Path) -> &(Vec<String>, Option<String>) {
        if let Some(f) = self.found.get() {
            return f;
        }
        // One check at a time (several proxies may start together).
        let _g = self
            .lock
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        self.found.get_or_init(|| {
            let said = quiet(ffmpeg)
                .args(["-hide_banner", "-hwaccels"])
                .stderr(Stdio::null())
                .output()
                .map(|o| String::from_utf8_lossy(&o.stdout).into_owned())
                .unwrap_or_default();
            let listed = parse_hwaccels(&said);
            let method = candidates(&listed, preference())
                .into_iter()
                .find(|m| device_works(ffmpeg, m));
            eprintln!("lumora-edit: hardware decoding {method:?} (offered {listed:?})");
            (listed, method)
        })
    }

    /// The hardware decoder to use now (none: software).
    pub fn method(&self, ffmpeg: &Path) -> Option<String> {
        if self.off.load(Ordering::Relaxed) || self.broken.load(Ordering::Relaxed) {
            return None;
        }
        self.detect(ffmpeg).1.clone()
    }

    /// FFmpeg's input options for decoding now.
    pub fn args(&self, ffmpeg: &Path) -> Vec<OsString> {
        decode_args(self.method(ffmpeg).as_deref())
    }

    /// A hardware decode failed: when FFmpeg blamed the hardware, it isn't used again this session.
    pub fn failed(&self, said: &str) {
        if hardware_failed(said) {
            self.broken.store(true, Ordering::Relaxed);
        }
    }

    pub fn set_mode(&self, auto: bool) {
        self.off.store(!auto, Ordering::Relaxed);
        if auto {
            self.broken.store(false, Ordering::Relaxed);
        }
    }

    pub fn status(&self, ffmpeg: &Path) -> Status {
        let (listed, _) = self.detect(ffmpeg);
        Status {
            mode: if self.off.load(Ordering::Relaxed) {
                "off".into()
            } else {
                "auto".into()
            },
            method: self.method(ffmpeg),
            listed: listed.clone(),
            fell_back: self.broken.load(Ordering::Relaxed),
        }
    }
}

static GLOBAL: HwAccel = HwAccel::new();

/// The session's hardware decoding.
#[must_use]
pub fn global() -> &'static HwAccel {
    &GLOBAL
}

/// Run something with the hardware first (the decoder's input options, and
/// `hardware: true` for anything else of the graphics card's, such as its
/// encoder) and, when that fails, again in software. `run` fails with the
/// message to show and everything FFmpeg said.
///
/// # Errors
/// The software run failed too (its message is given).
pub fn with_fallback<T>(
    hw: &HwAccel,
    ffmpeg: &Path,
    other_hardware: bool,
    mut run: impl FnMut(&[OsString], bool) -> Result<T, (String, String)>,
) -> Result<T, String> {
    let args = hw.args(ffmpeg);
    if args.is_empty() && !other_hardware {
        return run(&[], false).map_err(|(m, _)| m);
    }
    match run(&args, true) {
        Ok(v) => Ok(v),
        Err((_, said)) => {
            if !args.is_empty() {
                hw.failed(&said);
            }
            run(&[], false).map_err(|(m, _)| m)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const SAID: &str = "Hardware acceleration methods:
vdpau
cuda
vaapi
qsv
drm
opencl
vulkan

";

    #[test]
    fn reads_the_method_list() {
        assert_eq!(
            parse_hwaccels(SAID),
            vec!["vdpau", "cuda", "vaapi", "qsv", "drm", "opencl", "vulkan"]
        );
        assert!(parse_hwaccels("").is_empty());
        // Banner lines and anything before the heading are not methods.
        assert!(parse_hwaccels("ffmpeg version 7\nlibavutil 59\ncuda").is_empty());
    }

    #[test]
    fn tries_methods_in_the_platform_order() {
        let listed = parse_hwaccels(SAID);
        assert_eq!(
            candidates(&listed, &["cuda", "vaapi", "qsv"]),
            vec!["cuda", "vaapi", "qsv"]
        );
        assert_eq!(
            candidates(&listed, &["cuda", "qsv", "d3d11va", "dxva2"]),
            vec!["cuda", "qsv"]
        );
        assert!(candidates(&listed, &["videotoolbox"]).is_empty());
        let windows: Vec<String> = ["dxva2", "d3d11va", "qsv"].map(String::from).to_vec();
        assert_eq!(
            candidates(&windows, &["cuda", "qsv", "d3d11va", "dxva2"]),
            vec!["qsv", "d3d11va", "dxva2"]
        );
        assert!(!preference().is_empty());
    }

    #[test]
    fn decode_arguments() {
        assert!(decode_args(None).is_empty());
        assert!(decode_args(Some("")).is_empty());
        assert_eq!(
            decode_args(Some("cuda")),
            vec![OsString::from("-hwaccel"), OsString::from("cuda")]
        );
    }

    #[test]
    fn knows_when_the_hardware_is_to_blame() {
        assert!(hardware_failed(
            "[AVHWDeviceContext @ 0x1] Cannot load libcuda.so.1\nDevice creation failed: -1313558101."
        ));
        assert!(hardware_failed(
            "[h264 @ 0x2] Failed setup for format cuda: hwaccel initialisation returned error."
        ));
        assert!(hardware_failed(
            "[AVHWDeviceContext] No VA display found for device /dev/dri/renderD128."
        ));
        assert!(!hardware_failed("x.mov: No such file or directory"));
        assert!(!hardware_failed("Invalid data found when processing input"));
    }

    #[test]
    fn falls_back_to_software() {
        let hw = HwAccel::new();
        // Pretend detection found CUDA.
        let _ = hw.found.set((vec!["cuda".into()], Some("cuda".into())));
        let ff = Path::new("ffmpeg");
        assert_eq!(hw.method(ff).as_deref(), Some("cuda"));
        let mut tries = Vec::new();
        let r = with_fallback(&hw, ff, false, |a, hard| {
            tries.push((a.len(), hard));
            if a.is_empty() {
                Ok(7)
            } else {
                Err(("x".to_owned(), "Device creation failed: -1.".to_owned()))
            }
        });
        assert_eq!(r, Ok(7));
        assert_eq!(tries, vec![(2, true), (0, false)]);
        // Software decoding, but a hardware encoder: still tried first, then software.
        let mut tries = Vec::new();
        let r: Result<(), String> = with_fallback(&hw, ff, true, |a, hard| {
            tries.push((a.len(), hard));
            Err(("no".to_owned(), String::new()))
        });
        assert_eq!(r, Err("no".to_owned()));
        assert_eq!(tries, vec![(0, true), (0, false)]);
        // The hardware was to blame: software from now on.
        assert_eq!(hw.method(ff), None);
        assert!(hw.status(ff).fell_back);
        // Turned on again in the settings: tried again.
        hw.set_mode(true);
        assert_eq!(hw.method(ff).as_deref(), Some("cuda"));
        hw.set_mode(false);
        assert_eq!(hw.method(ff), None);
        assert_eq!(hw.status(ff).mode, "off");
    }

    #[test]
    fn a_file_problem_keeps_the_hardware() {
        let hw = HwAccel::new();
        let _ = hw.found.set((vec!["vaapi".into()], Some("vaapi".into())));
        let ff = Path::new("ffmpeg");
        let mut n = 0;
        let r: Result<(), String> = with_fallback(&hw, ff, false, |_, _| {
            n += 1;
            Err(("bad".into(), "Invalid data found".into()))
        });
        assert_eq!(r, Err("bad".into()));
        assert_eq!(n, 2, "software is tried too");
        assert_eq!(hw.method(ff).as_deref(), Some("vaapi"));
    }
}
