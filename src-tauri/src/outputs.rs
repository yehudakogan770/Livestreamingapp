//! The three output windows (Live, Back, Monitor) and the displays they go to.
//!
//! Each output is an ordinary window labeled `output-<screen>`. The page
//! inside reads its label to know which screen it shows. When the screen has a
//! display assigned in the show settings, the window goes fullscreen there;
//! otherwise it opens as a normal window that can be dragged anywhere.

use lumora_engine::{ScreenId, Show};
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, PhysicalPosition, WebviewUrl, WebviewWindowBuilder};

/// A display (monitor, projector, capture output) connected to this computer.
#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Display {
    /// Stable name used to remember the choice between events.
    pub id: String,
    pub width: u32,
    pub height: u32,
    pub x: i32,
    pub y: i32,
    pub primary: bool,
}

pub fn label(screen: ScreenId) -> String {
    format!("output-{}", slug(screen))
}

fn slug(screen: ScreenId) -> &'static str {
    match screen {
        ScreenId::Live => "live",
        ScreenId::Back => "back",
        ScreenId::Monitor => "monitor",
    }
}

/// Screens whose output window is open right now.
pub fn open_screens(app: &AppHandle) -> Vec<ScreenId> {
    ScreenId::ALL
        .into_iter()
        .filter(|s| app.get_webview_window(&label(*s)).is_some())
        .collect()
}

pub fn notify(app: &AppHandle) {
    let _ = app.emit("outputs-changed", open_screens(app));
}

pub fn displays(app: &AppHandle) -> Vec<Display> {
    let primary = app
        .primary_monitor()
        .ok()
        .flatten()
        .and_then(|m| m.name().cloned());
    let Ok(monitors) = app.available_monitors() else {
        return Vec::new();
    };
    monitors
        .into_iter()
        .enumerate()
        .map(|(i, m)| {
            let id = m
                .name()
                .cloned()
                .unwrap_or_else(|| format!("Display {}", i + 1));
            Display {
                primary: primary.as_deref() == Some(id.as_str()),
                width: m.size().width,
                height: m.size().height,
                x: m.position().x,
                y: m.position().y,
                id,
            }
        })
        .collect()
}

/// Open (or bring forward) the output window for `screen`, placed on its
/// assigned display.
pub fn open(app: &AppHandle, show: &Show, screen: ScreenId) -> tauri::Result<()> {
    let name = label(screen);
    let window = if let Some(w) = app.get_webview_window(&name) {
        w
    } else {
        let w = WebviewWindowBuilder::new(app, &name, WebviewUrl::default())
            .additional_browser_args(crate::BROWSER_ARGS)
            .title(format!("Lumora — {} output", screen.label()))
            .inner_size(960.0, 540.0)
            .min_inner_size(320.0, 180.0)
            .background_color(tauri::webview::Color(0, 0, 0, 255))
            .build()?;
        notify(app);
        w
    };
    place(app, &window, show, screen)?;
    window.set_focus()?;
    Ok(())
}

/// Move an output to its assigned display and make it fullscreen there, or
/// leave it windowed when no display is assigned (or the display is gone).
pub fn place(
    app: &AppHandle,
    window: &tauri::WebviewWindow,
    show: &Show,
    screen: ScreenId,
) -> tauri::Result<()> {
    let wanted = show.settings.displays.get(screen).as_deref();
    let target = wanted.and_then(|id| displays(app).into_iter().find(|d| d.id == id));
    match target {
        Some(d) => {
            window.set_fullscreen(false)?;
            window.set_position(PhysicalPosition::new(d.x + 40, d.y + 40))?;
            window.set_fullscreen(true)?;
        }
        None => window.set_fullscreen(false)?,
    }
    Ok(())
}

/// The multiview window's label.
pub const MULTIVIEW: &str = "output-multiview";

/// Open (or bring forward) the multiview, on its display if one is chosen.
pub fn open_multiview(app: &AppHandle, show: &Show) -> tauri::Result<()> {
    let window = if let Some(w) = app.get_webview_window(MULTIVIEW) {
        w
    } else {
        WebviewWindowBuilder::new(app, MULTIVIEW, WebviewUrl::default())
            .additional_browser_args(crate::BROWSER_ARGS)
            .title("Lumora — Multiview")
            .inner_size(1280.0, 720.0)
            .min_inner_size(480.0, 270.0)
            .background_color(tauri::webview::Color(0, 0, 0, 255))
            .build()?
    };
    let target = show
        .settings
        .multiview
        .display
        .as_deref()
        .and_then(|id| displays(app).into_iter().find(|d| d.id == id));
    match target {
        Some(d) => {
            window.set_fullscreen(false)?;
            window.set_position(PhysicalPosition::new(d.x + 40, d.y + 40))?;
            window.set_fullscreen(true)?;
        }
        None => window.set_fullscreen(false)?,
    }
    window.set_focus()?;
    Ok(())
}

pub fn close_multiview(app: &AppHandle) -> tauri::Result<()> {
    if let Some(w) = app.get_webview_window(MULTIVIEW) {
        w.close()?;
    }
    Ok(())
}

pub fn close(app: &AppHandle, screen: ScreenId) -> tauri::Result<()> {
    if let Some(w) = app.get_webview_window(&label(screen)) {
        w.close()?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn labels_are_stable() {
        assert_eq!(label(ScreenId::Live), "output-live");
        assert_eq!(label(ScreenId::Back), "output-back");
        assert_eq!(label(ScreenId::Monitor), "output-monitor");
    }
}
