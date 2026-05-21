#[cfg(target_os = "macos")]
mod bindings {
    include!(concat!(env!("OUT_DIR"), "/macos_bindings.rs"));
}

#[cfg(target_os = "macos")]
pub use bindings::piyo_install_quit_handler;
#[cfg(target_os = "macos")]
use bindings::*;

#[cfg(target_os = "macos")]
pub mod context_menu {
    pub fn install() {
        unsafe { super::piyo_install_context_menu() }
    }
}

#[cfg(target_os = "macos")]
pub mod refresh_rate {
    pub fn install<R: tauri::Runtime>(window: &tauri::WebviewWindow<R>) {
        let _ = window.with_webview(|wv| {
            let ptr = wv.inner();
            unsafe { super::piyo_install_refresh_rate(ptr) };
        });
    }
}

#[cfg(target_os = "macos")]
pub mod system_appearance {
    pub fn install<R: tauri::Runtime>(window: &tauri::WebviewWindow<R>) {
        let _ = window.with_webview(|wv| {
            let ptr = wv.inner();
            unsafe { super::piyo_install_system_appearance(ptr) };
        });
    }
}
