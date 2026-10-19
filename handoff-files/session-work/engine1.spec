@@@
    /// Previews are drawn every this many frames (60 fps / 6 = 10 previews a second).
    pub preview_every: u32,
}
===
    /// Previews are drawn every this many frames (60 fps / 6 = 10 previews a second).
    pub preview_every: u32,
    /// The graphics card (a [`crate::adapters::Card`] key; None: the high-performance one).
    pub adapter: Option<String>,
}
@@@
            preview_every: 6,
        }
===
            preview_every: 6,
            adapter: None,
        }
@@@
    pub adapter: Option<AdapterInfo>,
    pub outputs: Vec<String>,
===
    pub adapter: Option<AdapterInfo>,
    pub outputs: Vec<String>,
    /// Each output window: the card that presents it and how (SDR or HDR).
    pub output_cards: Vec<crate::adapters::OutputCard>,
    /// Every graphics card here (for Settings → Engine's choice).
    pub cards: Vec<crate::adapters::Card>,
@@@
                if let Some(o) = self.outputs.get_mut(&screen) {
                    o.place(p);
                } else {
                    let o = NativeOutput::open(&self.gpu.instance, p)?;
                    self.outputs.insert(screen, o);
                }
===
                // Another card for it (or none any more): a new window and surface.
                let recard = self.outputs.get(&screen).is_some_and(|o| {
                    o.placement().own_card != p.own_card || o.placement().display != p.display
                });
                if recard {
                    self.outputs.remove(&screen);
                }
                if let Some(o) = self.outputs.get_mut(&screen) {
                    o.place(p);
                } else {
                    let mut o = NativeOutput::open(&self.gpu.instance, p)?;
                    o.bridge = self.bridge_for(o.placement());
                    self.outputs.insert(screen, o);
                }
@@@
                if let Some(o) = self.multiview.as_mut() {
                    o.place(p);
                } else {
                    self.multiview = Some(NativeOutput::open(&self.gpu.instance, p)?);
                }
===
                let recard = self.multiview.as_ref().is_some_and(|o| {
                    o.placement().own_card != p.own_card || o.placement().display != p.display
                });
                if recard {
                    self.multiview = None;
                }
                if let Some(o) = self.multiview.as_mut() {
                    o.place(p);
                } else {
                    let mut o = NativeOutput::open(&self.gpu.instance, p)?;
                    o.bridge = self.bridge_for(o.placement());
                    self.multiview = Some(o);
                }
@@@
    /// The multiview's layout (for its words), when it is open.
===
    /// The card to present a window placed at `p` with, when it isn't the
    /// engine's: the display's own card, when the operator asked for it and
    /// that card is another one (see [`crate::adapters`]).
    fn bridge_for(&mut self, p: &Placement) -> Option<crate::adapters::Bridge> {
        let rect = p.display.filter(|_| p.own_card)?;
        self.stats.cards = crate::adapters::cards(&self.gpu.instance);
        let card = crate::adapters::card_for_display(&self.stats.cards, rect)?;
        let mine = self.stats.adapter.as_ref().and_then(|a| a.key.clone());
        if mine.as_deref() == Some(card.key.as_str()) {
            return None;
        }
        match crate::adapters::Bridge::open(&self.gpu.instance, &card.key) {
            Ok(b) => Some(b),
            Err(e) => {
                eprintln!("lumora: {} can't present its own display ({e}); the engine's card does", card.name);
                None
            }
        }
    }

    /// The multiview's layout (for its words), when it is open.
@@@
        // 4. The screens in their windows. An audience screen never closes by
        // accident (Alt+F4 on the projector): a close request is ignored.
        for (s, o) in &mut self.outputs {
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
        }
===
        // 4. The screens in their windows. An audience screen never closes by
        // accident (Alt+F4 on the projector): a close request is ignored.
        for (s, o) in &mut self.outputs {
            show_in(&mut self.gpu, o, program_target(*s));
        }
        if self.multiview.is_some() {
            self.draw_multiview();
            if let Some(o) = self.multiview.as_mut() {
                show_in(&mut self.gpu, o, MULTIVIEW);
            }
        }
@@@
/// Auto-framed inputs' pictures zoomed and panned to their shots (`shots`:
===
/// Show target `i` in output window `o`: on the engine's card, or copied
/// across to the card of its display (a bridge, one frame later).
fn show_in(gpu: &mut Compositor, o: &mut NativeOutput, i: usize) {
    let _ = o.pump();
    let (w, h) = o.size();
    match o.bridge.as_mut() {
        Some(b) => {
            if b.carry(gpu, i) {
                let t = b.target();
                b.gpu.present(&mut o.out, t, w, h);
            }
        }
        None => {
            gpu.present(&mut o.out, i, w, h);
        }
    }
}

/// Auto-framed inputs' pictures zoomed and panned to their shots (`shots`:
@@@
            self.stats.outputs = self
                .outputs
                .keys()
                .map(|s| screen_name(*s).to_owned())
                .chain(self.multiview.as_ref().map(|_| "multiview".to_owned()))
                .collect();
===
            self.stats.outputs = self
                .outputs
                .keys()
                .map(|s| screen_name(*s).to_owned())
                .chain(self.multiview.as_ref().map(|_| "multiview".to_owned()))
                .collect();
            self.stats.output_cards = self.output_cards();
@@@
    /// What doesn't work in the unified engine yet, for what is in the show
===
    /// Each output window's card and colors (the Engine dialog, the test event).
    fn output_cards(&self) -> Vec<crate::adapters::OutputCard> {
        let engine = self
            .stats
            .adapter
            .as_ref()
            .map_or_else(String::new, |a| a.name.clone());
        let mut v: Vec<(String, &NativeOutput)> = self
            .outputs
            .iter()
            .map(|(s, o)| (screen_name(*s).to_owned(), o))
            .chain(self.multiview.as_ref().map(|o| ("multiview".to_owned(), o)))
            .collect();
        v.sort_by(|a, b| a.0.cmp(&b.0));
        v.into_iter()
            .map(|(output, o)| crate::adapters::OutputCard {
                output,
                display_card: o.placement().display.and_then(|r| {
                    crate::adapters::card_for_display(&self.stats.cards, r).map(|c| c.name.clone())
                }),
                presented_by: o
                    .bridge
                    .as_ref()
                    .map_or_else(|| engine.clone(), |b| b.gpu.describe().name),
                copied: o.bridge.is_some(),
                color: o.out.color.label(),
            })
            .collect()
    }

    /// What doesn't work in the unified engine yet, for what is in the show
