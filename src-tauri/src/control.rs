//! Control from other gear: simple web addresses for Bitfocus Companion,
//! Stream Deck (with a web request button), tally lights and scripts. Served
//! by the phone remote's server, with the same PIN:
//!
//! - `GET /api/do/take?screen=live&pin=1234` (every command also takes POST)
//! - `GET /api/tally?pin=1234`: what is on air and in Next, for tally lights.
//!
//! Inputs are named by their number as shown on the tiles (`input=3`) or by
//! name (`name=Camera%201`). Screens are `live` (the default) or `back`.
//!
//! The same commands come through the control API (`api.rs`: HTTP and
//! WebSocket with a token, and OSC). See docs/API.md.

use lumora_engine::action::Action;
use serde_json::{json, Value};

use crate::remote::AppCommand;

/// What a command turns into.
#[derive(Debug, Clone, PartialEq)]
pub enum Command {
    /// A change to the show (the engine does it).
    Show(Box<Action>),
    /// Recording, streaming or replay (the control window does it).
    App(AppCommand),
}

/// Where commands are carried out.
pub trait Target {
    /// The show as JSON (`None`: still starting).
    fn show(&self) -> Option<Value>;
    /// What the control window says is running (`{}` until it says).
    fn app_state(&self) -> Value;
    /// Change the show.
    ///
    /// # Errors
    /// Why the engine refused.
    fn apply(&self, action: Action) -> Result<(), String>;
    /// Pass a request on to the control window.
    ///
    /// # Errors
    /// The control window can't be reached.
    fn app_command(&self, command: AppCommand) -> Result<(), String>;
}

/// Run one command (`cmd` with its query pairs) against `t`.
///
/// # Errors
/// What is wrong, in words for the person setting up the button.
pub fn run(t: &dyn Target, cmd: &str, q: &[(String, String)]) -> Result<(), String> {
    let show = t.show().ok_or("Lumora is still starting")?;
    if cmd.eq_ignore_ascii_case("ptz") {
        let (cam, c) = ptz(&show, q)?;
        return crate::ptz::send(&cam, c);
    }
    if cmd.eq_ignore_ascii_case("atem") {
        return crate::atem::control(q);
    }
    match command_for(&show, &t.app_state(), cmd, q)? {
        Command::Show(a) => {
            if !crate::remote::allowed(&a) {
                return Err("that is not allowed from outside".to_owned());
            }
            t.apply(*a)
        }
        Command::App(c) => t.app_command(c),
    }
}

/// The commands, for the help page and for errors.
pub const COMMANDS: &[(&str, &str)] = &[
    ("take", "screen, transition (fade, dip, wipe…), ms"),
    ("cut", "screen"),
    ("preview", "input or name, screen"),
    ("cutto", "input or name, screen"),
    ("playnow", "input or name, screen, transition, ms"),
    ("blank", "screen, state (on, off, toggle)"),
    ("ftb", "screen"),
    ("overlay", "channel (1 – 4), state (on, off, toggle)"),
    ("overlaysoff", ""),
    ("play", "input or name"),
    ("pause", "input or name"),
    ("playpause", "input or name"),
    ("restart", "input or name"),
    ("playlist", "input or name, item (1, 2… or next, previous)"),
    ("nextcue", ""),
    ("preset", "number"),
    ("nextpreset", ""),
    ("previouspreset", ""),
    ("panic", "state (on, off, toggle)"),
    ("flash", ""),
    ("slide", "input or name, to (next, previous or a number)"),
    (
        "score",
        "input or name, team (home or away), add (1, -1, 3…)",
    ),
    ("scorereset", "input or name"),
    ("clock", "input or name, state (on, off, toggle)"),
    ("datarow", "to (next, previous or a row number)"),
    ("verse", "input or name, to (next, previous, blank)"),
    ("prompter", "do (start, stop, toggle, faster, slower, top)"),
    ("lyrics", "input or name, to (next, previous, blank or a number)"),
    ("record", "state (on, off, toggle)"),
    ("stream", "state (on, off, toggle)"),
    ("replay", "seconds (1 – 60), slow (1 for half speed)"),
    ("replaybuffer", "state (on, off, toggle)"),
    ("mark", ""),
    ("macro", "name, or number (1, 2…)"),
    ("stopmacros", ""),
    (
        "timer",
        "input or name (the main countdown if left out), do (start, pause, toggle, reset, add), minutes",
    ),
    ("ptz", "input or name, preset, move, zoom, speed"),
    (
        "titler",
        "input or name, field and value (or set.<field>=…), or do (next, previous, start, stop, toggle, reset) with field",
    ),
    (
        "atem",
        "do (cut, auto, program, preview, ftb, style, rate, dsk, usk, macro, stopmacro), input, keyer, number or name, state, style, frames",
    ),
];

/// The main parameter of each command, for senders that give values without
/// names (OSC: `/lumora/preview 3`).
#[must_use]
pub fn main_key(cmd: &str) -> &'static str {
    match cmd.to_ascii_lowercase().as_str() {
        "overlay" => "channel",
        "preset" => "number",
        "macro" => "name",
        "replay" => "seconds",
        "blank" | "panic" | "record" | "stream" | "replaybuffer" | "clock" => "state",
        "datarow" | "slide" | "verse" | "lyrics" => "to",
        "prompter" | "timer" | "atem" => "do",
        "take" | "cut" | "ftb" => "screen",
        _ => "input",
    }
}

fn app_state_on(app: &Value, key: &str, q: &[(String, String)]) -> Result<bool, String> {
    state(q, app[key].as_bool().unwrap_or(false))
}

/// The countdown a timer command is for: the one named, or the main one
/// (on air, else the first).
fn countdown(show: &Value, q: &[(String, String)]) -> Result<String, String> {
    if get(q, "input").is_some() || get(q, "name").is_some() {
        return input(show, q);
    }
    let cds: Vec<&Value> = sources(show)
        .iter()
        .filter(|s| s["kind"]["type"] == "countdown")
        .collect();
    let on_air = |s: &&&Value| {
        ["live", "back"]
            .iter()
            .any(|sc| show["screens"][sc]["program"] == s["id"])
    };
    cds.iter()
        .find(on_air)
        .or_else(|| cds.first())
        .and_then(|s| s["id"].as_str())
        .map(str::to_owned)
        .ok_or_else(|| "there is no countdown input".to_owned())
}

/// The command as an action, or a request for the control window.
///
/// # Errors
/// A message saying what is wrong with the command.
pub fn command_for(
    show: &Value,
    app: &Value,
    cmd: &str,
    q: &[(String, String)],
) -> Result<Command, String> {
    let c = cmd.to_ascii_lowercase();
    let app_cmd = match c.as_str() {
        "record" => Some(AppCommand::Record {
            on: app_state_on(app, "recording", q)?,
        }),
        "stream" => Some(AppCommand::Stream {
            on: app_state_on(app, "streaming", q)?,
        }),
        "replaybuffer" => Some(AppCommand::ReplayBuffer {
            on: app_state_on(app, "replay", q)?,
        }),
        "replay" => {
            let seconds: u32 = get(q, "seconds")
                .unwrap_or("8")
                .trim()
                .parse()
                .ok()
                .filter(|s| (1..=AppCommand::MAX_REPLAY_S).contains(s))
                .ok_or("seconds must be 1 – 60")?;
            let slow = matches!(get(q, "slow"), Some("1" | "true" | "on" | "yes"));
            Some(AppCommand::Replay { seconds, slow })
        }
        "mark" => Some(AppCommand::Mark),
        _ => None,
    };
    if let Some(a) = app_cmd {
        return Ok(Command::App(a));
    }
    let v = match c.as_str() {
        "macro" => {
            let key = get(q, "name")
                .or_else(|| get(q, "number"))
                .or_else(|| get(q, "id"))
                .ok_or("say which macro: name=Start show or number=1")?;
            let macros: Vec<lumora_engine::macros::Macro> =
                serde_json::from_value(show["macros"].clone()).unwrap_or_default();
            let m = lumora_engine::macros::find(&macros, key)
                .ok_or_else(|| format!("there is no macro called {key}"))?;
            json!({"type": "runMacro", "id": m.id})
        }
        "stopmacros" => json!({"type": "stopSteps"}),
        "timer" => {
            let id = countdown(show, q)?;
            let running = sources(show)
                .iter()
                .find(|s| s["id"] == json!(id))
                .is_some_and(|s| {
                    let t = &s["kind"]["timer"];
                    !t["startedAt"].is_null() && !t["paused"].as_bool().unwrap_or(false)
                });
            let minutes = || -> Result<f64, String> {
                get(q, "minutes")
                    .unwrap_or("1")
                    .trim()
                    .parse::<f64>()
                    .ok()
                    .filter(|m| m.is_finite() && m.abs() <= 600.0)
                    .ok_or_else(|| "minutes must be a number (-600 – 600)".to_owned())
            };
            match get(q, "do").unwrap_or("toggle") {
                "start" => json!({"type": "startCountdown", "id": id}),
                "pause" | "stop" => json!({"type": "pauseCountdown", "id": id}),
                "toggle" if running => json!({"type": "pauseCountdown", "id": id}),
                "toggle" => json!({"type": "startCountdown", "id": id}),
                "reset" => json!({"type": "resetCountdown", "id": id}),
                "add" => {
                    #[allow(clippy::cast_possible_truncation)]
                    let ms = (minutes()? * 60_000.0).round() as i64;
                    json!({"type": "addCountdownTime", "id": id, "ms": ms})
                }
                _ => return Err("do must be start, pause, toggle, reset or add".into()),
            }
        }
        _ => return command(show, cmd, q).map(|a| Command::Show(Box::new(a))),
    };
    serde_json::from_value(v)
        .map(|a| Command::Show(Box::new(a)))
        .map_err(|e| format!("could not make that command: {e}"))
}

fn get<'a>(q: &'a [(String, String)], key: &str) -> Option<&'a str> {
    q.iter().find(|(k, _)| k == key).map(|(_, v)| v.as_str())
}

/// Split a query string into decoded pairs.
#[must_use]
pub fn parse_query(query: &str) -> Vec<(String, String)> {
    query
        .split('&')
        .filter(|kv| !kv.is_empty())
        .map(|kv| {
            let (k, v) = kv.split_once('=').unwrap_or((kv, ""));
            (decode(k), decode(v))
        })
        .collect()
}

fn decode(s: &str) -> String {
    let b = s.as_bytes();
    let mut out = Vec::with_capacity(b.len());
    let mut i = 0;
    while i < b.len() {
        match b[i] {
            b'+' => out.push(b' '),
            b'%' if i + 2 < b.len() => {
                match std::str::from_utf8(&b[i + 1..i + 3])
                    .ok()
                    .and_then(|h| u8::from_str_radix(h, 16).ok())
                    .ok_or(())
                {
                    Ok(v) => {
                        out.push(v);
                        i += 2;
                    }
                    Err(_) => out.push(b'%'),
                }
            }
            c => out.push(c),
        }
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

fn screen(q: &[(String, String)]) -> Result<&'static str, String> {
    match get(q, "screen")
        .unwrap_or("live")
        .to_ascii_lowercase()
        .as_str()
    {
        "live" | "1" => Ok("live"),
        "back" | "2" => Ok("back"),
        other => Err(format!("unknown screen \"{other}\" (live or back)")),
    }
}

fn sources(show: &Value) -> &[Value] {
    show["sources"].as_array().map_or(&[], Vec::as_slice)
}

/// The id of the input named by `input=N` or `name=…`.
fn input(show: &Value, q: &[(String, String)]) -> Result<String, String> {
    let all = sources(show);
    let found = if let Some(n) = get(q, "input") {
        let n: usize = n
            .trim()
            .parse()
            .map_err(|_| format!("input must be a number, not \"{n}\""))?;
        n.checked_sub(1).and_then(|i| all.get(i))
    } else if let Some(name) = get(q, "name") {
        let name = name.trim().to_lowercase();
        all.iter().find(|s| {
            s["name"]
                .as_str()
                .is_some_and(|n| n.trim().to_lowercase() == name)
        })
    } else {
        return Err("say which input: input=3 or name=Camera 1".to_owned());
    };
    found
        .and_then(|s| s["id"].as_str())
        .map(str::to_owned)
        .ok_or_else(|| "there is no such input".to_owned())
}

/// on / off / toggle against the current value.
fn state(q: &[(String, String)], now: bool) -> Result<bool, String> {
    match get(q, "state")
        .unwrap_or("toggle")
        .to_ascii_lowercase()
        .as_str()
    {
        "on" | "1" | "true" => Ok(true),
        "off" | "0" | "false" => Ok(false),
        "toggle" | "" => Ok(!now),
        other => Err(format!("state must be on, off or toggle, not \"{other}\"")),
    }
}

fn transition(q: &[(String, String)], v: &mut Value) -> Result<(), String> {
    if let Some(t) = get(q, "transition") {
        // Checked by turning it into the engine's own type.
        serde_json::from_value::<lumora_engine::model::TransitionKind>(json!(t))
            .map_err(|_| format!("unknown transition \"{t}\""))?;
        v["transition"] = json!(t);
    }
    if let Some(ms) = get(q, "ms") {
        v["durationMs"] = json!(ms
            .parse::<u32>()
            .map_err(|_| "ms must be a number".to_owned())?);
    }
    Ok(())
}

/// The action a command asks for, given the show as it is now.
///
/// # Errors
/// A message saying what is wrong with the command.
pub fn command(show: &Value, cmd: &str, q: &[(String, String)]) -> Result<Action, String> {
    let v = match cmd.to_ascii_lowercase().as_str() {
        "take" => {
            let mut v = json!({"type": "take", "screen": screen(q)?});
            transition(q, &mut v)?;
            v
        }
        "cut" => json!({"type": "take", "screen": screen(q)?, "transition": "cut"}),
        "preview" => {
            json!({"type": "setPreview", "screen": screen(q)?, "sourceId": input(show, q)?})
        }
        "cutto" => json!({"type": "cutTo", "screen": screen(q)?, "sourceId": input(show, q)?}),
        "playnow" => {
            let t = &show["transition"];
            let mut v = json!({"type": "take"});
            transition(q, &mut v)?;
            json!({
                "type": "playNow",
                "screen": screen(q)?,
                "sourceId": input(show, q)?,
                "transition": {
                    "kind": v.get("transition").unwrap_or(&t["kind"]),
                    "durationMs": v.get("durationMs").unwrap_or(&t["durationMs"]),
                },
            })
        }
        "blank" => {
            let sc = screen(q)?;
            let now = show["screens"][sc]["blank"].as_bool().unwrap_or(false);
            json!({"type": "setBlank", "screens": [sc], "value": state(q, now)?})
        }
        "ftb" => json!({"type": "fadeToBlack", "screen": screen(q)?}),
        "overlay" => {
            let n: usize = get(q, "channel")
                .unwrap_or("1")
                .parse()
                .map_err(|_| "channel must be 1 – 4".to_owned())?;
            let ch = n
                .checked_sub(1)
                .filter(|&c| c < 4)
                .ok_or("channel must be 1 – 4")?;
            let now = show["overlays"][ch]["on"].as_bool().unwrap_or(false);
            json!({"type": "setOverlayOn", "channel": ch, "value": state(q, now)?})
        }
        "overlaysoff" => json!({"type": "overlaysOff"}),
        "play" => json!({"type": "play", "id": input(show, q)?}),
        "pause" => json!({"type": "pause", "id": input(show, q)?}),
        "playpause" => {
            let id = input(show, q)?;
            let playing = sources(show)
                .iter()
                .find(|s| s["id"] == json!(id))
                .and_then(|s| s["kind"]["playback"]["playing"].as_bool())
                .unwrap_or(false);
            json!({"type": if playing { "pause" } else { "play" }, "id": id})
        }
        "restart" => json!({"type": "seek", "id": input(show, q)?, "posS": 0.0}),
        "playlist" => {
            let id = input(show, q)?;
            let src = sources(show).iter().find(|s| s["id"] == json!(id));
            let list = src
                .map(|s| &s["playlist"])
                .filter(|p| p.is_object())
                .ok_or("that input is not a playlist")?;
            let len = list["items"].as_array().map_or(0, Vec::len);
            let cur = list["current"].as_u64().unwrap_or(0) as usize;
            let item = match get(q, "item").unwrap_or("next") {
                "next" => (cur + 1) % len.max(1),
                "previous" | "prev" => (cur + len.max(1) - 1) % len.max(1),
                n => n
                    .parse::<usize>()
                    .ok()
                    .and_then(|n| n.checked_sub(1))
                    .ok_or("item must be next, previous or a number")?,
            };
            json!({"type": "playlistGo", "id": id, "index": item})
        }
        "nextcue" => json!({"type": "nextCue"}),
        "preset" => {
            let n: usize = get(q, "number")
                .unwrap_or("")
                .parse()
                .map_err(|_| "number must be a preset number (1, 2…)".to_owned())?;
            let p = show["presets"]
                .as_array()
                .and_then(|a| n.checked_sub(1).and_then(|i| a.get(i)))
                .and_then(|p| p["id"].as_str())
                .ok_or("there is no such preset")?;
            json!({"type": "pickPreset", "id": p})
        }
        "nextpreset" => json!({"type": "nextPreset"}),
        "previouspreset" => json!({"type": "previousPreset"}),
        "panic" => {
            let now = show["panic"].as_bool().unwrap_or(false);
            json!({"type": "panic", "value": state(q, now)?})
        }
        "flash" => json!({"type": "monitorFlash"}),
        "slide" => {
            let id = input(show, q)?;
            match get(q, "to").unwrap_or("next") {
                "next" => json!({"type": "slideNext", "id": id}),
                "previous" | "prev" => json!({"type": "slidePrevious", "id": id}),
                n => {
                    let i = n
                        .parse::<usize>()
                        .ok()
                        .and_then(|n| n.checked_sub(1))
                        .ok_or("to must be next, previous or a number")?;
                    json!({"type": "slideGo", "id": id, "index": i})
                }
            }
        }
        "prompter" => {
            let p = &show["monitor"]["prompter"];
            let running = !p["since"].is_null();
            let speed = p["speed"].as_f64().unwrap_or(4.0);
            match get(q, "do").unwrap_or("toggle") {
                "start" => json!({"type": "prompterRun", "run": true}),
                "stop" => json!({"type": "prompterRun", "run": false}),
                "toggle" => json!({"type": "prompterRun", "run": !running}),
                "faster" => json!({"type": "prompterSpeed", "speed": speed * 1.2}),
                "slower" => json!({"type": "prompterSpeed", "speed": speed / 1.2}),
                "top" => json!({"type": "prompterJump", "pos": 0.0}),
                _ => return Err("do must be start, stop, toggle, faster, slower or top".into()),
            }
        }
        "datarow" => match get(q, "to").unwrap_or("next") {
            "next" => json!({"type": "dataStep", "delta": 1}),
            "previous" | "prev" => json!({"type": "dataStep", "delta": -1}),
            n => {
                let row = n
                    .parse::<usize>()
                    .ok()
                    .and_then(|n| n.checked_sub(1))
                    .ok_or("to must be next, previous or a row number")?;
                json!({"type": "dataRow", "row": row})
            }
        },
        "verse" => {
            let id = input(show, q)?;
            match get(q, "to").unwrap_or("next") {
                "next" => json!({"type": "scriptureStep", "id": id, "delta": 1}),
                "previous" | "prev" => json!({"type": "scriptureStep", "id": id, "delta": -1}),
                "blank" => {
                    let now = sources(show)
                        .iter()
                        .find(|s| s["id"] == json!(id))
                        .and_then(|s| s["kind"]["blank"].as_bool())
                        .unwrap_or(false);
                    json!({"type": "scriptureBlank", "id": id, "value": !now})
                }
                _ => return Err("to must be next, previous or blank".into()),
            }
        }
        "lyrics" => {
            let id = input(show, q)?;
            match get(q, "to").unwrap_or("next") {
                "next" => json!({"type": "lyricsNext", "id": id}),
                "previous" | "prev" => json!({"type": "lyricsPrevious", "id": id}),
                "blank" => {
                    let now = sources(show)
                        .iter()
                        .find(|s| s["id"] == json!(id))
                        .and_then(|s| s["kind"]["blank"].as_bool())
                        .unwrap_or(false);
                    json!({"type": "lyricsBlank", "id": id, "value": !now})
                }
                n => {
                    let i = n
                        .parse::<usize>()
                        .ok()
                        .and_then(|n| n.checked_sub(1))
                        .ok_or("to must be next, previous, blank or a number")?;
                    json!({"type": "lyricsGo", "id": id, "index": i})
                }
            }
        }
        "score" => {
            let id = input(show, q)?;
            let side = match get(q, "team")
                .unwrap_or("home")
                .to_ascii_lowercase()
                .as_str()
            {
                "home" | "1" => "home",
                "away" | "2" => "away",
                t => return Err(format!("team must be home or away, not \"{t}\"")),
            };
            let delta: i32 = get(q, "add")
                .unwrap_or("1")
                .parse()
                .map_err(|_| "add must be a number".to_owned())?;
            json!({"type": "score", "id": id, "side": side, "delta": delta})
        }
        "scorereset" => json!({"type": "scoreReset", "id": input(show, q)?}),
        "titler" => titler(show, q, now_ms())?,
        "clock" => {
            let id = input(show, q)?;
            let running = sources(show)
                .iter()
                .find(|s| s["id"] == json!(id))
                .is_some_and(|s| !s["kind"]["clock"]["since"].is_null());
            json!({"type": "scoreClock", "id": id, "run": state(q, running)?})
        }
        other => {
            let names: Vec<&str> = COMMANDS.iter().map(|(n, _)| *n).collect();
            return Err(format!(
                "unknown command \"{other}\"; try: {}",
                names.join(", ")
            ));
        }
    };
    serde_json::from_value(v).map_err(|e| format!("could not make that command: {e}"))
}

fn now_ms() -> f64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0.0, |d| d.as_secs_f64() * 1000.0)
}

/// "10:00", "1:02:03", "45.5" or "600" as seconds.
fn parse_clock(text: &str) -> Option<f64> {
    let t = text.trim();
    if t.is_empty() {
        return None;
    }
    let (neg, t) = t.strip_prefix('-').map_or((false, t), |r| (true, r));
    let mut secs = 0.0;
    for part in t.split(':') {
        let v: f64 = part.parse().ok()?;
        secs = secs * 60.0 + v;
    }
    Some(if neg { -secs } else { secs })
}

/// A Lumora Titler graphic's fields, data rows and timers (see
/// titler/src/core/timer.ts for how a timer's value is written).
fn titler(show: &Value, q: &[(String, String)], now: f64) -> Result<Value, String> {
    let id = input(show, q)?;
    let src = sources(show)
        .iter()
        .find(|s| s["id"] == json!(id))
        .ok_or("there is no such input")?;
    let k = &src["kind"];
    if k["type"] != json!("titler") {
        return Err("that input is not a Lumora Titler graphic".to_owned());
    }
    if let Some(d) = get(q, "do") {
        return match d {
            "next" => Ok(json!({"type": "titlerDataStep", "id": id, "delta": 1})),
            "previous" | "prev" => Ok(json!({"type": "titlerDataStep", "id": id, "delta": -1})),
            "start" | "stop" | "toggle" | "reset" => {
                let template: Value = serde_json::from_str(k["template"].as_str().unwrap_or(""))
                    .map_err(|_| "that graphic has no template".to_owned())?;
                let field = get(q, "field");
                let var = template["variables"]
                    .as_array()
                    .and_then(|vs| {
                        vs.iter().find(|v| {
                            v["type"] == json!("timer")
                                && field.is_none_or(|f| v["key"].as_str() == Some(f))
                        })
                    })
                    .ok_or("that graphic has no such timer field")?;
                let key = var["key"].as_str().unwrap_or_default();
                let sample = var["value"].as_str().unwrap_or("0");
                let current = k["values"]
                    .as_array()
                    .and_then(|vs| vs.iter().find(|v| v["key"].as_str() == Some(key)))
                    .and_then(|v| v["value"].as_str())
                    .unwrap_or(sample);
                let up = var["timer"]["dir"] == json!("up");
                let stop = var["timer"]["stop"]
                    .as_f64()
                    .or(if up { None } else { Some(0.0) });
                let (secs, since) = match current.rsplit_once('@') {
                    Some((s, t)) => match (parse_clock(s), t.trim().parse::<f64>()) {
                        (Some(s), Ok(t)) => (s, Some(t)),
                        _ => (parse_clock(current).unwrap_or(0.0), None),
                    },
                    None => (parse_clock(current).unwrap_or(0.0), None),
                };
                let passed = since.map_or(0.0, |t| ((now - t) / 1000.0).max(0.0));
                let mut shown = if up { secs + passed } else { secs - passed };
                if let Some(s) = stop {
                    shown = if up { shown.min(s) } else { shown.max(s) };
                }
                let shown = (shown * 1000.0).round() / 1000.0;
                let running = since.is_some();
                let value = match (d, running) {
                    ("reset", _) => {
                        let first = parse_clock(sample).unwrap_or(0.0);
                        format!("{first}")
                    }
                    ("start", true) | ("stop", false) => current.to_owned(),
                    ("start" | "toggle", false) => format!("{shown}@{}", now.round()),
                    _ => format!("{shown}"),
                };
                Ok(
                    json!({"type": "setTitlerValues", "id": id, "values": [{"key": key, "value": value}]}),
                )
            }
            _ => Err("do must be next, previous, start, stop, toggle or reset".to_owned()),
        };
    }
    let mut values = Vec::new();
    if let Some(f) = get(q, "field") {
        values.push(json!({"key": f, "value": get(q, "value").unwrap_or("")}));
    }
    for (name, v) in q {
        if let Some(f) = name.strip_prefix("set.") {
            values.push(json!({"key": f, "value": v}));
        }
    }
    if values.is_empty() {
        return Err(
            "say what to change: field=name&value=Ada, set.name=Ada, or do=next".to_owned(),
        );
    }
    Ok(json!({"type": "setTitlerValues", "id": id, "values": values}))
}

/// A PTZ camera and what to make it do.
///
/// # Errors
/// A message saying what is wrong with the command.
pub fn ptz(
    show: &Value,
    q: &[(String, String)],
) -> Result<(lumora_engine::ptz::Ptz, crate::ptz::PtzCommand), String> {
    use crate::ptz::PtzCommand as C;
    let id = input(show, q)?;
    let cam = sources(show)
        .iter()
        .find(|s| s["id"] == json!(id))
        .and_then(|s| serde_json::from_value::<lumora_engine::ptz::Ptz>(s["ptz"].clone()).ok())
        .ok_or("that input is not set up as a PTZ camera")?;
    #[allow(clippy::cast_precision_loss)]
    let speed = get(q, "speed")
        .and_then(|v| v.parse::<u32>().ok())
        .map_or(0.5, |v| v.min(100) as f32 / 100.0);
    let cmd = if let Some(n) = get(q, "preset") {
        let n: u8 = n
            .parse()
            .ok()
            .filter(|n| (1..=128).contains(n))
            .ok_or("preset must be 1 – 128")?;
        if get(q, "store") == Some("1") {
            C::Store { preset: n - 1 }
        } else {
            C::Recall { preset: n - 1 }
        }
    } else if let Some(m) = get(q, "move") {
        let (pan, tilt) = match m {
            "up" => (0.0, 1.0),
            "down" => (0.0, -1.0),
            "left" => (-1.0, 0.0),
            "right" => (1.0, 0.0),
            "stop" => return Ok((cam, C::Stop)),
            "home" => return Ok((cam, C::Home)),
            _ => return Err("move must be up, down, left, right, stop or home".to_owned()),
        };
        C::Move { pan, tilt, speed }
    } else if let Some(z) = get(q, "zoom") {
        let dir = match z {
            "in" => 1,
            "out" => -1,
            "stop" => 0,
            _ => return Err("zoom must be in, out or stop".to_owned()),
        };
        C::Zoom { dir, speed }
    } else {
        return Err("say what to do: preset=1, move=left or zoom=in".to_owned());
    };
    Ok((cam, cmd))
}

/// What is on air and in Next on each screen, each input's tally, and
/// whether Lumora is recording and live (`app`: the control window's state).
#[must_use]
pub fn tally(show: &Value, app: &Value) -> Value {
    let on = |sc: &str, key: &str| show["screens"][sc][key].as_str().map(str::to_owned);
    let number = |id: &Option<String>| {
        id.as_ref()
            .and_then(|id| {
                sources(show)
                    .iter()
                    .position(|s| s["id"].as_str() == Some(id))
            })
            .map(|i| i + 1)
    };
    let name = |id: &Option<String>| {
        id.as_ref()
            .and_then(|id| sources(show).iter().find(|s| s["id"].as_str() == Some(id)))
            .and_then(|s| s["name"].as_str())
            .map(str::to_owned)
    };
    let screen = |sc: &str| {
        let (p, n) = (on(sc, "program"), on(sc, "preview"));
        json!({
            "program": number(&p), "programName": name(&p),
            "preview": number(&n), "previewName": name(&n),
            "blank": show["screens"][sc]["blank"].as_bool().unwrap_or(false),
        })
    };
    let programs = [on("live", "program"), on("back", "program")];
    let previews = [on("live", "preview"), on("back", "preview")];
    // Inputs in an overlay that is on are on air too.
    let overlaid: Vec<&str> = show["overlays"]
        .as_array()
        .map(|a| {
            a.iter()
                .filter(|o| o["on"].as_bool().unwrap_or(false))
                .filter_map(|o| o["sourceId"].as_str())
                .collect()
        })
        .unwrap_or_default();
    let panic = show["panic"].as_bool().unwrap_or(false);
    let inputs: Vec<Value> = sources(show)
        .iter()
        .enumerate()
        .map(|(i, s)| {
            let id = s["id"].as_str().map(str::to_owned);
            let overlay = id.as_deref().is_some_and(|x| overlaid.contains(&x));
            let program = !panic && (programs.contains(&id) || overlay);
            json!({
                "number": i + 1,
                "name": s["name"],
                "program": program,
                "preview": !program && previews.contains(&id),
                "overlay": overlay,
            })
        })
        .collect();
    let overlays: Vec<bool> = show["overlays"]
        .as_array()
        .map(|a| {
            a.iter()
                .map(|o| o["on"].as_bool().unwrap_or(false))
                .collect()
        })
        .unwrap_or_default();
    json!({
        "live": screen("live"),
        "back": screen("back"),
        "inputs": inputs,
        "overlays": overlays,
        "panic": panic,
        "recording": app["recording"].as_bool().unwrap_or(false),
        "streaming": app["streaming"].as_bool().unwrap_or(false),
        "rehearsal": app["rehearsal"].as_bool().unwrap_or(false),
        "replay": app["replay"].as_bool().unwrap_or(false),
        // Which try at reconnecting a dropped stream (0: not reconnecting).
        "reconnecting": app["reconnecting"].as_u64().unwrap_or(0),
    })
}

/// One input's tally as a word, for the simplest tally lights:
/// `program`, `preview` or `off`.
#[must_use]
pub fn tally_word(tally: &Value, number: usize) -> Option<&'static str> {
    let input = tally["inputs"]
        .as_array()?
        .iter()
        .find(|i| i["number"].as_u64() == u64::try_from(number).ok())?;
    Some(if input["program"].as_bool().unwrap_or(false) {
        "program"
    } else if input["preview"].as_bool().unwrap_or(false) {
        "preview"
    } else {
        "off"
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn show() -> Value {
        json!({
            "sources": [
                {"id": "a", "name": "Camera 1", "kind": {"type": "camera"}},
                {"id": "b", "name": "Intro", "kind": {"type": "video", "playback": {"playing": true}}, "playlist": {"items": [{}, {}, {}], "current": 2}},
            ],
            "screens": {"live": {"program": "a", "preview": "b", "blank": false}, "back": {"program": null, "preview": null, "blank": true}},
            "overlays": [{"on": false}, {"on": true}, {"on": false}, {"on": false}],
            "transition": {"kind": "fade", "durationMs": 800},
            "presets": [{"id": "p1"}],
            "panic": false,
        })
    }

    fn cmd(c: &str, q: &str) -> Result<Value, String> {
        command(&show(), c, &parse_query(q)).map(|a| serde_json::to_value(a).unwrap())
    }

    #[test]
    fn commands_become_engine_actions() {
        let take = cmd("take", "").unwrap();
        assert_eq!(
            (&take["type"], &take["screen"]),
            (&json!("take"), &json!("live"))
        );
        assert_eq!(
            cmd("take", "screen=back&transition=wipe&ms=500").unwrap()["durationMs"],
            json!(500)
        );
        assert!(cmd("take", "transition=sparkles")
            .unwrap_err()
            .contains("sparkles"));
        assert_eq!(cmd("preview", "input=2").unwrap()["sourceId"], json!("b"));
        assert_eq!(
            cmd("cutto", "name=camera%201").unwrap()["sourceId"],
            json!("a")
        );
        assert_eq!(
            cmd("CutTo", "name=Camera+1").unwrap()["sourceId"],
            json!("a")
        );
        assert!(cmd("preview", "input=9").is_err());
        assert_eq!(cmd("blank", "").unwrap()["value"], json!(true));
        assert_eq!(cmd("blank", "screen=back").unwrap()["value"], json!(false));
        assert_eq!(
            cmd("overlay", "channel=2").unwrap(),
            json!({"type": "setOverlayOn", "channel": 1, "value": false})
        );
        assert!(cmd("overlay", "channel=5").is_err());
        assert_eq!(cmd("playpause", "input=2").unwrap()["type"], json!("pause"));
        assert_eq!(cmd("playlist", "input=2").unwrap()["index"], json!(0));
        assert_eq!(
            cmd("playlist", "input=2&item=previous").unwrap()["index"],
            json!(1)
        );
        assert!(cmd("playlist", "input=1").is_err());
        assert_eq!(cmd("preset", "number=1").unwrap()["id"], json!("p1"));
        assert_eq!(
            cmd("playnow", "input=2").unwrap()["transition"],
            json!({"kind": "fade", "durationMs": 800})
        );
        assert!(cmd("dance", "").unwrap_err().contains("take"));
    }

    #[test]
    fn titler_fields_rows_and_timers() {
        let template = json!({"variables": [
            {"key": "name", "type": "text", "value": "Ada"},
            {"key": "clock", "type": "timer", "value": "10:00", "timer": {"dir": "down"}}
        ]})
        .to_string();
        let mut s = show();
        s["sources"].as_array_mut().unwrap().push(json!({
            "id": "t", "name": "Lower third",
            "kind": {"type": "titler", "template": template, "values": [{"key": "clock", "value": "600@1000"}]}
        }));
        let q = parse_query;
        assert_eq!(
            titler(&s, &q("name=Lower+third&field=name&value=Grace"), 0.0).unwrap(),
            json!({"type": "setTitlerValues", "id": "t", "values": [{"key": "name", "value": "Grace"}]})
        );
        assert_eq!(
            titler(&s, &q("name=Lower+third&set.name=Grace&set.role=Host"), 0.0).unwrap()["values"]
                [1],
            json!({"key": "role", "value": "Host"})
        );
        assert_eq!(
            titler(&s, &q("name=Lower+third&do=next"), 0.0).unwrap(),
            json!({"type": "titlerDataStep", "id": "t", "delta": 1})
        );
        // Running since 1000 ms: stopped 61 s later it shows 539 s.
        assert_eq!(
            titler(&s, &q("name=Lower+third&do=stop"), 62_000.0).unwrap()["values"][0]["value"],
            json!("539")
        );
        assert_eq!(
            titler(&s, &q("name=Lower+third&do=reset"), 62_000.0).unwrap()["values"][0]["value"],
            json!("600")
        );
        assert!(titler(&s, &q("name=Lower+third"), 0.0).is_err());
        assert!(titler(&s, &q("input=1&field=x&value=y"), 0.0).is_err());
        assert_eq!(parse_clock("1:02:03"), Some(3723.0));
        assert!(serde_json::from_value::<Action>(
            titler(&s, &q("name=Lower+third&do=toggle"), 5.0).unwrap()
        )
        .is_ok());
    }

    #[test]
    fn tally_says_what_is_on_air_and_next() {
        let t = tally(&show(), &json!({"recording": true}));
        assert_eq!(t["live"]["program"], json!(1));
        assert_eq!(t["live"]["previewName"], json!("Intro"));
        assert_eq!(t["inputs"][0]["program"], json!(true));
        assert_eq!(t["inputs"][1]["preview"], json!(true));
        assert_eq!(t["overlays"], json!([false, true, false, false]));
        assert_eq!(t["back"]["blank"], json!(true));
        assert_eq!(t["recording"], json!(true));
        assert_eq!(t["streaming"], json!(false));
        assert_eq!(tally_word(&t, 1), Some("program"));
        assert_eq!(tally_word(&t, 2), Some("preview"));
        assert_eq!(tally_word(&t, 3), None);
    }

    #[test]
    fn an_input_in_an_overlay_that_is_on_is_on_air_and_panic_clears_the_tally() {
        let mut s = show();
        s["overlays"][1]["sourceId"] = json!("b");
        let t = tally(&s, &json!({}));
        assert_eq!(t["inputs"][1]["program"], json!(true));
        assert_eq!(t["inputs"][1]["overlay"], json!(true));
        s["panic"] = json!(true);
        let t = tally(&s, &json!({}));
        assert_eq!(t["inputs"][0]["program"], json!(false));
    }

    fn app_cmd(c: &str, q: &str, app: &Value) -> Result<Command, String> {
        command_for(&show(), app, c, &parse_query(q))
    }

    #[test]
    fn recording_streaming_and_replay_go_to_the_control_window() {
        let idle = json!({"recording": false, "streaming": false});
        let busy = json!({"recording": true, "streaming": true});
        assert_eq!(
            app_cmd("record", "", &idle),
            Ok(Command::App(AppCommand::Record { on: true }))
        );
        assert_eq!(
            app_cmd("record", "", &busy),
            Ok(Command::App(AppCommand::Record { on: false }))
        );
        assert_eq!(
            app_cmd("stream", "state=on", &busy),
            Ok(Command::App(AppCommand::Stream { on: true }))
        );
        assert_eq!(
            app_cmd("replay", "seconds=10&slow=1", &idle),
            Ok(Command::App(AppCommand::Replay {
                seconds: 10,
                slow: true
            }))
        );
        assert!(app_cmd("replay", "seconds=90", &idle).is_err());
        assert_eq!(
            app_cmd("mark", "", &busy),
            Ok(Command::App(AppCommand::Mark))
        );
    }

    #[test]
    fn macros_run_by_name_or_number_and_timers_by_input() {
        let mut s = show();
        s["macros"] = json!([{"id": "m1", "name": "Start show", "steps": [], "hotkey": ""}]);
        s["sources"].as_array_mut().unwrap().push(
            json!({"id": "cd", "name": "Countdown", "kind": {"type": "countdown", "timer": {"startedAt": null}}}),
        );
        let run = |c: &str, q: &str| {
            command_for(&s, &json!({}), c, &parse_query(q)).map(|c| match c {
                Command::Show(a) => serde_json::to_value(a).unwrap(),
                Command::App(_) => Value::Null,
            })
        };
        assert_eq!(
            run("macro", "name=start%20show").unwrap()["id"],
            json!("m1")
        );
        assert_eq!(run("macro", "number=1").unwrap()["id"], json!("m1"));
        assert!(run("macro", "name=nope").is_err());
        assert_eq!(
            run("timer", "do=start").unwrap()["type"],
            json!("startCountdown")
        );
        assert_eq!(run("timer", "").unwrap()["id"], json!("cd"));
        let add = run("timer", "do=add&minutes=-2").unwrap();
        assert_eq!(
            (&add["type"], &add["ms"]),
            (&json!("addCountdownTime"), &json!(-120_000))
        );
        assert_eq!(run("cut", "").unwrap()["transition"], json!("cut"));
        assert_eq!(main_key("Preview"), "input");
        assert_eq!(main_key("overlay"), "channel");
    }

    #[test]
    fn ptz_commands_need_a_ptz_camera() {
        let mut s = show();
        assert!(ptz(&s, &parse_query("input=1&preset=2"))
            .unwrap_err()
            .contains("PTZ"));
        s["sources"][0]["ptz"] =
            json!({"host": "10.0.0.9", "port": 0, "protocol": "viscaUdp", "presets": []});
        let (cam, cmd) = ptz(&s, &parse_query("input=1&preset=2")).unwrap();
        assert_eq!(cam.host, "10.0.0.9");
        assert_eq!(cmd, crate::ptz::PtzCommand::Recall { preset: 1 });
        assert_eq!(
            ptz(&s, &parse_query("input=1&preset=2&store=1")).unwrap().1,
            crate::ptz::PtzCommand::Store { preset: 1 }
        );
        assert_eq!(
            ptz(&s, &parse_query("input=1&move=stop")).unwrap().1,
            crate::ptz::PtzCommand::Stop
        );
        assert!(matches!(
            ptz(&s, &parse_query("input=1&zoom=in&speed=100"))
                .unwrap()
                .1,
            crate::ptz::PtzCommand::Zoom { dir: 1, .. }
        ));
        assert!(ptz(&s, &parse_query("input=1&preset=0")).is_err());
        assert!(ptz(&s, &parse_query("input=1")).is_err());
    }

    #[test]
    fn decodes_addresses() {
        assert_eq!(decode("a%20b+c%2"), "a b c%2");
        assert_eq!(decode("%D7%A9"), "ש");
    }
}
