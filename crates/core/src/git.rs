//! Git access for the sidebar, backed by gitoxide (`gix`) — a pure-Rust git
//! implementation (no libgit2). These are internal helpers used by the store
//! ([`crate::store`]); only `Worktree` crosses the UniFFI boundary.

use std::collections::HashSet;
use std::path::Path;

/// One worktree of a git repository: its working-directory path and the short
/// name of the branch checked out there (`(detached)`/`(unborn)` when HEAD
/// isn't a normal branch).
#[derive(uniffi::Record, Clone, Debug)]
pub struct Worktree {
    pub path: String,
    pub branch: String,
}

/// Resolve any folder inside a repository to the repo's working-directory root.
/// Returns `None` when `folder` isn't part of a (non-bare) git repository.
pub(crate) fn resolve_toplevel(folder: &str) -> Option<String> {
    let repo = gix::discover(folder).ok()?;
    repo.workdir().map(normalize)
}

/// Every worktree of the repo at `repo_path` — the main worktree first, then
/// each linked worktree — each with the short name of its checked-out branch.
/// A broken/unopenable repo yields an empty list rather than erroring.
pub(crate) fn worktrees(repo_path: &str) -> Vec<Worktree> {
    let mut seen = HashSet::new();
    let mut out = Vec::new();
    let Ok(repo) = gix::open(repo_path) else {
        return out;
    };

    // Main worktree (its branch read from HEAD).
    if let Some(wd) = repo.workdir() {
        let path = normalize(wd);
        if seen.insert(path.clone()) {
            out.push(Worktree {
                branch: branch_label(&repo),
                path,
            });
        }
    }

    // Linked worktrees: list them, then open each to read its branch.
    if let Ok(proxies) = repo.worktrees() {
        for proxy in proxies {
            let Ok(base) = proxy.base() else { continue };
            let path = normalize(&base);
            if !seen.insert(path.clone()) {
                continue;
            }
            let branch = proxy
                .into_repo()
                .ok()
                .map(|r| branch_label(&r))
                .unwrap_or_else(|| "(detached)".to_string());
            out.push(Worktree { branch, path });
        }
    }
    out
}

/// Short branch name for a repo's HEAD, or `(unborn)`/`(detached)` when HEAD
/// isn't pointing at an existing branch.
fn branch_label(repo: &gix::Repository) -> String {
    match repo.head() {
        Ok(head) => match head.kind {
            gix::head::Kind::Symbolic(reference) => reference.name.shorten().to_string(),
            gix::head::Kind::Unborn(_) => "(unborn)".to_string(),
            gix::head::Kind::Detached { .. } => "(detached)".to_string(),
        },
        Err(_) => "(detached)".to_string(),
    }
}

/// Drop a trailing slash so paths compare and display cleanly.
fn normalize(p: &Path) -> String {
    let s = p.to_string_lossy();
    let trimmed = s.trim_end_matches('/');
    if trimmed.is_empty() {
        "/".to_string()
    } else {
        trimmed.to_string()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashSet;
    use std::path::Path;
    use std::process::Command;

    fn git(dir: &Path, args: &[&str]) {
        let status = Command::new("git")
            .current_dir(dir)
            .args(args)
            .env("GIT_AUTHOR_NAME", "t")
            .env("GIT_AUTHOR_EMAIL", "t@t")
            .env("GIT_COMMITTER_NAME", "t")
            .env("GIT_COMMITTER_EMAIL", "t@t")
            .status()
            .unwrap();
        assert!(status.success(), "git {args:?} failed");
    }

    #[test]
    fn resolves_toplevel_from_subdir() {
        // This crate lives in a git repo; `src/` is a subdirectory of its root.
        let sub = format!("{}/src", env!("CARGO_MANIFEST_DIR"));
        let top = resolve_toplevel(&sub).expect("should discover the repo");
        assert!(top.ends_with("/piyo"), "unexpected toplevel: {top}");
    }

    #[test]
    fn not_a_repo_is_none() {
        assert_eq!(resolve_toplevel("/"), None);
    }

    #[test]
    fn lists_main_and_linked_worktrees() {
        let tmp = std::env::temp_dir().join(format!("piyo-gixtest-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&tmp);
        let main = tmp.join("main");
        std::fs::create_dir_all(&main).unwrap();

        git(&main, &["-c", "init.defaultBranch=main", "init"]);
        std::fs::write(main.join("f.txt"), "hi").unwrap();
        git(&main, &["add", "."]);
        git(&main, &["commit", "-m", "init"]);
        // A linked worktree on a new branch `feature`, as a sibling dir.
        git(&main, &["worktree", "add", "-b", "feature", "../wt"]);

        let wts = worktrees(&main.to_string_lossy());
        let branches: HashSet<_> = wts.iter().map(|w| w.branch.as_str()).collect();
        assert_eq!(wts.len(), 2, "got: {wts:?}");
        assert!(branches.contains("main"), "got: {branches:?}");
        assert!(branches.contains("feature"), "got: {branches:?}");

        let _ = std::fs::remove_dir_all(&tmp);
    }

    #[test]
    fn unborn_head_is_labeled() {
        let dir = std::env::temp_dir().join(format!("piyo-gixunborn-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        git(&dir, &["-c", "init.defaultBranch=main", "init"]);

        let wts = worktrees(&dir.to_string_lossy());
        assert_eq!(wts.len(), 1, "got: {wts:?}");
        assert_eq!(wts[0].branch, "(unborn)");

        let _ = std::fs::remove_dir_all(&dir);
    }
}
