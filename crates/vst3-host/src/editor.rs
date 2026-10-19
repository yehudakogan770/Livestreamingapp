//! A plug-in's own window (Windows): its view is put in a window of the
//! helper process, which runs until the window is closed. What is changed in
//! it reaches the processor afterwards, so the saved state has it.
#![allow(unsafe_code)]

#[cfg(not(windows))]
use crate::plugin::Plugin;

/// Show the plug-in's own window until it is closed.
///
/// # Errors
/// It has no window of its own, or this isn't Windows.
#[cfg(not(windows))]
pub fn edit(_plugin: &mut Plugin, _title: &str) -> Result<(), String> {
    Err("A plug-in's own window opens in Lumora Studio for Windows. Here its settings are in Effect controls.".into())
}

#[cfg(windows)]
pub use win::edit;

#[cfg(windows)]
mod win {
    use std::sync::atomic::{AtomicPtr, Ordering};
    use std::sync::Arc;

    use windows_sys::Win32::Foundation::{HWND, LPARAM, LRESULT, RECT, WPARAM};
    use windows_sys::Win32::System::LibraryLoader::GetModuleHandleW;
    use windows_sys::Win32::System::Ole::OleInitialize;
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        AdjustWindowRectEx, CreateWindowExW, DefWindowProcW, DestroyWindow, DispatchMessageW,
        GetMessageW, GetSystemMetrics, LoadCursorW, PostQuitMessage, RegisterClassW,
        SetForegroundWindow, SetWindowPos, ShowWindow, TranslateMessage, HWND_NOTOPMOST,
        HWND_TOPMOST, IDC_ARROW, MSG, SM_CXSCREEN, SM_CYSCREEN, SWP_NOMOVE, SWP_NOSIZE,
        SWP_NOZORDER, SW_SHOW, WM_CLOSE, WM_DESTROY, WNDCLASSW, WS_CAPTION, WS_MINIMIZEBOX,
        WS_OVERLAPPED, WS_SYSMENU, WS_THICKFRAME,
    };

    use crate::com::{results, ComPtr, IEditControllerVtbl, IPlugViewVtbl, ViewRect, IPLUG_VIEW};
    use crate::objects;
    use crate::plugin::Plugin;

    fn wide(s: &str) -> Vec<u16> {
        s.encode_utf16().chain(std::iter::once(0)).collect()
    }

    unsafe extern "system" fn window_proc(
        hwnd: HWND,
        msg: u32,
        wparam: WPARAM,
        lparam: LPARAM,
    ) -> LRESULT {
        match msg {
            WM_CLOSE => {
                // SAFETY: our own window.
                unsafe { DestroyWindow(hwnd) };
                0
            }
            WM_DESTROY => {
                // SAFETY: ends this thread's message loop.
                unsafe { PostQuitMessage(0) };
                0
            }
            // SAFETY: everything else as Windows does it.
            _ => unsafe { DefWindowProcW(hwnd, msg, wparam, lparam) },
        }
    }

    const STYLE: u32 = WS_OVERLAPPED | WS_CAPTION | WS_SYSMENU | WS_MINIMIZEBOX;

    /// The window's outer size for a client area.
    fn outer(w: i32, h: i32, style: u32) -> (i32, i32) {
        let mut r = RECT {
            left: 0,
            top: 0,
            right: w,
            bottom: h,
        };
        // SAFETY: a RECT of ours.
        unsafe { AdjustWindowRectEx(&mut r, style, 0, 0) };
        (r.right - r.left, r.bottom - r.top)
    }

    pub fn edit(plugin: &mut Plugin, title: &str) -> Result<(), String> {
        let ctrl = plugin
            .controller()
            .ok_or("This plug-in has no settings window.")?
            .clone();
        // SAFETY: COM/OLE for this thread (plug-in windows may use drag and drop).
        unsafe { OleInitialize(std::ptr::null()) };
        // SAFETY: IEditController::createView("editor") hands over a view (one reference).
        let view = unsafe {
            ComPtr::from_raw((ctrl.vtbl::<IEditControllerVtbl>().create_view)(
                ctrl.as_ptr(),
                c"editor".as_ptr() as *const u8,
            ))
        }
        .ok_or("This plug-in has no window of its own: its settings are in Effect controls.")?;
        // A view always answers as IPlugView; make sure.
        let view = view.query(&IPLUG_VIEW).unwrap_or(view);
        // SAFETY: IPlugView's functions on the view the plug-in made.
        unsafe {
            let v = view.vtbl::<IPlugViewVtbl>();
            if (v.is_platform_type_supported)(view.as_ptr(), c"HWND".as_ptr() as *const u8)
                != results::OK
            {
                return Err("This plug-in's window can't be shown on Windows.".into());
            }
            let mut size = ViewRect::default();
            (v.get_size)(view.as_ptr(), &mut size);
            let w = (size.right - size.left).clamp(120, 4096);
            let h = (size.bottom - size.top).clamp(80, 4096);
            let resizable = (v.can_resize)(view.as_ptr()) == results::OK;
            let style = if resizable {
                STYLE | WS_THICKFRAME
            } else {
                STYLE
            };
            let instance = GetModuleHandleW(std::ptr::null());
            let class = wide("LumoraStudioPluginWindow");
            let wc = WNDCLASSW {
                lpfnWndProc: Some(window_proc),
                hInstance: instance,
                hCursor: LoadCursorW(std::ptr::null_mut(), IDC_ARROW),
                lpszClassName: class.as_ptr(),
                ..Default::default()
            };
            RegisterClassW(&wc);
            let (ow, oh) = outer(w, h, style);
            let x = ((GetSystemMetrics(SM_CXSCREEN) - ow) / 2).max(0);
            let y = ((GetSystemMetrics(SM_CYSCREEN) - oh) / 3).max(0);
            let name = wide(title);
            let hwnd = CreateWindowExW(
                0,
                class.as_ptr(),
                name.as_ptr(),
                style,
                x,
                y,
                ow,
                oh,
                std::ptr::null_mut(),
                std::ptr::null_mut(),
                instance,
                std::ptr::null(),
            );
            if hwnd.is_null() {
                return Err("The plug-in's window could not be made.".into());
            }
            // The plug-in can ask for another size through the frame.
            let shared = Arc::new(AtomicPtr::new(hwnd));
            let for_frame = Arc::clone(&shared);
            let frame = objects::new_frame(Box::new(move |cw, ch| {
                let (fw, fh) = outer(cw.clamp(120, 4096), ch.clamp(80, 4096), style);
                // SAFETY: our window (alive while the view is attached).
                SetWindowPos(
                    for_frame.load(Ordering::Acquire),
                    std::ptr::null_mut(),
                    0,
                    0,
                    fw,
                    fh,
                    SWP_NOMOVE | SWP_NOZORDER,
                );
            }));
            (v.set_frame)(view.as_ptr(), frame);
            if (v.attached)(
                view.as_ptr(),
                hwnd,
                c"HWND".as_ptr() as *const u8,
            ) != results::OK
            {
                (v.set_frame)(view.as_ptr(), std::ptr::null_mut());
                objects::release(frame);
                DestroyWindow(hwnd);
                return Err("The plug-in's window could not be opened.".into());
            }
            ShowWindow(hwnd, SW_SHOW);
            // In front of Lumora Studio (which waits for it), without staying above everything after.
            SetWindowPos(hwnd, HWND_TOPMOST, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE);
            SetWindowPos(hwnd, HWND_NOTOPMOST, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE);
            SetForegroundWindow(hwnd);
            let mut msg: MSG = std::mem::zeroed();
            while GetMessageW(&mut msg, std::ptr::null_mut(), 0, 0) > 0 {
                TranslateMessage(&msg);
                DispatchMessageW(&msg);
            }
            (v.removed)(view.as_ptr());
            (v.set_frame)(view.as_ptr(), std::ptr::null_mut());
            objects::release(frame);
            shared.store(std::ptr::null_mut(), Ordering::Release);
        }
        drop(view);
        // What was changed in the window reaches the processor (so its saved state has it).
        plugin.take_edits();
        plugin.apply(48_000.0)
    }
}
