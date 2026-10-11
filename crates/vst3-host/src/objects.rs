//! The objects the host hands to plug-ins: the host application (its name,
//! and messages for plug-ins whose two halves talk to each other), the
//! component handler (told when a parameter is changed), a memory stream for
//! saving and restoring state, and the parameter changes given with each
//! block of sound.
//!
//! Each is a heap object starting with its table of functions and a
//! reference count; plug-ins hold references with addRef/release, and the
//! object is freed when the last one goes.
#![allow(unsafe_code)]

use std::collections::HashMap;
use std::ffi::{c_void, CStr, CString};
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::{Arc, Mutex};

use crate::com::{
    results, to_wide128, FUnknownVtbl, IAttributeListVtbl, IBStreamVtbl, IComponentHandlerVtbl,
    IHostApplicationVtbl, IMessageVtbl, IParamValueQueueVtbl, IParameterChangesVtbl, TResult, Tuid,
    FUNKNOWN, IATTRIBUTE_LIST, IBSTREAM, ICOMPONENT_HANDLER, IHOST_APPLICATION, IMESSAGE,
    IPARAMETER_CHANGES, IPARAM_VALUE_QUEUE, STREAM_SEEK_CUR, STREAM_SEEK_END, STREAM_SEEK_SET,
};

/// A host object: its table of functions, its reference count and its data.
#[repr(C)]
struct Obj<V: 'static, D> {
    vtbl: &'static V,
    refs: AtomicU32,
    iid: &'static Tuid,
    data: D,
}

impl<V: 'static, D> Obj<V, D> {
    /// A new object with one reference (the caller's).
    fn make(vtbl: &'static V, iid: &'static Tuid, data: D) -> *mut c_void {
        Box::into_raw(Box::new(Self {
            vtbl,
            refs: AtomicU32::new(1),
            iid,
            data,
        })) as *mut c_void
    }

    /// # Safety
    /// `this` is one of these objects, alive.
    unsafe fn get<'a>(this: *mut c_void) -> &'a Self {
        // SAFETY: the caller says it is ours and alive.
        unsafe { &*(this as *const Self) }
    }

    /// # Safety
    /// `this` is one of these objects, alive, and not used elsewhere at the same time.
    unsafe fn get_mut<'a>(this: *mut c_void) -> &'a mut Self {
        // SAFETY: as above; plug-ins call one object from one thread at a time.
        unsafe { &mut *(this as *mut Self) }
    }

    unsafe extern "system" fn query_interface(
        this: *mut c_void,
        iid: *const Tuid,
        out: *mut *mut c_void,
    ) -> TResult {
        if out.is_null() || iid.is_null() {
            return results::INVALID_ARGUMENT;
        }
        // SAFETY: the plug-in gives a live object of ours and a 16-byte id.
        let (me, want) = unsafe { (Self::get(this), &*iid) };
        if want == &FUNKNOWN || want == me.iid {
            me.refs.fetch_add(1, Ordering::AcqRel);
            // SAFETY: `out` was checked.
            unsafe { *out = this };
            results::OK
        } else {
            // SAFETY: `out` was checked.
            unsafe { *out = std::ptr::null_mut() };
            results::NO_INTERFACE
        }
    }

    unsafe extern "system" fn add_ref(this: *mut c_void) -> u32 {
        // SAFETY: a live object of ours.
        unsafe { Self::get(this) }
            .refs
            .fetch_add(1, Ordering::AcqRel)
            + 1
    }

    unsafe extern "system" fn release(this: *mut c_void) -> u32 {
        // SAFETY: a live object of ours.
        let left = unsafe { Self::get(this) }
            .refs
            .fetch_sub(1, Ordering::AcqRel)
            - 1;
        if left == 0 {
            // SAFETY: the last reference: the box made in `make` is freed.
            drop(unsafe { Box::from_raw(this as *mut Self) });
        }
        left
    }

    const UNKNOWN: FUnknownVtbl = FUnknownVtbl {
        query_interface: Self::query_interface,
        add_ref: Self::add_ref,
        release: Self::release,
    };
}

/// Release one reference to a host object made here.
///
/// # Safety
/// `ptr` is an object made by this module that the caller holds a reference to.
pub unsafe fn release(ptr: *mut c_void) {
    // SAFETY: every object here starts with a table whose third function is release.
    unsafe { ((**(ptr as *const *const FUnknownVtbl)).release)(ptr) };
}

// ---------------------------------------------------------------------------
// The host application.

type HostApp = Obj<IHostApplicationVtbl, ()>;

unsafe extern "system" fn host_get_name(_this: *mut c_void, name: *mut [u16; 128]) -> TResult {
    if name.is_null() {
        return results::INVALID_ARGUMENT;
    }
    // SAFETY: the plug-in gives a String128 to fill.
    unsafe { *name = to_wide128("Lumora Studio") };
    results::OK
}

unsafe extern "system" fn host_create_instance(
    _this: *mut c_void,
    cid: *const Tuid,
    iid: *const Tuid,
    out: *mut *mut c_void,
) -> TResult {
    if out.is_null() || cid.is_null() || iid.is_null() {
        return results::INVALID_ARGUMENT;
    }
    // SAFETY: two 16-byte ids and a place for the object, from the plug-in.
    let (cid, iid) = unsafe { (&*cid, &*iid) };
    let made = if cid == &IMESSAGE && iid == &IMESSAGE {
        new_message()
    } else if cid == &IATTRIBUTE_LIST && iid == &IATTRIBUTE_LIST {
        new_attributes()
    } else {
        std::ptr::null_mut()
    };
    // SAFETY: `out` was checked.
    unsafe { *out = made };
    if made.is_null() {
        results::NO_INTERFACE
    } else {
        results::OK
    }
}

static HOST_VTBL: IHostApplicationVtbl = IHostApplicationVtbl {
    base: HostApp::UNKNOWN,
    get_name: host_get_name,
    create_instance: host_create_instance,
};

/// The host application object given to `initialize`.
#[must_use]
pub fn new_host() -> *mut c_void {
    HostApp::make(&HOST_VTBL, &IHOST_APPLICATION, ())
}

// ---------------------------------------------------------------------------
// The component handler: what the plug-in changes itself, kept for the host.

/// Parameter values a plug-in set itself (from its own window), by id.
pub type Edits = Arc<Mutex<Vec<(u32, f64)>>>;
type Handler = Obj<IComponentHandlerVtbl, Edits>;

unsafe extern "system" fn handler_begin(_this: *mut c_void, _id: u32) -> TResult {
    results::OK
}
unsafe extern "system" fn handler_perform(this: *mut c_void, id: u32, value: f64) -> TResult {
    // SAFETY: a live handler of ours.
    let me = unsafe { Handler::get(this) };
    if let Ok(mut e) = me.data.lock() {
        e.push((id, value));
    }
    results::OK
}
unsafe extern "system" fn handler_end(_this: *mut c_void, _id: u32) -> TResult {
    results::OK
}
unsafe extern "system" fn handler_restart(_this: *mut c_void, _flags: i32) -> TResult {
    results::OK
}

static HANDLER_VTBL: IComponentHandlerVtbl = IComponentHandlerVtbl {
    base: Handler::UNKNOWN,
    begin_edit: handler_begin,
    perform_edit: handler_perform,
    end_edit: handler_end,
    restart_component: handler_restart,
};

#[must_use]
pub fn new_handler(edits: Edits) -> *mut c_void {
    Handler::make(&HANDLER_VTBL, &ICOMPONENT_HANDLER, edits)
}

// ---------------------------------------------------------------------------
// A stream in memory (states are saved into one and restored from one).

struct Mem {
    bytes: Vec<u8>,
    pos: usize,
}
type Stream = Obj<IBStreamVtbl, Mem>;

unsafe extern "system" fn stream_read(
    this: *mut c_void,
    buffer: *mut c_void,
    n: i32,
    read: *mut i32,
) -> TResult {
    // SAFETY: a live stream of ours.
    let me = unsafe { Stream::get_mut(this) };
    let want = usize::try_from(n).unwrap_or(0);
    let got = want.min(me.data.bytes.len().saturating_sub(me.data.pos));
    if got > 0 && !buffer.is_null() {
        // SAFETY: the plug-in's buffer holds `n` bytes; we copy at most that many.
        unsafe {
            std::ptr::copy_nonoverlapping(
                me.data.bytes.as_ptr().add(me.data.pos),
                buffer as *mut u8,
                got,
            )
        };
    }
    me.data.pos += got;
    if !read.is_null() {
        // SAFETY: checked.
        unsafe { *read = got as i32 };
    }
    results::OK
}

unsafe extern "system" fn stream_write(
    this: *mut c_void,
    buffer: *mut c_void,
    n: i32,
    written: *mut i32,
) -> TResult {
    // SAFETY: a live stream of ours.
    let me = unsafe { Stream::get_mut(this) };
    let n = usize::try_from(n).unwrap_or(0);
    if n > 0 && !buffer.is_null() {
        let end = me.data.pos + n;
        if me.data.bytes.len() < end {
            me.data.bytes.resize(end, 0);
        }
        // SAFETY: the plug-in's buffer holds `n` bytes.
        unsafe {
            std::ptr::copy_nonoverlapping(
                buffer as *const u8,
                me.data.bytes.as_mut_ptr().add(me.data.pos),
                n,
            )
        };
        me.data.pos = end;
    }
    if !written.is_null() {
        // SAFETY: checked.
        unsafe { *written = n as i32 };
    }
    results::OK
}

unsafe extern "system" fn stream_seek(
    this: *mut c_void,
    pos: i64,
    mode: i32,
    result: *mut i64,
) -> TResult {
    // SAFETY: a live stream of ours.
    let me = unsafe { Stream::get_mut(this) };
    let base = match mode {
        STREAM_SEEK_SET => 0,
        STREAM_SEEK_CUR => me.data.pos as i64,
        STREAM_SEEK_END => me.data.bytes.len() as i64,
        _ => return results::INVALID_ARGUMENT,
    };
    let to = base.saturating_add(pos);
    if to < 0 {
        return results::INVALID_ARGUMENT;
    }
    me.data.pos = to as usize;
    if !result.is_null() {
        // SAFETY: checked.
        unsafe { *result = to };
    }
    results::OK
}

unsafe extern "system" fn stream_tell(this: *mut c_void, pos: *mut i64) -> TResult {
    if pos.is_null() {
        return results::INVALID_ARGUMENT;
    }
    // SAFETY: a live stream of ours; `pos` checked.
    unsafe { *pos = Stream::get(this).data.pos as i64 };
    results::OK
}

static STREAM_VTBL: IBStreamVtbl = IBStreamVtbl {
    base: Stream::UNKNOWN,
    read: stream_read,
    write: stream_write,
    seek: stream_seek,
    tell: stream_tell,
};

/// A stream holding `bytes` (read from the start; writes go at the end).
#[must_use]
pub fn new_stream(bytes: Vec<u8>) -> *mut c_void {
    Stream::make(&STREAM_VTBL, &IBSTREAM, Mem { bytes, pos: 0 })
}

/// What a stream holds.
///
/// # Safety
/// `ptr` is a live stream made by `new_stream`.
#[must_use]
pub unsafe fn stream_bytes(ptr: *mut c_void) -> Vec<u8> {
    // SAFETY: the caller says it is a live stream of ours.
    unsafe { Stream::get(ptr) }.data.bytes.clone()
}

// ---------------------------------------------------------------------------
// Parameter changes for one block of sound.

type Queue = Obj<IParamValueQueueVtbl, (u32, Vec<(i32, f64)>)>;

unsafe extern "system" fn queue_id(this: *mut c_void) -> u32 {
    // SAFETY: a live queue of ours.
    unsafe { Queue::get(this) }.data.0
}
unsafe extern "system" fn queue_count(this: *mut c_void) -> i32 {
    // SAFETY: a live queue of ours.
    unsafe { Queue::get(this) }.data.1.len() as i32
}
unsafe extern "system" fn queue_get(
    this: *mut c_void,
    index: i32,
    offset: *mut i32,
    value: *mut f64,
) -> TResult {
    // SAFETY: a live queue of ours.
    let me = unsafe { Queue::get(this) };
    let Some(&(o, v)) = usize::try_from(index).ok().and_then(|i| me.data.1.get(i)) else {
        return results::INVALID_ARGUMENT;
    };
    if offset.is_null() || value.is_null() {
        return results::INVALID_ARGUMENT;
    }
    // SAFETY: checked.
    unsafe {
        *offset = o;
        *value = v;
    }
    results::OK
}
unsafe extern "system" fn queue_add(
    this: *mut c_void,
    offset: i32,
    value: f64,
    index: *mut i32,
) -> TResult {
    // SAFETY: a live queue of ours.
    let me = unsafe { Queue::get_mut(this) };
    me.data.1.push((offset, value));
    if !index.is_null() {
        // SAFETY: checked.
        unsafe { *index = me.data.1.len() as i32 - 1 };
    }
    results::OK
}

static QUEUE_VTBL: IParamValueQueueVtbl = IParamValueQueueVtbl {
    base: Queue::UNKNOWN,
    get_parameter_id: queue_id,
    get_point_count: queue_count,
    get_point: queue_get,
    add_point: queue_add,
};

/// The queues of one block (each a live queue object we own a reference to).
struct Queues(Vec<*mut c_void>);
impl Drop for Queues {
    fn drop(&mut self) {
        for q in self.0.drain(..) {
            // SAFETY: we own one reference to each queue.
            unsafe { release(q) };
        }
    }
}
type Changes = Obj<IParameterChangesVtbl, Queues>;

unsafe extern "system" fn changes_count(this: *mut c_void) -> i32 {
    // SAFETY: a live object of ours.
    unsafe { Changes::get(this) }.data.0.len() as i32
}
unsafe extern "system" fn changes_get(this: *mut c_void, index: i32) -> *mut c_void {
    // SAFETY: a live object of ours.
    let me = unsafe { Changes::get(this) };
    usize::try_from(index)
        .ok()
        .and_then(|i| me.data.0.get(i).copied())
        .unwrap_or(std::ptr::null_mut())
}
unsafe extern "system" fn changes_add(
    this: *mut c_void,
    id: *const u32,
    index: *mut i32,
) -> *mut c_void {
    if id.is_null() {
        return std::ptr::null_mut();
    }
    // SAFETY: a live object of ours; `id` checked.
    let (me, id) = unsafe { (Changes::get_mut(this), *id) };
    // SAFETY: each queue is a live queue of ours.
    let found = me
        .data
        .0
        .iter()
        .position(|&q| unsafe { Queue::get(q) }.data.0 == id);
    let i = found.unwrap_or_else(|| {
        me.data.0.push(Queue::make(
            &QUEUE_VTBL,
            &IPARAM_VALUE_QUEUE,
            (id, Vec::new()),
        ));
        me.data.0.len() - 1
    });
    if !index.is_null() {
        // SAFETY: checked.
        unsafe { *index = i as i32 };
    }
    me.data.0[i]
}

static CHANGES_VTBL: IParameterChangesVtbl = IParameterChangesVtbl {
    base: Changes::UNKNOWN,
    get_parameter_count: changes_count,
    get_parameter_data: changes_get,
    add_parameter_data: changes_add,
};

/// Parameter changes for a block: each (id, value) at the block's start.
#[must_use]
pub fn new_changes(values: &[(u32, f64)]) -> *mut c_void {
    let queues = values
        .iter()
        .map(|&(id, v)| Queue::make(&QUEUE_VTBL, &IPARAM_VALUE_QUEUE, (id, vec![(0, v)])))
        .collect();
    Changes::make(&CHANGES_VTBL, &IPARAMETER_CHANGES, Queues(queues))
}

// ---------------------------------------------------------------------------
// Messages between a plug-in's processor and its controller (made by the
// plug-in through the host application's createInstance).

enum Attr {
    Int(i64),
    Float(f64),
    Text(Vec<u16>),
    Bytes(Vec<u8>),
}
type Attributes = Obj<IAttributeListVtbl, HashMap<Vec<u8>, Attr>>;

/// # Safety
/// `id` is null or a zero-ended string.
unsafe fn attr_key(id: *const u8) -> Option<Vec<u8>> {
    // SAFETY: as the caller says.
    (!id.is_null()).then(|| {
        unsafe { CStr::from_ptr(id as *const std::ffi::c_char) }
            .to_bytes()
            .to_vec()
    })
}

macro_rules! set_attr {
    ($name:ident, $t:ty, $make:expr) => {
        unsafe extern "system" fn $name(this: *mut c_void, id: *const u8, v: $t) -> TResult {
            // SAFETY: a live list of ours; the key is a C string from the plug-in.
            let (me, key) = unsafe { (Attributes::get_mut(this), attr_key(id)) };
            let Some(key) = key else {
                return results::INVALID_ARGUMENT;
            };
            me.data.insert(key, $make(v));
            results::OK
        }
    };
}
set_attr!(attr_set_int, i64, Attr::Int);
set_attr!(attr_set_float, f64, Attr::Float);

unsafe extern "system" fn attr_get_int(this: *mut c_void, id: *const u8, out: *mut i64) -> TResult {
    // SAFETY: a live list of ours; the key is a C string from the plug-in.
    let (me, key) = unsafe { (Attributes::get(this), attr_key(id)) };
    match key.and_then(|k| me.data.get(&k)) {
        Some(Attr::Int(v)) if !out.is_null() => {
            // SAFETY: checked.
            unsafe { *out = *v };
            results::OK
        }
        _ => results::FALSE,
    }
}
unsafe extern "system" fn attr_get_float(
    this: *mut c_void,
    id: *const u8,
    out: *mut f64,
) -> TResult {
    // SAFETY: a live list of ours; the key is a C string from the plug-in.
    let (me, key) = unsafe { (Attributes::get(this), attr_key(id)) };
    match key.and_then(|k| me.data.get(&k)) {
        Some(Attr::Float(v)) if !out.is_null() => {
            // SAFETY: checked.
            unsafe { *out = *v };
            results::OK
        }
        _ => results::FALSE,
    }
}
unsafe extern "system" fn attr_set_string(
    this: *mut c_void,
    id: *const u8,
    s: *const u16,
) -> TResult {
    // SAFETY: a live list of ours; the key is a C string from the plug-in.
    let (me, key) = unsafe { (Attributes::get_mut(this), attr_key(id)) };
    let Some(key) = key else {
        return results::INVALID_ARGUMENT;
    };
    let mut text = Vec::new();
    if !s.is_null() {
        let mut i = 0;
        // SAFETY: a zero-ended UTF-16 string from the plug-in.
        while unsafe { *s.add(i) } != 0 && i < 1 << 20 {
            text.push(unsafe { *s.add(i) });
            i += 1;
        }
    }
    me.data.insert(key, Attr::Text(text));
    results::OK
}
unsafe extern "system" fn attr_get_string(
    this: *mut c_void,
    id: *const u8,
    out: *mut u16,
    size: u32,
) -> TResult {
    // SAFETY: a live list of ours; the key is a C string from the plug-in.
    let (me, key) = unsafe { (Attributes::get(this), attr_key(id)) };
    match key.and_then(|k| me.data.get(&k)) {
        Some(Attr::Text(t)) if !out.is_null() && size > 0 => {
            // `size` is in bytes.
            let room = (size as usize / 2).saturating_sub(1);
            let n = t.len().min(room);
            // SAFETY: the plug-in's buffer holds `size` bytes; we write n + 1 chars.
            unsafe {
                std::ptr::copy_nonoverlapping(t.as_ptr(), out, n);
                *out.add(n) = 0;
            }
            results::OK
        }
        _ => results::FALSE,
    }
}
unsafe extern "system" fn attr_set_binary(
    this: *mut c_void,
    id: *const u8,
    data: *const c_void,
    size: u32,
) -> TResult {
    // SAFETY: a live list of ours; the key is a C string from the plug-in.
    let (me, key) = unsafe { (Attributes::get_mut(this), attr_key(id)) };
    let Some(key) = key else {
        return results::INVALID_ARGUMENT;
    };
    let bytes = if data.is_null() {
        Vec::new()
    } else {
        // SAFETY: the plug-in's data holds `size` bytes.
        unsafe { std::slice::from_raw_parts(data as *const u8, size as usize) }.to_vec()
    };
    me.data.insert(key, Attr::Bytes(bytes));
    results::OK
}
unsafe extern "system" fn attr_get_binary(
    this: *mut c_void,
    id: *const u8,
    data: *mut *const c_void,
    size: *mut u32,
) -> TResult {
    // SAFETY: a live list of ours; the key is a C string from the plug-in.
    let (me, key) = unsafe { (Attributes::get(this), attr_key(id)) };
    match key.and_then(|k| me.data.get(&k)) {
        Some(Attr::Bytes(b)) if !data.is_null() && !size.is_null() => {
            // SAFETY: checked; the bytes live as long as the list.
            unsafe {
                *data = b.as_ptr() as *const c_void;
                *size = b.len() as u32;
            }
            results::OK
        }
        _ => results::FALSE,
    }
}

static ATTR_VTBL: IAttributeListVtbl = IAttributeListVtbl {
    base: Attributes::UNKNOWN,
    set_int: attr_set_int,
    get_int: attr_get_int,
    set_float: attr_set_float,
    get_float: attr_get_float,
    set_string: attr_set_string,
    get_string: attr_get_string,
    set_binary: attr_set_binary,
    get_binary: attr_get_binary,
};

fn new_attributes() -> *mut c_void {
    Attributes::make(&ATTR_VTBL, &IATTRIBUTE_LIST, HashMap::new())
}

struct MessageData {
    id: CString,
    attributes: *mut c_void,
}
impl Drop for MessageData {
    fn drop(&mut self) {
        // SAFETY: the message owns one reference to its list.
        unsafe { release(self.attributes) };
    }
}
type Message = Obj<IMessageVtbl, MessageData>;

unsafe extern "system" fn message_id(this: *mut c_void) -> *const u8 {
    // SAFETY: a live message of ours.
    unsafe { Message::get(this) }.data.id.as_ptr() as *const u8
}
unsafe extern "system" fn message_set_id(this: *mut c_void, id: *const u8) {
    // SAFETY: a live message of ours; the id is a C string from the plug-in.
    let (me, key) = unsafe { (Message::get_mut(this), attr_key(id)) };
    me.data.id = CString::new(key.unwrap_or_default()).unwrap_or_default();
}
unsafe extern "system" fn message_attributes(this: *mut c_void) -> *mut c_void {
    // SAFETY: a live message of ours (the list is borrowed: no new reference, as the SDK says).
    unsafe { Message::get(this) }.data.attributes
}

static MESSAGE_VTBL: IMessageVtbl = IMessageVtbl {
    base: Message::UNKNOWN,
    get_message_id: message_id,
    set_message_id: message_set_id,
    get_attributes: message_attributes,
};

fn new_message() -> *mut c_void {
    Message::make(
        &MESSAGE_VTBL,
        &IMESSAGE,
        MessageData {
            id: CString::default(),
            attributes: new_attributes(),
        },
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::com::ComPtr;

    #[test]
    fn a_stream_reads_back_what_was_written_and_seeks() {
        let s = new_stream(Vec::new());
        // SAFETY: our own live stream, used as an IBStream.
        unsafe {
            let v = &STREAM_VTBL;
            let mut n = 0;
            let mut data = *b"hello";
            (v.write)(s, data.as_mut_ptr() as *mut c_void, 5, &mut n);
            assert_eq!(n, 5);
            let mut pos = 0;
            (v.tell)(s, &mut pos);
            assert_eq!(pos, 5);
            (v.seek)(s, 1, STREAM_SEEK_SET, std::ptr::null_mut());
            let mut buf = [0u8; 8];
            (v.read)(s, buf.as_mut_ptr() as *mut c_void, 8, &mut n);
            assert_eq!(&buf[..n as usize], b"ello");
            assert_eq!(stream_bytes(s), b"hello");
            assert_eq!(
                (v.seek)(s, -10, STREAM_SEEK_CUR, std::ptr::null_mut()),
                results::INVALID_ARGUMENT
            );
            release(s);
        }
    }

    #[test]
    fn parameter_changes_give_each_value_at_the_start() {
        let c = new_changes(&[(7, 0.25), (9, 1.0)]);
        // SAFETY: our own live objects.
        unsafe {
            let v = &CHANGES_VTBL;
            assert_eq!((v.get_parameter_count)(c), 2);
            let q = (v.get_parameter_data)(c, 1);
            assert_eq!(queue_id(q), 9);
            let (mut o, mut x) = (5, 0.0);
            assert_eq!(queue_get(q, 0, &mut o, &mut x), results::OK);
            assert_eq!((o, x), (0, 1.0));
            assert!((v.get_parameter_data)(c, 2).is_null());
            // A plug-in adding to output changes gets a queue for that id.
            let mut i = -1;
            let added = (v.add_parameter_data)(c, &7, &mut i);
            assert_eq!(i, 0);
            assert_eq!(added, (v.get_parameter_data)(c, 0));
            release(c);
        }
    }

    #[test]
    fn plug_ins_can_make_messages_and_the_reference_counts_hold() {
        let host = new_host();
        // SAFETY: our own live objects, used as a plug-in would.
        unsafe {
            let mut msg: *mut c_void = std::ptr::null_mut();
            assert_eq!(
                host_create_instance(host, &IMESSAGE, &IMESSAGE, &mut msg),
                results::OK
            );
            let m = ComPtr::from_raw(msg).unwrap();
            let mv = m.vtbl::<IMessageVtbl>();
            (mv.set_message_id)(m.as_ptr(), c"levels".as_ptr() as *const u8);
            assert_eq!(
                CStr::from_ptr((mv.get_message_id)(m.as_ptr()) as *const std::ffi::c_char)
                    .to_bytes(),
                b"levels"
            );
            let attrs = (mv.get_attributes)(m.as_ptr());
            assert_eq!(
                attr_set_int(attrs, c"n".as_ptr() as *const u8, 42),
                results::OK
            );
            let mut n = 0;
            assert_eq!(
                attr_get_int(attrs, c"n".as_ptr() as *const u8, &mut n),
                results::OK
            );
            assert_eq!(n, 42);
            let blob = [1u8, 2, 3];
            attr_set_binary(
                attrs,
                c"b".as_ptr() as *const u8,
                blob.as_ptr() as *const c_void,
                3,
            );
            let (mut p, mut size): (*const c_void, u32) = (std::ptr::null(), 0);
            attr_get_binary(attrs, c"b".as_ptr() as *const u8, &mut p, &mut size);
            assert_eq!(
                std::slice::from_raw_parts(p as *const u8, size as usize),
                &blob
            );
            // Asked as FUnknown, then dropped: counts stay balanced (no crash at the end).
            let again = m.query(&FUNKNOWN).unwrap();
            drop(again);
            drop(m);
            let mut nothing: *mut c_void = std::ptr::null_mut();
            assert_eq!(
                host_create_instance(host, &IBSTREAM, &IBSTREAM, &mut nothing),
                results::NO_INTERFACE
            );
            assert!(nothing.is_null());
            let mut name = [0u16; 128];
            host_get_name(host, &mut name);
            assert_eq!(crate::com::wide_text(&name), "Lumora Studio");
            release(host);
        }
    }
}
