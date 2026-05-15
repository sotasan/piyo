use serde::{Deserialize, Serialize};

pub const EVENT_PTY_TITLE: &str = "pty:title";
pub const EVENT_PTY_CWD: &str = "pty:cwd";
pub const EVENT_PTY_EXIT: &str = "pty:exit";
pub const EVENT_PTY_MODES: &str = "pty:modes";
pub const EVENT_PTY_BELL: &str = "pty:bell";

#[derive(Debug)]
pub struct CommandError(anyhow::Error);

impl<E: Into<anyhow::Error>> From<E> for CommandError {
    fn from(err: E) -> Self {
        Self(err.into())
    }
}

impl Serialize for CommandError {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.serialize_str(&format!("{:#}", self.0))
    }
}

pub type CommandResult<T> = Result<T, CommandError>;

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PtyCwd {
    pub rid: u32,
    pub cwd: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PtyModes {
    pub rid: u32,
    pub mouse_tracking: bool,
    pub bracketed_paste: bool,
    pub focus_event: bool,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PtyBell {
    pub rid: u32,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PtyTitle {
    pub rid: u32,
    pub title: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PtyExit {
    pub rid: u32,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PtySpawned {
    pub rid: u32,
    pub shell: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KeyInput {
    pub code: String,
    pub mods: u16,
    pub text: Option<String>,
    pub unshifted: Option<u32>,
    pub action: u8,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MouseSize {
    pub screen_width: u32,
    pub screen_height: u32,
    pub cell_width: u32,
    pub cell_height: u32,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MouseEventInput {
    pub action: u8,
    pub button: Option<u8>,
    pub mods: u16,
    pub x: f32,
    pub y: f32,
    pub size: MouseSize,
    pub any_pressed: bool,
}
