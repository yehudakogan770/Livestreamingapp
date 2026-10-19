W='/home/user/Livestreamingapp/.claude/worktrees/agent-aefea299a26a1206e/'
p=W+'src-tauri/src/live.rs'
s=open(p).read()
def rep(a,b,cnt=1):
    global s
    assert s.count(a)==cnt, (a, s.count(a))
    s=s.replace(a,b)
a=s.index('/// Record `seconds` of the Live Screen through the engine')
s=s[:a]+open('/tmp/claude-0/-home-user-Livestreamingapp/afbb1772-1200-52da-905a-12b6de33f858/scratchpad/live_capture.rs').read()
rep('''use live_engine::engine::{Config, DefaultFactory, Runner, Stats};''','''use live_engine::audio::AudioBus;
use live_engine::encoder::{EncoderFeed, FeedArgs, PcmChunk};
use live_engine::engine::{Config, DefaultFactory, Runner, Stats};
use live_engine::feeds::{FeedSource, FeedSpec, MakeFeed};''')
rep('''//! - "Test the engine's recording" sends ten seconds of the Live Screen
//!   through the engine's encoder feed into the normal recording code.''','''//! - recordings and streams are encoded from the engine's own picture of the
//!   Live Screen, with the control window's sound mix sent here as PCM
//!   (`live_engine_capture_start`, `live_engine_audio`): the control window
//!   opens no camera for them; each camera's ISO file comes from the
//!   engine's frames of it;
//! - "Test the engine's recording" sends ten seconds of the Live Screen
//!   through the engine's encoder feed into the normal recording code.''')
rep('''    /// Screens shown in the engine's own windows.
    native: Vec<ScreenId>,
}''','''    /// Screens shown in the engine's own windows.
    native: Vec<ScreenId>,
    /// Recordings and streams the engine encodes, with their ISO files.
    captures: std::collections::HashMap<u64, Vec<u64>>,
}''')
rep('''pub struct Live {
    file: PathBuf,
    ffmpeg: Option<PathBuf>,
    inner: Mutex<Inner>,
}''','''pub struct Live {
    file: PathBuf,
    ffmpeg: Option<PathBuf>,
    inner: Mutex<Inner>,
    /// The control window's sound mixes, to the engine's encoders.
    audio: Arc<AudioBus>,
}''')
rep('''            inner: Mutex::new(Inner {
                mode: saved.mode,
                ..Inner::default()
            }),
        }''','''            inner: Mutex::new(Inner {
                mode: saved.mode,
                ..Inner::default()
            }),
            audio: Arc::default(),
        }''')
open(p,'w').write(s)
p=W+'src-tauri/src/capture.rs'
s=open(p).read()
rep('''impl Running {
    fn new(''','''impl CaptureStatus {
    /// The running session `session`, whichever kind it is.
    pub fn running_session(&self, session: u64) -> Option<Running> {
        [&self.recording, &self.streaming, &self.vertical, &self.ndi]
            .into_iter()
            .flatten()
            .find(|r| r.session == session)
            .cloned()
    }
}

impl Running {
    fn new(''')
open(p,'w').write(s)
p=W+'src-tauri/src/lib.rs'
s=open(p).read()
rep('''            live::live_engine_graphics
''','''            live::live_engine_graphics,
            live::live_engine_audio,
            live::live_engine_audio_wanted,
            live::live_engine_capture_start,
            live::live_engine_capture_stop
''')
open(p,'w').write(s)
