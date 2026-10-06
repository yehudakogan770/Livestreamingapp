//! What the editor sends for each frame: the GPU passes that draw it (the
//! same passes the WebGL compositor runs, recorded instead of run), the video
//! frames they read, and any pictures (words, stills, curves, LUTs, mattes)
//! that are new since the last frame.
//!
//! A message is `[u32 little-endian header length][MessagePack header][bytes]`;
//! each upload's pixels are a range of the bytes after the header.

use serde::Deserialize;
use std::collections::HashMap;

/// One frame to draw.
#[derive(Debug, Clone, Deserialize, Default, PartialEq)]
pub struct Frame {
    /// The sequence's frame number.
    pub frame: i64,
    /// The size it is drawn at.
    pub w: u32,
    pub h: u32,
    /// The sequence's background color (0–1).
    #[serde(default)]
    pub background: [f32; 3],
    /// The target holding the finished frame (none: only the background).
    #[serde(default)]
    pub out: Option<u16>,
    #[serde(default)]
    pub passes: Vec<Pass>,
    /// Video frames the passes read (`v0`, `v1`, … by position).
    #[serde(default)]
    pub videos: Vec<VideoUse>,
    /// New pictures, before the frame is drawn.
    #[serde(default)]
    pub uploads: Vec<Upload>,
    /// Pictures no longer needed.
    #[serde(default)]
    pub free: Vec<String>,
    /// Shown as soon as it is drawn (stopped, scrubbing, stepping), not queued for its moment.
    #[serde(default)]
    pub now: bool,
}

/// One step: clear a target, or run a program into one.
#[derive(Debug, Clone, Deserialize, Default, PartialEq)]
pub struct Pass {
    /// 0: clear, 1: draw.
    pub k: u8,
    /// The target written.
    pub t: u16,
    /// Clear color (premultiplied RGBA).
    #[serde(default)]
    pub c: Option<[f32; 4]>,
    /// The program's name.
    #[serde(default)]
    pub p: Option<String>,
    /// Textures by the program's sampler names: `t3` (a target), `v0` (a video), `r:<id>` (an upload), `e` (nothing).
    #[serde(default)]
    pub x: HashMap<String, String>,
    /// Uniform values by name.
    #[serde(default)]
    pub u: HashMap<String, Vec<f32>>,
    /// The placed picture's four corners (x·w, y·w, 0, w, u, v each), for the `layer` program.
    #[serde(default)]
    pub q: Option<Vec<f32>>,
}

/// A source file's frame used by this frame.
#[derive(Debug, Clone, Deserialize, Default, PartialEq)]
pub struct VideoUse {
    /// One decoder per clip (and a second for a clip mixing two of its frames).
    pub key: String,
    pub path: String,
    /// Seconds into the file.
    pub time: f64,
    /// The file's frame rate.
    pub fps: f64,
    /// The picture's size as the editor places it.
    pub w: u32,
    pub h: u32,
    /// Playing speed through the file (negative: backwards), for reading ahead.
    #[serde(default)]
    pub rate: f64,
}

/// What an upload's bytes are.
#[derive(Debug, Clone, Copy, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "lowercase")]
pub enum UploadKind {
    /// RGBA with straight alpha (a canvas's pixels): premultiplied on the way in, as WebGL does.
    #[default]
    Straight,
    /// RGBA taken as it is (curves, LUTs).
    Raw,
    /// One byte per pixel: a matte, made white and that see-through.
    Alpha,
}

#[derive(Debug, Clone, Deserialize, Default, PartialEq)]
pub struct Upload {
    pub id: String,
    pub w: u32,
    pub h: u32,
    /// Depth for a 3D texture (a LUT); 0 for a picture.
    #[serde(default)]
    pub d: u32,
    #[serde(default)]
    pub kind: UploadKind,
    /// Where its bytes are, after the header.
    pub at: usize,
    pub len: usize,
}

/// A texture a pass reads.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum TexRef {
    Target(u16),
    Video(usize),
    Upload(String),
    Empty,
}

impl TexRef {
    pub fn parse(s: &str) -> Result<Self, String> {
        if s == "e" {
            return Ok(Self::Empty);
        }
        if let Some(id) = s.strip_prefix("r:") {
            return Ok(Self::Upload(id.to_owned()));
        }
        let bad = || format!("Unknown texture {s:?}");
        if let Some(n) = s.strip_prefix('t') {
            return n.parse().map(Self::Target).map_err(|_| bad());
        }
        if let Some(n) = s.strip_prefix('v') {
            return n.parse().map(Self::Video).map_err(|_| bad());
        }
        Err(bad())
    }
}

/// The most targets a frame may use (each is a frame-sized texture).
pub const MAX_TARGETS: u16 = 64;
/// The biggest frame or picture.
pub const MAX_SIZE: u32 = 8192;

/// A decoded message: the frame and the bytes its uploads point into.
#[derive(Debug, Clone)]
pub struct Message {
    pub frame: Frame,
    pub bytes: Vec<u8>,
    /// Where the uploads' bytes start in `bytes`.
    pub base: usize,
}

impl Message {
    /// An upload's bytes.
    pub fn data(&self, u: &Upload) -> &[u8] {
        let start = self.base + u.at;
        self.bytes.get(start..start + u.len).unwrap_or(&[])
    }
}

/// Read a message and check it is something that can be drawn.
///
/// # Errors
/// A malformed message, or a frame that refers to things it doesn't have.
pub fn decode(bytes: Vec<u8>) -> Result<Message, String> {
    let len = bytes
        .get(..4)
        .map(|b| u32::from_le_bytes([b[0], b[1], b[2], b[3]]) as usize)
        .ok_or("The frame message is empty.")?;
    let header = bytes
        .get(4..4 + len)
        .ok_or("The frame message is cut short.")?;
    let frame: Frame = rmp_serde::from_slice(header)
        .map_err(|e| format!("The frame message can't be read: {e}"))?;
    let base = 4 + len;
    let m = Message { frame, bytes, base };
    validate(&m)?;
    Ok(m)
}

fn validate(m: &Message) -> Result<(), String> {
    let f = &m.frame;
    if f.w == 0 || f.h == 0 || f.w > MAX_SIZE || f.h > MAX_SIZE {
        return Err(format!("A {}×{} frame can't be drawn.", f.w, f.h));
    }
    let target_ok = |t: u16| t < MAX_TARGETS;
    if f.out.is_some_and(|t| !target_ok(t)) {
        return Err("The frame's result is not a target.".into());
    }
    for (i, p) in f.passes.iter().enumerate() {
        if !target_ok(p.t) {
            return Err(format!("Pass {i} writes to target {} (too many).", p.t));
        }
        match p.k {
            0 => {}
            1 => {
                if p.p.as_deref().unwrap_or("").is_empty() {
                    return Err(format!("Pass {i} has no program."));
                }
                for (name, tex) in &p.x {
                    match TexRef::parse(tex)? {
                        TexRef::Target(t) if !target_ok(t) => {
                            return Err(format!("Pass {i} reads target {t}."))
                        }
                        TexRef::Target(t) if t == p.t => {
                            return Err(format!("Pass {i} reads ({name}) the target it writes."))
                        }
                        TexRef::Video(v) if v >= f.videos.len() => {
                            return Err(format!("Pass {i} reads video {v}."))
                        }
                        _ => {}
                    }
                }
                if let Some(q) = &p.q {
                    if q.len() != 24 {
                        return Err(format!("Pass {i}'s corners are not four."));
                    }
                }
            }
            k => return Err(format!("Pass {i} is of an unknown kind ({k}).")),
        }
    }
    for v in &f.videos {
        if v.w == 0
            || v.h == 0
            || v.w > MAX_SIZE
            || v.h > MAX_SIZE
            || !(v.fps > 0.0 && v.fps <= 1000.0)
        {
            return Err(format!(
                "The video {} can't be read at {}×{}.",
                v.path, v.w, v.h
            ));
        }
        if !v.time.is_finite() {
            return Err("A video time is not a number.".into());
        }
    }
    for u in &f.uploads {
        let px = u64::from(u.w) * u64::from(u.h) * u64::from(u.d.max(1));
        let want = match u.kind {
            UploadKind::Alpha => px,
            _ => px * 4,
        };
        if u.w == 0 || u.h == 0 || u.w > MAX_SIZE || u.h > MAX_SIZE || u.d > 256 {
            return Err(format!("The picture {} is {}×{}.", u.id, u.w, u.h));
        }
        if u.len as u64 != want || m.data(u).len() != u.len {
            return Err(format!(
                "The picture {} has the wrong number of bytes.",
                u.id
            ));
        }
    }
    Ok(())
}

/// Make a message (the editor does this in TypeScript; tests and tools here).
pub fn encode(frame: &serde_json::Value, bytes: &[u8]) -> Vec<u8> {
    let header = rmp_serde::to_vec_named(frame).unwrap_or_default();
    let mut out = Vec::with_capacity(4 + header.len() + bytes.len());
    out.extend_from_slice(&(header.len() as u32).to_le_bytes());
    out.extend_from_slice(&header);
    out.extend_from_slice(bytes);
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn sample() -> serde_json::Value {
        json!({
            "frame": 42, "w": 1920, "h": 1080, "background": [0.0, 0.0, 0.0], "out": 1,
            "passes": [
                { "k": 0, "t": 0, "c": [0.0, 0.0, 0.0, 0.0] },
                { "k": 1, "t": 0, "p": "layer", "x": { "uTex": "v0" }, "u": { "uCrop": [0.0, 0.0, 1.0, 1.0] },
                  "q": [-1.0,1.0,0.0,1.0,0.0,0.0, 1.0,1.0,0.0,1.0,1.0,0.0, -1.0,-1.0,0.0,1.0,0.0,1.0, 1.0,-1.0,0.0,1.0,1.0,1.0] },
                { "k": 1, "t": 1, "p": "grade", "x": { "uTex": "t0", "uBase": "t0", "uCurve": "r:curve:a|1" }, "u": { "uUseBasic": [1.0] } }
            ],
            "videos": [{ "key": "c1", "path": "/a.mp4", "time": 1.5, "fps": 25.0, "w": 3840, "h": 2160 }],
            "uploads": [{ "id": "curve:a|1", "w": 256, "h": 1, "kind": "raw", "at": 0, "len": 1024 }],
            "free": ["text:x|0"]
        })
    }

    #[test]
    fn reads_a_frame() {
        let m = decode(encode(&sample(), &[7u8; 1024])).unwrap();
        assert_eq!(m.frame.frame, 42);
        assert_eq!(m.frame.passes.len(), 3);
        assert_eq!(m.frame.passes[1].x["uTex"], "v0");
        assert_eq!(m.frame.passes[1].q.as_ref().unwrap().len(), 24);
        assert_eq!(m.frame.passes[2].u["uUseBasic"], vec![1.0]);
        assert_eq!(m.frame.videos[0].fps, 25.0);
        assert_eq!(m.frame.uploads[0].kind, UploadKind::Raw);
        assert_eq!(m.data(&m.frame.uploads[0]).len(), 1024);
        assert_eq!(m.frame.free, vec!["text:x|0".to_owned()]);
        assert!(!m.frame.now);
    }

    #[test]
    fn texture_names() {
        assert_eq!(TexRef::parse("t12").unwrap(), TexRef::Target(12));
        assert_eq!(TexRef::parse("v1").unwrap(), TexRef::Video(1));
        assert_eq!(
            TexRef::parse("r:img:a|b").unwrap(),
            TexRef::Upload("img:a|b".into())
        );
        assert_eq!(TexRef::parse("e").unwrap(), TexRef::Empty);
        assert!(TexRef::parse("q1").is_err());
        assert!(TexRef::parse("tx").is_err());
    }

    #[test]
    fn refuses_what_cant_be_drawn() {
        let bad = |f: &dyn Fn(&mut serde_json::Value)| {
            let mut v = sample();
            f(&mut v);
            decode(encode(&v, &[7u8; 1024])).unwrap_err()
        };
        assert!(bad(&|v| v["w"] = json!(0)).contains("can't be drawn"));
        assert!(bad(&|v| v["passes"][1]["x"]["uTex"] = json!("v3")).contains("reads video"));
        assert!(bad(&|v| v["passes"][2]["x"]["uTex"] = json!("t1")).contains("target it writes"));
        assert!(bad(&|v| v["uploads"][0]["len"] = json!(1000)).contains("wrong number"));
        assert!(bad(&|v| v["passes"][0]["k"] = json!(5)).contains("unknown kind"));
        assert!(bad(&|v| v["passes"][1]["q"] = json!([1.0, 2.0])).contains("four"));
        assert!(decode(vec![1, 0]).is_err());
        assert!(decode(vec![200, 0, 0, 0, 1]).is_err());
    }
}
