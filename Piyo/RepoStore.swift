import Foundation
import Observation

/// A git repository the user has added to the sidebar, identified by its
/// working-directory root (the main worktree's path).
struct Repo: Identifiable, Hashable {
    let path: String
    var id: String { path }
    var name: String { (path as NSString).lastPathComponent }
}

/// The sidebar's model: the added repositories (their paths persisted in
/// `UserDefaults`) and a cache of each one's worktrees, discovered via `Git` on
/// launch and whenever a repo is added.
@Observable
final class RepoStore {
    private(set) var repos: [Repo] = []
    private var worktreesByRepo: [String: [Worktree]] = [:]
    private var tabsByWorktree: [String: [Int]] = [:]
    private let defaultsKey = "repoPaths"
    private let tabsKey = "worktreeTabs"

    init() {
        repos = (UserDefaults.standard.stringArray(forKey: defaultsKey) ?? [])
            .map(Repo.init(path:))
        tabsByWorktree =
            UserDefaults.standard.dictionary(forKey: tabsKey) as? [String: [Int]] ?? [:]
        for repo in repos { refresh(repo) }
    }

    /// The tab ids open for a worktree (each maps to its own zmx session), in
    /// display order. Defaults to a single tab. Ids are stable so closing a tab
    /// doesn't renumber the others' sessions.
    func tabs(for worktree: Worktree) -> [Int] { tabsByWorktree[worktree.path] ?? [0] }

    /// Open a new tab on `worktree` and return its id (the next unused integer).
    @discardableResult
    func addTab(to worktree: Worktree) -> Int {
        var ids = tabs(for: worktree)
        let next = (ids.max() ?? -1) + 1
        ids.append(next)
        tabsByWorktree[worktree.path] = ids
        persistTabs()
        return next
    }

    /// Close tab `id` on `worktree`, keeping at least one tab open.
    func closeTab(_ id: Int, from worktree: Worktree) {
        var ids = tabs(for: worktree)
        ids.removeAll { $0 == id }
        tabsByWorktree[worktree.path] = ids.isEmpty ? [0] : ids
        persistTabs()
    }

    /// Cached worktrees for a repo (empty until refreshed). Cached so SwiftUI
    /// renders don't re-hit libgit2 on every redraw.
    func worktrees(for repo: Repo) -> [Worktree] { worktreesByRepo[repo.path] ?? [] }

    /// Add the git repository containing `folder`. Returns an error message to
    /// show the user on failure, nil on success (or if already present).
    @discardableResult
    func add(folder: String) -> String? {
        guard let top = Git.resolveToplevel(folder) else { return "Not a git repository." }
        guard !repos.contains(where: { $0.path == top }) else { return nil }
        let repo = Repo(path: top)
        repos.append(repo)
        refresh(repo)
        persist()
        return nil
    }

    func remove(_ repo: Repo) {
        repos.removeAll { $0.path == repo.path }
        worktreesByRepo[repo.path] = nil
        persist()
    }

    private func refresh(_ repo: Repo) {
        worktreesByRepo[repo.path] = Git.worktrees(at: repo.path)
    }

    private func persist() {
        UserDefaults.standard.set(repos.map(\.path), forKey: defaultsKey)
    }

    private func persistTabs() {
        UserDefaults.standard.set(tabsByWorktree, forKey: tabsKey)
    }
}
