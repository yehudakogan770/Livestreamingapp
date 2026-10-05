//! Behavior tests for the stage visuals.

use lumora_engine::visuals::{banks, Quantize, SceneRef, VisualsPatch, LOOK_SLOTS};
use lumora_engine::*;

fn sc(bank: usize, scene: usize) -> SceneRef {
    SceneRef { bank, scene }
}

/// At 120 BPM a beat is 500 ms.
fn at120() -> Engine {
    let mut e = Engine::new();
    e.apply(Action::VisualsTempo { bpm: 120.0 }, 0).unwrap();
    e
}

#[test]
fn the_music_types_are_all_there() {
    assert_eq!(banks().len(), 13);
    assert_eq!(banks().iter().map(|b| b.scenes.len()).sum::<usize>(), 261);
    assert_eq!(banks()[0].name, "Slow");
}

#[test]
fn the_beat_follows_the_tempo_and_carries_on_through_a_change() {
    let mut e = at120();
    assert!((e.show().visuals.beat_at(1000) - 2.0).abs() < 1e-9);
    // Faster at beat 2: no jump, then 1.5 times as fast.
    e.apply(Action::VisualsTempo { bpm: 180.0 }, 1000).unwrap();
    assert!((e.show().visuals.beat_at(1000) - 2.0).abs() < 1e-9);
    assert!((e.show().visuals.beat_at(1500) - 3.5).abs() < 1e-9);
    // Clamped to a playable tempo.
    e.apply(Action::VisualsTempo { bpm: 900.0 }, 2000).unwrap();
    assert!((e.show().visuals.bpm - 220.0).abs() < 1e-9);
    assert!(e
        .apply(Action::VisualsTempo { bpm: f64::NAN }, 2000)
        .is_err());
}

#[test]
fn sync_makes_now_beat_one_of_a_bar() {
    let mut e = at120();
    // Beat 5.2 → the nearest bar start, beat 4.
    e.apply(Action::VisualsSync, 2600).unwrap();
    assert!((e.show().visuals.beat_at(2600) - 4.0).abs() < 1e-9);
}

#[test]
fn a_new_scene_waits_for_the_next_beat_and_fades_from_the_old_one() {
    let mut e = at120();
    let first = e.show().visuals.scene;
    // Same music type, so the tempo stays.
    e.apply(
        Action::VisualsScene {
            scene: sc(first.bank, 3),
        },
        1200,
    )
    .unwrap();
    let v = &e.show().visuals;
    assert_eq!(v.scene, sc(first.bank, 3));
    assert_eq!(v.from, Some(first));
    assert!(
        (v.fade_start - 3.0).abs() < 1e-9,
        "beat 2.4 → starts on beat 3"
    );
    assert!((v.fade_len - banks()[first.bank].fade).abs() < 1e-9);
    // Changing again before it started still fades from what is showing.
    e.apply(
        Action::VisualsScene {
            scene: sc(first.bank, 4),
        },
        1300,
    )
    .unwrap();
    assert_eq!(e.show().visuals.from, Some(first));
    assert!(e
        .apply(Action::VisualsScene { scene: sc(99, 0) }, 0)
        .is_err());
}

#[test]
fn on_the_bar_and_now() {
    let mut e = at120();
    let mut st = e.show().visuals.settings.clone();
    st.quantize = Quantize::Bar;
    e.apply(
        Action::UpdateVisuals {
            patch: VisualsPatch {
                settings: Some(st.clone()),
                ..VisualsPatch::default()
            },
        },
        0,
    )
    .unwrap();
    e.apply(Action::VisualsScene { scene: sc(1, 5) }, 2600)
        .unwrap();
    assert!((e.show().visuals.fade_start - 8.0).abs() < 1e-9);
    st.quantize = Quantize::Now;
    e.apply(
        Action::UpdateVisuals {
            patch: VisualsPatch {
                settings: Some(st),
                ..VisualsPatch::default()
            },
        },
        3000,
    )
    .unwrap();
    // Wait for the pending one, then change right now.
    e.apply(Action::VisualsScene { scene: sc(1, 6) }, 5000)
        .unwrap();
    assert!((e.show().visuals.fade_start - 10.0).abs() < 1e-9);
}

#[test]
fn a_new_music_type_brings_its_own_tempo() {
    let mut e = at120();
    e.apply(Action::VisualsScene { scene: sc(2, 0) }, 0)
        .unwrap();
    assert!((e.show().visuals.bpm - banks()[2].bpm).abs() < 1e-9);
}

#[test]
fn next_and_previous_wrap_round() {
    let mut e = at120();
    let mut v = e.show().visuals.clone();
    v.settings.quantize = Quantize::Now;
    e.apply(
        Action::UpdateVisuals {
            patch: VisualsPatch {
                settings: Some(v.settings.clone()),
                ..VisualsPatch::default()
            },
        },
        0,
    )
    .unwrap();
    e.apply(Action::VisualsStep { step: -1 }, 0).unwrap();
    let bank = e.show().visuals.scene.bank;
    assert_eq!(e.show().visuals.scene.scene, banks()[bank].scenes.len() - 1);
    e.apply(Action::VisualsStep { step: 5 }, 0).unwrap();
    assert_eq!(e.show().visuals.scene.scene, 0, "a step is one scene");
}

#[test]
fn auto_change_moves_on_every_few_bars_by_itself() {
    let mut e = at120();
    let mut st = e.show().visuals.settings.clone();
    st.auto_bars = 2;
    e.apply(
        Action::UpdateVisuals {
            patch: VisualsPatch {
                settings: Some(st),
                ..VisualsPatch::default()
            },
        },
        1000,
    )
    .unwrap();
    // Two bars at 120 BPM = 4 seconds; due on beat 8.
    assert_eq!(e.show().visuals.next_auto, Some(8.0));
    let before = e.show().visuals.scene;
    assert_eq!(e.tick(3900), Outcome::Unchanged);
    assert_eq!(e.tick(4000), Outcome::Changed);
    let v = &e.show().visuals;
    assert_eq!(v.scene.scene, before.scene + 1);
    assert_eq!(v.next_auto, Some(16.0));
    assert!((v.fade_start - 8.0).abs() < 1e-9);
}

#[test]
fn freeze_holds_the_beat_and_auto_change() {
    let mut e = at120();
    e.apply(
        Action::UpdateVisuals {
            patch: VisualsPatch {
                freeze: Some(true),
                ..VisualsPatch::default()
            },
        },
        1000,
    )
    .unwrap();
    assert_eq!(e.show().visuals.frozen, Some(2.0));
}

#[test]
fn looks_keep_the_scene_and_effects() {
    let mut e = at120();
    let mut fx = e.show().visuals.fx;
    fx.kal = 6;
    fx.zoom = 9.0; // too much: clamped
    e.apply(
        Action::UpdateVisuals {
            patch: VisualsPatch {
                fx: Some(fx),
                ..VisualsPatch::default()
            },
        },
        0,
    )
    .unwrap();
    assert!((e.show().visuals.fx.zoom - 3.0).abs() < 1e-6);
    e.apply(
        Action::VisualsLook {
            slot: 2,
            store: true,
        },
        0,
    )
    .unwrap();
    e.apply(
        Action::UpdateVisuals {
            patch: VisualsPatch {
                fx: Some(lumora_engine::visuals::VisualsFx::default()),
                ..VisualsPatch::default()
            },
        },
        0,
    )
    .unwrap();
    e.apply(
        Action::VisualsLook {
            slot: 2,
            store: false,
        },
        0,
    )
    .unwrap();
    assert_eq!(e.show().visuals.fx.kal, 6);
    assert!(e
        .apply(
            Action::VisualsLook {
                slot: 3,
                store: false
            },
            0
        )
        .is_err());
    assert!(e
        .apply(
            Action::VisualsLook {
                slot: LOOK_SLOTS,
                store: true
            },
            0
        )
        .is_err());
}

#[test]
fn a_visuals_input_goes_on_air_and_behind_the_pesukim() {
    let mut e = Engine::new();
    e.apply(
        Action::AddSource {
            source: NewSource {
                id: Some(SourceId::new("vis")),
                name: "Stage visuals".into(),
                kind: SourceKind::Visuals,
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
    e.apply(
        Action::CutTo {
            screen: ScreenId::Back,
            source_id: SourceId::new("vis"),
        },
        0,
    )
    .unwrap();
    assert_eq!(e.show().screens.back.program, Some(SourceId::new("vis")));
}

#[test]
fn a_saved_show_with_broken_visuals_is_repaired() {
    let mut show = Show::default();
    show.visuals.bpm = f64::INFINITY;
    show.visuals.scene = sc(50, 50);
    show.visuals.looks.clear();
    show.visuals.strobe = true;
    let back = lumora_engine::persist::repair(show);
    assert!((back.visuals.bpm - 100.0).abs() < 1e-9);
    assert_eq!(back.visuals.scene, sc(0, 0));
    assert_eq!(back.visuals.looks.len(), LOOK_SLOTS);
    assert!(!back.visuals.strobe);
}

#[test]
fn safe_mode_blocks_the_strobe() {
    let mut e = at120();
    assert!(e.show().visuals.settings.safe, "safe by default");
    e.apply(
        Action::UpdateVisuals {
            patch: VisualsPatch {
                strobe: Some(true),
                ..VisualsPatch::default()
            },
        },
        0,
    )
    .unwrap();
    assert!(!e.show().visuals.strobe);
    let mut st = e.show().visuals.settings.clone();
    st.safe = false;
    e.apply(
        Action::UpdateVisuals {
            patch: VisualsPatch {
                settings: Some(st),
                strobe: Some(true),
                ..VisualsPatch::default()
            },
        },
        0,
    )
    .unwrap();
    assert!(e.show().visuals.strobe);
}

#[test]
fn favourites_are_kept_once_and_only_if_they_exist() {
    let mut e = at120();
    e.apply(
        Action::UpdateVisuals {
            patch: VisualsPatch {
                favourites: Some(vec![sc(0, 1), sc(0, 1), sc(40, 0)]),
                ..VisualsPatch::default()
            },
        },
        0,
    )
    .unwrap();
    assert_eq!(e.show().visuals.favourites, vec![sc(0, 1)]);
}
