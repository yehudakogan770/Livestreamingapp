import sys
p = sys.argv[1]
s = open(p).read()


def rep(a, b):
    global s
    assert a in s, a[:80]
    s = s.replace(a, b, 1)


rep('''use std::collections::HashMap;
use std::io::Read;
use std::path::Path;''', '''use std::collections::HashMap;
use std::ffi::OsString;
use std::io::Read;
use std::path::{Path, PathBuf};''')
rep('''use crate::formats::{plan, reader_args};''', '''use crate::formats::{plan, reader_args_with};''')
rep('''struct Reader {
    child: Child,
    out: ChildStdout,
    frame: usize,
}''', '''struct Reader {
    child: Child,
    out: ChildStdout,
    frame: usize,
    /// How to start FFmpeg again in software when the hardware decoder gives nothing.
    again: Option<(PathBuf, Vec<OsString>)>,
}

/// Start FFmpeg handing over frames.
fn spawn(ffmpeg: &Path, args: &[OsString]) -> Result<(Child, ChildStdout), String> {
    let mut child = quiet(ffmpeg)
        .args(args)
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|e| format!("FFmpeg could not start: {e}"))?;
    let out = child.stdout.take().ok_or("FFmpeg gave no frames.")?;
    Ok((child, out))
}''')
rep('''        let info = probe(ffmpeg, file)?;
        let plan = plan(file, &info);
        let mut child = quiet(ffmpeg)
            .args(reader_args(
                file,
                &plan,
                from.max(0.0),
                rate,
                width,
                height,
                plan.tone_map,
            ))
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .spawn()
            .map_err(|e| format!("FFmpeg could not start: {e}"))?;
        let out = child.stdout.take().ok_or("FFmpeg gave no frames.")?;
        let reader = Reader {
            child,
            out,
            frame: frame_bytes(width, height),
        };''', '''        let info = probe(ffmpeg, file)?;
        let plan = plan(file, &info);
        let args = |decode: &[OsString]| {
            reader_args_with(
                file,
                &plan,
                from.max(0.0),
                rate,
                (width, height),
                plan.tone_map,
                decode,
            )
        };
        // The hardware decoder first (software again if it gives nothing).
        let decode = crate::hwaccel::global().args(ffmpeg);
        let soft = args(&[]);
        let (child, out, again) = if decode.is_empty() {
            let (c, o) = spawn(ffmpeg, &soft)?;
            (c, o, None)
        } else {
            match spawn(ffmpeg, &args(&decode)) {
                Ok((c, o)) => (c, o, Some((ffmpeg.to_path_buf(), soft))),
                Err(_) => {
                    let (c, o) = spawn(ffmpeg, &soft)?;
                    (c, o, None)
                }
            }
        };
        let reader = Reader {
            child,
            out,
            frame: frame_bytes(width, height),
            again,
        };''')
rep('''        let mut buf = vec![0u8; r.frame];
        let got = read_full(&mut r.out, &mut buf);
        if got == buf.len() {''', '''        let mut buf = vec![0u8; r.frame];
        let mut got = read_full(&mut r.out, &mut buf);
        // The first frame: the hardware decoder gave nothing, so read in software.
        if let Some((ffmpeg, soft)) = r.again.take() {
            if got < buf.len() {
                if let Ok((child, out)) = spawn(&ffmpeg, &soft) {
                    let _ = r.child.kill();
                    let _ = r.child.wait();
                    r.child = child;
                    r.out = out;
                    got = read_full(&mut r.out, &mut buf);
                    if got == buf.len() {
                        crate::hwaccel::global().failed("hardware device setup failed");
                    }
                }
            }
        }
        if got == buf.len() {''')
open(p, 'w').write(s)
