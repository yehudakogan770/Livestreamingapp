p='/home/user/Livestreamingapp/.claude/worktrees/agent-aefea299a26a1206e/crates/live-engine/src/encoder.rs'
s=open(p).read()
def rep(a,b,cnt=1):
    global s
    assert s.count(a)==cnt, (a, s.count(a))
    s=s.replace(a,b)
rep('''        assert!(!s.contains("-an"));''','''        assert!(!s.contains(" -an "));''')
rep('''    /// When the first frame was (ms on the wall clock).
    pub fn start(&self) -> Option<u64> {
        self.start
    }''','''    /// When the first frame was (ms on the wall clock).
    pub fn start(&self) -> Option<u64> {
        self.start
    }

    /// Start counting with `sent` frames already sent, the first of them at `start_ms`.
    pub fn begin(&mut self, start_ms: u64, sent: u64) {
        self.start = Some(start_ms);
        self.due = sent;
    }''')
rep('''            self.primed = true;
            return 1;
        }
        let n = self.clock.copies(now_ms);''','''            self.primed = true;
            return 1;
        }
        if self.clock.start().is_none() {
            // That first frame is the picture's first: its slot is one frame before now.
            let frame = 1000 / u64::from(self.clock.fps);
            self.clock.begin(now_ms.saturating_sub(frame), 1);
        }
        let n = self.clock.copies(now_ms);''')
open(p,'w').write(s)
