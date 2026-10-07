//! How the outgoing and incoming pictures look at each moment of a
//! transition. A line-for-line port of `mixOf` / `mixAt` in
//! `app/src/engine/timing.ts` (and `lumaValue` in `app/src/engine/luma.ts`), so
//! the unified engine's transitions match the Standard engine's frame for frame.
//! The tests below use the same cases as `timing.test.ts`.

use lumora_engine::TransitionKind;

/// The part of the incoming picture that shows (fractions of the frame).
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum Shape {
    /// Everything shows.
    Whole,
    /// A rectangle: how much is cut off at the top, right, bottom and left.
    Rect { t: f32, r: f32, b: f32, l: f32 },
    /// A circle from the middle; 1 covers the corners.
    Circle { r: f32 },
    /// A diamond from the middle; 1 covers the corners.
    Diamond { r: f32 },
}

/// The luma wipe patterns.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LumaPattern {
    Clock,
    Circle,
    Blinds,
    Diagonal,
    Sparkle,
    Heart,
}

impl LumaPattern {
    /// The number the shader knows the pattern by (1 – 6; 0 is "no luma wipe").
    pub fn code(self) -> u32 {
        match self {
            LumaPattern::Clock => 1,
            LumaPattern::Circle => 2,
            LumaPattern::Blinds => 3,
            LumaPattern::Diagonal => 4,
            LumaPattern::Sparkle => 5,
            LumaPattern::Heart => 6,
        }
    }
}

/// How the two pictures look at one moment.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Mix {
    pub in_opacity: f32,
    pub out_opacity: f32,
    /// Black over both (dip).
    pub black: f32,
    /// White over both (flash).
    pub white: f32,
    pub in_shape: Shape,
    /// Offsets in % of the frame (slides).
    pub in_shift: f32,
    pub out_shift: f32,
    pub in_shift_y: f32,
    pub out_shift_y: f32,
    /// Size, 1 = as is (zooms).
    pub in_scale: f32,
    pub out_scale: f32,
    /// Blur, as a fraction of the frame height.
    pub in_blur: f32,
    pub out_blur: f32,
    /// The outgoing picture is drawn over the incoming one (reveal, zoom out).
    pub out_on_top: bool,
    /// A luma wipe: the pattern and how far it is (0 – 1).
    pub in_luma: Option<(LumaPattern, f32)>,
}

impl Mix {
    const fn base(in_opacity: f32, out_opacity: f32, black: f32) -> Self {
        Mix {
            in_opacity,
            out_opacity,
            black,
            white: 0.0,
            in_shape: Shape::Whole,
            in_shift: 0.0,
            out_shift: 0.0,
            in_shift_y: 0.0,
            out_shift_y: 0.0,
            in_scale: 1.0,
            out_scale: 1.0,
            in_blur: 0.0,
            out_blur: 0.0,
            out_on_top: false,
            in_luma: None,
        }
    }
    const WHOLE: Mix = Mix::base(1.0, 1.0, 0.0);
}

fn smooth(x: f32) -> f32 {
    x * x * (3.0 - 2.0 * x)
}

/// How blurred the pictures get in the middle of a blur transition.
const BLUR: f32 = 0.03;

fn rect(t: f32, r: f32, b: f32, l: f32) -> Shape {
    Shape::Rect { t, r, b, l }
}

fn mix_of(kind: TransitionKind, x: f32) -> Mix {
    use TransitionKind as K;
    let e = smooth(x);
    let whole = Mix::WHOLE;
    let shaped = |s: Shape| Mix {
        in_shape: s,
        ..whole
    };
    match kind {
        K::Cut => Mix::base(if x >= 1.0 { 1.0 } else { 0.0 }, 1.0, 0.0),
        K::Fade => Mix::base(x, 1.0, 0.0),
        K::Merge => Mix::base(e, 1.0 - e * 0.35, 0.0),
        K::Dip => {
            if x < 0.5 {
                Mix::base(0.0, 1.0, smooth(x * 2.0))
            } else {
                Mix::base(1.0, 0.0, smooth((1.0 - x) * 2.0))
            }
        }
        K::Flash => {
            if x < 0.5 {
                Mix {
                    white: smooth(x * 2.0),
                    ..Mix::base(0.0, 1.0, 0.0)
                }
            } else {
                Mix {
                    white: smooth((1.0 - x) * 2.0),
                    ..Mix::base(1.0, 0.0, 0.0)
                }
            }
        }
        K::Wipe => shaped(rect(0.0, 1.0 - x, 0.0, 0.0)),
        K::WipeLeft => shaped(rect(0.0, 0.0, 0.0, 1.0 - x)),
        K::WipeDown => shaped(rect(0.0, 0.0, 1.0 - x, 0.0)),
        K::WipeUp => shaped(rect(1.0 - x, 0.0, 0.0, 0.0)),
        K::Split => shaped(rect(0.0, (1.0 - x) / 2.0, 0.0, (1.0 - x) / 2.0)),
        K::SplitVertical => shaped(rect((1.0 - x) / 2.0, 0.0, (1.0 - x) / 2.0, 0.0)),
        K::Iris => shaped(Shape::Circle { r: e }),
        K::Diamond => shaped(Shape::Diamond { r: e }),
        K::Slide => Mix {
            in_shift: (1.0 - e) * 100.0,
            out_shift: -e * 100.0,
            ..whole
        },
        K::SlideRight => Mix {
            in_shift: -(1.0 - e) * 100.0,
            out_shift: e * 100.0,
            ..whole
        },
        K::SlideDown => Mix {
            in_shift_y: -(1.0 - e) * 100.0,
            out_shift_y: e * 100.0,
            ..whole
        },
        K::SlideUp => Mix {
            in_shift_y: (1.0 - e) * 100.0,
            out_shift_y: -e * 100.0,
            ..whole
        },
        K::Cover => Mix {
            in_shift: (1.0 - e) * 100.0,
            ..whole
        },
        K::Reveal => Mix {
            out_shift: -e * 100.0,
            out_on_top: true,
            ..whole
        },
        K::Zoom => Mix {
            in_scale: 0.6 + 0.4 * e,
            ..Mix::base(e, 1.0, 0.0)
        },
        K::ZoomOut => Mix {
            out_scale: 1.0 + 0.6 * e,
            out_on_top: true,
            ..Mix::base(1.0, 1.0 - e, 0.0)
        },
        K::LumaClock => luma(LumaPattern::Clock, x),
        K::LumaCircle => luma(LumaPattern::Circle, x),
        K::LumaBlinds => luma(LumaPattern::Blinds, x),
        K::LumaDiagonal => luma(LumaPattern::Diagonal, x),
        K::LumaSparkle => luma(LumaPattern::Sparkle, x),
        K::LumaHeart => luma(LumaPattern::Heart, x),
        // The stinger covers the switch; the scene cuts at its own point.
        K::Stinger1 | K::Stinger2 => Mix::base(if x >= 0.5 { 1.0 } else { 0.0 }, 1.0, 0.0),
        K::Blur => {
            let b = (std::f32::consts::PI * x).sin() * BLUR;
            Mix {
                in_blur: b,
                out_blur: b,
                ..Mix::base(smooth(((x - 0.3) / 0.4).clamp(0.0, 1.0)), 1.0, 0.0)
            }
        }
    }
}

fn luma(p: LumaPattern, x: f32) -> Mix {
    Mix {
        in_luma: Some((p, x)),
        ..Mix::WHOLE
    }
}

/// The mix at progress `p` (clamped to 0 – 1).
pub fn mix_at(kind: TransitionKind, p: f32) -> Mix {
    let p = if p.is_finite() {
        p.clamp(0.0, 1.0)
    } else {
        1.0
    };
    mix_of(kind, p)
}

/// Which stinger slot a transition plays.
pub fn stinger_slot(kind: TransitionKind) -> Option<usize> {
    kind.stinger()
}

/// 0 → 1 as a blank (or PANIC) fades in; 1 → 0 as it fades out. `ms` 0: the usual length.
pub fn fade_amount(on: bool, changed_at: u64, now: u64, ms: u32) -> f32 {
    let len = if ms == 0 {
        lumora_engine::BLANK_FADE_MS
    } else {
        ms
    };
    let k = (now.saturating_sub(changed_at) as f32 / len as f32).clamp(0.0, 1.0);
    if on {
        k
    } else {
        1.0 - k
    }
}

/// A luma pattern's gray value at (u, v), both 0 – 1 across a 16:9 frame
/// (the CPU twin of the shader's `luma_value`, for tests and documentation).
pub fn luma_value(p: LumaPattern, u: f32, v: f32) -> f32 {
    let x = (u - 0.5) * (16.0 / 9.0);
    let y = v - 0.5;
    match p {
        LumaPattern::Clock => {
            let a = x.atan2(-y) / (2.0 * std::f32::consts::PI) + 1.0;
            a.rem_euclid(1.0)
        }
        LumaPattern::Circle => (x.hypot(y) / 1.02).min(1.0),
        LumaPattern::Blinds => (u * 8.0).rem_euclid(1.0),
        LumaPattern::Diagonal => (u + v) / 2.0,
        LumaPattern::Sparkle => {
            let cx = (u * 64.0).floor();
            let cy = (v * 36.0).floor();
            let a = (cx * 12.9898 + cy * 78.233).sin() * 43758.547;
            a - a.floor()
        }
        LumaPattern::Heart => {
            let hx = x * 2.2;
            let hy = -y * 2.2 + 0.15;
            let inside = |k: f32| {
                let xx = hx / k;
                let yy = hy / k;
                let a = xx * xx + yy * yy - 1.0;
                a * a * a - xx * xx * yy * yy * yy <= 0.0
            };
            let (mut lo, mut hi) = (0.001_f32, 4.0_f32);
            for _ in 0..24 {
                let mid = (lo + hi) / 2.0;
                if inside(mid) {
                    hi = mid;
                } else {
                    lo = mid;
                }
            }
            (hi / 2.9).min(1.0)
        }
    }
}

/// How soft a luma wipe's edge is.
pub const LUMA_SOFT: f32 = 0.08;

/// How much of the new source shows at a point of the pattern.
pub fn luma_alpha(luma: f32, p: f32) -> f32 {
    ((p * (1.0 + LUMA_SOFT) - luma) / LUMA_SOFT).clamp(0.0, 1.0)
}

/// Whether a point (u, v in 0 – 1) is inside the incoming picture's shape
/// (the CPU twin of the shader's clip test).
pub fn inside_shape(s: Shape, u: f32, v: f32) -> bool {
    match s {
        Shape::Whole => true,
        Shape::Rect { t, r, b, l } => u >= l && u <= 1.0 - r && v >= t && v <= 1.0 - b,
        Shape::Circle { r } => {
            // CSS: radius against diagonal / √2, centred; half the diagonal (in px) covers the corners.
            // In 16:9 pixels: radius r·(diag/2).
            let dx = (u - 0.5) * 16.0;
            let dy = (v - 0.5) * 9.0;
            let half_diag = (16.0_f32.hypot(9.0)) / 2.0;
            dx.hypot(dy) <= r * half_diag
        }
        Shape::Diamond { r } => (u - 0.5).abs() + (v - 0.5).abs() <= r,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use TransitionKind as K;

    const ALL: [K; 28] = [
        K::Fade,
        K::Merge,
        K::Dip,
        K::Flash,
        K::Wipe,
        K::WipeLeft,
        K::WipeDown,
        K::WipeUp,
        K::Slide,
        K::SlideRight,
        K::SlideDown,
        K::SlideUp,
        K::Cover,
        K::Reveal,
        K::Split,
        K::SplitVertical,
        K::Iris,
        K::Diamond,
        K::Zoom,
        K::ZoomOut,
        K::Blur,
        K::LumaClock,
        K::LumaCircle,
        K::LumaBlinds,
        K::LumaDiagonal,
        K::LumaSparkle,
        K::LumaHeart,
        K::Cut,
    ];

    fn close(a: f32, b: f32) -> bool {
        (a - b).abs() < 1e-4
    }

    #[test]
    fn fades_the_new_picture_in_over_the_old_one() {
        let m = mix_at(K::Fade, 0.25);
        assert_eq!((m.in_opacity, m.out_opacity, m.black), (0.25, 1.0, 0.0));
    }

    #[test]
    fn dips_through_full_black_at_the_midpoint() {
        assert_eq!(mix_at(K::Dip, 0.25).in_opacity, 0.0);
        assert_eq!(mix_at(K::Dip, 0.5).black, 1.0);
        assert_eq!(mix_at(K::Dip, 0.75).out_opacity, 0.0);
    }

    #[test]
    fn wipes_and_slides_reach_exactly_the_new_picture() {
        assert_eq!(mix_at(K::Wipe, 1.0).in_shape, rect(0.0, 0.0, 0.0, 0.0));
        let s = mix_at(K::Slide, 1.0);
        assert_eq!((s.in_shift, s.out_shift), (0.0, -100.0));
        assert_eq!(
            mix_at(K::Split, 0.0).in_shape,
            rect(0.0, 0.5, 0.0, 0.5),
            "split starts closed in the middle"
        );
        assert_eq!(mix_at(K::Diamond, 1.0).in_shape, Shape::Diamond { r: 1.0 });
    }

    #[test]
    fn every_transition_ends_on_the_new_picture() {
        for k in ALL {
            let end = mix_at(k, 1.0);
            assert!(close(end.in_opacity, 1.0), "{k:?}");
            assert!(close(end.black, 0.0), "{k:?}");
            assert!(close(end.white, 0.0), "{k:?}");
            assert!(
                close(end.in_shift, 0.0) && close(end.in_shift_y, 0.0),
                "{k:?}"
            );
            assert!(close(end.in_scale, 1.0), "{k:?}");
            assert!(close(end.in_blur, 0.0), "{k:?}");
            // Every point of the frame is the new picture.
            for (u, v) in [(0.0, 0.0), (1.0, 1.0), (0.5, 0.5), (0.99, 0.01)] {
                assert!(inside_shape(end.in_shape, u, v), "{k:?} at {u},{v}");
                if let Some((p, x)) = end.in_luma {
                    assert!(close(luma_alpha(luma_value(p, u, v), x), 1.0), "{k:?}");
                }
            }
        }
    }

    #[test]
    fn every_transition_starts_on_the_old_picture() {
        for k in ALL {
            let s = mix_at(k, 0.0);
            let hidden = (s.out_on_top && s.out_opacity == 1.0 && s.out_shift == 0.0)
                || s.in_opacity == 0.0
                || s.in_shift.abs() >= 100.0
                || s.in_shift_y.abs() >= 100.0
                || s.in_shape != Shape::Whole
                || s.in_luma.is_some();
            assert!(hidden, "{k:?}");
            assert!(close(s.out_opacity, 1.0), "{k:?}");
            if let Some((p, x)) = s.in_luma {
                // Nothing of the new picture shows yet (bar the pattern's darkest points).
                assert!(luma_alpha(luma_value(p, 0.7, 0.3), x) < 0.01, "{k:?}");
            }
        }
    }

    #[test]
    fn clamps_out_of_range_progress() {
        assert_eq!(mix_at(K::Fade, 2.0).in_opacity, 1.0);
        assert_eq!(mix_at(K::Fade, -1.0).in_opacity, 0.0);
        assert_eq!(mix_at(K::Fade, f32::NAN).in_opacity, 1.0);
    }

    #[test]
    fn blank_fades_in_and_out_over_300ms() {
        assert!(close(fade_amount(true, 1000, 1150, 0), 0.5));
        assert!(close(fade_amount(false, 1000, 1150, 0), 0.5));
        assert_eq!(fade_amount(true, 1000, 5000, 0), 1.0);
        assert!(
            close(fade_amount(true, 0, 1000, 2000), 0.5),
            "fade to black has its own length"
        );
    }

    #[test]
    fn luma_patterns_stay_in_range() {
        for p in [
            LumaPattern::Clock,
            LumaPattern::Circle,
            LumaPattern::Blinds,
            LumaPattern::Diagonal,
            LumaPattern::Sparkle,
            LumaPattern::Heart,
        ] {
            for i in 0..=10 {
                for j in 0..=10 {
                    let v = luma_value(p, i as f32 / 10.0, j as f32 / 10.0);
                    assert!((0.0..=1.0).contains(&v), "{p:?} {v}");
                }
            }
        }
        // The clock starts at twelve o'clock and goes round clockwise.
        assert!(luma_value(LumaPattern::Clock, 0.5, 0.1) < 0.01);
        assert!(close(luma_value(LumaPattern::Clock, 0.9, 0.5), 0.25));
    }

    #[test]
    fn iris_covers_the_corners_at_the_end() {
        assert!(!inside_shape(Shape::Circle { r: 0.5 }, 0.0, 0.0));
        assert!(inside_shape(Shape::Circle { r: 1.0 }, 0.0, 0.0));
        assert!(inside_shape(Shape::Circle { r: 0.1 }, 0.5, 0.5));
    }
}
