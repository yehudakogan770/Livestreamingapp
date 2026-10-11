// Hide the extra console window on Windows release builds.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // A helper that opens VST3 plug-ins (so a plug-in that crashes can't take the editor down).
    if std::env::args().nth(1).as_deref() == Some(lumora_edit::VST_HELPER_ARG) {
        std::process::exit(lumora_edit::vst_helper());
    }
    lumora_edit::run();
}
