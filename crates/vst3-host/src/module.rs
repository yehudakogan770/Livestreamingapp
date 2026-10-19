//! A plug-in file (a `.vst3` bundle folder, or a single `.vst3` file on
//! Windows) loaded, started as the platform asks, and its factory read: the
//! effects it offers.
#![allow(unsafe_code)]

use std::ffi::c_void;
use std::path::{Path, PathBuf};

use crate::com::{
    c_text, results, ComPtr, IPluginFactory2Vtbl, IPluginFactoryVtbl, PClassInfo, PClassInfo2,
    PFactoryInfo, Tuid, IPLUGIN_FACTORY2,
};

/// One class a plug-in file offers.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClassInfo {
    /// Its id (32 hex digits, as stored in the file).
    pub cid: String,
    pub name: String,
    pub vendor: String,
    pub version: String,
    /// "Fx", "Fx|EQ", "Instrument|Synth"… (empty when the plug-in doesn't say).
    pub sub_categories: String,
}

impl ClassInfo {
    /// An effect (not an instrument): what Lumora Studio can use on sound.
    #[must_use]
    pub fn is_effect(&self) -> bool {
        !self
            .sub_categories
            .split('|')
            .any(|c| c.eq_ignore_ascii_case("Instrument"))
    }
}

#[must_use]
pub fn hex(id: &Tuid) -> String {
    id.iter().map(|b| format!("{b:02X}")).collect()
}

#[must_use]
pub fn unhex(s: &str) -> Option<Tuid> {
    if s.len() != 32 {
        return None;
    }
    let mut out = [0u8; 16];
    for (i, b) in out.iter_mut().enumerate() {
        *b = u8::from_str_radix(s.get(i * 2..i * 2 + 2)?, 16).ok()?;
    }
    Some(out)
}

/// The folder inside a bundle with this computer's binary.
const ARCH_DIR: &str = if cfg!(all(windows, target_arch = "x86_64")) {
    "x86_64-win"
} else if cfg!(all(windows, target_arch = "aarch64")) {
    "arm64-win"
} else if cfg!(all(target_os = "linux", target_arch = "aarch64")) {
    "aarch64-linux"
} else {
    "x86_64-linux"
};

/// The library inside a plug-in bundle (or the file itself).
#[must_use]
pub fn binary_of(path: &Path) -> Option<PathBuf> {
    if path.is_file() {
        return Some(path.to_path_buf());
    }
    let stem = path.file_stem()?.to_string_lossy().into_owned();
    let dir = path.join("Contents").join(ARCH_DIR);
    let ext = if cfg!(windows) { "vst3" } else { "so" };
    let named = dir.join(format!("{stem}.{ext}"));
    if named.is_file() {
        return Some(named);
    }
    // Some bundles name the binary differently: the only one there.
    std::fs::read_dir(&dir)
        .ok()?
        .filter_map(Result::ok)
        .map(|e| e.path())
        .find(|p| p.extension().is_some_and(|e| e.eq_ignore_ascii_case(ext)))
}

/// A loaded plug-in file.
pub struct Module {
    pub path: PathBuf,
    factory: Option<ComPtr>,
    exit: Option<Exit>,
    lib: Option<libloading::Library>,
}

type GetFactory = unsafe extern "system" fn() -> *mut c_void;
type Exit = unsafe extern "C" fn() -> bool;

/// Windows: the optional `bool InitDll()` first, `bool ExitDll()` last.
#[cfg(windows)]
fn start(
    path: &Path,
    lib: libloading::Library,
) -> Result<(libloading::Library, Option<Exit>), String> {
    // SAFETY: entry points as the SDK defines them.
    unsafe {
        if let Ok(init) = lib.get::<unsafe extern "C" fn() -> bool>(b"InitDll\0") {
            if !init() {
                return Err(format!("{} would not start.", path.display()));
            }
        }
        let exit = lib.get::<Exit>(b"ExitDll\0").ok().map(|f| *f);
        Ok((lib, exit))
    }
}

/// Linux: `bool ModuleEntry(void* handle)` must be called first, `bool ModuleExit()` last.
#[cfg(not(windows))]
fn start(
    path: &Path,
    lib: libloading::Library,
) -> Result<(libloading::Library, Option<Exit>), String> {
    use libloading::os::unix::Library as Unix;
    let raw = Unix::from(lib).into_raw();
    // SAFETY: the handle just came from a library we opened.
    let lib = unsafe { Unix::from_raw(raw) };
    // SAFETY: entry points as the SDK defines them.
    unsafe {
        if let Ok(entry) = lib.get::<unsafe extern "C" fn(*mut c_void) -> bool>(b"ModuleEntry\0") {
            if !entry(raw) {
                return Err(format!("{} would not start.", path.display()));
            }
        }
        let exit = lib.get::<Exit>(b"ModuleExit\0").ok().map(|f| *f);
        Ok((lib.into(), exit))
    }
}

impl Module {
    /// Load a plug-in file and start it.
    ///
    /// # Errors
    /// It isn't a VST3 plug-in for this computer, or it wouldn't start.
    pub fn load(path: &Path) -> Result<Self, String> {
        let bin = binary_of(path)
            .ok_or_else(|| format!("{} has no plug-in for this computer in it.", path.display()))?;
        // SAFETY: loading a plug-in runs its start-up code: that is what using a plug-in means
        // (this runs in a helper process, so a broken one can't take the editor down).
        let lib = unsafe { libloading::Library::new(&bin) }
            .map_err(|e| format!("{} could not be loaded: {e}", path.display()))?;
        let (lib, exit) = start(path, lib)?;
        Self::with_factory(path, lib, exit)
    }

    fn with_factory(
        path: &Path,
        lib: libloading::Library,
        exit: Option<Exit>,
    ) -> Result<Self, String> {
        // SAFETY: `IPluginFactory* GetPluginFactory()`, which hands over one reference.
        let factory = unsafe {
            let get = lib
                .get::<GetFactory>(b"GetPluginFactory\0")
                .map_err(|_| format!("{} is not a VST3 plug-in.", path.display()))?;
            ComPtr::from_raw(get())
        };
        let Some(factory) = factory else {
            return Err(format!("{} gave no plug-ins.", path.display()));
        };
        Ok(Self {
            path: path.to_path_buf(),
            factory: Some(factory),
            exit,
            lib: Some(lib),
        })
    }

    /// A module around a factory already in memory (tests: a plug-in written in Rust).
    #[must_use]
    pub fn from_factory(path: &Path, factory: ComPtr) -> Self {
        Self {
            path: path.to_path_buf(),
            factory: Some(factory),
            exit: None,
            lib: None,
        }
    }

    #[must_use]
    pub fn factory(&self) -> &ComPtr {
        self.factory
            .as_ref()
            .expect("the factory lives as long as the module")
    }

    /// The company that made it (from the factory).
    #[must_use]
    pub fn vendor(&self) -> String {
        // SAFETY: the factory implements IPluginFactory; the info is ours to fill in.
        unsafe {
            let mut info: PFactoryInfo = std::mem::zeroed();
            if (self.factory().vtbl::<IPluginFactoryVtbl>().get_factory_info)(
                self.factory().as_ptr(),
                &mut info,
            ) == results::OK
            {
                c_text(&info.vendor)
            } else {
                String::new()
            }
        }
    }

    /// The sound processors it offers ("Audio Module Class").
    #[must_use]
    pub fn classes(&self) -> Vec<ClassInfo> {
        let f = self.factory();
        let vendor = self.vendor();
        let v2 = f.query(&IPLUGIN_FACTORY2);
        let mut out = Vec::new();
        // SAFETY: the factory implements IPluginFactory (and IPluginFactory2 when it answered for it).
        unsafe {
            let n = (f.vtbl::<IPluginFactoryVtbl>().count_classes)(f.as_ptr());
            for i in 0..n.clamp(0, 1024) {
                if let Some(v2) = &v2 {
                    let mut info: PClassInfo2 = std::mem::zeroed();
                    if (v2.vtbl::<IPluginFactory2Vtbl>().get_class_info2)(v2.as_ptr(), i, &mut info)
                        == results::OK
                    {
                        if c_text(&info.category) != "Audio Module Class" {
                            continue;
                        }
                        let own = c_text(&info.vendor);
                        out.push(ClassInfo {
                            cid: hex(&info.cid),
                            name: c_text(&info.name),
                            vendor: if own.is_empty() { vendor.clone() } else { own },
                            version: c_text(&info.version),
                            sub_categories: c_text(&info.sub_categories),
                        });
                        continue;
                    }
                }
                let mut info: PClassInfo = std::mem::zeroed();
                if (f.vtbl::<IPluginFactoryVtbl>().get_class_info)(f.as_ptr(), i, &mut info)
                    == results::OK
                    && c_text(&info.category) == "Audio Module Class"
                {
                    out.push(ClassInfo {
                        cid: hex(&info.cid),
                        name: c_text(&info.name),
                        vendor: vendor.clone(),
                        version: String::new(),
                        sub_categories: String::new(),
                    });
                }
            }
        }
        out
    }

    /// Make one of its objects, asking for an interface.
    ///
    /// # Errors
    /// The plug-in wouldn't make it.
    pub fn create(&self, cid: &Tuid, iid: &Tuid) -> Result<ComPtr, String> {
        let f = self.factory();
        let mut out: *mut c_void = std::ptr::null_mut();
        // SAFETY: createInstance(cid, iid, obj) of IPluginFactory; on success it hands over a reference.
        let r = unsafe {
            (f.vtbl::<IPluginFactoryVtbl>().create_instance)(
                f.as_ptr(),
                cid.as_ptr(),
                iid.as_ptr(),
                &mut out,
            )
        };
        if r != results::OK {
            return Err("The plug-in could not be opened.".into());
        }
        // SAFETY: a successful createInstance handed over a reference.
        unsafe { ComPtr::from_raw(out) }.ok_or_else(|| "The plug-in could not be opened.".into())
    }
}

impl Drop for Module {
    fn drop(&mut self) {
        // The factory goes first, then the plug-in is told to finish, then the library is let go.
        self.factory = None;
        if let Some(exit) = self.exit {
            // SAFETY: the plug-in's own exit entry point, called once after everything of it is released.
            unsafe { exit() };
        }
        self.lib = None;
    }
}

/// Where VST3 plug-ins are installed on this computer.
#[must_use]
pub fn plugin_folders() -> Vec<PathBuf> {
    let mut out = Vec::new();
    if cfg!(windows) {
        if let Some(common) = std::env::var_os("CommonProgramFiles") {
            out.push(PathBuf::from(common).join("VST3"));
        }
        if let Some(local) = std::env::var_os("LOCALAPPDATA") {
            out.push(
                PathBuf::from(local)
                    .join("Programs")
                    .join("Common")
                    .join("VST3"),
            );
        }
    } else if cfg!(target_os = "macos") {
        out.push(PathBuf::from("/Library/Audio/Plug-Ins/VST3"));
        if let Some(home) = std::env::var_os("HOME") {
            out.push(PathBuf::from(home).join("Library/Audio/Plug-Ins/VST3"));
        }
    } else {
        if let Some(home) = std::env::var_os("HOME") {
            out.push(PathBuf::from(home).join(".vst3"));
        }
        out.push(PathBuf::from("/usr/lib/vst3"));
        out.push(PathBuf::from("/usr/local/lib/vst3"));
    }
    out
}

/// Every plug-in file under some folders (bundles are not looked inside).
#[must_use]
pub fn find_plugins(folders: &[PathBuf]) -> Vec<PathBuf> {
    fn walk(dir: &Path, depth: usize, out: &mut Vec<PathBuf>) {
        let Ok(entries) = std::fs::read_dir(dir) else {
            return;
        };
        let mut entries: Vec<_> = entries.filter_map(Result::ok).map(|e| e.path()).collect();
        entries.sort();
        for p in entries {
            let is_vst3 = p
                .extension()
                .is_some_and(|e| e.eq_ignore_ascii_case("vst3"));
            if is_vst3 {
                out.push(p);
            } else if p.is_dir() && depth < 4 {
                walk(&p, depth + 1, out);
            }
        }
    }
    let mut out = Vec::new();
    for f in folders {
        walk(f, 0, &mut out);
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn class_ids_round_trip_as_hex() {
        let id: Tuid = [0xAB, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 0xFF];
        let h = hex(&id);
        assert_eq!(h.len(), 32);
        assert_eq!(unhex(&h), Some(id));
        assert_eq!(unhex("nothex"), None);
    }

    #[test]
    fn finds_bundles_and_their_binary() {
        let dir = std::env::temp_dir().join(format!("lumora-vst-find-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        let bundle = dir.join("Vendor").join("Echo.vst3");
        let bin_dir = bundle.join("Contents").join(ARCH_DIR);
        std::fs::create_dir_all(&bin_dir).unwrap();
        let ext = if cfg!(windows) { "vst3" } else { "so" };
        std::fs::write(bin_dir.join(format!("Echo.{ext}")), b"x").unwrap();
        std::fs::write(dir.join("notes.txt"), b"x").unwrap();
        let found = find_plugins(std::slice::from_ref(&dir));
        assert_eq!(found, vec![bundle.clone()]);
        assert_eq!(
            binary_of(&bundle),
            Some(bin_dir.join(format!("Echo.{ext}")))
        );
        assert!(Module::load(&dir.join("missing.vst3")).is_err());
        // Not a library at all: refused with a message, not a crash.
        assert!(Module::load(&bundle).is_err());
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn instruments_are_not_effects() {
        let c = |s: &str| ClassInfo {
            cid: String::new(),
            name: String::new(),
            vendor: String::new(),
            version: String::new(),
            sub_categories: s.into(),
        };
        assert!(c("Fx|Reverb").is_effect());
        assert!(c("").is_effect());
        assert!(!c("Instrument|Synth").is_effect());
    }
}
