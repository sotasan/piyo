//! Quit-confirmation dialog state. Owns the i18n string cache populated
//! by the JS side at startup (see `set_quit_dialog_strings` below). The
//! swizzled `applicationShouldTerminate:` handler reads from this cache;
//! see [`crate::macos`] for the native side.

#![cfg(target_os = "macos")]

use std::sync::{OnceLock, RwLock};

use serde::Deserialize;
use tauri::AppHandle;

use crate::pty;

pub static APP_HANDLE: OnceLock<AppHandle> = OnceLock::new();

#[derive(Deserialize, Clone, Debug)]
pub struct QuitStrings {
    pub title: String,
    pub body: String,
    pub ok: String,
    pub cancel: String,
}

pub static QUIT_STRINGS: RwLock<Option<QuitStrings>> = RwLock::new(None);

#[tauri::command]
pub fn set_quit_dialog_strings(strings: QuitStrings) {
    *QUIT_STRINGS.write().unwrap() = Some(strings);
}

/// True iff any active PTY has a non-shell foreground process.
fn any_tab_busy(app: &AppHandle) -> bool {
    pty::active_rids()
        .into_iter()
        .any(|rid| pty::foreground_process_for(app, rid).is_some())
}

/// Show the parentless native quit dialog. Blocks the calling thread
/// (must be the main thread on macOS — `applicationShouldTerminate:`
/// is). Returns `true` if the user clicked the OK (Quit) button.
///
/// Returns `true` (allow quit silently) if JS hasn't pushed strings
/// yet — the only path to this branch is a Cmd+Q via system menu bar
/// before the main window has shown, where a silent quit is fine.
fn show_quit_dialog() -> bool {
    let Some(strings) = QUIT_STRINGS.read().unwrap().clone() else {
        return true;
    };
    matches!(
        rfd::MessageDialog::new()
            .set_level(rfd::MessageLevel::Warning)
            .set_title(&strings.title)
            .set_description(&strings.body)
            .set_buttons(rfd::MessageButtons::OkCancelCustom(
                strings.ok.clone(),
                strings.cancel.clone(),
            ))
            .show(),
        rfd::MessageDialogResult::Ok
    )
}

extern "C" fn should_terminate() -> bool {
    let Some(app) = APP_HANDLE.get() else {
        // Defensive: APP_HANDLE not initialized yet means lib.rs setup
        // hasn't completed — don't block quit.
        return true;
    };
    if !any_tab_busy(app) {
        return true;
    }
    show_quit_dialog()
}

pub fn install() {
    unsafe {
        crate::macos::piyo_install_quit_handler(Some(should_terminate));
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn set_quit_dialog_strings_replaces_cache() {
        // RwLock<Option<…>> starts as None.
        assert!(QUIT_STRINGS.read().unwrap().is_none());
        set_quit_dialog_strings(QuitStrings {
            title: "T".into(),
            body: "B".into(),
            ok: "O".into(),
            cancel: "C".into(),
        });
        let cached = QUIT_STRINGS.read().unwrap().clone().unwrap();
        assert_eq!(cached.title, "T");
        // Reset to None so other tests aren't affected by ordering.
        *QUIT_STRINGS.write().unwrap() = None;
    }
}
