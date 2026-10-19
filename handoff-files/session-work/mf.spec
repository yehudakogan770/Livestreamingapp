@@@
        if let Some(mode) = best_mode(&reader) {
            let _ = reader.SetCurrentMediaType(STREAM, None, &mode);
        }
===
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
@@@
        // NV12 first (no conversion on the processor), RGB32 when the camera can't.
        let nv12 = reader
            .SetCurrentMediaType(STREAM, None, &wanted(&MFVideoFormat_NV12)?)
            .is_ok();
        if !nv12 {
===
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
@@@
        let bpp = if nv12 { 1 } else { 4 };
===
        let bpp = if p010 {
            2
        } else if nv12 {
            1
        } else {
            4
        };
@@@
                let format = if nv12 {
                    PixelFormat::Nv12
                } else {
                    PixelFormat::Bgrx8
                };
===
                let format = match hdr.filter(|_| p010) {
                    Some(h) => PixelFormat::P010(h),
                    None if nv12 => PixelFormat::Nv12,
                    None => PixelFormat::Bgrx8,
                };
@@@
    MF_DEVSOURCE_ATTRIBUTE_SOURCE_TYPE_VIDCAP_GUID, MF_MT_DEFAULT_STRIDE, MF_MT_FRAME_RATE,
===
    MF_DEVSOURCE_ATTRIBUTE_SOURCE_TYPE_VIDCAP_GUID, MF_MT_DEFAULT_STRIDE, MF_MT_FRAME_RATE,
    MFVideoFormat_P010, MFVideoFormat_P016, MFVideoTransFunc_2084, MFVideoTransFunc_HLG,
    MF_MT_TRANSFER_FUNCTION,
@@@
use crate::frame::{FramePool, PixelFormat, VideoFrame};
===
use crate::frame::{FramePool, PixelFormat, VideoFrame};
use crate::hdr::Hdr;
