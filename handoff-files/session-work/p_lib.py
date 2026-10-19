import sys
p = sys.argv[1] + '/src-tauri/src/lib.rs'
s = open(p).read()

def rep(old, new):
    global s
    if old not in s:
        raise SystemExit('missing: ' + old[:80])
    s = s.replace(old, new, 1)

rep("mod browser;\n", "mod api;\nmod browser;\n")
rep("    remote: remote::Remote,\n", "    remote: remote::Remote,\n    api: api::Api,\n")
rep("""    if let Ok(json) = serde_json::to_string(snapshot) {
        state.remote.broadcast(&json);
    }
}""", """    if let Ok(json) = serde_json::to_string(snapshot) {
        state.remote.broadcast(&json);
    }
    state.api.show_changed(&snapshot.show);
}""")
rep("""    state.remote.set_app_state(&app_state);
}""", """    state.remote.set_app_state(&app_state);
    state.api.set_app_state(&app_state);
}

/// Lets the control API reach the engine and the control window.
struct ApiLink(tauri::AppHandle);

impl api::ApiBackend for ApiLink {
    fn show(&self) -> Option<serde_json::Value> {
        let state = self.0.try_state::<AppState>()?;
        let engine = lock(&state);
        serde_json::to_value(engine.show()).ok()
    }

    fn apply(&self, action: Action) -> Result<(), String> {
        let state = self
            .0
            .try_state::<AppState>()
            .ok_or_else(|| "Lumora is still starting".to_owned())?;
        apply(&self.0, &state, action).map_err(|e| e.to_string())
    }

    fn app_command(&self, command: remote::AppCommand) -> Result<(), String> {
        // Recording, streaming and replay run in the control window.
        self.0
            .emit_to("control", "remote-command", command)
            .map_err(|e| e.to_string())
    }
}

/// The control API: its settings, token and addresses.
#[tauri::command]
fn api_status(state: State<'_, AppState>) -> api::ApiStatus {
    state.api.status()
}

#[tauri::command]
fn set_api(config: api::ApiConfig, state: State<'_, AppState>) -> api::ApiStatus {
    state.api.set(config)
}

/// A new token for the control API (the old one stops working).
#[tauri::command]
fn new_api_token(state: State<'_, AppState>) -> api::ApiStatus {
    let status = state.api.new_token();
    state.remote.set_api_token(&status.config.token);
    status
}""")
rep("""            let videos = app
                .path()
                .video_dir()""", """            let control_api = api::Api::new(Some(&dir), ApiLink(app.handle().clone()));
            remote.set_api_token(&control_api.token());
            let videos = app
                .path()
                .video_dir()""")
rep("""                remote,
                capture,""", """                remote,
                api: control_api,
                capture,""")
rep("""            new_remote_pin,
""", """            new_remote_pin,
            api_status,
            set_api,
            new_api_token,
""")
open(p, 'w').write(s)
print('ok')
