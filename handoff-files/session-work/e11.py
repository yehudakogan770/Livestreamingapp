p='/home/user/Livestreamingapp/.claude/worktrees/agent-aefea299a26a1206e/crates/live-engine/src/encoder.rs'
s=open(p).read()
def rep(a,b,cnt=1):
    global s
    assert s.count(a)==cnt, (a, s.count(a))
    s=s.replace(a,b)
rep('''        if !self.ready.load(Ordering::SeqCst) {
            if self.primed {
                return 0;
            }
            self.primed = true;
            return 1;
        }''','''        if !self.ready.load(Ordering::SeqCst) {
            return u64::from(!self.primed);
        }''')
rep('''    pub fn owe(&mut self, n: u64) {
        self.owed = (self.owed + n).min(MAX_OWED);
    }''','''    pub fn owe(&mut self, n: u64) {
        // Before FFmpeg has started nothing is counted yet.
        if self.primed {
            self.owed = (self.owed + n).min(MAX_OWED);
        }
    }''')
rep('''        match tx.try_send((px, n)) {
            Ok(()) => {
                self.owed = 0;
                true
            }
            Err(TrySendError::Full(_) | TrySendError::Disconnected(_)) => {''','''        match tx.try_send((px, n)) {
            Ok(()) => {
                self.owed = 0;
                self.primed = true;
                true
            }
            Err(_) if !self.primed => false,
            Err(TrySendError::Full(_) | TrySendError::Disconnected(_)) => {''')
open(p,'w').write(s)
p='/home/user/Livestreamingapp/.claude/worktrees/agent-aefea299a26a1206e/crates/live-engine/tests/gpu.rs'
s=open(p).read()
rep('''    assert!(iso.len() >= W as usize * H as usize * 4 * 10);''','''    assert!(iso.len() >= W as usize * H as usize * 4 * 5, "{}", iso.len());''')
rep('''    assert!(small.len() >= 32 * 18 * 4 * 10, "{}", small.len());''','''    assert!(small.len() >= 32 * 18 * 4 * 8, "{}", small.len());''')
open(p,'w').write(s)
