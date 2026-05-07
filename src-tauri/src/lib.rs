mod config;
mod context_menu;
mod pty;
mod theme;

use tauri::Manager;
use window_vibrancy::{NSVisualEffectMaterial, NSVisualEffectState, apply_vibrancy};

use config::get_config;
use pty::{PtyState, pty_resize, pty_spawn, pty_write};
use theme::get_theme_css;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            app.manage(PtyState::default());
            app.manage(config::load());
            context_menu::install();

            #[cfg(target_os = "macos")]
            apply_vibrancy(
                app.get_webview_window("main").unwrap(),
                NSVisualEffectMaterial::Sidebar,
                Some(NSVisualEffectState::Active),
                None,
            )
            .expect("failed to apply window vibrancy");

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            pty_spawn,
            pty_write,
            pty_resize,
            get_config,
            get_theme_css
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
