root='/home/user/Livestreamingapp/.claude/worktrees/agent-a53b9f061dc9b1bdf/'
def edit(p, pairs):
    s=open(root+p).read()
    for a,b in pairs:
        assert a in s, (p, a[:70])
        s=s.replace(a,b,1)
    open(root+p,'w').write(s)

edit('editor/src-tauri/src/vst.rs', [
("""/// A stretch of a file's sound through a chain of plug-ins, as a WAV file""","""/// The plug-in's own window (in a helper, until it is closed); then its parameters and state.
///
/// # Errors
/// It has no window, or it couldn't be opened.
pub fn edit(path: &str, cid: &str, state: Option<String>, title: &str) -> Result<Settings, String> {
    // Open as long as the person works in it.
    let r = ask(
        &Request::Edit { path: PathBuf::from(path), cid: cid.to_owned(), state, title: title.to_owned() },
        Duration::from_secs(12 * 3600),
    )?;
    Ok(Settings { params: r.params, state: r.state.unwrap_or_default() })
}

/// A stretch of a file's sound through a chain of plug-ins, as a WAV file"""),
])
edit('editor/src-tauri/src/lib.rs', [
("""/// A stretch of a file's sound through a clip's VST3 effects, as a WAV file""","""/// A VST3 effect's own window (Windows), open until it is closed; then its parameters and state.
#[tauri::command]
async fn vst_edit(path: String, cid: String, state: Option<String>, title: String) -> Result<vst::Settings, String> {
    tauri::async_runtime::spawn_blocking(move || vst::edit(&path, &cid, state, &title))
        .await
        .map_err(|e| e.to_string())?
}

/// A stretch of a file's sound through a clip's VST3 effects, as a WAV file"""),
("""            vst_settings,
            vst_render,""","""            vst_settings,
            vst_edit,
            vst_render,"""),
])
edit('editor/app/src/native.ts', [
("""  /** A stretch of a file's sound through VST3 effects, as a WAV file (made once). */""","""  /** A VST3 effect's own window (Windows), open until it is closed; then its parameters and settings. */
  vstEdit: (path: string, cid: string, state: string | null, title: string) => invoke<{ params: PluginParam[]; state: string }>('vst_edit', { path, cid, state, title }),
  /** A stretch of a file's sound through VST3 effects, as a WAV file (made once). */"""),
])
edit('editor/app/src/ui/Plugins.tsx', [
("""  const [dragging, setDragging] = useState<{ id: number; value: number } | null>(null);""","""  const [dragging, setDragging] = useState<{ id: number; value: number } | null>(null);
  const [windowOpen, setWindowOpen] = useState(false);"""),
("""  const m = project.media.find((x) => clip.source.kind === 'media' && x.id === clip.source.media);""","""  const openWindow = () => {
    setProblem('');
    setWindowOpen(true);
    native
      .vstEdit(d.path, d.cid, d.state || null, `${d.name} — ${clip.name}`)
      .then((r) => onChange({ ...d, params: r.params, state: r.state }, `${d.name} settings`))
      .catch((e: unknown) => setProblem(e instanceof Error ? e.message : String(e)))
      .finally(() => setWindowOpen(false));
  };
  const m = project.media.find((x) => clip.source.kind === 'media' && x.id === clip.source.media);"""),
("""      {(problem || failed) && <p className="form__problem">{problem || failed}</p>}""","""      {(problem || failed) && <p className="form__problem">{problem || failed}</p>}
      {onWindows() && (
        <button type="button" className="btn btn--sm" disabled={windowOpen} title="The plug-in's own controls, in a window of their own" onClick={openWindow}>
          {windowOpen ? 'The plug-in window is open: close it to come back' : 'Open the plug-in window'}
        </button>
      )}"""),
("""type Scan = Awaited<ReturnType<typeof native.vstScan>>;""","""type Scan = Awaited<ReturnType<typeof native.vstScan>>;

/** Plug-in windows open on Windows (elsewhere the parameters are here). */
const onWindows = (): boolean => inApp() && typeof navigator !== 'undefined' && /Windows/i.test(navigator.userAgent);"""),
])
