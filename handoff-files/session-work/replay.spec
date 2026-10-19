@@@
    let dir = ring.dir.clone();
    let to = app.clone();
    let on_end: live_engine::encoder::OnEnd = Box::new(move |asked, said| {
        if asked {
            return;
        }
        let said = said.unwrap_or_else(|| "it stopped".to_owned());
        eprintln!("lumora: the engine's replay encoder stopped: {said}");
        if let Some(l) = to.try_state::<Live>() {
            lock(&l.inner).replay = None;
        }
        let _ = to.emit(
            "live-engine-replay-lost",
            format!("Instant replay stopped ({said})."),
        );
    });
===
    let dir = ring.dir.clone();
    let to = app.clone();
    // This replay (a newer one started meanwhile is left alone).
    let generation = {
        let mut inner = lock(&live.inner);
        inner.replay_generation += 1;
        inner.replay_generation
    };
    let on_end: live_engine::encoder::OnEnd = Box::new(move |asked, said| {
        if asked {
            return;
        }
        let said = said.unwrap_or_else(|| "it stopped".to_owned());
        eprintln!("lumora: the engine's replay encoder stopped: {said}");
        // A hardware encoder that failed isn't used again (as for recordings).
        if family.hardware() && encode::encoder_failed(&said) {
            to.state::<crate::AppState>()
                .capture
                .engine_hw_failed(family);
        }
        if let Some(l) = to.try_state::<Live>() {
            let (ring, runner) = {
                let mut inner = lock(&l.inner);
                if inner.replay_generation != generation {
                    return;
                }
                (inner.replay.take(), inner.runner.clone())
            };
            // Off everywhere: the engine lets the dead feed go and the pieces go.
            // (On its own thread: this is the encoder's, which finishing waits for.)
            std::thread::spawn(move || {
                if let Some(r) = runner {
                    drop(r.stop_feed(REPLAY_FEED));
                }
                if let Some(ring) = ring {
                    let dir = ring
                        .lock()
                        .unwrap_or_else(PoisonError::into_inner)
                        .dir
                        .clone();
                    let _ = std::fs::remove_dir_all(dir);
                }
            });
        }
        let _ = to.emit(
            "live-engine-replay-lost",
            format!("Instant replay stopped ({said})."),
        );
    });
@@@
    /// Instant replay: the ring of pieces the engine's replay feed writes.
    replay: Option<Arc<Mutex<live_engine::replay::Ring>>>,
===
    /// Instant replay: the ring of pieces the engine's replay feed writes.
    replay: Option<Arc<Mutex<live_engine::replay::Ring>>>,
    /// Counts replays started (an old one's encoder stopping leaves a new one alone).
    replay_generation: u64,
