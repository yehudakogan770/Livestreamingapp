@@@
use crate::gpu::SurfaceOut;

/// Where an output window goes.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Placement {
    /// The display's rectangle (x, y, width, height in physical pixels):
    /// the window covers it. None: a 960 × 540 window the operator can move.
    pub display: Option<(i32, i32, u32, u32)>,
    pub title: String,
}

pub struct NativeOutput {
    /// Declared before the window so the surface goes first when dropped.
    pub out: SurfaceOut,
===
use crate::adapters::Bridge;
use crate::gpu::SurfaceOut;

/// Where an output window goes.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct Placement {
    /// The display's rectangle (x, y, width, height in physical pixels):
    /// the window covers it. None: a 960 × 540 window the operator can move.
    pub display: Option<(i32, i32, u32, u32)>,
    pub title: String,
    /// Presented by the graphics card its display hangs off (the engine
    /// copies the picture across) rather than the engine's own card (Windows
    /// copies it): see [`crate::adapters`].
    pub own_card: bool,
    /// HDR10 when the display can show HDR, with SDR white (the engine's
    /// picture and graphics) at this many nits; None: SDR (the default).
    pub hdr_white: Option<u32>,
}

pub struct NativeOutput {
    /// Declared before the window so the surface goes first when dropped.
    pub out: SurfaceOut,
    /// Presented by another card than the engine's (its own display's).
    pub bridge: Option<Bridge>,
@@@
        let window = win::Window::create(&placement)?;
        let surface = win::surface(instance, window.hwnd())?;
        Ok(NativeOutput {
            out: SurfaceOut::new(surface),
            window,
            placement,
        })
===
        let window = win::Window::create(&placement)?;
        let surface = win::surface(instance, window.hwnd())?;
        let mut out = SurfaceOut::new(surface);
        out.set_hdr(placement.hdr_white);
        Ok(NativeOutput {
            out,
            bridge: None,
            window,
            placement,
        })
@@@
        #[cfg(windows)]
        self.window.place(&placement);
        self.placement = placement;
===
        #[cfg(windows)]
        self.window.place(&placement);
        self.out.set_hdr(placement.hdr_white);
        self.placement = placement;
