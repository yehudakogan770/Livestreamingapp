//! A VST3 effect written in Rust, for testing the host without a plug-in
//! file: "Test Gain", a processor (IComponent, IAudioProcessor and
//! IConnectionPoint in one object, as SDK effects are) and a separate
//! controller (IEditController and IConnectionPoint), made by a factory.
//! One parameter (gain, 0–1 meaning ×0–×2), a 3-sample delay, its state the
//! gain as 8 bytes; the processor greets the controller with a message the
//! host makes, as real plug-ins do.
#![allow(unsafe_code, clippy::not_unsafe_ptr_arg_deref)]

use std::ffi::c_void;
use std::mem::offset_of;
use std::sync::atomic::{AtomicU32, Ordering};

use crate::com::*;

pub const PROCESSOR_CID: Tuid = uid(0x1111_2222, 0x3333_4444, 0x5555_6666, 0x7777_8888);
pub const CONTROLLER_CID: Tuid = uid(0x9999_AAAA, 0xBBBB_CCCC, 0xDDDD_EEEE, 0xFFFF_0000);
pub const GAIN: u32 = 7;
pub const DELAY: usize = 3;

fn write_name<const N: usize>(dst: &mut [u8; N], s: &str) {
    for (i, b) in s.bytes().take(N - 1).enumerate() {
        dst[i] = b;
    }
}

// ---------------------------------------------------------------------------
// The factory.

#[repr(C)]
struct Factory {
    vtbl: *const IPluginFactoryVtbl,
    refs: AtomicU32,
}

unsafe extern "system" fn f_query(
    this: *mut c_void,
    iid: *const Tuid,
    out: *mut *mut c_void,
) -> TResult {
    let want = unsafe { &*iid };
    if want == &FUNKNOWN || want == &IPLUGIN_FACTORY {
        unsafe { f_add(this) };
        unsafe { *out = this };
        results::OK
    } else {
        unsafe { *out = std::ptr::null_mut() };
        results::NO_INTERFACE
    }
}
unsafe extern "system" fn f_add(this: *mut c_void) -> u32 {
    unsafe { &*(this as *const Factory) }
        .refs
        .fetch_add(1, Ordering::AcqRel)
        + 1
}
unsafe extern "system" fn f_release(this: *mut c_void) -> u32 {
    let left = unsafe { &*(this as *const Factory) }
        .refs
        .fetch_sub(1, Ordering::AcqRel)
        - 1;
    if left == 0 {
        drop(unsafe { Box::from_raw(this as *mut Factory) });
    }
    left
}
unsafe extern "system" fn f_info(_this: *mut c_void, info: *mut PFactoryInfo) -> TResult {
    let info = unsafe { &mut *info };
    write_name(&mut info.vendor, "Lumora Tests");
    results::OK
}
unsafe extern "system" fn f_count(_this: *mut c_void) -> i32 {
    2
}
unsafe extern "system" fn f_class(_this: *mut c_void, i: i32, info: *mut PClassInfo) -> TResult {
    let info = unsafe { &mut *info };
    match i {
        0 => {
            info.cid = PROCESSOR_CID;
            write_name(&mut info.category, "Audio Module Class");
            write_name(&mut info.name, "Test Gain");
        }
        1 => {
            info.cid = CONTROLLER_CID;
            write_name(&mut info.category, "Component Controller Class");
            write_name(&mut info.name, "Test Gain Controller");
        }
        _ => return results::INVALID_ARGUMENT,
    }
    info.cardinality = 0x7FFF_FFFF;
    results::OK
}
unsafe extern "system" fn f_create(
    _this: *mut c_void,
    cid: *const u8,
    iid: *const u8,
    out: *mut *mut c_void,
) -> TResult {
    let cid = unsafe { &*(cid as *const Tuid) };
    let iid = unsafe { &*(iid as *const Tuid) };
    let obj = if cid == &PROCESSOR_CID {
        new_processor()
    } else if cid == &CONTROLLER_CID {
        new_controller()
    } else {
        return results::FALSE;
    };
    // Hand out the asked interface, then drop the making reference.
    let r = unsafe { ((**(obj as *const *const FUnknownVtbl)).query_interface)(obj, iid, out) };
    unsafe { ((**(obj as *const *const FUnknownVtbl)).release)(obj) };
    r
}

static FACTORY: IPluginFactoryVtbl = IPluginFactoryVtbl {
    base: FUnknownVtbl {
        query_interface: f_query,
        add_ref: f_add,
        release: f_release,
    },
    get_factory_info: f_info,
    count_classes: f_count,
    get_class_info: f_class,
    create_instance: f_create,
};

/// The factory, as `GetPluginFactory` would give it (one reference, the caller's).
pub fn factory() -> ComPtr {
    let f = Box::into_raw(Box::new(Factory {
        vtbl: &FACTORY,
        refs: AtomicU32::new(1),
    }));
    unsafe { ComPtr::from_raw(f as *mut c_void) }.expect("made")
}

// ---------------------------------------------------------------------------
// The processor.

#[repr(C)]
struct Processor {
    comp: *const IComponentVtbl,
    proc_: *const IAudioProcessorVtbl,
    conn: *const IConnectionPointVtbl,
    refs: AtomicU32,
    gain: f64,
    host: *mut c_void,
    peer: *mut c_void,
    active: bool,
    delay: [[f32; DELAY]; 2],
}

macro_rules! base_of {
    ($this:expr, $t:ty, $field:ident) => {
        unsafe { &mut *(($this as *mut u8).sub(offset_of!($t, $field)) as *mut $t) }
    };
}

fn p_iface(p: *mut Processor, iid: &Tuid) -> *mut c_void {
    let base = p as *mut u8;
    if iid == &FUNKNOWN || iid == &ICOMPONENT || iid == &IPLUGIN_BASE {
        base as *mut c_void
    } else if iid == &IAUDIO_PROCESSOR {
        unsafe { base.add(offset_of!(Processor, proc_)) as *mut c_void }
    } else if iid == &ICONNECTION_POINT {
        unsafe { base.add(offset_of!(Processor, conn)) as *mut c_void }
    } else {
        std::ptr::null_mut()
    }
}
fn p_query(p: &mut Processor, iid: *const Tuid, out: *mut *mut c_void) -> TResult {
    let ptr = p_iface(p, unsafe { &*iid });
    unsafe { *out = ptr };
    if ptr.is_null() {
        return results::NO_INTERFACE;
    }
    p.refs.fetch_add(1, Ordering::AcqRel);
    results::OK
}
fn p_release(p: &mut Processor) -> u32 {
    let left = p.refs.fetch_sub(1, Ordering::AcqRel) - 1;
    if left == 0 {
        drop(unsafe { Box::from_raw(p as *mut Processor) });
    }
    left
}

// IComponent (this = the object)
unsafe extern "system" fn pc_query(
    this: *mut c_void,
    iid: *const Tuid,
    out: *mut *mut c_void,
) -> TResult {
    p_query(base_of!(this, Processor, comp), iid, out)
}
unsafe extern "system" fn pc_add(this: *mut c_void) -> u32 {
    base_of!(this, Processor, comp)
        .refs
        .fetch_add(1, Ordering::AcqRel)
        + 1
}
unsafe extern "system" fn pc_release(this: *mut c_void) -> u32 {
    p_release(base_of!(this, Processor, comp))
}
unsafe extern "system" fn pc_init(this: *mut c_void, ctx: *mut c_void) -> TResult {
    let p = base_of!(this, Processor, comp);
    if ctx.is_null() {
        return results::INVALID_ARGUMENT;
    }
    // Keep the host (a reference of our own).
    unsafe { ((**(ctx as *const *const FUnknownVtbl)).add_ref)(ctx) };
    p.host = ctx;
    results::OK
}
unsafe extern "system" fn pc_term(this: *mut c_void) -> TResult {
    let p = base_of!(this, Processor, comp);
    if !p.host.is_null() {
        unsafe { ((**(p.host as *const *const FUnknownVtbl)).release)(p.host) };
        p.host = std::ptr::null_mut();
    }
    results::OK
}
unsafe extern "system" fn pc_ctrl(_this: *mut c_void, id: *mut Tuid) -> TResult {
    unsafe { *id = CONTROLLER_CID };
    results::OK
}
unsafe extern "system" fn pc_io(_this: *mut c_void, _m: i32) -> TResult {
    results::OK
}
unsafe extern "system" fn pc_bus_count(_this: *mut c_void, media: i32, _dir: i32) -> i32 {
    i32::from(media == MEDIA_AUDIO)
}
unsafe extern "system" fn pc_bus_info(
    _this: *mut c_void,
    media: i32,
    dir: i32,
    index: i32,
    info: *mut BusInfo,
) -> TResult {
    if media != MEDIA_AUDIO || index != 0 {
        return results::INVALID_ARGUMENT;
    }
    let info = unsafe { &mut *info };
    info.media_type = media;
    info.direction = dir;
    info.channel_count = 2;
    info.name = to_wide128("Main");
    info.bus_type = BUS_MAIN;
    info.flags = 1;
    results::OK
}
unsafe extern "system" fn pc_routing(
    _this: *mut c_void,
    _a: *mut c_void,
    _b: *mut c_void,
) -> TResult {
    results::NOT_IMPLEMENTED
}
unsafe extern "system" fn pc_activate_bus(
    _this: *mut c_void,
    _m: i32,
    _d: i32,
    _i: i32,
    _s: u8,
) -> TResult {
    results::OK
}
unsafe extern "system" fn pc_active(this: *mut c_void, on: u8) -> TResult {
    let p = base_of!(this, Processor, comp);
    p.active = on != 0;
    p.delay = [[0.0; DELAY]; 2];
    results::OK
}
unsafe extern "system" fn pc_set_state(this: *mut c_void, s: *mut c_void) -> TResult {
    let p = base_of!(this, Processor, comp);
    let mut b = [0u8; 8];
    let mut n = 0;
    let v = unsafe { &**(s as *const *const IBStreamVtbl) };
    unsafe { (v.read)(s, b.as_mut_ptr() as *mut c_void, 8, &mut n) };
    if n != 8 {
        return results::FALSE;
    }
    p.gain = f64::from_le_bytes(b);
    results::OK
}
unsafe extern "system" fn pc_get_state(this: *mut c_void, s: *mut c_void) -> TResult {
    let p = base_of!(this, Processor, comp);
    let mut b = p.gain.to_le_bytes();
    let v = unsafe { &**(s as *const *const IBStreamVtbl) };
    unsafe { (v.write)(s, b.as_mut_ptr() as *mut c_void, 8, std::ptr::null_mut()) };
    results::OK
}

static P_COMP: IComponentVtbl = IComponentVtbl {
    base: IPluginBaseVtbl {
        base: FUnknownVtbl {
            query_interface: pc_query,
            add_ref: pc_add,
            release: pc_release,
        },
        initialize: pc_init,
        terminate: pc_term,
    },
    get_controller_class_id: pc_ctrl,
    set_io_mode: pc_io,
    get_bus_count: pc_bus_count,
    get_bus_info: pc_bus_info,
    get_routing_info: pc_routing,
    activate_bus: pc_activate_bus,
    set_active: pc_active,
    set_state: pc_set_state,
    get_state: pc_get_state,
};

// IAudioProcessor (this = object + offset)
unsafe extern "system" fn pp_query(
    this: *mut c_void,
    iid: *const Tuid,
    out: *mut *mut c_void,
) -> TResult {
    p_query(base_of!(this, Processor, proc_), iid, out)
}
unsafe extern "system" fn pp_add(this: *mut c_void) -> u32 {
    base_of!(this, Processor, proc_)
        .refs
        .fetch_add(1, Ordering::AcqRel)
        + 1
}
unsafe extern "system" fn pp_release(this: *mut c_void) -> u32 {
    p_release(base_of!(this, Processor, proc_))
}
unsafe extern "system" fn pp_arr(
    _this: *mut c_void,
    i: *mut u64,
    ni: i32,
    o: *mut u64,
    no: i32,
) -> TResult {
    let ok = ni == 1 && no == 1 && unsafe { *i == SPEAKER_STEREO && *o == SPEAKER_STEREO };
    if ok {
        results::OK
    } else {
        results::FALSE
    }
}
unsafe extern "system" fn pp_get_arr(_this: *mut c_void, _d: i32, _i: i32, a: *mut u64) -> TResult {
    unsafe { *a = SPEAKER_STEREO };
    results::OK
}
unsafe extern "system" fn pp_can(_this: *mut c_void, size: i32) -> TResult {
    if size == SAMPLE32 {
        results::OK
    } else {
        results::FALSE
    }
}
unsafe extern "system" fn pp_latency(_this: *mut c_void) -> u32 {
    DELAY as u32
}
unsafe extern "system" fn pp_setup(_this: *mut c_void, s: *mut ProcessSetup) -> TResult {
    let s = unsafe { &*s };
    let block = s.max_samples_per_block;
    let rate = s.sample_rate;
    if block > 0 && rate > 0.0 {
        results::OK
    } else {
        results::INVALID_ARGUMENT
    }
}
unsafe extern "system" fn pp_processing(_this: *mut c_void, _on: u8) -> TResult {
    results::NOT_IMPLEMENTED
}
unsafe extern "system" fn pp_process(this: *mut c_void, data: *mut ProcessData) -> TResult {
    let p = base_of!(this, Processor, proc_);
    if !p.active {
        return results::FALSE;
    }
    let d = unsafe { &mut *data };
    // Parameter changes: the last point of the gain's queue.
    let changes = d.input_parameter_changes;
    if !changes.is_null() {
        let cv = unsafe { &**(changes as *const *const IParameterChangesVtbl) };
        for i in 0..unsafe { (cv.get_parameter_count)(changes) } {
            let q = unsafe { (cv.get_parameter_data)(changes, i) };
            let qv = unsafe { &**(q as *const *const IParamValueQueueVtbl) };
            if unsafe { (qv.get_parameter_id)(q) } == GAIN {
                let n = unsafe { (qv.get_point_count)(q) };
                let (mut o, mut v) = (0, 0.0);
                if n > 0 && unsafe { (qv.get_point)(q, n - 1, &mut o, &mut v) } == results::OK {
                    p.gain = v;
                }
            }
        }
    }
    let n = d.num_samples as usize;
    if d.num_inputs < 1 || d.num_outputs < 1 {
        return results::OK;
    }
    let inb = unsafe { &*d.inputs };
    let outb = unsafe { &*d.outputs };
    let k = (p.gain * 2.0) as f32;
    for c in 0..2 {
        let ip = unsafe { *inb.channel_buffers32.add(c) };
        let op = unsafe { *outb.channel_buffers32.add(c) };
        for i in 0..n {
            let x = unsafe { *ip.add(i) };
            let line = &mut p.delay[c];
            let y = line[0];
            line.rotate_left(1);
            line[DELAY - 1] = x;
            unsafe { *op.add(i) = y * k };
        }
    }
    results::OK
}
unsafe extern "system" fn pp_tail(_this: *mut c_void) -> u32 {
    0
}

static P_PROC: IAudioProcessorVtbl = IAudioProcessorVtbl {
    base: FUnknownVtbl {
        query_interface: pp_query,
        add_ref: pp_add,
        release: pp_release,
    },
    set_bus_arrangements: pp_arr,
    get_bus_arrangement: pp_get_arr,
    can_process_sample_size: pp_can,
    get_latency_samples: pp_latency,
    setup_processing: pp_setup,
    set_processing: pp_processing,
    process: pp_process,
    get_tail_samples: pp_tail,
};

// IConnectionPoint (processor)
unsafe extern "system" fn pk_query(
    this: *mut c_void,
    iid: *const Tuid,
    out: *mut *mut c_void,
) -> TResult {
    p_query(base_of!(this, Processor, conn), iid, out)
}
unsafe extern "system" fn pk_add(this: *mut c_void) -> u32 {
    base_of!(this, Processor, conn)
        .refs
        .fetch_add(1, Ordering::AcqRel)
        + 1
}
unsafe extern "system" fn pk_release(this: *mut c_void) -> u32 {
    p_release(base_of!(this, Processor, conn))
}
unsafe extern "system" fn pk_connect(this: *mut c_void, other: *mut c_void) -> TResult {
    let p = base_of!(this, Processor, conn);
    p.peer = other;
    // Greet the controller with a message made by the host, as SDK plug-ins do.
    if p.host.is_null() {
        return results::OK;
    }
    let hv = unsafe { &**(p.host as *const *const IHostApplicationVtbl) };
    let mut msg: *mut c_void = std::ptr::null_mut();
    if unsafe { (hv.create_instance)(p.host, &IMESSAGE, &IMESSAGE, &mut msg) } == results::OK {
        let mv = unsafe { &**(msg as *const *const IMessageVtbl) };
        unsafe { (mv.set_message_id)(msg, c"hello".as_ptr() as *const u8) };
        let attrs = unsafe { (mv.get_attributes)(msg) };
        let av = unsafe { &**(attrs as *const *const IAttributeListVtbl) };
        unsafe { (av.set_float)(attrs, c"gain".as_ptr() as *const u8, p.gain) };
        let ov = unsafe { &**(other as *const *const IConnectionPointVtbl) };
        unsafe { (ov.notify)(other, msg) };
        unsafe { (mv.base.release)(msg) };
    }
    results::OK
}
unsafe extern "system" fn pk_disconnect(this: *mut c_void, _other: *mut c_void) -> TResult {
    base_of!(this, Processor, conn).peer = std::ptr::null_mut();
    results::OK
}
unsafe extern "system" fn pk_notify(_this: *mut c_void, _m: *mut c_void) -> TResult {
    results::OK
}

static P_CONN: IConnectionPointVtbl = IConnectionPointVtbl {
    base: FUnknownVtbl {
        query_interface: pk_query,
        add_ref: pk_add,
        release: pk_release,
    },
    connect: pk_connect,
    disconnect: pk_disconnect,
    notify: pk_notify,
};

fn new_processor() -> *mut c_void {
    let p = Box::new(Processor {
        comp: &P_COMP,
        proc_: &P_PROC,
        conn: &P_CONN,
        refs: AtomicU32::new(1),
        gain: 0.5,
        host: std::ptr::null_mut(),
        peer: std::ptr::null_mut(),
        active: false,
        delay: [[0.0; DELAY]; 2],
    });
    Box::into_raw(p) as *mut c_void
}

// ---------------------------------------------------------------------------
// The controller.

#[repr(C)]
struct Controller {
    ctrl: *const IEditControllerVtbl,
    conn: *const IConnectionPointVtbl,
    refs: AtomicU32,
    gain: f64,
    handler: *mut c_void,
    greeted: f64,
}

fn c_iface(c: *mut Controller, iid: &Tuid) -> *mut c_void {
    let base = c as *mut u8;
    if iid == &FUNKNOWN || iid == &IEDIT_CONTROLLER || iid == &IPLUGIN_BASE {
        base as *mut c_void
    } else if iid == &ICONNECTION_POINT {
        unsafe { base.add(offset_of!(Controller, conn)) as *mut c_void }
    } else {
        std::ptr::null_mut()
    }
}
fn c_query(c: &mut Controller, iid: *const Tuid, out: *mut *mut c_void) -> TResult {
    let ptr = c_iface(c, unsafe { &*iid });
    unsafe { *out = ptr };
    if ptr.is_null() {
        return results::NO_INTERFACE;
    }
    c.refs.fetch_add(1, Ordering::AcqRel);
    results::OK
}
fn c_release(c: &mut Controller) -> u32 {
    let left = c.refs.fetch_sub(1, Ordering::AcqRel) - 1;
    if left == 0 {
        if !c.handler.is_null() {
            unsafe { ((**(c.handler as *const *const FUnknownVtbl)).release)(c.handler) };
        }
        drop(unsafe { Box::from_raw(c as *mut Controller) });
    }
    left
}

unsafe extern "system" fn cc_query(
    this: *mut c_void,
    iid: *const Tuid,
    out: *mut *mut c_void,
) -> TResult {
    c_query(base_of!(this, Controller, ctrl), iid, out)
}
unsafe extern "system" fn cc_add(this: *mut c_void) -> u32 {
    base_of!(this, Controller, ctrl)
        .refs
        .fetch_add(1, Ordering::AcqRel)
        + 1
}
unsafe extern "system" fn cc_release(this: *mut c_void) -> u32 {
    c_release(base_of!(this, Controller, ctrl))
}
unsafe extern "system" fn cc_init(_this: *mut c_void, ctx: *mut c_void) -> TResult {
    if ctx.is_null() {
        results::INVALID_ARGUMENT
    } else {
        results::OK
    }
}
unsafe extern "system" fn cc_term(_this: *mut c_void) -> TResult {
    results::OK
}
unsafe extern "system" fn cc_set_comp_state(this: *mut c_void, s: *mut c_void) -> TResult {
    let c = base_of!(this, Controller, ctrl);
    let mut b = [0u8; 8];
    let mut n = 0;
    let v = unsafe { &**(s as *const *const IBStreamVtbl) };
    unsafe { (v.read)(s, b.as_mut_ptr() as *mut c_void, 8, &mut n) };
    if n == 8 {
        c.gain = f64::from_le_bytes(b);
    }
    results::OK
}
unsafe extern "system" fn cc_set_state(_this: *mut c_void, _s: *mut c_void) -> TResult {
    results::OK
}
unsafe extern "system" fn cc_get_state(_this: *mut c_void, _s: *mut c_void) -> TResult {
    results::OK
}
unsafe extern "system" fn cc_count(_this: *mut c_void) -> i32 {
    2
}
unsafe extern "system" fn cc_info(_this: *mut c_void, i: i32, info: *mut ParameterInfo) -> TResult {
    let info = unsafe { &mut *info };
    match i {
        0 => {
            info.id = GAIN;
            info.title = to_wide128("Gain");
            info.units = to_wide128("dB");
            info.step_count = 0;
            info.default_normalized_value = 0.5;
            info.flags = 1;
        }
        1 => {
            // A hidden one: the host leaves it out.
            info.id = 99;
            info.title = to_wide128("Internal");
            info.flags = PARAM_IS_HIDDEN;
        }
        _ => return results::INVALID_ARGUMENT,
    }
    results::OK
}
unsafe extern "system" fn cc_string(
    _this: *mut c_void,
    id: u32,
    v: f64,
    out: *mut [u16; 128],
) -> TResult {
    if id != GAIN {
        return results::INVALID_ARGUMENT;
    }
    let db = if v <= 0.0 {
        f64::NEG_INFINITY
    } else {
        20.0 * (v * 2.0).log10()
    };
    unsafe {
        *out = to_wide128(&if db.is_finite() {
            format!("{db:.1} dB")
        } else {
            "-inf dB".into()
        })
    };
    results::OK
}
unsafe extern "system" fn cc_value(
    _this: *mut c_void,
    _id: u32,
    _s: *const u16,
    _v: *mut f64,
) -> TResult {
    results::NOT_IMPLEMENTED
}
unsafe extern "system" fn cc_to_plain(_this: *mut c_void, _id: u32, v: f64) -> f64 {
    v * 2.0
}
unsafe extern "system" fn cc_to_norm(_this: *mut c_void, _id: u32, v: f64) -> f64 {
    v / 2.0
}
unsafe extern "system" fn cc_get(this: *mut c_void, id: u32) -> f64 {
    let c = base_of!(this, Controller, ctrl);
    if id == GAIN {
        c.gain
    } else {
        0.0
    }
}
unsafe extern "system" fn cc_set(this: *mut c_void, id: u32, v: f64) -> TResult {
    let c = base_of!(this, Controller, ctrl);
    if id == GAIN {
        c.gain = v;
        results::OK
    } else {
        results::INVALID_ARGUMENT
    }
}
unsafe extern "system" fn cc_handler(this: *mut c_void, h: *mut c_void) -> TResult {
    let c = base_of!(this, Controller, ctrl);
    if !c.handler.is_null() {
        unsafe { ((**(c.handler as *const *const FUnknownVtbl)).release)(c.handler) };
    }
    if !h.is_null() {
        unsafe { ((**(h as *const *const FUnknownVtbl)).add_ref)(h) };
        // As a plug-in window would: tell the host a value changed.
        let hv = unsafe { &**(h as *const *const IComponentHandlerVtbl) };
        unsafe { (hv.perform_edit)(h, GAIN, c.gain) };
    }
    c.handler = h;
    results::OK
}
unsafe extern "system" fn cc_view(_this: *mut c_void, _name: *const u8) -> *mut c_void {
    std::ptr::null_mut()
}

static C_CTRL: IEditControllerVtbl = IEditControllerVtbl {
    base: IPluginBaseVtbl {
        base: FUnknownVtbl {
            query_interface: cc_query,
            add_ref: cc_add,
            release: cc_release,
        },
        initialize: cc_init,
        terminate: cc_term,
    },
    set_component_state: cc_set_comp_state,
    set_state: cc_set_state,
    get_state: cc_get_state,
    get_parameter_count: cc_count,
    get_parameter_info: cc_info,
    get_param_string_by_value: cc_string,
    get_param_value_by_string: cc_value,
    normalized_param_to_plain: cc_to_plain,
    plain_param_to_normalized: cc_to_norm,
    get_param_normalized: cc_get,
    set_param_normalized: cc_set,
    set_component_handler: cc_handler,
    create_view: cc_view,
};

unsafe extern "system" fn ck_query(
    this: *mut c_void,
    iid: *const Tuid,
    out: *mut *mut c_void,
) -> TResult {
    c_query(base_of!(this, Controller, conn), iid, out)
}
unsafe extern "system" fn ck_add(this: *mut c_void) -> u32 {
    base_of!(this, Controller, conn)
        .refs
        .fetch_add(1, Ordering::AcqRel)
        + 1
}
unsafe extern "system" fn ck_release(this: *mut c_void) -> u32 {
    c_release(base_of!(this, Controller, conn))
}
unsafe extern "system" fn ck_connect(_this: *mut c_void, _o: *mut c_void) -> TResult {
    results::OK
}
unsafe extern "system" fn ck_disconnect(_this: *mut c_void, _o: *mut c_void) -> TResult {
    results::OK
}
unsafe extern "system" fn ck_notify(this: *mut c_void, m: *mut c_void) -> TResult {
    let c = base_of!(this, Controller, conn);
    let mv = unsafe { &**(m as *const *const IMessageVtbl) };
    let attrs = unsafe { (mv.get_attributes)(m) };
    let av = unsafe { &**(attrs as *const *const IAttributeListVtbl) };
    let mut g = 0.0;
    if unsafe { (av.get_float)(attrs, c"gain".as_ptr() as *const u8, &mut g) } == results::OK {
        c.greeted = g;
    }
    results::OK
}

static C_CONN: IConnectionPointVtbl = IConnectionPointVtbl {
    base: FUnknownVtbl {
        query_interface: ck_query,
        add_ref: ck_add,
        release: ck_release,
    },
    connect: ck_connect,
    disconnect: ck_disconnect,
    notify: ck_notify,
};

fn new_controller() -> *mut c_void {
    let c = Box::new(Controller {
        ctrl: &C_CTRL,
        conn: &C_CONN,
        refs: AtomicU32::new(1),
        gain: 0.5,
        handler: std::ptr::null_mut(),
        greeted: -1.0,
    });
    Box::into_raw(c) as *mut c_void
}

#[cfg(test)]
mod tests {
    use std::path::Path;
    use std::rc::Rc;

    use super::*;
    use crate::module::{hex, Module};
    use crate::plugin::Plugin;

    fn module() -> Rc<Module> {
        Rc::new(Module::from_factory(Path::new("Test Gain.vst3"), factory()))
    }

    #[test]
    fn lists_its_effects() {
        let m = module();
        assert_eq!(m.vendor(), "Lumora Tests");
        let c = m.classes();
        assert_eq!(
            c.len(),
            1,
            "only the audio module, not the controller class"
        );
        assert_eq!(c[0].name, "Test Gain");
        assert_eq!(c[0].cid, hex(&PROCESSOR_CID));
    }

    #[test]
    fn opens_with_its_separate_controller_joined_and_lists_parameters() {
        let p = Plugin::open(module(), &PROCESSOR_CID).unwrap();
        let params = p.params();
        assert_eq!(params.len(), 1, "the hidden parameter is left out");
        assert_eq!(params[0].title, "Gain");
        assert_eq!(params[0].units, "dB");
        assert!((params[0].value - 0.5).abs() < 1e-9);
        assert_eq!(params[0].text, "0.0 dB");
        assert_eq!(p.channels(), (2, 2));
        // The plug-in told the host about a value through the handler.
        assert_eq!(p.edits.lock().unwrap().as_slice(), &[(GAIN, 0.5)]);
    }

    #[test]
    fn runs_sound_with_the_gain_set_and_its_delay_taken_out() {
        let mut p = Plugin::open(module(), &PROCESSOR_CID).unwrap();
        p.set(GAIN, 0.25); // ×0.5
        let input = vec![
            (0..3000)
                .map(|i| (i as f32 * 0.01).sin())
                .collect::<Vec<_>>(),
            vec![1.0; 3000],
        ];
        let mut last = 0.0;
        let out = p.run(&input, 48_000.0, &mut |d| last = d).unwrap();
        assert_eq!(out.len(), 2);
        assert_eq!(out[0].len(), 3000);
        assert!((last - 1.0).abs() < 1e-9);
        for i in [0, 1, 500, 2999] {
            assert!(
                (out[0][i] - input[0][i] * 0.5).abs() < 1e-6,
                "sample {i}: {} vs {}",
                out[0][i],
                input[0][i] * 0.5
            );
            assert!((out[1][i] - 0.5).abs() < 1e-6);
        }
    }

    #[test]
    fn state_saves_and_restores_through_both_halves() {
        let mut p = Plugin::open(module(), &PROCESSOR_CID).unwrap();
        p.set(GAIN, 0.9);
        p.apply(48_000.0).unwrap();
        let state = p.state();
        drop(p);
        let mut q = Plugin::open(module(), &PROCESSOR_CID).unwrap();
        assert!((q.params()[0].value - 0.5).abs() < 1e-9);
        q.restore(&state).unwrap();
        assert!(
            (q.params()[0].value - 0.9).abs() < 1e-9,
            "the controller follows the processor's state"
        );
        let out = q.run(&[vec![1.0; 100]], 48_000.0, &mut |_| {}).unwrap();
        assert_eq!(out.len(), 1, "mono in, mono out");
        assert!((out[0][50] - 1.8).abs() < 1e-6);
        assert!(q.restore(b"junk").is_err());
    }

    #[test]
    fn many_opens_and_closes_keep_counts_balanced() {
        let m = module();
        for _ in 0..50 {
            let mut p = Plugin::open(Rc::clone(&m), &PROCESSOR_CID).unwrap();
            p.set(GAIN, 0.3);
            p.apply(44_100.0).unwrap();
            let _ = p.state();
        }
        assert!(
            Plugin::open(m, &CONTROLLER_CID).is_err(),
            "a controller is not a sound processor"
        );
    }
}
