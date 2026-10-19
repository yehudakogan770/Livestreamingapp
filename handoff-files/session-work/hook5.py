import os
os.chdir('/home/user/Livestreamingapp/.claude/worktrees/agent-aba3a6fa63da8b178')
p='src-tauri/src/atem.rs'
s=open(p).read()
rep=[
('''        let (connected, state) = match &inner.client {
            Some(c) => (c.status() == Status::Connected, c.state()),
            None => (false, SwitcherState::default()),
        };
        *lock(mirror()) = Mirror {
            connected,
            settings: inner.settings.clone(),
            state,
        };''','''        let (connected, state) = match &inner.client {
            Some(c) => (c.status() == Status::Connected, c.state()),
            None => (false, SwitcherState::default()),
        };
        let mut settings = inner.settings.clone();
        // "In use" only with a connection to keep (the tally gains its ATEM part then).
        settings.connect &= inner.client.is_some();
        *lock(mirror()) = Mirror {
            connected,
            settings,
            state,
        };'''),
('''// ---------------------------------------------------------------------------
// Commands for the control window

#[tauri::command]
pub fn atem_status(atem: tauri::State<'_, Atem>) -> AtemStatus {
    atem.status()
}

#[tauri::command]
pub fn atem_set(settings: AtemSettings, atem: tauri::State<'_, Atem>) -> AtemStatus {
    atem.set(settings)
}

#[tauri::command]
pub fn atem_send(commands: Vec<Command>, atem: tauri::State<'_, Atem>) -> Result<(), String> {
    atem.send(commands)
}''','''// ---------------------------------------------------------------------------
// The app's one connection, and commands for the control window

static ATEM: OnceLock<Atem> = OnceLock::new();

/// Start the app's ATEM connection (once, at start-up). `notify` is told
/// whenever the switcher or the connection changes.
pub fn install(dir: &Path, notify: OnChange) {
    // The tally mirror follows every change, then the app is told.
    let then: OnChange = Arc::new(move || {
        if let Some(a) = ATEM.get() {
            a.refresh();
        }
        notify();
    });
    let _ = ATEM.set(Atem::new(Some(dir), then));
    if let Some(a) = ATEM.get() {
        a.apply_connection();
    }
}

/// The app's ATEM connection (None before start-up).
pub fn get() -> Option<&'static Atem> {
    ATEM.get()
}

const NOT_STARTED: &str = "Lumora is still starting.";

/// The `atem` control command (control API, Companion, Stream Deck).
///
/// # Errors
/// What is wrong, for the person setting up the button.
pub fn control(q: &[(String, String)]) -> Result<(), String> {
    get().ok_or(NOT_STARTED)?.control(q)
}

#[tauri::command]
pub fn atem_status() -> Result<AtemStatus, String> {
    Ok(get().ok_or(NOT_STARTED)?.status())
}

#[tauri::command]
pub fn atem_set(settings: AtemSettings) -> Result<AtemStatus, String> {
    Ok(get().ok_or(NOT_STARTED)?.set(settings))
}

#[tauri::command]
pub fn atem_send(commands: Vec<Command>) -> Result<(), String> {
    get().ok_or(NOT_STARTED)?.send(commands)
}'''),
# Atem::new shouldn't connect itself (install does, once it is reachable for the callback).
('''            notify,
        };
        a.apply_connection();
        a.update_mirror();
        a''','''            notify,
        };
        a.update_mirror();
        a'''),
]
for a,b in rep:
    assert a in s, a[:60]
    s=s.replace(a,b,1)
open(p,'w').write(s)

p='src-tauri/src/control.rs'
s=open(p).read()
old='''        return crate::ptz::send(&cam, c);
    }
'''
assert old in s
s=s.replace(old,old+'''    if cmd.eq_ignore_ascii_case("atem") {
        return crate::atem::control(q);
    }
''',1)
old='''    ("ptz", "input or name, preset, move, zoom, speed"),
];'''
assert old in s
s=s.replace(old,'''    ("ptz", "input or name, preset, move, zoom, speed"),
    (
        "atem",
        "do (cut, auto, program, preview, ftb, style, rate, dsk, usk, macro, stopmacro), input, keyer, number or name, state, style, frames",
    ),
];''',1)
old='''        "prompter" | "timer" => "do",'''
assert old in s
s=s.replace(old,'''        "prompter" | "timer" | "atem" => "do",''',1)
open(p,'w').write(s)

p='src-tauri/src/api.rs'
s=open(p).read()
old='''    fn tally(&self, show: &Value) -> Value {
        control::tally(show, &lock(&self.app_state))
    }'''
assert old in s
s=s.replace(old,'''    fn tally(&self, show: &Value) -> Value {
        let mut t = control::tally(show, &lock(&self.app_state));
        // An ATEM switcher's tally, when one is connected (`atem.rs`).
        crate::atem::mirror_tally(&mut t, show);
        t
    }''',1)
old='''    /// What the control window says is running (recording, stream…).'''
assert old in s
s=s.replace(old,'''    /// Something outside the show changed the tally (an ATEM switcher): tell clients.
    pub fn refresh_tally(&self) {
        self.inner.push_tally();
    }

    /// What the control window says is running (recording, stream…).''',1)
open(p,'w').write(s)
