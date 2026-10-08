//! Zero-copy encoding: a screen feed's picture handed to the graphics
//! card's own encoder (NVIDIA NVENC, Intel Quick Sync, AMD AMF) as a texture,
//! instead of being made NV12, read back to the processor and piped to
//! FFmpeg as raw frames (3.1 MB a frame at 1080p, ≈190 MB/s at 60 fps).
//!
//! **The path chosen (Windows).** The engine draws with Direct3D 12 (wgpu).
//! Each feed gets a small ring of textures made by the engine's own D3D12
//! device as *shared* resources (`D3D12_HEAP_FLAG_SHARED`, simultaneous
//! access), opened on a Direct3D 11 device on the **same** graphics card
//! (matched by its LUID). Every frame the engine copies the feed's picture
//! into the next texture of the ring and signals a shared fence after the
//! copy (`wgpu-hal`'s `add_signal_fence`); a worker thread waits for that
//! fence on the D3D11 side (GPU-side wait, no processor stall), turns the
//! RGBA picture into NV12 with the card's video processor (BT.709, limited
//! range: the same colors as the read-back path's `fs_nv12`) and gives the
//! NV12 texture to the vendor's **Media Foundation hardware encoder**
//! (`MFT_ENUM_FLAG_HARDWARE`: NVIDIA's, Intel's and AMD's drivers each
//! install one; it takes D3D11 textures through `IMFDXGIDeviceManager`),
//! then signals a second shared fence the engine waits for (again on the
//! GPU) before it reuses that texture. The encoded H.264 comes back as an
//! elementary stream that FFmpeg copies into the container with the sound
//! (`encoder::encoded_input`), so files, destinations, reconnects and
//! backups are unchanged.
//!
//! **Why Media Foundation rather than FFmpeg's libraries or the vendor
//! SDKs.** Linking libavcodec with D3D11 frames would need FFmpeg's shared
//! libraries shipped next to the app (today only `ffmpeg.exe` is, the
//! static "essentials" build) and a C build in CI; the three vendor SDKs
//! (nvEncodeAPI, AMF, oneVPL) are three APIs to keep up with. The hardware
//! encoder MFTs are part of each vendor's display driver, need nothing
//! shipped, take D3D11 textures natively and are what Windows' own camera
//! app, Teams and the WebView's MediaRecorder use — so they are the most
//! likely to be present and working on an event PC. The encoder settings
//! are the app's (`encode.rs`): the operator's choice of encoder (by
//! vendor), bitrate and rate control, speed against quality, and a keyframe
//! every 2 seconds ([`Settings`]).
//!
//! **Fallback.** Anything that does not work — no Direct3D 12 (the engine on
//! Vulkan or GL), no hardware encoder of the chosen vendor on the engine's
//! graphics card, the processor encoder chosen, a driver that refuses the
//! texture or the settings — and the feed takes the read-back path as before,
//! with the reason in the Engine dialog and the test event. An encoder that
//! stops in the middle ends the feed with its reason (the app starts the
//! session again) and zero-copy is not tried again until Lumora restarts
//! ([`broken`]).
//!
//! Elsewhere (Linux and macOS development builds) there is no zero-copy
//! encoder; [`standin`] does the same hand-over through a copy and FFmpeg
//! (for tests and the benchmark).

use std::sync::mpsc::Receiver;
use std::sync::{Mutex, PoisonError};

use serde::Serialize;

use crate::encoder::Bitstream;
use crate::gpu::Compositor;

/// The graphics card maker whose encoder is used (the operator's choice of
/// encoder in Settings → Recording, as `encode.rs` picks it).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Vendor {
    Nvidia,
    Intel,
    Amd,
}

impl Vendor {
    /// The PCI vendor id (what Media Foundation lists hardware encoders by).
    pub fn pci_id(self) -> u32 {
        match self {
            Vendor::Nvidia => 0x10de,
            Vendor::Intel => 0x8086,
            Vendor::Amd => 0x1002,
        }
    }

    /// The encoder's name for the operator.
    pub fn label(self) -> &'static str {
        match self {
            Vendor::Nvidia => "NVIDIA NVENC",
            Vendor::Intel => "Intel Quick Sync",
            Vendor::Amd => "AMD AMF",
        }
    }

    /// From Media Foundation's `VEN_10DE`-style vendor string.
    pub fn from_mf(vendor: &str) -> Option<Vendor> {
        let hex = vendor.trim().to_ascii_uppercase();
        let id = u32::from_str_radix(hex.strip_prefix("VEN_").unwrap_or(&hex), 16).ok()?;
        [Vendor::Nvidia, Vendor::Intel, Vendor::Amd]
            .into_iter()
            .find(|v| v.pci_id() == id)
    }
}

/// How the bits are spent (as `encode::Rate`).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Rate {
    /// Constant bitrate (streams).
    Cbr { kbps: u32 },
    /// Constant quality on the x264 CRF scale (lower is better), never above `max_kbps`.
    Quality { level: u8, max_kbps: u32 },
}

/// Speed against quality (as `encode::Preset`).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Speed {
    Speed,
    Balanced,
    Quality,
}

/// What the encoder on the graphics card is asked for: the same settings the
/// app gives FFmpeg (`encode::video_args`).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Settings {
    pub vendor: Vendor,
    /// HEVC instead of H.264.
    pub hevc: bool,
    pub rate: Rate,
    pub speed: Speed,
    /// Frames between keyframes (2 seconds' worth; a replay's piece length).
    pub gop: u32,
}

impl Settings {
    /// The encoded picture's FFmpeg name (`encoder::encoded_input`).
    pub fn pix_fmt(&self) -> &'static str {
        if self.hevc {
            "hevc"
        } else {
            "h264"
        }
    }

    /// Media Foundation's `CODECAPI_AVEncCommonQualityVsSpeed` (0 fastest – 100 best).
    pub fn quality_vs_speed(&self) -> u32 {
        match self.speed {
            Speed::Speed => 0,
            Speed::Balanced => 50,
            Speed::Quality => 100,
        }
    }

    /// The constant-quality level as Media Foundation's
    /// `CODECAPI_AVEncCommonQuality` (0 – 100, higher is better): the CRF
    /// scale's 0 – 51 turned around.
    pub fn mf_quality(level: u8) -> u32 {
        let l = u32::from(level.min(51));
        ((51 - l) * 100 + 25) / 51
    }

    /// The bitrate it aims at (bits a second) and the largest it may use.
    pub fn bits(&self) -> (u32, u32) {
        match self.rate {
            Rate::Cbr { kbps } => (kbps * 1000, kbps * 1000),
            Rate::Quality { max_kbps, .. } => (max_kbps * 1000 / 2, max_kbps * 1000),
        }
    }
}

/// A zero-copy encoder as the engine's thread sees it.
pub trait Handoff {
    /// The picture drawn in target `target` for `copies` frames: copied on
    /// the GPU into the encoder's ring and handed over. False when the
    /// encoder can't take a frame now (the frames are owed) or has failed.
    fn submit(&mut self, gpu: &mut Compositor, target: usize, copies: u64) -> bool;
    /// Where the encoded picture goes (once FFmpeg has started).
    fn attach(&mut self, out: Bitstream);
    /// The encoder failed (the feed has been ended with the reason).
    fn failed(&self) -> Option<String>;
    /// The graphics device was lost: the encoder ends the picture (its textures went with the device).
    fn lost(&mut self);
    /// Encode what is left and let the picture end (off the engine's thread).
    fn close(&mut self);
}

/// An encoder being opened: its hand-over now, and on `ready` (from its
/// thread) a description of the path (`Ok`) or why it can't be used (`Err`:
/// the feed takes the read-back path).
pub struct Opened {
    pub handoff: Box<dyn Handoff>,
    pub ready: Receiver<Result<String, String>>,
}

/// Opens a zero-copy encoder for a `width` × `height` feed at `fps` on the engine's device.
pub type Opener =
    Box<dyn Fn(&Compositor, (u32, u32), u32, &Settings) -> Result<Opened, String> + Send>;

/// The zero-copy encoder of this computer (Windows: Media Foundation on
/// Direct3D 12), when there is one.
pub fn platform() -> Option<Opener> {
    #[cfg(windows)]
    {
        Some(Box::new(crate::zerocopy_win::open))
    }
    #[cfg(not(windows))]
    {
        None
    }
}

/// Whether an Annex B piece of H.264 (or HEVC) carries its parameter sets
/// (an SPS; HEVC: a VPS), which a player needs before the first picture.
/// Some encoders give them only in their output format, not in the stream.
pub fn has_parameter_sets(data: &[u8], hevc: bool) -> bool {
    let mut i = 0;
    while i + 3 < data.len() {
        if data[i] == 0 && data[i + 1] == 0 && data[i + 2] == 1 {
            let header = data[i + 3];
            let is_set = if hevc {
                (header >> 1) & 0x3f == 32
            } else {
                header & 0x1f == 7
            };
            if is_set {
                return true;
            }
            i += 3;
        } else {
            i += 1;
        }
    }
    false
}

static BROKEN: Mutex<Option<String>> = Mutex::new(None);

/// Why zero-copy is not used any more (an encoder stopped in the middle of a
/// recording or stream): set until Lumora restarts.
pub fn broken() -> Option<String> {
    BROKEN
        .lock()
        .unwrap_or_else(PoisonError::into_inner)
        .clone()
}

/// Zero-copy stopped working: the next sessions read back instead.
pub fn mark_broken(why: &str) {
    BROKEN
        .lock()
        .unwrap_or_else(PoisonError::into_inner)
        .get_or_insert_with(|| why.to_owned());
}

/// How a feed's picture reaches its encoder (for the Engine dialog and the test event).
#[derive(Debug, Clone, Serialize, PartialEq, Eq, Default)]
#[serde(rename_all = "camelCase")]
pub struct Route {
    /// The texture goes to the graphics card's encoder (no read-back).
    pub zero_copy: bool,
    /// In words: which encoder, or the read-back and why.
    pub path: String,
}

impl Route {
    pub fn read_back(why: Option<&str>) -> Self {
        Route {
            zero_copy: false,
            path: match why {
                Some(w) => format!("read back as NV12 to FFmpeg ({w})"),
                None => "read back as NV12 to FFmpeg".to_owned(),
            },
        }
    }
}

/// The same hand-over without a hardware encoder (tests, the benchmark,
/// development on Linux): the picture is copied into a ring of textures on
/// the GPU as on Windows, then read back and encoded by FFmpeg (x264) into
/// an H.264 elementary stream for the feed. It proves the engine's side —
/// the ring, the copies, the frames owed, the encoded picture into the file —
/// everywhere; the Windows encoder replaces only the last step.
pub mod standin {
    use std::io::{Read, Write};
    use std::path::{Path, PathBuf};
    use std::process::Stdio;
    use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
    use std::sync::mpsc::{channel, Sender};
    use std::sync::{Arc, Mutex};
    use std::thread;

    use super::{Handoff, Opened, Opener, Settings};
    use crate::encoder::Bitstream;
    use crate::gpu::{Compositor, TARGET_FORMAT};
    use crate::source::quiet;

    /// Frames handed over and not yet encoded, at most.
    const IN_FLIGHT: usize = 2;
    const RING: usize = 3;

    enum Job {
        Frame(Vec<u8>, u64),
        Attach(Bitstream),
        Lost,
        Stop,
    }

    struct StandIn {
        ring: Vec<wgpu::Texture>,
        next: usize,
        size: (u32, u32),
        jobs: Sender<Job>,
        in_flight: Arc<AtomicUsize>,
        failed: Arc<Mutex<Option<String>>>,
        closed: bool,
        /// Copies made into the ring (for tests).
        pub copies: Arc<AtomicUsize>,
    }

    /// An opener that encodes with FFmpeg at `ffmpeg` (x264) after the GPU
    /// copy; `copies` counts the ring copies (tests check it).
    pub fn opener(ffmpeg: PathBuf, copies: Arc<AtomicUsize>) -> Opener {
        Box::new(move |gpu, size, fps, settings| open(gpu, size, fps, settings, &ffmpeg, &copies))
    }

    fn open(
        gpu: &Compositor,
        (w, h): (u32, u32),
        fps: u32,
        settings: &Settings,
        ffmpeg: &Path,
        copies: &Arc<AtomicUsize>,
    ) -> Result<Opened, String> {
        let ring = (0..RING)
            .map(|_| {
                gpu.device.create_texture(&wgpu::TextureDescriptor {
                    label: Some("zero-copy ring"),
                    size: wgpu::Extent3d {
                        width: w,
                        height: h,
                        depth_or_array_layers: 1,
                    },
                    mip_level_count: 1,
                    sample_count: 1,
                    dimension: wgpu::TextureDimension::D2,
                    format: TARGET_FORMAT,
                    usage: wgpu::TextureUsages::COPY_DST | wgpu::TextureUsages::COPY_SRC,
                    view_formats: &[],
                })
            })
            .collect();
        let (jobs, rx) = channel::<Job>();
        let (ready_tx, ready) = channel();
        let in_flight = Arc::new(AtomicUsize::new(0));
        let failed = Arc::new(Mutex::new(None));
        let (fl, fail) = (Arc::clone(&in_flight), Arc::clone(&failed));
        let ffmpeg = ffmpeg.to_owned();
        let settings = *settings;
        thread::Builder::new()
            .name("lumora-zero-copy-standin".into())
            .spawn(move || {
                let kbps = settings.bits().0 / 1000;
                let child = quiet(&ffmpeg)
                    .args(["-hide_banner", "-loglevel", "error", "-f", "rawvideo"])
                    .args(["-pix_fmt", "rgba", "-s", &format!("{w}x{h}")])
                    .args(["-framerate", &fps.to_string(), "-i", "-"])
                    .args(["-c:v", "libx264", "-preset", "ultrafast", "-bf", "0"])
                    .args(["-g", &settings.gop.max(1).to_string()])
                    .args(["-b:v", &format!("{kbps}k"), "-pix_fmt", "yuv420p"])
                    .args(["-f", settings.pix_fmt(), "-"])
                    .stdin(Stdio::piped())
                    .stdout(Stdio::piped())
                    .stderr(Stdio::null())
                    .spawn();
                let mut child = match child {
                    Ok(c) => c,
                    Err(e) => {
                        let _ = ready_tx.send(Err(format!("FFmpeg could not start: {e}")));
                        return;
                    }
                };
                let _ = ready_tx.send(Ok("zero-copy stand-in: GPU ring copy, FFmpeg x264".into()));
                let (Some(mut stdin), Some(mut stdout)) = (child.stdin.take(), child.stdout.take())
                else {
                    return;
                };
                let out: Arc<Mutex<Option<Bitstream>>> = Arc::default();
                let o = Arc::clone(&out);
                let reader = thread::spawn(move || {
                    let mut buf = vec![0u8; 64 * 1024];
                    let mut pending = Vec::new();
                    while let Ok(n) = stdout.read(&mut buf) {
                        if n == 0 {
                            break;
                        }
                        pending.extend_from_slice(&buf[..n]);
                        if let Some(b) = o.lock().ok().and_then(|g| g.clone()) {
                            if !b.write(std::mem::take(&mut pending)) {
                                break;
                            }
                        }
                    }
                    if let Some(b) = o.lock().ok().and_then(|g| g.clone()) {
                        let _ = b.write(pending);
                    }
                });
                let gone = AtomicBool::new(false);
                for job in rx {
                    match job {
                        Job::Attach(b) => *out.lock().unwrap_or_else(|e| e.into_inner()) = Some(b),
                        Job::Frame(px, n) => {
                            for _ in 0..n {
                                if stdin.write_all(&px).is_err() {
                                    gone.store(true, Ordering::SeqCst);
                                    break;
                                }
                            }
                            if let Some(b) = out.lock().ok().and_then(|g| g.clone()) {
                                b.count(n);
                            }
                            fl.fetch_sub(1, Ordering::SeqCst);
                        }
                        Job::Lost => {
                            let why = "The graphics card was reset; the stand-in encoder ended.";
                            *fail.lock().unwrap_or_else(|e| e.into_inner()) = Some(why.into());
                            if let Some(b) = out.lock().ok().and_then(|g| g.clone()) {
                                b.fail(why);
                            }
                            break;
                        }
                        Job::Stop => break,
                    }
                }
                drop(stdin);
                let _ = reader.join();
                let _ = child.wait();
                // The picture ends when the last writer lets go.
                out.lock().unwrap_or_else(|e| e.into_inner()).take();
            })
            .map_err(|e| e.to_string())?;
        Ok(Opened {
            handoff: Box::new(StandIn {
                ring,
                next: 0,
                size: (w, h),
                jobs,
                in_flight,
                failed,
                closed: false,
                copies: Arc::clone(copies),
            }),
            ready,
        })
    }

    impl Handoff for StandIn {
        fn submit(&mut self, gpu: &mut Compositor, target: usize, copies: u64) -> bool {
            if self.closed || self.failed().is_some() {
                return false;
            }
            if self.in_flight.load(Ordering::SeqCst) >= IN_FLIGHT {
                return false;
            }
            let slot = &self.ring[self.next];
            self.next = (self.next + 1) % self.ring.len();
            if !gpu.copy_target_to(target, slot) {
                return false;
            }
            self.copies.fetch_add(1, Ordering::SeqCst);
            let Ok(px) = gpu.read_texture(slot, self.size) else {
                return false;
            };
            self.in_flight.fetch_add(1, Ordering::SeqCst);
            self.jobs.send(Job::Frame(px, copies)).is_ok()
        }
        fn attach(&mut self, out: Bitstream) {
            let _ = self.jobs.send(Job::Attach(out));
        }
        fn failed(&self) -> Option<String> {
            self.failed
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner)
                .clone()
        }
        fn lost(&mut self) {
            self.closed = true;
            let _ = self.jobs.send(Job::Lost);
        }
        fn close(&mut self) {
            if !std::mem::replace(&mut self.closed, true) {
                let _ = self.jobs.send(Job::Stop);
            }
        }
    }

    impl Drop for StandIn {
        fn drop(&mut self) {
            self.close();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn vendors_as_media_foundation_names_them() {
        assert_eq!(Vendor::from_mf("VEN_10DE"), Some(Vendor::Nvidia));
        assert_eq!(Vendor::from_mf("ven_8086"), Some(Vendor::Intel));
        assert_eq!(Vendor::from_mf("VEN_1002"), Some(Vendor::Amd));
        assert_eq!(
            Vendor::from_mf("VEN_1414"),
            None,
            "Microsoft's software adapter"
        );
        assert_eq!(Vendor::from_mf("rubbish"), None);
    }

    #[test]
    fn the_apps_settings_in_media_foundations_words() {
        let s = Settings {
            vendor: Vendor::Nvidia,
            hevc: false,
            rate: Rate::Cbr { kbps: 6000 },
            speed: Speed::Balanced,
            gop: 120,
        };
        assert_eq!(s.pix_fmt(), "h264");
        assert_eq!(s.bits(), (6_000_000, 6_000_000));
        assert_eq!(s.quality_vs_speed(), 50);
        let q = Settings {
            rate: Rate::Quality {
                level: 23,
                max_kbps: 20_000,
            },
            hevc: true,
            ..s
        };
        assert_eq!(q.pix_fmt(), "hevc");
        assert_eq!(q.bits(), (10_000_000, 20_000_000));
        // Lower CRF is better: higher on Media Foundation's scale.
        assert!(Settings::mf_quality(18) > Settings::mf_quality(23));
        assert_eq!(Settings::mf_quality(0), 100);
        assert_eq!(Settings::mf_quality(51), 0);
        assert_eq!(Settings::mf_quality(99), 0);
    }

    #[test]
    fn parameter_sets_are_found_in_the_stream() {
        // H.264: an SPS (type 7) after a 4-byte start code, then a PPS and a picture.
        let with = [
            0, 0, 0, 1, 0x67, 0x64, 0, 0, 1, 0x68, 0xee, 0, 0, 1, 0x65, 0x88,
        ];
        let without = [0, 0, 0, 1, 0x65, 0x88, 0x84, 0, 0, 1, 0x41, 0x9a];
        assert!(has_parameter_sets(&with, false));
        assert!(!has_parameter_sets(&without, false));
        // HEVC: a VPS is type 32 (0x40 0x01).
        assert!(has_parameter_sets(&[0, 0, 1, 0x40, 0x01, 0x0c], true));
        assert!(!has_parameter_sets(&[0, 0, 1, 0x26, 0x01, 0xaf], true));
        assert!(!has_parameter_sets(&[], false));
    }

    #[test]
    fn read_back_says_why() {
        assert_eq!(
            Route::read_back(Some("the processor encoder was chosen")).path,
            "read back as NV12 to FFmpeg (the processor encoder was chosen)"
        );
        assert!(!Route::read_back(None).zero_copy);
    }
}
