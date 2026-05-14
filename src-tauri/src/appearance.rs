#[cfg(target_os = "macos")]
mod platform {
    use objc2_app_kit::{
        NSAppearance, NSAppearanceCustomization, NSAppearanceNameAqua, NSAppearanceNameDarkAqua,
        NSWindow,
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

#[cfg(not(target_os = "macos"))]
mod platform {
    use tauri::{Runtime, WebviewWindow};

    pub fn apply<R: Runtime>(_window: &WebviewWindow<R>, _dark: bool) -> Result<(), String> {
        Ok(())
    }
}

#[derive(serde::Deserialize, specta::Type)]
#[serde(rename_all = "lowercase")]
pub enum Mode {
    Light,
    Dark,
}

#[tauri::command]
#[specta::specta]
pub fn set_window_appearance(window: tauri::WebviewWindow, mode: Mode) -> Result<(), String> {
    platform::apply(&window, matches!(mode, Mode::Dark))
}
