//! Behavior tests for sound: channels, mixes, solo and outputs.

use lumora_engine::persist::{load_json, save_json};
use lumora_engine::*;

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
    .expect("added");
}

fn mic() -> SourceKind {
    SourceKind::Microphone {
        device_id: "mic-1".into(),
        label: "Stage mic".into(),
    }
}

fn clip() -> SourceKind {
    SourceKind::Video {
        path: "C:/media/intro.mp4".into(),
        duration_s: 30.0,
        playback: Playback::default(),
    }
}

#[test]
fn microphones_are_always_live_and_videos_follow_the_picture() {
    let mut e = Engine::new();
    add(&mut e, "mic", mic());
    add(&mut e, "vid", clip());
    let s = e.show();
    assert!(!s.source(&SourceId::new("mic")).unwrap().audio.follow);
    assert!(s.source(&SourceId::new("vid")).unwrap().audio.follow);
}

#[test]
fn a_microphone_can_never_go_on_a_screen() {
    let mut e = Engine::new();
    add(&mut e, "mic", mic());
    for action in [
        Action::SetPreview {
            screen: ScreenId::Live,
            source_id: Some(SourceId::new("mic")),
        },
        Action::CutTo {
            screen: ScreenId::Back,
            source_id: SourceId::new("mic"),
        },
    ] {
        assert!(matches!(
            e.apply(action, 0),
            Err(ActionError::SoundOnly { .. })
        ));
    }
}

#[test]
fn channel_settings_change_one_at_a_time() {
    let mut e = Engine::new();
    add(&mut e, "vid", clip());
    e.apply(
        Action::UpdateSource {
            id: SourceId::new("vid"),
            patch: SourcePatch {
                audio: Some(SourceAudioPatch {
                    to_a: Some(false),
                    delay_ms: Some(99_999),
                    ..Default::default()
                }),
                ..Default::default()
            },
        },
        0,
    )
    .unwrap();
    let a = e.show().source(&SourceId::new("vid")).unwrap().audio;
    assert!(!a.to_a);
    assert!(a.to_master && a.to_b && a.follow, "others unchanged");
    assert_eq!(a.delay_ms, 5_000, "delay is capped at 5 seconds");
}

#[test]
fn mixes_have_names_levels_and_mutes() {
    let mut e = Engine::new();
    e.apply(
        Action::UpdateBus {
            bus: BusId::A,
            patch: BusPatch {
                name: Some("  Shul speakers ".into()),
                volume: Some(2.0),
                muted: Some(true),
            },
        },
        0,
    )
    .unwrap();
    e.apply(Action::SetMasterMuted { value: true }, 0).unwrap();
    let m = &e.show().audio;
    assert_eq!(m.a.name, "Shul speakers");
    assert!((m.a.volume - 1.0).abs() < f32::EPSILON);
    assert!(m.a.muted && m.master_muted);
    assert_eq!(m.b.name, "Recording");
}

#[test]
fn solo_only_for_inputs_with_sound_and_forgotten_when_removed() {
    let mut e = Engine::new();
    add(&mut e, "mic", mic());
    add(
        &mut e,
        "red",
        SourceKind::Color {
            color: "#ff0000".into(),
        },
    );
    assert!(e
        .apply(
            Action::SetSolo {
                source_id: Some(SourceId::new("red"))
            },
            0
        )
        .is_err());
    e.apply(
        Action::SetSolo {
            source_id: Some(SourceId::new("mic")),
        },
        0,
    )
    .unwrap();
    e.apply(
        Action::RemoveSource {
            id: SourceId::new("mic"),
        },
        0,
    )
    .unwrap();
    assert_eq!(e.show().audio.solo, None);
}

#[test]
fn outputs_are_remembered_and_solo_is_not() {
    let mut e = Engine::new();
    add(&mut e, "mic", mic());
    e.apply(
        Action::SetAudioOutput {
            output: AudioOutputId::A,
            device_id: Some("speakers-hall".into()),
        },
        0,
    )
    .unwrap();
    e.apply(
        Action::SetSolo {
            source_id: Some(SourceId::new("mic")),
        },
        0,
    )
    .unwrap();
    let loaded = load_json(&save_json(e.show())).unwrap();
    assert_eq!(
        loaded.settings.audio_outputs.a.as_deref(),
        Some("speakers-hall")
    );
    assert_eq!(loaded.audio.solo, None);
}

#[test]
fn older_show_files_get_sound_defaults() {
    let text = r#"{"version":1,"sources":[{"id":"v","name":"V","kind":{"type":"video","path":"x.mp4","durationS":3,"playback":{"playing":false,"posS":0,"at":0}},"volume":1,"muted":false,"looping":false,"fit":"contain"}]}"#;
    let s = load_json(text).unwrap();
    assert_eq!(s.sources[0].audio, SourceAudio::default());
    assert_eq!(s.audio.a.name, "Hall");
}
