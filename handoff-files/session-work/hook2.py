import os
os.chdir('/home/user/Livestreamingapp/.claude/worktrees/agent-aba3a6fa63da8b178')
p='crates/engine/src/stream.rs'
s=open(p).read()
old='''    "rtp://", // An NDI source on the network, by its name ("PC (Camera 1)").
    "ndi://",
];'''
assert old in s
s=s.replace(old,'''    "rtp://", // An NDI source on the network, by its name ("PC (Camera 1)").
    "ndi://",
    // A Blackmagic capture card (DeckLink, UltraStudio, Intensity), by its
    // name: "decklink://DeckLink Duo (1)?input=sdi&audio=3-4".
    "decklink://",
];''')
old='''    // NDI names have spaces; other addresses never do.
    let spaces_ok = lower.starts_with("ndi://");'''
assert old in s
s=s.replace(old,'''    // NDI and capture card names have spaces; other addresses never do.
    let spaces_ok = lower.starts_with("ndi://") || lower.starts_with("decklink://");''')
open(p,'w').write(s)
p='crates/engine/tests/browser.rs'
s=open(p).read()
old='''    assert!(clean_stream_url("example.com").is_none());
}'''
assert old in s
s=s.replace(old,'''    assert!(clean_stream_url("example.com").is_none());
    // Capture cards and NDI sources are named, with spaces.
    assert!(clean_stream_url("decklink://DeckLink Duo (1)?input=sdi&audio=3-4").is_some());
    assert!(clean_stream_url("ndi://PC (Camera 1)").is_some());
    assert!(clean_stream_url("rtsp://cam local/1").is_none());
    assert!(clean_stream_url("decklink://").is_none());
}''')
open(p,'w').write(s)
p='app/src/engine/stream.ts'
s=open(p).read()
old="""const SCHEMES = ['srt://', 'rtmp://', 'rtmps://', 'rtsp://', 'rtsps://', 'http://', 'https://', 'udp://', 'rtp://', 'ndi://'];"""
assert old in s
s=s.replace(old,"""const SCHEMES = ['srt://', 'rtmp://', 'rtmps://', 'rtsp://', 'rtsps://', 'http://', 'https://', 'udp://', 'rtp://', 'ndi://', 'decklink://'];""")
old="""  // NDI names have spaces; other addresses never do.
  const ndi = t.toLowerCase().startsWith('ndi://');
  if (!t || t.length > 2000 || (!ndi && /\\s/.test(t)) || /[\\u0000-\\u001f]/.test(t)) return null;"""
assert old in s, 'ts'
s=s.replace(old,"""  // NDI and capture card names have spaces; other addresses never do.
  const named = /^(ndi|decklink):\\/\\//i.test(t);
  if (!t || t.length > 2000 || (!named && /\\s/.test(t)) || /[\\u0000-\\u001f]/.test(t)) return null;""")
old="""  if (/^ndi:\\/\\//i.test(url)) return /\\(([^)]+)\\)\\s*$/.exec(url)?.[1] ?? url.slice(6);"""
assert old in s, 'ts2'
s=s.replace(old,old+"""
  // A capture card: its name ("DeckLink Duo (1)"), and the connector when chosen.
  if (/^decklink:\\/\\//i.test(url)) {
    const [name, query = ''] = url.slice(11).split('?');
    const input = /(?:^|&)input=([a-z]+)/i.exec(query)?.[1];
    return input ? `${name} ${input.toUpperCase()}` : name || 'Capture card';
  }""")
open(p,'w').write(s)
