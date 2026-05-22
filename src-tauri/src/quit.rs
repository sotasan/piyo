//! Quit-confirmation dialog state. Owns the i18n string cache populated
//! by the JS side at startup (see `set_quit_dialog_strings` below). The
//! swizzled `applicationShouldTerminate:` handler reads from this cache;
//! see [`crate::macos`] for the native side.

#![cfg(target_os = "macos")]

use std::sync::{OnceLock, RwLock};

use objc2::MainThreadMarker;
use objc2_app_kit::{NSAlert, NSAlertFirstButtonReturn};
use objc2_foundation::NSString;
use serde::Deserialize;
use tauri::AppHandle;

use crate::pty;

static APP_HANDLE: OnceLock<AppHandle> = OnceLock::new();

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
///
/// Uses `NSAlert` directly so the dialog shows the app icon. The
/// alternative `rfd` parentless path goes through
/// `CFUserNotificationDisplayAlert`, which always stamps a level
/// (caution / note / stop) badge regardless of the icon we want.
fn show_quit_dialog() -> bool {
    let Some(strings) = QUIT_STRINGS.read().unwrap().clone() else {
        return true;
    };
    let mtm = MainThreadMarker::new().expect("applicationShouldTerminate: runs on main");
    let alert = NSAlert::new(mtm);
    alert.setMessageText(&NSString::from_str(&strings.title));
    alert.setInformativeText(&NSString::from_str(&strings.body));
    alert.addButtonWithTitle(&NSString::from_str(&strings.ok));
    let cancel = alert.addButtonWithTitle(&NSString::from_str(&strings.cancel));
    // NSAlert auto-binds Esc/Cmd+. only when a button title is literally
    // "Cancel". With localized titles ("Abbrechen", "キャンセル", …) the
    // auto-bind misses, so bind Esc explicitly — macOS treats Cmd+. as a
    // synonym for any button whose key equivalent is Esc.
    cancel.setKeyEquivalent(&NSString::from_str("\u{1b}"));
    alert.runModal() == NSAlertFirstButtonReturn
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

pub fn install(app: AppHandle) {
    let _ = APP_HANDLE.set(app);
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
