root='/home/user/Livestreamingapp/.claude/worktrees/agent-a53b9f061dc9b1bdf/'
for p,pairs in {
 'crates/vst3-host/src/lib.rs':[("use std::sync::Arc;","use std::rc::Rc;"),("let m = Arc::new(Module::load(path)?);","let m = Rc::new(Module::load(path)?);"),
   ("""    for (i, chunk) in raw.chunks_exact(4).take(frames * channels).enumerate() {
        out[i % channels].push(f32::from_le_bytes([chunk[0], chunk[1], chunk[2], chunk[3]]));
    }""","""    for (i, chunk) in raw.as_chunks::<4>().0.iter().take(frames * channels).enumerate() {
        out[i % channels].push(f32::from_le_bytes(*chunk));
    }"""),
   ("if clean.len() % 4 != 0 {","if !clean.len().is_multiple_of(4) {")],
 'crates/vst3-host/src/plugin.rs':[("use std::sync::{Arc, Mutex};","use std::rc::Rc;\nuse std::sync::{Arc, Mutex};"),("    _module: Arc<Module>,","    _module: Rc<Module>,"),("pub fn open(module: Arc<Module>, cid: &Tuid)","pub fn open(module: Rc<Module>, cid: &Tuid)"),("_module: Arc::clone(&module),","_module: Rc::clone(&module),")],
 'crates/vst3-host/src/fake.rs':[("    use std::sync::Arc;","    use std::rc::Rc;"),("fn module() -> Arc<Module> {","fn module() -> Rc<Module> {"),("Arc::new(Module::from_factory(","Rc::new(Module::from_factory("),("Plugin::open(Arc::clone(&m),","Plugin::open(Rc::clone(&m),")],
}.items():
    s=open(root+p).read()
    for a,b in pairs:
        assert a in s,(p,a)
        s=s.replace(a,b)
    open(root+p,'w').write(s)
