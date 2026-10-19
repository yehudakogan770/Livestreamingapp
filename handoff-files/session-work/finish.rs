/// What happens after the last chunk.
enum Finish {
    Recording(PathBuf),
    /// A recording FFmpeg encodes (it gets time to write the end of the file).
    Encoded {
        child: Child,
        path: PathBuf,
        hevc: bool,
    },
    /// The FFmpegs of a stream, one per bitrate (a failure is reported by
    /// their progress readers).
    Stream(Vec<Child>),
    /// The FFmpegs that unpack the picture and sound for NDI.
    Ndi(Vec<Child>),
}

impl Finish {
    /// The FFmpegs being fed.
    fn pids(&self) -> Vec<u32> {
        match self {
            Finish::Recording(_) => Vec::new(),
            Finish::Encoded { child, .. } => vec![child.id()],
            Finish::Stream(children) | Finish::Ndi(children) => {
                children.iter().map(Child::id).collect()
            }
        }
    }

    /// `ended` is set once no FFmpeg is being fed any more (the .mp4 may still be made).
    fn run(self, shared: &Shared, ffmpeg: Option<&Path>, mime: &str, ended: &AtomicBool) {
        match self {
            Finish::Recording(path) => {
                let can_mp4 = mime.contains("avc1") || mime.contains("h264");
                finish_recording(shared, ffmpeg.filter(|_| can_mp4), path, false);
            }
            Finish::Encoded { child, path, hevc } => {
                finish_child(child, ENCODE_GRACE);
                ended.store(true, Ordering::SeqCst);
                // A hardware encoder that never started leaves nothing worth keeping.
                if fs::metadata(&path).map_or(0, |m| m.len()) < 1024 {
                    let _ = fs::remove_file(&path);
                    return;
                }
                finish_recording(shared, ffmpeg, path, hevc);
            }
            Finish::Stream(children) | Finish::Ndi(children) => {
                for c in children {
                    finish_child(c, Duration::from_secs(5));
                }
            }
        }
    }
}

/// Turn a finished recording into an .mp4 (when it can be) and say it is ready.
fn finish_recording(shared: &Shared, ffmpeg: Option<&Path>, path: PathBuf, hevc: bool) {
    match ffmpeg {
        Some(ffmpeg) => {
            shared.update(|s| s.finishing = true);
            let done = to_mp4(ffmpeg, &path, hevc).unwrap_or(path);
            shared.update(|s| {
                s.finishing = false;
                s.last_recording = Some(done.to_string_lossy().into_owned());
            });
        }
        None => shared.update(|s| {
            s.last_recording = Some(path.to_string_lossy().into_owned());
        }),
    }
}

/// Stdin is closed: give FFmpeg a moment to finish, then make sure it's gone.
fn finish_child(mut child: Child, within: Duration) {
    let deadline = Instant::now() + within;
    loop {
        match child.try_wait() {
            Ok(Some(_)) => break,
            Ok(None) if Instant::now() < deadline => thread::sleep(Duration::from_millis(50)),
            _ => {
                let _ = child.kill();
                let _ = child.wait();
                break;
            }
        }
    }
}

/// Feeds every FFmpeg of a stream the same chunks; one that has stopped is
/// left out, and only when all have stopped does writing fail.
struct FanOut(Vec<Option<ChildStdin>>);

impl Write for FanOut {
    fn write(&mut self, buf: &[u8]) -> std::io::Result<usize> {
        for slot in &mut self.0 {
            if slot.as_mut().is_some_and(|w| w.write_all(buf).is_err()) {
                *slot = None;
            }
        }
        if self.0.iter().all(Option::is_none) {
            return Err(std::io::ErrorKind::BrokenPipe.into());
        }
        Ok(buf.len())
    }
    fn flush(&mut self) -> std::io::Result<()> {
        for slot in &mut self.0 {
            if slot.as_mut().is_some_and(|w| w.flush().is_err()) {
                *slot = None;
            }
        }
        Ok(())
    }
}

/// Start an FFmpeg that is fed on stdin and watched: its progress (`on_speed`),
/// each line it says (`on_line`), and, if it ends without being stopped,
/// whether it sent anything and its last words (`on_end`). An FFmpeg that
/// stops reporting progress (stuck on a dead connection) is ended.
fn spawn_watched(
    ffmpeg: &Path,
    args: &[String],
    stall: Duration,
    stopping: &Arc<AtomicBool>,
    on_speed: impl Fn(Option<f32>) + Send + 'static,
    on_line: impl Fn(&str) + Send + 'static,
    on_end: impl FnOnce(bool, String) + Send + 'static,
) -> Result<(Child, ChildStdin), String> {
    let mut child = quiet(ffmpeg)
        .args(args)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("FFmpeg could not start: {e}"))?;
    let stdin = child.stdin.take().ok_or("FFmpeg could not start")?;
    let errors = Arc::new(Mutex::new(String::new()));
    let pid = child.id();
    if let Some(err) = child.stderr.take() {
        let errors = Arc::clone(&errors);
        thread::spawn(move || {
            for line in BufReader::new(err).lines().map_while(Result::ok) {
                // After a failed start FFmpeg can hang (busy, never exiting):
                // end it, so the failure is reported and nothing is left running.
                if gave_up(&line) {
                    thread::spawn(move || {
                        thread::sleep(Duration::from_secs(2));
                        kill_pid(pid);
                    });
                }
                on_line(&line);
                let mut e = lock(&errors);
                // Keep the last few lines, to explain a failure.
                e.push_str(&line);
                e.push('\n');
                if e.len() > 4000 {
                    let cut = e.len() - 2000;
                    let cut = (cut..e.len()).find(|&i| e.is_char_boundary(i)).unwrap_or(0);
                    e.drain(..cut);
                }
            }
        });
    }
    if let Some(out) = child.stdout.take() {
        let stopping = Arc::clone(stopping);
        let heard = Arc::new(AtomicU64::new(now_ms()));
        let ended = Arc::new(AtomicBool::new(false));
        watch_for_stall(pid, stall, &heard, &ended, &stopping);
        thread::spawn(move || {
            let sent = read_progress(out, &heard, on_speed);
            ended.store(true, Ordering::SeqCst);
            // FFmpeg has ended. Unless the operator stopped it, say why.
            thread::sleep(Duration::from_millis(200));
            if !stopping.load(Ordering::SeqCst) {
                let said = lock(&errors).clone();
                on_end(sent, said);
            }
        });
    }
    Ok((child, stdin))
}
