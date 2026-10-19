W='/home/user/Livestreamingapp/.claude/worktrees/agent-aefea299a26a1206e/'
def edit(path, pairs):
    p=W+path
    s=open(p).read()
    for a,b in pairs:
        assert s.count(a)==1, (path, a, s.count(a))
        s=s.replace(a,b)
    open(p,'w').write(s)

edit('crates/live-engine/src/gpu.rs', [
("""    Vertical { src: usize, small: usize },
}""","""    Vertical { src: usize, small: usize },
    /// A flat color (premultiplied) over the viewport.
    Solid([f32; 4]),
    /// A graphics plane of `slot` over the viewport, at whatever size it is held (the multiview's words).
    Plane { slot: usize, name: &'static str },
}"""),
("""                Paint::Vertical { src, small } => {""","""                Paint::Solid(c) => {
                    let mut d = DrawU::new();
                    d.set(COLOR, *c);
                    d.0[MISC * 4 + 3] = 1.0;
                    draws.push((d, TexKey::White));
                }
                Paint::Plane { slot, name } => {
                    if let Some(id) = self.plane(*slot, name, (w, h)) {
                        draws.push((DrawU::new(), TexKey::Plane(id)));
                    }
                }
                Paint::Vertical { src, small } => {"""),
])
edit('crates/live-engine/src/feeds.rs', [
("""/// Feed targets are numbered from here (the screens and Next come first).
const FIRST_TARGET: usize = 8;""","""/// Feed targets are numbered from here (the screens, Next and the multiview come first).
const FIRST_TARGET: usize = 16;"""),
])
edit('crates/live-engine/src/lib.rs', [
("""pub mod mix;\n""","""pub mod mix;\npub mod multiview;\n"""),
])
