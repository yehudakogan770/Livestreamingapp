//! Going through the cameras by itself.

use lumora_engine::cameras::AutoSwitch;
use lumora_engine::*;

fn apply(e: &mut Engine, a: Action, now: Millis) {
    e.apply(a, now).expect("action should be accepted");
}

fn id(s: &str) -> SourceId {
    SourceId::new(s)
}

fn add(e: &mut Engine, sid: &str) {
    apply(
        e,
        Action::AddSource {
            source: NewSource {
                id: Some(id(sid)),
                name: sid.into(),
                kind: SourceKind::Pattern,
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
    );
}

fn on_air(e: &Engine) -> Option<SourceId> {
    e.show().screens.live.program.clone()
}

#[test]
fn switches_by_itself_only_while_one_of_its_cameras_is_on_air() {
    let mut e = Engine::new();
    for c in ["a", "b", "c", "video"] {
        add(&mut e, c);
    }
    let cut = |e: &mut Engine, s: &str, now| {
        apply(
            e,
            Action::CutTo {
                screen: ScreenId::Live,
                source_id: id(s),
            },
            now,
        );
    };
    cut(&mut e, "a", 0);
    apply(
        &mut e,
        Action::UpdateAutoSwitch {
            auto: AutoSwitch {
                on: true,
                cameras: vec![id("a"), id("b"), id("c")],
                min_s: 5,
                max_s: 5,
                ..AutoSwitch::default()
            },
        },
        0,
    );
    assert_eq!(e.tick(4_000), Outcome::Unchanged);
    e.tick(5_000);
    assert_eq!(on_air(&e), Some(id("b")));
    e.tick(10_000);
    assert_eq!(on_air(&e), Some(id("c")));
    // A video on air holds it.
    cut(&mut e, "video", 11_000);
    assert_eq!(e.tick(20_000), Outcome::Unchanged);
    assert_eq!(on_air(&e), Some(id("video")));
    // Removing cameras down to one turns it off.
    apply(&mut e, Action::RemoveSource { id: id("b") }, 21_000);
    apply(&mut e, Action::RemoveSource { id: id("c") }, 21_000);
    assert!(!e.show().auto_switch.on);
}
