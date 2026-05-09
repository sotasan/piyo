mod accent;
mod config;
mod macos;
mod osc;
mod pty;
mod theme;

use tauri::Manager;
use window_vibrancy::{NSVisualEffectMaterial, NSVisualEffectState, apply_vibrancy};

use accent::get_accent_color;
use config::get_config;
use pty::{PtyState, pty_close, pty_get_cwd, pty_resize, pty_spawn, pty_write};
use theme::get_theme_css;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .setup(|app| {
            app.manage(PtyState::default());
            app.manage(config::load());

            #[cfg(target_os = "macos")]
            {
                let main = app
                    .get_webview_window("main")
                    .expect("main window missing in tauri.conf.json");
                macos::context_menu::install();
                apply_vibrancy(
                    &main,
                    NSVisualEffectMaterial::Sidebar,
                    Some(NSVisualEffectState::Active),
                    None,
                )
                .expect("failed to apply window vibrancy");
                macos::refresh_rate::install(&main);
                accent::install_observer(app.handle().clone());
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            pty_spawn,
            pty_write,
            pty_resize,
            pty_close,
            pty_get_cwd,
            get_config,
            get_theme_css,
            get_accent_color
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
