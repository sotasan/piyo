use anyhow::{Context, Result};
use config::{Config, File, FileFormat};
use etcetera::{app_strategy::AppStrategyArgs, choose_app_strategy, AppStrategy};
use serde::Deserialize;

const DEFAULT_TOML: &str = include_str!("../config/default.toml");

#[derive(Debug, Clone, Deserialize)]
#[allow(dead_code)]
pub struct Configuration {
    pub font_family: String,
    pub font_size: u16,
    pub theme: String,
}

pub fn app_strategy() -> Result<impl AppStrategy> {
    choose_app_strategy(AppStrategyArgs {
        app_name: env!("CARGO_PKG_NAME").into(),
        ..Default::default()
    })
    .context("could not resolve application directories")
}

pub fn load() -> Configuration {
    try_load().unwrap_or_else(|err| {
        eprintln!("config: {err:#}; falling back to defaults");
        toml::from_str(DEFAULT_TOML).expect("default.toml must parse")
    })
}

fn try_load() -> Result<Configuration> {
    let path = app_strategy()?.in_config_dir(concat!(env!("CARGO_PKG_NAME"), ".toml"));
    Config::builder()
        .add_source(File::from_str(DEFAULT_TOML, FileFormat::Toml))
        .add_source(File::from(path).required(false))
        .build()
        .context("failed to build config")?
        .try_deserialize()
        .context("failed to deserialize config")
}
