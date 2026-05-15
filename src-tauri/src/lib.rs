mod accent;
mod appearance;
mod config;
mod icon;
mod keycode;
mod macos;
mod osc;
mod pty;
mod shell;
mod theme;
mod vt;
mod wire;

use tauri::Manager;
use window_vibrancy::{NSVisualEffectMaterial, NSVisualEffectState, apply_vibrancy};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new("info,piyo_lib=debug")),
        )
        .init();

    tauri::Builder::default()
        .register_asynchronous_uri_scheme_protocol("icon", icon::handle)
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .invoke_handler(tauri::generate_handler![
            pty::pty_spawn,
            pty::pty_write,
            pty::pty_resize,
            pty::pty_close,
            pty::pty_send_key,
            pty::pty_send_mouse,
            config::get_config,
            theme::read_user_theme,
            accent::get_accent_color,
            appearance::set_window_appearance,
        ])
        .setup(move |app| {
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
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
