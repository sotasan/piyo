import Foundation

/// A git repository the user has added to the sidebar, identified by its
/// working-directory root (the main worktree's path).
struct Repo: Identifiable, Hashable {
    let path: String
    var id: String { path }
    var name: String { (path as NSString).lastPathComponent }
}
