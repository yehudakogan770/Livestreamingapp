@@@
    /// What doesn't work in the unified engine yet, for what is in the show
    /// now (said to the operator in the Engine dialog).
    fn notes(&self) -> Vec<String> {
        let mut notes = Vec::new();
        let Some(show) = &self.show else { return notes };
        // An input slide fades in as a picture, not with the slide's own fade.
        let slide_input = show.sources.iter().any(|s| match &s.kind {
            SourceKind::Slideshow(k) => {
                k.fade
                    && matches!(
                        k.slides.get(k.current),
                        Some(lumora_engine::slideshow::Slide::Input { source_id, .. })
                            if show.source(source_id).is_some_and(|i| scene::is_video_kind(&i.kind))
                    )
            }
            _ => false,
        });
        if slide_input {
            notes.push(
                "A camera or video used as a slide comes up without the slides' fade in the unified engine."
                    .into(),
            );
        }
        notes
    }
===
    /// What the operator should know about the unified engine now (said in
    /// the Engine dialog): a fallback that is in force.
    fn notes(&self) -> Vec<String> {
        let mut notes = Vec::new();
        if let Some(why) = crate::zerocopy::broken() {
            notes.push(format!(
                "Zero-copy encoding stopped ({why}); recordings and streams are read back from the graphics card until Lumora restarts."
            ));
        }
        if let Some(c) = self.stats.adapter.as_ref().and_then(|a| a.choice.as_deref()) {
            if c.contains("is not here") {
                notes.push(format!("The engine runs on {c}."));
            }
        }
        notes
    }
