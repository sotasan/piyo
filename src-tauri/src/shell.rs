//! Shell detection, login wrapping, and `CommandBuilder` construction.
//! Pulled out of `pty.rs` so that file is only about session ownership.
use std::path::{Path, PathBuf};

use anyhow::{Context, Result};
use portable_pty::CommandBuilder;

pub enum Shell {
    Bash,
    Zsh,
    Fish,
    Nu,
    Other,
}

impl Shell {
    pub fn detect(path: &str) -> Self {
        match Path::new(path).file_name().and_then(|n| n.to_str()) {
            Some("bash") => Self::Bash,
            Some("zsh") => Self::Zsh,
            Some("fish") => Self::Fish,
            Some("nu") => Self::Nu,
            _ => Self::Other,
        }
    }

    fn exec_inner(&self, shell: &str, integration_dir: &Path) -> String {
        let shell = sh_quote(shell);
        match self {
            Self::Bash => {
                let rcfile = integration_dir
                    .join("bash")
                    .join(concat!(env!("CARGO_PKG_NAME"), ".bash"));
                let rcfile = sh_quote(&rcfile.to_string_lossy());
                format!("exec {shell} --rcfile {rcfile}")
            }
            _ => format!("exec -l {shell}"),
        }
    }

    fn apply_env(&self, cmd: &mut CommandBuilder, integration_dir: &Path) {
        match self {
            Self::Zsh => {
                if let Ok(prev) = std::env::var("ZDOTDIR") {
                    cmd.env("PIYO_ZSH_ZDOTDIR", prev);
                }
                cmd.env("ZDOTDIR", integration_dir.join("zsh"));
            }
            Self::Fish | Self::Nu => {
                let dir = integration_dir.to_string_lossy();
                let existing = std::env::var("XDG_DATA_DIRS")
                    .unwrap_or_else(|_| "/usr/local/share:/usr/share".into());
                let data_dirs = if existing.split(':').any(|p| p == dir) {
                    existing
                } else {
                    format!("{dir}:{existing}")
                };
                cmd.env("XDG_DATA_DIRS", data_dirs);
            }
            Self::Bash | Self::Other => {}
        }
    }
}

fn sh_quote(s: &str) -> String {
    format!("'{}'", s.replace('\'', "'\\''"))
}

fn hushlogin() -> bool {
    etcetera::home_dir()
        .map(|home| home.join(".hushlogin").exists())
        .unwrap_or(false)
}

#[cfg(unix)]
fn login_shell_from_passwd() -> Option<String> {
    use uzers::os::unix::UserExt;
    let user = uzers::get_user_by_uid(uzers::get_current_uid())?;
    let shell = user.shell().to_str()?;
    if shell.is_empty() {
        None
    } else {
        Some(shell.to_owned())
    }
}

#[cfg(not(unix))]
fn login_shell_from_passwd() -> Option<String> {
    None
}

pub fn resolve_path() -> String {
    std::env::var("SHELL")
        .ok()
        .filter(|s| !s.is_empty())
        .or_else(login_shell_from_passwd)
        .unwrap_or_else(|| "/bin/sh".into())
}

pub struct ResourceDirs {
    pub integration: PathBuf,
    pub bin: PathBuf,
    pub scripts: PathBuf,
}

impl ResourceDirs {
    pub fn from_resource_dir(resource_dir: &Path) -> Self {
        Self {
            integration: resource_dir.join("shell"),
            bin: resource_dir.join("bin"),
            scripts: resource_dir.join("scripts"),
        }
    }
}

fn apply_common_env(cmd: &mut CommandBuilder, dirs: &ResourceDirs) {
    cmd.env("TERM", "xterm-256color");
    cmd.env("COLORTERM", "truecolor");
    cmd.env("TERM_PROGRAM", env!("CARGO_PKG_NAME"));
    cmd.env("TERM_PROGRAM_VERSION", env!("CARGO_PKG_VERSION"));
    let lang = std::env::var("LANG").unwrap_or_else(|_| "en_US.UTF-8".into());
    cmd.env("LANG", lang);
    cmd.env("PIYO_BIN", &dirs.bin);
    cmd.env("PIYO_SCRIPTS", &dirs.scripts);
}

pub fn build_command(
    shell_path: &str,
    shell: &Shell,
    dirs: &ResourceDirs,
    cwd: Option<&Path>,
) -> Result<CommandBuilder> {
    let user = whoami::username().context("failed to read current username")?;
    let flags = if hushlogin() { "-flpq" } else { "-flp" };
    let mut cmd = CommandBuilder::new("/usr/bin/login");
    cmd.arg(flags);
    cmd.arg(user);
    cmd.arg("/bin/bash");
    cmd.arg("--noprofile");
    cmd.arg("--norc");
    cmd.arg("-c");
    cmd.arg(shell.exec_inner(shell_path, &dirs.integration));
    apply_common_env(&mut cmd, dirs);
    shell.apply_env(&mut cmd, &dirs.integration);
    if let Some(dir) = cwd {
        cmd.cwd(dir);
    }
    Ok(cmd)
}
