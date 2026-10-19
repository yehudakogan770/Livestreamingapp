import sys
p = sys.argv[1] + '/src-tauri/src/remote.rs'
s = open(p).read()

def rep(old, new):
    global s
    if old not in s:
        raise SystemExit('missing: ' + old[:80])
    s = s.replace(old, new, 1)

old_start = s.index('            if p == "/api/tally" {\n                return json(request, 200, &crate::control::tally(&show).to_string());')
old_end = s.index('        (method, "/api/check" | "/api/show"')
s = s[:old_start] + '''            if p == "/api/tally" {
                let app = shared.app_state();
                return json(
                    request,
                    200,
                    &crate::control::tally(&show, &app).to_string(),
                );
            }
            let q = crate::control::parse_query(query);
            match crate::control::run(shared, &p["/api/do/".len()..], &q) {
                Ok(()) => json(request, 200, r#"{"ok":true}"#),
                Err(e) => json(
                    request,
                    400,
                    &serde_json::json!({"ok": false, "error": e}).to_string(),
                ),
            }
        }
''' + s[old_end:]

rep('''    /// What the control window says is running (recording, stream…), as JSON.
    app_state: Mutex<String>,
}
''', '''    /// What the control window says is running (recording, stream…), as JSON.
    app_state: Mutex<String>,
    /// The control API's token, also taken in place of the PIN (empty: none).
    api_token: Mutex<String>,
}

impl Shared {
    fn app_state(&self) -> serde_json::Value {
        serde_json::from_str(&lock(&self.app_state)).unwrap_or_else(|_| serde_json::json!({}))
    }
}

impl crate::control::Target for Shared {
    fn show(&self) -> Option<serde_json::Value> {
        self.backend
            .snapshot()
            .and_then(|s| serde_json::from_str::<serde_json::Value>(&s).ok())
            .map(|mut v| v["show"].take())
    }
    fn app_state(&self) -> serde_json::Value {
        Shared::app_state(self)
    }
    fn apply(&self, action: Action) -> Result<(), String> {
        self.backend
            .apply(action)
            .map_err(|e| serde_json::to_string(&e).unwrap_or_default())
    }
    fn app_command(&self, command: AppCommand) -> Result<(), String> {
        self.backend.app_command(command)
    }
}
''')

rep('''fn authorised(shared: &Shared, request: &Request, query: &str) -> bool {
    let pin = lock(&shared.pin).clone();''', '''fn authorised(shared: &Shared, request: &Request, query: &str) -> bool {
    // The control API's token works here too (Companion's HTTP buttons).
    let token = lock(&shared.api_token).clone();
    if token.len() >= 16 {
        let given = crate::api::token_from(
            request
                .headers()
                .iter()
                .map(|h| (h.field.as_str().as_str(), h.value.as_str())),
            query,
        );
        if given.is_some_and(|g| same(g.as_bytes(), token.as_bytes())) {
            return true;
        }
    }
    let pin = lock(&shared.pin).clone();''')

rep('''    /// What the control window says is running (recording, stream,
    /// rehearsal, replay). Everyone connected is told when it changes.''', '''    /// The control API's token, accepted in place of the PIN (empty: none).
    pub fn set_api_token(&self, token: &str) {
        token.clone_into(&mut lock(&self.shared.api_token));
    }

    /// What the control window says is running (recording, stream,
    /// rehearsal, replay). Everyone connected is told when it changes.''')
open(p, 'w').write(s)
print('ok')
