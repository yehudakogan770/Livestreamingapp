//! Windows side of [`crate::loopback`]: WASAPI process loopback (Windows 10
//! version 2004 and later). An audio client is activated on the virtual
//! process-loopback device for a process tree (included, or everything but
//! it excluded), asked for 48 kHz stereo 16-bit (Windows converts), and read
//! on its own thread as each period's sound is ready.
#![allow(unsafe_code)]

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{sync_channel, SyncSender};
use std::sync::{Arc, Mutex, PoisonError};
use std::thread::{self, JoinHandle};
use std::time::Duration;

use windows::core::{implement, Interface, Ref, HRESULT, PWSTR};
use windows::Win32::Foundation::{CloseHandle, HANDLE, WAIT_OBJECT_0};
use windows::Win32::Media::Audio::{
    eConsole, eRender, ActivateAudioInterfaceAsync, IActivateAudioInterfaceAsyncOperation,
    IActivateAudioInterfaceCompletionHandler, IActivateAudioInterfaceCompletionHandler_Impl,
    IAudioCaptureClient, IAudioClient, IAudioSessionControl2, IAudioSessionManager2,
    IMMDeviceEnumerator, MMDeviceEnumerator, AUDCLNT_BUFFERFLAGS_SILENT, AUDCLNT_SHAREMODE_SHARED,
    AUDCLNT_STREAMFLAGS_AUTOCONVERTPCM, AUDCLNT_STREAMFLAGS_EVENTCALLBACK,
    AUDCLNT_STREAMFLAGS_LOOPBACK, AUDCLNT_STREAMFLAGS_SRC_DEFAULT_QUALITY,
    AUDIOCLIENT_ACTIVATION_PARAMS, AUDIOCLIENT_ACTIVATION_PARAMS_0,
    AUDIOCLIENT_ACTIVATION_TYPE_PROCESS_LOOPBACK, AUDIOCLIENT_PROCESS_LOOPBACK_PARAMS,
    PROCESS_LOOPBACK_MODE_EXCLUDE_TARGET_PROCESS_TREE,
    PROCESS_LOOPBACK_MODE_INCLUDE_TARGET_PROCESS_TREE, VIRTUAL_AUDIO_DEVICE_PROCESS_LOOPBACK,
    WAVEFORMATEX, WAVE_FORMAT_PCM,
};
use windows::Win32::System::Com::StructuredStorage::{
    PROPVARIANT, PROPVARIANT_0, PROPVARIANT_0_0, PROPVARIANT_0_0_0,
};
use windows::Win32::System::Com::{
    CoCreateInstance, CoInitializeEx, CoTaskMemFree, CoUninitialize, IAgileObject,
    IAgileObject_Impl, BLOB, CLSCTX_ALL, COINIT_MULTITHREADED,
};
use windows::Win32::System::Diagnostics::ToolHelp::{
    CreateToolhelp32Snapshot, Process32FirstW, Process32NextW, PROCESSENTRY32W, TH32CS_SNAPPROCESS,
};
use windows::Win32::System::Threading::{
    CreateEventW, OpenProcess, QueryFullProcessImageNameW, WaitForSingleObject, PROCESS_NAME_WIN32,
    PROCESS_QUERY_LIMITED_INFORMATION,
};
use windows::Win32::System::Variant::VT_BLOB;

use crate::loopback::{Program, Sink, Target, FRAME_BYTES, RATE};

/// Tells the waiting thread that Windows finished activating the audio client.
#[implement(IActivateAudioInterfaceCompletionHandler, IAgileObject)]
struct Activated {
    done: Mutex<Option<SyncSender<()>>>,
}

impl IActivateAudioInterfaceCompletionHandler_Impl for Activated_Impl {
    fn ActivateCompleted(
        &self,
        _operation: Ref<IActivateAudioInterfaceAsyncOperation>,
    ) -> windows::core::Result<()> {
        if let Some(tx) = self
            .done
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .take()
        {
            let _ = tx.send(());
        }
        Ok(())
    }
}

impl IAgileObject_Impl for Activated_Impl {}

/// An event handle, closed when dropped.
struct Event(HANDLE);

impl Drop for Event {
    fn drop(&mut self) {
        // SAFETY: the handle was made by CreateEventW and is closed once.
        let _ = unsafe { CloseHandle(self.0) };
    }
}

/// What Windows answered, in plain words.
fn explain(what: &str, e: &windows::core::Error) -> String {
    // E_NOTIMPL / not found: Windows before version 2004 has no process loopback.
    let code = e.code().0 as u32;
    if code == 0x8000_4001 || code == 0x8007_0490 || code == 0x8007_0002 {
        return "Taking this computer's sound needs Windows 10 (version 2004) or later.".to_owned();
    }
    format!("{what}: {}", e.message())
}

/// The 48 kHz stereo 16-bit format asked for.
fn format() -> WAVEFORMATEX {
    WAVEFORMATEX {
        wFormatTag: WAVE_FORMAT_PCM as u16,
        nChannels: 2,
        nSamplesPerSec: RATE,
        nAvgBytesPerSec: RATE * FRAME_BYTES as u32,
        nBlockAlign: FRAME_BYTES as u16,
        wBitsPerSample: 16,
        cbSize: 0,
    }
}

/// Activate an audio client on the process-loopback device for `target`.
///
/// SAFETY (for callers): COM is started on this thread.
unsafe fn activate(target: Target) -> Result<IAudioClient, String> {
    let (pid, mode) = match target {
        Target::Everything { except } => {
            (except, PROCESS_LOOPBACK_MODE_EXCLUDE_TARGET_PROCESS_TREE)
        }
        Target::Program { pid } => (pid, PROCESS_LOOPBACK_MODE_INCLUDE_TARGET_PROCESS_TREE),
    };
    let mut params = AUDIOCLIENT_ACTIVATION_PARAMS {
        ActivationType: AUDIOCLIENT_ACTIVATION_TYPE_PROCESS_LOOPBACK,
        Anonymous: AUDIOCLIENT_ACTIVATION_PARAMS_0 {
            ProcessLoopbackParams: AUDIOCLIENT_PROCESS_LOOPBACK_PARAMS {
                TargetProcessId: pid,
                ProcessLoopbackMode: mode,
            },
        },
    };
    // The parameters go in as a blob (they stay alive on this stack frame until activation is done).
    let prop = PROPVARIANT {
        Anonymous: PROPVARIANT_0 {
            Anonymous: std::mem::ManuallyDrop::new(PROPVARIANT_0_0 {
                vt: VT_BLOB,
                wReserved1: 0,
                wReserved2: 0,
                wReserved3: 0,
                Anonymous: PROPVARIANT_0_0_0 {
                    blob: BLOB {
                        cbSize: std::mem::size_of::<AUDIOCLIENT_ACTIVATION_PARAMS>() as u32,
                        pBlobData: std::ptr::addr_of_mut!(params).cast(),
                    },
                },
            }),
        },
    };
    let (tx, rx) = sync_channel(1);
    let handler: IActivateAudioInterfaceCompletionHandler = Activated {
        done: Mutex::new(Some(tx)),
    }
    .into();
    // SAFETY: valid device path, interface id and parameters, which outlive the wait below.
    let op = unsafe {
        ActivateAudioInterfaceAsync(
            VIRTUAL_AUDIO_DEVICE_PROCESS_LOOPBACK,
            &IAudioClient::IID,
            Some(&raw const prop),
            &handler,
        )
    }
    .map_err(|e| explain("Windows did not start taking the sound", &e))?;
    rx.recv_timeout(Duration::from_secs(5))
        .map_err(|_| "Windows did not answer in time; trying again.".to_owned())?;
    let mut result = HRESULT(0);
    let mut unknown = None;
    // SAFETY: the operation has completed (the handler was called).
    unsafe { op.GetActivateResult(&mut result, &mut unknown) }
        .map_err(|e| explain("Windows did not start taking the sound", &e))?;
    result
        .ok()
        .map_err(|e| explain("Windows did not start taking the sound", &e))?;
    let unknown = unknown.ok_or("Windows gave no sound device")?;
    unknown
        .cast::<IAudioClient>()
        .map_err(|e| explain("Windows gave the wrong kind of sound device", &e))
}

pub fn run(
    target: Target,
    mut sink: Sink,
    stop: Arc<AtomicBool>,
    ended: Arc<AtomicBool>,
    error: Arc<Mutex<Option<String>>>,
) -> Result<JoinHandle<()>, String> {
    let (ready_tx, ready_rx) = sync_channel::<Result<(), String>>(1);
    let handle = thread::Builder::new()
        .name("lumora-computer-sound".into())
        .spawn(move || {
            // SAFETY: COM is started and stopped on this thread only.
            let com = unsafe { CoInitializeEx(None, COINIT_MULTITHREADED) }.is_ok();
            // SAFETY: COM is started on this thread.
            let outcome = unsafe { capture(target, &mut sink, &stop, &ready_tx) };
            if let Err(e) = outcome {
                // Before it started: the caller hears it; after: kept for `error()`.
                if ready_tx.try_send(Err(e.clone())).is_err() {
                    *error.lock().unwrap_or_else(PoisonError::into_inner) = Some(e);
                }
            }
            ended.store(true, Ordering::Release);
            if com {
                // SAFETY: matched with the start above, on the same thread.
                unsafe { CoUninitialize() };
            }
        })
        .map_err(|e| e.to_string())?;
    match ready_rx.recv_timeout(Duration::from_secs(8)) {
        Ok(Ok(())) => Ok(handle),
        Ok(Err(e)) => {
            let _ = handle.join();
            Err(e)
        }
        Err(_) => Err("Windows did not start taking the sound in time.".to_owned()),
    }
}

/// Take the sound until `stop`; `ready` hears once it has started.
///
/// SAFETY (for callers): COM is started on this thread.
unsafe fn capture(
    target: Target,
    sink: &mut Sink,
    stop: &AtomicBool,
    ready: &SyncSender<Result<(), String>>,
) -> Result<(), String> {
    // SAFETY: COM is started on this thread (the caller's promise).
    let client = unsafe { activate(target) }?;
    let fmt = format();
    // SAFETY: a valid format; shared mode with Windows converting to it; 200 ms of room.
    unsafe {
        client.Initialize(
            AUDCLNT_SHAREMODE_SHARED,
            AUDCLNT_STREAMFLAGS_LOOPBACK
                | AUDCLNT_STREAMFLAGS_EVENTCALLBACK
                | AUDCLNT_STREAMFLAGS_AUTOCONVERTPCM
                | AUDCLNT_STREAMFLAGS_SRC_DEFAULT_QUALITY,
            2_000_000,
            0,
            &raw const fmt,
            None,
        )
    }
    .map_err(|e| explain("Windows refused the sound format", &e))?;
    // SAFETY: an unnamed auto-reset event.
    let event = Event(
        unsafe { CreateEventW(None, false, false, None) }.map_err(|e| e.message().to_string())?,
    );
    // SAFETY: the event lives as long as the client is used (both end with this function).
    unsafe { client.SetEventHandle(event.0) }.map_err(|e| e.message().to_string())?;
    // SAFETY: the client is initialized.
    let reader: IAudioCaptureClient =
        unsafe { client.GetService() }.map_err(|e| e.message().to_string())?;
    // SAFETY: the client is initialized.
    unsafe { client.Start() }.map_err(|e| explain("Windows did not start the sound", &e))?;
    let _ = ready.try_send(Ok(()));
    let mut piece: Vec<u8> = Vec::with_capacity(48_000 / 50 * FRAME_BYTES);
    let result = loop {
        if stop.load(Ordering::Acquire) {
            break Ok(());
        }
        // SAFETY: a valid event handle.
        let woke = unsafe { WaitForSingleObject(event.0, 100) };
        if woke != WAIT_OBJECT_0 {
            continue;
        }
        if let Err(e) = unsafe { drain(&reader, &mut piece) } {
            break Err(explain("The sound stopped", &e));
        }
        if !piece.is_empty() {
            sink(&piece);
            piece.clear();
        }
    };
    // SAFETY: started above.
    let _ = unsafe { client.Stop() };
    result
}

/// Every packet waiting, appended to `out` (silence where Windows says so).
///
/// SAFETY (for callers): `reader` belongs to a started client.
unsafe fn drain(reader: &IAudioCaptureClient, out: &mut Vec<u8>) -> windows::core::Result<()> {
    loop {
        // SAFETY: as above.
        let waiting = unsafe { reader.GetNextPacketSize() }?;
        if waiting == 0 {
            return Ok(());
        }
        let mut data: *mut u8 = std::ptr::null_mut();
        let mut frames = 0u32;
        let mut flags = 0u32;
        // SAFETY: valid out-pointers; the buffer is read before it is released.
        unsafe { reader.GetBuffer(&mut data, &mut frames, &mut flags, None, None) }?;
        let len = frames as usize * FRAME_BYTES;
        if flags & (AUDCLNT_BUFFERFLAGS_SILENT.0 as u32) != 0 || data.is_null() {
            out.resize(out.len() + len, 0);
        } else {
            // SAFETY: Windows hands `frames` frames of the asked-for format at `data`.
            out.extend_from_slice(unsafe { std::slice::from_raw_parts(data, len) });
        }
        // SAFETY: releasing exactly what was taken.
        unsafe { reader.ReleaseBuffer(frames) }?;
    }
}

/// A process's file name ("spotify.exe"), if it can be asked.
fn exe_of(pid: u32) -> Option<String> {
    // SAFETY: the handle is closed below; the buffer is long enough for any path.
    unsafe {
        let h = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid).ok()?;
        let mut buf = [0u16; 1024];
        let mut len = buf.len() as u32;
        let ok =
            QueryFullProcessImageNameW(h, PROCESS_NAME_WIN32, PWSTR(buf.as_mut_ptr()), &mut len)
                .is_ok();
        let _ = CloseHandle(h);
        if !ok {
            return None;
        }
        let path = String::from_utf16_lossy(&buf[..len as usize]);
        path.rsplit('\\').next().map(str::to_lowercase)
    }
}

/// The programs with a sound session on the default speakers (the Windows
/// volume mixer's list).
pub fn sessions() -> Vec<Program> {
    // SAFETY: COM is started and stopped around the calls on this thread.
    unsafe {
        let com = CoInitializeEx(None, COINIT_MULTITHREADED).is_ok();
        let list = list_sessions().unwrap_or_default();
        if com {
            CoUninitialize();
        }
        list
    }
}

/// SAFETY (for callers): COM is started on this thread.
unsafe fn list_sessions() -> windows::core::Result<Vec<Program>> {
    let mut out = Vec::new();
    // SAFETY: COM is started; every object is used on this thread.
    unsafe {
        let devices: IMMDeviceEnumerator = CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL)?;
        let speakers = devices.GetDefaultAudioEndpoint(eRender, eConsole)?;
        let manager: IAudioSessionManager2 = speakers.Activate(CLSCTX_ALL, None)?;
        let sessions = manager.GetSessionEnumerator()?;
        for i in 0..sessions.GetCount()? {
            let Ok(control) = sessions.GetSession(i) else {
                continue;
            };
            let Ok(control) = control.cast::<IAudioSessionControl2>() else {
                continue;
            };
            let Ok(pid) = control.GetProcessId() else {
                continue;
            };
            if pid == 0 {
                continue;
            }
            let name = control
                .GetDisplayName()
                .ok()
                .map(|p| {
                    let s = p.to_string().unwrap_or_default();
                    CoTaskMemFree(Some(p.0.cast()));
                    s
                })
                .unwrap_or_default();
            if let Some(exe) = exe_of(pid) {
                out.push(Program { pid, exe, name });
            }
        }
    }
    Ok(out)
}

/// Every running process: (pid, parent pid, file name).
pub fn processes() -> Vec<(u32, u32, String)> {
    let mut out = Vec::new();
    // SAFETY: the snapshot handle is closed below; the entry's size is set as required.
    unsafe {
        let Ok(snap) = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0) else {
            return out;
        };
        let mut e = PROCESSENTRY32W {
            dwSize: std::mem::size_of::<PROCESSENTRY32W>() as u32,
            ..Default::default()
        };
        let mut more = Process32FirstW(snap, &mut e).is_ok();
        while more {
            let end = e
                .szExeFile
                .iter()
                .position(|&c| c == 0)
                .unwrap_or(e.szExeFile.len());
            out.push((
                e.th32ProcessID,
                e.th32ParentProcessID,
                String::from_utf16_lossy(&e.szExeFile[..end]),
            ));
            more = Process32NextW(snap, &mut e).is_ok();
        }
        let _ = CloseHandle(snap);
    }
    out
}
