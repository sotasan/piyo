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

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::Duration;

use notify::{EventKind, RecursiveMode};
use notify_debouncer_full::{DebounceEventResult, Debouncer, RecommendedCache, new_debouncer};
use tauri::{AppHandle, Emitter, Manager};

pub struct WatcherRegistry {
    inner: Mutex<HashMap<u32, Debouncer<notify::RecommendedWatcher, RecommendedCache>>>,
}

impl WatcherRegistry {
    pub fn new() -> Self {
        Self {
            inner: Mutex::new(HashMap::new()),
        }
    }
}

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase", tag = "kind")]
enum FsEventKind {
    Create,
    Remove,
    Rename,
}

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct FsEventPayload {
    rid: u32,
    #[serde(flatten)]
    kind: FsEventKind,
    path: String,
    is_dir: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    from_path: Option<String>,
}

/// Returns true if any path segment is in the exclude list.
fn path_excluded(path: &Path) -> bool {
    path.components()
        .any(|c| c.as_os_str().to_str().map(is_excluded).unwrap_or(false))
}

fn emit_event(app: &AppHandle, payload: FsEventPayload) {
    let _ = app.emit("fs:event", payload);
}

fn dispatch(app: &AppHandle, rid: u32, root: &Path, result: DebounceEventResult) {
    let events = match result {
        Ok(events) => events,
        Err(errs) => {
            for e in errs {
                eprintln!("fs watcher error: {e:?}");
            }
            return;
        }
    };

    for event in events {
        // Each DebouncedEvent has an inner Event with a `paths` Vec.
        // Use the first path as the primary path for this event.
        let primary = match event.paths.first() {
            Some(p) => p,
            None => continue,
        };

        if path_excluded(primary) {
            continue;
        }

        let rel = match primary.strip_prefix(root) {
            Ok(r) => r,
            Err(_) => continue,
        };
        let rel_str = rel.to_string_lossy().into_owned();
        if rel_str.is_empty() {
            continue;
        }
        let is_dir = primary.is_dir();

        // notify_debouncer_full emits high-level EventKinds. We collapse them
        // into create/remove/rename for the frontend.
        match event.kind {
            EventKind::Create(_) => {
                emit_event(
                    app,
                    FsEventPayload {
                        rid,
                        kind: FsEventKind::Create,
                        path: rel_str,
                        is_dir,
                        from_path: None,
                    },
                );
            }
            EventKind::Remove(_) => {
                emit_event(
                    app,
                    FsEventPayload {
                        rid,
                        kind: FsEventKind::Remove,
                        path: rel_str,
                        is_dir,
                        from_path: None,
                    },
                );
            }
            EventKind::Modify(notify::event::ModifyKind::Name(_))
                // notify on macOS sometimes reports renames as paired Create+Remove
                // events in the same batch; sometimes as Modify::Name with both
                // paths in `paths`. Handle the two-path form here; the paired
                // form is naturally handled by the Create and Remove arms above.
                if event.paths.len() == 2 =>
            {
                let from = event.paths[0]
                    .strip_prefix(root)
                    .ok()
                    .map(|p| p.to_string_lossy().into_owned());
                if let Some(from) = from {
                    emit_event(
                        app,
                        FsEventPayload {
                            rid,
                            kind: FsEventKind::Rename,
                            path: rel_str,
                            is_dir,
                            from_path: Some(from),
                        },
                    );
                }
            }
            _ => {}
        }
    }
}

#[tauri::command]
pub fn fs_watch_start(app: AppHandle, rid: u32, path: String) -> CommandResult<()> {
    let registry = app.state::<WatcherRegistry>();
    let root = PathBuf::from(&path);
    let root_for_cb = root.clone();
    let app_for_cb = app.clone();

    let mut debouncer = new_debouncer(
        Duration::from_millis(100),
        None,
        move |res: DebounceEventResult| {
            dispatch(&app_for_cb, rid, &root_for_cb, res);
        },
    )
    .context("failed to create fs watcher")?;
    debouncer
        .watch(&root, RecursiveMode::Recursive)
        .context("failed to watch path")?;

    let mut map = registry.inner.lock().unwrap();
    // Drop any previous watcher for this rid (e.g., from a stale cwd).
    map.remove(&rid);
    map.insert(rid, debouncer);
    Ok(())
}

#[tauri::command]
pub fn fs_watch_stop(app: AppHandle, rid: u32) -> CommandResult<()> {
    let registry = app.state::<WatcherRegistry>();
    let mut map = registry.inner.lock().unwrap();
    map.remove(&rid);
    Ok(())
}

#[cfg(test)]
mod watcher_tests {
    use super::*;

    #[test]
    fn path_excluded_handles_any_segment() {
        assert!(path_excluded(Path::new("/root/.git/index")));
        assert!(path_excluded(Path::new("/root/foo/.DS_Store")));
        assert!(!path_excluded(Path::new("/root/src/main.rs")));
    }
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
