@@@
        let view = tex
            .texture
            .create_view(&wgpu::TextureViewDescriptor::default());
        let Some(src) = self.targets.get(i).and_then(Option::as_ref) else {
            return false;
        };
        // Letterbox the screen into the window.
        let (sa, wa) = (src.w as f32 / src.h as f32, w as f32 / h as f32);
        let dst = if sa > wa {
            let k = wa / sa;
            [0.0, (1.0 - k) / 2.0, 1.0, (1.0 + k) / 2.0]
        } else {
            let k = sa / wa;
            [(1.0 - k) / 2.0, 0.0, (1.0 + k) / 2.0, 1.0]
        };
        let mut d = DrawU::new();
        d.set(DST, dst);
        d.0[MISC * 4 + 3] = 2.0;
        d.set(HDR, out.color.uniform());
        self.submit(
            vec![(Dest::Target(usize::MAX), None, vec![(d, TexKey::Target(i))])],
            Some((&view, format)),
        );
        self.queue.present(tex);
        true
    }
===
        let view = tex
            .texture
            .create_view(&wgpu::TextureViewDescriptor::default());
        if !self.draw_output(i, &view, format, (w, h), out.color) {
            return false;
        }
        self.queue.present(tex);
        true
    }

    /// Draw target `i` letterboxed into `view` (a window's texture of
    /// `format` and `size`), encoded for `color` (SDR, or SDR placed at its
    /// white level in HDR10 or scRGB). False when the target doesn't exist.
    pub fn draw_output(
        &mut self,
        i: usize,
        view: &wgpu::TextureView,
        format: wgpu::TextureFormat,
        (w, h): (u32, u32),
        color: OutColor,
    ) -> bool {
        let Some(src) = self.targets.get(i).and_then(Option::as_ref) else {
            return false;
        };
        // Letterbox the screen into the window.
        let (sa, wa) = (src.w as f32 / src.h as f32, w as f32 / h as f32);
        let dst = if sa > wa {
            let k = wa / sa;
            [0.0, (1.0 - k) / 2.0, 1.0, (1.0 + k) / 2.0]
        } else {
            let k = sa / wa;
            [(1.0 - k) / 2.0, 0.0, (1.0 + k) / 2.0, 1.0]
        };
        let mut d = DrawU::new();
        d.set(DST, dst);
        d.0[MISC * 4 + 3] = 2.0;
        d.set(HDR, color.uniform());
        self.submit(
            vec![(Dest::Target(usize::MAX), None, vec![(d, TexKey::Target(i))])],
            Some((view, format)),
        );
        true
    }
