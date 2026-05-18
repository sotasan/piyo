use serde::Serialize;

pub const EVENT_PTY_CWD: &str = "pty:cwd";
pub const EVENT_PTY_EXIT: &str = "pty:exit";

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
pub struct PtyExit {
    pub rid: u32,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PtySpawned {
    pub rid: u32,
    pub shell: String,
}
