root='/home/user/Livestreamingapp/.claude/worktrees/agent-a53b9f061dc9b1bdf/'
def edit(p, pairs):
    s=open(root+p).read()
    for a,b in pairs:
        assert a in s, (p, a[:70])
        s=s.replace(a,b,1)
    open(root+p,'w').write(s)

edit('crates/vst3-host/Cargo.toml', [
("""libloading = "0.8"
""","""libloading = "0.8"

# A plug-in's own window on Windows.
[target.'cfg(windows)'.dependencies]
windows-sys = { version = "0.61", features = [
  "Win32_Foundation",
  "Win32_Graphics_Gdi",
  "Win32_System_LibraryLoader",
  "Win32_System_Ole",
  "Win32_UI_WindowsAndMessaging",
] }
"""),
])
edit('crates/vst3-host/src/lib.rs', [
("""pub mod com;
pub mod module;""","""pub mod com;
pub mod editor;
pub mod module;"""),
("""    /// Sound through a chain of effects: raw 32-bit float samples (channels interleaved) in and out.""","""    /// The plug-in's own window, until it is closed; then its parameters and state.
    Edit {
        path: PathBuf,
        cid: String,
        #[serde(default)]
        state: Option<String>,
        title: String,
    },
    /// Sound through a chain of effects: raw 32-bit float samples (channels interleaved) in and out."""),
("""        Request::Render { chain, input, output, channels, rate } => {""","""        Request::Edit { path, cid, state, title } => {
            let mut p = open(&path, &cid, state.as_deref())?;
            editor::edit(&mut p, &title)?;
            Ok(Reply { error: None, classes: Vec::new(), params: p.params(), state: Some(base64_encode(&p.state())), vendor: None })
        }
        Request::Render { chain, input, output, channels, rate } => {"""),
])
edit('crates/vst3-host/src/fake.rs', [
("""    #[test]
    fn many_opens_and_closes_keep_counts_balanced() {""","""    #[test]
    fn changes_made_in_the_plug_in_window_reach_the_saved_state() {
        let mut p = Plugin::open(module(), &PROCESSOR_CID).unwrap();
        // As the window would: the plug-in tells the host through the handler.
        p.edits.lock().unwrap().clear();
        p.edits.lock().unwrap().extend([(GAIN, 0.2), (GAIN, 0.7)]);
        p.take_edits();
        p.apply(48_000.0).unwrap();
        let state = p.state();
        let mut q = Plugin::open(module(), &PROCESSOR_CID).unwrap();
        q.restore(&state).unwrap();
        assert!((q.params()[0].value - 0.7).abs() < 1e-9);
        // The fake has no window: refused with a message (and on Linux the window is Windows-only).
        assert!(crate::editor::edit(&mut q, "Test").is_err());
    }

    #[test]
    fn many_opens_and_closes_keep_counts_balanced() {"""),
])
