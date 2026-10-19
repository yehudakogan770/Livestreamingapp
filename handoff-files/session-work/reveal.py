import os
os.chdir('/home/user/Livestreamingapp/.claude/worktrees/agent-ae2e4fb2496ef2830')
p = 'editor/src-tauri/src/lib.rs'
s = open(p).read()
old = """/// Show a file in its folder.
#[tauri::command]
fn reveal(path: String) {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        let _ = std::process::Command::new("explorer")
            .raw_arg(format!("/select,\\"{path}\\""))
            .spawn();
    }
    #[cfg(not(windows))]
    {
        if let Some(dir) = Path::new(&path).parent() {
            let _ = std::process::Command::new("xdg-open").arg(dir).spawn();
        }
    }
}"""
assert old in s, 'reveal'
new = """/// A path that is safe to hand to the file manager: a whole, plain path to
/// something that is there (a project from a teammate could hold any text
/// where a media file's path goes; quotes or options must never reach the
/// command line, where they could open or run something else).
fn revealable(path: &str) -> Option<PathBuf> {
    let p = Path::new(path);
    let plain = !path.is_empty()
        && p.is_absolute()
        && !path.starts_with('-')
        && !path.chars().any(|c| c == '"' || c.is_control());
    (plain && p.exists()).then(|| p.to_path_buf())
}

/// Show a file in its folder.
#[tauri::command]
fn reveal(path: String) {
    let Some(path) = revealable(&path) else {
        return;
    };
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        let _ = std::process::Command::new("explorer")
            .raw_arg(format!("/select,\\"{}\\"", path.display()))
            .spawn();
    }
    #[cfg(not(windows))]
    {
        if let Some(dir) = path.parent() {
            let _ = std::process::Command::new("xdg-open").arg(dir).spawn();
        }
    }
}"""
s = s.replace(old, new)
if '#[cfg(test)]' in s:
    raise SystemExit('has tests module: add manually')
s = s.rstrip('\n') + """

#[cfg(test)]
mod tests {
    use super::revealable;

    #[test]
    fn only_plain_paths_that_exist_are_shown_in_their_folder() {
        let dir = std::env::temp_dir().join(format!("lumora-reveal-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let file = dir.join("clip.mp4");
        std::fs::write(&file, b"x").unwrap();
        let f = file.to_string_lossy().into_owned();
        assert_eq!(revealable(&f), Some(file.clone()));
        // Quotes (to break out of the command line), relative or missing paths, options: never.
        assert_eq!(revealable(&format!("{f}\\" C:\\\\Windows\\\\System32\\\\calc.exe")), None);
        assert_eq!(revealable("clip.mp4"), None);
        assert_eq!(revealable(&format!("{f}.missing")), None);
        assert_eq!(revealable("-e"), None);
        assert_eq!(revealable(""), None);
        std::fs::remove_dir_all(&dir).unwrap();
    }
}
"""
open(p, 'w').write(s)
