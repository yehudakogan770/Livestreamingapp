import re
root='/home/user/Livestreamingapp/.claude/worktrees/agent-a53b9f061dc9b1bdf/'
def edit(p, pairs):
    s=open(root+p).read()
    for a,b in pairs:
        assert a in s, (p, a[:60])
        s=s.replace(a,b,1)
    open(root+p,'w').write(s)

edit('editor/src-tauri/src/media.rs', [
("""    /// HDR: PQ (smpte2084) or HLG (arib-std-b67) transfer.
    pub hdr: bool,""","""    /// HDR: PQ (smpte2084) or HLG (arib-std-b67) transfer.
    pub hdr: bool,
    /// HLG (arib-std-b67) rather than PQ.
    pub hlg: bool,"""),
("""                    p.hdr = rest.contains("smpte2084") || rest.contains("arib-std-b67");""","""                    p.hdr = rest.contains("smpte2084") || rest.contains("arib-std-b67");
                    p.hlg = rest.contains("arib-std-b67");"""),
])

edit('editor/src-tauri/src/formats.rs', [
("""    pub bit_depth: u32,
    pub hdr: bool,
    pub rotation: i32,""","""    pub bit_depth: u32,
    pub hdr: bool,
    /// How brightness is coded: "sdr" (Rec. 709), "pq" (HDR10, Dolby Vision) or "hlg".
    pub transfer: &'static str,
    pub rotation: i32,"""),
("""        hdr: video && hdr,
        rotation: p.rotation,""","""        hdr: video && hdr,
        transfer: if !(video && hdr) {
            "sdr"
        } else if p.hlg {
            "hlg"
        } else {
            "pq"
        },
        rotation: p.rotation,"""),
("""#[cfg(test)]
mod tests {
    use super::*;
    use crate::media::parse_probe;
""","""/// Frames read for an HDR film: the signal kept as it is (no tone mapping;
/// PQ, HLG or SDR coding and the file's colors), 16 bits a channel (RGBA64),
/// so the editor turns it into the film's color space itself.
#[must_use]
pub fn reader_args_deep(file: &Path, plan: &Plan, from: f64, rate: f64, (width, height): (u32, u32), decode: &[OsString]) -> Vec<OsString> {
    let mut vf = video_filters(plan, false);
    vf.push(format!("fps={rate:.6}"));
    // The file's own YUV coefficients (Rec. 2020 for HDR), full range out.
    let matrix = if plan.hdr { "bt2020" } else { "bt709" };
    vf.push(format!(
        "scale={width}:{height}:flags=bicubic:in_color_matrix={matrix}:out_range=full"
    ));
    vf.push("format=rgba64le".to_owned());
    let mut a: Vec<OsString> = vec![
        "-hide_banner".into(),
        "-nostdin".into(),
        "-loglevel".into(),
        "error".into(),
    ];
    if from > 0.0 {
        a.extend(["-ss".into(), format!("{from:.6}").into()]);
    }
    a.extend(decode.iter().cloned());
    a.extend([
        "-i".into(),
        file.into(),
        "-map".into(),
        "0:v:0".into(),
        "-an".into(),
        "-vf".into(),
        vf.join(",").into(),
    ]);
    a.extend(["-f", "rawvideo", "-pix_fmt", "rgba64le", "pipe:1"].map(OsString::from));
    a
}

/// A copy of an HDR file for watching while editing an HDR sequence: its
/// signal (PQ or HLG code values, Rec. 2020 colors) kept as it is in an
/// 8-bit H.264 file labeled Rec. 709, so the editor's video player hands the
/// code values over untouched and the editor shows them tone-mapped itself.
#[must_use]
pub fn signal_copy_args(file: &Path, plan: &Plan, out: &Path) -> Vec<OsString> {
    let mut vf = video_filters(plan, false);
    vf.push("scale=-2:'min(1080,ih)':flags=bicubic:in_color_matrix=bt2020:out_color_matrix=bt709:in_range=auto:out_range=tv".to_owned());
    vf.push("format=yuv420p".to_owned());
    let mut a: Vec<OsString> = vec!["-i".into(), file.into(), "-map".into(), "0:v:0".into(), "-an".into(), "-vf".into(), vf.join(",").into()];
    a.extend(
        [
            "-c:v", "libx264", "-preset", "veryfast", "-crf", "16", "-g", "30", "-color_primaries", "bt709", "-color_trc", "bt709", "-colorspace",
            "bt709", "-movflags", "+faststart",
        ]
        .map(OsString::from),
    );
    a.push(out.into());
    a
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::media::parse_probe;

    #[test]
    fn hdr_files_say_how_brightness_is_coded_and_can_be_read_deep() {
        let p = probe(IPHONE_HDR, "");
        let plan = plan(Path::new("a.mov"), &p);
        assert_eq!(plan.transfer, "hlg");
        let sdr = plan(Path::new("b.mp4"), &probe("h264 (High), yuv420p, 1920x1080, 30 fps, 30 tbr", ""));
        assert_eq!(sdr.transfer, "sdr");
        let a = reader_args_deep(Path::new("a.mov"), &plan, 1.0, 30.0, (1920, 1080), &[]);
        let text: Vec<String> = a.iter().map(|x| x.to_string_lossy().into_owned()).collect();
        assert!(text.iter().any(|x| x.contains("in_color_matrix=bt2020") && !x.contains("tonemap")));
        assert!(text.windows(2).any(|w| w[0] == "-pix_fmt" && w[1] == "rgba64le"));
        let c = signal_copy_args(Path::new("a.mov"), &plan, Path::new("o.mp4"));
        let text: Vec<String> = c.iter().map(|x| x.to_string_lossy().into_owned()).collect();
        assert!(text.iter().any(|x| x.contains("out_color_matrix=bt709") && !x.contains("tonemap")));
        assert!(text.windows(2).any(|w| w[0] == "-color_trc" && w[1] == "bt709"));
    }
"""),
])
