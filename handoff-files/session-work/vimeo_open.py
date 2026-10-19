import sys
root = sys.argv[1]
p = root + '/editor/src-tauri/src/youtube.rs'
s = open(p).read()
assert 'fn open_browser(url: &str) -> Result<(), String> {' in s
s = s.replace("fn open_browser(url: &str) -> Result<(), String> {", "pub(crate) fn open_browser(url: &str) -> Result<(), String> {", 1)
open(p, 'w').write(s)
p = root + '/editor/src-tauri/src/vimeo.rs'
s = open(p).read()
s += '''
/// Open a published video's page (only a vimeo.com address is taken).
#[tauri::command]
pub fn vimeo_open(url: String) -> Result<(), String> {
    let ok = url
        .strip_prefix("https://vimeo.com/")
        .is_some_and(|rest| !rest.is_empty() && rest.chars().all(|c| c.is_ascii_alphanumeric() || c == '/'));
    if !ok {
        return Err("That isn’t a Vimeo video.".to_owned());
    }
    crate::youtube::open_browser(&url)
}
'''
open(p, 'w').write(s)
p = root + '/editor/src-tauri/src/lib.rs'
s = open(p).read()
assert "            vimeo::vimeo_upload,\n" in s
s = s.replace("            vimeo::vimeo_upload,\n", "            vimeo::vimeo_upload,\n            vimeo::vimeo_open,\n", 1)
open(p, 'w').write(s)
