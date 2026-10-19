    /// Picture and sound into one file, the sound lined up by its time
    /// although it arrives 80 ms late: a white flash and a tone start at the
    /// same moment, and FFmpeg's own decode of the file finds them together.
    #[test]
    fn picture_and_sound_together_when_ffmpeg_is_present() {
        let Some(ffmpeg) = ffmpeg() else { return };
        let dir = std::env::temp_dir().join(format!("lumora-feed-{}", std::process::id()));
        let _ = std::fs::create_dir_all(&dir);
        let path = dir.join("av.mkv");
        let (atx, arx) = sync_channel(64);
        let mut feed = EncoderFeed::start(
            &ffmpeg,
            FeedArgs {
                width: 64,
                height: 36,
                fps: 30,
                pix_fmt: "rgba",
                encode: vec!["-c:v".into(), "mpeg4".into(), "-q:v".into(), "2".into()],
                container: vec![
                    "-f".into(),
                    "matroska".into(),
                    "-y".into(),
                    path.to_string_lossy().into_owned(),
                ],
                audio: Some(AudioIn {
                    rate: 48_000,
                    encode: vec!["-c:a".into(), "pcm_s16le".into()],
                    chunks: arx,
                }),
            },
            Box::new(|_| {}),
            None,
        )
        .expect("starts");
        const FLASH_MS: u64 = 700;
        const LATE_MS: u64 = 80;
        let t0 = now_ms();
        let mut sent_audio = 0u64;
        while now_ms() < t0 + 1500 {
            let now = now_ms();
            let n = feed.due(now);
            if n > 0 {
                let v = if now >= t0 + FLASH_MS { 255 } else { 0 };
                feed.push(Pixels::Owned(vec![v; 64 * 36 * 4]), n);
            }
            // 20 ms of sound, sent 80 ms after its time (a busy web view):
            // silence, then a tone from the flash on.
            while t0 + sent_audio * 20 + 20 + LATE_MS <= now {
                let pcm: Vec<u8> = (0..960u64)
                    .flat_map(|i| {
                        let at = sent_audio * 960 + i;
                        let on = at * 1000 >= FLASH_MS * 48_000;
                        let t = at as f32 / 48_000.0;
                        let v = if on {
                            ((t * 440.0 * std::f32::consts::TAU).sin() * 12_000.0) as i16
                        } else {
                            0
                        };
                        let b = v.to_le_bytes();
                        [b[0], b[1], b[0], b[1]]
                    })
                    .collect();
                let _ = atx.try_send(PcmChunk {
                    at_ms: (t0 + sent_audio * 20) as f64,
                    rate: 48_000,
                    pcm: Arc::new(pcm),
                });
                sent_audio += 1;
            }
            std::thread::sleep(Duration::from_millis(4));
        }
        let stats = feed.finish();
        assert!(stats.frames_in >= 43, "{stats:?}");
        assert!(stats.audio_samples > 48_000, "{stats:?}");
        // Decode both back: the picture as one gray value a frame, the sound as samples.
        let video = quiet(&ffmpeg)
            .args(["-v", "error", "-i"])
            .arg(&path)
            .args(["-map", "0:v", "-vf", "scale=1:1", "-f", "rawvideo", "-pix_fmt", "gray", "-"])
            .output()
            .expect("decodes");
        let audio = quiet(&ffmpeg)
            .args(["-v", "error", "-i"])
            .arg(&path)
            .args(["-map", "0:a", "-ac", "1", "-f", "s16le", "-"])
            .output()
            .expect("decodes");
        let _ = std::fs::remove_dir_all(&dir);
        let first_white = video.stdout.iter().position(|v| *v > 128).expect("a flash");
        let samples: Vec<i16> = audio
            .stdout
            .chunks_exact(2)
            .map(|b| i16::from_le_bytes([b[0], b[1]]))
            .collect();
        let first_tone = samples
            .iter()
            .position(|v| v.unsigned_abs() > 2000)
            .expect("a tone");
        let flash = first_white as f64 / 30.0;
        let tone = first_tone as f64 / 48_000.0;
        eprintln!("flash at {flash:.3} s, tone at {tone:.3} s ({stats:?})");
        assert!(
            (flash - tone).abs() <= 0.045,
            "flash at {flash:.3} s, tone at {tone:.3} s"
        );
        assert!((flash - FLASH_MS as f64 / 1000.0).abs() <= 0.045, "{flash}");
    }
}
