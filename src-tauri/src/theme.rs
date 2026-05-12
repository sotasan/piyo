use std::path::Path;

use etcetera::AppStrategy;

#[tauri::command]
pub fn read_user_theme(name: String) -> Option<String> {
    let leaf = Path::new("themes").join(format!("{name}.json"));
    let path = crate::config::app_strategy().ok()?.in_config_dir(&leaf);
    std::fs::read_to_string(&path).ok()
}
