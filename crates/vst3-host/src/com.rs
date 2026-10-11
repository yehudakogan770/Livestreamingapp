//! The VST3 binary interface: interface ids, result codes, the structures
//! passed across it and each interface's table of functions, written from
//! the VST 3 SDK's interface headers (pluginterfaces). Only what a host that
//! runs effects offline needs.
//!
//! VST3 is COM-like: every object starts with a pointer to its table of
//! functions, the first three being queryInterface, addRef and release.
//! On Windows the ids are laid out like COM GUIDs and the results are COM's
//! HRESULTs; elsewhere the ids are plain big-endian bytes.
#![allow(unsafe_code, non_snake_case, clippy::upper_case_acronyms)]

use std::ffi::c_void;

pub type TResult = i32;
pub type Tuid = [u8; 16];

#[cfg(windows)]
pub mod results {
    pub const OK: i32 = 0;
    pub const FALSE: i32 = 1;
    pub const NO_INTERFACE: i32 = 0x8000_4002_u32 as i32;
    pub const INVALID_ARGUMENT: i32 = 0x8007_0057_u32 as i32;
    pub const NOT_IMPLEMENTED: i32 = 0x8000_4001_u32 as i32;
}
#[cfg(not(windows))]
pub mod results {
    pub const OK: i32 = 0;
    pub const FALSE: i32 = 1;
    pub const NO_INTERFACE: i32 = -1;
    pub const INVALID_ARGUMENT: i32 = 2;
    pub const NOT_IMPLEMENTED: i32 = 3;
}

/// An interface id from its four 32-bit parts, laid out as the platform's plug-ins expect.
#[must_use]
pub const fn uid(l1: u32, l2: u32, l3: u32, l4: u32) -> Tuid {
    let a = l1.to_be_bytes();
    let b = l2.to_be_bytes();
    let c = l3.to_be_bytes();
    let d = l4.to_be_bytes();
    if cfg!(windows) {
        // COM GUID: Data1 and the two halves of l2 little-endian, the rest as is.
        [
            a[3], a[2], a[1], a[0], b[1], b[0], b[3], b[2], c[0], c[1], c[2], c[3], d[0], d[1],
            d[2], d[3],
        ]
    } else {
        [
            a[0], a[1], a[2], a[3], b[0], b[1], b[2], b[3], c[0], c[1], c[2], c[3], d[0], d[1],
            d[2], d[3],
        ]
    }
}

pub const FUNKNOWN: Tuid = uid(0x0000_0000, 0x0000_0000, 0xC000_0000, 0x0000_0046);
pub const IPLUGIN_BASE: Tuid = uid(0x2288_8DDB, 0x156E_45AE, 0x8358_B348, 0x0819_0625);
pub const IPLUGIN_FACTORY: Tuid = uid(0x7A4D_811C, 0x5211_4A1F, 0xAED9_D2EE, 0x0B43_BF9F);
pub const IPLUGIN_FACTORY2: Tuid = uid(0x0007_B650, 0xF24B_4C0B, 0xA464_EDB9, 0xF00B_2ABB);
pub const ICOMPONENT: Tuid = uid(0xE831_FF31, 0xF2D5_4301, 0x928E_BBEE, 0x2569_7802);
pub const IAUDIO_PROCESSOR: Tuid = uid(0x4204_3F99, 0xB7DA_453C, 0xA569_E79D, 0x9AAE_C33D);
pub const IEDIT_CONTROLLER: Tuid = uid(0xDCD7_BBE3, 0x7742_448D, 0xA874_AACC, 0x979C_759E);
pub const IHOST_APPLICATION: Tuid = uid(0x58E5_95CC, 0xDB2D_4969, 0x8B6A_AF8C, 0x36A6_64E5);
pub const ICOMPONENT_HANDLER: Tuid = uid(0x93A0_BEA3, 0x0BD0_45DB, 0x8E89_0B0C, 0xC1E4_6AC6);
pub const IBSTREAM: Tuid = uid(0xC3BF_6EA2, 0x3099_4752, 0x9B6B_F990, 0x1EE3_3E9B);
pub const IPARAMETER_CHANGES: Tuid = uid(0xA477_9663, 0x0BB6_4A56, 0xB443_84A8, 0x466F_EB9D);
pub const IPARAM_VALUE_QUEUE: Tuid = uid(0x0126_3A18, 0xED07_4F6F, 0x98C9_D356, 0x4686_F9BA);
pub const ICONNECTION_POINT: Tuid = uid(0x70A4_156F, 0x6E6E_4026, 0x9891_48BF, 0xAA60_D8D1);
pub const IMESSAGE: Tuid = uid(0x936F_033B, 0xC6C0_47DB, 0xBB08_82F8, 0x13C1_E613);
pub const IATTRIBUTE_LIST: Tuid = uid(0x1E5F_0AEB, 0xCC7F_4533, 0xA254_4011, 0x38AD_5EE4);

// ---- constants ----
pub const MEDIA_AUDIO: i32 = 0;
pub const DIR_INPUT: i32 = 0;
pub const DIR_OUTPUT: i32 = 1;
pub const BUS_MAIN: i32 = 0;
pub const IO_OFFLINE: i32 = 2;
pub const MODE_OFFLINE: i32 = 2;
pub const SAMPLE32: i32 = 0;
pub const SPEAKER_MONO: u64 = 1 << 19;
pub const SPEAKER_STEREO: u64 = 0b11;
pub const PARAM_IS_READ_ONLY: i32 = 1 << 1;
pub const PARAM_IS_HIDDEN: i32 = 1 << 4;
pub const PARAM_IS_BYPASS: i32 = 1 << 16;
pub const STREAM_SEEK_SET: i32 = 0;
pub const STREAM_SEEK_CUR: i32 = 1;
pub const STREAM_SEEK_END: i32 = 2;

// ---- structures (natural C layout: the SDK's headers align them as the compiler does on 64-bit) ----

#[repr(C)]
pub struct PFactoryInfo {
    pub vendor: [u8; 64],
    pub url: [u8; 256],
    pub email: [u8; 128],
    pub flags: i32,
}

#[repr(C)]
pub struct PClassInfo {
    pub cid: Tuid,
    pub cardinality: i32,
    pub category: [u8; 32],
    pub name: [u8; 64],
}

#[repr(C)]
pub struct PClassInfo2 {
    pub cid: Tuid,
    pub cardinality: i32,
    pub category: [u8; 32],
    pub name: [u8; 64],
    pub class_flags: u32,
    pub sub_categories: [u8; 128],
    pub vendor: [u8; 64],
    pub version: [u8; 64],
    pub sdk_version: [u8; 64],
}

#[repr(C)]
pub struct BusInfo {
    pub media_type: i32,
    pub direction: i32,
    pub channel_count: i32,
    pub name: [u16; 128],
    pub bus_type: i32,
    pub flags: u32,
}

#[repr(C)]
pub struct ProcessSetup {
    pub process_mode: i32,
    pub symbolic_sample_size: i32,
    pub max_samples_per_block: i32,
    pub sample_rate: f64,
}

#[repr(C)]
pub struct AudioBusBuffers {
    pub num_channels: i32,
    pub silence_flags: u64,
    pub channel_buffers32: *mut *mut f32,
}

#[repr(C)]
pub struct ProcessData {
    pub process_mode: i32,
    pub symbolic_sample_size: i32,
    pub num_samples: i32,
    pub num_inputs: i32,
    pub num_outputs: i32,
    pub inputs: *mut AudioBusBuffers,
    pub outputs: *mut AudioBusBuffers,
    pub input_parameter_changes: *mut c_void,
    pub output_parameter_changes: *mut c_void,
    pub input_events: *mut c_void,
    pub output_events: *mut c_void,
    pub process_context: *mut c_void,
}

#[repr(C)]
pub struct ParameterInfo {
    pub id: u32,
    pub title: [u16; 128],
    pub short_title: [u16; 128],
    pub units: [u16; 128],
    pub step_count: i32,
    pub default_normalized_value: f64,
    pub unit_id: i32,
    pub flags: i32,
}

// ---- tables of functions ----

pub type QueryInterface =
    unsafe extern "system" fn(*mut c_void, *const Tuid, *mut *mut c_void) -> TResult;
pub type AddRef = unsafe extern "system" fn(*mut c_void) -> u32;
pub type Release = unsafe extern "system" fn(*mut c_void) -> u32;

#[repr(C)]
pub struct FUnknownVtbl {
    pub query_interface: QueryInterface,
    pub add_ref: AddRef,
    pub release: Release,
}

#[repr(C)]
pub struct IPluginFactoryVtbl {
    pub base: FUnknownVtbl,
    pub get_factory_info: unsafe extern "system" fn(*mut c_void, *mut PFactoryInfo) -> TResult,
    pub count_classes: unsafe extern "system" fn(*mut c_void) -> i32,
    pub get_class_info: unsafe extern "system" fn(*mut c_void, i32, *mut PClassInfo) -> TResult,
    pub create_instance:
        unsafe extern "system" fn(*mut c_void, *const u8, *const u8, *mut *mut c_void) -> TResult,
}

#[repr(C)]
pub struct IPluginFactory2Vtbl {
    pub base: IPluginFactoryVtbl,
    pub get_class_info2: unsafe extern "system" fn(*mut c_void, i32, *mut PClassInfo2) -> TResult,
}

#[repr(C)]
pub struct IPluginBaseVtbl {
    pub base: FUnknownVtbl,
    pub initialize: unsafe extern "system" fn(*mut c_void, *mut c_void) -> TResult,
    pub terminate: unsafe extern "system" fn(*mut c_void) -> TResult,
}

#[repr(C)]
pub struct IComponentVtbl {
    pub base: IPluginBaseVtbl,
    pub get_controller_class_id: unsafe extern "system" fn(*mut c_void, *mut Tuid) -> TResult,
    pub set_io_mode: unsafe extern "system" fn(*mut c_void, i32) -> TResult,
    pub get_bus_count: unsafe extern "system" fn(*mut c_void, i32, i32) -> i32,
    pub get_bus_info:
        unsafe extern "system" fn(*mut c_void, i32, i32, i32, *mut BusInfo) -> TResult,
    pub get_routing_info:
        unsafe extern "system" fn(*mut c_void, *mut c_void, *mut c_void) -> TResult,
    pub activate_bus: unsafe extern "system" fn(*mut c_void, i32, i32, i32, u8) -> TResult,
    pub set_active: unsafe extern "system" fn(*mut c_void, u8) -> TResult,
    pub set_state: unsafe extern "system" fn(*mut c_void, *mut c_void) -> TResult,
    pub get_state: unsafe extern "system" fn(*mut c_void, *mut c_void) -> TResult,
}

#[repr(C)]
pub struct IAudioProcessorVtbl {
    pub base: FUnknownVtbl,
    pub set_bus_arrangements:
        unsafe extern "system" fn(*mut c_void, *mut u64, i32, *mut u64, i32) -> TResult,
    pub get_bus_arrangement: unsafe extern "system" fn(*mut c_void, i32, i32, *mut u64) -> TResult,
    pub can_process_sample_size: unsafe extern "system" fn(*mut c_void, i32) -> TResult,
    pub get_latency_samples: unsafe extern "system" fn(*mut c_void) -> u32,
    pub setup_processing: unsafe extern "system" fn(*mut c_void, *mut ProcessSetup) -> TResult,
    pub set_processing: unsafe extern "system" fn(*mut c_void, u8) -> TResult,
    pub process: unsafe extern "system" fn(*mut c_void, *mut ProcessData) -> TResult,
    pub get_tail_samples: unsafe extern "system" fn(*mut c_void) -> u32,
}

#[repr(C)]
pub struct IEditControllerVtbl {
    pub base: IPluginBaseVtbl,
    pub set_component_state: unsafe extern "system" fn(*mut c_void, *mut c_void) -> TResult,
    pub set_state: unsafe extern "system" fn(*mut c_void, *mut c_void) -> TResult,
    pub get_state: unsafe extern "system" fn(*mut c_void, *mut c_void) -> TResult,
    pub get_parameter_count: unsafe extern "system" fn(*mut c_void) -> i32,
    pub get_parameter_info:
        unsafe extern "system" fn(*mut c_void, i32, *mut ParameterInfo) -> TResult,
    pub get_param_string_by_value:
        unsafe extern "system" fn(*mut c_void, u32, f64, *mut [u16; 128]) -> TResult,
    pub get_param_value_by_string:
        unsafe extern "system" fn(*mut c_void, u32, *const u16, *mut f64) -> TResult,
    pub normalized_param_to_plain: unsafe extern "system" fn(*mut c_void, u32, f64) -> f64,
    pub plain_param_to_normalized: unsafe extern "system" fn(*mut c_void, u32, f64) -> f64,
    pub get_param_normalized: unsafe extern "system" fn(*mut c_void, u32) -> f64,
    pub set_param_normalized: unsafe extern "system" fn(*mut c_void, u32, f64) -> TResult,
    pub set_component_handler: unsafe extern "system" fn(*mut c_void, *mut c_void) -> TResult,
    pub create_view: unsafe extern "system" fn(*mut c_void, *const u8) -> *mut c_void,
}

#[repr(C)]
pub struct IConnectionPointVtbl {
    pub base: FUnknownVtbl,
    pub connect: unsafe extern "system" fn(*mut c_void, *mut c_void) -> TResult,
    pub disconnect: unsafe extern "system" fn(*mut c_void, *mut c_void) -> TResult,
    pub notify: unsafe extern "system" fn(*mut c_void, *mut c_void) -> TResult,
}

// Host-side interfaces (the host implements these; see objects.rs).

#[repr(C)]
pub struct IHostApplicationVtbl {
    pub base: FUnknownVtbl,
    pub get_name: unsafe extern "system" fn(*mut c_void, *mut [u16; 128]) -> TResult,
    pub create_instance: unsafe extern "system" fn(
        *mut c_void,
        *const Tuid,
        *const Tuid,
        *mut *mut c_void,
    ) -> TResult,
}

#[repr(C)]
pub struct IComponentHandlerVtbl {
    pub base: FUnknownVtbl,
    pub begin_edit: unsafe extern "system" fn(*mut c_void, u32) -> TResult,
    pub perform_edit: unsafe extern "system" fn(*mut c_void, u32, f64) -> TResult,
    pub end_edit: unsafe extern "system" fn(*mut c_void, u32) -> TResult,
    pub restart_component: unsafe extern "system" fn(*mut c_void, i32) -> TResult,
}

#[repr(C)]
pub struct IBStreamVtbl {
    pub base: FUnknownVtbl,
    pub read: unsafe extern "system" fn(*mut c_void, *mut c_void, i32, *mut i32) -> TResult,
    pub write: unsafe extern "system" fn(*mut c_void, *mut c_void, i32, *mut i32) -> TResult,
    pub seek: unsafe extern "system" fn(*mut c_void, i64, i32, *mut i64) -> TResult,
    pub tell: unsafe extern "system" fn(*mut c_void, *mut i64) -> TResult,
}

#[repr(C)]
pub struct IParamValueQueueVtbl {
    pub base: FUnknownVtbl,
    pub get_parameter_id: unsafe extern "system" fn(*mut c_void) -> u32,
    pub get_point_count: unsafe extern "system" fn(*mut c_void) -> i32,
    pub get_point: unsafe extern "system" fn(*mut c_void, i32, *mut i32, *mut f64) -> TResult,
    pub add_point: unsafe extern "system" fn(*mut c_void, i32, f64, *mut i32) -> TResult,
}

#[repr(C)]
pub struct IParameterChangesVtbl {
    pub base: FUnknownVtbl,
    pub get_parameter_count: unsafe extern "system" fn(*mut c_void) -> i32,
    pub get_parameter_data: unsafe extern "system" fn(*mut c_void, i32) -> *mut c_void,
    pub add_parameter_data:
        unsafe extern "system" fn(*mut c_void, *const u32, *mut i32) -> *mut c_void,
}

#[repr(C)]
pub struct IMessageVtbl {
    pub base: FUnknownVtbl,
    pub get_message_id: unsafe extern "system" fn(*mut c_void) -> *const u8,
    pub set_message_id: unsafe extern "system" fn(*mut c_void, *const u8),
    pub get_attributes: unsafe extern "system" fn(*mut c_void) -> *mut c_void,
}

#[repr(C)]
pub struct IAttributeListVtbl {
    pub base: FUnknownVtbl,
    pub set_int: unsafe extern "system" fn(*mut c_void, *const u8, i64) -> TResult,
    pub get_int: unsafe extern "system" fn(*mut c_void, *const u8, *mut i64) -> TResult,
    pub set_float: unsafe extern "system" fn(*mut c_void, *const u8, f64) -> TResult,
    pub get_float: unsafe extern "system" fn(*mut c_void, *const u8, *mut f64) -> TResult,
    pub set_string: unsafe extern "system" fn(*mut c_void, *const u8, *const u16) -> TResult,
    pub get_string: unsafe extern "system" fn(*mut c_void, *const u8, *mut u16, u32) -> TResult,
    pub set_binary:
        unsafe extern "system" fn(*mut c_void, *const u8, *const c_void, u32) -> TResult,
    pub get_binary:
        unsafe extern "system" fn(*mut c_void, *const u8, *mut *const c_void, *mut u32) -> TResult,
}

/// The first field of every interface object: its table of functions.
#[repr(C)]
pub struct Object<V> {
    pub vtbl: *const V,
}

/// A counted reference to an object the plug-in made (released when dropped).
pub struct ComPtr {
    ptr: *mut c_void,
}

impl ComPtr {
    /// Takes over one reference.
    ///
    /// # Safety
    /// `ptr` is null or a live interface pointer whose reference the caller owns.
    #[must_use]
    pub unsafe fn from_raw(ptr: *mut c_void) -> Option<Self> {
        (!ptr.is_null()).then_some(Self { ptr })
    }

    #[must_use]
    pub fn as_ptr(&self) -> *mut c_void {
        self.ptr
    }

    /// The object's table of functions, as the interface `V`.
    ///
    /// # Safety
    /// The object implements `V` (it was given out for `V`'s id).
    #[must_use]
    pub unsafe fn vtbl<V>(&self) -> &V {
        // SAFETY: every VST3 object starts with a pointer to its table; the caller says which.
        unsafe { &*(*(self.ptr as *const Object<V>)).vtbl }
    }

    /// Another of the object's interfaces.
    #[must_use]
    pub fn query(&self, iid: &Tuid) -> Option<Self> {
        let mut out: *mut c_void = std::ptr::null_mut();
        // SAFETY: queryInterface is the first function of every interface; it adds a reference on success.
        let r = unsafe { (self.vtbl::<FUnknownVtbl>().query_interface)(self.ptr, iid, &mut out) };
        if r == results::OK {
            // SAFETY: a successful queryInterface handed us a reference.
            unsafe { Self::from_raw(out) }
        } else {
            None
        }
    }
}

impl Clone for ComPtr {
    fn clone(&self) -> Self {
        // SAFETY: a live object; addRef adds the reference this clone owns.
        unsafe { (self.vtbl::<FUnknownVtbl>().add_ref)(self.ptr) };
        Self { ptr: self.ptr }
    }
}

impl Drop for ComPtr {
    fn drop(&mut self) {
        // SAFETY: we own one reference.
        unsafe { (self.vtbl::<FUnknownVtbl>().release)(self.ptr) };
    }
}

/// Text from a fixed C string field.
#[must_use]
pub fn c_text(bytes: &[u8]) -> String {
    let end = bytes.iter().position(|&b| b == 0).unwrap_or(bytes.len());
    String::from_utf8_lossy(&bytes[..end]).trim().to_owned()
}

/// Text from a UTF-16 string field.
#[must_use]
pub fn wide_text(chars: &[u16]) -> String {
    let end = chars.iter().position(|&c| c == 0).unwrap_or(chars.len());
    String::from_utf16_lossy(&chars[..end]).trim().to_owned()
}

/// A UTF-16 string field from text (cut to fit, ending with a zero).
#[must_use]
pub fn to_wide128(text: &str) -> [u16; 128] {
    let mut out = [0u16; 128];
    for (i, c) in text.encode_utf16().take(127).enumerate() {
        out[i] = c;
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ids_are_laid_out_for_the_platform() {
        let id = uid(0x0102_0304, 0x0506_0708, 0x090A_0B0C, 0x0D0E_0F10);
        if cfg!(windows) {
            assert_eq!(id, [4, 3, 2, 1, 6, 5, 8, 7, 9, 10, 11, 12, 13, 14, 15, 16]);
        } else {
            assert_eq!(id, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]);
        }
        assert_ne!(ICOMPONENT, IAUDIO_PROCESSOR);
    }

    #[test]
    fn structures_match_the_sdk_layout() {
        // Natural alignment (falignpush.h: 16-byte packing on 64-bit, so nothing is squeezed).
        assert_eq!(std::mem::size_of::<ProcessSetup>(), 24);
        assert_eq!(std::mem::offset_of!(ProcessSetup, sample_rate), 16);
        assert_eq!(std::mem::size_of::<AudioBusBuffers>(), 24);
        assert_eq!(std::mem::offset_of!(ProcessData, inputs), 24);
        assert_eq!(std::mem::size_of::<ProcessData>(), 80);
        assert_eq!(
            std::mem::offset_of!(ParameterInfo, default_normalized_value),
            776
        );
        assert_eq!(std::mem::size_of::<ParameterInfo>(), 792);
        assert_eq!(std::mem::size_of::<BusInfo>(), 12 + 256 + 8);
        assert_eq!(std::mem::size_of::<PClassInfo>(), 116);
        assert_eq!(std::mem::size_of::<PFactoryInfo>(), 452);
    }

    #[test]
    fn text_fields() {
        assert_eq!(c_text(b"Reverb\0junk"), "Reverb");
        let w = to_wide128("Gain");
        assert_eq!(wide_text(&w), "Gain");
    }
}
