import sys
root = sys.argv[1]
p = root + '/hwaccel.rs'
s = open(p).read()


def rep(a, b):
    global s
    assert a in s, a[:80]
    s = s.replace(a, b, 1)


rep('''/// Run something with hardware decoding first and, when that fails, again in software.
///
/// # Errors
/// The software run failed too (its error is given).
pub fn with_fallback<T>(
    hw: &HwAccel,
    ffmpeg: &Path,
    mut run: impl FnMut(&[OsString]) -> Result<T, String>,
) -> Result<T, String> {
    let args = hw.args(ffmpeg);
    if args.is_empty() {
        return run(&[]);
    }
    match run(&args) {
        Ok(v) => Ok(v),
        Err(e) => {
            hw.failed(&e);
            run(&[])
        }
    }
}''', '''/// Run something with the hardware first (the decoder's input options, and
/// `hardware: true` for anything else of the graphics card's, such as its
/// encoder) and, when that fails, again in software. `run` fails with the
/// message to show and everything FFmpeg said.
///
/// # Errors
/// The software run failed too (its message is given).
pub fn with_fallback<T>(
    hw: &HwAccel,
    ffmpeg: &Path,
    other_hardware: bool,
    mut run: impl FnMut(&[OsString], bool) -> Result<T, (String, String)>,
) -> Result<T, String> {
    let args = hw.args(ffmpeg);
    if args.is_empty() && !other_hardware {
        return run(&[], false).map_err(|(m, _)| m);
    }
    match run(&args, true) {
        Ok(v) => Ok(v),
        Err((_, said)) => {
            if !args.is_empty() {
                hw.failed(&said);
            }
            run(&[], false).map_err(|(m, _)| m)
        }
    }
}''')
rep('''        let r = with_fallback(&hw, ff, |a| {
            tries.push(a.len());
            if a.is_empty() {
                Ok(7)
            } else {
                Err("Device creation failed: -1.".to_owned())
            }
        });
        assert_eq!(r, Ok(7));
        assert_eq!(tries, vec![2, 0]);''', '''        let r = with_fallback(&hw, ff, false, |a, hard| {
            tries.push((a.len(), hard));
            if a.is_empty() {
                Ok(7)
            } else {
                Err(("x".to_owned(), "Device creation failed: -1.".to_owned()))
            }
        });
        assert_eq!(r, Ok(7));
        assert_eq!(tries, vec![(2, true), (0, false)]);
        // Software decoding, but a hardware encoder: still tried first, then software.
        let mut tries = Vec::new();
        let r: Result<(), String> = with_fallback(&hw, ff, true, |a, hard| {
            tries.push((a.len(), hard));
            Err(("no".to_owned(), String::new()))
        });
        assert_eq!(r, Err("no".to_owned()));
        assert_eq!(tries, vec![(0, true), (0, false)]);''')
rep('''        let r: Result<(), String> = with_fallback(&hw, ff, |_| Err("Invalid data found".into()));
        assert!(r.is_err());''', '''        let mut n = 0;
        let r: Result<(), String> = with_fallback(&hw, ff, false, |_, _| {
            n += 1;
            Err(("bad".into(), "Invalid data found".into()))
        });
        assert_eq!(r, Err("bad".into()));
        assert_eq!(n, 2, "software is tried too");''')
open(p, 'w').write(s)

p = root + '/media.rs'
s = open(p).read()
a = s.index("    let hw = crate::hwaccel::global();\n    let first = CopyEncoding {")
b = s.index("/// One go at a copy.")
s = s[:a] + '''    let hardware = how.encoder.is_some();
    crate::hwaccel::with_fallback(crate::hwaccel::global(), ffmpeg, hardware, |decode, hard| {
        let _ = fs::remove_file(out);
        let how = CopyEncoding {
            encoder: if hard { how.encoder.clone() } else { None },
            threads: how.threads,
            decode: decode.to_vec(),
        };
        optimize_once(ffmpeg, file, out, seconds, progress, plan, kind, &how)
    })
}

''' + s[b:]
rep('''/// A lighter copy of a heavy file for smooth playback (kept in `cache`, made once).
///
/// # Errors
/// FFmpeg can't read the file.
pub fn playback_proxy(''', '''/// A lighter copy of a heavy file for smooth playback (kept in `cache`, made once).
///
/// # Errors
/// FFmpeg can't read the file.
#[cfg(test)]
pub fn playback_proxy(''')
open(p, 'w').write(s)

p = root + '/formats.rs'
s = open(p).read()
rep('''/// FFmpeg's arguments for an edit-friendly copy or a playback proxy.
#[must_use]
pub fn copy_args(''', '''/// FFmpeg's arguments for an edit-friendly copy or a playback proxy.
#[must_use]
#[cfg(test)]
pub fn copy_args(''')
rep('''#[must_use]
pub fn reader_args(''', '''#[must_use]
#[cfg(test)]
pub fn reader_args(''')
open(p, 'w').write(s)
