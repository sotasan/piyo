//! Shared tauri-specta builder. Used by `lib::run()` to register the invoke
//! handler at runtime AND by `examples/gen_bindings.rs` to write the TS
//! bindings before vite starts.
use tauri_specta::{Builder, collect_commands, collect_events};

use crate::{accent, appearance, config, pty, theme};

pub fn builder() -> Builder<tauri::Wry> {
    Builder::<tauri::Wry>::new()
        .commands(collect_commands![
            pty::pty_write,
            pty::pty_resize,
            pty::pty_close,
            pty::pty_send_key,
            pty::pty_send_mouse,
            pty::pty_scroll,
            pty::pty_scroll_to,
            config::get_config,
            theme::read_user_theme,
            accent::get_accent_color,
            appearance::set_window_appearance,
        ])
        .events(collect_events![
            pty::PtyTitle,
            pty::PtyCwd,
            pty::PtyExit,
            pty::PtyModes,
            accent::AccentChanged,
        ])
}
