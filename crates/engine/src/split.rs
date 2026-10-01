//! Split screen: two to four inputs on the screen at once (two cameras side
//! by side, picture-in-picture, a grid of four). It is an input like any
//! other, so it goes to Next and is taken to air; its layout can change
//! while it is on air.

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::model::SourceId;
use crate::overlays::Frame;

/// Most boxes.
pub const MAX_BOXES: usize = 4;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub enum SplitLayout {
    /// Two, side by side.
    #[default]
    SideBySide,
    /// One big, one small in the corner.
    PictureInPicture,
    /// One big on the left, two stacked on the right.
    ThreeUp,
    /// Four in a grid.
    Grid,
    /// Boxes placed by hand.
    Custom,
}

impl SplitLayout {
    /// The boxes of a ready-made layout, in % of the frame.
    pub fn frames(self, gap: f32) -> Vec<Frame> {
        let g = gap;
        let half = (100.0 - 3.0 * g) / 2.0;
        match self {
            SplitLayout::SideBySide => {
                // Two 16:9 pictures side by side, centered.
                let w = half;
                let h = w * (16.0 / 9.0) * (9.0 / 16.0);
                let y = (100.0 - h) / 2.0;
                vec![
                    Frame { x: g, y, w, h },
                    Frame {
                        x: 2.0 * g + w,
                        y,
                        w,
                        h,
                    },
                ]
            }
            SplitLayout::PictureInPicture => vec![
                Frame {
                    x: 0.0,
                    y: 0.0,
                    w: 100.0,
                    h: 100.0,
                },
                Frame {
                    x: 68.0,
                    y: 6.0,
                    w: 28.0,
                    h: 28.0,
                },
            ],
            SplitLayout::ThreeUp => {
                let big = 100.0 - 3.0 * g - (100.0 - 3.0 * g) / 3.0;
                let small = 100.0 - 3.0 * g - big;
                let sh = (100.0 - 3.0 * g) / 2.0;
                vec![
                    Frame {
                        x: g,
                        y: g,
                        w: big,
                        h: 100.0 - 2.0 * g,
                    },
                    Frame {
                        x: 2.0 * g + big,
                        y: g,
                        w: small,
                        h: sh,
                    },
                    Frame {
                        x: 2.0 * g + big,
                        y: 2.0 * g + sh,
                        w: small,
                        h: sh,
                    },
                ]
            }
            SplitLayout::Grid => vec![
                Frame {
                    x: g,
                    y: g,
                    w: half,
                    h: half,
                },
                Frame {
                    x: 2.0 * g + half,
                    y: g,
                    w: half,
                    h: half,
                },
                Frame {
                    x: g,
                    y: 2.0 * g + half,
                    w: half,
                    h: half,
                },
                Frame {
                    x: 2.0 * g + half,
                    y: 2.0 * g + half,
                    w: half,
                    h: half,
                },
            ],
            SplitLayout::Custom => Vec::new(),
        }
    }
}

/// One box of a split screen.
#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", default)]
#[ts(export)]
pub struct SplitBox {
    pub source_id: Option<SourceId>,
    pub frame: Frame,
}

/// A split-screen input.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", default)]
#[ts(export)]
pub struct Split {
    pub layout: SplitLayout,
    /// Up to four boxes; the first is at the back.
    pub boxes: Vec<SplitBox>,
    /// Space between boxes, % of the frame.
    pub gap: f32,
    pub background: String,
    /// A thin line around each box.
    pub border: bool,
    pub border_color: String,
}

impl Default for Split {
    fn default() -> Self {
        let mut s = Split {
            layout: SplitLayout::SideBySide,
            boxes: Vec::new(),
            gap: 2.0,
            background: "#101216".to_owned(),
            border: false,
            border_color: "#ffffff".to_owned(),
        };
        s.apply_layout();
        s
    }
}

fn is_color(c: &str) -> bool {
    c.len() == 7 && c.starts_with('#') && c[1..].chars().all(|c| c.is_ascii_hexdigit())
}

impl Split {
    /// Put the boxes where the chosen layout has them (keeping their inputs).
    pub fn apply_layout(&mut self) {
        if self.layout == SplitLayout::Custom {
            return;
        }
        let frames = self.layout.frames(self.gap);
        self.boxes.resize_with(frames.len(), SplitBox::default);
        for (b, f) in self.boxes.iter_mut().zip(frames) {
            b.frame = f;
        }
    }

    pub fn repair(&mut self) {
        self.gap = if self.gap.is_finite() {
            self.gap.clamp(0.0, 10.0)
        } else {
            2.0
        };
        self.boxes.truncate(MAX_BOXES);
        for b in &mut self.boxes {
            b.frame = b.frame.clamped();
        }
        let d = Split::default();
        if !is_color(&self.background) {
            self.background = d.background;
        }
        if !is_color(&self.border_color) {
            self.border_color = d.border_color;
        }
        self.apply_layout();
    }
}
