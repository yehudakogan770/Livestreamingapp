//! The switcher's state, built from the blocks it sends: all of them right
//! after connecting (ending with `InCm`), then each one as it changes.
//! Blocks Lumora doesn't use are skipped.

use std::collections::BTreeMap;

use serde::Serialize;

use crate::command::Block;

/// The style of the next transition.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum TransitionStyle {
    #[default]
    Mix,
    Dip,
    Wipe,
    Dve,
    Stinger,
}

impl TransitionStyle {
    #[must_use]
    pub fn from_byte(b: u8) -> Self {
        match b {
            1 => TransitionStyle::Dip,
            2 => TransitionStyle::Wipe,
            3 => TransitionStyle::Dve,
            4 => TransitionStyle::Stinger,
            _ => TransitionStyle::Mix,
        }
    }
    #[must_use]
    pub fn byte(self) -> u8 {
        self as u8
    }
}

/// One of the switcher's inputs (cameras, color bars, media players…).
#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Input {
    pub id: u16,
    pub long_name: String,
    pub short_name: String,
    /// 0 external (SDI/HDMI), 1 black, 2 color bars, 3 color generator, 4
    /// media player fill, 5 media player key, 6 super source, 128 program,
    /// 129 preview, 130 clean feed… (as the switcher says).
    pub port_type: u8,
}

impl Input {
    /// An input a camera or other gear is plugged into.
    #[must_use]
    pub fn is_external(&self) -> bool {
        self.port_type == 0 && self.id > 0 && self.id < 1000
    }
}

/// One mix effect bus.
#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MixEffect {
    pub program: u16,
    pub preview: u16,
    pub style: TransitionStyle,
    /// Mix rate, frames.
    pub mix_rate: u8,
    pub in_transition: bool,
    /// 0 – 10 000.
    pub tbar: u16,
    pub ftb_black: bool,
    pub ftb_in_transition: bool,
    pub ftb_rate: u8,
    /// Upstream keyers on air (by keyer).
    pub usk_on_air: Vec<bool>,
}

/// A downstream keyer.
#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Dsk {
    pub on_air: bool,
    pub in_transition: bool,
}

/// A macro slot that has a macro in it.
#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Macro {
    pub index: u16,
    pub name: String,
}

/// An input's tally.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Tally {
    pub program: bool,
    pub preview: bool,
}

/// Everything Lumora knows about the switcher.
#[derive(Debug, Clone, PartialEq, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SwitcherState {
    /// "ATEM Mini Pro", "ATEM Television Studio HD8"…
    pub model: String,
    /// The protocol version (major, minor).
    pub protocol: (u16, u16),
    /// The video mode as the switcher numbers it, and its frame rate.
    pub video_mode: u8,
    pub fps: f32,
    pub inputs: BTreeMap<u16, Input>,
    pub mix_effects: Vec<MixEffect>,
    pub dsks: Vec<Dsk>,
    pub macros: Vec<Macro>,
    /// The macro running (None: none).
    pub macro_running: Option<u16>,
    /// Tally by input number.
    pub tally: BTreeMap<u16, Tally>,
    /// The whole state has arrived (`InCm`).
    pub complete: bool,
}

fn u16_at(d: &[u8], i: usize) -> Option<u16> {
    Some(u16::from_be_bytes([*d.get(i)?, *d.get(i + 1)?]))
}

/// Text up to the first zero byte (names are padded with zeros).
fn text(d: &[u8]) -> String {
    let end = d.iter().position(|&b| b == 0).unwrap_or(d.len());
    String::from_utf8_lossy(&d[..end]).trim().to_owned()
}

/// The frame rate of an ATEM video mode number.
#[must_use]
pub fn mode_fps(mode: u8) -> f32 {
    match mode {
        // 525i59.94, 625i50 (4:3 and 16:9): the rates are of whole frames.
        0 | 2 | 7 => 29.97,
        1 | 3 | 6 => 25.0,
        4 | 12 | 18 => 50.0,
        5 | 13 | 19 => 59.94,
        8 | 14 => 23.976,
        9 | 15 => 24.0,
        10 | 16 => 25.0,
        11 | 17 => 29.97,
        _ => 30.0,
    }
}

impl SwitcherState {
    fn me(&mut self, i: u8) -> &mut MixEffect {
        let i = usize::from(i);
        if self.mix_effects.len() <= i {
            self.mix_effects.resize(i + 1, MixEffect::default());
        }
        &mut self.mix_effects[i]
    }

    fn dsk(&mut self, i: u8) -> &mut Dsk {
        let i = usize::from(i);
        if self.dsks.len() <= i {
            self.dsks.resize(i + 1, Dsk::default());
        }
        &mut self.dsks[i]
    }

    /// Take in one block. Returns whether anything Lumora shows changed.
    pub fn apply(&mut self, b: &Block<'_>) -> bool {
        let d = b.data;
        let before = self.clone();
        let _ = self.apply_inner(&b.name, d);
        *self != before
    }

    fn apply_inner(&mut self, name: &[u8; 4], d: &[u8]) -> Option<()> {
        match name {
            b"_ver" => self.protocol = (u16_at(d, 0)?, u16_at(d, 2)?),
            b"_pin" => self.model = text(d.get(..d.len().min(44))?),
            b"_top" => {
                let mes = *d.first()?;
                self.me(mes.saturating_sub(1));
            }
            b"_MeC" => {
                let (me, keyers) = (*d.first()?, *d.get(1)?);
                self.me(me).usk_on_air.resize(usize::from(keyers), false);
            }
            b"VidM" => {
                self.video_mode = *d.first()?;
                self.fps = mode_fps(self.video_mode);
            }
            b"InPr" => {
                let id = u16_at(d, 0)?;
                let input = Input {
                    id,
                    long_name: text(d.get(2..22)?),
                    short_name: text(d.get(22..26)?),
                    port_type: d.get(32).copied().unwrap_or(0),
                };
                self.inputs.insert(id, input);
            }
            b"PrgI" => {
                let (me, src) = (*d.first()?, u16_at(d, 2)?);
                self.me(me).program = src;
            }
            b"PrvI" => {
                let (me, src) = (*d.first()?, u16_at(d, 2)?);
                self.me(me).preview = src;
            }
            b"TrSS" => {
                let (me, style) = (*d.first()?, *d.get(1)?);
                self.me(me).style = TransitionStyle::from_byte(style);
            }
            b"TrPs" => {
                let (me, on) = (*d.first()?, *d.get(1)? != 0);
                let pos = u16_at(d, 4)?;
                let m = self.me(me);
                m.in_transition = on;
                m.tbar = pos;
            }
            b"TMxP" => {
                let (me, rate) = (*d.first()?, *d.get(1)?);
                self.me(me).mix_rate = rate;
            }
            b"FtbP" => {
                let (me, rate) = (*d.first()?, *d.get(1)?);
                self.me(me).ftb_rate = rate;
            }
            b"FtbS" => {
                let (me, black, moving) = (*d.first()?, *d.get(1)? != 0, *d.get(2)? != 0);
                let m = self.me(me);
                m.ftb_black = black;
                m.ftb_in_transition = moving;
            }
            b"DskS" => {
                let (i, on, moving) = (*d.first()?, *d.get(1)? != 0, *d.get(2)? != 0);
                let k = self.dsk(i);
                k.on_air = on;
                k.in_transition = moving;
            }
            b"DskB" | b"DskP" => {
                // Their existence tells how many there are.
                self.dsk(*d.first()?);
            }
            b"KeOn" => {
                let (me, keyer, on) = (*d.first()?, usize::from(*d.get(1)?), *d.get(2)? != 0);
                let m = self.me(me);
                if m.usk_on_air.len() <= keyer {
                    m.usk_on_air.resize(keyer + 1, false);
                }
                m.usk_on_air[keyer] = on;
            }
            b"MPrp" => {
                let index = u16_at(d, 0)?;
                let used = *d.get(2)? != 0;
                self.macros.retain(|m| m.index != index);
                if used {
                    let len = usize::from(u16_at(d, 4)?);
                    let name = d.get(8..8 + len).map(text).unwrap_or_default();
                    self.macros.push(Macro { index, name });
                    self.macros.sort_by_key(|m| m.index);
                }
            }
            b"MRPr" => {
                let running = *d.first()? & 1 != 0;
                let index = u16_at(d, 2)?;
                self.macro_running = running.then_some(index);
            }
            b"TlSr" => {
                let n = usize::from(u16_at(d, 0)?);
                let mut tally = BTreeMap::new();
                for i in 0..n {
                    let at = 2 + i * 3;
                    let (Some(src), Some(&f)) = (u16_at(d, at), d.get(at + 2)) else {
                        break;
                    };
                    tally.insert(
                        src,
                        Tally {
                            program: f & 1 != 0,
                            preview: f & 2 != 0,
                        },
                    );
                }
                self.tally = tally;
            }
            b"InCm" => self.complete = true,
            _ => {}
        }
        Some(())
    }

    /// The first mix effect bus (every ATEM has one).
    #[must_use]
    pub fn me0(&self) -> MixEffect {
        self.mix_effects.first().cloned().unwrap_or_default()
    }

    /// An input's name for people ("Camera 1", or "Input 5" when unnamed).
    #[must_use]
    pub fn input_name(&self, id: u16) -> String {
        match self.inputs.get(&id) {
            Some(i) if !i.long_name.is_empty() => i.long_name.clone(),
            _ if id == 0 => "Black".to_owned(),
            _ => format!("Input {id}"),
        }
    }

    /// The tally of input `id`: from the switcher's tally list when it has
    /// sent one, else from program and preview.
    #[must_use]
    pub fn tally_of(&self, id: u16) -> Tally {
        if let Some(t) = self.tally.get(&id) {
            return *t;
        }
        let me = self.me0();
        Tally {
            program: me.program == id,
            preview: me.preview == id,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::command::{block, split};

    fn state_of(payload: &[u8]) -> SwitcherState {
        let mut s = SwitcherState::default();
        for b in split(payload) {
            s.apply(&b);
        }
        s
    }

    fn name(s: &str, len: usize) -> Vec<u8> {
        let mut v = s.as_bytes().to_vec();
        v.resize(len, 0);
        v
    }

    /// The opening of a state dump as an ATEM Mini Pro sends it (trimmed to
    /// the blocks Lumora reads).
    fn dump() -> Vec<u8> {
        let mut p = Vec::new();
        p.extend(block(b"_ver", &[0x00, 0x02, 0x00, 0x1E]));
        p.extend(block(b"_pin", &name("ATEM Mini Pro", 44)));
        p.extend(block(b"_top", &[1, 14, 2, 1, 1, 1, 0, 0, 0, 0, 0, 0]));
        p.extend(block(b"_MeC", &[0, 1, 0, 0]));
        p.extend(block(b"VidM", &[13, 0, 0, 0]));
        let mut inpr = vec![0x00, 0x01];
        inpr.extend(name("Camera 1", 20));
        inpr.extend(name("CAM1", 4));
        inpr.extend([1, 0, 0, 0x03, 0, 0x01, 0, 0, 0, 0x03, 0x01, 0, 0, 0]);
        p.extend(block(b"InPr", &inpr));
        let mut bars = vec![0x03, 0xE8];
        bars.extend(name("Color Bars", 20));
        bars.extend(name("Bars", 4));
        bars.extend([1, 0, 0, 0, 0, 0, 2, 0, 0, 0, 0, 0, 0, 0]);
        p.extend(block(b"InPr", &bars));
        p.extend(block(b"PrgI", &[0, 0, 0, 1]));
        p.extend(block(b"PrvI", &[0, 0, 0, 2, 0, 0, 0, 0]));
        p.extend(block(b"TrSS", &[0, 1, 1, 1, 1, 0, 0, 0]));
        p.extend(block(b"TMxP", &[0, 30, 0, 0]));
        p.extend(block(b"FtbP", &[0, 25, 0, 0]));
        p.extend(block(b"FtbS", &[0, 0, 0, 25]));
        p.extend(block(b"DskS", &[0, 1, 0, 0, 30, 0, 0, 0]));
        p.extend(block(b"KeOn", &[0, 0, 1, 0]));
        let mut mp = vec![0, 2, 1, 0, 0, 9, 0, 0];
        mp.extend(b"Intro all");
        p.extend(block(b"MPrp", &mp));
        p.extend(block(b"MRPr", &[0, 0, 0xFF, 0xFF]));
        p.extend(block(
            b"TlSr",
            &[0, 3, 0, 1, 1, 0, 2, 2, 0x03, 0xE8, 0, 0, 0],
        ));
        p.extend(block(b"InCm", &[1, 0, 0, 0]));
        p
    }

    #[test]
    fn a_state_dump_is_read() {
        let s = state_of(&dump());
        assert_eq!(s.model, "ATEM Mini Pro");
        assert_eq!(s.protocol, (2, 30));
        assert!((s.fps - 59.94).abs() < 0.01);
        assert_eq!(s.inputs.len(), 2);
        assert_eq!(s.inputs[&1].long_name, "Camera 1");
        assert_eq!(s.inputs[&1].short_name, "CAM1");
        assert!(s.inputs[&1].is_external());
        assert_eq!(s.inputs[&1000].port_type, 2);
        assert!(!s.inputs[&1000].is_external());
        let me = s.me0();
        assert_eq!((me.program, me.preview), (1, 2));
        assert_eq!(me.style, TransitionStyle::Dip);
        assert_eq!((me.mix_rate, me.ftb_rate), (30, 25));
        assert!(!me.ftb_black);
        assert_eq!(me.usk_on_air, vec![true]);
        assert_eq!(s.dsks.len(), 1);
        assert!(s.dsks[0].on_air);
        assert_eq!(
            s.macros,
            vec![Macro {
                index: 2,
                name: "Intro all".into()
            }]
        );
        assert_eq!(s.macro_running, None);
        assert!(s.tally_of(1).program && !s.tally_of(1).preview);
        assert!(s.tally_of(2).preview);
        assert!(!s.tally_of(1000).program);
        assert!(s.complete);
        assert_eq!(s.input_name(1), "Camera 1");
        assert_eq!(s.input_name(7), "Input 7");
    }

    #[test]
    fn changes_are_noticed_and_odd_blocks_ignored() {
        let mut s = state_of(&dump());
        let p = block(b"PrgI", &[0, 0, 0, 3]);
        assert!(s.apply(&split(&p)[0]));
        assert_eq!(s.me0().program, 3);
        assert!(!s.apply(&split(&p)[0]), "the same again is no change");
        // Too short, unknown: nothing happens, nothing breaks.
        for junk in [block(b"PrgI", &[0]), block(b"Zzzz", &[1, 2, 3])] {
            assert!(!s.apply(&split(&junk)[0]));
        }
        // A macro slot emptied, a macro running, fade to black.
        assert!(s.apply(&split(&block(b"MPrp", &[0, 2, 0, 0, 0, 0, 0, 0]))[0]));
        assert!(s.macros.is_empty());
        assert!(s.apply(&split(&block(b"MRPr", &[1, 0, 0, 4]))[0]));
        assert_eq!(s.macro_running, Some(4));
        assert!(s.apply(&split(&block(b"FtbS", &[0, 1, 0, 0]))[0]));
        assert!(s.me0().ftb_black);
    }

    #[test]
    fn frame_rates_follow_the_video_mode() {
        assert!((mode_fps(10) - 25.0).abs() < 0.01);
        assert!((mode_fps(7) - 29.97).abs() < 0.01);
        assert!((mode_fps(200) - 30.0).abs() < 0.01);
    }
}
