#[cfg(target_os = "macos")]
unsafe extern "C" {
    fn piyo_install_context_menu();
    fn piyo_install_refresh_rate(wk_webview: *mut std::ffi::c_void);
}

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
