import sys
p = sys.argv[1] + '/src-tauri/src/control.rs'
s = open(p).read()

def rep(old, new):
    global s
    if old not in s:
        raise SystemExit('missing: ' + old[:80])
    s = s.replace(old, new, 1)

rep('''//! Inputs are named by their number as shown on the tiles (`input=3`) or by
//! name (`name=Camera%201`). Screens are `live` (the default) or `back`.

use lumora_engine::action::Action;
use serde_json::{json, Value};
''', '''//! Inputs are named by their number as shown on the tiles (`input=3`) or by
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
    Show(Action),
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
    match command_for(&show, &t.app_state(), cmd, q)? {
        Command::Show(a) => {
            if !crate::remote::allowed(&a) {
                return Err("that is not allowed from outside".to_owned());
            }
            t.apply(a)
        }
        Command::App(c) => t.app_command(c),
    }
}
''')

rep('''    ("prompter", "do (start, stop, toggle, faster, slower, top)"),
];''', '''    ("prompter", "do (start, stop, toggle, faster, slower, top)"),
    ("lyrics", "input or name, to (next, previous, blank or a number)"),
    ("record", "state (on, off, toggle)"),
    ("stream", "state (on, off, toggle)"),
    ("replay", "seconds (1 – 60), slow (1 for half speed)"),
    ("replaybuffer", "state (on, off, toggle)"),
    ("macro", "name, or number (1, 2…)"),
    ("stopmacros", ""),
    (
        "timer",
        "input or name (the main countdown if left out), do (start, pause, toggle, reset, add), minutes",
    ),
    ("ptz", "input or name, preset, move, zoom, speed"),
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
        "prompter" | "timer" => "do",
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
        _ => return command(show, cmd, q).map(Command::Show),
    };
    serde_json::from_value(v)
        .map(Command::Show)
        .map_err(|e| format!("could not make that command: {e}"))
}''')

rep('''/// What is on air and in Next on each screen, and each input's tally.
#[must_use]
pub fn tally(show: &Value) -> Value {''', '''/// What is on air and in Next on each screen, each input's tally, and
/// whether Lumora is recording and live (`app`: the control window's state).
#[must_use]
pub fn tally(show: &Value, app: &Value) -> Value {''')

rep('''    let inputs: Vec<Value> = sources(show)
        .iter()
        .enumerate()
        .map(|(i, s)| {
            let id = s["id"].as_str().map(str::to_owned);
            let program = programs.contains(&id);
            json!({
                "number": i + 1,
                "name": s["name"],
                "program": program,
                "preview": !program && previews.contains(&id),
            })
        })
        .collect();''', '''    // Inputs in an overlay that is on are on air too.
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
        .collect();''')

rep('''        "overlays": overlays,
        "panic": show["panic"].as_bool().unwrap_or(false),
    })
}''', '''        "overlays": overlays,
        "panic": panic,
        "recording": app["recording"].as_bool().unwrap_or(false),
        "streaming": app["streaming"].as_bool().unwrap_or(false),
        "rehearsal": app["rehearsal"].as_bool().unwrap_or(false),
        "replay": app["replay"].as_bool().unwrap_or(false),
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
}''')

rep('''        let t = tally(&show());''', '''        let t = tally(&show(), &json!({"recording": true}));''')

rep('''        assert_eq!(t["back"]["blank"], json!(true));
    }''', '''        assert_eq!(t["back"]["blank"], json!(true));
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
        assert_eq!(run("macro", "name=start%20show").unwrap()["id"], json!("m1"));
        assert_eq!(run("macro", "number=1").unwrap()["id"], json!("m1"));
        assert!(run("macro", "name=nope").is_err());
        assert_eq!(run("timer", "do=start").unwrap()["type"], json!("startCountdown"));
        assert_eq!(run("timer", "").unwrap()["id"], json!("cd"));
        let add = run("timer", "do=add&minutes=-2").unwrap();
        assert_eq!(
            (&add["type"], &add["ms"]),
            (&json!("addCountdownTime"), &json!(-120_000))
        );
        assert_eq!(run("cut", "").unwrap()["transition"], json!("cut"));
        assert_eq!(main_key("Preview"), "input");
        assert_eq!(main_key("overlay"), "channel");
    }''')
open(p, 'w').write(s)
print('ok')
