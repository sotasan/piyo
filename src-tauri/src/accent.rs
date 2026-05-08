#[cfg(target_os = "macos")]
use objc2_app_kit::{NSColor, NSColorSpace};

#[cfg(target_os = "macos")]
fn read_accent_hex() -> String {
    let color = NSColor::controlAccentColor();
    match color.colorUsingColorSpace(&NSColorSpace::sRGBColorSpace()) {
        Some(rgb) => {
            let r = rgb.redComponent();
            let g = rgb.greenComponent();
            let b = rgb.blueComponent();
            format!(
                "#{:02x}{:02x}{:02x}",
                (r.clamp(0.0, 1.0) * 255.0).round() as u8,
                (g.clamp(0.0, 1.0) * 255.0).round() as u8,
                (b.clamp(0.0, 1.0) * 255.0).round() as u8,
            )
        }
        None => "transparent".into(),
    }
}

#[tauri::command]
pub fn get_accent_color() -> String {
    read_accent_hex()
}
