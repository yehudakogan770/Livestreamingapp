//! Which graphics card draws, and which shows each output window.
//!
//! - **The engine's card** (Settings → Engine → Graphics card): automatic is
//!   the high-performance card (on a hybrid laptop the NVIDIA or AMD one, not
//!   the integrated one; Windows' own per-app graphics setting still has the
//!   last word), or one chosen by name.
//! - **Each output window** shows on the engine's card by default; when its
//!   display hangs off another card (a projector on the integrated GPU's HDMI
//!   port of a hybrid laptop, two cards in a desktop), Windows copies every
//!   frame across. The operator can instead have that output **presented by
//!   its display's own card**: the engine copies the picture across itself
//!   (read back one frame late, uploaded to a device on the other card,
//!   [`Bridge`]) and the window flips on its own card.
//!
//! Which display hangs off which card comes from DXGI (`EnumOutputs`, the
//! display's desktop rectangle) on Windows; elsewhere nothing is known and
//! every output stays on the engine's card.

use serde::Serialize;

use crate::gpu::{Compositor, Dest};

/// A graphics card the engine could use.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Card {
    /// Stable while the cards stay the same: vendor, device, backend and which of identical ones.
    pub key: String,
    pub name: String,
    pub backend: String,
    /// "discrete", "integrated", "software", "virtual" or "other".
    pub kind: &'static str,
    /// The displays it drives (desktop rectangles, physical pixels). Windows only.
    pub displays: Vec<(i32, i32, u32, u32)>,
}

/// A card's key: vendor and device ids, backend, and its place among identical ones.
pub fn key_of(info: &wgpu::AdapterInfo, nth: usize) -> String {
    format!(
        "{:04x}-{:04x}-{:?}-{nth}",
        info.vendor, info.device, info.backend
    )
}

/// The keys of `infos`, in order (identical cards numbered in the order listed).
pub fn keys(infos: &[wgpu::AdapterInfo]) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    for (i, info) in infos.iter().enumerate() {
        let nth = infos[..i]
            .iter()
            .filter(|o| (o.vendor, o.device, o.backend) == (info.vendor, info.device, info.backend))
            .count();
        out.push(key_of(info, nth));
    }
    out
}

/// Every card wgpu offers here, with the displays each drives.
pub fn cards(instance: &wgpu::Instance) -> Vec<Card> {
    let adapters = pollster::block_on(instance.enumerate_adapters(wgpu::Backends::all()));
    let infos: Vec<wgpu::AdapterInfo> = adapters.iter().map(wgpu::Adapter::get_info).collect();
    keys(&infos)
        .into_iter()
        .zip(adapters.iter().zip(infos))
        .map(|(key, (a, i))| Card {
            key,
            kind: crate::gpu::kind_of(i.device_type),
            backend: format!("{:?}", i.backend),
            name: i.name,
            displays: displays_of(a),
        })
        .collect()
}

/// The adapter of `instance` with key `key`.
pub fn find(instance: &wgpu::Instance, key: &str) -> Option<wgpu::Adapter> {
    let adapters = pollster::block_on(instance.enumerate_adapters(wgpu::Backends::all()));
    let infos: Vec<wgpu::AdapterInfo> = adapters.iter().map(wgpu::Adapter::get_info).collect();
    let i = keys(&infos).iter().position(|k| k == key)?;
    adapters.into_iter().nth(i)
}

/// The key of the card `adapter` is (among `instance`'s).
pub fn key_in(instance: &wgpu::Instance, adapter: &wgpu::Adapter) -> Option<String> {
    let me = adapter.get_info();
    let adapters = pollster::block_on(instance.enumerate_adapters(wgpu::Backends::all()));
    let infos: Vec<wgpu::AdapterInfo> = adapters.iter().map(wgpu::Adapter::get_info).collect();
    let keys = keys(&infos);
    let same = |o: &wgpu::AdapterInfo| {
        (o.vendor, o.device, o.backend, &o.name) == (me.vendor, me.device, me.backend, &me.name)
    };
    // Identical cards: the first of them (wgpu doesn't say which one it took).
    infos.iter().position(same).map(|i| keys[i].clone())
}

/// The card that drives the display at `rect` (when known).
pub fn card_for_display(cards: &[Card], rect: (i32, i32, u32, u32)) -> Option<&Card> {
    cards
        .iter()
        .find(|c| c.displays.contains(&rect))
        .or_else(|| {
            // Not the very same rectangle (scaling changed since): the one it lies on.
            let (x, y, w, h) = rect;
            let (cx, cy) = (x + (w / 2) as i32, y + (h / 2) as i32);
            cards.iter().find(|c| {
                c.displays.iter().any(|&(dx, dy, dw, dh)| {
                    cx >= dx && cy >= dy && cx < dx + dw as i32 && cy < dy + dh as i32
                })
            })
        })
}

/// How an output window is presented, for the Engine dialog and the test event.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct OutputCard {
    /// `live`, `back`, `monitor` or `multiview`.
    pub output: String,
    /// The card that drives its display (None: unknown, or a window).
    pub display_card: Option<String>,
    /// The card that presents it.
    pub presented_by: String,
    /// The engine copies the picture to the display's card itself.
    pub copied: bool,
    /// HDR10 (PQ), scRGB or SDR, as the window shows now.
    pub color: String,
}

/// An output presented by another card than the engine's: a small
/// compositor there, the picture copied in every frame (read back one frame
/// late on the engine's card, uploaded on this one).
pub struct Bridge {
    pub gpu: Compositor,
    pub key: String,
}

/// The target a bridge's copy is kept in.
const BRIDGE_TARGET: usize = 0;

impl Bridge {
    /// A device on the card `key` (from `instance`, which made the window's surface).
    ///
    /// # Errors
    /// No such card, or it could not start.
    pub fn open(instance: &wgpu::Instance, key: &str) -> Result<Self, String> {
        let adapter = find(instance, key).ok_or("That graphics card is gone.")?;
        let gpu = Compositor::on_adapter(instance.clone(), adapter)?;
        Ok(Bridge {
            gpu,
            key: key.to_owned(),
        })
    }

    /// Copy target `i` of the engine's card across: last frame's picture
    /// (the read-back is one frame late, so the engine never waits).
    /// False until the first copy has arrived.
    pub fn carry(&mut self, from: &mut Compositor, i: usize) -> bool {
        match from.read_pipelined(Dest::Target(i)) {
            Some((w, h, px)) => {
                self.gpu.write_target(BRIDGE_TARGET, w, h, &px);
                true
            }
            None => self.gpu.target_size(BRIDGE_TARGET).is_some(),
        }
    }

    /// The copy's target on the bridge's card.
    pub fn target(&self) -> usize {
        BRIDGE_TARGET
    }
}

#[cfg(windows)]
#[allow(unsafe_code)]
fn displays_of(adapter: &wgpu::Adapter) -> Vec<(i32, i32, u32, u32)> {
    let mut out = Vec::new();
    // SAFETY: reading the DXGI adapter wgpu holds (it outlives this call)
    // and its outputs' descriptions.
    unsafe {
        let Some(hal) = adapter.as_hal::<wgpu::hal::api::Dx12>() else {
            return out;
        };
        let raw = hal.raw_adapter();
        let mut i = 0;
        while let Ok(o) = raw.EnumOutputs(i) {
            if let Ok(d) = o.GetDesc() {
                let r = d.DesktopCoordinates;
                if d.AttachedToDesktop.as_bool() {
                    out.push((
                        r.left,
                        r.top,
                        (r.right - r.left).max(0) as u32,
                        (r.bottom - r.top).max(0) as u32,
                    ));
                }
            }
            i += 1;
        }
    }
    out
}

#[cfg(not(windows))]
fn displays_of(_adapter: &wgpu::Adapter) -> Vec<(i32, i32, u32, u32)> {
    Vec::new()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn info(vendor: u32, device: u32, name: &str) -> wgpu::AdapterInfo {
        wgpu::AdapterInfo {
            name: name.into(),
            vendor,
            device,
            device_type: wgpu::DeviceType::DiscreteGpu,
            backend: wgpu::Backend::Dx12,
            ..wgpu::AdapterInfo::new(wgpu::DeviceType::DiscreteGpu, wgpu::Backend::Dx12)
        }
    }

    #[test]
    fn identical_cards_get_their_own_keys() {
        let k = keys(&[
            info(0x10de, 0x2684, "RTX 4090"),
            info(0x8086, 0xa7a0, "Iris Xe"),
            info(0x10de, 0x2684, "RTX 4090"),
        ]);
        assert_eq!(k[0], "10de-2684-Dx12-0");
        assert_eq!(k[1], "8086-a7a0-Dx12-0");
        assert_eq!(k[2], "10de-2684-Dx12-1");
    }

    fn card(key: &str, displays: Vec<(i32, i32, u32, u32)>) -> Card {
        Card {
            key: key.into(),
            name: key.into(),
            backend: "Dx12".into(),
            kind: "discrete",
            displays,
        }
    }

    #[test]
    fn a_display_is_found_on_the_card_that_drives_it() {
        // A hybrid laptop: the panel on the integrated card, the projector on the NVIDIA one.
        let cards = [
            card("nvidia", vec![(1920, 0, 1920, 1080)]),
            card("intel", vec![(0, 0, 1920, 1080)]),
        ];
        assert_eq!(
            card_for_display(&cards, (0, 0, 1920, 1080)).unwrap().key,
            "intel"
        );
        assert_eq!(
            card_for_display(&cards, (1920, 0, 1920, 1080)).unwrap().key,
            "nvidia"
        );
        // Scaled since (another rectangle on the same display): the one it lies on.
        assert_eq!(
            card_for_display(&cards, (1920, 0, 1280, 720)).unwrap().key,
            "nvidia"
        );
        assert!(card_for_display(&cards, (-4000, 0, 800, 600)).is_none());
    }
}
