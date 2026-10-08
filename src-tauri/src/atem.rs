//! A Blackmagic ATEM switcher next to Lumora (Settings → ATEM switcher…).
//!
//! - **Connect** by IP address; the connection (`lumora-atem`) keeps itself
//!   up and comes back by itself after the switcher restarts or the network
//!   drops.
//! - **Lumora drives the ATEM**: TAKE, CUT and the Next choice on Lumora's
//!   Live Screen switch the ATEM's program and preview, for the inputs in the
//!   mapping table (a cut, or the ATEM's own transition at Lumora's length).
//! - **Follow the ATEM**: the ATEM's tally (what it has on program and
//!   preview) lights Lumora's inputs that carry its cameras, for tally lights
//!   and Companion; when the ATEM's program output is captured into Lumora
//!   (a capture card input), Lumora's on-air tally of the ATEM cameras holds
//!   only while that input is on air.
//! - **Buttons**: cut, auto, program, preview, fade to black, keyers and
//!   macros from the control window, the control API, Companion and Stream
//!   Deck (`atem` command).

use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, OnceLock};

use lumora_atem::client::{resolve, OnChange};
use lumora_atem::command::OnOff;
use lumora_atem::{Client, Command, Status, SwitcherState};
use lumora_engine::{Show, TransitionKind};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use crate::store::write_file_atomic;

const FILE: &str = "atem.json";

fn lock<T>(m: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    m.lock().unwrap_or_else(std::sync::PoisonError::into_inner)
}

/// One row of the mapping table: a Lumora input and the ATEM input it is.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MapRow {
    pub source_id: String,
    pub atem_input: u16,
}

/// How Lumora's TAKE switches the ATEM.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum DriveHow {
    /// Always a cut.
    Cut,
    /// The ATEM's transition: mix, dip or wipe like Lumora's, at Lumora's length.
    #[default]
    Transition,
}

/// The settings, remembered between starts.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct AtemSettings {
    /// The switcher's address ("192.168.10.240").
    pub host: String,
    /// Connected (and connected again at start).
    pub connect: bool,
    pub mapping: Vec<MapRow>,
    /// Lumora's TAKE, CUT and Next switch the ATEM.
    pub drive: bool,
    pub drive_how: DriveHow,
    /// Lumora's fade to black (blank on the Live Screen) fades the ATEM to black too.
    pub drive_blank: bool,
    /// The ATEM's tally lights Lumora's inputs of its cameras.
    pub follow: bool,
    /// The Lumora input that carries the ATEM's program output (a capture card input).
    pub program_input: Option<String>,
}

impl Default for AtemSettings {
    fn default() -> Self {
        AtemSettings {
            host: String::new(),
            connect: false,
            mapping: Vec::new(),
            drive: false,
            drive_how: DriveHow::Transition,
            drive_blank: false,
            follow: true,
            program_input: None,
        }
    }
}

impl AtemSettings {
    fn atem_input(&self, source: Option<&str>) -> Option<u16> {
        let s = source?;
        self.mapping
            .iter()
            .find(|r| r.source_id == s)
            .map(|r| r.atem_input)
    }
}

/// What Lumora's Live Screen showed, to notice what changed.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Seen {
    pub program: Option<String>,
    pub preview: Option<String>,
    pub blank: bool,
    /// When the last TAKE started (a TAKE to the same input again is still a TAKE).
    pub took_at: u64,
}

impl Seen {
    fn of(show: &Show) -> (Seen, Option<(TransitionKind, u32)>) {
        let live = &show.screens.live;
        let t = live.transition.map(|t| (t.kind, t.duration_ms));
        (
            Seen {
                program: live.program.as_ref().map(|s| s.as_str().to_owned()),
                preview: live.preview.as_ref().map(|s| s.as_str().to_owned()),
                blank: live.blank,
                took_at: live.transition.map_or(0, |t| t.started_at),
            },
            t,
        )
    }
}

/// The ATEM's style for a Lumora transition (0 mix, 1 dip, 2 wipe).
#[must_use]
pub fn style_for(kind: TransitionKind) -> u8 {
    match kind {
        TransitionKind::Dip | TransitionKind::Flash => 1,
        TransitionKind::Wipe
        | TransitionKind::WipeLeft
        | TransitionKind::WipeDown
        | TransitionKind::WipeUp
        | TransitionKind::Split
        | TransitionKind::SplitVertical
        | TransitionKind::Iris
        | TransitionKind::Diamond => 2,
        _ => 0,
    }
}

/// What to tell the ATEM after Lumora's Live Screen changed from `prev` to `now`.
#[must_use]
pub fn drive(
    prev: &Seen,
    now: &Seen,
    transition: Option<(TransitionKind, u32)>,
    s: &AtemSettings,
    atem: &SwitcherState,
) -> Vec<Command> {
    let me = atem.me0();
    let mut out = Vec::new();
    let took = now.program != prev.program || now.took_at != prev.took_at;
    if took {
        if let Some(n) = s.atem_input(now.program.as_deref()) {
            if me.program != n {
                match transition {
                    Some((kind, ms))
                        if s.drive_how == DriveHow::Transition && kind != TransitionKind::Cut =>
                    {
                        let style = style_for(kind);
                        out.push(Command::Preview { me: 0, input: n });
                        if me.style.byte() != style {
                            out.push(Command::TransitionStyle { me: 0, style });
                        }
                        let fps = if atem.fps > 0.0 { atem.fps } else { 30.0 };
                        let frames = ((f64::from(ms) / 1000.0) * f64::from(fps))
                            .round()
                            .clamp(1.0, 250.0) as u8;
                        if style == 0 && me.mix_rate != frames {
                            out.push(Command::MixRate { me: 0, frames });
                        }
                        out.push(Command::Auto { me: 0 });
                    }
                    _ => out.push(Command::Program { me: 0, input: n }),
                }
            }
        }
    }
    if now.preview != prev.preview || (took && out.is_empty()) {
        if let Some(m) = s.atem_input(now.preview.as_deref()) {
            // After an auto the ATEM swaps program and preview by itself; Lumora's
            // Next is set again once the transition has run (the next change).
            let busy = out.iter().any(|c| matches!(c, Command::Auto { .. }));
            if !busy && me.preview != m && now.preview != now.program {
                out.push(Command::Preview { me: 0, input: m });
            }
        }
    }
    if s.drive_blank
        && now.blank != prev.blank
        && me.ftb_black != now.blank
        && !me.ftb_in_transition
    {
        out.push(Command::FadeToBlack { me: 0 });
    }
    out
}

/// The connection's state for the control window.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AtemStatus {
    pub settings: AtemSettings,
    /// "off", "connecting", "connected", "retrying".
    pub connection: &'static str,
    /// Why it is retrying, in words for the operator.
    pub detail: Option<String>,
    pub state: Option<SwitcherState>,
}

struct Inner {
    settings: AtemSettings,
    client: Option<Client>,
    seen: Seen,
    /// Why it can't connect (an address that can't be found).
    problem: Option<String>,
}

/// The switcher connection, managed by the app.
pub struct Atem {
    dir: Option<PathBuf>,
    inner: Mutex<Inner>,
    notify: OnChange,
}

/// The ATEM's tally and settings, for the control API's tally (read from any thread).
#[derive(Clone, Default)]
struct Mirror {
    connected: bool,
    settings: AtemSettings,
    state: SwitcherState,
}

fn mirror() -> &'static Mutex<Mirror> {
    static M: OnceLock<Mutex<Mirror>> = OnceLock::new();
    M.get_or_init(Mutex::default)
}

impl Atem {
    /// The saved settings; connects at once when it was connected before.
    pub fn new(dir: Option<&Path>, notify: OnChange) -> Atem {
        let settings: AtemSettings = dir
            .and_then(|d| std::fs::read(d.join(FILE)).ok())
            .and_then(|b| serde_json::from_slice(&b).ok())
            .unwrap_or_default();
        let a = Atem {
            dir: dir.map(Path::to_path_buf),
            inner: Mutex::new(Inner {
                settings,
                client: None,
                seen: Seen::default(),
                problem: None,
            }),
            notify,
        };
        a.update_mirror();
        a
    }

    fn save(&self, s: &AtemSettings) {
        if let (Some(dir), Ok(text)) = (&self.dir, serde_json::to_string_pretty(s)) {
            let _ = write_file_atomic(&dir.join(FILE), &text);
        }
    }

    /// Connect or disconnect to match the settings.
    fn apply_connection(&self) {
        // An old connection is closed after the lock is let go: its thread
        // may be telling of a change (which takes the lock) as it ends.
        let old = {
            let mut inner = lock(&self.inner);
            inner.problem = None;
            let want = inner.settings.connect && !inner.settings.host.trim().is_empty();
            let addr = if want {
                match resolve(&inner.settings.host) {
                    Ok(a) => Some(a),
                    Err(e) => {
                        inner.problem = Some(e);
                        None
                    }
                }
            } else {
                None
            };
            match addr {
                None => inner.client.take(),
                Some(a) if inner.client.as_ref().is_some_and(|c| c.address() == a) => None,
                Some(a) => {
                    let notify = Arc::clone(&self.notify);
                    match Client::connect(a, Some(notify)) {
                        Ok(c) => inner.client.replace(c),
                        Err(e) => {
                            inner.problem = Some(e);
                            inner.client.take()
                        }
                    }
                }
            }
        };
        drop(old);
    }

    fn update_mirror(&self) {
        let inner = lock(&self.inner);
        let (connected, state) = match &inner.client {
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
        };
    }

    /// Something changed on the switcher (called from its thread): the tally mirror is updated.
    pub fn refresh(&self) {
        self.update_mirror();
    }

    pub fn status(&self) -> AtemStatus {
        let inner = lock(&self.inner);
        let (connection, detail, state) = match &inner.client {
            None => ("off", None, None),
            Some(c) => match c.status() {
                Status::Connecting => ("connecting", None, None),
                Status::Connected => ("connected", None, Some(c.state())),
                Status::Retrying(why) => ("retrying", Some(why), None),
            },
        };
        let detail = detail.or_else(|| inner.problem.clone());
        AtemStatus {
            settings: inner.settings.clone(),
            connection,
            detail,
            state,
        }
    }

    /// New settings (connects, reconnects or disconnects as needed).
    pub fn set(&self, mut settings: AtemSettings) -> AtemStatus {
        settings.host = settings.host.trim().to_owned();
        settings.mapping.retain(|r| !r.source_id.is_empty());
        settings.mapping.dedup_by(|a, b| a.source_id == b.source_id);
        self.save(&settings);
        lock(&self.inner).settings = settings;
        self.apply_connection();
        self.update_mirror();
        (self.notify)();
        self.status()
    }

    /// Send commands to the switcher.
    ///
    /// # Errors
    /// Not connected.
    pub fn send(&self, commands: Vec<Command>) -> Result<(), String> {
        let inner = lock(&self.inner);
        let c = inner
            .client
            .as_ref()
            .ok_or("Connect to the ATEM switcher first (Settings → ATEM switcher…).")?;
        c.send(commands)
    }

    /// Lumora's show changed: drive the ATEM when that is on.
    pub fn show_changed(&self, show: &Show) {
        let (now, transition) = Seen::of(show);
        let mut inner = lock(&self.inner);
        let prev = std::mem::replace(&mut inner.seen, now.clone());
        if !inner.settings.drive || prev == now {
            return;
        }
        let Some(c) = inner
            .client
            .as_ref()
            .filter(|c| c.status() == Status::Connected)
        else {
            return;
        };
        let cmds = drive(&prev, &now, transition, &inner.settings, &c.state());
        if !cmds.is_empty() {
            if let Err(e) = c.send(cmds) {
                eprintln!("lumora: ATEM: {e}");
            }
        }
    }

    /// The `atem` control command (`do=cut`, `do=program&input=2`…).
    ///
    /// # Errors
    /// What is wrong, for the person setting up the button.
    pub fn control(&self, q: &[(String, String)]) -> Result<(), String> {
        let state = lock(&self.inner)
            .client
            .as_ref()
            .map(Client::state)
            .unwrap_or_default();
        self.send(control_commands(q, &state)?)
    }
}

/// The value of `key` in a query.
fn param<'a>(q: &'a [(String, String)], key: &str) -> Option<&'a str> {
    q.iter()
        .find(|(k, _)| k.eq_ignore_ascii_case(key))
        .map(|(_, v)| v.as_str())
}

fn on_off(q: &[(String, String)]) -> Result<OnOff, String> {
    match param(q, "state")
        .unwrap_or("toggle")
        .to_ascii_lowercase()
        .as_str()
    {
        "on" | "1" | "true" => Ok(OnOff::On),
        "off" | "0" | "false" => Ok(OnOff::Off),
        "toggle" | "" => Ok(OnOff::Toggle),
        other => Err(format!("state must be on, off or toggle, not \"{other}\"")),
    }
}

fn number(q: &[(String, String)], key: &str) -> Result<u16, String> {
    param(q, key)
        .ok_or_else(|| format!("{key} is needed"))?
        .trim()
        .parse()
        .map_err(|_| format!("{key} must be a number"))
}

/// The commands an `atem` control command stands for.
///
/// # Errors
/// What is wrong.
pub fn control_commands(
    q: &[(String, String)],
    st: &SwitcherState,
) -> Result<Vec<Command>, String> {
    let me = st.me0();
    let what = param(q, "do").unwrap_or("").to_ascii_lowercase();
    // Keyers and macros are numbered from 1 for people, from 0 for the switcher.
    let index = |key: &str| number(q, key).map(|n| n.saturating_sub(1));
    let flip = |now: bool| -> Result<bool, String> {
        Ok(match on_off(q)? {
            OnOff::On => true,
            OnOff::Off => false,
            OnOff::Toggle => !now,
        })
    };
    Ok(match what.as_str() {
        "cut" => vec![Command::Cut { me: 0 }],
        "auto" => vec![Command::Auto { me: 0 }],
        "program" => vec![Command::Program { me: 0, input: number(q, "input")? }],
        "preview" => vec![Command::Preview { me: 0, input: number(q, "input")? }],
        "ftb" => {
            let want = flip(me.ftb_black)?;
            if want == me.ftb_black {
                Vec::new()
            } else {
                vec![Command::FadeToBlack { me: 0 }]
            }
        }
        "style" => {
            let style = match param(q, "style").unwrap_or("").to_ascii_lowercase().as_str() {
                "mix" => 0,
                "dip" => 1,
                "wipe" => 2,
                "dve" => 3,
                "stinger" | "sting" => 4,
                other => return Err(format!("style must be mix, dip, wipe, dve or stinger, not \"{other}\"")),
            };
            vec![Command::TransitionStyle { me: 0, style }]
        }
        "rate" => {
            let frames = u8::try_from(number(q, "frames")?.clamp(1, 250)).unwrap_or(30);
            vec![Command::MixRate { me: 0, frames }]
        }
        "dsk" => {
            let k = if param(q, "keyer").is_some() { index("keyer")? } else { 0 } as u8;
            if param(q, "state").is_some_and(|s| s.eq_ignore_ascii_case("auto")) {
                vec![Command::DskAuto { keyer: k }]
            } else {
                let now = st.dsks.get(usize::from(k)).is_some_and(|d| d.on_air);
                vec![Command::DskOnAir { keyer: k, on: flip(now)? }]
            }
        }
        "usk" => {
            let k = if param(q, "keyer").is_some() { index("keyer")? } else { 0 } as u8;
            let now = me.usk_on_air.get(usize::from(k)).copied().unwrap_or(false);
            vec![Command::UskOnAir { me: 0, keyer: k, on: flip(now)? }]
        }
        "macro" => match param(q, "name") {
            Some(name) if number(q, "number").is_err() => {
                let m = st
                    .macros
                    .iter()
                    .find(|m| m.name.eq_ignore_ascii_case(name.trim()))
                    .ok_or_else(|| format!("the ATEM has no macro called \"{name}\""))?;
                vec![Command::RunMacro { index: m.index }]
            }
            _ => vec![Command::RunMacro { index: index("number")? }],
        },
        "stopmacro" => vec![Command::StopMacro],
        other => {
            return Err(format!(
                "do must be cut, auto, program, preview, ftb, style, rate, dsk, usk, macro or stopmacro, not \"{other}\""
            ))
        }
    })
}

/// Light Lumora's inputs of the ATEM's cameras from the ATEM's tally, and
/// add the ATEM's own (`tally["atem"]`), when following it.
pub fn mirror_tally(tally: &mut Value, show: &Value) {
    let m = lock(mirror()).clone();
    mirror_into(tally, show, &m);
}

fn mirror_into(tally: &mut Value, show: &Value, m: &Mirror) {
    // Nothing added while no switcher is in use (the tally stays as it always was).
    if !m.settings.connect {
        return;
    }
    tally["atem"] = json!({
        "connected": m.connected,
        "program": m.connected.then(|| m.state.me0().program),
        "preview": m.connected.then(|| m.state.me0().preview),
        "programName": m.connected.then(|| m.state.input_name(m.state.me0().program)),
        "previewName": m.connected.then(|| m.state.input_name(m.state.me0().preview)),
    });
    if !(m.connected && m.settings.follow) {
        return;
    }
    let ids: Vec<Option<String>> = show["sources"]
        .as_array()
        .map(|a| {
            a.iter()
                .map(|s| s["id"].as_str().map(str::to_owned))
                .collect()
        })
        .unwrap_or_default();
    let Some(inputs) = tally["inputs"].as_array_mut() else {
        return;
    };
    // The ATEM's program counts as on air only while its output is on air in Lumora (when set).
    let carrier_on_air = m.settings.program_input.as_ref().is_none_or(|carrier| {
        inputs.iter().any(|i| {
            let n = i["number"].as_u64().unwrap_or(0) as usize;
            ids.get(n.wrapping_sub(1)).cloned().flatten().as_deref() == Some(carrier.as_str())
                && i["program"].as_bool().unwrap_or(false)
        })
    });
    for i in inputs.iter_mut() {
        let n = i["number"].as_u64().unwrap_or(0) as usize;
        let Some(id) = ids.get(n.wrapping_sub(1)).cloned().flatten() else {
            continue;
        };
        let Some(a) = m.settings.atem_input(Some(&id)) else {
            continue;
        };
        let t = m.state.tally_of(a);
        let program = i["program"].as_bool().unwrap_or(false) || (t.program && carrier_on_air);
        let preview = !program && (i["preview"].as_bool().unwrap_or(false) || t.preview);
        i["program"] = json!(program);
        i["preview"] = json!(preview);
        i["atem"] = json!(a);
    }
}

// ---------------------------------------------------------------------------
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
}

#[cfg(test)]
mod tests {
    use super::*;
    use lumora_atem::command::{block, split};

    fn atem(program: u16, preview: u16) -> SwitcherState {
        let mut s = SwitcherState::default();
        for b in [
            block(b"PrgI", &[0, 0, 0, program as u8]),
            block(b"PrvI", &[0, 0, 0, preview as u8, 0, 0, 0, 0]),
            block(b"TMxP", &[0, 30, 0, 0]),
            block(b"VidM", &[10, 0, 0, 0]),
        ] {
            s.apply(&split(&b)[0]);
        }
        s
    }

    fn settings() -> AtemSettings {
        AtemSettings {
            host: "10.0.0.9".into(),
            connect: true,
            drive: true,
            mapping: vec![
                MapRow {
                    source_id: "cam1".into(),
                    atem_input: 1,
                },
                MapRow {
                    source_id: "cam2".into(),
                    atem_input: 2,
                },
            ],
            ..AtemSettings::default()
        }
    }

    fn seen(program: &str, preview: &str, at: u64) -> Seen {
        Seen {
            program: Some(program.into()),
            preview: Some(preview.into()),
            blank: false,
            took_at: at,
        }
    }

    #[test]
    fn a_take_with_a_fade_becomes_the_atems_mix_at_lumoras_length() {
        let cmds = drive(
            &seen("cam1", "cam2", 1),
            &seen("cam2", "cam1", 2),
            Some((TransitionKind::Fade, 1000)),
            &settings(),
            &atem(1, 2),
        );
        // 1 s at 25 fps (1080p25) is 25 frames; the mix rate was 30.
        assert_eq!(
            cmds,
            vec![
                Command::Preview { me: 0, input: 2 },
                Command::MixRate { me: 0, frames: 25 },
                Command::Auto { me: 0 },
            ]
        );
        let dip = drive(
            &seen("cam1", "cam2", 1),
            &seen("cam2", "cam1", 2),
            Some((TransitionKind::Dip, 500)),
            &settings(),
            &atem(1, 2),
        );
        assert!(dip.contains(&Command::TransitionStyle { me: 0, style: 1 }));
        assert_eq!(dip.last(), Some(&Command::Auto { me: 0 }));
    }

    #[test]
    fn a_cut_or_cut_mode_puts_the_input_straight_on_program() {
        let mut s = settings();
        let cut = drive(
            &seen("cam1", "cam2", 1),
            &seen("cam2", "cam1", 2),
            Some((TransitionKind::Cut, 0)),
            &s,
            &atem(1, 2),
        );
        assert_eq!(cut[0], Command::Program { me: 0, input: 2 });
        s.drive_how = DriveHow::Cut;
        let cut = drive(
            &seen("cam1", "cam2", 1),
            &seen("cam2", "cam1", 2),
            Some((TransitionKind::Fade, 800)),
            &s,
            &atem(1, 2),
        );
        assert_eq!(cut[0], Command::Program { me: 0, input: 2 });
        // Then Lumora's Next (cam1) goes to the ATEM's preview.
        assert_eq!(cut.get(1), Some(&Command::Preview { me: 0, input: 1 }));
    }

    #[test]
    fn unmapped_inputs_and_no_change_send_nothing() {
        let s = settings();
        assert!(drive(
            &seen("cam1", "cam2", 1),
            &seen("slides", "cam2", 2),
            None,
            &s,
            &atem(1, 2)
        )
        .is_empty());
        assert!(drive(
            &seen("cam1", "cam2", 1),
            &seen("cam1", "cam2", 1),
            None,
            &s,
            &atem(1, 2)
        )
        .is_empty());
        // Already on the ATEM's program: nothing to do.
        assert!(drive(
            &seen("cam2", "cam1", 1),
            &seen("cam1", "cam2", 2),
            None,
            &s,
            &atem(1, 2)
        )
        .is_empty());
        // Only Next changed: the ATEM's preview follows.
        let next = drive(
            &seen("cam1", "slides", 1),
            &seen("cam1", "cam2", 1),
            None,
            &s,
            &atem(1, 3),
        );
        assert_eq!(next, vec![Command::Preview { me: 0, input: 2 }]);
    }

    #[test]
    fn lumoras_fade_to_black_fades_the_atem_when_asked() {
        let mut s = settings();
        let mut now = seen("cam1", "cam2", 1);
        now.blank = true;
        assert!(drive(&seen("cam1", "cam2", 1), &now, None, &s, &atem(1, 2)).is_empty());
        s.drive_blank = true;
        assert_eq!(
            drive(&seen("cam1", "cam2", 1), &now, None, &s, &atem(1, 2)),
            vec![Command::FadeToBlack { me: 0 }]
        );
    }

    #[test]
    fn control_commands_map_to_switcher_commands() {
        let q = |s: &str| crate::control::parse_query(s);
        let st = atem(1, 2);
        assert_eq!(
            control_commands(&q("do=cut"), &st).unwrap(),
            vec![Command::Cut { me: 0 }]
        );
        assert_eq!(
            control_commands(&q("do=program&input=4"), &st).unwrap(),
            vec![Command::Program { me: 0, input: 4 }]
        );
        assert_eq!(
            control_commands(&q("do=ftb&state=off"), &st).unwrap(),
            vec![]
        );
        assert_eq!(
            control_commands(&q("do=ftb"), &st).unwrap(),
            vec![Command::FadeToBlack { me: 0 }]
        );
        assert_eq!(
            control_commands(&q("do=dsk&keyer=1&state=on"), &st).unwrap(),
            vec![Command::DskOnAir { keyer: 0, on: true }]
        );
        assert_eq!(
            control_commands(&q("do=dsk&state=auto"), &st).unwrap(),
            vec![Command::DskAuto { keyer: 0 }]
        );
        assert_eq!(
            control_commands(&q("do=usk&keyer=2"), &st).unwrap(),
            vec![Command::UskOnAir {
                me: 0,
                keyer: 1,
                on: true
            }]
        );
        assert_eq!(
            control_commands(&q("do=macro&number=3"), &st).unwrap(),
            vec![Command::RunMacro { index: 2 }]
        );
        assert!(control_commands(&q("do=macro&name=Intro"), &st)
            .unwrap_err()
            .contains("no macro"));
        assert_eq!(
            control_commands(&q("do=style&style=wipe"), &st).unwrap(),
            vec![Command::TransitionStyle { me: 0, style: 2 }]
        );
        assert_eq!(
            control_commands(&q("do=rate&frames=500"), &st).unwrap(),
            vec![Command::MixRate { me: 0, frames: 250 }]
        );
        assert!(control_commands(&q("do=dance"), &st).is_err());
        assert!(control_commands(&q("do=program"), &st)
            .unwrap_err()
            .contains("input"));
    }

    #[test]
    fn the_atems_tally_lights_lumoras_inputs_of_its_cameras() {
        let show = json!({"sources": [{"id": "cam1"}, {"id": "cam2"}, {"id": "atem-pgm"}, {"id": "slides"}]});
        let base = json!({"inputs": [
            {"number": 1, "program": false, "preview": false},
            {"number": 2, "program": false, "preview": false},
            {"number": 3, "program": true, "preview": false},
            {"number": 4, "program": false, "preview": true},
        ]});
        let mut s = settings();
        s.program_input = Some("atem-pgm".into());
        let m = Mirror {
            connected: true,
            settings: s.clone(),
            state: atem(1, 2),
        };
        let mut t = base.clone();
        mirror_into(&mut t, &show, &m);
        assert_eq!(
            t["inputs"][0]["program"], true,
            "ATEM program, and its output is on air"
        );
        assert_eq!(t["inputs"][1]["preview"], true);
        assert_eq!(t["inputs"][3]["preview"], true, "Lumora's own tally stays");
        assert_eq!(t["atem"]["program"], 1);
        // The ATEM's output is not on air in Lumora: its cameras are not on air either.
        let mut t = base.clone();
        t["inputs"][2]["program"] = json!(false);
        mirror_into(&mut t, &show, &m);
        assert_eq!(t["inputs"][0]["program"], false);
        // Not following: only the summary.
        s.follow = false;
        let m = Mirror {
            connected: true,
            settings: s.clone(),
            state: atem(1, 2),
        };
        let mut t = base.clone();
        mirror_into(&mut t, &show, &m);
        assert_eq!(t["inputs"][0]["program"], false);
        assert_eq!(t["atem"]["connected"], true);
        // No switcher in use: the tally is untouched.
        s.connect = false;
        let m = Mirror {
            connected: false,
            settings: s,
            state: SwitcherState::default(),
        };
        let mut t = base.clone();
        mirror_into(&mut t, &show, &m);
        assert_eq!(t, base);
    }

    #[test]
    fn settings_are_kept_and_a_bad_address_says_so() {
        let dir = std::env::temp_dir().join(format!("lumora-atem-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let a = Atem::new(Some(&dir), Arc::new(|| {}));
        assert_eq!(a.status().connection, "off");
        let mut s = settings();
        s.host = "  ".into();
        let st = a.set(s.clone());
        assert_eq!(st.connection, "off");
        // An address that can't be used says why.
        s.host = "10.0.0.1:99999".into();
        let st = a.set(s.clone());
        assert_eq!(st.connection, "off");
        assert!(st.detail.unwrap().contains("Can't find"));
        s.host = "  ".into();
        a.set(s);
        let again = Atem::new(Some(&dir), Arc::new(|| {}));
        assert_eq!(again.status().settings.mapping.len(), 2);
        assert!(a
            .send(vec![Command::Cut { me: 0 }])
            .unwrap_err()
            .contains("Connect"));
        let _ = std::fs::remove_dir_all(&dir);
    }
}
