//! The blend modes on the CPU: the same math as the `composite` program (the
//! W3C compositing formulas on premultiplied color), for checking what the GPU
//! draws and for tests.

/// In the order the programs number them (`uMode`), as the editor lists them.
pub const MODES: [&str; 17] = [
    "normal",
    "multiply",
    "screen",
    "overlay",
    "add",
    "darken",
    "lighten",
    "difference",
    "softlight",
    "hardlight",
    "colordodge",
    "colorburn",
    "exclusion",
    "hue",
    "saturation",
    "color",
    "luminosity",
];

pub type Rgb = [f32; 3];
pub type Rgba = [f32; 4];

fn map(c: Rgb, f: impl Fn(f32) -> f32) -> Rgb {
    [f(c[0]), f(c[1]), f(c[2])]
}
fn zip(a: Rgb, b: Rgb, f: impl Fn(f32, f32) -> f32) -> Rgb {
    [f(a[0], b[0]), f(a[1], b[1]), f(a[2], b[2])]
}
fn step(edge: f32, x: f32) -> f32 {
    if x < edge {
        0.0
    } else {
        1.0
    }
}
fn mix(a: f32, b: f32, t: f32) -> f32 {
    a * (1.0 - t) + b * t
}
fn lum(c: Rgb) -> f32 {
    c[0] * 0.3 + c[1] * 0.59 + c[2] * 0.11
}
fn clip_color(c: Rgb) -> Rgb {
    let l = lum(c);
    let n = c[0].min(c[1]).min(c[2]);
    let x = c[0].max(c[1]).max(c[2]);
    let mut c = c;
    if n < 0.0 {
        c = map(c, |v| l + (v - l) * l / (l - n).max(1e-5));
    }
    if x > 1.0 {
        c = map(c, |v| l + (v - l) * (1.0 - l) / (x - l).max(1e-5));
    }
    c
}
fn set_lum(c: Rgb, l: f32) -> Rgb {
    let d = l - lum(c);
    clip_color(map(c, |v| v + d))
}
fn sat(c: Rgb) -> f32 {
    c[0].max(c[1]).max(c[2]) - c[0].min(c[1]).min(c[2])
}
fn set_sat(c: Rgb, s: f32) -> Rgb {
    let x = c[0].max(c[1]).max(c[2]);
    let n = c[0].min(c[1]).min(c[2]);
    if x > n {
        map(c, |v| (v - n) * s / (x - n))
    } else {
        [0.0; 3]
    }
}
fn hard_light(b: f32, s: f32) -> f32 {
    mix(
        b * 2.0 * s,
        b + (2.0 * s - 1.0) - b * (2.0 * s - 1.0),
        step(0.5001, s),
    )
}

/// One mode on straight (not premultiplied) colors: base `b`, layer `s`.
pub fn blend_one(mode: usize, b: Rgb, s: Rgb) -> Rgb {
    match mode {
        1 => zip(b, s, |b, s| b * s),
        2 => zip(b, s, |b, s| b + s - b * s),
        3 => zip(b, s, |b, s| {
            mix(2.0 * b * s, 1.0 - 2.0 * (1.0 - b) * (1.0 - s), step(0.5, b))
        }),
        4 => zip(b, s, |b, s| (b + s).min(1.0)),
        5 => zip(b, s, f32::min),
        6 => zip(b, s, f32::max),
        7 => zip(b, s, |b, s| (b - s).abs()),
        8 => zip(b, s, |b, s| {
            let d = mix(((16.0 * b - 12.0) * b + 4.0) * b, b.sqrt(), step(0.25, b));
            mix(
                b - (1.0 - 2.0 * s) * b * (1.0 - b),
                b + (2.0 * s - 1.0) * (d - b),
                step(0.5, s),
            )
        }),
        9 => zip(b, s, hard_light),
        10 => zip(b, s, |b, s| {
            mix((b / (1.0 - s).max(1e-5)).min(1.0), 1.0, step(0.99999, s)) * step(1e-6, b)
        }),
        11 => zip(b, s, |b, s| {
            mix(1.0 - ((1.0 - b) / s.max(1e-5)).min(1.0), 0.0, step(s, 1e-6))
                * (1.0 - step(0.99999, b))
                + step(0.99999, b)
        }),
        12 => zip(b, s, |b, s| b + s - 2.0 * b * s),
        13 => set_lum(set_sat(s, sat(b)), lum(b)),
        14 => set_lum(set_sat(b, sat(s)), lum(b)),
        15 => set_lum(s, lum(b)),
        16 => set_lum(b, lum(s)),
        _ => s,
    }
}

fn unpre(c: Rgba) -> Rgb {
    if c[3] > 0.0001 {
        [c[0] / c[3], c[1] / c[3], c[2] / c[3]]
    } else {
        [0.0; 3]
    }
}

/// A premultiplied layer `top` (at `opacity`) over a premultiplied `base`, as the `composite` program does.
pub fn composite(base: Rgba, top: Rgba, opacity: f32, mode: usize) -> Rgba {
    let t = top.map(|v| v * opacity);
    if mode == 0 {
        return [0, 1, 2, 3].map(|i| t[i] + base[i] * (1.0 - t[3]));
    }
    let f = blend_one(mode, unpre(base), unpre(t));
    let mut out = [0.0; 4];
    for i in 0..3 {
        out[i] = (1.0 - base[3]) * t[i] + (1.0 - t[3]) * base[i] + t[3] * base[3] * f[i];
    }
    out[3] = t[3] + base[3] * (1.0 - t[3]);
    out
}

/// A blend mode's number by name (unknown names draw as normal, as on the GPU).
pub fn mode_index(name: &str) -> usize {
    MODES.iter().position(|m| *m == name).unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn close(a: Rgba, b: Rgba) -> bool {
        a.iter().zip(b).all(|(x, y)| (x - y).abs() < 1e-4)
    }

    #[test]
    fn seventeen_modes_in_the_editors_order() {
        assert_eq!(MODES.len(), 17);
        assert_eq!(mode_index("multiply"), 1);
        assert_eq!(mode_index("luminosity"), 16);
        assert_eq!(mode_index("nonsense"), 0);
    }

    #[test]
    fn normal_is_over() {
        let base = [0.2, 0.4, 0.6, 1.0];
        let top = [0.5, 0.0, 0.0, 0.5];
        assert!(close(composite(base, top, 1.0, 0), [0.6, 0.2, 0.3, 1.0]));
        // Half opacity halves the layer.
        assert!(close(composite(base, top, 0.5, 0), [0.4, 0.3, 0.45, 1.0]));
        assert!(close(composite([0.0; 4], top, 1.0, 0), top));
    }

    #[test]
    fn opaque_layers_follow_the_formulas() {
        let b = [0.2, 0.5, 0.8];
        let s = [0.6, 0.6, 0.1];
        let on = |m: usize| {
            let o = composite([b[0], b[1], b[2], 1.0], [s[0], s[1], s[2], 1.0], 1.0, m);
            [o[0], o[1], o[2]]
        };
        let near = |a: Rgb, e: Rgb| a.iter().zip(e).all(|(x, y)| (x - y).abs() < 1e-4);
        assert!(near(on(1), [0.12, 0.3, 0.08]));
        assert!(near(on(2), [0.68, 0.8, 0.82]));
        assert!(near(on(4), [0.8, 1.0, 0.9]));
        assert!(near(on(5), [0.2, 0.5, 0.1]));
        assert!(near(on(6), [0.6, 0.6, 0.8]));
        assert!(near(on(7), [0.4, 0.1, 0.7]));
        assert!(near(on(12), [0.56, 0.5, 0.74]));
        // Overlay: multiply in the shadows, screen in the highlights (of the base).
        assert!(near(on(3), [0.24, 0.6, 1.0 - 2.0 * 0.2 * 0.9]));
        // Luminosity keeps the base's color and takes the layer's brightness.
        let l = on(16);
        assert!((lum(l) - lum(s)).abs() < 1e-4);
        // Color keeps the base's brightness.
        assert!((lum(on(15)) - lum(b)).abs() < 1e-4);
        // Every mode stays in range for colors in range.
        for m in 0..17 {
            let o = on(m);
            assert!(
                o.iter().all(|v| (-1e-4..=1.0001).contains(v)),
                "mode {m}: {o:?}"
            );
        }
    }

    #[test]
    fn see_through_layers_keep_the_base_where_they_are_clear() {
        let base = [0.3, 0.3, 0.3, 1.0];
        for m in 0..17 {
            assert!(close(composite(base, [0.0; 4], 1.0, m), base), "mode {m}");
        }
        // Over nothing, any mode is the layer itself.
        let top = [0.25, 0.5, 0.0, 0.5];
        for m in 0..17 {
            assert!(close(composite([0.0; 4], top, 1.0, m), top), "mode {m}");
        }
    }
}
