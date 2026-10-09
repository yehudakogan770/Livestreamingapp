//! Drawing on screen (a telestrator): the operator draws lines and arrows
//! over the picture, on an overlay, to point things out (a play in a game, a
//! part of a slide). Each stroke is kept in frame fractions (0 – 1), so it
//! lands in the same place on every screen and in the recording.

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::model::Millis;

/// Most strokes in one drawing (older ones go first).
pub const MAX_STROKES: usize = 200;
/// Most points in one stroke (the control window thins longer ones).
pub const MAX_POINTS: usize = 1000;
/// Thinnest and thickest line, as a fraction of the frame's height.
pub const MIN_WIDTH: f32 = 0.002;
pub const MAX_WIDTH: f32 = 0.05;

/// One line drawn in one movement.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", default)]
#[ts(export)]
pub struct Stroke {
    /// `#rrggbb`.
    pub color: String,
    /// Thickness, as a fraction of the frame's height.
    pub width: f32,
    /// Where it goes, as fractions of the frame (x, y).
    pub points: Vec<[f32; 2]>,
    /// An arrowhead at the end.
    pub arrow: bool,
}

impl Default for Stroke {
    fn default() -> Self {
        Stroke {
            color: "#ffd400".to_owned(),
            width: 0.008,
            points: Vec::new(),
            arrow: false,
        }
    }
}

fn hex_color(c: &str) -> bool {
    c.len() == 7 && c.starts_with('#') && c[1..].chars().all(|ch| ch.is_ascii_hexdigit())
}

impl Stroke {
    /// Keep it within the rules: a color, a sensible width, points on the
    /// frame (a little outside is allowed), not too many.
    pub fn repair(&mut self) {
        if !hex_color(&self.color) {
            "#ffd400".clone_into(&mut self.color);
        }
        self.width = if self.width.is_finite() {
            self.width.clamp(MIN_WIDTH, MAX_WIDTH)
        } else {
            0.008
        };
        self.points.retain(|[x, y]| x.is_finite() && y.is_finite());
        for p in &mut self.points {
            p[0] = p[0].clamp(-0.1, 1.1);
            p[1] = p[1].clamp(-0.1, 1.1);
        }
        self.points.truncate(MAX_POINTS);
    }
}

/// A drawing input: the strokes on it now.
#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", default)]
#[ts(export)]
pub struct Drawing {
    pub strokes: Vec<Stroke>,
    /// When it last changed.
    #[ts(type = "number")]
    pub changed_at: Millis,
}

impl Drawing {
    pub fn repair(&mut self) {
        for s in &mut self.strokes {
            s.repair();
        }
        self.strokes.retain(|s| !s.points.is_empty());
        if self.strokes.len() > MAX_STROKES {
            let drop = self.strokes.len() - MAX_STROKES;
            self.strokes.drain(..drop);
        }
    }

    /// Add a stroke (a single tap makes a dot). The oldest goes when it is full.
    pub fn add(&mut self, mut stroke: Stroke, now: Millis) {
        stroke.repair();
        if stroke.points.is_empty() {
            return;
        }
        self.strokes.push(stroke);
        if self.strokes.len() > MAX_STROKES {
            self.strokes.remove(0);
        }
        self.changed_at = now;
    }

    /// Take the last stroke away.
    pub fn undo(&mut self, now: Millis) {
        if self.strokes.pop().is_some() {
            self.changed_at = now;
        }
    }

    pub fn clear(&mut self, now: Millis) {
        if !self.strokes.is_empty() {
            self.strokes.clear();
            self.changed_at = now;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn strokes_are_kept_in_range_and_the_oldest_go_first() {
        let mut d = Drawing::default();
        d.add(
            Stroke {
                color: "red".into(),
                width: 9.0,
                points: vec![[0.5, 0.5], [f32::NAN, 0.2], [2.0, -3.0]],
                arrow: true,
            },
            10,
        );
        let s = &d.strokes[0];
        assert_eq!(s.color, "#ffd400");
        assert!((s.width - MAX_WIDTH).abs() < f32::EPSILON);
        assert_eq!(s.points, vec![[0.5, 0.5], [1.1, -0.1]]);
        assert_eq!(d.changed_at, 10);
        // Nothing to draw: nothing added.
        d.add(Stroke::default(), 20);
        assert_eq!(d.strokes.len(), 1);
        assert_eq!(d.changed_at, 10);
        for i in 0..MAX_STROKES {
            d.add(
                Stroke {
                    points: vec![[0.1, 0.1]],
                    color: format!("#{i:06x}"),
                    ..Stroke::default()
                },
                30,
            );
        }
        assert_eq!(d.strokes.len(), MAX_STROKES);
        assert_eq!(d.strokes[0].color, "#000000");
        d.undo(40);
        assert_eq!(d.strokes.len(), MAX_STROKES - 1);
        d.clear(50);
        assert!(d.strokes.is_empty());
        assert_eq!(d.changed_at, 50);
    }
}
