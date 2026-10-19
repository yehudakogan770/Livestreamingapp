W='/home/user/Livestreamingapp/.claude/worktrees/agent-aefea299a26a1206e/'
def edit(path, pairs):
    p=W+path
    s=open(p).read()
    for a,b in pairs:
        assert s.count(a)==1, (path, a, s.count(a))
        s=s.replace(a,b)
    open(p,'w').write(s)

edit('crates/live-engine/tests/gpu.rs', [
("""    // Half a second of frames in real time.
    let t0 = live_engine::engine::now_ms();
    while live_engine::engine::now_ms() < t0 + 500 {
        e.frame(live_engine::engine::now_ms());
        std::thread::sleep(std::time::Duration::from_millis(10));
    }""","""    // Frames in real time until every encoder runs (the camera's starts
    // with its first frame), then half a second more.
    let now = live_engine::engine::now_ms;
    let t0 = now();
    let mut until = None;
    while until.is_none_or(|u| now() < u) && now() < t0 + 10_000 {
        e.frame(now());
        if until.is_none() && [1, 2, 3].iter().all(|id| e.feed_running(*id)) {
            until = Some(now() + 500);
        }
        std::thread::sleep(std::time::Duration::from_millis(10));
    }"""),
])
edit('crates/live-engine/src/engine.rs', [
("""    /// Stop feed `id`: its encoder, for the caller to finish (off the engine's thread).""","""    /// Feed `id`'s encoder has started.
    pub fn feed_running(&self, id: u64) -> bool {
        self.feeds.running(id)
    }

    /// Stop feed `id`: its encoder, for the caller to finish (off the engine's thread)."""),
])
edit('crates/live-engine/src/feeds.rs', [
("""    pub fn is_empty(&self) -> bool {""","""    /// Feed `id`'s encoder has started.
    pub fn running(&self, id: u64) -> bool {
        self.feeds.get(&id).is_some_and(|f| f.enc.is_some())
    }

    pub fn is_empty(&self) -> bool {"""),
])
