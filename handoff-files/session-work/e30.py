W='/home/user/Livestreamingapp/.claude/worktrees/agent-aefea299a26a1206e/'
def edit(path, pairs):
    p=W+path
    s=open(p).read()
    for a,b in pairs:
        assert s.count(a)==1, (path, a, s.count(a))
        s=s.replace(a,b)
    open(p,'w').write(s)
enc=open('/tmp/claude-0/-home-user-Livestreamingapp/afbb1772-1200-52da-905a-12b6de33f858/scratchpad/encoded.rs').read()
edit('crates/live-engine/src/source.rs', [
("""/// A source that never has a picture, with a reason""", enc + """/// A source that never has a picture, with a reason"""),
("""#[cfg(test)]
mod tests {
    use super::*;
""","""#[cfg(test)]
mod tests {
    use super::*;

    /// A frame store with one picture of input "p".
    struct OnePicture(Vec<u8>, &'static str);
    impl EncodedFrames for OnePicture {
        fn next(&self, id: &str, after: u64, wait: Duration) -> Option<(u64, Arc<Vec<u8>>, &'static str)> {
            if id == "p" && after == 0 {
                return Some((1, Arc::new(self.0.clone()), self.1));
            }
            thread::sleep(wait.min(Duration::from_millis(20)));
            None
        }
    }

    fn png_of(w: u32, h: u32, rgba: [u8; 4]) -> Vec<u8> {
        let mut out = Vec::new();
        {
            let mut e = png::Encoder::new(&mut out, w, h);
            e.set_color(png::ColorType::Rgba);
            e.set_depth(png::BitDepth::Eight);
            let mut wr = e.write_header().unwrap();
            let data: Vec<u8> = (0..w * h).flat_map(|_| rgba).collect();
            wr.write_image_data(&data).unwrap();
        }
        out
    }

    #[test]
    fn pictures_from_the_app_are_decoded_jpeg_or_png() {
        let pool = FramePool::new(2);
        // A see-through web page (PNG) keeps its alpha.
        let f = decode_picture(&png_of(4, 2, [10, 20, 30, 128]), "image/png", &pool, 7).expect("png");
        assert_eq!((f.width, f.height, f.seq, f.format), (4, 2, 7, PixelFormat::Rgba8));
        assert_eq!(&f.data.as_slice()[..4], &[10, 20, 30, 128]);
        // A JPEG (a stream's picture), made by the app's own encoder.
        let mut jpeg = Vec::new();
        let px: Vec<u8> = (0..16 * 8).flat_map(|_| [200u8, 40, 40, 255]).collect();
        jpeg_encoder::Encoder::new(&mut jpeg, 95)
            .encode(&px, 16, 8, jpeg_encoder::ColorType::Rgba)
            .unwrap();
        let f = decode_picture(&jpeg, "image/jpeg", &pool, 1).expect("jpeg");
        assert_eq!((f.width, f.height), (16, 8));
        let p = &f.data.as_slice()[..4];
        assert!(p[0].abs_diff(200) < 8 && p[1].abs_diff(40) < 8 && p[3] == 255, "{p:?}");
        // Not a picture: nothing.
        assert!(decode_picture(&[1, 2, 3], "image/jpeg", &pool, 2).is_none());
    }

    #[test]
    fn an_input_from_the_app_goes_live_with_its_pictures() {
        let src = EncodedSource::start("p", Arc::new(OnePicture(png_of(3, 3, [1, 2, 3, 255]), "image/png")));
        let t = Instant::now();
        while src.latest().is_none() && t.elapsed() < Duration::from_secs(5) {
            thread::sleep(Duration::from_millis(10));
        }
        let f = src.latest().expect("a picture");
        assert_eq!((f.width, f.height), (3, 3));
        assert_eq!(src.health().state, SourceState::Live);
        // Another input's pictures never arrive: it is still starting.
        let other = EncodedSource::start("q", Arc::new(OnePicture(Vec::new(), "image/png")));
        thread::sleep(Duration::from_millis(50));
        assert_eq!(other.health().state, SourceState::Starting);
    }
"""),
])
edit('crates/live-engine/Cargo.toml', [
("""[[bin]]""","""[dev-dependencies]
jpeg-encoder = "0.7"

[[bin]]"""),
])
edit('crates/live-engine/src/engine.rs', [
("""use crate::source::{FfmpegFile, SourceHealth, TestPattern, Unavailable, VideoSource};""","""use crate::source::{
    EncodedFrames, EncodedSource, FfmpegFile, SourceHealth, TestPattern, Unavailable, VideoSource,
};"""),
("""    /// Where a show's media path is on disk.
    pub resolve: Box<dyn Fn(&str) -> PathBuf + Send>,
    seed: usize,
}""","""    /// Where a show's media path is on disk.
    pub resolve: Box<dyn Fn(&str) -> PathBuf + Send>,
    /// The app's store of stream, web page, screen-capture and guest pictures.
    pub pictures: Option<Arc<dyn EncodedFrames>>,
    seed: usize,
}"""),
("""            resolve: Box::new(|p: &str| PathBuf::from(p)),
            seed: 0,""","""            resolve: Box::new(|p: &str| PathBuf::from(p)),
            pictures: None,
            seed: 0,"""),
("""            SourceKind::Pattern => "pattern".into(),
            other => format!("other:{}", kind_name(other)),""","""            SourceKind::Pattern => "pattern".into(),
            // Their pictures come from the app's frame store by input: one source each.
            other => format!("pictures:{}", kind_name(other)),"""),
("""            other => Box::new(Unavailable::new(format!(
                "{} inputs are not in the unified engine yet (Phase 2).",
                kind_name(other)
            ))),""","""            SourceKind::Stream(_)
            | SourceKind::Screen(_)
            | SourceKind::Guest(_)
            | SourceKind::Browser(_) => match &self.pictures {
                Some(p) => Box::new(EncodedSource::start(src.id.as_str(), Arc::clone(p))),
                None => Box::new(Unavailable::new(format!(
                    "{} inputs need the app's picture server.",
                    kind_name(&src.kind)
                ))),
            },
            other => Box::new(Unavailable::new(format!(
                "{} inputs are not in the unified engine yet.",
                kind_name(other)
            ))),"""),
])
