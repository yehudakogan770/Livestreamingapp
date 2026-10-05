//! Making the finished film: the editor sends the plan (one FFmpeg run per
//! part, then one that joins them), this runs it in the background and says
//! how far along it is.

use std::fs;
use std::io::{BufRead, BufReader, Read};
use std::path::{Path, PathBuf};
use std::process::{Child, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

use base64::Engine as _;
use serde::{Deserialize, Serialize};

use crate::media::quiet;

#[derive(Deserialize, Debug, Clone)]
pub struct Job {
    pub args: Vec<String>,
    pub seconds: f64,
}

#[derive(Deserialize, Debug, Clone)]
pub struct TitleImage {
    pub id: String,
    /// PNG, as base64.
    pub png: String,
}

#[derive(Deserialize, Debug, Clone)]
pub struct Plan {
    pub jobs: Vec<Job>,
    pub list: String,
    #[serde(rename = "final")]
    pub last: Job,
    pub titles: Vec<TitleImage>,
}

#[derive(Serialize, Debug, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct Progress {
    /// 0 to 1.
    pub done: f64,
    pub part: usize,
    pub parts: usize,
    pub finished: bool,
    pub error: Option<String>,
    pub path: Option<String>,
}

#[derive(Default)]
pub struct Exports {
    child: Arc<Mutex<Option<Child>>>,
    stop: Arc<AtomicBool>,
    busy: Arc<AtomicBool>,
}

fn lock<T>(m: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    m.lock().unwrap_or_else(std::sync::PoisonError::into_inner)
}

/// `{tmp}` and `{out}` in an argument become the real places.
#[must_use]
pub fn fill(arg: &str, tmp: &Path, out: &Path) -> String {
    arg.replace("{tmp}", &tmp.to_string_lossy())
        .replace("{out}", &out.to_string_lossy())
}

/// The seconds done, from FFmpeg's progress lines (`out_time_us=…`).
#[must_use]
pub fn progress_seconds(line: &str) -> Option<f64> {
    let v = line
        .strip_prefix("out_time_us=")
        .or_else(|| line.strip_prefix("out_time_ms="))?;
    v.trim().parse::<f64>().ok().map(|us| us / 1_000_000.0)
}

/// FFmpeg's own words about what went wrong, made short.
fn explain(said: &str) -> String {
    let last = said
        .lines()
        .map(str::trim)
        .rfind(|l| !l.is_empty())
        .unwrap_or("FFmpeg stopped.");
    if said.contains("No space left") {
        "The disk is full. Free some space (or save the film to another drive) and try again."
            .into()
    } else {
        format!("The film could not be made: {last}")
    }
}

impl Exports {
    /// Start making the film; `report` is called as it goes (and at the end).
    ///
    /// # Errors
    /// A film is already being made.
    pub fn start(
        &self,
        ffmpeg: PathBuf,
        plan: Plan,
        out: PathBuf,
        report: impl Fn(Progress) + Send + 'static,
    ) -> Result<(), String> {
        if self.busy.swap(true, Ordering::SeqCst) {
            return Err("A film is already being made.".into());
        }
        self.stop.store(false, Ordering::SeqCst);
        let child = Arc::clone(&self.child);
        let stop = Arc::clone(&self.stop);
        let busy = Arc::clone(&self.busy);
        std::thread::spawn(move || {
            let result = run(&ffmpeg, &plan, &out, &child, &stop, &report);
            busy.store(false, Ordering::SeqCst);
            let parts = plan.jobs.len() + 1;
            report(match result {
                Ok(()) => Progress {
                    done: 1.0,
                    part: parts,
                    parts,
                    finished: true,
                    error: None,
                    path: Some(out.to_string_lossy().into_owned()),
                },
                Err(e) => Progress {
                    finished: true,
                    error: Some(e),
                    parts,
                    ..Progress::default()
                },
            });
        });
        Ok(())
    }

    pub fn cancel(&self) {
        self.stop.store(true, Ordering::SeqCst);
        if let Some(c) = lock(&self.child).as_mut() {
            let _ = c.kill();
        }
    }
}

fn run(
    ffmpeg: &Path,
    plan: &Plan,
    out: &Path,
    child: &Mutex<Option<Child>>,
    stop: &AtomicBool,
    report: &dyn Fn(Progress),
) -> Result<(), String> {
    let folder = out
        .parent()
        .filter(|p| !p.as_os_str().is_empty())
        .map_or_else(std::env::temp_dir, Path::to_path_buf);
    let tmp = folder.join(format!(".lumora-edit-{}", std::process::id()));
    let _ = fs::remove_dir_all(&tmp);
    fs::create_dir_all(&tmp).map_err(|e| format!("Could not make a work folder: {e}"))?;
    let result = (|| {
        for t in &plan.titles {
            let bytes = base64::engine::general_purpose::STANDARD
                .decode(&t.png)
                .map_err(|e| e.to_string())?;
            let safe: String = t.id.chars().filter(char::is_ascii_alphanumeric).collect();
            fs::write(tmp.join(format!("title-{safe}.png")), bytes).map_err(|e| e.to_string())?;
        }
        fs::write(tmp.join("list.txt"), &plan.list).map_err(|e| e.to_string())?;
        // The joining at the end is quick: it counts as a small share.
        let total: f64 =
            plan.jobs.iter().map(|j| j.seconds).sum::<f64>() + plan.last.seconds * 0.1 + 0.001;
        let parts = plan.jobs.len() + 1;
        let mut before = 0.0;
        for (i, job) in plan
            .jobs
            .iter()
            .chain(std::iter::once(&plan.last))
            .enumerate()
        {
            let weight = if i == plan.jobs.len() { 0.1 } else { 1.0 };
            let args: Vec<String> = job.args.iter().map(|a| fill(a, &tmp, out)).collect();
            one(ffmpeg, &args, child, stop, &|s| {
                let done = (before + s.min(job.seconds) * weight) / total;
                report(Progress {
                    done: done.min(0.999),
                    part: i + 1,
                    parts,
                    ..Progress::default()
                });
            })?;
            before += job.seconds * weight;
        }
        Ok(())
    })();
    let _ = fs::remove_dir_all(&tmp);
    if result.is_err() {
        let _ = fs::remove_file(out);
    }
    result
}

fn one(
    ffmpeg: &Path,
    args: &[String],
    child: &Mutex<Option<Child>>,
    stop: &AtomicBool,
    progress: &dyn Fn(f64),
) -> Result<(), String> {
    if stop.load(Ordering::SeqCst) {
        return Err("Stopped.".into());
    }
    let mut c = quiet(ffmpeg)
        .args([
            "-hide_banner",
            "-nostdin",
            "-y",
            "-loglevel",
            "error",
            "-nostats",
            "-progress",
            "pipe:1",
        ])
        .args(args)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("FFmpeg could not start: {e}"))?;
    let stdout = c.stdout.take();
    let stderr = c.stderr.take();
    *lock(child) = Some(c);
    let said = std::thread::spawn(move || {
        let mut s = String::new();
        if let Some(mut e) = stderr {
            let _ = e.read_to_string(&mut s);
        }
        s
    });
    if let Some(o) = stdout {
        for line in BufReader::new(o).lines().map_while(Result::ok) {
            if let Some(s) = progress_seconds(&line) {
                progress(s);
            }
        }
    }
    let status = lock(child).take().map(|mut c| c.wait());
    let said = said.join().unwrap_or_default();
    if stop.load(Ordering::SeqCst) {
        return Err("Stopped.".into());
    }
    match status {
        Some(Ok(s)) if s.success() => Ok(()),
        _ => Err(explain(&said)),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn places_and_progress() {
        let tmp = Path::new("/w");
        let out = Path::new("/films/Gala.mp4");
        assert_eq!(fill("{tmp}/title-t.png", tmp, out), "/w/title-t.png");
        assert_eq!(fill("{out}", tmp, out), "/films/Gala.mp4");
        assert_eq!(progress_seconds("out_time_us=2500000"), Some(2.5));
        assert_eq!(progress_seconds("frame=10"), None);
        assert!(explain("x\nNo space left on device\n").contains("disk is full"));
        assert!(explain("a\nInvalid argument\n").ends_with("Invalid argument"));
    }

    #[test]
    fn reads_the_plan_the_editor_sends() {
        let plan: Plan = serde_json::from_str(
            r#"{"jobs":[{"args":["-i","a"],"seconds":2}],"list":"file 'part-0001.mkv'\n","final":{"args":["{out}"],"seconds":2},"titles":[{"id":"t1","png":"iVBORw0KGgo="}],"seconds":2}"#,
        )
        .unwrap();
        assert_eq!(plan.jobs.len(), 1);
        assert_eq!(plan.last.args, ["{out}"]);
    }
}
