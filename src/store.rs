//! The sidebar's model and business logic: the list of repositories, each one's
//! worktrees (discovered via [`crate::git`]), and the terminal sessions per
//! worktree — all persisted in SQLite (via `sqlx`, with migrations).
//!
//! The store is **async-native**: every DB-touching method is `async fn` exported
//! with `#[uniffi::export(async_runtime = "tokio")]`, so UniFFI drives the futures
//! on a Tokio runtime and the generated Swift methods are `async`. Blocking git
//! discovery is offloaded with `tokio::task::spawn_blocking`. The Swift side is a
//! thin `@MainActor @Observable` adapter that `await`s these and republishes the
//! state for SwiftUI.

use std::collections::HashMap;
use std::path::Path;
use std::sync::{Arc, Mutex, OnceLock};

use sqlx::sqlite::{SqliteConnectOptions, SqliteJournalMode, SqlitePoolOptions};
use sqlx::SqlitePool;
use uuid::Uuid;

use crate::git::{self, Worktree};

/// A git repository the user has added to the sidebar.
#[derive(uniffi::Record, Clone, Debug)]
pub struct Repo {
    pub id: String,
    pub path: String,
    /// Display name: the last path component of `path`.
    pub name: String,
}

/// A terminal session (tab) of a worktree. `id` is the UUID that also names the
/// zmx session (`piyo-<id>`).
#[derive(uniffi::Record, Clone, Debug)]
pub struct Session {
    pub id: String,
    pub worktree_path: String,
}

/// What happened when the user tried to add a folder. The Swift side maps
/// `NotARepository` to a localized message; the others are silent successes.
#[derive(uniffi::Enum, Debug, PartialEq)]
pub enum AddRepoOutcome {
    Added,
    AlreadyPresent,
    NotARepository,
}

/// In-memory, non-persisted derived state: each repo's discovered worktrees and
/// the reverse map from a worktree path to its owning repository id (needed to
/// attach new sessions to the right repo).
#[derive(Default)]
struct Cache {
    worktrees: HashMap<String, Vec<Worktree>>, // repo path -> worktrees
    worktree_repo: HashMap<String, String>,    // worktree path -> repository id
}

/// The store object Swift holds. The pool is created in [`Self::open`], not the
/// constructor: building a pool needs a Tokio runtime context (it spawns a
/// background task), which only the async methods have — the constructor is
/// synchronous so Swift can build it in a plain `@State` initializer.
#[derive(uniffi::Object)]
pub struct RepoStoreCore {
    db_path: String,
    pool: OnceLock<SqlitePool>,
    cache: Mutex<Cache>,
}

#[uniffi::export]
impl RepoStoreCore {
    /// Create the store over the SQLite database at `db_path`. Does no IO; call
    /// [`Self::open`] (async) to create the pool, run migrations, and discover.
    #[uniffi::constructor]
    pub fn new(db_path: String) -> Arc<Self> {
        Arc::new(Self {
            db_path,
            pool: OnceLock::new(),
            cache: Mutex::new(Cache::default()),
        })
    }

    /// Cached worktrees for a repo (in-memory; no IO, so this stays synchronous).
    pub fn worktrees(&self, repo_path: String) -> Vec<Worktree> {
        self.cache
            .lock()
            .unwrap()
            .worktrees
            .get(&repo_path)
            .cloned()
            .unwrap_or_default()
    }
}

#[uniffi::export(async_runtime = "tokio")]
impl RepoStoreCore {
    /// Create the connection pool, run migrations, and discover the saved
    /// repositories' worktrees. Call once after construction, before reading
    /// state. Runs under UniFFI's Tokio runtime (so pool creation has a context).
    pub async fn open(&self) {
        let options = SqliteConnectOptions::new()
            .filename(&self.db_path)
            .create_if_missing(true)
            .foreign_keys(true)
            .journal_mode(SqliteJournalMode::Wal);
        let pool = SqlitePoolOptions::new().connect_lazy_with(options);
        let _ = sqlx::migrate!("./migrations").run(&pool).await;
        let _ = self.pool.set(pool);
        self.rediscover().await;
    }

    /// The added repositories, in saved (drag-to-reorder) order.
    pub async fn repos(&self) -> Vec<Repo> {
        let Some(pool) = self.pool.get() else {
            return Vec::new();
        };
        load_repos(pool).await
    }

    /// The sessions of a worktree, in saved order (does not create any).
    pub async fn sessions(&self, worktree_path: String) -> Vec<Session> {
        let Some(pool) = self.pool.get() else {
            return Vec::new();
        };
        into_sessions(session_ids(pool, &worktree_path).await, &worktree_path)
    }

    /// Ensure a worktree has at least one session (creating a default if empty),
    /// then return its sessions. Used when a worktree is first opened.
    pub async fn ensure_session(&self, worktree_path: String) -> Vec<Session> {
        let Some(pool) = self.pool.get() else {
            return Vec::new();
        };
        let repo_id = self.repo_for(&worktree_path);
        let mut ids = session_ids(pool, &worktree_path).await;
        if ids.is_empty() {
            if let Some(repo_id) = repo_id {
                if let Some(id) = insert_session(pool, &repo_id, &worktree_path).await {
                    ids.push(id);
                }
            }
        }
        into_sessions(ids, &worktree_path)
    }

    /// Open a new session on a worktree; returns it (or `None` if the worktree's
    /// repository isn't known).
    pub async fn add_session(&self, worktree_path: String) -> Option<Session> {
        let pool = self.pool.get()?;
        let repo_id = self.repo_for(&worktree_path)?;
        let id = insert_session(pool, &repo_id, &worktree_path).await?;
        Some(Session { id, worktree_path })
    }

    /// Close a session (the UI keeps at least one open).
    pub async fn close_session(&self, session_id: String) {
        let Some(pool) = self.pool.get() else { return };
        let _ = sqlx::query("DELETE FROM sessions WHERE id = ?")
            .bind(&session_id)
            .execute(pool)
            .await;
    }

    /// Add the git repository containing `folder` (deduped by toplevel path).
    pub async fn add_folder(&self, folder: String) -> AddRepoOutcome {
        let Some(pool) = self.pool.get() else {
            return AddRepoOutcome::NotARepository;
        };
        // gitoxide discovery is blocking filesystem work — keep it off the async pool.
        let top = tokio::task::spawn_blocking(move || git::resolve_toplevel(&folder))
            .await
            .ok()
            .flatten();
        let Some(top) = top else {
            return AddRepoOutcome::NotARepository;
        };

        let existing: Option<String> = sqlx::query_scalar("SELECT id FROM repositories WHERE path = ?")
            .bind(&top)
            .fetch_optional(pool)
            .await
            .ok()
            .flatten();
        if existing.is_some() {
            return AddRepoOutcome::AlreadyPresent;
        }

        let position: i64 =
            sqlx::query_scalar("SELECT COALESCE(MAX(position) + 1, 0) FROM repositories")
                .fetch_one(pool)
                .await
                .unwrap_or(0);
        let _ = sqlx::query("INSERT INTO repositories (id, path, position) VALUES (?, ?, ?)")
            .bind(Uuid::new_v4().to_string())
            .bind(&top)
            .bind(position)
            .execute(pool)
            .await;
        self.rediscover().await;
        AddRepoOutcome::Added
    }

    /// Remove a repository (cascade-deletes its sessions).
    pub async fn remove(&self, repo_id: String) {
        let Some(pool) = self.pool.get() else { return };
        let _ = sqlx::query("DELETE FROM repositories WHERE id = ?")
            .bind(&repo_id)
            .execute(pool)
            .await;
        self.rediscover().await;
    }

    /// Persist a new sidebar order for the repositories (their ids top to bottom).
    pub async fn reorder_repositories(&self, ordered_ids: Vec<String>) {
        let Some(pool) = self.pool.get() else { return };
        let Ok(mut tx) = pool.begin().await else {
            return;
        };
        for (position, id) in ordered_ids.iter().enumerate() {
            let _ = sqlx::query("UPDATE repositories SET position = ? WHERE id = ?")
                .bind(position as i64)
                .bind(id)
                .execute(&mut *tx)
                .await;
        }
        let _ = tx.commit().await;
    }
}

impl RepoStoreCore {
    /// The repository id owning a worktree path, from the in-memory map.
    fn repo_for(&self, worktree_path: &str) -> Option<String> {
        self.cache
            .lock()
            .unwrap()
            .worktree_repo
            .get(worktree_path)
            .cloned()
    }

    /// Rebuild the worktree cache + reverse map from the persisted repositories.
    async fn rediscover(&self) {
        let Some(pool) = self.pool.get() else { return };
        let repos = load_repos(pool).await;
        // Discover worktrees (blocking git IO) off the async runtime's worker.
        let discovered = tokio::task::spawn_blocking(move || {
            repos
                .into_iter()
                .map(|repo| {
                    let worktrees = git::worktrees(&repo.path);
                    (repo.path, repo.id, worktrees)
                })
                .collect::<Vec<_>>()
        })
        .await
        .unwrap_or_default();

        let mut cache = self.cache.lock().unwrap();
        cache.worktrees.clear();
        cache.worktree_repo.clear();
        for (path, id, worktrees) in discovered {
            for worktree in &worktrees {
                cache.worktree_repo.insert(worktree.path.clone(), id.clone());
            }
            cache.worktrees.insert(path, worktrees);
        }
    }
}

async fn load_repos(pool: &SqlitePool) -> Vec<Repo> {
    let rows: Vec<(String, String)> =
        sqlx::query_as("SELECT id, path FROM repositories ORDER BY position")
            .fetch_all(pool)
            .await
            .unwrap_or_default();
    rows.into_iter()
        .map(|(id, path)| Repo {
            name: repo_name(&path),
            id,
            path,
        })
        .collect()
}

async fn session_ids(pool: &SqlitePool, worktree_path: &str) -> Vec<String> {
    sqlx::query_scalar("SELECT id FROM sessions WHERE worktree_path = ? ORDER BY position")
        .bind(worktree_path)
        .fetch_all(pool)
        .await
        .unwrap_or_default()
}

async fn insert_session(pool: &SqlitePool, repo_id: &str, worktree_path: &str) -> Option<String> {
    let id = Uuid::new_v4().to_string();
    let position: i64 =
        sqlx::query_scalar("SELECT COALESCE(MAX(position) + 1, 0) FROM sessions WHERE worktree_path = ?")
            .bind(worktree_path)
            .fetch_one(pool)
            .await
            .unwrap_or(0);
    sqlx::query("INSERT INTO sessions (id, repository_id, worktree_path, position) VALUES (?, ?, ?, ?)")
        .bind(&id)
        .bind(repo_id)
        .bind(worktree_path)
        .bind(position)
        .execute(pool)
        .await
        .ok()?;
    Some(id)
}

fn into_sessions(ids: Vec<String>, worktree_path: &str) -> Vec<Session> {
    ids.into_iter()
        .map(|id| Session {
            id,
            worktree_path: worktree_path.to_string(),
        })
        .collect()
}

/// Display name = the last path component, falling back to the whole path.
fn repo_name(path: &str) -> String {
    Path::new(path)
        .file_name()
        .map(|s| s.to_string_lossy().into_owned())
        .unwrap_or_else(|| path.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;
    use std::process::Command;

    fn git(dir: &Path, args: &[&str]) {
        let ok = Command::new("git")
            .current_dir(dir)
            .args(args)
            .env("GIT_AUTHOR_NAME", "t")
            .env("GIT_AUTHOR_EMAIL", "t@t")
            .env("GIT_COMMITTER_NAME", "t")
            .env("GIT_COMMITTER_EMAIL", "t@t")
            .status()
            .unwrap()
            .success();
        assert!(ok, "git {args:?} failed");
    }

    fn scratch(tag: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("piyo-store-{tag}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn init_repo(parent: &Path, name: &str) -> PathBuf {
        let repo = parent.join(name);
        std::fs::create_dir_all(&repo).unwrap();
        git(&repo, &["-c", "init.defaultBranch=main", "init"]);
        std::fs::write(repo.join("f.txt"), "hi").unwrap();
        git(&repo, &["add", "."]);
        git(&repo, &["commit", "-m", "init"]);
        repo
    }

    #[tokio::test]
    async fn repos_add_dedup_reorder_persist() {
        let root = scratch("repos");
        let a = init_repo(&root, "alpha");
        let b = init_repo(&root, "bravo");
        let db = root.join("piyo.sqlite");

        let core = RepoStoreCore::new(db.to_string_lossy().into_owned());
        core.open().await;
        assert_eq!(
            core.add_folder(root.to_string_lossy().into_owned()).await,
            AddRepoOutcome::NotARepository
        );
        assert_eq!(core.add_folder(a.to_string_lossy().into_owned()).await, AddRepoOutcome::Added);
        assert_eq!(core.add_folder(b.to_string_lossy().into_owned()).await, AddRepoOutcome::Added);
        assert_eq!(
            core.add_folder(a.to_string_lossy().into_owned()).await,
            AddRepoOutcome::AlreadyPresent
        );

        let repos = core.repos().await;
        assert_eq!(repos.iter().map(|r| r.name.as_str()).collect::<Vec<_>>(), ["alpha", "bravo"]);
        assert!(repos[0].id.len() == 36 && repos[0].id.contains('-'));

        core.reorder_repositories(vec![repos[1].id.clone(), repos[0].id.clone()]).await;
        assert_eq!(
            core.repos().await.iter().map(|r| r.name.as_str()).collect::<Vec<_>>(),
            ["bravo", "alpha"]
        );

        drop(core);
        let reopened = RepoStoreCore::new(db.to_string_lossy().into_owned());
        reopened.open().await;
        assert_eq!(
            reopened.repos().await.iter().map(|r| r.name.as_str()).collect::<Vec<_>>(),
            ["bravo", "alpha"]
        );

        let _ = std::fs::remove_dir_all(&root);
    }

    #[tokio::test]
    async fn sessions_uuid_default_and_fk_cascade() {
        let root = scratch("sessions");
        let repo = init_repo(&root, "repo");
        let db = root.join("piyo.sqlite");

        let core = RepoStoreCore::new(db.to_string_lossy().into_owned());
        core.open().await;
        core.add_folder(repo.to_string_lossy().into_owned()).await;
        let wt = core.repos().await[0].path.clone();

        assert!(core.sessions(wt.clone()).await.is_empty());
        let ensured = core.ensure_session(wt.clone()).await;
        assert_eq!(ensured.len(), 1);
        assert!(ensured[0].id.contains('-'));
        assert_eq!(core.ensure_session(wt.clone()).await.len(), 1); // idempotent

        let added = core.add_session(wt.clone()).await.expect("repo known");
        let sessions = core.sessions(wt.clone()).await;
        assert_eq!(sessions.len(), 2);
        assert_eq!(sessions[1].id, added.id);
        assert_ne!(sessions[0].id, sessions[1].id);

        core.close_session(sessions[0].id.clone()).await;
        assert_eq!(core.sessions(wt.clone()).await.len(), 1);

        let repo_id = core.repos().await[0].id.clone();
        core.remove(repo_id).await;
        assert!(core.sessions(wt).await.is_empty()); // cascade

        let _ = std::fs::remove_dir_all(&root);
    }
}
