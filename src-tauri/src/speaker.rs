//! The speaker's clicker: a second device (the speaker's phone, a stage
//! manager's tablet, a laptop at the lectern) that changes the slides.
//!
//! It is served by the phone remote (see `remote.rs`) at `/slides`, with its
//! own PIN. That PIN gives the "speaker" access level: it can only move the
//! slides (and black them out, if the operator allows it) — never cut
//! cameras, go live or change anything else. The operator can pause it at
//! any moment, and always wins: whatever the operator does shows on the
//! speaker's device at once.
//!
//! What the speaker's device is sent is a small view of the show made here
//! (`slides_view`): the slideshows, their slides and notes, the countdown —
//! not the whole show.

use std::collections::hash_map::RandomState;
use std::collections::{HashMap, VecDeque};
use std::hash::{BuildHasher, Hash, Hasher};
use std::net::IpAddr;

use lumora_engine::slideshow::Slide;
use lumora_engine::{Action, ScreenId, Show, SourceKind};
use serde::Serialize;
use serde_json::{json, Value};

/// Who is asking.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Access {
    /// The phone remote's PIN: running the show.
    Full,
    /// The speaker's PIN: the slides only.
    Speaker,
}

/// What the operator lets the speaker do.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct Rules {
    /// Paused: the speaker sees the slides but can't change them.
    pub locked: bool,
    /// The speaker may black out the slides.
    pub black: bool,
}

/// Why a speaker's action was refused.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Refusal {
    /// Not a slide action (cameras, going live…): never from the speaker.
    NotSlides,
    /// The operator paused speaker control.
    Locked,
    /// Black out is not allowed.
    NoBlack,
}

impl Refusal {
    pub fn status(self) -> u16 {
        match self {
            Refusal::NotSlides | Refusal::NoBlack => 403,
            Refusal::Locked => 423,
        }
    }

    pub fn body(self) -> &'static str {
        match self {
            Refusal::NotSlides => r#"{"code":"onlySlides"}"#,
            Refusal::Locked => r#"{"code":"speakerLocked"}"#,
            Refusal::NoBlack => r#"{"code":"blackNotAllowed"}"#,
        }
    }
}

/// May the speaker do this? Only next, back, go to a slide and (if allowed)
/// black out. The engine itself refuses these for anything that is not a
/// slideshow.
pub fn speaker_may(action: &Action, rules: Rules) -> Result<(), Refusal> {
    let slides = matches!(
        action,
        Action::SlideNext { .. }
            | Action::SlidePrevious { .. }
            | Action::SlideGo { .. }
            | Action::SlideBlack { .. }
    );
    if !slides {
        return Err(Refusal::NotSlides);
    }
    if rules.locked {
        return Err(Refusal::Locked);
    }
    if matches!(action, Action::SlideBlack { .. }) && !rules.black {
        return Err(Refusal::NoBlack);
    }
    Ok(())
}

/// A new random 6-digit speaker PIN (longer than the remote's, so the two
/// are never the same).
pub fn new_speaker_pin() -> String {
    let n = RandomState::new().build_hasher().finish();
    format!("{:06}", n % 1_000_000)
}

pub fn valid_speaker_pin(pin: &str) -> bool {
    pin.len() == 6 && pin.bytes().all(|b| b.is_ascii_digit())
}

/// A name for the device, from its browser's User-Agent ("iPhone", "iPad"…).
pub fn device_name(user_agent: &str) -> &'static str {
    let ua = user_agent;
    if ua.contains("iPhone") {
        "iPhone"
    } else if ua.contains("iPad") {
        "iPad"
    } else if ua.contains("Android") {
        if ua.contains("Mobile") {
            "Android phone"
        } else {
            "Android tablet"
        }
    } else if ua.contains("CrOS") {
        "Chromebook"
    } else if ua.contains("Macintosh") || ua.contains("Mac OS X") {
        "Mac"
    } else if ua.contains("Windows") {
        "Windows computer"
    } else if ua.contains("Linux") {
        "Linux computer"
    } else {
        "web browser"
    }
}

/// Most slide changes from one device in `CLICK_WINDOW_MS` (a held-down
/// clicker or a stuck key can't race through the slides).
pub const CLICKS_PER_WINDOW: usize = 10;
pub const CLICK_WINDOW_MS: u64 = 2000;

/// Room for one more slide change from this address now (and it is counted)?
pub fn click_allowed(clicks: &mut HashMap<IpAddr, VecDeque<u64>>, ip: IpAddr, now: u64) -> bool {
    if clicks.len() > 1000 {
        clicks.retain(|_, t| {
            t.back()
                .is_some_and(|&l| now.saturating_sub(l) < CLICK_WINDOW_MS)
        });
    }
    let times = clicks.entry(ip).or_default();
    while times
        .front()
        .is_some_and(|&t| now.saturating_sub(t) >= CLICK_WINDOW_MS)
    {
        times.pop_front();
    }
    if times.len() >= CLICKS_PER_WINDOW {
        return false;
    }
    times.push_back(now);
    true
}

/// A short tag for a picture file, so a device fetches it again only when
/// the slide's picture changes.
fn tag(path: &str) -> String {
    let mut h = std::collections::hash_map::DefaultHasher::new();
    path.hash(&mut h);
    format!("{:x}", h.finish() & 0xffff_ffff)
}

/// The picture file of a slide (`None`: not a picture slide, or no such slide).
pub fn slide_picture(show: &Show, id: &str, index: usize) -> Option<String> {
    let src = show.sources.iter().find(|s| s.id.as_str() == id)?;
    match &src.kind {
        SourceKind::Slideshow(sh) => match sh.slides.get(index)? {
            Slide::Image { path, .. } => Some(path.clone()),
            Slide::Input { .. } => None,
        },
        _ => None,
    }
}

/// Picture types a slide may be (anything else is not sent).
pub fn picture_type(path: &str) -> Option<&'static str> {
    let ext = path.rsplit('.').next()?.to_ascii_lowercase();
    Some(match ext.as_str() {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "bmp" => "image/bmp",
        "avif" => "image/avif",
        _ => return None,
    })
}

/// What the speaker's device shows: every slideshow (the one on air first),
/// its slides and notes, the countdown, and what the operator allows.
pub fn slides_view(show: &Show, rules: Rules) -> Value {
    let program = |sc: ScreenId| show.screens.get(sc).program.as_ref();
    let preview = |sc: ScreenId| show.screens.get(sc).preview.as_ref();
    let mut shows: Vec<(u8, Value)> = show
        .sources
        .iter()
        .filter_map(|src| {
            let SourceKind::Slideshow(sh) = &src.kind else {
                return None;
            };
            let id = Some(&src.id);
            let (rank, on_air) = if program(ScreenId::Live) == id {
                (0, Some("live"))
            } else if program(ScreenId::Back) == id {
                (1, Some("back"))
            } else if preview(ScreenId::Live) == id || preview(ScreenId::Back) == id {
                (2, None)
            } else {
                (3, None)
            };
            let name_of = |sid: &lumora_engine::SourceId| {
                show.source(sid).map(|s| s.name.clone()).unwrap_or_default()
            };
            let slides: Vec<Value> = sh
                .slides
                .iter()
                .map(|sl| {
                    let mut v = match sl {
                        Slide::Image { path, .. } => json!({ "type": "image", "v": tag(path) }),
                        Slide::Input { source_id, .. } => {
                            json!({ "type": "input", "name": name_of(source_id) })
                        }
                    };
                    if let Some(n) = sl.notes() {
                        v["notes"] = json!(n);
                    }
                    v
                })
                .collect();
            Some((
                rank,
                json!({
                    "id": src.id,
                    "name": src.name,
                    "onAir": on_air,
                    "inNext": rank == 2,
                    "current": sh.current,
                    "black": sh.black,
                    "looping": sh.looping,
                    "slides": slides,
                }),
            ))
        })
        .collect();
    shows.sort_by_key(|(rank, _)| *rank);
    let countdown = show.main_countdown().and_then(|id| {
        let c = show.countdown(id)?;
        Some(json!({
            "name": show.source(id).map(|s| s.name.clone()).unwrap_or_default(),
            "endsAt": c.ends_at,
            "remainingMs": c.remaining_ms,
        }))
    });
    json!({
        "event": show.event.name,
        "locked": rules.locked,
        "allowBlack": rules.black,
        "slideshows": shows.into_iter().map(|(_, v)| v).collect::<Vec<_>>(),
        "countdown": countdown,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use lumora_engine::slideshow::Slideshow;
    use lumora_engine::{Engine, NewSource, SourceId};

    fn sid(s: &str) -> SourceId {
        SourceId::new(s)
    }

    fn add(e: &mut Engine, id: &str, kind: SourceKind) {
        e.apply(
            Action::AddSource {
                source: NewSource {
                    id: Some(sid(id)),
                    name: id.to_uppercase(),
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

    #[test]
    fn the_speaker_can_only_move_the_slides() {
        let open = Rules {
            locked: false,
            black: false,
        };
        let id = sid("slides");
        for ok in [
            Action::SlideNext { id: id.clone() },
            Action::SlidePrevious { id: id.clone() },
            Action::SlideGo {
                id: id.clone(),
                index: 3,
            },
        ] {
            assert_eq!(speaker_may(&ok, open), Ok(()), "{ok:?}");
        }
        // Never the show itself: cameras, going on air, PANIC, the countdown, blanking a screen.
        let never: Vec<Action> = vec![
            serde_json::from_str(r#"{"type":"take","screen":"live"}"#).unwrap(),
            serde_json::from_str(r#"{"type":"cutTo","screen":"live","sourceId":"cam"}"#).unwrap(),
            serde_json::from_str(r#"{"type":"setPreview","screen":"live","sourceId":"cam"}"#)
                .unwrap(),
            serde_json::from_str(r#"{"type":"panic","value":true}"#).unwrap(),
            serde_json::from_str(r#"{"type":"setBlank","screens":["live"],"value":true}"#).unwrap(),
            serde_json::from_str(r#"{"type":"startCountdown","id":"cd"}"#).unwrap(),
            serde_json::from_str(r#"{"type":"removeSource","id":"slides"}"#).unwrap(),
            serde_json::from_str(r#"{"type":"nextCue"}"#).unwrap(),
            Action::UpdateSlideshow {
                id: id.clone(),
                slideshow: Slideshow::default(),
            },
        ];
        for a in &never {
            assert_eq!(speaker_may(a, open), Err(Refusal::NotSlides), "{a:?}");
            // Not even with every speaker permission on.
            let all = Rules {
                locked: false,
                black: true,
            };
            assert_eq!(speaker_may(a, all), Err(Refusal::NotSlides), "{a:?}");
        }
    }

    #[test]
    fn black_needs_permission_and_a_pause_stops_everything() {
        let black = Action::SlideBlack {
            id: sid("s"),
            value: true,
        };
        let next = Action::SlideNext { id: sid("s") };
        let no_black = Rules::default();
        assert_eq!(speaker_may(&black, no_black), Err(Refusal::NoBlack));
        let with_black = Rules {
            black: true,
            ..Rules::default()
        };
        assert_eq!(speaker_may(&black, with_black), Ok(()));
        let paused = Rules {
            locked: true,
            black: true,
        };
        assert_eq!(speaker_may(&next, paused), Err(Refusal::Locked));
        assert_eq!(speaker_may(&black, paused), Err(Refusal::Locked));
        assert_eq!(Refusal::Locked.status(), 423);
        assert_eq!(Refusal::NotSlides.status(), 403);
    }

    #[test]
    fn devices_get_plain_names() {
        let iphone = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15";
        assert_eq!(device_name(iphone), "iPhone");
        assert_eq!(
            device_name("Mozilla/5.0 (iPad; CPU OS 16_0 like Mac OS X)"),
            "iPad"
        );
        assert_eq!(
            device_name("Mozilla/5.0 (Linux; Android 14; Pixel 8) Mobile Safari/537.36"),
            "Android phone"
        );
        assert_eq!(
            device_name("Mozilla/5.0 (Linux; Android 13; SM-X200) Safari/537.36"),
            "Android tablet"
        );
        assert_eq!(
            device_name("Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/126"),
            "Windows computer"
        );
        assert_eq!(
            device_name("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)"),
            "Mac"
        );
        assert_eq!(device_name(""), "web browser");
    }

    #[test]
    fn a_runaway_clicker_is_slowed_down() {
        let mut clicks = HashMap::new();
        let ip: IpAddr = [192, 168, 1, 9].into();
        let other: IpAddr = [192, 168, 1, 10].into();
        for i in 0..CLICKS_PER_WINDOW as u64 {
            assert!(click_allowed(&mut clicks, ip, 1000 + i));
        }
        assert!(!click_allowed(&mut clicks, ip, 1500));
        assert!(
            click_allowed(&mut clicks, other, 1500),
            "each device counts on its own"
        );
        assert!(click_allowed(&mut clicks, ip, 1000 + CLICK_WINDOW_MS + 10));
    }

    #[test]
    fn speaker_pins_are_six_digits() {
        for _ in 0..20 {
            assert!(valid_speaker_pin(&new_speaker_pin()));
        }
        assert!(!valid_speaker_pin("1234"));
        assert!(!valid_speaker_pin("12345a"));
    }

    #[test]
    fn the_view_has_the_slideshow_on_air_first_with_notes_and_no_file_paths() {
        let mut e = Engine::new();
        add(&mut e, "cam", SourceKind::Pattern);
        add(&mut e, "other", SourceKind::Slideshow(Box::default()));
        add(&mut e, "talk", SourceKind::Slideshow(Box::default()));
        let sh = Slideshow {
            slides: vec![
                Slide::Image {
                    path: "C:/Users/me/secret/1.png".into(),
                    notes: Some("Say hello".into()),
                },
                Slide::Input {
                    source_id: sid("cam"),
                    notes: None,
                },
            ],
            ..Slideshow::default()
        };
        e.apply(
            Action::UpdateSlideshow {
                id: sid("talk"),
                slideshow: sh,
            },
            0,
        )
        .unwrap();
        e.apply(
            Action::CutTo {
                screen: ScreenId::Live,
                source_id: sid("talk"),
            },
            0,
        )
        .unwrap();
        let v = slides_view(
            e.show(),
            Rules {
                locked: true,
                black: false,
            },
        );
        assert_eq!(v["locked"], true);
        assert_eq!(v["allowBlack"], false);
        let first = &v["slideshows"][0];
        assert_eq!(first["id"], "talk");
        assert_eq!(first["onAir"], "live");
        assert_eq!(first["slides"][0]["notes"], "Say hello");
        assert_eq!(first["slides"][1]["name"], "CAM");
        assert_eq!(v["slideshows"][1]["id"], "other");
        assert!(
            !v.to_string().contains("secret"),
            "the speaker never sees file paths"
        );
        assert_eq!(
            slide_picture(e.show(), "talk", 0).as_deref(),
            Some("C:/Users/me/secret/1.png")
        );
        assert_eq!(slide_picture(e.show(), "talk", 1), None);
        assert_eq!(slide_picture(e.show(), "cam", 0), None);
        assert_eq!(picture_type("a/b.JPG"), Some("image/jpeg"));
        assert_eq!(picture_type("a/b.svg"), None);
    }
}
