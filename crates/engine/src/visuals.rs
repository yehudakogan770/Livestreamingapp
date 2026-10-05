//! Stage visuals: beat-synced animated backgrounds (from Stage Visuals Live).
//!
//! The engine keeps the one shared state — tempo, the beat anchor, which
//! scene is on, the effects — and every screen draws it on its own. Since the
//! beat is worked out from the anchor and the clock, all screens (and the
//! recording) stay on the same beat without sending frames around.

use std::sync::OnceLock;

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::model::Millis;

/// Slowest and fastest tempo.
pub const MIN_BPM: f64 = 40.0;
pub const MAX_BPM: f64 = 220.0;
/// Saved looks (slots 1 – 8).
pub const LOOK_SLOTS: usize = 8;
/// Longest words on the visuals.
pub const MAX_VISUALS_TEXT: usize = 60;

/// One music type: its tempo, fade and how many scenes it has. Read from the
/// same file the screens draw from, so the two can never disagree.
#[derive(Debug, Deserialize)]
pub struct Bank {
    pub name: String,
    pub bpm: f64,
    pub fade: f64,
    pub scenes: Vec<serde_json::Value>,
}

#[derive(Debug, Deserialize)]
struct Library {
    banks: Vec<Bank>,
}

/// The built-in music types.
///
/// # Panics
/// Never at run time: the file is part of the program and checked by tests.
pub fn banks() -> &'static [Bank] {
    static BANKS: OnceLock<Vec<Bank>> = OnceLock::new();
    BANKS.get_or_init(|| {
        let lib: Library =
            serde_json::from_str(include_str!("../../../app/src/visuals/banks.json"))
                .expect("banks.json is valid");
        lib.banks
    })
}

/// A scene: music type and the scene in it (both 0-based).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", default)]
#[ts(export)]
pub struct SceneRef {
    pub bank: usize,
    pub scene: usize,
}

impl SceneRef {
    pub fn exists(self) -> bool {
        banks()
            .get(self.bank)
            .is_some_and(|b| self.scene < b.scenes.len())
    }
    fn repaired(self) -> SceneRef {
        if self.exists() {
            self
        } else {
            SceneRef::default()
        }
    }
}

/// When a new scene starts.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub enum Quantize {
    Now,
    /// On the next beat.
    #[default]
    Beat,
    /// On the next bar (4 beats).
    Bar,
}

/// Effects on the picture (all saved in looks).
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", default)]
#[ts(export)]
pub struct VisualsFx {
    pub zoom: f32,
    /// Turns with the beat.
    pub spin: f32,
    pub pan_x: f32,
    pub pan_y: f32,
    /// Zoom kick on the beat.
    pub pump: f32,
    /// Kaleidoscope segments (0: off).
    pub kal: u32,
    /// 0 off, 1 – 3 mirror modes.
    pub mirror: u32,
    pub hue: f32,
    pub hue_cycle: f32,
    pub sat: f32,
    pub con: f32,
    pub glow: f32,
    pub trail: f32,
    pub echo: f32,
    pub echo_rot: f32,
    pub rgb: f32,
    pub pix: f32,
    pub post: f32,
    pub scan: f32,
    pub vig: f32,
    /// Overlay layer: a second scene on top.
    pub ov: f32,
    pub ov_mode: u32,
    pub ov_scene: SceneRef,
}

impl Default for VisualsFx {
    fn default() -> Self {
        VisualsFx {
            zoom: 1.0,
            spin: 0.0,
            pan_x: 0.0,
            pan_y: 0.0,
            pump: 0.0,
            kal: 0,
            mirror: 0,
            hue: 0.0,
            hue_cycle: 0.0,
            sat: 1.0,
            con: 1.0,
            glow: 0.0,
            trail: 0.0,
            echo: 0.0,
            echo_rot: 0.0,
            rgb: 0.0,
            pix: 0.0,
            post: 0.0,
            scan: 0.0,
            vig: 0.0,
            ov: 0.0,
            ov_mode: 1,
            ov_scene: SceneRef::default(),
        }
    }
}

fn fit(v: f32, lo: f32, hi: f32, d: f32) -> f32 {
    if v.is_finite() {
        v.clamp(lo, hi)
    } else {
        d
    }
}

fn fit64(v: f64, lo: f64, hi: f64, d: f64) -> f64 {
    if v.is_finite() {
        v.clamp(lo, hi)
    } else {
        d
    }
}

impl VisualsFx {
    pub fn repair(&mut self) {
        self.zoom = fit(self.zoom, 0.5, 3.0, 1.0);
        self.spin = fit(self.spin, -2.0, 2.0, 0.0);
        self.pan_x = fit(self.pan_x, -0.6, 0.6, 0.0);
        self.pan_y = fit(self.pan_y, -0.4, 0.4, 0.0);
        self.pump = fit(self.pump, 0.0, 1.0, 0.0);
        self.kal = self.kal.min(12);
        self.mirror = self.mirror.min(3);
        self.hue = fit(self.hue, 0.0, std::f32::consts::TAU, 0.0);
        self.hue_cycle = fit(self.hue_cycle, 0.0, 1.0, 0.0);
        self.sat = fit(self.sat, 0.0, 2.0, 1.0);
        self.con = fit(self.con, 0.5, 2.0, 1.0);
        self.glow = fit(self.glow, 0.0, 1.5, 0.0);
        self.trail = fit(self.trail, 0.0, 0.97, 0.0);
        self.echo = fit(self.echo, -0.05, 0.05, 0.0);
        self.echo_rot = fit(self.echo_rot, -0.05, 0.05, 0.0);
        self.rgb = fit(self.rgb, 0.0, 1.0, 0.0);
        self.pix = fit(self.pix, 0.0, 24.0, 0.0).round();
        self.post = fit(self.post, 0.0, 8.0, 0.0).round();
        self.scan = fit(self.scan, 0.0, 1.0, 0.0);
        self.vig = fit(self.vig, 0.0, 1.0, 0.0);
        self.ov = fit(self.ov, 0.0, 1.0, 0.0);
        self.ov_mode = self.ov_mode.min(3);
        self.ov_scene = self.ov_scene.repaired();
    }
}

/// Words on the visuals.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", default)]
#[ts(export)]
pub struct VisualsText {
    pub on: bool,
    pub words: String,
    /// clean, bold, elegant or classic.
    pub font: String,
    pub color: String,
    pub size: f32,
    /// Up / down, -0.4 – 0.4.
    pub y: f32,
    /// Pulses with the beat.
    pub pulse: f32,
}

impl Default for VisualsText {
    fn default() -> Self {
        VisualsText {
            on: false,
            words: String::new(),
            font: "clean".to_owned(),
            color: "#ffffff".to_owned(),
            size: 0.6,
            y: 0.0,
            pulse: 0.3,
        }
    }
}

/// How the visuals play (not part of looks).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", default)]
#[ts(export)]
#[allow(clippy::struct_excessive_bools)] // independent on/off settings
pub struct VisualsSettings {
    /// Flash strength on the beat, 0 – 1.
    pub flash: f32,
    /// Movement speed, 0.25 – 2.
    pub speed: f32,
    pub bright: f32,
    /// "scene" (each scene's own colors) or a color set's key.
    pub palette: String,
    /// Fade between scenes in beats; negative: the music type's own.
    pub fade: f64,
    pub quantize: Quantize,
    /// Change scene by itself every this many bars (0: off).
    pub auto_bars: u32,
    pub auto_random: bool,
    /// A new music type sets its own tempo.
    pub bank_tempo: bool,
    /// Flash every this many beats (0: never).
    pub flash_every: f64,
    /// Strobe flashes per beat.
    pub strobe_div: f64,
    pub slow_blackout: bool,
    /// Drawing quality: 1, 0.75 or 0.5.
    pub quality: f32,
    /// Safe for the audience: no strobe, gentler flashes (flashing light
    /// can affect people with photosensitive epilepsy).
    pub safe: bool,
}

impl Default for VisualsSettings {
    fn default() -> Self {
        VisualsSettings {
            flash: 1.0,
            speed: 1.0,
            bright: 1.0,
            palette: "scene".to_owned(),
            fade: -1.0,
            quantize: Quantize::Beat,
            auto_bars: 0,
            auto_random: false,
            bank_tempo: true,
            flash_every: 1.0,
            strobe_div: 2.0,
            slow_blackout: false,
            quality: 1.0,
            safe: true,
        }
    }
}

/// Where the event logo sits on the visuals.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub enum LogoPlace {
    #[default]
    Corner,
    Centre,
    Bottom,
}

/// The event logo on top of the visuals.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", default)]
#[ts(export)]
pub struct VisualsLogo {
    pub on: bool,
    pub place: LogoPlace,
    /// Height as a share of the screen, 0.05 – 0.6.
    pub size: f32,
    /// Grows a little on the beat, 0 – 1.
    pub pulse: f32,
}

impl Default for VisualsLogo {
    fn default() -> Self {
        VisualsLogo {
            on: false,
            place: LogoPlace::Corner,
            size: 0.18,
            pulse: 0.3,
        }
    }
}

/// Most favorite scenes.
pub const MAX_FAVOURITES: usize = 300;

/// A saved look: a scene and every effect setting.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct VisualsLook {
    pub scene: SceneRef,
    pub fx: VisualsFx,
}

/// Everything about the stage visuals.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", default)]
#[ts(export)]
pub struct Visuals {
    pub bpm: f64,
    /// The beat is `anchor_beat` at `anchor_at` and moves on at `bpm`.
    #[ts(type = "number")]
    pub anchor_at: Millis,
    pub anchor_beat: f64,
    /// The scene on (or coming, at `fade_start`).
    pub scene: SceneRef,
    /// The scene fading out.
    pub from: Option<SceneRef>,
    /// The beat the fade starts on (can be ahead: the change waits for it).
    pub fade_start: f64,
    /// Fade length in beats (0: a cut).
    pub fade_len: f64,
    /// The beat to change scene by itself (auto-change).
    pub next_auto: Option<f64>,
    pub settings: VisualsSettings,
    pub fx: VisualsFx,
    pub text: VisualsText,
    /// Held pads and toggles.
    pub strobe: bool,
    pub blackout: bool,
    pub invert: bool,
    /// Frozen on this beat.
    pub frozen: Option<f64>,
    /// The last white flash.
    #[ts(type = "number")]
    pub flash_at: Millis,
    /// Saved looks 1 – 8.
    pub looks: Vec<Option<VisualsLook>>,
    /// Scenes starred to find quickly.
    pub favourites: Vec<SceneRef>,
    pub logo: VisualsLogo,
}

impl Default for Visuals {
    fn default() -> Self {
        Visuals {
            bpm: 100.0,
            anchor_at: 0,
            anchor_beat: 0.0,
            scene: SceneRef { bank: 1, scene: 0 },
            from: None,
            fade_start: 0.0,
            fade_len: 0.0,
            next_auto: None,
            settings: VisualsSettings::default(),
            fx: VisualsFx::default(),
            text: VisualsText::default(),
            strobe: false,
            blackout: false,
            invert: false,
            frozen: None,
            flash_at: 0,
            looks: vec![None; LOOK_SLOTS],
            favourites: Vec::new(),
            logo: VisualsLogo::default(),
        }
    }
}

/// Change the held pads and toggles, the settings, effects or words. Only
/// what is given changes.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", default)]
#[ts(export)]
pub struct VisualsPatch {
    #[ts(optional)]
    pub settings: Option<VisualsSettings>,
    #[ts(optional)]
    pub fx: Option<VisualsFx>,
    #[ts(optional)]
    pub text: Option<VisualsText>,
    #[ts(optional)]
    pub strobe: Option<bool>,
    #[ts(optional)]
    pub blackout: Option<bool>,
    #[ts(optional)]
    pub invert: Option<bool>,
    #[ts(optional)]
    pub freeze: Option<bool>,
    #[ts(optional)]
    pub favourites: Option<Vec<SceneRef>>,
    #[ts(optional)]
    pub logo: Option<VisualsLogo>,
}

fn is_color(c: &str) -> bool {
    c.len() == 7 && c.starts_with('#') && c[1..].chars().all(|c| c.is_ascii_hexdigit())
}

impl Visuals {
    /// The beat at `now` (not counting freeze).
    pub fn beat_at(&self, now: Millis) -> f64 {
        let dt = now as f64 - self.anchor_at as f64;
        self.anchor_beat + dt * self.bpm / 60_000.0
    }

    /// Move the anchor to now, so a new tempo carries on from the same beat.
    fn reanchor(&mut self, now: Millis) {
        self.anchor_beat = self.beat_at(now);
        self.anchor_at = now;
    }

    pub fn set_bpm(&mut self, bpm: f64, now: Millis) {
        self.reanchor(now);
        self.bpm = (fit64(bpm, MIN_BPM, MAX_BPM, self.bpm) * 10.0).round() / 10.0;
        self.plan_auto(now);
    }

    /// Now is beat 1 of a bar.
    pub fn sync_to_one(&mut self, now: Millis) {
        let b = (self.beat_at(now) / 4.0).round() * 4.0;
        self.anchor_beat = b;
        self.anchor_at = now;
        if self.frozen.is_some() {
            self.frozen = Some(b);
        }
        self.next_auto = None;
        self.plan_auto(now);
    }

    /// Start a scene on the next beat / bar (or now), fading from the one on.
    pub fn launch(&mut self, to: SceneRef, now: Millis) {
        if !to.exists() {
            return;
        }
        let beat = self.beat_at(now);
        let pending = self.fade_start > beat;
        if to == self.scene && !pending {
            return;
        }
        if to.bank != self.scene.bank && self.settings.bank_tempo {
            let bpm = banks()[to.bank].bpm;
            self.set_bpm(bpm, now);
        }
        let beat = self.beat_at(now);
        let at = match self.settings.quantize {
            Quantize::Now => beat,
            Quantize::Beat => beat.ceil(),
            Quantize::Bar => (beat / 4.0).ceil() * 4.0,
        };
        // A change still waiting keeps fading from what is on screen now.
        if !pending {
            self.from = Some(self.scene);
        }
        self.scene = to;
        // Each scene starts with its own look: the effects go back to as
        // designed (the overlay layer stays; tempo, colors, energy, words
        // and logo are for the whole show).
        self.fx = VisualsFx {
            ov: self.fx.ov,
            ov_mode: self.fx.ov_mode,
            ov_scene: self.fx.ov_scene,
            ..VisualsFx::default()
        };
        self.fade_start = at;
        self.fade_len = if self.settings.fade < 0.0 {
            banks()[to.bank].fade
        } else {
            self.settings.fade
        };
        self.next_auto = None;
        self.plan_auto(now);
    }

    /// The next (or previous, `step` < 0) scene in the same music type.
    pub fn step(&mut self, step: i64, now: Millis) {
        let n = banks()[self.scene.bank].scenes.len();
        let i = if step < 0 {
            (self.scene.scene + n - 1) % n
        } else {
            (self.scene.scene + 1) % n
        };
        self.launch(
            SceneRef {
                bank: self.scene.bank,
                scene: i,
            },
            now,
        );
    }

    /// Work out when auto-change is next due (on the bar grid).
    fn plan_auto(&mut self, now: Millis) {
        let bars = f64::from(self.settings.auto_bars);
        if bars <= 0.0 {
            self.next_auto = None;
        } else if self.next_auto.is_none() {
            let bar = (self.beat_at(now) / 4.0).floor();
            self.next_auto = Some(((bar / bars).floor() + 1.0) * bars * 4.0);
        }
    }

    /// Auto-change is due.
    pub fn due(&self, now: Millis) -> bool {
        self.frozen.is_none() && self.next_auto.is_some_and(|b| self.beat_at(now) >= b)
    }

    /// Auto-change: the next scene, or a random other one.
    pub fn auto_change(&mut self, now: Millis) {
        let n = banks()[self.scene.bank].scenes.len();
        let i = if self.settings.auto_random && n > 1 {
            // Any other scene; the clock is random enough for this.
            let r = (now.wrapping_mul(6_364_136_223_846_793_005) >> 33) as usize;
            (self.scene.scene + 1 + r % (n - 1)) % n
        } else {
            (self.scene.scene + 1) % n
        };
        let quant = self.settings.quantize;
        // It is already on the bar: change now.
        self.settings.quantize = Quantize::Now;
        self.launch(
            SceneRef {
                bank: self.scene.bank,
                scene: i,
            },
            now,
        );
        self.settings.quantize = quant;
    }

    pub fn apply_patch(&mut self, p: VisualsPatch, now: Millis) {
        if let Some(st) = p.settings {
            let bars_changed = st.auto_bars != self.settings.auto_bars;
            self.settings = st;
            if bars_changed {
                self.next_auto = None;
            }
        }
        if let Some(fx) = p.fx {
            self.fx = fx;
        }
        if let Some(t) = p.text {
            self.text = t;
        }
        if let Some(v) = p.strobe {
            self.strobe = v;
        }
        if let Some(v) = p.blackout {
            self.blackout = v;
        }
        if let Some(v) = p.invert {
            self.invert = v;
        }
        if let Some(f) = p.favourites {
            self.favourites = f;
        }
        if let Some(l) = p.logo {
            self.logo = l;
        }
        if let Some(v) = p.freeze {
            if v != self.frozen.is_some() {
                self.frozen = v.then(|| self.beat_at(now));
            }
        }
        self.repair();
        self.plan_auto(now);
    }

    /// Keep a look in a slot (0 – 7).
    pub fn store_look(&mut self, slot: usize) {
        if let Some(l) = self.looks.get_mut(slot) {
            *l = Some(VisualsLook {
                scene: self.scene,
                fx: self.fx,
            });
        }
    }

    /// Bring back a saved look. False when the slot is empty.
    pub fn recall_look(&mut self, slot: usize, now: Millis) -> bool {
        let Some(Some(l)) = self.looks.get(slot).cloned() else {
            return false;
        };
        // After the change (which resets the effects), the look's own.
        self.launch(l.scene, now);
        self.fx = l.fx;
        true
    }

    pub fn repair(&mut self) {
        self.bpm = fit64(self.bpm, MIN_BPM, MAX_BPM, 100.0);
        if !self.anchor_beat.is_finite() {
            self.anchor_beat = 0.0;
        }
        self.scene = self.scene.repaired();
        self.from = self.from.filter(|f| f.exists());
        if !self.fade_start.is_finite() {
            self.fade_start = 0.0;
        }
        self.fade_len = fit64(self.fade_len, 0.0, 32.0, 0.0);
        self.next_auto = self.next_auto.filter(|b| b.is_finite());
        self.frozen = self.frozen.filter(|b| b.is_finite());
        let st = &mut self.settings;
        st.flash = fit(st.flash, 0.0, 1.0, 1.0);
        st.speed = fit(st.speed, 0.25, 2.0, 1.0);
        st.bright = fit(st.bright, 0.0, 1.5, 1.0);
        st.fade = fit64(st.fade, -1.0, 32.0, -1.0);
        st.auto_bars = st.auto_bars.min(64);
        st.flash_every = fit64(st.flash_every, 0.0, 4.0, 1.0);
        st.strobe_div = fit64(st.strobe_div, 1.0, 8.0, 2.0);
        st.quality = fit(st.quality, 0.5, 1.0, 1.0);
        if st.palette.len() > 20 || st.palette.is_empty() {
            "scene".clone_into(&mut st.palette);
        }
        self.fx.repair();
        let t = &mut self.text;
        if t.words.chars().count() > MAX_VISUALS_TEXT {
            t.words = t.words.chars().take(MAX_VISUALS_TEXT).collect();
        }
        if !["clean", "bold", "elegant", "classic"].contains(&t.font.as_str()) {
            "clean".clone_into(&mut t.font);
        }
        if !is_color(&t.color) {
            "#ffffff".clone_into(&mut t.color);
        }
        t.size = fit(t.size, 0.2, 1.2, 0.6);
        t.y = fit(t.y, -0.4, 0.4, 0.0);
        t.pulse = fit(t.pulse, 0.0, 1.0, 0.3);
        if st.safe {
            self.strobe = false;
        }
        let mut seen = std::collections::HashSet::new();
        self.favourites
            .retain(|f| f.exists() && seen.insert((f.bank, f.scene)));
        self.favourites.truncate(MAX_FAVOURITES);
        let l = &mut self.logo;
        l.size = fit(l.size, 0.05, 0.6, 0.18);
        l.pulse = fit(l.pulse, 0.0, 1.0, 0.3);
        self.looks.resize(LOOK_SLOTS, None);
        for l in self.looks.iter_mut().flatten() {
            l.scene = l.scene.repaired();
            l.fx.repair();
        }
    }
}
