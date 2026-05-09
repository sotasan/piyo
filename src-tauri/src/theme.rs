use std::path::{Path, PathBuf};

use etcetera::AppStrategy;
use rust_embed::RustEmbed;
use tauri::State;

use crate::config::Configuration;

const DEFAULT_THEME: &str = "rose-pine";

#[derive(RustEmbed)]
#[folder = "themes/"]
struct BuiltinThemes;

fn builtin(name: &str) -> Option<String> {
    let file = BuiltinThemes::get(&format!("{name}.css"))?;
    Some(String::from_utf8_lossy(&file.data).into_owned())
}

fn user_theme_path(name: &str) -> Option<PathBuf> {
    let leaf = Path::new("themes").join(format!("{name}.css"));
    Some(crate::config::app_strategy().ok()?.in_config_dir(&leaf))
}

fn resolve(name: &str) -> String {
    if let Some(path) = user_theme_path(name)
        && let Ok(css) = std::fs::read_to_string(&path)
    {
        return css;
    }
    if let Some(css) = builtin(name) {
        return css;
    }
    builtin(DEFAULT_THEME).expect("default theme must be embedded")
}

#[tauri::command]
pub fn get_theme_css(config: State<'_, Configuration>) -> String {
    resolve(&config.theme)
}
