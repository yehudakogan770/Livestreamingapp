@@@
    /// The background behind the people, without a green screen (None: kept).
    /// Applied once the vision worker has sent a person mask ([`crate::vision`]).
    pub backdrop: Option<Backdrop>,
}
===
    /// The background behind the people, without a green screen (None: kept).
    /// Applied once the vision worker has sent a person mask ([`crate::vision`]).
    pub backdrop: Option<Backdrop>,
    /// It fades in from this time (show-clock ms) over this many ms, eased
    /// out (a camera or video coming up as a slide: the slides' `slide-in`).
    pub appear: Option<(u64, u32)>,
}

/// How much of a picture that appears from `start` over `ms` shows at `now`:
/// CSS `ease-out` (`cubic-bezier(0, 0, 0.58, 1)`), as the slides' fade.
pub fn appear_amount(start: u64, ms: u32, now: u64) -> f32 {
    if ms == 0 {
        return 1.0;
    }
    let x = (now.saturating_sub(start) as f64 / f64::from(ms)).clamp(0.0, 1.0);
    // The curve's x(s) = 3(1-s)s²·0.58 + s³ … solved for s by bisection, then y(s).
    let (x1, x2) = (0.0, 0.58);
    let bez = |s: f64, a: f64, b: f64| 3.0 * (1.0 - s) * (1.0 - s) * s * a + 3.0 * (1.0 - s) * s * s * b + s * s * s;
    let (mut lo, mut hi) = (0.0, 1.0);
    for _ in 0..30 {
        let mid = (lo + hi) / 2.0;
        if bez(mid, x1, x2) < x {
            lo = mid;
        } else {
            hi = mid;
        }
    }
    bez((lo + hi) / 2.0, 0.0, 1.0) as f32
}

/// The slides' fade (`slide-in 0.4s` on the web).
pub const SLIDE_FADE_MS: u32 = 400;
@@@
            look: None,
            backdrop: None,
        }
    }
}
===
            look: None,
            backdrop: None,
            appear: None,
        }
    }
}
@@@
                    out.push(Picture {
                        content: Content::Video(inner.id.clone()),
                        placement: placement_of(inner, r),
                    });
===
                    let mut placement = placement_of(inner, r);
                    // It comes up with the slides' fade, as any slide.
                    if k.fade {
                        placement.appear = Some((k.changed_at, SLIDE_FADE_MS));
                    }
                    out.push(Picture {
                        content: Content::Video(inner.id.clone()),
                        placement,
                    });
