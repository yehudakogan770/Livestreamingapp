//! The graphics layers from the web overlay renderer (one hidden WebView per
//! screen, `app/src/engine/overlayRenderer.ts`): how its frames arrive, and
//! the planes they fill.
//!
//! The renderer draws each graphic with today's Canvas code (the recorder's
//! `ProgramCompositor`, so fonts, animations and timing are the same) into
//! its own transparent **plane**:
//!
//! - `g:<input id>` — a graphics input (title, countdown, scoreboard, slides…)
//!   at the size the screen shows it (the whole screen, a split-screen box or
//!   an overlay channel's box). The engine draws it in its place among the
//!   pictures, with the transition's fade, wipe, slide, blur or luma wipe,
//!   exactly as it draws a camera.
//! - `top` — over everything but blank and PANIC (the stinger video).
//! - `panic` — the PANIC safe screen's logo, over the engine's own PANIC black.
//!
//! Only what changed is sent: a frame is a list of **records**, each a plane
//! and the rectangles of it that changed (dirty rectangles); a plane that
//! didn't change sends nothing, so a still title costs nothing after its
//! first frame. A plane no longer needed is cleared.
//!
//! The format (little endian), shared with `overlayWire.ts`:
//!
//! ```text
//! message := "LOV1" count:u16 record*
//! record  := op:u8 screen:u8 name_len:u16 name:utf8 w:u32 h:u32 at:u64 n:u32
//!            (x:u32 y:u32 rw:u32 rh:u32){n} pixels
//! op      := 1 patch (pixels: each rectangle's RGBA rows, in order) | 2 clear | 3 reset the screen
//! ```
//!
//! Pixels are straight-alpha RGBA (as `getImageData` gives them), top row first.

use lumora_engine::ScreenId;
use serde::Serialize;

pub const MAGIC: &[u8; 4] = b"LOV1";
/// No plane is bigger than this (each side).
pub const MAX_SIDE: u32 = 8192;

/// The plane for a graphics input.
pub fn graphic_plane(id: &str) -> String {
    format!("g:{id}")
}
/// Over everything but blank and PANIC.
pub const TOP: &str = "top";
/// The PANIC safe screen's logo.
pub const PANIC: &str = "panic";
/// The live captions written in the stream picture (Live; drawn only into
/// the stream and its vertical version, never on the screen or the recording).
pub const CAPTIONS: &str = "cap";
/// The stage monitor's words (the Monitor in the engine's own window).
pub const MONITOR: &str = "mon";

/// What a record does.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Op {
    /// New pixels for some rectangles of a plane.
    Patch,
    /// The plane is no longer shown.
    Clear,
    /// Every plane of the screen goes (the renderer started again).
    Reset,
}

/// A changed rectangle and where its pixels are in the message.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Rect {
    pub x: u32,
    pub y: u32,
    pub w: u32,
    pub h: u32,
    /// Byte range of its pixels in [`Message::bytes`].
    pub start: usize,
}

impl Rect {
    pub fn len(&self) -> usize {
        self.w as usize * self.h as usize * 4
    }
    pub fn is_empty(&self) -> bool {
        self.w == 0 || self.h == 0
    }
}

/// One record: a plane of a screen, and what changed in it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Record {
    pub op: Op,
    pub screen: ScreenId,
    pub name: String,
    /// The whole plane's size.
    pub w: u32,
    pub h: u32,
    /// The show time (ms) it was drawn for.
    pub at: u64,
    pub rects: Vec<Rect>,
}

/// A message from the renderer: the bytes as they arrived, and their records.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Message {
    pub bytes: Vec<u8>,
    pub records: Vec<Record>,
}

impl Message {
    /// The pixels of one rectangle.
    pub fn pixels(&self, r: &Rect) -> &[u8] {
        &self.bytes[r.start..r.start + r.len()]
    }

    /// Pixel bytes it carries (for the statistics).
    pub fn pixel_bytes(&self) -> u64 {
        self.records
            .iter()
            .flat_map(|r| r.rects.iter())
            .map(|r| r.len() as u64)
            .sum()
    }
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
            .ok_or("The graphics frame ended too soon.")?;
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
    fn u32(&mut self) -> Result<u32, String> {
        let s = self.take(4)?;
        Ok(u32::from_le_bytes([s[0], s[1], s[2], s[3]]))
    }
    fn u64(&mut self) -> Result<u64, String> {
        let s = self.take(8)?;
        let mut a = [0u8; 8];
        a.copy_from_slice(s);
        Ok(u64::from_le_bytes(a))
    }
}

fn screen_of(n: u8) -> Result<ScreenId, String> {
    match n {
        0 => Ok(ScreenId::Live),
        1 => Ok(ScreenId::Back),
        2 => Ok(ScreenId::Monitor),
        _ => Err(format!("No screen {n}.")),
    }
}

/// The number a screen is sent as.
pub fn screen_code(s: ScreenId) -> u8 {
    match s {
        ScreenId::Live => 0,
        ScreenId::Back => 1,
        ScreenId::Monitor => 2,
    }
}

/// Read a message. Everything is checked (sizes, rectangles inside their
/// plane, pixel counts): a bad message is refused whole, never half applied.
///
/// # Errors
/// What is wrong with it.
pub fn parse(bytes: Vec<u8>) -> Result<Message, String> {
    let mut r = Reader { b: &bytes, at: 0 };
    if r.take(4)? != MAGIC {
        return Err("Not a graphics frame.".into());
    }
    let count = r.u16()?;
    let mut records = Vec::with_capacity(usize::from(count));
    for _ in 0..count {
        let op = match r.u8()? {
            1 => Op::Patch,
            2 => Op::Clear,
            3 => Op::Reset,
            n => return Err(format!("Unknown graphics operation {n}.")),
        };
        let screen = screen_of(r.u8()?)?;
        let len = usize::from(r.u16()?);
        let name = std::str::from_utf8(r.take(len)?)
            .map_err(|_| "A plane's name is not text.".to_owned())?
            .to_owned();
        let (w, h) = (r.u32()?, r.u32()?);
        let at = r.u64()?;
        let n = r.u32()?;
        if op == Op::Patch && (w == 0 || h == 0 || w > MAX_SIDE || h > MAX_SIDE) {
            return Err(format!("A graphics plane can't be {w} × {h}."));
        }
        if n > 4096 {
            return Err("Too many rectangles in one graphics frame.".into());
        }
        let mut rects = Vec::with_capacity(n as usize);
        for _ in 0..n {
            let (x, y, rw, rh) = (r.u32()?, r.u32()?, r.u32()?, r.u32()?);
            let inside = x.checked_add(rw).is_some_and(|e| e <= w)
                && y.checked_add(rh).is_some_and(|e| e <= h);
            if !inside {
                return Err(format!(
                    "A rectangle {rw} × {rh} at {x}, {y} is outside its {w} × {h} plane."
                ));
            }
            rects.push(Rect {
                x,
                y,
                w: rw,
                h: rh,
                start: 0,
            });
        }
        if op != Op::Patch && !rects.is_empty() {
            return Err("Only a patch carries pixels.".into());
        }
        for rect in &mut rects {
            rect.start = r.at;
            r.take(rect.len())?;
        }
        records.push(Record {
            op,
            screen,
            name,
            w,
            h,
            at,
            rects,
        });
    }
    if r.at != bytes.len() {
        return Err("A graphics frame has bytes left over.".into());
    }
    Ok(Message { bytes, records })
}

/// One record to write: what, which screen, the plane's name and size, the
/// time it was drawn for, and its rectangles (`[x, y, w, h]` and their pixels).
pub type OutRecord<'a> = (
    Op,
    ScreenId,
    &'a str,
    u32,
    u32,
    u64,
    Vec<([u32; 4], &'a [u8])>,
);

/// Write a message (the renderer's side, in Rust: tests and the benchmark).
pub fn encode(records: &[OutRecord<'_>]) -> Vec<u8> {
    let mut out = Vec::new();
    out.extend_from_slice(MAGIC);
    out.extend_from_slice(&(records.len() as u16).to_le_bytes());
    for (op, screen, name, w, h, at, rects) in records {
        out.push(match op {
            Op::Patch => 1,
            Op::Clear => 2,
            Op::Reset => 3,
        });
        out.push(screen_code(*screen));
        out.extend_from_slice(&(name.len() as u16).to_le_bytes());
        out.extend_from_slice(name.as_bytes());
        out.extend_from_slice(&w.to_le_bytes());
        out.extend_from_slice(&h.to_le_bytes());
        out.extend_from_slice(&at.to_le_bytes());
        out.extend_from_slice(&(rects.len() as u32).to_le_bytes());
        for ([x, y, rw, rh], _) in rects {
            for v in [x, y, rw, rh] {
                out.extend_from_slice(&v.to_le_bytes());
            }
        }
        for (_, px) in rects {
            out.extend_from_slice(px);
        }
    }
    out
}

/// Among the sizes a plane is held at, the one closest to `want` (a plane is
/// drawn at the size it is shown, so normally there is exactly one).
pub fn closest(sizes: impl Iterator<Item = (u32, u32)>, want: (u32, u32)) -> Option<(u32, u32)> {
    sizes.min_by_key(|(w, h)| w.abs_diff(want.0) + h.abs_diff(want.1))
}

/// How the graphics are arriving.
#[derive(Debug, Clone, Default, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct OverlayStats {
    /// Graphics frames (messages) in the last second.
    pub frames_per_s: f32,
    /// Pixel data received, MB a second.
    pub mb_per_s: f32,
    /// From the moment a frame was drawn for to the moment the engine had
    /// it, on average (ms; negative: it arrived ahead of its time).
    pub latency_ms: f32,
    /// Planes held now.
    pub planes: usize,
    /// Messages refused (malformed).
    pub refused: u64,
}

#[cfg(test)]
mod tests {
    use super::*;

    fn px(w: u32, h: u32, v: u8) -> Vec<u8> {
        vec![v; (w * h * 4) as usize]
    }

    #[test]
    fn a_message_reads_back_as_written() {
        let a = px(2, 1, 7);
        let b = px(1, 2, 9);
        let bytes = encode(&[
            (
                Op::Patch,
                ScreenId::Live,
                "g:title",
                4,
                4,
                1234,
                vec![([0, 0, 2, 1], &a[..]), ([3, 2, 1, 2], &b[..])],
            ),
            (Op::Clear, ScreenId::Back, "top", 4, 4, 5, vec![]),
        ]);
        let m = parse(bytes).unwrap();
        assert_eq!(m.records.len(), 2);
        let r = &m.records[0];
        assert_eq!(
            (r.op, r.screen, r.name.as_str(), r.w, r.h, r.at),
            (Op::Patch, ScreenId::Live, "g:title", 4, 4, 1234)
        );
        assert_eq!(m.pixels(&r.rects[0]), &a[..]);
        assert_eq!(m.pixels(&r.rects[1]), &b[..]);
        assert_eq!(m.records[1].op, Op::Clear);
        assert_eq!(m.records[1].screen, ScreenId::Back);
        assert_eq!(m.pixel_bytes(), 16);
    }

    #[test]
    fn bad_messages_are_refused_whole() {
        let a = px(2, 2, 1);
        let ok = encode(&[(
            Op::Patch,
            ScreenId::Live,
            "top",
            4,
            4,
            0,
            vec![([0, 0, 2, 2], &a[..])],
        )]);
        assert!(parse(ok.clone()).is_ok());
        // Cut short.
        assert!(parse(ok[..ok.len() - 1].to_vec()).is_err());
        // Extra bytes.
        let mut long = ok.clone();
        long.push(0);
        assert!(parse(long).is_err());
        // Wrong magic.
        let mut bad = ok.clone();
        bad[0] = b'X';
        assert!(parse(bad).is_err());
        // A rectangle outside its plane.
        let out = encode(&[(
            Op::Patch,
            ScreenId::Live,
            "top",
            4,
            4,
            0,
            vec![([3, 3, 2, 2], &a[..])],
        )]);
        assert!(parse(out).is_err());
        // A huge plane.
        let huge = encode(&[(Op::Patch, ScreenId::Live, "top", 9000, 4, 0, vec![])]);
        assert!(parse(huge).is_err());
        // No such screen.
        let mut s = ok;
        s[7] = 9;
        assert!(parse(s).is_err());
    }

    /// The same bytes `overlayWire.test.ts` writes: the two sides agree.
    #[test]
    fn reads_what_the_web_renderer_writes() {
        let hex = "4c4f5631020001000700673a7469746c6503000000020000003930000000000000010000000100000000000000020000000100000001020304050607080201050070616e69630300000002000000000000000000000000000000";
        let bytes: Vec<u8> = (0..hex.len())
            .step_by(2)
            .map(|i| u8::from_str_radix(&hex[i..i + 2], 16).unwrap())
            .collect();
        let m = parse(bytes).unwrap();
        let r = &m.records[0];
        assert_eq!(
            (r.op, r.screen, r.name.as_str(), r.w, r.h, r.at),
            (Op::Patch, ScreenId::Live, "g:title", 3, 2, 12345)
        );
        assert_eq!(r.rects[0].x, 1);
        assert_eq!((r.rects[0].w, r.rects[0].h), (2, 1));
        assert_eq!(m.pixels(&r.rects[0]), &[1, 2, 3, 4, 5, 6, 7, 8]);
        let c = &m.records[1];
        assert_eq!(
            (c.op, c.screen, c.name.as_str(), c.w, c.h),
            (Op::Clear, ScreenId::Back, "panic", 3, 2)
        );
    }

    #[test]
    fn the_closest_size_is_picked() {
        let sizes = [(1920, 1080), (640, 360)];
        assert_eq!(closest(sizes.into_iter(), (1919, 1080)), Some((1920, 1080)));
        assert_eq!(closest(sizes.into_iter(), (600, 300)), Some((640, 360)));
        assert_eq!(closest(std::iter::empty(), (1, 1)), None);
    }
}
