//! The library: things made for one event (texts, slideshows, credits,
//! presets, runs of show…) kept on this computer for later events. The
//! control window decides what an item holds; this keeps the list safe on
//! disk and moves it to and from files (export / import).

use std::fs;
use std::path::{Path, PathBuf};

use serde_json::Value;

use crate::store::write_file_atomic;

const FILE: &str = "library.json";
/// Largest library (it holds settings, not media files).
const MAX_BYTES: usize = 50 * 1024 * 1024;

pub struct Library {
    path: PathBuf,
}

impl Library {
    pub fn new(dir: &Path) -> Library {
        Library {
            path: dir.join(FILE),
        }
    }

    /// The items (an empty list if there are none yet or the file is damaged).
    pub fn load(&self) -> Value {
        read_items(&self.path).unwrap_or_else(|_| Value::Array(Vec::new()))
    }

    /// Replace the items.
    ///
    /// # Errors
    /// When the list is not a list or too big, or the disk refuses.
    pub fn save(&self, items: &Value) -> Result<(), String> {
        let text = checked(items)?;
        write_file_atomic(&self.path, &text)
            .map_err(|e| format!("The library could not be saved: {e}"))
    }
}

fn checked(items: &Value) -> Result<String, String> {
    if !items.is_array() {
        return Err("A library is a list of items.".to_owned());
    }
    let text = serde_json::to_string_pretty(items).map_err(|e| e.to_string())?;
    if text.len() > MAX_BYTES {
        return Err("The library is too big.".to_owned());
    }
    Ok(text)
}

fn read_items(path: &Path) -> Result<Value, String> {
    let text = fs::read_to_string(path).map_err(|e| e.to_string())?;
    let v: Value =
        serde_json::from_str(&text).map_err(|_| "That file is not a Lumora library.".to_owned())?;
    // An export is {"lumoraLibrary":1,"items":[…]}; the library file is the list itself.
    let items = v.get("items").cloned().unwrap_or(v);
    if items.is_array() {
        Ok(items)
    } else {
        Err("That file is not a Lumora library.".to_owned())
    }
}

/// Write items to a file to take to another computer.
///
/// # Errors
/// When the disk refuses.
pub fn export(path: &Path, items: &Value) -> Result<(), String> {
    checked(items)?;
    let wrapped = serde_json::json!({ "lumoraLibrary": 1, "items": items });
    let text = serde_json::to_string_pretty(&wrapped).map_err(|e| e.to_string())?;
    write_file_atomic(path, &text).map_err(|e| format!("Could not write {}: {e}", path.display()))
}

/// Read items from an exported file.
///
/// # Errors
/// When the file can't be read or isn't a library.
pub fn import(path: &Path) -> Result<Value, String> {
    read_items(path)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn saves_exports_and_imports() {
        let dir = std::env::temp_dir().join(format!("lumora-library-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        let lib = Library::new(&dir);
        assert_eq!(lib.load(), serde_json::json!([]));
        let items = serde_json::json!([{ "id": "a", "name": "Lower third" }]);
        lib.save(&items).unwrap();
        assert_eq!(lib.load(), items);
        let file = dir.join("Take home.lumora-library");
        export(&file, &items).unwrap();
        assert_eq!(import(&file).unwrap(), items);
        assert!(lib.save(&serde_json::json!({ "not": "a list" })).is_err());
        fs::write(dir.join("junk"), "hello").unwrap();
        assert!(import(&dir.join("junk")).is_err());
    }
}
