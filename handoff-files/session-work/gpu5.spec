@@@
    pub fn set_time(&mut self, now_ms: u64) {
        self.time = (now_ms % 100_000) as f32 / 1000.0;
    }
===
    pub fn set_time(&mut self, now_ms: u64) {
        self.time = (now_ms % 100_000) as f32 / 1000.0;
        self.now_ms = now_ms;
    }
@@@
    /// Seconds (0 – 100) for the grain effect.
    time: f32,
===
    /// Seconds (0 – 100) for the grain effect.
    time: f32,
    /// The show clock (ms): pictures that fade in by themselves (a slide).
    now_ms: u64,
@@@
            uploaded: 0,
            time: 0.0,
            lost,
===
            uploaded: 0,
            time: 0.0,
            now_ms: 0,
            lost,
@@@
                    let pl = &pic.placement;
                    let qw = (dst[2] - dst[0]) * out_w as f32;
===
                    let pl = &pic.placement;
                    if let Some((start, ms)) = pl.appear {
                        // A slide's fade: this picture alone, over the background.
                        d.0[FX * 4] = layer.opacity * crate::scene::appear_amount(start, ms, self.now_ms);
                    }
                    let qw = (dst[2] - dst[0]) * out_w as f32;
