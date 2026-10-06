//! A long event squeezed into a test: tens of thousands of switching,
//! overlay, blank, PANIC and countdown actions with time passing between
//! them. Nothing may panic, get stuck or keep growing.

use lumora_engine::*;
use serde_json::{json, Value};

/// A small repeatable random number maker (the same event every run).
struct Dice(u64);

impl Dice {
    fn next(&mut self) -> u64 {
        self.0 = self
            .0
            .wrapping_mul(6_364_136_223_846_793_005)
            .wrapping_add(1_442_695_040_888_963_407);
        self.0 >> 33
    }
    fn pick<'a, T>(&mut self, from: &'a [T]) -> &'a T {
        &from[(self.next() as usize) % from.len()]
    }
}

fn add(e: &mut Engine, id: &str, kind: SourceKind) {
    e.apply(
        Action::AddSource {
            source: NewSource {
                id: Some(SourceId::new(id)),
                name: id.into(),
                kind,
                volume: None,
                muted: None,
                looping: None,
                fit: None,
                audio: None,
                key: None,
                screens: None,
            },
        },
        0,
    )
    .unwrap();
}

fn event() -> Engine {
    let mut e = Engine::new();
    add(&mut e, "cam1", SourceKind::Pattern);
    add(&mut e, "cam2", SourceKind::Pattern);
    add(
        &mut e,
        "clip",
        SourceKind::Video {
            path: "C:/media/clip.mp4".into(),
            duration_s: 12.0,
            playback: Playback::default(),
        },
    );
    add(
        &mut e,
        "cd",
        SourceKind::Countdown {
            background: "#000000".into(),
            logo: None,
            timer: Countdown::default(),
        },
    );
    e
}

fn random_action(d: &mut Dice, now: Millis) -> Value {
    let ids = ["cam1", "cam2", "clip", "cd"];
    let screens = ["live", "back"];
    let kinds = [
        "cut",
        "fade",
        "dip",
        "wipe",
        "lumaClock",
        "stinger1",
        "zoom",
        "flash",
    ];
    let id = *d.pick(&ids);
    let screen = *d.pick(&screens);
    match d.next() % 16 {
        0..=2 => json!({ "type": "setPreview", "screen": screen, "sourceId": id }),
        3..=4 => {
            json!({ "type": "take", "screen": screen, "transition": d.pick(&kinds), "durationMs": d.next() % 3000 })
        }
        5 => json!({ "type": "cutTo", "screen": screen, "sourceId": id }),
        6 => {
            json!({ "type": "setTbar", "screen": screen, "value": (d.next() % 1001) as f64 / 1000.0 })
        }
        7 => json!({ "type": "panic", "value": d.next().is_multiple_of(4) }),
        8 => json!({ "type": "fadeToBlack", "screen": screen }),
        9 => {
            json!({ "type": "setBlank", "screens": [screen], "value": d.next().is_multiple_of(2) })
        }
        10 => {
            json!({ "type": if d.next().is_multiple_of(2) { "play" } else { "pause" }, "id": "clip" })
        }
        11 => json!({ "type": "setOverlaySource", "channel": d.next() % 4, "sourceId": id }),
        12 => {
            json!({ "type": "setOverlayOn", "channel": d.next() % 4, "value": d.next().is_multiple_of(2) })
        }
        13 => json!({ "type": "countdownTo", "id": "cd", "at": now + 2_000 + d.next() % 20_000 }),
        14 => {
            json!({ "type": "updateCountdown", "id": "cd", "patch": { "atZero": if d.next().is_multiple_of(2) { json!({ "type": "takeNext" }) } else { json!({ "type": "cutTo", "sourceId": "cam1" }) } } })
        }
        _ => json!({ "type": "setBackFollowsLive", "value": d.next().is_multiple_of(3) }),
    }
}

/// Everything on the screens points at an input that exists.
fn check(e: &Engine) {
    let s = e.show();
    for sc in [ScreenId::Live, ScreenId::Back] {
        let st = s.screens.get(sc);
        for id in [&st.program, &st.preview].into_iter().flatten() {
            assert!(s.source(id).is_some(), "{sc:?} points at {id:?}");
        }
        assert!((0.0..=1.0).contains(&st.tbar));
        if let Some(t) = &st.transition {
            assert!(
                t.duration_ms <= 60_000,
                "a transition that never ends: {t:?}"
            );
        }
    }
}

#[test]
fn hours_of_switching_never_stick_or_grow() {
    let mut e = event();
    let mut d = Dice(42);
    let mut now: Millis = 1_000_000;
    let mut size_early = 0;
    let mut revision = e.revision();
    for step in 0..60_000u32 {
        let v = random_action(&mut d, now);
        let action: Action =
            serde_json::from_value(v.clone()).unwrap_or_else(|e| panic!("{v}: {e}"));
        let _ = e.apply(action, now);
        // Time passes as at an event: the app ticks ten times a second.
        let gap = d.next() % 3_000;
        let mut t = now;
        while t < now + gap {
            t += 100;
            let _ = e.tick(t);
        }
        now += gap.max(1);
        assert!(e.revision() >= revision);
        revision = e.revision();
        check(&e);
        if step == 6_000 {
            size_early = serde_json::to_string(e.show()).unwrap().len();
        }
    }
    let size_late = serde_json::to_string(e.show()).unwrap().len();
    assert!(
        size_late < size_early + 4_096,
        "the show grew from {size_early} to {size_late} bytes"
    );
    // Left alone for a minute: everything settles, nothing keeps changing.
    for _ in 0..600 {
        now += 100;
        e.tick(now);
    }
    let settled = e.revision();
    for _ in 0..600 {
        now += 100;
        e.tick(now);
    }
    assert_eq!(
        e.revision(),
        settled,
        "ticks keep changing a show nobody touches"
    );
}
