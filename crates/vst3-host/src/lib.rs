//! # Lumora Studio's VST3 host
//!
//! Finds the VST3 effects installed on the computer, opens one, lists and
//! sets its parameters, saves and restores its state, and runs sound through
//! it offline. Lumora Studio does all of this in a helper process (the editor
//! started again with a request), so a plug-in that crashes can't take the
//! editor with it: see [`serve`].
//!
//! - [`com`]: the VST3 binary interface (ids, structures, function tables).
//! - [`objects`]: what the host hands to plug-ins (host application, streams,
//!   parameter changes, messages).
//! - [`module`]: a plug-in file loaded, and the effects it offers.
//! - [`plugin`]: one effect: parameters, state, and sound through it.

pub mod com;
pub mod module;
pub mod objects;
pub mod plugin;

#[cfg(test)]
mod fake;

use std::path::{Path, PathBuf};
use std::rc::Rc;

pub use module::{find_plugins, plugin_folders, ClassInfo, Module};
pub use plugin::{Param, Plugin};

/// A request to the helper process.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(tag = "op", rename_all = "camelCase")]
pub enum Request {
    /// The effects one plug-in file offers.
    Describe { path: PathBuf },
    /// An effect's parameters (with a saved state applied, and values set), and its state after.
    Params {
        path: PathBuf,
        cid: String,
        #[serde(default)]
        state: Option<String>,
        #[serde(default)]
        set: Vec<(u32, f64)>,
    },
    /// Sound through a chain of effects: raw 32-bit float samples (channels interleaved) in and out.
    Render {
        chain: Vec<Link>,
        input: PathBuf,
        output: PathBuf,
        channels: usize,
        rate: f64,
    },
}

/// One effect of a chain, with its saved state (base64).
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Link {
    pub path: PathBuf,
    pub cid: String,
    #[serde(default)]
    pub state: Option<String>,
}

/// What the helper answers.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Reply {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub classes: Vec<ClassInfo>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub params: Vec<Param>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub state: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub vendor: Option<String>,
}

impl Reply {
    fn error(e: String) -> Self {
        Self {
            error: Some(e),
            classes: Vec::new(),
            params: Vec::new(),
            state: None,
            vendor: None,
        }
    }
}

/// Open an effect, restoring its saved state if there is one.
///
/// # Errors
/// The file, the effect or the state can't be used.
pub fn open(path: &Path, cid: &str, state: Option<&str>) -> Result<Plugin, String> {
    let id = module::unhex(cid).ok_or("That plug-in id is not valid.")?;
    let m = Rc::new(Module::load(path)?);
    let mut p = Plugin::open(m, &id)?;
    if let Some(s) = state.filter(|s| !s.is_empty()) {
        p.restore(&base64_decode(s).ok_or("That plug-in setting is damaged.")?)?;
    }
    Ok(p)
}

/// Answer one request (in the helper process).
#[must_use]
pub fn handle(req: Request) -> Reply {
    match run(req) {
        Ok(r) => r,
        Err(e) => Reply::error(e),
    }
}

fn run(req: Request) -> Result<Reply, String> {
    match req {
        Request::Describe { path } => {
            let m = Module::load(&path)?;
            let classes: Vec<ClassInfo> = m
                .classes()
                .into_iter()
                .filter(ClassInfo::is_effect)
                .collect();
            Ok(Reply {
                error: None,
                vendor: Some(m.vendor()),
                classes,
                params: Vec::new(),
                state: None,
            })
        }
        Request::Params {
            path,
            cid,
            state,
            set,
        } => {
            let mut p = open(&path, &cid, state.as_deref())?;
            for (id, v) in set {
                p.set(id, v);
            }
            p.apply(48_000.0)?;
            Ok(Reply {
                error: None,
                classes: Vec::new(),
                params: p.params(),
                state: Some(base64_encode(&p.state())),
                vendor: None,
            })
        }
        Request::Render {
            chain,
            input,
            output,
            channels,
            rate,
        } => {
            let raw =
                std::fs::read(&input).map_err(|e| format!("The sound could not be read: {e}"))?;
            let ch = channels.clamp(1, 8);
            let mut sound = deinterleave(&raw, ch);
            for link in &chain {
                let mut p = open(&link.path, &link.cid, link.state.as_deref())?;
                sound = p.run(&sound, rate, &mut |_| {})?;
            }
            std::fs::write(&output, interleave(&sound))
                .map_err(|e| format!("The sound could not be written: {e}"))?;
            Ok(Reply {
                error: None,
                classes: Vec::new(),
                params: Vec::new(),
                state: None,
                vendor: None,
            })
        }
    }
}

/// The helper process: a request (JSON) on standard input, the reply (JSON) on standard output.
pub fn serve() -> i32 {
    use std::io::{Read, Write};
    let mut text = String::new();
    if std::io::stdin().read_to_string(&mut text).is_err() {
        return 2;
    }
    let reply = match serde_json::from_str::<Request>(&text) {
        Ok(req) => handle(req),
        Err(e) => Reply::error(format!("Bad request: {e}")),
    };
    let out = serde_json::to_string(&reply).unwrap_or_else(|_| "{\"error\":\"No reply\"}".into());
    let mut stdout = std::io::stdout();
    let _ = stdout.write_all(out.as_bytes());
    let _ = stdout.flush();
    i32::from(reply.error.is_some())
}

/// Samples (interleaved little-endian floats) into channels.
#[must_use]
pub fn deinterleave(raw: &[u8], channels: usize) -> Vec<Vec<f32>> {
    let frames = raw.len() / 4 / channels.max(1);
    let mut out = vec![Vec::with_capacity(frames); channels.max(1)];
    for (i, chunk) in raw.as_chunks::<4>().0.iter().take(frames * channels).enumerate() {
        out[i % channels].push(f32::from_le_bytes(*chunk));
    }
    out
}

/// Channels into interleaved little-endian floats.
#[must_use]
pub fn interleave(channels: &[Vec<f32>]) -> Vec<u8> {
    let frames = channels.iter().map(Vec::len).min().unwrap_or(0);
    let mut out = Vec::with_capacity(frames * channels.len() * 4);
    for i in 0..frames {
        for c in channels {
            out.extend_from_slice(&c[i].to_le_bytes());
        }
    }
    out
}

const B64: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

#[must_use]
pub fn base64_encode(bytes: &[u8]) -> String {
    let mut out = String::with_capacity(bytes.len().div_ceil(3) * 4);
    for chunk in bytes.chunks(3) {
        let n = u32::from(chunk[0]) << 16
            | u32::from(*chunk.get(1).unwrap_or(&0)) << 8
            | u32::from(*chunk.get(2).unwrap_or(&0));
        for (i, shift) in [18, 12, 6, 0].into_iter().enumerate() {
            if i <= chunk.len() {
                out.push(B64[(n >> shift & 63) as usize] as char);
            } else {
                out.push('=');
            }
        }
    }
    out
}

#[must_use]
pub fn base64_decode(text: &str) -> Option<Vec<u8>> {
    let val = |c: u8| B64.iter().position(|&x| x == c).map(|v| v as u32);
    let clean: Vec<u8> = text.bytes().filter(|c| !c.is_ascii_whitespace()).collect();
    if !clean.len().is_multiple_of(4) {
        return None;
    }
    let mut out = Vec::with_capacity(clean.len() / 4 * 3);
    for q in clean.chunks(4) {
        let pad = q.iter().rev().take_while(|&&c| c == b'=').count();
        let mut n = 0u32;
        for &c in &q[..4 - pad] {
            n = n << 6 | val(c)?;
        }
        n <<= 6 * pad as u32;
        let bytes = [(n >> 16) as u8, (n >> 8) as u8, n as u8];
        out.extend_from_slice(&bytes[..3 - pad]);
    }
    Some(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn base64_round_trips() {
        for s in [&b""[..], b"a", b"ab", b"abc", b"abcd", &[0, 255, 7, 9, 200]] {
            assert_eq!(base64_decode(&base64_encode(s)).as_deref(), Some(s));
        }
        assert_eq!(base64_encode(b"hello"), "aGVsbG8=");
        assert_eq!(base64_decode("a"), None);
    }

    #[test]
    fn samples_interleave_both_ways() {
        let ch = vec![vec![1.0f32, 2.0], vec![-1.0, -2.0]];
        assert_eq!(deinterleave(&interleave(&ch), 2), ch);
    }

    /// A real plug-in, when one is named: `LUMORA_TEST_VST3=/path/Effect.vst3 cargo test -p lumora-vst3-host`.
    #[test]
    fn a_real_plug_in_when_given() {
        let Some(path) = std::env::var_os("LUMORA_TEST_VST3").map(PathBuf::from) else {
            return;
        };
        let described = handle(Request::Describe { path: path.clone() });
        assert_eq!(described.error, None);
        let class = described.classes.first().expect("an effect").clone();
        eprintln!(
            "{} by {:?}: {}",
            class.name, described.vendor, class.sub_categories
        );
        let first = handle(Request::Params {
            path: path.clone(),
            cid: class.cid.clone(),
            state: None,
            set: Vec::new(),
        });
        assert_eq!(first.error, None);
        assert!(!first.params.is_empty());
        for p in first.params.iter().take(4) {
            eprintln!("  {} = {} ({})", p.title, p.value, p.text);
        }
        // Change the first continuous parameter: its state changes and comes back.
        let target = first
            .params
            .iter()
            .find(|p| p.steps == 0 && !p.bypass)
            .expect("a continuous parameter");
        let to = if target.value > 0.5 { 0.1 } else { 0.9 };
        let set = handle(Request::Params {
            path: path.clone(),
            cid: class.cid.clone(),
            state: first.state.clone(),
            set: vec![(target.id, to)],
        });
        assert_eq!(set.error, None);
        let again = handle(Request::Params {
            path: path.clone(),
            cid: class.cid.clone(),
            state: set.state.clone(),
            set: Vec::new(),
        });
        let v = again
            .params
            .iter()
            .find(|p| p.id == target.id)
            .unwrap()
            .value;
        assert!(
            (v - to).abs() < 0.02,
            "{} came back as {v}, not {to}",
            target.title
        );
        // Sound through it: a burst, then silence (a reverb rings on).
        let dir = std::env::temp_dir().join(format!("lumora-vst-real-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let rate = 48_000.0;
        let input: Vec<Vec<f32>> = (0..2)
            .map(|_| {
                (0..48_000)
                    .map(|i| {
                        if i < 4800 {
                            ((i as f32) * 0.05).sin() * 0.5
                        } else {
                            0.0
                        }
                    })
                    .collect()
            })
            .collect();
        std::fs::write(dir.join("in.raw"), interleave(&input)).unwrap();
        let r = handle(Request::Render {
            chain: vec![Link {
                path: path.clone(),
                cid: class.cid.clone(),
                state: set.state.clone(),
            }],
            input: dir.join("in.raw"),
            output: dir.join("out.raw"),
            channels: 2,
            rate,
        });
        assert_eq!(r.error, None);
        let out = deinterleave(&std::fs::read(dir.join("out.raw")).unwrap(), 2);
        assert_eq!(out[0].len(), 48_000);
        assert!(out.iter().flatten().all(|s| s.is_finite()));
        let energy: f32 = out.iter().flatten().map(|s| s * s).sum();
        eprintln!("  output energy {energy}");
        assert!(energy > 0.0);
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn bad_requests_get_a_message() {
        let r = handle(Request::Describe {
            path: PathBuf::from("/nowhere/x.vst3"),
        });
        assert!(r.error.is_some());
        let r = handle(Request::Params {
            path: PathBuf::from("/nowhere/x.vst3"),
            cid: "zz".into(),
            state: None,
            set: Vec::new(),
        });
        assert_eq!(r.error.as_deref(), Some("That plug-in id is not valid."));
    }
}
