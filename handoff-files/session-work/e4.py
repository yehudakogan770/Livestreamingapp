W='/home/user/Livestreamingapp/.claude/worktrees/agent-aefea299a26a1206e/'
p=W+'crates/live-engine/src/gpu.rs'
s=open(p).read()
def rep(a,b,cnt=1):
    global s
    assert s.count(a)==cnt, (a, s.count(a))
    s=s.replace(a,b)
rep("""    /// Another target, stretched over the viewport (a preview of a screen).
    Target(usize),
}""","""    /// Another target, stretched over the viewport (a preview of a screen).
    Target(usize),
    /// The 9:16 version of target `src` (the recorder's `VerticalFrame`):
    /// the whole picture across the middle, over a soft, darkened copy of
    /// it filling the frame (stretched up from the tiny target `small`).
    Vertical { src: usize, small: usize },
}""")
rep("""                Paint::Target(i) => {
                    let mut d = DrawU::new();
                    d.0[MISC * 4 + 3] = 2.0;
                    draws.push((d, TexKey::Target(*i)));
                }""","""                Paint::Target(i) => {
                    let mut d = DrawU::new();
                    d.0[MISC * 4 + 3] = 2.0;
                    draws.push((d, TexKey::Target(*i)));
                }
                Paint::Vertical { src, small } => {
                    let (sw, sh) = self.dest_size(Dest::Target(*src)).unwrap_or((16, 9));
                    let (ow, oh) = (w as f32, h as f32);
                    // Behind: the tiny copy, stretched to the frame's height (a cheap, smooth blur).
                    let cw = oh * sw as f32 / sh as f32 / ow;
                    let mut d = DrawU::new();
                    d.set(DST, [0.5 - cw / 2.0, 0.0, 0.5 + cw / 2.0, 1.0]);
                    d.0[MISC * 4 + 3] = 2.0;
                    draws.push((d, TexKey::Target(*small)));
                    let mut dark = DrawU::new();
                    dark.set(COLOR, [0.0, 0.0, 0.0, 1.0])
                        .set(FX, [0.45, 0.0, 0.0, 0.0]);
                    dark.0[MISC * 4 + 3] = 1.0;
                    draws.push((dark, TexKey::White));
                    // In front: the whole picture, nothing cut off.
                    let k = (ow / sw as f32).min(oh / sh as f32);
                    let (fw, fh) = (sw as f32 * k / ow, sh as f32 * k / oh);
                    let mut d = DrawU::new();
                    d.set(
                        DST,
                        [(1.0 - fw) / 2.0, (1.0 - fh) / 2.0, (1.0 + fw) / 2.0, (1.0 + fh) / 2.0],
                    );
                    d.0[MISC * 4 + 3] = 2.0;
                    draws.push((d, TexKey::Target(*src)));
                }""")
rep("""    /// Make sure the preview atlas exists at `w` × `h`.""","""    /// Let target `i` go (a feed ended).
    pub fn drop_target(&mut self, i: usize) {
        if let Some(t) = self.targets.get_mut(i) {
            *t = None;
        }
        self.rings.remove(&Dest::Target(i));
    }

    /// Make sure the preview atlas exists at `w` × `h`.""")
open(p,'w').write(s)
