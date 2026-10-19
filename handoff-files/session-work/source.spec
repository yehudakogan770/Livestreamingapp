@@@
/// The picture size FFmpeg's `ffprobe` reports (None when it can't tell).
pub fn probe_size(ffmpeg: &Path, file: &Path) -> Option<(u32, u32)> {
===
/// The picture size FFmpeg's `ffprobe` reports (None when it can't tell).
pub fn probe_size(ffmpeg: &Path, file: &Path) -> Option<(u32, u32)> {
    probe(ffmpeg, file).0
}

/// `ffprobe`'s line for the first video stream (`width,height,color_transfer`):
/// its size, and its HDR transfer function when it is HDR.
pub fn parse_probe(text: &str) -> (Option<(u32, u32)>, Option<crate::hdr::Hdr>) {
    let line = text.lines().find(|l| !l.trim().is_empty()).unwrap_or("");
    let mut it = line.split(',');
    let mut num = || it.next().and_then(|v| v.trim().parse::<u32>().ok());
    let size = match (num(), num()) {
        (Some(w), Some(h)) if w > 0 && h > 0 => Some((w, h)),
        _ => None,
    };
    let trc = line.split(',').nth(2).unwrap_or("");
    (size, crate::hdr::Hdr::from_ffmpeg(trc))
}

/// A file's picture size and HDR transfer function (`ffprobe`).
pub fn probe(ffmpeg: &Path, file: &Path) -> (Option<(u32, u32)>, Option<crate::hdr::Hdr>) {
@@@
            "-show_entries",
            "stream=width,height",
            "-of",
            "csv=p=0",
        ])
        .arg(file)
        .output()
        .ok()?;
    let text = String::from_utf8_lossy(&out.stdout);
    let mut it = text.trim().split(',').map(|v| v.trim().parse::<u32>().ok());
    match (it.next().flatten(), it.next().flatten()) {
        (Some(w), Some(h)) if w > 0 && h > 0 => Some((w, h)),
        _ => None,
    }
}
===
            "-show_entries",
            "stream=width,height,color_transfer",
            "-of",
            "csv=p=0",
        ])
        .arg(file)
        .output();
    match out {
        Ok(o) => parse_probe(&String::from_utf8_lossy(&o.stdout)),
        Err(_) => (None, None),
    }
}
@@@
/// FFmpeg's arguments to decode `file` as `clip` says, at `w` × `h` RGBA (`still`: a picture).
pub fn file_args(file: &Path, still: bool, clip: Clip, w: u32, h: u32) -> Vec<String> {
===
/// FFmpeg's arguments to decode `file` as `clip` says, at `w` × `h` RGBA (`still`: a picture).
pub fn file_args(file: &Path, still: bool, clip: Clip, w: u32, h: u32) -> Vec<String> {
    file_args_as(file, still, clip, (w, h), None)
}

/// [`file_args`] for a file that may be HDR: an HDR video is decoded as
/// 10-bit RGB (`x2bgr10le`, its own BT.2020 colors and PQ or HLG signal),
/// made SDR on the GPU (`hdr.wgsl`) instead of being clipped by FFmpeg.
pub fn file_args_as(
    file: &Path,
    still: bool,
    clip: Clip,
    (w, h): (u32, u32),
    hdr: Option<crate::hdr::Hdr>,
) -> Vec<String> {
@@@
        "-pix_fmt".to_owned(),
        "rgba".to_owned(),
        "-f".to_owned(),
        "rawvideo".to_owned(),
        "-".to_owned(),
    ]);
    a
}
===
        "-pix_fmt".to_owned(),
        if hdr.is_some() { "x2bgr10le" } else { "rgba" }.to_owned(),
        "-f".to_owned(),
        "rawvideo".to_owned(),
        "-".to_owned(),
    ]);
    a
}
@@@
    let (w, h) = delivered_size(probe_size(ffmpeg, file));
    let mut cmd = quiet(ffmpeg);
    cmd.args(file_args(file, still, clip, w, h));
===
    let (size, hdr) = probe(ffmpeg, file);
    // HDR pictures (still images are always SDR here) come as 10-bit RGB.
    let hdr = hdr.filter(|_| !still);
    let (w, h) = delivered_size(size);
    let mut cmd = quiet(ffmpeg);
    cmd.args(file_args_as(file, still, clip, (w, h), hdr));
@@@
        mb.put(VideoFrame {
            width: w,
            height: h,
            format: PixelFormat::Rgba8,
            data: Arc::new(buf),
            seq,
        });
===
        mb.put(VideoFrame {
            width: w,
            height: h,
            format: hdr.map_or(PixelFormat::Rgba8, PixelFormat::Rgb10),
            data: Arc::new(buf),
            seq,
        });
