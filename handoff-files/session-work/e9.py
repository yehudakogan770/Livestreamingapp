p='/home/user/Livestreamingapp/.claude/worktrees/agent-aefea299a26a1206e/crates/live-engine/src/encoder.rs'
s=open(p).read()
def rep(a,b,cnt=1):
    global s
    assert s.count(a)==cnt, (a, s.count(a))
    s=s.replace(a,b)
# no probing on raw inputs
rep('''        "-thread_queue_size",
        "64",
        "-f",
        "rawvideo",''','''        "-thread_queue_size",
        "64",
        "-probesize",
        "32",
        "-analyzeduration",
        "0",
        "-f",
        "rawvideo",''')
rep('''                "-thread_queue_size",
                "1024",
                "-f",
                "s16le",''','''                "-thread_queue_size",
                "1024",
                "-probesize",
                "32",
                "-analyzeduration",
                "0",
                "-f",
                "s16le",''')
# ready flag
rep('''    /// The feed's first frame (wall-clock ms; 0: not yet), for the sound.
    start: Arc<AtomicU64>,''','''    /// The feed's first frame (wall-clock ms; 0: not yet), for the sound.
    start: Arc<AtomicU64>,
    /// FFmpeg has taken the first frame (it has started): the clock runs from then.
    ready: Arc<AtomicBool>,
    /// The first frame, to get FFmpeg going, has been sent.
    primed: bool,''')
rep('''        let fr = Arc::clone(&frames);''','''        let fr = Arc::clone(&frames);
        let ready = Arc::new(AtomicBool::new(false));
        let rd = Arc::clone(&ready);''')
rep('''                            fr.fetch_add(1, Ordering::Relaxed);''','''                            fr.fetch_add(1, Ordering::Relaxed);
                            rd.store(true, Ordering::SeqCst);''')
rep('''            last: None,
            start,''','''            last: None,
            start,
            ready,
            primed: false,''')
rep('''    pub fn due(&mut self, now_ms: u64) -> u64 {
        let n = self.clock.copies(now_ms);''','''    pub fn due(&mut self, now_ms: u64) -> u64 {
        // Until FFmpeg has started (it takes a moment, more with a hardware
        // encoder), only one frame goes to get it going: frames counted
        // while it can't take them would land later in the picture than they belong.
        if !self.ready.load(Ordering::SeqCst) {
            if self.primed {
                return 0;
            }
            self.primed = true;
            return 1;
        }
        let n = self.clock.copies(now_ms);''')
# the primer frame is not part of the count: the clock's first slot is the first frame after it.
open(p,'w').write(s)
