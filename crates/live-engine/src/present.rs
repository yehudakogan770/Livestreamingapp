//! Native output windows: the Live, Back and Monitor screens shown straight
//! from the GPU, with no WebView in between. Each is a plain borderless
//! window covering its assigned display (or an ordinary window when none is
//! assigned, or the display is gone). The engine thread makes them, draws
//! into them and handles their messages.
//!
//! Windows only for now; elsewhere [`NativeOutput::open`] says so (the
//! engine then runs headless: encoder feed and previews still work).

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
    #[cfg(windows)]
    window: win::Window,
    placement: Placement,
}

impl NativeOutput {
    /// Make the window and a surface on it.
    ///
    /// # Errors
    /// Not on Windows, or Windows refused the window or the surface.
    #[cfg(windows)]
    pub fn open(instance: &wgpu::Instance, placement: Placement) -> Result<Self, String> {
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
    }

    /// Make the window and a surface on it.
    ///
    /// # Errors
    /// Not on Windows, or Windows refused the window or the surface.
    #[cfg(not(windows))]
    pub fn open(_instance: &wgpu::Instance, _placement: Placement) -> Result<Self, String> {
        Err("Native output windows are only made on Windows for now.".into())
    }

    /// The window's drawable size in pixels.
    pub fn size(&self) -> (u32, u32) {
        #[cfg(windows)]
        {
            self.window.client_size()
        }
        #[cfg(not(windows))]
        {
            (0, 0)
        }
    }

    /// Handle the window's messages. False once the operator closed it.
    pub fn pump(&mut self) -> bool {
        #[cfg(windows)]
        {
            self.window.pump()
        }
        #[cfg(not(windows))]
        {
            true
        }
    }

    /// Move it to another display (or make it a window).
    pub fn place(&mut self, placement: Placement) {
        if placement == self.placement {
            return;
        }
        #[cfg(windows)]
        self.window.place(&placement);
        self.out.set_hdr(placement.hdr_white);
        self.placement = placement;
    }

    pub fn placement(&self) -> &Placement {
        &self.placement
    }
}

#[cfg(windows)]
#[allow(unsafe_code)]
mod win {
    //! Win32: borderless top-level windows that take no focus from the control
    //! window, and a wgpu surface on each.

    use std::num::NonZeroIsize;
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::sync::Once;

    use raw_window_handle::{
        RawDisplayHandle, RawWindowHandle, Win32WindowHandle, WindowsDisplayHandle,
    };
    use windows_sys::Win32::Foundation::{HWND, LPARAM, LRESULT, RECT, WPARAM};
    use windows_sys::Win32::System::LibraryLoader::GetModuleHandleW;
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        CreateWindowExW, DefWindowProcW, DestroyWindow, DispatchMessageW, GetClientRect,
        PeekMessageW, RegisterClassExW, SetWindowLongPtrW, SetWindowPos, ShowWindow,
        TranslateMessage, GWL_STYLE, HWND_TOP, MSG, PM_REMOVE, SWP_FRAMECHANGED, SWP_NOACTIVATE,
        SWP_SHOWWINDOW, SW_SHOWNOACTIVATE, WM_CLOSE, WM_ERASEBKGND, WNDCLASSEXW, WS_EX_NOACTIVATE,
        WS_OVERLAPPEDWINDOW, WS_POPUP, WS_VISIBLE,
    };

    use super::Placement;

    const CLASS: &str = "LumoraLiveOutput";

    /// Set when any output window was asked to close (the engine reopens or reports it).
    static CLOSE_ASKED: AtomicBool = AtomicBool::new(false);

    fn wide(s: &str) -> Vec<u16> {
        s.encode_utf16().chain(std::iter::once(0)).collect()
    }

    unsafe extern "system" fn window_proc(hwnd: HWND, msg: u32, w: WPARAM, l: LPARAM) -> LRESULT {
        match msg {
            // The GPU paints every pixel: no flash of white.
            WM_ERASEBKGND => 1,
            // An audience screen never closes by accident (Alt+F4 on the projector).
            WM_CLOSE => {
                CLOSE_ASKED.store(true, Ordering::SeqCst);
                0
            }
            // SAFETY: forwarding the message Windows gave us, unchanged.
            _ => unsafe { DefWindowProcW(hwnd, msg, w, l) },
        }
    }

    pub struct Window {
        hwnd: isize,
    }

    fn style(p: &Placement) -> u32 {
        if p.display.is_some() {
            WS_POPUP | WS_VISIBLE
        } else {
            WS_OVERLAPPEDWINDOW | WS_VISIBLE
        }
    }

    fn rect(p: &Placement) -> (i32, i32, i32, i32) {
        match p.display {
            Some((x, y, w, h)) => (x, y, w as i32, h as i32),
            None => (120, 120, 960, 540),
        }
    }

    impl Window {
        pub fn create(p: &Placement) -> Result<Self, String> {
            static REGISTER: Once = Once::new();
            let class = wide(CLASS);
            let title = wide(&p.title);
            let (x, y, w, h) = rect(p);
            // SAFETY: plain Win32 calls with valid, null-terminated strings and a
            // window procedure that lives for the whole program.
            unsafe {
                let instance = GetModuleHandleW(std::ptr::null());
                REGISTER.call_once(|| {
                    let wc = WNDCLASSEXW {
                        cbSize: std::mem::size_of::<WNDCLASSEXW>() as u32,
                        style: 0,
                        lpfnWndProc: Some(window_proc),
                        cbClsExtra: 0,
                        cbWndExtra: 0,
                        hInstance: instance,
                        hIcon: std::ptr::null_mut(),
                        hCursor: std::ptr::null_mut(),
                        hbrBackground: std::ptr::null_mut(),
                        lpszMenuName: std::ptr::null(),
                        lpszClassName: class.as_ptr(),
                        hIconSm: std::ptr::null_mut(),
                    };
                    RegisterClassExW(&wc);
                });
                let hwnd = CreateWindowExW(
                    // Never steals focus from the control window.
                    WS_EX_NOACTIVATE,
                    class.as_ptr(),
                    title.as_ptr(),
                    style(p),
                    x,
                    y,
                    w,
                    h,
                    std::ptr::null_mut(),
                    std::ptr::null_mut(),
                    instance,
                    std::ptr::null(),
                );
                if hwnd.is_null() {
                    return Err("Windows could not make the output window.".into());
                }
                ShowWindow(hwnd, SW_SHOWNOACTIVATE);
                Ok(Window {
                    hwnd: hwnd as isize,
                })
            }
        }

        pub fn hwnd(&self) -> isize {
            self.hwnd
        }

        pub fn client_size(&self) -> (u32, u32) {
            let mut r = RECT {
                left: 0,
                top: 0,
                right: 0,
                bottom: 0,
            };
            // SAFETY: our own window, a valid RECT to write into.
            unsafe {
                GetClientRect(self.hwnd as HWND, &mut r);
            }
            (
                (r.right - r.left).max(0) as u32,
                (r.bottom - r.top).max(0) as u32,
            )
        }

        pub fn place(&self, p: &Placement) {
            let (x, y, w, h) = rect(p);
            // SAFETY: our own window; style and position are plain values.
            unsafe {
                SetWindowLongPtrW(self.hwnd as HWND, GWL_STYLE, style(p) as isize);
                SetWindowPos(
                    self.hwnd as HWND,
                    HWND_TOP,
                    x,
                    y,
                    w,
                    h,
                    SWP_NOACTIVATE | SWP_SHOWWINDOW | SWP_FRAMECHANGED,
                );
            }
        }

        /// Handle waiting messages (this thread's windows). False once closing was asked.
        pub fn pump(&self) -> bool {
            // SAFETY: the standard message loop on the thread that made the window.
            unsafe {
                let mut msg: MSG = std::mem::zeroed();
                while PeekMessageW(&mut msg, std::ptr::null_mut(), 0, 0, PM_REMOVE) != 0 {
                    TranslateMessage(&msg);
                    DispatchMessageW(&msg);
                }
            }
            !CLOSE_ASKED.swap(false, Ordering::SeqCst)
        }
    }

    impl Drop for Window {
        fn drop(&mut self) {
            // SAFETY: our window; the surface on it was dropped first (NativeOutput's field order).
            unsafe {
                DestroyWindow(self.hwnd as HWND);
            }
        }
    }

    /// A wgpu surface on a window.
    pub fn surface(
        instance: &wgpu::Instance,
        hwnd: isize,
    ) -> Result<wgpu::Surface<'static>, String> {
        let handle =
            Win32WindowHandle::new(NonZeroIsize::new(hwnd).ok_or("No window to draw into.")?);
        // SAFETY: the window lives as long as the NativeOutput that holds this surface.
        unsafe {
            instance.create_surface_unsafe(wgpu::SurfaceTargetUnsafe::RawHandle {
                raw_display_handle: Some(RawDisplayHandle::Windows(WindowsDisplayHandle::new())),
                raw_window_handle: RawWindowHandle::Win32(handle),
            })
        }
        .map_err(|e| format!("The output window can't be drawn into: {e}"))
    }
}
