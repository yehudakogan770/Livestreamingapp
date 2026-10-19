W='/home/user/Livestreamingapp/.claude/worktrees/agent-aefea299a26a1206e/'
def edit(path, pairs):
    p=W+path
    s=open(p).read()
    for a,b in pairs:
        assert s.count(a)==1, (path, a, s.count(a))
        s=s.replace(a,b)
    open(p,'w').write(s)

edit('crates/live-engine/src/engine.rs', [
("""use crate::gpu::{AdapterInfo, Compositor, Dest, Paint, Pass};""","""use crate::gpu::{AdapterInfo, Compositor, Dest, Paint, Pass};
use crate::multiview::{self, Tally, TileContent};"""),
("""const NEXT: [(ScreenId, usize); 2] = [(ScreenId::Live, 3), (ScreenId::Back, 4)];""","""const NEXT: [(ScreenId, usize); 2] = [(ScreenId::Live, 3), (ScreenId::Back, 4)];
/// The multiview is drawn here (feeds' targets come after it).
const MULTIVIEW: usize = 8;
/// The multiview's background, borders and tally (`MultiviewView.css`: --chrome, #272727, --program-bright, --preview-bright).
const MV_CHROME: [f32; 4] = [11.0 / 255.0, 11.0 / 255.0, 11.0 / 255.0, 1.0];
const MV_BORDER: [f32; 4] = [39.0 / 255.0, 39.0 / 255.0, 39.0 / 255.0, 1.0];
const MV_PGM: [f32; 4] = [1.0, 75.0 / 255.0, 62.0 / 255.0, 1.0];
const MV_PVW: [f32; 4] = [52.0 / 255.0, 210.0 / 255.0, 107.0 / 255.0, 1.0];
/// The plane of words (names, tally tags, clock) the Live Screen's overlay renderer draws for it.
pub const MULTIVIEW_PLANE: &str = "mv";"""),
("""    feeds: Feeds,
""","""    feeds: Feeds,
    /// The multiview's window, and its layout for the show now.
    multiview: Option<NativeOutput>,
    mv_layout: Option<multiview::Layout>,
""",),
("""            feeds: Feeds::default(),
""","""            feeds: Feeds::default(),
            multiview: None,
            mv_layout: None,
"""),
("""        self.show = Some(show);
    }""","""        self.mv_layout = Some(multiview::layout(&show, multiview::SIZE.0, multiview::SIZE.1));
        self.show = Some(show);
    }"""),
("""    pub fn open_outputs(&self) -> Vec<ScreenId> {""","""    /// Open (or move) the multiview's window; None closes it.
    ///
    /// # Errors
    /// The window could not be made (and on computers other than Windows).
    pub fn set_multiview(&mut self, placement: Option<Placement>) -> Result<(), String> {
        match placement {
            None => {
                self.multiview = None;
                self.gpu.drop_target(MULTIVIEW);
            }
            Some(p) => {
                if let Some(o) = self.multiview.as_mut() {
                    o.place(p);
                } else {
                    self.multiview = Some(NativeOutput::open(&self.gpu.instance, p)?);
                }
            }
        }
        Ok(())
    }

    /// The multiview's layout (for its words), when it is open.
    pub fn multiview_layout(&self) -> Option<multiview::Layout> {
        self.multiview.as_ref().and(self.mv_layout.clone())
    }

    /// Draw the multiview (into its own target) from this frame's pictures.
    pub fn draw_multiview(&mut self) {
        let (Some(show), Some(l)) = (&self.show, &self.mv_layout) else {
            return;
        };
        self.gpu.ensure_target(MULTIVIEW, l.width, l.height);
        let (w, h) = (self.config.width as f32, self.config.height as f32);
        let aspect = w / h.max(1.0);
        let scenes: Vec<(usize, ScreenScene)> = l
            .tiles
            .iter()
            .enumerate()
            .filter_map(|(i, t)| match &t.content {
                TileContent::Input(id) => Some((i, scene::source_scene(show, id))),
                _ => None,
            })
            .collect();
        let mut passes: Vec<Pass<'_>> = vec![Pass {
            dest: Dest::Target(MULTIVIEW),
            viewport: None,
            paint: Paint::Solid(MV_CHROME),
        }];
        let border = l.scale.max(1.0).round() as u32;
        for (i, t) in l.tiles.iter().enumerate() {
            let [x, y, tw, th] = t.rect;
            let (color, b) = match t.tally {
                Tally::Pgm => (MV_PGM, border * 2),
                Tally::Pvw => (MV_PVW, border * 2),
                Tally::None => (MV_BORDER, border),
            };
            // The box: its border, then black inside.
            passes.push(Pass {
                dest: Dest::Target(MULTIVIEW),
                viewport: Some(t.rect),
                paint: Paint::Solid(color),
            });
            passes.push(Pass {
                dest: Dest::Target(MULTIVIEW),
                viewport: Some([x + b, y + b, tw.saturating_sub(2 * b).max(1), th.saturating_sub(2 * b).max(1)]),
                paint: Paint::Solid([0.0, 0.0, 0.0, 1.0]),
            });
            let pic = multiview::fit(t.picture, aspect);
            let paint = match &t.content {
                TileContent::Program(s) => Paint::Target(program_target(*s)),
                TileContent::Next(s) => match NEXT.iter().find(|n| n.0 == *s) {
                    Some(n) => Paint::Target(n.1),
                    None => continue,
                },
                TileContent::Input(_) => match scenes.iter().find(|(n, _)| *n == i) {
                    // A graphics input shows when the Live Screen's renderer has it (on air there).
                    Some((_, sc)) => Paint::Scene {
                        scene: sc,
                        planes: Some(program_target(ScreenId::Live)),
                    },
                    None => continue,
                },
            };
            passes.push(Pass {
                dest: Dest::Target(MULTIVIEW),
                viewport: Some(pic),
                paint,
            });
        }
        passes.push(Pass {
            dest: Dest::Target(MULTIVIEW),
            viewport: None,
            paint: Paint::Plane {
                slot: program_target(ScreenId::Live),
                name: MULTIVIEW_PLANE,
            },
        });
        self.gpu.render(&passes);
    }

    pub fn open_outputs(&self) -> Vec<ScreenId> {"""),
("""        let mut needed: Vec<&SourceId> = program
            .iter()
            .flat_map(|p| p.2.videos())
            .chain(next.iter().flat_map(|n| n.1.videos()))
            .chain(inputs.iter().map(|i| &i.0))
            .collect();""","""        // The multiview shows every input at the engine's full rate.
        let all: Vec<&SourceId> = if self.multiview.is_some() {
            scene::video_inputs(show).into_iter().map(|s| &s.id).collect()
        } else {
            Vec::new()
        };
        let mut needed: Vec<&SourceId> = program
            .iter()
            .flat_map(|p| p.2.videos())
            .chain(next.iter().flat_map(|n| n.1.videos()))
            .chain(inputs.iter().map(|i| &i.0))
            .chain(all)
            .collect();"""),
("""        for (s, o) in &mut self.outputs {
            let _ = o.pump();
            let (w, h) = o.size();
            self.gpu.present(&mut o.out, program_target(*s), w, h);
        }""","""        for (s, o) in &mut self.outputs {
            let _ = o.pump();
            let (w, h) = o.size();
            self.gpu.present(&mut o.out, program_target(*s), w, h);
        }
        if self.multiview.is_some() {
            self.draw_multiview();
            if let Some(o) = self.multiview.as_mut() {
                let _ = o.pump();
                let (w, h) = o.size();
                self.gpu.present(&mut o.out, MULTIVIEW, w, h);
            }
        }"""),
("""            self.stats.outputs = self
                .outputs
                .keys()
                .map(|s| screen_name(*s).to_owned())
                .collect();""","""            self.stats.outputs = self
                .outputs
                .keys()
                .map(|s| screen_name(*s).to_owned())
                .chain(self.multiview.as_ref().map(|_| "multiview".to_owned()))
                .collect();"""),
# runner command
("""    Probe(ScreenId, Sender<ScreenProbe>),""","""    Probe(ScreenId, Sender<ScreenProbe>),
    Multiview(Option<Placement>, Sender<Result<(), String>>),
    MultiviewLayout(Sender<Option<multiview::Layout>>),"""),
("""                Ok(Command::Probe(s, reply)) => {
                    let _ = reply.send(engine.probe(s));
                }""","""                Ok(Command::Probe(s, reply)) => {
                    let _ = reply.send(engine.probe(s));
                }
                Ok(Command::Multiview(p, reply)) => {
                    let _ = reply.send(engine.set_multiview(p));
                }
                Ok(Command::MultiviewLayout(reply)) => {
                    let _ = reply.send(engine.multiview_layout());
                }"""),
("""    /// Check a screen (the test event).""","""    /// Open, move or (None) close the multiview's window.
    ///
    /// # Errors
    /// The window could not be made.
    pub fn set_multiview(&self, placement: Option<Placement>) -> Result<(), String> {
        let (tx, rx) = channel();
        self.tx
            .send(Command::Multiview(placement, tx))
            .map_err(|_| "The unified engine has stopped.".to_owned())?;
        rx.recv_timeout(Duration::from_secs(5))
            .map_err(|_| "The unified engine did not answer.".to_owned())?
    }

    /// The multiview's layout while it is open (for its words).
    pub fn multiview_layout(&self) -> Option<multiview::Layout> {
        let (tx, rx) = channel();
        self.tx.send(Command::MultiviewLayout(tx)).ok()?;
        rx.recv_timeout(Duration::from_secs(5)).ok().flatten()
    }

    /// Check a screen (the test event)."""),
])
