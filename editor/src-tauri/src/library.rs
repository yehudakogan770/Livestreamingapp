//! Sending a finished video to Lumora: it goes in Lumora's library (the list
//! of things kept for later events), ready to add and show live.

use std::fs;
use std::path::Path;
use std::time::{SystemTime, UNIX_EPOCH};

use serde_json::{json, Value};

/// Add a video to the library in Lumora's data folder.
///
/// # Errors
/// Lumora isn't installed here, or its library can't be written.
pub fn add_video(dir: &Path, path: &str, name: &str, seconds: f64) -> Result<(), String> {
    if !dir.is_dir() {
        return Err(
            "Lumora was not found on this computer. Install Lumora, open it once, then try again."
                .into(),
        );
    }
    let file = dir.join("library.json");
    let mut items: Vec<Value> = fs::read_to_string(&file)
        .ok()
        .and_then(|t| serde_json::from_str::<Value>(&t).ok())
        .and_then(|v| v.as_array().cloned())
        .unwrap_or_default();
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |d| d.as_millis());
    // A video already sent from the same file is replaced (the newer export wins).
    items.retain(|it| it.pointer("/source/kind/path").and_then(Value::as_str) != Some(path));
    items.push(json!({
        "id": format!("lib-edit-{now:x}"),
        "name": name,
        "category": "From Lumora Studio",
        "savedAt": u64::try_from(now).unwrap_or(0),
        "type": "input",
        "source": {
            "name": name,
            "kind": {
                "type": "video",
                "path": path,
                "durationS": seconds,
                "playback": { "playing": false, "posS": 0, "at": 0 }
            }
        }
    }));
    let text = serde_json::to_string_pretty(&Value::Array(items)).map_err(|e| e.to_string())?;
    let temp = file.with_extension("saving");
    fs::write(&temp, text).map_err(|e| format!("Lumora's library could not be saved: {e}"))?;
    fs::rename(&temp, &file).map_err(|e| format!("Lumora's library could not be saved: {e}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn adds_and_replaces() {
        let dir = std::env::temp_dir().join(format!("lumora-edit-lib-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        assert!(add_video(&dir, "/v.mp4", "Intro", 3.0).is_err());
        fs::create_dir_all(&dir).unwrap();
        fs::write(dir.join("library.json"), r#"[{"id":"x","type":"preset"}]"#).unwrap();
        add_video(&dir, "/v.mp4", "Intro", 3.0).unwrap();
        add_video(&dir, "/v.mp4", "Intro 2", 4.0).unwrap();
        let v: Value =
            serde_json::from_str(&fs::read_to_string(dir.join("library.json")).unwrap()).unwrap();
        let list = v.as_array().unwrap();
        assert_eq!(list.len(), 2);
        assert_eq!(list[1]["source"]["kind"]["durationS"], 4.0);
        assert_eq!(list[1]["name"], "Intro 2");
        let _ = fs::remove_dir_all(dir);
    }
}
