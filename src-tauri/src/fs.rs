use std::fs;
use std::path::Path;

use anyhow::Context;
use serde::Serialize;

#[derive(Debug)]
pub struct CommandError(anyhow::Error);

impl<E: Into<anyhow::Error>> From<E> for CommandError {
    fn from(err: E) -> Self {
        Self(err.into())
    }
}

impl serde::Serialize for CommandError {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.serialize_str(&format!("{:#}", self.0))
    }
}

type CommandResult<T> = Result<T, CommandError>;

/// Names that are filtered out of every directory listing and watcher event.
pub const EXCLUDE: &[&str] = &[".git", ".DS_Store"];

pub fn is_excluded(name: &str) -> bool {
    EXCLUDE.contains(&name)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DirEntry {
    name: String,
    is_dir: bool,
}

#[tauri::command]
pub fn list_dir(path: String) -> CommandResult<Vec<DirEntry>> {
    let dir = Path::new(&path);
    let read = fs::read_dir(dir).with_context(|| format!("read_dir failed for {path}"))?;

    let mut entries: Vec<DirEntry> = Vec::new();
    for item in read {
        let item = match item {
            Ok(i) => i,
            Err(_) => continue,
        };
        let name = match item.file_name().into_string() {
            Ok(n) => n,
            Err(_) => continue,
        };
        if is_excluded(&name) {
            continue;
        }
        // Use file_type() rather than metadata() so symlinks are reported as files
        // (not the type of their target). This dodges symlink cycles entirely.
        let is_dir = item
            .file_type()
            .map(|t| t.is_dir() && !t.is_symlink())
            .unwrap_or(false);
        entries.push(DirEntry { name, is_dir });
    }

    entries.sort_by(|a, b| match (a.is_dir, b.is_dir) {
        (true, false) => std::cmp::Ordering::Less,
        (false, true) => std::cmp::Ordering::Greater,
        _ => a.name.to_lowercase().cmp(&b.name.to_lowercase()),
    });

    Ok(entries)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn is_excluded_matches_fixed_list() {
        assert!(is_excluded(".git"));
        assert!(is_excluded(".DS_Store"));
        assert!(!is_excluded("src"));
        assert!(!is_excluded(".gitignore"));
    }

    #[test]
    fn list_dir_filters_and_sorts() {
        let tmp = tempfile::tempdir().unwrap();
        std::fs::create_dir(tmp.path().join(".git")).unwrap();
        std::fs::create_dir(tmp.path().join("src")).unwrap();
        std::fs::write(tmp.path().join("README.md"), "").unwrap();
        std::fs::write(tmp.path().join(".DS_Store"), "").unwrap();

        let names: Vec<_> = list_dir(tmp.path().to_string_lossy().into())
            .unwrap()
            .into_iter()
            .map(|e| e.name)
            .collect();
        assert_eq!(names, vec!["src", "README.md"]);
    }
}
