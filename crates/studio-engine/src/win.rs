//! Windows: the native picture lives in a child window of the editor's main
//! window, placed exactly over the program monitor's picture. It takes no
//! clicks or keys (they belong to the page under it).
#![allow(unsafe_code)]

use std::num::NonZeroIsize;
use std::sync::Once;

use raw_window_handle::{
    RawDisplayHandle, RawWindowHandle, Win32WindowHandle, WindowsDisplayHandle,
};
use windows_sys::Win32::Foundation::{HWND, LPARAM, LRESULT, WPARAM};
use windows_sys::Win32::System::LibraryLoader::GetModuleHandleW;
use windows_sys::Win32::UI::WindowsAndMessaging::{
    CreateWindowExW, DefWindowProcW, DestroyWindow, RegisterClassExW, SetWindowPos, HTTRANSPARENT,
    SWP_HIDEWINDOW, SWP_NOACTIVATE, SWP_SHOWWINDOW, WM_ERASEBKGND, WM_NCHITTEST, WNDCLASSEXW,
    WS_CHILD, WS_CLIPSIBLINGS, WS_DISABLED, WS_EX_NOACTIVATE, WS_EX_NOPARENTNOTIFY,
};

const CLASS: &str = "LumoraNativeViewer";

fn wide(s: &str) -> Vec<u16> {
    s.encode_utf16().chain(std::iter::once(0)).collect()
}

unsafe extern "system" fn window_proc(hwnd: HWND, msg: u32, w: WPARAM, l: LPARAM) -> LRESULT {
    match msg {
        // Clicks fall through to what is under it.
        WM_NCHITTEST => HTTRANSPARENT as LRESULT,
        // The GPU paints every pixel: no flash of background.
        WM_ERASEBKGND => 1,
        _ => unsafe { DefWindowProcW(hwnd, msg, w, l) },
    }
}

/// The child window. Make, move and drop it on the thread that runs the main window's messages.
pub struct ChildWindow {
    hwnd: isize,
}

impl ChildWindow {
    /// A hidden child of `parent` (the main window's `HWND`).
    ///
    /// # Errors
    /// Windows refused to make it.
    pub fn create(parent: isize) -> Result<Self, String> {
        static REGISTER: Once = Once::new();
        let class = wide(CLASS);
        // SAFETY: plain Win32 calls with valid, null-terminated strings and a window procedure that lives forever.
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
                WS_EX_NOPARENTNOTIFY | WS_EX_NOACTIVATE,
                class.as_ptr(),
                std::ptr::null(),
                WS_CHILD | WS_CLIPSIBLINGS | WS_DISABLED,
                0,
                0,
                16,
                16,
                parent as HWND,
                std::ptr::null_mut(),
                instance,
                std::ptr::null(),
            );
            if hwnd.is_null() {
                return Err("Windows could not make the native viewer's window.".into());
            }
            Ok(Self {
                hwnd: hwnd as isize,
            })
        }
    }

    pub fn hwnd(&self) -> isize {
        self.hwnd
    }

    /// Place it (pixels in the main window's client area), on top of the page, shown or hidden.
    pub fn place(&self, x: i32, y: i32, w: i32, h: i32, visible: bool) {
        place_hwnd(self.hwnd, x, y, w, h, visible);
    }
}

/// Place a viewer window by its handle (on the main window's thread).
pub fn place_hwnd(hwnd: isize, x: i32, y: i32, w: i32, h: i32, visible: bool) {
    let flags = SWP_NOACTIVATE
        | if visible {
            SWP_SHOWWINDOW
        } else {
            SWP_HIDEWINDOW
        };
    // SAFETY: a window this module made (destroyed only after the engine stops); HWND_TOP is the null handle.
    unsafe {
        SetWindowPos(
            hwnd as HWND,
            std::ptr::null_mut(),
            x,
            y,
            w.max(1),
            h.max(1),
            flags,
        );
    }
}

impl Drop for ChildWindow {
    fn drop(&mut self) {
        // SAFETY: the window is ours; the engine drawing into it has been stopped first.
        unsafe {
            DestroyWindow(self.hwnd as HWND);
        }
    }
}

/// A wgpu surface on a window.
///
/// # Errors
/// The window can't be drawn into.
pub fn surface(instance: &wgpu::Instance, hwnd: isize) -> Result<wgpu::Surface<'static>, String> {
    let handle = Win32WindowHandle::new(NonZeroIsize::new(hwnd).ok_or("No window to draw into.")?);
    // SAFETY: the caller keeps the window alive until the engine (and so the surface) is gone.
    unsafe {
        instance.create_surface_unsafe(wgpu::SurfaceTargetUnsafe::RawHandle {
            raw_display_handle: Some(RawDisplayHandle::Windows(WindowsDisplayHandle::new())),
            raw_window_handle: RawWindowHandle::Win32(handle),
        })
    }
    .map_err(|e| format!("The native viewer's window can't be drawn into: {e}"))
}
