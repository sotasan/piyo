//! The sidebar's model and business logic: the list of repositories, each one's
//! worktrees (discovered via [`crate::git`]), and the terminal sessions per
//! worktree — all persisted in SQLite via **Diesel** (type-safe query builder,
//! migrations as the single source of truth, schema in [`crate::schema`]).
//!
//! DB access is async (`diesel-async` over a `SyncConnectionWrapper` SQLite
//! connection pool), exported with `#[uniffi::export(async_runtime = "tokio")]`
//! so the generated Swift methods are `async`. Migrations run synchronously on a
//! blocking thread at [`Self::open`]. The Swift side is a thin `@MainActor`
//! `@Observable` adapter that `await`s these and republishes the state.

use std::collections::HashMap;
use std::path::Path;
use std::sync::{Arc, Mutex, OnceLock};

use diesel::dsl::max;
use diesel::prelude::*;
use diesel::sqlite::SqliteConnection;
use diesel_async::pooled_connection::deadpool::Pool;
use diesel_async::pooled_connection::AsyncDieselConnectionManager;
use diesel_async::sync_connection_wrapper::SyncConnectionWrapper;
use diesel_async::RunQueryDsl;
use diesel_migrations::{embed_migrations, EmbeddedMigrations, MigrationHarness};
use uuid::Uuid;

use crate::git::{self, Worktree};
use crate::schema::{repositories, sessions};

type AsyncConn = SyncConnectionWrapper<SqliteConnection>;
type DbPool = Pool<AsyncConn>;

const MIGRATIONS: EmbeddedMigrations = embed_migrations!();

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
/// the reverse map from a worktree path to its owning repository id.
#[derive(Default)]
struct Cache {
    worktrees: HashMap<String, Vec<Worktree>>, // repo path -> worktrees
    worktree_repo: HashMap<String, String>,    // worktree path -> repository id
}

/// The store object Swift holds. The pool is created in [`Self::open`] (its
/// connections live on the Tokio runtime), so the constructor stays synchronous.
#[derive(uniffi::Object)]
pub struct RepoStoreCore {
    db_path: String,
    pool: OnceLock<DbPool>,
    cache: Mutex<Cache>,
}

#[uniffi::export]
impl RepoStoreCore {
    /// Create the store over the SQLite database at `db_path`. Does no IO; call
    /// [`Self::open`] (async) to run migrations, build the pool, and discover.
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
    /// Run migrations, build the connection pool, and discover the saved
    /// repositories' worktrees. Call once after construction, before reading.
    pub async fn open(&self) {
        run_migrations(self.db_path.clone()).await;
        let manager = AsyncDieselConnectionManager::<AsyncConn>::new(self.db_path.clone());
        if let Ok(pool) = Pool::builder(manager).build() {
            let _ = self.pool.set(pool);
        }
        self.rediscover().await;
    }

    /// The added repositories, in saved (drag-to-reorder) order.
    pub async fn repos(&self) -> Vec<Repo> {
        let Ok(mut conn) = self.conn().await else {
            return Vec::new();
        };
        fetch_repos(&mut conn).await
    }

    /// The sessions of a worktree, in saved order (does not create any).
    pub async fn sessions(&self, worktree_path: String) -> Vec<Session> {
        let Ok(mut conn) = self.conn().await else {
            return Vec::new();
        };
        into_sessions(fetch_session_ids(&mut conn, &worktree_path).await, &worktree_path)
    }

    /// Ensure a worktree has at least one session (creating a default if empty),
    /// then return its sessions. Used when a worktree is first opened.
    pub async fn ensure_session(&self, worktree_path: String) -> Vec<Session> {
        let repo_id = self.repo_for(&worktree_path);
        let Ok(mut conn) = self.conn().await else {
            return Vec::new();
        };
        let mut ids = fetch_session_ids(&mut conn, &worktree_path).await;
        if ids.is_empty() {
            if let Some(repo_id) = repo_id {
                if let Some(id) = insert_session(&mut conn, &repo_id, &worktree_path).await {
                    ids.push(id);
                }
            }
        }
        into_sessions(ids, &worktree_path)
    }

    /// Open a new session on a worktree; returns it (or `None` if the worktree's
    /// repository isn't known).
    pub async fn add_session(&self, worktree_path: String) -> Option<Session> {
        let repo_id = self.repo_for(&worktree_path)?;
        let mut conn = self.conn().await.ok()?;
        let id = insert_session(&mut conn, &repo_id, &worktree_path).await?;
        Some(Session { id, worktree_path })
    }

    /// Close a session (the UI keeps at least one open).
    pub async fn close_session(&self, session_id: String) {
        let Ok(mut conn) = self.conn().await else {
            return;
        };
        let _ = diesel::delete(sessions::table.filter(sessions::id.eq(&session_id)))
            .execute(&mut conn)
            .await;
    }

    /// Add the git repository containing `folder` (deduped by toplevel path).
    pub async fn add_folder(&self, folder: String) -> AddRepoOutcome {
        // gitoxide discovery is blocking filesystem work — keep it off the runtime.
        let top = tokio::task::spawn_blocking(move || git::resolve_toplevel(&folder))
            .await
            .ok()
            .flatten();
        let Some(top) = top else {
            return AddRepoOutcome::NotARepository;
        };
        let Ok(mut conn) = self.conn().await else {
            return AddRepoOutcome::NotARepository;
        };

        let existing: Option<String> = repositories::table
            .filter(repositories::path.eq(&top))
            .select(repositories::id)
            .first(&mut conn)
            .await
            .ok();
        if existing.is_some() {
            return AddRepoOutcome::AlreadyPresent;
        }

        let next: Option<i32> = repositories::table
            .select(max(repositories::position))
            .first(&mut conn)
            .await
            .unwrap_or(None);
        let position = next.map(|p| p + 1).unwrap_or(0);
        let _ = diesel::insert_into(repositories::table)
            .values((
                repositories::id.eq(Uuid::new_v4().to_string()),
                repositories::path.eq(&top),
                repositories::position.eq(position),
            ))
            .execute(&mut conn)
            .await;
        drop(conn);
        self.rediscover().await;
        AddRepoOutcome::Added
    }

    /// Remove a repository and its sessions.
    pub async fn remove(&self, repo_id: String) {
        if let Ok(mut conn) = self.conn().await {
            // Explicit, so we don't depend on per-connection `PRAGMA foreign_keys`.
            let _ = diesel::delete(sessions::table.filter(sessions::repository_id.eq(&repo_id)))
                .execute(&mut conn)
                .await;
            let _ = diesel::delete(repositories::table.filter(repositories::id.eq(&repo_id)))
                .execute(&mut conn)
                .await;
        }
        self.rediscover().await;
    }

    /// Persist a new sidebar order for the repositories (their ids top to bottom).
    pub async fn reorder_repositories(&self, ordered_ids: Vec<String>) {
        let Ok(mut conn) = self.conn().await else {
            return;
        };
        for (index, id) in ordered_ids.iter().enumerate() {
            let position = index as i32;
            let _ = diesel::update(repositories::table.filter(repositories::id.eq(id)))
                .set(repositories::position.eq(position))
                .execute(&mut conn)
                .await;
        }
    }
}

impl RepoStoreCore {
    /// A pooled async connection (errors if [`Self::open`] hasn't run).
    async fn conn(
        &self,
    ) -> Result<diesel_async::pooled_connection::deadpool::Object<AsyncConn>, ()> {
        let pool = self.pool.get().ok_or(())?;
        pool.get().await.map_err(|_| ())
    }

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
        let Ok(mut conn) = self.conn().await else {
            return;
        };
        let repos = fetch_repos(&mut conn).await;
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

async fn fetch_repos(conn: &mut AsyncConn) -> Vec<Repo> {
    let rows: Vec<(String, String)> = repositories::table
        .select((repositories::id, repositories::path))
        .order(repositories::position.asc())
        .load(conn)
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

async fn fetch_session_ids(conn: &mut AsyncConn, worktree_path: &str) -> Vec<String> {
    sessions::table
        .filter(sessions::worktree_path.eq(worktree_path))
        .order(sessions::position.asc())
        .select(sessions::id)
        .load(conn)
        .await
        .unwrap_or_default()
}

async fn insert_session(conn: &mut AsyncConn, repo_id: &str, worktree_path: &str) -> Option<String> {
    let id = Uuid::new_v4().to_string();
    let next: Option<i32> = sessions::table
        .filter(sessions::worktree_path.eq(worktree_path))
        .select(max(sessions::position))
        .first(conn)
        .await
        .unwrap_or(None);
    let position = next.map(|p| p + 1).unwrap_or(0);
    diesel::insert_into(sessions::table)
        .values((
            sessions::id.eq(&id),
            sessions::repository_id.eq(repo_id),
            sessions::worktree_path.eq(worktree_path),
            sessions::position.eq(position),
        ))
        .execute(conn)
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

/// Run pending migrations synchronously (diesel_migrations is sync) on a blocking
/// thread, creating the database file if missing.
async fn run_migrations(db_path: String) {
    let _ = tokio::task::spawn_blocking(move || {
        let mut conn = SqliteConnection::establish(&db_path)?;
        conn.run_pending_migrations(MIGRATIONS)?;
        Ok::<(), Box<dyn std::error::Error + Send + Sync>>(())
    })
    .await;
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
    async fn sessions_uuid_default_and_removed_with_repo() {
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
        assert!(core.sessions(wt).await.is_empty());

        let _ = std::fs::remove_dir_all(&root);
    }
}
