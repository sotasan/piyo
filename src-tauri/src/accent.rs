use serde::Serialize;
use specta::Type;
use tauri_specta::Event;

/// Emitted whenever the system accent color changes.
#[derive(Clone, Debug, Serialize, Type, Event)]
pub struct AccentChanged(pub String);

#[cfg(target_os = "macos")]
mod platform {
    use std::ptr::NonNull;

    use block2::RcBlock;
    use objc2_app_kit::{NSColor, NSColorSpace, NSSystemColorsDidChangeNotification};
    use objc2_foundation::{NSNotification, NSNotificationCenter, NSUserDefaults, ns_string};
    use tauri::AppHandle;
    use tauri_specta::Event;

    use super::AccentChanged;

    const FALLBACK: &str = "transparent";

    pub fn read_accent_hex() -> String {
        let defaults = NSUserDefaults::standardUserDefaults();
        if defaults
            .objectForKey(ns_string!("AppleAccentColor"))
            .is_none()
        {
            return FALLBACK.into();
        }
        match NSColor::controlAccentColor().colorUsingColorSpace(&NSColorSpace::sRGBColorSpace()) {
            Some(rgb) => {
                let r = (rgb.redComponent().clamp(0.0, 1.0) * 255.0).round() as u8;
                let g = (rgb.greenComponent().clamp(0.0, 1.0) * 255.0).round() as u8;
                let b = (rgb.blueComponent().clamp(0.0, 1.0) * 255.0).round() as u8;
                format!("#{r:02x}{g:02x}{b:02x}")
            }
            None => FALLBACK.into(),
        }
    }

    pub fn install_observer(app: AppHandle) {
        let block = RcBlock::new(move |_: NonNull<NSNotification>| {
            let _ = AccentChanged(read_accent_hex()).emit(&app);
        });
        let center = NSNotificationCenter::defaultCenter();
        unsafe {
            let _ = center.addObserverForName_object_queue_usingBlock(
                Some(NSSystemColorsDidChangeNotification),
                None,
                None,
                &block,
            );
        }
    }
}

#[cfg(not(target_os = "macos"))]
mod platform {
    use tauri::AppHandle;

    pub fn read_accent_hex() -> String {
        "transparent".into()
    }

    pub fn install_observer(_app: AppHandle) {}
}

pub use platform::install_observer;

#[tauri::command]
#[specta::specta]
pub fn get_accent_color() -> String {
    platform::read_accent_hex()
}
