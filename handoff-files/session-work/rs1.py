def edit(p, pairs):
    s=open(p).read()
    for a,b in pairs:
        assert s.count(a)==1, (p, a, s.count(a))
        s=s.replace(a,b)
    open(p,'w').write(s)

edit('editor/src-tauri/src/media.rs', [
("""    /** A still picture (one frame, an image format). */
    pub still: bool,
}""","""    /** A still picture (one frame, an image format). */
    pub still: bool,
    /// The whole file's bit rate (kb/s), when FFmpeg says.
    pub bitrate_kbps: u32,
    /// The picture's pixel format (yuv420p, yuv422p10le…).
    pub pix_fmt: String,
    /// The frame rate FFmpeg guesses from the timestamps ("tbr").
    pub tbr: f64,
    /// HDR: PQ (smpte2084) or HLG (arib-std-b67) transfer.
    pub hdr: bool,
    /// Dolby Vision (iPhone HDR).
    pub dolby_vision: bool,
    /// Turned in the file (degrees clockwise: 0, 90, 180, 270).
    pub rotation: i32,
    /// Interlaced fields (camcorders, AVCHD, broadcast).
    pub interlaced: bool,
}

/// Bits per color of a pixel format (8 unless it says otherwise).
#[must_use]
pub fn bit_depth(pix_fmt: &str) -> u32 {
    let f = pix_fmt.to_ascii_lowercase();
    if f.contains("p16") || f.contains("48le") || f.contains("64le") {
        16
    } else if f.contains("12le") || f.contains("12be") || f.contains("p012") {
        12
    } else if f.contains("10le") || f.contains("10be") || f.contains("p010") || f == "v210" {
        10
    } else {
        8
    }
}

/// The pixel format's first word in a stream line (after the codec), if any.
fn pixel_format(rest: &str) -> Option<String> {
    const STARTS: [&str; 10] = [
        "yuv", "yuvj", "nv12", "nv16", "p010", "p210", "gbr", "rgb", "bgr", "gray",
    ];
    rest.split([' ', ',', '('])
        .map(str::trim)
        .find(|w| STARTS.iter().any(|s| w.starts_with(s)) && !w.contains('/'))
        .map(str::to_owned)
}

/// A number before a word in a stream line ("30 tbr", "29.97 fps").
fn number_before(rest: &str, unit: &str) -> Option<f64> {
    rest.split(',').find_map(|x| {
        let x = x.trim();
        let n = x.strip_suffix(unit)?.trim();
        let n = n.strip_suffix('k').map_or_else(
            || n.parse::<f64>().ok(),
            |k| k.parse::<f64>().ok().map(|v| v * 1000.0),
        );
        n
    })
}"""),
("""        if let Some(rest) = line.strip_prefix("Duration:") {
            let t = rest.split(',').next().unwrap_or("").trim();
            let parts: Vec<f64> = t.split(':').filter_map(|x| x.parse().ok()).collect();
            if let [h, m, s] = parts[..] {
                p.duration_ms = Some(((h * 60.0 + m) * 60.0 + s) * 1000.0);
            }
        } else if line.starts_with("Stream #") {""","""        if let Some(rest) = line.strip_prefix("Duration:") {
            let t = rest.split(',').next().unwrap_or("").trim();
            let parts: Vec<f64> = t.split(':').filter_map(|x| x.parse().ok()).collect();
            if let [h, m, s] = parts[..] {
                p.duration_ms = Some(((h * 60.0 + m) * 60.0 + s) * 1000.0);
            }
            if let Some(b) = rest
                .split(',')
                .find_map(|x| x.trim().strip_prefix("bitrate:"))
                .and_then(|b| b.trim().strip_suffix("kb/s"))
                .and_then(|b| b.trim().parse::<u32>().ok())
            {
                p.bitrate_kbps = b;
            }
        } else if line.starts_with("DOVI configuration record") {
            p.dolby_vision = true;
        } else if let Some(r) = line
            .strip_prefix("displaymatrix: rotation of")
            .and_then(|r| r.trim().strip_suffix("degrees"))
            .and_then(|r| r.trim().parse::<f64>().ok())
        {
            // FFmpeg says it counterclockwise: -90 means the picture is shown turned 90° clockwise.
            if p.rotation == 0 {
                p.rotation = (-r.round() as i32).rem_euclid(360);
            }
        } else if let Some(r) = line
            .strip_prefix("rotate")
            .and_then(|r| r.trim().strip_prefix(':'))
            .and_then(|r| r.trim().parse::<i32>().ok())
        {
            if p.rotation == 0 {
                p.rotation = r.rem_euclid(360);
            }
        } else if line.starts_with("Stream #") {"""),
("""                    if let Some(f) = rest.split(',').find_map(|x| {
                        x.trim()
                            .strip_suffix(" fps")
                            .and_then(|n| n.trim().parse::<f64>().ok())
                    }) {
                        p.fps = f;
                    }""","""                    if let Some(f) = number_before(rest, " fps") {
                        p.fps = f;
                    }
                    p.tbr = number_before(rest, " tbr").unwrap_or(0.0);
                    p.pix_fmt = pixel_format(rest).unwrap_or_default();
                    p.hdr = rest.contains("smpte2084") || rest.contains("arib-std-b67");
                    p.interlaced = rest.contains("top first")
                        || rest.contains("bottom first")
                        || rest.contains("top coded first")
                        || rest.contains("bottom coded first");
                    if p.bitrate_kbps == 0 {
                        if let Some(b) = number_before(rest, " kb/s") {
                            p.bitrate_kbps = b as u32;
                        }
                    }"""),
])
print('ok')
