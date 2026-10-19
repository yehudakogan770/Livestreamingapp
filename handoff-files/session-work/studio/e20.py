root='/home/user/Livestreamingapp/.claude/worktrees/agent-a53b9f061dc9b1bdf/'
def edit(p, pairs):
    s=open(root+p).read()
    for a,b in pairs:
        assert a in s, (p, a[:70])
        s=s.replace(a,b,1)
    open(root+p,'w').write(s)

edit('crates/vst3-host/src/com.rs', [
("""pub const IATTRIBUTE_LIST: Tuid = uid(0x1E5F_0AEB, 0xCC7F_4533, 0xA254_4011, 0x38AD_5EE4);""","""pub const IATTRIBUTE_LIST: Tuid = uid(0x1E5F_0AEB, 0xCC7F_4533, 0xA254_4011, 0x38AD_5EE4);
pub const IPLUG_VIEW: Tuid = uid(0x5BC3_2507, 0xD060_49EA, 0xA615_1B52, 0x2B75_5B29);
pub const IPLUG_FRAME: Tuid = uid(0x367F_AF01, 0xAFA9_4693, 0x8D4D_A2A0, 0xED08_82A3);"""),
("""/// The first field of every interface object: its table of functions.""","""/// A plug-in window's size and place (pixels).
#[repr(C)]
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct ViewRect {
    pub left: i32,
    pub top: i32,
    pub right: i32,
    pub bottom: i32,
}

#[repr(C)]
pub struct IPlugViewVtbl {
    pub base: FUnknownVtbl,
    pub is_platform_type_supported: unsafe extern "system" fn(*mut c_void, *const u8) -> TResult,
    pub attached: unsafe extern "system" fn(*mut c_void, *mut c_void, *const u8) -> TResult,
    pub removed: unsafe extern "system" fn(*mut c_void) -> TResult,
    pub on_wheel: unsafe extern "system" fn(*mut c_void, f32) -> TResult,
    pub on_key_down: unsafe extern "system" fn(*mut c_void, u16, i16, i16) -> TResult,
    pub on_key_up: unsafe extern "system" fn(*mut c_void, u16, i16, i16) -> TResult,
    pub get_size: unsafe extern "system" fn(*mut c_void, *mut ViewRect) -> TResult,
    pub on_size: unsafe extern "system" fn(*mut c_void, *mut ViewRect) -> TResult,
    pub on_focus: unsafe extern "system" fn(*mut c_void, u8) -> TResult,
    pub set_frame: unsafe extern "system" fn(*mut c_void, *mut c_void) -> TResult,
    pub can_resize: unsafe extern "system" fn(*mut c_void) -> TResult,
    pub check_size_constraint: unsafe extern "system" fn(*mut c_void, *mut ViewRect) -> TResult,
}

#[repr(C)]
pub struct IPlugFrameVtbl {
    pub base: FUnknownVtbl,
    pub resize_view: unsafe extern "system" fn(*mut c_void, *mut c_void, *mut ViewRect) -> TResult,
}

/// The first field of every interface object: its table of functions."""),
])

edit('crates/vst3-host/src/objects.rs', [
("""use crate::com::{
    results, to_wide128, FUnknownVtbl, IAttributeListVtbl, IBStreamVtbl, IComponentHandlerVtbl,""","""use crate::com::{
    results, to_wide128, FUnknownVtbl, IAttributeListVtbl, IBStreamVtbl, IComponentHandlerVtbl, IPlugFrameVtbl, IPlugViewVtbl, ViewRect, IPLUG_FRAME,"""),
("""// ---------------------------------------------------------------------------
// A stream in memory""","""// ---------------------------------------------------------------------------
// The frame around a plug-in's own window: it asks to be resized through it.

/// Makes the window around a plug-in view a new size (client width and height).
pub type Resize = Box<dyn Fn(i32, i32)>;
type Frame = Obj<IPlugFrameVtbl, Resize>;

unsafe extern "system" fn frame_resize(this: *mut c_void, view: *mut c_void, rect: *mut ViewRect) -> TResult {
    if view.is_null() || rect.is_null() {
        return results::INVALID_ARGUMENT;
    }
    // SAFETY: a live frame of ours; the plug-in gives its view and a rectangle.
    let (me, r) = unsafe { (Frame::get(this), *rect) };
    (me.data)(r.right - r.left, r.bottom - r.top);
    // SAFETY: the view's onSize, as the SDK asks hosts to call after resizing.
    unsafe {
        let mut done = r;
        ((**(view as *const *const IPlugViewVtbl)).on_size)(view, &mut done);
    }
    results::OK
}

static FRAME_VTBL: IPlugFrameVtbl = IPlugFrameVtbl { base: Frame::UNKNOWN, resize_view: frame_resize };

/// A frame for a plug-in view (`resize` makes the window around it bigger or smaller).
#[must_use]
pub fn new_frame(resize: Resize) -> *mut c_void {
    Frame::make(&FRAME_VTBL, &IPLUG_FRAME, resize)
}

// ---------------------------------------------------------------------------
// A stream in memory"""),
])

edit('crates/vst3-host/src/plugin.rs', [
("""    /// Set a parameter (0–1): the controller now, the processor with the next block.""","""    /// The controller (for the plug-in's own window).
    #[must_use]
    pub fn controller(&self) -> Option<&ComPtr> {
        self.controller.as_ref()
    }

    /// The values the plug-in's own window changed, given to the processor (each parameter's last).
    pub fn take_edits(&mut self) {
        let edits: Vec<(u32, f64)> = self.edits.lock().map(|mut e| std::mem::take(&mut *e)).unwrap_or_default();
        for (id, v) in edits {
            self.pending.retain(|(x, _)| *x != id);
            self.pending.push((id, v.clamp(0.0, 1.0)));
        }
    }

    /// Set a parameter (0–1): the controller now, the processor with the next block."""),
])
