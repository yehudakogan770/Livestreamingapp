//! Behaviour tests for web page inputs.

use lumora_engine::browser::{clean_url, BrowserInput};
use lumora_engine::*;

fn add(e: &mut Engine, url: &str) -> Result<Outcome, ActionError> {
    e.apply(
        Action::AddSource {
            source: NewSource {
                id: Some(SourceId::new("web")),
                name: "Scores".into(),
                kind: SourceKind::Browser(Box::new(BrowserInput {
                    url: url.into(),
                    ..BrowserInput::default()
                })),
                volume: None,
                muted: None,
                looping: None,
                fit: None,
                audio: None,
                key: None,
            },
        },
        0,
    )
}

#[test]
fn addresses_are_cleaned_up_and_only_web_pages_are_allowed() {
    assert_eq!(
        clean_url(" example.com/live ").as_deref(),
        Some("https://example.com/live")
    );
    assert_eq!(
        clean_url("http://10.0.0.5:8080").as_deref(),
        Some("http://10.0.0.5:8080")
    );
    assert_eq!(clean_url("javascript:alert(1)"), None);
    assert_eq!(clean_url("ftp://x"), None);
    assert_eq!(clean_url("https://"), None);
    assert_eq!(clean_url("two words"), None);
}

#[test]
fn a_web_page_is_added_changed_and_goes_on_air() {
    let mut e = Engine::new();
    assert!(add(&mut e, "not a url").is_err());
    add(&mut e, "scores.example.com").unwrap();
    e.apply(
        Action::UpdateBrowser {
            id: SourceId::new("web"),
            browser: BrowserInput {
                url: "example.org".into(),
                zoom: 1000,
                width: 10,
                ..BrowserInput::default()
            },
        },
        0,
    )
    .unwrap();
    let SourceKind::Browser(b) = &e.show().sources[0].kind else {
        panic!("not a web page")
    };
    assert_eq!(b.url, "https://example.org");
    assert_eq!(b.zoom, 400);
    assert_eq!(b.width, 320);
    e.apply(
        Action::CutTo {
            screen: ScreenId::Live,
            source_id: SourceId::new("web"),
        },
        0,
    )
    .unwrap();
}
