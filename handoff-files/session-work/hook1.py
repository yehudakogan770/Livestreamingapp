import os
os.chdir('/home/user/Livestreamingapp/.claude/worktrees/agent-aba3a6fa63da8b178')
p='crates/live-engine/src/engine.rs'
s=open(p).read()
a='''            SourceKind::Pattern => "pattern".into(),
            // Their pictures come from the app's frame store by input: one source each.'''
assert a in s
s=s.replace(a,'''            SourceKind::Pattern => "pattern".into(),
            // A Blackmagic card: opened directly (one capture per card and connector).
            SourceKind::Stream(st) if crate::decklink::is_decklink(&st.url) => {
                crate::decklink::key(&st.url)
            }
            // Their pictures come from the app's frame store by input: one source each.''',1)
b='''            SourceKind::Stream(_)
            | SourceKind::Screen(_)'''
assert b in s
s=s.replace(b,'''            SourceKind::Stream(st) if crate::decklink::is_decklink(&st.url) => {
                crate::decklink::open(&st.url)
            }
            SourceKind::Stream(_)
            | SourceKind::Screen(_)''',1)
open(p,'w').write(s)
p='crates/live-engine/src/lib.rs'
s=open(p).read()
s=s.replace("pub mod audio;\n","pub mod audio;\npub mod decklink;\n",1)
open(p,'w').write(s)
p='crates/live-engine/Cargo.toml'
s=open(p).read()
old='lumora-engine = { path = "../engine" }\n'
assert old in s
s=s.replace(old,old+'# Blackmagic capture cards (DeckLink API through Desktop Video, Windows).\nlumora-decklink = { path = "../decklink" }\n',1)
open(p,'w').write(s)
p='crates/live-engine/src/decklink.rs'
s=open(p).read()
s=s.replace('''/// The source for a `decklink://` address.''','''/// What identifies the capture (the card and connector; the audio pair is the mixer's business).
pub fn key(url: &str) -> String {
    Address::parse(url).map_or_else(
        || format!("decklink:{url}"),
        |a| format!("decklink:{}", a.capture_key()),
    )
}

/// The source for a `decklink://` address.''')
open(p,'w').write(s)
