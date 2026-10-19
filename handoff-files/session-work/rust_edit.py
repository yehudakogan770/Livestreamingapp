import sys, os
root = sys.argv[1]

HELPER = '''/// The Lumora website. When it moves to its own domain, change this one line
/// (and `SITE_URL` in app/src/site.ts and the other app's lib.rs).
pub(crate) const SITE_URL: &str = "https://yehudakogan770.github.io/Livestreamingapp/";

/// The pages of the website the app may open in the browser (only these).
const SITE_PAGES: [&str; 3] = ["planner/", "terms.html", "privacy.html"];

/// Opens a web address in the computer's browser.
fn open_in_browser(url: &str) -> Result<(), String> {
    #[cfg(windows)]
    let mut cmd = {
        let mut c = std::process::Command::new("rundll32");
        c.args(["url.dll,FileProtocolHandler", url]);
        c
    };
    #[cfg(target_os = "macos")]
    let mut cmd = {
        let mut c = std::process::Command::new("open");
        c.arg(url);
        c
    };
    #[cfg(all(unix, not(target_os = "macos")))]
    let mut cmd = {
        let mut c = std::process::Command::new("xdg-open");
        c.arg(url);
        c
    };
    let mut child = cmd
        .spawn()
        .map_err(|e| format!("The browser could not be opened: {e}"))?;
    // Reaped once the opener hands the address to the browser.
    std::thread::spawn(move || {
        let _ = child.wait();
    });
    Ok(())
}

/// Opens a page of the Lumora website (the Planner, Terms of Use or Privacy
/// Policy) in the browser.
#[tauri::command]
#[allow(clippy::needless_pass_by_value)]
fn open_site_page(page: String) -> Result<(), String> {
    if !SITE_PAGES.contains(&page.as_str()) {
        return Err("That page is not part of the Lumora website.".to_owned());
    }
    open_in_browser(&format!("{SITE_URL}{page}"))
}
'''

# Lumora
p = os.path.join(root, 'src-tauri/src/lib.rs')
s = open(p).read()
start = s.index("/// The web Lumora Planner (the team's shared run of show).")
end = s.index("#[tauri::command]\nfn close_multiview")
s = s[:start] + HELPER + '''
/// Opens the web Lumora Planner (the team's shared run of show) in the browser.
#[tauri::command]
fn open_planner() -> Result<(), String> {
    open_in_browser(&format!("{SITE_URL}planner/"))
}

''' + s[end:]
assert s.count("            open_planner,\n") == 1
s = s.replace("            open_planner,\n", "            open_planner,\n            open_site_page,\n", 1)
open(p, 'w').write(s)

p = os.path.join(root, 'src-tauri/src/captions.rs')
s = open(p).read()
old = 'const SITE: &str = "https://yehudakogan770.github.io/Livestreamingapp/models";\n'
assert old in s
s = s.replace(old, '', 1)
s = s.replace('format!("{SITE}/{}/{file}", m.name)', 'format!("{}models/{}/{file}", crate::SITE_URL, m.name)', 1)
assert 'SITE}' not in s
open(p, 'w').write(s)

# Studio
p = os.path.join(root, 'editor/src-tauri/src/speech.rs')
s = open(p).read()
old = 'const SITE: &str = "https://yehudakogan770.github.io/Livestreamingapp/models";\n'
assert old in s
s = s.replace(old, '', 1)
s = s.replace('format!("{SITE}/{}/{file}", m.name)', 'format!("{}models/{}/{file}", crate::SITE_URL, m.name)', 1)
assert 'SITE}' not in s
open(p, 'w').write(s)

p = os.path.join(root, 'editor/src-tauri/src/lib.rs')
s = open(p).read()
anchor = "/// Show a file in its folder.\n"
assert s.count(anchor) == 1
s = s.replace(anchor, HELPER + '\n' + anchor, 1)
anchor2 = "            app_ready,\n"
assert s.count(anchor2) == 1
s = s.replace(anchor2, anchor2 + "            open_site_page,\n", 1)
open(p, 'w').write(s)
print("ok")
