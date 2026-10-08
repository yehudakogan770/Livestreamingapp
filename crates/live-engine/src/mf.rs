//! Cameras through Windows Media Foundation: the same API the WebView's
//! `getUserMedia` uses underneath, opened once here for every screen,
//! preview, recording and stream.
//!
//! The camera is found by its name (the show keeps the browser's label, which
//! Chrome ends with " (vid:pid)" for USB cameras; that part is ignored). The
//! largest mode up to 1080p at the highest frame rate is chosen, delivered as
//! NV12 (most cameras' own format, 12 bits a pixel: converted to RGB on the
//! GPU) or, when the camera can't, turned into RGB32 (B, G, R, x) by Media
//! Foundation's video processor. An unplugged camera is retried every two
//! seconds until it is back.
#![allow(unsafe_code)]

use std::sync::Arc;
use std::thread;
use std::time::Duration;

use windows::core::PWSTR;
use windows::Win32::Media::MediaFoundation::{
    IMFActivate, IMFAttributes, IMFMediaSource, IMFMediaType, IMFSourceReader, MFCreateAttributes,
    MFCreateMediaType, MFCreateSourceReaderFromMediaSource, MFEnumDeviceSources, MFMediaType_Video,
    MFShutdown, MFStartup, MFVideoFormat_NV12, MFVideoFormat_P010, MFVideoFormat_P016,
    MFVideoFormat_RGB32, MFVideoTransFunc_2084, MFVideoTransFunc_HLG, MFSTARTUP_FULL,
    MF_DEVSOURCE_ATTRIBUTE_FRIENDLY_NAME, MF_DEVSOURCE_ATTRIBUTE_SOURCE_TYPE,
    MF_DEVSOURCE_ATTRIBUTE_SOURCE_TYPE_VIDCAP_GUID, MF_MT_DEFAULT_STRIDE, MF_MT_FRAME_RATE,
    MF_MT_FRAME_SIZE, MF_MT_MAJOR_TYPE, MF_MT_SUBTYPE, MF_MT_TRANSFER_FUNCTION,
    MF_SOURCE_READERF_ENDOFSTREAM, MF_SOURCE_READERF_ERROR,
    MF_SOURCE_READER_ENABLE_VIDEO_PROCESSING, MF_SOURCE_READER_FIRST_VIDEO_STREAM, MF_VERSION,
};
use windows::Win32::System::Com::{
    CoInitializeEx, CoTaskMemFree, CoUninitialize, COINIT_MULTITHREADED,
};

use crate::frame::{FramePool, PixelFormat, VideoFrame};
use crate::hdr::Hdr;
use crate::source::{Mailbox, SourceHealth, VideoSource};

pub struct Camera {
    mailbox: Arc<Mailbox>,
    label: String,
}

impl Camera {
    /// Start opening the camera called `label` (on its own thread).
    pub fn start(label: &str) -> Self {
        let mailbox = Mailbox::new();
        let mb = Arc::clone(&mailbox);
        let name = crate::source::camera_name(label).to_owned();
        let _ = thread::Builder::new()
            .name("lumora-live-camera".into())
            .spawn(move || {
                // SAFETY: COM and Media Foundation are started and stopped on this thread only.
                let com = unsafe { CoInitializeEx(None, COINIT_MULTITHREADED) }.is_ok();
                let mf = unsafe { MFStartup(MF_VERSION, MFSTARTUP_FULL) }.is_ok();
                let pool = FramePool::new(4);
                let mut seq = 0u64;
                while !mb.stopped() {
                    if let Err(e) = run(&name, &mb, &pool, &mut seq) {
                        mb.fail(e);
                    }
                    // Unplugged or taken by another program: try again shortly.
                    for _ in 0..20 {
                        if mb.stopped() {
                            break;
                        }
                        thread::sleep(Duration::from_millis(100));
                    }
                }
                // SAFETY: matched with the starts above, on the same thread.
                unsafe {
                    if mf {
                        let _ = MFShutdown();
                    }
                    if com {
                        CoUninitialize();
                    }
                }
            });
        Camera {
            mailbox,
            label: label.to_owned(),
        }
    }
}

impl VideoSource for Camera {
    fn latest(&self) -> Option<VideoFrame> {
        self.mailbox.latest()
    }
    fn health(&self) -> SourceHealth {
        self.mailbox.health()
    }
    fn describe(&self) -> String {
        format!("Media Foundation camera: {}", self.label)
    }
}

impl Drop for Camera {
    fn drop(&mut self) {
        self.mailbox.stop();
    }
}

/// Every camera's activation object and name.
fn cameras() -> windows::core::Result<Vec<(IMFActivate, String)>> {
    // SAFETY: Media Foundation calls with valid out-pointers; the array it
    // allocates is freed with CoTaskMemFree after its objects are taken out.
    unsafe {
        let mut attrs: Option<IMFAttributes> = None;
        MFCreateAttributes(&mut attrs, 1)?;
        let attrs = attrs.ok_or_else(windows::core::Error::empty)?;
        attrs.SetGUID(
            &MF_DEVSOURCE_ATTRIBUTE_SOURCE_TYPE,
            &MF_DEVSOURCE_ATTRIBUTE_SOURCE_TYPE_VIDCAP_GUID,
        )?;
        let mut list: *mut Option<IMFActivate> = std::ptr::null_mut();
        let mut count = 0u32;
        MFEnumDeviceSources(&attrs, &mut list, &mut count)?;
        let mut out = Vec::new();
        for i in 0..count as usize {
            if let Some(a) = (*list.add(i)).take() {
                let mut name = PWSTR::null();
                let mut len = 0u32;
                let label = if a
                    .GetAllocatedString(&MF_DEVSOURCE_ATTRIBUTE_FRIENDLY_NAME, &mut name, &mut len)
                    .is_ok()
                {
                    let s = name.to_string().unwrap_or_default();
                    CoTaskMemFree(Some(name.0 as *const _));
                    s
                } else {
                    String::new()
                };
                out.push((a, label));
            }
        }
        if !list.is_null() {
            CoTaskMemFree(Some(list as *const _));
        }
        Ok(out)
    }
}

/// The names of the cameras connected now (for the engine's status panel).
pub fn camera_names() -> Vec<String> {
    // SAFETY: COM / Media Foundation started for the length of the call on this thread.
    unsafe {
        let com = CoInitializeEx(None, COINIT_MULTITHREADED).is_ok();
        let mf = MFStartup(MF_VERSION, MFSTARTUP_FULL).is_ok();
        let names = cameras()
            .map(|c| c.into_iter().map(|(_, n)| n).collect())
            .unwrap_or_default();
        if mf {
            let _ = MFShutdown();
        }
        if com {
            CoUninitialize();
        }
        names
    }
}

fn split(v: u64) -> (u32, u32) {
    ((v >> 32) as u32, v as u32)
}

const STREAM: u32 = MF_SOURCE_READER_FIRST_VIDEO_STREAM.0 as u32;

/// The largest mode up to 1080p, then the fastest.
fn best_mode(reader: &IMFSourceReader) -> Option<IMFMediaType> {
    let mut best: Option<(u64, u32, IMFMediaType)> = None;
    for i in 0.. {
        // SAFETY: reading the camera's own list of modes.
        let Ok(t) = (unsafe { reader.GetNativeMediaType(STREAM, i) }) else {
            break;
        };
        let (w, h) = split(unsafe { t.GetUINT64(&MF_MT_FRAME_SIZE) }.unwrap_or(0));
        let (num, den) = split(unsafe { t.GetUINT64(&MF_MT_FRAME_RATE) }.unwrap_or(0));
        if w == 0 || h == 0 || w > 1920 || h > 1080 {
            continue;
        }
        let fps = num.checked_div(den).unwrap_or(0);
        let area = u64::from(w) * u64::from(h);
        if best.as_ref().is_none_or(|(a, f, _)| (area, fps) > (*a, *f)) {
            best = Some((area, fps, t));
        }
    }
    best.map(|b| b.2)
}

fn run(name: &str, mb: &Mailbox, pool: &FramePool, seq: &mut u64) -> Result<(), String> {
    let found = cameras().map_err(|e| format!("Windows could not list the cameras: {e}"))?;
    let want = name.to_lowercase();
    let activate = found
        .iter()
        .find(|(_, n)| n.to_lowercase() == want)
        .or_else(|| {
            found
                .iter()
                .find(|(_, n)| !n.is_empty() && want.contains(&n.to_lowercase()))
        })
        .map(|(a, _)| a.clone())
        .ok_or_else(|| format!("Camera \u{201c}{name}\u{201d} not found or unplugged"))?;
    // SAFETY: Media Foundation objects used on the thread that made them; the
    // sample buffer is only read between Lock and Unlock.
    unsafe {
        let source: IMFMediaSource = activate.ActivateObject().map_err(|e| {
            format!("The camera is being used by another program, or Windows refused it: {e}")
        })?;
        let mut attrs: Option<IMFAttributes> = None;
        MFCreateAttributes(&mut attrs, 1).map_err(|e| e.to_string())?;
        let attrs = attrs.ok_or("No attributes.")?;
        attrs
            .SetUINT32(&MF_SOURCE_READER_ENABLE_VIDEO_PROCESSING, 1)
            .map_err(|e| e.to_string())?;
        let reader =
            MFCreateSourceReaderFromMediaSource(&source, &attrs).map_err(|e| e.to_string())?;
        // An HDR camera (HDR10 or HLG, 10-bit): kept as P010 and made SDR on the GPU.
        let mut hdr = None;
        if let Some(mode) = best_mode(&reader) {
            let _ = reader.SetCurrentMediaType(STREAM, None, &mode);
            let trc = mode.GetUINT32(&MF_MT_TRANSFER_FUNCTION).unwrap_or(0);
            let ten_bit = mode
                .GetGUID(&MF_MT_SUBTYPE)
                .is_ok_and(|s| s == MFVideoFormat_P010 || s == MFVideoFormat_P016);
            hdr = match trc {
                t if t == MFVideoTransFunc_2084.0 as u32 => Some(Hdr::Pq),
                t if t == MFVideoTransFunc_HLG.0 as u32 => Some(Hdr::Hlg),
                _ => None,
            }
            .filter(|_| ten_bit);
        }
        let wanted = |subtype: &windows::core::GUID| -> Result<IMFMediaType, String> {
            let t: IMFMediaType = MFCreateMediaType().map_err(|e| e.to_string())?;
            t.SetGUID(&MF_MT_MAJOR_TYPE, &MFMediaType_Video)
                .map_err(|e| e.to_string())?;
            t.SetGUID(&MF_MT_SUBTYPE, subtype)
                .map_err(|e| e.to_string())?;
            Ok(t)
        };
        // P010 for an HDR camera; NV12 first otherwise (no conversion on the
        // processor), RGB32 when the camera can't.
        let p010 = hdr.is_some()
            && reader
                .SetCurrentMediaType(STREAM, None, &wanted(&MFVideoFormat_P010)?)
                .is_ok();
        let nv12 = p010
            || reader
                .SetCurrentMediaType(STREAM, None, &wanted(&MFVideoFormat_NV12)?)
                .is_ok();
        if !nv12 {
            reader
                .SetCurrentMediaType(STREAM, None, &wanted(&MFVideoFormat_RGB32)?)
                .map_err(|e| format!("The camera can't give pictures Lumora can use: {e}"))?;
        }
        let current = reader
            .GetCurrentMediaType(STREAM)
            .map_err(|e| e.to_string())?;
        let (w, h) = split(current.GetUINT64(&MF_MT_FRAME_SIZE).unwrap_or(0));
        if w == 0 || h == 0 {
            return Err("The camera did not say its picture size.".into());
        }
        let (w, h) = if nv12 { (w & !1, h & !1) } else { (w, h) };
        let bpp = if p010 {
            2
        } else if nv12 {
            1
        } else {
            4
        };
        // A negative stride means the picture is stored bottom row first.
        let stride = current
            .GetUINT32(&MF_MT_DEFAULT_STRIDE)
            .map_or(i64::from(w) * bpp, |s| i64::from(s as i32));
        let row = w as usize * bpp as usize;
        while !mb.stopped() {
            let mut flags = 0u32;
            let mut sample = None;
            reader
                .ReadSample(STREAM, 0, None, Some(&mut flags), None, Some(&mut sample))
                .map_err(|e| format!("The camera stopped: {e}"))?;
            if flags & (MF_SOURCE_READERF_ERROR.0 as u32 | MF_SOURCE_READERF_ENDOFSTREAM.0 as u32)
                != 0
            {
                return Err("The camera stopped (unplugged?)".into());
            }
            let Some(sample) = sample else { continue };
            let buffer = sample
                .ConvertToContiguousBuffer()
                .map_err(|e| e.to_string())?;
            let mut data: *mut u8 = std::ptr::null_mut();
            let mut len = 0u32;
            buffer
                .Lock(&mut data, None, Some(&mut len))
                .map_err(|e| e.to_string())?;
            let pitch = stride.unsigned_abs() as usize;
            // NV12: the Y rows, then half as many rows of U and V.
            let rows = if nv12 { h as usize * 3 / 2 } else { h as usize };
            if !data.is_null() && (len as usize) >= pitch * (rows - 1) + row {
                let src = std::slice::from_raw_parts(data, len as usize);
                let format = match hdr.filter(|_| p010) {
                    Some(h) => PixelFormat::P010(h),
                    None if nv12 => PixelFormat::Nv12,
                    None => PixelFormat::Bgrx8,
                };
                let f = VideoFrame::build(pool, w, h, format, *seq, |px| {
                    for y in 0..rows {
                        let from = if stride < 0 { rows - 1 - y } else { y } * pitch;
                        px[y * row..(y + 1) * row].copy_from_slice(&src[from..from + row]);
                    }
                });
                *seq += 1;
                let _ = buffer.Unlock();
                mb.put(f);
            } else {
                let _ = buffer.Unlock();
            }
        }
        let _ = source.Shutdown();
    }
    Ok(())
}
