use std::path::PathBuf;

use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct Config {
    pub font_family: String,
    pub font_size: u16,
}

impl Default for Config {
    fn default() -> Self {
        Self {
            font_family: String::new(),
            font_size: 15,
        }
    }
}

fn config_path() -> Result<PathBuf> {
    let home = dirs::home_dir().context("could not resolve home directory")?;
    Ok(home.join(".config").join("piyo").join("piyo.toml"))
}

pub fn load() -> Result<Config> {
    confy::load_path(config_path()?).context("failed to load config")
}

#[allow(dead_code)]
pub fn save(cfg: &Config) -> Result<()> {
    confy::store_path(config_path()?, cfg).context("failed to save config")
}
