import re
W='/home/user/Livestreamingapp/.claude/worktrees/agent-aefea299a26a1206e/'
p=W+'crates/live-engine/src/overlay.rs'
s=open(p).read()
a=s.index('/// Write a message (the renderer')
b=s.index('pub fn encode(')
s=s[:a]+'''/// One record to write: what, which screen, the plane's name and size, the
/// time it was drawn for, and its rectangles (`[x, y, w, h]` and their pixels).
pub type OutRecord<'a> = (Op, ScreenId, &'a str, u32, u32, u64, Vec<([u32; 4], &'a [u8])>);

/// Write a message (the renderer's side, in Rust: tests and the benchmark).
'''+s[b:]
s=re.sub(r"pub fn encode\(\s*records: &\[\(Op, ScreenId, &str, u32, u32, u64, Vec<\(\[u32; 4\], &\[u8\]\)>\)\],?\s*\) -> Vec<u8> \{", "pub fn encode(records: &[OutRecord<'_>]) -> Vec<u8> {", s)
assert "OutRecord<'_>]) -> Vec<u8>" in s
open(p,'w').write(s)
p=W+'crates/live-engine/src/encoder.rs'
s=open(p).read()
s=s.replace('''            .chunks_exact(2)
            .map(|b| i16::from_le_bytes([b[0], b[1]]))''','''            .as_chunks::<2>()
            .0
            .iter()
            .map(|b| i16::from_le_bytes(*b))''')
open(p,'w').write(s)
