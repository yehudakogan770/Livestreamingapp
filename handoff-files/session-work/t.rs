/// The Lumora website. When it moves to its own domain, change this one line
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
#[allow(clippy::needless_pass_by_value)]
fn open_site_page(page: String) -> Result<(), String> {
    if !SITE_PAGES.contains(&page.as_str()) {
        return Err("That page is not part of the Lumora website.".to_owned());
    }
    open_in_browser(&format!("{SITE_URL}{page}"))
}

fn main() { let _ = open_site_page("x".to_owned()); let _ = open_in_browser; }
