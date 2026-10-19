W='/home/user/Livestreamingapp/.claude/worktrees/agent-aefea299a26a1206e/'
def edit(path, pairs):
    p=W+path
    s=open(p).read()
    for a,b in pairs:
        assert s.count(a)==1, (path, a, s.count(a))
        s=s.replace(a,b)
    open(p,'w').write(s)

edit('crates/live-engine/src/lib.rs', [
("""pub mod audio;\n""","""pub mod audio;\npub mod delay;\n"""),
])
edit('crates/live-engine/src/engine.rs', [
("""    feeds: Feeds,
""","""    feeds: Feeds,
    /// Cameras held back (their picture's delay).
    delays: HashMap<SourceId, crate::delay::DelayLine>,
"""),
("""            feeds: Feeds::default(),
""","""            feeds: Feeds::default(),
            delays: HashMap::new(),
"""),
("""        for id in needed {
            if let Some(f) = self.sources.get(id).and_then(|(_, s)| s.latest()) {
                self.gpu.upload(id, &f);
            }
        }""","""        for id in needed {
            let f = self.sources.get(id).and_then(|(_, s)| s.latest());
            let delay = show
                .source(id)
                .and_then(|s| s.video_delay_ms)
                .filter(|d| *d > 0);
            let f = match delay {
                Some(ms) => {
                    let line = self.delays.entry(id.clone()).or_default();
                    if let Some(f) = f {
                        line.push(now, f);
                    }
                    line.get(now, u64::from(ms))
                }
                None => {
                    self.delays.remove(id);
                    f
                }
            };
            if let Some(f) = f {
                self.gpu.upload(id, &f);
            }
        }"""),
])
