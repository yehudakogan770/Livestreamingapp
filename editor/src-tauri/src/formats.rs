//! What to do with each kind of file so it edits smoothly: which files the
//! editor's own video decoder can't show (ProRes, DNxHR, 10-bit, 4:2:2, HDR,
//! interlaced, variable frame rate…) and get an edit-friendly copy; which are
//! heavy enough to want a lighter playback proxy; and how FFmpeg reads the
//! original when the film is made from a file the editor can't decode.

use serde::Serialize;
use std::ffi::OsString;
use std::path::Path;

use crate::media::{bit_depth, needs, Needs, Probe};

/// What the editor decodes itself (8-bit 4:2:0 only).
const DECODES: [&str; 4] = ["h264", "vp8", "vp9", "av1"];

/// Frame rates cameras record at.
const STANDARD_RATES: [f64; 15] = [
    23.976, 24.0, 25.0, 29.97, 30.0, 47.952, 48.0, 50.0, 59.94, 60.0, 90.0, 100.0, 119.88, 120.0,
    240.0,
];

fn near(a: f64, b: f64, within: f64) -> bool {
    (a - b).abs() <= within
}

/// A frame rate cameras use.
#[must_use]
pub fn standard_rate(fps: f64) -> bool {
    STANDARD_RATES.iter().any(|&r| near(fps, r, 0.006))
}

/// The standard rate nearest a frame rate.
#[must_use]
pub fn nearest_rate(fps: f64) -> f64 {
    STANDARD_RATES
        .iter()
        .copied()
        .min_by(|a, b| (a - fps).abs().total_cmp(&(b - fps).abs()))
        .unwrap_or(30.0)
}

/// The frame rate changes through the file (phones record like this): the
/// average rate and the rate the timestamps suggest disagree (and not because
/// of interlaced fields, where one is twice the other).
#[must_use]
pub fn variable_rate(p: &Probe) -> bool {
    if p.fps <= 0.0 || p.tbr <= 0.0 || p.tbr >= 1000.0 {
        return false;
    }
    !near(p.fps, p.tbr, 0.006) && !near(p.tbr, p.fps * 2.0, 0.05) && !near(p.fps, p.tbr * 2.0, 0.05)
}

/// What Lumora Studio does with a file.
#[derive(Serialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Plan {
    /// The picture's codec (or the sound's, for a sound file).
    pub codec: String,
    pub bit_depth: u32,
    pub hdr: bool,
    pub rotation: i32,
    pub vfr: bool,
    pub bitrate_kbps: u32,
    /// Heavy to play: a lighter playback proxy is made in the background.
    pub heavy: bool,
    /// `ffmpeg`: the editor can't decode the original, so the film reads it through FFmpeg.
    pub export_via: &'static str,
    /// What was done, for the person editing.
    pub note: Option<String>,
    #[serde(skip)]
    pub need: Needs,
    #[serde(skip)]
    pub tone_map: bool,
    #[serde(skip)]
    pub deinterlace: bool,
    /// Made constant at this rate (variable frame rate files).
    #[serde(skip)]
    pub cfr: Option<f64>,
}

/// The editor's own decoder shows this picture as it is.
#[must_use]
pub fn decodable(p: &Probe) -> bool {
    let codec = p.video.as_deref().unwrap_or("");
    let fmt = p.pix_fmt.as_str();
    let four_two_zero = fmt.is_empty()
        || fmt.starts_with("yuv420p")
        || fmt.starts_with("yuvj420p")
        || fmt == "nv12";
    DECODES.contains(&codec)
        && bit_depth(fmt) == 8
        && four_two_zero
        && !p.hdr
        && !p.dolby_vision
        && !p.interlaced
}

/// Decide what a file needs (from what FFmpeg says about it).
#[must_use]
pub fn plan(file: &Path, p: &Probe) -> Plan {
    let base = needs(file, p);
    let ext = file
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    let picture = matches!(
        ext.as_str(),
        "png" | "jpg" | "jpeg" | "webp" | "gif" | "bmp" | "avif"
    );
    let video = p.video.is_some()
        && !p.still
        && !picture
        && matches!(base, Needs::Nothing | Needs::Rewrap | Needs::Optimize);
    let hdr = p.hdr || p.dolby_vision;
    let vfr = video && variable_rate(p);
    let mut need = base;
    if video && (!decodable(p) || vfr) {
        need = Needs::Optimize;
    }
    let pixels = u64::from(p.width) * u64::from(p.height);
    let codec = p
        .video
        .clone()
        .filter(|_| video)
        .or_else(|| p.audio_codec.clone())
        .unwrap_or_default();
    // What plays while editing: the original, or an H.264 copy the same size.
    let heavy = video
        && (pixels >= 3_500_000
            || (p.fps > 61.0 && pixels >= 2_000_000)
            || (need != Needs::Optimize && (p.bitrate_kbps > 60_000 || codec == "hevc")));
    let mut notes = Vec::new();
    if video && hdr {
        notes.push(if p.dolby_vision {
            "Dolby Vision HDR: shown tone-mapped to SDR (Rec. 709) while editing and in the film."
        } else {
            "HDR: shown tone-mapped to SDR (Rec. 709) while editing and in the film."
        });
    }
    let cfr = vfr.then(|| {
        if standard_rate(p.tbr) {
            p.tbr
        } else {
            nearest_rate(p.fps)
        }
    });
    let cfr_note = cfr.map(|r| {
        format!(
            "Variable frame rate: made constant at {} fps for editing.",
            trim_rate(r)
        )
    });
    if video && p.interlaced {
        notes.push("Interlaced: deinterlaced for editing and for the film.");
    }
    let mut note: Vec<String> = notes.into_iter().map(str::to_owned).collect();
    if let Some(n) = cfr_note {
        note.push(n);
    }
    Plan {
        codec,
        bit_depth: if video { bit_depth(&p.pix_fmt) } else { 0 },
        hdr: video && hdr,
        rotation: p.rotation,
        vfr,
        bitrate_kbps: p.bitrate_kbps,
        heavy,
        export_via: if video && !decodable(p) {
            "ffmpeg"
        } else {
            "original"
        },
        note: (!note.is_empty()).then(|| note.join(" ")),
        need,
        tone_map: video && hdr,
        deinterlace: video && p.interlaced,
        cfr,
    }
}

fn trim_rate(r: f64) -> String {
    let s = format!("{r:.3}");
    s.trim_end_matches('0').trim_end_matches('.').to_owned()
}

/// HDR (PQ, HLG) to SDR Rec. 709.
pub const TONE_MAP: &str =
    "zscale=t=linear:npl=100,format=gbrpf32le,zscale=p=bt709,tonemap=tonemap=hable:desat=0,zscale=t=bt709:m=bt709:r=tv";

/// The picture filters a plan asks for (FFmpeg turns the picture upright by itself).
#[must_use]
pub fn video_filters(plan: &Plan, tone_map: bool) -> Vec<String> {
    let mut f = Vec::new();
    if plan.deinterlace {
        f.push("bwdif=mode=send_frame:parity=auto:deint=all".to_owned());
    }
    if tone_map && plan.tone_map {
        f.push(TONE_MAP.to_owned());
    }
    f
}

/// What kind of copy to make.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CopyKind {
    /// Full size and quality, for editing a file the editor can't decode (short GOP for quick jumps).
    Intermediate,
    /// Lighter (at most 1080 high), for smooth playback of heavy files.
    Proxy,
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
    let mut vf = video_filters(plan, tone_map);
    if kind == CopyKind::Proxy {
        vf.push("scale=-2:'min(1080,ih)':flags=bicubic".to_owned());
    }
    vf.push("format=yuv420p".to_owned());
    let (crf, preset, gop) = match kind {
        CopyKind::Intermediate => ("16", "veryfast", "15"),
        CopyKind::Proxy => ("22", "veryfast", "12"),
    };
    let mut a: Vec<OsString> = vec![
        "-i".into(),
        file.into(),
        "-map".into(),
        "0:v:0".into(),
        "-map".into(),
        "0:a?".into(),
    ];
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
        [
            "-c:v",
            "libx264",
            "-preset",
            preset,
            "-crf",
            crf,
            "-g",
            gop,
            "-bf",
            "0",
            "-tune",
            "fastdecode",
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
    // A copy carries no turn of its own (the pictures are already upright).
    a.extend(["-metadata:s:v:0".into(), "rotate=0".into()]);
    a.push(out.into());
    a
}

/// FFmpeg's arguments to hand over a file's frames (RGBA, `width`×`height`,
/// `rate` frames a second from `from` seconds), for making the film from an
/// original the editor can't decode.
#[must_use]
pub fn reader_args(
    file: &Path,
    plan: &Plan,
    from: f64,
    rate: f64,
    width: u32,
    height: u32,
    tone_map: bool,
) -> Vec<OsString> {
    let mut vf = video_filters(plan, tone_map);
    vf.push(format!("fps={rate:.6}"));
    vf.push(format!("scale={width}:{height}:flags=bicubic"));
    vf.push("format=rgba".to_owned());
    let mut a: Vec<OsString> = vec![
        "-hide_banner".into(),
        "-nostdin".into(),
        "-loglevel".into(),
        "error".into(),
    ];
    if from > 0.0 {
        a.extend(["-ss".into(), format!("{from:.6}").into()]);
    }
    a.extend([
        "-i".into(),
        file.into(),
        "-map".into(),
        "0:v:0".into(),
        "-an".into(),
        "-vf".into(),
        vf.join(",").into(),
    ]);
    a.extend(["-f", "rawvideo", "-pix_fmt", "rgba", "pipe:1"].map(OsString::from));
    a
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::media::parse_probe;

    fn probe(stream: &str, extra: &str) -> Probe {
        parse_probe(&format!("  Duration: 00:00:10.00, start: 0.000000, bitrate: 20000 kb/s\n  Stream #0:0[0x1](und): Video: {stream}\n{extra}  Stream #0:1: Audio: aac (LC), 48000 Hz, stereo, fltp, 192 kb/s"))
    }

    const IPHONE_HDR: &str = "hevc (Main 10) (hvc1 / 0x31637668), yuv420p10le(tv, bt2020nc/bt2020/arib-std-b67), 1920x1080, 15646 kb/s, 29.98 fps, 30 tbr, 600 tbn (default)";

    #[test]
    fn reads_the_details() {
        let p = probe(IPHONE_HDR, "      Side data:\n        DOVI configuration record: version: 1.0, profile: 8, level: 4\n        displaymatrix: rotation of -90.00 degrees\n");
        assert_eq!(p.video.as_deref(), Some("hevc"));
        assert_eq!(p.pix_fmt, "yuv420p10le");
        assert_eq!(bit_depth(&p.pix_fmt), 10);
        assert!(p.hdr && p.dolby_vision);
        assert_eq!(p.rotation, 90);
        assert_eq!((p.width, p.height), (1920, 1080));
        assert!((p.tbr - 30.0).abs() < 1e-9);
        assert_eq!(p.bitrate_kbps, 20000);
        let old = probe(
            "h264 (High), yuv420p, 1920x1080, 29.97 fps, 29.97 tbr",
            "    Metadata:\n      rotate          : 270\n",
        );
        assert_eq!(old.rotation, 270);
        let tv = probe("h264 (High), yuv420p(top first), 1920x1080 [SAR 1:1 DAR 16:9], 25 fps, 50 tbr, 90k tbn", "");
        assert!(tv.interlaced);
    }

    #[test]
    fn iphone_hdr_gets_a_tone_mapped_constant_rate_copy() {
        let p = probe(
            IPHONE_HDR,
            "        DOVI configuration record: version: 1.0\n",
        );
        let plan = plan(Path::new("IMG_0001.MOV"), &p);
        assert_eq!(plan.need, Needs::Optimize);
        assert!(plan.tone_map && plan.hdr && plan.vfr);
        assert_eq!(plan.cfr, Some(30.0));
        assert_eq!(plan.export_via, "ffmpeg");
        let note = plan.note.clone().unwrap_or_default();
        assert!(
            note.contains("Dolby Vision") && note.contains("30 fps"),
            "{note}"
        );
        let args: Vec<String> = copy_args(
            Path::new("in.mov"),
            Path::new("out.mp4"),
            &plan,
            CopyKind::Intermediate,
            true,
        )
        .iter()
        .map(|a| a.to_string_lossy().into_owned())
        .collect();
        let vf = &args[args.iter().position(|a| a == "-vf").unwrap() + 1];
        assert!(
            vf.contains("tonemap") && vf.ends_with("format=yuv420p"),
            "{vf}"
        );
        assert!(args.windows(2).any(|w| w[0] == "-r" && w[1] == "30"));
        assert!(args
            .windows(2)
            .any(|w| w[0] == "-fps_mode" && w[1] == "cfr"));
    }

    #[test]
    fn camera_codecs_get_copies_and_export_through_ffmpeg() {
        for (stream, file) in [
            ("prores (HQ) (apch / 0x68637061), yuv422p10le(tv, bt709, progressive), 3840x2160, 737711 kb/s, 23.98 fps, 23.98 tbr, 24k tbn", "a.mov"),
            ("dnxhd (DNXHR HQX), yuv422p10le(tv, bt709/unknown/unknown), 3840x2160, 23.98 fps, 23.98 tbr", "a.mxf"),
            ("h264 (High 10), yuv420p10le(tv, bt709, progressive), 3840x2160, 25 fps, 25 tbr", "a.mp4"),
            ("h264 (High 4:2:2), yuv422p(tv, bt709, top first), 1920x1080, 29.97 fps, 59.94 tbr", "a.mts"),
            ("wmv3 (Main) (WMV3 / 0x33564D57), yuv420p, 1280x720, 30 fps, 30 tbr", "a.wmv"),
            ("mpeg4 (Simple Profile) (XVID / 0x44495658), yuv420p, 640x480, 25 fps, 25 tbr", "a.avi"),
        ] {
            let plan = plan(Path::new(file), &probe(stream, ""));
            assert_eq!(plan.need, Needs::Optimize, "{stream}");
            assert_eq!(plan.export_via, "ffmpeg", "{stream}");
        }
    }

    #[test]
    fn interlaced_avchd_is_deinterlaced() {
        let plan = plan(
            Path::new("00001.MTS"),
            &probe("h264 (High) (HDPR / 0x52504448), yuv420p(top first), 1920x1080 [SAR 1:1 DAR 16:9], 29.97 fps, 59.94 tbr, 90k tbn", ""),
        );
        assert_eq!(plan.need, Needs::Optimize);
        assert!(plan.deinterlace && !plan.vfr);
        assert!(video_filters(&plan, true)[0].starts_with("bwdif"));
    }

    #[test]
    fn ordinary_files_play_as_they_are() {
        let hd = plan(Path::new("a.mp4"), &probe("h264 (High) (avc1 / 0x31637661), yuv420p(tv, bt709, progressive), 1920x1080, 8000 kb/s, 29.97 fps, 29.97 tbr", ""));
        assert_eq!(hd.need, Needs::Nothing);
        assert!(!hd.heavy && !hd.vfr && hd.note.is_none());
        assert_eq!(hd.export_via, "original");
        // An odd but steady rate is left alone.
        let fifteen = plan(
            Path::new("a.mp4"),
            &probe("h264 (High), yuv420p, 640x480, 15 fps, 15 tbr", ""),
        );
        assert_eq!(fifteen.need, Needs::Nothing);
        assert!(!fifteen.vfr);
        // MKV with H.264 is only rewrapped.
        let mkv = plan(
            Path::new("a.mkv"),
            &probe(
                "h264 (High), yuv420p(progressive), 1920x1080, 25 fps, 25 tbr",
                "",
            ),
        );
        assert_eq!(mkv.need, Needs::Rewrap);
    }

    #[test]
    fn heavy_files_get_playback_proxies() {
        let uhd = plan(
            Path::new("a.mp4"),
            &probe(
                "h264 (High), yuv420p, 3840x2160, 100000 kb/s, 29.97 fps, 29.97 tbr",
                "",
            ),
        );
        assert!(uhd.heavy);
        assert_eq!(uhd.export_via, "original");
        let fast = plan(
            Path::new("a.mp4"),
            &probe("h264 (High), yuv420p, 1920x1080, 120 fps, 120 tbr", ""),
        );
        assert!(fast.heavy);
        let dense = plan(
            Path::new("a.mp4"),
            &parse_probe("  Duration: 00:00:10.00, start: 0.0, bitrate: 90000 kb/s\n  Stream #0:0: Video: h264 (High), yuv420p, 1920x1080, 25 fps, 25 tbr"),
        );
        assert!(dense.heavy);
        let small_prores = plan(
            Path::new("a.mov"),
            &probe("prores (LT), yuv422p10le, 1280x720, 25 fps, 25 tbr", ""),
        );
        assert!(!small_prores.heavy, "its H.264 copy plays easily");
        let args: Vec<String> = copy_args(
            Path::new("a.mp4"),
            Path::new("p.mp4"),
            &uhd,
            CopyKind::Proxy,
            true,
        )
        .iter()
        .map(|a| a.to_string_lossy().into_owned())
        .collect();
        assert!(args.iter().any(|a| a.contains("min(1080,ih)")));
    }

    #[test]
    fn sound_files() {
        let flac = Probe {
            audio: true,
            audio_codec: Some("flac".into()),
            ..Probe::default()
        };
        assert_eq!(plan(Path::new("a.flac"), &flac).need, Needs::Nothing);
        for (ext, codec) in [
            ("aiff", "pcm_s16be"),
            ("aif", "pcm_s24be"),
            ("wma", "wmav2"),
        ] {
            let p = Probe {
                audio: true,
                audio_codec: Some(codec.into()),
                ..Probe::default()
            };
            let plan = plan(Path::new(&format!("a.{ext}")), &p);
            assert_eq!(plan.need, Needs::Sound, "{ext}");
            assert!(!plan.heavy);
        }
    }

    #[test]
    fn frame_rates() {
        assert!(standard_rate(29.97) && standard_rate(23.976) && !standard_rate(29.98));
        assert!((nearest_rate(29.83) - 29.97).abs() < 1e-9);
        let mut p = Probe {
            fps: 29.83,
            tbr: 30.0,
            ..Probe::default()
        };
        assert!(variable_rate(&p));
        p.tbr = 59.66;
        assert!(!variable_rate(&p), "fields, not a changing rate");
    }

    #[test]
    fn reading_frames_for_the_film() {
        let plan = plan(
            Path::new("a.mov"),
            &probe(
                "prores (HQ), yuv422p10le, 3840x2160, 23.98 fps, 23.98 tbr",
                "",
            ),
        );
        let args: Vec<String> =
            reader_args(Path::new("a.mov"), &plan, 12.5, 24.0, 1920, 1080, true)
                .iter()
                .map(|a| a.to_string_lossy().into_owned())
                .collect();
        assert!(args
            .windows(2)
            .any(|w| w[0] == "-ss" && w[1] == "12.500000"));
        let vf = &args[args.iter().position(|a| a == "-vf").unwrap() + 1];
        assert!(
            vf.contains("fps=24.000000")
                && vf.contains("scale=1920:1080")
                && vf.ends_with("format=rgba"),
            "{vf}"
        );
        assert_eq!(args.last().map(String::as_str), Some("pipe:1"));
    }
}
