use std::path::{Component, Path};

use etcetera::AppStrategy;

#[tauri::command]
pub fn read_user_theme(name: String) -> Option<String> {
    // Defense-in-depth: only allow plain single-segment names. Rejects "..",
    // path separators, absolute paths, ".", and the empty string.
    let mut components = Path::new(&name).components();
    let first = components.next()?;
    if components.next().is_some() || !matches!(first, Component::Normal(_)) {
        return None;
    }

    let leaf = Path::new("themes").join(format!("{name}.json"));
    let path = crate::config::app_strategy().ok()?.in_config_dir(&leaf);
    std::fs::read_to_string(&path).ok()
}
