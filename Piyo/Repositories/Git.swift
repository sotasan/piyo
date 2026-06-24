import Foundation
import SwiftGitX
import libgit2

/// Git access for the sidebar. Opening a repo and reading its working directory
/// and HEAD branch go through SwiftGitX's Swift API; the two things SwiftGitX
/// has no API for — discovering a repo's toplevel from a subdirectory, and
/// enumerating *linked* worktrees — drop to libgit2's C API (`import libgit2`),
/// the same single libgit2 module SwiftGitX itself builds on.
enum Git {
    /// libgit2 must be initialized once before the raw C calls below. One-shot;
    /// process exit handles the matching shutdown.
    private static let initialized: Void = { git_libgit2_init() }()

    /// Resolve any folder inside a repository to the repo's working-directory
    /// root. SwiftGitX only opens an exact repo path (no discovery), so this uses
    /// libgit2's `git_repository_open_ext`. Returns nil when `folder` isn't part
    /// of a git repository.
    static func resolveToplevel(_ folder: String) -> String? {
        _ = initialized
        var repo: OpaquePointer?
        guard git_repository_open_ext(&repo, folder, 0, nil) == 0 else { return nil }
        defer { git_repository_free(repo) }
        guard let wd = git_repository_workdir(repo) else { return nil }
        return normalize(String(cString: wd))
    }

    /// Every worktree of the repo at `repoPath` — the main worktree first, then
    /// each linked worktree. Branches come from SwiftGitX; the linked-worktree
    /// list comes from libgit2. Returns whatever succeeds; a broken repo yields
    /// an empty list rather than throwing.
    static func worktrees(at repoPath: String) -> [Worktree] {
        _ = initialized
        var seen = Set<String>()
        var result: [Worktree] = []
        func add(_ path: String, _ branch: String) {
            let p = normalize(path)
            if seen.insert(p).inserted { result.append(Worktree(path: p, branch: branch)) }
        }

        // Main worktree (SwiftGitX gives both its path and branch).
        if let main = inspect(repoPath) { add(main.path, main.branch) }
        // Linked worktrees: libgit2 enumerates them, SwiftGitX reads each branch.
        for path in linkedWorktreePaths(repoPath) {
            add(path, inspect(path)?.branch ?? "(detached)")
        }
        return result
    }

    /// Open the repo at `path` with SwiftGitX and read its working directory and
    /// current branch short name. nil if it can't be opened. Works for both a
    /// main repo and a linked worktree (each has its own openable working dir).
    private static func inspect(_ path: String) -> (path: String, branch: String)? {
        guard let repo = try? Repository.open(at: URL(fileURLWithPath: path)),
            let workdir = try? repo.workingDirectory
        else { return nil }

        let branch: String
        if repo.isHEADUnborn {
            branch = "(unborn)"
        } else if repo.isHEADDetached {
            branch = "(detached)"
        } else if let head = try? repo.HEAD {
            branch = head.name  // short name, e.g. "main", via Reference.name
        } else {
            branch = "(detached)"
        }
        return (workdir.path, branch)
    }

    /// Paths of the repo's *linked* worktrees (libgit2's `git_worktree_list`
    /// omits the main one, which `worktrees(at:)` handles separately).
    private static func linkedWorktreePaths(_ repoPath: String) -> [String] {
        var repo: OpaquePointer?
        guard git_repository_open(&repo, repoPath) == 0 else { return [] }
        defer { git_repository_free(repo) }

        var names = git_strarray()
        guard git_worktree_list(&names, repo) == 0, let strings = names.strings else { return [] }
        defer { git_strarray_dispose(&names) }

        var paths: [String] = []
        for i in 0..<Int(names.count) {
            guard let cName = strings[i] else { continue }
            var wt: OpaquePointer?
            guard git_worktree_lookup(&wt, repo, cName) == 0 else { continue }
            defer { git_worktree_free(wt) }
            if let cPath = git_worktree_path(wt) { paths.append(String(cString: cPath)) }
        }
        return paths
    }

    /// Drop libgit2's trailing slash on working-directory paths so paths compare
    /// and display cleanly.
    private static func normalize(_ path: String) -> String {
        var p = path
        while p.count > 1, p.hasSuffix("/") { p.removeLast() }
        return p
    }
}
