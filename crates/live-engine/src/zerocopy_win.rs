//! Zero-copy encoding on Windows (see [`crate::zerocopy`] for the why): the
//! engine's Direct3D 12 textures shared with a Direct3D 11 device on the same
//! graphics card, turned into NV12 by its video processor and encoded by the
//! vendor's Media Foundation hardware encoder (NVENC, Quick Sync, AMF).
//!
//! Two threads own the two sides:
//!
//! - the engine's thread ([`MfHandoff`]) holds the ring of shared D3D12
//!   textures (wrapped as wgpu textures) and the two shared fences: each
//!   frame it waits (on the GPU) until the ring's next texture is free,
//!   copies the picture into it and signals `drawn` after the copy;
//! - the encoder's thread ([`run`]) owns every D3D11 and Media Foundation
//!   object (COM objects stay on the thread that made them): it waits (on
//!   the GPU) for `drawn`, converts the texture to NV12, signals `free`, and
//!   feeds the NV12 texture to the encoder; the encoded stream goes to the
//!   feed's FFmpeg ([`Bitstream`]).
#![allow(unsafe_code)]

use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::mpsc::{channel, Receiver, Sender};
use std::sync::{Arc, Mutex, PoisonError};
use std::thread;
use std::time::{Duration, Instant};

use windows::core::{Interface, GUID, PWSTR};
use windows::Win32::Foundation::{CloseHandle, GENERIC_ALL, HANDLE, HMODULE, LUID, VARIANT_TRUE};
use windows::Win32::Graphics::Direct3D::{
    D3D_DRIVER_TYPE_UNKNOWN, D3D_FEATURE_LEVEL_11_0, D3D_FEATURE_LEVEL_11_1,
};
use windows::Win32::Graphics::Direct3D11::{
    D3D11CreateDevice, ID3D11Device, ID3D11Device1, ID3D11Device5, ID3D11DeviceContext,
    ID3D11DeviceContext4, ID3D11Fence, ID3D11Multithread, ID3D11Texture2D, ID3D11VideoContext,
    ID3D11VideoContext1, ID3D11VideoDevice, ID3D11VideoProcessor, ID3D11VideoProcessorEnumerator,
    ID3D11VideoProcessorInputView, ID3D11VideoProcessorOutputView, D3D11_BIND_RENDER_TARGET,
    D3D11_BIND_VIDEO_ENCODER, D3D11_CREATE_DEVICE_BGRA_SUPPORT, D3D11_CREATE_DEVICE_VIDEO_SUPPORT,
    D3D11_SDK_VERSION, D3D11_TEXTURE2D_DESC, D3D11_USAGE_DEFAULT,
    D3D11_VIDEO_FRAME_FORMAT_PROGRESSIVE, D3D11_VIDEO_PROCESSOR_COLOR_SPACE,
    D3D11_VIDEO_PROCESSOR_CONTENT_DESC, D3D11_VIDEO_PROCESSOR_FORMAT_SUPPORT_INPUT,
    D3D11_VIDEO_PROCESSOR_FORMAT_SUPPORT_OUTPUT, D3D11_VIDEO_PROCESSOR_INPUT_VIEW_DESC,
    D3D11_VIDEO_PROCESSOR_OUTPUT_VIEW_DESC, D3D11_VIDEO_PROCESSOR_STREAM,
    D3D11_VIDEO_USAGE_PLAYBACK_NORMAL, D3D11_VPIV_DIMENSION_TEXTURE2D,
    D3D11_VPOV_DIMENSION_TEXTURE2D,
};
use windows::Win32::Graphics::Direct3D12::{
    ID3D12Device, ID3D12Fence, ID3D12Resource, D3D12_FENCE_FLAG_SHARED, D3D12_HEAP_FLAG_SHARED,
    D3D12_HEAP_PROPERTIES, D3D12_HEAP_TYPE_DEFAULT, D3D12_RESOURCE_DESC,
    D3D12_RESOURCE_DIMENSION_TEXTURE2D, D3D12_RESOURCE_FLAG_ALLOW_RENDER_TARGET,
    D3D12_RESOURCE_FLAG_ALLOW_SIMULTANEOUS_ACCESS, D3D12_RESOURCE_STATE_COMMON,
    D3D12_TEXTURE_LAYOUT_UNKNOWN,
};
use windows::Win32::Graphics::Dxgi::Common::{
    DXGI_COLOR_SPACE_RGB_FULL_G22_NONE_P709, DXGI_COLOR_SPACE_YCBCR_STUDIO_G22_LEFT_P709,
    DXGI_FORMAT_NV12, DXGI_FORMAT_R8G8B8A8_UNORM, DXGI_RATIONAL, DXGI_SAMPLE_DESC,
};
use windows::Win32::Graphics::Dxgi::{CreateDXGIFactory1, IDXGIAdapter1, IDXGIFactory4};
use windows::Win32::Media::MediaFoundation::{
    eAVEncCommonRateControlMode_CBR, eAVEncCommonRateControlMode_Quality, eAVEncH264VProfile_High,
    eAVEncH265VProfile_Main_420_8, CODECAPI_AVEncCommonBufferSize, CODECAPI_AVEncCommonMaxBitRate,
    CODECAPI_AVEncCommonMeanBitRate, CODECAPI_AVEncCommonQuality,
    CODECAPI_AVEncCommonQualityVsSpeed, CODECAPI_AVEncCommonRateControlMode,
    CODECAPI_AVEncMPVDefaultBPictureCount, CODECAPI_AVEncMPVGOPSize, CODECAPI_AVLowLatencyMode,
    ICodecAPI, IMF2DBuffer, IMFActivate, IMFDXGIDeviceManager, IMFMediaEventGenerator,
    IMFMediaType, IMFSample, IMFShutdown, IMFTransform, METransformDrainComplete,
    METransformHaveOutput, METransformNeedInput, MFCreateDXGIDeviceManager,
    MFCreateDXGISurfaceBuffer, MFCreateMediaType, MFCreateMemoryBuffer, MFCreateSample,
    MFMediaType_Video, MFNominalRange_16_235, MFShutdown, MFStartup, MFTEnumEx,
    MFT_ENUM_HARDWARE_VENDOR_ID_Attribute, MFT_FRIENDLY_NAME_Attribute, MFVideoFormat_H264,
    MFVideoFormat_HEVC, MFVideoFormat_NV12, MFVideoInterlace_Progressive, MFVideoPrimaries_BT709,
    MFVideoTransFunc_709, MFVideoTransferMatrix_BT709, MFSTARTUP_FULL, MFT_CATEGORY_VIDEO_ENCODER,
    MFT_ENUM_ADAPTER_LUID, MFT_ENUM_FLAG_HARDWARE, MFT_ENUM_FLAG_SORTANDFILTER,
    MFT_MESSAGE_COMMAND_DRAIN, MFT_MESSAGE_NOTIFY_BEGIN_STREAMING,
    MFT_MESSAGE_NOTIFY_END_OF_STREAM, MFT_MESSAGE_NOTIFY_END_STREAMING,
    MFT_MESSAGE_NOTIFY_START_OF_STREAM, MFT_MESSAGE_SET_D3D_MANAGER, MFT_OUTPUT_DATA_BUFFER,
    MFT_OUTPUT_STREAM_PROVIDES_SAMPLES, MFT_REGISTER_TYPE_INFO, MF_EVENT_FLAG_NONE,
    MF_EVENT_FLAG_NO_WAIT, MF_E_NO_EVENTS_AVAILABLE, MF_E_TRANSFORM_NEED_MORE_INPUT,
    MF_E_TRANSFORM_STREAM_CHANGE, MF_MT_AVG_BITRATE, MF_MT_FRAME_RATE, MF_MT_FRAME_SIZE,
    MF_MT_INTERLACE_MODE, MF_MT_MAJOR_TYPE, MF_MT_MPEG2_PROFILE, MF_MT_MPEG_SEQUENCE_HEADER,
    MF_MT_PIXEL_ASPECT_RATIO, MF_MT_SUBTYPE, MF_MT_TRANSFER_FUNCTION, MF_MT_VIDEO_NOMINAL_RANGE,
    MF_MT_VIDEO_PRIMARIES, MF_MT_YUV_MATRIX, MF_SA_D3D11_AWARE, MF_TRANSFORM_ASYNC,
    MF_TRANSFORM_ASYNC_UNLOCK, MF_VERSION,
};
use windows::Win32::System::Com::{
    CoInitializeEx, CoTaskMemFree, CoUninitialize, COINIT_MULTITHREADED,
};
use windows::Win32::System::Variant::{VARIANT, VT_BOOL, VT_UI4};

use crate::encoder::Bitstream;
use crate::gpu::{Compositor, TARGET_FORMAT};
use crate::zerocopy::{has_parameter_sets, mark_broken, Handoff, Opened, Settings, Vendor};

/// Textures in the ring (the engine draws into one while the encoder reads another).
const RING: usize = 3;
/// Frames handed over and not yet taken by the encoder's thread, at most.
const IN_FLIGHT: usize = 2;
/// NV12 textures the encoder may hold at once.
const POOL: usize = 6;
/// Longest wait for the encoder (an answer, the last frames at the end).
const PATIENCE: Duration = Duration::from_secs(3);

type DxResult<T> = windows::core::Result<T>;

/// What the engine's thread sends the encoder's.
enum Job {
    /// The picture is (once `value` is reached on `drawn`) in ring texture `slot`, for `copies` frames.
    Frame {
        slot: usize,
        value: u64,
        copies: u64,
    },
    Attach(Bitstream),
    Lost,
    Stop,
}

/// The engine's side of a zero-copy encoder.
struct MfHandoff {
    ring: Vec<wgpu::Texture>,
    /// The `free` value that says each ring texture has been taken (0: never used).
    taken: [u64; RING],
    next: usize,
    value: u64,
    drawn: ID3D12Fence,
    free: ID3D12Fence,
    jobs: Sender<Job>,
    in_flight: Arc<AtomicUsize>,
    failed: Arc<Mutex<Option<String>>>,
    closed: bool,
}

/// A handle that crosses to the encoder's thread (closed there once opened).
struct Shared(usize);

impl Shared {
    fn of(h: HANDLE) -> Self {
        Shared(h.0 as usize)
    }
    fn handle(&self) -> HANDLE {
        HANDLE(self.0 as *mut _)
    }
}

fn lock<T>(m: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    m.lock().unwrap_or_else(PoisonError::into_inner)
}

/// Open a zero-copy encoder for a `w` × `h` feed at `fps` (the engine's thread).
///
/// # Errors
/// The engine isn't on Direct3D 12, or the shared textures or fences could not be made.
pub fn open(
    gpu: &Compositor,
    (w, h): (u32, u32),
    fps: u32,
    settings: &Settings,
) -> Result<Opened, String> {
    // SAFETY: the raw device is only used here to make objects of our own;
    // wgpu's device outlives them (the ring's textures hold it).
    let d3d12: ID3D12Device = unsafe { gpu.device.as_hal::<wgpu::hal::api::Dx12>() }
        .map(|d| d.raw_device().clone())
        .ok_or("the engine is not drawing with Direct3D 12")?;
    let err = |what: &str, e: windows::core::Error| format!("{what}: {}", e.message());
    // SAFETY: plain object creation on a valid device; every out-pointer is ours.
    let (luid, drawn, free, drawn_h, free_h) = unsafe {
        let luid = d3d12.GetAdapterLuid();
        let drawn: ID3D12Fence = d3d12
            .CreateFence(0, D3D12_FENCE_FLAG_SHARED)
            .map_err(|e| err("shared fence", e))?;
        let free: ID3D12Fence = d3d12
            .CreateFence(0, D3D12_FENCE_FLAG_SHARED)
            .map_err(|e| err("shared fence", e))?;
        let drawn_h = d3d12
            .CreateSharedHandle(&drawn, None, GENERIC_ALL.0, None)
            .map_err(|e| err("fence handle", e))?;
        let free_h = d3d12
            .CreateSharedHandle(&free, None, GENERIC_ALL.0, None)
            .map_err(|e| err("fence handle", e))?;
        (luid, drawn, free, Shared::of(drawn_h), Shared::of(free_h))
    };
    let mut ring = Vec::new();
    let mut handles = Vec::new();
    for _ in 0..RING {
        let props = D3D12_HEAP_PROPERTIES {
            Type: D3D12_HEAP_TYPE_DEFAULT,
            ..Default::default()
        };
        let desc = D3D12_RESOURCE_DESC {
            Dimension: D3D12_RESOURCE_DIMENSION_TEXTURE2D,
            Alignment: 0,
            Width: u64::from(w),
            Height: h,
            DepthOrArraySize: 1,
            MipLevels: 1,
            Format: DXGI_FORMAT_R8G8B8A8_UNORM,
            SampleDesc: DXGI_SAMPLE_DESC {
                Count: 1,
                Quality: 0,
            },
            Layout: D3D12_TEXTURE_LAYOUT_UNKNOWN,
            // Simultaneous access: D3D11 may read it while D3D12 has it in
            // another state, and it decays to COMMON after each submit.
            Flags: D3D12_RESOURCE_FLAG_ALLOW_RENDER_TARGET
                | D3D12_RESOURCE_FLAG_ALLOW_SIMULTANEOUS_ACCESS,
        };
        let mut res: Option<ID3D12Resource> = None;
        // SAFETY: valid descriptions and out-pointer.
        let handle = unsafe {
            d3d12
                .CreateCommittedResource(
                    &props,
                    D3D12_HEAP_FLAG_SHARED,
                    &desc,
                    D3D12_RESOURCE_STATE_COMMON,
                    None,
                    &mut res,
                )
                .map_err(|e| err("shared texture", e))?;
            let r = res.as_ref().ok_or("no shared texture")?;
            d3d12
                .CreateSharedHandle(r, None, GENERIC_ALL.0, None)
                .map_err(|e| err("texture handle", e))?
        };
        handles.push(Shared::of(handle));
        let res = res.ok_or("no shared texture")?;
        let size = wgpu::Extent3d {
            width: w,
            height: h,
            depth_or_array_layers: 1,
        };
        // SAFETY: the resource was made on this very device, with this size
        // and format, and is in the COMMON state (wgpu's "uninitialized").
        let texture = unsafe {
            let hal = wgpu::hal::dx12::Device::texture_from_raw(
                res,
                TARGET_FORMAT,
                wgpu::TextureDimension::D2,
                size,
                1,
                1,
            );
            gpu.device.create_texture_from_hal::<wgpu::hal::api::Dx12>(
                hal,
                &wgpu::TextureDescriptor {
                    label: Some("zero-copy ring"),
                    size,
                    mip_level_count: 1,
                    sample_count: 1,
                    dimension: wgpu::TextureDimension::D2,
                    format: TARGET_FORMAT,
                    usage: wgpu::TextureUsages::COPY_DST,
                    view_formats: &[],
                },
                wgpu::TextureUses::UNINITIALIZED,
            )
        };
        ring.push(texture);
    }
    let (jobs, rx) = channel();
    let (ready_tx, ready) = channel();
    let in_flight = Arc::new(AtomicUsize::new(0));
    let failed = Arc::new(Mutex::new(None));
    let start = Start {
        luid: (luid.LowPart, luid.HighPart),
        size: (w, h),
        fps: fps.max(1),
        settings: *settings,
        drawn: drawn_h,
        free: free_h,
        ring: handles,
    };
    let (fl, fail) = (Arc::clone(&in_flight), Arc::clone(&failed));
    thread::Builder::new()
        .name("lumora-zero-copy".into())
        .spawn(move || run(start, &rx, &ready_tx, &fl, &fail))
        .map_err(|e| e.to_string())?;
    Ok(Opened {
        handoff: Box::new(MfHandoff {
            ring,
            taken: [0; RING],
            next: 0,
            value: 0,
            drawn,
            free,
            jobs,
            in_flight,
            failed,
            closed: false,
        }),
        ready,
    })
}

impl Handoff for MfHandoff {
    fn submit(&mut self, gpu: &mut Compositor, target: usize, copies: u64) -> bool {
        if self.closed || lock(&self.failed).is_some() {
            return false;
        }
        if self.in_flight.load(Ordering::SeqCst) >= IN_FLIGHT {
            return false;
        }
        let slot = self.next;
        let size = (self.ring[slot].width(), self.ring[slot].height());
        if gpu.target_size(target) != Some(size) {
            return false;
        }
        self.value += 1;
        let value = self.value;
        {
            // SAFETY: the fences are ours and outlive the submit; wgpu-hal
            // queues the wait before and the signal after the next submit.
            let Some(queue) = (unsafe { gpu.queue.as_hal::<wgpu::hal::api::Dx12>() }) else {
                return false;
            };
            if self.taken[slot] > 0 {
                // The encoder has taken what was in this texture before (a wait on the GPU).
                queue.add_wait_fence(self.free.clone(), self.taken[slot]);
            }
            queue.add_signal_fence(self.drawn.clone(), value);
        }
        // (The size was checked: the copy is submitted, with the wait and signal.)
        let _ = gpu.copy_target_to(target, &self.ring[slot]);
        self.taken[slot] = value;
        self.next = (slot + 1) % RING;
        self.in_flight.fetch_add(1, Ordering::SeqCst);
        if self
            .jobs
            .send(Job::Frame {
                slot,
                value,
                copies,
            })
            .is_err()
        {
            self.in_flight.fetch_sub(1, Ordering::SeqCst);
            return false;
        }
        true
    }

    fn attach(&mut self, out: Bitstream) {
        let _ = self.jobs.send(Job::Attach(out));
    }

    fn failed(&self) -> Option<String> {
        lock(&self.failed).clone()
    }

    fn lost(&mut self) {
        if !std::mem::replace(&mut self.closed, true) {
            let _ = self.jobs.send(Job::Lost);
        }
    }

    fn close(&mut self) {
        if !std::mem::replace(&mut self.closed, true) {
            let _ = self.jobs.send(Job::Stop);
        }
    }
}

impl Drop for MfHandoff {
    fn drop(&mut self) {
        self.close();
    }
}

/// What the encoder's thread starts from.
struct Start {
    luid: (u32, i32),
    size: (u32, u32),
    fps: u32,
    settings: Settings,
    drawn: Shared,
    free: Shared,
    ring: Vec<Shared>,
}

fn close_handles(s: &Start) {
    for h in [&s.drawn, &s.free].into_iter().chain(&s.ring) {
        // SAFETY: each handle was made for this thread and is closed once.
        unsafe {
            let _ = CloseHandle(h.handle());
        }
    }
}

/// The encoder's thread: COM and Media Foundation live and die here.
fn run(
    start: Start,
    jobs: &Receiver<Job>,
    ready: &Sender<Result<String, String>>,
    in_flight: &AtomicUsize,
    failed: &Mutex<Option<String>>,
) {
    // SAFETY: started and stopped on this thread only.
    let com = unsafe { CoInitializeEx(None, COINIT_MULTITHREADED) }.is_ok();
    let mf = unsafe { MFStartup(MF_VERSION, MFSTARTUP_FULL) }.is_ok();
    let opened = Encoder::open(&start);
    close_handles(&start);
    match opened {
        Err(e) => {
            let _ = ready.send(Err(e));
        }
        Ok(mut enc) => {
            let _ = ready.send(Ok(enc.path.clone()));
            // (Attached before any frame: the engine sends it as FFmpeg starts.)
            let mut out: Option<Bitstream> = None;
            let end = |why: &str, out: &Option<Bitstream>, broken: bool| {
                *lock(failed) = Some(why.to_owned());
                if broken {
                    mark_broken(why);
                }
                if let Some(o) = out {
                    o.fail(why);
                }
            };
            for job in jobs {
                match job {
                    Job::Attach(b) => out = Some(b),
                    Job::Frame {
                        slot,
                        value,
                        copies,
                    } => {
                        let r = enc.frame(slot, value, copies, out.as_ref());
                        in_flight.fetch_sub(1, Ordering::SeqCst);
                        if let Err(e) = r {
                            let why = format!("The graphics card's encoder stopped: {e}");
                            end(&why, &out, true);
                            break;
                        }
                    }
                    Job::Lost => {
                        end(
                            "The graphics card was reset; the encoder starts again with it.",
                            &out,
                            false,
                        );
                        break;
                    }
                    Job::Stop => {
                        if let Err(e) = enc.drain(out.as_ref()) {
                            eprintln!("lumora: the zero-copy encoder's last frames: {e}");
                        }
                        break;
                    }
                }
            }
            enc.shutdown();
            // The picture ends when the last writer lets go (FFmpeg finishes the file).
            drop(out);
        }
    }
    // SAFETY: matched with the starts above, on the same thread.
    unsafe {
        if mf {
            let _ = MFShutdown();
        }
        if com {
            CoUninitialize();
        }
    }
}

/// Everything on the encoder's side.
struct Encoder {
    path: String,
    ctx: ID3D11DeviceContext4,
    drawn: ID3D11Fence,
    free: ID3D11Fence,
    video: ID3D11VideoContext,
    vp: ID3D11VideoProcessor,
    inputs: Vec<ID3D11VideoProcessorInputView>,
    nv12: Vec<(ID3D11Texture2D, ID3D11VideoProcessorOutputView)>,
    next_nv12: usize,
    mft: IMFTransform,
    events: Option<IMFMediaEventGenerator>,
    /// The encoder said it wants input this many times (async encoders).
    need: u32,
    provides_samples: bool,
    out_size: u32,
    /// Frames given to the encoder and not yet out.
    pending: usize,
    frame: u64,
    fps: u32,
    hevc: bool,
    /// The parameter sets (SPS/PPS) said once at the start when the encoder doesn't put them in the stream.
    started: bool,
    /// Kept alive while the encoder uses the device.
    _manager: IMFDXGIDeviceManager,
    _device: ID3D11Device,
}

fn mf_err(what: &str) -> impl Fn(windows::core::Error) -> String + '_ {
    move |e| format!("{what} ({})", e.message())
}

fn variant_u32(v: u32) -> VARIANT {
    let mut x = VARIANT::default();
    // SAFETY: a plain number in the union, tagged as such.
    unsafe {
        (*x.Anonymous.Anonymous).vt = VT_UI4;
        (*x.Anonymous.Anonymous).Anonymous.ulVal = v;
    }
    x
}

fn variant_bool(v: bool) -> VARIANT {
    let mut x = VARIANT::default();
    // SAFETY: a plain boolean in the union, tagged as such.
    unsafe {
        (*x.Anonymous.Anonymous).vt = VT_BOOL;
        (*x.Anonymous.Anonymous).Anonymous.boolVal = if v {
            VARIANT_TRUE
        } else {
            windows::Win32::Foundation::VARIANT_FALSE
        };
    }
    x
}

impl Encoder {
    fn open(s: &Start) -> Result<Self, String> {
        let (w, h) = s.size;
        // SAFETY: Direct3D 11 and Media Foundation calls with valid
        // arguments and out-pointers, all on this thread; the shared handles
        // were made for us by the engine and are opened before being closed.
        unsafe {
            let factory: IDXGIFactory4 = CreateDXGIFactory1().map_err(mf_err("DXGI"))?;
            let luid = LUID {
                LowPart: s.luid.0,
                HighPart: s.luid.1,
            };
            let adapter: IDXGIAdapter1 = factory
                .EnumAdapterByLuid(luid)
                .map_err(mf_err("the engine's graphics card"))?;
            let name = adapter
                .GetDesc1()
                .map(|d| {
                    String::from_utf16_lossy(&d.Description)
                        .trim_end_matches('\0')
                        .to_owned()
                })
                .unwrap_or_default();
            let mut device: Option<ID3D11Device> = None;
            let mut immediate: Option<ID3D11DeviceContext> = None;
            D3D11CreateDevice(
                &adapter,
                D3D_DRIVER_TYPE_UNKNOWN,
                HMODULE::default(),
                D3D11_CREATE_DEVICE_VIDEO_SUPPORT | D3D11_CREATE_DEVICE_BGRA_SUPPORT,
                Some(&[D3D_FEATURE_LEVEL_11_1, D3D_FEATURE_LEVEL_11_0]),
                D3D11_SDK_VERSION,
                Some(&mut device),
                None,
                Some(&mut immediate),
            )
            .map_err(mf_err("Direct3D 11 with video"))?;
            let device = device.ok_or("no Direct3D 11 device")?;
            let immediate = immediate.ok_or("no Direct3D 11 context")?;
            // Media Foundation uses the device from its own threads too.
            if let Ok(mt) = device.cast::<ID3D11Multithread>() {
                let _ = mt.SetMultithreadProtected(true);
            }
            let dev5: ID3D11Device5 = device
                .cast()
                .map_err(mf_err("shared fences need Windows 10 1703"))?;
            let ctx: ID3D11DeviceContext4 = immediate.cast().map_err(mf_err("shared fences"))?;
            let mut drawn: Option<ID3D11Fence> = None;
            dev5.OpenSharedFence(s.drawn.handle(), &mut drawn)
                .map_err(mf_err("opening the shared fence"))?;
            let mut free: Option<ID3D11Fence> = None;
            dev5.OpenSharedFence(s.free.handle(), &mut free)
                .map_err(mf_err("opening the shared fence"))?;
            let dev1: ID3D11Device1 = device.cast().map_err(mf_err("Direct3D 11.1"))?;
            let ring: Vec<ID3D11Texture2D> = s
                .ring
                .iter()
                .map(|h| dev1.OpenSharedResource1(h.handle()))
                .collect::<DxResult<_>>()
                .map_err(mf_err("opening the shared textures"))?;
            // RGBA → NV12 (BT.709, limited range) with the card's video processor.
            let video_dev: ID3D11VideoDevice = device.cast().map_err(mf_err("video processing"))?;
            let video: ID3D11VideoContext = immediate.cast().map_err(mf_err("video processing"))?;
            let rate = DXGI_RATIONAL {
                Numerator: s.fps,
                Denominator: 1,
            };
            let content = D3D11_VIDEO_PROCESSOR_CONTENT_DESC {
                InputFrameFormat: D3D11_VIDEO_FRAME_FORMAT_PROGRESSIVE,
                InputFrameRate: rate,
                InputWidth: w,
                InputHeight: h,
                OutputFrameRate: rate,
                OutputWidth: w,
                OutputHeight: h,
                Usage: D3D11_VIDEO_USAGE_PLAYBACK_NORMAL,
            };
            let vp_enum: ID3D11VideoProcessorEnumerator = video_dev
                .CreateVideoProcessorEnumerator(&content)
                .map_err(mf_err("video processor"))?;
            let can_in = vp_enum
                .CheckVideoProcessorFormat(DXGI_FORMAT_R8G8B8A8_UNORM)
                .unwrap_or(0);
            let can_out = vp_enum
                .CheckVideoProcessorFormat(DXGI_FORMAT_NV12)
                .unwrap_or(0);
            if can_in & D3D11_VIDEO_PROCESSOR_FORMAT_SUPPORT_INPUT.0 as u32 == 0
                || can_out & D3D11_VIDEO_PROCESSOR_FORMAT_SUPPORT_OUTPUT.0 as u32 == 0
            {
                return Err("the video processor can't make NV12 from RGBA here".into());
            }
            let vp = video_dev
                .CreateVideoProcessor(&vp_enum, 0)
                .map_err(mf_err("video processor"))?;
            if let Ok(v1) = video.cast::<ID3D11VideoContext1>() {
                v1.VideoProcessorSetStreamColorSpace1(
                    &vp,
                    0,
                    DXGI_COLOR_SPACE_RGB_FULL_G22_NONE_P709,
                );
                v1.VideoProcessorSetOutputColorSpace1(
                    &vp,
                    DXGI_COLOR_SPACE_YCBCR_STUDIO_G22_LEFT_P709,
                );
            } else {
                // Usage 0, RGB full range, BT.709 matrix, YCbCr limited (16 – 235).
                let cs = D3D11_VIDEO_PROCESSOR_COLOR_SPACE {
                    _bitfield: (1 << 2) | (1 << 4),
                };
                video.VideoProcessorSetOutputColorSpace(&vp, &cs);
            }
            let mut inputs = Vec::new();
            for t in &ring {
                let mut desc = D3D11_VIDEO_PROCESSOR_INPUT_VIEW_DESC {
                    ViewDimension: D3D11_VPIV_DIMENSION_TEXTURE2D,
                    ..Default::default()
                };
                desc.FourCC = 0;
                let mut view = None;
                video_dev
                    .CreateVideoProcessorInputView(t, &vp_enum, &desc, Some(&mut view))
                    .map_err(mf_err("video processor input"))?;
                inputs.push(view.ok_or("no input view")?);
            }
            let mut nv12 = Vec::new();
            for _ in 0..POOL {
                let tex = nv12_texture(&device, w, h)?;
                let desc = D3D11_VIDEO_PROCESSOR_OUTPUT_VIEW_DESC {
                    ViewDimension: D3D11_VPOV_DIMENSION_TEXTURE2D,
                    ..Default::default()
                };
                let mut view = None;
                video_dev
                    .CreateVideoProcessorOutputView(&tex, &vp_enum, &desc, Some(&mut view))
                    .map_err(mf_err("video processor output"))?;
                nv12.push((tex, view.ok_or("no output view")?));
            }
            // The encoder: the chosen maker's hardware encoder on this graphics card.
            let (activate, mft_name) = find_encoder(&s.settings, luid)?;
            let mft: IMFTransform = activate
                .ActivateObject()
                .map_err(mf_err("starting the hardware encoder"))?;
            let attrs = mft.GetAttributes().map_err(mf_err("encoder attributes"))?;
            let is_async = attrs.GetUINT32(&MF_TRANSFORM_ASYNC).unwrap_or(0) != 0;
            if is_async {
                attrs
                    .SetUINT32(&MF_TRANSFORM_ASYNC_UNLOCK, 1)
                    .map_err(mf_err("unlocking the encoder"))?;
            }
            if attrs.GetUINT32(&MF_SA_D3D11_AWARE).unwrap_or(0) == 0 {
                return Err(format!("{mft_name} doesn't take Direct3D 11 textures"));
            }
            let mut token = 0u32;
            let mut manager: Option<IMFDXGIDeviceManager> = None;
            MFCreateDXGIDeviceManager(&mut token, &mut manager)
                .map_err(mf_err("device manager"))?;
            let manager = manager.ok_or("no device manager")?;
            manager
                .ResetDevice(&device, token)
                .map_err(mf_err("device manager"))?;
            mft.ProcessMessage(MFT_MESSAGE_SET_D3D_MANAGER, manager.as_raw() as usize)
                .map_err(mf_err("giving the encoder the graphics card"))?;
            configure(&mft, &s.settings, s.size, s.fps)?;
            let info = mft
                .GetOutputStreamInfo(0)
                .map_err(mf_err("encoder output"))?;
            mft.ProcessMessage(MFT_MESSAGE_NOTIFY_BEGIN_STREAMING, 0)
                .map_err(mf_err("starting the encoder"))?;
            mft.ProcessMessage(MFT_MESSAGE_NOTIFY_START_OF_STREAM, 0)
                .map_err(mf_err("starting the encoder"))?;
            let events = if is_async {
                Some(
                    mft.cast::<IMFMediaEventGenerator>()
                        .map_err(mf_err("encoder events"))?,
                )
            } else {
                None
            };
            let codec = if s.settings.hevc { "HEVC" } else { "H.264" };
            Ok(Encoder {
                path: format!(
                    "zero-copy: {} {codec} on {name} (Media Foundation, {mft_name}; Direct3D 12 → 11 shared texture)",
                    s.settings.vendor.label()
                ),
                ctx,
                drawn: drawn.ok_or("no fence")?,
                free: free.ok_or("no fence")?,
                video,
                vp,
                inputs,
                nv12,
                next_nv12: 0,
                mft,
                events,
                need: 0,
                provides_samples: info.dwFlags & MFT_OUTPUT_STREAM_PROVIDES_SAMPLES.0 as u32 != 0,
                out_size: info.cbSize.max(w * h),
                pending: 0,
                frame: 0,
                fps: s.fps,
                hevc: s.settings.hevc,
                started: false,
                _manager: manager,
                _device: device,
            })
        }
    }

    /// The picture in ring texture `slot` (drawn once `drawn` reaches `value`), for `copies` frames.
    fn frame(
        &mut self,
        slot: usize,
        value: u64,
        copies: u64,
        out: Option<&Bitstream>,
    ) -> Result<(), String> {
        // Not more NV12 textures in the encoder than there are.
        while self.pending >= POOL - 1 {
            self.wait_output(out)?;
        }
        let k = self.next_nv12;
        self.next_nv12 = (k + 1) % POOL;
        // SAFETY: valid objects of this thread; the stream description holds
        // a borrowed view that is released (ManuallyDrop) right after.
        unsafe {
            self.ctx
                .Wait(&self.drawn, value)
                .map_err(mf_err("waiting for the engine's picture"))?;
            let stream = D3D11_VIDEO_PROCESSOR_STREAM {
                Enable: true.into(),
                pInputSurface: std::mem::ManuallyDrop::new(Some(self.inputs[slot].clone())),
                ..Default::default()
            };
            let mut streams = [stream];
            let r = self
                .video
                .VideoProcessorBlt(&self.vp, &self.nv12[k].1, 0, &streams);
            std::mem::ManuallyDrop::drop(&mut streams[0].pInputSurface);
            r.map_err(mf_err("making NV12"))?;
            // The ring texture may be drawn into again once the conversion is done.
            self.ctx
                .Signal(&self.free, value)
                .map_err(mf_err("freeing the engine's texture"))?;
            self.ctx.Flush();
        }
        let tex = self.nv12[k].0.clone();
        for _ in 0..copies.max(1) {
            self.input(&tex)?;
            if let Some(o) = out {
                o.count(1);
            }
        }
        self.poll_outputs(out)
    }

    fn sample_of(&self, tex: &ID3D11Texture2D) -> Result<IMFSample, String> {
        // SAFETY: a sample around our texture; times in 100 ns units.
        unsafe {
            let buffer = MFCreateDXGISurfaceBuffer(&ID3D11Texture2D::IID, tex, 0, false)
                .map_err(mf_err("wrapping the texture"))?;
            if let Ok(b2) = buffer.cast::<IMF2DBuffer>() {
                if let Ok(len) = b2.GetContiguousLength() {
                    let _ = buffer.SetCurrentLength(len);
                }
            }
            let sample = MFCreateSample().map_err(mf_err("sample"))?;
            sample.AddBuffer(&buffer).map_err(mf_err("sample"))?;
            let fps = i64::from(self.fps.max(1));
            let n = i64::try_from(self.frame).unwrap_or(i64::MAX / 2);
            sample
                .SetSampleTime(n * 10_000_000 / fps)
                .map_err(mf_err("sample"))?;
            sample
                .SetSampleDuration(10_000_000 / fps)
                .map_err(mf_err("sample"))?;
            Ok(sample)
        }
    }

    fn input(&mut self, tex: &ID3D11Texture2D) -> Result<(), String> {
        let sample = self.sample_of(tex)?;
        if self.events.is_some() {
            // Asynchronous (hardware) encoders say when they want a frame.
            let deadline = Instant::now() + PATIENCE;
            while self.need == 0 {
                if Instant::now() > deadline {
                    return Err("the encoder stopped asking for frames".into());
                }
                self.next_event(true, None)?;
            }
            self.need -= 1;
        }
        // SAFETY: a valid sample for stream 0.
        unsafe { self.mft.ProcessInput(0, &sample, 0) }.map_err(mf_err("encoding a frame"))?;
        self.frame += 1;
        self.pending += 1;
        if self.events.is_none() {
            self.pull_outputs(None)?;
        }
        Ok(())
    }

    /// One event of an asynchronous encoder (`wait`: block for it). `out`: where output goes.
    fn next_event(&mut self, wait: bool, out: Option<&Bitstream>) -> Result<Option<u32>, String> {
        let Some(events) = &self.events else {
            return Ok(None);
        };
        let flags = if wait {
            MF_EVENT_FLAG_NONE
        } else {
            MF_EVENT_FLAG_NO_WAIT
        };
        // SAFETY: our encoder's event queue.
        let ev = match unsafe { events.GetEvent(flags) } {
            Ok(e) => e,
            Err(e) if e.code() == MF_E_NO_EVENTS_AVAILABLE => return Ok(None),
            Err(e) => return Err(mf_err("the encoder's events")(e)),
        };
        // SAFETY: reading the event's type.
        let kind = unsafe { ev.GetType() }.map_err(mf_err("the encoder's events"))?;
        if kind == METransformNeedInput.0 as u32 {
            self.need += 1;
        } else if kind == METransformHaveOutput.0 as u32 {
            self.take_output(out)?;
        }
        Ok(Some(kind))
    }

    /// Handle every event already there.
    fn poll_outputs(&mut self, out: Option<&Bitstream>) -> Result<(), String> {
        if self.events.is_none() {
            return Ok(());
        }
        while self.next_event(false, out)?.is_some() {}
        Ok(())
    }

    /// Wait for one encoded frame.
    fn wait_output(&mut self, out: Option<&Bitstream>) -> Result<(), String> {
        let before = self.pending;
        let deadline = Instant::now() + PATIENCE;
        while self.pending == before {
            if Instant::now() > deadline {
                return Err("the encoder stopped giving frames back".into());
            }
            if self.events.is_some() {
                self.next_event(true, out)?;
            } else if !self.take_output(out)? {
                return Err("the encoder holds every frame".into());
            }
        }
        Ok(())
    }

    /// A synchronous encoder: everything it has now.
    fn pull_outputs(&mut self, out: Option<&Bitstream>) -> Result<(), String> {
        while self.take_output(out)? {}
        Ok(())
    }

    /// Take one encoded frame out (false: none ready).
    fn take_output(&mut self, out: Option<&Bitstream>) -> Result<bool, String> {
        // SAFETY: Media Foundation fills (or takes) the sample; the
        // ManuallyDrop fields are released here exactly once.
        unsafe {
            let own = if self.provides_samples {
                None
            } else {
                let s = MFCreateSample().map_err(mf_err("output sample"))?;
                let b = MFCreateMemoryBuffer(self.out_size).map_err(mf_err("output buffer"))?;
                s.AddBuffer(&b).map_err(mf_err("output sample"))?;
                Some(s)
            };
            let mut buf = [MFT_OUTPUT_DATA_BUFFER {
                dwStreamID: 0,
                pSample: std::mem::ManuallyDrop::new(own),
                dwStatus: 0,
                pEvents: std::mem::ManuallyDrop::new(None),
            }];
            let mut status = 0u32;
            let r = self.mft.ProcessOutput(0, &mut buf, &mut status);
            let sample = std::mem::ManuallyDrop::take(&mut buf[0].pSample);
            std::mem::ManuallyDrop::drop(&mut buf[0].pEvents);
            match r {
                Ok(()) => {}
                Err(e) if e.code() == MF_E_TRANSFORM_NEED_MORE_INPUT => return Ok(false),
                Err(e) if e.code() == MF_E_TRANSFORM_STREAM_CHANGE => {
                    // The encoder settled its output format: take it as offered.
                    let t = self
                        .mft
                        .GetOutputAvailableType(0, 0)
                        .map_err(mf_err("the encoder's new format"))?;
                    self.mft
                        .SetOutputType(0, &t, 0)
                        .map_err(mf_err("the encoder's new format"))?;
                    return Ok(true);
                }
                Err(e) => return Err(mf_err("taking an encoded frame")(e)),
            }
            let Some(sample) = sample else {
                return Ok(true);
            };
            let buffer = sample
                .ConvertToContiguousBuffer()
                .map_err(mf_err("encoded frame"))?;
            let mut data = std::ptr::null_mut();
            let mut len = 0u32;
            buffer
                .Lock(&mut data, None, Some(&mut len))
                .map_err(mf_err("encoded frame"))?;
            let mut bytes = std::slice::from_raw_parts(data, len as usize).to_vec();
            let _ = buffer.Unlock();
            self.pending = self.pending.saturating_sub(1);
            if !self.started {
                self.started = true;
                // Some encoders keep the parameter sets out of the stream: said once at the start.
                if !has_parameter_sets(&bytes, self.hevc) {
                    if let Some(header) = sequence_header(&self.mft) {
                        bytes.splice(0..0, header);
                    }
                }
            }
            if let Some(o) = out {
                if !o.write(bytes) {
                    return Err("FFmpeg stopped taking the picture".into());
                }
            }
            Ok(true)
        }
    }

    /// Encode what is left (the end of the recording or stream).
    fn drain(&mut self, out: Option<&Bitstream>) -> Result<(), String> {
        // SAFETY: plain messages to our encoder.
        unsafe {
            self.mft
                .ProcessMessage(MFT_MESSAGE_NOTIFY_END_OF_STREAM, 0)
                .map_err(mf_err("ending"))?;
            self.mft
                .ProcessMessage(MFT_MESSAGE_COMMAND_DRAIN, 0)
                .map_err(mf_err("ending"))?;
        }
        if self.events.is_none() {
            return self.pull_outputs(out);
        }
        let deadline = Instant::now() + PATIENCE;
        while Instant::now() < deadline {
            match self.next_event(false, out)? {
                Some(k) if k == METransformDrainComplete.0 as u32 => return Ok(()),
                Some(_) => {}
                None => thread::sleep(Duration::from_millis(2)),
            }
        }
        Err("the encoder did not give its last frames back".into())
    }

    fn shutdown(&mut self) {
        // SAFETY: plain messages; the encoder is shut down once.
        unsafe {
            let _ = self.mft.ProcessMessage(MFT_MESSAGE_NOTIFY_END_STREAMING, 0);
            if let Ok(s) = self.mft.cast::<IMFShutdown>() {
                let _ = s.Shutdown();
            }
        }
    }
}

/// An NV12 texture the video processor writes and the encoder reads.
fn nv12_texture(device: &ID3D11Device, w: u32, h: u32) -> Result<ID3D11Texture2D, String> {
    let mut desc = D3D11_TEXTURE2D_DESC {
        Width: w,
        Height: h,
        MipLevels: 1,
        ArraySize: 1,
        Format: DXGI_FORMAT_NV12,
        SampleDesc: DXGI_SAMPLE_DESC {
            Count: 1,
            Quality: 0,
        },
        Usage: D3D11_USAGE_DEFAULT,
        BindFlags: (D3D11_BIND_RENDER_TARGET.0 | D3D11_BIND_VIDEO_ENCODER.0) as u32,
        CPUAccessFlags: 0,
        MiscFlags: 0,
    };
    let mut tex = None;
    // SAFETY: a valid description and out-pointer; tried again without the
    // encoder binding for drivers that don't know it.
    unsafe {
        if device.CreateTexture2D(&desc, None, Some(&mut tex)).is_err() {
            desc.BindFlags = D3D11_BIND_RENDER_TARGET.0 as u32;
            device
                .CreateTexture2D(&desc, None, Some(&mut tex))
                .map_err(mf_err("NV12 texture"))?;
        }
    }
    tex.ok_or_else(|| "no NV12 texture".to_owned())
}

/// The parameter sets the encoder put in its output format.
fn sequence_header(mft: &IMFTransform) -> Option<Vec<u8>> {
    // SAFETY: reading a blob of the size Media Foundation says.
    unsafe {
        let t = mft.GetOutputCurrentType(0).ok()?;
        let n = t.GetBlobSize(&MF_MT_MPEG_SEQUENCE_HEADER).ok()?;
        let mut v = vec![0u8; n as usize];
        t.GetBlob(&MF_MT_MPEG_SEQUENCE_HEADER, &mut v, None).ok()?;
        Some(v)
    }
}

/// The hardware encoder of `settings.vendor` that runs on the graphics card `luid`.
/// A hardware encoder Media Foundation lists: its maker, graphics card (LUID) and name.
type Listed = (IMFActivate, Option<Vendor>, Option<[u8; 8]>, String);

fn find_encoder(settings: &Settings, luid: LUID) -> Result<(IMFActivate, String), String> {
    let subtype = if settings.hevc {
        MFVideoFormat_HEVC
    } else {
        MFVideoFormat_H264
    };
    let input = MFT_REGISTER_TYPE_INFO {
        guidMajorType: MFMediaType_Video,
        guidSubtype: MFVideoFormat_NV12,
    };
    let output = MFT_REGISTER_TYPE_INFO {
        guidMajorType: MFMediaType_Video,
        guidSubtype: subtype,
    };
    let mut list: *mut Option<IMFActivate> = std::ptr::null_mut();
    let mut count = 0u32;
    // SAFETY: Media Foundation allocates the list; its objects are taken
    // out and the list freed with CoTaskMemFree.
    let all: Vec<Listed> = unsafe {
        MFTEnumEx(
            MFT_CATEGORY_VIDEO_ENCODER,
            MFT_ENUM_FLAG_HARDWARE | MFT_ENUM_FLAG_SORTANDFILTER,
            Some(&input),
            Some(&output),
            &mut list,
            &mut count,
        )
        .map_err(mf_err("listing hardware encoders"))?;
        let mut all = Vec::new();
        for i in 0..count as usize {
            let Some(a) = (*list.add(i)).take() else {
                continue;
            };
            let vendor = string(&a, &MFT_ENUM_HARDWARE_VENDOR_ID_Attribute)
                .and_then(|v| Vendor::from_mf(&v));
            let mut l = [0u8; 8];
            let on = a
                .GetBlob(&MFT_ENUM_ADAPTER_LUID, &mut l, None)
                .ok()
                .map(|()| l);
            let name = string(&a, &MFT_FRIENDLY_NAME_Attribute).unwrap_or_default();
            all.push((a, vendor, on, name));
        }
        if !list.is_null() {
            CoTaskMemFree(Some(list as *const _));
        }
        all
    };
    let mut want = [0u8; 8];
    want[..4].copy_from_slice(&luid.LowPart.to_le_bytes());
    want[4..].copy_from_slice(&luid.HighPart.to_le_bytes());
    let label = settings.vendor.label();
    if !all.iter().any(|e| e.1 == Some(settings.vendor)) {
        return Err(format!("no {label} hardware encoder in Media Foundation"));
    }
    all.into_iter()
        .find(|(_, v, on, _)| *v == Some(settings.vendor) && on.is_none_or(|l| l == want))
        .map(|(a, _, _, name)| (a, name))
        .ok_or_else(|| format!("{label} is on another graphics card than the engine's"))
}

fn string(a: &IMFActivate, key: &GUID) -> Option<String> {
    let mut p = PWSTR::null();
    let mut len = 0u32;
    // SAFETY: Media Foundation allocates the string; freed with CoTaskMemFree.
    unsafe {
        a.GetAllocatedString(key, &mut p, &mut len).ok()?;
        let s = p.to_string().ok();
        CoTaskMemFree(Some(p.0 as *const _));
        s
    }
}

/// The app's settings (`encode.rs`) told to the encoder, then its formats.
fn configure(mft: &IMFTransform, s: &Settings, (w, h): (u32, u32), fps: u32) -> Result<(), String> {
    let (mean, max) = s.bits();
    // SAFETY: settings and media types on our encoder; every value lives
    // across its call.
    unsafe {
        if let Ok(api) = mft.cast::<ICodecAPI>() {
            let set = |key: &GUID, v: &VARIANT| api.SetValue(key, v).is_ok();
            match s.rate {
                crate::zerocopy::Rate::Cbr { .. } => {
                    set(
                        &CODECAPI_AVEncCommonRateControlMode,
                        &variant_u32(eAVEncCommonRateControlMode_CBR.0 as u32),
                    );
                }
                crate::zerocopy::Rate::Quality { level, .. } => {
                    set(
                        &CODECAPI_AVEncCommonRateControlMode,
                        &variant_u32(eAVEncCommonRateControlMode_Quality.0 as u32),
                    );
                    set(
                        &CODECAPI_AVEncCommonQuality,
                        &variant_u32(Settings::mf_quality(level)),
                    );
                }
            }
            set(&CODECAPI_AVEncCommonMeanBitRate, &variant_u32(mean));
            set(&CODECAPI_AVEncCommonMaxBitRate, &variant_u32(max));
            set(
                &CODECAPI_AVEncCommonBufferSize,
                &variant_u32(max.saturating_mul(2)),
            );
            set(&CODECAPI_AVEncMPVGOPSize, &variant_u32(s.gop.max(1)));
            set(&CODECAPI_AVEncMPVDefaultBPictureCount, &variant_u32(0));
            set(
                &CODECAPI_AVEncCommonQualityVsSpeed,
                &variant_u32(s.quality_vs_speed()),
            );
            // A frame out for every frame in (no look-ahead holding frames back).
            set(&CODECAPI_AVLowLatencyMode, &variant_bool(true));
        }
        let out: IMFMediaType = MFCreateMediaType().map_err(mf_err("media type"))?;
        let subtype = if s.hevc {
            MFVideoFormat_HEVC
        } else {
            MFVideoFormat_H264
        };
        let profile = if s.hevc {
            eAVEncH265VProfile_Main_420_8.0 as u32
        } else {
            eAVEncH264VProfile_High.0 as u32
        };
        let size = (u64::from(w) << 32) | u64::from(h);
        let rate = (u64::from(fps) << 32) | 1;
        let common = |t: &IMFMediaType| -> DxResult<()> {
            t.SetGUID(&MF_MT_MAJOR_TYPE, &MFMediaType_Video)?;
            t.SetUINT64(&MF_MT_FRAME_SIZE, size)?;
            t.SetUINT64(&MF_MT_FRAME_RATE, rate)?;
            t.SetUINT64(&MF_MT_PIXEL_ASPECT_RATIO, (1u64 << 32) | 1)?;
            t.SetUINT32(&MF_MT_INTERLACE_MODE, MFVideoInterlace_Progressive.0 as u32)?;
            // BT.709, limited range: as the read-back path tags its NV12.
            t.SetUINT32(&MF_MT_VIDEO_PRIMARIES, MFVideoPrimaries_BT709.0 as u32)?;
            t.SetUINT32(&MF_MT_TRANSFER_FUNCTION, MFVideoTransFunc_709.0 as u32)?;
            t.SetUINT32(&MF_MT_YUV_MATRIX, MFVideoTransferMatrix_BT709.0 as u32)?;
            t.SetUINT32(&MF_MT_VIDEO_NOMINAL_RANGE, MFNominalRange_16_235.0 as u32)
        };
        common(&out).map_err(mf_err("output format"))?;
        out.SetGUID(&MF_MT_SUBTYPE, &subtype)
            .map_err(mf_err("output format"))?;
        out.SetUINT32(&MF_MT_AVG_BITRATE, mean)
            .map_err(mf_err("output format"))?;
        out.SetUINT32(&MF_MT_MPEG2_PROFILE, profile)
            .map_err(mf_err("output format"))?;
        mft.SetOutputType(0, &out, 0)
            .map_err(mf_err("the encoder refused the settings"))?;
        let input: IMFMediaType = MFCreateMediaType().map_err(mf_err("media type"))?;
        common(&input).map_err(mf_err("input format"))?;
        input
            .SetGUID(&MF_MT_SUBTYPE, &MFVideoFormat_NV12)
            .map_err(mf_err("input format"))?;
        mft.SetInputType(0, &input, 0)
            .map_err(mf_err("the encoder refused NV12 at this size"))?;
    }
    Ok(())
}
