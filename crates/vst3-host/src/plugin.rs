//! One effect opened from a plug-in file: its processor and its controller
//! (one object, or two joined to each other), its parameters, its state, and
//! sound run through it offline, a block at a time.
#![allow(unsafe_code)]

use std::ffi::c_void;
use std::rc::Rc;
use std::sync::{Arc, Mutex};

use crate::com::{
    results, wide_text, AudioBusBuffers, BusInfo, ComPtr, IAudioProcessorVtbl, IComponentVtbl,
    IConnectionPointVtbl, IEditControllerVtbl, ParameterInfo, ProcessData, ProcessSetup, Tuid,
    DIR_INPUT, DIR_OUTPUT, IAUDIO_PROCESSOR, ICOMPONENT, ICONNECTION_POINT, IEDIT_CONTROLLER,
    IO_OFFLINE, MEDIA_AUDIO, MODE_OFFLINE, PARAM_IS_BYPASS, PARAM_IS_HIDDEN, PARAM_IS_READ_ONLY,
    SAMPLE32, SPEAKER_MONO, SPEAKER_STEREO,
};
use crate::module::Module;
use crate::objects::{self, Edits};

/// A parameter as the settings show it.
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Param {
    pub id: u32,
    pub title: String,
    pub units: String,
    /// 0: continuous; 1: on/off; more: that many steps.
    pub steps: i32,
    /// 0–1.
    pub default: f64,
    pub value: f64,
    /// The value as the plug-in writes it ("-6.0 dB").
    pub text: String,
    /// The plug-in's own bypass switch.
    pub bypass: bool,
}

/// How many samples go through at a time.
pub const BLOCK: usize = 1024;

pub struct Plugin {
    // Field order is drop order: the processor's interface goes before the component
    // (some plug-ins make them two objects), and both before the module that made them.
    processor: ComPtr,
    component: ComPtr,
    controller: Option<ComPtr>,
    /// The controller is a second object (initialized and terminated on its own).
    separate: bool,
    /// The processor's and controller's connection points, joined to each other.
    joined: Option<(ComPtr, ComPtr)>,
    host: *mut c_void,
    handler: *mut c_void,
    /// Values the plug-in set itself (its own window).
    pub edits: Edits,
    /// Values to give the processor with the next block.
    pending: Vec<(u32, f64)>,
    channels: (usize, usize),
    _module: Rc<Module>,
}

impl Plugin {
    /// Open an effect of a plug-in file.
    ///
    /// # Errors
    /// It isn't a sound effect, or it wouldn't start.
    pub fn open(module: Rc<Module>, cid: &Tuid) -> Result<Self, String> {
        let component = module.create(cid, &ICOMPONENT)?;
        let host = objects::new_host();
        let edits: Edits = Arc::new(Mutex::new(Vec::new()));
        let handler = objects::new_handler(Arc::clone(&edits));
        // SAFETY: IComponent's initialize(context) with our host object.
        let ok = unsafe {
            (component.vtbl::<IComponentVtbl>().base.initialize)(component.as_ptr(), host)
        };
        if ok != results::OK {
            // SAFETY: our references.
            unsafe {
                objects::release(host);
                objects::release(handler);
            }
            return Err("The plug-in would not start.".into());
        }
        let Some(processor) = component.query(&IAUDIO_PROCESSOR) else {
            // SAFETY: initialized above; our references.
            unsafe {
                (component.vtbl::<IComponentVtbl>().base.terminate)(component.as_ptr());
                objects::release(host);
                objects::release(handler);
            }
            return Err("That plug-in doesn't process sound.".into());
        };
        let mut plugin = Self {
            processor,
            component,
            controller: None,
            separate: false,
            joined: None,
            host,
            handler,
            edits,
            pending: Vec::new(),
            channels: (2, 2),
            _module: Rc::clone(&module),
        };
        plugin.open_controller(&module);
        plugin.arrange();
        // The controller starts from the processor's state.
        let state = plugin.component_state();
        plugin.controller_take_component_state(&state);
        Ok(plugin)
    }

    /// Its controller: the component itself, or a second object joined to it.
    fn open_controller(&mut self, module: &Module) {
        if let Some(c) = self.component.query(&IEDIT_CONTROLLER) {
            self.controller = Some(c);
        } else {
            let mut cid: Tuid = [0; 16];
            // SAFETY: getControllerClassId fills a 16-byte id.
            let r = unsafe {
                (self
                    .component
                    .vtbl::<IComponentVtbl>()
                    .get_controller_class_id)(self.component.as_ptr(), &mut cid)
            };
            if r == results::OK && cid != [0; 16] {
                if let Ok(c) = module.create(&cid, &IEDIT_CONTROLLER) {
                    // SAFETY: IEditController's initialize with our host object.
                    let ok = unsafe {
                        (c.vtbl::<IEditControllerVtbl>().base.initialize)(c.as_ptr(), self.host)
                    };
                    if ok == results::OK {
                        self.controller = Some(c);
                        self.separate = true;
                    }
                }
            }
        }
        let Some(ctrl) = &self.controller else { return };
        // SAFETY: setComponentHandler with our handler (the controller adds its own reference).
        unsafe {
            (ctrl.vtbl::<IEditControllerVtbl>().set_component_handler)(ctrl.as_ptr(), self.handler)
        };
        if self.separate {
            if let (Some(a), Some(b)) = (
                self.component.query(&ICONNECTION_POINT),
                ctrl.query(&ICONNECTION_POINT),
            ) {
                // SAFETY: IConnectionPoint::connect each way, as hosts do.
                unsafe {
                    (a.vtbl::<IConnectionPointVtbl>().connect)(a.as_ptr(), b.as_ptr());
                    (b.vtbl::<IConnectionPointVtbl>().connect)(b.as_ptr(), a.as_ptr());
                }
                self.joined = Some((a, b));
            }
        }
    }

    fn bus_channels(&self, dir: i32) -> Option<usize> {
        let c = &self.component;
        // SAFETY: IComponent's getBusCount and getBusInfo for the main audio bus.
        unsafe {
            let v = c.vtbl::<IComponentVtbl>();
            if (v.get_bus_count)(c.as_ptr(), MEDIA_AUDIO, dir) < 1 {
                return None;
            }
            let mut info: BusInfo = std::mem::zeroed();
            ((v.get_bus_info)(c.as_ptr(), MEDIA_AUDIO, dir, 0, &mut info) == results::OK)
                .then(|| usize::try_from(info.channel_count).unwrap_or(0))
        }
    }

    /// Stereo in and out when it takes it, otherwise what it has; the main buses on.
    fn arrange(&mut self) {
        let ins = self.bus_channels(DIR_INPUT).unwrap_or(0);
        let outs = self.bus_channels(DIR_OUTPUT).unwrap_or(2);
        let c = &self.component;
        let p = &self.processor;
        // SAFETY: IComponent::setIoMode/activateBus and IAudioProcessor::setBusArrangements, with arrays of our own.
        unsafe {
            let cv = c.vtbl::<IComponentVtbl>();
            (cv.set_io_mode)(c.as_ptr(), IO_OFFLINE);
            let pv = p.vtbl::<IAudioProcessorVtbl>();
            let mut stereo_in = [SPEAKER_STEREO];
            let mut stereo_out = [SPEAKER_STEREO];
            let n_in = i32::from(ins > 0);
            let stereo = (pv.set_bus_arrangements)(
                p.as_ptr(),
                stereo_in.as_mut_ptr(),
                n_in,
                stereo_out.as_mut_ptr(),
                1,
            ) == results::OK;
            self.channels = if stereo {
                (if ins > 0 { 2 } else { 0 }, 2)
            } else {
                // Not stereo: mono if it takes that, else whatever it was made with.
                let mut mono_in = [SPEAKER_MONO];
                let mut mono_out = [SPEAKER_MONO];
                if (pv.set_bus_arrangements)(
                    p.as_ptr(),
                    mono_in.as_mut_ptr(),
                    n_in,
                    mono_out.as_mut_ptr(),
                    1,
                ) == results::OK
                {
                    (if ins > 0 { 1 } else { 0 }, 1)
                } else {
                    (ins.min(8), outs.clamp(1, 8))
                }
            };
            if ins > 0 {
                (cv.activate_bus)(c.as_ptr(), MEDIA_AUDIO, DIR_INPUT, 0, 1);
            }
            (cv.activate_bus)(c.as_ptr(), MEDIA_AUDIO, DIR_OUTPUT, 0, 1);
        }
    }

    /// The channels it reads and writes.
    #[must_use]
    pub fn channels(&self) -> (usize, usize) {
        self.channels
    }

    /// The processor's state (its settings, as the plug-in saves them).
    #[must_use]
    pub fn component_state(&self) -> Vec<u8> {
        let s = objects::new_stream(Vec::new());
        // SAFETY: IComponent::getState into our stream; then its bytes, then our reference released.
        unsafe {
            (self.component.vtbl::<IComponentVtbl>().get_state)(self.component.as_ptr(), s);
            let bytes = objects::stream_bytes(s);
            objects::release(s);
            bytes
        }
    }

    fn controller_state(&self) -> Vec<u8> {
        let Some(c) = &self.controller else {
            return Vec::new();
        };
        let s = objects::new_stream(Vec::new());
        // SAFETY: IEditController::getState into our stream.
        unsafe {
            (c.vtbl::<IEditControllerVtbl>().get_state)(c.as_ptr(), s);
            let bytes = objects::stream_bytes(s);
            objects::release(s);
            bytes
        }
    }

    fn controller_take_component_state(&self, state: &[u8]) {
        let Some(c) = &self.controller else { return };
        let s = objects::new_stream(state.to_vec());
        // SAFETY: IEditController::setComponentState from our stream.
        unsafe {
            (c.vtbl::<IEditControllerVtbl>().set_component_state)(c.as_ptr(), s);
            objects::release(s);
        }
    }

    /// Everything to restore it: the processor's and the controller's states, in one.
    #[must_use]
    pub fn state(&self) -> Vec<u8> {
        pack_state(&self.component_state(), &self.controller_state())
    }

    /// Restore what `state` saved.
    ///
    /// # Errors
    /// It isn't a state this kind of plug-in saved.
    pub fn restore(&mut self, state: &[u8]) -> Result<(), String> {
        let (comp, ctrl) = unpack_state(state).ok_or("That plug-in setting is damaged.")?;
        let s = objects::new_stream(comp.to_vec());
        // SAFETY: IComponent::setState from our stream.
        let r = unsafe {
            let r = (self.component.vtbl::<IComponentVtbl>().set_state)(self.component.as_ptr(), s);
            objects::release(s);
            r
        };
        if r != results::OK && !comp.is_empty() {
            return Err("The plug-in didn't take its saved settings.".into());
        }
        self.controller_take_component_state(comp);
        if let (Some(c), false) = (&self.controller, ctrl.is_empty()) {
            let s = objects::new_stream(ctrl.to_vec());
            // SAFETY: IEditController::setState from our stream.
            unsafe {
                (c.vtbl::<IEditControllerVtbl>().set_state)(c.as_ptr(), s);
                objects::release(s);
            }
        }
        Ok(())
    }

    /// Its parameters (hidden and read-only ones left out), with their values now.
    #[must_use]
    pub fn params(&self) -> Vec<Param> {
        let Some(c) = &self.controller else {
            return Vec::new();
        };
        let mut out = Vec::new();
        // SAFETY: IEditController's parameter functions, with structures of our own.
        unsafe {
            let v = c.vtbl::<IEditControllerVtbl>();
            let n = (v.get_parameter_count)(c.as_ptr()).clamp(0, 4096);
            for i in 0..n {
                let mut info: ParameterInfo = std::mem::zeroed();
                if (v.get_parameter_info)(c.as_ptr(), i, &mut info) != results::OK {
                    continue;
                }
                let flags = info.flags;
                if flags & (PARAM_IS_HIDDEN | PARAM_IS_READ_ONLY) != 0 {
                    continue;
                }
                let id = info.id;
                let value = (v.get_param_normalized)(c.as_ptr(), id);
                let title = { info.title };
                let units = { info.units };
                out.push(Param {
                    id,
                    title: wide_text(&title),
                    units: wide_text(&units),
                    steps: info.step_count,
                    default: info.default_normalized_value,
                    value,
                    text: self.text_of(id, value),
                    bypass: flags & PARAM_IS_BYPASS != 0,
                });
            }
        }
        out
    }

    /// A value as the plug-in writes it.
    #[must_use]
    pub fn text_of(&self, id: u32, value: f64) -> String {
        let Some(c) = &self.controller else {
            return String::new();
        };
        let mut s = [0u16; 128];
        // SAFETY: getParamStringByValue fills a String128.
        let r = unsafe {
            (c.vtbl::<IEditControllerVtbl>().get_param_string_by_value)(
                c.as_ptr(),
                id,
                value,
                &mut s,
            )
        };
        if r == results::OK {
            wide_text(&s)
        } else {
            format!("{:.0}%", value * 100.0)
        }
    }

    /// The controller (for the plug-in's own window).
    #[must_use]
    pub fn controller(&self) -> Option<&ComPtr> {
        self.controller.as_ref()
    }

    /// The values the plug-in's own window changed, given to the processor (each parameter's last).
    pub fn take_edits(&mut self) {
        let edits: Vec<(u32, f64)> = self
            .edits
            .lock()
            .map(|mut e| std::mem::take(&mut *e))
            .unwrap_or_default();
        for (id, v) in edits {
            self.pending.retain(|(x, _)| *x != id);
            self.pending.push((id, v.clamp(0.0, 1.0)));
        }
    }

    /// Set a parameter (0–1): the controller now, the processor with the next block.
    pub fn set(&mut self, id: u32, value: f64) {
        let v = value.clamp(0.0, 1.0);
        if let Some(c) = &self.controller {
            // SAFETY: IEditController::setParamNormalized.
            unsafe { (c.vtbl::<IEditControllerVtbl>().set_param_normalized)(c.as_ptr(), id, v) };
        }
        self.pending.retain(|(x, _)| *x != id);
        self.pending.push((id, v));
    }

    /// Get ready to run sound at a rate.
    fn start(&mut self, rate: f64) -> Result<(), String> {
        let mut setup = ProcessSetup {
            process_mode: MODE_OFFLINE,
            symbolic_sample_size: SAMPLE32,
            max_samples_per_block: BLOCK as i32,
            sample_rate: rate,
        };
        // SAFETY: IAudioProcessor::setupProcessing, then IComponent::setActive and setProcessing, as the SDK's order says.
        unsafe {
            let pv = self.processor.vtbl::<IAudioProcessorVtbl>();
            if (pv.can_process_sample_size)(self.processor.as_ptr(), SAMPLE32) != results::OK {
                return Err("The plug-in can't run 32-bit sound.".into());
            }
            if (pv.setup_processing)(self.processor.as_ptr(), &mut setup) != results::OK {
                return Err("The plug-in couldn't get ready at this sample rate.".into());
            }
            if (self.component.vtbl::<IComponentVtbl>().set_active)(self.component.as_ptr(), 1)
                != results::OK
            {
                return Err("The plug-in wouldn't start processing.".into());
            }
            // Some plug-ins don't implement it (they answer "not implemented"): fine.
            (pv.set_processing)(self.processor.as_ptr(), 1);
        }
        Ok(())
    }

    fn stop(&mut self) {
        // SAFETY: the reverse of `start`.
        unsafe {
            (self.processor.vtbl::<IAudioProcessorVtbl>().set_processing)(
                self.processor.as_ptr(),
                0,
            );
            (self.component.vtbl::<IComponentVtbl>().set_active)(self.component.as_ptr(), 0);
        }
    }

    /// The samples it delays its output by.
    fn latency(&self) -> usize {
        // SAFETY: IAudioProcessor::getLatencySamples.
        let l = unsafe {
            (self
                .processor
                .vtbl::<IAudioProcessorVtbl>()
                .get_latency_samples)(self.processor.as_ptr())
        };
        (l as usize).min(1 << 20)
    }

    /// Run one block (each channel `n` samples) into `out`.
    fn block(
        &mut self,
        input: &mut [Vec<f32>],
        out: &mut [Vec<f32>],
        n: usize,
    ) -> Result<(), String> {
        let mut in_ptrs: Vec<*mut f32> = input.iter_mut().map(|c| c.as_mut_ptr()).collect();
        let mut out_ptrs: Vec<*mut f32> = out.iter_mut().map(|c| c.as_mut_ptr()).collect();
        let mut in_bus = AudioBusBuffers {
            num_channels: in_ptrs.len() as i32,
            silence_flags: 0,
            channel_buffers32: in_ptrs.as_mut_ptr(),
        };
        let mut out_bus = AudioBusBuffers {
            num_channels: out_ptrs.len() as i32,
            silence_flags: 0,
            channel_buffers32: out_ptrs.as_mut_ptr(),
        };
        let changes = (!self.pending.is_empty()).then(|| objects::new_changes(&self.pending));
        let out_changes = objects::new_changes(&[]);
        let mut data = ProcessData {
            process_mode: MODE_OFFLINE,
            symbolic_sample_size: SAMPLE32,
            num_samples: n as i32,
            num_inputs: i32::from(!input.is_empty()),
            num_outputs: 1,
            inputs: if input.is_empty() {
                std::ptr::null_mut()
            } else {
                &mut in_bus
            },
            outputs: &mut out_bus,
            input_parameter_changes: changes.unwrap_or(std::ptr::null_mut()),
            output_parameter_changes: out_changes,
            input_events: std::ptr::null_mut(),
            output_events: std::ptr::null_mut(),
            process_context: std::ptr::null_mut(),
        };
        // SAFETY: IAudioProcessor::process with buffers that live through the call.
        let r = unsafe {
            (self.processor.vtbl::<IAudioProcessorVtbl>().process)(
                self.processor.as_ptr(),
                &mut data,
            )
        };
        // SAFETY: our references to the change lists.
        unsafe {
            if let Some(c) = changes {
                objects::release(c);
            }
            objects::release(out_changes);
        }
        self.pending.clear();
        if r == results::OK {
            Ok(())
        } else {
            Err("The plug-in stopped processing.".into())
        }
    }

    /// Give the processor the values set so far (a short silent block), so its saved state has them.
    ///
    /// # Errors
    /// It wouldn't process.
    pub fn apply(&mut self, rate: f64) -> Result<(), String> {
        if self.pending.is_empty() {
            return Ok(());
        }
        self.start(rate)?;
        let (ci, co) = self.channels;
        let mut input = vec![vec![0.0f32; 32]; ci];
        let mut out = vec![vec![0.0f32; 32]; co];
        let r = self.block(&mut input, &mut out, 32);
        self.stop();
        r
    }

    /// Run sound (channels of samples at `rate`) through it, offline. The
    /// result has as many channels and samples as the input (its delay taken out).
    ///
    /// # Errors
    /// It wouldn't process.
    pub fn run(
        &mut self,
        input: &[Vec<f32>],
        rate: f64,
        progress: &mut dyn FnMut(f64),
    ) -> Result<Vec<Vec<f32>>, String> {
        let len = input.iter().map(Vec::len).max().unwrap_or(0);
        let want = input.len().max(1);
        let (ci, co) = self.channels;
        self.start(rate)?;
        let latency = self.latency();
        let total = len + latency;
        let mut out: Vec<Vec<f32>> = vec![Vec::with_capacity(total); co];
        let mut ib = vec![vec![0.0f32; BLOCK]; ci];
        let mut ob = vec![vec![0.0f32; BLOCK]; co];
        let mut at = 0;
        let result = loop {
            if at >= total {
                break Ok(());
            }
            let n = BLOCK.min(total - at);
            // The plug-in's channels from ours: the same, repeated, or (to mono) mixed.
            for (k, ch) in ib.iter_mut().enumerate() {
                for (i, s) in ch.iter_mut().take(n).enumerate() {
                    let t = at + i;
                    *s = if ci == 1 && input.len() > 1 {
                        input
                            .iter()
                            .map(|c| c.get(t).copied().unwrap_or(0.0))
                            .sum::<f32>()
                            / input.len() as f32
                    } else {
                        input
                            .get(k % want)
                            .and_then(|c| c.get(t))
                            .copied()
                            .unwrap_or(0.0)
                    };
                }
            }
            for ch in &mut ob {
                ch[..n].fill(0.0);
            }
            if let Err(e) = self.block(&mut ib, &mut ob, n) {
                break Err(e);
            }
            for (k, ch) in out.iter_mut().enumerate() {
                ch.extend_from_slice(&ob[k][..n]);
            }
            at += n;
            progress(at as f64 / total.max(1) as f64);
        };
        self.stop();
        result?;
        // Its delay taken out, and back to our channels.
        let mut done: Vec<Vec<f32>> = (0..want)
            .map(|k| {
                out[k % co.max(1)]
                    .iter()
                    .skip(latency)
                    .take(len)
                    .copied()
                    .collect()
            })
            .collect();
        for ch in &mut done {
            for s in ch.iter_mut() {
                if !s.is_finite() {
                    *s = 0.0;
                }
            }
        }
        Ok(done)
    }
}

impl Drop for Plugin {
    fn drop(&mut self) {
        // SAFETY: tearing down in the reverse order of opening; our own references released last.
        unsafe {
            if let Some((a, b)) = self.joined.take() {
                (a.vtbl::<IConnectionPointVtbl>().disconnect)(a.as_ptr(), b.as_ptr());
                (b.vtbl::<IConnectionPointVtbl>().disconnect)(b.as_ptr(), a.as_ptr());
            }
            if let Some(c) = &self.controller {
                (c.vtbl::<IEditControllerVtbl>().set_component_handler)(
                    c.as_ptr(),
                    std::ptr::null_mut(),
                );
                if self.separate {
                    (c.vtbl::<IEditControllerVtbl>().base.terminate)(c.as_ptr());
                }
            }
            self.controller = None;
            (self.component.vtbl::<IComponentVtbl>().base.terminate)(self.component.as_ptr());
            objects::release(self.handler);
            objects::release(self.host);
        }
    }
}

/// Both states in one: "LVS3", then each as a 4-byte length and its bytes.
#[must_use]
pub fn pack_state(component: &[u8], controller: &[u8]) -> Vec<u8> {
    let mut out = Vec::with_capacity(12 + component.len() + controller.len());
    out.extend_from_slice(b"LVS3");
    for part in [component, controller] {
        out.extend_from_slice(&(part.len() as u32).to_le_bytes());
        out.extend_from_slice(part);
    }
    out
}

#[must_use]
pub fn unpack_state(bytes: &[u8]) -> Option<(&[u8], &[u8])> {
    let rest = bytes.strip_prefix(b"LVS3")?;
    let take = |b: &'_ [u8]| -> Option<(usize, usize)> {
        let n = u32::from_le_bytes(b.get(..4)?.try_into().ok()?) as usize;
        (b.len() >= 4 + n).then_some((4, 4 + n))
    };
    let (a0, a1) = take(rest)?;
    let comp = &rest[a0..a1];
    let rest = &rest[a1..];
    let (b0, b1) = take(rest)?;
    Some((comp, &rest[b0..b1]))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn states_pack_and_unpack() {
        let p = pack_state(b"abc", b"");
        assert_eq!(unpack_state(&p), Some((&b"abc"[..], &b""[..])));
        assert_eq!(unpack_state(b"LVS3\x09\0\0\0ab"), None);
        assert_eq!(unpack_state(b"nope"), None);
    }
}
