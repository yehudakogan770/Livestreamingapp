W='/home/user/Livestreamingapp/.claude/worktrees/agent-aefea299a26a1206e/'
def edit(path, pairs):
    p=W+path
    s=open(p).read()
    for a,b in pairs:
        assert s.count(a)==1, (path, a, s.count(a))
        s=s.replace(a,b)
    open(p,'w').write(s)

edit('crates/live-engine/src/gpu.rs', [
("""                    entry_point: Some("fs"),""","""                    // NV12 targets get the NV12 conversion (and no blending).
                    entry_point: Some(if format == NV12_FORMAT { "fs_nv12" } else { "fs" }),"""),
("""                        blend: Some(wgpu::BlendState::PREMULTIPLIED_ALPHA_BLENDING),""","""                        blend: (format != NV12_FORMAT)
                            .then_some(wgpu::BlendState::PREMULTIPLIED_ALPHA_BLENDING),"""),
("""        let target_pipe = self.pipeline(TARGET_FORMAT);
        let surface_pipe = surface.map(|(_, f)| self.pipeline(f));""","""        let target_pipe = self.pipeline(TARGET_FORMAT);
        let nv12_pipe = plan
            .iter()
            .any(|(d, _, _)| self.dest_bpp(*d) == 1)
            .then(|| self.pipeline(NV12_FORMAT));
        let surface_pipe = surface.map(|(_, f)| self.pipeline(f));"""),
("""            let (view, size) = match (dest, surface) {
                (Dest::Target(usize::MAX), Some((v, _))) => (v, None),
                (Dest::Target(i), _) => match self.targets.get(*i).and_then(Option::as_ref) {
                    Some(t) => (&t.view, Some((t.w, t.h))),
                    None => continue,
                },
                (Dest::Atlas, _) => match &self.atlas {
                    Some(t) => (&t.view, Some((t.w, t.h))),
                    None => continue,
                },
            };""","""            let (view, size, nv12) = match (dest, surface) {
                (Dest::Target(usize::MAX), Some((v, _))) => (v, None, false),
                (Dest::Target(i), _) => match self.targets.get(*i).and_then(Option::as_ref) {
                    Some(t) => (&t.view, Some((t.w, t.h)), t.format == NV12_FORMAT),
                    None => continue,
                },
                (Dest::Atlas, _) => match &self.atlas {
                    Some(t) => (&t.view, Some((t.w, t.h)), false),
                    None => continue,
                },
            };"""),
("""            let pipe = if size.is_none() {
                surface_pipe.as_ref().unwrap_or(&target_pipe)
            } else {
                &target_pipe
            };""","""            let pipe = if size.is_none() {
                surface_pipe.as_ref().unwrap_or(&target_pipe)
            } else if nv12 {
                nv12_pipe.as_ref().unwrap_or(&target_pipe)
            } else {
                &target_pipe
            };"""),
])
