    fn open_recording(
        &self,
        session: u64,
        mime: &str,
        name: &str,
        stopping: &Arc<AtomicBool>,
    ) -> Result<(Box<dyn Write + Send>, Running, Finish), String> {
        let folder = self.folder();
        fs::create_dir_all(&folder).map_err(|e| {
            format!(
                "The recordings folder {} can't be used: {e}",
                folder.display()
            )
        })?;
        let settings = self.settings();
        if let (Some(ffmpeg), true) = (self.ffmpeg.as_ref(), settings.record_encode) {
            let e = plan_record(&settings, self.family(&settings, settings.record_codec));
            return self.open_encoded_recording(ffmpeg, session, name, &folder, &settings, e, stopping);
        }
        let ext = if mime.contains("matroska") {
            "mkv"
        } else {
            "webm"
        };
        let path = unique_path(&folder, &file_name(name), ext);
        let file = File::create(&path)
            .map_err(|e| format!("Can't create the recording file {}: {e}", path.display()))?;
        let running = Running::new(
            session,
            Some(path.to_string_lossy().into_owned()),
            Vec::new(),
            WEBVIEW_ENCODER.to_owned(),
        );
        Ok((Box::new(file), running, Finish::Recording(path)))
    }

    /// A recording FFmpeg encodes again at constant quality (into an .mkv,
    /// which stays playable whatever happens).
    #[allow(clippy::too_many_arguments)]
    fn open_encoded_recording(
        &self,
        ffmpeg: &Path,
        session: u64,
        name: &str,
        folder: &Path,
        settings: &CaptureSettings,
        e: VideoEncode,
        stopping: &Arc<AtomicBool>,
    ) -> Result<(Box<dyn Write + Send>, Running, Finish), String> {
        let path = unique_path(folder, &file_name(name), "mkv");
        let speed_to = Arc::clone(&self.shared);
        let end_to = Arc::clone(&self.shared);
        let family = e.family;
        let (child, stdin) = spawn_watched(
            ffmpeg,
            &record_args(&e, &path),
            self.stall,
            stopping,
            move |speed| speed_to.running(Kind::Record, session, |r| r.speed = speed),
            |_| {},
            move |_sent, said| {
                let detail = ffmpeg_detail(&said);
                if family.hardware() && encode::encoder_failed(&said) {
                    end_to.hw_failed(family);
                    end_to.fail_with(
                        Kind::Record,
                        session,
                        format!(
                            "The {} encoder stopped ({detail}). The recording so far is kept; \
                             Lumora goes on recording with the processor (x264) in a new file.",
                            family.label()
                        ),
                        false,
                        true,
                    );
                } else {
                    end_to.fail(
                        Kind::Record,
                        session,
                        format!("The recording encoder stopped ({detail}). The recording so far is kept."),
                    );
                }
            },
        )?;
        let mut running = Running::new(
            session,
            Some(path.to_string_lossy().into_owned()),
            Vec::new(),
            format!(
                "{} ({}), constant quality",
                family.label(),
                family.encoder(e.codec)
            ),
        );
        running.source_kbps = Some(encode::source_kbps(
            settings.video_kbps,
            settings.quality.kbps(),
        ));
        let hevc = family.encoder(e.codec).starts_with("hevc");
        Ok((
            Box::new(StdinWriter(stdin)),
            running,
            Finish::Encoded { child, path, hevc },
        ))
    }

    fn open_stream(
        &self,
        kind: Kind,
        session: u64,
        mime: &str,
        stopping: &Arc<AtomicBool>,
        rehearse: bool,
    ) -> Result<(Box<dyn Write + Send>, Running, Finish), String> {
        let ffmpeg = self.ffmpeg.as_ref().ok_or(
            "Streaming needs FFmpeg, which was not found on this computer. \
             Put ffmpeg.exe next to Lumora (or install FFmpeg) and start Lumora again.",
        )?;
        let settings = self.settings();
        let dests = destinations_for(&settings, kind);
        if rehearse {
            // Nothing leaves the computer.
        } else if dests.is_empty() && kind == Kind::Vertical {
            return Err("No destination gets the vertical version.".to_owned());
        } else if dests.is_empty() && !destinations_for(&settings, Kind::Vertical).is_empty() {
            return Err(
                "Every destination gets the vertical version. Add a wide one too, or set \
                 the picture to Vertical in Settings → Recording and streaming to stream \
                 only vertical."
                    .to_owned(),
            );
        } else if dests.is_empty() {
            return Err(
                "There is nowhere to stream to yet. Add YouTube, Facebook or another \
                        destination in Settings → Recording and streaming."
                    .to_owned(),
            );
        }
        if !rehearse {
            preflight(&dests)?;
        }
        let targets: Vec<(String, String, Option<u32>)> = if rehearse {
            Vec::new()
        } else {
            dests
                .iter()
                .map(|d| (d.name.clone(), d.target(), d.video_kbps))
                .collect()
        };
        let family = self.family(&settings, Codec::H264);
        let plan = plan_stream(&settings, kind, mime, family, &targets);
        let n = plan.groups.len();
        let remaining = Arc::new(AtomicUsize::new(n));
        let any_sent = Arc::new(AtomicBool::new(false));
        let speeds = Arc::new(Mutex::new(vec![None::<f32>; n]));
        let pids = Arc::new(Mutex::new(Vec::<u32>::new()));
        let mut children = Vec::new();
        let mut inputs = Vec::new();
        for (i, (group, enc)) in plan.groups.iter().enumerate() {
            let args = stream_args(group, enc.as_ref(), settings.audio_kbps);
            let on_speed = {
                let (shared, speeds) = (Arc::clone(&self.shared), Arc::clone(&speeds));
                move |speed: Option<f32>| {
                    let slowest = {
                        let mut s = lock(&speeds);
                        s[i] = speed;
                        s.iter().flatten().copied().reduce(f32::min)
                    };
                    shared.running(kind, session, |r| r.speed = slowest);
                }
            };
            let on_line = {
                let (shared, names) = (Arc::clone(&self.shared), group.names.clone());
                move |line: &str| {
                    if let Some(name) = encode::dropped_output(line).and_then(|k| names.get(k)) {
                        eprintln!("lumora: {kind:?} {session}: {name} dropped out");
                        let name = name.clone();
                        shared.running(kind, session, |r| {
                            if !r.dropped.contains(&name) {
                                r.dropped.push(name);
                            }
                        });
                    }
                }
            };
            let on_end = {
                let shared = Arc::clone(&self.shared);
                let (remaining, any_sent, pids) =
                    (Arc::clone(&remaining), Arc::clone(&any_sent), Arc::clone(&pids));
                let names = group.names.clone();
                let hw = enc.is_some_and(|e| e.family.hardware());
                move |sent: bool, said: String| {
                    if sent {
                        any_sent.store(true, Ordering::SeqCst);
                    }
                    if hw && encode::encoder_failed(&said) {
                        // Everything starts again with the processor's encoder.
                        shared.hw_failed(family);
                        shared.fail_with(
                            kind,
                            session,
                            format!(
                                "The {} encoder stopped ({}). Lumora switched to the processor \
                                 (x264) and is starting the stream again.",
                                family.label(),
                                ffmpeg_detail(&said)
                            ),
                            false,
                            true,
                        );
                        lock(&pids).iter().copied().for_each(kill_pid);
                    } else if remaining.fetch_sub(1, Ordering::SeqCst) == 1 {
                        shared.fail_how(
                            kind,
                            session,
                            explain_stream_error(&said),
                            !any_sent.load(Ordering::SeqCst),
                        );
                    } else {
                        // The other destinations carry on.
                        eprintln!("lumora: {kind:?} {session}: {names:?} stopped: {said}");
                        shared.running(kind, session, |r| {
                            for name in &names {
                                if !r.dropped.contains(name) {
                                    r.dropped.push(name.clone());
                                }
                            }
                        });
                    }
                }
            };
            match spawn_watched(ffmpeg, &args, self.stall, stopping, on_speed, on_line, on_end) {
                Ok((child, stdin)) => {
                    lock(&pids).push(child.id());
                    children.push(child);
                    inputs.push(Some(stdin));
                }
                Err(e) => {
                    stopping.store(true, Ordering::SeqCst);
                    for mut c in children {
                        let _ = c.kill();
                        let _ = c.wait();
                    }
                    return Err(e);
                }
            }
        }
        let mut running = Running::new(
            session,
            None,
            if rehearse {
                vec!["Rehearsal (nothing sent)".to_owned()]
            } else {
                dests.iter().map(|d| d.name.clone()).collect()
            },
            plan.label(),
        );
        running.source_kbps = Some(plan.source_kbps);
        Ok((
            Box::new(FanOut(inputs)),
            running,
            Finish::Stream(children),
        ))
    }
}
