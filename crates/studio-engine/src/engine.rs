//! The engine: a thread that owns the GPU and the decoders, takes the frames
//! the editor sends, and shows each one at its moment.

use std::collections::VecDeque;
use std::path::PathBuf;
use std::sync::mpsc;
use std::sync::{Arc, Condvar, Mutex, PoisonError};
use std::thread::JoinHandle;
use std::time::{Duration, Instant};

use crate::clock::{Clock, Queue};
use crate::decode::{Decoders, Source};
use crate::gpu::{Gpu, Output, ProgramSource};
use crate::plan::{Message, VideoUse};
use crate::yuv::Matrix;

/// What the engine tells the editor.
#[derive(Debug, Clone, PartialEq)]
pub enum Event {
    /// A frame is on screen.
    Presented {
        frame: i64,
        dropped: u64,
        late: u64,
        ms: f32,
    },
    /// A frame couldn't be drawn here (the editor draws it, and others like it).
    Fallback { frame: i64, reason: String },
}

pub type Events = Arc<dyn Fn(Event) + Send + Sync>;

/// A frame read back: its number, width, height and RGBA bytes.
pub type Pixels = (i64, u32, u32, Vec<u8>);

/// Where frames are shown.
#[derive(Debug, Clone, Copy)]
pub enum Target {
    /// A window (a Win32 `HWND`), kept alive by the caller for as long as the engine runs.
    #[cfg(windows)]
    Window(isize),
    /// Nowhere: frames are read back (tests, and computers without a native window).
    Offscreen,
}

#[derive(Debug, Clone)]
pub struct Config {
    pub ffmpeg: PathBuf,
    /// Decode on the graphics card when FFmpeg can.
    pub hardware: bool,
}

#[derive(Default)]
struct Inbox {
    messages: VecDeque<Arc<Message>>,
    clock: Option<Clock>,
    /// The window's size in pixels, and whether it shows.
    view: Option<(u32, u32, bool)>,
    stop: bool,
    /// Forget pictures and decoders (the editor starts sending them again).
    reset: bool,
}

struct Shared {
    inbox: Mutex<Inbox>,
    cv: Condvar,
    /// The last frame read back (offscreen).
    pixels: Mutex<Option<Pixels>>,
    epoch: Instant,
}

pub struct Engine {
    shared: Arc<Shared>,
    thread: Option<JoinHandle<()>>,
    pub adapter: String,
}

impl Engine {
    /// Start the GPU and the drawing thread.
    ///
    /// # Errors
    /// No graphics card, or the window can't be drawn into.
    pub fn start(
        config: Config,
        target: Target,
        programs: Vec<ProgramSource>,
        events: Events,
    ) -> Result<Self, String> {
        let shared = Arc::new(Shared {
            inbox: Mutex::new(Inbox::default()),
            cv: Condvar::new(),
            pixels: Mutex::new(None),
            epoch: Instant::now(),
        });
        let (tx, rx) = mpsc::channel();
        let s = shared.clone();
        let thread = std::thread::Builder::new()
            .name("lumora-native-view".into())
            .spawn(move || {
                let worker = match Worker::new(config, target, programs, s, events) {
                    Ok(w) => {
                        let _ = tx.send(Ok(w.gpu.describe()));
                        w
                    }
                    Err(e) => {
                        let _ = tx.send(Err(e));
                        return;
                    }
                };
                worker.run();
            })
            .map_err(|e| e.to_string())?;
        let adapter = rx
            .recv_timeout(Duration::from_secs(20))
            .map_err(|_| "The graphics card took too long to start.".to_owned())??;
        Ok(Self {
            shared,
            thread: Some(thread),
            adapter,
        })
    }

    fn send(&self, f: impl FnOnce(&mut Inbox)) {
        let mut i = self
            .shared
            .inbox
            .lock()
            .unwrap_or_else(PoisonError::into_inner);
        f(&mut i);
        self.shared.cv.notify_all();
    }

    /// Seconds on the engine's clock.
    pub fn now(&self) -> f64 {
        self.shared.epoch.elapsed().as_secs_f64()
    }

    /// A frame to draw (queued for its moment, or shown now).
    pub fn submit(&self, m: Message) {
        self.send(|i| i.messages.push_back(Arc::new(m)));
    }

    /// Playing from `frame` at `speed` (0: stopped).
    pub fn play(&self, frame: f64, fps: f64, speed: f64) {
        let at = self.now();
        self.send(|i| {
            i.clock = Some(Clock {
                frame,
                at,
                fps: fps.max(1.0),
                speed,
            })
        });
    }

    /// Where the editor's playhead is (it keeps the sound, so it is the master).
    pub fn sync(&self, frame: f64, fps: f64, speed: f64) {
        let now = self.now();
        self.send(|i| {
            let mut c = i.clock.unwrap_or(Clock {
                frame,
                at: now,
                fps,
                speed,
            });
            if c.speed != speed || (c.fps - fps).abs() > 1e-6 {
                c = Clock {
                    frame,
                    at: now,
                    fps,
                    speed,
                };
            } else {
                c.sync(frame, now);
            }
            i.clock = Some(c);
        });
    }

    /// The window's size (pixels) and whether it shows.
    pub fn view(&self, w: u32, h: u32, visible: bool) {
        self.send(|i| i.view = Some((w, h, visible)));
    }

    /// Forget every picture and decoder.
    pub fn reset(&self) {
        self.send(|i| i.reset = true);
    }

    /// The last frame drawn offscreen: its number, size and RGBA bytes.
    pub fn take_pixels(&self) -> Option<Pixels> {
        self.shared
            .pixels
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .take()
    }

    /// Wait (up to `timeout`) for an offscreen frame.
    pub fn wait_pixels(&self, timeout: Duration) -> Option<Pixels> {
        let end = Instant::now() + timeout;
        while Instant::now() < end {
            if let Some(p) = self.take_pixels() {
                return Some(p);
            }
            std::thread::sleep(Duration::from_millis(5));
        }
        None
    }
}

impl Drop for Engine {
    fn drop(&mut self) {
        self.send(|i| i.stop = true);
        if let Some(t) = self.thread.take() {
            let _ = t.join();
        }
    }
}

/// How long a stopped frame waits for its video (a seek in a long-GOP file can take a while).
const STILL_WAIT: Duration = Duration::from_secs(4);

struct Worker {
    gpu: Gpu,
    surface: Option<(wgpu::Surface<'static>, Option<wgpu::SurfaceConfiguration>)>,
    decoders: Decoders,
    shared: Arc<Shared>,
    events: Events,
    queue: Queue<Arc<Message>>,
    clock: Clock,
    view: (u32, u32, bool),
    /// The frame on screen (drawn again when the window changes size).
    last: Option<Arc<Message>>,
    late: u64,
    last_event: Instant,
    /// Programs still to build while nothing else is happening.
    warm: Vec<String>,
}

impl Worker {
    fn new(
        config: Config,
        target: Target,
        programs: Vec<ProgramSource>,
        shared: Arc<Shared>,
        events: Events,
    ) -> Result<Self, String> {
        let instance = wgpu::Instance::new(wgpu::InstanceDescriptor::new_without_display_handle());
        let surface = match target {
            #[cfg(windows)]
            Target::Window(hwnd) => Some(crate::win::surface(&instance, hwnd)?),
            Target::Offscreen => None,
        };
        let mut gpu = Gpu::new(instance, surface.as_ref())?;
        let warm = programs.iter().map(|p| p.name.clone()).collect();
        gpu.set_programs(programs);
        Ok(Self {
            gpu,
            surface: surface.map(|s| (s, None)),
            decoders: Decoders::new(config.ffmpeg, config.hardware),
            shared,
            events,
            queue: Queue::new(),
            clock: Clock::stopped(0.0),
            view: (0, 0, false),
            last: None,
            late: 0,
            last_event: Instant::now(),
            warm,
        })
    }

    fn now(&self) -> f64 {
        self.shared.epoch.elapsed().as_secs_f64()
    }

    fn run(mut self) {
        let mut last_sweep = Instant::now();
        loop {
            // Wait for something to do: a message, or the next frame's moment.
            let wait = self.wait_time();
            let inbox = {
                let mut i = self
                    .shared
                    .inbox
                    .lock()
                    .unwrap_or_else(PoisonError::into_inner);
                if i.messages.is_empty()
                    && i.clock.is_none()
                    && i.view.is_none()
                    && !i.stop
                    && !i.reset
                {
                    i = self
                        .shared
                        .cv
                        .wait_timeout(i, wait)
                        .map(|x| x.0)
                        .unwrap_or_else(|e| e.into_inner().0);
                }
                std::mem::take(&mut *i)
            };
            if inbox.stop {
                return;
            }
            if inbox.reset {
                self.gpu.forget();
                self.decoders.clear();
                self.queue.clear();
                self.last = None;
            }
            if let Some(c) = inbox.clock {
                let now = self.now();
                let jumped =
                    (c.frame_at(now) - self.clock.frame_at(now)).abs() > 2.0 + c.speed.abs();
                if c.playing() && (!self.clock.playing() || jumped) {
                    // A new run: frames queued for somewhere else go (ones just sent for here stay).
                    self.queue.retain_near(c.frame_at(now), c.fps * 3.0);
                    self.queue.shown = None;
                    self.queue.dropped = 0;
                    self.late = 0;
                }
                self.clock = c;
            }
            let mut redraw = false;
            if let Some(v) = inbox.view {
                redraw = v != self.view;
                self.view = v;
            }
            let mut still: Option<Arc<Message>> = None;
            for m in inbox.messages {
                // Pictures arrive in order, whatever happens to their frames.
                self.gpu.apply_uploads(&m);
                if m.frame.now {
                    still = Some(m);
                } else {
                    self.hint(&m);
                    self.queue.push(m.frame.frame, m);
                }
            }
            if let Some(m) = still {
                self.draw(&m, true);
            } else if self.clock.playing() {
                let now = self.clock.frame_at(self.now());
                let dir = self.clock.speed.signum();
                if let Some((_, m)) = self.queue.take(now, dir) {
                    self.draw(&m, false);
                } else if redraw {
                    self.redraw();
                }
            } else if redraw {
                self.redraw();
            } else if let Some(name) = self.warm.pop() {
                // Idle: build the next program, so the first frame using it doesn't wait.
                let _ = self.gpu.prepare(&name, crate::gpu::TARGET_FORMAT);
            }
            if last_sweep.elapsed() > Duration::from_secs(1) {
                self.decoders.sweep();
                last_sweep = Instant::now();
            }
        }
    }

    fn wait_time(&self) -> Duration {
        if !self.clock.playing() {
            return if self.warm.is_empty() {
                Duration::from_millis(250)
            } else {
                Duration::ZERO
            };
        }
        let now = self.now();
        let f = self.clock.frame_at(now);
        let dir = self.clock.speed.signum();
        let next = self.queue.next_after(f, dir).map_or(f + dir, |n| n as f64);
        let at = self
            .clock
            .time_of(if dir >= 0.0 { next } else { next + 1.0 - 1e-6 })
            .unwrap_or(now + 0.01);
        Duration::from_secs_f64((at - now).clamp(0.0005, 0.05))
    }

    fn source(m: &Message, v: &VideoUse) -> Source {
        // Decoded no bigger than twice the frame's height (8K into a small viewer needn't come down the pipe whole).
        let limit = (m.frame.h * 2).max(2);
        let (w, h) = if v.h > limit {
            let h = limit;
            (
                (f64::from(v.w) * f64::from(h) / f64::from(v.h)).round() as u32,
                h,
            )
        } else {
            (v.w, v.h)
        };
        Source {
            path: v.path.clone(),
            fps: v.fps,
            w: (w.max(2) / 2) * 2,
            h: (h.max(2) / 2) * 2,
        }
    }

    /// Decoders started (or moved on) toward a frame that is coming.
    fn hint(&mut self, m: &Message) {
        for v in &m.frame.videos {
            let src = Self::source(m, v);
            self.decoders.hint(&v.key, &src, v.time);
        }
    }

    fn redraw(&mut self) {
        if let Some(m) = self.last.clone() {
            self.draw(&m, true);
        }
    }

    fn draw(&mut self, m: &Arc<Message>, still: bool) {
        let t0 = Instant::now();
        let f = &m.frame;
        // The video frames, decoded and on the GPU.
        let deadline = if still {
            Instant::now() + STILL_WAIT
        } else {
            let frame_time = 1.0 / (self.clock.fps * self.clock.speed.abs().max(1.0));
            Instant::now() + Duration::from_secs_f64(frame_time.clamp(0.004, 0.1))
        };
        let mut keys = Vec::with_capacity(f.videos.len());
        for v in &f.videos {
            let src = Self::source(m, v);
            if let Some(got) = self.decoders.get(&v.key, &src, v.time, deadline) {
                if got.late && !still {
                    self.late += 1;
                }
                self.gpu
                    .video(&v.key, got.id, got.w, got.h, &got.data, Matrix::guess(v.h));
            } else if let Some(e) = self.decoders.last_error.take() {
                (self.events)(Event::Fallback {
                    frame: f.frame,
                    reason: format!("video: {e}"),
                });
                return;
            }
            keys.push(v.key.as_str());
        }
        self.gpu.keep_videos(&keys);
        let result = match &mut self.surface {
            Some((surface, config)) => {
                let (w, h, visible) = self.view;
                if !visible || w == 0 || h == 0 {
                    Ok(())
                } else {
                    present(&mut self.gpu, surface, config, f, w, h)
                }
            }
            None => self.gpu.render(f, Output::Read).map(|px| {
                if let Some(px) = px {
                    *self
                        .shared
                        .pixels
                        .lock()
                        .unwrap_or_else(PoisonError::into_inner) = Some((f.frame, f.w, f.h, px));
                }
            }),
        };
        match result {
            Ok(()) => {
                self.last = Some(m.clone());
                let ms = t0.elapsed().as_secs_f32() * 1000.0;
                // Every stopped frame, and a few times a second while playing.
                if still || self.last_event.elapsed() > Duration::from_millis(90) {
                    self.last_event = Instant::now();
                    (self.events)(Event::Presented {
                        frame: f.frame,
                        dropped: self.queue.dropped,
                        late: self.late,
                        ms,
                    });
                }
            }
            Err(reason) => (self.events)(Event::Fallback {
                frame: f.frame,
                reason,
            }),
        }
    }
}

fn present(
    gpu: &mut Gpu,
    surface: &wgpu::Surface<'static>,
    config: &mut Option<wgpu::SurfaceConfiguration>,
    f: &crate::plan::Frame,
    w: u32,
    h: u32,
) -> Result<(), String> {
    let stale = config
        .as_ref()
        .is_none_or(|c| c.width != w || c.height != h);
    if stale {
        let caps = surface.get_capabilities(&gpu.adapter);
        // Plain 8-bit (not sRGB-encoded), as the WebGL canvas is.
        let format = caps
            .formats
            .iter()
            .copied()
            .find(|f| {
                matches!(
                    f,
                    wgpu::TextureFormat::Bgra8Unorm | wgpu::TextureFormat::Rgba8Unorm
                )
            })
            .or_else(|| caps.formats.first().copied())
            .ok_or("The window can't be drawn into.")?;
        let mode = if caps.present_modes.contains(&wgpu::PresentMode::Mailbox) {
            wgpu::PresentMode::Mailbox
        } else {
            wgpu::PresentMode::Fifo
        };
        let c = wgpu::SurfaceConfiguration {
            usage: wgpu::TextureUsages::RENDER_ATTACHMENT,
            format,
            width: w,
            height: h,
            present_mode: mode,
            desired_maximum_frame_latency: 1,
            alpha_mode: caps
                .alpha_modes
                .first()
                .copied()
                .unwrap_or(wgpu::CompositeAlphaMode::Auto),
            view_formats: vec![],
            color_space: Default::default(),
        };
        surface.configure(&gpu.device, &c);
        *config = Some(c);
    }
    let format = config
        .as_ref()
        .map_or(wgpu::TextureFormat::Bgra8Unorm, |c| c.format);
    let tex = match surface.get_current_texture() {
        wgpu::CurrentSurfaceTexture::Success(t) | wgpu::CurrentSurfaceTexture::Suboptimal(t) => t,
        wgpu::CurrentSurfaceTexture::Timeout | wgpu::CurrentSurfaceTexture::Occluded => {
            return Ok(())
        }
        _ => {
            *config = None;
            return Ok(());
        }
    };
    let view = tex
        .texture
        .create_view(&wgpu::TextureViewDescriptor::default());
    gpu.render(f, Output::View(&view, format))?;
    gpu.queue.present(tex);
    Ok(())
}
