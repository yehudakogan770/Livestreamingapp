use serde_json::{json, Value};

fn get<'a>(q: &'a [(String, String)], key: &str) -> Option<&'a str> {
    q.iter().find(|(k, _)| k == key).map(|(_, v)| v.as_str())
}

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

fn sources(show: &Value) -> &[Value] {
    show["sources"].as_array().map_or(&[], Vec::as_slice)
}

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

fn now_ms() -> f64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0.0, |d| d.as_secs_f64() * 1000.0)
}

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
    #[test]    fn titler_fields_rows_and_timers() {
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
        assert!(Ok::<Value, ()>(
            titler(&s, &q("name=Lower+third&do=toggle"), 5.0).unwrap()
        )
        .is_ok());
    }
}
