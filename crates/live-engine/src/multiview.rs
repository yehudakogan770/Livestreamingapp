//! The multiview drawn by the engine (Unified mode): every input and the
//! screens at once, for the crew, in a native window of its own — from the
//! same GPU frames the screens are drawn from, at the engine's full rate.
//!
//! The layout follows `app/src/views/MultiviewView.css` (a header strip; the
//! Live Screen's Next and On air big — and the Back Screen's for "both
//! screens"; every input below in a grid of tiles). The engine draws the
//! pictures and the tally borders; the words (names, tally tags, the clock)
//! come from the Live Screen's overlay renderer as the plane `mv`, drawn at
//! the layout's own rectangles (`app/src/engine/multiviewLabels.ts`, which
//! asks for this layout).

use lumora_engine::{MultiviewLayout, ScreenId, Show, SourceId, SourceKind};
use serde::Serialize;

/// The multiview is drawn at this size (and letterboxed into its window).
pub const SIZE: (u32, u32) = (1920, 1080);

/// The sound-only file kinds (`isSoundFile`: they have no picture to show).
const SOUND: [&str; 8] = ["mp3", "wav", "m4a", "aac", "ogg", "flac", "wma", "opus"];

/// What a tile shows.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase", tag = "type", content = "id")]
pub enum TileContent {
    /// A screen on air.
    Program(ScreenId),
    /// What is lined up next on a screen.
    Next(ScreenId),
    /// One input.
    Input(SourceId),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Tally {
    /// On air (red).
    Pgm,
    /// Next (green).
    Pvw,
    None,
}

/// One tile, in pixels of the multiview: `[x, y, w, h]`.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Tile {
    pub content: TileContent,
    pub rect: [u32; 4],
    /// Where the picture goes (inside the border, above the label strip).
    pub picture: [u32; 4],
    /// The label strip.
    pub label: [u32; 4],
    pub tally: Tally,
    /// The screens' tiles (bigger words).
    pub big: bool,
    /// The input's number (1 …), for inputs.
    pub number: Option<u32>,
    /// Where its timecode goes (the screens' tiles: the end of the label
    /// strip), drawn from the small plane `tc2` every frame.
    pub timecode: Option<[u32; 4]>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Layout {
    pub width: u32,
    pub height: u32,
    pub header: [u32; 4],
    /// The header's clock (a timecode with frames, from the small plane `tc`).
    pub clock: [u32; 4],
    pub tiles: Vec<Tile>,
    /// CSS pixels to multiview pixels (the words are drawn at this scale).
    pub scale: f32,
}

/// The header clock's plane (`HH:MM:SS:FF`, one change a frame: kept small).
pub const CLOCK_PLANE: &str = "tc";
/// The screens' tiles' timecode plane (the same time, smaller words).
pub const TIMECODE_PLANE: &str = "tc2";

/// The inputs the multiview shows (everything with a picture).
pub fn inputs(show: &Show) -> Vec<&lumora_engine::Source> {
    show.sources
        .iter()
        .filter(|s| match &s.kind {
            SourceKind::Microphone { .. } => false,
            SourceKind::Video { path, .. } => {
                let ext = path.rsplit('.').next().unwrap_or("").to_ascii_lowercase();
                !SOUND.contains(&ext.as_str())
            }
            _ => true,
        })
        .collect()
}

fn r(x: f32, y: f32, w: f32, h: f32) -> [u32; 4] {
    [
        x.round().max(0.0) as u32,
        y.round().max(0.0) as u32,
        w.round().max(1.0) as u32,
        h.round().max(1.0) as u32,
    ]
}

#[allow(clippy::too_many_arguments)]
fn tile(
    content: TileContent,
    x: f32,
    y: f32,
    w: f32,
    h: f32,
    s: f32,
    big: bool,
    tally: Tally,
    number: Option<u32>,
) -> Tile {
    // A 1 px border; the label strip at the bottom (13 or 16 px words with their padding).
    let b = s.max(1.0);
    let lh = if big { 27.0 } else { 23.0 } * s;
    let pic_h = (h - 2.0 * b - lh).max(1.0);
    let screen = !matches!(content, TileContent::Input(_));
    // The timecode at the end of a screen's label strip (12 px mono words, 8 px in from the edge).
    let tc_w = (TIMECODE_W * s).min((w - 2.0 * b) / 2.0);
    Tile {
        timecode: screen.then(|| r(x + w - b - tc_w, y + b + pic_h, tc_w, lh)),
        content,
        rect: r(x, y, w, h),
        picture: r(x + b, y + b, w - 2.0 * b, pic_h),
        label: r(x + b, y + b + pic_h, w - 2.0 * b, lh),
        tally,
        big,
        number,
    }
}

/// Room for a tile's timecode (`00:00:00:00` at 12 px mono and its margin), CSS pixels.
const TIMECODE_W: f32 = 104.0;
/// The header clock's box (`00:00:00:00` at 16 px mono, 10 px each side), CSS pixels.
const CLOCK_W: f32 = 132.0;

/// The multiview's layout for this show, `w` × `h` pixels.
pub fn layout(show: &Show, w: u32, h: u32) -> Layout {
    let (wf, hf) = (w as f32, h as f32);
    let s = hf / 1080.0;
    let pad = 4.0 * s;
    let gap = 4.0 * s;
    let (gx, gy, gw, gh) = (pad, pad, wf - 2.0 * pad, hf - 2.0 * pad);
    let header = r(gx, gy, gw, 32.0 * s);
    // The clock: 26 px high, 6 px in from the header's right end, centered in it.
    let clock = r(
        gx + gw - 6.0 * s - CLOCK_W * s,
        gy + 3.0 * s,
        CLOCK_W * s,
        26.0 * s,
    );
    let mut y = gy + 32.0 * s + gap;
    let mut tiles = Vec::new();
    let live = &show.screens.live;
    let back = &show.screens.back;
    let on_air =
        |id: &SourceId| live.program.as_ref() == Some(id) || back.program.as_ref() == Some(id);
    let next = |id: &SourceId| {
        [live, back]
            .iter()
            .any(|sc| sc.preview.as_ref() == Some(id) && sc.preview != sc.program)
    };
    let layout = show.settings.multiview.layout;
    let screens: &[ScreenId] = match layout {
        MultiviewLayout::Inputs => &[],
        MultiviewLayout::BothScreens => &[ScreenId::Live, ScreenId::Back],
        MultiviewLayout::Classic => &[ScreenId::Live],
    };
    if !screens.is_empty() {
        let share = if screens.len() == 2 { 0.60 } else { 0.58 };
        let total = gh * share;
        let n = screens.len() as f32;
        let row_h = (total - gap * (n - 1.0)) / n;
        let col_w = (gw - gap) / 2.0;
        for (i, sc) in screens.iter().enumerate() {
            let ry = y + i as f32 * (row_h + gap);
            tiles.push(tile(
                TileContent::Next(*sc),
                gx,
                ry,
                col_w,
                row_h,
                s,
                true,
                Tally::Pvw,
                None,
            ));
            tiles.push(tile(
                TileContent::Program(*sc),
                gx + col_w + gap,
                ry,
                col_w,
                row_h,
                s,
                true,
                Tally::Pgm,
                None,
            ));
        }
        y += total + gap;
    }
    let list = inputs(show);
    if !list.is_empty() {
        let min = if layout == MultiviewLayout::Inputs {
            (360.0 * s).min(0.45 * gw)
        } else {
            (260.0 * s).min(0.30 * gw)
        };
        let cols = (((gw + gap) / (min + gap)).floor() as usize).max(1);
        let rows = list.len().div_ceil(cols);
        let area_h = (gy + gh - y).max(1.0);
        let row_h = (area_h - gap * (rows as f32 - 1.0)) / rows as f32;
        let col_w = (gw - gap * (cols as f32 - 1.0)) / cols as f32;
        for (i, src) in list.iter().enumerate() {
            let (c, rw) = (i % cols, i / cols);
            let tally = if on_air(&src.id) {
                Tally::Pgm
            } else if next(&src.id) {
                Tally::Pvw
            } else {
                Tally::None
            };
            tiles.push(tile(
                TileContent::Input(src.id.clone()),
                gx + c as f32 * (col_w + gap),
                y + rw as f32 * (row_h + gap),
                col_w,
                row_h,
                s,
                false,
                tally,
                Some(i as u32 + 1),
            ));
        }
    }
    Layout {
        width: w,
        height: h,
        header,
        clock,
        tiles,
        scale: s,
    }
}

/// A picture of `aspect` (w / h) fitted inside `area` (pixels), centered.
pub fn fit(area: [u32; 4], aspect: f32) -> [u32; 4] {
    let [x, y, w, h] = area;
    let (wf, hf) = (w as f32, h as f32);
    let (fw, fh) = if wf / hf > aspect {
        (hf * aspect, hf)
    } else {
        (wf, wf / aspect)
    };
    r(
        x as f32 + (wf - fw) / 2.0,
        y as f32 + (hf - fh) / 2.0,
        fw,
        fh,
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use lumora_engine::{Fit, Source, SourceAudio};

    fn src(id: &str, kind: SourceKind) -> Source {
        Source {
            id: SourceId::new(id),
            name: id.to_owned(),
            kind,
            volume: 1.0,
            muted: false,
            looping: false,
            fit: Fit::Contain,
            audio: SourceAudio::default(),
            key: Default::default(),
            adjust: Default::default(),
            speed: None,
            ptz: None,
            playlist: None,
            video_delay_ms: None,
            camera: None,
            background: Default::default(),
            auto_frame: Default::default(),
            screens: Vec::new(),
        }
    }

    fn cam(id: &str) -> Source {
        src(
            id,
            SourceKind::Camera {
                device_id: id.into(),
                label: id.into(),
            },
        )
    }

    fn show() -> Show {
        let mut s = Show {
            sources: vec![
                cam("a"),
                cam("b"),
                cam("c"),
                src(
                    "mic",
                    SourceKind::Microphone {
                        device_id: "m".into(),
                        label: "m".into(),
                    },
                ),
            ],
            ..Show::default()
        };
        s.screens.live.program = Some(SourceId::new("a"));
        s.screens.live.preview = Some(SourceId::new("b"));
        s
    }

    fn inside(inner: [u32; 4], outer: [u32; 4]) -> bool {
        inner[0] >= outer[0]
            && inner[1] >= outer[1]
            && inner[0] + inner[2] <= outer[0] + outer[2]
            && inner[1] + inner[3] <= outer[1] + outer[3]
    }

    #[test]
    fn classic_has_next_and_on_air_big_then_the_inputs() {
        let l = layout(&show(), 1920, 1080);
        assert_eq!(l.tiles[0].content, TileContent::Next(ScreenId::Live));
        assert_eq!(l.tiles[1].content, TileContent::Program(ScreenId::Live));
        assert!(l.tiles[0].big && l.tiles[1].tally == Tally::Pgm);
        // Three inputs (the microphone has no picture), numbered, on air and next marked.
        let inputs: Vec<_> = l.tiles[2..].iter().map(|t| (t.number, t.tally)).collect();
        assert_eq!(
            inputs,
            vec![
                (Some(1), Tally::Pgm),
                (Some(2), Tally::Pvw),
                (Some(3), Tally::None)
            ]
        );
        // The screens take 58 % of the height; inputs fill the rest in one row of 7 columns.
        let big = l.tiles[0].rect;
        assert!((big[3] as f32 - (1072.0 * 0.58)).abs() < 2.0, "{big:?}");
        let small = l.tiles[2].rect;
        assert!(
            (small[2] as f32 - (1912.0 - 6.0 * 4.0) / 7.0).abs() < 1.5,
            "{small:?}"
        );
        assert!(small[1] > big[1] + big[3]);
        for t in &l.tiles {
            assert!(inside(t.picture, t.rect) && inside(t.label, t.rect));
            assert!(inside(t.rect, [0, 0, 1920, 1080]), "{t:?}");
            assert_eq!(t.picture[1] + t.picture[3], t.label[1]);
        }
    }

    #[test]
    fn both_screens_and_inputs_only() {
        let mut s = show();
        s.settings.multiview.layout = MultiviewLayout::BothScreens;
        let l = layout(&s, 1920, 1080);
        let screens: Vec<_> = l
            .tiles
            .iter()
            .filter(|t| t.big)
            .map(|t| t.content.clone())
            .collect();
        assert_eq!(
            screens,
            vec![
                TileContent::Next(ScreenId::Live),
                TileContent::Program(ScreenId::Live),
                TileContent::Next(ScreenId::Back),
                TileContent::Program(ScreenId::Back),
            ]
        );
        s.settings.multiview.layout = MultiviewLayout::Inputs;
        let l = layout(&s, 1920, 1080);
        assert!(l.tiles.iter().all(|t| !t.big));
        // Bigger tiles: five columns.
        assert!((l.tiles[0].rect[2] as f32 - (1912.0 - 16.0) / 5.0).abs() < 1.5);
    }

    #[test]
    fn many_inputs_wrap_into_rows_that_fit() {
        let mut s = show();
        for i in 0..12 {
            s.sources.push(cam(&format!("x{i}")));
        }
        let l = layout(&s, 1280, 720);
        let rows: std::collections::BTreeSet<u32> =
            l.tiles[2..].iter().map(|t| t.rect[1]).collect();
        assert_eq!(rows.len(), 3, "15 inputs, 7 a row");
        assert!(l.tiles.iter().all(|t| t.rect[1] + t.rect[3] <= 717));
    }

    /// The words' renderer reads this (`multiviewLabels.ts`: `MvLayout`).
    #[test]
    fn the_layout_reads_as_the_web_side_expects() {
        let v = serde_json::to_value(layout(&show(), 1920, 1080)).unwrap();
        assert_eq!(
            v["tiles"][0]["content"],
            serde_json::json!({ "type": "next", "id": "live" })
        );
        assert_eq!(v["tiles"][1]["tally"], "pgm");
        assert_eq!(
            v["tiles"][2]["content"],
            serde_json::json!({ "type": "input", "id": "a" })
        );
        assert_eq!(v["tiles"][2]["number"], 1);
        assert_eq!(v["header"].as_array().map(Vec::len), Some(4));
        assert_eq!(v["scale"], 1.0);
        // The timecodes: the header's clock, and the screens' tiles' (not the inputs').
        assert_eq!(v["clock"], serde_json::json!([1778, 7, 132, 26]));
        assert_eq!(v["tiles"][1]["timecode"].as_array().map(Vec::len), Some(4));
        assert!(v["tiles"][2]["timecode"].is_null());
    }

    #[test]
    fn pictures_are_fitted_in_their_box() {
        assert_eq!(fit([0, 0, 400, 300], 16.0 / 9.0), [0, 38, 400, 225]);
        assert_eq!(fit([10, 0, 400, 100], 16.0 / 9.0), [121, 0, 178, 100]);
    }
}
