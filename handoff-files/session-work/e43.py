W='/home/user/Livestreamingapp/.claude/worktrees/agent-aefea299a26a1206e/'
def edit(path, pairs):
    p=W+path
    s=open(p).read()
    for a,b in pairs:
        assert s.count(a)==1, (path, a, s.count(a))
        s=s.replace(a,b)
    open(p,'w').write(s)

edit('crates/live-engine/src/mf.rs', [
("""//! largest mode up to 1080p at the highest frame rate is chosen and Media
//! Foundation's video processor turns it into RGB32 (B, G, R, x). An
//! unplugged camera is retried every two seconds until it is back.""","""//! largest mode up to 1080p at the highest frame rate is chosen, delivered as
//! NV12 (most cameras' own format, 12 bits a pixel: converted to RGB on the
//! GPU) or, when the camera can't, turned into RGB32 (B, G, R, x) by Media
//! Foundation's video processor. An unplugged camera is retried every two
//! seconds until it is back."""),
("""    MFShutdown, MFStartup, MFVideoFormat_RGB32, MFSTARTUP_FULL,""","""    MFShutdown, MFStartup, MFVideoFormat_NV12, MFVideoFormat_RGB32, MFSTARTUP_FULL,"""),
("""        let rgb: IMFMediaType = MFCreateMediaType().map_err(|e| e.to_string())?;
        rgb.SetGUID(&MF_MT_MAJOR_TYPE, &MFMediaType_Video)
            .map_err(|e| e.to_string())?;
        rgb.SetGUID(&MF_MT_SUBTYPE, &MFVideoFormat_RGB32)
            .map_err(|e| e.to_string())?;
        reader
            .SetCurrentMediaType(STREAM, None, &rgb)
            .map_err(|e| format!("The camera can't give pictures Lumora can use: {e}"))?;""","""        let wanted = |subtype: &windows::core::GUID| -> Result<IMFMediaType, String> {
            let t: IMFMediaType = MFCreateMediaType().map_err(|e| e.to_string())?;
            t.SetGUID(&MF_MT_MAJOR_TYPE, &MFMediaType_Video)
                .map_err(|e| e.to_string())?;
            t.SetGUID(&MF_MT_SUBTYPE, subtype)
                .map_err(|e| e.to_string())?;
            Ok(t)
        };
        // NV12 first (no conversion on the processor), RGB32 when the camera can't.
        let nv12 = reader
            .SetCurrentMediaType(STREAM, None, &wanted(&MFVideoFormat_NV12)?)
            .is_ok();
        if !nv12 {
            reader
                .SetCurrentMediaType(STREAM, None, &wanted(&MFVideoFormat_RGB32)?)
                .map_err(|e| format!("The camera can't give pictures Lumora can use: {e}"))?;
        }"""),
("""        // A negative stride means the picture is stored bottom row first.
        let stride = current
            .GetUINT32(&MF_MT_DEFAULT_STRIDE)
            .map_or(i64::from(w) * 4, |s| i64::from(s as i32));
        let row = w as usize * 4;""","""        let (w, h) = if nv12 { (w & !1, h & !1) } else { (w, h) };
        let bpp = if nv12 { 1 } else { 4 };
        // A negative stride means the picture is stored bottom row first.
        let stride = current
            .GetUINT32(&MF_MT_DEFAULT_STRIDE)
            .map_or(i64::from(w) * bpp, |s| i64::from(s as i32));
        let row = w as usize * bpp as usize;"""),
("""            let pitch = stride.unsigned_abs() as usize;
            if !data.is_null() && (len as usize) >= pitch * (h as usize - 1) + row {
                let src = std::slice::from_raw_parts(data, len as usize);
                let f = VideoFrame::build(pool, w, h, PixelFormat::Bgrx8, *seq, |px| {
                    for y in 0..h as usize {
                        let from = if stride < 0 { h as usize - 1 - y } else { y } * pitch;
                        px[y * row..(y + 1) * row].copy_from_slice(&src[from..from + row]);
                    }
                });""","""            let pitch = stride.unsigned_abs() as usize;
            // NV12: the Y rows, then half as many rows of U and V.
            let rows = if nv12 { h as usize * 3 / 2 } else { h as usize };
            if !data.is_null() && (len as usize) >= pitch * (rows - 1) + row {
                let src = std::slice::from_raw_parts(data, len as usize);
                let format = if nv12 {
                    PixelFormat::Nv12
                } else {
                    PixelFormat::Bgrx8
                };
                let f = VideoFrame::build(pool, w, h, format, *seq, |px| {
                    for y in 0..rows {
                        let from = if stride < 0 { rows - 1 - y } else { y } * pitch;
                        px[y * row..(y + 1) * row].copy_from_slice(&src[from..from + row]);
                    }
                });"""),
])
