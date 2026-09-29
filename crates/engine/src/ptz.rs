//! PTZ (pan, tilt, zoom) cameras: where to reach one over the network. The
//! app sends it VISCA commands; the show only remembers the address.

use serde::{Deserialize, Serialize};
use ts_rs::TS;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub enum PtzProtocol {
    /// VISCA over IP (Sony and most others): UDP, port 52381.
    #[default]
    ViscaUdp,
    /// Plain VISCA over TCP (`PTZOptics` and others): port 5678.
    ViscaTcp,
}

#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", default)]
#[ts(export)]
pub struct Ptz {
    /// The camera's IP address or name.
    pub host: String,
    /// 0: the usual port for the protocol.
    pub port: u16,
    pub protocol: PtzProtocol,
    /// Names for the preset buttons (empty: just the number).
    pub presets: Vec<String>,
}

impl Ptz {
    pub fn repair(&mut self) {
        self.host = self
            .host
            .trim()
            .chars()
            .filter(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '-' | ':' | '[' | ']'))
            .take(100)
            .collect();
        self.presets.truncate(16);
        for p in &mut self.presets {
            *p = p.chars().take(30).collect();
        }
    }
}
