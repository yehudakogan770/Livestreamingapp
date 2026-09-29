//! How hard this computer is working: processor and memory, for the stats
//! readout (the windows add their own frame rates).

use std::sync::Mutex;

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
}

pub struct Perf {
    sys: Mutex<System>,
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
        }
    }
}

impl Perf {
    /// Measured since the last call (call about once a second).
    pub fn sample(&self) -> PerfStats {
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
        }
    }
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
}
