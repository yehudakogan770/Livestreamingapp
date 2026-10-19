import os
os.chdir('/home/user/Livestreamingapp/.claude/worktrees/agent-aba3a6fa63da8b178')
p='src-tauri/src/streams.rs'
s=open(p).read()
old='''            // An NDI source: read with the NDI runtime, not FFmpeg.'''
assert old in s
s=s.replace(old,'''            // A Blackmagic capture card: read with the DeckLink API (`decklink.rs`).
            if crate::decklink::is_card(&st.url) {
                let stop = Arc::new(AtomicBool::new(false));
                crate::decklink::spawn(
                    id.clone(),
                    st.url.clone(),
                    Arc::clone(frames),
                    Arc::clone(sounds),
                    Arc::clone(status),
                    Arc::clone(&stop),
                );
                readers.insert(
                    id,
                    Reader {
                        url: st.url,
                        buffer_ms: st.buffer_ms,
                        stop,
                        child: Arc::new(Mutex::new(None)),
                        sound: Arc::new(Mutex::new(None)),
                    },
                );
                continue;
            }
            // An NDI source: read with the NDI runtime, not FFmpeg.''',1)
open(p,'w').write(s)

p='src-tauri/src/live.rs'
s=open(p).read()
old='''    fn runner(&self) -> Option<Arc<Runner>> {
        lock(&self.inner).runner.clone()
    }
'''
assert old in s
s=s.replace(old,old+'''
    /// The running engine and FFmpeg, for feeds started elsewhere (a
    /// Blackmagic card's program out, `decklink.rs`).
    pub(crate) fn feed_parts(&self) -> Option<(Arc<Runner>, PathBuf)> {
        Some((self.runner()?, self.ffmpeg.clone()?))
    }
''',1)
open(p,'w').write(s)

p='src-tauri/Cargo.toml'
s=open(p).read()
old='lumora-live-engine = { path = "../crates/live-engine" }\n'
assert old in s
s=s.replace(old,old+'# Blackmagic capture cards and ATEM switchers.\nlumora-decklink = { path = "../crates/decklink" }\nlumora-atem = { path = "../crates/atem" }\n',1)
open(p,'w').write(s)
