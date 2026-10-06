//! The backup lineup: the plan is kept with the event, cleaned, and follows
//! inputs being removed; the "no signal" list is never saved.

use lumora_engine::event::Backup;
use lumora_engine::persist::{load_json, save_json};
use lumora_engine::*;

fn apply(e: &mut Engine, a: Action) {
    e.apply(a, 0).expect("action should be accepted");
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
    );
}

fn set_backup(e: &mut Engine, b: Backup) {
    apply(
        e,
        Action::UpdateEvent {
            patch: EventPatch {
                backup: Some(b),
                ..EventPatch::default()
            },
        },
    );
}

#[test]
fn on_by_default_with_an_automatic_lineup() {
    let e = Engine::new();
    let b = &e.show().event.backup;
    assert!(b.on);
    assert!(b.lineup.is_empty(), "empty means automatic");
    assert_eq!(b.lost_after_ms, 1500);
    assert!(!b.switch_back, "the operator decides when to go back");
    assert_eq!(b.screens, vec![ScreenId::Live, ScreenId::Back]);
}

#[test]
fn the_lineup_is_cleaned_and_saved() {
    let mut e = Engine::new();
    for c in ["cam1", "cam2", "wide"] {
        add(&mut e, c);
    }
    set_backup(
        &mut e,
        Backup {
            on: true,
            lineup: vec![id("cam2"), id("cam1"), id("cam2"), id(" "), id("wide")],
            lost_after_ms: 10,
            fade_ms: 99_999,
            switch_back: true,
            screens: vec![ScreenId::Live, ScreenId::Live],
        },
    );
    let b = &e.show().event.backup;
    assert_eq!(b.lineup, vec![id("cam2"), id("cam1"), id("wide")]);
    assert_eq!(b.lost_after_ms, 500);
    assert_eq!(b.fade_ms, 2000);
    assert_eq!(b.screens, vec![ScreenId::Live]);
    let loaded = load_json(&save_json(e.show())).unwrap();
    assert_eq!(&loaded.event.backup, b);
}

#[test]
fn turning_it_off_and_removing_an_input() {
    let mut e = Engine::new();
    for c in ["cam1", "cam2"] {
        add(&mut e, c);
    }
    set_backup(
        &mut e,
        Backup {
            lineup: vec![id("cam1"), id("cam2")],
            ..Backup::default()
        },
    );
    apply(&mut e, Action::SetBackupOn { value: false });
    assert!(!e.show().event.backup.on);
    apply(&mut e, Action::RemoveSource { id: id("cam1") });
    assert_eq!(e.show().event.backup.lineup, vec![id("cam2")]);
}

#[test]
fn no_signal_lists_known_inputs_and_is_not_saved() {
    let mut e = Engine::new();
    add(&mut e, "cam1");
    apply(
        &mut e,
        Action::SetNoSignal {
            ids: vec![id("cam1"), id("gone"), id("cam1")],
        },
    );
    assert_eq!(e.show().no_signal, vec![id("cam1")]);
    let loaded = load_json(&save_json(e.show())).unwrap();
    assert!(loaded.no_signal.is_empty());
}

#[test]
fn old_files_get_the_default_lineup() {
    let loaded = load_json(r#"{"version":3,"sources":[],"event":{"name":"Old"}}"#).unwrap();
    assert_eq!(loaded.event.backup, Backup::default());
}
