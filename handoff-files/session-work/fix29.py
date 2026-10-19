import os
os.chdir('/home/user/Livestreamingapp/.claude/worktrees/agent-a155a6f1093a2d850')
def rep(p,a,b):
    s=open(p).read(); assert a in s,(p,a); s=s.replace(a,b,1); open(p,'w').write(s)
p='src-tauri/src/control.rs'
rep(p,"""    ("ptz", "input or name, preset, move, zoom, speed"),""","""    ("ptz", "input or name, preset, move, zoom, speed"),
    (
        "titler",
        "input or name, field and value (or set.<field>=…), or do (next, previous, start, stop, toggle, reset) with field",
    ),""")
rep(p,"""        "clock" => {
            let id = input(show, q)?;
            let running = sources(show)""","""        "titler" => titler(show, q, now_ms())?,
        "clock" => {
            let id = input(show, q)?;
            let running = sources(show)""")
rep(p,"""/// A PTZ camera and what to make it do.""","""fn now_ms() -> f64 {
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
                let stop = var["timer"]["stop"].as_f64().or(if up { None } else { Some(0.0) });
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
                    ("reset", _) => format!("{}", parse_clock(sample).unwrap_or(0.0)),
                    ("start", true) | ("stop", false) => current.to_owned(),
                    ("start" | "toggle", false) => format!("{shown}@{}", now.round()),
                    _ => format!("{shown}"),
                };
                Ok(json!({"type": "setTitlerValues", "id": id, "values": [{"key": key, "value": value}]}))
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
        return Err("say what to change: field=name&value=Ada, set.name=Ada, or do=next".to_owned());
    }
    Ok(json!({"type": "setTitlerValues", "id": id, "values": values}))
}

/// A PTZ camera and what to make it do.""")
# test
rep(p,"""        assert!(cmd("dance", "").unwrap_err().contains("take"));
    }""","""        assert!(cmd("dance", "").unwrap_err().contains("take"));
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
        let q = |x: &str| parse_query(x);
        assert_eq!(
            titler(&s, &q("name=Lower+third&field=name&value=Grace"), 0.0).unwrap(),
            json!({"type": "setTitlerValues", "id": "t", "values": [{"key": "name", "value": "Grace"}]})
        );
        assert_eq!(
            titler(&s, &q("name=Lower+third&set.name=Grace&set.role=Host"), 0.0).unwrap()["values"][1],
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
        assert!(serde_json::from_value::<Action>(titler(&s, &q("name=Lower+third&do=toggle"), 5.0).unwrap()).is_ok());
    }""")
p='src-tauri/src/remote.rs'
rep(p,"""            | Action::DataStep { .. }""","""            | Action::DataStep { .. }
            | Action::SetTitlerValues { .. }
            | Action::TitlerDataStep { .. }""")
