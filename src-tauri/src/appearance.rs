#[cfg(target_os = "macos")]
mod platform {
    use objc2_app_kit::{
        NSAppearance, NSAppearanceNameAqua, NSAppearanceNameDarkAqua, NSWindow,
    };
    use tauri::{Runtime, WebviewWindow};

    pub fn apply<R: Runtime>(window: &WebviewWindow<R>, dark: bool) -> Result<(), String> {
        let raw = window.ns_window().map_err(|e| e.to_string())?;
        if raw.is_null() {
            return Err("ns_window pointer is null".into());
        }
        unsafe {
            let ns_window: &NSWindow = &*(raw as *const NSWindow);
            let name = if dark {
                NSAppearanceNameDarkAqua
            } else {
                NSAppearanceNameAqua
            };
            let appearance = NSAppearance::appearanceNamed(name);
            ns_window.setAppearance(appearance.as_deref());
        }
        Ok(())
    }
}

#[tauri::command]
pub fn set_window_appearance<R: tauri::Runtime>(
    window: tauri::WebviewWindow<R>,
    mode: String,
) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        let dark = mode != "light";
        platform::apply(&window, dark)?;
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (window, mode);
    }
    Ok(())
}
