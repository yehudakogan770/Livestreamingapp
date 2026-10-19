import sys
p = sys.argv[1]
s = open(p).read()
old_start = s.index("/// FFmpeg's arguments for an edit-friendly copy or a playback proxy.")
old_end = s.index("/// FFmpeg's arguments to hand over a file's frames")
new = '''/// How a copy is encoded: the encoder (a graphics card's for proxies when one
/// works, else libx264), FFmpeg's threads (several proxies are made side by
/// side) and the input options for hardware decoding.
#[derive(Debug, Clone, Default)]
pub struct CopyEncoding {
    /// `None`: libx264.
    pub encoder: Option<String>,
    pub threads: Option<u32>,
    /// Put before `-i` (e.g. `-hwaccel cuda`).
    pub decode: Vec<OsString>,
}

/// The video encoder's options for a copy (`gop` frames between key frames, quality like x264's CRF).
#[must_use]
pub fn copy_encoder_args(encoder: Option<&str>, crf: &str, preset: &str, gop: &str) -> Vec<String> {
    let enc = encoder.unwrap_or("libx264");
    let mut a: Vec<&str> = vec!["-c:v", enc];
    if enc.ends_with("_nvenc") {
        a.extend(["-preset", "p4", "-rc", "vbr", "-cq", crf, "-b:v", "0", "-g", gop, "-bf", "0"]);
    } else if enc.ends_with("_qsv") {
        a.extend(["-preset", "veryfast", "-global_quality", crf, "-g", gop, "-bf", "0"]);
    } else if enc.ends_with("_amf") {
        a.extend(["-quality", "speed", "-rc", "cqp", "-qp_i", crf, "-qp_p", crf, "-g", gop, "-bf", "0"]);
    } else if enc.ends_with("_videotoolbox") {
        a.extend(["-q:v", "60", "-g", gop]);
    } else {
        a.extend(["-preset", preset, "-crf", crf, "-g", gop, "-bf", "0", "-tune", "fastdecode"]);
    }
    a.into_iter().map(str::to_owned).collect()
}

/// The pixel format an encoder is given (hardware encoders other than NVENC like NV12).
#[must_use]
pub fn copy_pixel_format(encoder: Option<&str>) -> &'static str {
    match encoder {
        Some(e) if e.ends_with("_qsv") || e.ends_with("_amf") || e.ends_with("_videotoolbox") => "nv12",
        _ => "yuv420p",
    }
}

/// FFmpeg's arguments for an edit-friendly copy or a playback proxy.
#[must_use]
pub fn copy_args(
    file: &Path,
    out: &Path,
    plan: &Plan,
    kind: CopyKind,
    tone_map: bool,
) -> Vec<OsString> {
    copy_args_with(file, out, plan, kind, tone_map, &CopyEncoding::default())
}

/// FFmpeg's arguments for a copy, encoded and decoded as `how` says.
#[must_use]
pub fn copy_args_with(
    file: &Path,
    out: &Path,
    plan: &Plan,
    kind: CopyKind,
    tone_map: bool,
    how: &CopyEncoding,
) -> Vec<OsString> {
    let mut vf = video_filters(plan, tone_map);
    if kind == CopyKind::Proxy {
        vf.push("scale=-2:'min(1080,ih)':flags=bicubic".to_owned());
    }
    vf.push(format!("format={}", copy_pixel_format(how.encoder.as_deref())));
    let (crf, preset, gop) = match kind {
        CopyKind::Intermediate => ("16", "veryfast", "15"),
        CopyKind::Proxy => ("22", "veryfast", "12"),
    };
    let mut a: Vec<OsString> = how.decode.clone();
    a.extend([
        "-i".into(),
        file.into(),
        "-map".into(),
        "0:v:0".into(),
        "-map".into(),
        "0:a?".into(),
    ]);
    a.extend(["-vf".into(), vf.join(",").into()]);
    if let Some(r) = plan.cfr {
        a.extend([
            "-fps_mode".into(),
            "cfr".into(),
            "-r".into(),
            trim_rate(r).into(),
        ]);
    }
    a.extend(
        copy_encoder_args(how.encoder.as_deref(), crf, preset, gop)
            .into_iter()
            .map(OsString::from),
    );
    a.extend(
        [
            "-c:a",
            "aac",
            "-b:a",
            "192k",
            "-ac",
            "2",
            "-movflags",
            "+faststart",
        ]
        .map(OsString::from),
    );
    if let Some(t) = how.threads.filter(|t| *t > 0) {
        a.extend(["-threads".into(), t.to_string().into()]);
    }
    // A copy carries no turn of its own (the pictures are already upright).
    a.extend(["-metadata:s:v:0".into(), "rotate=0".into()]);
    a.push(out.into());
    a
}

'''
s = s[:old_start] + new + s[old_end:]


def rep(a, b):
    global s
    assert a in s, a[:60]
    s = s.replace(a, b, 1)


rep('''    tone_map: bool,
) -> Vec<OsString> {
    let mut vf = video_filters(plan, tone_map);
    vf.push(format!("fps={rate:.6}"));''', '''    tone_map: bool,
) -> Vec<OsString> {
    reader_args_with(file, plan, from, rate, (width, height), tone_map, &[])
}

/// [`reader_args`] with input options for hardware decoding (`decode`, before `-i`).
#[must_use]
pub fn reader_args_with(
    file: &Path,
    plan: &Plan,
    from: f64,
    rate: f64,
    (width, height): (u32, u32),
    tone_map: bool,
    decode: &[OsString],
) -> Vec<OsString> {
    let mut vf = video_filters(plan, tone_map);
    vf.push(format!("fps={rate:.6}"));''')
rep('''        a.extend(["-ss".into(), format!("{from:.6}").into()]);
    }
    a.extend([''', '''        a.extend(["-ss".into(), format!("{from:.6}").into()]);
    }
    a.extend(decode.iter().cloned());
    a.extend([''')
rep('''        assert_eq!(args.last().map(String::as_str), Some("pipe:1"));
    }
}''', '''        assert_eq!(args.last().map(String::as_str), Some("pipe:1"));
        let hw: Vec<String> = reader_args_with(
            Path::new("a.mov"),
            &plan,
            0.0,
            24.0,
            (640, 360),
            true,
            &crate::hwaccel::decode_args(Some("cuda")),
        )
        .iter()
        .map(|a| a.to_string_lossy().into_owned())
        .collect();
        let i = hw.iter().position(|a| a == "-i").unwrap();
        assert_eq!(&hw[i - 2..i], ["-hwaccel", "cuda"], "decoding options go before the input");
    }

    #[test]
    fn proxies_with_hardware_encoders() {
        let uhd = plan(
            Path::new("a.mp4"),
            &probe("hevc (Main), yuv420p, 3840x2160, 29.97 fps, 29.97 tbr", ""),
        );
        let text = |how: &CopyEncoding| -> Vec<String> {
            copy_args_with(Path::new("a.mp4"), Path::new("p.mp4"), &uhd, CopyKind::Proxy, true, how)
                .iter()
                .map(|a| a.to_string_lossy().into_owned())
                .collect()
        };
        let soft = text(&CopyEncoding::default());
        assert!(soft.windows(2).any(|w| w[0] == "-c:v" && w[1] == "libx264"));
        assert!(!soft.iter().any(|a| a == "-threads" || a == "-hwaccel"));
        let nv = text(&CopyEncoding {
            encoder: Some("h264_nvenc".into()),
            threads: Some(4),
            decode: crate::hwaccel::decode_args(Some("cuda")),
        });
        assert_eq!(&nv[..3], ["-hwaccel", "cuda", "-i"]);
        assert!(nv.windows(2).any(|w| w[0] == "-c:v" && w[1] == "h264_nvenc"));
        assert!(nv.windows(2).any(|w| w[0] == "-cq" && w[1] == "22"));
        assert!(nv.windows(2).any(|w| w[0] == "-threads" && w[1] == "4"));
        assert!(nv.iter().any(|a| a.ends_with("format=yuv420p")));
        let qsv = text(&CopyEncoding {
            encoder: Some("h264_qsv".into()),
            ..CopyEncoding::default()
        });
        assert!(qsv.iter().any(|a| a.ends_with("format=nv12")));
        assert_eq!(qsv.last().map(String::as_str), Some("p.mp4"));
        // The plain call is unchanged.
        let plain: Vec<String> = copy_args(Path::new("a.mp4"), Path::new("p.mp4"), &uhd, CopyKind::Proxy, true)
            .iter()
            .map(|a| a.to_string_lossy().into_owned())
            .collect();
        assert_eq!(plain, soft);
    }
}''')
open(p, 'w').write(s)
