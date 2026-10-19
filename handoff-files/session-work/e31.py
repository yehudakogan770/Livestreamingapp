W='/home/user/Livestreamingapp/.claude/worktrees/agent-aefea299a26a1206e/'
def edit(path, pairs):
    p=W+path
    s=open(p).read()
    for a,b in pairs:
        assert s.count(a)==1, (path, a, s.count(a))
        s=s.replace(a,b)
    open(p,'w').write(s)

edit('src-tauri/src/live.rs', [
("""pub struct Live {
    file: PathBuf,
    ffmpeg: Option<PathBuf>,""","""pub struct Live {
    file: PathBuf,
    ffmpeg: Option<PathBuf>,
    /// Stream, web page, screen-capture and guest inputs' pictures (`browser.rs`'s store).
    pictures: Option<Arc<dyn live_engine::source::EncodedFrames>>,"""),
("""    pub fn new(dir: &Path, ffmpeg: Option<PathBuf>) -> Self {""","""    pub fn new(
        dir: &Path,
        ffmpeg: Option<PathBuf>,
        pictures: Option<Arc<dyn live_engine::source::EncodedFrames>>,
    ) -> Self {"""),
("""        Live {
            file,
            ffmpeg,""","""        Live {
            file,
            ffmpeg,
            pictures,"""),
("""        let factory = DefaultFactory::new(self.ffmpeg.clone(), fake);""","""        let mut factory = DefaultFactory::new(self.ffmpeg.clone(), fake);
        factory.pictures = self.pictures.clone();"""),
])
edit('src-tauri/src/lib.rs', [
("""            app.manage(live::Live::new(&dir, ffmpeg.clone()));""","""            app.manage(live::Live::new(
                &dir,
                ffmpeg.clone(),
                Some(std::sync::Arc::clone(&browsers.frames) as _),
            ));"""),
])
edit('src-tauri/src/browser.rs', [
("""/// Live sound (raw 48 kHz stereo 16-bit) from stream inputs, handed to""","""/// The unified engine takes stream, web page, screen-capture and guest
/// inputs' pictures straight from here (no HTTP), decoding them itself.
impl live_engine::source::EncodedFrames for Frames {
    fn next(&self, id: &str, after: u64, wait: Duration) -> Option<(u64, Arc<Vec<u8>>, &'static str)> {
        Frames::next(self, id, after, wait).map(|f| (f.n, f.bytes, f.mime))
    }
}

/// Live sound (raw 48 kHz stereo 16-bit) from stream inputs, handed to"""),
])
