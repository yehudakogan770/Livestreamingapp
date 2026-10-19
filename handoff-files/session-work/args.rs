fn is_h264(mime: &str) -> bool {
    mime.contains("avc1") || mime.contains("h264")
}

/// How a stream session is made: one FFmpeg per bitrate.
#[derive(Debug, Clone, PartialEq)]
struct StreamPlan {
    family: Family,
    /// Each FFmpeg's destinations and its encode (`None`: sent as the WebView encoded it).
    groups: Vec<(encode::Group, Option<VideoEncode>)>,
    /// What the WebView encodes at, kbit/s.
    source_kbps: u32,
}

impl StreamPlan {
    /// The encoder in use, for the operator.
    fn label(&self) -> String {
        let encodes = self.groups.iter().filter(|(_, e)| e.is_some()).count();
        let mut parts = Vec::new();
        if encodes > 0 {
            let more = if encodes > 1 {
                format!(", {encodes} bitrates")
            } else {
                String::new()
            };
            parts.push(format!(
                "{} ({}){more}",
                self.family.label(),
                self.family.encoder(Codec::H264)
            ));
        }
        if encodes < self.groups.len() {
            parts.push("the app’s own encoder (WebView2), sent as it is".to_owned());
        }
        let text = parts.join(" + ");
        let mut chars = text.chars();
        chars
            .next()
            .map(|c| c.to_uppercase().chain(chars).collect())
            .unwrap_or_default()
    }
}

/// Plan a stream (`Kind::Stream` or `Kind::Vertical`) to these destinations
/// (name, address, own bitrate); none: a rehearsal.
fn plan_stream(
    settings: &CaptureSettings,
    kind: Kind,
    mime: &str,
    family: Family,
    targets: &[(String, String, Option<u32>)],
) -> StreamPlan {
    let picture = if kind == Kind::Vertical {
        Quality::Vertical
    } else {
        settings.quality
    };
    let (pw, ph, pfps) = picture.size();
    let out = match kind {
        Kind::Stream => settings.stream_quality.unwrap_or(picture),
        _ => picture,
    };
    let (ow, oh, ofps) = out.size();
    let fps = ofps.min(pfps);
    let smaller = (ow, oh) != (pw, ph);
    let mut base = settings.stream_kbps.unwrap_or(settings.video_kbps);
    if kind == Kind::Vertical {
        base = base.min(Quality::Vertical.kbps());
    }
    let groups = if targets.is_empty() {
        vec![encode::Group {
            kbps: base,
            names: Vec::new(),
            targets: Vec::new(),
        }]
    } else {
        encode::group_by_bitrate(targets, base)
    };
    let need = StreamNeed {
        input_h264: is_h264(mime),
        resized: smaller || fps != pfps,
        own_bitrate: false,
    };
    let groups: Vec<_> = groups
        .into_iter()
        .map(|g| {
            let need = StreamNeed {
                own_bitrate: g.kbps != base,
                ..need
            };
            let enc = encode::must_encode(need, family, settings.encoder).then_some(VideoEncode {
                family,
                codec: Codec::H264,
                rate: Rate::Cbr { kbps: g.kbps },
                preset: settings.preset,
                fps,
                size: smaller.then_some((ow, oh)),
            });
            (g, enc)
        })
        .collect();
    // Sent as it is somewhere: the WebView encodes at the stream's bitrate.
    // Otherwise well above it, so the second encode loses next to nothing.
    let source_kbps = if groups.iter().any(|(_, e)| e.is_none()) {
        base
    } else {
        let top = groups.iter().map(|(g, _)| g.kbps).max().unwrap_or(base);
        encode::source_kbps(top, picture.kbps())
    };
    StreamPlan {
        family,
        groups,
        source_kbps,
    }
}

/// The encode of a recording FFmpeg encodes again: constant quality, at
/// most the recording bitrate.
fn plan_record(settings: &CaptureSettings, family: Family) -> VideoEncode {
    VideoEncode {
        family,
        codec: settings.record_codec,
        rate: Rate::Quality {
            level: encode::quality_level(settings.preset),
            max_kbps: settings.video_kbps,
        },
        preset: settings.preset,
        fps: settings.quality.size().2,
        size: None,
    }
}

/// The start of every FFmpeg fed the WebView's encode on stdin.
fn input_args(decode: Vec<String>) -> Vec<String> {
    let mut a: Vec<String> = ["-hide_banner", "-loglevel", "error", "-fflags", "+genpts"]
        .map(str::to_owned)
        .to_vec();
    // The encoder says what the stream holds, so start after a second.
    a.extend(["-analyzeduration", "1000000"].map(str::to_owned));
    a.extend(decode);
    a.extend(["-i", "pipe:0", "-map", "0:v:0", "-map", "0:a:0?"].map(str::to_owned));
    a
}

/// FFmpeg's progress report, every second, on stdout.
fn progress_args() -> [String; 4] {
    ["-progress", "pipe:1", "-stats_period", "1"].map(str::to_owned)
}

/// FFmpeg's arguments for a recording it encodes again (into Matroska, which
/// stays playable if anything stops; it becomes an .mp4 at the end).
fn record_args(e: &VideoEncode, path: &Path) -> Vec<String> {
    let mut a = input_args(encode::decode_args(e.family));
    a.extend(encode::video_args(e));
    a.extend(["-c:a", "copy"].map(str::to_owned));
    a.extend(progress_args());
    a.extend(["-f", "matroska", "-y"].map(str::to_owned));
    a.push(path.to_string_lossy().into_owned());
    a
}

/// FFmpeg's arguments for streaming what arrives on stdin to one bitrate
/// group of destinations (`video`: its encode; `None`: sent as it is).
fn stream_args(group: &encode::Group, video: Option<&VideoEncode>, audio_kbps: u32) -> Vec<String> {
    let mut a = input_args(video.map(|e| encode::decode_args(e.family)).unwrap_or_default());
    match video {
        Some(e) => a.extend(encode::video_args(e)),
        // Already H.264 from the WebView's encoder: sent as it is.
        None => a.extend(["-c:v", "copy"].map(str::to_owned)),
    }
    a.extend([
        "-c:a".to_owned(),
        "aac".to_owned(),
        "-b:a".to_owned(),
        format!("{audio_kbps}k"),
    ]);
    a.extend(["-ar", "48000", "-ac", "2", "-flags:a", "+global_header"].map(str::to_owned));
    a.extend(progress_args());
    if group.targets.is_empty() {
        // A rehearsal: made in full, sent nowhere.
        a.extend(["-f", "null", "-"].map(str::to_owned));
        return a;
    }
    a.extend(["-f", "tee"].map(str::to_owned));
    // One failing destination never stops the others.
    let tee = group
        .targets
        .iter()
        .map(|t| format!("[f=flv:onfail=ignore]{}", tee_escape(t)))
        .collect::<Vec<_>>()
        .join("|");
    a.push(tee);
    a
}

