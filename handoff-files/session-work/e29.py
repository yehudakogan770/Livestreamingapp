W='/home/user/Livestreamingapp/.claude/worktrees/agent-aefea299a26a1206e/'
def edit(path, pairs):
    p=W+path
    s=open(p).read()
    for a,b in pairs:
        assert s.count(a)==1, (path, a, s.count(a))
        s=s.replace(a,b)
    open(p,'w').write(s)

edit('crates/live-engine/src/gpu.rs', [
("""/// A pass ready to encode: where, which part, and its draws.
type Planned = (Dest, Option<[u32; 4]>, Vec<(DrawU, TexKey)>);""","""/// A pass ready to encode: where, which part, and its draws.
type Planned = (Dest, Option<[u32; 4]>, Vec<(DrawU, TexKey)>);

/// Layers drawn whole into a scratch target first (see [`needs_group`]):
/// (an overlay channel, its index) → the scratch target.
type Groups = HashMap<(bool, usize), usize>;

/// Scratch targets (layers composited as a group) are numbered from here; they start see-through.
const SCRATCH: usize = 64;

/// A layer of several pictures (a split screen, a picture with its bars)
/// that fades, wipes or blurs is drawn whole first and then faded as one, as
/// the web fades a box with its contents: faded picture by picture, its
/// background would show through its boxes mid-fade.
pub fn needs_group(l: &Layer) -> bool {
    let pictures = l
        .pictures
        .iter()
        .filter(|p| !matches!(p.content, Content::Bars(_)))
        .count();
    pictures > 1
        && l.opacity > 0.0
        && (l.opacity < 1.0 || l.blur > 0.0 || l.shape != Shape::Whole || l.luma.is_some())
}"""),
("""    fn scene_draws(
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
        }""","""    #[allow(clippy::too_many_arguments)]
    fn scene_draws(
        &self,
        scene: &ScreenScene,
        planes: Option<usize>,
        out_w: u32,
        out_h: u32,
        groups: &Groups,
        draws: &mut Vec<(DrawU, TexKey)>,
    ) {
        let out_aspect = out_w as f32 / out_h.max(1) as f32;
        for (i, layer) in scene.layers.iter().enumerate() {
            match groups.get(&(false, i)) {
                Some(t) => self.group_draw(layer, *t, out_w, out_h, draws),
                None => self.layer_draws(layer, planes, out_w, out_h, draws),
            }
        }"""),
("""        for layer in &scene.overlays {
            self.layer_draws(layer, planes, out_w, out_h, draws);
        }""","""        for (i, layer) in scene.overlays.iter().enumerate() {
            match groups.get(&(true, i)) {
                Some(t) => self.group_draw(layer, *t, out_w, out_h, draws),
                None => self.layer_draws(layer, planes, out_w, out_h, draws),
            }
        }"""),
("""    /// The draws of one layer (an input with its transition, or an overlay channel).""","""    /// A layer drawn whole into scratch target `t` (unmoved, opaque), put on
    /// as one picture with the layer's move, fade, shape, luma wipe and blur.
    fn group_draw(&self, layer: &Layer, t: usize, out_w: u32, out_h: u32, draws: &mut Vec<(DrawU, TexKey)>) {
        let out_aspect = out_w as f32 / out_h.max(1) as f32;
        let lb = layer_box(layer);
        let lw = (lb[2] - lb[0]) * out_w as f32;
        let lh = (lb[3] - lb[1]) * out_h as f32;
        let mut d = DrawU::new();
        d.set(LAYER, lb).set(DST, lb);
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
        d.set(MISC, [1.0, 1.0, layer_aspect, 2.0]);
        draws.push((d, TexKey::Target(t)));
    }

    /// The draws of one layer (an input with its transition, or an overlay channel)."""),
("""        let mut plan: Vec<Planned> = Vec::new();
        for p in passes {
            let Some((tw, th)) = self.dest_size(p.dest) else {
                continue;
            };
            let (w, h) = p.viewport.map_or((tw, th), |v| (v[2], v[3]));
            let mut draws = Vec::new();
            match &p.paint {
                Paint::Scene { scene, planes } => {
                    self.scene_draws(scene, *planes, w, h, &mut draws)
                }""","""        let mut plan: Vec<Planned> = Vec::new();
        let mut scratch = SCRATCH;
        for p in passes {
            let Some((tw, th)) = self.dest_size(p.dest) else {
                continue;
            };
            let (w, h) = p.viewport.map_or((tw, th), |v| (v[2], v[3]));
            let mut draws = Vec::new();
            match &p.paint {
                Paint::Scene { scene, planes } => {
                    // Layers faded as a whole: drawn into scratch targets first.
                    let mut groups = Groups::new();
                    for (overlay, list) in [(false, &scene.layers), (true, &scene.overlays)] {
                        for (i, l) in list.iter().enumerate().filter(|(_, l)| needs_group(l)) {
                            let t = scratch;
                            scratch += 1;
                            self.ensure_target(t, w, h);
                            let whole = Layer {
                                opacity: 1.0,
                                blur: 0.0,
                                shape: Shape::Whole,
                                luma: None,
                                shift: [0.0, 0.0],
                                scale: 1.0,
                                ..l.clone()
                            };
                            let mut d = Vec::new();
                            self.layer_draws(&whole, *planes, w, h, &mut d);
                            plan.push((Dest::Target(t), None, d));
                            groups.insert((overlay, i), t);
                        }
                    }
                    self.scene_draws(scene, *planes, w, h, &groups, &mut draws)
                }"""),
("""                        load: if whole {
                            wgpu::LoadOp::Clear(wgpu::Color::BLACK)""","""                        load: if whole {
                            wgpu::LoadOp::Clear(if matches!(dest, Dest::Target(i) if *i >= SCRATCH) {
                                wgpu::Color::TRANSPARENT
                            } else {
                                wgpu::Color::BLACK
                            })"""),
])
