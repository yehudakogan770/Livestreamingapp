W='/home/user/Livestreamingapp/.claude/worktrees/agent-aefea299a26a1206e/'
p=W+'crates/live-engine/src/engine.rs'
s=open(p).read()
def rep(a,b,cnt=1):
    global s
    assert s.count(a)==cnt, (a, s.count(a))
    s=s.replace(a,b)
rep('''    pub ms_per_frame: f32,''','''    pub ms_per_frame: f32,
    /// Frames drawn in the last second.
    pub fps: f32,''')
rep('''            self.stats.ms_per_frame = (tm.total / n) as f32;''','''            self.stats.ms_per_frame = (tm.total / n) as f32;
            self.stats.fps = (n / span) as f32;''')
rep('''    /// Each input's health, for the backup lineup's watch.
    pub fn health(&self) -> Vec<(SourceId, SourceHealth)> {''','''    /// How a screen is doing, as the test event asks the output windows:
    /// what is on air is really drawn (its frames or its graphics are
    /// there), whether the picture is black, whether the overlays on air are drawn.
    pub fn probe(&self, screen: ScreenId) -> ScreenProbe {
        let mut p = ScreenProbe {
            fps: self.stats.fps,
            width: self.config.width,
            height: self.config.height,
            window: self.outputs.contains_key(&screen),
            ..ScreenProbe::default()
        };
        let Some(show) = &self.show else { return p };
        let slot = program_target(screen);
        let drawn = |id: &SourceId| match show.source(id).map(|s| &s.kind) {
            Some(k) if scene::is_video_kind(k) => self.gpu.source_size(id).is_some(),
            Some(SourceKind::Color { .. } | SourceKind::Split(_)) => true,
            Some(_) => self.gpu.has_plane(slot, &overlay::graphic_plane(id.as_str())),
            None => false,
        };
        let sc = show.screens.get(screen);
        p.in_sync = sc.program.as_ref().map(&drawn);
        if !sc.blank && !show.panic {
            if let Some(t) = self.previews.get(&PreviewId::Program(screen).key()) {
                let px = t.rgba.as_chunks::<4>().0;
                let sum: f64 = px
                    .iter()
                    .map(|c| 0.2126 * f64::from(c[0]) + 0.7152 * f64::from(c[1]) + 0.0722 * f64::from(c[2]))
                    .sum();
                p.black = Some(sum / (px.len().max(1) as f64) < 3.0);
            }
        }
        let on: Vec<&SourceId> = show
            .overlays
            .iter()
            .filter(|o| o.on && o.screens.contains(&screen))
            .filter_map(|o| o.source_id.as_ref())
            .collect();
        if !on.is_empty() {
            p.overlays = Some(on.into_iter().all(drawn));
        }
        p
    }

    /// Each input's health, for the backup lineup's watch.
    pub fn health(&self) -> Vec<(SourceId, SourceHealth)> {''')
rep('''/// What the engine reports.''','''/// A screen as the test event checks it (see [`LiveEngine::probe`]).
#[derive(Debug, Clone, Default, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ScreenProbe {
    pub fps: f32,
    pub in_sync: Option<bool>,
    pub black: Option<bool>,
    pub overlays: Option<bool>,
    pub width: u32,
    pub height: u32,
    /// Shown in the engine's own window now.
    pub window: bool,
}

/// What the engine reports.''')
rep('''    Stop,
}''','''    Probe(ScreenId, Sender<ScreenProbe>),
    Stop,
}''')
rep('''                Ok(Command::Graphics(m)) => engine.apply_graphics(&m),''','''                Ok(Command::Graphics(m)) => engine.apply_graphics(&m),
                Ok(Command::Probe(s, reply)) => {
                    let _ = reply.send(engine.probe(s));
                }''')
rep('''    pub fn stats(&self) -> Stats {
        lock(&self.shared.stats).clone()
    }''','''    pub fn stats(&self) -> Stats {
        lock(&self.shared.stats).clone()
    }

    /// Check a screen (the test event).
    pub fn probe(&self, screen: ScreenId) -> Option<ScreenProbe> {
        let (tx, rx) = channel();
        self.tx.send(Command::Probe(screen, tx)).ok()?;
        rx.recv_timeout(Duration::from_secs(5)).ok()
    }''')
open(p,'w').write(s)
p=W+'crates/live-engine/src/gpu.rs'
s=open(p).read()
rep('''    /// Planes held now.
    pub fn plane_count(&self) -> usize {''','''    /// Whether slot `slot` has a plane `name` (at any size).
    pub fn has_plane(&self, slot: usize, name: &str) -> bool {
        self.planes.keys().any(|k| k.slot == slot && k.name == name)
    }

    /// Planes held now.
    pub fn plane_count(&self) -> usize {''')
open(p,'w').write(s)
p=W+'src-tauri/src/live.rs'
s=open(p).read()
rep('''/// The mixes the engine's encoders are listening to''','''/// The test event's check of an engine screen (in the engine's own window, or not shown).
#[tauri::command]
pub fn live_engine_probe(
    screen: ScreenId,
    live: State<'_, Live>,
) -> Option<live_engine::engine::ScreenProbe> {
    live.runner()?.probe(screen)
}

/// The mixes the engine's encoders are listening to''')
open(p,'w').write(s)
p=W+'src-tauri/src/lib.rs'
s=open(p).read()
rep('''            live::live_engine_capture_stop
''','''            live::live_engine_capture_stop,
            live::live_engine_probe
''')
open(p,'w').write(s)
