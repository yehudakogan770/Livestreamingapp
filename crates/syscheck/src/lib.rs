//! The system check's facts: what this computer has. Gathered once when the
//! check runs (first start after installing, or Help → Check this computer…);
//! the apps judge them (app/src/syscheck/rules.ts), so the thresholds live in
//! one table there.
//!
//! On Windows one hidden PowerShell call asks Windows (WMI and the registry)
//! for the graphics cards, drives, power, Windows' own version and WebView2;
//! the processor and memory come from `sysinfo` everywhere. Anything that
//! can't be measured is left empty and named in `missing`: the check never
//! fails, it just knows less.

use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

use serde::Serialize;
use serde_json::Value;

mod parse;
pub use parse::*;

/// What to look at besides the computer itself.
#[derive(Debug, Clone, Default)]
pub struct Request {
    /// Folders whose drives matter, with what they are for ("recordings", "app data", …).
    pub places: Vec<(String, PathBuf)>,
    /// FFmpeg as the app found it.
    pub ffmpeg: Option<PathBuf>,
    /// Try the graphics card's video encoders for real (a tiny encode each).
    /// Studio already knows which work and passes its own list instead.
    pub test_encoders: bool,
}

#[derive(Debug, Clone, Default, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Os {
    /// "Windows 11 Pro", "Ubuntu 24.04", …
    pub name: String,
    /// Windows' build number (0 elsewhere).
    pub build: u32,
    /// "23H2" (Windows), when known.
    pub display_version: String,
    pub is_64bit: bool,
}

#[derive(Debug, Clone, Default, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Cpu {
    pub name: String,
    pub cores: u32,
    pub threads: u32,
}

#[derive(Debug, Clone, Default, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Memory {
    pub total_mb: u64,
    pub available_mb: u64,
}

#[derive(Debug, Clone, Default, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Gpu {
    pub name: String,
    /// "nvidia", "amd", "intel", "microsoft" (software), "other".
    pub vendor: String,
    /// The card's own memory, when Windows says.
    pub vram_mb: Option<u64>,
    pub driver_version: String,
    /// "YYYY-MM-DD", when known.
    pub driver_date: Option<String>,
    /// Drawing in software (no real driver): very slow.
    pub software: bool,
}

#[derive(Debug, Clone, Default, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Disk {
    /// What it is for, as asked ("recordings", …).
    pub purpose: String,
    /// "C:" on Windows; empty elsewhere (folders are never shown).
    pub drive: String,
    pub free_mb: u64,
    pub total_mb: u64,
    /// "ssd", "hdd" or "unknown".
    pub kind: String,
}

#[derive(Debug, Clone, Default, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Power {
    /// A laptop (or anything with a battery).
    pub battery: bool,
    /// Running on the battery right now.
    pub on_battery: bool,
    /// The power plan: "saver", "balanced", "high", "ultimate", "other" or "" (unknown).
    pub plan: String,
    /// Windows 11's power mode: "efficiency", "balanced", "performance" or "" (unknown).
    pub mode: String,
}

#[derive(Debug, Clone, Default, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Ffmpeg {
    pub found: bool,
    /// It answered `-version`.
    pub runs: bool,
    pub version: String,
}

#[derive(Debug, Clone, Default, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Display {
    pub width: u32,
    pub height: u32,
    pub scale: f64,
    pub primary: bool,
}

/// Studio's native engine (Direct3D 12 on Windows).
#[derive(Debug, Clone, Default, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Native {
    pub adapters: Vec<NativeAdapter>,
    /// A real graphics card offers the engine's graphics API (Direct3D 12 on Windows).
    pub supported: bool,
}

#[derive(Debug, Clone, Default, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct NativeAdapter {
    pub name: String,
    /// "discrete", "integrated", "software", "virtual" or "other".
    pub kind: String,
    pub backend: String,
}

/// Everything the check knows about this computer.
#[derive(Debug, Clone, Default, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Facts {
    pub os: Os,
    pub cpu: Cpu,
    pub memory: Memory,
    pub gpus: Vec<Gpu>,
    pub disks: Vec<Disk>,
    /// WebView2's version ("131.0.2903.70"), from the registry (the page also knows its own).
    pub webview2: Option<String>,
    pub ffmpeg: Ffmpeg,
    /// Hardware video encoders that work (h264_nvenc, hevc_qsv, …).
    pub hw_encoders: Vec<String>,
    /// The hardware decoder FFmpeg uses (Studio), if any.
    pub hw_decode: Option<String>,
    pub power: Power,
    /// Filled by the app (it knows the screens).
    pub displays: Vec<Display>,
    /// Filled by Studio.
    pub native: Option<Native>,
    /// What couldn't be measured (plain words).
    pub missing: Vec<String>,
}

/// Look at this computer. Takes a few seconds on Windows (one PowerShell call, FFmpeg).
pub fn gather(req: &Request) -> Facts {
    let mut f = Facts::default();
    basics(&mut f);
    #[cfg(windows)]
    windows(&mut f, req);
    #[cfg(not(windows))]
    unix(&mut f, req);
    match &req.ffmpeg {
        None => f.missing.push("FFmpeg".into()),
        Some(ff) => {
            f.ffmpeg.found = true;
            if let Some(out) = run(Command::new(ff).arg("-version"), Duration::from_secs(10)) {
                f.ffmpeg.runs = !out.is_empty();
                f.ffmpeg.version = ffmpeg_version(&out);
            }
            if req.test_encoders && f.ffmpeg.runs {
                f.hw_encoders = working_hw_encoders(ff);
            }
        }
    }
    f
}

/// Processor, memory and the system's name, from sysinfo (every system).
fn basics(f: &mut Facts) {
    use sysinfo::{CpuRefreshKind, MemoryRefreshKind, RefreshKind, System};
    let sys = System::new_with_specifics(
        RefreshKind::nothing()
            .with_cpu(CpuRefreshKind::nothing())
            .with_memory(MemoryRefreshKind::nothing().with_ram()),
    );
    f.cpu = Cpu {
        name: sys
            .cpus()
            .first()
            .map(|c| c.brand().trim().to_owned())
            .unwrap_or_default(),
        cores: u32::try_from(sys.physical_core_count().unwrap_or(0)).unwrap_or(0),
        threads: u32::try_from(sys.cpus().len()).unwrap_or(0),
    };
    if f.cpu.cores == 0 {
        f.cpu.cores = f.cpu.threads;
    }
    f.memory = Memory {
        total_mb: sys.total_memory() / 1_048_576,
        available_mb: sys.available_memory() / 1_048_576,
    };
    f.os.name = System::long_os_version().unwrap_or_else(|| "Unknown system".into());
    f.os.is_64bit = cfg!(target_pointer_width = "64") || System::cpu_arch().contains("64");
}

/// A command that never flashes a console window on Windows.
fn quiet(cmd: &mut Command) -> &mut Command {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000);
    }
    cmd
}

/// Run a program and keep what it printed (stdout, then stderr), giving up after `limit`.
fn run(cmd: &mut Command, limit: Duration) -> Option<String> {
    let mut child = quiet(cmd)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .ok()?;
    let mut out = child.stdout.take()?;
    let mut err = child.stderr.take()?;
    let reader = std::thread::spawn(move || {
        let mut s = String::new();
        let _ = out.read_to_string(&mut s);
        let mut e = String::new();
        let _ = err.read_to_string(&mut e);
        s + &e
    });
    let until = Instant::now() + limit;
    loop {
        match child.try_wait() {
            Ok(Some(_)) => break,
            Ok(None) if Instant::now() < until => std::thread::sleep(Duration::from_millis(50)),
            _ => {
                let _ = child.kill();
                let _ = child.wait();
                return None;
            }
        }
    }
    reader.join().ok()
}

/// The hardware encoders FFmpeg offers that really work here (a tiny encode each, side by side).
pub fn working_hw_encoders(ffmpeg: &Path) -> Vec<String> {
    let said = run(
        Command::new(ffmpeg).args(["-hide_banner", "-encoders"]),
        Duration::from_secs(10),
    )
    .unwrap_or_default();
    let tries: Vec<_> = hw_encoders_listed(&said)
        .into_iter()
        .map(|name| {
            let ff = ffmpeg.to_path_buf();
            std::thread::spawn(move || {
                let ok = run(
                    Command::new(&ff).args([
                        "-hide_banner",
                        "-loglevel",
                        "error",
                        "-f",
                        "lavfi",
                        "-i",
                        "color=black:s=256x144:d=0.1",
                        "-frames:v",
                        "2",
                        "-pix_fmt",
                        "nv12",
                        "-c:v",
                        &name,
                        "-f",
                        "null",
                        "-",
                    ]),
                    Duration::from_secs(12),
                )
                .is_some_and(|said| !said.to_ascii_lowercase().contains("error"));
                ok.then_some(name)
            })
        })
        .collect();
    tries
        .into_iter()
        .filter_map(|t| t.join().ok().flatten())
        .collect()
}

#[cfg(windows)]
fn windows(f: &mut Facts, req: &Request) {
    let mut letters: Vec<char> = Vec::new();
    for (_, p) in &req.places {
        if let Some(l) = drive_letter(p) {
            if !letters.contains(&l) {
                letters.push(l);
            }
        }
    }
    // Encoded, so no quote in the script is ever re-read by the command line.
    let script = encoded_command(&windows_script(&letters));
    let out = run(
        Command::new("powershell").args([
            "-NoProfile",
            "-NonInteractive",
            "-ExecutionPolicy",
            "Bypass",
            "-EncodedCommand",
            &script,
        ]),
        Duration::from_secs(30),
    );
    let Some(raw) = out.and_then(|o| parse_windows(&o).ok()) else {
        f.missing
            .push("graphics, drives and Windows details (Windows did not answer)".into());
        return;
    };
    if !raw.os.name.is_empty() {
        f.os.name = raw.os.name;
    }
    f.os.build = raw.os.build;
    f.os.display_version = raw.os.display_version;
    f.os.is_64bit = raw.os.is_64bit;
    f.gpus = raw.gpus;
    f.webview2 = raw.webview2;
    f.power = raw.power;
    for (purpose, p) in &req.places {
        let Some(l) = drive_letter(p) else { continue };
        if let Some(d) = raw.disks.iter().find(|d| d.drive.starts_with(l)) {
            f.disks.push(Disk {
                purpose: purpose.clone(),
                ..d.clone()
            });
        } else {
            f.missing.push(format!("free space on {l}:"));
        }
    }
    if f.gpus.is_empty() {
        f.missing.push("graphics card".into());
    }
}

#[cfg(not(windows))]
fn unix(f: &mut Facts, req: &Request) {
    for (purpose, p) in &req.places {
        let out =
            run(Command::new("df").arg("-Pk").arg(p), Duration::from_secs(5)).unwrap_or_default();
        match parse_df(&out) {
            Some((total_mb, free_mb)) => f.disks.push(Disk {
                purpose: purpose.clone(),
                drive: String::new(),
                free_mb,
                total_mb,
                kind: "unknown".into(),
            }),
            None => f.missing.push(format!("free space for {purpose}")),
        }
    }
    f.missing
        .push("graphics card details (measured on Windows only)".into());
}

/// The drive letter of a Windows path ("D:\Videos" → 'D').
pub fn drive_letter(p: &Path) -> Option<char> {
    let s = p.to_string_lossy();
    let mut c = s.chars();
    let l = c.next()?.to_ascii_uppercase();
    (l.is_ascii_alphabetic() && c.next() == Some(':')).then_some(l)
}

/// The PowerShell that asks Windows. Prints one line of JSON.
pub fn windows_script(letters: &[char]) -> String {
    let list = letters
        .iter()
        .filter(|c| c.is_ascii_alphabetic())
        .map(|c| format!("'{c}'"))
        .collect::<Vec<_>>()
        .join(",");
    WINDOWS_SCRIPT.replace("@@LETTERS@@", &list)
}

const WINDOWS_SCRIPT: &str = r#"
$ErrorActionPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [Text.Encoding]::UTF8
$os = Get-CimInstance Win32_OperatingSystem
$cv = Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion'
$gpus = @(Get-CimInstance Win32_VideoController | ForEach-Object {
  @{ name = "$($_.Name)"; ram = $_.AdapterRAM; driver = "$($_.DriverVersion)"; date = $(if ($_.DriverDate) { $_.DriverDate.ToString('yyyy-MM-dd') } else { '' }); pnp = "$($_.PNPDeviceID)" } })
$vram = @(Get-ChildItem 'HKLM:\SYSTEM\ControlSet001\Control\Class\{4d36e968-e325-11ce-bfc1-08002be10318}' | ForEach-Object {
  $p = Get-ItemProperty $_.PSPath
  if ($p.DriverDesc) { @{ name = "$($p.DriverDesc)"; qw = $p.'HardwareInformation.qwMemorySize'; mem = $p.'HardwareInformation.MemorySize' } } })
$wvKey = 'SOFTWARE\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}'
$wv = (Get-ItemProperty "HKLM:\SOFTWARE\WOW6432Node\$($wvKey.Substring(9))").pv
if (-not $wv) { $wv = (Get-ItemProperty "HKLM:\$wvKey").pv }
if (-not $wv) { $wv = (Get-ItemProperty "HKCU:\$wvKey").pv }
$disks = @(foreach ($l in @(@@LETTERS@@)) {
  $v = Get-Volume -DriveLetter $l
  $n = (Get-Partition -DriveLetter $l | Get-Disk).Number
  $pd = Get-PhysicalDisk | Where-Object { "$($_.DeviceId)" -eq "$n" } | Select-Object -First 1
  @{ letter = "$l"; free = $v.SizeRemaining; size = $v.Size; media = "$($pd.MediaType)"; bus = "$($pd.BusType)" } })
$bat = @(Get-CimInstance Win32_Battery)
$pw = Get-ItemProperty 'HKLM:\SYSTEM\CurrentControlSet\Control\Power\User\PowerSchemes'
@{
  os = @{ caption = "$($os.Caption)"; build = "$($os.BuildNumber)"; display = "$($cv.DisplayVersion)"; is64 = [Environment]::Is64BitOperatingSystem }
  gpus = $gpus; vram = $vram; webview = "$wv"; disks = $disks
  battery = @{ count = $bat.Count; status = $(if ($bat.Count) { $bat[0].BatteryStatus } else { 0 }) }
  scheme = "$(powercfg /getactivescheme)"
  overlay = "$(if ($bat.Count -and $bat[0].BatteryStatus -eq 1) { $pw.ActiveOverlayDcPowerScheme } else { $pw.ActiveOverlayAcPowerScheme })"
} | ConvertTo-Json -Compress -Depth 5
"#;

/// The JSON value as a number (PowerShell sometimes gives numbers as text, or a list of bytes for a registry value).
pub(crate) fn number(v: &Value) -> Option<u64> {
    match v {
        Value::Number(n) => n
            .as_u64()
            .or_else(|| n.as_f64().filter(|x| *x >= 0.0).map(|x| x as u64)),
        Value::String(s) => s.trim().parse().ok(),
        Value::Array(bytes) if !bytes.is_empty() && bytes.len() <= 8 => {
            let mut n: u64 = 0;
            for (i, b) in bytes.iter().enumerate() {
                n |= b.as_u64()? << (8 * i);
            }
            Some(n)
        }
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn gathering_never_fails() {
        let f = gather(&Request {
            places: vec![("recordings".into(), std::env::temp_dir())],
            ffmpeg: None,
            test_encoders: false,
        });
        assert!(f.cpu.threads > 0);
        assert!(f.memory.total_mb > 0);
        assert!(!f.ffmpeg.found);
        assert!(f.missing.iter().any(|m| m == "FFmpeg"));
        // Named the way the page reads them (app/src/syscheck/rules.ts).
        let v = serde_json::to_value(&f).unwrap();
        assert!(v["memory"]["totalMb"].is_u64());
        assert!(v["os"]["is64bit"].is_boolean());
        assert!(v["hwEncoders"].is_array());
        assert!(v["power"]["onBattery"].is_boolean());
    }

    #[test]
    fn numbers_in_any_shape() {
        assert_eq!(number(&serde_json::json!(5)), Some(5));
        assert_eq!(number(&serde_json::json!(" 7 ")), Some(7));
        assert_eq!(number(&serde_json::json!([0, 1])), Some(256));
        assert_eq!(number(&serde_json::json!(null)), None);
    }
}
