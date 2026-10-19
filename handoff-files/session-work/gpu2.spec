@@@
/// A window (or anything with a wgpu surface) being drawn into.
pub struct SurfaceOut {
    pub surface: wgpu::Surface<'static>,
    config: Option<wgpu::SurfaceConfiguration>,
}

impl SurfaceOut {
    pub fn new(surface: wgpu::Surface<'static>) -> Self {
        SurfaceOut {
            surface,
            config: None,
        }
    }

    /// Configure it again on the next present (a new graphics device).
    pub fn reset(&mut self) {
        self.config = None;
    }
}
===
/// How a window's pixels are meant.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum OutColor {
    /// sRGB, as everything else (the default).
    #[default]
    Sdr,
    /// HDR10: BT.2020 primaries, PQ (`Rgb10a2Unorm`); SDR white at `white` nits.
    Pq { white: u32 },
    /// scRGB: linear BT.709, 1.0 = 80 nits (`Rgba16Float`); SDR white at `white` nits.
    ScRgb { white: u32 },
}

impl OutColor {
    /// For the operator.
    pub fn label(self) -> String {
        match self {
            OutColor::Sdr => "SDR".into(),
            OutColor::Pq { white } => format!("HDR10 (PQ), SDR white at {white} nits"),
            OutColor::ScRgb { white } => format!("HDR (scRGB), SDR white at {white} nits"),
        }
    }

    /// The draw's `hdr` uniform: encoding and SDR white.
    fn uniform(self) -> [f32; 4] {
        match self {
            OutColor::Sdr => [0.0; 4],
            OutColor::ScRgb { white } => [1.0, white as f32, 0.0, 0.0],
            OutColor::Pq { white } => [2.0, white as f32, 0.0, 0.0],
        }
    }
}

/// The SDR white level of HDR outputs unless the operator sets another (BT.2408: 203 nits).
pub const SDR_WHITE_NITS: u32 = 203;

/// Whether a display shows HDR now (what Windows says about it).
pub fn display_is_hdr(info: &wgpu::DisplayHdrInfo) -> bool {
    info.coarse.and_then(|c| c.high_dynamic_range).unwrap_or(false)
        || info
            .luminance
            .and_then(|l| l.max_nits)
            .is_some_and(|n| n >= 400.0)
}

/// The best HDR way to show in a surface that offers `caps`: HDR10 (PQ) first, then scRGB.
pub fn hdr_format(
    caps: &wgpu::SurfaceCapabilities,
    white: u32,
) -> Option<(wgpu::TextureFormat, wgpu::SurfaceColorSpace, OutColor)> {
    let has = |f: wgpu::TextureFormat, cs: wgpu::SurfaceColorSpaces| caps.color_spaces(f).contains(cs);
    if has(
        wgpu::TextureFormat::Rgb10a2Unorm,
        wgpu::SurfaceColorSpaces::BT2100_PQ,
    ) {
        Some((
            wgpu::TextureFormat::Rgb10a2Unorm,
            wgpu::SurfaceColorSpace::Bt2100Pq,
            OutColor::Pq { white },
        ))
    } else if has(
        wgpu::TextureFormat::Rgba16Float,
        wgpu::SurfaceColorSpaces::EXTENDED_SRGB_LINEAR,
    ) {
        Some((
            wgpu::TextureFormat::Rgba16Float,
            wgpu::SurfaceColorSpace::ExtendedSrgbLinear,
            OutColor::ScRgb { white },
        ))
    } else {
        None
    }
}

/// A window (or anything with a wgpu surface) being drawn into.
pub struct SurfaceOut {
    pub surface: wgpu::Surface<'static>,
    config: Option<wgpu::SurfaceConfiguration>,
    /// HDR asked for (SDR white in nits); None: SDR.
    hdr_white: Option<u32>,
    /// How it shows now.
    pub color: OutColor,
}

impl SurfaceOut {
    pub fn new(surface: wgpu::Surface<'static>) -> Self {
        SurfaceOut {
            surface,
            config: None,
            hdr_white: None,
            color: OutColor::Sdr,
        }
    }

    /// Configure it again on the next present (a new graphics device).
    pub fn reset(&mut self) {
        self.config = None;
    }

    /// Show HDR when the display can, SDR white at `white` nits (None: SDR).
    pub fn set_hdr(&mut self, white: Option<u32>) {
        if self.hdr_white != white {
            self.hdr_white = white;
            self.config = None;
        }
    }
}
@@@
        if stale {
            let caps = out.surface.get_capabilities(&self.adapter);
            let Some(format) = caps
                .formats
                .iter()
                .copied()
                .find(|f| {
                    matches!(
                        f,
                        wgpu::TextureFormat::Bgra8Unorm | wgpu::TextureFormat::Rgba8Unorm
                    )
                })
                .or_else(|| caps.formats.first().copied())
            else {
                return false;
            };
===
        if stale {
            let caps = out.surface.get_capabilities(&self.adapter);
            // HDR when asked for and the display shows HDR now; SDR otherwise.
            let hdr = out
                .hdr_white
                .filter(|_| display_is_hdr(&out.surface.display_hdr_info(&self.adapter)))
                .and_then(|white| hdr_format(&caps, white));
            let sdr = caps
                .formats
                .iter()
                .copied()
                .find(|f| {
                    matches!(
                        f,
                        wgpu::TextureFormat::Bgra8Unorm | wgpu::TextureFormat::Rgba8Unorm
                    )
                })
                .or_else(|| caps.formats.first().copied());
            let (format, color_space, color) = match (hdr, sdr) {
                (Some(h), _) => h,
                (None, Some(f)) => (f, wgpu::SurfaceColorSpace::Auto, OutColor::Sdr),
                (None, None) => return false,
            };
            out.color = color;
@@@
                view_formats: vec![],
                color_space: Default::default(),
            };
===
                view_formats: vec![],
                color_space,
            };
@@@
        let mut d = DrawU::new();
        d.set(DST, dst);
        d.0[MISC * 4 + 3] = 2.0;
===
        let mut d = DrawU::new();
        d.set(DST, dst);
        d.0[MISC * 4 + 3] = 2.0;
        d.set(HDR, out.color.uniform());
