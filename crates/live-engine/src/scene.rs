//! What each screen shows at one moment, worked out from the show — pure
//! data, no GPU. It follows `programLayers` / `ProgramView` in
//! `app/src/components/ScreenView.tsx` rule for rule: a running TAKE draws the
//! outgoing and incoming inputs mixed by [`mix_at`]; the manual T-bar mixes
//! On air and Next with the chosen transition (a fade for cut and stingers);
//! under a stinger the pictures cut at its cut point; then blank (fade to
//! black) and PANIC go over everything.

use lumora_engine::{
    overlays::{Overlay, OverlayAnim},
    pesukim::PesukimMode,
    slideshow::Slide,
    timing::transition_progress,
    Fit, ScreenId, Show, Source, SourceId, SourceKind, TransitionKind,
};

use crate::mix::{fade_amount, mix_at, stinger_slot, LumaPattern, Mix, Shape};

/// What fills a picture.
#[derive(Debug, Clone, PartialEq)]
pub enum Content {
    /// The newest frame of a source the engine opened (camera, video, picture, stream).
    Video(SourceId),
    /// A flat color, premultiplied RGBA 0 – 1.
    Color([f32; 4]),
    /// A color only around the picture that follows (the bars of a contained
    /// picture), so a fading picture never shows it through itself.
    Bars([f32; 4]),
    /// Drawn by the web overlay renderer (titles, countdowns, scoreboards…):
    /// arrives as the screen's plane `g:<id>` ([`crate::overlay`]) at the
    /// size of this picture's frame, and is drawn here like a picture.
    Graphic(SourceId),
}

/// A rectangle in fractions of its parent: left, top, right, bottom.
pub type Rect = [f32; 4];

pub const FULL: Rect = [0.0, 0.0, 1.0, 1.0];

/// Where and how a picture sits inside its layer.
#[derive(Debug, Clone, PartialEq)]
pub struct Placement {
    /// The box it fills (split screen boxes; the whole frame otherwise).
    pub frame: Rect,
    pub fit: Fit,
    /// Cut off each side: left, right, top, bottom (fractions, 0 – 0.45).
    pub crop: [f32; 4],
    /// 1 – 4.
    pub zoom: f32,
    /// -1 – 1 (right and down are positive).
    pub pan: [f32; 2],
    pub flip: [bool; 2],
    /// Degrees.
    pub rotate: f32,
    /// Green screen and light and color (None: the picture as it is).
    pub look: Option<crate::look::Look>,
    /// The background behind the people, without a green screen (None: kept).
    /// Applied once the vision worker has sent a person mask ([`crate::vision`]).
    pub backdrop: Option<Backdrop>,
}

/// What happens to the background behind the people (the input's `background`).
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Backdrop {
    /// 1 blurred, 2 taken away, 3 a picture (or virtual set) behind ([`crate::vision::mode_code`]).
    pub mode: f32,
    /// How strong the blur is, 0 – 1.
    pub blur: f32,
    /// How soft the edge around people is, 0 – 1.
    pub edge: f32,
}

impl Default for Placement {
    fn default() -> Self {
        Placement {
            frame: FULL,
            fit: Fit::Contain,
            crop: [0.0; 4],
            zoom: 1.0,
            pan: [0.0; 2],
            flip: [false; 2],
            rotate: 0.0,
            look: None,
            backdrop: None,
        }
    }
}

/// One picture of a layer.
#[derive(Debug, Clone, PartialEq)]
pub struct Picture {
    pub content: Content,
    pub placement: Placement,
}

/// One input on a screen, with how the transition shows it.
#[derive(Debug, Clone, PartialEq)]
pub struct Layer {
    pub source: SourceId,
    pub pictures: Vec<Picture>,
    pub opacity: f32,
    /// % of the frame (slides).
    pub shift: [f32; 2],
    pub scale: f32,
    /// Fraction of the frame height.
    pub blur: f32,
    /// The part of it that shows (wipes, iris…), in its own box.
    pub shape: Shape,
    pub luma: Option<(LumaPattern, f32)>,
    /// Drawn over the other layer (reveal, zoom out).
    pub top: bool,
}

/// A stinger playing over the switch (drawn by the web overlay renderer into the `top` plane).
#[derive(Debug, Clone, PartialEq)]
pub struct StingerPlay {
    pub path: String,
    pub started_at: u64,
}

/// Everything one screen shows at one moment, back to front.
#[derive(Debug, Clone, PartialEq, Default)]
pub struct ScreenScene {
    pub layers: Vec<Layer>,
    /// Black over the inputs (dip).
    pub black: f32,
    /// White over the inputs (flash).
    pub white: f32,
    /// The overlay channels showing (lower thirds, logos, picture-in-picture),
    /// over the dip and flash, channel 1 first.
    pub overlays: Vec<Layer>,
    /// The screen's own fade to black (blank).
    pub blank: f32,
    /// PANIC: the safe screen over everything.
    pub panic: f32,
    pub stinger: Option<StingerPlay>,
    /// Its graphics inputs' planes are named with this first (`n:` for the
    /// Next preview's, drawn half size: [`NEXT_PREFIX`]).
    pub plane_prefix: &'static str,
}

/// The prefix of the Next preview's graphics planes (`overlayPlanes.ts: nextPlanes`).
pub const NEXT_PREFIX: &str = "n:";

impl ScreenScene {
    /// The sources whose frames this scene needs.
    pub fn videos(&self) -> impl Iterator<Item = &SourceId> {
        self.layers
            .iter()
            .chain(&self.overlays)
            .flat_map(|l| l.pictures.iter())
            .filter_map(|p| match &p.content {
                Content::Video(id) => Some(id),
                _ => None,
            })
    }

    /// Graphics inputs on the screen (they need the overlay renderer).
    pub fn graphics(&self) -> impl Iterator<Item = &SourceId> {
        self.layers
            .iter()
            .chain(&self.overlays)
            .flat_map(|l| l.pictures.iter())
            .filter_map(|p| match &p.content {
                Content::Graphic(id) => Some(id),
                _ => None,
            })
    }
}

/// `#rrggbb` as premultiplied RGBA (opaque); black when it isn't a color.
pub fn color(hex: &str) -> [f32; 4] {
    let ok = hex.len() == 7
        && hex.starts_with('#')
        && hex.bytes().skip(1).all(|b| b.is_ascii_hexdigit());
    let byte = |i: usize| {
        if ok {
            u8::from_str_radix(&hex[i..i + 2], 16).unwrap_or(0)
        } else {
            0
        }
    };
    [
        f32::from(byte(1)) / 255.0,
        f32::from(byte(3)) / 255.0,
        f32::from(byte(5)) / 255.0,
        1.0,
    ]
}

/// Whether the engine opens this kind of input itself (as a video source).
pub fn is_video_kind(kind: &SourceKind) -> bool {
    matches!(
        kind,
        SourceKind::Camera { .. }
            | SourceKind::Video { .. }
            | SourceKind::Image { .. }
            | SourceKind::Pattern
            | SourceKind::Stream(_)
            | SourceKind::Screen(_)
            | SourceKind::Guest(_)
            | SourceKind::Browser(_)
    )
}

fn placement_of(src: &Source, frame: Rect) -> Placement {
    let a = &src.adjust;
    let pct = |v: f32| {
        if v.is_finite() {
            (v / 100.0).clamp(0.0, 0.45)
        } else {
            0.0
        }
    };
    let pan = |v: f32| {
        if v.is_finite() {
            (v / 100.0).clamp(-1.0, 1.0)
        } else {
            0.0
        }
    };
    Placement {
        frame,
        fit: src.fit,
        crop: [
            pct(a.crop_left),
            pct(a.crop_right),
            pct(a.crop_top),
            pct(a.crop_bottom),
        ],
        zoom: if a.zoom.is_finite() {
            (a.zoom / 100.0).clamp(1.0, 4.0)
        } else {
            1.0
        },
        // The settings' "up" is positive; the shader's y goes down (`chroma.ts` passes -panY).
        pan: [pan(a.pan_x), -pan(a.pan_y)],
        flip: [a.flip_h, a.flip_v],
        rotate: if a.rotate.is_finite() { a.rotate } else { 0.0 },
        look: crate::look::Look::of(&src.key, a),
        backdrop: src.background.on().then(|| Backdrop {
            mode: crate::vision::mode_code(src.background.mode),
            blur: finite01(src.background.blur, 0.6),
            edge: finite01(src.background.edge, 0.4),
        }),
    }
}

fn finite01(v: f32, d: f32) -> f32 {
    if v.is_finite() {
        v.clamp(0.0, 1.0)
    } else {
        d
    }
}

/// The pictures that make up one input inside `frame` (a split screen's
/// boxes, a countdown's background…). A split inside a split shows nothing,
/// as on the web.
fn pictures_in(show: &Show, src: &Source, frame: Rect, nested: bool) -> Vec<Picture> {
    let full = |content| Picture {
        content,
        placement: Placement {
            frame,
            ..Placement::default()
        },
    };
    let video = |src: &Source| {
        vec![
            // Bars around a contained picture are black, as `background: #000` on the web.
            full(Content::Bars([0.0, 0.0, 0.0, 1.0])),
            Picture {
                content: Content::Video(src.id.clone()),
                placement: placement_of(src, frame),
            },
        ]
    };
    // What is behind slides or the Pesukim words, when the engine draws it
    // (a camera, a file, a picture, a color; graphics behind are in the plane).
    let behind = |b: &Source| match &b.kind {
        k if is_video_kind(k) => video(b),
        SourceKind::Color { color: c } => vec![full(Content::Color(color(c)))],
        _ => Vec::new(),
    };
    match &src.kind {
        k if is_video_kind(k) => video(src),
        SourceKind::Color { color: c } => vec![full(Content::Color(color(c)))],
        SourceKind::Countdown { background, .. } => vec![
            full(Content::Color(color(background))),
            full(Content::Graphic(src.id.clone())),
        ],
        SourceKind::Split(sp) if !nested => {
            let [fx0, fy0, fx1, fy1] = frame;
            let (fw, fh) = (fx1 - fx0, fy1 - fy0);
            let mut out = vec![full(Content::Color(color(&sp.background)))];
            for b in &sp.boxes {
                let f = b.frame.clamped();
                let r = [
                    fx0 + fw * f.x / 100.0,
                    fy0 + fh * f.y / 100.0,
                    fx0 + fw * (f.x + f.w) / 100.0,
                    fy0 + fh * (f.y + f.h) / 100.0,
                ];
                if let Some(inner) = b.source_id.as_ref().and_then(|id| show.source(id)) {
                    out.extend(pictures_in(show, inner, r, true));
                }
            }
            out
        }
        SourceKind::Split(_) | SourceKind::Microphone { .. } => Vec::new(),
        // Slides with a camera or video behind them (or one as a slide):
        // the engine draws the background color and the pictures, the
        // overlay renderer the slides over them (its plane is see-through
        // where the pictures are).
        SourceKind::Slideshow(k) => {
            let mut out = vec![full(Content::Color(color(&k.background)))];
            let other = |id: &Option<SourceId>| {
                id.as_ref()
                    .and_then(|i| show.source(i))
                    .filter(|s| is_video_kind(&s.kind))
            };
            if let Some(b) = k.behind.as_ref().and_then(|i| show.source(i)) {
                out.extend(behind(b));
            }
            if let (false, Some(Slide::Input { source_id, .. })) =
                (k.black, k.slides.get(k.current))
            {
                if let Some(inner) = other(&Some(source_id.clone())) {
                    let [fx0, fy0, fx1, fy1] = frame;
                    let (fw, fh) = (fx1 - fx0, fy1 - fy0);
                    let a = &k.area;
                    let r = [
                        fx0 + fw * a.x / 100.0,
                        fy0 + fh * a.y / 100.0,
                        fx0 + fw * (a.x + a.w) / 100.0,
                        fy0 + fh * (a.y + a.h) / 100.0,
                    ];
                    out.push(Picture {
                        content: Content::Video(inner.id.clone()),
                        placement: placement_of(inner, r),
                    });
                }
            }
            out.push(full(Content::Graphic(src.id.clone())));
            out
        }
        // The 12 Pesukim with a camera or video behind the words: the same.
        SourceKind::Pesukim(p) => {
            let mut out = Vec::new();
            if p.look.mode != PesukimMode::Bar {
                out.push(full(Content::Color(color(&p.look.background))));
            }
            if let Some(b) = p.look.behind.as_ref().and_then(|i| show.source(i)) {
                out.extend(behind(b));
            }
            out.push(full(Content::Graphic(src.id.clone())));
            out
        }
        _ => vec![full(Content::Graphic(src.id.clone()))],
    }
}

fn plain_layer(show: &Show, id: &SourceId) -> Option<Layer> {
    let src = show.source(id)?;
    Some(Layer {
        source: id.clone(),
        pictures: pictures_in(show, src, FULL, false),
        opacity: 1.0,
        shift: [0.0, 0.0],
        scale: 1.0,
        blur: 0.0,
        shape: Shape::Whole,
        luma: None,
        top: false,
    })
}

/// What a screen shows on air at `now` (the Standard engine's `programLayers` + `ProgramView`).
pub fn program_scene(show: &Show, screen: ScreenId, now: u64) -> ScreenScene {
    let sc = show.screens.get(screen);
    let mut scene = ScreenScene {
        blank: fade_amount(sc.blank, sc.blank_changed_at, now, sc.blank_fade_ms),
        panic: fade_amount(show.panic, show.panic_changed_at, now, 0),
        overlays: overlay_layers(show, screen, now),
        ..ScreenScene::default()
    };
    let pair = |scene: &mut ScreenScene, out: Option<&SourceId>, inc: Option<&SourceId>, m: Mix| {
        if let Some(l) = out.and_then(|id| plain_layer(show, id)) {
            scene.layers.push(Layer {
                opacity: m.out_opacity,
                shift: [m.out_shift, m.out_shift_y],
                scale: m.out_scale,
                blur: m.out_blur,
                top: m.out_on_top,
                ..l
            });
        }
        if let Some(l) = inc
            .filter(|i| Some(*i) != out)
            .and_then(|id| plain_layer(show, id))
        {
            scene.layers.push(Layer {
                opacity: m.in_opacity,
                shift: [m.in_shift, m.in_shift_y],
                scale: m.in_scale,
                blur: m.in_blur,
                shape: m.in_shape,
                luma: m.in_luma,
                ..l
            });
        }
        scene.black = m.black;
        scene.white = m.white;
    };
    let p = transition_progress(sc, now);
    let stinger = sc.transition.and_then(|t| {
        let slot = stinger_slot(t.kind)?;
        let st = show.settings.stingers.get(slot)?;
        (!st.path.is_empty()).then_some((t, st))
    });
    if p < 1.0 {
        if let (Some(t), Some((_, st))) = (sc.transition, stinger) {
            // Under the stinger the pictures simply change at its cut point.
            let cut = now.saturating_sub(t.started_at) >= u64::from(st.cut_ms);
            let id = if cut {
                sc.program.as_ref()
            } else {
                sc.previous.as_ref().or(sc.program.as_ref())
            };
            scene.layers.extend(id.and_then(|id| plain_layer(show, id)));
            scene.stinger = Some(StingerPlay {
                path: st.path.clone(),
                started_at: t.started_at,
            });
            return scene;
        }
        if let (Some(t), Some(prev)) = (sc.transition, sc.previous.as_ref()) {
            pair(
                &mut scene,
                Some(prev),
                sc.program.as_ref(),
                mix_at(t.kind, p),
            );
            sort_top(&mut scene);
            return scene;
        }
    }
    if sc.tbar > 0.0 && sc.preview.is_some() && sc.preview != sc.program {
        let k = show.transition.kind;
        let kind = if k == TransitionKind::Cut || stinger_slot(k).is_some() {
            TransitionKind::Fade
        } else {
            k
        };
        pair(
            &mut scene,
            sc.program.as_ref(),
            sc.preview.as_ref(),
            mix_at(kind, sc.tbar),
        );
        sort_top(&mut scene);
        return scene;
    }
    scene
        .layers
        .extend(sc.program.as_ref().and_then(|id| plain_layer(show, id)));
    scene
}

/// How an overlay channel looks at one moment (a port of `overlayLook` in
/// `app/src/engine/overlays.ts`): its opacity, its offset in boxes, its size
/// and how much of it a wipe has revealed.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct OverlayLook {
    pub opacity: f32,
    pub dx: f32,
    pub dy: f32,
    pub scale: f32,
    pub reveal: f32,
}

/// On air, or still animating out (`overlayShowing`).
pub fn overlay_showing(o: &Overlay, now: u64) -> bool {
    o.source_id.is_some()
        && (o.on || (now as i128 - i128::from(o.changed_at)) < i128::from(o.anim_ms))
}

/// The channel's look at `now`; None when it isn't showing.
pub fn overlay_look(o: &Overlay, now: u64) -> Option<OverlayLook> {
    if !overlay_showing(o, now) {
        return None;
    }
    let p = if o.anim_ms > 0 {
        ((now as f64 - o.changed_at as f64) / f64::from(o.anim_ms)).clamp(0.0, 1.0) as f32
    } else {
        1.0
    };
    let anim = if o.on { o.anim_in } else { o.anim_out };
    let e = if o.on {
        1.0 - (1.0 - p).powi(3)
    } else {
        p * p * p
    };
    // t: 1 = fully shown, 0 = hidden.
    let t = if anim == OverlayAnim::Cut {
        if o.on || p < 1.0 {
            1.0
        } else {
            0.0
        }
    } else if o.on {
        e
    } else {
        1.0 - e
    };
    let off = 1.0 - t;
    Some(OverlayLook {
        opacity: o.opacity
            * if matches!(anim, OverlayAnim::Fade | OverlayAnim::Zoom) {
                t
            } else {
                1.0
            },
        dx: match anim {
            OverlayAnim::SlideLeft => -1.1 * off,
            OverlayAnim::SlideRight => 1.1 * off,
            _ => 0.0,
        },
        dy: if anim == OverlayAnim::SlideUp {
            1.1 * off
        } else {
            0.0
        },
        scale: if anim == OverlayAnim::Zoom {
            0.6 + 0.4 * t
        } else {
            1.0
        },
        reveal: if anim == OverlayAnim::Wipe { t } else { 1.0 },
    })
}

/// The overlay channels showing on a screen as layers, channel 1 first (as
/// the compositor's `drawOverlay`: the box moved and sized by the animation,
/// a wipe revealing it from the left).
pub fn overlay_layers(show: &Show, screen: ScreenId, now: u64) -> Vec<Layer> {
    let mut out = Vec::new();
    for o in &show.overlays {
        if !o.screens.contains(&screen) {
            continue;
        }
        let Some(look) = overlay_look(o, now) else {
            continue;
        };
        let Some(src) = o.source_id.as_ref().and_then(|id| show.source(id)) else {
            continue;
        };
        if look.opacity <= 0.0 {
            continue;
        }
        let f = o.frame;
        let (bw, bh) = (f.w / 100.0, f.h / 100.0);
        let x0 = f.x / 100.0 + look.dx * bw;
        let y0 = f.y / 100.0 + look.dy * bh;
        let (cx, cy) = (x0 + bw / 2.0, y0 + bh / 2.0);
        let (hw, hh) = (bw * look.scale / 2.0, bh * look.scale / 2.0);
        let frame = [cx - hw, cy - hh, cx + hw, cy + hh];
        let shape = if look.reveal < 1.0 {
            // Only the left part of the box shows (in the layer's box: the whole screen).
            Shape::Rect {
                t: 0.0,
                r: (1.0 - (frame[0] + (frame[2] - frame[0]) * look.reveal)).clamp(0.0, 1.0),
                b: 0.0,
                l: 0.0,
            }
        } else {
            Shape::Whole
        };
        let mut pictures = pictures_in(show, src, frame, false);
        // A picture in a channel has no bars: the program shows around it (as recorded).
        pictures.retain(|p| !matches!(p.content, Content::Bars(_)));
        out.push(Layer {
            source: src.id.clone(),
            pictures,
            opacity: look.opacity.clamp(0.0, 1.0),
            shift: [0.0, 0.0],
            scale: 1.0,
            blur: 0.0,
            shape,
            luma: None,
            top: false,
        });
    }
    out
}

/// Layers marked `top` are drawn last (`zIndex: 1` on the web).
fn sort_top(scene: &mut ScreenScene) {
    scene.layers.sort_by_key(|l| l.top);
}

/// What is lined up next on a screen (no blank or PANIC: Next is for the
/// operator). Its graphics are the screen renderer's `n:` planes.
pub fn preview_scene(show: &Show, screen: ScreenId) -> ScreenScene {
    let sc = show.screens.get(screen);
    ScreenScene {
        layers: sc
            .preview
            .as_ref()
            .and_then(|id| plain_layer(show, id))
            .into_iter()
            .collect(),
        plane_prefix: NEXT_PREFIX,
        ..ScreenScene::default()
    }
}

/// One input on its own (the control window's input tiles).
pub fn source_scene(show: &Show, id: &SourceId) -> ScreenScene {
    ScreenScene {
        layers: plain_layer(show, id).into_iter().collect(),
        ..ScreenScene::default()
    }
}

/// Every input the engine opens itself: each one once, whatever shows it.
pub fn video_inputs(show: &Show) -> Vec<&Source> {
    show.sources
        .iter()
        .filter(|s| is_video_kind(&s.kind))
        .collect()
}

/// Whether anything on this screen is moving at `now` (a transition, a blank or PANIC fade).
pub fn moving(show: &Show, screen: ScreenId, now: u64) -> bool {
    let sc = show.screens.get(screen);
    let fade = if sc.blank_fade_ms == 0 {
        lumora_engine::BLANK_FADE_MS
    } else {
        sc.blank_fade_ms
    };
    transition_progress(sc, now) < 1.0
        || now.saturating_sub(sc.blank_changed_at) < u64::from(fade) + 50
        || now.saturating_sub(show.panic_changed_at) < u64::from(lumora_engine::BLANK_FADE_MS) + 50
}

// ---------------------------------------------------------------------------
// Placement math (shared by the GPU compositor and its tests)

/// Where a picture of `src_w` × `src_h` lands inside `frame` (output
/// fractions) on an output of `out_w` × `out_h`, and which part of the
/// (cropped) source shows: (destination rect, source uv rect).
pub fn fit_rect(p: &Placement, src_w: u32, src_h: u32, out_w: u32, out_h: u32) -> (Rect, Rect) {
    let [l, r, t, b] = p.crop;
    let cw = (1.0 - l - r).max(0.1) * src_w.max(1) as f32;
    let ch = (1.0 - t - b).max(0.1) * src_h.max(1) as f32;
    let uv = [l, t, 1.0 - r, 1.0 - b];
    let [fx0, fy0, fx1, fy1] = p.frame;
    let bw = (fx1 - fx0) * out_w as f32;
    let bh = (fy1 - fy0) * out_h as f32;
    if bw <= 0.0 || bh <= 0.0 {
        return ([fx0, fy0, fx0, fy0], uv);
    }
    let src_aspect = cw / ch;
    let box_aspect = bw / bh;
    match p.fit {
        Fit::Contain => {
            // Letterbox or pillarbox inside the box.
            let (w, h) = if src_aspect > box_aspect {
                (bw, bw / src_aspect)
            } else {
                (bh * src_aspect, bh)
            };
            let x0 = fx0 + (bw - w) / 2.0 / out_w as f32;
            let y0 = fy0 + (bh - h) / 2.0 / out_h as f32;
            ([x0, y0, x0 + w / out_w as f32, y0 + h / out_h as f32], uv)
        }
        Fit::Cover => {
            // Fill the box, cutting the middle of the source.
            let [u0, v0, u1, v1] = uv;
            let (uw, vh) = (u1 - u0, v1 - v0);
            let (ku, kv) = if src_aspect > box_aspect {
                (box_aspect / src_aspect, 1.0)
            } else {
                (1.0, src_aspect / box_aspect)
            };
            let du = uw * (1.0 - ku) / 2.0;
            let dv = vh * (1.0 - kv) / 2.0;
            (p.frame, [u0 + du, v0 + dv, u1 - du, v1 - dv])
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use lumora_engine::{ActiveTransition, Source, SourceAudio, Split, SplitBox, Stinger};

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
                device_id: id.to_owned(),
                label: id.to_owned(),
            },
        )
    }

    /// Camera a on air, b in Next, on the Live Screen.
    fn show() -> Show {
        let mut s = Show {
            sources: vec![cam("a"), cam("b")],
            ..Show::default()
        };
        s.screens.live.program = Some(SourceId::new("a"));
        s.screens.live.preview = Some(SourceId::new("b"));
        s
    }

    fn take(s: &mut Show, kind: TransitionKind, ms: u32, at: u64) {
        let sc = &mut s.screens.live;
        sc.previous = sc.program.take();
        sc.program = sc.preview.take();
        sc.transition = Some(ActiveTransition {
            kind,
            duration_ms: ms,
            started_at: at,
        });
    }

    fn ids(sc: &ScreenScene) -> Vec<(&str, f32)> {
        sc.layers
            .iter()
            .map(|l| (l.source.as_str(), l.opacity))
            .collect()
    }

    #[test]
    fn shows_just_what_is_on_air_when_nothing_moves() {
        let sc = program_scene(&show(), ScreenId::Live, 1000);
        assert_eq!(ids(&sc), vec![("a", 1.0)]);
        assert_eq!(sc.videos().map(SourceId::as_str).collect::<Vec<_>>(), ["a"]);
        assert_eq!((sc.black, sc.blank, sc.panic), (0.0, 0.0, 0.0));
    }

    #[test]
    fn a_take_draws_both_inputs_then_only_the_new_one() {
        let mut s = show();
        take(&mut s, TransitionKind::Fade, 800, 1000);
        let mid = program_scene(&s, ScreenId::Live, 1400);
        assert_eq!(ids(&mid), vec![("a", 1.0), ("b", 0.5)]);
        assert!(moving(&s, ScreenId::Live, 1400));
        assert_eq!(
            ids(&program_scene(&s, ScreenId::Live, 2000)),
            vec![("b", 1.0)]
        );
        assert!(!moving(&s, ScreenId::Live, 2500));
    }

    #[test]
    fn a_cut_is_instant() {
        let mut s = show();
        take(&mut s, TransitionKind::Cut, 800, 1000);
        assert_eq!(
            ids(&program_scene(&s, ScreenId::Live, 1000)),
            vec![("b", 1.0)]
        );
    }

    #[test]
    fn a_dip_goes_through_black() {
        let mut s = show();
        take(&mut s, TransitionKind::Dip, 1000, 0);
        let mid = program_scene(&s, ScreenId::Live, 500);
        assert_eq!(mid.black, 1.0);
    }

    #[test]
    fn reveal_draws_the_old_input_on_top() {
        let mut s = show();
        take(&mut s, TransitionKind::Reveal, 1000, 0);
        let sc = program_scene(&s, ScreenId::Live, 500);
        assert_eq!(sc.layers.last().map(|l| l.source.as_str()), Some("a"));
        assert!(sc.layers.last().is_some_and(|l| l.top && l.shift[0] < 0.0));
    }

    #[test]
    fn the_tbar_mixes_on_air_and_next() {
        let mut s = show();
        s.screens.live.tbar = 0.3;
        assert_eq!(
            ids(&program_scene(&s, ScreenId::Live, 5000)),
            vec![("a", 1.0), ("b", 0.3)]
        );
        // A cut chosen as the transition fades on the T-bar.
        s.transition.kind = TransitionKind::Cut;
        assert_eq!(ids(&program_scene(&s, ScreenId::Live, 5000))[1], ("b", 0.3));
        // A wipe wipes.
        s.transition.kind = TransitionKind::Wipe;
        let sc = program_scene(&s, ScreenId::Live, 5000);
        assert!(matches!(sc.layers[1].shape, Shape::Rect { r, .. } if (r - 0.7).abs() < 1e-5));
    }

    #[test]
    fn under_a_stinger_the_inputs_cut_at_its_cut_point() {
        let mut s = show();
        s.settings.stingers[0] = Stinger {
            path: "s.webm".into(),
            duration_ms: 1000,
            cut_ms: 400,
        };
        take(&mut s, TransitionKind::Stinger1, 1000, 0);
        let before = program_scene(&s, ScreenId::Live, 300);
        assert_eq!(ids(&before), vec![("a", 1.0)]);
        assert_eq!(
            before.stinger.as_ref().map(|p| p.path.as_str()),
            Some("s.webm")
        );
        assert_eq!(
            ids(&program_scene(&s, ScreenId::Live, 500)),
            vec![("b", 1.0)]
        );
    }

    #[test]
    fn blank_and_panic_fade_over_everything() {
        let mut s = show();
        s.screens.live.blank = true;
        s.screens.live.blank_changed_at = 1000;
        s.screens.live.blank_fade_ms = 2000;
        s.panic = true;
        s.panic_changed_at = 1000;
        let sc = program_scene(&s, ScreenId::Live, 2000);
        assert!(
            (sc.blank - 0.5).abs() < 1e-5,
            "fade to black has its own length"
        );
        assert_eq!(sc.panic, 1.0, "PANIC is quick");
        // Other screens: only PANIC.
        assert_eq!(program_scene(&s, ScreenId::Back, 2000).blank, 0.0);
    }

    #[test]
    fn a_split_screen_places_each_input_in_its_box() {
        let mut s = show();
        let mut sp = Split {
            layout: lumora_engine::SplitLayout::Custom,
            ..Split::default()
        };
        sp.boxes = vec![
            SplitBox {
                source_id: Some(SourceId::new("a")),
                frame: lumora_engine::Frame {
                    x: 0.0,
                    y: 0.0,
                    w: 50.0,
                    h: 100.0,
                },
            },
            SplitBox {
                source_id: Some(SourceId::new("b")),
                frame: lumora_engine::Frame {
                    x: 50.0,
                    y: 0.0,
                    w: 50.0,
                    h: 100.0,
                },
            },
        ];
        s.sources.push(src("sp", SourceKind::Split(Box::new(sp))));
        s.screens.live.program = Some(SourceId::new("sp"));
        let sc = program_scene(&s, ScreenId::Live, 0);
        let videos: Vec<_> = sc.layers[0]
            .pictures
            .iter()
            .filter(|p| matches!(p.content, Content::Video(_)))
            .map(|p| p.placement.frame)
            .collect();
        assert_eq!(videos, vec![[0.0, 0.0, 0.5, 1.0], [0.5, 0.0, 1.0, 1.0]]);
        assert_eq!(sc.videos().count(), 2);
    }

    #[test]
    fn graphics_inputs_are_left_to_the_overlay_renderer() {
        let mut s = show();
        s.sources.push(src(
            "c",
            SourceKind::Countdown {
                background: "#ff0000".into(),
                logo: None,
                timer: Default::default(),
            },
        ));
        let sc = source_scene(&s, &SourceId::new("c"));
        assert_eq!(
            sc.layers[0].pictures[0].content,
            Content::Color([1.0, 0.0, 0.0, 1.0])
        );
        assert_eq!(sc.graphics().count(), 1);
        assert_eq!(
            video_inputs(&s).len(),
            2,
            "only cameras, files and streams are opened"
        );
    }

    #[test]
    fn a_camera_behind_slides_or_the_pesukim_words_is_the_engines_picture_under_their_plane() {
        use lumora_engine::pesukim::Pesukim;
        use lumora_engine::slideshow::Slideshow;
        let mut s = show();
        let mut slides = Slideshow {
            behind: Some(SourceId::new("a")),
            background: "#0000ff".into(),
            slides: vec![
                Slide::Image {
                    path: "one.png".into(),
                    notes: None,
                },
                Slide::Input {
                    source_id: SourceId::new("b"),
                    notes: None,
                },
            ],
            ..Slideshow::default()
        };
        slides.area = lumora_engine::overlays::Frame {
            x: 50.0,
            y: 0.0,
            w: 50.0,
            h: 50.0,
        };
        s.sources
            .push(src("sl", SourceKind::Slideshow(Box::new(slides.clone()))));
        let what = |s: &Show, id: &str| -> Vec<(String, Rect)> {
            source_scene(s, &SourceId::new(id)).layers[0]
                .pictures
                .iter()
                .map(|p| {
                    let c = match &p.content {
                        Content::Video(v) => format!("video {v}"),
                        Content::Graphic(g) => format!("graphic {g}"),
                        Content::Color(_) => "color".into(),
                        Content::Bars(_) => "bars".into(),
                    };
                    (c, p.placement.frame)
                })
                .collect()
        };
        // The background, the camera behind (with its bars), then the slides' plane.
        assert_eq!(
            what(&s, "sl"),
            vec![
                ("color".into(), FULL),
                ("bars".into(), FULL),
                ("video a".into(), FULL),
                ("graphic sl".into(), FULL)
            ]
        );
        // A camera as the slide: in the slides' area.
        slides.current = 1;
        s.sources[2].kind = SourceKind::Slideshow(Box::new(slides.clone()));
        let w = what(&s, "sl");
        assert_eq!(w[3], ("video b".into(), [0.5, 0.0, 1.0, 0.5]));
        assert_eq!(w.len(), 5);
        // Blacked out: the slide's camera goes, what is behind stays.
        slides.black = true;
        s.sources[2].kind = SourceKind::Slideshow(Box::new(slides));
        assert_eq!(what(&s, "sl").len(), 4);
        // The Pesukim: big words over their background, a camera behind; the bar has no background.
        let mut p = Pesukim::default();
        p.look.behind = Some(SourceId::new("a"));
        p.look.mode = PesukimMode::Word;
        s.sources
            .push(src("pk", SourceKind::Pesukim(Box::new(p.clone()))));
        let w = what(&s, "pk");
        assert_eq!(w[0].0, "color");
        assert_eq!(w[2].0, "video a");
        assert_eq!(w[3].0, "graphic pk");
        p.look.mode = PesukimMode::Bar;
        s.sources[3].kind = SourceKind::Pesukim(Box::new(p));
        assert_eq!(what(&s, "pk")[0].0, "bars");
        // Nothing behind: just the plane (and the background).
        let plain = Slideshow::default();
        s.sources[2].kind = SourceKind::Slideshow(Box::new(plain));
        assert_eq!(what(&s, "sl").len(), 2);
    }

    #[test]
    fn overlay_channels_go_over_the_picture_with_their_animation() {
        let mut s = show();
        s.sources
            .push(src("name", SourceKind::Text(Default::default())));
        s.overlays = lumora_engine::overlays::channels();
        let o = &mut s.overlays[1];
        o.source_id = Some(SourceId::new("name"));
        o.frame = lumora_engine::overlays::Frame {
            x: 6.0,
            y: 72.0,
            w: 50.0,
            h: 16.0,
        };
        o.anim_in = OverlayAnim::SlideLeft;
        o.anim_ms = 1000;
        o.set_on(true, 1000);
        // Halfway in: sliding from the left, fully opaque.
        let sc = program_scene(&s, ScreenId::Live, 1500);
        assert_eq!(sc.overlays.len(), 1);
        let l = &sc.overlays[0];
        assert_eq!(l.opacity, 1.0);
        let f = l.pictures[0].placement.frame;
        let t = 1.0 - 0.5f32.powi(3);
        assert!((f[0] - (0.06 - 1.1 * (1.0 - t) * 0.5)).abs() < 1e-5);
        assert!((f[3] - 0.88).abs() < 1e-5);
        assert_eq!(
            l.pictures[0].content,
            Content::Graphic(SourceId::new("name"))
        );
        assert_eq!(sc.graphics().count(), 1);
        // Not on the Back Screen; gone once it has animated out.
        assert!(program_scene(&s, ScreenId::Back, 1500).overlays.is_empty());
        s.overlays[1].set_on(false, 3000);
        assert_eq!(program_scene(&s, ScreenId::Live, 3500).overlays.len(), 1);
        assert!(program_scene(&s, ScreenId::Live, 4000).overlays.is_empty());
    }

    #[test]
    fn overlay_looks_match_the_web() {
        let mut o = Overlay {
            source_id: Some(SourceId::new("x")),
            anim_ms: 1000,
            ..Overlay::default()
        };
        o.set_on(true, 0);
        // Fade in: eased opacity.
        let l = overlay_look(&o, 500).unwrap();
        assert!((l.opacity - 0.875).abs() < 1e-5);
        // Zoom: from 60 % size.
        o.anim_in = OverlayAnim::Zoom;
        assert!((overlay_look(&o, 0).unwrap().scale - 0.6).abs() < 1e-5);
        // Wipe: revealed from the left.
        o.anim_in = OverlayAnim::Wipe;
        let l = overlay_look(&o, 500).unwrap();
        assert!((l.reveal - 0.875).abs() < 1e-5 && l.opacity == 1.0);
        // A cut out stays until its time is up, then goes.
        o.anim_out = OverlayAnim::Cut;
        o.set_on(false, 2000);
        assert_eq!(overlay_look(&o, 2500).unwrap().opacity, 1.0);
        assert!(overlay_look(&o, 3000).is_none());
        // Nothing in the channel: never shows.
        o.source_id = None;
        o.on = true;
        assert!(overlay_look(&o, 3000).is_none());
    }

    #[test]
    fn a_wiping_channel_shows_only_its_left_part() {
        let mut s = show();
        s.sources
            .push(src("logo", SourceKind::Text(Default::default())));
        s.overlays = lumora_engine::overlays::channels();
        let o = &mut s.overlays[0];
        o.source_id = Some(SourceId::new("logo"));
        o.frame = lumora_engine::overlays::Frame {
            x: 50.0,
            y: 0.0,
            w: 50.0,
            h: 50.0,
        };
        o.anim_in = OverlayAnim::Wipe;
        o.anim_ms = 1000;
        o.set_on(true, 0);
        let sc = program_scene(&s, ScreenId::Live, 1000);
        assert_eq!(sc.overlays[0].shape, Shape::Whole);
        let sc = program_scene(&s, ScreenId::Live, 500);
        let Shape::Rect { r, .. } = sc.overlays[0].shape else {
            panic!("a wipe cuts")
        };
        let shown = 0.5 + 0.5 * (1.0 - 0.5f32.powi(3));
        assert!((r - (1.0 - shown)).abs() < 1e-5);
    }

    #[test]
    fn contain_letterboxes_and_cover_crops() {
        let p = Placement::default();
        // 4:3 into 16:9: pillarbox.
        let (d, uv) = fit_rect(&p, 640, 480, 1920, 1080);
        assert!((d[0] - 0.125).abs() < 1e-4 && (d[2] - 0.875).abs() < 1e-4);
        assert_eq!(uv, FULL);
        let cover = Placement {
            fit: Fit::Cover,
            ..Placement::default()
        };
        let (d, uv) = fit_rect(&cover, 640, 480, 1920, 1080);
        assert_eq!(d, FULL);
        assert!((uv[1] - 0.125).abs() < 1e-4 && (uv[3] - 0.875).abs() < 1e-4);
        // Crop 25% off the left: the kept part is narrower.
        let cropped = Placement {
            crop: [0.25, 0.0, 0.0, 0.0],
            ..Placement::default()
        };
        let (_, uv) = fit_rect(&cropped, 1920, 1080, 1920, 1080);
        assert_eq!(uv[0], 0.25);
    }

    #[test]
    fn colors_parse_and_bad_ones_are_black() {
        assert_eq!(color("#ff8000"), [1.0, 128.0 / 255.0, 0.0, 1.0]);
        assert_eq!(color("red"), [0.0, 0.0, 0.0, 1.0]);
        assert_eq!(color("#ééé"), [0.0, 0.0, 0.0, 1.0]);
    }
}
