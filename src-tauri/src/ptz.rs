//! PTZ camera control over the network with VISCA: move, zoom, go to and
//! store presets. VISCA over IP (UDP 52381, used by Sony, BirdDog, Panasonic
//! in VISCA mode and most others) or plain VISCA over TCP (`PTZOptics` 5678).

use std::io::Write;
use std::net::{TcpStream, ToSocketAddrs, UdpSocket};
use std::sync::atomic::{AtomicU32, Ordering};
use std::time::Duration;

use lumora_engine::ptz::{Ptz, PtzProtocol};
use serde::Deserialize;

/// What to make a camera do.
#[derive(Debug, Clone, Copy, PartialEq, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum PtzCommand {
    /// Pan and tilt: −1 (left / down) to 1 (right / up); speed 0 – 1.
    Move { pan: f32, tilt: f32, speed: f32 },
    /// Stop moving.
    Stop,
    /// −1 wider, 1 closer, 0 stop; speed 0 – 1.
    Zoom { dir: i8, speed: f32 },
    /// Straight ahead.
    Home,
    /// Go to preset 0 – 127.
    Recall { preset: u8 },
    /// Store where the camera is as preset 0 – 127.
    Store { preset: u8 },
    /// Focus by itself.
    AutoFocus,
}

#[allow(clippy::cast_possible_truncation, clippy::cast_sign_loss)]
fn scale(speed: f32, max: u8) -> u8 {
    let s = if speed.is_finite() {
        speed.clamp(0.0, 1.0)
    } else {
        0.5
    };
    (1.0 + s * f32::from(max - 1)).round() as u8
}

/// The VISCA bytes for a command (camera 1).
#[must_use]
pub fn visca(cmd: PtzCommand) -> Vec<u8> {
    match cmd {
        PtzCommand::Move { pan, tilt, speed } => {
            let dir = |v: f32, neg: u8, pos: u8| {
                if v < -0.1 {
                    neg
                } else if v > 0.1 {
                    pos
                } else {
                    3
                }
            };
            let (x, y) = (dir(pan, 1, 2), dir(tilt, 2, 1));
            vec![
                0x81,
                0x01,
                0x06,
                0x01,
                scale(speed, 0x18),
                scale(speed, 0x14),
                x,
                y,
                0xFF,
            ]
        }
        PtzCommand::Stop => vec![0x81, 0x01, 0x06, 0x01, 0x01, 0x01, 0x03, 0x03, 0xFF],
        PtzCommand::Zoom { dir, speed } => {
            let p = scale(speed, 8) - 1;
            let b = match dir.signum() {
                1 => 0x20 | p,
                -1 => 0x30 | p,
                _ => 0x00,
            };
            vec![0x81, 0x01, 0x04, 0x07, b, 0xFF]
        }
        PtzCommand::Home => vec![0x81, 0x01, 0x06, 0x04, 0xFF],
        PtzCommand::Recall { preset } => vec![0x81, 0x01, 0x04, 0x3F, 0x02, preset.min(127), 0xFF],
        PtzCommand::Store { preset } => vec![0x81, 0x01, 0x04, 0x3F, 0x01, preset.min(127), 0xFF],
        PtzCommand::AutoFocus => vec![0x81, 0x01, 0x04, 0x38, 0x02, 0xFF],
    }
}

/// VISCA over IP: an 8-byte header (command, length, sequence) before the bytes.
#[must_use]
pub fn over_ip(seq: u32, payload: &[u8]) -> Vec<u8> {
    let len = u16::try_from(payload.len()).unwrap_or(u16::MAX);
    let mut out = vec![0x01, 0x00];
    out.extend_from_slice(&len.to_be_bytes());
    out.extend_from_slice(&seq.to_be_bytes());
    out.extend_from_slice(payload);
    out
}

static SEQ: AtomicU32 = AtomicU32::new(1);

/// Send a command to a camera.
///
/// # Errors
/// A plain message when the camera can't be reached.
pub fn send(ptz: &Ptz, cmd: PtzCommand) -> Result<(), String> {
    let host = ptz.host.trim();
    if host.is_empty() {
        return Err("Type the camera's address first.".to_owned());
    }
    let bytes = visca(cmd);
    let port = match (ptz.port, ptz.protocol) {
        (0, PtzProtocol::ViscaUdp) => 52381,
        (0, PtzProtocol::ViscaTcp) => 5678,
        (p, _) => p,
    };
    let addr = (host, port)
        .to_socket_addrs()
        .map_err(|_| format!("Can't find {host} on the network."))?
        .next()
        .ok_or_else(|| format!("Can't find {host} on the network."))?;
    match ptz.protocol {
        PtzProtocol::ViscaUdp => {
            let sock = UdpSocket::bind(if addr.is_ipv6() {
                "[::]:0"
            } else {
                "0.0.0.0:0"
            })
            .map_err(|e| e.to_string())?;
            let seq = SEQ.fetch_add(1, Ordering::Relaxed);
            sock.send_to(&over_ip(seq, &bytes), addr)
                .map(|_| ())
                .map_err(|_| format!("Can't reach the camera at {host}."))
        }
        PtzProtocol::ViscaTcp => {
            let mut s = TcpStream::connect_timeout(&addr, Duration::from_millis(800))
                .map_err(|_| format!("Can't reach the camera at {host}:{port}."))?;
            s.set_write_timeout(Some(Duration::from_millis(800))).ok();
            s.write_all(&bytes)
                .map_err(|_| format!("The camera at {host} stopped answering."))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn commands_are_visca() {
        assert_eq!(
            visca(PtzCommand::Move {
                pan: -1.0,
                tilt: 1.0,
                speed: 1.0
            }),
            [0x81, 1, 6, 1, 0x18, 0x14, 1, 1, 0xFF]
        );
        assert_eq!(
            visca(PtzCommand::Move {
                pan: 1.0,
                tilt: -1.0,
                speed: 0.0
            }),
            [0x81, 1, 6, 1, 1, 1, 2, 2, 0xFF]
        );
        assert_eq!(
            visca(PtzCommand::Move {
                pan: 0.0,
                tilt: 0.0,
                speed: 0.5
            })[6..8],
            [3, 3]
        );
        assert_eq!(
            visca(PtzCommand::Zoom { dir: 1, speed: 1.0 }),
            [0x81, 1, 4, 7, 0x27, 0xFF]
        );
        assert_eq!(
            visca(PtzCommand::Zoom {
                dir: -1,
                speed: 0.0
            }),
            [0x81, 1, 4, 7, 0x30, 0xFF]
        );
        assert_eq!(
            visca(PtzCommand::Zoom { dir: 0, speed: 0.5 }),
            [0x81, 1, 4, 7, 0, 0xFF]
        );
        assert_eq!(
            visca(PtzCommand::Recall { preset: 3 }),
            [0x81, 1, 4, 0x3F, 2, 3, 0xFF]
        );
        assert_eq!(visca(PtzCommand::Store { preset: 200 })[5], 127);
        assert_eq!(
            over_ip(7, &[0x81, 0xFF]),
            [1, 0, 0, 2, 0, 0, 0, 7, 0x81, 0xFF]
        );
    }

    #[test]
    fn sends_to_a_camera_over_udp_and_tcp() {
        let cam = UdpSocket::bind("127.0.0.1:0").unwrap();
        cam.set_read_timeout(Some(Duration::from_secs(2))).unwrap();
        let ptz = Ptz {
            host: "127.0.0.1".into(),
            port: cam.local_addr().unwrap().port(),
            ..Ptz::default()
        };
        send(&ptz, PtzCommand::Home).unwrap();
        let mut buf = [0u8; 64];
        let n = cam.recv(&mut buf).unwrap();
        assert_eq!(&buf[8..n], &[0x81, 1, 6, 4, 0xFF]);

        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let tcp = Ptz {
            host: "127.0.0.1".into(),
            port: listener.local_addr().unwrap().port(),
            protocol: PtzProtocol::ViscaTcp,
            ..Ptz::default()
        };
        send(&tcp, PtzCommand::Stop).unwrap();
        let (mut s, _) = listener.accept().unwrap();
        let mut got = Vec::new();
        std::io::Read::read_to_end(&mut s, &mut got).unwrap();
        assert_eq!(got, visca(PtzCommand::Stop));
        assert!(send(&Ptz::default(), PtzCommand::Stop).is_err());
    }
}
