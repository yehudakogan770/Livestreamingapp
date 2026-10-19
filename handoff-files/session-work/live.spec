@@@
    // As the WebView's replay buffer: 30 frames a second, 8 Mb/s.
    let mut video = encode::video_args(&VideoEncode {
        family,
        codec: Codec::H264,
        rate: Rate::Cbr { kbps: 8000 },
        preset: settings.preset,
        fps: 30,
        size: None,
    });
    video.extend(keyframe_args(PIECE_S));
===
    // As the WebView's replay buffer: 30 frames a second, 8 Mb/s.
    let ve = VideoEncode {
        family,
        codec: Codec::H264,
        rate: Rate::Cbr { kbps: 8000 },
        preset: settings.preset,
        fps: 30,
        size: None,
    };
    let mut video = encode::video_args(&ve);
    video.extend(keyframe_args(PIECE_S));
@@@
        width: c.width,
        height: c.height,
        fps: 30,
        zero_copy: None,
    };
    let r = Arc::clone(&runner);
===
        width: c.width,
        height: c.height,
        fps: 30,
        // A keyframe at every piece's start.
        zero_copy: zero_copy(&ve, 30 * PIECE_S),
    };
    let r = Arc::clone(&runner);
@@@
    let video = encode::video_args(&VideoEncode {
        family,
        codec: Codec::H264,
        rate: Rate::Cbr { kbps },
        preset: settings.preset,
        fps,
        size: None,
    });
    let audio = live_engine::encoder::AudioIn {
        rate: r.sample_rate,
===
    let ve = VideoEncode {
        family,
        codec: Codec::H264,
        rate: Rate::Cbr { kbps },
        preset: settings.preset,
        fps,
        size: None,
    };
    let video = encode::video_args(&ve);
    let audio = live_engine::encoder::AudioIn {
        rate: r.sample_rate,
@@@
        width: r.width.clamp(16, 7680) & !1,
        height: r.height.clamp(16, 4320) & !1,
        fps,
        zero_copy: None,
    };
===
        width: r.width.clamp(16, 7680) & !1,
        height: r.height.clamp(16, 4320) & !1,
        fps,
        zero_copy: zero_copy(&ve, fps * 2),
    };
@@@
    let encode_args = encode::video_args(&VideoEncode {
        family,
        codec: Codec::H264,
        rate: Rate::Cbr { kbps: 12_000 },
        preset: settings.preset,
        fps: c.fps,
        size: None,
    });
===
    let ve = VideoEncode {
        family,
        codec: Codec::H264,
        rate: Rate::Cbr { kbps: 12_000 },
        preset: settings.preset,
        fps: c.fps,
        size: None,
    };
    let encode_args = encode::video_args(&ve);
@@@
        width: c.width,
        height: c.height,
        fps: c.fps,
        zero_copy: None,
    };
===
        width: c.width,
        height: c.height,
        fps: c.fps,
        zero_copy: zero_copy(&ve, c.fps * 2),
    };
@@@
/// An encoder feed from the engine into `on_chunk`, with sound from `audio` (when given).
===
/// The settings for the graphics card's encoder to take the engine's picture
/// as a texture (zero-copy, `live_engine::zerocopy`): the same encoder,
/// bitrate and speed as FFmpeg would use (`encode.rs`), a keyframe every
/// `gop` frames. None for the processor encoder (x264 reads back as before),
/// or when `LUMORA_NO_ZERO_COPY` is set.
fn zero_copy(e: &VideoEncode, gop: u32) -> Option<live_engine::zerocopy::Settings> {
    use live_engine::zerocopy::{Rate as ZRate, Settings, Speed, Vendor};
    if std::env::var_os("LUMORA_NO_ZERO_COPY").is_some() {
        return None;
    }
    let vendor = match e.family {
        encode::Family::Nvenc => Vendor::Nvidia,
        encode::Family::Qsv => Vendor::Intel,
        encode::Family::Amf => Vendor::Amd,
        encode::Family::Software => return None,
    };
    Some(Settings {
        vendor,
        hevc: e.codec == Codec::Hevc,
        rate: match e.rate {
            Rate::Cbr { kbps } => ZRate::Cbr { kbps },
            Rate::Quality { level, max_kbps } => ZRate::Quality { level, max_kbps },
        },
        speed: match e.preset {
            encode::Preset::Speed => Speed::Speed,
            encode::Preset::Balanced => Speed::Balanced,
            encode::Preset::Quality => Speed::Quality,
        },
        gop,
    })
}

/// An encoder feed from the engine into `on_chunk`, with sound from `audio` (when given).
