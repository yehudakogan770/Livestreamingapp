@@@
    pub fn new(
        instance: wgpu::Instance,
        surface: Option<&wgpu::Surface<'_>>,
    ) -> Result<Self, String> {
        let adapter = pollster::block_on(instance.request_adapter(&wgpu::RequestAdapterOptions {
            power_preference: wgpu::PowerPreference::HighPerformance,
            force_fallback_adapter: false,
            compatible_surface: surface,
            apply_limit_buckets: false,
        }))
        .map_err(|e| format!("No graphics card for the unified engine: {e}"))?;
        let limits
===
    pub fn new(
        instance: wgpu::Instance,
        surface: Option<&wgpu::Surface<'_>>,
    ) -> Result<Self, String> {
        let adapter = pollster::block_on(instance.request_adapter(&wgpu::RequestAdapterOptions {
            power_preference: wgpu::PowerPreference::HighPerformance,
            force_fallback_adapter: false,
            compatible_surface: surface,
            apply_limit_buckets: false,
        }))
        .map_err(|e| format!("No graphics card for the unified engine: {e}"))?;
        let mut c = Self::on_adapter(instance, adapter)?;
        c.choice = "the high-performance graphics card (automatic)".into();
        Ok(c)
    }

    /// Start on the card `key` (Settings → Engine; see [`crate::adapters`]),
    /// or the high-performance one when it is automatic or the card is gone.
    ///
    /// # Errors
    /// No usable graphics card.
    pub fn with_card(instance: wgpu::Instance, key: Option<&str>) -> Result<Self, String> {
        let Some(key) = key else {
            return Self::new(instance, None);
        };
        match crate::adapters::find(&instance, key) {
            Some(a) => {
                let mut c = Self::on_adapter(instance, a)?;
                c.wanted = Some(key.to_owned());
                c.choice = "chosen in Settings → Engine".into();
                Ok(c)
            }
            None => {
                let mut c = Self::new(instance, None)?;
                c.wanted = Some(key.to_owned());
                c.choice =
                    "the high-performance graphics card (the one chosen in Settings → Engine is not here)"
                        .into();
                Ok(c)
            }
        }
    }

    /// Start on `adapter`.
    ///
    /// # Errors
    /// The card could not start.
    pub fn on_adapter(instance: wgpu::Instance, adapter: wgpu::Adapter) -> Result<Self, String> {
        let limits
@@@
            uploaded: 0,
            time: 0.0,
            lost,
        };
===
            uploaded: 0,
            time: 0.0,
            lost,
            wanted: None,
            choice: String::new(),
        };
@@@
    pub fn renew(&self) -> Result<Self, String> {
        Self::new(self.instance.clone(), None)
    }
===
    pub fn renew(&self) -> Result<Self, String> {
        Self::with_card(self.instance.clone(), self.wanted.as_deref())
    }
@@@
    pub fn describe(&self) -> AdapterInfo {
        let i = self.adapter.get_info();
        AdapterInfo {
            kind: kind_of(i.device_type),
            backend: format!("{:?}", i.backend),
            name: i.name,
        }
    }
===
    pub fn describe(&self) -> AdapterInfo {
        let i = self.adapter.get_info();
        AdapterInfo {
            kind: kind_of(i.device_type),
            backend: format!("{:?}", i.backend),
            name: i.name,
            key: crate::adapters::key_in(&self.instance, &self.adapter),
            choice: Some(self.choice.clone()).filter(|c| !c.is_empty()),
        }
    }

    /// Put `rgba` (`w` × `h`, top row first) into target `i` (an output
    /// presented by another card: [`crate::adapters::Bridge`]).
    pub fn write_target(&mut self, i: usize, w: u32, h: u32, rgba: &[u8]) {
        if rgba.len() < (w as usize) * (h as usize) * 4 {
            return;
        }
        self.ensure_target(i, w, h);
        if let Some(t) = self.targets.get(i).and_then(Option::as_ref) {
            write_tex(&self.queue, t, rgba);
            self.uploaded += u64::from(w) * u64::from(h) * 4;
        }
    }
@@@
fn kind_of(t: wgpu::DeviceType) -> &'static str {
===
pub fn kind_of(t: wgpu::DeviceType) -> &'static str {
@@@
    /// The graphics device was lost (a driver reset, the card removed): the engine makes a new one.
    lost: Arc<std::sync::atomic::AtomicBool>,
}
===
    /// The graphics device was lost (a driver reset, the card removed): the engine makes a new one.
    lost: Arc<std::sync::atomic::AtomicBool>,
    /// The card asked for in Settings → Engine (None: automatic).
    wanted: Option<String>,
    /// Why this card, in words.
    choice: String,
}
@@@
pub struct AdapterInfo {
    pub name: String,
    pub backend: String,
    /// "discrete", "integrated", "software", "virtual" or "other".
    pub kind: &'static str,
}
===
pub struct AdapterInfo {
    pub name: String,
    pub backend: String,
    /// "discrete", "integrated", "software", "virtual" or "other".
    pub kind: &'static str,
    /// Its key (Settings → Engine's choice, [`crate::adapters::Card::key`]).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub key: Option<String>,
    /// Why the engine is on it.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub choice: Option<String>,
}
@@@
            AdapterInfo {
                kind: kind_of(i.device_type),
                backend: format!("{:?}", i.backend),
                name: i.name,
            }
===
            AdapterInfo {
                kind: kind_of(i.device_type),
                backend: format!("{:?}", i.backend),
                name: i.name,
                key: None,
                choice: None,
            }
