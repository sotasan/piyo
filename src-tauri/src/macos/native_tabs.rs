#[cfg(target_os = "macos")]
mod imp {
    use std::sync::atomic::{AtomicU64, Ordering};

    use objc2_app_kit::{NSApplication, NSWindow, NSWindowOrderingMode, NSWindowTabbingMode};
    use objc2_foundation::{MainThreadMarker, NSString};
    use tauri::Manager;

    const TABBING_ID: &str = "sh.piyo.tab";

    static TAB_COUNTER: AtomicU64 = AtomicU64::new(0);

    unsafe fn as_ns_window<'a>(ptr: *mut std::ffi::c_void) -> &'a NSWindow {
        unsafe { &*(ptr as *const NSWindow) }
    }

    fn apply_tab_settings(window: &NSWindow) {
        let id = NSString::from_str(TABBING_ID);
        window.setTabbingIdentifier(&id);
        window.setTabbingMode(NSWindowTabbingMode::Preferred);
    }

    pub fn install<R: tauri::Runtime>(window: &tauri::WebviewWindow<R>) {
        let Ok(ptr) = window.ns_window() else {
            return;
        };
        apply_tab_settings(unsafe { as_ns_window(ptr) });
    }

    fn dispatch_to_key_window<R, F>(app: &tauri::AppHandle<R>, f: F) -> Result<(), String>
    where
        R: tauri::Runtime,
        F: FnOnce(&NSWindow) + Send + 'static,
    {
        app.run_on_main_thread(move || {
            let Some(mtm) = MainThreadMarker::new() else {
                return;
            };
            let app_ns = NSApplication::sharedApplication(mtm);
            if let Some(kw) = app_ns.keyWindow() {
                f(&kw);
            }
        })
        .map_err(|e| e.to_string())
    }

    pub fn new_tab<R: tauri::Runtime>(app: tauri::AppHandle<R>) -> Result<(), String> {
        let n = TAB_COUNTER.fetch_add(1, Ordering::Relaxed);
        let label = format!("tab-{n}");

        let main = app
            .get_webview_window("main")
            .ok_or_else(|| "main window missing".to_string())?;
        let main_ptr = main.ns_window().map_err(|e| e.to_string())? as usize;
        let app_inner = app.clone();

        app.run_on_main_thread(move || {
            let url = tauri::WebviewUrl::App("index.html".into());
            let Ok(new_win) = tauri::WebviewWindowBuilder::new(&app_inner, &label, url)
                .title("piyo")
                .inner_size(1000.0, 600.0)
                .build()
            else {
                return;
            };
            let Ok(new_ptr) = new_win.ns_window() else {
                return;
            };
            let (main_ns, new_ns) =
                unsafe { (as_ns_window(main_ptr as *mut _), as_ns_window(new_ptr)) };
            apply_tab_settings(new_ns);
            main_ns.addTabbedWindow_ordered(new_ns, NSWindowOrderingMode::Above);
        })
        .map_err(|e| e.to_string())
    }

    pub fn select_next<R: tauri::Runtime>(app: tauri::AppHandle<R>) -> Result<(), String> {
        dispatch_to_key_window(&app, |win| win.selectNextTab(None))
    }

    pub fn select_previous<R: tauri::Runtime>(app: tauri::AppHandle<R>) -> Result<(), String> {
        dispatch_to_key_window(&app, |win| win.selectPreviousTab(None))
    }

    pub fn merge_all<R: tauri::Runtime>(app: tauri::AppHandle<R>) -> Result<(), String> {
        dispatch_to_key_window(&app, |win| win.mergeAllWindows(None))
    }

    pub fn move_to_new_window<R: tauri::Runtime>(app: tauri::AppHandle<R>) -> Result<(), String> {
        dispatch_to_key_window(&app, |win| win.moveTabToNewWindow(None))
    }
}

#[cfg(not(target_os = "macos"))]
mod imp {
    pub fn install<R: tauri::Runtime>(_window: &tauri::WebviewWindow<R>) {}

    pub fn new_tab<R: tauri::Runtime>(_app: tauri::AppHandle<R>) -> Result<(), String> {
        Err("native tabs are only available on macOS".into())
    }

    pub fn select_next<R: tauri::Runtime>(_app: tauri::AppHandle<R>) -> Result<(), String> {
        Err("native tabs are only available on macOS".into())
    }

    pub fn select_previous<R: tauri::Runtime>(_app: tauri::AppHandle<R>) -> Result<(), String> {
        Err("native tabs are only available on macOS".into())
    }

    pub fn merge_all<R: tauri::Runtime>(_app: tauri::AppHandle<R>) -> Result<(), String> {
        Err("native tabs are only available on macOS".into())
    }

    pub fn move_to_new_window<R: tauri::Runtime>(_app: tauri::AppHandle<R>) -> Result<(), String> {
        Err("native tabs are only available on macOS".into())
    }
}

pub use imp::install;

#[tauri::command]
pub fn native_tabs_new_tab<R: tauri::Runtime>(app: tauri::AppHandle<R>) -> Result<(), String> {
    imp::new_tab(app)
}

#[tauri::command]
pub fn native_tabs_select_next<R: tauri::Runtime>(app: tauri::AppHandle<R>) -> Result<(), String> {
    imp::select_next(app)
}

#[tauri::command]
pub fn native_tabs_select_previous<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
) -> Result<(), String> {
    imp::select_previous(app)
}

#[tauri::command]
pub fn native_tabs_merge_all<R: tauri::Runtime>(app: tauri::AppHandle<R>) -> Result<(), String> {
    imp::merge_all(app)
}

#[tauri::command]
pub fn native_tabs_move_to_new_window<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
) -> Result<(), String> {
    imp::move_to_new_window(app)
}
