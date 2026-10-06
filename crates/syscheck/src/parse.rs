//! Reading what Windows, FFmpeg and `df` said (pure, so it is tested here).

use serde_json::Value;

use crate::{number, Disk, Gpu, Os, Power};

/// What the Windows script found.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct WindowsRaw {
    pub os: Os,
    pub gpus: Vec<Gpu>,
    /// Every drive asked about, with `drive` set ("C:") and no purpose yet.
    pub disks: Vec<Disk>,
    pub webview2: Option<String>,
    pub power: Power,
}

/// PowerShell's `ConvertTo-Json` turns a list of one into the one thing: always a list here.
fn many(v: &Value) -> Vec<&Value> {
    match v {
        Value::Array(a) => a.iter().collect(),
        Value::Null => Vec::new(),
        other => vec![other],
    }
}

fn text(v: &Value, key: &str) -> String {
    match &v[key] {
        Value::String(s) => s.trim().to_owned(),
        Value::Number(n) => n.to_string(),
        Value::Bool(b) => b.to_string(),
        _ => String::new(),
    }
}

/// Read the Windows script's JSON (anything before the first `{` is ignored).
///
/// # Errors
/// It isn't the script's JSON.
pub fn parse_windows(said: &str) -> Result<WindowsRaw, String> {
    let start = said.find('{').ok_or("no JSON")?;
    let v: Value = serde_json::from_str(said[start..].trim()).map_err(|e| e.to_string())?;
    let os = &v["os"];
    let build = number(&os["build"])
        .and_then(|b| u32::try_from(b).ok())
        .unwrap_or(0);
    let caption = text(os, "caption");
    let mut out = WindowsRaw {
        os: Os {
            name: windows_name(&caption, build),
            build,
            display_version: text(os, "display"),
            is_64bit: matches!(&os["is64"], Value::Bool(true))
                || text(os, "is64").eq_ignore_ascii_case("true"),
        },
        webview2: Some(text(&v, "webview")).filter(|s| !s.is_empty() && s != "0.0.0.0"),
        ..WindowsRaw::default()
    };
    let vram: Vec<(String, Option<u64>)> = many(&v["vram"])
        .into_iter()
        .map(|r| {
            (
                text(r, "name"),
                number(&r["qw"])
                    .or_else(|| number(&r["mem"]))
                    .filter(|n| *n > 0),
            )
        })
        .collect();
    for g in many(&v["gpus"]) {
        let name = text(g, "name");
        if name.is_empty() {
            continue;
        }
        // The registry's size is right past 4 GB; Win32_VideoController's stops at 4 GB.
        let reg = vram
            .iter()
            .find(|(n, m)| n == &name && m.is_some())
            .and_then(|(_, m)| *m);
        let wmi = number(&g["ram"]).filter(|n| *n > 0);
        let date = text(g, "date");
        out.gpus.push(Gpu {
            vendor: vendor_of(&text(g, "pnp"), &name).to_owned(),
            software: is_software_gpu(&name),
            vram_mb: reg.or(wmi).map(|b| b / 1_048_576),
            driver_version: text(g, "driver"),
            driver_date: (date.len() == 10).then_some(date),
            name,
        });
    }
    for d in many(&v["disks"]) {
        let letter = text(d, "letter");
        let (Some(free), Some(size)) = (number(&d["free"]), number(&d["size"])) else {
            continue;
        };
        out.disks.push(Disk {
            purpose: String::new(),
            drive: format!("{}:", letter.to_ascii_uppercase()),
            free_mb: free / 1_048_576,
            total_mb: size / 1_048_576,
            kind: disk_kind(&text(d, "media"), &text(d, "bus")).to_owned(),
        });
    }
    let bat = &v["battery"];
    let count = number(&bat["count"]).unwrap_or(0);
    out.power = Power {
        battery: count > 0,
        // Win32_Battery: 1 means "discharging" (on the battery).
        on_battery: count > 0 && number(&bat["status"]) == Some(1),
        plan: plan_of(&text(&v, "scheme")).to_owned(),
        mode: mode_of(&text(&v, "overlay")).to_owned(),
    };
    Ok(out)
}

/// "Windows 11 Pro" from WMI's caption; Windows 11 still says "10" in some places, so the build decides.
pub fn windows_name(caption: &str, build: u32) -> String {
    let name = caption
        .trim()
        .trim_start_matches("Microsoft ")
        .trim()
        .to_owned();
    if build >= 22000 && name.contains("Windows 10") {
        return name.replace("Windows 10", "Windows 11");
    }
    if name.is_empty() {
        return if build >= 22000 {
            "Windows 11".into()
        } else {
            "Windows".into()
        };
    }
    name
}

/// Who made a graphics card, from its PCI id (or its name).
pub fn vendor_of(pnp: &str, name: &str) -> &'static str {
    let p = pnp.to_ascii_uppercase();
    let n = name.to_ascii_lowercase();
    if p.contains("VEN_10DE")
        || n.contains("nvidia")
        || n.contains("geforce")
        || n.contains("quadro")
    {
        "nvidia"
    } else if p.contains("VEN_1002")
        || p.contains("VEN_1022")
        || n.contains("radeon")
        || n.contains("amd")
    {
        "amd"
    } else if p.contains("VEN_8086") || n.contains("intel") {
        "intel"
    } else if p.contains("VEN_1414") || n.contains("microsoft") {
        "microsoft"
    } else {
        "other"
    }
}

/// Graphics drawn by the processor (no real driver): Windows' stand-in, SwiftShader, llvmpipe.
pub fn is_software_gpu(name: &str) -> bool {
    let n = name.to_ascii_lowercase();
    [
        "basic render",
        "basic display",
        "swiftshader",
        "llvmpipe",
        "softpipe",
        "software rasterizer",
        "warp",
    ]
    .iter()
    .any(|s| n.contains(s))
}

/// "ssd", "hdd" or "unknown" from Get-PhysicalDisk's media and bus types.
pub fn disk_kind(media: &str, bus: &str) -> &'static str {
    let m = media.trim().to_ascii_uppercase();
    if m == "SSD" || m == "4" || bus.trim().eq_ignore_ascii_case("NVMe") || bus.trim() == "17" {
        "ssd"
    } else if m == "HDD" || m == "3" {
        "hdd"
    } else {
        "unknown"
    }
}

/// The power plan from `powercfg /getactivescheme` (by its id, so any language works).
pub fn plan_of(said: &str) -> &'static str {
    let s = said.to_ascii_lowercase();
    if s.trim().is_empty() {
        ""
    } else if s.contains("a1841308-3541-4fab-bc81-f71556f20b4a") {
        "saver"
    } else if s.contains("381b4222-f694-41f0-9685-ff5bb260df2e") {
        "balanced"
    } else if s.contains("8c5e7fda-e8bf-4a96-9a85-a6e23a8c635c") {
        "high"
    } else if s.contains("e9a42b02-d5df-448d-aa00-03f14749eb61") {
        "ultimate"
    } else {
        "other"
    }
}

/// Windows 11's power mode (the "overlay" scheme id).
pub fn mode_of(overlay: &str) -> &'static str {
    let s = overlay.trim().to_ascii_lowercase();
    if s.is_empty() {
        ""
    } else if s.starts_with("961cc777") {
        "efficiency"
    } else if s.starts_with("ded574b5") {
        "performance"
    } else if s.starts_with("00000000") {
        "balanced"
    } else {
        ""
    }
}

/// "7.1" from `ffmpeg -version`'s first line.
pub fn ffmpeg_version(said: &str) -> String {
    said.lines()
        .find_map(|l| l.trim().strip_prefix("ffmpeg version "))
        .and_then(|rest| rest.split_whitespace().next())
        .unwrap_or("")
        .to_owned()
}

/// The graphics cards' video encoders in `ffmpeg -encoders` (H.264 and HEVC).
pub fn hw_encoders_listed(said: &str) -> Vec<String> {
    let mut out = Vec::new();
    for line in said.lines() {
        let mut words = line.split_whitespace();
        let (Some(flags), Some(name)) = (words.next(), words.next()) else {
            continue;
        };
        if !flags.starts_with('V') || flags.len() != 6 {
            continue;
        }
        let hw = ["_nvenc", "_qsv", "_amf", "_videotoolbox"]
            .iter()
            .any(|s| name.ends_with(s));
        if hw
            && (name.starts_with("h264") || name.starts_with("hevc"))
            && !out.iter().any(|n| n == name)
        {
            out.push(name.to_owned());
        }
    }
    out
}

/// Size and free space (MB) from `df -Pk`'s second line.
pub fn parse_df(said: &str) -> Option<(u64, u64)> {
    let line = said.lines().nth(1)?;
    let cols: Vec<&str> = line.split_whitespace().collect();
    let total: u64 = cols.get(1)?.parse().ok()?;
    let free: u64 = cols.get(3)?.parse().ok()?;
    Some((total / 1024, free / 1024))
}

/// Compare dotted versions ("131.0.2903.70" ≥ "120"): missing parts count as 0.
pub fn version_at_least(have: &str, need: &str) -> bool {
    let parts = |s: &str| {
        s.split('.')
            .map(|p| p.trim().parse::<u64>().unwrap_or(0))
            .collect::<Vec<_>>()
    };
    let (a, b) = (parts(have), parts(need));
    for i in 0..a.len().max(b.len()) {
        let (x, y) = (
            a.get(i).copied().unwrap_or(0),
            b.get(i).copied().unwrap_or(0),
        );
        if x != y {
            return x > y;
        }
    }
    true
}

/// PowerShell's `-EncodedCommand`: the script as UTF-16LE, in base64.
pub fn encoded_command(script: &str) -> String {
    const A: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let bytes: Vec<u8> = script.encode_utf16().flat_map(u16::to_le_bytes).collect();
    let mut out = String::with_capacity(bytes.len().div_ceil(3) * 4);
    for chunk in bytes.chunks(3) {
        let n = (u32::from(chunk[0]) << 16)
            | (u32::from(*chunk.get(1).unwrap_or(&0)) << 8)
            | u32::from(*chunk.get(2).unwrap_or(&0));
        for i in 0..4 {
            if i <= chunk.len() {
                out.push(A[((n >> (18 - 6 * i)) & 63) as usize] as char);
            } else {
                out.push('=');
            }
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::Path;

    const SAID: &str = r#"{"os":{"caption":"Microsoft Windows 11 Pro","build":"22631","display":"23H2","is64":true},
      "gpus":[{"name":"NVIDIA GeForce RTX 3060","ram":4293918720,"driver":"31.0.15.5222","date":"2024-03-12","pnp":"PCI\\VEN_10DE&DEV_2504"},
              {"name":"Intel(R) UHD Graphics 770","ram":1073741824,"driver":"31.0.101.4502","date":"2023-06-01","pnp":"PCI\\VEN_8086&DEV_4680"}],
      "vram":[{"name":"NVIDIA GeForce RTX 3060","qw":12884901888,"mem":null},{"name":"Intel(R) UHD Graphics 770","qw":null,"mem":[0,0,0,64]}],
      "webview":"131.0.2903.70",
      "disks":[{"letter":"C","free":53687091200,"size":511101108224,"media":"SSD","bus":"NVMe"},
               {"letter":"D","free":"1099511627776","size":"2000398934016","media":"HDD","bus":"SATA"}],
      "battery":{"count":1,"status":1},
      "scheme":"Power Scheme GUID: 381b4222-f694-41f0-9685-ff5bb260df2e  (Balanced)",
      "overlay":"961cc777-2547-4f9d-8174-7d86181b8a7a"}"#;

    #[test]
    fn reads_the_windows_script() {
        let w = parse_windows(&format!("some warning\r\n{SAID}\r\n")).unwrap();
        assert_eq!(w.os.name, "Windows 11 Pro");
        assert_eq!(w.os.build, 22631);
        assert_eq!(w.os.display_version, "23H2");
        assert!(w.os.is_64bit);
        assert_eq!(w.gpus.len(), 2);
        assert_eq!(w.gpus[0].vendor, "nvidia");
        // The registry's 12 GB, not WMI's 4 GB.
        assert_eq!(w.gpus[0].vram_mb, Some(12288));
        assert_eq!(w.gpus[0].driver_date.as_deref(), Some("2024-03-12"));
        // A registry value given as bytes (little-endian): 0x40000000 = 1 GB.
        assert_eq!(w.gpus[1].vram_mb, Some(1024));
        assert_eq!(w.gpus[1].vendor, "intel");
        assert!(!w.gpus[0].software);
        assert_eq!(w.webview2.as_deref(), Some("131.0.2903.70"));
        assert_eq!(w.disks[0].drive, "C:");
        assert_eq!(w.disks[0].free_mb, 51200);
        assert_eq!(w.disks[0].kind, "ssd");
        assert_eq!(w.disks[1].kind, "hdd");
        assert_eq!(w.disks[1].free_mb, 1_048_576);
        assert!(w.power.battery && w.power.on_battery);
        assert_eq!(w.power.plan, "balanced");
        assert_eq!(w.power.mode, "efficiency");
    }

    #[test]
    fn a_list_of_one_and_missing_parts() {
        // ConvertTo-Json gives a single card as an object, not a list; nothing else known.
        let said = r#"{"os":{"caption":"Microsoft Windows 10 Home","build":19045,"display":"22H2","is64":"True"},
          "gpus":{"name":"Microsoft Basic Render Driver","ram":0,"driver":"10.0.19041.1","date":"","pnp":"ROOT\\BasicRender"},
          "vram":null,"webview":"","disks":null,"battery":{"count":0,"status":0},"scheme":"","overlay":""}"#;
        let w = parse_windows(said).unwrap();
        assert_eq!(w.os.name, "Windows 10 Home");
        assert!(w.os.is_64bit);
        assert_eq!(w.gpus.len(), 1);
        assert!(w.gpus[0].software);
        assert_eq!(w.gpus[0].vram_mb, None);
        assert_eq!(w.gpus[0].driver_date, None);
        assert_eq!(w.webview2, None);
        assert!(w.disks.is_empty());
        assert!(!w.power.battery);
        assert_eq!(w.power.plan, "");
        assert!(parse_windows("PowerShell is not here").is_err());
    }

    #[test]
    fn windows_names() {
        assert_eq!(
            windows_name("Microsoft Windows 10 Pro", 22631),
            "Windows 11 Pro"
        );
        assert_eq!(
            windows_name("Microsoft Windows 10 Pro", 19045),
            "Windows 10 Pro"
        );
        assert_eq!(windows_name("", 22000), "Windows 11");
    }

    #[test]
    fn graphics_vendors_and_software_drawing() {
        assert_eq!(
            vendor_of("PCI\\VEN_1002&DEV_73DF", "AMD Radeon RX 6700 XT"),
            "amd"
        );
        assert_eq!(vendor_of("", "Intel(R) Iris(R) Xe Graphics"), "intel");
        assert_eq!(vendor_of("", "Parallels Display Adapter"), "other");
        for s in [
            "Microsoft Basic Render Driver",
            "Microsoft Basic Display Adapter",
            "Google SwiftShader",
            "llvmpipe (LLVM 15.0.7, 256 bits)",
        ] {
            assert!(is_software_gpu(s), "{s}");
        }
        assert!(!is_software_gpu("NVIDIA GeForce GTX 1650"));
    }

    #[test]
    fn drive_kinds_and_power() {
        assert_eq!(disk_kind("Unspecified", "NVMe"), "ssd");
        assert_eq!(disk_kind("Unspecified", "USB"), "unknown");
        assert_eq!(disk_kind("4", "11"), "ssd");
        assert_eq!(
            plan_of("Power Scheme GUID: a1841308-3541-4fab-bc81-f71556f20b4a  (Energiesparmodus)"),
            "saver"
        );
        assert_eq!(
            plan_of("Power Scheme GUID: 8C5E7FDA-E8BF-4A96-9A85-A6E23A8C635C  (High performance)"),
            "high"
        );
        assert_eq!(
            plan_of("Power Scheme GUID: 11111111-2222-3333-4444-555555555555  (Dell)"),
            "other"
        );
        assert_eq!(
            mode_of("ded574b5-45a0-4f42-8737-46345c09c238"),
            "performance"
        );
        assert_eq!(mode_of("00000000-0000-0000-0000-000000000000"), "balanced");
    }

    #[test]
    fn ffmpeg_words() {
        assert_eq!(ffmpeg_version("ffmpeg version 7.1-full_build-www.gyan.dev Copyright (c) 2000-2024\nbuilt with gcc"), "7.1-full_build-www.gyan.dev");
        assert_eq!(ffmpeg_version("nothing"), "");
        let said = "Encoders:\n V..... = Video\n ------\n V....D libx264              libx264 H.264\n V....D h264_nvenc           NVIDIA NVENC H.264 encoder (codec h264)\n V....D hevc_qsv             HEVC (Intel Quick Sync Video acceleration)\n V....D av1_nvenc            NVIDIA NVENC av1\n A....D aac                  AAC\n";
        assert_eq!(hw_encoders_listed(said), vec!["h264_nvenc", "hevc_qsv"]);
    }

    #[test]
    fn df_and_drive_letters() {
        let said = "Filesystem     1024-blocks      Used Available Capacity Mounted on\n/dev/vda        263174212  37000000 209715200      16% /\n";
        assert_eq!(parse_df(said), Some((257_006, 204_800)));
        assert_eq!(parse_df("df: nope"), None);
        assert_eq!(
            crate::drive_letter(Path::new("d:\\Videos\\Lumora")),
            Some('D')
        );
        assert_eq!(crate::drive_letter(Path::new("/home/me")), None);
    }

    #[test]
    fn versions() {
        assert!(version_at_least("131.0.2903.70", "120"));
        assert!(version_at_least("120", "120.0.0"));
        assert!(!version_at_least("119.9.9", "120"));
        assert!(version_at_least("10.0.22631", "10.0.19044"));
        assert!(!version_at_least("10.0.19041", "10.0.19044"));
    }

    #[test]
    fn encoded_commands_are_utf16_base64() {
        // "hi" → 68 00 69 00
        assert_eq!(encoded_command("hi"), "aABpAA==");
        assert_eq!(encoded_command("abc"), "YQBiAGMA");
        let s = crate::windows_script(&['C', 'D']);
        assert!(s.contains("@('C','D')"));
        assert!(!s.contains("@@"));
    }
}
