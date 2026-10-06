//! Media management: finding shot changes in a clip (FFmpeg's scene score),
//! collecting a project's files into one folder (copied, or trimmed with
//! handles), and the recovery folder that autosaves and backups go into.

use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::Stdio;

use serde::{Deserialize, Serialize};

use crate::media::quiet;

/// The times (seconds) of FFmpeg's `showinfo` lines: where the picture changed.
#[must_use]
pub fn parse_scene_times(said: &str) -> Vec<f64> {
    let mut out: Vec<f64> = said
        .lines()
        .filter(|l| l.contains("showinfo"))
        .filter_map(|l| {
            let at = l.find("pts_time:")? + "pts_time:".len();
            let rest = l[at..].trim_start();
            let end = rest
                .find(|c: char| !(c.is_ascii_digit() || c == '.' || c == '-'))
                .unwrap_or(rest.len());
            rest[..end].parse::<f64>().ok()
        })
        .filter(|t| t.is_finite() && *t > 0.0)
        .collect();
    out.sort_by(f64::total_cmp);
    out.dedup_by(|a, b| (*a - *b).abs() < 1e-6);
    out
}

/// The arguments that make FFmpeg list shot changes (a small picture is enough to judge them).
#[must_use]
pub fn scene_args(file: &Path, threshold: f64) -> Vec<String> {
    let t = threshold.clamp(0.05, 0.95);
    vec![
        "-hide_banner".into(),
        "-nostdin".into(),
        "-loglevel".into(),
        "info".into(),
        "-i".into(),
        file.to_string_lossy().into_owned(),
        "-an".into(),
        "-sn".into(),
        "-dn".into(),
        "-vf".into(),
        format!("scale=320:-2,select='gt(scene,{t:.3})',showinfo"),
        "-f".into(),
        "null".into(),
        "-".into(),
    ]
}

/// Where the picture changes in a file (seconds), by FFmpeg's scene score.
///
/// # Errors
/// FFmpeg can't start or can't read the file.
pub fn scene_cuts(ffmpeg: &Path, file: &Path, threshold: f64) -> Result<Vec<f64>, String> {
    let mut child = quiet(ffmpeg)
        .args(scene_args(file, threshold))
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("FFmpeg could not start: {e}"))?;
    let mut said = String::new();
    if let Some(mut e) = child.stderr.take() {
        let _ = e.read_to_string(&mut said);
    }
    let ok = child.wait().is_ok_and(|s| s.success());
    let times = parse_scene_times(&said);
    if !ok && times.is_empty() {
        let last = said.lines().rfind(|l| !l.trim().is_empty()).unwrap_or("");
        return Err(format!("Shots could not be found: {last}"));
    }
    Ok(times)
}

/// One file to collect: copied as it is, or made by FFmpeg (trimmed, with handles).
#[derive(Deserialize, Debug, Clone)]
pub struct CollectJob {
    pub from: String,
    pub to: String,
    /// FFmpeg's arguments for a trimmed copy (`{in}` and `{out}` are the two files); none: a plain copy.
    #[serde(default)]
    pub args: Option<Vec<String>>,
}

#[derive(Serialize, Debug, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct CollectProgress {
    pub done: usize,
    pub of: usize,
    pub name: String,
    pub finished: bool,
    pub problems: Vec<String>,
}

/// The arguments with the two files put in.
#[must_use]
pub fn fill_files(args: &[String], from: &str, to: &str) -> Vec<String> {
    args.iter()
        .map(|a| match a.as_str() {
            "{in}" => from.to_owned(),
            "{out}" => to.to_owned(),
            _ => a.clone(),
        })
        .collect()
}

/// Collect every file; a file that fails is reported and the rest carry on.
pub fn collect(ffmpeg: Option<&Path>, jobs: &[CollectJob], report: &dyn Fn(CollectProgress)) -> Vec<String> {
    let mut problems = Vec::new();
    let of = jobs.len();
    for (i, job) in jobs.iter().enumerate() {
        let name = Path::new(&job.to)
            .file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_default();
        report(CollectProgress {
            done: i,
            of,
            name: name.clone(),
            ..CollectProgress::default()
        });
        let to = PathBuf::from(&job.to);
        let result = (|| -> Result<(), String> {
            if Path::new(&job.from) == to {
                return Ok(());
            }
            if let Some(dir) = to.parent() {
                fs::create_dir_all(dir).map_err(|e| e.to_string())?;
            }
            match &job.args {
                None => fs::copy(&job.from, &to).map(|_| ()).map_err(|e| e.to_string()),
                Some(args) => {
                    let ff = ffmpeg.ok_or("FFmpeg was not found.")?;
                    let out = quiet(ff)
                        .args(["-hide_banner", "-nostdin", "-y", "-loglevel", "error"])
                        .args(fill_files(args, &job.from, &job.to))
                        .stdout(Stdio::null())
                        .output()
                        .map_err(|e| e.to_string())?;
                    if out.status.success() {
                        Ok(())
                    } else {
                        let said = String::from_utf8_lossy(&out.stderr);
                        Err(said.lines().rfind(|l| !l.trim().is_empty()).unwrap_or("FFmpeg stopped.").to_owned())
                    }
                }
            }
        })();
        if let Err(e) = result {
            problems.push(format!("{name}: {e}"));
        }
    }
    report(CollectProgress {
        done: of,
        of,
        name: String::new(),
        finished: true,
        problems: problems.clone(),
    });
    problems
}

/// A name in the recovery folder: letters, digits, `-`, `_` and `.` only (never a path).
#[must_use]
pub fn safe_name(name: &str) -> bool {
    !name.is_empty()
        && name.len() <= 200
        && !name.starts_with('.')
        && !name.contains("..")
        && name
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_' || c == '.')
}

#[derive(Serialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Entry {
    pub name: String,
    pub size: u64,
    /// Milliseconds since 1970.
    pub modified: f64,
}

/// What is in the recovery folder.
#[must_use]
pub fn list(dir: &Path) -> Vec<Entry> {
    let Ok(read) = fs::read_dir(dir) else {
        return Vec::new();
    };
    read.flatten()
        .filter_map(|e| {
            let meta = e.metadata().ok()?;
            if !meta.is_file() {
                return None;
            }
            let modified = meta
                .modified()
                .ok()
                .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                .map_or(0.0, |d| d.as_secs_f64() * 1000.0);
            Some(Entry {
                name: e.file_name().to_string_lossy().into_owned(),
                size: meta.len(),
                modified,
            })
        })
        .collect()
}

/// A file in the recovery folder (refused unless the name is a plain one).
///
/// # Errors
/// The name is not a plain file name.
pub fn place(dir: &Path, name: &str) -> Result<PathBuf, String> {
    if safe_name(name) {
        Ok(dir.join(name))
    } else {
        Err("That is not a recovery file.".into())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_shot_changes() {
        let said = "\
[Parsed_showinfo_2 @ 0x1] config in time_base: 1/30000, frame_rate: 30000/1001
[Parsed_showinfo_2 @ 0x1] n:   0 pts:  150150 pts_time:5.005   duration:   1001 pos: 1 fmt:yuv420p
[Parsed_showinfo_2 @ 0x1] n:   1 pts:  360360 pts_time:12.012  duration:   1001
[Parsed_showinfo_2 @ 0x1] n:   2 pts:  360360 pts_time:12.012  duration:   1001
frame=  200 fps=0.0 q=-0.0 Lsize=N/A time=00:00:20.00
[Parsed_showinfo_2 @ 0x1] n:   3 pts:  0 pts_time:0 duration: 1
[Parsed_showinfo_2 @ 0x1] n:   4 pts: 1 pts_time:3.5";
        assert_eq!(parse_scene_times(said), vec![3.5, 5.005, 12.012]);
        assert!(parse_scene_times("nothing").is_empty());
    }

    #[test]
    fn scene_arguments() {
        let a = scene_args(Path::new("/m/a.mp4"), 2.0);
        assert!(a.contains(&"/m/a.mp4".to_owned()));
        assert!(a.iter().any(|x| x.contains("gt(scene,0.950)")));
        let b = scene_args(Path::new("x"), 0.4);
        assert!(b.iter().any(|x| x == "scale=320:-2,select='gt(scene,0.400)',showinfo"));
    }

    #[test]
    fn recovery_names_stay_in_the_folder() {
        assert!(safe_name("p1a2b--1700000000000.lumoraedit"));
        assert!(safe_name("u_x.session.json"));
        assert!(!safe_name("../x"));
        assert!(!safe_name("a/b"));
        assert!(!safe_name("a\\b"));
        assert!(!safe_name(".hidden"));
        assert!(!safe_name(""));
        assert!(place(Path::new("/r"), "C:\\x").is_err());
        assert_eq!(place(Path::new("/r"), "a.json").unwrap(), Path::new("/r/a.json"));
    }

    #[test]
    fn collects_files() {
        let dir = std::env::temp_dir().join(format!("lumora-collect-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        let a = dir.join("a.bin");
        fs::write(&a, b"abc").unwrap();
        let jobs = vec![
            CollectJob {
                from: a.to_string_lossy().into_owned(),
                to: dir.join("out/Media/a.bin").to_string_lossy().into_owned(),
                args: None,
            },
            CollectJob {
                from: dir.join("gone.bin").to_string_lossy().into_owned(),
                to: dir.join("out/Media/gone.bin").to_string_lossy().into_owned(),
                args: None,
            },
        ];
        let seen = std::cell::RefCell::new(Vec::new());
        let problems = collect(None, &jobs, &|p| seen.borrow_mut().push(p));
        assert_eq!(fs::read(dir.join("out/Media/a.bin")).unwrap(), b"abc");
        assert_eq!(problems.len(), 1);
        assert!(problems[0].starts_with("gone.bin"));
        assert!(seen.borrow().last().unwrap().finished);
        let listed = list(&dir.join("out/Media"));
        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].size, 3);
        assert_eq!(
            fill_files(&["-i".into(), "{in}".into(), "{out}".into()], "a", "b"),
            vec!["-i", "a", "b"]
        );
        let _ = fs::remove_dir_all(dir);
    }
}
