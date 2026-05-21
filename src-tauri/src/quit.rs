//! Quit-confirmation dialog state. Owns the i18n string cache populated
//! by the JS side at startup (see `set_quit_dialog_strings` below). The
//! swizzled `applicationShouldTerminate:` handler reads from this cache;
//! see [`crate::macos`] for the native side.

#![cfg(target_os = "macos")]

use std::sync::{OnceLock, RwLock};

use serde::Deserialize;
use tauri::AppHandle;

// Consumed by the quit handler in a follow-up task.
#[allow(dead_code)]
pub static APP_HANDLE: OnceLock<AppHandle> = OnceLock::new();

// Fields are consumed by the quit handler in a follow-up task.
#[allow(dead_code)]
#[derive(Deserialize, Clone, Debug)]
pub struct QuitStrings {
    pub title: String,
    pub body: String,
    pub ok: String,
    pub cancel: String,
}

// Consumed by the quit handler in a follow-up task.
#[allow(dead_code)]
pub static QUIT_STRINGS: RwLock<Option<QuitStrings>> = RwLock::new(None);

#[tauri::command]
pub fn set_quit_dialog_strings(strings: QuitStrings) {
    *QUIT_STRINGS.write().unwrap() = Some(strings);
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
