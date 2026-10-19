import os
os.chdir('/home/user/Livestreamingapp/.claude/worktrees/agent-aba3a6fa63da8b178')
p='src-tauri/src/lib.rs'
s=open(p).read()
rep=[
("mod api;\nmod browser;","mod api;\nmod atem;\nmod browser;"),
("mod control;\nmod desktop;","mod control;\nmod decklink;\nmod desktop;"),
('''    state.api.show_changed(&snapshot.show);
}''','''    state.api.show_changed(&snapshot.show);
    if let Some(atem) = atem::get() {
        atem.show_changed(&snapshot.show);
    }
}'''),
('''            app.manage(live::Live::new(''','''            // An ATEM switcher next to Lumora (Settings → ATEM switcher…).
            let told = app.handle().clone();
            atem::install(
                &dir,
                std::sync::Arc::new(move || {
                    if let Some(a) = atem::get() {
                        let _ = told.emit("atem-changed", a.status());
                    }
                    if let Some(state) = told.try_state::<AppState>() {
                        state.api.refresh_tally();
                    }
                }),
            );
            app.manage(decklink::Output::default());
            app.manage(live::Live::new('''),
("            ndi_sources,\n","            ndi_sources,\n            decklink::decklink_devices,\n            decklink::decklink_signals,\n            decklink::decklink_output_start,\n            decklink::decklink_output_stop,\n            decklink::decklink_output_status,\n            atem::atem_status,\n            atem::atem_set,\n            atem::atem_send,\n"),
]
for a,b in rep:
    assert a in s, a[:50]
    s=s.replace(a,b,1)
open(p,'w').write(s)
