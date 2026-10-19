p='/home/user/Livestreamingapp/.claude/worktrees/agent-aefea299a26a1206e/crates/live-engine/src/encoder.rs'
s=open(p).read()
a='''        let probe = quiet("ffprobe")
            .args(["-v", "error", "-show_entries", "stream=codec_type,duration", "-of", "csv=p=0"])
            .arg(&path)
            .output();
        let _ = std::fs::remove_dir_all(&dir);
        let Ok(probe) = probe else {
            eprintln!("no ffprobe here; the file was made");
            return;
        };
        let text = String::from_utf8_lossy(&probe.stdout);
        assert!(text.contains("video"), "{text}");
        assert!(text.contains("audio"), "{text}");
        assert!(stats.audio_samples > 30_000, "{stats:?}");'''
b='''        // Each stream's length, as FFmpeg reads the file back.
        let probe = quiet("ffprobe")
            .args([
                "-v",
                "error",
                "-show_entries",
                "stream=codec_type:stream_tags=DURATION",
                "-of",
                "csv=p=0",
            ])
            .arg(&path)
            .output();
        let _ = std::fs::remove_dir_all(&dir);
        let Ok(probe) = probe else {
            eprintln!("no ffprobe here; the file was made");
            return;
        };
        let text = String::from_utf8_lossy(&probe.stdout).into_owned();
        let secs = |kind: &str| -> f64 {
            let line = text.lines().find(|l| l.starts_with(kind)).unwrap_or("");
            let d = line.split(',').nth(1).unwrap_or("0");
            // h:mm:ss.fraction
            d.split(':')
                .map(|p| p.trim().parse::<f64>().unwrap_or(0.0))
                .fold(0.0, |acc, v| acc * 60.0 + v)
        };
        let (v, a) = (secs("video"), secs("audio"));
        eprintln!("video {v} s, audio {a} s");
        assert!(v > 0.9 && a > 0.6, "{text}");
        // The picture is exactly as long as the time it covered; the sound
        // stops up to its lag behind the wall clock.
        assert!((v - a).abs() < 0.45, "video {v} s, audio {a} s: {text}");
        assert!(stats.audio_samples > 30_000, "{stats:?}");'''
assert s.count(a)==1
s=s.replace(a,b)
open(p,'w').write(s)
