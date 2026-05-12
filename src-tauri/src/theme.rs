use std::path::Path;

use etcetera::AppStrategy;

#[tauri::command]
pub fn read_user_theme(name: String) -> Option<String> {
    let basename = Path::new(&name).file_name()?.to_str()?;
    let leaf = Path::new("themes").join(format!("{basename}.json"));
    let path = crate::config::app_strategy().ok()?.in_config_dir(&leaf);
    std::fs::read_to_string(&path).ok()
}
