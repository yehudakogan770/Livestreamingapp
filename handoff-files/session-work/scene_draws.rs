    /// The draws that paint `scene` on an output of `out_w` × `out_h`, with
    /// the graphics planes of slot `planes` (back to front: the pictures,
    /// dip, flash, the overlay channels, the `top` plane, blank, PANIC and its logo).
    fn scene_draws(
        &self,
        scene: &ScreenScene,
        planes: Option<usize>,
        out_w: u32,
        out_h: u32,
        draws: &mut Vec<(DrawU, TexKey)>,
    ) {
        let out_aspect = out_w as f32 / out_h.max(1) as f32;
        for layer in &scene.layers {
            self.layer_draws(layer, planes, out_w, out_h, draws);
        }
        let solid = |c: [f32; 4], a: f32, draws: &mut Vec<(DrawU, TexKey)>| {
            if a > 0.0 {
                let mut d = DrawU::new();
                d.set(COLOR, c).set(FX, [a, 0.0, 0.0, 0.0]);
                d.0[MISC * 4 + 3] = 1.0;
                draws.push((d, TexKey::White));
            }
        };
        let whole = |slot: usize, name: &str, a: f32, draws: &mut Vec<(DrawU, TexKey)>| {
            if a <= 0.0 {
                return;
            }
            if let Some(id) = self.plane(slot, name, (out_w, out_h)) {
                let mut d = DrawU::new();
                d.set(LUMA, [0.0, 0.0, out_aspect, out_aspect])
                    .set(FX, [a, 0.0, 0.0, 0.0]);
                draws.push((d, TexKey::Plane(id)));
            }
        };
        solid([0.0, 0.0, 0.0, 1.0], scene.black, draws);
        solid([1.0, 1.0, 1.0, 1.0], scene.white, draws);
        for layer in &scene.overlays {
            self.layer_draws(layer, planes, out_w, out_h, draws);
        }
        if let Some(slot) = planes {
            whole(slot, crate::overlay::TOP, 1.0, draws);
        }
        solid([0.0, 0.0, 0.0, 1.0], scene.blank, draws);
        // PANIC: the safe screen — black at once (here, whatever the web
        // renderer is doing), then the event's logo from it.
        solid([0.0, 0.0, 0.0, 1.0], scene.panic, draws);
        if let Some(slot) = planes {
            whole(slot, crate::overlay::PANIC, scene.panic, draws);
        }
    }

    /// The draws of one layer (an input with its transition, or an overlay channel).
    fn layer_draws(
        &self,
        layer: &Layer,
        planes: Option<usize>,
        out_w: u32,
        out_h: u32,
        draws: &mut Vec<(DrawU, TexKey)>,
    ) {
        if layer.opacity <= 0.0 {
            return;
        }
        let out_aspect = out_w as f32 / out_h.max(1) as f32;
        let lb = layer_box(layer);
        let lw = (lb[2] - lb[0]) * out_w as f32;
        let lh = (lb[3] - lb[1]) * out_h as f32;
        for (n, pic) in layer.pictures.iter().enumerate() {
            let frame = within(lb, pic.placement.frame);
            let mut d = DrawU::new();
            d.set(LAYER, lb).set(CLIP, frame);
            let (shape_kind, size) = match layer.shape {
                Shape::Whole => (0.0, 0.0),
                Shape::Rect { t, r, b, l } => {
                    d.set(CUT, [t, r, b, l]);
                    (1.0, 0.0)
                }
                Shape::Circle { r } => (2.0, r),
                Shape::Diamond { r } => (3.0, r),
            };
            d.set(FX, [layer.opacity, layer.blur, shape_kind, size]);
            let (pattern, p) = layer
                .luma
                .map_or((0.0, 0.0), |(pat, p)| (pat.code() as f32, p));
            let layer_aspect = if lh > 0.0 { lw / lh } else { out_aspect };
            d.set(LUMA, [pattern, p, layer_aspect, out_aspect]);
            let color_rect = |r: Rect, c: [f32; 4], draws: &mut Vec<(DrawU, TexKey)>| {
                if r[2] - r[0] > 1e-5 && r[3] - r[1] > 1e-5 {
                    let mut d = d;
                    d.set(DST, r).set(COLOR, c);
                    d.0[MISC * 4 + 3] = 1.0;
                    draws.push((d, TexKey::White));
                }
            };
            match &pic.content {
                Content::Color(c) => color_rect(frame, *c, draws),
                Content::Bars(c) => {
                    // Only around the picture that follows: under it, its own
                    // opacity would let the bars show through mid-fade.
                    let covered = layer
                        .pictures
                        .get(n + 1)
                        .and_then(|next| self.video_dst(next, lb, lw, lh));
                    match covered {
                        Some((v, _, _)) => {
                            let [f0, f1, f2, f3] = frame;
                            let [v0, v1, v2, v3] = v;
                            for r in [
                                [f0, f1, v0, f3],
                                [v2, f1, f2, f3],
                                [v0, f1, v2, v1],
                                [v0, v3, v2, f3],
                            ] {
                                color_rect(r, *c, draws);
                            }
                        }
                        None => color_rect(frame, *c, draws),
                    }
                }
                Content::Video(id) => {
                    let Some((dst, uv, mode)) = self.video_dst(pic, lb, lw, lh) else {
                        continue;
                    };
                    let pl = &pic.placement;
                    let qw = (dst[2] - dst[0]) * out_w as f32;
                    let qh = (dst[3] - dst[1]) * out_h as f32;
                    d.set(DST, dst).set(UV, uv).set(
                        VIEW,
                        [pl.zoom, pl.pan[0], pl.pan[1], pl.rotate.to_radians()],
                    );
                    d.set(
                        MISC,
                        [
                            if pl.flip[0] { -1.0 } else { 1.0 },
                            if pl.flip[1] { -1.0 } else { 1.0 },
                            if qh > 0.0 { qw / qh } else { 1.0 },
                            mode,
                        ],
                    );
                    draws.push((d, TexKey::Source(id.clone())));
                }
                Content::Graphic(id) => {
                    // Drawn by the web renderer at the size it is shown (the
                    // layer's own box, before a slide or zoom moved it).
                    let Some(slot) = planes else { continue };
                    let f = pic.placement.frame;
                    let want = (
                        ((f[2] - f[0]) * out_w as f32).round().max(1.0) as u32,
                        ((f[3] - f[1]) * out_h as f32).round().max(1.0) as u32,
                    );
                    let Some(plane) =
                        self.plane(slot, &crate::overlay::graphic_plane(id.as_str()), want)
                    else {
                        continue;
                    };
                    let (qw, qh) = (
                        (frame[2] - frame[0]) * out_w as f32,
                        (frame[3] - frame[1]) * out_h as f32,
                    );
                    d.set(DST, frame);
                    d.set(MISC, [1.0, 1.0, if qh > 0.0 { qw / qh } else { 1.0 }, 0.0]);
                    draws.push((d, TexKey::Plane(plane)));
                }
            }
        }
    }
