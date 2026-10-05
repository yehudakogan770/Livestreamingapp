//! NDI: video over the office network, to and from other computers, video
//! mixers and NDI cameras. Lumora uses the free NDI runtime when it is
//! installed (NDI Tools); without it, NDI is simply unavailable and the
//! operator is told where to get it. Lumora does not ship the runtime.
//!
//! The NDI library is C; this module is the only place Lumora talks to
//! foreign code, so `unsafe` is allowed here and nowhere else. The layouts
//! follow the NDI SDK headers (Processing.NDI.structs.h, v5/v6).

#![allow(unsafe_code)]

use std::ffi::{c_char, c_void, CStr, CString};
use std::sync::OnceLock;

use libloading::Library;

#[repr(C)]
struct Source {
    name: *const c_char,
    url: *const c_char,
}

#[repr(C)]
struct FindCreate {
    show_local_sources: bool,
    groups: *const c_char,
    extra_ips: *const c_char,
}

#[repr(C)]
struct RecvCreate {
    source: Source,
    color_format: i32,
    bandwidth: i32,
    allow_video_fields: bool,
    name: *const c_char,
}

#[repr(C)]
struct SendCreate {
    name: *const c_char,
    groups: *const c_char,
    clock_video: bool,
    clock_audio: bool,
}

#[repr(C)]
struct VideoFrame {
    xres: i32,
    yres: i32,
    fourcc: u32,
    frame_rate_n: i32,
    frame_rate_d: i32,
    aspect: f32,
    frame_format: i32,
    timecode: i64,
    data: *mut u8,
    line_stride: i32,
    metadata: *const c_char,
    timestamp: i64,
}

#[repr(C)]
struct AudioFrame {
    sample_rate: i32,
    channels: i32,
    samples: i32,
    timecode: i64,
    fourcc: u32,
    data: *mut u8,
    channel_stride: i32,
    metadata: *const c_char,
    timestamp: i64,
}

const fn fourcc(a: u8, b: u8, c: u8, d: u8) -> u32 {
    (a as u32) | ((b as u32) << 8) | ((c as u32) << 16) | ((d as u32) << 24)
}
const BGRA: u32 = fourcc(b'B', b'G', b'R', b'A');
const BGRX: u32 = fourcc(b'B', b'G', b'R', b'X');
const FLTP: u32 = fourcc(b'F', b'L', b'T', b'p');
const COLOR_BGRX_BGRA: i32 = 0;
const BANDWIDTH_HIGHEST: i32 = 100;
const PROGRESSIVE: i32 = 1;
const FRAME_VIDEO: i32 = 1;
const FRAME_AUDIO: i32 = 2;
/// "Let the library pick the time" (`NDIlib_send_timecode_synthesize`).
const SYNTHESIZE: i64 = i64::MAX;

type Instance = *mut c_void;

struct Lib {
    _lib: Library,
    find_create: unsafe extern "C" fn(*const FindCreate) -> Instance,
    find_destroy: unsafe extern "C" fn(Instance),
    find_wait: unsafe extern "C" fn(Instance, u32) -> bool,
    find_sources: unsafe extern "C" fn(Instance, *mut u32) -> *const Source,
    recv_create: unsafe extern "C" fn(*const RecvCreate) -> Instance,
    recv_destroy: unsafe extern "C" fn(Instance),
    recv_capture:
        unsafe extern "C" fn(Instance, *mut VideoFrame, *mut AudioFrame, *mut c_void, u32) -> i32,
    recv_free_video: unsafe extern "C" fn(Instance, *const VideoFrame),
    recv_free_audio: unsafe extern "C" fn(Instance, *const AudioFrame),
    send_create: unsafe extern "C" fn(*const SendCreate) -> Instance,
    send_destroy: unsafe extern "C" fn(Instance),
    send_video: unsafe extern "C" fn(Instance, *const VideoFrame),
    send_audio: unsafe extern "C" fn(Instance, *const AudioFrame),
}

/// Where the NDI runtime may be on this computer.
fn candidates() -> Vec<std::path::PathBuf> {
    let mut out = Vec::new();
    if let Ok(p) = std::env::var("NDI_LIB_PATH") {
        out.push(p.into());
    }
    #[cfg(windows)]
    {
        for var in ["NDI_RUNTIME_DIR_V6", "NDI_RUNTIME_DIR_V5"] {
            if let Ok(dir) = std::env::var(var) {
                out.push(std::path::Path::new(&dir).join("Processing.NDI.Lib.x64.dll"));
            }
        }
        out.push("Processing.NDI.Lib.x64.dll".into());
    }
    #[cfg(not(windows))]
    for name in ["libndi.so.6", "libndi.so.5", "libndi.so"] {
        out.push(name.into());
    }
    out
}

macro_rules! sym {
    ($lib:expr, $name:literal) => {
        // SAFETY: the symbol has this C signature in every NDI 5/6 runtime.
        *unsafe { $lib.get($name) }.map_err(|_| {
            format!(
                "This NDI runtime is too old (no {}).",
                String::from_utf8_lossy(&$name[..$name.len() - 1])
            )
        })?
    };
}

fn load() -> Result<Lib, String> {
    let mut last = String::new();
    for path in candidates() {
        // SAFETY: loading the NDI runtime runs its own start-up code only.
        let lib = match unsafe { Library::new(&path) } {
            Ok(l) => l,
            Err(e) => {
                last = e.to_string();
                continue;
            }
        };
        let initialize: unsafe extern "C" fn() -> bool = sym!(lib, b"NDIlib_initialize\0");
        // SAFETY: plain call with no arguments.
        if !unsafe { initialize() } {
            return Err("NDI can't run on this computer's processor.".to_owned());
        }
        return Ok(Lib {
            find_create: sym!(lib, b"NDIlib_find_create_v2\0"),
            find_destroy: sym!(lib, b"NDIlib_find_destroy\0"),
            find_wait: sym!(lib, b"NDIlib_find_wait_for_sources\0"),
            find_sources: sym!(lib, b"NDIlib_find_get_current_sources\0"),
            recv_create: sym!(lib, b"NDIlib_recv_create_v3\0"),
            recv_destroy: sym!(lib, b"NDIlib_recv_destroy\0"),
            recv_capture: sym!(lib, b"NDIlib_recv_capture_v3\0"),
            recv_free_video: sym!(lib, b"NDIlib_recv_free_video_v2\0"),
            recv_free_audio: sym!(lib, b"NDIlib_recv_free_audio_v3\0"),
            send_create: sym!(lib, b"NDIlib_send_create\0"),
            send_destroy: sym!(lib, b"NDIlib_send_destroy\0"),
            send_video: sym!(lib, b"NDIlib_send_send_video_v2\0"),
            send_audio: sym!(lib, b"NDIlib_send_send_audio_v3\0"),
            _lib: lib,
        });
    }
    let _ = last;
    Err("NDI needs the free NDI Runtime: install NDI Tools from ndi.video/tools, then start Lumora again.".to_owned())
}

fn lib() -> Result<&'static Lib, String> {
    static LIB: OnceLock<Result<Lib, String>> = OnceLock::new();
    LIB.get_or_init(load).as_ref().map_err(Clone::clone)
}

/// NDI can be used on this computer (the runtime is installed).
pub fn available() -> Result<(), String> {
    lib().map(|_| ())
}

/// The NDI sources on the network, by name (waits up to `wait_ms` for them
/// to show up). `extra_ips`: computers to ask directly, for networks where
/// sources don't announce themselves ("192.168.1.20, 10.0.0.5").
///
/// # Errors
/// When NDI isn't installed.
pub fn sources(wait_ms: u32, extra_ips: &str) -> Result<Vec<String>, String> {
    let l = lib()?;
    let extra = CString::new(extra_ips.trim()).unwrap_or_default();
    let create = FindCreate {
        show_local_sources: true,
        groups: std::ptr::null(),
        extra_ips: if extra.as_bytes().is_empty() {
            std::ptr::null()
        } else {
            extra.as_ptr()
        },
    };
    // SAFETY: the settings live until the call returns; the finder is destroyed below.
    let finder = unsafe { (l.find_create)(&create) };
    if finder.is_null() {
        return Err("NDI could not look for sources.".to_owned());
    }
    let mut names = Vec::new();
    let until = std::time::Instant::now() + std::time::Duration::from_millis(u64::from(wait_ms));
    while std::time::Instant::now() < until {
        // SAFETY: the finder is alive.
        unsafe { (l.find_wait)(finder, 300) };
    }
    let mut count = 0u32;
    // SAFETY: the list stays valid until the next call on this finder (copied right away).
    let list = unsafe { (l.find_sources)(finder, &mut count) };
    for i in 0..count as usize {
        // SAFETY: `count` sources follow `list`; each name is a C string.
        let s = unsafe { &*list.add(i) };
        if !s.name.is_null() {
            let name = unsafe { CStr::from_ptr(s.name) }
                .to_string_lossy()
                .into_owned();
            if !s.url.is_null() {
                // Remembered, so a receiver connects straight there (no need to find it again).
                let url = unsafe { CStr::from_ptr(s.url) }
                    .to_string_lossy()
                    .into_owned();
                addresses()
                    .lock()
                    .unwrap_or_else(std::sync::PoisonError::into_inner)
                    .insert(name.clone(), url);
            }
            names.push(name);
        }
    }
    // SAFETY: destroyed once, after use.
    unsafe { (l.find_destroy)(finder) };
    names.sort();
    Ok(names)
}

/// Where each source found was (name → address), to connect straight there.
fn addresses() -> &'static std::sync::Mutex<std::collections::HashMap<String, String>> {
    static A: OnceLock<std::sync::Mutex<std::collections::HashMap<String, String>>> =
        OnceLock::new();
    A.get_or_init(Default::default)
}

/// What came in from an NDI source.
pub enum Received {
    /// A picture, BGRA, `width × height`, rows packed.
    Video {
        width: u32,
        height: u32,
        bgra: Vec<u8>,
    },
    /// Sound: `channels` planes of `samples` floats each, at `rate`.
    Audio {
        rate: u32,
        channels: usize,
        samples: usize,
        planar: Vec<f32>,
    },
    Nothing,
}

/// A connection to one NDI source.
pub struct Receiver {
    inst: Instance,
}

// SAFETY: an NDI receiver may be used from any one thread at a time.
unsafe impl Send for Receiver {}

impl Receiver {
    /// Connect to the source named `name`.
    ///
    /// # Errors
    /// When NDI isn't installed or the connection can't be made.
    pub fn new(name: &str) -> Result<Receiver, String> {
        let l = lib()?;
        let source = CString::new(name).map_err(|_| "bad NDI name".to_owned())?;
        let known = addresses()
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .get(name)
            .and_then(|u| CString::new(u.as_str()).ok());
        let me = CString::new("Lumora").expect("no nul");
        let create = RecvCreate {
            source: Source {
                name: source.as_ptr(),
                url: known.as_ref().map_or(std::ptr::null(), |u| u.as_ptr()),
            },
            color_format: COLOR_BGRX_BGRA,
            bandwidth: BANDWIDTH_HIGHEST,
            allow_video_fields: false,
            name: me.as_ptr(),
        };
        // SAFETY: the settings and their strings live until the call returns.
        let inst = unsafe { (l.recv_create)(&create) };
        if inst.is_null() {
            return Err(format!("Could not connect to the NDI source “{name}”."));
        }
        Ok(Receiver { inst })
    }

    /// The next picture or sound (waits up to `wait_ms`).
    pub fn capture(&mut self, wait_ms: u32) -> Received {
        let Ok(l) = lib() else {
            return Received::Nothing;
        };
        let mut v = VideoFrame {
            xres: 0,
            yres: 0,
            fourcc: 0,
            frame_rate_n: 0,
            frame_rate_d: 0,
            aspect: 0.0,
            frame_format: 0,
            timecode: 0,
            data: std::ptr::null_mut(),
            line_stride: 0,
            metadata: std::ptr::null(),
            timestamp: 0,
        };
        let mut a = AudioFrame {
            sample_rate: 0,
            channels: 0,
            samples: 0,
            timecode: 0,
            fourcc: 0,
            data: std::ptr::null_mut(),
            channel_stride: 0,
            metadata: std::ptr::null(),
            timestamp: 0,
        };
        // SAFETY: the frames are filled by the library and freed below.
        let kind =
            unsafe { (l.recv_capture)(self.inst, &mut v, &mut a, std::ptr::null_mut(), wait_ms) };
        match kind {
            FRAME_VIDEO => {
                let out = if (v.fourcc == BGRA || v.fourcc == BGRX)
                    && !v.data.is_null()
                    && v.xres > 0
                    && v.yres > 0
                {
                    let (w, h, stride) = (
                        v.xres as usize,
                        v.yres as usize,
                        v.line_stride.max(0) as usize,
                    );
                    let mut bgra = Vec::with_capacity(w * h * 4);
                    for row in 0..h {
                        // SAFETY: each of `h` rows has `stride` bytes, at least `w × 4` of them picture.
                        let line =
                            unsafe { std::slice::from_raw_parts(v.data.add(row * stride), w * 4) };
                        bgra.extend_from_slice(line);
                    }
                    Received::Video {
                        width: w as u32,
                        height: h as u32,
                        bgra,
                    }
                } else {
                    Received::Nothing
                };
                // SAFETY: freed once, as captured.
                unsafe { (l.recv_free_video)(self.inst, &v) };
                out
            }
            FRAME_AUDIO => {
                let out =
                    if a.fourcc == FLTP && !a.data.is_null() && a.channels > 0 && a.samples > 0 {
                        let (ch, n, stride) = (
                            a.channels as usize,
                            a.samples as usize,
                            a.channel_stride.max(0) as usize,
                        );
                        let mut planar = Vec::with_capacity(ch * n);
                        for c in 0..ch {
                            // SAFETY: each of `ch` planes starts `stride` bytes after the last and holds `n` floats.
                            let plane = unsafe {
                                std::slice::from_raw_parts(a.data.add(c * stride).cast::<f32>(), n)
                            };
                            planar.extend_from_slice(plane);
                        }
                        Received::Audio {
                            rate: a.sample_rate.max(1) as u32,
                            channels: ch,
                            samples: n,
                            planar,
                        }
                    } else {
                        Received::Nothing
                    };
                // SAFETY: freed once, as captured.
                unsafe { (l.recv_free_audio)(self.inst, &a) };
                out
            }
            _ => Received::Nothing,
        }
    }
}

impl Drop for Receiver {
    fn drop(&mut self) {
        if let Ok(l) = lib() {
            // SAFETY: destroyed once.
            unsafe { (l.recv_destroy)(self.inst) };
        }
    }
}

/// Lumora's picture and sound, offered on the network as an NDI source.
pub struct Sender {
    inst: Instance,
    _name: CString,
}

// SAFETY: an NDI sender may be used from any one thread at a time (kept behind a lock).
unsafe impl Send for Sender {}

impl Sender {
    /// Offer a source named `name` (shown as "COMPUTER (name)").
    ///
    /// # Errors
    /// When NDI isn't installed or the source can't be made.
    pub fn new(name: &str) -> Result<Sender, String> {
        let l = lib()?;
        let name = CString::new(name).map_err(|_| "bad NDI name".to_owned())?;
        let create = SendCreate {
            name: name.as_ptr(),
            groups: std::ptr::null(),
            clock_video: false,
            clock_audio: false,
        };
        // SAFETY: the settings and the name live until the call returns (the name is kept too).
        let inst = unsafe { (l.send_create)(&create) };
        if inst.is_null() {
            return Err("Could not offer Lumora as an NDI source.".to_owned());
        }
        Ok(Sender { inst, _name: name })
    }

    /// Send a picture (BGRA, rows packed) at `fps`.
    pub fn video(&mut self, width: u32, height: u32, fps: u32, bgra: &mut [u8]) {
        let Ok(l) = lib() else { return };
        if bgra.len() < (width * height * 4) as usize {
            return;
        }
        let f = VideoFrame {
            xres: width as i32,
            yres: height as i32,
            fourcc: BGRA,
            frame_rate_n: fps as i32 * 1000,
            frame_rate_d: 1000,
            aspect: width as f32 / height.max(1) as f32,
            frame_format: PROGRESSIVE,
            timecode: SYNTHESIZE,
            data: bgra.as_mut_ptr(),
            line_stride: width as i32 * 4,
            metadata: std::ptr::null(),
            timestamp: 0,
        };
        // SAFETY: the picture stays alive while the call copies it (not the async variant).
        unsafe { (l.send_video)(self.inst, &f) };
    }

    /// Send sound: `channels` planes of `samples` floats each.
    pub fn audio(&mut self, rate: u32, channels: usize, samples: usize, planar: &mut [f32]) {
        let Ok(l) = lib() else { return };
        if planar.len() < channels * samples {
            return;
        }
        let f = AudioFrame {
            sample_rate: rate as i32,
            channels: channels as i32,
            samples: samples as i32,
            timecode: SYNTHESIZE,
            fourcc: FLTP,
            data: planar.as_mut_ptr().cast::<u8>(),
            channel_stride: (samples * 4) as i32,
            metadata: std::ptr::null(),
            timestamp: 0,
        };
        // SAFETY: the sound stays alive while the call copies it.
        unsafe { (l.send_audio)(self.inst, &f) };
    }
}

impl Drop for Sender {
    fn drop(&mut self) {
        if let Ok(l) = lib() {
            // SAFETY: destroyed once.
            unsafe { (l.send_destroy)(self.inst) };
        }
    }
}

/// NDI sound (any rate, any channels) as Lumora's stream sound: 48 kHz
/// stereo, 16-bit, interleaved.
#[must_use]
pub fn to_stereo_s16(rate: u32, channels: usize, samples: usize, planar: &[f32]) -> Vec<u8> {
    if channels == 0 || samples == 0 {
        return Vec::new();
    }
    let left = &planar[..samples];
    let right = if channels > 1 {
        &planar[samples..samples * 2]
    } else {
        left
    };
    let out_n = (samples as u64 * 48_000 / u64::from(rate.max(1))) as usize;
    let mut out = Vec::with_capacity(out_n * 4);
    for i in 0..out_n {
        let pos = i as f64 * f64::from(rate) / 48_000.0;
        let j = (pos as usize).min(samples - 1);
        let k = (j + 1).min(samples - 1);
        let t = (pos - j as f64) as f32;
        for plane in [left, right] {
            let v = plane[j] + (plane[k] - plane[j]) * t;
            let s = (v.clamp(-1.0, 1.0) * 32767.0) as i16;
            out.extend_from_slice(&s.to_le_bytes());
        }
    }
    out
}

/// Interleaved floats (as FFmpeg gives them) made into planes (as NDI takes them).
#[must_use]
pub fn deinterleave(interleaved: &[f32], channels: usize) -> Vec<f32> {
    let n = interleaved.len() / channels.max(1);
    let mut out = vec![0.0; n * channels];
    for i in 0..n {
        for c in 0..channels {
            out[c * n + i] = interleaved[i * channels + c];
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sound_becomes_48k_stereo() {
        // One second of mono at 24 kHz → one second at 48 kHz, two channels, 2 bytes each.
        let out = to_stereo_s16(24_000, 1, 24_000, &vec![0.5; 24_000]);
        assert_eq!(out.len(), 48_000 * 4);
        assert_eq!(i16::from_le_bytes([out[0], out[1]]), 16383);
    }

    #[test]
    fn interleaved_sound_becomes_planes() {
        assert_eq!(
            deinterleave(&[1.0, 2.0, 3.0, 4.0], 2),
            vec![1.0, 3.0, 2.0, 4.0]
        );
    }

    /// Needs the NDI runtime (NDI_LIB_PATH): `cargo test -- --ignored ndi`.
    #[test]
    #[ignore = "needs the NDI runtime"]
    fn a_picture_sent_over_ndi_comes_back() {
        let mut send = Sender::new("Lumora Test").unwrap();
        let stop = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));
        let s2 = std::sync::Arc::clone(&stop);
        let feeder = std::thread::spawn(move || {
            let mut frame = vec![0u8; 320 * 180 * 4];
            for px in frame.chunks_mut(4) {
                px.copy_from_slice(&[255, 0, 0, 255]); // blue
            }
            let mut sound = vec![0.25f32; 2 * 960];
            while !s2.load(std::sync::atomic::Ordering::Relaxed) {
                send.video(320, 180, 30, &mut frame);
                send.audio(48_000, 2, 960, &mut sound);
                std::thread::sleep(std::time::Duration::from_millis(33));
            }
        });
        let found = sources(3000, "127.0.0.1").unwrap();
        eprintln!("NDI sources: {found:?}");
        let name = found
            .iter()
            .find(|n| n.contains("Lumora Test"))
            .expect("our source is found")
            .clone();
        let mut recv = Receiver::new(&name).unwrap();
        let (mut video, mut audio) = (None, false);
        for _ in 0..100 {
            match recv.capture(200) {
                Received::Video {
                    width,
                    height,
                    bgra,
                } => video = Some((width, height, bgra[0..4].to_vec())),
                Received::Audio { channels, .. } => audio = channels == 2,
                Received::Nothing => {}
            }
            if video.is_some() && audio {
                break;
            }
        }
        stop.store(true, std::sync::atomic::Ordering::Relaxed);
        let _ = feeder.join();
        let (w, h, px) = video.expect("a picture came");
        assert_eq!((w, h), (320, 180));
        // NDI compresses a little on the way: still clearly blue.
        assert!(
            px[0] > 200 && px[1] < 40 && px[2] < 40,
            "blue came back: {px:?}"
        );
        assert!(audio, "sound came");
    }

    #[test]
    fn layouts_match_the_ndi_headers() {
        // 64-bit layouts from Processing.NDI.structs.h.
        assert_eq!(std::mem::size_of::<VideoFrame>(), 72);
        assert_eq!(std::mem::size_of::<AudioFrame>(), 64);
        assert_eq!(std::mem::size_of::<Source>(), 16);
        assert_eq!(BGRA, 0x4152_4742);
    }
}
