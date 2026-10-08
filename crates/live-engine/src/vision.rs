//! Background removal, blur behind people and auto-framing in the unified
//! engine, with the web's own person-finding models.
//!
//! The models (MediaPipe's selfie segmenter and person detector,
//! `app/src/engine/vision.ts`) run in a hidden web view, the **vision
//! worker** (`app/src/engine/visionWorker.ts`, window `overlay-vision`,
//! opened by the app only while an input uses them). The engine hands it
//! small copies of the frames of the cameras that use these effects — and
//! only those — and it answers with each camera's person **mask** (how sure
//! each spot is a person, 0 – 255, at the model's size), the **shot**
//! auto-framing aims for, and the picture (or virtual set) to put behind the
//! people. The engine's shader applies them in the same pass that draws the
//! camera (`compose.wgsl`: `bg0`, `bg1`), as the web picture processor does
//! (`chroma.ts`): portrait blur where there are no people, the background
//! taken away, or a picture behind, and the auto-framed shot's zoom and pan,
//! which the engine moves toward smoothly every frame ([`step_shot`]).
//!
//! **Latency.** A frame is copied small when the engine takes it (at most
//! 30 times a second, at most [`SIDE`] pixels wide, on the processor: no GPU
//! read-back), the worker is waiting for it (a long poll), the model takes
//! 5 – 15 ms on a graphics card, and the mask is used from the engine's next
//! frame. So the mask drawn on a picture was found on a frame 1 – 2 frames
//! older at 60 fps (2 – 3 when the model is slow); the web's processor
//! blends each mask with the last too, so a moving edge trails a little in
//! both. The picture itself is never held back for it.
//!
//! The formats (little endian), shared with `visionWire.ts`:
//!
//! ```text
//! frames  := "LVF1" count:u16 (id_len:u16 id:utf8 seq:u64 w:u32 h:u32 rgba{w*h*4})*
//! results := "LVR1" count:u16 result*
//! result  := id_len:u16 id:utf8 flags:u8
//!            [mask: w:u16 h:u16 bytes{w*h}]          (flags & 1; else no mask)
//!            [shot: cx:f32 cy:f32 zoom:f32]          (flags & 2; else wide)
//!            [back: w:u16 h:u16 rgba{w*h*4}]         (flags & 4: the picture behind; 0 × 0 clears it)
//!            [front: w:u16 h:u16 rgba{w*h*4}]        (flags & 8: a virtual set's desk; 0 × 0 clears it)
//! ```

use lumora_engine::vision::BackgroundMode;
use lumora_engine::{Show, Source, SourceId};

use crate::frame::{PixelFormat, VideoFrame};

/// The small copies sent to the models are at most this wide (the segmenter
/// works at 256 × 256, the detector at 320 × 320).
pub const SIDE: u32 = 320;
/// At most this many small copies a second per camera (the web's 33 ms).
pub const RATE: u32 = 30;
/// No mask or picture bigger than this (each side).
pub const MAX_SIDE: u32 = 4096;

/// Whether an input uses the person-finding models: a background that isn't
/// kept, or auto-framing done digitally (a PTZ camera is steered instead).
pub fn uses_vision(src: &Source) -> bool {
    src.background.on() || (src.auto_frame.enabled && src.ptz.is_none())
}

/// Any input in the show uses them (the app opens the vision worker then).
pub fn wanted(show: &Show) -> bool {
    show.sources
        .iter()
        .any(|s| crate::scene::is_video_kind(&s.kind) && uses_vision(s))
}

// ---------------------------------------------------------------------------
// Small copies of frames

/// A frame made small for the models: RGBA, top row first.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LowRes {
    pub id: SourceId,
    pub seq: u64,
    pub w: u32,
    pub h: u32,
    pub rgba: Vec<u8>,
}

/// The size a `w` × `h` frame is made small to (at most `side` wide, its own shape, even).
pub fn small_size(w: u32, h: u32, side: u32) -> (u32, u32) {
    if w == 0 || h == 0 {
        return (0, 0);
    }
    let sw = w.min(side).max(2) & !1;
    let sh = ((u64::from(h) * u64::from(sw) / u64::from(w)) as u32).max(2) & !1;
    (sw, sh)
}

fn clamp8(v: f32) -> u8 {
    v.round().clamp(0.0, 255.0) as u8
}

/// One NV12 sample as RGB (limited range; BT.709 for HD, BT.601 below, as `yuv.wgsl`).
fn yuv_rgb(y: u8, u: u8, v: u8, hd: bool) -> [u8; 3] {
    let y = (f32::from(y) - 16.0) * (255.0 / 219.0);
    let u = (f32::from(u) - 128.0) * (255.0 / 224.0);
    let v = (f32::from(v) - 128.0) * (255.0 / 224.0);
    let (r, g, b) = if hd {
        (y + 1.5748 * v, y - 0.1873 * u - 0.4681 * v, y + 1.8556 * u)
    } else {
        (
            y + 1.402 * v,
            y - 0.344_136 * u - 0.714_136 * v,
            y + 1.772 * u,
        )
    };
    [clamp8(r), clamp8(g), clamp8(b)]
}

/// A frame made small (nearest sample of each spot; the models don't need
/// more), at most `side` wide. None when the frame is empty or short.
pub fn downscale(id: &SourceId, f: &VideoFrame, side: u32) -> Option<LowRes> {
    let (w, h) = small_size(f.width, f.height, side);
    let data = f.data.as_slice();
    if w == 0 || data.len() < f.format.frame_len(f.width, f.height) {
        return None;
    }
    let mut rgba = Vec::with_capacity((w * h * 4) as usize);
    let (fw, fh) = (f.width as usize, f.height as usize);
    let hd = f.height >= 720;
    for y in 0..h as usize {
        let sy = ((y * 2 + 1) * fh / (h as usize * 2)).min(fh - 1);
        for x in 0..w as usize {
            let sx = ((x * 2 + 1) * fw / (w as usize * 2)).min(fw - 1);
            let px = match f.format {
                PixelFormat::Rgba8 => {
                    let i = (sy * fw + sx) * 4;
                    [data[i], data[i + 1], data[i + 2], data[i + 3]]
                }
                PixelFormat::Bgra8 | PixelFormat::Bgrx8 => {
                    let i = (sy * fw + sx) * 4;
                    let a = if f.format == PixelFormat::Bgrx8 {
                        255
                    } else {
                        data[i + 3]
                    };
                    [data[i + 2], data[i + 1], data[i], a]
                }
                PixelFormat::Nv12 => {
                    let yv = data[sy * fw + sx];
                    let c = fw * fh + (sy / 2) * fw + (sx / 2) * 2;
                    let [r, g, b] = yuv_rgb(yv, data[c], data[c + 1], hd);
                    [r, g, b, 255]
                }
                // HDR: made SDR as the screens show it (`hdr.rs`).
                PixelFormat::Rgb10(t) => {
                    let i = (sy * fw + sx) * 4;
                    let word = u32::from_le_bytes([data[i], data[i + 1], data[i + 2], data[i + 3]]);
                    let [r, g, b] =
                        crate::hdr::signal_to_sdr(crate::hdr::rgb10(word), t).map(crate::hdr::byte);
                    [r, g, b, 255]
                }
                PixelFormat::P010(t) => {
                    let w16 = |at: usize| u16::from_le_bytes([data[at], data[at + 1]]);
                    let yv = w16((sy * fw + sx) * 2);
                    let c = fw * fh * 2 + ((sy / 2) * fw + (sx / 2) * 2) * 2;
                    let rgb = crate::hdr::p010_rgb(yv, w16(c), w16(c + 2));
                    let [r, g, b] = crate::hdr::signal_to_sdr(rgb, t).map(crate::hdr::byte);
                    [r, g, b, 255]
                }
            };
            rgba.extend_from_slice(&px);
        }
    }
    Some(LowRes {
        id: id.clone(),
        seq: f.seq,
        w,
        h,
        rgba,
    })
}

/// The frames for the vision worker, as one message.
pub fn encode_frames(frames: &[LowRes]) -> Vec<u8> {
    let mut out = Vec::with_capacity(
        6 + frames
            .iter()
            .map(|f| 22 + f.id.as_str().len() + f.rgba.len())
            .sum::<usize>(),
    );
    out.extend_from_slice(b"LVF1");
    out.extend_from_slice(&(frames.len().min(usize::from(u16::MAX)) as u16).to_le_bytes());
    for f in frames.iter().take(usize::from(u16::MAX)) {
        let id = f.id.as_str().as_bytes();
        out.extend_from_slice(&(id.len() as u16).to_le_bytes());
        out.extend_from_slice(id);
        out.extend_from_slice(&f.seq.to_le_bytes());
        out.extend_from_slice(&f.w.to_le_bytes());
        out.extend_from_slice(&f.h.to_le_bytes());
        out.extend_from_slice(&f.rgba);
    }
    out
}

// ---------------------------------------------------------------------------
// What the worker found

/// A picture from the worker (straight-alpha RGBA, top row first).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Image {
    pub w: u32,
    pub h: u32,
    pub rgba: Vec<u8>,
}

/// What the models found for one input.
#[derive(Debug, Clone, PartialEq)]
pub struct VisionResult {
    pub id: SourceId,
    /// The person mask, `w` × `h`, one byte a spot (None: no mask now — the
    /// models are paused or failed, so the picture shows as it is).
    pub mask: Option<(u32, u32, Vec<u8>)>,
    /// Where auto-framing aims (None: wide).
    pub shot: Option<Shot>,
    /// The picture behind the people: Some(None) clears it; None leaves it as it is.
    pub back: Option<Option<Image>>,
    /// A virtual set's desk in front of them (same).
    pub front: Option<Option<Image>>,
}

struct Reader<'a> {
    b: &'a [u8],
    at: usize,
}

impl Reader<'_> {
    fn take(&mut self, n: usize) -> Result<&[u8], String> {
        let end = self
            .at
            .checked_add(n)
            .filter(|e| *e <= self.b.len())
            .ok_or("The vision message ended too soon.")?;
        let s = &self.b[self.at..end];
        self.at = end;
        Ok(s)
    }
    fn u8(&mut self) -> Result<u8, String> {
        Ok(self.take(1)?[0])
    }
    fn u16(&mut self) -> Result<u16, String> {
        let s = self.take(2)?;
        Ok(u16::from_le_bytes([s[0], s[1]]))
    }
    fn f32(&mut self) -> Result<f32, String> {
        let s = self.take(4)?;
        Ok(f32::from_le_bytes([s[0], s[1], s[2], s[3]]))
    }
    fn image(&mut self, bpp: usize) -> Result<(u32, u32, Vec<u8>), String> {
        let (w, h) = (u32::from(self.u16()?), u32::from(self.u16()?));
        if w > MAX_SIDE || h > MAX_SIDE {
            return Err(format!("A vision picture can't be {w} × {h}."));
        }
        let px = self.take(w as usize * h as usize * bpp)?.to_vec();
        Ok((w, h, px))
    }
}

/// Read the worker's results. Everything is checked; a bad message is refused whole.
///
/// # Errors
/// What is wrong with it.
pub fn parse_results(bytes: &[u8]) -> Result<Vec<VisionResult>, String> {
    let mut r = Reader { b: bytes, at: 0 };
    if r.take(4)? != b"LVR1" {
        return Err("Not a vision message.".into());
    }
    let count = r.u16()?;
    let mut out = Vec::with_capacity(usize::from(count));
    for _ in 0..count {
        let len = usize::from(r.u16()?);
        let id = std::str::from_utf8(r.take(len)?)
            .map_err(|_| "An input's id is not text.".to_owned())?;
        let id = SourceId::new(id);
        let flags = r.u8()?;
        if flags & !0x0f != 0 {
            return Err(format!("Unknown vision flags {flags:#x}."));
        }
        let mask = if flags & 1 != 0 {
            let (w, h, px) = r.image(1)?;
            (w > 0 && h > 0).then_some((w, h, px))
        } else {
            None
        };
        let shot = if flags & 2 != 0 {
            let (cx, cy, zoom) = (r.f32()?, r.f32()?, r.f32()?);
            if !(cx.is_finite() && cy.is_finite() && zoom.is_finite()) {
                return Err("A shot that isn't a number.".into());
            }
            Some(Shot {
                cx: cx.clamp(0.0, 1.0),
                cy: cy.clamp(0.0, 1.0),
                zoom: zoom.clamp(1.0, 4.0),
            })
        } else {
            None
        };
        let mut pic = |bit: u8| -> Result<Option<Option<Image>>, String> {
            if flags & bit == 0 {
                return Ok(None);
            }
            let (w, h, rgba) = r.image(4)?;
            Ok(Some((w > 0 && h > 0).then_some(Image { w, h, rgba })))
        };
        let back = pic(4)?;
        let front = pic(8)?;
        out.push(VisionResult {
            id,
            mask,
            shot,
            back,
            front,
        });
    }
    if r.at != bytes.len() {
        return Err("A vision message has bytes left over.".into());
    }
    Ok(out)
}

/// Write results (the worker's side, in Rust: tests).
pub fn encode_results(results: &[VisionResult]) -> Vec<u8> {
    let mut out = Vec::new();
    out.extend_from_slice(b"LVR1");
    out.extend_from_slice(&(results.len() as u16).to_le_bytes());
    let img = |out: &mut Vec<u8>, w: u32, h: u32, px: &[u8]| {
        out.extend_from_slice(&(w as u16).to_le_bytes());
        out.extend_from_slice(&(h as u16).to_le_bytes());
        out.extend_from_slice(px);
    };
    for r in results {
        let id = r.id.as_str().as_bytes();
        out.extend_from_slice(&(id.len() as u16).to_le_bytes());
        out.extend_from_slice(id);
        let flags = u8::from(r.mask.is_some())
            | u8::from(r.shot.is_some()) << 1
            | u8::from(r.back.is_some()) << 2
            | u8::from(r.front.is_some()) << 3;
        out.push(flags);
        if let Some((w, h, px)) = &r.mask {
            img(&mut out, *w, *h, px);
        }
        if let Some(s) = r.shot {
            for v in [s.cx, s.cy, s.zoom] {
                out.extend_from_slice(&v.to_le_bytes());
            }
        }
        for p in [&r.back, &r.front].into_iter().flatten() {
            match p {
                Some(i) => img(&mut out, i.w, i.h, &i.rgba),
                None => img(&mut out, 0, 0, &[]),
            }
        }
    }
    out
}

// ---------------------------------------------------------------------------
// Auto-framing: the shot (a port of `vision.ts`)

/// Where the shot is: its center (0 – 1) and how far it is zoomed in (1: the whole picture).
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Shot {
    pub cx: f32,
    pub cy: f32,
    pub zoom: f32,
}

pub const WIDE: Shot = Shot {
    cx: 0.5,
    cy: 0.5,
    zoom: 1.0,
};

/// Move the shot a step toward where it should be: calm, never jumpy (`stepShot`).
pub fn step_shot(cur: Shot, target: Shot, speed: f32, dt_ms: f32) -> Shot {
    let rate = 0.5 + speed.clamp(0.0, 1.0) * 3.0;
    let k = 1.0 - (-rate * dt_ms.clamp(0.0, 200.0) / 1000.0).exp();
    let (cz, tz) = (cur.zoom.max(1e-3), target.zoom.max(1e-3));
    let zoom = (cz.ln() + (tz.ln() - cz.ln()) * k).exp();
    Shot {
        cx: cur.cx + (target.cx - cur.cx) * k,
        cy: cur.cy + (target.cy - cur.cy) * k,
        zoom,
    }
}

/// The picture processor's zoom and pan for a shot (`shotToView`): zoom, pan x, pan y.
pub fn shot_to_view(s: Shot) -> (f32, f32, f32) {
    let room = 0.5 - 0.5 / s.zoom.max(1e-3);
    if room < 1e-4 {
        return (1.0, 0.0, 0.0);
    }
    let c = |v: f32| v.clamp(-1.0, 1.0);
    (s.zoom, c((s.cx - 0.5) / room), c((s.cy - 0.5) / room))
}

/// One input's auto-framing as the engine moves it: where it aims, and where it is.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Framing {
    pub target: Shot,
    pub shot: Shot,
    pub at: Option<u64>,
}

impl Default for Framing {
    fn default() -> Self {
        Framing {
            target: WIDE,
            shot: WIDE,
            at: None,
        }
    }
}

impl Framing {
    /// Move toward the target for show time `now` (once a frame).
    pub fn step(&mut self, now: u64, speed: f32) -> Shot {
        let dt = self.at.map_or(0.0, |a| now.saturating_sub(a) as f32);
        self.shot = step_shot(self.shot, self.target, speed, dt);
        self.at = Some(now);
        self.shot
    }
}

/// How the shader treats the background (from the input's settings; see `compose.wgsl`).
pub fn mode_code(m: BackgroundMode) -> f32 {
    match m {
        BackgroundMode::Keep => 0.0,
        BackgroundMode::Blur => 1.0,
        BackgroundMode::Remove => 2.0,
        BackgroundMode::Picture | BackgroundMode::Set => 3.0,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::frame::FramePool;
    use lumora_engine::vision::{AutoFrame, Background};
    use lumora_engine::{SourceAudio, SourceKind};

    fn cam(id: &str) -> Source {
        Source {
            id: SourceId::new(id),
            name: id.into(),
            kind: SourceKind::Camera {
                device_id: id.into(),
                label: id.into(),
            },
            volume: 1.0,
            muted: false,
            looping: false,
            fit: lumora_engine::Fit::Contain,
            audio: SourceAudio::default(),
            key: Default::default(),
            adjust: Default::default(),
            speed: None,
            ptz: None,
            playlist: None,
            video_delay_ms: None,
            camera: None,
            background: Default::default(),
            auto_frame: Default::default(),
            screens: Vec::new(),
        }
    }

    #[test]
    fn only_inputs_with_the_effects_use_the_models() {
        let mut a = cam("a");
        assert!(!uses_vision(&a));
        a.background = Background {
            mode: BackgroundMode::Blur,
            ..Background::default()
        };
        assert!(uses_vision(&a));
        let mut b = cam("b");
        b.auto_frame = AutoFrame {
            enabled: true,
            ..AutoFrame::default()
        };
        assert!(uses_vision(&b));
        // A PTZ camera is steered instead of zoomed in the picture.
        b.ptz = Some(lumora_engine::ptz::Ptz::default());
        assert!(!uses_vision(&b));
    }

    #[test]
    fn frames_are_made_small_in_their_own_shape() {
        assert_eq!(small_size(1920, 1080, 320), (320, 180));
        assert_eq!(small_size(1280, 960, 320), (320, 240));
        assert_eq!(small_size(160, 90, 320), (160, 90));
        assert_eq!(small_size(0, 90, 320), (0, 0));
        let pool = FramePool::new(1);
        // NV12 red (BT.709): Y 63, U 102, V 240.
        let f = VideoFrame::build(&pool, 1280, 720, PixelFormat::Nv12, 7, |px| {
            let (y, uv) = px.split_at_mut(1280 * 720);
            y.fill(63);
            for c in uv.as_chunks_mut::<2>().0 {
                *c = [102, 240];
            }
        });
        let s = downscale(&SourceId::new("a"), &f, SIDE).unwrap();
        assert_eq!(
            (s.w, s.h, s.seq, s.rgba.len()),
            (320, 180, 7, 320 * 180 * 4)
        );
        let p = &s.rgba[..4];
        assert!(p[0] > 240 && p[1] < 15 && p[2] < 15 && p[3] == 255, "{p:?}");
        // Windows RGB32: blue, green, red, nothing — opaque.
        let f = VideoFrame::build(&pool, 64, 36, PixelFormat::Bgrx8, 1, |px| {
            for c in px.as_chunks_mut::<4>().0 {
                *c = [10, 20, 30, 0];
            }
        });
        let s = downscale(&SourceId::new("b"), &f, SIDE).unwrap();
        assert_eq!(&s.rgba[..4], &[30, 20, 10, 255]);
    }

    #[test]
    fn the_messages_go_both_ways_and_bad_ones_are_refused() {
        let frames = vec![LowRes {
            id: SourceId::new("cam"),
            seq: 3,
            w: 2,
            h: 2,
            rgba: vec![9; 16],
        }];
        let m = encode_frames(&frames);
        assert_eq!(&m[..6], b"LVF1\x01\x00");
        assert_eq!(m.len(), 6 + 2 + 3 + 8 + 8 + 16);
        let results = vec![
            VisionResult {
                id: SourceId::new("cam"),
                mask: Some((4, 2, vec![200; 8])),
                shot: Some(Shot {
                    cx: 0.4,
                    cy: 0.5,
                    zoom: 2.0,
                }),
                back: Some(Some(Image {
                    w: 1,
                    h: 1,
                    rgba: vec![1, 2, 3, 255],
                })),
                front: Some(None),
            },
            VisionResult {
                id: SourceId::new("b"),
                mask: None,
                shot: None,
                back: None,
                front: None,
            },
        ];
        let bytes = encode_results(&results);
        assert_eq!(parse_results(&bytes).unwrap(), results);
        // Cut short, bytes left over, unknown flags, too big: refused whole.
        assert!(parse_results(&bytes[..bytes.len() - 1]).is_err());
        let mut more = bytes.clone();
        more.push(0);
        assert!(parse_results(&more).is_err());
        let mut bad = encode_results(&results[1..]);
        let n = bad.len();
        bad[n - 1] = 0x10;
        assert!(parse_results(&bad).is_err());
        let mut huge = b"LVR1\x01\x00\x01\x00a\x01".to_vec();
        huge.extend_from_slice(&5000u16.to_le_bytes());
        huge.extend_from_slice(&1u16.to_le_bytes());
        assert!(parse_results(&huge).unwrap_err().contains("can't be"));
        assert!(parse_results(b"NOPE\x00\x00").is_err());
    }

    #[test]
    fn the_same_bytes_as_the_web_side() {
        // visionWire.test.ts checks these very bytes.
        let frames = encode_frames(&[LowRes {
            id: SourceId::new("cam"),
            seq: 7,
            w: 1,
            h: 1,
            rgba: vec![9, 8, 7, 255],
        }]);
        let hex = |b: &[u8]| b.iter().map(|x| format!("{x:02x}")).collect::<String>();
        assert_eq!(
            hex(&frames),
            "4c5646310100030063616d07000000000000000100000001000000090807ff"
        );
        let results = encode_results(&[VisionResult {
            id: SourceId::new("cam"),
            mask: Some((2, 1, vec![0, 255])),
            shot: Some(Shot {
                cx: 0.25,
                cy: 0.5,
                zoom: 2.0,
            }),
            back: Some(Some(Image {
                w: 1,
                h: 1,
                rgba: vec![1, 2, 3, 255],
            })),
            front: Some(None),
        }]);
        assert_eq!(
            hex(&results),
            "4c5652310100030063616d0f0200010000ff0000803e0000003f0000004001000100010203ff00000000"
        );
    }

    #[test]
    fn the_shot_moves_calmly_as_on_the_web() {
        // vision.test.ts: "moves calmly, not in one jump".
        let target = Shot {
            cx: 0.8,
            cy: 0.5,
            zoom: 2.0,
        };
        let next = step_shot(WIDE, target, 0.4, 33.0);
        assert!(next.cx > 0.5 && next.cx < 0.6, "{next:?}");
        assert!(next.zoom > 1.0 && next.zoom < 1.2);
        // A long gap counts as 200 ms at most.
        let far = step_shot(WIDE, target, 1.0, 10_000.0);
        let capped = step_shot(WIDE, target, 1.0, 200.0);
        assert_eq!(far, capped);
        // Over a few seconds it gets there.
        let mut f = Framing {
            target,
            ..Framing::default()
        };
        for i in 0..300 {
            f.step(i * 16, 0.4);
        }
        assert!((f.shot.cx - 0.8).abs() < 0.01 && (f.shot.zoom - 2.0).abs() < 0.02);
    }

    #[test]
    fn a_shot_becomes_the_processors_zoom_and_pan() {
        // vision.test.ts: "turns a shot into the picture processor's zoom and pan".
        assert_eq!(shot_to_view(WIDE), (1.0, 0.0, 0.0));
        let (z, x, y) = shot_to_view(Shot {
            cx: 0.75,
            cy: 0.5,
            zoom: 2.0,
        });
        assert_eq!((z, x, y), (2.0, 1.0, 0.0));
        let (_, x, _) = shot_to_view(Shot {
            cx: 0.0,
            cy: 0.5,
            zoom: 2.0,
        });
        assert_eq!(x, -1.0);
    }
}
