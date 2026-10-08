fn main() {
    // The app registrations for connected YouTube and Facebook accounts
    // (docs/LIVE_ACCOUNTS.md): read with option_env!, so a change rebuilds.
    for var in [
        "LUMORA_YT_CLIENT_ID",
        "LUMORA_YT_CLIENT_SECRET",
        "LUMORA_FB_APP_ID",
    ] {
        println!("cargo:rerun-if-env-changed={var}");
    }
    tauri_build::build();
}
