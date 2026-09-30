//! A free-layout graphic (the title designer): text, boxes and pictures put
//! anywhere on the frame, each with its own look, all coming in together.
//! Text can take words from the data file with `{Column}`.

use serde::{Deserialize, Serialize};
use ts_rs::TS;

pub const MAX_ELEMENTS: usize = 40;

fn clean(s: &str, max: usize) -> String {
    s.chars()
        .filter(|c| !c.is_control() || *c == '\n')
        .take(max)
        .collect()
}

fn color(c: &str, fallback: &str) -> String {
    let ok = c.len() == 7 && c.starts_with('#') && c[1..].chars().all(|ch| ch.is_ascii_hexdigit());
    if ok {
        c.to_owned()
    } else {
        fallback.to_owned()
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub enum ElementKind {
    #[default]
    Text,
    /// A coloured box (a bar, a panel, a line).
    Box,
    /// A picture file.
    Image,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub enum TextAlign {
    #[default]
    Left,
    Center,
    Right,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub enum Entrance {
    /// Just there.
    None,
    #[default]
    Fade,
    /// Slides in from the left.
    SlideLeft,
    /// Rises from below.
    Rise,
    /// Grows from its middle.
    Grow,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", default)]
#[ts(export)]
pub struct Element {
    pub id: u32,
    pub kind: ElementKind,
    /// Where and how big, in % of the frame's width and height.
    pub x: f32,
    pub y: f32,
    pub w: f32,
    pub h: f32,
    /// Text: the words ({Column} for the data file).
    pub text: String,
    pub font: String,
    /// Text size in % of the frame height.
    pub size: f32,
    pub weight: u16,
    pub italic: bool,
    pub align: TextAlign,
    /// Text colour, or the box's colour.
    pub color: String,
    /// Box corners, in % of the frame height.
    pub radius: f32,
    /// 0 – 1.
    pub opacity: f32,
    /// Image: the picture file.
    pub path: String,
    pub shadow: bool,
    /// How it comes in, and how long after the graphic starts (ms).
    pub entrance: Entrance,
    pub delay_ms: u32,
}

impl Default for Element {
    fn default() -> Self {
        Element {
            id: 0,
            kind: ElementKind::Text,
            x: 10.0,
            y: 70.0,
            w: 40.0,
            h: 10.0,
            text: "Text".to_owned(),
            font: "Segoe UI".to_owned(),
            size: 5.0,
            weight: 700,
            italic: false,
            align: TextAlign::Left,
            color: "#ffffff".to_owned(),
            radius: 0.0,
            opacity: 1.0,
            path: String::new(),
            shadow: false,
            entrance: Entrance::Fade,
            delay_ms: 0,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", default)]
#[ts(export)]
pub struct Graphic {
    /// Back to front.
    pub elements: Vec<Element>,
    pub next_id: u32,
}

fn finite(v: f32, lo: f32, hi: f32, fallback: f32) -> f32 {
    if v.is_finite() {
        v.clamp(lo, hi)
    } else {
        fallback
    }
}

impl Graphic {
    pub fn repair(&mut self) {
        self.elements.truncate(MAX_ELEMENTS);
        let mut seen = std::collections::HashSet::new();
        for e in &mut self.elements {
            if e.id == 0 || !seen.insert(e.id) {
                self.next_id = self.next_id.wrapping_add(1).max(1);
                e.id = self.next_id;
                seen.insert(e.id);
            }
            self.next_id = self.next_id.max(e.id);
            e.x = finite(e.x, -50.0, 150.0, 0.0);
            e.y = finite(e.y, -50.0, 150.0, 0.0);
            e.w = finite(e.w, 0.5, 200.0, 20.0);
            e.h = finite(e.h, 0.3, 200.0, 10.0);
            e.size = finite(e.size, 0.5, 50.0, 5.0);
            e.radius = finite(e.radius, 0.0, 50.0, 0.0);
            e.opacity = finite(e.opacity, 0.0, 1.0, 1.0);
            e.weight = e.weight.clamp(100, 900);
            e.delay_ms = e.delay_ms.min(10_000);
            e.text = clean(&e.text, 500);
            e.font = clean(&e.font, 60);
            e.path = clean(&e.path, 1000);
            e.color = color(&e.color, "#ffffff");
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn repairs_elements() {
        let mut g = Graphic {
            elements: vec![
                Element {
                    id: 3,
                    x: f32::NAN,
                    color: "red".into(),
                    ..Element::default()
                },
                Element {
                    id: 3,
                    opacity: 4.0,
                    ..Element::default()
                },
            ],
            next_id: 0,
        };
        g.repair();
        assert!(g.elements[0].x.abs() < f32::EPSILON);
        assert_eq!(g.elements[0].color, "#ffffff");
        assert_ne!(g.elements[0].id, g.elements[1].id, "ids stay apart");
        assert!((g.elements[1].opacity - 1.0).abs() < f32::EPSILON);
    }
}
