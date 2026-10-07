//! Which video encoder FFmpeg uses, and with what arguments.
//!
//! The Live Screen is first encoded by the WebView (MediaRecorder, which uses
//! the graphics card through Windows Media Foundation where it can). FFmpeg
//! encodes again only when that helps:
//!
//! - a stream at a different size, frame rate or bitrate than the picture
//!   (4K recording, 1080p stream; a lower bitrate for one destination);
//! - a steady stream (constant bitrate, a keyframe every 2 seconds, as
//!   YouTube and Facebook ask) when a hardware encoder is there to do it;
//! - recordings, when "Encode recordings with the encoder below" is chosen
//!   (constant quality instead of the WebView's bitrate).
//!
//! The encoder is NVIDIA NVENC, Intel Quick Sync or AMD AMF when the start-up
//! check found it working, otherwise x264 on the processor. A hardware
//! encoder that fails is not used again until Lumora restarts.
//!
//! Everything here is pure (no FFmpeg is run), so it is unit tested.

use serde::{Deserialize, Serialize};

/// The encoder the operator chose.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub enum EncoderChoice {
    /// The best hardware encoder that works here, else the processor.
    #[default]
    Auto,
    Nvidia,
    Intel,
    Amd,
    /// x264 on the processor.
    Software,
}

/// Speed against quality (mapped to each encoder's own presets).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub enum Preset {
    Speed,
    #[default]
    Balanced,
    Quality,
}

/// The video format of FFmpeg-encoded recordings (streams are always H.264).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub enum Codec {
    #[default]
    H264,
    /// Smaller files at the same quality (hardware only; the processor uses H.264).
    Hevc,
}

/// An encoder family.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Family {
    Nvenc,
    Qsv,
    Amf,
    Software,
}

impl Family {
    /// FFmpeg's encoder name. The processor always makes H.264 (HEVC is too
    /// slow for live work there).
    #[must_use]
    pub fn encoder(self, codec: Codec) -> &'static str {
        match (self, codec) {
            (Family::Nvenc, Codec::H264) => "h264_nvenc",
            (Family::Nvenc, Codec::Hevc) => "hevc_nvenc",
            (Family::Qsv, Codec::H264) => "h264_qsv",
            (Family::Qsv, Codec::Hevc) => "hevc_qsv",
            (Family::Amf, Codec::H264) => "h264_amf",
            (Family::Amf, Codec::Hevc) => "hevc_amf",
            (Family::Software, _) => "libx264",
        }
    }

    /// For the operator.
    #[must_use]
    pub fn label(self) -> &'static str {
        match self {
            Family::Nvenc => "NVIDIA NVENC",
            Family::Qsv => "Intel Quick Sync",
            Family::Amf => "AMD AMF",
            Family::Software => "Processor",
        }
    }

    #[must_use]
    pub fn hardware(self) -> bool {
        self != Family::Software
    }
}

/// The encoder to use: the chosen one if it works here (and has not failed
/// this time), otherwise the processor. Automatic tries NVIDIA, then Intel,
/// then AMD.
#[must_use]
pub fn pick(choice: EncoderChoice, codec: Codec, working: &[String], failed: &[Family]) -> Family {
    let usable = |f: Family| !failed.contains(&f) && working.iter().any(|w| w == f.encoder(codec));
    let order: &[Family] = match choice {
        EncoderChoice::Auto => &[Family::Nvenc, Family::Qsv, Family::Amf],
        EncoderChoice::Nvidia => &[Family::Nvenc],
        EncoderChoice::Intel => &[Family::Qsv],
        EncoderChoice::Amd => &[Family::Amf],
        EncoderChoice::Software => &[],
    };
    order
        .iter()
        .copied()
        .find(|f| usable(*f))
        .unwrap_or(Family::Software)
}

/// How the bits are spent.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Rate {
    /// Constant bitrate (streams: what streaming services ask for).
    Cbr { kbps: u32 },
    /// Constant quality, never above `max_kbps` (recordings). `level` is on
    /// the x264 CRF scale (lower is better; 18 – 28 is sensible).
    Quality { level: u8, max_kbps: u32 },
}

/// One FFmpeg video encode.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct VideoEncode {
    pub family: Family,
    pub codec: Codec,
    pub rate: Rate,
    pub preset: Preset,
    /// Frames a second out (a keyframe every 2 seconds of them).
    pub fps: u32,
    /// Scaled to this size (`None`: as it comes).
    pub size: Option<(u32, u32)>,
}

/// The constant-quality level for a preset (x264 CRF scale).
#[must_use]
pub fn quality_level(preset: Preset) -> u8 {
    match preset {
        Preset::Speed => 26,
        Preset::Balanced => 23,
        Preset::Quality => 20,
    }
}

fn s(v: &[&str]) -> Vec<String> {
    v.iter().map(|x| (*x).to_owned()).collect()
}

/// FFmpeg's output arguments for a video encode (from `-vf` to the encoder's
/// options; the input and the muxer are added by the caller).
#[must_use]
pub fn video_args(e: &VideoEncode) -> Vec<String> {
    let fps = e.fps.max(1);
    let gop = (fps * 2).to_string();
    let hw = e.family.hardware();
    let codec = if hw { e.codec } else { Codec::H264 };
    let mut a = Vec::new();
    // Size and pixel format (NV12 for the graphics cards; Quick Sync takes nothing else).
    let format = if hw { "nv12" } else { "yuv420p" };
    let vf = match e.size {
        Some((w, h)) => format!("scale={w}:{h}:flags=bicubic,format={format}"),
        None => format!("format={format}"),
    };
    a.extend(["-vf".to_owned(), vf, "-r".to_owned(), fps.to_string()]);
    a.extend(["-c:v".to_owned(), e.family.encoder(codec).to_owned()]);
    // Speed against quality, in each encoder's own words.
    a.extend(match (e.family, e.preset) {
        (Family::Nvenc, p) => vec![
            "-preset".to_owned(),
            match p {
                Preset::Speed => "p2",
                Preset::Balanced => "p4",
                Preset::Quality => "p6",
            }
            .to_owned(),
            "-tune".to_owned(),
            "hq".to_owned(),
        ],
        (Family::Qsv, p) => vec![
            "-preset".to_owned(),
            match p {
                Preset::Speed => "veryfast",
                Preset::Balanced => "medium",
                Preset::Quality => "slower",
            }
            .to_owned(),
        ],
        (Family::Amf, p) => vec![
            "-usage".to_owned(),
            "transcoding".to_owned(),
            "-quality".to_owned(),
            match p {
                Preset::Speed => "speed",
                Preset::Balanced => "balanced",
                Preset::Quality => "quality",
            }
            .to_owned(),
        ],
        (Family::Software, p) => vec![
            "-preset".to_owned(),
            match p {
                Preset::Speed => "superfast",
                Preset::Balanced => "veryfast",
                Preset::Quality => "faster",
            }
            .to_owned(),
        ],
    });
    if codec == Codec::H264 {
        a.extend(s(&["-profile:v", "high"]));
    }
    // Rate control.
    match e.rate {
        Rate::Cbr { kbps } => {
            let (k, buf) = (format!("{kbps}k"), format!("{}k", kbps * 2));
            match e.family {
                Family::Nvenc | Family::Amf => a.extend(s(&["-rc", "cbr"])),
                // Quick Sync is constant bitrate when the bitrate and its maximum are equal.
                Family::Qsv => {}
                Family::Software => a.extend(s(&["-x264-params", "nal-hrd=cbr"])),
            }
            a.extend([
                "-b:v".to_owned(),
                k.clone(),
                "-maxrate".to_owned(),
                k,
                "-bufsize".to_owned(),
                buf,
            ]);
        }
        Rate::Quality { level, max_kbps } => {
            let max = format!("{max_kbps}k");
            let buf = format!("{}k", max_kbps * 2);
            let l = level.to_string();
            match e.family {
                Family::Nvenc => a.extend([
                    "-rc".to_owned(),
                    "vbr".to_owned(),
                    "-cq".to_owned(),
                    l,
                    "-b:v".to_owned(),
                    "0".to_owned(),
                    "-maxrate".to_owned(),
                    max,
                    "-bufsize".to_owned(),
                    buf,
                ]),
                // ICQ (intelligent constant quality).
                Family::Qsv => a.extend(["-global_quality".to_owned(), l]),
                Family::Amf => a.extend([
                    "-rc".to_owned(),
                    "cqp".to_owned(),
                    "-qp_i".to_owned(),
                    l.clone(),
                    "-qp_p".to_owned(),
                    (level + 2).to_string(),
                    "-qp_b".to_owned(),
                    (level + 4).to_string(),
                ]),
                Family::Software => a.extend([
                    "-crf".to_owned(),
                    l,
                    "-maxrate".to_owned(),
                    max,
                    "-bufsize".to_owned(),
                    buf,
                ]),
            }
        }
    }
    // A keyframe exactly every 2 seconds (streaming services ask for it; it
    // also lets editors cut anywhere close).
    a.extend(["-g".to_owned(), gop.clone(), "-keyint_min".to_owned(), gop]);
    match e.family {
        Family::Software => a.extend(s(&["-sc_threshold", "0"])),
        Family::Nvenc => a.extend(s(&["-no-scenecut", "1", "-strict_gop", "1"])),
        Family::Qsv => a.extend(s(&["-idr_interval", "0"])),
        Family::Amf => {}
    }
    a.extend(s(&["-flags:v", "+global_header"]));
    a
}

/// Input arguments: decoding on the graphics card when a hardware encoder is
/// used (FFmpeg falls back to the processor by itself if it can't).
#[must_use]
pub fn decode_args(family: Family) -> Vec<String> {
    if family.hardware() {
        s(&["-hwaccel", "auto"])
    } else {
        Vec::new()
    }
}

/// FFmpeg's words when a video encoder can't start or stops working (the
/// graphics driver, the card's limit of encodes at once, no such card).
#[must_use]
pub fn encoder_failed(ffmpeg_said: &str) -> bool {
    let l = ffmpeg_said.to_ascii_lowercase();
    [
        "error while opening encoder",
        "could not open encoder",
        "error initializing output stream",
        "openencodesessionex failed",
        "no capable devices found",
        "no nvenc capable devices",
        "cannot load nvcuda",
        "cannot load libcuda",
        "cannot init cuda",
        "nvenc",
        "initializeencoder failed",
        "error submitting video frame",
        "error encoding a frame",
        "error during encoding",
        "error initializing an internal mfx session",
        "mfx session",
        "error creating a mfx session",
        "amf failed",
        "amfcontext",
        "failed to initialize amf",
        "generic error in an external library",
        "incompatible client key",
        "driver does not support",
        "out of memory",
        "device creation failed",
        "failed to set value",
    ]
    .iter()
    .any(|w| l.contains(w))
}

/// Which tee output dropped out ("Slave muxer #1 failed: …, continuing with 1/2 slaves").
#[must_use]
pub fn dropped_output(line: &str) -> Option<usize> {
    let rest = line.split("Slave muxer #").nth(1)?;
    if !rest.contains("failed") {
        return None;
    }
    rest.split(|c: char| !c.is_ascii_digit())
        .next()?
        .parse()
        .ok()
}

/// Destinations that share a bitrate share one encode.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Group {
    pub kbps: u32,
    /// The destinations' names and addresses, in order.
    pub names: Vec<String>,
    pub targets: Vec<String>,
}

/// Group destinations (name, address, own bitrate) by bitrate, keeping their order.
#[must_use]
pub fn group_by_bitrate(dests: &[(String, String, Option<u32>)], default_kbps: u32) -> Vec<Group> {
    let mut groups: Vec<Group> = Vec::new();
    for (name, target, own) in dests {
        let kbps = own.filter(|k| *k > 0).unwrap_or(default_kbps);
        match groups.iter_mut().find(|g| g.kbps == kbps) {
            Some(g) => {
                g.names.push(name.clone());
                g.targets.push(target.clone());
            }
            None => groups.push(Group {
                kbps,
                names: vec![name.clone()],
                targets: vec![target.clone()],
            }),
        }
    }
    groups
}

/// What a stream (or one bitrate group of it) needs from FFmpeg.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct StreamNeed {
    /// The WebView sends H.264 (it can go out as it is).
    pub input_h264: bool,
    /// The stream is smaller than the picture, or has fewer frames a second.
    pub resized: bool,
    /// This group's bitrate is not the stream's own.
    pub own_bitrate: bool,
}

/// Whether FFmpeg must encode (`false`: the WebView's encode goes out as it
/// is, which costs nothing). With a hardware encoder it always encodes, for a
/// steady bitrate and keyframes; the processor is spared when nothing needs it,
/// unless Software was chosen on purpose.
#[must_use]
pub fn must_encode(need: StreamNeed, family: Family, choice: EncoderChoice) -> bool {
    !need.input_h264
        || need.resized
        || need.own_bitrate
        || family.hardware()
        || choice == EncoderChoice::Software
}

/// The bitrate the WebView encodes at when FFmpeg encodes again: high enough
/// that the second encode loses next to nothing.
#[must_use]
pub fn source_kbps(out_kbps: u32, picture_kbps: u32) -> u32 {
    (out_kbps * 2).max(picture_kbps * 3 / 2).clamp(4000, 80_000)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn has(a: &[String], pair: [&str; 2]) -> bool {
        a.windows(2).any(|w| w[0] == pair[0] && w[1] == pair[1])
    }

    fn enc(family: Family, rate: Rate) -> VideoEncode {
        VideoEncode {
            family,
            codec: Codec::H264,
            rate,
            preset: Preset::Balanced,
            fps: 30,
            size: None,
        }
    }

    #[test]
    fn automatic_takes_the_best_working_card_and_falls_back() {
        let all: Vec<String> = ["h264_qsv", "h264_amf", "h264_nvenc", "hevc_nvenc"]
            .map(str::to_owned)
            .to_vec();
        let auto = EncoderChoice::Auto;
        assert_eq!(pick(auto, Codec::H264, &all, &[]), Family::Nvenc);
        assert_eq!(pick(auto, Codec::H264, &all, &[Family::Nvenc]), Family::Qsv);
        assert_eq!(
            pick(auto, Codec::H264, &all, &[Family::Nvenc, Family::Qsv]),
            Family::Amf
        );
        assert_eq!(pick(auto, Codec::H264, &[], &[]), Family::Software);
        // HEVC only where the card can do HEVC.
        assert_eq!(pick(auto, Codec::Hevc, &all, &[]), Family::Nvenc);
        assert_eq!(
            pick(auto, Codec::Hevc, &all, &[Family::Nvenc]),
            Family::Software
        );
        // A chosen card that isn't there (or failed) means the processor, never another card.
        assert_eq!(
            pick(EncoderChoice::Intel, Codec::H264, &all, &[]),
            Family::Qsv
        );
        assert_eq!(
            pick(EncoderChoice::Amd, Codec::H264, &["h264_nvenc".into()], &[]),
            Family::Software
        );
        assert_eq!(
            pick(EncoderChoice::Nvidia, Codec::H264, &all, &[Family::Nvenc]),
            Family::Software
        );
        assert_eq!(
            pick(EncoderChoice::Software, Codec::H264, &all, &[]),
            Family::Software
        );
    }

    #[test]
    fn names_and_families_match() {
        let suffix = |f: Family| match f {
            Family::Nvenc => "_nvenc",
            Family::Qsv => "_qsv",
            Family::Amf => "_amf",
            Family::Software => "x264",
        };
        for f in [Family::Nvenc, Family::Qsv, Family::Amf, Family::Software] {
            assert!(f
                .encoder(Codec::H264)
                .starts_with(if f.hardware() { "h264" } else { "lib" }));
            for c in [Codec::H264, Codec::Hevc] {
                assert!(f.encoder(c).ends_with(suffix(f)));
            }
        }
        assert_eq!(Family::Software.encoder(Codec::Hevc), "libx264");
        assert_eq!(Family::Amf.encoder(Codec::Hevc), "hevc_amf");
    }

    #[test]
    fn streams_are_constant_bitrate_with_a_keyframe_every_two_seconds() {
        for family in [Family::Nvenc, Family::Qsv, Family::Amf, Family::Software] {
            let mut e = enc(family, Rate::Cbr { kbps: 6000 });
            e.fps = 60;
            let a = video_args(&e);
            assert!(has(&a, ["-b:v", "6000k"]), "{family:?} {a:?}");
            assert!(has(&a, ["-maxrate", "6000k"]), "{family:?}");
            assert!(has(&a, ["-bufsize", "12000k"]), "{family:?}");
            assert!(has(&a, ["-g", "120"]), "{family:?}");
            assert!(has(&a, ["-keyint_min", "120"]), "{family:?}");
            assert!(has(&a, ["-r", "60"]), "{family:?}");
            assert!(has(&a, ["-c:v", family.encoder(Codec::H264)]));
            assert!(has(&a, ["-profile:v", "high"]));
            assert!(has(&a, ["-flags:v", "+global_header"]));
        }
        let nv = video_args(&enc(Family::Nvenc, Rate::Cbr { kbps: 6000 }));
        assert!(has(&nv, ["-rc", "cbr"]) && has(&nv, ["-preset", "p4"]));
        assert!(has(&nv, ["-vf", "format=nv12"]));
        let amf = video_args(&enc(Family::Amf, Rate::Cbr { kbps: 6000 }));
        assert!(has(&amf, ["-rc", "cbr"]) && has(&amf, ["-quality", "balanced"]));
        let qsv = video_args(&enc(Family::Qsv, Rate::Cbr { kbps: 6000 }));
        assert!(!qsv.contains(&"-rc".to_owned()), "Quick Sync has no -rc");
        assert!(has(&qsv, ["-preset", "medium"]));
        let x = video_args(&enc(Family::Software, Rate::Cbr { kbps: 6000 }));
        assert!(has(&x, ["-x264-params", "nal-hrd=cbr"]));
        assert!(has(&x, ["-sc_threshold", "0"]) && has(&x, ["-preset", "veryfast"]));
        assert!(has(&x, ["-vf", "format=yuv420p"]));
    }

    #[test]
    fn recordings_are_constant_quality() {
        let q = Rate::Quality {
            level: 20,
            max_kbps: 40_000,
        };
        let nv = video_args(&enc(Family::Nvenc, q));
        assert!(has(&nv, ["-rc", "vbr"]) && has(&nv, ["-cq", "20"]) && has(&nv, ["-b:v", "0"]));
        assert!(has(&nv, ["-maxrate", "40000k"]));
        let qsv = video_args(&enc(Family::Qsv, q));
        assert!(has(&qsv, ["-global_quality", "20"]));
        let amf = video_args(&enc(Family::Amf, q));
        assert!(
            has(&amf, ["-rc", "cqp"]) && has(&amf, ["-qp_i", "20"]) && has(&amf, ["-qp_b", "24"])
        );
        let x = video_args(&enc(Family::Software, q));
        assert!(has(&x, ["-crf", "20"]) && has(&x, ["-maxrate", "40000k"]));
        assert!(quality_level(Preset::Quality) < quality_level(Preset::Speed));
    }

    #[test]
    fn presets_map_to_each_encoders_own_words() {
        let p = |family, preset| {
            let mut e = enc(family, Rate::Cbr { kbps: 1000 });
            e.preset = preset;
            video_args(&e)
        };
        assert!(has(&p(Family::Nvenc, Preset::Speed), ["-preset", "p2"]));
        assert!(has(&p(Family::Nvenc, Preset::Quality), ["-preset", "p6"]));
        assert!(has(&p(Family::Qsv, Preset::Speed), ["-preset", "veryfast"]));
        assert!(has(&p(Family::Qsv, Preset::Quality), ["-preset", "slower"]));
        assert!(has(&p(Family::Amf, Preset::Speed), ["-quality", "speed"]));
        assert!(has(
            &p(Family::Amf, Preset::Quality),
            ["-quality", "quality"]
        ));
        assert!(has(
            &p(Family::Software, Preset::Speed),
            ["-preset", "superfast"]
        ));
        assert!(has(
            &p(Family::Software, Preset::Quality),
            ["-preset", "faster"]
        ));
    }

    #[test]
    fn hevc_and_scaling() {
        let mut e = enc(
            Family::Nvenc,
            Rate::Quality {
                level: 23,
                max_kbps: 50_000,
            },
        );
        e.codec = Codec::Hevc;
        e.size = Some((1920, 1080));
        let a = video_args(&e);
        assert!(has(&a, ["-c:v", "hevc_nvenc"]));
        assert!(
            !a.contains(&"-profile:v".to_owned()),
            "HEVC keeps its own profile"
        );
        assert!(has(
            &a,
            ["-vf", "scale=1920:1080:flags=bicubic,format=nv12"]
        ));
        // The processor never does HEVC live.
        e.family = Family::Software;
        assert!(has(&video_args(&e), ["-c:v", "libx264"]));
        assert_eq!(decode_args(Family::Qsv), ["-hwaccel", "auto"]);
        assert!(decode_args(Family::Software).is_empty());
    }

    #[test]
    fn encoder_failures_are_told_apart_from_network_ones() {
        assert!(encoder_failed(
            "[h264_nvenc @ 0x1] Cannot load libcuda.so.1\nError while opening encoder for output stream #0:0"
        ));
        assert!(encoder_failed(
            "[h264_nvenc @ 0x1] OpenEncodeSessionEx failed: out of memory (10)"
        ));
        assert!(encoder_failed(
            "[h264_qsv @ 0x1] Error initializing an internal MFX session: unsupported (-3)"
        ));
        assert!(encoder_failed("[h264_amf @ 0x1] AMF failed to initialise"));
        assert!(encoder_failed(
            "Error submitting video frame to the encoder"
        ));
        assert!(!encoder_failed(
            "[tcp @ 0x1] Connection to tcp://x:1935 failed: Connection refused"
        ));
        assert!(!encoder_failed(
            "[flv @ 0x1] Failed to update header with correct duration."
        ));
    }

    #[test]
    fn a_dropped_destination_is_found_in_the_tee_message() {
        assert_eq!(
            dropped_output(
                "[tee @ 0x55] Slave muxer #1 failed: Broken pipe, continuing with 1/2 slaves."
            ),
            Some(1)
        );
        assert_eq!(
            dropped_output("[tee @ 0x55] Slave '...': error writing frame"),
            None
        );
        assert_eq!(dropped_output("anything else"), None);
    }

    #[test]
    fn destinations_with_the_same_bitrate_share_an_encode() {
        let d = |n: &str, k: Option<u32>| (n.to_owned(), format!("rtmp://{n}"), k);
        let g = group_by_bitrate(
            &[
                d("YouTube", None),
                d("Facebook", Some(4000)),
                d("Vimeo", Some(6000)),
                d("Church", Some(0)),
            ],
            6000,
        );
        assert_eq!(g.len(), 2);
        assert_eq!(g[0].kbps, 6000);
        assert_eq!(g[0].names, ["YouTube", "Vimeo", "Church"]);
        assert_eq!(g[1].kbps, 4000);
        assert_eq!(g[1].targets, ["rtmp://Facebook"]);
    }

    #[test]
    fn the_webview_encode_goes_out_as_it_is_only_when_nothing_needs_ffmpeg() {
        let plain = StreamNeed {
            input_h264: true,
            resized: false,
            own_bitrate: false,
        };
        assert!(!must_encode(plain, Family::Software, EncoderChoice::Auto));
        assert!(must_encode(
            plain,
            Family::Software,
            EncoderChoice::Software
        ));
        assert!(must_encode(plain, Family::Nvenc, EncoderChoice::Auto));
        let vp8 = StreamNeed {
            input_h264: false,
            ..plain
        };
        assert!(must_encode(vp8, Family::Software, EncoderChoice::Auto));
        let smaller = StreamNeed {
            resized: true,
            ..plain
        };
        assert!(must_encode(smaller, Family::Software, EncoderChoice::Auto));
        assert_eq!(source_kbps(6000, 25_000), 37_500);
        assert_eq!(source_kbps(6000, 6000), 12_000);
        assert_eq!(source_kbps(60_000, 25_000), 80_000);
    }
}
