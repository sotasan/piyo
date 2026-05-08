mod accent;
mod config;
mod context_menu;
mod osc;
mod pty;
mod theme;

use tauri::Manager;
use window_vibrancy::{NSVisualEffectMaterial, NSVisualEffectState, apply_vibrancy};

use accent::get_accent_color;
use config::get_config;
use pty::{PtyState, pty_resize, pty_spawn, pty_write};
use theme::get_theme_css;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_notification::init())
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

            #[cfg(target_os = "macos")]
            accent::install_observer(app.handle().clone());

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            pty_spawn,
            pty_write,
            pty_resize,
            get_config,
            get_theme_css,
            get_accent_color
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
