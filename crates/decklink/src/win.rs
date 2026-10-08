//! Capture and playout on Windows, through the DeckLink COM API that
//! Blackmagic Desktop Video registers.
//!
//! - Capture: the card is found by its display name, its connector chosen
//!   (when given), the input opened with format detection at 1080i59.94;
//!   when the card detects the real signal it says so
//!   (`VideoInputFormatChanged`) and the input is opened again in that mode
//!   and pixel format. Frames and embedded audio arrive on the driver's
//!   thread (`VideoInputFrameArrived`) and go straight to the subscribers.
//!   A card that is unplugged, busy or missing is tried again every two
//!   seconds.
//! - Playout: frames are shown on the card's output as they come
//!   (`DisplayVideoFrameSync`), on a thread of its own.
#![allow(unsafe_code)]

use std::ffi::c_void;
use std::ptr::null_mut;
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::mpsc::{channel, sync_channel, SyncSender, TrySendError};
use std::sync::Arc;
use std::thread;
use std::time::Duration;

use windows::Win32::System::Com::{
    CoCreateInstance, CoInitializeEx, CoUninitialize, CLSCTX_ALL, COINIT_MULTITHREADED,
};
use windows_core::{implement, Interface, BSTR, HRESULT};

use crate::capture::{timecode_text, AudioRef, Capture, VideoRef};
use crate::com::*;
use crate::modes::{self, audio_channels, capture_format, Connection, PixelFormat};
use crate::{Device, INSTALL_HELP};

const S_OK: HRESULT = HRESULT(0);
/// `REGDB_E_CLASSNOTREG`: the DeckLink API isn't registered (no Desktop Video).
const CLASS_NOT_REGISTERED: HRESULT = HRESULT(0x8004_0154_u32 as i32);

/// COM started on this thread (and stopped when dropped, on the same thread).
struct Com(bool);

impl Com {
    fn init() -> Com {
        // SAFETY: paired with CoUninitialize in Drop on the same thread.
        Com(unsafe { CoInitializeEx(None, COINIT_MULTITHREADED) }.is_ok())
    }
}

impl Drop for Com {
    fn drop(&mut self) {
        if self.0 {
            // SAFETY: this thread's CoInitializeEx succeeded.
            unsafe { CoUninitialize() };
        }
    }
}

fn iterator() -> Result<IDeckLinkIterator, String> {
    // SAFETY: a plain COM class creation; the result is an owned interface.
    unsafe { CoCreateInstance::<_, IDeckLinkIterator>(&CLSID_DECKLINK_ITERATOR, None, CLSCTX_ALL) }
        .map_err(|e| {
            if e.code() == CLASS_NOT_REGISTERED {
                INSTALL_HELP.to_owned()
            } else {
                format!("The Blackmagic driver didn't answer ({e}). {INSTALL_HELP}")
            }
        })
}

fn cards(it: &IDeckLinkIterator) -> Vec<IDeckLink> {
    let mut out = Vec::new();
    loop {
        let mut p = null_mut();
        // SAFETY: Next writes an owned IDeckLink pointer (or null when done).
        let r = unsafe { it.Next(&mut p) };
        if r != S_OK || p.is_null() {
            break;
        }
        // SAFETY: p is an owned reference to an IDeckLink.
        out.push(unsafe { IDeckLink::from_raw(p) });
        if out.len() > 64 {
            break;
        }
    }
    out
}

fn bstr(get: impl FnOnce(*mut BSTR) -> HRESULT) -> String {
    let mut b = BSTR::new();
    if get(&mut b).is_ok() {
        b.to_string()
    } else {
        String::new()
    }
}

fn display_name(d: &IDeckLink) -> String {
    // SAFETY: the out-pointer is a valid BSTR the callee fills.
    bstr(|b| unsafe { d.GetDisplayName(b) })
}

fn model_name(d: &IDeckLink) -> String {
    // SAFETY: as above.
    bstr(|b| unsafe { d.GetModelName(b) })
}

struct Attrs(Option<IDeckLinkProfileAttributes>);

impl Attrs {
    fn of(d: &IDeckLink) -> Attrs {
        Attrs(d.cast().ok())
    }
    fn int(&self, id: u32) -> Option<i64> {
        let a = self.0.as_ref()?;
        let mut v = 0i64;
        // SAFETY: valid out-pointer.
        unsafe { a.GetInt(id, &mut v) }.is_ok().then_some(v)
    }
    fn flag(&self, id: u32) -> bool {
        let Some(a) = self.0.as_ref() else {
            return false;
        };
        let mut v: Bool = 0;
        // SAFETY: valid out-pointer.
        unsafe { a.GetFlag(id, &mut v) }.is_ok() && v != 0
    }
}

pub fn devices() -> Result<Vec<Device>, String> {
    // On a thread of its own so COM is set up as needed, whatever the caller's thread has.
    thread::spawn(|| {
        let _com = Com::init();
        let it = iterator()?;
        Ok(cards(&it)
            .iter()
            .map(|d| {
                let a = Attrs::of(d);
                let io = a
                    .int(ATTR_VIDEO_IO_SUPPORT)
                    .unwrap_or(IO_CAPTURE | IO_PLAYBACK);
                Device {
                    name: display_name(d),
                    model: model_name(d),
                    can_capture: io & IO_CAPTURE != 0,
                    can_playout: io & IO_PLAYBACK != 0,
                    inputs: Connection::from_bits(a.int(ATTR_VIDEO_INPUT_CONNECTIONS).unwrap_or(0)),
                    outputs: Connection::from_bits(
                        a.int(ATTR_VIDEO_OUTPUT_CONNECTIONS).unwrap_or(0),
                    ),
                    detects_format: a.flag(ATTR_SUPPORTS_INPUT_FORMAT_DETECTION),
                    audio_channels: audio_channels(a.int(ATTR_MAXIMUM_AUDIO_CHANNELS).unwrap_or(2)),
                }
            })
            .collect())
    })
    .join()
    .unwrap_or_else(|_| Err("Listing the Blackmagic cards failed.".to_owned()))
}

/// The card named `name` (its display name; or, failing that, its model name).
fn find(name: &str) -> Result<IDeckLink, String> {
    let it = iterator()?;
    let list = cards(&it);
    if let Some(i) = list.iter().position(|d| display_name(d) == name) {
        return Ok(list[i].clone());
    }
    let bare = name.rsplit_once(" (").map_or(name, |(b, _)| b);
    if let Some(i) = list.iter().position(|d| model_name(d) == bare) {
        return Ok(list[i].clone());
    }
    let found: Vec<String> = list.iter().map(display_name).collect();
    Err(if found.is_empty() {
        format!("The capture card “{name}” isn't in this computer: no Blackmagic card was found. Check it is plugged in (an UltraStudio needs its power and Thunderbolt cable) and shows in Blackmagic Desktop Video Setup.")
    } else {
        format!(
            "The capture card “{name}” isn't in this computer. Cards found: {}.",
            found.join(", ")
        )
    })
}

#[implement(IDeckLinkInputCallback)]
struct InputCallback {
    input: IDeckLinkInput,
    capture: Arc<Capture>,
    detect: bool,
    channels: AtomicU32,
}

/// The frame's timecode, when the signal carries one.
fn timecode(f: &IDeckLinkVideoFrame) -> Option<String> {
    for format in [TIMECODE_RP188_ANY, TIMECODE_VITC] {
        let mut p = null_mut();
        // SAFETY: GetTimecode writes an owned IDeckLinkTimecode pointer (or fails).
        if unsafe { f.GetTimecode(format, &mut p) }.is_ok() && !p.is_null() {
            // SAFETY: p is an owned reference.
            let tc = unsafe { IDeckLinkTimecode::from_raw(p) };
            let (mut h, mut m, mut s, mut fr) = (0u8, 0u8, 0u8, 0u8);
            // SAFETY: valid out-pointers.
            if unsafe { tc.GetComponents(&mut h, &mut m, &mut s, &mut fr) }.is_ok() {
                return Some(timecode_text(h, m, s, fr));
            }
        }
    }
    None
}

impl IDeckLinkInputCallback_Impl for InputCallback_Impl {
    unsafe fn VideoInputFormatChanged(
        &self,
        _events: u32,
        mode: *mut c_void,
        detected: u32,
    ) -> HRESULT {
        // SAFETY: the driver passes a borrowed IDeckLinkDisplayMode for the call.
        let Some(m) = (unsafe { IDeckLinkDisplayMode::from_raw_borrowed(&mode) }) else {
            return S_OK;
        };
        // SAFETY: plain getters on a live interface.
        let (code, w, h) = unsafe { (m.GetDisplayMode(), m.GetWidth(), m.GetHeight()) };
        let (mut duration, mut scale) = (0i64, 0i64);
        // SAFETY: valid out-pointers.
        let _ = unsafe { m.GetFrameRate(&mut duration, &mut scale) };
        let fps = if duration > 0 {
            scale as f64 / duration as f64
        } else {
            0.0
        };
        let pf = capture_format(detected, false);
        let flags = if self.detect {
            INPUT_ENABLE_FORMAT_DETECTION
        } else {
            0
        };
        // Opened again in the detected mode, as the DeckLink SDK's own samples do.
        // SAFETY: the input outlives its callback (the callback is removed before it is released).
        unsafe {
            let _ = self.input.PauseStreams();
            let _ = self.input.EnableVideoInput(code, pf.code(), flags);
            let _ = self.input.FlushStreams();
            let _ = self.input.StartStreams();
        }
        self.capture.set_mode(
            modes::mode(code),
            u32::try_from(w).unwrap_or(0),
            u32::try_from(h).unwrap_or(0),
            fps,
            pf,
        );
        S_OK
    }

    unsafe fn VideoInputFrameArrived(&self, video: *mut c_void, audio: *mut c_void) -> HRESULT {
        // SAFETY: borrowed for the call; may be null (audio only).
        if let Some(f) = unsafe { IDeckLinkVideoInputFrame::from_raw_borrowed(&video) } {
            // SAFETY: plain getters on a live frame.
            let (flags, w, h, rb, pf) = unsafe {
                (
                    f.GetFlags(),
                    f.GetWidth(),
                    f.GetHeight(),
                    f.GetRowBytes(),
                    f.GetPixelFormat(),
                )
            };
            if flags & FRAME_HAS_NO_INPUT_SOURCE != 0 {
                self.capture.no_input();
            } else if let (Some(pf), Ok(w), Ok(h), Ok(rb)) = (
                PixelFormat::from_code(pf),
                u32::try_from(w),
                u32::try_from(h),
                usize::try_from(rb),
            ) {
                let mut p = null_mut();
                // SAFETY: GetBytes points at the frame's buffer, alive for this call.
                if unsafe { f.GetBytes(&mut p) }.is_ok() && !p.is_null() && w > 0 && h > 0 {
                    // SAFETY: the buffer holds rb × h bytes (DeckLink's frame layout).
                    let data =
                        unsafe { std::slice::from_raw_parts(p as *const u8, rb * h as usize) };
                    self.capture.video(
                        VideoRef {
                            width: w,
                            height: h,
                            format: pf,
                            row_bytes: rb,
                            data,
                            seq: 0,
                        },
                        timecode(f),
                    );
                }
            }
        }
        // SAFETY: borrowed for the call; may be null (no audio enabled).
        if let Some(a) = unsafe { IDeckLinkAudioInputPacket::from_raw_borrowed(&audio) } {
            let ch = self.channels.load(Ordering::Relaxed).max(1);
            // SAFETY: plain getter.
            let n = unsafe { a.GetSampleFrameCount() };
            let mut p = null_mut();
            // SAFETY: GetBytes points at the packet's samples, alive for this call.
            if n > 0 && unsafe { a.GetBytes(&mut p) }.is_ok() && !p.is_null() {
                // SAFETY: n sample frames of `ch` 32-bit samples each.
                let samples = unsafe {
                    std::slice::from_raw_parts(p as *const i32, n as usize * ch as usize)
                };
                self.capture.audio(AudioRef {
                    channels: ch,
                    samples,
                });
            }
        }
        S_OK
    }
}

/// Capture until the input is no longer wanted; tried again after failures.
#[allow(clippy::needless_pass_by_value)] // the capture thread owns it
pub fn run(c: Arc<Capture>) {
    let _com = Com::init();
    while !c.stopped() {
        if let Err(why) = capture(&c) {
            c.fail(why);
        }
        for _ in 0..20 {
            if c.stopped() {
                break;
            }
            thread::sleep(Duration::from_millis(100));
        }
    }
}

fn capture(c: &Arc<Capture>) -> Result<(), String> {
    let card = find(&c.address.device)?;
    let input: IDeckLinkInput = card
        .cast()
        .map_err(|_| format!("“{}” can't capture.", c.address.device))?;
    let attrs = Attrs::of(&card);
    if let Some(conn) = c.address.connection {
        if let Ok(cfg) = card.cast::<IDeckLinkConfiguration>() {
            // SAFETY: a plain setter.
            let _ = unsafe { cfg.SetInt(CONFIG_VIDEO_INPUT_CONNECTION, conn.bit()) };
        }
    }
    let detect = attrs.flag(ATTR_SUPPORTS_INPUT_FORMAT_DETECTION);
    let channels = audio_channels(attrs.int(ATTR_MAXIMUM_AUDIO_CHANNELS).unwrap_or(2));
    let callback: IDeckLinkInputCallback = InputCallback {
        input: input.clone(),
        capture: Arc::clone(c),
        detect,
        channels: AtomicU32::new(channels),
    }
    .into();
    let flags = if detect {
        INPUT_ENABLE_FORMAT_DETECTION
    } else {
        0
    };
    // SAFETY: COM calls on live interfaces; the callback is removed before
    // either is released (below), which breaks the input ↔ callback cycle.
    unsafe {
        let _ = input.SetCallback(callback.as_raw());
        if input
            .EnableVideoInput(modes::START_MODE, PixelFormat::Uyvy.code(), flags)
            .is_err()
        {
            let _ = input.SetCallback(null_mut());
            return Err(format!(
                "“{}” is in use by another program (close Media Express, OBS or any other program using it), or it can't take 1080i59.94.",
                c.address.device
            ));
        }
        let audio = input
            .EnableAudioInput(AUDIO_48K, AUDIO_32BIT, channels)
            .is_ok();
        c.update(|s| s.channels = if audio { channels } else { 0 });
        if !detect {
            c.set_mode(
                modes::mode(modes::START_MODE),
                1920,
                1080,
                30000.0 / 1001.0,
                PixelFormat::Uyvy,
            );
        }
        if input.StartStreams().is_err() {
            let _ = input.DisableVideoInput();
            let _ = input.SetCallback(null_mut());
            return Err(format!("“{}” would not start capturing.", c.address.device));
        }
    }
    while !c.stopped() {
        thread::sleep(Duration::from_millis(100));
    }
    // SAFETY: as above.
    unsafe {
        let _ = input.StopStreams();
        let _ = input.SetCallback(null_mut());
        let _ = input.DisableAudioInput();
        let _ = input.DisableVideoInput();
    }
    Ok(())
}

/// A card's output, fed from a thread of its own.
pub struct Playout {
    tx: SyncSender<Vec<u8>>,
    mode: String,
    len: usize,
}

impl Playout {
    pub fn open(name: &str, width: u32, height: u32, fps: f64) -> Result<Playout, String> {
        let mode = crate::playout_mode(width, height, fps).ok_or_else(|| {
            format!("Blackmagic outputs play 720p, 1080p and 2160p; {width} × {height} at {fps:.2} isn't one of them.")
        })?;
        let (tx, rx) = sync_channel::<Vec<u8>>(2);
        let (ready_tx, ready_rx) = channel::<Result<(), String>>();
        let name = name.to_owned();
        thread::Builder::new()
            .name("lumora-decklink-out".into())
            .spawn(move || {
                let _com = Com::init();
                let output = match open_output(&name, mode) {
                    Ok(o) => {
                        let _ = ready_tx.send(Ok(()));
                        o
                    }
                    Err(e) => {
                        let _ = ready_tx.send(Err(e));
                        return;
                    }
                };
                let (w, h) = (mode.width as i32, mode.height as i32);
                for frame in rx {
                    let mut p = null_mut();
                    // SAFETY: COM calls on a live output; the frame's buffer
                    // holds w × 2 × h bytes (UYVY, the row size asked for).
                    unsafe {
                        if output
                            .CreateVideoFrame(
                                w,
                                h,
                                w * 2,
                                PixelFormat::Uyvy.code(),
                                OUTPUT_DEFAULT,
                                &mut p,
                            )
                            .is_err()
                            || p.is_null()
                        {
                            continue;
                        }
                        let f = IDeckLinkMutableVideoFrame::from_raw(p);
                        let mut b = null_mut();
                        if f.GetBytes(&mut b).is_ok() && !b.is_null() {
                            let n = frame.len().min((w * 2 * h) as usize);
                            std::ptr::copy_nonoverlapping(frame.as_ptr(), b.cast::<u8>(), n);
                            let _ = output.DisplayVideoFrameSync(f.as_raw());
                        }
                    }
                }
                // SAFETY: as above.
                let _ = unsafe { output.DisableVideoOutput() };
            })
            .map_err(|e| e.to_string())?;
        ready_rx
            .recv_timeout(Duration::from_secs(10))
            .map_err(|_| "The Blackmagic output didn't answer.".to_owned())??;
        Ok(Playout {
            tx,
            mode: mode.name(),
            len: (mode.width * 2 * mode.height) as usize,
        })
    }

    pub fn show_uyvy(&self, uyvy: &[u8]) -> Result<(), String> {
        if uyvy.len() < self.len {
            return Err("A frame of the wrong size.".to_owned());
        }
        match self.tx.try_send(uyvy[..self.len].to_vec()) {
            // The card is behind: this frame is skipped, never queued without end.
            Ok(()) | Err(TrySendError::Full(_)) => Ok(()),
            Err(TrySendError::Disconnected(_)) => Err("The Blackmagic output stopped.".to_owned()),
        }
    }

    pub fn mode_name(&self) -> String {
        self.mode.clone()
    }
}

fn open_output(name: &str, mode: modes::Mode) -> Result<IDeckLinkOutput, String> {
    let card = find(name)?;
    let output: IDeckLinkOutput = card
        .cast()
        .map_err(|_| format!("“{name}” has no output."))?;
    let (mut actual, mut ok) = (0u32, 0 as Bool);
    // SAFETY: valid out-pointers.
    let r = unsafe {
        output.DoesSupportVideoMode(
            0,
            mode.code,
            PixelFormat::Uyvy.code(),
            NO_CONVERSION,
            0,
            &mut actual,
            &mut ok,
        )
    };
    if r.is_err() || ok == 0 {
        return Err(format!("“{name}” can't play {}.", mode.name()));
    }
    // SAFETY: a plain call on a live output.
    if unsafe { output.EnableVideoOutput(mode.code, OUTPUT_DEFAULT) }.is_err() {
        return Err(format!(
            "“{name}”'s output is in use by another program (close Media Express or any other program using it)."
        ));
    }
    Ok(output)
}
