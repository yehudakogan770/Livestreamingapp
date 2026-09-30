//! How hard this computer is working: processor, memory and the graphics
//! card, for the stats readout (the windows add their own frame rates).

use std::sync::{Arc, Mutex, Once};

use serde::Serialize;
use sysinfo::{
    CpuRefreshKind, MemoryRefreshKind, Pid, ProcessRefreshKind, ProcessesToUpdate, RefreshKind,
    System,
};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PerfStats {
    /// The whole computer's processor use, 0 – 100.
    pub cpu: f32,
    /// Memory in use and in all, MB.
    pub mem_used_mb: u64,
    pub mem_total_mb: u64,
    /// Lumora's own memory, MB.
    pub app_mem_mb: u64,
    /// The graphics card's 3D use, 0 – 100 (None where it can't be measured).
    pub gpu: Option<f32>,
}

pub struct Perf {
    sys: Mutex<System>,
    gpu: Arc<Mutex<Option<f32>>>,
    gpu_started: Once,
}

impl Default for Perf {
    fn default() -> Self {
        let sys = System::new_with_specifics(
            RefreshKind::nothing()
                .with_cpu(CpuRefreshKind::nothing().with_cpu_usage())
                .with_memory(MemoryRefreshKind::nothing().with_ram()),
        );
        Perf {
            sys: Mutex::new(sys),
            gpu: Arc::default(),
            gpu_started: Once::new(),
        }
    }
}

impl Perf {
    /// Measured since the last call (call about once a second).
    pub fn sample(&self) -> PerfStats {
        self.gpu_started
            .call_once(|| watch_gpu(Arc::clone(&self.gpu)));
        let mut sys = self
            .sys
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        sys.refresh_cpu_usage();
        sys.refresh_memory();
        let me = Pid::from_u32(std::process::id());
        sys.refresh_processes_specifics(
            ProcessesToUpdate::Some(&[me]),
            true,
            ProcessRefreshKind::nothing().with_memory(),
        );
        let mb = |b: u64| b / 1_048_576;
        PerfStats {
            cpu: sys.global_cpu_usage(),
            mem_used_mb: mb(sys.used_memory()),
            mem_total_mb: mb(sys.total_memory()),
            app_mem_mb: sys.process(me).map_or(0, |p| mb(p.memory())),
            gpu: *self
                .gpu
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner),
        }
    }
}

/// The graphics card's 3D use from `typeperf`'s answer (all its engines added up).
fn gpu_from_typeperf(out: &str) -> Option<f32> {
    let line = out.lines().filter(|l| l.starts_with('"')).nth(1)?;
    let mut total = 0.0f32;
    let mut any = false;
    for cell in line.split(',').skip(1) {
        if let Ok(v) = cell.trim().trim_matches('"').parse::<f32>() {
            total += v;
            any = true;
        }
    }
    any.then_some(total.clamp(0.0, 100.0))
}

/// Measure the graphics card every few seconds (Windows' own counters), in the background.
fn watch_gpu(slot: Arc<Mutex<Option<f32>>>) {
    if !cfg!(windows) {
        return;
    }
    std::thread::Builder::new()
        .name("lumora-gpu".into())
        .spawn(move || loop {
            let mut cmd = std::process::Command::new("typeperf");
            cmd.args([
                r"\GPU Engine(*engtype_3D)\Utilization Percentage",
                "-sc",
                "1",
            ])
            .stdin(std::process::Stdio::null())
            .stderr(std::process::Stdio::null());
            #[cfg(windows)]
            {
                use std::os::windows::process::CommandExt;
                cmd.creation_flags(0x0800_0000);
            }
            let Ok(out) = cmd.output() else { return };
            let v = gpu_from_typeperf(&String::from_utf8_lossy(&out.stdout));
            *slot
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner) = v;
            if v.is_none() && !out.status.success() {
                // No counters on this computer (an old driver): stop asking.
                return;
            }
            std::thread::sleep(std::time::Duration::from_secs(3));
        })
        .ok();
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn measures_this_computer() {
        let p = Perf::default();
        let _ = p.sample();
        std::thread::sleep(std::time::Duration::from_millis(250));
        let s = p.sample();
        assert!((0.0..=100.0).contains(&s.cpu));
        assert!(s.mem_total_mb > 0 && s.mem_used_mb <= s.mem_total_mb);
        assert!(s.app_mem_mb > 0);
    }

    #[test]
    fn reads_the_graphics_cards_counters() {
        let out = "\r\n\"(PDH-CSV 4.0)\",\"\\\\PC\\GPU Engine(pid_1_eng_0)\",\"\\\\PC\\GPU Engine(pid_2_eng_0)\"\r\n\"09/30/2026 04:50:00.000\",\"12.5\",\"30.25\"\r\nExiting, please wait...";
        assert_eq!(gpu_from_typeperf(out), Some(42.75));
        assert_eq!(gpu_from_typeperf("nothing"), None);
    }
}
