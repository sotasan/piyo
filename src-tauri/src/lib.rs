mod accent;
mod appearance;
mod config;
mod icon;
mod macos;
mod osc;
mod pty;
mod theme;

use tauri::Manager;
use window_vibrancy::{NSVisualEffectMaterial, NSVisualEffectState, apply_vibrancy};

use accent::get_accent_color;
use appearance::set_window_appearance;
use config::get_config;
use pty::{pty_close, pty_resize, pty_spawn, pty_write};
use theme::read_user_theme;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .register_asynchronous_uri_scheme_protocol("icon", icon::handle)
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .setup(|app| {
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
                macos::system_appearance::install(&main);
                accent::install_observer(app.handle().clone());
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            pty_spawn,
            pty_write,
            pty_resize,
            pty_close,
            get_config,
            read_user_theme,
            get_accent_color,
            set_window_appearance
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
