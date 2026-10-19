root='/home/user/Livestreamingapp/.claude/worktrees/agent-aa20d25c9832f0a41/'
def rep(path,a,b):
    s=open(root+path).read()
    assert s.count(a)==1,(path,a[:60],s.count(a))
    s=s.replace(a,b)
    open(root+path,'w').write(s)
CMDS = """            titler_host::titler_library_dir,
            titler_host::titler_library_list,
            titler_host::titler_read,
            titler_host::titler_write,
            titler_host::titler_remove,
            titler_host::titler_data_url,
            titler_host::titler_autosave,
            titler_host::titler_recover,
            titler_host::titler_open_window,
            titler_host::titler_render_start,
            titler_host::titler_render_frame,
            titler_host::titler_render_finish,
            titler_host::titler_render_cancel,
"""
# Lumora
rep('src-tauri/Cargo.toml','lumora-crash = { path = "../crates/crash" }\n','lumora-crash = { path = "../crates/crash" }\ntitler-host = { package = "lumora-titler-host", path = "../crates/titler-host" }\n')
rep('src-tauri/src/lib.rs','''        .invoke_handler(tauri::generate_handler![
            app_ready,
''','''        .invoke_handler(tauri::generate_handler![
            app_ready,
'''+CMDS)
rep('src-tauri/src/lib.rs','''            app.manage(live::Live::new(
                &dir,''','''            // Lumora Titler: its window, the shared title library and films through FFmpeg.
            app.manage(titler_host::Renders::default());
            app.manage(live::Live::new(
                &dir,''')
# Studio
rep('editor/src-tauri/Cargo.toml','lumora-crash = { path = "../../crates/crash" }\n','lumora-crash = { path = "../../crates/crash" }\ntitler-host = { package = "lumora-titler-host", path = "../../crates/titler-host" }\n')
rep('editor/src-tauri/src/lib.rs','''        .invoke_handler(tauri::generate_handler![
            app_ready,
''','''        .invoke_handler(tauri::generate_handler![
            app_ready,
'''+CMDS)
rep('editor/src-tauri/src/lib.rs','''            app.manage(native_view::NativeView::default());
''','''            app.manage(native_view::NativeView::default());
            // Lumora Titler: its window, the shared title library and films through FFmpeg.
            app.manage(titler_host::Renders::default());
''')
cap = '''{
  "$schema": "../gen/schemas/desktop-schema.json",
  "identifier": "titler",
  "description": "The Lumora Titler window (the title designer): its own window, and choosing files to open, save and add.",
  "windows": ["titler"],
  "permissions": [
    "core:default",
    "core:window:allow-set-title",
    "core:window:allow-close",
    "dialog:allow-open",
    "dialog:allow-save",
    "dialog:allow-ask",
    "dialog:allow-message"
  ]
}
'''
open(root+'src-tauri/capabilities/titler.json','w').write(cap)
open(root+'editor/src-tauri/capabilities/titler.json','w').write(cap)
