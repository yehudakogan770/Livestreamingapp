p='/home/user/Livestreamingapp/.claude/worktrees/agent-aefea299a26a1206e/crates/live-engine/src/encoder.rs'
s=open(p).read()
a=s.index('    /// Picture and sound into one file, the sound lined up by its time')
new=open('/tmp/claude-0/-home-user-Livestreamingapp/afbb1772-1200-52da-905a-12b6de33f858/scratchpad/avtest.rs').read()
s=s[:a]+new
open(p,'w').write(s)
